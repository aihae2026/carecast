// ISSUE-005 — 'API 키 저장' 라우트는 자기가 다루는 키 이름만 받는다
//
// 왜 필요한가(2026-09-06 검수): POST /api/settings/api-keys 가 `key` 를 검사하지 않고 그대로
// setSetting 했다. 그래서 출력장치 이름(정규 경로는 sanitizeDeviceName 을 반드시 지난다)·
// 자동종료 시각(쓰는 순간 PC 종료가 무장된다)·자동방송 시각까지 이 한 라우트로 **검증 없이**
// 덮어쓸 수 있었다(EV-000462·EV-000463). 인증 문제가 아니라 검증 우회다(PROJECT_PROFILE §1-1).
//
// 이 라우트의 유일한 화면 호출처는 apiSettingsAI.jsx 이고 보내는 키는 gemini_api_key 하나다.
// GET 쪽이 읽는 세 키(anthropic·claude·gemini)가 곧 이 라우트의 범위다 — 그 목록 하나를
// GET 과 POST 가 같이 본다. 다른 API 키(기상청·에어코리아·유튜브·캘린더·스위치봇)는 각자
// 전용 라우트가 있으므로 여기서 열지 않는다.
//
// 위험한 키는 **거부되는 것만** 확인한다. 400 이면 setSetting 에 닿지 않으므로 이 테스트가
// 자동종료를 무장시키거나 장치 이름을 바꿀 일은 없다. DB 는 임시 파일이다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_apikeys_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp }  = require('./helpers/testApp')
const settingsRoutes    = require('../routes/settings')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function post(p, body) {
  const r = await fetch(app.baseUrl + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

const get = async (p) => (await fetch(app.baseUrl + p)).json()

function readSetting(key) {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : undefined
}

// 이 라우트가 절대 건드리면 안 되는 키들 — 각자 검증이 있는 전용 경로가 따로 있다.
const 남의키 = [
  ['audio_device',       '스피커 (Realtek(R) Audio)'],  // 정규 경로는 sanitizeDeviceName 필수
  ['auto_shutdown_time', '18:21'],                      // 쓰는 순간 PC 종료가 무장된다
  ['morning_time',       '03:00'],                      // 방송 시각이 바뀐다
  ['zz_audit_p4_probe',  'v1'],                         // 검수 때 실제로 들어갔던 임의 키(EV-000462)
]

test('ISSUE-005: 목록 밖 키는 400 이고 DB 에 들어가지 않는다', async () => {
  for (const [key, value] of 남의키) {
    const before = readSetting(key)
    const r = await post('/api/settings/api-keys', { key, value })
    assert.equal(r.status, 400, `${key} 를 이 라우트로 쓸 수 있으면 안 된다 (status=${r.status})`)
    assert.ok(r.body && /키/.test(r.body.error || ''), `${key}: 사람이 읽을 오류 문구가 있어야 한다`)
    assert.equal(readSetting(key), before, `${key} 가 DB 에 기록됐다 — 거부가 저장 전에 일어나야 한다`)
  }
})

test('ISSUE-005: gemini_api_key 는 저장되고 GET 이 마스킹해 돌려준다', async () => {
  const r = await post('/api/settings/api-keys', { key: 'gemini_api_key', value: '  AIza-test-1234  ' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true })
  assert.equal(readSetting('gemini_api_key'), 'AIza-test-1234', '앞뒤 공백은 다듬어 저장한다')

  const view = await get('/api/settings/api-keys')
  assert.equal(view.gemini.set, true)
  assert.equal(view.gemini.masked, '••••••••1234')
  assert.doesNotMatch(JSON.stringify(view), /AIza-test/, 'GET 은 키 본문을 절대 돌려주지 않는다')
})

test('ISSUE-005: 빈 키·빈 값은 그대로 400 (기존 동작 유지)', async () => {
  assert.equal((await post('/api/settings/api-keys', { key: '', value: 'x' })).status, 400)
  assert.equal((await post('/api/settings/api-keys', { key: 'gemini_api_key', value: '   ' })).status, 400)
})
