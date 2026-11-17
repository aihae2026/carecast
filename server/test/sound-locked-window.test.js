// **창은 붙어 있는데 소리가 잠긴 상태를 서버가 안다** (현장 사고 2026-09-15).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 그날 아침 07:50 아침 종합 방송이 **아무 소리 없이** 지나갔는데 이력에는 **성공**이었다.
// 방송 화면은 내내 **열려 있었다** — 브라우저가 자동재생을 막아 **소리만 잠겨** 있었다.
// 서버가 보던 것은 *"창이 붙어 있나"* 뿐이라 그 상태를 통과시켰다.
//
// 「무음인데 기록은 멀쩡」은 이 저장소가 가장 비싸게 데인 모양이다. 2026-09-14 에는
// **창이 없어서** 같은 일이 났고 그때 `hasSitePlayer()` 검사를 넣었는데, 그것으로는
// **창이 있는데 소리만 잠긴** 이 경우를 못 잡는다.
//
// ── 무엇을 고정하나 ─────────────────────────────────────────────────────────
// 화면이 생존 신호에 `sound=on|off` 를 실어 보내고, 서버가 그것으로 센다.
// **안 알려 준 창은 「낼 수 있다」로 센다** — 옛 화면을 「못 낸다」로 세면 멀쩡한 방송이
// 전부 실패로 적힌다. 그 폴백도 여기서 고정한다(이쪽이 더 위험한 오답이다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_soundlock_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const sse = require('../services/sse')
const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({
    '/api/events': require('../routes/events'),
    '/api/health': require('../routes/health'),
  })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

// 현장 창 하나를 흉내 낸다. 실제 서명은 `addClient(res, req, tabId)` 이고,
// **현장인지는 `req` 의 주소로 판정한다**(`isLocalRequest`) — 그래서 loopback 주소를 준다.
function 가짜창(tabId) {
  const res = {
    write: () => true,
    end:   () => {},
    on:    () => {},
    setHeader: () => {},
    flushHeaders: () => {},
    writeHead: () => {},
  }
  const req = { socket: { remoteAddress: '127.0.0.1' }, query: {} }
  sse.addClient(res, req, tabId)
  return res
}

test('긍정 앵커 — 붙은 창은 살아 있는 것으로 센다', () => {
  sse._test.reset()
  가짜창('tab-a')
  sse.noteAlive('tab-a', true)
  assert.equal(sse.localAliveCount(), 1, '창이 안 세어지면 이 시험의 전제가 없다')
  assert.equal(sse.소리낼수있는창수(), 1)
})

test('**소리가 잠겼다고 알린 창은 소리 낼 창으로 안 센다**', () => {
  sse._test.reset()
  가짜창('tab-b')
  sse.noteAlive('tab-b', false)          // 창은 살아 있다. 소리만 못 낸다
  assert.equal(sse.localAliveCount(), 1,
    '창은 여전히 붙어 있다 — 「창이 없다」와 헷갈리면 사람에게 엉뚱한 조치를 시킨다')
  assert.equal(sse.소리낼수있는창수(), 0,
    '소리가 잠긴 창을 세면 무음 방송이 또 성공으로 적힌다')
})

test('**안 알려 준 창은 낼 수 있는 쪽으로 센다** — 옛 화면을 실패로 만들지 않는다', () => {
  sse._test.reset()
  가짜창('tab-c')
  sse.noteAlive('tab-c')                 // sound 를 안 실어 보낸 옛 화면
  assert.equal(sse.소리낼수있는창수(), 1,
    '옛 화면을 「못 낸다」로 세면 멀쩡한 방송이 전부 실패로 적힌다')
})

test('**잠겼다가 풀리면 다시 센다** — 띠를 누른 뒤가 이 경우다', () => {
  sse._test.reset()
  가짜창('tab-d')
  sse.noteAlive('tab-d', false)
  assert.equal(sse.소리낼수있는창수(), 0)
  sse.noteAlive('tab-d', true)           // 사람이 띠를 눌러 풀었다
  assert.equal(sse.소리낼수있는창수(), 1, '풀린 뒤에도 0이면 경보가 안 꺼진다')
})

test('HTTP: /alive 가 sound=off 를 받아 반영한다', async () => {
  sse._test.reset()
  가짜창('tab-e')
  const r = await fetch(`${app.baseUrl}/api/events/alive?tab=tab-e&sound=off`, { method: 'POST' })
  assert.equal(r.status, 204)
  assert.equal(sse.소리낼수있는창수(), 0, '라우트가 sound 를 안 넘기면 서버는 잠김을 영영 모른다')

  await fetch(`${app.baseUrl}/api/events/alive?tab=tab-e&sound=on`, { method: 'POST' })
  assert.equal(sse.소리낼수있는창수(), 1)
})

test('HTTP: /api/health 가 창 수와 소리 가능 수를 **따로** 알린다', async () => {
  sse._test.reset()
  가짜창('tab-f')
  sse.noteAlive('tab-f', false)
  const body = await (await fetch(`${app.baseUrl}/api/health`)).json()
  assert.equal(body.localClientsAlive, 1, '창은 붙어 있다')
  assert.equal(body.localSoundReady, 0, '소리는 못 낸다')
  // 이 둘이 **다르다**는 것이 진단의 핵심이다 — 같으면 사람이 두 경우를 못 가른다.
  assert.notEqual(body.localClientsAlive, body.localSoundReady,
    '두 값이 같으면 「창 없음」과 「소리 잠김」을 구별할 수 없다')
})

test('**방송 성공 판정이 소리 잠김을 본다** — 소스 대조', () => {
  // 시퀀서 전체를 돌리는 것은 이 파일의 몫이 아니다(레인 하나가 수 분이다).
  // 판정에 이 값이 **엮여 있다는 것**만 고정한다 — 빠지면 조용히 옛 동작으로 돌아간다.
  const 소스 = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  const 코드만 = 소스.replace(/\/\/.*$/gm, '')
  assert.match(코드만, /소리낼수있나\s*=\s*require\('\.\/sitePlayer'\)\.소리낼수있나\(\)/,
    '시퀀서가 소리 가능 여부를 안 묻는다')
  assert.match(코드만, /const 들렸나 = .*소리낼수있나/,
    '성공 판정(들렸나)에 소리 가능 여부가 안 엮여 있다 — 잠긴 채 나간 방송이 또 성공이 된다')
})
