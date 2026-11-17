// 유예 0분이 조용히 5분으로 바뀌던 것 (P-38, 2026-09-10).
//
// `Number(getSetting(...)) || 기본값` 이 네 자리에 따로 적혀 있었다
// (`watchdog.js` 세 곳 · `routes/schedules.js` 한 곳). `||` 는 **0 을 falsy 로 삼킨다.**
// 그래서 사람이 유예 0분을 저장하면 **화면엔 0 이 남고 판정은 5분을 쓴다.**
// 값이 안 먹는 것도 나쁘지만, 화면이 0 이라고 말하는 것이 더 나쁘다 —
// 사람은 즉시 알림이 켜졌다고 믿고 안 오는 경보를 기다린다.
//
// 게다가 `routes/schedules.js` 는 기본값 `5` 를 **리터럴로 베껴 적고 있었다** —
// 감시의 기본값이 바뀌면 화면만 5 로 남는다(FP-0005).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_grace0_${process.pid}_${Date.now()}.db`)
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
const { writeSetting, 숫자설정 } = require('../domain/settingsRead')
const watchdog = require('../services/watchdog')

initDB()
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

// ── 읽는 규칙 자체 — 기대값을 손으로 적는다 ─────────────────────────────

test('0 은 0 이다 — 이것이 이 결함의 전부다', () => {
  assert.equal(숫자설정('0', 5), 0, '0 을 기본값으로 되돌린다 — 화면과 판정이 갈린다')
  assert.equal(숫자설정(0, 5), 0)
})

test('없거나 비었거나 못 읽으면 기본값이다', () => {
  assert.equal(숫자설정(null, 5), 5)
  assert.equal(숫자설정(undefined, 5), 5)
  assert.equal(숫자설정('', 5), 5)
  assert.equal(숫자설정('   ', 5), 5, '공백만 있는 값도 "안 정했다"이다')
  assert.equal(숫자설정('abc', 5), 5)
  assert.equal(숫자설정('NaN', 5), 5)
})

test('음수는 기본값으로 둔다 — 유예가 음수면 예정 시각 전에 누락을 알린다', () => {
  assert.equal(숫자설정('-3', 5), 5)
})

test('정상 값은 그대로 읽는다 — 통과해야 하는 사례', () => {
  assert.equal(숫자설정('7', 5), 7)
  assert.equal(숫자설정('60', 5), 60)
  assert.equal(숫자설정(' 12 ', 5), 12, '앞뒤 공백은 사람이 흔히 넣는다')
})

// ── 실제 판정에 먹는가 ──────────────────────────────────────────────────

function 판깔기(grace) {
  const db = getDB()
  화면알림.length = 0
  for (const k of ['morning_enabled', 'exercise_broadcast_enabled', 'dinner_broadcast_enabled', 'evening_prayer_enabled']) {
    writeSetting(db, k, 'false')
  }
  writeSetting(db, 'lunch_broadcast_enabled', 'true')
  writeSetting(db, 'lunch_broadcast_time', '11:10')
  writeSetting(db, 'lunch_last_fired', '')
  writeSetting(db, 'lunch_last_started', '')
  writeSetting(db, 'watchdog_alerted_lunch', '')
  writeSetting(db, 'watchdog_grace_min', String(grace))
  return db
}

/** 그날 11:12 — 예정(11:10) + 2분. 유예 0이면 걸리고, 유예 5면 아직이다. */
const 시각 = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

test('유예 0 을 저장하면 예정 시각 다음 분부터 알린다', () => {
  const db = 판깔기(0)
  const found = watchdog.checkMissed(db, { now: 시각(11, 12) })
  assert.equal(found.length, 1,
    '유예 0 인데 안 알렸다 — 저장한 0 이 조용히 5분으로 바뀌었다')
})

test('유예 5 는 예전 그대로다 — 고치면서 반대편으로 넘어가지 않았다', () => {
  const db = 판깔기(5)
  assert.equal(watchdog.checkMissed(db, { now: 시각(11, 12) }).length, 0,
    '유예 5분인데 2분 만에 알렸다')
  판깔기(5)
  assert.equal(watchdog.checkMissed(getDB(), { now: 시각(11, 20) }).length, 1,
    '유예 5분이 지났는데 안 알렸다')
})

test('설정이 비어 있으면 기본값 5 다 — 지금까지의 동작', () => {
  const db = 판깔기('')
  assert.equal(watchdog.checkMissed(db, { now: 시각(11, 12) }).length, 0)
})

// ── 기본값이 두 벌이 아닌가 ─────────────────────────────────────────────

test('화면(오늘 목록)과 감시가 같은 기본값을 본다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'schedules.js'), 'utf8')
  const LF = String.fromCharCode(10)
  const 본문 = src.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  assert.match(본문, /DEFAULT_GRACE_MIN/,
    '화면이 기본값을 자기 리터럴로 들고 있다 — 감시 기본값이 바뀌면 화면만 옛 값으로 남는다')
  assert.doesNotMatch(본문, /Number\(get\('watchdog_grace_min'\)\)/,
    '0 을 삼키는 옛 읽기가 남아 있다')
})
