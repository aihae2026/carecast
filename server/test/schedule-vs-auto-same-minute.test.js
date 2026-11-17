// 같은 분에 예약과 자동방송이 함께 있으면 **예약을 미룬다** (2026-09-03 레드 검증 F6 후속).
//
// 무엇이 문제였나: 매분 tick은 예약(due)을 먼저 돌고 자동방송 5종을 나중에 돈다.
// 그래서 12:00 예약과 12:00 점심 자동방송이 같이 있으면
//   ① 예약이 먼저 나가고 이력에 **성공(1)**으로 적히고
//   ② 1.5초 뒤 자동방송이 newBroadcastToken()으로 그것을 밀어낸다.
// 홀에서는 예약이 잘려 나가는데 기록은 성공이다 — 이 저장소가 가장 싫어하는 "거짓 성공"
// (CC-003 계열)이고, 아무도 안 나간 방송을 찾지 못한다.
//
// 왜 미루기인가: 자동방송 도중의 예약을 미루는 길(H5 (나)안)은 이미 있고 검증돼 있다
// (schedule-defers-during-broadcast.test.js). 문제는 **아직 시작 전이라 broadcastInProgress()가
// false인 같은 tick**뿐이라, 그 창만 같은 판정으로 메운다. 새 정책이 아니라 이미 정한
// 정책의 구멍을 닫는 것이다.
//
// 고정하는 사실:
//  1. 같은 분에 자동방송이 예정돼 있으면 예약은 그 tick에 안 나간다(미룬다)
//  2. 자동방송은 그대로 나간다 — 미루는 것은 예약뿐이다
//  3. 차임벨 예약은 미루지 않는다 — 차임은 공존이 명세다(td09 §3-B 규칙 5)
//  4. 자동방송이 없는 분에는 예약이 예전처럼 곧바로 나간다(회귀)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_samemin_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const { mock } = require('node:test')
const assert = require('node:assert/strict')

const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports } }

const sent = []
stub(require.resolve('../services/sse'), {
  broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
  localClientCount: () => 1, localAliveCount: () => 1, clientCount: () => 1,
  addClient: () => {}, soundOwner: () => null,
})
stub(require.resolve('../services/tts'), {
  generateTTS: async () => '/tmp/fake.mp3',
  generateTTSWithRetry: async () => '/tmp/fake.mp3',
  readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
  deleteTmpFile: () => {}, rateToStr: () => '+0%', pitchToStr: () => '+0Hz',
  getPythonPath: () => null,
})
stub(require.resolve('../services/audioStore'), {
  storeAudio: () => 'fake-audio-id', consumeAudio: () => null,
})
stub(require.resolve('../services/chimePlayer'), {
  playChime: () => {}, resolveChimeVolume: () => 0.8,
})
stub(require.resolve('../services/switchbot'), {
  sendCommand: async () => { throw new Error('테스트에서는 SwitchBot을 부르지 않는다') },
  getConfig: () => ({}),
})

// 마이크 생방송 신호등 — 켜짐/꺼짐을 테스트가 손으로 정한다
const micState = { live: false }
stub(require.resolve('../services/micLive'), {
  isLive: () => micState.live,
  chunkArrived: () => {},
  HOLD_MS: 3000,
})

const cronTasks = []
stub(require.resolve('node-cron', { paths: [path.join(__dirname, '..', 'services')] }), {
  schedule: (expr, fn) => { cronTasks.push({ expr, fn }); return { stop() {}, start() {} } },
})

// 자동방송 발사만 기록용으로 갈아끼운다(다른 배관은 진짜를 쓴다)
const seqPath = require.resolve('../services/broadcastSequencer')
const realSeq = require(seqPath)
const fired = []
require.cache[seqPath].exports = {
  ...realSeq,
  fireMorningBroadcast:       async () => { fired.push('morning') },
  fireExerciseBroadcast:      async () => { fired.push('exercise') },
  fireLunchBroadcast:         async () => { fired.push('lunch') },
  fireDinnerBroadcast:        async () => { fired.push('dinner') },
  fireEveningPrayerBroadcast: async () => { fired.push('evening_prayer') },
}

const { initDB, getDB } = require('../db/schema')
const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
const { startScheduler } = require('../services/scheduler')

const BASE_DAY = [2026, 8, 2]     // 2026-09-02 (수)
const TODAY    = '2026-09-02'
const AT       = '14:23'

let db, tick

test.before(() => {
  mock.timers.enable({ apis: ['Date'], now: new Date(...BASE_DAY, 14, 23, 0) })
  initDB()
  db = getDB()
  startScheduler()
  tick = cronTasks.find(t => t.expr === '* * * * *')?.fn
  assert.ok(tick, '매분 tick이 등록되지 않았다')
})
test.after(() => {
  mock.timers.reset()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

function put(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
function drop(key) { db.prepare('DELETE FROM settings WHERE key = ?').run(key) }

let seq = 0
function makeSchedule(type = 'chime') {
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, '내용', '전체', ?, 1, ?, '[]', ?)
  `).run(`같은분예약${++seq}`, AT, TODAY, type).lastInsertRowid
  return id
}

function reset() {
  mock.timers.setTime(new Date(...BASE_DAY, 14, 23, 0).getTime())
  fired.length = 0; sent.length = 0
  micState.live = false
  db.prepare('DELETE FROM schedules').run()
  db.prepare('DELETE FROM broadcasts').run()
  for (const spec of AUTO_BROADCASTS) { drop(spec.enabledKey); drop(spec.timeKey); drop(spec.firedKey) }
}

// 점심 자동방송을 이 분에 켠다
function armLunchAt(time = AT) {
  const spec = AUTO_BROADCASTS.find(b => b.id === 'lunch')
  put(spec.enabledKey, 'true')
  put(spec.timeKey, time)
}

test('같은 분에 자동방송이 있으면 예약은 그 tick에 안 나간다 — 밀려나 거짓 성공으로 적히던 자리', async () => {
  reset()
  armLunchAt()
  const id = makeSchedule('text')

  await tick()

  assert.deepEqual(fired, ['lunch'], '자동방송은 그대로 나가야 한다')
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.notEqual(row.last_fired, TODAY,
    '예약이 같은 tick에 발사됐다 — 1.5초 뒤 자동방송이 밀어내는데 이력엔 성공으로 남는다(거짓 성공)')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM broadcasts').get().c, 0,
    '밀려날 방송이 이력에 먼저 적혔다')
})

test('차임벨 예약은 미루지 않는다 — 차임은 공존이 명세다', async () => {
  reset()
  armLunchAt()
  const id = makeSchedule('chime')

  await tick()

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.last_fired, TODAY,
    '차임벨까지 미뤘다 — 차임은 방송 위에 겹쳐 나는 것이 명세다(td09 §3-B 규칙 5)')
})

test('자동방송이 없는 분에는 예약이 곧바로 나간다 (회귀)', async () => {
  reset()
  const id = makeSchedule('text')

  await tick()

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.last_fired, TODAY, '멀쩡한 예약까지 미루면 그날 방송이 통째로 사라진다')
})

// ── 사실 5 (레드 검증 F6의 나머지 절반) ────────────────────────────────
// 마이크 생방송은 nowPlaying.broadcast에 안 잡힌다 — 서버 스피커로 직접 나가는 길이라
// 시퀀서를 안 지나기 때문이다. 그래서 직원이 말하는 중에 정시 예약이 그 위에 얹혔다.
// 안내 둘이 겹치면 어느 쪽도 못 알아듣는다 — 자동방송 중 예약을 미루는 이유와 같다(H5).
test('마이크 생방송 중이면 예약을 미룬다 — 말하는 중에 그 위로 얹히지 않는다', async () => {
  reset()
  micState.live = true
  const id = makeSchedule('text')

  await tick()

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.notEqual(row.last_fired, TODAY,
    '직원이 마이크로 말하는 중인데 예약이 그 위로 나갔다 — 둘 다 안 들린다')

  // 말이 끝나면 나간다 — 미루기는 건너뛰기가 아니다
  micState.live = false
  mock.timers.setTime(new Date(...BASE_DAY, 14, 24, 0).getTime())
  await tick()
  const after = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(after.last_fired, TODAY, '마이크가 끝났는데도 예약이 안 나간다')
})

test('미룬 예약은 자동방송이 끝난 뒤 나간다 — 사라지지 않는다', async () => {
  reset()
  armLunchAt()
  const id = makeSchedule('text')
  await tick()                       // 이 분: 자동방송만 나가고 예약은 미룸

  // 다음 분: 자동방송 시각이 아니고 진행 중도 아니다 → 미뤄 둔 것이 나간다
  mock.timers.setTime(new Date(...BASE_DAY, 14, 24, 0).getTime())
  await tick()

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.last_fired, TODAY,
    '미룬 예약이 영영 안 나간다 — 미루기는 건너뛰기가 아니다')
})
