'use strict'
// **서버 스피커로 차임을 못 내면 방송 화면(브라우저)이 대신 울리고, 방송 로그에 남긴다** (사용자 결정 2026-09-26, TODO T-36 ③)
//
// 파이썬 차임은 장치를 못 열면 exit 0 으로 끝나 **소리 없이 성공**이 됐다. 주석은 「브라우저가 울린다」였지만 브라우저 수신은
// 꺼져 있었다(MusicPlayer 의 chime_play 수신 주석 처리). 이제 장치 못 엶은 exit 3 이고, 서버는 현장 대표 창에
// `chime_fallback_play` 를 보내 울리게 하며, 그 사실을 방송 로그(시스템)에 한 줄 남긴다. 창이 없으면 실패로 남긴다.
// 스피커·파이썬은 안 쓴다 — sse·sitePlayer 를 가짜로 바꾸고 임시 DB 를 쓴다.
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const dbPath = path.join(os.tmpdir(), `carecast_test_chime_fallback_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = dbPath
process.env.CARECAST_NO_HARDWARE = '1'
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*#.*$/gm, '')

// 2026-09-26 Codex 교차검수(T36) High: 처음엔 「현장 연결이 있나」(hasSitePlayer)만 봤는데, 그 수에는 MusicPlayer 가 없는
// /monitor 창도 들어가고 전달 실패(0건)도 성공이 됐다. 그래서 **소리 담당 창**(sse.soundOwner — 탭 id 를 보낸 살아 있는 현장 창)과
// **실제 전달 수**를 함께 본다. 가짜 sse 가 셋을 따로 흉내 낸다.
const 보낸것 = []
let 담당 = 'tab-1', 소리됨 = true, 전달수 = 1
const 끼우기 = (이름, exports) => { const p = require.resolve(이름); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
// 2회차: 판정은 대표 창 하나로 한다(sse.담당에게보내기) — 진짜 sse 로 하는 시험은 chime-fallback-owner.test.js. 여기 가짜는
// 그 함수가 「담당 있음 · 소리 가능 · 실제 전송」 셋을 함께 답한다고 보고 흉내 낸다.
끼우기('../services/sse', {
  broadcastSSE: (type, data) => { 보낸것.push({ type, data }); return 전달수 },
  담당에게보내기: (type, data) => { if (!담당 || !소리됨) return false; 보낸것.push({ type, data }); return 전달수 > 0 },
  soundOwner: () => 담당,
  소리낼수있는창수: () => (소리됨 ? 1 : 0),
})
끼우기('../services/sitePlayer', { hasSitePlayer: () => true, 소리낼수있나: () => 소리됨, 무창사건수: () => 0, 담당바뀜수: () => 0 })
const 창상태 = (d, s, n) => { 담당 = d; 소리됨 = s; 전달수 = n }

const { initDB, getDB } = require('../db/schema')
const { __test__ } = require('../services/chimePlayer')
test.before(() => initDB())
test.after(() => { try { getDB().close() } catch { /* 이미 닫힘 */ } for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + s) } catch { /* 없음 */ } })
const 마지막줄 = () => getDB().prepare('SELECT type, content, success, fail_reason FROM broadcasts ORDER BY id DESC LIMIT 1').get()

test('장치를 못 열었는데 현장 창이 있으면 — 화면으로 울리라고 보내고, 성공 + 「화면으로 대신 울림」을 로그에 남긴다', async () => {
  창상태('tab-1', true, 1); 보낸것.length = 0
  let 결과 = null, 시작 = false
  await __test__.장치못엶처리('general', 0.5, (ok) => { 결과 = ok }, () => { 시작 = true })
  assert.deepEqual(보낸것.map((e) => e.type), ['chime_fallback_play'], '화면에 대신 울리라고 안 보냈다')
  assert.equal(결과, true)
  assert.equal(시작, true, '화면이 울렸는데 시작 신호를 안 보냈다 — 안내가 기본 대기만 한다')
  const 줄 = 마지막줄()
  assert.equal(줄.success, 1)
  assert.match(줄.content, /화면\(브라우저\)으로 대신 울림/, `로그 문구: ${줄.content}`)
})

for (const [말, 담당값, 소리값, 전달값] of [
  ['소리 낼 현장 창이 아예 없으면', null, false, 0],
  ['/monitor 창만 있어 소리 담당 창이 없으면', null, true, 1],
  ['담당 창이 소리를 못 내는 상태면(자동재생 막힘)', 'tab-1', false, 1],
  ['담당 창은 있는데 이벤트가 한 곳에도 안 갔으면', 'tab-1', true, 0],
]) {
  test(`장치를 못 열었고 ${말} — 실패로 남기고 시작 신호도 안 보낸다(무음을 성공으로 적지 않는다)`, async () => {
    창상태(담당값, 소리값, 전달값); 보낸것.length = 0
    let 결과 = null, 시작 = false
    await __test__.장치못엶처리('general', 0.5, (ok) => { 결과 = ok }, () => { 시작 = true })
    assert.equal(결과, false, '아무 데서도 안 울렸는데 성공으로 알렸다')
    assert.equal(시작, false, '안 울린 차임의 시작 신호를 보냈다')
    const 줄 = 마지막줄()
    assert.equal(줄.success, 0)
    assert.match(줄.content, /울리지 못함/, `로그 문구: ${줄.content}`)
    assert.equal(줄.fail_reason, require('../domain/broadcastRecord').사유.화면없음)
  })
}

// 같은 교차검수 Medium: 화면 차임이 서버가 보낸 볼륨·종류를 버려 볼륨 0 에도 최대 음량, 시작음·종료음이 같았다.
// 브라우저 합성 함수를 가짜 AudioContext 로 **실제로 돌려** 본다. 인자 없는 기존 호출(미리듣기)은 예전 소리 그대로여야 한다.
test('화면 차임은 서버가 보낸 볼륨·종류를 따른다 — 볼륨 0 은 무음, 시작음·종료음은 파이썬과 같은 음 순서', async () => {
  const 기록 = []
  global.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {} }
    createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start() { 기록.push({ f: o.frequency.value }) }, stop() {} }; return o }
    createGain() { const g = { gain: { setValueAtTime() {}, linearRampToValueAtTime: (v) => 기록.push({ 게인: v }), exponentialRampToValueAtTime() {} }, connect() {} }; return g }
  }
  const { playBrowserChime } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'src', 'lib', 'browserChime.js')).href)
  const 최대게인 = () => Math.max(0, ...기록.filter((x) => '게인' in x).map((x) => x.게인))
  const 기본음들 = () => 기록.filter((x) => 'f' in x).map((x) => Math.round(x.f))

  기록.length = 0; playBrowserChime({ type: 'general', volume: 0 })
  assert.equal(기록.length, 0, '볼륨 0 인데 소리를 만들었다')

  기록.length = 0; playBrowserChime({ type: 'general', volume: 100 }); const 크게 = 최대게인()
  기록.length = 0; playBrowserChime({ type: 'general', volume: 10 }); const 작게 = 최대게인()
  assert.ok(작게 > 0 && 작게 < 크게 / 5, `볼륨 10 과 100 의 크기가 같다: ${작게} vs ${크게}`)

  기록.length = 0; playBrowserChime({ type: 'general', volume: 80 })
  const 올림 = 기본음들().filter((f) => [523, 659, 784].includes(f))
  기록.length = 0; playBrowserChime({ type: 'end', volume: 80 })
  const 내림 = 기본음들().filter((f) => [523, 659, 784].includes(f))
  assert.deepEqual(올림, [523, 659, 784], `시작음이 파이썬(도·미·솔)과 다르다: ${올림}`)
  assert.deepEqual(내림, [784, 659, 523], `종료음이 파이썬(솔·미·도)과 다르다: ${내림}`)

  기록.length = 0; playBrowserChime()   // 인자 없는 기존 호출 — 예전 두 음(미·도) 그대로
  assert.deepEqual(기본음들().filter((f) => [523, 659].includes(f)), [659, 523], '미리듣기 차임 소리가 바뀌었다')
  delete global.AudioContext
})

test('파이썬은 장치를 못 열면 exit 3 이고, 서버는 그 코드를 대신 울리기로 보낸다', () => {
  const py = 코드만(읽기('server/services/carecast_chime.py'))
  const 열기 = py.indexOf('waveOutOpen(')
  assert.ok(열기 > 0, '장치 여는 줄 — 대상 앵커')
  assert.match(py.slice(열기, 열기 + 300), /if r != 0:\s*\r?\n\s*sys\.exit\(3\)/, '장치를 못 열어도 exit 3 이 아니다 — 서버가 무음을 모른다')
  const cp = 코드만(읽기('server/services/chimePlayer.js'))
  const 재생 = cp.slice(cp.indexOf('function playViaWaveOut('), cp.indexOf('function cachedWavPath('))
  assert.match(재생, /code === 장치못엶코드[\s\S]*?장치못엶처리\(/, 'exit 3 을 대신 울리기로 안 보낸다')
})

test('화면은 현장 대표 창만 대신 울리고, 드라이런은 그것도 막는다', () => {
  const mp = 코드만(읽기('src/components/easy/MusicPlayer.jsx'))
  const 시작 = mp.indexOf("addEventListener('chime_fallback_play'")
  assert.ok(시작 > 0, '화면이 대신 울리기 이벤트를 안 받는다')
  const 본문 = mp.slice(시작, 시작 + 300)
  assert.match(본문, /if \(!window\.CC_IS_LEADER \|\| !_IS_LOCAL\) return/, '대표 창·현장 PC 가 아니어도 울린다 — 창마다 겹쳐 울린다')
  assert.match(본문, /playBrowserChime\(\{ type: d\.type, volume: d\.volume \}\)/, '받고도 울리지 않거나 서버가 보낸 종류·볼륨을 버린다')
  assert.ok(require('../services/hardwareMode').소리이벤트.has('chime_fallback_play'), '드라이런 중에도 화면 차임이 울린다')
})
