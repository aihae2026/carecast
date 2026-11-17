// 통합 홈의 검색창·초안 카드 — **옷만 갈아입고 로직은 하나** (2026-09-13).
//
// 고정하는 것 셋:
//
//  ① **색은 셋뿐이다**(사용자 결정 2026-09-13). 말 파랑 · 음악 자주 · 순서 보라.
//     넷째 색이 슬그머니 붙으면 "이 색이 무슨 뜻이냐"를 사람이 더는 못 외운다.
//     규칙의 단일 출처는 `src/lib/broadcastKind.js` — 여기서 **실제로 돌려** 본다.
//
//  ② **유형은 서버가 정한다.** 문장만 보고 색을 미리 칠하려면 유형 사전
//     (`server/domain/ontology.js`)의 사본을 브라우저에 둬야 한다. 그 사본이 서버와
//     갈리는 날 화면은 파란데 실제로는 음악이 나간다 — 이 저장소가 볼륨·묶음에서
//     이미 겪은 모양이다. 그래서 화면에 낱말 사전이 없는지 본다.
//
//  ③ **쉬운 화면은 그대로다.** `tone` 의 기본값이 `easy` 이고, 기존 세 화면이
//     `tone` 을 넘기지 않아야 이번 작업이 그 화면들을 건드리지 않은 것이다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { pathToFileURL } = require('url')

const ROOT  = path.join(__dirname, '..', '..')
const KIND  = path.join(ROOT, 'src', 'lib', 'broadcastKind.js')
const ASK   = path.join(ROOT, 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx')
const HOME  = path.join(ROOT, 'src', 'components', 'home')
const PAGE  = path.join(ROOT, 'src', 'pages', 'HomeMode.jsx')
// 이 입력창을 이미 쓰고 있던 화면들 — 이번 작업이 여기를 건드리지 않았다는 증거.
// **`tone` 을 아예 안 넘기는 화면**만 여기 둔다.
const EASY_CALLERS = [
  path.join(ROOT, 'src', 'components', 'easy', 'ScheduledBroadcastMini.jsx'),
]
// 달력은 예외다 — 그 자신이 `tone` 을 받아 **그대로 흘려보낸다**(§5-3).
// 그러므로 "안 넘기는가"가 아니라 **"제 기본값이 easy 인가"** 로 본다.
const WEEKLY = path.join(ROOT, 'src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx')

const load = () => import(pathToFileURL(KIND).href)
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

test('유형 → 색 갈래: 말 파랑 · 음악 자주 · 순서 보라', async () => {
  const { kindOfType } = await load()
  assert.equal(kindOfType('text'), 'tts')
  assert.equal(kindOfType('bgm'), 'bgm')
  assert.equal(kindOfType('flow'), 'flow')
})

test('넷째 색을 만들지 않는다 — 차임벨·음원·영상은 색이 없다', async () => {
  const { kindOfType } = await load()
  for (const t of ['chime', 'audio', 'video', '', null, undefined, 'no-such-type']) {
    assert.equal(kindOfType(t), '', `${t} 에 색이 붙었다 — 색은 셋뿐이다`)
  }
})

test('자동 일과방송은 흐름이다 — broadcast_type 이 없어도', async () => {
  const { kindOfItem } = await load()
  assert.equal(kindOfItem({ kind: 'auto' }), 'flow',
    '일과방송 5종은 여러 단계가 이어지는 흐름이다(settings 로 돌아서 type 이 없다)')
  assert.equal(kindOfItem({ kind: 'schedule', type: 'text' }), 'tts')
  assert.equal(kindOfItem({ kind: 'schedule', type: 'chime' }), '')
  assert.equal(kindOfItem(null), '')
})

test('색 이름은 세 벌뿐 — 통합 홈 어디에도 넷째 계열이 없다', () => {
  // v3 옷을 입는 파일은 **전부** 본다 — 새 화면을 더할 때 여기 한 줄을 같이 더한다.
  const files = [
    ASK, PAGE, WEEKLY,
    path.join(ROOT, 'src', 'pages', 'CalendarMode.jsx'),
    path.join(ROOT, 'src', 'lib', 'broadcastKind.js'),
    ...fs.readdirSync(HOME).map(f => path.join(HOME, f)),
  ]
  // tokens.css 에 실제로 있는 v3 이름만 쓴다. 색 계열은 tts·bgm·flow·drop 넷이고
  // 나머지(bg·surface·line·ink·hair·shadow)는 무채색이라 갈래가 아니다.
  const ALLOWED = new Set([
    'bg', 'surface', 'surface-2', 'line', 'line-2', 'ink', 'ink-2', 'ink-3', 'hair',
    'tts', 'tts-bg', 'tts-line', 'bgm', 'bgm-bg', 'bgm-line', 'flow', 'flow-bg', 'flow-line',
    'drop-tts', 'drop-bgm',
    // **경고색**(G-6, 2026-09-16 신설). 포인트 색이 아니라 안전 장치다 — 실패·누락에만
    // 쓰고 반드시 글자와 함께 쓴다. 가이드라인이 `--warn` 이라고 부르던 자리이고,
    // 이름만 있고 토큰이 없어서 그동안 옛 벌의 `cc-danger` 가 그 일을 하고 있었다.
    'warn', 'warn-bg',
  ])
  let seen = 0
  for (const f of files) {
    if (!/\.(jsx|js)$/.test(f)) continue
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    for (const m of code.matchAll(/ds-v3-([a-z0-9-]+)/g)) {
      seen++
      assert.ok(ALLOWED.has(m[1]), `${path.basename(f)} 에 없는 색 이름 --ds-v3-${m[1]}`)
    }
  }
  assert.ok(seen > 20, `v3 색 이름을 ${seen}개밖에 못 찾았다 — 파일이 옮겨졌으면 이 시험도 옮긴다`)
})

test('화면이 유형을 스스로 알아내지 않는다 — 유형 사전은 서버에만 있다', () => {
  const code = codeOnly(fs.readFileSync(ASK, 'utf8'))
  assert.match(code, /import \{[^}]*kindOfType[^}]*\} from '\.\.\/\.\.\/lib\/broadcastKind'/,
    '색 갈래를 공용 규칙에서 안 가져온다')
  assert.match(code, /kindOfType\(draft\.broadcast_type\)/,
    '서버가 정한 유형이 아니라 다른 것으로 색을 정하고 있다')
  // 목업은 타이핑 중에 낱말로 색을 미리 칠한다. 제품에서 그렇게 하려면 사전 사본이 필요하다
  for (const word of ['클래식', '찬양', '자연의 소리', '루틴']) {
    assert.ok(!code.includes(word),
      `유형 낱말 "${word}" 이 화면에 들어왔다 — 사전은 server/domain/ontology.js 한 곳이다`)
  }
})

test('쉬운 화면은 그대로다 — tone 기본값이 easy 이고 기존 화면은 안 넘긴다', () => {
  const code = codeOnly(fs.readFileSync(ASK, 'utf8'))
  assert.match(code, /function QuickSchedulePhrase\(\{[^}]*tone = 'easy'/,
    "tone 의 기본값이 'easy' 가 아니다 — 기존 세 화면의 모습이 그 자리에서 바뀐다")
  for (const f of EASY_CALLERS) {
    const c = codeOnly(fs.readFileSync(f, 'utf8'))
    // 큰 파일을 통째로 단언에 싣지 않는다 — 빨간불 때 화면이 파일 하나로 덮인다
    const tag = c.match(/<QuickSchedulePhrase[^>]*>/)
    assert.ok(tag, `${path.basename(f)} 가 이 입력창을 안 쓴다 — 시험을 다시 본다`)
    assert.ok(!/\btone=/.test(tag[0]),
      `${path.basename(f)} 가 tone 을 넘긴다 — 쉬운 화면 모습이 바뀐다: ${tag[0]}`)
  }
  const homeTag = codeOnly(fs.readFileSync(PAGE, 'utf8')).match(/<QuickSchedulePhrase[^>]*>/)
  assert.ok(homeTag && /tone="v3"/.test(homeTag[0]), '통합 홈이 v3 옷을 안 입는다')
})

test('즉시 방송도 옷만 갈아입는다 — 쉬운 화면 두 자리는 tone 을 안 넘긴다', () => {
  // V② 적대 검수(2026-09-13)가 잡은 구멍: 이 부품의 기본값을 `'v3'` 로 바꿔도 **전부 초록불**
  // 이었다. `tone` 을 받는 넷 중 이것만 앵커가 없었다.
  const INST = path.join(ROOT, 'src', 'components', 'easy', 'InstantBroadcast.jsx')
  const EASY = path.join(ROOT, 'src', 'pages', 'EasyMode.jsx')
  const code = codeOnly(fs.readFileSync(INST, 'utf8'))
  assert.match(code, /function InstantBroadcast\(\{[^}]*tone = 'easy'/,
    "InstantBroadcast 의 tone 기본값이 'easy' 가 아니다 — 쉬운 화면의 초록이 그 자리에서 파랑이 된다")

  const easy = codeOnly(fs.readFileSync(EASY, 'utf8'))
  const tags = [...easy.matchAll(/<InstantBroadcast[^>]*>/g)].map(m => m[0])
  assert.ok(tags.length >= 2, `쉬운 화면에서 즉시 방송을 ${tags.length}곳밖에 못 찾았다`)
  for (const t of tags) {
    assert.ok(!/\btone=/.test(t), `쉬운 화면이 tone 을 넘긴다: ${t}`)
  }
  const home = codeOnly(fs.readFileSync(PAGE, 'utf8')).match(/<InstantBroadcast[^>]*>/)
  assert.ok(home && /tone="v3"/.test(home[0]), '통합 홈이 v3 옷을 안 입는다')
})

test('달력도 옷만 갈아입는다 — 제 기본값이 easy 이고 그대로 흘려보낸다', () => {
  // 관리자 화면은 `<WeeklySchedule />` 로 부른다(`AdminMode` 의 sectionMap). 기본값이
  // `easy` 여야 **지금 모습 그대로**다. 캘린더 탭만 `v3` 를 준다.
  const w = codeOnly(fs.readFileSync(WEEKLY, 'utf8'))
  assert.match(w, /function WeeklySchedule\(\{[^}]*tone = 'easy'/,
    "WeeklySchedule 의 tone 기본값이 'easy' 가 아니다 — 관리자 화면 색이 그 자리에서 바뀐다")
  const tag = w.match(/<QuickSchedulePhrase[^>]*>/)
  assert.ok(tag && /tone=\{tone\}/.test(tag[0]),
    `달력 안의 입력창이 제 화면의 옷을 안 따라간다: ${tag ? tag[0] : '(없음)'}`)

  const cal = codeOnly(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'CalendarMode.jsx'), 'utf8'))
  const calTag = cal.match(/<WeeklySchedule[^>]*>/)
  assert.ok(calTag && /tone="v3"/.test(calTag[0]), '캘린더 탭이 v3 옷을 안 입는다')
  // 달력을 새로 만들지 않았다는 증거 — 기존 화면을 그대로 얹는다
  assert.match(cal, /import WeeklySchedule from '\.\.\/components\/admin\/sections\/WeeklySchedule'/,
    '캘린더가 기존 달력을 안 쓴다 — 새로 만들면 끌어 옮기기·팝업·일시정지를 잃는다')
})

test('캘린더 범례가 칩 색과 같은 말을 한다 — 손으로 적지 않는다', async () => {
  // **왜**: 처음엔 "음원 · 차임벨 · 영상 · TV" 라고 손으로 적었다. 그런데 TV(`youtube-tv`)는
  // `kindOfType` 이 음악(자주)으로 보낸다 — **칩은 자주인데 범례는 "색 없음"이라고 말하고
  // 있었다**(V③ 검수 2026-09-13 지적). 범례가 거짓말을 하면 색을 준 의미가 없다.
  // 그래서 범례를 규칙에서 뽑게 고쳤고, 여기서 **그 규칙을 실제로 돌려** 확인한다.
  const { kindOfType } = await load()
  // **줄끝을 먼저 맞춘다.** 이 작업 트리는 CRLF 라 `'\n\n'` 으로 토막을 끊으면 아무 데도
  // 안 걸려서 **파일 전체가 한 토막**이 된다 — 실제로 그렇게 오탐이 났다.
  const src = fs.readFileSync(WEEKLY, 'utf8').split('\r\n').join('\n')

  // 범례가 손으로 적은 유형 목록을 다시 들고 있지 않은지
  const i = src.indexOf('const V3_LEGEND = ')
  assert.ok(i >= 0, '범례를 규칙에서 안 뽑는다 — 손으로 적으면 칩 색과 갈린다')
  const end = src.indexOf('\n\n', i)
  assert.ok(end > i, '범례 토막의 끝을 못 찾았다')
  const 범례 = src.slice(i, end)
  assert.match(범례, /kindOfType\(/, '범례가 갈래 규칙을 안 본다')
  assert.match(범례, /TYPE_STYLE\[t\]\??\.label/, '범례가 유형 이름을 직접 적고 있다')

  // 규칙 자체가 맞는지 — 이 화면이 아는 유형 전부를 돌려 본다
  const j = src.indexOf('const TYPE_STYLE = {')
  const 블록 = src.slice(j, src.indexOf('\n}', j))
  const 유형 = [...블록.matchAll(/^\s*'?([\w-]+)'?:\s*\{/gm)].map(m => m[1]).filter(t => t !== 'auto')
  // (TV 송출 유형은 2026-09-21 걷어냈다 — 여섯이다)
  assert.ok(유형.length >= 6, `유형을 ${유형.length}개밖에 못 찾았다 — 목록이 옮겨졌으면 이 시험도 옮긴다`)

  const 무색 = 유형.filter(t => kindOfType(t) === '')
  assert.deepEqual(무색.sort(), ['audio', 'chime', 'video'],
    `색 없는 유형이 바뀌었다: ${무색.join(', ')} — 범례와 칩이 갈리지 않는지 다시 본다`)
})

test('저장 중에는 초안을 닫는 길이 하나도 없다', () => {
  // **왜**: `reset()` 은 draft 를 지우지만 이미 날아간 저장 요청은 못 되돌린다. 저장이
  // 실패하면 그 사유(`saveError`)는 draft 안에서만 그려지므로, 먼저 닫히면 **예약이 안
  // 만들어졌는데 사람은 아무 말도 못 듣는다.** V③ 검수(2026-09-13)가 새 ✕ 단추에서 잡았다.
  //
  // 철자가 아니라 **구조**로 본다 — `reset` 을 부르는 단추를 **전부** 찾아 하나하나 확인한다.
  // 그래야 나중에 셋째 닫기 길이 생겨도 이 시험이 잡는다.
  const code = codeOnly(fs.readFileSync(ASK, 'utf8'))
  const tags = [...code.matchAll(/<button[^>]*onClick=\{reset\}[^>]*>/g)].map(m => m[0])
  assert.ok(tags.length >= 2,
    `초안을 닫는 단추를 ${tags.length}개밖에 못 찾았다 — 이름이 바뀌었으면 이 시험을 다시 본다`)
  for (const t of tags) {
    assert.ok(/disabled=\{saving\}/.test(t),
      '저장 중에도 눌리는 닫기 단추가 있다 — 실패 사유가 화면에서 사라진다: '
      + t.replace(/\s+/g, ' ').slice(0, 120))
  }
})

test('저장 경로는 한 벌뿐 — 통합 홈이 따로 예약을 만들지 않는다', () => {
  const files = [PAGE, ...fs.readdirSync(HOME).map(f => path.join(HOME, f))]
  for (const f of files) {
    if (!/\.(jsx|js)$/.test(f)) continue
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    assert.doesNotMatch(code, /\b(createSchedule|parseSchedulePhrase)\b/,
      `${path.basename(f)} 가 예약을 직접 만들고 있다 — 검토 게이트가 두 벌이 되면 한쪽만 고쳐진다`)
  }
})
