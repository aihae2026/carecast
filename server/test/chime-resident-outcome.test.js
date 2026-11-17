'use strict'
// **상주 플레이어로 낸 차임도 실패를 실패로 알린다** (2026-09-26 Codex 통합 검수 SOLO-0918 High 둘)
//
// ① 차임을 상주 플레이어에 넘기면 결과와 무관하게 3.7초 뒤 성공을 알렸다. 그 사이 플레이어가 죽거나
//    (장치 설정 변경으로 내려감) 파이썬이 PLAY_ERROR 를 내도 예약 로그는 성공이었다 — 이 저장소가
//    가장 비싸게 데인 「무음인데 기록은 멀쩡」이다. 그래서 그 창 안의 사고 수를 견준다.
// ② 지연 기동이 장치 캐시를 안 데우고 떠서, 장치를 바꾼 직후의 차임·마이크가 기본 스피커를 물고
//    서버가 사는 내내 그대로였다. 부팅과 같은 「데우기 → 기동」 한 곳으로 모은 것을 고정한다.
// 스피커·파이썬은 쓰지 않는다 — 상주 플레이어를 가짜로 바꿔 끼운다.
process.env.CARECAST_NO_HARDWARE = '1'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let 사고 = 0
const 가짜 = { playPcm16: () => true, 재생사고수: () => 사고, playChunk: () => false, stop: () => false, stopIfStreaming: () => false }
const 경로 = require.resolve('../services/audioPlayer')
require.cache[경로] = { id: 경로, filename: 경로, loaded: true, exports: 가짜 }
const { __test__ } = require('../services/chimePlayer')

const 파형 = path.join(os.tmpdir(), 'carecast_chime_pcm_residenttest_050.raw')
test.before(() => fs.writeFileSync(파형, Buffer.alloc(Math.round(44100 * 3.5) * 2)))
test.after(() => { try { fs.unlinkSync(파형) } catch { /* 없으면 그만 */ } })

const 울려보기 = (도중에) => new Promise((r) => {
  const 넘김 = __test__.상주로울리기('residenttest', 0.5, (ok) => r({ 넘김, ok }))
  if (도중에) setTimeout(도중에, 500)
})

test('상주 플레이어가 차임 도중 아무 일 없으면 성공으로 알린다', async () => {
  const { 넘김, ok } = await 울려보기(null)
  assert.equal(넘김, true, '파형을 상주 플레이어로 넘기지 않았다 — 이 시험의 전제')
  assert.equal(ok, true)
})

test('차임 도중 상주 플레이어가 죽거나 PLAY_ERROR 를 내면 실패로 알린다 — 무음을 성공으로 적지 않는다', async () => {
  const { 넘김, ok } = await 울려보기(() => { 사고 += 1 })
  assert.equal(넘김, true)
  assert.equal(ok, false, '도중에 플레이어 사고가 났는데 차임을 성공으로 알린다')
})

test('상주 플레이어는 사고 수를 센다 — 종료와 PLAY_ERROR 둘 다', () => {
  const ap = fs.readFileSync(path.join(__dirname, '..', 'services', 'audioPlayer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const 닫힘 = ap.slice(ap.indexOf("playerProc.on('close'"), ap.indexOf("playerProc.on('close'") + 200)
  assert.match(닫힘, /_사고수\s*\+=\s*1|_사고수\+\+/, '플레이어 종료를 사고로 세지 않는다')
  assert.match(ap, /startsWith\('PLAY_ERROR'\)[^\n]*_사고수/, 'PLAY_ERROR 를 사고로 세지 않는다')
  assert.match(ap, /module\.exports = \{[^}]*재생사고수/, '사고 수를 밖에 알리지 않는다')
})

test('지연 기동은 장치 캐시를 데운 뒤에 뜬다 — 장치를 바꾼 직후 차임·마이크가 기본 스피커를 물지 않는다', () => {
  const ap = fs.readFileSync(path.join(__dirname, '..', 'services', 'audioPlayer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(ap, /function 데우고기동\(\)[\s\S]*?warmDeviceCache\(\)[\s\S]*?startPlayer\(\)/, '데운 뒤 띄우는 한 곳이 없다')
  for (const 함수 of ['function playChunk(', 'function playPcm16(']) {
    const 시작 = ap.indexOf(함수)
    assert.ok(시작 > 0, `${함수} 를 못 찾았다 — 대상 앵커`)
    // 함수 끝 = 줄 맨 앞의 `}`. 작업 사본이 CRLF 일 수 있어 \r? 를 둔다(LF 로만 찾으면 파일 끝까지 잘린다).
    const 끝 = ap.slice(시작).search(/\r?\n\}\r?\n/)
    assert.ok(끝 > 0, `${함수} 의 끝을 못 찾았다`)
    const 본문 = ap.slice(시작, 시작 + 끝)
    assert.match(본문, /데우고기동\(\)/, `${함수} 가 데우지 않고 띄운다`)
    assert.doesNotMatch(본문, /startPlayer\(\)/, `${함수} 가 캐시를 안 데우고 바로 startPlayer 를 부른다`)
  }
})

// 2026-09-26 Codex 교차검수: 상주 차임이 울리는 중에 두 번째 차임을 넘기면 파이썬이 같은 핸들에 **줄 세워**
// 앞 차임이 끝난 뒤에야 울린다. 그런데 판정은 둘 다 넘긴 뒤 3.7초에 끝나, 뒤 차임 재생 중의 사고를 못 봤다(1회차 High).
// 1회차에는 두 번째를 예전 길(파이썬 새로 띄움)로 돌렸는데, 그 길은 장치를 못 열어도 exit 0 이라 **울리지 않은 차임을
// 성공으로 적었다**(2회차 High). 줄 뒤에 세우자 늦은 실패를 흐름이 못 받고, 줄이 길면 안내가 차임보다 먼저 나갔다(3회차).
// **사용자 결정(2026-09-26, 안 가)**: 울리는 중이면 두 번째는 울리지 않고 **바로 실패**로 알린다. 흐름이 결과를 확정하기 전에 닿는다.
test('상주 차임이 울리는 중에 온 두 번째 차임은 울리지 않고 곧바로 실패로 알린다 (사용자 결정 가)', async () => {
  const 첫 = new Promise((r) => { __test__.상주로울리기('residenttest', 0.5, (ok) => r(ok)) })
  // **두 번째를 넘기는 순간부터** 잰다(2026-10-07). 예전엔 첫 차임을 띄우기 전에 찍어, 첫 차임의 동기 준비(파형 읽기·
  // 플레이어 기동)까지 두 번째의 지연으로 셌다 — 전체 verify 에서 745·944ms 로 빨갛고 단독에선 통과했다.
  const 시작 = Date.now()
  let 넘김, 시작신호 = false
  const 둘째 = new Promise((r) => { 넘김 = __test__.상주로울리기('residenttest', 0.5, (ok, 안울림) => r({ ok, 안울림, ms: Date.now() - 시작 }), () => { 시작신호 = true }) })
  assert.equal(넘김, true, '겹친 차임을 예전 길로 넘긴다 — 그 길은 장치 실패를 성공으로 적는다')
  const b = await 둘째
  assert.equal(b.ok, false, '겹쳐서 안 울린 차임을 성공으로 적었다')
  assert.ok(b.ms < 500, `겹침 실패를 ${b.ms}ms 뒤에야 알렸다 — 흐름이 결과를 먼저 확정한다`)
  assert.equal(시작신호, false, '안 울린 차임의 시작 신호를 보냈다 — 안내가 그 신호를 기다린다')
  assert.equal(await 첫, true, '앞 차임은 그대로 울려야 한다')
  // 앞 차임이 끝나면 다시 울린다
  const 다음 = await new Promise((r) => { const n = __test__.상주로울리기('residenttest', 0.5, (ok) => r({ n, ok })) })
  assert.equal(다음.n, true); assert.equal(다음.ok, true, '앞 차임이 끝난 뒤의 차임까지 실패로 막았다')
})

// 흐름 실행기는 `차임뒤대기` 가 끝난 **직후** 결과(played)를 읽어 확정한다(flowRunner.js 의 차임 단계).
// 겹침 실패가 그보다 늦게 오면 「결과 모름」이 되어 연속 실패 집계에서 빠진다(Codex 3회차 High). 그 순서를 실제 대기 함수로 본다.
test('겹침 실패는 흐름이 결과를 읽는 순간(차임뒤대기 끝)보다 먼저 도착한다', async () => {
  const { 차임시작표지, 차임뒤대기 } = require('../services/chimeTiming')
  const 앞 = new Promise((r) => { __test__.상주로울리기('residenttest', 0.5, () => r()) })   // 울리는 중으로 만든다
  const 표지 = 차임시작표지(), t0 = Date.now()
  let played = null
  const 신호옴 = __test__.상주로울리기('residenttest', 0.5, (ok) => { played = ok; 표지.끝남() }, 표지.onStart)
  await 차임뒤대기({ 신호옴, 표지, t0, 기본ms: 3000, 잠자기: async () => {} })
  assert.equal(played, false, `흐름이 결과를 읽는 순간 played=${played} — 겹침 실패가 늦어 「모름」으로 기록된다`)
  await 앞
})
