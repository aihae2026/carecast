// 2026-08-31 CC-036. /api/ai/test 와 /api/ai/test-gemini 는 "같은 일을 하는 두 벌"이었다 —
// 66줄이 통째로 복제돼 있었고, 둘 다 fetchGeminiWithRetry를 건너뛰고 fetch를 직접 불렀다
// (CLAUDE.md "Gemini API 호출 규칙" 위반). 한쪽만 고치면 다른 쪽이 조용히 옛날 동작을 한다.
//
// 라우터를 실제로 require해서 두 경로가 **같은 핸들러 함수**를 가리키는지 본다 — 소스에서
// 문자열을 세는 것과 달리, 복제가 다시 생기면 반드시 빨간불이 된다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

process.env.CARECAST_DB_PATH = path.join(os.tmpdir(), `carecast_test_aidedup_${process.pid}_${Date.now()}.db`)

const test = require('node:test')
const assert = require('node:assert/strict')

const router = require('../routes/ai')

function handlersFor(routerInstance, method, routePath) {
  const layer = routerInstance.stack.find(l => l.route?.path === routePath && l.route?.methods?.[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack.map(s => s.handle)
}

test('연결 테스트 두 경로가 같은 핸들러를 쓴다(복제 금지)', () => {
  const a = handlersFor(router, 'post', '/test')
  const b = handlersFor(router, 'post', '/test-gemini')
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(a[0], b[0], '/test-gemini는 /test의 하위 호환 별칭이어야 한다 — 본문을 복사하면 안 된다')
})

test('ai.js는 Gemini를 fetch로 직접 부르지 않는다(래퍼 경유)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/ai.js'), 'utf8')
  const bare = src.match(/(?<!GeminiWithRetry\()\bawait fetch\(/g) || []
  assert.equal(bare.length, 0, 'CLAUDE.md 규칙: fetchGeminiWithRetry()를 반드시 거친다')
})

test.after(() => {
  try { fs.unlinkSync(process.env.CARECAST_DB_PATH) } catch { /* 안 만들어졌으면 그만 */ }
})
