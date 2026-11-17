'use strict'
// **초기 설정의 「휴대폰 접속 허용하기」** (사용자 확정 시안 2026-09-16, 구현 2026-09-17).
//
// 방화벽을 여는 일은 설치팩에 든 `CareCast-방화벽-열기.bat` 이 한다(스스로 관리자 권한을
// 요청하고, 집·회사 망에서만 3001·3443 을 연다). 서버는 **그 파일을 띄워 주기만** 한다.
//
// 이 시험이 지키는 것 셋:
//  ① **이 PC 에서 연 화면만** 띄울 수 있다 — 휴대폰에서 누르면 방송 PC 에 권한 창이 뜨는 일은
//     없어야 한다(누가 눌렀는지 모르는 창에 「예」를 누르게 된다).
//  ② **시험 중에는 절대 실행하지 않는다** — `npm test` 가 개발 PC 의 방화벽을 건드리면 안 된다.
//  ③ 파일이 없는 PC(개발 PC)에서는 없다고 말한다 — 조용히 성공처럼 굴지 않는다.
const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_firewall_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')
const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const settingsRoutes = require('../routes/settings')
const { 방화벽창구 } = require('../routes/settings')

let app
test.before(async () => { initDB(); app = await startTestApp({ '/api/settings': settingsRoutes }) })
test.after(async () => {
  await app.close()
  try { getDB().close() } catch { /* 이미 닫힘 */ }
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없음 */ } }
})

test('**이 PC 에서 연 화면이 아니면 막는다** — 휴대폰이 방송 PC 에 권한 창을 띄우지 못한다', () => {
  const 호출 = []
  const 결과 = 방화벽창구({ socket: { remoteAddress: '192.168.0.23' } }, { 있나: () => true, 띄우기: (p) => 호출.push(p), 시험중: false })
  assert.equal(결과.status, 403)
  assert.equal(호출.length, 0, '다른 기기의 요청으로 파일을 띄웠다')
})

test('**파일이 없으면 없다고 말한다** — 개발 PC 에서 성공처럼 굴지 않는다', () => {
  const 결과 = 방화벽창구({ socket: { remoteAddress: '127.0.0.1' } }, { 있나: () => false, 띄우기: () => { throw new Error('띄우면 안 된다') }, 시험중: false })
  assert.equal(결과.status, 404)
  assert.match(결과.body.error, /설치/)
})

test('**이 PC 이고 파일이 있으면 띄운다** — 결과는 「창을 띄웠다」까지만 말한다', () => {
  const 호출 = []
  const 결과 = 방화벽창구({ socket: { remoteAddress: '::1' } }, { 있나: () => true, 띄우기: (p) => 호출.push(p), 시험중: false })
  assert.equal(결과.status, 200)
  assert.equal(호출.length, 1)
  assert.match(호출[0], /CareCast-방화벽-열기\.bat$/)
  // 사람이 권한 창에서 「예」를 눌렀는지는 서버가 모른다 — 열렸다고 적지 않는다.
  assert.equal(결과.body.열었나, undefined, '권한 창 결과를 모르면서 열었다고 말한다')
  assert.equal(결과.body.띄움, true)
})

test('**시험 중에는 실제 경로로 불러도 절대 실행하지 않는다**', async () => {
  const r = await fetch(`${app.baseUrl}/api/settings/setup-firewall`, { method: 'POST' })
  const j = await r.json()
  assert.equal(j.시험, true, '시험 중인데 실제로 방화벽 파일을 띄우려 했다')
})

// ── **허용이 먼저, 주소는 그다음** (현장 지적 2026-09-18) ────────────────────────────────
// 앞 판은 주소·QR 을 위에, 방화벽 허용을 아래에 뒀다. 그런데 사람이 실제로 하는 순서는 반대다 —
// 허용을 안 하면 주소를 쳐도 QR 을 찍어도 안 열린다. 화면 순서가 일하는 순서와 같아야 한다.
// 사용자 원문: *"권한설정을 하고 주소를 복사하고 카메라로 QR 가보지 않을까?"*
test('초기 설정 「접속 주소」 — 방화벽 허용 칸이 주소·QR 보다 **위에** 있다', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/admin/sections/SetupWizard.jsx'), 'utf8')

  const 장 = src.indexOf("{단계 === 'address' && (")
  const 장끝 = src.indexOf("{단계 === 'done' && (")
  assert.ok(장 > 0 && 장끝 > 장, '긍정 앵커 — 접속 주소 장이 이 파일에 있다')
  const 덩어리 = src.slice(장, 장끝)

  const 허용 = 덩어리.indexOf('이PC인가()')
  const 주소 = 덩어리.indexOf('{주소?.url && (')
  assert.ok(허용 > 0, '긍정 앵커 — 방화벽 허용 칸이 이 장에 있다')
  assert.ok(주소 > 0, '긍정 앵커 — 주소 칸이 이 장에 있다')
  assert.ok(허용 < 주소,
    '방화벽 허용이 주소·QR 아래에 있다 — 허용을 안 하면 주소도 QR 도 안 열린다(현장 지적 2026-09-18)')
})
