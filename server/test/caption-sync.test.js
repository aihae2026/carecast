// 자막 시계 보정 — 어림값을 실측으로 바꿔 다는 신호 (2026-09-05).
//
// 소리를 안 내는 창(원격 PC·직원 휴대폰)은 재생 위치를 알 방법이 없어 "신호 받은 시각 +
// 어림값"으로 도는 추정 시계를 쓴다. 그 어림값이 틀린 만큼 자막이 통째로 밀리는데, 실측해
// 보니 0.36초 늦게 가고 있었다(같은 날 fix). 어림값을 더 나은 어림값으로 바꾼 것이 그 fix고,
// 여기서는 **어림을 아예 안 하게** 만든다.
//
// 재료는 이미 있었다 — 소리를 내는 창이 "진짜로 소리가 시작됐다"를 서버에 보고하고 있었고
// (routes/morning.js의 play-started), 서버는 그걸 도스창에 한 줄 찍고 버렸다. 그대로 되쏘면
// 원격 창이 실측값으로 시계를 다시 건다.
//
// 여기서 잠그는 것 셋:
//  1. 보고가 오면 되쏜다 — 그게 없으면 원격 창은 영영 어림값으로 돈다
//  2. **audioId가 없으면 안 쏜다.** 어느 방송의 보고인지 못 가리면, 방송이 잇달아 나갈 때
//     옛 신호가 새 자막 시계를 흔들어 지금보다 나빠진다
//  3. 보고가 깨졌으면(숫자가 아니면) 아무것도 안 쏜다 — 틀린 보정은 안 하느니만 못하다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_capsync_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── SSE를 가로챈다 (routes/morning require 전에 심어야 한다) ──
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

// TTS는 파이썬을 띄운다 — 이 검사에서는 소리를 만들 일이 없다
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    generateTTSWithRetry: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    generateTTS: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    deleteTmpFile: () => {},
  },
}

const { initDB } = require('../db/schema')
const router = require('../routes/morning')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

function call(handler, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b }) },
    }
    handler({ body, query: {}, params: {} }, res)
  })
}

test.before(() => { initDB() })
test.after(() => { try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ } })

test('재생 시작 보고가 오면 실측값을 되쏜다', async () => {
  sent.length = 0
  const { status } = await call(findRoute('post', '/play-started'),
    { label: '예약 방송', kind: '예약', audioId: 'abc123', sinceEventMs: 540 })
  assert.equal(status, 200)
  const sync = sent.find(s => s.type === 'caption_sync')
  assert.ok(sync, '보정 신호를 안 쏜다 — 원격 창은 영영 어림값으로 돈다')
  assert.equal(sync.payload.audioId, 'abc123')
  assert.equal(sync.payload.sinceEventMs, 540)
})

test('audioId가 없으면 안 쏜다 — 어느 방송의 보고인지 못 가리면 나빠진다', async () => {
  sent.length = 0
  await call(findRoute('post', '/play-started'), { label: '예약 방송', sinceEventMs: 540 })
  assert.equal(sent.filter(s => s.type === 'caption_sync').length, 0)
})

test('보고가 숫자가 아니면 안 쏜다 — 틀린 보정은 안 하느니만 못하다', async () => {
  sent.length = 0
  await call(findRoute('post', '/play-started'), { audioId: 'abc123', sinceEventMs: '몰라' })
  assert.equal(sent.filter(s => s.type === 'caption_sync').length, 0)
})

test('[구조] 자막 층이 이 신호를 듣고, 소리 내는 창에서는 무시한다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'broadcast', 'BroadcastCaption.jsx'), 'utf8')
  assert.match(src, /carecast:caption-resync/, '자막 층이 보정 신호를 안 듣는다')
  assert.match(src, /if \(embedded \|\| audioRef\.current\) return/,
    '소리 내는 창이 이 신호로 시계를 고치면 안 된다 — 거기는 실제 재생 위치를 읽고 있다')
  assert.match(src, /String\(id\) !== String\(c\.audioId\)/,
    'audioId를 안 맞춰 보면 옛 보고가 새 자막을 흔든다')
})
