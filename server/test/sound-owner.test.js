// 같은 PC에서 창을 두 개 열면 소리가 겹치던 것 — 소리 담당을 서버가 정한다.
//
// 무엇이 문제였나(2026-08-30, 코치 검토에서 지적된 빈틈):
// 소리 담당(대표 탭) 표시를 브라우저 저장공간(localStorage)에 남기는데, **그 공간은 접속
// 주소마다 분리된다.** 그런데 현장 PC 판정은 호스트 이름만 본다:
//     const _IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
// 그래서 같은 PC에서 `localhost:3001`과 `127.0.0.1:3001`을 각각 열면
//   · 둘 다 "현장 PC"로 인정되고
//   · localStorage가 서로 안 보여서 각자 자기가 담당이라고 믿고
//   · **둘 다 재생한다** → 겹쳐 들린다.
// 개발용 포트(5173)를 같이 띄운 경우도 같은 구조다.
//
// 고치는 방향: **서버가 정한다.** 서버는 이미 어느 연결이 루프백인지 알고 있고(sse.js의
// isLocalRequest, 요청 주소로 판정하므로 아무나 주장할 수 없다), 그 목록은 주소가 갈려도
// 하나다. 브라우저 저장공간을 아예 판단 근거에서 빼면 이 빈틈이 구조적으로 사라진다.
//
// 안전 장치: 탭 id를 안 보내는 옛 화면이 담당이 되면 **아무도 그 사실을 모르고 전부
// 침묵한다.** 그래서 id를 보낸 탭만 담당이 될 수 있게 하고, 후보가 없으면 담당을 비워
// 화면이 예전 방식(localStorage)으로 떨어지게 둔다. 겹쳐 들리는 것보다 무음이 훨씬 나쁘다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const sse = require('../services/sse')

// 가짜 SSE 응답 — 실제 소켓 없이 붙였다 뗐다 한다
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
const 루프백 = (tab) => connect('127.0.0.1', tab)
const 원격   = (tab) => connect('192.168.0.55', tab)

function 전부끊기() {
  for (const r of [...열린것]) { try { r._close() } catch { /* 이미 닫힘 */ } }
  열린것.length = 0
}

test.beforeEach(() => { 전부끊기() })
test.after(() => { 전부끊기() })

// 마지막으로 전파된 소리 담당을 응답 본문에서 읽는다
function 마지막담당(res) {
  const 줄 = [...res.written].reverse().find(w => w.includes('event: sound_owner'))
  if (!줄) return undefined
  return JSON.parse(줄.match(/data: (.*)\n\n$/)[1]).tabId
}

// ── 담당은 하나다 ─────────────────────────────────────────────

test('루프백 탭이 하나면 그 탭이 소리 담당이다', () => {
  루프백('탭A')
  assert.equal(sse.soundOwner(), '탭A')
})

test('주소가 달라도 담당은 하나다 — 이 빈틈이 겹쳐 들리는 원인이었다', () => {
  루프백('탭A')                          // localhost로 연 창
  const b = connect('::1', '탭B')        // 127.0.0.1(IPv6 루프백)로 연 창
  assert.equal(sse.soundOwner(), '탭A', '먼저 붙은 쪽이 계속 담당이어야 한다')
  assert.equal(마지막담당(b), '탭A', '뒤에 붙은 창은 자기가 담당이 아님을 알아야 한다')
})

test('탭이 더 붙어도 담당을 뺏지 않는다 — 재생이 창을 옮겨 다니면 소리가 끊긴다', () => {
  루프백('탭A'); 루프백('탭B'); 루프백('탭C')
  assert.equal(sse.soundOwner(), '탭A')
})

// ── 담당이 사라지면 넘겨준다 ──────────────────────────────────

test('담당 창이 닫히면 다음 루프백 탭이 담당이 된다', () => {
  const a = 루프백('탭A')
  const b = 루프백('탭B')
  a._close()
  assert.equal(sse.soundOwner(), '탭B')
  assert.equal(마지막담당(b), '탭B', '새 담당에게 알려주지 않으면 아무도 소리를 안 낸다')
})

test('담당이 아닌 창이 닫히면 담당은 그대로다', () => {
  루프백('탭A')
  const b = 루프백('탭B')
  b._close()
  assert.equal(sse.soundOwner(), '탭A')
})

test('루프백 창이 하나도 없으면 담당이 없다', () => {
  const a = 루프백('탭A')
  a._close()
  assert.equal(sse.soundOwner(), null)
})

// ── 원격은 담당이 될 수 없다 ──────────────────────────────────

test('원격 PC·직원 휴대폰은 담당이 될 수 없다 — 소리는 현장에서만 난다', () => {
  원격('폰1')
  assert.equal(sse.soundOwner(), null, '원격만 붙어 있으면 담당이 없어야 한다')

  루프백('탭A')
  assert.equal(sse.soundOwner(), '탭A')
})

test('담당 판정은 요청 주소로만 한다 — 스스로 현장이라고 주장할 수 없다', () => {
  // 원격이 "나 현장이야"라고 우겨도 목록에 못 들어간다(sse.isLocalRequest가 소켓 주소를 본다)
  const 우김 = { socket: { remoteAddress: '192.168.0.55' }, query: { tab: '위장', local: '1' } }
  const res = fakeRes()
  sse.addClient(res, 우김, '위장')
  열린것.push(res)
  assert.equal(sse.soundOwner(), null)
})

// ── 옛 화면 호환 (무음보다 겹침이 낫다) ───────────────────────

test('탭 id를 안 보내는 옛 화면은 담당이 되지 않는다 — 담당인 줄 모르면 전부 침묵한다', () => {
  루프백(null)
  assert.equal(sse.soundOwner(), null,
    '알려줄 수 없는 상대를 담당으로 세우면 아무도 소리를 안 낸다')
})

test('옛 화면과 새 화면이 섞이면 새 화면이 담당이 된다', () => {
  루프백(null)
  루프백('탭B')
  assert.equal(sse.soundOwner(), '탭B')
})

// ── 기존 성질 보존 ────────────────────────────────────────────

test('현장 PC 연결 수 세기는 그대로다', () => {
  루프백('탭A'); 루프백(null); 원격('폰1')
  assert.equal(sse.localClientCount(), 2, '탭 id 유무와 무관하게 현장 연결은 현장 연결이다')
  assert.equal(sse.clientCount(), 3)
})

test('전파는 모든 클라이언트에게 가고 전달 수를 돌려준다', () => {
  루프백('탭A'); 원격('폰1')
  assert.equal(sse.broadcastSSE('테스트', {}), 2)
})

// ── 담당이 살아 있는지 서버가 확인한다 (H15, 2026-09-02) ──────
//
// 무엇이 문제였나: **연결이 살아 있는 것과 창이 살아 있는 것은 다르다.** 개발 PC의 Vite
// 프록시는 브라우저를 닫아도 백엔드 쪽 SSE를 안 끊는다. 크롬을 전부 닫고도 localClients가
// 5로 남는 것을 실측했고, 서버는 그 유령 하나를 담당으로 지목했다 — 담당이 세상에 없으니
// **어느 창에서도 소리가 안 났다.** 사용자 신고는 "아침 방송 BGM이 안 난다"였다.
// 현장 PC는 Vite를 안 거치지만, 원격 데스크톱이 죽거나 랜선이 빠지면 똑같이 된다.
//
// 고치는 방향: 창이 **브라우저가 돌고 있어야만 보낼 수 있는 신호**를 주기적으로 보내고,
// 소식이 끊긴 창은 담당 후보에서 뺀다. 아래가 그 규칙을 고정한다.
const 원래시계 = sse._test.now
let 지금 = 1_700_000_000_000
function 시계고정() { 지금 = 1_700_000_000_000; sse._test.now = () => 지금 }
function 시간흐름(ms) { 지금 += ms }
const 제한시간 = sse.ALIVE_TIMEOUT_MS
test.after(() => { sse._test.now = 원래시계 })

test('소식이 끊긴 담당은 살아 있는 창에게 넘어간다 — 유령이 소리를 삼키던 것', () => {
  시계고정()
  루프백('탭A'); const b = 루프백('탭B')
  sse.noteAlive('탭A'); sse.noteAlive('탭B')
  assert.equal(sse.soundOwner(), '탭A', '둘 다 살아 있으면 먼저 붙은 쪽이 담당이다')

  시간흐름(제한시간 + 1)
  sse.noteAlive('탭B')                 // A는 닫혔고(유령), B만 계속 알린다
  assert.equal(sse.soundOwner(), '탭B')
  assert.equal(마지막담당(b), '탭B', '새 담당에게 알려주지 않으면 아무도 소리를 안 낸다')
})

test('살아 있는 담당은 시간이 흘러도 안 뺏긴다 — 담당이 옮겨 다니면 소리가 끊긴다', () => {
  시계고정()
  루프백('탭A'); 루프백('탭B')
  for (let i = 0; i < 5; i++) {
    시간흐름(60_000)                    // 가려진 창은 1분에 한 번까지 눌린다 — 그래도 살아 있다
    sse.noteAlive('탭A'); sse.noteAlive('탭B')
  }
  sse.recheckOwner()
  assert.equal(sse.soundOwner(), '탭A')
})

test('아무도 소식이 없으면 담당을 비운다 — 없는 창을 담당으로 두는 것이 무음의 원인이었다', () => {
  시계고정()
  const a = 루프백('탭A')
  sse.noteAlive('탭A')
  assert.equal(sse.soundOwner(), '탭A')

  시간흐름(제한시간 + 1)
  sse.recheckOwner()                    // 순찰(15초마다)이 하는 일
  assert.equal(sse.soundOwner(), null)
  assert.equal(마지막담당(a), null, '담당이 없어진 것도 화면에 알려야 한다')
})

test('유령이 담당인 채로 새 창이 붙으면 담당이 새 창으로 온다 — 2026-09-02 사고 재현', () => {
  시계고정()
  루프백('유령')                        // Vite가 안 끊어 준 죽은 창
  sse.noteAlive('유령')
  시간흐름(제한시간 + 1)

  const b = 루프백('탭B')               // 사람이 크롬을 새로 열었다
  sse.noteAlive('탭B')
  assert.equal(sse.soundOwner(), '탭B', '유령이 담당이면 새 창은 소리를 안 낸다')
  assert.equal(마지막담당(b), '탭B')
})

test('창이 닫히며 남긴 인사는 그 자리에서 담당을 넘긴다', () => {
  시계고정()
  루프백('탭A'); 루프백('탭B')
  sse.noteAlive('탭A'); sse.noteAlive('탭B')

  assert.equal(sse.forgetClient('탭A'), true)
  assert.equal(sse.soundOwner(), '탭B', '90초를 기다릴 것 없이 바로 넘어가야 한다')
  assert.equal(sse.localClientCount(), 1, '인사하고 간 연결은 목록에서도 빠진다')
})

test('원격 PC의 생존 신호는 담당을 만들지 않는다 — 소리는 현장에서만 난다', () => {
  시계고정()
  원격('폰1')
  sse.noteAlive('폰1')
  assert.equal(sse.soundOwner(), null)
})

test('현장 연결 수와 살아 있는 수를 따로 센다 — 둘이 다르면 유령이 쌓인 것이다', () => {
  시계고정()
  루프백('탭A'); 루프백('탭B')
  sse.noteAlive('탭A'); sse.noteAlive('탭B')
  assert.equal(sse.localClientCount(), 2)
  assert.equal(sse.localAliveCount(), 2)

  시간흐름(제한시간 + 1)
  sse.noteAlive('탭B')
  assert.equal(sse.localClientCount(), 2, '연결은 그대로 열려 있다(프록시가 안 끊는다)')
  assert.equal(sse.localAliveCount(), 1, '살아 있는 창은 하나뿐이다')
})

// ── 생존 신호를 모르는 옛 화면 (무음보다 겹침이 낫다) ─────────

test('생존 신호를 한 번도 못 받은 서버는 예전 규칙 그대로다', () => {
  시계고정()
  sse._test.reset()                     // 옛 화면만 붙어 있는 서버로 되돌린다
  루프백('탭A')
  시간흐름(제한시간 * 10)
  sse.recheckOwner()
  assert.equal(sse.soundOwner(), '탭A',
    '신호를 보낼 줄 모르는 화면을 죽었다고 보면 담당이 아무도 없어 전부 침묵한다')
})
