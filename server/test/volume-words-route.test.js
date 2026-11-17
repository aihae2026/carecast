// GET/POST /api/settings/volume-words — 말로 쓰는 볼륨 표현("잔잔하게")의 수치.
//
// 이 설정이 있는 이유는 하나다: "잔잔하게"가 몇 %인지는 스피커·공간마다 달라서, 어르신들이
// "잘 안 들린다"고 하실 때 **배포 없이** 고칠 수 있어야 한다. 그래서 저장된 값이 실제
// 자연어 파싱 결과까지 흘러가는지를 함께 확인한다 — 거기까지 안 가면 이 화면은 장식이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_volwords_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const settingsRoutes = require('../routes/settings')
const schedulesRoutes = require('../routes/schedules')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes, '/api/schedules': schedulesRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function get(p) {
  const r = await fetch(app.baseUrl + p)
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function post(p, body) {
  const r = await fetch(app.baseUrl + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

test('처음에는 기본값을 돌려준다', async () => {
  const r = await get('/api/settings/volume-words')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { quiet: 30, loud: 85 })
})

test('저장하면 그대로 다시 읽힌다', async () => {
  assert.equal((await post('/api/settings/volume-words', { quiet: 20, loud: 90 })).status, 200)
  assert.deepEqual((await get('/api/settings/volume-words')).body, { quiet: 20, loud: 90 })
})

test('한쪽만 보내면 다른 쪽은 그대로 둔다', async () => {
  await post('/api/settings/volume-words', { quiet: 20, loud: 90 })
  await post('/api/settings/volume-words', { quiet: 10 })
  assert.deepEqual((await get('/api/settings/volume-words')).body, { quiet: 10, loud: 90 })
})

test('범위를 벗어나거나 숫자가 아니면 400', async () => {
  for (const bad of [-1, 101, 'abc', {}, []]) {
    assert.equal((await post('/api/settings/volume-words', { quiet: bad })).status, 400,
      `${JSON.stringify(bad)}은 거부되어야 한다`)
  }
})

test('보낼 값이 하나도 없으면 400', async () => {
  assert.equal((await post('/api/settings/volume-words', {})).status, 400)
})

test('여기서 바꾼 값이 자연어 예약에 실제로 반영된다', async () => {
  // 이 설정의 존재 이유 — 화면에서 고치면 배포 없이 "잔잔하게"의 크기가 바뀌어야 한다
  await post('/api/settings/volume-words', { quiet: 12 })
  let parsed = await post('/api/schedules/parse-phrase', { text: '오후 2시 안내, 볼륨은 잔잔하게' })
  assert.equal(parsed.body.bgm_volume, 12)

  await post('/api/settings/volume-words', { quiet: 55 })
  parsed = await post('/api/schedules/parse-phrase', { text: '오후 2시 안내, 볼륨은 잔잔하게' })
  assert.equal(parsed.body.bgm_volume, 55, '설정을 바꿔도 파싱이 안 따라오면 이 화면은 장식이다')
})

test('"크게"도 같은 경로로 반영된다', async () => {
  await post('/api/settings/volume-words', { loud: 95 })
  const parsed = await post('/api/schedules/parse-phrase', { text: '오후 2시 투약 안내, 안내 음성은 크게' })
  assert.equal(parsed.body.main_volume, 95)
})

test('시스템 볼륨 설정과 섞이지 않는다', async () => {
  // 정성어 수치는 별도 키다 — 여기를 바꿨다고 실제 재생 볼륨이 바뀌면 안 된다
  const { getDB } = require('../db/schema')
  const { readVolumes } = require('../domain/volume')
  const before = readVolumes(getDB())
  await post('/api/settings/volume-words', { quiet: 5, loud: 99 })
  assert.deepEqual(readVolumes(getDB()), before)
})
