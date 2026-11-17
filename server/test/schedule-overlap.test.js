// 순서편집기 예상시간 줄의 "다음 방송과 겹칩니다" 경고 규칙(src/lib/scheduleOverlap.js).
//
// 이 경고는 사람이 방송 시각을 정할 때 마지막으로 걸리는 그물이다. 안 뜨면 두 방송이
// 같은 스피커로 겹쳐 나가고, 현장에서는 "왜 소리가 두 개냐"로만 보인다.
// 예전 판정은 화면 JSX 안 IIFE에 있어 테스트가 하나도 없었고, 두 구멍이 있었다:
//   · 끝시각과 다음 시작 시각이 **같은 분**이면 안 떴다(초를 올림하므로 흔한 경계다)
//   · 자정을 넘기는 방송은 뒤에 오는 방송이 없어 후보가 안 잡혀 **영영 안 떴다**
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
// Node는 CJS에서 ESM을 require할 수 있다(bgm-lane.test.js와 같은 방식)
const { findScheduleOverlap } = require(path.join(ROOT, 'src', 'lib', 'scheduleOverlap.js'))

// 라우트가 돌려주는 모양 그대로 — { startTime, end: { time, dayOffset } }
const at = (startTime, endTime, dayOffset = 0) => ({ startTime, end: { time: endTime, dayOffset } })

test('끝나기 전에 다음 방송이 시작하면 겹침이다', () => {
  const r = findScheduleOverlap('morning', { morning: at('07:50', '08:20'), exercise: at('08:10', '08:30') })
  assert.equal(r?.tab, 'exercise')
  assert.equal(r?.startTime, '08:10')
})

test('끝시각과 다음 시작 시각이 같은 분이면 겹침이다 — 그 분에 아직 방송 중이다', () => {
  // estimateEndTime은 초를 올림한다. "11:15 종료 / 11:15 시작"은 드문 경계가 아니라 흔한 값이다.
  const r = findScheduleOverlap('lunch', { lunch: at('11:00', '11:15'), dinner: at('11:15', '11:40') })
  assert.ok(r, '같은 분에 걸치는데 경고가 안 뜨면 두 방송이 겹쳐 나간다')
  assert.equal(r.tab, 'dinner')
})

test('여유 있게 끝나면 경고하지 않는다 — 잔소리가 되면 사람이 경고를 안 본다', () => {
  assert.equal(findScheduleOverlap('lunch', { lunch: at('11:00', '11:14'), dinner: at('11:15', '11:40') }), null)
})

test('시작 시각이 같으면 길이와 무관하게 겹침이다', () => {
  const r = findScheduleOverlap('lunch', { lunch: at('11:15', '11:20'), dinner: at('11:15', '11:40') })
  assert.equal(r?.sameStart, true)
})

test('자정을 넘기면 뒤에 오는 방송이 없어도 경고한다 — 예전엔 이때만 안 떴다', () => {
  // 자정을 넘길 만큼 긴 방송은 하루 중 가장 늦은 방송이다. "뒤에 시작하는 방송"을 찾아서
  // 그것과 비교하는 방식으로는 이 경우가 절대 안 걸린다.
  const r = findScheduleOverlap('evening_prayer', {
    morning:        at('07:50', '08:20'),
    evening_prayer: at('23:40', '00:20', 1),
  })
  assert.ok(r, '자정을 넘기는 것 자체가 경고 대상이다')
  assert.equal(r.crossesMidnight, true)
})

test('꺼 둔 방송은 겹침 후보가 아니다', () => {
  const estimate = { lunch: at('11:00', '11:30'), dinner: at('11:10', '11:40') }
  assert.equal(findScheduleOverlap('lunch', estimate, { dinner: { enabled: false } }), null)
})

test('비교할 값이 없으면 조용히 없음이다 — 화면이 깨지면 안 된다', () => {
  assert.equal(findScheduleOverlap('morning', null), null)
  assert.equal(findScheduleOverlap('morning', {}), null)
})
