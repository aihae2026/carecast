// 대시보드 "기능 활성화" 토글이 실제 방송 동작을 제어하는지 검증.
//
// 문제였던 상황: 토글을 끄면 settings.feature_toggles에 저장은 되는데 서버 어느 코드도
// 그 값을 읽지 않아서, "자동 아침 방송"을 꺼도 다음날 아침 방송이 그대로 나갔다.
// (스케줄러는 별개 키 morning_enabled를 읽는다.) 직원이 "껐다"고 믿는데 방송이 나가는
// 운영 위험이라, 토글을 실제 제어 키에 연결한다.
//
// 매핑:
//   morning → morning_enabled                     (scheduler가 아침방송 발동 여부로 읽음)
//   alert   → weather_alert_broadcast_enabled     (특보 자동방송 on/off)
//             + morning_segments[alert].enabled   (아침 안내문 속 특보 문장)
//   weather → morning_segments[weather].enabled   (아침 안내문 속 날씨 문장)
//   dust    → morning_segments[dust].enabled      (아침 안내문 속 미세먼지 문장)
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_features_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const settingsRoutes = require('../routes/settings')

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

const getSetting = (k) => getDB().prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null
const segEnabled = (id) => {
  const raw = getSetting('morning_segments')
  if (!raw) return null
  return JSON.parse(raw).find(s => s.id === id)?.enabled ?? null
}

async function getFeatures() {
  const r = await fetch(app.baseUrl + '/api/settings/features')
  return r.json()
}
async function postFeatures(body) {
  const r = await fetch(app.baseUrl + '/api/settings/features', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json() }
}

test('"자동 아침 방송" 토글을 끄면 scheduler가 읽는 morning_enabled가 실제로 false가 된다', async () => {
  const cur = await getFeatures()
  const res = await postFeatures({ ...cur, morning: false })
  assert.equal(res.status, 200)
  assert.equal(getSetting('morning_enabled'), 'false', '토글만 저장되고 실제 키는 그대로면 아침방송이 계속 나간다')

  await postFeatures({ ...cur, morning: true })
  assert.equal(getSetting('morning_enabled'), 'true')
})

test('"특보 안내" 토글이 특보 자동방송 키와 아침 안내문 특보 문장을 함께 제어한다', async () => {
  const cur = await getFeatures()
  await postFeatures({ ...cur, alert: true })
  assert.equal(getSetting('weather_alert_broadcast_enabled'), 'true')
  assert.equal(segEnabled('alert'), true)

  await postFeatures({ ...cur, alert: false })
  assert.equal(getSetting('weather_alert_broadcast_enabled'), 'false')
  assert.equal(segEnabled('alert'), false)
})

test('"날씨 안내"/"미세먼지" 토글이 아침 안내문 세그먼트를 실제로 끈다', async () => {
  const cur = await getFeatures()
  await postFeatures({ ...cur, weather: false, dust: false })
  assert.equal(segEnabled('weather'), false)
  assert.equal(segEnabled('dust'), false)

  await postFeatures({ ...cur, weather: true, dust: true })
  assert.equal(segEnabled('weather'), true)
  assert.equal(segEnabled('dust'), true)
})

test('GET /features는 저장된 토글이 아니라 실제 제어 키의 현재 값을 반영한다', async () => {
  // 화면을 거치지 않고 실제 키를 직접 바꿔도(다른 화면에서 끈 경우) 대시보드에 반영돼야 한다
  getDB().prepare("INSERT INTO settings (key, value) VALUES ('morning_enabled','false') ON CONFLICT(key) DO UPDATE SET value='false'").run()
  const f = await getFeatures()
  assert.equal(f.morning, false, '자동방송순서편집기에서 끈 것이 대시보드에도 보여야 한다')

  getDB().prepare("INSERT INTO settings (key, value) VALUES ('morning_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'").run()
  assert.equal((await getFeatures()).morning, true)
})

test('나머지 토글(tts/ai/mic 등)은 기존처럼 feature_toggles에 그대로 저장된다(회귀)', async () => {
  const cur = await getFeatures()
  await postFeatures({ ...cur, tts: false, ai: false })
  const saved = JSON.parse(getSetting('feature_toggles') || '{}')
  assert.equal(saved.tts, false)
  assert.equal(saved.ai, false)
  assert.equal((await getFeatures()).tts, false)
})
