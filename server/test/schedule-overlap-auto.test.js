// 예약이 **자동방송 5종과 겹치면** 저장 전에 경고한다 (2026-09-03 사용자 결정).
//
// 왜: 겹침을 실행 시점에 처리하는 길(미루기·건너뛰기·밀어냄)은 전부 사고가 난다 —
// 레드 검증이 잡은 F6도 그 계열이다(같은 분에 영상 예약과 점심 자동방송이 있으면,
// 예약이 먼저 나가고 1.5초 뒤 자동방송이 그것을 밀어낸다). 사용자 결정은 간단하다:
// **넣을 때 "이미 있는 시간입니다"라고 알린다.**
//
// 예약끼리의 겹침 경고는 이미 있었다(2026-08-31). 그런데 그 함수는 주석에
// "자동방송 5종은 여기 안 들어온다 — 매일 돌아가는 곳이라 건드리지 않는다"고 적고
// 실제로 빼고 있었다. 정작 가장 흔한 겹침이 그것이다.
//
// 고정하는 사실:
//  1. 자동방송을 겹침 후보로 만들어 주는 변환이 있다(켜진 것만, 매일 도는 것으로)
//  2. 시작 시각이 같으면 겹침이다
//  3. **자동방송이 도는 도중**이면 겹침이다 — 아침 방송은 27분짜리라 08:00 예약도 그 위다
//     (예약끼리의 ±5분 창으로는 절대 못 잡는다)
//  4. 꺼 둔 자동방송은 후보가 아니다 — 소리를 안 낸다
//  5. 예약 모달이 이 둘을 합쳐서 본다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// 화면 모듈(ESM)을 노드에서 그대로 부를 수 없어, 순수 함수만 떼어 실행한다.
// (이 저장소가 scheduleUtils를 검사할 때 쓰는 방식과 같다)
async function loadUtils() {
  const url = 'file:///' + path.join(ROOT, 'src', 'lib', 'scheduleUtils.js').replace(/\\/g, '/')
  return import(url)
}

const SETTINGS = {
  morning:        { enabled: true,  time: '07:50' },
  exercise:       { enabled: true,  time: '09:00' },
  lunch:          { enabled: false, time: '11:15' },   // 꺼 둔 것
  dinner:         { enabled: true,  time: '16:20' },
  evening_prayer: { enabled: true,  time: '18:00' },
}
// 아침 방송은 27분짜리 — 끝나는 시각이 08:17이다
const ESTIMATE = {
  morning:  { startTime: '07:50', end: { time: '08:17', dayOffset: 0 } },
  exercise: { startTime: '09:00', end: { time: '09:12', dayOffset: 0 } },
}

test('자동방송을 겹침 후보로 바꾼다 — 켜진 것만, 매일 도는 것으로', async () => {
  const { autoBroadcastSiblings } = await loadUtils()
  assert.equal(typeof autoBroadcastSiblings, 'function',
    'autoBroadcastSiblings가 없다 — 예약 모달이 자동방송을 볼 방법이 없다')
  const rows = autoBroadcastSiblings(SETTINGS, ESTIMATE)
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes('auto:morning') && ids.includes('auto:exercise'))
  assert.ok(!ids.includes('auto:lunch'), '꺼 둔 자동방송이 후보에 들어갔다 — 소리를 안 내는 방송이다')
  const m = rows.find(r => r.id === 'auto:morning')
  assert.equal(m.scheduled_time, '07:50')
  assert.equal(m.endTime, '08:17', '예상 종료 시각을 안 싣는다 — 도는 도중을 판정할 수 없다')
  assert.equal(m.isAuto, true)
})

test('시작 시각이 같으면 겹침이다', async () => {
  const { findScheduleOverlaps, autoBroadcastSiblings } = await loadUtils()
  const hits = findScheduleOverlaps(
    { scheduled_time: '09:00', repeat_weekdays: [], repeat_start_date: '2026-09-04' },
    autoBroadcastSiblings(SETTINGS, ESTIMATE))
  assert.equal(hits.length, 1, '같은 시각의 자동방송을 못 잡았다')
  assert.equal(hits[0].exact, true)
})

test('자동방송이 도는 도중이면 겹침이다 — ±5분 창으로는 못 잡는 자리', async () => {
  const { findScheduleOverlaps, autoBroadcastSiblings } = await loadUtils()
  const hits = findScheduleOverlaps(
    { scheduled_time: '08:00', repeat_weekdays: [], repeat_start_date: '2026-09-04' },
    autoBroadcastSiblings(SETTINGS, ESTIMATE))
  assert.equal(hits.length, 1,
    '아침 방송(07:50~08:17)이 도는 08:00에 넣었는데 경고가 없다 — 시작 시각 차이는 10분이라 ±5분 창이 못 잡는다')
  assert.equal(hits[0].exact, false, '시작이 같지는 않다')
  assert.match(String(hits[0].running), /true/, '"도는 도중"이라는 표시가 없다 — 문구를 다르게 못 쓴다')
})

test('멀리 떨어진 시각은 경고하지 않는다 — 잔소리가 되면 아무도 안 읽는다', async () => {
  const { findScheduleOverlaps, autoBroadcastSiblings } = await loadUtils()
  const hits = findScheduleOverlaps(
    { scheduled_time: '14:00', repeat_weekdays: [], repeat_start_date: '2026-09-04' },
    autoBroadcastSiblings(SETTINGS, ESTIMATE))
  assert.equal(hits.length, 0)
})

test('예약 모달이 예약과 자동방송을 함께 본다', async () => {
  const src = read('src/components/shared/ScheduleModal.jsx')
  assert.match(src, /autoBroadcastSiblings/,
    '모달이 자동방송을 겹침 후보에 안 넣는다 — 가장 흔한 겹침을 그대로 놓친다')
  assert.match(src, /getBroadcastSchedule|getBroadcastEstimate/,
    '자동방송 시각·소요시간을 받아오지 않는다')
})
