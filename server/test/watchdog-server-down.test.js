// 서버가 꺼져 있던 시각의 자동방송 (P-97, 사용자 승인 2026-09-10).
//
// **승인 문구**: *"자동방송 5종도 예약과 동일하게, 예정 시각에 서버가 꺼져 있었으면 경보를
// 내지 않는 것으로 진행해. 다만 이력은 없애지 말고 '서버 미가동으로 미실행'으로 구분해 남겨.
// 실제 가동 기록으로 확인 가능한 경우에만 그렇게 판정하고, 확인이 안 되면 '확인 불가'로 남겨."*
//
// **무엇이 어긋나 있었나**: 예약 감시는 `wasUpAt` 을 보는데(ISSUE-006 사용자 결정)
// 자동방송 감시는 안 봤다. 같은 상황에서 **아침방송은 경보가 나고 같은 시각 예약은 조용**했다.
//
// **모르는 것은 접지 않는다.** 가동 기록이 아예 없으면 "꺼져 있었다"가 아니라 **모른다**이고,
// 그때 경보를 삼키면 진짜 누락이 조용히 사라진다 — 이 저장소에서 가장 비싼 오판이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_wdsdown_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const 화면알림 = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (t, p) => { 화면알림.push({ type: t, payload: p }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const watchdog = require('../services/watchdog')
const boot = require('../services/serverBoot')
const BR = require('../domain/broadcastRecord')
const { todayStr } = require('../services/repeatSchedule')

initDB()
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

const 오늘 = todayStr()
const 시각 = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

function 판깔기() {
  const db = getDB()
  db.prepare('DELETE FROM broadcasts').run()
  db.prepare('DELETE FROM server_boot').run()
  화면알림.length = 0
  for (const k of ['morning_enabled', 'exercise_broadcast_enabled', 'dinner_broadcast_enabled', 'evening_prayer_enabled']) {
    writeSetting(db, k, 'false')
  }
  writeSetting(db, 'lunch_broadcast_enabled', 'true')
  writeSetting(db, 'lunch_broadcast_time', '11:10')
  writeSetting(db, 'lunch_last_fired', '')
  writeSetting(db, 'lunch_last_started', '')
  writeSetting(db, 'watchdog_alerted_lunch', '')
  writeSetting(db, 'watchdog_grace_min', '5')
  return db
}

function 가동구간(from, seen, stopped = null) {
  getDB().prepare('INSERT INTO server_boot (started_at, last_seen_at, stopped_at) VALUES (?, ?, ?)')
    .run(boot.nowISO(from), boot.nowISO(seen), stopped ? boot.nowISO(stopped) : null)
}
const 오늘행 = (db) => db.prepare('SELECT * FROM broadcasts WHERE date = ? ORDER BY id').all(오늘)
const 경보수 = () => 화면알림.filter((e) => e.type === 'system_alert').length

// ── 승인된 세 갈래 ──────────────────────────────────────────────────────

test('떠 있었으면 지금까지 그대로 알린다 — 대조군', () => {
  const db = 판깔기()
  가동구간(시각(0, 0), 시각(23, 59))
  const found = watchdog.checkMissed(db, { now: 시각(11, 30) })
  assert.equal(found.length, 1, '떠 있었는데 경보가 안 났다')
  assert.equal(경보수(), 1)
})

test('P-97: 꺼져 있었으면 경보를 안 낸다', () => {
  const db = 판깔기()
  가동구간(시각(12, 0), 시각(23, 0))   // 12:00 에 켰다 — 11:10 은 지나간 뒤다
  const found = watchdog.checkMissed(db, { now: 시각(13, 0) })
  assert.equal(found.length, 0, 'PC 가 꺼져 있던 시간의 방송을 누락으로 알렸다')
  assert.equal(경보수(), 0, '화면 배너까지 나갔다')
})

test('P-97: 그래도 이력은 남는다 — "서버 미가동으로 미실행"으로 구분해서', () => {
  const db = 판깔기()
  가동구간(시각(12, 0), 시각(23, 0))
  watchdog.checkMissed(db, { now: 시각(13, 0) })

  const 행 = 오늘행(db)
  assert.equal(행.length, 1, `이력이 ${행.length}줄이다 — 흔적을 없애면 그날 왜 안 나갔는지 못 묻는다`)
  assert.equal(행[0].fail_reason, BR.사유.서버미가동, '사유 코드로 구분이 안 된다')
  assert.match(행[0].content, /서버 미가동으로 미실행/, '사람이 읽을 문구가 없다')
  assert.equal(행[0].type, '자동', '경보 행으로 남았다 — 경보를 안 냈는데 경보로 적힌다')
})

test('P-97: 가동 기록이 아예 없으면 "확인 불가"다 — 모르는 것을 꺼짐으로 접지 않는다', () => {
  const db = 판깔기()   // server_boot 를 비운 채로 둔다
  const found = watchdog.checkMissed(db, { now: 시각(11, 30) })

  assert.equal(found.length, 1,
    '모르는 것을 "꺼져 있었다"로 접었다 — 진짜 누락이 조용히 사라진다')
  assert.equal(경보수(), 1, '확인이 안 되는데 경보를 삼켰다')

  const 확인불가행 = 오늘행(db).filter((r) => r.fail_reason === BR.사유.확인불가)
  assert.equal(확인불가행.length, 1, '확인 불가라는 사실을 안 남겼다')
  assert.match(확인불가행[0].content, /확인 불가/)
})

test('P-97: 재시작 틈은 꺼진 것으로 안 본다 — 그 방송은 진짜로 안 나갔다', () => {
  const db = 판깔기()
  가동구간(시각(8, 0), 시각(11, 9))     // 11:09 까지
  가동구간(시각(11, 12), 시각(23, 0))   // 11:12 에 다시 — 11:10 이 틈에 빠진다
  const found = watchdog.checkMissed(db, { now: 시각(11, 30) })
  assert.equal(found.length, 1, '재시작 틈을 "꺼져 있었다"로 읽어 진짜 누락을 삼켰다(P-25)')
})

test('P-97: 하루 한 번만 남긴다 — 매분 돌아도 이력이 안 쌓인다', () => {
  const db = 판깔기()
  가동구간(시각(12, 0), 시각(23, 0))
  watchdog.checkMissed(db, { now: 시각(13, 0) })
  watchdog.checkMissed(db, { now: 시각(13, 1) })
  watchdog.checkMissed(db, { now: 시각(13, 2) })
  assert.equal(오늘행(db).length, 1, '매분 한 줄씩 쌓인다 — 이력이 뒤덮인다')
})

// ── 오류 숫자 — 고장이 아닌 것을 고장으로 세지 않는다 ────────────────────

test('P-97: 서버 미가동은 오류로 안 센다 — PC 가 꺼져 있던 것은 고장이 아니다', () => {
  // P-31 이 밀림에 대해 정한 것과 같은 규칙이다. 목록의 정본은 broadcastRecord 하나다.
  assert.ok(BR.고장아닌사유.includes(BR.사유.서버미가동), '고장 아닌 사유 목록에 없다')
  assert.ok(BR.고장아닌사유.includes(BR.사유.밀림), '밀림이 빠졌다 — P-31 이 되돌아간다')
  assert.ok(!BR.고장아닌사유.includes(BR.사유.기타), '그 밖의 실패까지 오류에서 뺐다')
})

test('P-97: 확인 불가는 오류로 센다 — 모르는 것을 괜찮은 것으로 접지 않는다', () => {
  assert.ok(!BR.고장아닌사유.includes(BR.사유.확인불가),
    '확인이 안 되는 것을 "고장 아님"으로 뺐다 — 진짜 문제가 숫자에서 사라진다')
})

test('오류 집계가 목록을 베껴 적지 않는다 — 사유를 더하는 날 숫자만 옛 기준으로 남는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'status.js'), 'utf8')
  const LF = String.fromCharCode(10)
  const 본문 = src.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  assert.match(본문, /오류수\(db,/, '오류 집계가 단일 출처를 안 읽는다')
  assert.doesNotMatch(본문, /'server_down'/, '사유 코드를 직접 적었다')
  assert.doesNotMatch(본문, /fail_reason NOT IN/, '집계 질의를 직접 적었다 — 두 벌이 된다')
})
