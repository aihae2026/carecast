// 자동방송 TTS 대기가 배속(tts_rate)을 따라가는가 (CC-033).
//
// stepTTS는 관리자가 정한 배속(settings.tts_rate)으로 음성을 만들어 놓고, 다음 단계로
// 넘어가기 전 기다릴 시간은 **초당 4.5자 고정**으로 계산한다. 그런데 4.5자/초는 기본 배속
// 0.9를 기준으로 잡은 상수다. 배속을 0.5로 낮추면 음성은 거의 두 배로 길어지는데 대기는
// 그대로라, 다음 단계(투약 안내·영상)가 아직 말하고 있는 목소리 위로 겹친다. 반대로 배속을
// 올리면 아무 소리도 없는 시간이 남는다.
//
// 유효 속도 = 4.5 * (rateVal / 0.9) — 배속에 비례한다. 최소 6000ms와 여유분 +3000ms는 그대로.
//
// 대기 시간을 실제로 기다려서 재면 한 번에 수십 초가 걸리고 부하에 따라 흔들린다(CC-048).
// 그래서 계산만 떼어낸 **순수 함수**를 요구한다 — broadcastSequencer가
//   ttsWaitMs(textLength, rateVal) -> ms
// 를 export하고 stepTTS가 그것을 쓰는 형태다. 여기서는 그 함수를 직접 부른다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttswait_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// 실제 소리가 나지 않도록 SSE를 스텁한다(broadcastSequencer require 전에)
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: () => {}, addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const seq = require('../services/broadcastSequencer')

// 2026-09-01: 단계 실행기(stepTTS·stepPrayerTTS·stepAudioFile)는 broadcastSteps.js로 옮겼다.
// seq.ttsWaitMs는 시퀀서가 그대로 재수출하므로 위 require는 그대로다.
const SEQ_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSteps.js'), 'utf8')
// stepTTS 본문만 잘라 본다 — stepPrayerTTS는 배속을 자체 고정(0.80)하는 별개 규칙이라
// 같이 보면 안 된다.
function stepTTSBody() {
  const from = SEQ_SRC.indexOf('async function stepTTS(')
  const to   = SEQ_SRC.indexOf('async function stepPrayerTTS(')
  assert.ok(from >= 0 && to > from, 'stepTTS / stepPrayerTTS를 소스에서 찾지 못했다')
  return SEQ_SRC.slice(from, to)
}

const DEFAULT_RATE = 0.9
const LONG_TEXT_LEN = 90   // 기본 배속에서 20초(=90/4.5)치 — 하한 6000ms에 걸리지 않는 길이

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 함수가 있어야 벽시계 없이 검증할 수 있다 ────────────────────
test('broadcastSequencer가 대기 계산을 순수 함수로 내놓는다 — ttsWaitMs(textLength, rateVal)', () => {
  assert.equal(typeof seq.ttsWaitMs, 'function',
    'stepTTS 안에 계산이 박혀 있으면 대기 시간을 실제로 기다려야만 검증할 수 있다')
})

// ── ① 기본 배속에서는 지금과 완전히 같아야 한다(회귀 방지) ──────
test('기본 배속(0.9)에서는 지금 나가는 방송과 대기가 똑같다', () => {
  // 지금 현장에서 잘 나가는 방송의 타이밍이 바뀌면 안 된다.
  const legacy = (len) => Math.max(6000, Math.ceil(len / 4.5) * 1000 + 3000)
  for (const len of [0, 1, 10, 27, 45, 90, 200, 613]) {
    assert.equal(seq.ttsWaitMs(len, DEFAULT_RATE), legacy(len),
      `길이 ${len}에서 기본 배속 대기가 달라졌다`)
  }
})

// ── ② 느리면 길게 ───────────────────────────────────────────────
test('배속 0.45(절반)면 말하는 시간이 두 배 — 대기도 두 배로 늘어난다', () => {
  const base = seq.ttsWaitMs(LONG_TEXT_LEN, DEFAULT_RATE)
  const slow = seq.ttsWaitMs(LONG_TEXT_LEN, DEFAULT_RATE / 2)
  // +3000ms는 배속과 무관한 여유분이므로 빼고 비교한다
  assert.equal(slow - 3000, (base - 3000) * 2,
    '배속을 낮췄는데 대기가 그대로면 다음 단계가 말 위로 겹친다')
})

// ── ③ 빠르면 짧게, 단 하한은 지킨다 ─────────────────────────────
test('배속 1.8(두 배)면 대기가 절반으로 줄어든다', () => {
  const base = seq.ttsWaitMs(LONG_TEXT_LEN, DEFAULT_RATE)
  const fast = seq.ttsWaitMs(LONG_TEXT_LEN, DEFAULT_RATE * 2)
  assert.equal(fast - 3000, (base - 3000) / 2,
    '배속을 올렸는데 대기가 그대로면 아무 소리 없는 시간이 남는다')
})

test('아무리 빨라도 최소 6초는 기다린다 — 화면이 재생을 시작할 틈은 있어야 한다', () => {
  assert.equal(seq.ttsWaitMs(5, 1.5), 6000)
  assert.equal(seq.ttsWaitMs(0, 1.5), 6000)
  assert.ok(seq.ttsWaitMs(1, 100) >= 6000, '하한이 뚫리면 다음 단계가 곧바로 덮어쓴다')
})

// ── ④ 이상한 값이 들어와도 방송이 깨지지 않는다 ─────────────────
test('배속이 0·음수·NaN이면 기본 배속으로 안전하게 떨어진다', () => {
  // settings.tts_rate는 사람이 손으로 넣을 수 있는 값이라 무엇이든 들어올 수 있다.
  // 0으로 나눠 Infinity가 되면 Math.ceil(Infinity)로 타이머가 통째로 깨진다.
  const expected = seq.ttsWaitMs(LONG_TEXT_LEN, DEFAULT_RATE)
  for (const bad of [0, -1, -0.5, NaN, undefined, null, 'abc']) {
    const got = seq.ttsWaitMs(LONG_TEXT_LEN, bad)
    assert.ok(Number.isFinite(got), `배속 ${String(bad)}에서 대기가 유한한 수가 아니다: ${got}`)
    assert.equal(got, expected, `배속 ${String(bad)}는 기본 배속(0.9)으로 떨어져야 한다`)
  }
})

// ── stepTTS가 실제로 그 함수를 쓰는가 ───────────────────────────
test('stepTTS가 대기를 직접 계산하지 않고 ttsWaitMs를 쓴다', () => {
  const body = stepTTSBody()
  assert.match(body, /ttsWaitMs\(/,
    '순수 함수만 만들고 stepTTS가 옛 계산을 그대로 쓰면 현장 동작은 하나도 안 바뀐다')
  assert.doesNotMatch(body, /text\.length\s*\/\s*4\.5/,
    '초당 4.5자 고정 계산이 stepTTS에 남아 있다')
})

// ── 범위 밖임을 못박아 두는 가드 ────────────────────────────────
test('식사 안내 TTS는 tts_rate를 읽지 않는다 — 이번 수정 범위 밖이다', () => {
  const from = SEQ_SRC.indexOf('async function stepPrayerTTS(')
  const to   = SEQ_SRC.indexOf('async function stepAudioFile(')
  assert.ok(from >= 0 && to > from, 'stepPrayerTTS를 소스에서 찾지 못했다')
  const body = SEQ_SRC.slice(from, to)
  assert.doesNotMatch(body, /tts_rate/,
    '식사 안내 TTS는 차분한 분위기를 위해 0.80으로 자체 고정한다 — 설정을 따라가게 바꾸지 않는다')
  assert.match(body, /rateToStr\(0\.80\)/)
})
