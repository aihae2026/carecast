// CC-029 — 어디서 온 요청까지 받아줄지.
//
// 예전엔 `cors({ origin: true })`라 **임의의 웹사이트**가 브라우저를 통해 이 서버의 API를
// 부를 수 있었다. 현장 PC에서 아무 페이지나 하나 열어두면 그 페이지가 DELETE /api/broadcasts나
// POST /api/morning/stop을 부를 수 있다는 뜻이다(응답을 못 읽을 뿐, 요청은 실행된다).
//
// 반대 방향 위험이 더 크다는 것을 잊지 말 것: **잘못 좁히면 원격 제어가 통째로 죽는다.**
// 현장 PC·원격 PC·직원 폰이 전부 같은 랜에서 붙는다. 그래서 판정은 "사설망이면 허용"이다 —
// 공인 인터넷 주소에서 오는 것만 막는다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { isAllowedOrigin } = require('../services/corsOrigin')

test('출처가 아예 없는 요청은 통과한다 — 같은 출처·앱·스크립트', () => {
  // 브라우저가 Origin을 안 붙이는 경우(같은 출처 탐색, curl, 시작 bat의 헬스체크).
  // 여기서 막으면 화면이 통째로 안 뜬다.
  assert.equal(isAllowedOrigin(undefined), true)
  assert.equal(isAllowedOrigin(''), true)
})

test('현장 PC 자신은 http·https·포트를 가리지 않고 통과한다', () => {
  for (const o of [
    'http://localhost:3001', 'https://localhost:5173', 'http://127.0.0.1:3001',
    'https://127.0.0.1:3443', 'http://[::1]:3001',
  ]) assert.equal(isAllowedOrigin(o), true, o)
})

test('같은 랜의 사설 IP는 통과한다 — 원격 PC·직원 폰', () => {
  for (const o of [
    'http://192.168.0.15:3001', 'http://192.168.1.200:5173', 'https://10.0.0.7:3443',
    'http://172.16.5.9:3001', 'http://172.31.255.254:3001',
    'http://169.254.10.10:3001',  // 링크로컬(DHCP 실패 시 폰이 이걸 쓴다)
  ]) assert.equal(isAllowedOrigin(o), true, o)
})

test('사설 대역처럼 생겼지만 아닌 주소는 막는다', () => {
  // 172.16~31만 사설이다. 172.15·172.32는 공인 주소다 — 넓게 잡으면 막는 의미가 없다.
  for (const o of ['http://172.15.0.1', 'http://172.32.0.1', 'http://11.0.0.1', 'http://193.168.0.1'])
    assert.equal(isAllowedOrigin(o), false, o)
})

test('공인 웹사이트는 막는다 — 이게 이 작업의 이유다', () => {
  for (const o of [
    'https://evil.example.com', 'http://example.com', 'https://naver.com',
    'http://localhost.evil.com',        // 접두사만 흉내
    'https://192.168.0.15.evil.com',    // 사설 IP를 이름에 심은 것
  ]) assert.equal(isAllowedOrigin(o), false, o)
})

test('랜 안에서 이름으로 붙는 것도 통과한다 — 점 없는 호스트명과 .local', () => {
  // 공인 DNS에는 점 없는 이름이 없다. mDNS(.local)도 인터넷에서 못 온다.
  assert.equal(isAllowedOrigin('http://carecast-pc:3001'), true)
  assert.equal(isAllowedOrigin('http://carecast-pc.local:3001'), true)
})

test('안전 밸브 — 목록에 없는 출처를 설정으로 더 열 수 있다', () => {
  // 현장에서 판정이 틀려 원격 제어가 죽었을 때 코드 배포 없이 뚫을 길이 있어야 한다.
  assert.equal(isAllowedOrigin('https://tunnel.example.com', { extra: ['https://tunnel.example.com'] }), true)
  assert.equal(isAllowedOrigin('https://other.example.com', { extra: ['https://tunnel.example.com'] }), false)
})

test('망가진 출처 값에 서버가 터지지 않는다', () => {
  for (const o of ['not a url', 'http://', '://', 'javascript:alert(1)', 'null'])
    assert.doesNotThrow(() => isAllowedOrigin(o))
  assert.equal(isAllowedOrigin('null'), false, "샌드박스 iframe이 보내는 'null'은 출처 없음이 아니다")
})

// ── 다른 사이트의 쓰기 요청 (공개판 보안 점검 2026-10-18) ─────────────────────────
// CORS 는 응답만 가린다. form·multipart·text/plain POST 는 프리플라이트 없이 **실행된다.**
const { isCrossSiteWrite, crossSiteWriteGuard, isAllowedUpgrade } = require('../services/corsOrigin')

test('쓰기 막기 — 외부 사이트 Origin 의 POST·DELETE 는 막고, 읽기는 그대로 둔다', () => {
  const r = (method, headers) => ({ method, headers })
  assert.equal(isCrossSiteWrite(r('POST', { origin: 'https://evil.example.com' })), true)
  assert.equal(isCrossSiteWrite(r('DELETE', { origin: 'https://evil.example.com' })), true)
  assert.equal(isCrossSiteWrite(r('POST', { origin: 'null' })), true, "샌드박스 iframe 의 'null' 도 막는다")
  assert.equal(isCrossSiteWrite(r('GET', { origin: 'https://evil.example.com' })), false, '읽기는 CORS 가 응답을 가린다')
  assert.equal(isCrossSiteWrite(r('OPTIONS', { origin: 'https://evil.example.com' })), false, '프리플라이트는 cors 가 답한다')
})

test('쓰기 막기 — 같은 PC·같은 랜 화면과 비브라우저 요청은 예전처럼 통과한다', () => {
  const r = (method, headers) => ({ method, headers })
  for (const o of ['http://localhost:3001', 'http://192.168.0.15:3001', 'https://10.0.0.7:3443', 'http://carecast-pc:3001'])
    assert.equal(isCrossSiteWrite(r('POST', { origin: o })), false, o)
  assert.equal(isCrossSiteWrite(r('POST', {})), false, 'curl·시작 bat 은 Origin 이 없다')
  assert.equal(isCrossSiteWrite(r('POST', { 'sec-fetch-site': 'same-origin' })), false)
  assert.equal(isCrossSiteWrite(r('POST', { 'sec-fetch-site': 'cross-site' })), true, 'Origin 이 빠져도 브라우저가 cross-site 라 하면 막는다')
  assert.equal(isCrossSiteWrite(r('POST', { origin: 'https://t.example.com' }), { extra: ['https://t.example.com'] }), false, '안전 밸브')
})

test('쓰기 막기 — 실제 서버에서 외부 출처의 multipart POST 는 403, 라우트까지 안 간다', async () => {
  const express = require('express')
  const http = require('http')
  const app = express()
  let 닿음 = 0
  app.use(crossSiteWriteGuard)
  app.post('/api/mic/broadcast', (req, res) => { 닿음++; res.json({ ok: true }) })
  const server = http.createServer(app)
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const 보내기 = (headers) => new Promise((ok, ng) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/mic/broadcast',
      headers: { 'content-type': 'multipart/form-data; boundary=x', ...headers } }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode)) })
    req.on('error', ng)
    req.end('--x--\r\n')
  })
  try {
    assert.equal(await 보내기({ origin: 'https://evil.example.com' }), 403)
    assert.equal(닿음, 0, '막힌 요청이 라우트에 닿으면 안 된다')
    assert.equal(await 보내기({ origin: 'http://192.168.0.15:3001' }), 200)
    assert.equal(await 보내기({}), 200)
    assert.equal(닿음, 2)
  } finally { server.close() }
})

test('WebSocket 연결도 같은 출처 판정을 쓴다 — 외부 페이지는 /ws/audio 에 못 붙는다', () => {
  assert.equal(isAllowedUpgrade({ headers: { origin: 'https://evil.example.com' } }), false)
  assert.equal(isAllowedUpgrade({ headers: { origin: 'https://192.168.0.20:3443' } }), true)
  assert.equal(isAllowedUpgrade({ headers: {} }), true, '비브라우저 클라이언트')
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.ok(src.includes('crossSiteWriteGuard'), 'index.js 가 쓰기 막기를 안 건다')
  assert.ok(src.includes('isAllowedUpgrade'), 'index.js 의 WS 업그레이드가 출처를 안 본다')
  assert.ok(src.indexOf('crossSiteWriteGuard') < src.indexOf("app.use('/api/tts'"), '쓰기 막기는 라우트보다 먼저 걸려야 한다')
})

test('index.js가 origin:true를 쓰지 않고 이 판정을 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.ok(!/origin:\s*true/.test(src), 'origin: true가 남아 있으면 판정이 아무 일도 안 한다')
  assert.ok(src.includes('corsOrigin'), 'index.js가 공용 판정을 안 쓴다')
})
