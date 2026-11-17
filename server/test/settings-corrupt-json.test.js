// settings의 morning_segments가 손상 JSON이면 화면이 영영 막히는 것(CC-044).
//
// GET /api/settings/morning(routes/settings.js)이 저장된 morning_segments를 JSON.parse로
// 그대로 파싱해서, 값이 한 번이라도 깨져 들어가면(디스크 오류·수동 편집·버그) 그 뒤로는
// 이 라우트가 항상 500이다. 이 설정을 고치는 화면 자체가 이 라우트로 열리기 때문에,
// **화면에서는 복구할 방법이 없다** — DB를 직접 열어야 한다.
// 같은 파일의 readSegments()(660행 부근)는 이미 try + 기본값 폴백으로 가드돼 있다.
// 그 패턴이 기대 동작이다: 손상 JSON이어도 200 + 기본값으로 응답해서 화면이 살아 있어야 한다.
//
// put-preserves-volume.test.js와 같은 방식의 행동 테스트 — 격리 DB에 손상 JSON을 심고
// 라우터만 빈 익스프레스 앱에 얹어 실제 요청을 보낸다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_corruptjson_${process.pid}_${Date.now()}.db`)
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

test('morning_segments가 손상 JSON이어도 GET /api/settings/morning은 200 + 기본값으로 응답한다', async () => {
  getDB().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('morning_segments', '{"broken": ')  // 손상 JSON — 실제로는 디스크 오류·수동 편집으로 생긴다

  const res = await fetch(app.baseUrl + '/api/settings/morning')
  assert.equal(res.status, 200,
    '손상 JSON 하나로 라우트가 500이 되면 아침방송 설정 화면이 영영 안 열린다 — 화면에서 복구 불가')

  const body = await res.json()
  // 기본값 폴백: segments가 null(기본값 사용 신호) 또는 세그먼트 배열이어야 한다
  assert.ok(body.segments === null || Array.isArray(body.segments),
    '손상 값 대신 기본값(null 또는 배열)으로 응답해야 화면이 이어서 동작한다')
  assert.equal(typeof body.enabled, 'boolean', '나머지 설정도 정상적으로 함께 와야 한다')
})
