// /api/health — "떠 있음"이 아니라 "돌고 있음"을 답하는가 (2026-08-29 리뷰 CC-012).
//
// 시작 bat의 재시작 판정이 netstat 포트 LISTEN 하나뿐이었다. 포트는 express가 잡고 있으면
// 계속 LISTEN이라, 이벤트 루프가 멎어도·스케줄러 cron이 죽어도 bat은 "정상"으로 본다.
// 무인 운영에서 이건 아무도 모르는 무음이 된다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_health_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// scheduler를 실제로 로드하면 switchbot 등 하드웨어 경계까지 딸려온다(TASKS T-002).
// 여기서 검증할 것은 "tick 시각으로 판정하는가"뿐이므로 이음새만 세운다.
let fakeTick = null
const schedPath = require.resolve('../services/scheduler')
require.cache[schedPath] = {
  id: schedPath, filename: schedPath, loaded: true,
  exports: { getLastTickAt: () => fakeTick },
}

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const healthRoutes = require('../routes/health')
const { healthState, STALE_MS, BOOT_GRACE_MS } = healthRoutes

let app
test.before(async () => { initDB(); app = await startTestApp({ '/api/health': healthRoutes }) })
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const now = 1_800_000_000_000

test('기동 직후 tick이 없어도 정상이다 — 여기서 503을 주면 부팅 루프가 된다', () => {
  const s = healthState({ now, startedAt: now - 30_000, lastTickAt: null })
  assert.equal(s.ok, true)
  assert.match(s.reason, /기동 직후/)
})

test('유예를 넘겨도 tick이 없으면 비정상 — 스케줄러가 아예 안 떴다는 뜻이다', () => {
  const s = healthState({ now, startedAt: now - BOOT_GRACE_MS - 1000, lastTickAt: null })
  assert.equal(s.ok, false)
  assert.match(s.reason, /한 번도 돌지 않았다/)
})

test('최근에 돌았으면 정상', () => {
  assert.equal(healthState({ now, startedAt: now - 600_000, lastTickAt: now - 5_000 }).ok, true)
})

test('오래 안 돌았으면 비정상 — 포트가 LISTEN이어도 방송은 안 나간다', () => {
  const s = healthState({ now, startedAt: now - 600_000, lastTickAt: now - STALE_MS - 1000 })
  assert.equal(s.ok, false)
  assert.match(s.reason, /초째 돌지 않았다/)
})

test('한 번 거른 정도로는 죽이지 않는다 — 무거운 시퀀스가 돌면 tick이 밀릴 수 있다', () => {
  assert.ok(STALE_MS >= 3 * 60 * 1000, '2분 이하로 잡으면 정상 방송 중에 재시작하게 된다')
  assert.equal(healthState({ now, startedAt: now - 600_000, lastTickAt: now - 90_000 }).ok, true)
})

test('HTTP: tick이 신선하면 200', async () => {
  fakeTick = Date.now() - 1000
  const res  = await fetch(`${app.baseUrl}/api/health`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(typeof body.uptimeSec, 'number')
  assert.ok(body.sinceTickSec <= 5)
})

test('HTTP: tick이 멎으면 503 — bat이 이걸 보고 재시작한다', async () => {
  fakeTick = Date.now() - (STALE_MS + 5000)
  const res  = await fetch(`${app.baseUrl}/api/health`)
  const body = await res.json()
  assert.equal(res.status, 503)
  assert.equal(body.ok, false)
  assert.match(body.reason, /돌지 않았다/)
})

test('DB 상태는 본문에 싣기만 하고 판정에는 안 넣는다 — 손상된 DB는 재시작해도 안 낫는다', async () => {
  fakeTick = Date.now() - 1000
  const res  = await fetch(`${app.baseUrl}/api/health`)
  const body = await res.json()
  assert.equal(res.status, 200, 'DB 때문에 503을 주면 bat이 무한 재시작을 돈다')
  assert.equal(body.db, 'ok')
  assert.ok('localClients' in body, '현장 재생 창 수도 사람이 볼 수 있게 싣는다')
  // 둘이 다르면 유령 연결이 쌓였다는 뜻이다 — 2026-09-02에 크롬을 다 닫고도 5로 남던 그것(H15)
  assert.ok('localClientsAlive' in body, '그중 생존 신호가 유효한 수도 같이 싣는다')
})
