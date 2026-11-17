// 정지 버튼이 마이크 생방송도 끊는다 (td09 H10, 사용자 결정 2026-09-02).
//
// 마이크 실시간 방송의 실소리는 서버 스피커(audioPlayer.playChunk — audioQueue 밖)라
// 어떤 정지 경로에도 안 잡혔다. 사용자 결정: 현장 「정지」는 다른 직원의 생방송 말도
// 그 자리에서 끊고, 말하던 사람 화면에는 왜 끊겼는지 안내가 뜬다.
//
// 배선: 사람 정지(stopCurrentBroadcast)가 ① 서버 스피커의 마이크 재생을 내리고
// ② broadcast_stopped SSE를 쏜다(원래 쏘던 것). 방송자 화면(InstantBroadcast)은
// 그 SSE의 stop-broadcast 변환을 듣고 스스로 마이크를 내리며 안내를 띄운다 —
// 새 신호 없이 "정지는 하나의 길" 원칙 그대로다.
//
// 고정하는 사실 넷:
//  1. 사람 정지가 마이크 재생 중단(stopIfStreaming)을 부른다
//  2. 자동방송의 밀어냄(cancelCurrentBroadcast)은 마이크를 안 끊는다 — 결정은 '정지 버튼'에
//     한정이다. 정시 방송이 시작됐다고 직원의 생방송 말이 끊기면 안 된다
//  3. audioPlayer가 "지금 스트리밍 중인가"를 청크 시각으로 판정한다(오래된 스트림은 안 건드림)
//  4. 방송자 화면이 정지 신호를 듣고 스스로 내리며, 왜 끊겼는지 안내한다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// ── 스텁 (broadcastGate가 require하기 전에) ──────────────────────────────────
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}
const micStops = []
const playerPath = require.resolve('../services/audioPlayer')
require.cache[playerPath] = {
  id: playerPath, filename: playerPath, loaded: true, exports: {
    playChunk: () => {},
    stop: () => true,
    stopIfStreaming: (reason) => { micStops.push(reason || ''); return true },
  },
}
// broadcastGate → audioQueue(silenceNow) — 스피커를 안 울리게
const queuePath = require.resolve('../services/audioQueue')
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true, exports: {
    enqueue: () => Promise.resolve(), mciVolume: () => 500,
    stopAll: () => ({ cancelled: 0, killed: false }),
  },
}

const gate = require('../services/broadcastGate')

// ── 사실 1: 사람 정지 → 마이크 재생 중단 ──────────────────────────────────────
test('사람이 정지를 누르면 마이크 생방송 재생이 끊긴다', () => {
  micStops.length = 0; sent.length = 0
  gate.stopCurrentBroadcast()
  assert.equal(micStops.length, 1,
    '정지가 마이크 재생(stopIfStreaming)을 안 부른다 — 직원이 말을 멈춰야만 소리가 멎는다(td09 H10)')
  assert.ok(sent.find(e => e.type === 'broadcast_stopped'),
    'broadcast_stopped가 안 나갔다 — 방송자 화면이 정지된 줄 모르고 계속 송출한다')
})

// ── 사실 2: 자동방송의 밀어냄은 마이크를 안 끊는다 ────────────────────────────
test('자동방송이 시작돼도(밀어냄) 마이크 생방송은 안 끊긴다 — 결정은 정지 버튼에 한정이다', () => {
  micStops.length = 0
  gate.cancelCurrentBroadcast('새 방송이 시작되어 앞 소리를 정리합니다')
  gate.newBroadcastToken()
  assert.equal(micStops.length, 0,
    '자동방송 시작이 직원의 생방송 말을 끊는다 — 사용자가 정한 범위(정지 버튼)를 넘었다')
})

// ── 사실 3: 스트리밍 판정은 청크 시각으로 ─────────────────────────────────────
test('audioPlayer가 최근 청크 시각으로 생방송 여부를 판정한다', () => {
  const src = read('server/services/audioPlayer.js')
  assert.match(src, /_lastChunkAt = Date\.now\(\)/,
    'playChunk가 청크 시각을 안 남긴다 — 무엇이 생방송인지 알 길이 없다')
  assert.match(src, /function stopIfStreaming/, 'stopIfStreaming이 없다')
  assert.match(src, /10000|10_000/,
    '최근 청크 판정 창(10초)이 없다 — 몇 시간 전에 끝난 스트림 때문에 상주 플레이어를 내린다')
})

// ── 사실 4: 방송자 화면이 스스로 내리고 안내한다 ──────────────────────────────
test('방송자 화면(InstantBroadcast)이 정지 신호를 듣고 마이크를 내리며 안내를 띄운다', () => {
  const src = read('src/components/easy/InstantBroadcast.jsx')
  assert.match(src, /addEventListener\('carecast:stop-broadcast'/,
    'InstantBroadcast가 정지 신호를 안 듣는다 — 홀은 조용한데 직원은 계속 말한다')
  assert.match(src, /removeEventListener\('carecast:stop-broadcast'/, '구독을 안 거둔다')
  assert.match(src, /정지.*방송이 중단/,
    '왜 끊겼는지 안내가 없다 — 조용히 끊기면 말하던 사람은 장비 고장으로 안다')
})

// ── 사실 5: 안내를 지우는 타이머가 다른 상태를 밟지 않고, 창을 떠나면 걷힌다 ────
// (레드 검증 화면 발견4, 2026-09-03에 고침) 강제정지 안내의 "5초 뒤 idle" 타이머가
// 무조건 setState('idle')이었다 — 안내가 떠 있는 5초 안에 새 방송을 시작하면 낡은
// 타이머가 방송 중 화면을 idle로 뒤집는다(시작 버튼이 다시 떠서 이중 송출 유도).
// 마이크 권한 오류의 3초 타이머도 같은 모양이었다.
test('안내 되돌림 타이머는 error일 때만 idle로 내리고, 언마운트에서 걷힌다', () => {
  const src = read('src/components/easy/InstantBroadcast.jsx')
  assert.ok(!src.includes("setTimeout(() => setState('idle')"),
    '타이머가 상태를 무조건 idle로 되돌린다 — 안내 중 새 방송을 시작하면 방송 중 화면이 뒤집힌다')
  assert.match(src, /s === 'error' \? 'idle' : s/,
    '되돌림에 상태 가드가 없다 — error에서만 idle로 내려야 다른 상태를 안 밟는다')
  assert.match(src, /clearTimeout\(/,
    '타이머를 걷는 곳이 없다 — 창을 떠나거나 새 안내가 뜰 때 앞 타이머가 살아남는다')
})
