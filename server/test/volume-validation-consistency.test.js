// 볼륨 값이 범위를 벗어났을 때 경로마다 답이 달랐다.
//
//   POST /api/schedules      → 400 "0~100 사이 숫자여야 합니다" (되묻는다)
//   POST /api/audio/volume   → 조용히 100으로 잘라서 저장 (200 OK)
//
// 같은 값을 넣었는데 어디로 넣느냐에 따라 결과가 다르면, 사람은 둘 중 하나를 반드시
// 잘못 기억한다. 예약 쪽 주석이 이유를 적어 두었다 — "조용히 자르지 않고 되묻는다.
// 사람은 넣은 대로 될 거라 믿는다." 그 규칙을 볼륨 저장에도 맞춘다.
//
// **자르기(clamp) 자체를 없애는 게 아니다.** 읽을 때(readVolume)는 계속 자른다 —
// DB에 이미 들어앉은 이상한 값 때문에 방송이 멈추면 안 된다. 막는 것은 **들어오는 길**뿐이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_volval_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const audioRoutes = require('../routes/audio')
const { readVolume, clampVolume } = require('../domain/volume')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/audio': audioRoutes })
})
test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const post = async (body) => {
  const r = await fetch(app.baseUrl + '/api/audio/volume', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

test('범위를 벗어난 볼륨은 400으로 되묻는다 — 조용히 자르지 않는다', async () => {
  const before = readVolume(getDB(), 'tts')
  const r = await post({ tts: 150 })
  assert.equal(r.status, 400)
  assert.equal(readVolume(getDB(), 'tts'), before, '거부했으면 값도 안 바뀌어야 한다')
})

test('숫자가 아닌 값도 400', async () => {
  assert.equal((await post({ bgm: '크게' })).status, 400)
  assert.equal((await post({ master: -5 })).status, 400)
})

test('[회귀] 정상 범위는 그대로 저장된다 — 0은 명시적 무음이라 유효하다', async () => {
  assert.equal((await post({ tts: 0 })).status, 200)
  assert.equal(readVolume(getDB(), 'tts'), 0)
  assert.equal((await post({ tts: 100 })).status, 200)
  assert.equal(readVolume(getDB(), 'tts'), 100)
})

test('[회귀] 안 보낸 채널은 건드리지 않는다', async () => {
  await post({ tts: 55 })
  const bgmBefore = readVolume(getDB(), 'bgm')
  await post({ tts: 56 })
  assert.equal(readVolume(getDB(), 'bgm'), bgmBefore)
})

test('[회귀] 읽을 때는 계속 자른다 — DB에 이미 든 이상한 값으로 방송이 멈추면 안 된다', () => {
  const db = getDB()
  db.prepare("INSERT INTO settings (key, value) VALUES ('vol_tts','999') ON CONFLICT(key) DO UPDATE SET value='999'").run()
  assert.equal(readVolume(db, 'tts'), 100, '읽기까지 막으면 방송이 통째로 죽는다')
  assert.equal(clampVolume(999, 70), 100)
})
