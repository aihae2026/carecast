// 안내도 인앱 모션 — 움직임의 규칙을 화면 없이 고정한다.
//
// 사용자가 방식을 못박았다(2026-09-01): **DOM 애니메이션이 아니라 canvas 2D + rAF**,
// 스프링(F = -kx)·lerp·벡터 물리·파티클. 그래서 여기서 두 가지를 지킨다 —
// (1) 움직임의 계산이 실제로 맞는가(순서·도착·수렴), (2) 그 방식이 나중에 조용히
// CSS transition으로 바뀌지 않는가.
//
// 계산은 src/lib/guideMap.js에만 있다(캔버스도 React도 모르는 순수 모듈). 그래서
// 노드에서 그대로 불러 돌릴 수 있다 — schedule-overlap-warning.test.js와 같은 결.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const MAP = path.join(ROOT, 'src', 'lib', 'guideMap.js')
const CANVAS = path.join(ROOT, 'src', 'components', 'shared', 'GuideMapCanvas.jsx')
const PAGE = path.join(ROOT, 'src', 'pages', 'GuideMapPage.jsx')
const APP = path.join(ROOT, 'src', 'App.jsx')
const SIDEBAR = path.join(ROOT, 'src', 'components', 'admin', 'Sidebar.jsx')

const load = () => import(pathToFileURL(MAP).href)

test('선은 모두 실제 담당끼리 잇고, 좌표는 그림 밖으로 안 나간다', async () => {
  const { NODES, EDGES, VIEW, TOKEN_ROUTES } = await load()
  const ids = new Set(NODES.map(n => n.id))
  for (const e of EDGES) {
    assert.ok(ids.has(e.from), `${e.id}의 출발(${e.from})이 없는 담당이다`)
    assert.ok(ids.has(e.to), `${e.id}의 도착(${e.to})이 없는 담당이다`)
    for (const [x, y] of e.points) {
      assert.ok(x >= 0 && x <= VIEW.w && y >= 0 && y <= VIEW.h, `${e.id}의 점이 그림 밖이다`)
    }
  }
  for (const n of NODES) {
    assert.ok(n.x >= 0 && n.x + n.w <= VIEW.w, `${n.id}가 가로로 그림 밖이다`)
    assert.ok(n.y >= 0 && n.y + n.h <= VIEW.h, `${n.id}가 세로로 그림 밖이다`)
  }

  // 조형물(차임벨·안내 음성·BGM 단추)이 타고 갈 길도 **실제 선**이어야 하고 이어져야 한다.
  // 2026-09-05에 선 이름을 바꾸면서(office-clock → office-ledger 등) 이 표를 안 고쳤다.
  // launchToken이 edgeById로 못 찾고 조용히 빠져나가서 **단추 셋이 아무 일도 안 했다** —
  // 아무 에러도 안 나므로 눌러 보기 전에는 모른다. 그래서 여기서 잡는다.
  const edgeIds = new Set(EDGES.map(e => e.id))
  for (const [kind, route] of Object.entries(TOKEN_ROUTES)) {
    for (const id of route) {
      assert.ok(edgeIds.has(id), `${kind} 조형물의 길에 없는 선 '${id}'이 있다`)
    }
    for (let i = 1; i < route.length; i++) {
      const prev = EDGES.find(e => e.id === route[i - 1])
      const cur = EDGES.find(e => e.id === route[i])
      assert.equal(prev.to, cur.from,
        `${kind} 조형물의 길이 끊긴다 — ${route[i - 1]}은 ${prev.to}에서 끝나는데 ${route[i]}는 ${cur.from}에서 출발한다`)
    }
  }
})

test('한 판을 돌리면 다섯 단계를 순서대로 지나 스피커와 TV까지 켜진다', async () => {
  const { createState, startRun, update } = await load()
  const s = createState()
  startRun(s, 'office')

  const steps = []
  for (let i = 0; i < 3500 && s.phase !== 'done'; i++) {
    update(s, 16)
    if (s.step && steps[steps.length - 1] !== s.step) steps.push(s.step)
  }

  assert.equal(s.phase, 'done', '한 판이 끝나야 한다 — 안 끝나면 어딘가에서 짐이 영영 안 도착한다')
  assert.deepEqual(steps, [1, 2, 3, 4, 5], '단계가 순서대로 한 번씩 지나가야 한다')
  // 소리 두 갈래가 이 그림의 핵심이다 — 둘 다 실제로 켜졌는지 본다
  for (const id of ['clock', 'runner', 'sound', 'ledger', 'speaker', 'tv', 'watch', 'internet']) {
    assert.ok(s.nodes[id].visited, `${id}까지 불이 닿아야 한다`)
  }
  // 이 상한은 '멈췄나'를 보는 것이지 UX 기준이 아니다. 2026-09-05에 박자 체류를
  // 자막 길이로 계산하게 바꾸면서(readMs) 한 판이 20초를 넘었다 — 사용자 지시로 느리게 한 것이다.
  assert.ok(s.t < 40, `한 판이 40초 안에 끝나야 한다 — 안 끝나면 짐이 영영 안 도착한 것이다(실측 ${s.t.toFixed(1)}초)`)
})

test('누른 쪽에서 짐이 출발한다 — 사무실이면 사무실, 폰이면 폰', async () => {
  const { createState, startRun, update } = await load()
  // 2026-09-04: 예약은 시계 지킴이가 아니라 **장부**로 간다(실제 코드가 그렇다 —
  // insertSchedule()이 schedules 표에 적고 scheduler가 매분 그 표를 읽는다).
  // 이 테스트가 옛 배선(office-clock)을 사실처럼 적고 있었다.
  for (const [source, edge] of [['office', 'office-ledger'], ['phone', 'phone-ledger']]) {
    const s = createState()
    startRun(s, source)
    update(s, 16)
    assert.equal(s.packets[0].edge, edge, `${source}에서 시작하면 ${edge}로 나가야 한다`)
    assert.ok(s.nodes[source].visited, '누른 네모부터 켜져야 한다')
  }
})

test('스프링은 목표를 한 번 지나쳤다가 목표로 수렴한다', async () => {
  const { springStep } = await load()
  let x = 0
  let v = 0
  let over = false
  for (let i = 0; i < 400; i++) {
    const r = springStep(x, v, 1, 1 / 60)
    x = r.x
    v = r.v
    if (x > 1.02) over = true
  }
  assert.ok(over, '목표를 살짝 지나쳐야 켜질 때 통 하는 맛이 난다(과감쇠면 밋밋하다)')
  assert.ok(Math.abs(x - 1) < 0.01, `목표로 수렴해야 한다(끝값 ${x.toFixed(3)})`)
  assert.ok(Math.abs(v) < 0.05, '멈춰야 한다 — 안 멈추면 발진이다')
})

test('창을 한참 두고 왔다 와도 한 걸음이 튀지 않는다', async () => {
  const { createState, startRun, update, pathLength, edgeById } = await load()
  const s = createState()
  startRun(s, 'office')
  update(s, 16)
  const len = pathLength(edgeById(s.packets[0].edge).points)
  update(s, 5000)      // 탭을 5초 두고 온 상황 — rAF가 큰 dt를 준다
  for (const p of s.packets) {
    assert.ok(Number.isFinite(p.d), '짐 위치가 숫자가 아니게 되면 화면이 통째로 멈춘다')
    assert.ok(p.d >= 0 && p.d <= len + 1, '한 번에 길 밖으로 튀어 나가면 안 된다')
  }
  assert.ok(s.t < 1, '큰 dt는 잘라서 쓴다 — 안 자르면 스프링이 발산한다')
})

test('파티클은 마찰로 느려지고 수명이 끝나면 사라진다', async () => {
  const { createState, startRun, update } = await load()
  const s = createState()
  startRun(s, 'office')
  update(s, 16)
  assert.ok(s.particles.length > 0, '시작하면 파티클이 생겨야 한다')
  const first = s.particles[0]
  const speed0 = Math.hypot(first.vx, first.vy)
  update(s, 100)
  assert.ok(Math.hypot(first.vx, first.vy) < speed0, '마찰이 걸려야 한다')
  for (let i = 0; i < 200; i++) update(s, 16)
  assert.ok(s.particles.length < 400, '파티클이 무한히 쌓이면 오래 열어 둔 화면이 느려진다')
})

test('되풀이를 켜면 사무실과 폰을 번갈아 돈다', async () => {
  const { createState, startRun, update } = await load()
  const s = createState()
  s.loop = true
  startRun(s, 'office')
  for (let i = 0; i < 4000 && !(s.phase === 'run' && s.source === 'phone'); i++) update(s, 16)
  assert.equal(s.source, 'phone', '한 판이 끝나면 반대쪽에서 다시 시작해야 한다')
})

test('그림은 canvas 2D + requestAnimationFrame으로 그린다 (사용자가 정한 방식)', () => {
  const src = fs.readFileSync(CANVAS, 'utf8')
  assert.ok(src.includes('requestAnimationFrame'), 'rAF 루프여야 한다')
  assert.ok(src.includes("getContext('2d')"), 'canvas 2D여야 한다')
  assert.ok(src.includes('devicePixelRatio'), '고해상도 화면에서 글씨가 뭉개지면 안 된다')
  // 움직임을 CSS로 옮기면 사용자가 정한 방식(캔버스 물리)이 조용히 사라진다
  assert.equal(/animate-|transition-all|@keyframes/.test(src), false,
    '움직임은 캔버스가 계산한다 — CSS 애니메이션으로 대체하지 않는다')
  // 계산은 lib에만 — 여기서 다시 만들면 테스트가 못 본다
  assert.ok(src.includes("from '../../lib/guideMap'"), '움직임의 규칙은 lib/guideMap.js 한 곳이다')
})

test('움직임을 줄인 사람에게는 루프를 안 돌린다', () => {
  const canvas = fs.readFileSync(CANVAS, 'utf8')
  const page = fs.readFileSync(PAGE, 'utf8')
  assert.ok(page.includes('prefers-reduced-motion'), '설정을 읽어야 한다')
  assert.ok(canvas.includes('if (reduced)'), '그럴 때는 rAF를 아예 안 건다')
  assert.ok(canvas.includes('fastForward'), '대신 계산만 끝까지 돌려 결과 그림을 보여 준다')
})

test('그림의 박자와 화면의 글 목록은 같은 출처를 본다', () => {
  const page = fs.readFileSync(PAGE, 'utf8')
  assert.ok(page.includes("from '../lib/guideMap'") && page.includes('BEATS'),
    '두 곳에 따로 적으면 그림과 글이 서로 다른 순서를 말하게 된다')
})

test('/guide는 방송 재생을 안 태우는 별도 껍데기다', () => {
  const src = fs.readFileSync(APP, 'utf8')
  assert.ok(src.includes("const _IS_GUIDE = window.location.pathname === '/guide'"),
    '주소로 갈라야 한다')
  assert.ok(src.includes('if (_IS_GUIDE) {'), '안내도 전용 껍데기가 있어야 한다')
  // 재생 담당(leader) 경쟁에 끼면 현장 PC에서 안내도를 띄운 것만으로 소리 담당이 바뀐다
  assert.equal(src.split('_IS_DEV_CONSOLE || _IS_GUIDE').length - 1, 2,
    'leader 선출과 중복 창 판정 두 곳 모두에서 빠져야 한다')
})

test('안내도로 가는 길은 navigate가 아니라 주소 이동이다', () => {
  const src = fs.readFileSync(SIDEBAR, 'utf8')
  assert.ok(src.includes('href="/guide"'), '사이드바에 안내도 링크가 있어야 한다')
  assert.equal(src.includes("navigate('/guide')"), false,
    'navigate로 가면 본 앱 Routes에 /guide가 없어 빈 화면이 된다(/dev-console에서 겪은 함정)')
  // 이 화면은 직원·방문객에게 보여 주는 것이라 개발 빌드 가드 **밖**에 있어야 한다.
  // 위치 비교가 아니라 가드 블록을 잘라서 본다 — 링크를 옮겨 적어도 판정이 그대로다.
  const guardAt = src.indexOf('{import.meta.env.DEV && (')
  assert.ok(guardAt > 0, '개발 전용 가드 블록을 못 찾았다')
  const NL = String.fromCharCode(10)
  const guardEnd = src.indexOf(NL + '        )}', guardAt)
  const guarded = src.slice(guardAt, guardEnd > 0 ? guardEnd : guardAt)
  assert.equal(guarded.includes('href="/guide"'), false,
    '안내도는 현장 빌드(dist)에서도 보여야 한다 — DEV 가드 안에 넣으면 직원에게 안 보인다')
  assert.ok(guarded.includes('고도화 제안'), '가드 블록을 잘못 잘랐다')
})
