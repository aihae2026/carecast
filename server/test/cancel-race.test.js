// "재생을 지시한 직후 ~ 대기를 등록하기 직전" 틈에 들어온 취소를 놓치지 않는지.
//
// 이 틈은 아주 짧지만 실재한다. broadcastSSE로 곡을 띄운 뒤 waitForAudioEnd가 resolver를
// 등록하기 전에 자동방송이 시작되면(cancelCurrentBroadcast), 그 순간 끊을 대상이 아직
// 없어서 아무것도 취소되지 않는다. 흐름은 그 뒤에 등록하고 상한(180초)까지 기다리다가
// 새 방송 위로 다음 곡을 쏜다. 현장에서는 "점심 방송이 나가는데 동요가 계속 겹쳐 나온다"로
// 보인다. 부하가 걸리면 틈이 벌어져서 전체 테스트에서만 간헐적으로 재현됐다.
//
// 해결: 취소가 몇 번 있었는지 세는 세대(generation)를 두고, 등록 시점에 대조한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_cancelrace_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 실제 소리가 나지 않도록 SSE를 스텁한다(broadcastSequencer require 전에)
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: () => {}, addClient: () => {}, clientCount: () => 0,
  },
}

const { initDB } = require('../db/schema')
const seq = require('../services/broadcastSequencer')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('대기를 등록하기 전에 들어온 취소를 놓치지 않는다', async () => {
  const gen = seq.cancelGeneration()      // 재생을 지시하기 직전에 읽어 둔 값
  seq.cancelCurrentBroadcast()            // 등록 전에 자동방송이 시작됨

  const started = Date.now()
  const reason = await seq.waitForAudioEnd('없는-토큰', 3000, gen)

  assert.equal(reason, 'cancelled',
    '등록 전 취소를 놓치면 상한까지 기다리다가 새 방송 위로 다음 곡이 나간다')
  assert.ok(Date.now() - started < 1000,
    `곧바로 답해야 한다 — ${Date.now() - started}ms나 기다렸다`)
})

test('영상 대기도 같은 규칙을 따른다', async () => {
  const gen = seq.cancelGeneration()
  seq.cancelCurrentBroadcast()
  const reason = await seq.waitForVideoEnd('없는-토큰', 3000, gen)
  assert.equal(reason, 'cancelled')
})

test('취소가 없었으면 평소대로 기다린다 — 멀쩡한 재생을 끊지 않는다', async () => {
  const gen = seq.cancelGeneration()
  const token = 'tok-정상'
  const waiting = seq.waitForAudioEnd(token, 3000, gen)
  // 곡이 정상적으로 끝난 경우
  setTimeout(() => seq.notifyAudioEnded(token), 50)
  assert.equal(await waiting, 'ended',
    '취소가 없었는데 cancelled로 답하면 곡이 끝나기도 전에 다음으로 넘어간다')
})

test('세대를 안 넘기면 지금까지와 똑같이 동작한다', async () => {
  // 기존 호출부(broadcastSequencer 내부 등)는 인자를 안 넘긴다 — 그쪽 동작이 바뀌면 안 된다.
  seq.cancelCurrentBroadcast()
  const token = 'tok-구버전'
  const waiting = seq.waitForAudioEnd(token, 3000)
  setTimeout(() => seq.notifyAudioEnded(token), 50)
  assert.equal(await waiting, 'ended')
})

test('취소 세대는 취소할 때만 올라간다', () => {
  const a = seq.cancelGeneration()
  assert.equal(seq.cancelGeneration(), a, '읽기만 해서는 변하면 안 된다')
  seq.cancelCurrentBroadcast()
  assert.equal(seq.cancelGeneration(), a + 1)
})
