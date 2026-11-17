// CC-026 잔여 — 쉬운 화면 맨 위 "다음 예약" 띠가 자동방송 5종을 못 보여주던 문제.
//
// 그 띠(NotificationBar)는 getSchedules()만 읽는다. 아침·체조·점심·저녁·저녁 마무리는
// schedules 테이블이 아니라 settings의 시각·활성 키로 돌기 때문에 **거기 아예 안 나왔다.**
// 07:50에 아침방송이 있는데 띠에는 "다음 예약 14:00 프로그램 안내"만 뜬다.
//
// /api/schedules/today는 이미 둘을 합쳐서 준다(TodaySchedule 화면이 쓰고 있다).
// 띠도 그것을 쓰게 하고, 그러려면 반복 표시에 필요한 필드가 그 응답에 있어야 한다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { buildTodayView } = require('../domain/todaySchedule')

const at = (h, m = 0) => new Date(2026, 7, 31, h, m)

test('예약 항목이 반복 표시에 필요한 필드를 그대로 싣는다', () => {
  const [item] = buildTodayView({
    schedules: [{
      id: 1, title: '프로그램 안내', scheduled_time: '14:00', broadcast_type: 'text',
      repeat_weekdays: '[1,3,5]', repeat_start_date: '2026-08-31', repeat_end_date: null,
    }],
    now: at(9),
  })
  assert.equal(item.repeat_weekdays, '[1,3,5]',
    '반복 요일이 빠지면 띠가 이 API로 갈아탈 때 "월수금" 표시가 사라진다')
})

test('자동방송도 같은 목록에 들어온다 — 띠가 이걸 읽으면 5종이 보인다', () => {
  const items = buildTodayView({
    autoTimes: [{ id: 'morning', label: '아침 방송', time: '07:50' }],
    schedules: [{ id: 1, title: '프로그램 안내', scheduled_time: '14:00' }],
    now: at(7, 0),
  })
  assert.equal(items[0].kind, 'auto')
  assert.equal(items[0].time, '07:50')
  assert.equal(items[0].status, 'pending')
})

test('띠가 getSchedules가 아니라 오늘 목록을 읽는다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'NotificationBar.jsx'), 'utf8')
  assert.ok(src.includes('getTodaySchedule'), '오늘 목록 API를 안 쓰면 자동방송 5종이 안 뜬다')
  // 주석에는 남아 있어도 된다(왜 바꿨는지가 거기 적혀 있다) — 실제로 부르는지만 본다
  assert.ok(!/getSchedules\s*\(/.test(src),
    'getSchedules를 아직 부르면 목록이 두 벌이 된다 — 같은 화면이 서로 다른 답을 보여준다')
})
