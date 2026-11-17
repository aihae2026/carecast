// 자동방송 단계의 BGM 폴더·차례가 저장되고, 모르는 값은 막힌다 (2026-09-21).
//
// 단계 편집기가 「이 PC 음원」에서 폴더(방송용·식사용)와 차례(랜덤·차례로)를 고른다. 서버의
// stepBGMStart 가 `bgmRole`·`bgmOrder` 를 그대로 읽으므로 **저장 때 걸러야** 한다 — 안 거르면
// 방송 시각에야 「모르는 용도」로 BGM 이 빠지고 그때는 아무도 이유를 모른다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_steprole_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': require('../routes/settings') })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

const 저장 = (steps) => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lunch: { steps } }),
})
const 저장된것 = () => JSON.parse(getDB().prepare("SELECT value FROM settings WHERE key='lunch_steps'").get()?.value || 'null')

test('폴더·차례를 고르면 그대로 저장된다', async () => {
  const r = await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmSource: 'local', bgmRole: 'meal', bgmOrder: 'seq' }])
  assert.equal(r.status, 200, await r.text())
  const [s] = 저장된것()
  assert.equal(s.bgmRole, 'meal')
  assert.equal(s.bgmOrder, 'seq')
})

test('안 고른 것(빈 값)은 서버 기본이라 그대로 통과한다', async () => {
  const r = await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmSource: 'local' }])
  assert.equal(r.status, 200)
})

test('모르는 폴더·차례는 400 이고 저장된 값이 안 바뀐다', async () => {
  await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmSource: 'local', bgmRole: 'broadcast' }])
  for (const 나쁜 of [{ bgmRole: 'kids' }, { bgmOrder: 'shuffle' }]) {
    const r = await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmSource: 'local', ...나쁜 }])
    assert.equal(r.status, 400, JSON.stringify(나쁜))
    assert.match((await r.json()).error, /BGM/)
    assert.equal(저장된것()[0].bgmRole, 'broadcast', '거절했는데 저장이 바뀌었다')
  }
})
