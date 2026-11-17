// 대시보드 "기능 활성화" 토글 중 수동 조작을 막는 스위치(TTS/AI/마이크)가 실제로
// 해당 동작을 차단하는지 검증.
//
// 핵심 안전 조건 2가지:
//  1) 자동방송(아침 방송 등)은 /api/tts/broadcast를 거치지 않고 services/tts를 직접 쓰므로
//     "TTS 방송"을 꺼도 자동방송은 그대로 나가야 한다 — 이 토글은 "수동 TTS 방송" 차단용이다.
//  2) 비상방송(화재/실종/응급)은 priority=true로 이 라우트를 쓰는데, 토글이 꺼져 있어도
//     절대 막히면 안 된다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_gates_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 소리 경계 스텁 — 라우트를 require하기 **전에** 걸어야 한다(flow-integration.test.js와 같은 기법).
// 이 파일의 통과 케이스(/api/tts/broadcast, /api/mic/chime)는 실제 재생 경로를 그대로 탄다:
// generateTTS(옛 인터넷 합성 엔진 파이썬·네트워크) → playChime(파이썬 차임) → enqueue(파이썬 WaveOut).
// 스텁이 없으면 (1) 전체 테스트를 돌릴 때마다 이 PC 스피커로 "화재 경보! 즉시 대피해
// 주십시오."가 실제로 울리고 (2) 재생 자식 프로세스가 이벤트 루프를 붙잡아 이 파일만
// 전체 실행에서 영영 안 끝난다(단독 실행은 통과해서 원인 찾기가 어려웠다).
const stubModule = (rel, patch) => {
  const p = require.resolve(rel)
  const real = require(rel)
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { ...real, ...patch } }
}
const fakeTTSFile = async () => {
  const p = path.join(os.tmpdir(), `carecast_fake_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
  fs.writeFileSync(p, Buffer.from('fake-mp3'))
  return p
}
// audioPlayer만은 stubModule을 쓰면 안 된다 — 그 함수는 `const real = require(rel)`로 실제
// 모듈을 먼저 로드하는데, audioPlayer.js는 **로드 자체가 부작용**이다(파일 끝의
// `if (IS_WINDOWS) setTimeout(() => { startPlayer() }, 2000)`). 2초 뒤 상주형 파이썬
// carecast_player.py가 떠서 이벤트 루프를 영원히 붙잡고, 이 파일이 안 끝난다.
// routes/mic.js:7이 audioPlayer를 직접 require하므로 라우트보다 먼저 캐시를 채워
// **실제 모듈이 한 번도 로드되지 않게** 한다.
//
// 2026-08-29(7881a3d)에 같은 행을 고치면서 이 경계만 빠졌다. 그때 통과한 건 이 PC에서
// Python 경로를 못 찾아 startPlayer()가 그냥 빠져나갔기 때문이고, 옛 인터넷 합성 엔진가 설치되면서
// Python이 잡히자 행이 되돌아왔다. `.unref()`로는 못 막는다 — startTestApp()이 HTTP 서버를
// 띄워 2초 뒤에도 루프가 살아 있어서 unref된 타이머도 그대로 발화한다.
const audioPlayerPath = require.resolve('../services/audioPlayer')
require.cache[audioPlayerPath] = {
  id: audioPlayerPath, filename: audioPlayerPath, loaded: true,
  exports: { playChunk: () => {} },
}

stubModule('../services/chimePlayer', { playChime: () => {} })
stubModule('../services/audioQueue', { enqueue: () => Promise.resolve() })
stubModule('../services/tts', { generateTTS: fakeTTSFile, generateTTSWithRetry: fakeTTSFile })

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const { isFeatureEnabled } = require('../services/features')
const aiRoutes = require('../routes/ai')
const micRoutes = require('../routes/mic')
const ttsRoutes = require('../routes/tts')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/ai': aiRoutes, '/api/mic': micRoutes, '/api/tts': ttsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function setToggles(obj) {
  getDB().prepare(
    "INSERT INTO settings (key, value) VALUES ('feature_toggles', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(obj))
}

async function post(p, body) {
  const r = await fetch(app.baseUrl + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

test('isFeatureEnabled: 설정이 없거나 깨져 있으면 기본값 켜짐(기능이 조용히 막히지 않게)', () => {
  getDB().prepare("DELETE FROM settings WHERE key='feature_toggles'").run()
  assert.equal(isFeatureEnabled('tts'), true)

  getDB().prepare("INSERT INTO settings (key, value) VALUES ('feature_toggles','{{깨진json') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  assert.equal(isFeatureEnabled('mic'), true)
})

test('"AI 방송 도우미" OFF → /api/ai/generate가 403으로 차단된다', async () => {
  setToggles({ ai: false })
  const res = await post('/api/ai/generate', { keyword: '점심 안내' })
  assert.equal(res.status, 403)
  assert.equal(res.body.disabledFeature, 'ai')

  setToggles({ ai: true })
  const on = await post('/api/ai/generate', { keyword: '점심 안내' })
  assert.notEqual(on.status, 403, '켜면 더 이상 403이 아니어야 한다(API 키 미설정 등 다른 오류는 무관)')
})

test('"실시간 마이크" OFF → /api/mic/stream이 403으로 차단된다', async () => {
  setToggles({ mic: false })
  const r = await fetch(app.baseUrl + '/api/mic/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from([1, 2, 3, 4]),
  })
  assert.equal(r.status, 403)
  const body = await r.json()
  assert.equal(body.disabledFeature, 'mic')
})

test('"실시간 마이크" OFF여도 차임벨(/api/mic/chime)은 막히지 않는다(별개 기능)', async () => {
  setToggles({ mic: false })
  const res = await post('/api/mic/chime')
  assert.notEqual(res.status, 403, '차임벨은 마이크 기능이 아니므로 마이크 토글과 무관해야 한다')
})

test('"TTS 방송" OFF → 수동 TTS 방송(/api/tts/broadcast)이 403으로 차단된다', async () => {
  setToggles({ tts: false })
  const res = await post('/api/tts/broadcast', { text: '점심 식사 안내입니다.' })
  assert.equal(res.status, 403)
  assert.equal(res.body.disabledFeature, 'tts')
})

test('[안전] "TTS 방송"이 꺼져 있어도 비상방송(priority=true)은 절대 막히지 않는다', async () => {
  setToggles({ tts: false })
  const res = await post('/api/tts/broadcast', { text: '화재 경보! 즉시 대피해 주십시오.', priority: true, user: '비상방송' })
  assert.notEqual(res.status, 403, '안전 스위치가 비상방송을 막으면 안 된다')
})

test('"TTS 방송" ON이면 수동 TTS 방송이 차단되지 않는다', async () => {
  setToggles({ tts: true })
  const res = await post('/api/tts/broadcast', { text: '안내 말씀 드립니다.' })
  assert.notEqual(res.status, 403)
})
