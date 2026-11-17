// P-28 — 밀린 방송 하나가 이력에 **두 줄**로 남는다 (2026-09-10).
//
// 시퀀서가 밀림 행을 남기고(`logPreempted`), 5분 뒤 감시가 경보 행을 또 남긴다.
// 둘 다 참이지만 사람이 보기엔 같은 사건이 두 번 실패한 것으로 보인다.
//
// **더 나쁜 것**: 그 경보 행이 **오류 숫자를 다시 올린다.** P-31 이 밀림을 오류 집계에서
// 뺀 근거는 `fail_reason` 코드와 `밀림표식` 문구인데(`routes/status.js:106-112`),
// 경보 행은 `fail_reason` 이 NULL 이고 문구도 다르다 —
// 밀림표식은 `"— 다른 방송에 밀려 중단됨"`, 감시 문구는 `"…밀려 중단됐습니다."` 다.
// 그래서 "수동재생으로 정시 방송을 앞당길 때마다 오류가 1씩 오른다"는 P-31 의 증상이
// 이 경로로 되살아나 있었다([FACT] EV-003378).
//
// **이 검사는 진짜 `alert` 을 쓴다.** `watchdog-preempt-message.test.js` 는 경보를
// 통째로 갈아끼워 문구만 보므로 **DB 에 무엇이 남는지는 못 본다** — 그래서 이 결함이
// 그 검사를 지나갔다. 여기서는 표를 직접 센다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_wdpredup_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// SSE 만 가로챈다 — 경보가 화면까지 가는지도 함께 봐야 하므로 alert 은 진짜를 쓴다.
const 화면알림 = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { 화면알림.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const { initDB, getDB } = require('../db/schema')
const boot = require('../services/serverBoot')
const { writeSetting } = require('../domain/settingsRead')
const watchdog = require('../services/watchdog')
const { LANES } = require('../services/broadcastSequencer')
const { todayStr } = require('../services/repeatSchedule')
const BR = require('../domain/broadcastRecord')

// `alert.raise` 는 실제 오늘 날짜로 적는다(주입 못 한다). 감시에 넘기는 시각도 오늘로 맞춘다.
const 오늘 = todayStr()
const 지금 = new Date()
지금.setHours(12, 0, 0, 0)     // 12:00 — 점심(11:10) 유예를 넘겼다

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

function 판깔기() {
  const db = getDB()
  db.prepare('DELETE FROM broadcasts').run()
  // **가동 기록을 깔아 둔다**(P-97, 2026-09-10). 감시는 이제 "그 시각에 서버가 떠 있었나"를
  // 먼저 본다 — 안 깔면 이 파일의 모든 사례가 '확인 불가' 줄을 하나씩 더 남겨,
  // 이 검사가 재려는 것(밀림 중복)이 그 줄에 가린다.
  db.prepare('DELETE FROM server_boot').run()
  const 하루시작 = new Date(지금); 하루시작.setHours(0, 0, 0, 0)
  const 하루끝 = new Date(지금); 하루끝.setHours(23, 59, 0, 0)
  db.prepare('INSERT INTO server_boot (started_at, last_seen_at, stopped_at) VALUES (?, ?, ?)')
    .run(boot.nowISO(하루시작), boot.nowISO(하루끝), null)
  화면알림.length = 0
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

/** 시퀀서가 남기는 것과 같은 모양의 밀림 행. 레인 표·문구를 베끼지 않고 단일 출처를 읽는다. */
function 밀림행넣기(db) {
  db.prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success, fail_reason)'
    + ' VALUES (?,?,?,?,?,?,0,?)'
  ).run(오늘, '11:10', '자동', BR.밀림문구(LANES.lunch.logContent), '자동', '전체', BR.사유.밀림)
}

const 오늘행 = (db) => db.prepare('SELECT * FROM broadcasts WHERE date = ? ORDER BY id').all(오늘)

test('앵커: 밀림이 아니면 감시가 이력에 한 줄을 남긴다 — 통과해야 하는 정상 사례', () => {
  const db = 판깔기()
  const found = watchdog.checkMissed(db, { now: 지금 })
  assert.equal(found.length, 1, `한 건이 걸려야 한다: ${JSON.stringify(found)}`)
  const 행 = 오늘행(db)
  assert.equal(행.length, 1, `경보 행이 안 남았다 — 실패가 아무 데도 안 적히면 그게 더 나쁘다`)
  assert.equal(행[0].type, '경보')
})

test('P-28: 밀림 행이 이미 있으면 감시가 두 번째 줄을 안 남긴다', () => {
  const db = 판깔기()
  밀림행넣기(db)

  watchdog.checkMissed(db, { now: 지금 })

  const 행 = 오늘행(db)
  assert.equal(행.length, 1,
    `같은 사건이 이력에 ${행.length}줄로 남았다: ${행.map((r) => r.content).join(' / ')}`)
  assert.equal(행[0].fail_reason, BR.사유.밀림, '남은 한 줄이 밀림 행이 아니다')
  assert.equal(행[0].type, '자동', '경보 행이 밀림 행을 밀어냈다')
})

test('P-28: 그 중복 줄이 오류 숫자를 올리던 것이 사라진다', () => {
  const db = 판깔기()
  밀림행넣기(db)
  watchdog.checkMissed(db, { now: 지금 })

  // P-31 의 집계 규칙과 **같은 뜻**을 여기 손으로 적는다(승인된 수용 기준이라 독립 확인).
  // 밀림 코드도 아니고 밀림 문구도 아닌 success=0 행 = 사람이 보는 '오류'.
  const 오류 = 오늘행(db).filter((r) =>
    r.success === 0 && r.fail_reason !== BR.사유.밀림 && !String(r.content).includes(BR.밀림표식))
  assert.equal(오류.length, 0,
    `밀림뿐인데 오류가 ${오류.length}건으로 잡힌다: ${오류.map((r) => r.content).join(' / ')}`)
})

test('P-28: 생략하는 것은 DB 한 줄뿐이다 — 화면 알림은 그대로 나간다', () => {
  const db = 판깔기()
  밀림행넣기(db)
  watchdog.checkMissed(db, { now: 지금 })

  const 경보 = 화면알림.filter((e) => e.type === 'system_alert')
  assert.equal(경보.length, 1, '밀렸어도 알리기는 해야 한다(P-30 의 결정) — 화면 알림이 사라졌다')
  assert.match(경보[0].payload.message, /다른 방송에 밀려/, '밀림이라는 사실을 안 알린다')

  const 누락 = 화면알림.filter((e) => e.type === 'broadcast_missed')
  assert.equal(누락.length, 1, '방송 하나를 짚어 주는 신호도 그대로여야 한다')
})

test('밀림 행이 없으면 생략하지 않는다 — 추측으로 흔적을 지우지 않는다', () => {
  // 시퀀서의 밀림 기록은 실패해도 방송을 안 막는다(catch 로 삼킨다). 그때 감시까지
  // 생략하면 **그 사건의 유일한 흔적이 사라진다.** 표를 읽어 확인했을 때만 생략한다.
  const db = 판깔기()
  db.prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,0)'
  ).run(오늘, '11:10', '자동', '점심 방송 — 무슨 다른 이유로 실패', '자동', '전체')

  watchdog.checkMissed(db, { now: 지금 })
  assert.equal(오늘행(db).length, 2, '밀림이 아닌 실패인데 경보를 생략했다')
})

test('어제의 밀림 행으로 오늘 경보를 생략하지 않는다', () => {
  const db = 판깔기()
  const 어제 = new Date(지금.getTime() - 86400000)
  db.prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success, fail_reason)'
    + ' VALUES (?,?,?,?,?,?,0,?)'
  ).run(todayStr(어제), '11:10', '자동', BR.밀림문구(LANES.lunch.logContent), '자동', '전체', BR.사유.밀림)

  watchdog.checkMissed(db, { now: 지금 })
  assert.equal(오늘행(db).length, 1, '어제 기록으로 오늘 흔적을 지웠다')
  assert.equal(오늘행(db)[0].type, '경보')
})

test('alert.raise 는 기본적으로 이력을 남긴다 — 생략은 명시할 때만', () => {
  const db = 판깔기()
  const alert = require('../services/alert')
  alert.raise('시험', '기본값 확인', {}, db)
  assert.equal(오늘행(db).length, 1, '기본값이 뒤집혔다 — 모든 경보가 조용히 사라진다')
  alert.raise('시험', '생략 확인', {}, db, { 이미기록됨: true })
  assert.equal(오늘행(db).length, 1, '생략을 지시했는데 남겼다')
})
