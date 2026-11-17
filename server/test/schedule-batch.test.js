// 같은 묶음으로 짝지어진 예약을 **한 줄로 접는 규칙** — src/lib/scheduleBatch.js.
//
// 환기방송처럼 1차·2차로 나뉜 예약이 주간표와 예약 목록에서 각각 한 줄씩 차지해
// 화면이 실제보다 훨씬 복잡해 보였다. 오늘방송일정(TodaySchedule.jsx)은 이미 접어서
// "1차/2차"로 보여주고 있었는데, 그 규칙이 **그 파일 안에만** 있었다.
//
// 규칙을 화면마다 복사하면 언젠가 한쪽만 고쳐져 갈라진다. 그래서 순수 모듈로 빼고
// 여기서 고정한다(flowGroups.js와 같은 이유·같은 방식).
//
// 접는 판정만 여기서 한다 — **무엇을 어떻게 그릴지는 화면이 정한다.** 세 화면이 보여주는
// 것이 서로 다르기 때문이다(오늘일정은 상태 배지, 주간표는 칩, 예약목록은 작업 버튼).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { batchSchedules, BATCH_WINDOW_MIN } = require('../../src/lib/scheduleBatch.js')

// 읽기 쉬운 예약 만들기
const mk = (time, group_id = null, title = '환기방송') => ({ time, group_id, title })
const shape = (batches) => batches.map(b => b.items.map(i => i.time))

test('같은 묶음이 20분 안에 몰려 있으면 한 줄로 접는다', () => {
  const got = batchSchedules([mk('09:10', 'g1'), mk('09:20', 'g1')])
  assert.deepEqual(shape(got), [['09:10', '09:20']])
  assert.equal(got[0].groupId, 'g1')
})

test('묶음이 아닌 것은 접지 않는다', () => {
  const got = batchSchedules([mk('09:10'), mk('09:20')])
  assert.deepEqual(shape(got), [['09:10'], ['09:20']])
})

test('같은 묶음이라도 멀리 떨어져 있으면 각각 보여준다 — 언제 나가는지 알아야 한다', () => {
  const got = batchSchedules([mk('09:10', 'g1'), mk('17:00', 'g1')])
  assert.deepEqual(shape(got), [['09:10'], ['17:00']], '아침과 저녁이 한 줄로 접히면 안 된다')
})

test(`경계: 정확히 ${BATCH_WINDOW_MIN}분이면 접고, 1분 더 벌어지면 안 접는다`, () => {
  assert.deepEqual(shape(batchSchedules([mk('09:00', 'g1'), mk('09:20', 'g1')])), [['09:00', '09:20']])
  assert.deepEqual(shape(batchSchedules([mk('09:00', 'g1'), mk('09:21', 'g1')])), [['09:00'], ['09:21']])
})

test('접은 줄 안에서도 시각 순서가 유지된다 — 2차가 1차보다 앞에 오면 안 된다', () => {
  const got = batchSchedules([mk('12:10', 'g2'), mk('12:00', 'g2')])
  assert.deepEqual(shape(got), [['12:00', '12:10']])
})

test('결과는 첫 항목 시각 순으로 정렬된다', () => {
  const got = batchSchedules([
    mk('18:00'), mk('09:20', 'g1'), mk('12:00', 'g2'), mk('09:10', 'g1'), mk('12:10', 'g2'),
  ])
  assert.deepEqual(shape(got), [['09:10', '09:20'], ['12:00', '12:10'], ['18:00']])
})

test('시각 필드 이름을 바꿔 쓸 수 있다 — 화면마다 time / scheduled_time으로 다르다', () => {
  const items = [
    { scheduled_time: '17:00', group_id: 'g3' },
    { scheduled_time: '17:10', group_id: 'g3' },
  ]
  const got = batchSchedules(items, 'scheduled_time')
  assert.equal(got.length, 1)
  assert.equal(got[0].items.length, 2)
})

test('묶음이 혼자 있으면 접지 않는다 — 1차만 있는데 "1·2차"로 보이면 거짓말이다', () => {
  const got = batchSchedules([mk('09:10', 'g1')])
  assert.deepEqual(shape(got), [['09:10']])
  assert.equal(got[0].groupId, null, '혼자면 묶음으로 보지 않는다')
})

test('시각이 깨진 항목이 있어도 접지 않고 그냥 보여준다 — 화면이 죽으면 안 된다', () => {
  const got = batchSchedules([mk('엉터리', 'g1'), mk('09:10', 'g1')])
  assert.equal(got.length, 2, '판정할 수 없으면 각각 보여준다')
})

test('빈 목록도 안전하다', () => {
  assert.deepEqual(batchSchedules([]), [])
})

// ── 구조 ───────────────────────────────────────────────────
// 규칙이 다시 화면 안으로 복사되면 한쪽만 고쳐지는 순간 같은 방송이 화면에 따라
// 한 줄로도 두 줄로도 보인다. 세 화면이 이 모듈을 쓰는지 여기서 지킨다.
test('[구조] 세 화면이 같은 규칙을 쓴다 — 접는 판정을 각자 갖고 있지 않다', () => {
  const fs   = require('fs')
  const path = require('path')
  const SCREENS = [
    ['src', 'components', 'easy', 'TodaySchedule.jsx'],
    ['src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx'],
    ['src', 'components', 'admin', 'sections', 'ScheduledBroadcast.jsx'],
  ]
  for (const parts of SCREENS) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
    const name = parts[parts.length - 1]
    assert.match(src, /batchSchedules/, `${name}이 공용 규칙을 안 쓴다`)
    assert.doesNotMatch(src, /diffMin\s*<=\s*20|<=\s*20\s*\)/,
      `${name}에 20분 판정이 다시 들어왔다 — 규칙이 두 벌이 된다`)
  }
})
