// P-30 — 감시가 **밀린 것**과 **안 뜬 것**을 같은 문구로 알린다 (2026-09-10).
//
// `checkMissed` 는 `broadcasts` 표를 **아예 안 봤다**(AUTO_BROADCASTS + settings 만).
// 그래서 다른 방송에 밀려 중단된 것까지
//   "…이 나가지 않았습니다. 현장 PC의 CareCast 창이 열려 있는지 확인해주세요."
// 로 알렸다 — 창은 멀쩡히 열려 있고 사람은 엉뚱한 데를 본다.
// ISSUE-010 이 이력에 흔적을 남기게 고쳤는데 **감시가 그 흔적을 안 읽고 있었다.**
//
// 알리는 것 자체는 그대로다 — 밀렸어도 그 방송은 안 나간 것이다. **문구만 가른다.**
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_wdpre_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 경보를 관찰한다 — 실제 DB·SSE 로 안 나가게 갈아끼운다
const raised = []
const alertPath = require.resolve('../services/alert')
require.cache[alertPath] = {
  id: alertPath, filename: alertPath, loaded: true,
  exports: { raise: (kind, message, meta) => raised.push({ kind, message, meta }), MAX_MESSAGE: 300 },
}

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const watchdog = require('../services/watchdog')
const { LANES } = require('../services/broadcastSequencer')

const 오늘 = '2026-09-10'
const 지금 = new Date(2026, 8, 10, 12, 0)     // 12:00 — 점심(11:10) 유예를 넘겼다

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

function 판깔기() {
  const db = getDB()
  db.prepare('DELETE FROM broadcasts').run()
  raised.length = 0
  // 점심만 켜고 나머지는 끈다 — 한 건만 보게 한다
  for (const k of ['morning_enabled', 'exercise_broadcast_enabled', 'dinner_broadcast_enabled', 'evening_prayer_enabled']) {
    writeSetting(db, k, 'false')
  }
  writeSetting(db, 'lunch_broadcast_enabled', 'true')
  writeSetting(db, 'lunch_broadcast_time', '11:10')
  writeSetting(db, 'lunch_last_fired', '')
  writeSetting(db, 'lunch_last_started', '')
  writeSetting(db, 'watchdog_alerted_lunch', '')
  return db
}

test('앵커: 밀림 기록이 없으면 지금까지의 문구 그대로다', () => {
  const db = 판깔기()
  const found = watchdog.checkMissed(db, { now: 지금 })
  assert.equal(found.length, 1, `한 건이 걸려야 한다: ${JSON.stringify(found)}`)
  assert.equal(raised.length, 1)
  assert.match(raised[0].message, /창이 열려 있는지/, '기존 문구가 아니다 — 이 검사의 대조군이 무너졌다')
})

test('P-30: 밀림 기록이 있으면 "창" 이야기를 하지 않는다', () => {
  const db = 판깔기()
  // 시퀀서가 남기는 것과 **같은 문구**로 넣는다. 레인 표를 복사하지 않고 읽는다.
  const content = `${LANES.lunch.logContent} — 다른 방송에 밀려 중단됨`
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,0)')
    .run(오늘, '11:10', '자동', content, '자동', '전체')

  const found = watchdog.checkMissed(db, { now: 지금 })
  assert.equal(found.length, 1, '밀렸어도 그 방송은 안 나간 것이다 — 알리기는 해야 한다')
  assert.equal(raised.length, 1)
  assert.match(raised[0].message, /다른 방송에 밀려/,
    `밀림인데 그 사실을 안 알린다: ${raised[0].message}`)
  assert.doesNotMatch(raised[0].message, /창이 열려 있는지/,
    '창을 확인하라고 한다 — 창은 멀쩡하고 사람이 엉뚱한 데를 본다')
})

test('P-30: 다른 방송의 밀림 기록은 이 방송의 문구를 안 바꾼다', () => {
  const db = 판깔기()
  const content = `${LANES.morning.logContent} — 다른 방송에 밀려 중단됨`   // 아침 것
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,0)')
    .run(오늘, '07:50', '자동', content, '자동', '전체')

  watchdog.checkMissed(db, { now: 지금 })
  assert.match(raised[0].message, /창이 열려 있는지/,
    '남의 밀림 기록을 자기 것으로 읽었다 — 레인을 안 가린다')
})

test('P-30: 어제의 밀림 기록은 오늘 문구를 안 바꾼다', () => {
  const db = 판깔기()
  const content = `${LANES.lunch.logContent} — 다른 방송에 밀려 중단됨`
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,0)')
    .run('2026-09-09', '11:10', '자동', content, '자동', '전체')

  watchdog.checkMissed(db, { now: 지금 })
  assert.match(raised[0].message, /창이 열려 있는지/, '날짜를 안 가린다')
})

test('P-30: 성공한 밀림-비슷한 행은 안 센다 — success=0 만 본다', () => {
  const db = 판깔기()
  const content = `${LANES.lunch.logContent} — 다른 방송에 밀려 중단됨`
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,1)')
    .run(오늘, '11:10', '자동', content, '자동', '전체')

  watchdog.checkMissed(db, { now: 지금 })
  assert.match(raised[0].message, /창이 열려 있는지/, '성공 행을 밀림으로 읽었다')
})
