// 통합 홈의 "다음 방송"이 묶음 때문에 틀린 말을 하지 않는다 (2026-09-13).
//
// **왜 이 시험이 있나**: V③ Codex 독립검수가 잡은 자리다. 묶은 줄의 상태는
// "누락 > 대기 > 완료"로 덮어쓴다. 그래서 09:10 이 안 나가고 09:20 이 아직 남은 묶음은
// 줄 전체가 `missed` 가 되고, **줄에서** pending 을 찾으면 그 묶음이 통째로 건너뛰어져
// "오늘 남은 방송 없음"이 뜬다 — 아직 나갈 방송이 있는데도.
// 반대로 09:10 이 나가고 09:20 이 남은 묶음은 줄의 시각(09:10)을 "다음"으로 보여 준다.
// 둘 다 **사람에게 틀린 말을 하는 것**이고, 이 저장소에서 가장 비싼 실패의 모양이다.
//
// **이 시험은 한 번 가짜였다(2026-09-13, V③ 2차 지적).** 계산이 `HomeToday.jsx` 안에
// 있어서 노드로 못 돌렸고, 그래서 **소스를 글자로 읽는 것**밖에 안 했다. Codex 가
// `findNextItem` 의 **본문**을 `return null` 로, 또 완료 항목을 고르도록 바꿔 보니
// **5건이 전부 통과**했다 — 이름과 부르는 자리만 봤지 무엇을 고르는지는 안 봤다.
// 그래서 계산을 `src/lib/todayRows.js` 로 내리고 **실제로 돌려서** 고정한다
// (`guide-map.test.js`·`schedule-overlap-warning.test.js` 와 같은 결).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const MOD  = path.join(ROOT, 'src', 'lib', 'todayRows.js')
const SRC  = path.join(ROOT, 'src', 'components', 'home', 'HomeToday.jsx')

const load = () => import(pathToFileURL(MOD).href)

// 환기방송 1·2차처럼 같은 `group_id` 로 20분 안에 붙어 있는 한 쌍.
// (실제 현장 값이다 — PROJECT_PROFILE §6-1: 09:10·09:20 환기방송)
const pair = (s1, s2) => [
  { id: 1, group_id: 'g1', time: '09:10', label: '환기방송 1차', type: 'text', status: s1 },
  { id: 2, group_id: 'g1', time: '09:20', label: '환기방송 2차', type: 'text', status: s2 },
]
const alone = (time, label, status, id = 9) =>
  ({ id, group_id: null, time, label, type: 'text', status })

test('누락이 섞인 묶음이 남아 있으면 "다음"을 건너뛰지 않는다', async () => {
  const { findNextItem, groupItems } = await load()
  const items = pair('missed', 'pending')

  // 줄은 하나로 접히고 그 줄의 상태는 `missed` 다 — 여기까지는 의도한 대로다
  const rows = groupItems(items)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'missed')

  // **그런데 다음 방송은 아직 남아 있다.** 줄에서 찾으면 여기서 null 이 된다
  const next = findNextItem(items)
  assert.notEqual(next, null, '아직 나갈 09:20 이 있는데 "오늘 남은 방송 없음"이 된다')
  assert.equal(next.time, '09:20')
  assert.equal(next.label, '환기방송 2차')
})

test('이미 나간 시각을 "다음"이라고 말하지 않는다', async () => {
  const { findNextItem } = await load()
  const next = findNextItem(pair('done', 'pending'))
  assert.equal(next.time, '09:20', '묶음의 첫 시각(09:10)은 이미 나갔다')
  assert.equal(next.label, '환기방송 2차')
})

test('대기가 하나도 없으면 null — 그때만 "남은 방송 없음"이다', async () => {
  const { findNextItem } = await load()
  assert.equal(findNextItem(pair('done', 'done')), null)
  assert.equal(findNextItem(pair('missed', 'missed')), null)
  assert.equal(findNextItem([]), null)
  assert.equal(findNextItem(null), null)
})

test('대기가 여럿이면 가장 이른 것 — 서버가 준 순서를 그대로 쓴다', async () => {
  const { findNextItem } = await load()
  const items = [
    alone('07:50', '아침 종합 방송', 'done', 10),
    ...pair('missed', 'pending'),
    alone('11:10', '점심 식사 전', 'pending', 11),
    alone('18:00', '저녁 마무리', 'pending', 12),
  ]
  const next = findNextItem(items)
  assert.equal(next.time, '09:20')
  assert.equal(next.label, '환기방송 2차')
})

test('"다음" 표시는 그 항목을 담고 있는 줄에 붙는다 — 한 건짜리 줄도 같은 규칙', async () => {
  const { findNextItem, groupItems, findRowOf } = await load()

  // 묶인 줄
  const grouped = pair('missed', 'pending')
  const gRows = groupItems(grouped)
  const gRow = findRowOf(gRows, findNextItem(grouped))
  assert.equal(gRow, gRows[0], '09:20 을 담고 있는 묶음 줄에 "다음"이 붙어야 한다')
  assert.equal(gRow._isGroup, true)

  // 혼자 있는 줄 — `_items` 가 없으면 여기서 조용히 null 이 된다
  const single = [alone('07:50', '아침 종합 방송', 'done', 10), alone('18:00', '저녁 마무리', 'pending', 12)]
  const sRows = groupItems(single)
  const sRow = findRowOf(sRows, findNextItem(single))
  assert.notEqual(sRow, null, '한 건짜리 줄에 `_items` 가 없다 — "다음" 표시가 어디에도 안 붙는다')
  assert.equal(sRow.time, '18:00')

  // 고를 것이 없으면 줄도 없다
  assert.equal(findRowOf(sRows, null), null)
})

test('묶음 상태는 누락 > 대기 > 완료 순으로 덮어쓴다 — 하나라도 안 나갔으면 보여야 한다', async () => {
  const { groupItems } = await load()
  assert.equal(groupItems(pair('missed', 'pending'))[0].status, 'missed')
  assert.equal(groupItems(pair('done', 'pending'))[0].status, 'pending')
  assert.equal(groupItems(pair('done', 'done'))[0].status, 'done')
})

test('묶인 줄은 시각 구간을 들고 있다 — 화면이 "09:10~09:20"으로 적을 수 있게', async () => {
  const { groupItems } = await load()
  const row = groupItems(pair('done', 'pending'))[0]
  assert.equal(row.time, '09:10')
  assert.equal(row._time_end, '09:20')
})

// ── 여기부터는 화면(JSX)이 위 규칙을 실제로 쓰고 있는지 ────────────────────────
// 계산은 위에서 돌려 봤다. 남은 위험은 **화면이 그 결과를 안 쓰는 것**이라 소스를 본다.
//
// **부정 단언은 주석을 보면 안 된다.** 이 파일들의 머리말에는 "처음엔 getSchedules() 를
// 읽었다"는 실패 기록이 일부러 적혀 있다 — 주석째로 보면 그 기록 때문에 빨간불이 난다
// (실제로 한 번 그렇게 났다). 그래서 코드만 남기고 본다.
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')     // 블록 주석
  .replace(/^\s*\/\/.*$/gm, '')          // 줄 주석
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')  // JSX 주석

test('감시할 대상이 있다 — HomeToday 가 그 자리에서 순수 모듈을 쓴다', () => {
  assert.ok(fs.existsSync(SRC), 'HomeToday.jsx 가 없다 — 옮겼으면 이 시험도 같이 옮긴다')
  assert.ok(fs.existsSync(MOD), 'todayRows.js 가 없다 — 옮겼으면 이 시험도 같이 옮긴다')
  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  assert.match(code, /import\s*\{[^}]*findNextItem[^}]*\}\s*from\s*'\.\.\/\.\.\/lib\/todayRows'/,
    '화면이 순수 모듈을 안 쓴다 — 계산이 JSX 로 되돌아오면 다시 못 돌린다')
  assert.match(code, /findNextItem\(items\)/,
    '다음 항목을 items 에서 찾지 않는다 — 묶은 줄에서 찾으면 누락 섞인 묶음이 통째로 건너뛰어진다')
  assert.doesNotMatch(code, /rows\.find\(\s*r\s*=>\s*r\.status\s*===\s*'pending'\s*\)/,
    '묶은 줄에서 pending 을 찾고 있다 — 09:10 누락 + 09:20 대기 묶음이 "남은 방송 없음"이 된다')
})

test('바닥글 시각이 묶음의 첫 시각이 아니라 그 항목의 시각이다', () => {
  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  assert.match(code, /다음 \$\{nextItem\.time\}/,
    '바닥글이 nextItem.time 을 안 쓴다 — 이미 나간 09:10 을 "다음"으로 말하게 된다')
  assert.doesNotMatch(code, /다음 \$\{nextRow\.time\}/,
    '바닥글이 묶은 줄의 시각을 쓰고 있다')
})

test('하루치 목록에서 색 붙은 줄이 소수다 — 색은 예외를 가리킨다 (G-2·G-18·G-34)', async () => {
  // **왜 이 시험이 있나**: 처음엔 색을 줄 수 있으면 다 줬다. 자동 5종이 보라, 환기가 파랑이라
  // 여덟 줄이 **전부** 색 알약을 달았고 사용자가 *"AI 냄새난다"* 고 했다.
  // 한 목록에서 색 붙은 줄이 절반을 넘으면 **그 색은 아무것도 가리키지 못한다.**
  // 목업은 여덟 줄 중 둘만 색이다. 규칙이 되살아나지 않게 **현장 하루**로 재 둔다.
  const { tagOfRow } = await import(pathToFileURL(
    path.join(ROOT, 'src', 'lib', 'broadcastKind.js')).href)
  const { groupItems } = await load()

  // 현장 실제 구성(PROJECT_PROFILE §6·§6-1): 자동 5종 + 환기 3쌍 + 그날의 예약 둘
  const 항목 = [
    ...['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']
      .map((id, i) => ({ kind: 'auto', id, type: null, time: `0${i + 5}:00`, status: 'done' })),
    ...[['g1', '09:10'], ['g1', '09:20'], ['g2', '12:00'], ['g2', '12:10'], ['g3', '17:00'], ['g3', '17:10']]
      .map(([g, t], i) => ({ kind: 'schedule', id: 100 + i, type: 'text', group_id: g, time: t, status: 'done' })),
    { kind: 'schedule', id: 201, type: 'text', group_id: null, time: '14:00', status: 'pending' },
    { kind: 'schedule', id: 202, type: 'bgm', group_id: null, time: '15:00', status: 'pending' },
  ]

  // **날것이 아니라 실제로 화면에 그려지는 줄로 잰다.** 처음엔 날것으로만 쟀는데,
  // `groupItems` 가 묶은 줄을 새 객체로 만들면서 `group_id` 를 안 물려줘서
  // **환기방송에 색 태그가 그대로 붙어 있었다**(브라우저에서 눈으로 보고 알았다).
  // 시험이 화면과 다른 것을 재고 있었던 것이다.
  const rows = groupItems(항목)
  const 태그 = rows.map(tagOfRow)
  const 색붙은줄 = 태그.filter(t => t && t.kind).length
  assert.ok(색붙은줄 <= 2,
    `${rows.length}줄 중 ${색붙은줄}줄에 색이 붙었다 — 색이 기본값이 되면 아무것도 못 가리킨다`)

  const 자동 = rows.map((r, i) => [r, 태그[i]]).filter(([r]) => r.kind === 'auto')
  assert.equal(자동.length, 5, '자동 일과방송 다섯 줄을 못 찾았다')
  for (const [, t] of 자동) {
    assert.deepEqual(t, { kind: '', label: '자동' },
      '자동 일과방송에 색이 붙었다 — 다수를 칠하면 위계가 평평해진다')
  }

  const 묶음 = rows.map((r, i) => [r, 태그[i]]).filter(([r]) => r._isGroup)
  assert.equal(묶음.length, 3, '환기방송 세 묶음이 접히지 않았다')
  for (const [, t] of 묶음) {
    assert.equal(t, null, '묶음 줄에 태그가 붙었다 — 그 목록의 기본값이라 말해 줄 것이 없다')
  }

  // 색이 남는 것은 그날의 예외 둘뿐
  const 색 = 태그.filter(t => t && t.kind)
  assert.deepEqual(색.map(t => t.label).sort(), ['배경음악', '안내방송'])
})

test('색을 안 주는 것이 기본이다 — 차임벨·음원·영상은 태그가 없다 (G-2)', async () => {
  const { tagOfRow } = await import(pathToFileURL(
    path.join(ROOT, 'src', 'lib', 'broadcastKind.js')).href)
  for (const t of ['chime', 'audio', 'video']) {
    assert.equal(tagOfRow({ kind: 'schedule', type: t }), null,
      `${t} 에 태그가 붙었다 — 색 갈래 셋에 없는 유형은 태그도 안 단다`)
  }
})

// ── 2026-09-14: **태그가 이 목록에서 빠졌다**(사용자 지시) ────────────────────
// 앞 판은 `tagOfRow(r)` 를 쓰는지를 봤다. 지금은 유형 태그를 아예 안 단다 — 오늘 목록에서
// 필요한 것은 **시각·제목·상태**뿐이고 색 알약이 줄마다 붙으면 읽는 눈이 그리로 끌린다.
// **지켜야 할 사실은 남는다**: 화면이 **제 유형 규칙을 새로 짓지 않는다.** 태그를 도로
// 달게 되면 그때도 `src/lib/broadcastKind.js` 의 것을 쓴다.
test('화면이 유형 규칙을 새로 짓지 않는다 — 태그는 뺐고, 되살린다면 lib 의 것을 쓴다', () => {
  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  // 긍정 앵커 — 감시할 목록이 이 파일에 있다(없는 파일에서도 부정 단언은 조용히 통과한다)
  assert.match(code, /rows\.map\(r => \{/, '오늘 목록을 그리는 자리가 없다 — 시험이 볼 대상이 없다')
  assert.doesNotMatch(code, /kindOfItem\(/,
    'kindOfItem 을 되살렸다 — 그것은 캘린더 것이고, 자동방송을 흐름(보라)으로 올린다')
  // 유형 색을 이 파일에서 직접 고르면 캘린더와 갈린다
  assert.doesNotMatch(code, /broadcast_type === '(text|bgm|flow)' \?/,
    '화면이 유형 색·이름을 직접 가르고 있다 — 규칙이 두 벌이 된다')
})

test('「안 나감」을 "다음"으로 덮지 않는다 — 둘 다 참이면 둘 다 적는다', () => {
  // 누락 섞인 묶음은 한 줄로 접히고 그 줄이 곧 "다음"이다. 상태 칸을 '다음'으로만 쓰면
  // **빨간 「안 나감」이 목록에서 사라진다** — 머리줄 숫자를 따로 읽어야만 알게 된다.
  // R4 는 바닥글만 고쳤고 이 칸이 남아 있었다(V② 적대 검수 2026-09-13).
  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  assert.match(code, /isNext && r\.status === 'missed' \? '안 나감 · 다음'/,
    '누락이면서 다음인 줄에 둘 다 안 적는다 — 안 나간 사실이 화면에서 사라진다')
  assert.doesNotMatch(code, /\{isNext \? '다음' : st\.label\}/,
    "상태 칸이 '다음'으로 덮고 있다")
  // 색도 누락 쪽이 이겨야 한다 — 보라(다음)로 칠하면 빨강이 사라진 것과 같다
  assert.match(code, /r\.status === 'missed' \? STATUS\.missed\.cls/,
    '누락인 줄의 색이 누락 색이 아니다')
})

test('기본 3상태와 예약 결과 미확인을 서버와 화면이 함께 안다', () => {
  // **왜**: `findNextItem` 은 `status === 'pending'` 만 고른다. 서버에 넷째 낱말이 생기면
  // 그 항목은 **화면엔 「대기」로 그려지는데**(`STATUS[...] || STATUS.pending`) 바닥글은
  // "오늘 남은 방송 없음"이라고 말한다 — 한 화면이 서로 다른 말을 한다.
  // 기본 시간 판정 3상태에 예약 결과 미확인이 추가됐다(2026-09-16).
  // 시간 판정 `statusOf`의 **몸통 안의 문자열 낱말**을 전부 걷는다 —
  // 마지막 것은 `return nowMin > deadline ? 'missed' : 'pending'` 이라 `return '…'` 으로만
  // 찾으면 **놓친다**(처음에 그렇게 써서 빨간불이 났다). 주석은 걷어내고 코드만 본다.
  const server = fs.readFileSync(path.join(ROOT, 'server', 'domain', 'todaySchedule.js'), 'utf8')
  const si = server.indexOf('function statusOf(')
  assert.ok(si >= 0, '서버의 statusOf 를 못 찾았다 — 옮겼으면 이 시험도 같이 옮긴다')
  const 몸통 = codeOnly(server.slice(si, server.indexOf('\n}', si)))
  const 서버낱말 = new Set([...몸통.matchAll(/'([a-z_]+)'/g)].map(m => m[1]))
  assert.deepEqual([...서버낱말].sort(), ['done', 'missed', 'pending'],
    `서버가 내는 상태 낱말이 바뀌었다: ${[...서버낱말].join(', ')} — ` +
    'HomeToday 의 STATUS 표와 findNextItem 을 같이 본다')

  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  const i = code.indexOf('const STATUS = {')
  const 화면낱말 = new Set([...code.slice(i, code.indexOf('\n}', i)).matchAll(/^\s*(\w+):\s*\{/gm)].map(m => m[1]))
  const { buildTodayView } = require('../domain/todaySchedule')
  const outcomes = buildTodayView({ schedules: [0, 1, 2, null].map((outcome, id) => ({
    id, scheduled_time: '09:10', firedToday: true, outcome,
  })) }).map(item => item.status)
  for (const status of outcomes) 서버낱말.add(status)
  assert.deepEqual([...화면낱말].sort(), [...서버낱말].sort(),
    '화면이 아는 상태 낱말이 서버와 다르다')
})

test('완료/대기/누락 판정을 화면이 다시 계산하지 않는다 — 서버 것을 쓴다', () => {
  const code = codeOnly(fs.readFileSync(SRC, 'utf8'))
  assert.match(code, /getTodaySchedule\(\)/,
    'GET /api/schedules/today 를 안 쓴다 — 일과방송 5종이 빠지고 날짜 판정이 서버와 갈린다(CC-026)')
  // `getSchedules` 를 **가져오지 않는지**로 본다 — 이름이 겹치는 다른 호출과 헷갈리지 않는다
  assert.doesNotMatch(code, /import[^\n]*\bgetSchedules\b/,
    'getSchedules 를 다시 가져왔다 — 그 목록에는 일과방송 5종이 없다')
  // ── 2026-09-14 (두 번째 정정): 시계가 **다시 빠졌다** ─────────────────────────
  // 「지나간 줄 회색 바탕」을 넣으며 `getHours()` 가 들어왔고, 그 지시가 철회되면서 다시
  // 나갔다. 그래서 이 단언은 **원래 모양으로 돌아간다** — 화면은 시각을 안 잰다.
  // 지키려던 사실은 한 번도 안 바뀌었다: *"완료/대기/누락 낱말은 서버 것을 쓴다."*
  assert.doesNotMatch(code, /getHours\(\)/,
    '화면이 시각을 다시 재고 있다 — watchdog 경보와 갈리면 사람이 둘 다 안 믿는다')
})
