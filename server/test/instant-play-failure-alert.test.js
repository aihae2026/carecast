// 즉시 방송이 스피커로 못 나가면 **화면에도** 알린다 (사용자 지시 2026-09-22).
//
// 「지금 방송」·즐겨찾기(/api/tts/broadcast)는 대기열에 넣자마자 「내보냈습니다」로 답한다.
// 재생은 그 **뒤에** 거절될 수 있어서(재생기 없음·재생 프로그램 오류), 예전엔 이력만 실패로
// 고치고 화면은 조용했다 — 누른 사람은 소리가 안 난 것을 모른다.
//
// 고정하는 사실:
//  1. 종류 없는 거절(진짜 실패)은 `system_alert`(즉시방송)로 화면에 뜬다
//  2. 일부러 끊은 것('의도')·이미 경보가 난 것('경보됨')·소리 끔 모드('하드웨어없음')는 안 뜬다
//     — 사람이 정지를 눌렀는데 「실패」 경보가 뜨면 거짓 경보다
//  3. 진짜 대기열의 소리 끔 모드 거절에는 '하드웨어없음' 종류가 붙어 있다
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_playfail_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// ── 소리·합성이 일어나지 않게 미리 심는 스텁 (tts-speak-ducking.test.js 와 같은 방식) ──
const sent = []
const plays = []

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {},
    clientCount: () => 0,
  },
}

// 진짜 대기열은 사실 3에서 따로 본다 — 여기서는 거절을 손으로 만든다.
const 진짜대기열 = require('../services/audioQueue')
const queuePath = require.resolve('../services/audioQueue')
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true, exports: {
    enqueue: () => new Promise((resolve, reject) => { plays.push({ resolve, reject }) }),
    mciVolume: () => 500,
    stopAll: () => ({ cancelled: 0, killed: false }),
  },
}

const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async () => path.join(os.tmpdir(), 'fake-tts.wav'),
    generateTTSWithRetry: async () => path.join(os.tmpdir(), 'fake-tts.wav'),
    readCues: () => null,
    deleteTmpFile: () => {},
    rateToStr:  (v) => String(v),
    pitchToStr: (v) => String(v),
  },
}

const devicesPath = require.resolve('../services/audioDevices')
require.cache[devicesPath] = {
  id: devicesPath, filename: devicesPath, loaded: true, exports: {
    resolveDeviceIndex: async () => ({ index: null, warning: null }),
  },
}

const 진짜차임 = require('../services/chimePlayer')
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    ...진짜차임,
    playChime: () => {},
    resolveChimeVolume: () => 500,
  },
}

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const ttsRoutes = require('../routes/tts')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/tts': ttsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function post(body) {
  const r = await fetch(app.baseUrl + '/api/tts/broadcast', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.status
}

const tick = () => new Promise(r => setImmediate(r))
const 경보들 = () => sent.filter(s => s.type === 'system_alert').map(s => s.payload)

test.beforeEach(() => { sent.length = 0; plays.length = 0 })

function 거절(message, 종류) { const e = new Error(message); if (종류) e.종류 = 종류; return e }

test('사실 1: 재생이 진짜로 실패하면 화면에 「즉시방송」 경보가 뜬다', async () => {
  assert.equal(await post({ text: '어르신 여러분, 잠시 후 점심 식사가 준비됩니다.' }), 200)
  assert.equal(plays.length, 1, '재생이 대기열에 안 들어갔다 — 시험 전제가 무너졌다')
  assert.equal(경보들().length, 0, '재생 전에 경보가 떴다')

  plays[0].reject(거절('서버 재생 실패 (종료코드 1): 장치 열기 실패'))
  await tick(); await tick()

  const a = 경보들()
  assert.equal(a.length, 1, '재생이 실패했는데 화면 경보가 없다 — 누른 사람은 「내보냈습니다」만 본다')
  assert.equal(a[0].kind, '즉시방송')
  assert.match(a[0].message, /어르신 여러분, 잠시 후 점심/, '어느 방송인지 경보에 안 적혔다')
  assert.match(a[0].message, /장치 열기 실패/, '왜 실패했는지 경보에 안 적혔다')
})

for (const [종류, 뜻] of [
  ['의도', '사람의 정지·비상방송 교체'],
  ['경보됨', '제한시간(경보가 이미 났다)'],
  ['하드웨어없음', '소리 끔 모드'],
]) {
  test(`사실 2: ${뜻}('${종류}') 거절은 화면 경보를 띄우지 않는다`, async () => {
    assert.equal(await post({ text: `어르신 여러분, ${종류} 시험 안내입니다.` }), 200)
    plays[0].reject(거절('중단', 종류))
    await tick(); await tick()
    assert.equal(경보들().length, 0, `'${종류}' 거절에 경보가 떴다 — 거짓 경보이거나 두 번 뜬다`)
  })
}

test('사실 3: 진짜 대기열의 소리 끔 모드 거절에는 「하드웨어없음」 종류가 붙는다', async () => {
  // 시험은 늘 하드웨어 접근 없음 모드로 돈다(진짜 스피커를 안 울린다).
  const err = await 진짜대기열.enqueue('없는파일.wav').then(() => null, (e) => e)
  assert.ok(err, '소리 끔 모드인데 재생이 성공했다 — 시험 환경이 달라졌다')
  assert.equal(err.종류, '하드웨어없음',
    '종류가 없다 — 개발 PC·시험에서 방송마다 「실패」 경보가 뜬다')
})
