// **현장 화면이 없다는 사실을 화면이 알 수 있다** (현장 사고 2026-09-14).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 18:00 저녁 마무리가 **소리 없이** 지나갔다(환기방송도 같았다). 원인은 현장 PC 에 `localhost`
// 로 열린 창이 하나도 없었던 것이다 — 예약 TTS·녹음 음원·BGM·영상은 **브라우저**가 재생하고
// (`PROJECT_PROFILE` §1-3), 랜 주소로 연 창은 `lib/isLocal.js` 판정에서 원격이라 **화면만
// 그리고 소리는 안 낸다.**
//
// **서버는 알고 있었다** — `/api/health` 의 `localClients` 가 0 이었다. 아무도 안 봤을 뿐이다.
// 그래서 그 숫자를 **화면까지 밀어 준다.** `sound_owner` 에 실어 보낸다 — 새 이벤트를 만들지
// 않는 이유는 소식이 필요한 시점이 담당이 바뀌는 시점과 사실상 같고, 갓 붙은 창에 초기값을
// 보내는 자리도 이미 있기 때문이다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const sse = require('../services/sse')

function fakeRes() {
  const closers = []
  return {
    written: [],
    writeHead() {},
    write(chunk) { this.written.push(chunk) },
    on(ev, cb) { if (ev === 'close') closers.push(cb) },
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
test.afterEach(() => { 열린것.splice(0).forEach(r => { try { r._close() } catch { /* 이미 닫힘 */ } }) })

/** 그 창이 받은 마지막 `sound_owner` 의 payload. 못 받았으면 null. */
function 마지막소유(res) {
  const 줄 = res.written.filter(c => c.startsWith('event: sound_owner'))
  if (!줄.length) return null
  return JSON.parse(줄[줄.length - 1].match(/data: (.*)\n\n/)[1])
}

test('긍정 앵커 — 붙은 창은 곧바로 소리 담당 소식을 받는다', () => {
  const 원격 = connect('192.168.0.8', 'r1')
  assert.ok(마지막소유(원격), 'sound_owner 를 아예 못 받았다 — 이 시험의 전제가 깨졌다')
})

test('**현장 창이 없으면 0 이라고 말해 준다** — 그 값이 곧 무음의 예고다', () => {
  const 원격 = connect('192.168.0.8', 'r1')
  assert.equal(마지막소유(원격).siteScreens, 0,
    '현장 창이 하나도 없는데 화면은 그 사실을 알 길이 없다 — 2026-09-14 저녁 마무리가 그렇게 지나갔다')
})

test('현장 창이 붙으면 **숫자가 올라간 것을 원격도 받는다**', () => {
  const 원격 = connect('192.168.0.8', 'r1')
  connect('127.0.0.1', 'site1')
  assert.equal(마지막소유(원격).siteScreens, 1,
    '현장 창이 생겼는데 원격 화면은 아직 「없다」로 알고 있다 — 안내가 안 걷힌다')
})

test('현장 창이 닫히면 **다시 0 을 받는다** — 이번 사고의 그 순간', () => {
  const 원격 = connect('192.168.0.8', 'r1')
  const 현장 = connect('127.0.0.1', 'site1')
  assert.equal(마지막소유(원격).siteScreens, 1)
  현장._close()
  assert.equal(마지막소유(원격).siteScreens, 0,
    '현장 창이 닫혔는데 아무도 안 알려준다 — 서버는 아무도 없는 곳에 계속 방송한다')
})

test('랜 주소로 연 창은 **현장 창으로 세지 않는다** — 소리를 못 내기 때문이다', () => {
  const 원격 = connect('192.168.0.8', 'r1')
  connect('192.168.0.9', 'r2')
  assert.equal(마지막소유(원격).siteScreens, 0,
    '원격 창을 현장 창으로 셌다 — 화면만 그리는 창을 「소리 낼 창 있음」으로 세면 안내가 거짓이 된다')
})

test('소리 담당 소식이 **없어지지 않았다** — 기존 규칙을 안 흔든다', () => {
  const 현장 = connect('127.0.0.1', 'site1')
  assert.equal(마지막소유(현장).tabId, 'site1', '담당 탭 알림이 사라졌다')
})

// ── **창이 둘일 때 담당만 닫히는 경우** (V③ R10 지적, 2026-09-14) ─────────────────
// 현장 창이 **둘** 있으면 소리를 내던 창이 닫혀도 `localAliveCount` 는 1 로 남는다 —
// 「창 없음」 사건이 안 오른다. 그런데 **재생은 그 창에서 끊겼고**, 담당이 넘어가도
// 진행 중인 소리는 안 이어받는다. 그래서 **담당이 바뀐 것도 센다.**
test('담당 창이 닫히면 **창 수가 그대로여도** 그 사실이 남는다', () => {
  const a = connect('127.0.0.1', 'site-a')
  connect('127.0.0.1', 'site-b')
  const 전 = { 무창: sse.무창사건수(), 담당: sse.담당바뀜수() }
  assert.equal(마지막소유(a).tabId, 'site-a', '긍정 앵커 — 먼저 붙은 창이 담당이다')

  a._close()                                   // **소리를 내던 창**만 닫힌다
  const 후 = { 무창: sse.무창사건수(), 담당: sse.담당바뀜수() }
  assert.equal(sse.localAliveCount(), 1, '남은 창이 있어야 이 시험이 뜻이 있다')
  assert.equal(후.무창, 전.무창,
    '창 수로는 아무 일도 안 일어난 것으로 보인다 — 그래서 담당을 따로 세는 것이다')
  assert.ok(후.담당 > 전.담당,
    '담당이 바뀐 것을 아무도 안 센다 — 재생하던 창이 닫혀도 방송이 성공으로 기록된다')
})

test('담당이 그대로면 **안 센다** — 멀쩡한 방송을 실패로 적지 않는다', () => {
  connect('127.0.0.1', 'site-a')
  const 전 = sse.담당바뀜수()
  connect('192.168.0.9', 'remote')            // 원격이 붙어도 담당은 그대로다
  assert.equal(sse.담당바뀜수(), 전,
    '원격 창이 붙었다고 담당이 바뀐 것으로 센다 — 멀쩡한 방송이 실패로 적힌다')
})

// ── **띠가 누를 수 있어야 한다** (현장 지적 2026-09-15) ──────────────────────
// 띠는 *"localhost 를 여세요"* 라고 **말만** 했다. 그런데 현장 PC 에서 랜 주소로 연
// 창에서는 그 한 줄이 **주소를 손으로 옮겨 치라는 뜻**이 된다.
// 그날 실제로 그 상황이 났다 — 바탕화면에 「홈 화면에 추가」로 만든 아이콘이 랜 주소였고,
// 그 창이 현장 PC 에서 소리를 못 내고 있었다. 사람이 띠를 읽고도 뭘 눌러야 할지 몰랐다.
test('띠에 **localhost 를 여는 단추**가 있다', () => {
  // 이 파일은 SSE 신호를 보는 곳이라 fs·path 를 안 쓴다 — 이 시험에서만 부른다.
  const fs   = require('node:fs')
  const path = require('node:path')
  const 소스 = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'SiteScreenWarning.jsx'), 'utf8')
  const 코드만 = 소스.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드만, /href="http:\/\/localhost:3001"/,
    '띠가 localhost 로 가는 링크를 안 준다 — 사람이 주소를 손으로 쳐야 한다')

  // ── **단추는 통하는 창에만 보여야 한다** (사용자 지적 2026-09-15) ──────────────
  // 이 띠는 **원격 창에만** 뜬다. 그래서 단추를 늘 보여 주면 **직원 폰에도 보이는데**,
  // 폰에서 누르면 그 폰의 localhost 라 아무 데도 안 닿는다.
  // 서버가 「같은 기계인가」를 알려 주고, 같을 때만 단추를 낸다.
  assert.match(코드만, /같은기계 \?/,
    '단추가 조건 없이 늘 보인다 — 원격 기기에서 눌러도 아무 데도 안 닿는다')
  assert.match(코드만, /지금 보시는 기기에서는 해결할 수 없습니다/,
    '같은 기계가 아닐 때 무엇을 해야 하는지 안 적고 있다')
})

test('**서버가 「같은 기계인가」를 붙는 창에 알려 준다** — 화면은 스스로 못 안다', () => {
  // 랜 주소로 열면 그 창은 **자기도 원격으로 보인다.** 서버만 연결 주소로 가를 수 있다.
  const fs   = require('node:fs')
  const path = require('node:path')
  const 소스 = fs.readFileSync(path.join(__dirname, '..', 'services', 'sse.js'), 'utf8')
  const 코드만 = 소스.replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드만, /sameMachine: 같은기계인가\(req\)/,
    '붙는 창에 sameMachine 을 안 실어 보낸다')
  // **판정은 밖에서 넣는다.** `sse.js` 는 아무 모듈도 require 하지 않는 순수 전송 계층이라
  // 여기서 `os` 를 부를 수 없다(배선도 ③). 처음에 그렇게 썼다가 가드에 걸렸고 **가드가
  // 옳았다** — `setSoundGate` 와 같은 모양으로 고쳤다.
  assert.match(코드만, /function set같은기계판정\(fn\)/,
    '판정을 밖에서 넣을 자리가 없다 — sse.js 가 os 를 직접 부르게 된다')
  const EV = fs.readFileSync(path.join(__dirname, '..', 'routes', 'events.js'), 'utf8')
  assert.match(EV, /set같은기계판정\(/, '배선하는 곳이 없다 — 아무도 판정을 안 넣는다')
  // IPv4-mapped IPv6 로 오는 경우를 안 벗기면 같은 기계를 원격으로 본다.
  assert.match(EV, /::ffff:/,
    'IPv4-mapped IPv6 주소를 안 벗긴다 — 같은 기계가 원격으로 판정된다')
})
