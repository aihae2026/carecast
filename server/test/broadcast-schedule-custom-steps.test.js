// GET /api/settings/broadcast-schedule 회귀 테스트 — 커스텀 스텝(고정 ID에 없는 스텝)이
// 저장 후 조회 시 사라지지 않는지 확인. server/services/broadcastSequencer.js의
// mergeStepsWithDefaults 버그(settings.js의 parseSteps가 DEFAULT_STEPS 기준으로만 배열을
// 재구성해서 커스텀 스텝이 조용히 drop되던 문제)의 API 레벨 회귀 테스트.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_customsteps_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
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

test('POST 후 GET /api/settings/broadcast-schedule — 커스텀 스텝이 저장 후 조회 시에도 남아있는다', async () => {
  const getRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule')
  const current = await getRes.json()

  const customStep = {
    id: 'custom_bgm_test', customType: 'bgm', label: '커스텀 BGM', enabled: true, order: 99,
    bgm_type: 'preset', bgm_value: '클래식 음악', bgm_title: '', bgm_delay: 5,
  }
  const postRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ morning: { ...current.morning, steps: [...current.morning.steps, customStep] } }),
  })
  assert.equal(postRes.status, 200)

  const afterRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule')
  const after = await afterRes.json()
  const found = after.morning.steps.find(s => s.id === 'custom_bgm_test')
  assert.ok(found, '커스텀 스텝(custom_bgm_test)이 저장 후 GET 응답에서 사라지면 안 된다')
  assert.equal(found.customType, 'bgm')
  assert.equal(found.bgm_value, '클래식 음악')

  // 기존 고정 스텝들도 그대로 남아있어야 한다(회귀 없음)
  const fixedIds = current.morning.steps.map(s => s.id)
  const afterIds = after.morning.steps.map(s => s.id)
  for (const id of fixedIds) {
    assert.ok(afterIds.includes(id), `기존 고정 스텝(${id})은 그대로 남아있어야 한다`)
  }
})

test('같은 customType(bgm)의 커스텀 스텝을 여러 개 추가해도 전부 독립적으로 저장된다', async () => {
  const getRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule')
  const current = await getRes.json()

  const step1 = { id: 'custom_bgm_multi1', customType: 'bgm', label: 'BGM 1', enabled: true, order: 100, bgm_value: '클래식' }
  const step2 = { id: 'custom_bgm_multi2', customType: 'bgm', label: 'BGM 2', enabled: true, order: 101, bgm_value: '동요' }

  const postRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ morning: { ...current.morning, steps: [...current.morning.steps, step1, step2] } }),
  })
  assert.equal(postRes.status, 200)

  const after = (await (await fetch(app.baseUrl + '/api/settings/broadcast-schedule')).json()).morning.steps
  const found1 = after.find(s => s.id === 'custom_bgm_multi1')
  const found2 = after.find(s => s.id === 'custom_bgm_multi2')
  assert.ok(found1 && found2, '같은 타입의 커스텀 스텝 2개가 모두 저장되어야 한다')
  assert.equal(found1.bgm_value, '클래식')
  assert.equal(found2.bgm_value, '동요')
})

test('customType="video_file"(업로드 영상) 커스텀 스텝도 저장 후 조회 시 남아있는다', async () => {
  const getRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule')
  const current = await getRes.json()

  const videoStep = { id: 'custom_video_file_test', customType: 'video_file', label: '업로드 영상', enabled: true, order: 200, audio_file_id: '1' }
  const postRes = await fetch(app.baseUrl + '/api/settings/broadcast-schedule', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ morning: { ...current.morning, steps: [...current.morning.steps, videoStep] } }),
  })
  assert.equal(postRes.status, 200)

  const after = (await (await fetch(app.baseUrl + '/api/settings/broadcast-schedule')).json()).morning.steps
  const found = after.find(s => s.id === 'custom_video_file_test')
  assert.ok(found, 'video_file 커스텀 스텝이 저장 후 GET 응답에서 사라지면 안 된다')
  assert.equal(found.audio_file_id, '1')
})
