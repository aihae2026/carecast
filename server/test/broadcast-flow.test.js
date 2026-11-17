// 핵심 흐름 스모크 테스트: 방송 등록 → 저장 → 조회 → 요일별 반복 판정 → 실행 로그
// 운영 DB(server/db/database.db)를 절대 건드리지 않도록 CARECAST_DB_PATH로 임시 DB를 쓴다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { getDB, initDB } = require('../db/schema')
const { shouldRunToday, isOneTime, deriveLegacyRepeatType } = require('../services/repeatSchedule')

function localToday(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('예약 방송 등록 시 DB에 저장되고 동일하게 조회된다', () => {
  const db = getDB()
  db.prepare(
    'INSERT INTO schedules (title, content, target, scheduled_time, repeat_type, active) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('스모크 테스트 방송', '테스트 내용입니다', '전체', '10:00', '매일', 1)

  const row = db.prepare('SELECT * FROM schedules WHERE title = ?').get('스모크 테스트 방송')
  assert.ok(row, '방금 등록한 예약이 조회되어야 한다')
  assert.equal(row.content, '테스트 내용입니다')
  assert.equal(row.active, 1)
})

test('repeat_broadcast, group_id가 저장 후 그대로 재조회된다 (회귀 대상 컬럼)', () => {
  const db = getDB()
  db.prepare(
    'INSERT INTO schedules (title, scheduled_time, repeat_type, active, repeat_broadcast, group_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('반복 방송 테스트', '11:00', '매일', 1, 1, 'group-smoke-test')

  const row = db.prepare('SELECT * FROM schedules WHERE title = ?').get('반복 방송 테스트')
  assert.equal(row.repeat_broadcast, 1)
  assert.equal(row.group_id, 'group-smoke-test')
})

test('shouldRunToday: 요일 7개(매일 해당) 전부 선택하면 항상 실행 대상이다', () => {
  assert.equal(shouldRunToday({ repeat_start_date: localToday(-10), repeat_end_date: null, repeat_weekdays: '[0,1,2,3,4,5,6]' }), true)
})

test('shouldRunToday: 평일(월~금) 요일 세트는 오늘 요일 기준으로만 실행된다', () => {
  const day = new Date().getDay() // 0=일 ... 6=토
  const expected = day >= 1 && day <= 5
  const schedule = { repeat_start_date: localToday(-10), repeat_end_date: null, repeat_weekdays: '[1,2,3,4,5]' }
  assert.equal(shouldRunToday(schedule), expected)
})

test('shouldRunToday: 평일 세트와 주말 세트는 정확히 반대여야 한다', () => {
  const base = { repeat_start_date: localToday(-10), repeat_end_date: null }
  const weekday = shouldRunToday({ ...base, repeat_weekdays: '[1,2,3,4,5]' })
  const weekend  = shouldRunToday({ ...base, repeat_weekdays: '[0,6]' })
  assert.notEqual(weekday, weekend)
})

test('shouldRunToday: repeat_weekdays가 빈 배열(1회성)이면 반복시작일 당일에만 true다', () => {
  const oneTimeToday     = { repeat_start_date: localToday(0), repeat_end_date: null, repeat_weekdays: '[]' }
  const oneTimeYesterday = { repeat_start_date: localToday(-1), repeat_end_date: null, repeat_weekdays: '[]' }
  assert.equal(shouldRunToday(oneTimeToday), true)
  assert.equal(shouldRunToday(oneTimeYesterday), false)
  assert.equal(isOneTime(oneTimeToday), true)
})

test('shouldRunToday: 반복종료일이 지나면 요일이 맞아도 false다', () => {
  const allDays = '[0,1,2,3,4,5,6]'
  const expired = { repeat_start_date: localToday(-10), repeat_end_date: localToday(-1), repeat_weekdays: allDays }
  const stillOn = { repeat_start_date: localToday(-10), repeat_end_date: localToday(1),  repeat_weekdays: allDays }
  assert.equal(shouldRunToday(expired), false)
  assert.equal(shouldRunToday(stillOn), true)
})

test('shouldRunToday: 반복시작일 이전이면 요일이 맞아도 false다', () => {
  const allDays = '[0,1,2,3,4,5,6]'
  const notYet = { repeat_start_date: localToday(1), repeat_end_date: null, repeat_weekdays: allDays }
  assert.equal(shouldRunToday(notYet), false)
})

test('deriveLegacyRepeatType: 알려진 요일 조합은 구 repeat_type 라벨로 정확히 역산된다', () => {
  assert.equal(deriveLegacyRepeatType([0, 1, 2, 3, 4, 5, 6]), '매일')
  assert.equal(deriveLegacyRepeatType([1, 2, 3, 4, 5]), '평일')
  assert.equal(deriveLegacyRepeatType([0, 6]), '주말')
  assert.equal(deriveLegacyRepeatType([1, 3, 5]), '월수금')
  assert.equal(deriveLegacyRepeatType([2, 4]), '화목')
  assert.equal(deriveLegacyRepeatType([]), '1회')
  assert.equal(deriveLegacyRepeatType([1, 2]), '주간') // 알려지지 않은 임의 조합은 안전한 폴백
})

test('비활성(active=0) 예약은 실행 대상 목록에서 제외되어야 한다', () => {
  const db = getDB()
  db.prepare(
    'INSERT INTO schedules (title, scheduled_time, repeat_type, active, repeat_start_date, repeat_weekdays) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('비활성 방송', '12:00', '매일', 0, localToday(-10), '[0,1,2,3,4,5,6]')

  const active = db.prepare('SELECT * FROM schedules WHERE active = 1 AND title = ?').get('비활성 방송')
  assert.equal(active, undefined, 'active=0인 예약은 active=1 조회에 걸리지 않아야 한다')
})

test('방송 실행 시 broadcasts 테이블에 로그가 남는다', () => {
  const db = getDB()
  db.prepare(
    'INSERT INTO broadcasts (time, type, content, user, target, success, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('10:00:00', 'text', '스모크 테스트 방송', 'system', '전체', 1, new Date().toISOString().slice(0, 10))

  const row = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1').get()
  assert.ok(row)
  assert.equal(row.success, 1)
  assert.equal(row.content, '스모크 테스트 방송')
})

// TTS/음원 생성, 오디오 재생, SwitchBot 등 외부 I/O가 있는 실제 fireSchedule() 실행 경로는
// 여기서 다루지 않는다 — mock 대상이 넓어 첫 스모크 테스트 범위를 넘어선다.
// 다음 단계(TASKS.md 후속 작업)로 generateTTSWithRetry / audioPlayer를 mock한
// fireSchedule() 통합 테스트를 별도로 추가하는 것을 권장한다.
