// 옆으로 넘겨야 보이는 표 없애기 (고도화 제안 #25, 2026-09-03).
//
// 사용자가 못 박은 것: **"횡스크롤은 못 쓴다."** 그런데 예약목록·주간표·쉬운화면 예약은
// 좁은 화면 대비가 **한 곳도 없었다**(`md:` 사용 0회). 실측:
//  · 예약목록 — 표 6열(시간·제목·대상·반복·상태·작업). 작업 버튼과 반복 라벨이 안 줄어
//    표가 화면보다 넓어지고 페이지가 통째로 옆으로 밀린다.
//  · 주간표 — grid-cols-7 고정. 폰 375px이면 하루가 53px이라 칩 글자가 뭉갠다.
//  · 쉬운화면 예약 — 가로 flex 한 줄. 오늘 버튼을 44px로 키워(제안 #24) 더 좁아졌다.
//
// 고친 방식은 **접기**다. 마크업을 두 벌로 만들지 않았다 — 예약 표는 묶음·자동방송 행이
// 얽혀 있어 한 벌 더 두면 반드시 한쪽만 고쳐지는 날이 온다.
//
// 고정하는 사실 넷:
//  1. 예약목록의 대상·반복 열은 좁은 화면에서 접힌다
//  2. **접힌 정보는 사라지지 않는다** — 제목 칸 아래 한 줄로 함께 보인다
//  3. 주간표는 좁은 화면에서 7열이 아니다
//  4. 가로로 밀리던 버튼 묶음이 줄을 바꾼다(예약목록·쉬운화면)
//
// 2026-09-05: 접는 경계의 **이름**만 바꿨다(옛 이름 lg → laptop, 둘 다 1024px). 빌드
// 산출물에서 "@media (width>=1024px)"로 같은 것을 대조했다 — 접히는 폭은 그대로다.
// **md:(768)는 여기 없다** — 그것은 스타일이 아니라 마운트 경계라, 이름을 정리한다는
// 이유로 건드리면 소리가 겹친다(easy-mode-breakpoints.test.js 머리말).
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SRC = path.join(__dirname, '..', '..', 'src')
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const LIST  = read('components', 'admin', 'sections', 'ScheduledBroadcast.jsx')
const WEEK  = read('components', 'admin', 'sections', 'WeeklySchedule.jsx')
const MINI  = read('components', 'easy', 'ScheduledBroadcastMini.jsx')

test('사실1 — 예약목록의 대상·반복은 좁은 화면에서 접힌다', () => {
  // 머리글과 칸이 짝으로 접혀야 한다. 한쪽만 접으면 표가 어긋난다.
  const folded = LIST.match(/hidden laptop:table-cell/g) || []
  assert.equal(folded.length, 4, `머리글 2 + 칸 2 = 4곳이어야 한다(지금 ${folded.length})`)
  assert.match(LIST, /hidden laptop:table-cell[^>]*>대상</)
  assert.match(LIST, /hidden laptop:table-cell[^>]*>반복</)
})

test('사실2 — 접힌 정보가 사라지지 않는다', () => {
  assert.match(LIST, /laptop:hidden[\s\S]{0,120}\{s\.target\} · \{formatRepeatLabel\(s\)\}/,
    '좁은 화면에서 대상·반복을 볼 길이 없어졌다 — 접는 것과 지우는 것은 다르다')
})

// ── **고정하는 것은 사실이지 모양이 아니다** (2026-09-16 정정) ──────────────────
// 이 시험의 뒷줄은 *"넓은 화면에서는 예전처럼 7열이어야 한다"* 며 `grid-cols-1
// sm:grid-cols-2 md:grid-cols-7` 이라는 **글자 그대로**를 요구하고 있었다. 그런데 이
// 시험이 지키려던 사실(머리말 3번)은 **「폰에서 하루가 53px 이 되지 않는다」** 지
// 「넓은 화면이 7열이다」가 아니다. 7열은 그때 고른 **수단**이었다.
//
// 2026-09-16 에 사용자가 주 보기를 **세로 목록**으로 바꾸라고 했다(*"그냥 목록 처럼 하고
// 깔끔하게"*). 목록은 폰에서도 하루가 화면 폭 전체라 머리말 3번을 **더 잘** 지킨다.
// 그런데 모양으로 고정해 둔 탓에 **옳은 변경이 빨간불을 냈다.**
//
// 그래서 사실만 남긴다: **주 보기에 7열 격자가 없다.** 이 조건은 목록이든, 나중에 또
// 다른 배치든, 「하루가 53px 이 되는 배치」만 걸러 낸다.
test('사실3 — 주간표에 7열 격자가 없다 (폰에서 하루 53px 이 되는 배치를 막는다)', () => {
  // **범위를 글자 수로 어림하지 않는다.** 바로 뒤가 월 보기이고 그쪽은 7열이 옳다 —
  // `{0,900}` 같은 어림으로 자르면 월 보기의 `grid-cols-7` 을 주 보기의 것으로 오인해
  // **늘 빨간불**이 나거나, 반대로 범위를 좁히면 진짜 회귀를 놓친다.
  const 시작 = WEEK.indexOf("viewMode === 'week' ? (")
  assert.ok(시작 >= 0, '주 보기를 그리는 자리를 못 찾았다 — 이 시험이 헛돌고 있다')
  const 끝 = WEEK.indexOf('      ) : (', 시작)
  assert.ok(끝 > 시작, '주 보기 분기의 끝을 못 찾았다 — 이 시험이 헛돌고 있다')

  const 주보기 = WEEK.slice(시작, 끝)
  // 긍정 앵커 — 잘라낸 토막이 진짜 주 보기인지 확인한다(빈 토막이면 아래가 헛통과한다).
  assert.match(주보기, /<DayCard/, '잘라낸 자리에 DayCard 가 없다 — 범위를 잘못 잡았다')
  assert.doesNotMatch(주보기, /grid-cols-7/,
    '주 보기가 7열이다 — 폰에서 하루 53px 이면 칩 글자가 뭉갠다')
})

test('사실4 — 가로로 밀리던 묶음이 줄을 바꾼다', () => {
  assert.match(LIST, /flex items-center justify-end gap-2 flex-wrap/,
    '작업 버튼이 안 줄어들어 표를 옆으로 민다')
  const wrapped = MINI.match(/flex items-center gap-\d(?:\.\d)? flex-wrap/g) || []
  assert.ok(wrapped.length >= 2,
    `쉬운화면 예약 줄이 안 접힌다(지금 ${wrapped.length}곳) — 44px 버튼이 들어가 더 좁아졌다`)
})

test('세 화면 모두 좁은 화면 분기를 갖는다', () => {
  for (const [name, src] of [['예약목록', LIST], ['주간표', WEEK], ['쉬운화면 예약', MINI]]) {
    assert.ok(/\b(sm|md|lg):/.test(src) || /flex-wrap/.test(src),
      `${name}에 좁은 화면 대비가 하나도 없다`)
  }
})
