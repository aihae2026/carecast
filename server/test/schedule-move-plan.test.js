// 캘린더에서 일정을 끌어 놓았을 때 **무엇이 바뀐다고 말하고, 실제로 무엇을 바꾸는가**
// (UX-22 · UX-23, 2026-09-11).
//
// 왜 이 검사가 있나: 사용자 지시는 *"끌어서 이동하거나 그런거, 대신에 자동방송이라고
// 설정된거는 한번 더 확인 받아"* 였다. 위험한 것은 **말과 저장이 갈리는 것**이다 —
// 확인창은 "이 날짜만 옮깁니다"라고 하는데 저장은 반복 원본을 바꾸는 경우.
// 그래서 판단을 순수 함수 하나(`planMove`)로 두고, 화면은 그 결과의 문구와 patch 를
// 둘 다 그 함수에서 받는다. 이 검사는 그 함수를 **직접 돌린다**.
//
// **기대값은 여기 손으로 적는다.** 제품 상수를 가져오면 규칙을 바꾸는 변이가 기대값까지
// 데려간다(2026-09-10 교훈 3).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src', 'lib', 'scheduleUtils.js')

// ESM 파일이라 require 가 안 된다. node:test 에서 동적 import 로 읽는다.
const load = () => import('node:url').then(({ pathToFileURL }) => import(pathToFileURL(SRC).href))

const 예약 = (over = {}) => ({
  id: 1, title: '프로그램 안내', scheduled_time: '14:00',
  repeat_weekdays: [], repeat_start_date: '2026-09-11', repeat_end_date: null,
  ...over,
})

test('1회성 예약은 그 날짜만 바뀐다', async () => {
  const { planMove } = await load()
  const p = planMove(예약(), '2026-09-11', '2026-09-15')
  assert.equal(p.allowed, true)
  assert.equal(p.kind, 'once')
  assert.deepEqual(p.patch, { repeat_start_date: '2026-09-15' })
  assert.match(p.detail, /이 날짜만/, '한 번짜리라는 사실을 사람에게 말해야 한다')
})

test('1회성 예약에 종료일이 적혀 있으면 같이 옮긴다 — 안 옮기면 뒤로 끈 순간 종료일<시작일로 거절된다 (F3)', async () => {
  const { planMove } = await load()
  const 뒤로 = planMove(예약({ repeat_end_date: '2026-09-11' }), '2026-09-11', '2026-09-15')
  assert.deepEqual(뒤로.patch, { repeat_start_date: '2026-09-15', repeat_end_date: '2026-09-15' })
  const 앞으로 = planMove(예약({ repeat_start_date: '2026-09-15', repeat_end_date: '2026-09-15' }), '2026-09-15', '2026-09-12')
  assert.deepEqual(앞으로.patch, { repeat_start_date: '2026-09-12', repeat_end_date: '2026-09-12' })
})

test('매주 한 요일 예약은 요일이 바뀌고, 앞으로 모든 회차가 바뀐다고 말한다', async () => {
  const { planMove } = await load()
  // 2026-09-11은 금요일, 2026-09-16은 수요일
  const p = planMove(예약({ repeat_weekdays: [5] }), '2026-09-11', '2026-09-16')
  assert.equal(p.allowed, true)
  assert.equal(p.kind, 'weekly')
  assert.deepEqual(p.patch, { repeat_weekdays: [3] }, '수요일(3)로 바뀌어야 한다')
  assert.match(p.detail, /모든 회차/,
    '반복 원본이 바뀐다는 사실을 안 말하면 사람은 "오늘만 옮겼다"고 믿는다')
})

test('여러 요일 반복은 끌어서 못 옮긴다 — 어느 회차인지 알 수 없다', async () => {
  const { planMove } = await load()
  const p = planMove(예약({ repeat_weekdays: [1, 3, 5] }), '2026-09-11', '2026-09-16')
  assert.equal(p.allowed, false)
  assert.equal(p.kind, 'multi')
  assert.equal(p.patch, undefined, '막았으면 바꿀 내용을 들고 있으면 안 된다')
  assert.match(p.detail, /수정/, '대신 무엇을 하면 되는지 말해야 한다')
})

test('자동방송은 못 옮기고, 왜 못 옮기는지와 어디서 바꾸는지를 말한다(UX-23)', async () => {
  const { planMove } = await load()
  const p = planMove(예약({ _isAuto: true, title: '아침 방송' }), '2026-09-11', '2026-09-16')
  assert.equal(p.allowed, false)
  assert.equal(p.kind, 'auto')
  assert.equal(p.patch, undefined)
  assert.match(p.detail, /자동방송 편집/, '바꾸는 길을 안 알려주면 사람이 갇힌다')
  assert.match(p.detail, /모든 날/, '그날 이후 전부 바뀐다는 사실을 말해야 한다')
})

test('같은 날짜·같은 요일로 놓으면 아무 일도 안 한다', async () => {
  const { planMove } = await load()
  assert.equal(planMove(예약(), '2026-09-11', '2026-09-11').allowed, false)
  // 금요일 반복을 다른 금요일로 놓은 경우
  assert.equal(planMove(예약({ repeat_weekdays: [5] }), '2026-09-11', '2026-09-18').allowed, false)
})

test('막은 경우에는 patch 가 아예 없다 — 화면이 실수로라도 저장할 수 없게', async () => {
  const { planMove } = await load()
  for (const item of [예약({ _isAuto: true }), 예약({ repeat_weekdays: [1, 2] })]) {
    const p = planMove(item, '2026-09-11', '2026-09-16')
    assert.equal(p.allowed, false)
    assert.equal(p.patch, undefined)
  }
})

test('문자열로 온 반복요일도 읽는다 — DB/API 는 JSON 문자열로 준다', async () => {
  const { planMove } = await load()
  const p = planMove(예약({ repeat_weekdays: '[5]' }), '2026-09-11', '2026-09-16')
  assert.equal(p.kind, 'weekly', '문자열을 못 읽으면 1회성으로 오인해 날짜만 바꾼다')
  assert.deepEqual(p.patch, { repeat_weekdays: [3] })
})

test('판단이 한 곳에만 있다 — 화면이 제 규칙을 또 만들지 않는다', () => {
  const 팝업 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'scheduleCalendarPopups.jsx'), 'utf8')
  assert.match(팝업, /MoveConfirmPopup/, '긍정 앵커 — 옮기기 확인 팝업이 이 파일에 있다')
  assert.doesNotMatch(팝업, /function planMove/,
    '팝업이 제 판단 규칙을 또 들고 있다 — 확인 문구와 저장이 갈린다')
})

// ── 2026-09-11 독립 검수 지적 반영 ──────────────────────────────────────────
// 위 검사들은 `planMove` 순수 함수만 돌렸다. 검수가 짚은 대로 **집행부가 그 판단을 실제로
// 따르는지**는 아무도 안 봤고, 그 사이 유일한 게이트가 팝업 버튼의 `disabled` 한 줄이었다.
// 그 줄을 지우면 자동방송의 가짜 id(`auto_morning`)로 PUT 이 나간다.
const 화면 = () => fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx'), 'utf8')

test('집행부가 막힌 계획을 스스로도 막는다 — 팝업 버튼 하나에 기대지 않는다', () => {
  const s = 화면()
  const i = s.indexOf('const applyMove')
  assert.notEqual(i, -1, 'applyMove 가 사라졌다 — 이 가드를 옮길 것')
  const 본문 = s.slice(i, s.indexOf('\n  }', i))
  assert.match(본문, /plan\?\.allowed|plan\.allowed/,
    'applyMove 가 plan.allowed 를 안 본다 — 팝업의 disabled 를 지우면 그대로 저장된다')
  assert.match(본문, /return/, '막았을 때 돌아서는 길이 없다')
})

test('보낼 때 화면 전용 필드와 이중 인코딩을 걸러 낸다', () => {
  const s = 화면()
  const i = s.indexOf('const applyMove')
  const 본문 = s.slice(i, s.indexOf('\n  }', i))
  assert.match(본문, /parseWeekdays\(/,
    'repeat_weekdays 를 정규화하지 않는다 — 서버가 JSON.stringify 를 한 번 더 걸어 "\\"[]\\"" 가 저장된다')
  assert.match(본문, /_isAuto/,
    '화면 전용 필드를 안 걸러 낸다 — API 가 준 원본을 그대로 되돌려 보낸다')
})

test('묶음(1·2차)은 끌어서 못 옮긴다 — 한 건만 옮기면 쌍이 갈린다', () => {
  const s = 화면()
  assert.match(s, /draggable=\{!!onDragStart && !batched\}/,
    '묶음 칩이 여전히 끌린다 — 1차만 옮겨져 "여세요"와 "닫으세요"가 다른 날이 된다')
})

test('칩이 묶음 전체를 넘긴다 — "2건"이라 적어 놓고 1건만 다루지 않는다', () => {
  const s = 화면()
  const i = s.indexOf('function BroadcastChip')
  const 본문 = s.slice(i, s.indexOf('\n}', i))
  assert.match(본문, /onChipClick\(items, e\)/,
    '칩이 items[0] 한 건만 넘긴다 — 상세 팝업의 삭제가 1차만 지운다')
  assert.ok(!/onChipClick\(item, e\)/.test(본문),
    '아직 단건을 넘기는 자리가 남아 있다')
})

test('상세 팝업이 묶음을 다룬다 — 회차를 보여주고 무엇을 지울지 고르게 한다', () => {
  const 팝업 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'scheduleCalendarPopups.jsx'), 'utf8')
  assert.match(팝업, /EventDetailPopup\(\{ items,/,
    '팝업이 아직 단건(item)만 받는다')
  assert.match(팝업, /한 쌍입니다/, '묶음이라는 사실을 화면이 말하지 않는다')
  assert.match(팝업, /이것만 삭제/, '한 건만 지우는 길이 없다')
  assert.match(팝업, /for \(const s of 묶음\) await deleteSchedule/,
    '"모두 삭제"가 실제로 전부를 지우지 않는다')
})

// ── 2026-09-11 독립 검수(VERDICT FAIL)가 잡은 것 ──────────────────────────
//
// 삭제는 고쳤는데 **일시정지는 못 고쳤다.** 토글 라우트는 목표 상태를 안 받고
// 각 행의 현재 값을 뒤집으므로(`server/routes/schedules.js:369-381`), 묶음을 그냥
// N번 뒤집으면 상태가 갈린 쌍이 **갈린 채로 서로 뒤바뀐다** —
// 1차 켜짐·2차 멈춤이 되어 "창문 여세요"만 나가고 "닫으세요"는 안 나간다.
// 위 검사 42건이 초록인 채로 이것이 지나갔다: 전부 문자열 존재만 봤기 때문이다.
test('묶음 일시정지가 목표 상태를 먼저 정한다 — 갈린 쌍을 갈린 채로 뒤집지 않는다', () => {
  const 팝업 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'scheduleCalendarPopups.jsx'), 'utf8')

  assert.match(팝업, /const 켤까 = !묶음\.every\(s => s\.active\)/,
    '목표 상태를 안 정하고 각 건을 뒤집는다 — 갈린 쌍이 서로 뒤바뀐다')
  assert.match(팝업, /if \(!!s\.active === 켤까\) continue/,
    '이미 목표 상태인 건까지 뒤집는다')

  // 부정 단언 앞의 긍정 앵커 — toggle 함수가 이 파일에 있다
  const m = /const toggle = async \(\) => \{([\s\S]*?)\n {2}\}/.exec(팝업)
  assert.ok(m, 'toggle 함수를 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(!/결과\[0\]\?\.active/.test(m[1]),
    '토스트를 1차 결과 하나로 정한다 — 나머지가 어떻게 됐는지 말하지 않는다')
})

test('일시정지 버튼 문구가 묶음 전체로 정해진다 — 적힌 것과 하는 일이 같게', () => {
  const 팝업 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'scheduleCalendarPopups.jsx'), 'utf8')
  const m = /<button onClick=\{toggle\}([\s\S]*?)<\/button>/.exec(팝업)
  assert.ok(m, '일시정지 버튼을 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /\{켤까/, '버튼 문구가 아직 1차(item.active)만 본다')
  assert.ok(!/\{item\.active/.test(m[1]),
    '"모두 잠시 멈추기"라고 적어 놓고 켜는 쪽으로 동작할 수 있다')
})

// ── 2026-09-12: 실제 마우스 드래그를 브라우저에서 처음 돌려 본 뒤 ────────────
//
// 그동안 이 항목(UX-22)의 "실제 드래그"는 NOT_RUN 이었다. CDP 실입력으로 돌려 보니
// 드래그·확인 팝업·저장·취소는 다 맞았다. **되돌리기도 맞았다** — 500 을 주면
// `load()` 를 안 부르므로 칩이 원래 칸에 그대로 남고 DB 도 안 바뀐다.
//
// 문제는 그 다음이었다. 실패를 `alert(err.message)` 로 알렸다 — 창을 막고, 서버가 준
// **원시 문구**가 그대로 나간다. 이 화면엔 이미 토스트가 있는데 성공에만 쓰고 있었다.
// 되돌아간 이유를 안 말하면 사람은 자기가 잘못 놓은 줄 안다.
test('UX-22: 옮기기 실패를 alert 이 아니라 이 화면의 토스트로 알린다', () => {
  const 주간 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx'), 'utf8')

  // 긍정 앵커 — applyMove 의 catch 가 이 파일에 있다
  const m = /const applyMove = async \(\) => \{([\s\S]*?)\n {2}\}/.exec(주간)
  assert.ok(m, 'applyMove 를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /catch \(err\)/, 'applyMove 에 실패 처리가 없다')

  // 주석은 뺀다 — "예전엔 alert 이었다"고 적어 둔 줄까지 잡으면 오탐이고,
  // 오탐이 쌓이면 다음 사람이 이 가드를 꺼 버린다(헌장 §M11).
  const 코드만 = 주간.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.ok(!/\balert\(/.test(코드만),
    'alert 으로 알린다 — 창을 막고 원시 문구가 그대로 나간다')
  // 규칙이 너무 넓으면 전부 통과한다 — 먼저 시험한다.
  assert.ok(/\balert\(/.test('  if (x) alert(err.message)'), '규칙이 진짜 alert 을 못 잡는다')
  assert.ok(!/\balert\(/.test(['// 예전엔 alert(err.message) 였다']
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')), '주석을 못 걸러낸다')
  assert.match(m[1], /showToast\([^)]*되돌렸습니다[\s\S]*?'fail'\)/,
    '실패를 fail 토스트로 알리지 않는다 — 되돌아간 이유를 사람이 모른다')

  // 색만으로 가르지 않는다(UX-42). 보조기기에도 알린다.
  assert.match(주간, /role=\{toast\.kind === 'fail' \? 'alert' : 'status'\}/,
    '실패 토스트를 보조기기가 읽지 않는다')
  assert.match(주간, /toast\.kind === 'fail' \? <AlertCircle/,
    '성공과 실패가 같은 아이콘이다 — 색만으로 가른다')

  // 실패는 더 오래 남는다 — 2.5초는 "왜 안 옮겨졌지"를 읽기에 짧다.
  assert.match(주간, /kind === 'fail' \? 6000 : 2500/,
    '실패 토스트가 성공과 같은 시간만 뜬다')
})
