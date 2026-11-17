'use strict'
// **누르고 말하기 — 신호가 있는 마이크를 고른다** (사용자 신고 2026-09-18).
// 노트북 기본 녹음 장치가 소리 없는 장치로 잡혀 차임만 나가고 목소리는 안 나갔다(서버 로그에 청크 0줄).
// 실제 마이크·브라우저 없이 가짜 장치로 규칙만 본다.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..', '..')
let 모듈
test.before(async () => { 모듈 = await import(pathToFileURL(path.join(ROOT, 'src/lib/micPick.js')).href) })

/** 장치 id → 신호 유무. 'default' 는 기본 장치로 열린다. */
function 가짜(장치들, 기본id) {
  const 열린것 = []
  const md = {
    async getUserMedia({ audio }) {
      const id = audio?.deviceId?.exact ?? 기본id
      if (!(id in 장치들)) throw Object.assign(new Error('없음'), { name: 'OverconstrainedError' })
      const 멈춤 = { v: false }
      const s = { id, 멈춤, getTracks: () => [{ stop: () => { 멈춤.v = true } }], getAudioTracks: () => [{ getSettings: () => ({ deviceId: id }) }] }
      열린것.push(s)
      return s
    },
    async enumerateDevices() {
      return [{ kind: 'audioinput', deviceId: 'default' }, ...Object.keys(장치들).map((deviceId) => ({ kind: 'audioinput', deviceId, label: deviceId }))]
    },
  }
  const 저장 = new Map()
  const 저장소 = { getItem: (k) => (저장.has(k) ? 저장.get(k) : null), setItem: (k, v) => 저장.set(k, v), removeItem: (k) => 저장.delete(k) }
  const 재기 = async (s) => 장치들[s.id]
  return { md, 저장소, 재기, 저장, 열린것 }
}

test('기본 장치가 신호 있으면 그대로 쓴다 — 다른 장치를 건드리지 않는다', async () => {
  const f = 가짜({ 진짜마이크: true, 스테레오믹스: false }, '진짜마이크')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '진짜마이크')
  assert.equal(f.열린것.length, 1)
  assert.equal(f.저장.size, 0)
})

test('기본 장치가 완전 무음이면 **신호 있는 마이크로 바꾸고 기억한다** · 무음 스트림은 닫는다', async () => {
  const f = 가짜({ 스테레오믹스: false, 가상오디오: false, 진짜마이크: true }, '스테레오믹스')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '진짜마이크')
  assert.equal(f.저장.get(모듈.마이크키), '진짜마이크')
  assert.ok(f.열린것.filter((x) => x.id !== '진짜마이크').every((x) => x.멈춤.v), '버린 마이크를 안 닫았다 — 켜진 채 남는다')
})

test('다음번에는 **기억한 마이크부터** 연다', async () => {
  const f = 가짜({ 스테레오믹스: false, 진짜마이크: true }, '스테레오믹스')
  f.저장소.setItem(모듈.마이크키, '진짜마이크')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '진짜마이크')
  assert.equal(f.열린것.length, 1)
})

test('기억한 마이크가 빠졌으면 기본 장치로 연다 · 전부 무음이면 처음 것을 그대로 쓴다(방송은 막지 않는다)', async () => {
  const f = 가짜({ 스테레오믹스: false }, '스테레오믹스')
  f.저장소.setItem(모듈.마이크키, '뽑힌마이크')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '스테레오믹스')
  assert.equal(s.멈춤.v, false, '돌려준 스트림이 닫혀 있다')
})

test('권한 거부는 삼키지 않는다 — 화면이 「마이크 권한이 거부됐습니다」를 말해야 한다', async () => {
  const md = { getUserMedia: async () => { throw Object.assign(new Error('거부'), { name: 'NotAllowedError' }) }, enumerateDevices: async () => [] }
  await assert.rejects(모듈.마이크고르기({ md, 저장소: { getItem: () => null, setItem() {} }, 재기: async () => true }), { name: 'NotAllowedError' })
})

// ── **소리를 되받는 장치를 마이크로 오인하지 않는다** (적대적 검수 2026-09-18) ──────────────
// 스테레오 믹스·가상 오디오 케이블은 **나가는 소리를 그대로 입력으로 준다.** BGM 이나 방송이
// 도는 중이면 신호가 가득해서 무음 검사만으로는 진짜 마이크와 못 가른다. 한 번 뽑히면 기억까지
// 하므로, 그 뒤로는 홀에 사람 목소리 대신 스피커 소리가 되돌아 나간다(하울링).

test('되받는 장치는 **신호가 있어도 안 고른다** — BGM 이 나가는 중이면 신호가 가득하다', async () => {
  // 노트북 마이크가 하드웨어 음소거(무음)이고, 스테레오 믹스에는 BGM 이 흐르는 상황.
  const f = 가짜({ '마이크 배열': false, '스테레오 믹스': true, '라인 입력': true }, '마이크 배열')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '라인 입력', '되받는 장치를 건너뛰고 다음 후보를 골라야 한다')
  assert.equal(f.저장.get(모듈.마이크키), '라인 입력')
})

test('되받는 장치뿐이면 **바꾸지 않는다** — 무음이 낫다(하울링보다)', async () => {
  const f = 가짜({ '마이크 배열': false, 'Stereo Mix': true, 'VoiceMeeter Output': true }, '마이크 배열')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '마이크 배열')
  assert.equal(f.저장.size, 0, '기억하지 않는다')
})

test('예전에 기억해 둔 되받는 장치는 **버리고 다시 고른다** — 스스로 풀린다', async () => {
  const f = 가짜({ '마이크 배열': true, '스테레오 믹스': true }, '마이크 배열')
  f.저장.set(모듈.마이크키, '스테레오 믹스')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '마이크 배열', '기억한 값을 버리고 기본 장치로 가야 한다')
  assert.equal(f.저장.has(모듈.마이크키), false, '기억도 지운다')
})

test('신호를 **못 잰 후보**는 채택하지 않는다 — 기억까지 하는 자리라서다', async () => {
  const f = 가짜({ '마이크 배열': false, '못재는장치': null, '진짜마이크': true }, '마이크 배열')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '진짜마이크')
  assert.equal(f.저장.get(모듈.마이크키), '진짜마이크')
})

test('처음 연 마이크는 **못 쟀다고 버리지 않는다** — 멀쩡한 마이크를 놓치면 안 된다', async () => {
  const f = 가짜({ '마이크 배열': null, '진짜마이크': true }, '마이크 배열')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '마이크 배열')
  assert.equal(f.저장.size, 0)
})

test('되받는장치(): 이름으로 가른다', () => {
  for (const 이름 of ['스테레오 믹스', '스테레오믹스', 'Stereo Mix (Realtek)', 'What U Hear', 'CABLE Output (VB-Audio)', 'VoiceMeeter Output', '루프백 녹음']) {
    assert.equal(모듈.되받는장치(이름), true, 이름)
  }
  for (const 이름 of ['마이크 배열 (Realtek)', 'Microphone (USB Audio)', '헤드셋 마이크', '', null, undefined]) {
    assert.equal(모듈.되받는장치(이름), false, String(이름))
  }
})

test('**기본 장치 자체가 되받는 장치**면 신호가 있어도 다른 마이크를 찾는다', async () => {
  // Windows 기본 녹음 장치가 「스테레오 믹스」로 잡혀 있는 PC. 소리가 흐르니 무음 검사는 통과해 버린다.
  const f = 가짜({ '스테레오 믹스': true, '마이크 배열': true }, '스테레오 믹스')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '마이크 배열')
  assert.equal(f.저장.get(모듈.마이크키), '마이크 배열')
})

test('기본 장치가 되받는 장치인데 **대안이 없으면** 그대로 쓴다 — 방송을 막지 않는다', async () => {
  const f = 가짜({ '스테레오 믹스': true }, '스테레오 믹스')
  const s = await 모듈.마이크고르기(f)
  assert.equal(s.id, '스테레오 믹스')
  assert.equal(f.저장.size, 0, '기억하지는 않는다 — 다음에 다시 찾아본다')
})

test('화면이 이 규칙을 쓴다', () => {
  const src = require('node:fs').readFileSync(path.join(ROOT, 'src/components/easy/InstantBroadcast.jsx'), 'utf8')
  assert.match(src, /import \{ 마이크고르기 \} from '..\/..\/lib\/micPick'/)
  assert.match(src, /const stream = await 마이크고르기\(\)/)
})
