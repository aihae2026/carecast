// CC-033 본안 — TTS 대기를 "글자수 추정"에서 "실제 종료 감지"로.
//
// 지금까지는 글자 수를 배속으로 나눈 추정 시간만큼 기다렸다. 추정은 문장 부호가 많거나
// 숫자를 길게 읽는 문장("2026년 8월 31일 오전 열한 시")에서 어긋난다 — 짧게 잡히면 다음
// 단계가 아직 말하는 목소리 위로 겹치고, 길게 잡히면 방송 사이가 뜬다.
//
// 화면은 이미 음원(prayer_play)에서 토큰을 돌려주는 길을 갖고 있다(POST /api/morning/audio-ended).
// TTS도 같은 길을 쓰게 한다. **추정은 버리지 않고 상한(안전망)으로 남긴다** — 현장에 재생
// 창이 없거나 자동재생이 막히면 아무도 신호를 안 보내는데, 그때 영영 멈추면 그날 방송이 통째로 죽는다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttsend_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

// TTS 합성은 타지 않는다 — 이 테스트가 보는 것은 대기 방식이지 음성이 아니다
const fakeTTS = async () => {
  const f = path.join(os.tmpdir(), `carecast_ttsend_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`)
  fs.writeFileSync(f, 'x')
  return f
}
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    // 시퀀서가 실제로 부르는 것은 generateTTSWithRetry다 — 이쪽을 안 막으면 진짜 합성이 돈다
    generateTTS: fakeTTS, generateTTSWithRetry: fakeTTS,
  },
}

const { initDB } = require('../db/schema')
const sequencer = require('../services/broadcastSequencer')
const seq = { ...sequencer, ...sequencer.__test__ }
const { notifyAudioEnded, newBroadcastToken } = require('../services/broadcastGate')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const lastTTS = () => [...sent].reverse().find(e => e.type === 'scheduled_broadcast')

test('TTS 방송 신호에 재생 토큰이 실린다 — 화면이 끝을 알려줄 주소', async () => {
  sent.length = 0
  const tok = newBroadcastToken()
  const p = seq.stepTTS(require('../db/schema').getDB(), '안녕하세요.', '테스트', tok)
  // 신호는 합성 직후 나간다 — 대기가 끝나기 전에 이미 관찰할 수 있다
  await new Promise(r => setTimeout(r, 60))
  const ev = lastTTS()
  assert.ok(ev, 'scheduled_broadcast 신호가 안 나갔다')
  assert.ok(ev.payload.token, '토큰이 없으면 화면이 끝을 알려줄 방법이 없다')
  notifyAudioEnded(ev.payload.token)
  await p
})

test('화면이 끝을 알리면 추정 시간을 안 기다리고 바로 다음 단계로 간다', async () => {
  sent.length = 0
  const tok = newBroadcastToken()
  const text = '가'.repeat(300)   // 추정으로는 60초가 넘는 문장
  const started = Date.now()
  const p = seq.stepTTS(require('../db/schema').getDB(), text, '테스트', tok)
  await new Promise(r => setTimeout(r, 60))
  notifyAudioEnded(lastTTS().payload.token)
  await p
  const elapsed = Date.now() - started
  assert.ok(elapsed < 3000, `실제 종료를 안 기다렸다 — ${elapsed}ms 걸렸다(추정이었으면 60초+)`)
})

test('식사 안내 TTS도 같은 길을 쓴다', async () => {
  sent.length = 0
  const tok = newBroadcastToken()
  const p = seq.stepPrayerTTS(require('../db/schema').getDB(), '가'.repeat(300), '식사 안내', tok)
  await new Promise(r => setTimeout(r, 60))
  const ev = lastTTS()
  assert.ok(ev.payload.token, '식사 안내 TTS만 옛 방식이면 식사 방송에서 다시 겹친다')
  const started = Date.now()
  notifyAudioEnded(ev.payload.token)
  await p
  assert.ok(Date.now() - started < 3000)
})

test('[안전망] 아무도 끝을 안 알리면 추정 시간에 스스로 넘어간다', async () => {
  // 화면이 없거나 자동재생이 막힌 경우. 영영 멈추면 그날 방송이 통째로 죽는다.
  {
    sent.length = 0
    const tok = newBroadcastToken()
    const started = Date.now()
    await seq.stepTTS(require('../db/schema').getDB(), '짧게.', '테스트', tok)
    const elapsed = Date.now() - started
    const estimate = seq.ttsWaitMs('짧게.'.length, 0.9)
    assert.ok(elapsed >= estimate - 500, `추정보다 빨리 끝났다 (${elapsed}ms)`)
    assert.ok(elapsed < estimate * 2, `상한을 넘겼다 (${elapsed}ms) — 상한은 추정 그대로여야 한다`)
  }
})

test('[안전망] 상한은 예전 추정값 그대로다 — 늘리면 화면 없는 PC에서 방송이 늘어진다', () => {
  const waitMs = seq.ttsWaitMs(10, 0.9)
  assert.ok(waitMs >= 6000, '하한이 사라지면 화면이 재생을 시작할 틈이 없다')
  assert.equal(waitMs, Math.max(6000, Math.ceil(10 / (4.5 * (0.9 / 0.9))) * 1000 + 3000),
    '추정식을 바꾸면 상한도 같이 움직인다 — 이 변경은 상한을 건드리지 않는 것이 전제다')
})

test('[회귀] 추정식 자체는 그대로다 — 배속에 비례한다', () => {
  const slow = seq.ttsWaitMs(100, 0.5)
  const fast = seq.ttsWaitMs(100, 1.5)
  assert.ok(slow > fast, '배속을 낮추면 더 오래 기다려야 한다')
  assert.equal(seq.ttsWaitMs(100, 0), seq.ttsWaitMs(100, 0.9), '0배속은 기본 배속으로 떨어진다')
})
