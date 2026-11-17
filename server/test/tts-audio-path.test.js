// 고도화 리스트에서 승인된 "TTS·오디오 실행 경로 자동 테스트" — 그동안 사람이 직접 들어야만
// 확인되던 영역(텍스트 → 실제 재생 가능한 오디오 파일 생성)을 자동 회귀로 커버한다.
// 목소리가 "잘 들리는지"는 여전히 사람 몫이지만, "파이프라인이 안 깨졌는지"(실제로 재생 가능한
// 바이트가 나오는지, 저장소 왕복이 맞는지, HTTP로 스트리밍되는지)는 여기서 자동으로 잡는다.
//
// 2026-09-21: 기본 엔진이 Supertonic 3(이 PC 안 합성)로 바뀌었다. **진짜 모델로** 합성하는 통합 시험이다 —
// 모델이 없는 PC(`npm run setup:tts` 전)에서는 이유를 밝히고 건너뛴다. 예전 판은 엔진이 빠진 시험 안에서
// 운영 캐시의 옛 mp3 를 「지난 성공본」으로 집어 **합성을 안 하고도** 통과했다(8ms) — 그래서 캐시는 임시 폴더를 쓴다.
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttspath_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
// 이 파일만 진짜 엔진을 켠다(다른 시험은 엔진이 스스로 빠진다 — 각 엔진 머리말).
process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
// 미리듣기 라우트도 **임시 캐시**를 쓰게 한다 — 운영 캐시를 쓰면 다음 실행이 합성 없이 통과한다(Codex ④-d 1회차).
const 캐시 = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cc-ttspath-'))
process.env.CARECAST_TTS_CACHE_DIR = 캐시

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { generateTTSWithRetry, deleteTmpFile, 엔진차례 } = require('../services/tts')
const supertonic = require('../services/ttsEngines/supertonic')
const { storeAudio, consumeAudio } = require('../services/audioStore')
const { startTestApp } = require('./helpers/testApp')
const ttsRoutes = require('../routes/tts')

const 모델있음 = supertonic.available()
const 건너뜀 = 모델있음 ? false : `안내 음성 모델이 없다 — npm run setup:tts (${supertonic.unavailableReason()})`
let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/tts': ttsRoutes })
})

test.after(async () => {
  await app.close()
  supertonic.__resetForTests()   // 띄운 합성 프로세스를 거둔다
  delete process.env.CARECAST_TTS_ENGINE_IN_TESTS
  delete process.env.CARECAST_TTS_CACHE_DIR
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
  try { fs.rmSync(캐시, { recursive: true, force: true }) } catch { /* 무시 */ }
})

function WAV인가(buf) {
  return buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE'
}

test('generateTTSWithRetry: 진짜 모델로 재생 가능한 WAV 를 만든다', { skip: 건너뜀 }, async () => {
  assert.equal(엔진차례()[0], 'supertonic')
  const filePath = await generateTTSWithRetry({ text: '테스트 방송입니다.', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }, 1, { cacheDir: 캐시, noCache: true })
  try {
    assert.match(filePath, /\.wav$/)
    const buf = fs.readFileSync(filePath)
    assert.ok(WAV인가(buf), 'WAV 머리가 아니다')
    assert.equal(buf.readUInt16LE(34), 16, '16비트가 아니다')
    assert.equal(buf.readUInt32LE(24), 44100, '44100Hz 가 아니다')
    assert.ok(buf.length > 44100, `소리가 너무 짧다(${buf.length}바이트)`)
  } finally {
    deleteTmpFile(filePath)
  }
})

test('storeAudio/consumeAudio: 저장 후 1회 소비하면 같은 경로를 돌려주고, 두 번째 소비는 null이다', { skip: 건너뜀 }, async () => {
  const filePath = await generateTTSWithRetry({ text: '저장소 왕복 테스트입니다.', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }, 1, { cacheDir: 캐시, noCache: true })
  try {
    const id = storeAudio(filePath)
    assert.equal(typeof id, 'string')
    const consumed = consumeAudio(id)
    assert.equal(consumed, filePath, '소비 시 저장했던 경로 그대로 돌아와야 한다')
    assert.equal(consumeAudio(id), null, '한 번 소비된 id는 다시 꺼낼 수 없어야 한다(1회 소비)')
  } finally {
    deleteTmpFile(filePath)
  }
})

test('POST /api/tts/preview: 실제 오디오 바이트를 audio/wav 로 스트리밍한다', { skip: 건너뜀 }, async () => {
  const res = await fetch(app.baseUrl + '/api/tts/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '미리듣기 경로 테스트입니다.' }),
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /audio\/wav/)
  const buf = Buffer.from(await res.arrayBuffer())
  assert.ok(WAV인가(buf) && buf.length > 44100, `응답이 WAV 가 아니거나 너무 짧다(${buf.length}바이트)`)
})

test('POST /api/tts/preview: 빈 텍스트는 400과 에러 메시지를 반환한다(합성 안 함)', async () => {
  const res = await fetch(app.baseUrl + '/api/tts/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(typeof body.error, 'string')
})
