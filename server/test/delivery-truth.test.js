// 방송 이력이 진실을 적는가.
//
// 이 시스템의 가장 큰 구멍(2026-08-29 리뷰 CC-008): 정시 방송 6회의 소리는 전부 현장 PC의
// 브라우저 창에서 난다. 스케줄러·시퀀서는 audioQueue(서버 스피커)를 한 번도 부르지 않고
// broadcastSSE로 쏘기만 한다. 그런데 broadcastSSE는 듣는 클라이언트가 0명이어도 조용히
// 끝나고, finishScheduleFire는 그와 무관하게 success=1을 적는다.
//
// 결과: 직원이 CareCast 창을 닫으면 그 순간부터 6회 방송이 전부 무음인데, 이력에는 6회 모두
// 성공으로 남는다. 시작 bat도 포트가 LISTEN이면 아무것도 안 한다. 아무도 모른 채 며칠이 간다.
//
// 여기서 고정하는 것:
//   1) broadcastSSE가 실제로 전달한 수를 돌려준다
//   2) 현장 PC(루프백) 청취자가 0명이면 브라우저로 나가는 방송은 success=0으로 남는다
//   3) 차임벨은 서버 스피커라 청취자가 없어도 success=1 — 멀쩡히 난 소리를 실패로 적지 않는다
//
// 3번이 중요하다. "무음을 성공으로 적는" 문제를 고치다가 "성공을 실패로 적으면" 정확히
// 반대 방향의 같은 실수가 된다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_delivery_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 실제 소리가 나지 않도록 미리 심어 두는 스텁 (scheduler가 require하기 전에) ──
// sse는 스텁하지 않는다 — 전달 여부 판정이 이 파일의 주제라서 진짜를 써야 의미가 있다.
const chimes = []
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    playChime: (type, volumePct, onDone) => { chimes.push({ type, volumePct }); if (onDone) onDone(true) },
    resolveChimeVolume: () => 0.8,
  },
}

// TTS는 네트워크(옛 인터넷 합성 엔진)를 타므로 스텁한다
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async () => '/tmp/fake.mp3',
    generateTTSWithRetry: async () => '/tmp/fake.mp3',
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {},
    rateToStr: () => '+0%',
    pitchToStr: () => '+0Hz',
    getPythonPath: () => null,
  },
}

const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    storeAudio: () => 'fake-audio-id',
    consumeAudio: () => null,
  },
}

const { initDB, getDB } = require('../db/schema')
const sse = require('../services/sse')
const { fireSchedule } = require('../services/scheduler')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 가짜 SSE 클라이언트 ────────────────────────────────────────
// remoteAddress로 현장 PC(루프백) 여부가 갈리는지 보려고 주소를 골라 넣는다.
function fakeClient(remoteAddress, tabId = null) {
  const closers = []
  const res = {
    written: [],
    writeHead() {},
    write(chunk) { this.written.push(chunk) },
    on(ev, cb) { if (ev === 'close') closers.push(cb) },
    _close() { for (const cb of closers) cb() },
  }
  const req = { socket: { remoteAddress } }
  sse.addClient(res, req, tabId)
  return res
}

function clearClients() {
  // addClient가 등록한 close 콜백으로 정리한다 — 내부 Set을 직접 만지지 않는다
  for (const c of [...openClients]) { c._close() }
  openClients.length = 0
}
const openClients = []

function addLocal()  { const c = fakeClient('127.0.0.1');  openClients.push(c); return c }
function addRemote() { const c = fakeClient('192.168.0.55'); openClients.push(c); return c }

let seq = 0
function makeSchedule(broadcast_type, content = '') {
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, ?, '전체', '10:00', 1, '2026-08-28', '[]', ?)
  `).run(`전달테스트${++seq}`, content, broadcast_type).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

function lastLog(title) {
  return getDB().prepare('SELECT * FROM broadcasts WHERE content = ? OR content = ? ORDER BY id DESC LIMIT 1')
    .get(title, title)
}

// ── 1) broadcastSSE가 전달 수를 돌려준다 ───────────────────────

test('broadcastSSE가 실제로 전달한 클라이언트 수를 돌려준다', () => {
  clearClients()
  assert.equal(sse.broadcastSSE('test_event', {}), 0, '아무도 없으면 0')

  addLocal(); addRemote()
  assert.equal(sse.broadcastSSE('test_event', {}), 2, '둘에게 갔으면 2')

  clearClients()
  assert.equal(sse.broadcastSSE('test_event', {}), 0, '끊긴 뒤엔 다시 0')
})

test('현장 PC(루프백) 청취자 수를 따로 센다 — 직원 휴대폰은 소리를 내지 않는다', () => {
  clearClients()
  assert.equal(sse.localClientCount(), 0)

  addRemote()
  assert.equal(sse.localClientCount(), 0, '원격 PC·휴대폰은 현장 스피커를 울리지 않는다')
  assert.equal(sse.clientCount(), 1)

  addLocal()
  assert.equal(sse.localClientCount(), 1)

  clearClients()
  assert.equal(sse.localClientCount(), 0)
})

// ── 2) 아무도 못 받았으면 성공이 아니다 ────────────────────────

test('현장 청취자가 0명이면 예약 TTS 방송은 success=0으로 남는다', async () => {
  clearClients()
  const s = makeSchedule('text', '점심 식사 안내드립니다.')
  await fireSchedule(s, getDB())

  const row = lastLog('점심 식사 안내드립니다.')
  assert.ok(row, '이력 행 자체는 남아야 한다')
  assert.equal(row.success, 0, '창이 닫혀 아무 소리도 안 났는데 성공으로 적으면 아무도 모른다')
})

test('원격 PC만 붙어 있어도 success=0 — 소리는 현장에서 나야 한다', async () => {
  clearClients()
  addRemote()
  const s = makeSchedule('text', '저녁 안내드립니다.')
  await fireSchedule(s, getDB())

  assert.equal(lastLog('저녁 안내드립니다.').success, 0,
    '직원 휴대폰이 이벤트를 받은 것과 요양원 스피커에서 소리가 난 것은 다르다')
})

test('현장 청취자가 있으면 success=1', async () => {
  clearClients()
  addLocal()
  const s = makeSchedule('text', '아침 안내드립니다.')
  await fireSchedule(s, getDB())

  assert.equal(lastLog('아침 안내드립니다.').success, 1)
})

// ── 3) 서버 스피커로 나가는 것은 브라우저와 무관하다 ───────────

test('차임벨은 현장 청취자가 없어도 success=1 — 서버 스피커가 냈다', async () => {
  clearClients()
  const before = chimes.length
  const s = makeSchedule('chime')
  await fireSchedule(s, getDB())

  assert.equal(chimes.length, before + 1, '서버 스피커로 실제로 나갔다')
  assert.equal(lastLog(s.title).success, 1,
    '멀쩡히 난 소리를 실패로 적으면, 고치려던 문제의 정확한 반대 오류가 된다')
})

test('음원 예약은 브라우저가 재생하므로 청취자가 없으면 success=0', async () => {
  clearClients()
  const s = makeSchedule('audio')
  await fireSchedule(s, getDB())
  assert.equal(lastLog(s.title).success, 0)
})

// ── 참조가 깨진 예약 (2026-08-29 리뷰 CC-020이 가리킨 실제 문제) ─────────────
//
// 예약이 참조하는 음원·영상이 지워졌거나 BGM 해석에 실패하면 console.error 한 줄만 남기고
// **이력에는 성공으로 적혔다.** 현장 재생 창이 열려 있으면 hasSitePlayer()가 true라
// success=1이 된다 — 소리는 아무것도 안 났는데 이력만 보면 정상이다.
//
// FK로는 못 막는다. schedules.audio_file_id에는 외래키 선언 자체가 없다(실측). 참조가
// 깨졌는지는 발사 시점에 조회해 봐야 알 수 있으므로, 그 자리에서 실패로 적어야 한다.
test('참조하는 음원이 없으면 청취자가 있어도 success=0', async () => {
  clearClients(); addLocal()
  const s = makeSchedule('audio')
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(999999, s.id)
  const fresh = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id)

  await fireSchedule(fresh, getDB())
  assert.equal(lastLog(s.title).success, 0, '아무 소리도 안 났는데 성공으로 남으면 안 된다')
})

test('참조하는 영상이 없으면 청취자가 있어도 success=0', async () => {
  clearClients(); addLocal()
  const s = makeSchedule('video')
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(999999, s.id)
  const fresh = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id)

  await fireSchedule(fresh, getDB())
  assert.equal(lastLog(s.title).success, 0)
})


test('참조가 깨졌다는 사실을 이력에 경보로도 남긴다 — 로그만으로는 아무도 모른다', async () => {
  clearClients(); addLocal()
  const s = makeSchedule('audio')
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(999999, s.id)
  const fresh = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id)

  await fireSchedule(fresh, getDB())
  const alert = getDB().prepare(
    "SELECT * FROM broadcasts WHERE type = '경보' AND content LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`%${s.title}%`)
  assert.ok(alert, '경보 행이 없다 — 화면 배너도 안 뜬다는 뜻이다')
  assert.equal(alert.success, 0)
})

// ── 5) 유령은 재생 창이 아니다 (td09 §9의 미뤄 둔 갈래, 2026-09-02) ──────────────
// H15에서 배운 것: Vite 프록시가 SSE close를 upstream에 안 전달하면 **죽은 창이 연결
// 목록에 남는다.** 그 유령을 "재생 창 있음"으로 세면, 이 파일이 막은 원래 구멍(무음이
// 성공으로 적힘)이 유령 경로로 그대로 되살아난다. 판정은 생존 신호가 유효한 연결만 센다.
// 안전망: 신호를 한 번도 못 받은 서버(옛 화면만)는 전원 생존 취급 — 예전 판정 그대로.

test('유령만 남았으면 success=0 — 생존 신호가 만료된 연결은 재생 창이 아니다', async () => {
  clearClients()
  sse._test.reset()
  const realNow = sse._test.now
  try {
    const BASE = Date.now()
    sse._test.now = () => BASE
    openClients.push(fakeClient('127.0.0.1', 'tab-ghost'))
    sse.noteAlive('tab-ghost')                       // 신호를 보낼 줄 아는 화면이었다
    sse._test.now = () => BASE + sse.ALIVE_TIMEOUT_MS + 1000   // 그 뒤 소식이 끊겼다

    const s = makeSchedule('text', '유령 시간 안내드립니다.')
    await fireSchedule(s, getDB())
    assert.equal(lastLog('유령 시간 안내드립니다.').success, 0,
      '유령 연결을 재생 창으로 셌다 — 창이 죽어 무음인데 이력에는 성공으로 남는다')
  } finally {
    sse._test.now = realNow
    sse._test.reset()
    clearClients()
  }
})

test('유령이 섞여 있어도 산 창이 하나면 success=1', async () => {
  clearClients()
  sse._test.reset()
  const realNow = sse._test.now
  try {
    const BASE = Date.now()
    sse._test.now = () => BASE
    openClients.push(fakeClient('127.0.0.1', 'tab-g2'))
    sse.noteAlive('tab-g2')
    // 91초 뒤 — 유령의 신호는 만료됐고, 산 창이 새로 신호를 보낸다
    sse._test.now = () => BASE + sse.ALIVE_TIMEOUT_MS + 1000
    openClients.push(fakeClient('127.0.0.1', 'tab-live'))
    sse.noteAlive('tab-live')

    const s = makeSchedule('text', '산 창 안내드립니다.')
    await fireSchedule(s, getDB())
    assert.equal(lastLog('산 창 안내드립니다.').success, 1,
      '산 창이 있는데 실패로 적었다 — 멀쩡한 방송을 실패로 적는 반대 방향 실수다')
  } finally {
    sse._test.now = realNow
    sse._test.reset()
    clearClients()
  }
})

test('생존 신호를 한 번도 못 받은 서버(옛 화면만)는 예전 판정 그대로 success=1', async () => {
  clearClients()
  sse._test.reset()          // 신호 0회 상태로 되돌린다
  try {
    addLocal()               // 신호를 보낼 줄 모르는 옛 화면
    const s = makeSchedule('text', '옛 화면 안내드립니다.')
    await fireSchedule(s, getDB())
    assert.equal(lastLog('옛 화면 안내드립니다.').success, 1,
      '옛 화면만 있다고 전부 실패로 적었다 — H15의 안전장치(전원 생존 취급)가 판정에서 빠졌다')
  } finally {
    sse._test.reset()
    clearClients()
  }
})
