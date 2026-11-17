// 「정지」는 이미 나가고 있는 소리까지 끈다.
//
// 무슨 일이 있었나(2026-08-31 사용자 신고): 방송 중 정지를 눌러도 **안내 음성이 끝까지
// 나왔다.** 빨간 "방송 중" 표시만 사라져서, 사람 눈에는 멈춘 것처럼 보이는데 홀에서는
// 계속 말하고 있었다. 그 뒤 다시 방송을 틀면 두 목소리가 겹쳤다.
//
// 원인: POST /api/morning/stop → stopCurrentBroadcast()는 **취소 표시만** 세웠다.
// 안내 음성은 서버 PC 스피커로 나가는데(audioQueue가 자식 프로세스로 재생), 그 자식을
// 죽이는 함수(audioQueue.stopAll)는 **서버 종료 때만** 불리고 정지 버튼은 한 번도 안 불렀다.
//
// 요양원에서 잘못 나간 방송을 멈출 수 없다는 것은 그냥 둘 수 없는 종류의 결함이다.
// 여기서 고정하는 것: 정지도, 새 방송 시작도, **소리를 실제로 끊는다.**
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stop_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH     = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

// 소리 경계는 mock한다(CLAUDE.md 7) — 실제 스피커를 울릴 수는 없으니 "끊으라고 시켰는가"를 본다.
const queuePath = require.resolve('../services/audioQueue')
const stopCalls = []
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true,
  exports: {
    enqueue: () => Promise.resolve(),
    mciVolume: () => {},
    stopAll: (reason) => { stopCalls.push(reason); return { cancelled: 0, killed: true } },
    DEFAULT_PLAY_TIMEOUT_MS: 1000,
    _test: { activeCount: () => 0, queueLength: () => 0 },
  },
}

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true,
  exports: { broadcastSSE: () => {}, addClient: () => {}, clientCount: () => 0 },
}

const gate = require('../services/broadcastGate')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

test('정지 버튼은 나가고 있는 소리를 끊는다 — 취소 표시만 세우면 안 된다', () => {
  stopCalls.length = 0
  gate.stopCurrentBroadcast()
  assert.equal(stopCalls.length, 1,
    '정지를 눌러도 스피커로 나가던 안내가 끝까지 나간다 — 사람이 멈출 방법이 없다')
})

test('새 방송이 시작하면 앞 소리를 정리한다 — 두 목소리가 겹치면 안 된다', () => {
  // broadcastGate의 주석이 이미 이렇게 적고 있다: "자동방송 시작 = 이전 소리 정리. 시각이 왕이다."
  // 의도는 있었는데 소리를 끊는 배선이 빠져 있었다.
  stopCalls.length = 0
  gate.newBroadcastToken()
  assert.equal(stopCalls.length, 1, '앞 방송 소리가 살아 있는 채로 새 방송이 얹힌다')
})

test('정지와 새 방송 시작은 사유를 구별해 남긴다 — 로그에서 원인을 갈라 볼 수 있어야 한다', () => {
  stopCalls.length = 0
  gate.stopCurrentBroadcast()
  gate.newBroadcastToken()
  assert.equal(stopCalls.length, 2)
  assert.notEqual(stopCalls[0], stopCalls[1], '두 경우가 같은 문구면 로그로 구별할 수 없다')
})

test('취소 토큰은 그대로 동작한다 — 소리를 끊는다고 기존 취소 규칙이 바뀌면 안 된다', () => {
  const tok = gate.newBroadcastToken()
  assert.equal(gate.isCancelled(tok), false, '방금 받은 토큰은 살아 있어야 한다')
  gate.stopCurrentBroadcast()
  assert.equal(gate.isCancelled(tok), true, '정지 후에는 그 토큰이 취소로 보여야 한다')
})
