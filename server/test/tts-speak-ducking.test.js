// 서버 스피커 TTS의 덕킹 신호 (td09 H6).
//
// 쉬운화면 '방송하기'·즐겨찾기 문구(/api/tts/broadcast)의 실소리는 **서버 스피커**다.
// 예약 TTS는 브라우저에서 재생하니 스스로 tts-start/end를 쏘는데, 이 경로는 브라우저가
// 시작·끝을 알 방법이 없어 홀 BGM이 맨 볼륨으로 안내와 겹쳤다. 서버가 재생의 시작
// (enqueue)과 끝(promise 정착)을 아는 유일한 곳이므로 `tts_speak` SSE로 알리고, 화면
// (useScheduledBroadcast)이 기존 덕킹 이벤트로 바꿔 쏜다.
//
// 고정하는 사실 셋:
//  1. 방송이 나가면 tts_speak start가, 재생이 끝나면 end가 나간다
//  2. 재생이 실패해도 end는 나간다 — 안 나가면 덕킹이 영영 안 풀린다
//  3. 비상방송이 현재 재생을 교체하면 옛 방송의 end는 침묵한다(세대 번호) —
//     옛 end가 새 start 뒤에 도착하면 덕킹이 풀린 채 비상방송이 나간다
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttsspeak_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// ── 실제 소리·TTS 생성이 일어나지 않도록 미리 심어 두는 스텁 ────────────────────
// routes/tts.js가 require하기 **전에** 캐시를 채워야 한다(broadcast-volume.test.js와 같은 방식).
const sent = []            // broadcastSSE 호출 기록
const plays = []           // enqueue된 재생 — 테스트가 손으로 끝낸다(resolve/reject)

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {},
    clientCount: () => 0,
  },
}

const queuePath = require.resolve('../services/audioQueue')
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true, exports: {
    // 재생을 바로 끝내지 않는다 — start와 end 사이를 테스트가 관찰할 수 있게.
    enqueue: (tmpFile, priority) => new Promise((resolve, reject) => {
      plays.push({ tmpFile, priority, resolve, reject })
    }),
    mciVolume: () => 500,
    stopAll: () => ({ cancelled: 0, killed: false }),
  },
}

const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    // 2026-09-03부터 운영 경로는 generateTTSWithRetry(캐시 우선 + 재시도 + 폴백)만 쓴다.
    // 이음새 이름이 옮겨간 것이라 둘 다 같은 가짜로 막는다 — 안 그러면 진짜 옛 인터넷 합성 엔진를 부른다.
    generateTTS:          async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    generateTTSWithRetry: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
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

// **진짜 모듈에서 파생시킨다** — 소리 내는 것 하나만 가짜로 덮는다 (2026-09-13 고침).
//
// 예전엔 `{ playChime, resolveChimeVolume }` 둘만 적어 두고 통째로 갈아끼웠다. 그러다
// `routes/tts.js` 가 같은 모듈의 **새 이음새**(`부수차임막힘`)를 쓰기 시작하자, 이 스텁에
// 그 이름이 없어 호출이 `undefined()` 로 죽었고 라우트가 **500** 을 냈다. 차임과 아무 상관
// 없는 「덕킹 SSE」 시험 셋이 한꺼번에 빨간불이 됐다 — 원인을 찾는 데만 한참 걸린다.
//
// 목록을 손으로 적는 스텁은 **모듈이 자랄 때마다 조용히 낡는다.** 진짜를 펼쳐 놓고
// 바꿀 것만 덮으면 그 일이 안 생긴다. 여기서 가짜여야 하는 것은 **실제로 소리를 내는
// `playChime` 하나**다(`resolveChimeVolume` 은 DB 를 읽는 순수 계산이라 덮어 둔다).
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
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

// promise의 .finally 마이크로태스크가 돌 시간을 준다
const tick = () => new Promise(r => setImmediate(r))
const speaks = () => sent.filter(s => s.type === 'tts_speak').map(s => s.payload.state)

test.beforeEach(() => { sent.length = 0; plays.length = 0 })

// ── 사실 1: 시작에 start, 재생이 끝나면 end ─────────────────────────────────────
test('방송이 나가면 start, 재생이 끝나면 end가 SSE로 나간다', async () => {
  const r = await post({ text: '어르신 여러분, 잠시 후 점심 식사가 준비됩니다.' })
  assert.equal(r.status, 200)
  assert.deepEqual(speaks(), ['start'],
    'start가 안 나갔다 — BGM을 틀고 있는 창이 볼륨을 낮출 시점을 모른다(td09 H6)')

  plays[0].resolve()   // 서버 스피커 재생 완료
  await tick()
  assert.deepEqual(speaks(), ['start', 'end'],
    'end가 안 나갔다 — 덕킹이 영영 안 풀려 BGM이 계속 작게 나온다')
})

// ── 사실 2: 재생이 실패해도 end는 나간다 ────────────────────────────────────────
test('재생이 실패해도 end가 나간다 — 덕킹을 되돌릴 다른 길이 없다', async () => {
  await post({ text: '어르신 여러분, 곧 프로그램을 시작하겠습니다.' })
  plays[0].reject(new Error('장치 열기 실패'))
  await tick()
  assert.deepEqual(speaks(), ['start', 'end'])
})

// ── 사실 3: 비상방송 교체 시 옛 방송의 end는 침묵한다 ──────────────────────────
test('비상방송이 교체하면 옛 방송의 end는 침묵한다 — 비상방송 중에 덕킹이 풀리면 안 된다', async () => {
  await post({ text: '어르신 여러분, 잠시 안내 말씀 드립니다.' })          // 방송 A
  await post({ text: '화재가 발생했습니다. 안내에 따라 대피해주세요.', priority: true })  // 비상 B

  // 실제 순서 그대로: 비상 enqueue가 현재 재생을 죽이고, A의 promise가 그 **뒤에** 정착한다
  plays[0].reject(new Error('비상 방송으로 인해 중단됨'))
  await tick()
  assert.deepEqual(speaks(), ['start', 'start'],
    '옛 방송(A)의 end가 나갔다 — 비상방송(B)이 나가는 중에 BGM 덕킹이 풀린다')

  plays[1].resolve()   // 비상방송 재생 완료
  await tick()
  assert.deepEqual(speaks(), ['start', 'start', 'end'],
    '비상방송이 끝났는데 end가 없다 — 덕킹이 안 풀린다')
})
