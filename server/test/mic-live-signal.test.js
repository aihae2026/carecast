// 마이크 생방송 신호등 — 방송자가 아닌 화면에도 "방송 중"이 보인다 (2026-09-03 실기 신고).
//
// 즉시 방송의 "● 방송 중" 표시는 방송자 브라우저의 지역 상태였다 — 폰으로 방송하면
// 홀에서는 소리가 나는데 PC 화면은 아무 표시가 없었다. 서버는 청크를 받는 유일한
// 자리(/api/mic/stream)이므로 서버가 신호등을 켠다:
//   첫 청크 → mic_live {on:true} SSE 한 번, 청크가 끊기고 HOLD_MS 지나면 {on:false} 한 번.
//
// 고정하는 사실:
//  1. 첫 청크에 켜짐 신호가 정확히 한 번 나간다 (청크마다 반복하면 SSE가 홍수가 된다)
//  2. 청크가 끊기면 신호등이 꺼진다
//  3. 스트림 라우트가 신호등을 부른다 · 화면 배선(허브 중계·카드 표시)이 있다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// SSE 스텁 — micLive가 require하기 전에 선점
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const micLive = require('../services/micLive')

test('첫 청크에 켜짐 신호가 한 번만 나간다', () => {
  sent.length = 0
  micLive.chunkArrived(60)
  micLive.chunkArrived(60)
  micLive.chunkArrived(60)
  const ons = sent.filter(e => e.type === 'mic_live' && e.payload.on === true)
  assert.equal(ons.length, 1,
    `켜짐 신호가 ${ons.length}번 나갔다 — 청크는 초당 수십 개라 매번 쏘면 SSE가 홍수가 된다`)
  assert.equal(micLive.isLive(), true)
})

test('청크가 끊기면 꺼짐 신호가 나간다', async () => {
  await new Promise(r => setTimeout(r, 150))   // 위 테스트의 60ms 창이 지나가길 기다린다
  const offs = sent.filter(e => e.type === 'mic_live' && e.payload.on === false)
  assert.equal(offs.length, 1,
    '꺼짐 신호가 안 나갔다 — 방송이 끝나도 모든 화면에 "방송 중"이 남는다')
  assert.equal(micLive.isLive(), false)
})

test('스트림 라우트가 신호등을 부르고, 화면 배선이 있다', () => {
  // 청크가 오는 길은 **둘**이다 — WS(/ws/audio, 폰의 1차 경로)와 HTTP 폴백(/api/mic/stream).
  // 처음에 HTTP에만 달았다가 폰(WS) 방송에서 신호등이 안 켜지는 반쪽이 될 뻔했다.
  assert.match(read('server/routes/mic.js'), /micLive|chunkArrived/,
    '/api/mic/stream이 신호등을 안 부른다 — HTTP 폴백 방송을 아무 화면도 모른다')
  assert.match(read('server/index.js'), /chunkArrived/,
    'WS(/ws/audio) 경로가 신호등을 안 부른다 — 폰 마이크 방송(1차 경로)을 아무 화면도 모른다')
  assert.match(read('src/hooks/useScheduledBroadcast.js'), /mic_live/,
    'SSE 허브가 mic_live를 중계하지 않는다 — 신호가 브라우저에서 버려진다')
  const card = read('src/components/easy/InstantBroadcast.jsx')
  assert.match(card, /carecast:mic-live/,
    '즉시 방송 카드가 신호를 안 듣는다')
  assert.match(card, /다른 기기에서/,
    '다른 기기의 방송을 표시하는 문구가 없다 — 폰으로 방송하면 PC는 여전히 모른다')
})
