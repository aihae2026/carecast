// **시설 위치(위도·경도)는 저장되어야 한다** (2026-09-18).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// `server/services/weather.js` 는 기상청이 막혔을 때 Open-Meteo 로 날씨를 받아 오는데,
// 그때 위경도를 `location_lat`·`location_lon` 설정에서 읽는다. 그런데 **그 값을 저장하는
// 경로가 어디에도 없었다** — 화면에서 위경도를 넣고 「격자 계산」을 눌러도 격자(nx·ny)만
// 저장됐다. 그래서 다른 기관이 설치하면 **오류도 경고도 없이 기본값 위치의 날씨**가
// 나갔다. README 의 한계에 「좌표를 넣어야 한다」고 적어 뒀는데 **넣어도 안 됐다.**
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
//  · **왕복** — 저장한 값이 그대로 돌아온다(소스 정규식이 아니라 실제 DB 로)
//  · **빈 값은 안 쓴다** — 빈 문자열 행이 생기면 읽는 쪽의 `?? 기본값` 을 통과해
//    `latitude=` 인 주소가 만들어지고 Open-Meteo 가 통째로 죽는다(고치기 전보다 나쁜 회귀)
//  · **전부 검사한 뒤 전부 쓴다** — 한쪽이 틀리면 다른 쪽도 안 바뀐다(반쪽 저장 금지)
//  · **범위 밖은 막는다** — 소수점을 빠뜨린 `37211` 이 그대로 저장되면 무증상 고장이 된다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_loc_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { getSetting }    = require('../domain/settingsRead')
const settingsRouter    = require('../routes/settings')

test.before(() => { initDB() })
test.after(() => {
  for (const 꼬리 of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + 꼬리) } catch { /* 없으면 그만 */ }
  }
})

/** 라우터를 express 없이 부른다 — 이 저장소가 다른 라우트 시험에서 쓰는 방식과 같다. */
function 부르기(body) {
  const layer = settingsRouter.stack.find((l) => l.route?.path === '/kma' && l.route.methods.post)
  assert.ok(layer, '긍정 앵커 — POST /kma 라우트가 있다')
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(v) { resolve({ code: this.statusCode, body: v }) },
    }
    layer.route.stack[0].handle({ body }, res, () => resolve({ code: 0, body: null }))
  })
}

// 서버는 숫자로 정규화해 저장한다 — 「127.0」 은 「127」 로 들어간다(같은 좌표다).
// 그래서 **값으로 비교**한다. 글자 그대로 보면 멀쩡한 동작이 빨간불이 된다.
const 읽기 = (키) => getSetting(getDB(), 키, '(없음)')
const 같은값 = (키, 기대, 말) => assert.equal(Number(읽기(키)), Number(기대), 말)

test('저장한 좌표가 **그대로 돌아온다** — 왕복', async () => {
  const r = await 부르기({ lat: '35.1595', lon: '126.8526' })   // 광주
  assert.equal(r.code, 200, `저장이 거부됐다: ${JSON.stringify(r.body)}`)
  assert.equal(읽기('location_lat'), '35.1595')
  assert.equal(읽기('location_lon'), '126.8526')
})

test('**빈 값은 저장하지 않는다** — 빈 문자열이 들어앉으면 Open-Meteo 주소가 `latitude=` 가 된다', async () => {
  await 부르기({ lat: '35.1595', lon: '126.8526' })
  const r = await 부르기({ lat: '', lon: '' })
  assert.equal(r.code, 200)
  assert.equal(읽기('location_lat'), '35.1595', '빈 값이 멀쩡한 좌표를 덮었다')
  assert.equal(읽기('location_lon'), '126.8526', '빈 값이 멀쩡한 좌표를 덮었다')
})

test('숫자가 아니면 **400 이고 아무것도 안 바뀐다**', async () => {
  await 부르기({ lat: '37.5', lon: '127.0' })
  const r = await 부르기({ lat: '서울', lon: '127.0' })
  assert.equal(r.code, 400)
  같은값('location_lat', 37.5)
  같은값('location_lon', 127.0)
})

test('경도가 틀리면 **위도도 안 바뀐다** — 반쪽 저장 금지', async () => {
  await 부르기({ lat: '37.5', lon: '127.0' })
  const r = await 부르기({ lat: '35.16', lon: '없음' })
  assert.equal(r.code, 400)
  같은값('location_lat', 37.5,
    '경도 검사에서 막혔는데 위도가 이미 저장됐다 — 두 값이 다른 동네를 가리킨다')
})

test('범위를 벗어나면 막는다 — 소수점을 빠뜨린 `37211` 이 그대로 들어가지 않는다', async () => {
  await 부르기({ lat: '37.5', lon: '127.0' })
  const r = await 부르기({ lat: '37211', lon: '126948' })
  assert.equal(r.code, 400)
  assert.match(String(r.body?.error || ''), /범위/)
  같은값('location_lat', 37.5)
})

test('위경도를 뒤바꿔 넣으면 막는다 — 경도 127 을 위도 칸에', async () => {
  const r = await 부르기({ lat: '127.0', lon: '37.5' })
  assert.equal(r.code, 400, '위도 127 은 ±90 밖이라 막아야 한다')
})

test('읽기 응답이 **기본값을 흉내 내지 않는다** — 안 넣었으면 빈 값으로 온다', async () => {
  const layer = settingsRouter.stack.find((l) => l.route?.path === '/kma' && l.route.methods.get)
  assert.ok(layer, '긍정 앵커 — GET /kma 라우트가 있다')
  const db = getDB()
  db.prepare("DELETE FROM settings WHERE key IN ('location_lat','location_lon')").run()
  const 답 = await new Promise((resolve) => {
    layer.route.stack[0].handle({}, { json: resolve, status() { return this } }, () => resolve(null))
  })
  assert.equal(답.lat, '', '안 넣은 좌표를 만든 곳 값으로 채워 보내면 사람은 자기 시설 좌표인 줄 안다')
  assert.equal(답.lon, '')
})
