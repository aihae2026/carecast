// **경보 「확인」을 서버가 기억한다** (현장 지적 2026-09-15).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 「방송멈춤」 배너의 확인을 눌렀는데 **들어갈 때마다 또 떴다.**
// 확인 기록이 `localStorage` 에만 있었기 때문이다. 그 저장소는 **주소마다·브라우저
// 프로필마다 따로**라, 같은 사람이 같은 PC 에서 봐도 —
//   · `localhost` 로 봤다가 랜 주소로 보면 확인이 안 넘어가고
//   · 방송 화면 전용 프로필이 새로 생기면 빈 채로 시작하고
//   · 직원 폰에서 보면 처음부터 다시 뜬다
//
// 잔소리가 되면 사람이 **진짜 경보까지 안 읽는다.** 이 배너를 만든 이유 자체가 무너진다.
//
// ── 무엇을 고정하나 ─────────────────────────────────────────────────────────
// 확인이 서버에 남고, **다른 창에서 물어도 같은 답**이 온다는 것.
// 그리고 **못 적어도 배너가 사라지지는 않는다**는 것(안전한 실패 방향).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ack_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/status': require('../routes/status') })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

const 확인목록 = async () => (await (await fetch(`${app.baseUrl}/api/status/acked-alerts`)).json())
const 확인하기 = (id) => fetch(`${app.baseUrl}/api/status/acked-alerts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id }),
})

test('긍정 앵커 — 처음에는 확인한 것이 없다', async () => {
  const r = await 확인목록()
  assert.ok(Array.isArray(r.ids), 'ids 가 배열이 아니면 화면이 거를 수 없다')
  assert.equal(r.ids.length, 0)
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, '날짜를 함께 줘야 화면이 오늘 것인지 안다')
})

test('**확인하면 서버에 남고, 다시 물으면 그대로 있다** — 새 창이 그 답을 본다', async () => {
  const id = '2026-09-15|방송멈춤|국민체조(09:00) 방송이 시작됐는데 끝나지 않았습니다'
  const r = await 확인하기(id)
  assert.equal(r.status, 200)

  // **다른 창이 묻는 것과 같은 요청이다.** localStorage 와 달리 이 답은 창을 안 가린다.
  const 목록 = await 확인목록()
  assert.ok(목록.ids.includes(id),
    '확인이 서버에 안 남으면 다른 창·다른 주소에서 그 경보가 또 뜬다')
})

test('같은 것을 두 번 확인해도 한 번만 쌓인다', async () => {
  const id = '2026-09-15|방송멈춤|같은 경보'
  await 확인하기(id)
  await 확인하기(id)
  const 목록 = await 확인목록()
  assert.equal(목록.ids.filter(v => v === id).length, 1,
    '중복이 쌓이면 설정 한 칸이 계속 커진다')
})

test('id 가 없으면 400 — 빈 값을 확인으로 적지 않는다', async () => {
  const r = await fetch(`${app.baseUrl}/api/status/acked-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(r.status, 400)
  const 목록 = await 확인목록()
  assert.ok(!목록.ids.includes(''), '빈 id 가 들어가면 그 뒤 비교가 전부 어긋난다')
})

test('**화면이 서버 목록을 걸러 쓴다** — 소스 대조', () => {
  const 소스 = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'SystemAlertBanner.jsx'), 'utf8')
  const 코드만 = 소스.replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드만, /getAckedAlerts\(\)/,
    '복원할 때 서버의 확인 목록을 안 묻는다 — 확인해도 또 뜬다')
  assert.match(코드만, /!서버확인\.has\(a\.id\)/,
    '서버 확인 목록으로 거르지 않는다')
  assert.match(코드만, /ackAlert\(id\)/,
    '확인을 눌러도 서버에 안 알린다')
  // **안전한 실패 방향**: 서버 목록을 못 받으면 경보를 숨기지 않는다.
  assert.match(코드만, /getAckedAlerts\(\)\.catch\(\(\) => null\)/,
    '서버 목록 실패를 안 흘려보낸다 — 못 받으면 경보가 뜨는 쪽이 맞다')
})
