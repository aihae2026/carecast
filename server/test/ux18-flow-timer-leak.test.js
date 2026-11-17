'use strict'
// UX-18 — 흐름이 선점당했을 때 **대기 타이머가 남지 않는다** (2026-09-11).
//
// `broadcastGate` 의 종료 대기는 상한 타이머를 건다(음원 3분 · 영상 15분). 종료 신호가
// 오거나 `cancelAll()` 이 불리면 그 타이머를 걷는다 — **거기까지는 맞게 돼 있다.**
//
// 그런데 흐름(`flowRunner`)에는 **세 번째 길**이 있다. 뒤 단계의 예약 시각(앵커)이
// 지나가면 `isCancelled()` 가 서고, `waitForMediaEnd` 의 경주에서 그쪽이 이긴다.
// 그때 게이트 대기자는 **아무도 안 깨운다** — 상한까지 타이머와 Map 항목이 남는다.
//
// 한 번이면 3분이다. 그런데 현장 PC 는 **수 개월 무중단**으로 돌고(PROJECT_PROFILE §3 J
// "타이머 중복"), 흐름은 하루에 여러 번 돈다. 게다가 같은 토큰이 다시 쓰이면 앞의 `done`
// 이 **타이머를 안 걷은 채** 덮어써져, 그 타이머는 상한을 다 채운다.
const test = require('node:test')
const assert = require('node:assert/strict')
const gate = require('../services/broadcastGate')

// 지금 살아 있는 타이머 수. Node 18+ 가 제공한다 — 가짜 시계나 내부 들여다보기 없이
// **실제로 남았는지**를 본다.
const 타이머수 = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length

test('선점으로 대기를 떠나면 그 대기 타이머를 걷을 수 있다', async () => {
  const 시작 = 타이머수()
  const 토큰 = gate.newBroadcastToken()
  const gen = gate.cancelGeneration()

  // 흐름이 재생을 지시하고 종료를 기다리기 시작한다(상한 60초).
  const 대기 = gate.waitForAudioEnd(토큰, 60000, gen)
  await new Promise(r => setImmediate(r))
  assert.ok(타이머수() > 시작, '대기 타이머가 안 걸렸다 — 이 시험이 성립하지 않는다')

  // 앵커가 지나 흐름이 이 대기를 버리고 다음 단계로 간다.
  // **버린 대기를 거둘 길이 있어야 한다.**
  assert.equal(typeof gate.releaseAudioWait, 'function',
    '버린 대기를 거둘 길이 없다 — 상한까지 타이머가 남는다')
  gate.releaseAudioWait(토큰)

  assert.equal(await 대기, 'released', '거둔 대기가 다른 이유로 깨어났다')
  await new Promise(r => setImmediate(r))
  assert.equal(타이머수(), 시작, '거뒀는데도 타이머가 남아 있다')
})

test('영상 쪽도 같은 길을 갖는다 — 한쪽만 고치면 15분짜리가 남는다', async () => {
  // 이 파일의 머리말이 적어 둔 그대로다: 예전에 상한 타이머 정리를 영상에만 넣어
  // 음원 쪽이 남았던 적이 있다. 같은 실수를 반대 방향으로 하지 않는다.
  assert.equal(typeof gate.releaseVideoWait, 'function', '영상 대기를 거둘 길이 없다')
  const 시작 = 타이머수()
  const 토큰 = gate.newBroadcastToken()
  const 대기 = gate.waitForVideoEnd(토큰, 60000, gate.cancelGeneration())
  await new Promise(r => setImmediate(r))
  gate.releaseVideoWait(토큰)
  assert.equal(await 대기, 'released')
  await new Promise(r => setImmediate(r))
  assert.equal(타이머수(), 시작, '영상 대기 타이머가 남았다')
})

test('거둔 뒤에 늦은 종료 신호가 와도 아무 일이 없다', async () => {
  // 화면이 보낸 `audio-ended` 가 늦게 도착할 수 있다. 거둔 대기를 다시 깨우면
  // 흐름이 이미 다음 단계로 갔는데 앞 단계가 "끝났다"고 말하는 셈이 된다.
  const 토큰 = gate.newBroadcastToken()
  const 대기 = gate.waitForAudioEnd(토큰, 60000, gate.cancelGeneration())
  gate.releaseAudioWait(토큰)
  assert.equal(await 대기, 'released')
  gate.notifyAudioEnded(토큰)   // 늦은 신호 — 던지지 않아야 한다
})

// Codex 가 잡은 둘(EV-004582).
test('같은 토큰으로 두 번 기다려도 앞 타이머가 고립되지 않는다', async () => {
  const 시작 = 타이머수()
  const 토큰 = gate.newBroadcastToken()
  const 첫째 = gate.waitForAudioEnd(토큰, 60000, gate.cancelGeneration())
  await new Promise(r => setImmediate(r))
  // 같은 토큰으로 또 등록한다. 그냥 덮어쓰면 첫째의 타이머가 상한까지 살아남는다.
  const 둘째 = gate.waitForAudioEnd(토큰, 60000, gate.cancelGeneration())
  await new Promise(r => setImmediate(r))
  assert.equal(await 첫째, 'released', '앞 대기를 안 거두고 덮어썼다')

  gate.releaseAudioWait(토큰)
  assert.equal(await 둘째, 'released')
  await new Promise(r => setImmediate(r))
  assert.equal(타이머수(), 시작, '타이머가 남았다 — 상한까지 산다')
})

test('앞 대기를 거둬도 **뒤에 선 대기**는 살아 있다 — 무조건 지우면 안 된다', async () => {
  const 토큰 = gate.newBroadcastToken()
  const 첫째 = gate.waitForAudioEnd(토큰, 60000, gate.cancelGeneration())
  await new Promise(r => setImmediate(r))
  const 둘째 = gate.waitForAudioEnd(토큰, 60000, gate.cancelGeneration())
  await 첫째   // 첫째가 물러나며 Map 을 통째로 지우면 둘째가 미아가 된다
  gate.notifyAudioEnded(토큰)
  assert.equal(await 둘째, 'ended', '뒤에 선 대기가 종료 신호를 못 받았다 — 상한까지 잔다')
})

test('TTS 합성 도중 정지를 누르면 **재생 지시가 안 나간다**', () => {
  // 합성은 옛 인터넷 합성 엔진 를 부르는 네트워크 일이라 초 단위다. 그 사이에 누른 정지를 안 보면
  // 합성이 끝나는 순간 방송이 시작된다 — 사용자 STOP 을 무시하는 것이다.
  const fs = require('node:fs')
  const path = require('node:path')
  const FR = fs.readFileSync(path.join(__dirname, '..', 'services/flowRunner.js'), 'utf8')
  const 구간 = FR.slice(FR.indexOf("step.step_type === 'tts'"), FR.indexOf("step.step_type === 'bgm'"))
  assert.ok(구간.length > 500, 'TTS 단계를 못 찾았다 — 이 가드를 옮길 것')

  const 합성 = 구간.indexOf('generateTTSWithRetry')
  const 검사 = 구간.indexOf('합성전세대')
  const 발송 = 구간.indexOf("broadcastSSE('scheduled_broadcast'")
  assert.ok(검사 > -1, '합성 전 세대를 안 읽는다 — 합성 중 정지를 못 본다')
  assert.ok(검사 < 합성, '세대를 합성 **뒤**에 읽는다 — 그때는 이미 취소가 지나간 뒤다')
  assert.match(구간.slice(합성, 발송), /gate\.cancelGeneration\(\) !== 합성전세대/,
    '합성과 발송 사이에 취소 확인이 없다 — 한 번 나간 SSE 는 회수할 수 없다')
  // 사람이 눌렀을 때와 앵커에 밀렸을 때를 **갈라야** 한다. 앵커에서 흐름을 통째로
  // 멈추면 남은 단계가 사라진다.
  assert.match(구간.slice(합성, 발송), /wasHumanStopSince/,
    '정지와 앵커를 안 가른다 — 앵커에 밀렸을 뿐인데 남은 단계가 통째로 사라진다')
})

test('흐름이 선점당하면 실제로 그 길을 부른다 — 배선', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const FR = fs.readFileSync(path.join(__dirname, '..', 'services/flowRunner.js'), 'utf8')
  // 긍정 앵커 — 감시할 자리가 이 파일에 있다.
  assert.match(FR, /async function waitForMediaEnd/, '대기 함수를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(FR, /release(Audio|Video)Wait|거두기/,
    '선점으로 대기를 떠나면서 게이트 대기를 안 거둔다 — 상한까지 타이머가 남는다')
})
