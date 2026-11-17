'use strict'
// **화면 대체 차임은 소리 담당 창 하나를 기준으로 판정한다** — 진짜 sse 모듈로 (2026-09-26 Codex 교차검수 T36 2회차 High)
//
// 1회차 수정은 「현장 창 전체에 소리 낼 창이 있나」와 「모든 연결에 몇 곳 갔나」를 봤다. 그런데 실제로 울리는 것은
// **대표(담당) 창 하나**다(MusicPlayer 의 CC_IS_LEADER). 그래서 대표 창은 소리가 막혔는데 다른 창이 준비됐거나,
// 대표 창 전송만 실패하고 원격 창이 받은 경우에도 성공이 됐다. 이제 sse.담당에게보내기 가 **대표 창에게만** 보내고
// 그 창이 살아 있고 소리를 낼 수 있으며 실제로 써졌을 때만 true 다.
// 창은 sound-owner.test.js 와 같은 방식(가짜 res + 요청 주소)으로 흉내 낸다.
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const dbPath = path.join(os.tmpdir(), `carecast_test_chime_owner_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = dbPath
process.env.CARECAST_NO_HARDWARE = '1'
const test = require('node:test')
const assert = require('node:assert/strict')

const sse = require('../services/sse')
const { initDB, getDB } = require('../db/schema')
const { __test__ } = require('../services/chimePlayer')

function fakeRes(터짐 = false) {
  const closers = []
  return {
    written: [], 터짐,
    writeHead() {},
    write(chunk, cb) {
      if (this.터짐 && String(chunk).includes('chime_fallback_play')) throw new Error('끊긴 연결')
      this.written.push(chunk)
      if (typeof cb === 'function') setImmediate(() => cb())   // 진짜 응답처럼 다 쓴 뒤 콜백
      return true
    },
    on(ev, cb) { if (ev === 'close') closers.push(cb) },
    end() {},
    _close() { for (const cb of closers) cb() },
  }
}
const 열린것 = []
function connect(address, tabId) {
  const res = fakeRes()
  sse.addClient(res, { socket: { remoteAddress: address }, query: tabId ? { tab: tabId } : {} }, tabId)
  열린것.push(res)
  return res
}
const 루프백 = (tab) => connect('127.0.0.1', tab)
const 원격 = (tab) => connect('192.168.0.55', tab)
const 모니터 = () => connect('127.0.0.1', null)        // /monitor 는 탭 id 를 안 보내 담당이 못 된다(tabId.js)
const 받았나 = (res) => res.written.some((w) => String(w).includes('event: chime_fallback_play'))

test.before(() => initDB())
test.beforeEach(() => { for (const r of 열린것.splice(0)) { try { r._close() } catch { /* 닫힘 */ } } sse._test.reset(); sse.setSoundGate(null) })
test.after(() => {
  for (const r of 열린것.splice(0)) { try { r._close() } catch { /* 닫힘 */ } }
  try { getDB().close() } catch { /* 닫힘 */ }
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + s) } catch { /* 없음 */ }
})
const 마지막줄 = () => getDB().prepare('SELECT content, success FROM broadcasts ORDER BY id DESC LIMIT 1').get()
// 판정은 대표 창 쓰기가 **끝났다는 확인**을 기다린 뒤에 나온다(비동기) — 결과 콜백이 올 때까지 기다린다.
const 울려보기 = () => new Promise((r) => {
  let 시작 = false
  __test__.장치못엶처리('general', 0.5, (ok) => r({ ok, 시작 }), () => { 시작 = true })
})

test('대표 창이 살아 있고 소리를 낼 수 있으면 — 대표 창에게만 보내고 성공', async () => {
  const a = 루프백('탭A'); const r = 원격('탭R')
  sse.noteAlive('탭A', true)
  const { ok, 시작 } = await 울려보기()
  assert.equal(ok, true); assert.equal(시작, true)
  assert.ok(받았나(a), '대표 창이 못 받았다')
  assert.ok(!받았나(r), '원격 창에도 보냈다 — 대표 창만 울린다')
  assert.equal(마지막줄().success, 1)
})

test('대표 창 전송만 실패하고 원격 창은 받을 수 있어도 — 실패', async () => {
  const a = 루프백('탭A'); 원격('탭R')
  sse.noteAlive('탭A', true)
  a.터짐 = true
  const { ok, 시작 } = await 울려보기()
  assert.equal(ok, false, '대표 창에 못 보냈는데 성공으로 적었다')
  assert.equal(시작, false)
  assert.equal(마지막줄().success, 0)
})

test('대표 창이 「소리 못 냄」이고 다른 창(모니터)만 준비돼 있어도 — 실패', async () => {
  루프백('탭A'); 모니터()
  sse.noteAlive('탭A', false)
  const { ok } = await 울려보기()
  assert.equal(ok, false, '대표 창이 소리를 못 내는데 성공으로 적었다')
  assert.equal(마지막줄().success, 0)
})

test('모니터 창만 있으면 대표 창이 없다 — 실패', async () => {
  모니터()
  const { ok } = await 울려보기()
  assert.equal(ok, false)
  assert.equal(마지막줄().success, 0)
})

test('드라이런이면 대표 창에게도 안 보낸다 — 실패로 남는다', async () => {
  const a = 루프백('탭A')
  sse.noteAlive('탭A', true)
  sse.setSoundGate((ev) => ev === 'chime_fallback_play')
  const { ok } = await 울려보기()
  assert.equal(ok, false); assert.ok(!받았나(a), '드라이런인데 화면에 보냈다')
})

// ── 3회차(사용자 결정 가): **쓰기 완료 확인**까지 본다 — 진짜 http.ServerResponse 로 ─────────────────────────
// res.write() 가 예외 없이 돌아와도 소켓 오류(EPIPE)는 나중에 비동기로 온다. 예전엔 그래도 성공으로 적었다.
// 소리를 브라우저가 실제로 냈는지까지는 모른다 — 다른 브라우저 소리(broadcastSSE·sitePlayer 판정)와 같은 수준의 한계다.
const http = require('node:http')
const { Duplex } = require('node:stream')
function 진짜창(tabId, 차임에서터짐) {
  const socket = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      if (차임에서터짐 && String(chunk).includes('chime_fallback_play')) {
        setImmediate(() => cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))   // 비동기로 알리는 소켓 오류
      } else setImmediate(cb)
    },
  })
  socket.remoteAddress = '127.0.0.1'
  socket.on('error', () => {})   // 시험 프로세스를 죽이지 않게
  const req = new http.IncomingMessage(socket)
  req.socket = socket
  req.query = { tab: tabId }
  const res = new http.ServerResponse(req)
  res.assignSocket(socket)
  res._close = () => { try { res.emit('close') } catch { /* 닫힘 */ } }
  sse.addClient(res, req, tabId)
  열린것.push(res)
  return res
}

test('진짜 응답 — 대표 창 소켓이 차임 전송에서 비동기 EPIPE 를 내면 실패로 적는다', async () => {
  진짜창('탭E', true)
  sse.noteAlive('탭E', true)
  const { ok, 시작 } = await 울려보기()
  assert.equal(ok, false, '소켓 쓰기가 실패했는데 성공으로 적었다')
  assert.equal(시작, false)
  assert.equal(마지막줄().success, 0)
})

test('진짜 응답 — 소켓 쓰기가 정상으로 끝나면 성공으로 적는다(대조군)', async () => {
  진짜창('탭OK', false)
  sse.noteAlive('탭OK', true)
  const { ok } = await 울려보기()
  assert.equal(ok, true)
  assert.equal(마지막줄().success, 1)
})

test('진짜 응답 — 이미 끝난 연결이 아직 대표로 남아 있어도 보내지 않고 실패', async () => {
  const res = 진짜창('탭END', false)
  sse.noteAlive('탭END', true)
  res.end()                                     // close 이벤트 전 — 서버 목록에는 아직 대표로 남아 있다
  const { ok } = await 울려보기()
  assert.equal(ok, false, '끝난 연결에 쓰고 성공으로 적었다')
})
