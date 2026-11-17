// 취소된 방송의 녹음 음원이 새 소리 위로 나가지 않는가 (CC-045).
//
// fireSchedule은 음원 예약을 만나면 안내 TTS를 쏜 뒤 **3.5초 뒤에** 녹음 음원 재생을
// 지시한다(prayer_schedule_play). 그 3.5초는 사람이 정지 버튼을 누르기에 충분한 시간이고,
// 같은 분(分)에 걸린 다른 자동방송이 시작되기에도 충분하다. 그런데 콜백은 아무것도 확인하지
// 않고 그냥 쏜다 — 현장에서는 "정지를 눌렀는데 3초쯤 뒤에 음원이 혼자 나온다", "점심방송이
// 시작됐는데 그 위로 녹음 음원이 겹친다"로 보인다.
//
// 처방으로 적혀 있던 isCancelled(tok)는 여기서 못 쓴다 — 방송 토큰은 broadcastSequencer의
// 것이고 fireSchedule에는 토큰이 아예 없다. 대신 이 저장소가 이미 쓰는 **취소 세대(generation)
// 대조**로 간다(broadcastGate.waitForAudioEnd의 sinceGen과 같은 어휘·같은 이유):
// setTimeout을 걸기 **직전**에 cancelGeneration()을 읽어 두고, 콜백 안에서 그 값이 여전히
// 같을 때만 보낸다. 세대가 달라졌다 = 그 사이 정지·새 방송이 있었다 = 보내면 안 된다.
//
// 3.5초를 실제로 기다리지 않는다(CC-048 — 벽시계에 판정을 걸면 flake가 난다). 대신
// global.setTimeout을 갈아끼워 3500ms짜리 콜백을 **붙잡아 두고**, 취소를 넣거나 안 넣은 뒤
// 손으로 실행해서 결과를 본다. 소리는 sse 스텁이 전부 가로채므로 스피커는 울리지 않는다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_prayercancel_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// 실제 소리가 나지 않도록 SSE를 스텁한다(scheduler require 전에)
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const chimePath  = require.resolve('../services/chimePlayer')
const realChime  = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: { ...realChime, playChime: () => {} },
}

const { initDB, getDB } = require('../db/schema')
const { fireSchedule }  = require('../services/scheduler')
// scheduler가 보는 것과 **같은 모듈 인스턴스**여야 세대 대조가 성립한다(require 캐시 공유).
const { cancelCurrentBroadcast, stopCurrentBroadcast } = require('../services/broadcastGate')

const PRAYER_DELAY_MS = 3500   // scheduler.js가 녹음 음원 재생을 미루는 시간

// 3500ms짜리 setTimeout 콜백만 붙잡아 둔다. 나머지 타이머는 진짜 setTimeout으로 흘려보낸다 —
// fireSchedule 안의 다른 await가 이 스텁 때문에 멈추면 안 된다.
const realSetTimeout = global.setTimeout
let captured = []

async function fireCapturingPrayerTimer(schedule) {
  captured = []
  global.setTimeout = function (fn, delay, ...rest) {
    if (delay === PRAYER_DELAY_MS) {
      captured.push(fn)
      return { unref() { return this }, ref() { return this } }   // 실행하지 않고 붙잡아 둔다
    }
    return realSetTimeout(fn, delay, ...rest)
  }
  try {
    await fireSchedule(schedule, getDB())
  } finally {
    global.setTimeout = realSetTimeout
  }
}

const countPrayerPlays = () => sent.filter(e => e.type === 'prayer_schedule_play').length
const lastPrayerPlay   = () => [...sent].reverse().find(e => e.type === 'prayer_schedule_play')

let seq = 0
function makePrayerSchedule(broadcastType) {
  const db = getDB()
  // content는 비워 둔다 — 안내 TTS 생성(옛 인터넷 합성 엔진)까지 돌릴 이유가 없고, 이 테스트가 보는 것은
  // 그 뒤에 붙는 녹음 음원 지시뿐이다.
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date,
                           repeat_weekdays, broadcast_type)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', '[]', ?)
  `).run(`음원취소테스트${++seq}`, broadcastType).lastInsertRowid
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

test.before(() => { initDB() })

test.after(() => {
  global.setTimeout = realSetTimeout
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── ① 아무 일도 없었으면 예전 그대로 나간다 ────────────────────
test('취소가 없으면 3.5초 뒤 녹음 음원이 그대로 나간다', async () => {
  const s = makePrayerSchedule('morning-prayer')
  await fireCapturingPrayerTimer(s)

  assert.equal(captured.length, 1,
    `음원 예약인데 ${PRAYER_DELAY_MS}ms 뒤 발사가 예약되지 않았다`)

  const before = countPrayerPlays()
  captured[0]()
  assert.equal(countPrayerPlays() - before, 1,
    '취소가 없었는데 안 나가면 멀쩡한 아침 방송 음원이 통째로 사라진다')
  assert.equal(lastPrayerPlay().payload.category, 'morning-prayer')
  assert.equal(lastPrayerPlay().payload.withStaff, false)
})

test('직원용 음원(-staff)도 그대로 나간다 — withStaff가 실린다', async () => {
  const s = makePrayerSchedule('lunch-prayer-staff')
  await fireCapturingPrayerTimer(s)

  const before = countPrayerPlays()
  captured[0]()
  assert.equal(countPrayerPlays() - before, 1)
  assert.equal(lastPrayerPlay().payload.category, 'lunch-prayer')
  assert.equal(lastPrayerPlay().payload.withStaff, true)
})

// ── ② 그 사이에 취소가 있었으면 안 나간다 ──────────────────────
test('3.5초 사이에 새 방송이 시작됐으면 녹음 음원을 보내지 않는다', async () => {
  const s = makePrayerSchedule('dinner-prayer')
  await fireCapturingPrayerTimer(s)
  assert.equal(captured.length, 1, '발사가 예약되지 않았다면 이 테스트는 아무것도 검증하지 못한다')

  const before = countPrayerPlays()
  cancelCurrentBroadcast()   // 다른 자동방송이 시작됨(newBroadcastToken이 거쳐가는 경로)
  captured[0]()

  assert.equal(countPrayerPlays() - before, 0,
    '취소 뒤인데도 보냈다 — 새 방송 위로 저녁 마무리 음원이 겹쳐 나간다')
})

test('3.5초 사이에 정지 버튼을 눌렀으면 녹음 음원을 보내지 않는다', async () => {
  const s = makePrayerSchedule('morning-prayer-staff')
  await fireCapturingPrayerTimer(s)
  assert.equal(captured.length, 1)

  const before = countPrayerPlays()
  stopCurrentBroadcast()     // 사람이 화면에서 정지
  captured[0]()

  assert.equal(countPrayerPlays() - before, 0,
    '정지를 눌렀는데 3초쯤 뒤 음원이 혼자 나오는 것이 이 버그의 현장 증상이다')
})

// ── ③ 취소 판정은 "발사 예약 직전"을 기준으로 한다 ─────────────
test('발사 예약보다 앞선 취소는 이 방송을 막지 않는다', async () => {
  // 세대를 "콜백 실행 시점의 절대값"으로 비교하면(예: gen === 0) 하루에 한 번만 맞는다.
  // 기준은 언제나 **이 방송이 발사를 예약하기 직전에 읽어 둔 값**이어야 한다.
  cancelCurrentBroadcast()   // 이 예약이 시작되기 전에 이미 취소가 몇 번 있었다
  cancelCurrentBroadcast()

  const s = makePrayerSchedule('lunch-prayer')
  await fireCapturingPrayerTimer(s)

  const before = countPrayerPlays()
  captured[0]()
  assert.equal(countPrayerPlays() - before, 1,
    '과거의 취소 횟수 때문에 멀쩡한 음원 방송이 막히면 안 된다')
})
