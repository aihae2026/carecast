// Gemini 2.5 Flash가 간헐적으로 503(UNAVAILABLE, "high demand")을 내는 것을 실측했음
// (2026-08-27) — fetchGeminiWithRetry가 503만 짧게 재시도하고, 429 등 다른 실패는
// 재시도 없이 그대로 돌려주는지 확인한다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { fetchGeminiWithRetry, retryDelayMs, GEMINI_TIMEOUT_MS } = require('../services/geminiClient')

function mockResponse(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('503이면 재시도하다가 성공하면 그 응답을 반환한다', async () => {
  let calls = 0
  global.fetch = async () => {
    calls += 1
    if (calls < 3) return mockResponse(503, { error: { message: 'high demand' } })
    return mockResponse(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
  }
  const res = await fetchGeminiWithRetry('http://test', {})
  assert.equal(res.ok, true)
  assert.equal(calls, 3)
})

test('재시도를 다 써도 503이면 마지막 실패 응답을 그대로 반환한다', async () => {
  let calls = 0
  global.fetch = async () => { calls += 1; return mockResponse(503, {}) }
  const res = await fetchGeminiWithRetry('http://test', {})
  assert.equal(res.ok, false)
  assert.equal(res.status, 503)
  assert.equal(calls, 3, '최초 1회 + 재시도 2회 = 총 3회')
})

test('429(쿼터 초과)는 재시도 없이 바로 실패 응답을 반환한다', async () => {
  let calls = 0
  global.fetch = async () => { calls += 1; return mockResponse(429, { error: { message: 'quota exceeded' } }) }
  const res = await fetchGeminiWithRetry('http://test', {})
  assert.equal(res.ok, false)
  assert.equal(res.status, 429)
  assert.equal(calls, 1)
})

// ── 2026-08-31 CC-036 ────────────────────────────────────────────────────────
// 원 finding: fetchGeminiWithRetry에 타임아웃이 없어 fetch가 매달리면 라우트가 무기한 멈춘다
// (Node의 fetch는 기본 타임아웃이 없다). 재시도까지 겹치면 최악이 몇 분 단위가 된다.
// 판정은 벽시계에 걸지 않는다(규칙 7) — 타임아웃 값을 인자로 받아 짧게 주고, 기본값(20초)은
// 소스 대조로 고정한다. 지터는 순수 함수(retryDelayMs)로 떼어내 난수 없이 검증한다.

test('응답이 오지 않으면 타임아웃으로 중단하고 오류를 던진다', async () => {
  let calls = 0
  global.fetch = async (_url, opts) => {
    calls += 1
    // signal이 끊길 때까지 영원히 안 끝나는 요청 — 매달린 Gemini를 흉내낸다
    return new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
    })
  }
  await assert.rejects(
    () => fetchGeminiWithRetry('http://test', {}, { timeoutMs: 30 }),
    /응답이 없습니다|시간 초과/,
  )
  assert.equal(calls, 1, '타임아웃은 재시도하지 않는다 — 재시도하면 사람이 그 배수만큼 더 기다린다')
})

test('타임아웃 기본값은 20초다', () => {
  assert.equal(GEMINI_TIMEOUT_MS, 20000)
})

test('재시도 대기에 지터가 붙되 기본 간격 아래로는 안 내려간다', () => {
  // rand는 0 이상 1 미만 — 양 끝을 직접 넣어 범위를 고정한다(난수 없이 판정)
  assert.equal(retryDelayMs(0, 0), 800)
  assert.equal(retryDelayMs(1, 0), 1600)
  assert.ok(retryDelayMs(0, 0.999) > 800 && retryDelayMs(0, 0.999) <= 1200)
  assert.ok(retryDelayMs(1, 0.999) > 1600 && retryDelayMs(1, 0.999) <= 2400)
})
