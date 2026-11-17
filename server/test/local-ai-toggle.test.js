// 로컬 AI(1차) 허용 스위치 — **소스 대조가 아니라 동작으로** 잠근다.
//
// 여기서 잠그는 것 셋:
//  1. **기본은 꺼짐.** 아무도 승인한 적 없는데 모델이 도는 일이 없어야 한다.
//  2. **대시보드의 "AI 방송 도우미"를 끄면 함께 멈춘다.** 1차 로컬은 브라우저에서 돌아
//     `routes/ai.js` 의 403 가드를 **안 지난다** — 이 창구가 대신 막지 않으면, 기능을 끈
//     사람은 껐다고 믿는데 문구는 계속 만들어진다. 조용히 도는 쪽이 훨씬 나쁘다.
//  3. **왜 안 도는지 구분해서 알려 준다.** 하나로 뭉쳐 보내면 화면이 "켰는데 왜 안 되냐"에
//     답할 수 없고, 사람은 체크박스를 껐다 켜며 시간을 버린다.
'use strict'

const path = require('path')
const os   = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_localai_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')

// 라우터를 통째로 띄우지 않고 핸들러만 부른다 — 이 저장소에는 supertest가 없고,
// 새 테스트 하네스를 들이지 않는 것이 회귀 규칙이다.
const router = require('../routes/settings')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

function call(handler, { body = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b }) },
    }
    handler({ body }, res)
  })
}

initDB()

const GET  = findRoute('get',  '/local-ai')
const POST = findRoute('post', '/local-ai')

function 설정(key, value) {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

test('기본은 꺼짐 — 아무도 승인 안 했는데 켜져 있으면 안 된다', async () => {
  const r = await call(GET)
  assert.equal(r.body.enabled, false)
  assert.equal(r.body.localAllowed, false)
})

test('사람이 켜면 켜진다', async () => {
  await call(POST, { body: { enabled: true } })
  const r = await call(GET)
  assert.equal(r.body.enabled, true)
  assert.equal(r.body.localAllowed, true)
  assert.equal(r.body.aiFeature, true)
})

test('"AI 방송 도우미"를 끄면 로컬 1차도 함께 멈춘다 — 서버 403 을 안 지나기 때문', async () => {
  설정('feature_toggles', JSON.stringify({ tts: true, ai: false, mic: true }))
  const r = await call(GET)
  assert.equal(r.body.enabled, false,
    '기능을 껐는데 브라우저 1차가 계속 돈다 — 끈 사람은 껐다고 믿고 있다')
  // 사람이 켠 사실 자체는 그대로 남는다. 이게 없으면 기능을 다시 켰을 때
  // 체크가 풀려 있어서, 사람이 껐다고 오해하고 다시 승인 절차를 밟는다.
  assert.equal(r.body.localAllowed, true, '사람이 켠 기록까지 지워졌다')
  assert.equal(r.body.aiFeature, false, '왜 안 도는지 구분이 안 된다')
})

test('기능을 다시 켜면 승인은 그대로 살아 있다', async () => {
  설정('feature_toggles', JSON.stringify({ tts: true, ai: true, mic: true }))
  const r = await call(GET)
  assert.equal(r.body.enabled, true, '다시 켰는데 안 돈다 — 승인이 날아갔다')
})

test('사람이 끄면 기능이 켜져 있어도 안 돈다', async () => {
  await call(POST, { body: { enabled: false } })
  const r = await call(GET)
  assert.equal(r.body.enabled, false)
  assert.equal(r.body.localAllowed, false)
})
