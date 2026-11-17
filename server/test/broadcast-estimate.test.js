// 순서편집기 위에 뜰 "이 방송은 대략 몇 분 걸린다"의 계산 규칙(server/domain/broadcastEstimate.js).
//
// 이 숫자는 장식이 아니라 **주장**이다. 사람이 이걸 보고 다음 방송 시각을 정한다 —
// "아침 방송이 12분 30초 걸린다"고 적어 두면 08:05에 다른 방송을 잡아 놓고, 실제로는
// 투약 6분 대기와 30분짜리 영상이 남아 있어서 두 방송이 겹친다. 그래서 이 테스트는
// **추측한 수치가 아니라 서버가 실제로 기다리는 시간**을 박아 둔다.
//
// 근거(실측한 원본):
//   server/services/broadcastSequencer.js  — 자동방송 5종의 단계별 실제 대기
//   server/services/flowRunner.js          — 흐름 단계는 **다른 추정식**을 쓴다
//   server/db/schema.js:231                — audio_files.duration(초), 기본 0(=모름)
//   src/components/admin/sections/MorningEditor.jsx — 화면이 저장하는 실제 단계 구성
//
// RED 단계다. broadcastEstimate.js는 아직 없다 — 모듈이 없어서 파일 전체가 로드 실패로
// 죽으면 "무엇이 틀렸는지"가 안 보이므로, 각 테스트 안에서 require를 시도해 **테스트별로**
// 빨간불이 나게 감쌌다.
'use strict'

const path = require('path')
const { editorSource } = require('./helpers/editorSource')
const os   = require('os')
const fs   = require('fs')

// 운영 DB(server/db/database.db)를 절대 건드리지 않는다 — broadcastSequencer를 require하는
// 다른 테스트들과 같은 방식(tts-wait-rate.test.js).
const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_estimate_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH   = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

// 자동방송 경로의 **진짜** 대기 계산식. 값을 베껴 적지 않고 이 함수를 그대로 불러서 대조한다 —
// 나중에 4.5자/초가 바뀌면 추정도 같이 따라와야 하기 때문이다.
const { ttsWaitMs }                = require('../services/broadcastSequencer')
// 흐름 경로의 대기 계산식. 자동방송과 **다른 식**이라는 사실 자체를 아래에서 고정한다.
const { estimateTtsDurationMs }    = require('../services/flowRunner')
const { DEFAULT_MEDICATION_TTS }   = require('../domain/broadcastDefaults')


test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

// ── 실측 상수 ────────────────────────────────────────────────
// 전부 소스에서 뽑은 값이다. 옆에 근거 위치를 적어 둔다 — 나중에 누가 "이 800은 뭐죠"라고
// 물었을 때 답이 없으면 그 순간부터 이 표는 추측이 된다.

// 자동방송 5종은 **단계마다** 본작업 전에 800ms를 쓴다.
// broadcastSequencer.js fireMorningBroadcast/fireExercise/fireLunch/fireDinner/fireEveningPrayer
// 의 for 루프 안 `await tokenDelay(800, tok)`. 8단계면 6.4초다 — 흐름(flowRunner.runFlow)에는
// 이 간격이 없다.
const STEP_GAP_MS = 800

// BGM 시작 뒤의 고정 대기. **같은 id라도 방송(탭)마다 다르다** — 그래서 tab을 재료로 받는다.
// morning: case 'bgm' → tokenDelay(1500), case 'bgm_after' → tokenDelay(1000)
// exercise: case 'bgm' → tokenDelay(1500)
// lunch/dinner: case 'bgm_start' → tokenDelay(1500), case 'bgm'(식사 중) → **대기 없음**
// evening_prayer: case 'bgm' → tokenDelay(3500, 페이드인 2초), bgm_closing/bgm_final → 2000
const BGM_LEAD_MS = {
  morning:        { bgm: 1500, bgm_after: 1000 },
  exercise:       { bgm: 1500 },
  lunch:          { bgm_start: 1500, bgm: 0 },
  dinner:         { bgm_start: 1500, bgm: 0 },
  evening_prayer: { bgm: 3500, bgm_closing: 2000, bgm_final: 2000 },
}

// 커스텀/흐름 BGM 단계의 선재생. flowRunner.js:183 `(Number(item.bgm_delay) || 5) * 1000`
const BGM_DELAY_DEFAULT_SEC = 5

// 투약 안내의 기본 대기. broadcastSequencer.js `Number(step.delay_min) || 6` → 6분
const MEDICATION_DELAY_MIN = 6

// 재생시간을 모르는 파일의 대기 **상한**. 두 경로의 값이 다르다:
//  · 자동방송의 고정 음원 단계(morning_prayer 등)는 호출부가 300초를 넘긴다
//    (stepAudioFile(db, 'morning-prayer', 0, 300, ...)). 함수 시그니처 기본값은 180이지만
//    호출부 전부가 300을 넘기므로 실제로 쓰이는 값은 300이다.
//  · 흐름/커스텀 음원 단계는 flowRunner의 AUDIO_WAIT_CAP_MS = 180초.
//  · 업로드 영상 단계(stepVideoFile)는 480초.
const AUTO_AUDIO_CAP_MS  = 300 * 1000
const FLOW_AUDIO_CAP_MS  = 180 * 1000
const VIDEO_FILE_CAP_MS  = 480 * 1000

// stepVideoFile은 BGM 페이드아웃이 끝나기를 1500ms 기다린 뒤에야 영상을 튼다(줄 338).
const VIDEO_FADE_MS = 1500

// ── 아직 없는 모듈 붙잡기 ─────────────────────────────────────
const MODULE_PATH = path.join(__dirname, '..', 'domain', 'broadcastEstimate.js')

function load() {
  try {
    return require(MODULE_PATH)
  } catch (err) {
    assert.fail(`server/domain/broadcastEstimate.js 를 불러올 수 없습니다 (아직 없음): ${err.message}`)
  }
}

// 요구하는 API:
//   estimateBroadcastDuration(steps, materials) -> {
//     steps: [{ id, label, ms, confidence }],   // 꺼진 단계는 아예 안 들어온다
//     totalMs,
//     confidence,          // 단계들 중 가장 약한 것
//     hasUpperBound,       // 상한으로 잡은 단계가 하나라도 있는가
//     upperBoundStepIds,   // 그 단계들의 id
//   }
// materials = { tab, lane, ttsRate, texts: {stepId: '문구'}, audioFiles: {stepId: {duration}} }
//   · tab   — 'morning'|'exercise'|'lunch'|'dinner'|'evening_prayer' (BGM 선재생이 탭마다 다르다)
//   · lane  — 'auto'(기본) | 'flow'. 두 경로가 다른 식을 쓰기 때문에 반드시 갈라야 한다.
//   · ttsRate — settings.tts_rate (기본 0.9)
// confidence는 셋 중 하나다:
//   'fixed'      — 코드에 박힌 대기·delay_min·wait_sec·아는 재생시간. 실제로 그만큼 걸린다.
//   'estimate'   — 글자수로 어림한 TTS. 화면이 종료를 알려주면 더 짧아진다.
//   'upperBound' — 재생시간을 몰라 상한만 아는 것. **대개 훨씬 짧다.**
const CONFIDENCE_VALUES = new Set(['fixed', 'estimate', 'upperBound'])

function estimate(steps, materials = {}) {
  const mod = load()
  assert.equal(typeof mod.estimateBroadcastDuration, 'function',
    'estimateBroadcastDuration(steps, materials) 를 내보내야 합니다')
  return mod.estimateBroadcastDuration(steps, materials)
}

function endTime(startHHMM, totalMs) {
  const mod = load()
  assert.equal(typeof mod.estimateEndTime, 'function',
    'estimateEndTime(startHHMM, totalMs) 를 내보내야 합니다')
  return mod.estimateEndTime(startHHMM, totalMs)
}

// 단계 하나짜리 방송의 그 단계 결과를 꺼낸다
function one(steps, materials) {
  const r = estimate(steps, materials)
  assert.ok(Array.isArray(r.steps), 'steps 배열을 돌려줘야 합니다')
  assert.equal(r.steps.length, 1)
  return r.steps[0]
}

const chars = (n) => '가'.repeat(n)

// ─────────────────────────────────────────────────────────────
// 1. TTS 단계 — 자동방송 경로는 ttsWaitMs와 **같은 값**이어야 한다
// ─────────────────────────────────────────────────────────────

test('자동방송 TTS 단계의 추정은 서버가 실제로 기다리는 ttsWaitMs와 같은 값이다', () => {
  // ttsWaitMs = max(6000, ceil(글자수 / (4.5*(rate/0.9))) * 1000 + 3000)
  // 45자 기준 실측값: 0.9배속 13초 / 0.5배속 21초 / 1.5배속 10초.
  const text = chars(45)
  const mk = (rate) => one(
    [{ id: 'morning_prayer_intro', label: '기도·묵상 시간 안내 (선택)', enabled: true }],
    { tab: 'morning', ttsRate: rate, texts: { morning_prayer_intro: text } },
  )

  assert.equal(mk(0.9).ms - STEP_GAP_MS, ttsWaitMs(45, 0.9))
  assert.equal(mk(0.5).ms - STEP_GAP_MS, ttsWaitMs(45, 0.5))
  assert.equal(mk(1.5).ms - STEP_GAP_MS, ttsWaitMs(45, 1.5))

  // 함수를 잘못 불러와 놓고 통과하는 일이 없게 실측 리터럴도 함께 박는다.
  assert.equal(mk(0.9).ms, 13000 + STEP_GAP_MS)
  assert.equal(mk(0.5).ms, 21000 + STEP_GAP_MS)
  // **1.5배속은 10초다(9초가 아니다).** 4.5*(1.5/0.9)는 부동소수점 때문에 정확히 7.5가
  // 아니라 7.4999…라, 45/7.4999… = 6.0000…001 → ceil 7 → 10초가 된다. "45/7.5=6이니 9초"로
  // 손계산해서 고쳐 넣으면 서버 대기와 1초 어긋난다. 식을 그대로 써야 한다.
  assert.equal(mk(1.5).ms, 10000 + STEP_GAP_MS)

  // 배속을 안 넘기면 기본 0.9로 본다(settings.tts_rate 기본값)
  const noRate = one(
    [{ id: 'morning_prayer_intro', enabled: true }],
    { tab: 'morning', texts: { morning_prayer_intro: text } },
  )
  assert.equal(noRate.ms, 13000 + STEP_GAP_MS)
})

test('짧은 문구는 하한 6초로 잡힌다 — 화면이 재생을 시작할 틈', () => {
  const s = one(
    [{ id: 'morning_prayer_intro', enabled: true }],
    { tab: 'morning', ttsRate: 0.9, texts: { morning_prayer_intro: '안녕하세요' } },
  )
  assert.equal(s.ms - STEP_GAP_MS, 6000)
  assert.equal(s.ms - STEP_GAP_MS, ttsWaitMs(5, 0.9))
})

test('TTS는 확정값이 아니라 추정이다 — confidence가 fixed면 안 된다', () => {
  // 2026-08-31부터 자동방송은 화면의 실제 종료 신호를 먼저 보고, 신호가 없을 때만 이 값까지
  // 기다린다. 즉 이건 "정확히 이만큼"이 아니라 어림값이다.
  const s = one(
    [{ id: 'morning_prayer_intro', enabled: true }],
    { tab: 'morning', texts: { morning_prayer_intro: chars(45) } },
  )
  assert.equal(s.confidence, 'estimate')
})

// ─────────────────────────────────────────────────────────────
// 2. 흐름 단계는 **다른 식**을 쓴다
// ─────────────────────────────────────────────────────────────

test('흐름 단계의 TTS 추정은 자동방송과 다른 식이다 — 한쪽 식을 양쪽에 쓰면 실패한다', () => {
  // flowRunner.estimateTtsDurationMs = max(1500, 글자수*180) + 1500
  // 20자: 흐름 5100ms vs 자동방송 8000ms. 두 경로가 붙어 있으면 여기서 걸린다.
  const text = chars(20)

  const flow = one(
    [{ step_type: 'tts', label: '안내', config: { content: text } }],
    { lane: 'flow' },
  )
  const auto = one(
    [{ id: 'morning_prayer_intro', enabled: true }],
    { tab: 'morning', lane: 'auto', ttsRate: 0.9, texts: { morning_prayer_intro: text } },
  )

  // 흐름에는 단계 간 800ms 간격이 없다(runFlow의 루프에는 tokenDelay가 없다)
  assert.equal(flow.ms, estimateTtsDurationMs(text))
  assert.equal(flow.ms, 5100)

  assert.equal(auto.ms - STEP_GAP_MS, ttsWaitMs(20, 0.9))
  assert.equal(auto.ms, 8000 + STEP_GAP_MS)

  assert.notEqual(flow.ms, auto.ms - STEP_GAP_MS)
  assert.notEqual(flow.ms, auto.ms)
})

test('자동방송 안의 커스텀 TTS 단계는 흐름 식이 아니라 자동방송 식을 쓴다', () => {
  // customType 'tts'/'message'는 runCustomExtraStep으로 안 가고 stepTTS로 간다
  // (broadcastSequencer의 default 분기) — 즉 ttsWaitMs다.
  const text = chars(20)
  const s = one(
    [{ id: 'custom_1', customType: 'tts', content: text, enabled: true }],
    { tab: 'morning', ttsRate: 0.9 },
  )
  assert.equal(s.ms, ttsWaitMs(20, 0.9) + STEP_GAP_MS)
  assert.notEqual(s.ms - STEP_GAP_MS, estimateTtsDurationMs(text))
})

test('식사 안내 TTS는 또 다른 식이다 — 3.5자/초, 하한 8초, 배속 설정을 안 본다', () => {
  // stepPrayerTTS: max(8000, ceil(글자수/3.5)*1000 + 3000). rate는 0.80으로 고정이라
  // settings.tts_rate를 바꿔도 안 움직인다. ttsWaitMs를 여기에 쓰면 값이 어긋난다.
  const sixty = chars(60)
  const s = one(
    [{ id: 'breakfast_prayer_tts', enabled: true }],
    { tab: 'morning', ttsRate: 0.5, texts: { breakfast_prayer_tts: sixty } },
  )
  assert.equal(s.ms - STEP_GAP_MS, 21000)          // ceil(60/3.5)=18 → 18000+3000
  assert.notEqual(s.ms - STEP_GAP_MS, ttsWaitMs(60, 0.5))

  const short = one(
    [{ id: 'breakfast_prayer_tts', enabled: true }],
    { tab: 'morning', texts: { breakfast_prayer_tts: '오늘도 감사합니다' } },
  )
  assert.equal(short.ms - STEP_GAP_MS, 8000)       // 하한 8초(자동 TTS의 6초가 아니다)
})

// ─────────────────────────────────────────────────────────────
// 3. 음원 단계 — 아는 길이 / 모르는 길이(상한)
// ─────────────────────────────────────────────────────────────

test('음원 단계: duration을 아는 파일은 duration/배속 + 2초다', () => {
  // stepAudioFile: Math.round(file.duration / speed) * 1000 + 2000
  const withRate = (rate) => one(
    [{ id: 'morning_prayer', enabled: true, rate }],
    { tab: 'morning', audioFiles: { morning_prayer: { duration: 214 } } },
  )
  assert.equal(withRate(undefined).ms - STEP_GAP_MS, 216000)   // 정속
  assert.equal(withRate(1).ms   - STEP_GAP_MS, 216000)
  assert.equal(withRate(0.5).ms - STEP_GAP_MS, 430000)         // 느리게 틀면 길어진다
  assert.equal(withRate(1.5).ms - STEP_GAP_MS, 145000)         // round(214/1.5)=143

  // 길이를 아는 파일은 상한이 아니다 — 화면에 "최대"라고 쓰면 안 된다
  assert.equal(withRate(1).confidence, 'fixed')
  const r = estimate(
    [{ id: 'morning_prayer', enabled: true }],
    { tab: 'morning', audioFiles: { morning_prayer: { duration: 214 } } },
  )
  assert.equal(r.hasUpperBound, false)
  assert.deepEqual(r.upperBoundStepIds, [])
})

test('음원 단계: duration을 모르면 상한이고, 그것이 결과에 드러나야 한다', () => {
  // 여기서 3분(또는 5분)이라고 **단정하면 거짓말이다.** 실제 녹음 음원은 대개 훨씬 짧고,
  // 서버는 화면이 "끝났다"고 알려주는 즉시 넘어간다. 상한까지 가는 건 현장 화면이 안 떠
  // 있을 때뿐이다. 그래서 값과 함께 "상한"이라는 표시가 반드시 붙어야 한다.
  const r = estimate(
    [{ id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true }],
    { tab: 'morning' },   // audioFiles 없음 = duration 모름
  )
  const s = r.steps[0]
  assert.equal(s.ms - STEP_GAP_MS, AUTO_AUDIO_CAP_MS)   // 호출부가 넘기는 300초
  assert.equal(s.confidence, 'upperBound')
  assert.equal(r.hasUpperBound, true)
  assert.deepEqual(r.upperBoundStepIds, ['morning_prayer'])
  assert.equal(r.confidence, 'upperBound')              // 전체도 상한으로 내려간다

  // duration 0도 "모름"이다 — audio_files.duration의 기본값이 0이다(schema.js:231)
  const zero = one(
    [{ id: 'morning_prayer', enabled: true }],
    { tab: 'morning', audioFiles: { morning_prayer: { duration: 0 } } },
  )
  assert.equal(zero.ms - STEP_GAP_MS, AUTO_AUDIO_CAP_MS)
  assert.equal(zero.confidence, 'upperBound')
})

test('음원 상한은 경로마다 다르다 — 자동방송 고정 단계 300초, 흐름·커스텀 180초', () => {
  // 자동방송의 고정 음원 단계는 호출부가 defaultWaitSec=300을 넘긴다.
  // 흐름/커스텀 음원은 flowRunner.AUDIO_WAIT_CAP_MS = 180초를 쓴다.
  // 시그니처 기본값 180만 보고 양쪽에 180을 쓰면 자동방송 쪽이 2분 짧게 나온다.
  const auto = one([{ id: 'lunch_prayer_audio', enabled: true }], { tab: 'lunch' })
  assert.equal(auto.ms - STEP_GAP_MS, AUTO_AUDIO_CAP_MS)

  // 상한은 **파일은 있는데 길이를 모를 때** 쓰는 값이다. 아무 파일도 안 고른 단계는
  // 상한이 아니라 0초다 — flowRunner의 for 루프가 한 번도 안 돈다(estimate-runtime-parity
  // .test.js가 그쪽을 고정한다). 예전엔 이 테스트가 빈 단계로 상한을 확인하고 있었는데,
  // 그건 실행부에 없는 동작이라 입력만 바꾼다. 확인하려는 것(경로마다 상한이 다르다)은 그대로다.
  const unknownLen = { 31: { exists: true, duration: 0 } }

  const custom = one(
    [{ id: "custom_2", customType: "audio", enabled: true, playlist: [31] }],
    { tab: "morning", audioFiles: unknownLen },
  )
  assert.equal(custom.ms - STEP_GAP_MS, FLOW_AUDIO_CAP_MS)

  const flow = one([{ step_type: "audio", config: { playlist: [31] } }], { lane: "flow", audioFiles: unknownLen })
  assert.equal(flow.ms, FLOW_AUDIO_CAP_MS)

  for (const s of [auto, custom, flow]) assert.equal(s.confidence, 'upperBound')
})

test('업로드 영상 단계는 페이드아웃 1.5초를 먼저 쓰고, 여유가 2초가 아니라 3초다', () => {
  // stepVideoFile: bgm_stop → 1500ms 대기 → 재생.
  // 대기 상한은 Math.round(duration/배속)*1000 + **3000**(음원은 2000), 모르면 480초.
  const known = one(
    [{ id: 'exercise_video', enabled: true }],
    { tab: 'exercise', audioFiles: { exercise_video: { duration: 300 } } },
  )
  assert.equal(known.ms - STEP_GAP_MS, VIDEO_FADE_MS + 303000)

  const unknown = one([{ id: 'exercise_video', enabled: true }], { tab: 'exercise' })
  assert.equal(unknown.ms - STEP_GAP_MS, VIDEO_FADE_MS + VIDEO_FILE_CAP_MS)
  assert.equal(unknown.confidence, 'upperBound')
})

// ─────────────────────────────────────────────────────────────
// 4. 대기 단계와 투약 안내
// ─────────────────────────────────────────────────────────────

test('대기 단계(wait_sec)는 그대로 총합에 들어간다', () => {
  const custom = one(
    [{ id: 'custom_3', customType: 'delay', wait_sec: 90, enabled: true }],
    { tab: 'morning' },
  )
  assert.equal(custom.ms - STEP_GAP_MS, 90000)
  assert.equal(custom.confidence, 'fixed')

  const flow = one([{ step_type: 'delay', config: { wait_sec: 90 } }], { lane: 'flow' })
  assert.equal(flow.ms, 90000)
})


test('투약 안내는 대기 6분 + TTS 둘 다 더한다', () => {
  const s = one(
    [{ id: 'medication_tts', label: '투약 안내 (TTS)', enabled: true, content: DEFAULT_MEDICATION_TTS }],
    { tab: 'morning', ttsRate: 0.9 },
  )
  const ttsMs = ttsWaitMs(DEFAULT_MEDICATION_TTS.length, 0.9)
  assert.equal(s.ms, STEP_GAP_MS + MEDICATION_DELAY_MIN * 60 * 1000 + ttsMs)
  assert.ok(s.ms > 6 * 60 * 1000, '6분 대기가 빠지면 방송이 실제보다 6분 짧게 보인다')

  // delay_min을 지정하면 그 값을 쓴다(기본 6분은 값이 없을 때만)
  const three = one(
    [{ id: 'medication_tts', enabled: true, delay_min: 3, content: DEFAULT_MEDICATION_TTS }],
    { tab: 'morning', ttsRate: 0.9 },
  )
  assert.equal(three.ms, STEP_GAP_MS + 3 * 60 * 1000 + ttsMs)
})

test('차임벨 단계는 3초다', () => {
  // flowRunner: playChime 후 cancellableSleep(3000)
  const s = one(
    [{ id: 'custom_4', customType: 'chime', enabled: true }],
    { tab: 'morning' },
  )
  assert.equal(s.ms - STEP_GAP_MS, 3000)
})

// ─────────────────────────────────────────────────────────────
// 5. BGM은 총 소요시간을 늘리지 않는다
// ─────────────────────────────────────────────────────────────

test('BGM 단계는 총 소요시간을 늘리지 않는다 — 더하는 것은 선재생뿐', () => {
  // 음악은 그 자리에서 끝나는 게 아니라 **다음 단계들 밑에 계속 깔린다**(src/lib/bgmLane.js가
  // 그리는 그 선). 그래서 BGM 재생 시간을 총합에 더하면 같은 시간을 두 번 세는 것이 된다.
  // 서버가 실제로 멈춰 있는 건 시작 직후의 고정 대기뿐이다.
  const s = one(
    [{ id: 'bgm', label: 'BGM 시작', enabled: true, durationSec: 600, durationMin: 15 }],
    { tab: 'morning' },
  )
  assert.equal(s.ms - STEP_GAP_MS, BGM_LEAD_MS.morning.bgm)   // 1500
  assert.ok(s.ms < 60 * 1000, 'BGM 재생 시간(15분·600초)이 총합에 섞이면 안 된다')

  // durationSec/durationMin을 아무리 키워도 값이 안 변해야 한다
  const longer = one(
    [{ id: 'bgm', enabled: true, durationSec: 3600, durationMin: 60 }],
    { tab: 'morning' },
  )
  assert.equal(longer.ms, s.ms)
})

test('커스텀·흐름 BGM 단계가 더하는 것은 선재생(bgm_delay, 기본 5초)뿐이다', () => {
  const dflt = one(
    [{ id: 'custom_bgm', customType: 'bgm', enabled: true }],
    { tab: 'morning' },
  )
  assert.equal(dflt.ms - STEP_GAP_MS, BGM_DELAY_DEFAULT_SEC * 1000)

  const eight = one(
    [{ id: 'custom_bgm', customType: 'bgm', bgm_delay: 8, enabled: true }],
    { tab: 'morning' },
  )
  assert.equal(eight.ms - STEP_GAP_MS, 8000)

  const flow = one([{ step_type: 'bgm', config: { bgm_delay: 8 } }], { lane: 'flow' })
  assert.equal(flow.ms, 8000)
})

test('BGM 선재생은 같은 id라도 방송마다 다르다 — 탭을 봐야 한다', () => {
  const bgmIn = (tab) => one([{ id: 'bgm', enabled: true }], { tab }).ms - STEP_GAP_MS
  assert.equal(bgmIn('morning'),        1500)
  assert.equal(bgmIn('exercise'),       1500)
  assert.equal(bgmIn('lunch'),          0)      // 식사 중 BGM은 대기가 아예 없다
  assert.equal(bgmIn('dinner'),         0)
  assert.equal(bgmIn('evening_prayer'), 3500)   // 페이드인 2초를 기다린다

  const lead = (tab, id) => one([{ id, enabled: true }], { tab }).ms - STEP_GAP_MS
  assert.equal(lead('morning', 'bgm_after'),          1000)
  assert.equal(lead('lunch',   'bgm_start'),          1500)
  assert.equal(lead('evening_prayer', 'bgm_closing'), 2000)
  assert.equal(lead('evening_prayer', 'bgm_final'),   2000)
})

// ─────────────────────────────────────────────────────────────
// 6. 꺼 둔 단계
// ─────────────────────────────────────────────────────────────

test('꺼 둔 단계(enabled === false)는 총합에서 빠진다 — 800ms 간격까지 같이 빠진다', () => {
  // 시퀀서는 `if (!step.enabled) continue` 로 tokenDelay(800)에 닿기도 전에 건너뛴다.
  const steps = [
    { id: 'bgm',                  enabled: true },
    { id: 'morning_prayer_intro', enabled: false },
    { id: 'medication_tts',       enabled: false, content: DEFAULT_MEDICATION_TTS },
  ]
  const r = estimate(steps, { tab: 'morning', texts: { morning_prayer_intro: chars(45) } })

  assert.equal(r.steps.length, 1, '꺼진 단계는 목록에도 들어오면 안 된다')
  assert.equal(r.steps[0].id, 'bgm')
  assert.equal(r.totalMs, STEP_GAP_MS + BGM_LEAD_MS.morning.bgm)

  // enabled를 아예 안 적은 단계는 켜진 것으로 본다(기본값 true)
  const implicit = estimate([{ id: 'bgm' }], { tab: 'morning' })
  assert.equal(implicit.steps.length, 1)
})

// ─────────────────────────────────────────────────────────────
// 7. 끝나는 시각
// ─────────────────────────────────────────────────────────────

test('끝나는 시각: 시작 07:50 + 총합', () => {
  // 초는 올림한다 — 아직 방송 중인 분을 "끝났다"고 적으면 사람이 그 분에 다음 방송을 잡는다.
  assert.deepEqual(endTime('07:50', 25 * 60 * 1000),        { time: '08:15', dayOffset: 0 })
  assert.deepEqual(endTime('07:50', 25 * 60 * 1000 + 30000), { time: '08:16', dayOffset: 0 })
  assert.equal(endTime('07:50', 26 * 60 * 1000).time.startsWith('08:1'), true)
  assert.deepEqual(endTime('07:50', 0), { time: '07:50', dayOffset: 0 })
})

test('끝나는 시각: 자정을 넘으면 다음 날임이 드러나야 한다', () => {
  // 저녁 마무리 뒤에 긴 영상을 붙이면 실제로 넘어간다. 23:50 + 30분을 "00:20"이라고만 적으면
  // 사람은 그것을 **오늘 아침 00:20**으로 읽는다.
  assert.deepEqual(endTime('23:50', 30 * 60 * 1000), { time: '00:20', dayOffset: 1 })
  assert.deepEqual(endTime('23:59', 60 * 1000),      { time: '00:00', dayOffset: 1 })
  assert.deepEqual(endTime('23:00', 25 * 60 * 60 * 1000), { time: '00:00', dayOffset: 2 })
})

// ─────────────────────────────────────────────────────────────
// 8. 실제 아침 방송 구성 전체
// ─────────────────────────────────────────────────────────────

test('화면의 아침 영상 단계 기본 재생시간은 30분이다 — 이 테스트의 전제', () => {
  // src/components/admin/sections/MorningEditor.jsx의 DEFAULT_STEPS.morning.
  // (서버 broadcastSequencer.js의 같은 항목은 15로 남아 있다 — 화면이 저장한 값이 이기므로
  //  현장 DB에는 30이 들어 있다. 이 차이 자체가 사람을 헷갈리게 하는 지점이라 근거를 박아 둔다.)
  const src = editorSource()
  const line = src.split('\n').find(l => l.includes("id: 'morning_video'"))
  assert.ok(line, "MorningEditor.jsx에서 morning_video 기본 단계를 찾지 못했습니다")
  assert.match(line, /durationMin:\s*30/,
    '화면 기본값이 바뀌었다면 아래 아침 방송 총합 기대치도 같이 고쳐야 합니다')
})

test('실제 아침 방송 전체는 투약 6분 대기와 30분 영상 때문에 36분을 넘는다', () => {
  // MorningEditor.jsx DEFAULT_STEPS.morning 그대로.
  const texts = {
    date_weather_schedule: chars(120),
    morning_prayer_intro:  chars(30),
    breakfast_prayer_tts:  chars(60),
  }
  const steps = [
    { id: 'bgm',                   label: 'BGM 시작',                enabled: true },
    { id: 'date_weather_schedule', label: '날짜/요일/날씨/일정 안내', enabled: true },
    { id: 'morning_prayer_intro',  label: '기도·묵상 시간 안내 (선택)',      enabled: true },
    { id: 'morning_prayer',        label: '기도·묵상 시간 음원 (선택)',            enabled: true },
    { id: 'breakfast_prayer_tts',  label: '아침 식사 안내 (TTS)',  enabled: true },
    { id: 'bgm_after',             label: 'BGM 재시작 (식사 안내 후)',     enabled: true },
    { id: 'medication_tts',        label: '투약 안내 (TTS)',          enabled: true, delay_min: 6, content: DEFAULT_MEDICATION_TTS },
    { id: 'morning_video',         label: '아침 후 YouTube 영상',     enabled: true, durationMin: 30 },
  ]
  const r = estimate(steps, {
    tab: 'morning',
    ttsRate: 0.9,
    texts,
    audioFiles: { morning_prayer: { duration: 214 } },   // 길이를 아는 녹음 음원
  })

  assert.equal(r.steps.length, 8)

  const expectedPerStep = [
    STEP_GAP_MS + 1500,                                  // bgm
    STEP_GAP_MS + ttsWaitMs(120, 0.9),                   // 30000
    STEP_GAP_MS + ttsWaitMs(30, 0.9),                    // 10000
    STEP_GAP_MS + 216000,                                // 214초 음원 + 2초
    STEP_GAP_MS + 21000,                                 // 식사 안내 TTS(3.5자/초)
    STEP_GAP_MS + 1000,                                  // bgm_after
    STEP_GAP_MS + 360000 + ttsWaitMs(DEFAULT_MEDICATION_TTS.length, 0.9),
    STEP_GAP_MS + 30 * 60 * 1000,                        // 영상 30분
  ]
  assert.deepEqual(r.steps.map(s => s.ms), expectedPerStep)

  const expectedTotal = expectedPerStep.reduce((a, b) => a + b, 0)
  assert.equal(r.totalMs, expectedTotal)

  // 핵심 주장: "12분짜리 방송"이 아니다. 41분 넘게 자리를 차지한다.
  assert.ok(r.totalMs > 36 * 60 * 1000,
    `아침 방송 총합이 36분을 넘어야 합니다 (실제 ${Math.round(r.totalMs / 60000)}분)`)

  // 영상 단계를 서버의 실제 대기(800ms tokenDelay)로 세면 방송이 30분 짧게 나온다.
  // stepVideoAfter는 SSE를 쏘고 곧바로 다음으로 넘어가지만, **화면은 durationMin 동안 계속
  // 영상을 튼다.** 사람이 알고 싶은 건 "방이 언제 비는가"라서 30분을 세는 쪽이 맞다.
  const videoStep = r.steps[7]
  assert.equal(videoStep.ms, STEP_GAP_MS + 1800000)
  assert.notEqual(videoStep.ms, STEP_GAP_MS + 800)

  // 2026-08-31 적대적 검증 뒤 바뀐 계약: **유튜브 영상 단계는 확정이 아니다.**
  // stepVideoAfter는 resolveVideoId가 null이면(API 키 없음·검색 0건·임베드 불가) 아무것도
  // 안 튼다 → 0초. 총합의 절반을 차지하면서 가장 안 확실한 단계라, 이걸 'fixed'로 두면
  // 화면이 "대략 41분"이라고 단정한다. 그래서 상한으로 내렸다.
  assert.equal(r.steps[7].confidence, 'upperBound')
  assert.equal(r.hasUpperBound, true)
  assert.deepEqual(r.upperBoundStepIds, ['morning_video'])
  assert.equal(r.confidence, 'upperBound')

  // 07:50에 시작하면 08:31 이후에 끝난다 — 08:05에 다른 방송을 잡으면 겹친다
  const end = endTime('07:50', r.totalMs)
  assert.equal(end.dayOffset, 0)
  assert.ok(end.time > '08:30', `실제 종료 ${end.time}`)
})

test('녹음 음원 길이를 모르면 아침 방송 전체가 "상한"으로 표시된다', () => {
  const r = estimate(
    [
      { id: 'morning_prayer_intro', enabled: true },
      { id: 'morning_prayer',       enabled: true },
    ],
    { tab: 'morning', texts: { morning_prayer_intro: chars(30) } },
  )
  assert.equal(r.hasUpperBound, true)
  assert.equal(r.confidence, 'upperBound')
  assert.deepEqual(r.upperBoundStepIds, ['morning_prayer'])
})

// ─────────────────────────────────────────────────────────────
// 9. 추정임이 드러나는 표시
// ─────────────────────────────────────────────────────────────

test('모든 단계에 확신도 표시가 붙는다 — 화면이 단정하지 못하게', () => {
  const r = estimate(
    [
      { id: 'bgm',                  enabled: true },
      { id: 'morning_prayer_intro', enabled: true },
      { id: 'morning_prayer',       enabled: true },
      { id: 'medication_tts',       enabled: true, content: DEFAULT_MEDICATION_TTS },
    ],
    { tab: 'morning', texts: { morning_prayer_intro: chars(30) } },
  )

  for (const s of r.steps) {
    assert.ok(CONFIDENCE_VALUES.has(s.confidence), `알 수 없는 confidence: ${s.confidence}`)
    assert.equal(typeof s.ms, 'number')
    assert.ok(Number.isFinite(s.ms) && s.ms >= 0)
    assert.ok('id' in s && 'label' in s, '단계마다 id와 label이 있어야 화면이 어느 줄인지 짚는다')
  }

  assert.deepEqual(r.steps.map(s => s.confidence),
    ['fixed', 'estimate', 'upperBound', 'estimate'])

  // 전체 확신도는 **가장 약한 것**을 따른다. 하나라도 상한이면 전체가 상한이다 —
  // 확실한 단계가 많다고 해서 "12분 30초"라고 단정할 수 있는 게 아니다.
  assert.equal(r.confidence, 'upperBound')
  assert.equal(r.hasUpperBound, true)
})

test('상한이 없고 TTS도 없으면 fixed다 — 그때만 단정해도 된다', () => {
  const r = estimate(
    [
      { id: 'bgm',        enabled: true },
      { id: 'custom_5',   customType: 'delay', wait_sec: 60, enabled: true },
    ],
    { tab: 'morning' },
  )
  assert.equal(r.confidence, 'fixed')
  assert.equal(r.hasUpperBound, false)
  assert.equal(r.totalMs, (STEP_GAP_MS + 1500) + (STEP_GAP_MS + 60000))
})

test('빈 단계 목록도 조용히 0으로 답한다 — 화면이 NaN을 그리면 안 된다', () => {
  const r = estimate([], { tab: 'morning' })
  assert.equal(r.totalMs, 0)
  assert.deepEqual(r.steps, [])
  assert.equal(r.hasUpperBound, false)
  assert.deepEqual(endTime('07:50', 0), { time: '07:50', dayOffset: 0 })
})

// ─────────────────────────────────────────────────────────────
// 10. 적대적 검증(2026-08-31)이 찾아낸 것들
//
// 위 26건이 전부 초록불인 채로 아래가 전부 틀려 있었다. 계산 뼈대는 맞았고, 틀린 곳은
// **재료를 모으는 쪽**과 **모르는 것을 말하는 방식**이었다.
// ─────────────────────────────────────────────────────────────

test('파일이 하나도 없는 단계는 0초다 — 상한 5분이 아니다', () => {
  // 실행부는 파일이 없으면 **대기 없이 건너뛴다**(stepAudioFile: `if (!file) ... return`).
  // "없음"을 "모름"과 뭉뚱그려 상한으로 세면, 음원을 한 번도 올린 적 없는 PC에서
  // 아침 방송이 5분 더 긴 것처럼 보인다(실제로 이 저장소의 개발 PC가 그 상태였다).
  const s = one(
    [{ id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true }],
    { tab: 'morning', audioFiles: { morning_prayer: { exists: false } } },
  )
  assert.equal(s.ms - STEP_GAP_MS, 0)
  assert.equal(s.confidence, 'fixed', '없는 소리는 "최대"가 아니라 확정된 0초다')

  const r = estimate(
    [{ id: 'morning_prayer', enabled: true }],
    { tab: 'morning', audioFiles: { morning_prayer: { exists: false } } },
  )
  assert.equal(r.hasUpperBound, false)
  assert.equal(r.confidence, 'fixed')

  // 영상도 같다 — 페이드아웃 1.5초조차 없다(파일을 못 찾으면 그 전에 return)
  const video = one(
    [{ id: 'exercise_video', enabled: true }],
    { tab: 'exercise', audioFiles: { exercise_video: { exists: false } } },
  )
  assert.equal(video.ms - STEP_GAP_MS, 0)
})

test('파일은 있는데 길이만 모르면 그때가 상한이다', () => {
  const s = one(
    [{ id: 'morning_prayer', enabled: true }],
    { tab: 'morning', audioFiles: { morning_prayer: { exists: true, duration: 0 } } },
  )
  assert.equal(s.ms - STEP_GAP_MS, AUTO_AUDIO_CAP_MS)
  assert.equal(s.confidence, 'upperBound')
})

test('투약 안내는 종료일이 지나면 통째로 빠진다', () => {
  // broadcastSequencer: `if (step.end_date && todayStr() > step.end_date) break`
  // 임시 투약 안내를 끝내고 종료일을 넣어 두면 아침·점심·저녁 셋 다 6.5분씩 줄어든다.
  const step = { id: 'medication_tts', enabled: true, end_date: '2026-08-30', content: DEFAULT_MEDICATION_TTS }
  const past = one([step], { tab: 'morning', today: '2026-08-31', ttsRate: 0.9 })
  assert.equal(past.ms - STEP_GAP_MS, 0)
  assert.equal(past.confidence, 'fixed')

  // 종료일 당일까지는 나간다(`>` 비교라 같은 날은 통과)
  const sameDay = one([step], { tab: 'morning', today: '2026-08-30', ttsRate: 0.9 })
  assert.ok(sameDay.ms > 6 * 60 * 1000)
})

test('투약 대기 0분은 0분이 아니라 기본 6분이다 — 실행부가 falsy 폴백을 쓴다', () => {
  // `Number(step.delay_min) || 6` — 0을 넣으면 6분이 된다. num(0, 6)으로 읽으면 0분이 되어
  // 화면만 6분 짧아진다.
  const s = one(
    [{ id: 'medication_tts', enabled: true, delay_min: 0, content: DEFAULT_MEDICATION_TTS }],
    { tab: 'morning', ttsRate: 0.9 },
  )
  assert.equal(s.ms, STEP_GAP_MS + 6 * 60 * 1000 + ttsWaitMs(DEFAULT_MEDICATION_TTS.length, 0.9))
})

test('서버가 조립해서 읽는 안내(날씨·일정)는 6초로 단정하지 않는다', () => {
  // 사람이 넣는 문구 칸이 없어 길이를 미리 모른다. 빈 문자열로 넘어와 6초(하한)로 잡히면
  // 실제 30~60초짜리 안내가 통째로 사라진다.
  const s = one(
    [{ id: 'date_weather_schedule', label: '날짜/요일/날씨/일정 안내', enabled: true }],
    { tab: 'morning', ttsRate: 0.9, texts: { date_weather_schedule: '' } },
  )
  assert.ok(s.ms - STEP_GAP_MS > 30000, `조립 안내가 ${s.ms - STEP_GAP_MS}ms로 잡혔다`)
  assert.equal(s.confidence, 'upperBound', '길이를 모르면 상한이라고 말해야 한다')

  // 문구를 실제로 받은 경우에는 그 길이로 어림한다(상한이 아니다)
  const known = one(
    [{ id: 'date_weather_schedule', enabled: true }],
    { tab: 'morning', ttsRate: 0.9, texts: { date_weather_schedule: chars(40) } },
  )
  assert.equal(known.ms - STEP_GAP_MS, ttsWaitMs(40, 0.9))
  assert.equal(known.confidence, 'estimate')
})

test('식사 안내는 녹음이 있으면 길이를 몰라도 음원이다 — TTS가 아니다', () => {
  // stepMealPrayer는 파일이 **있기만 하면** stepAudioFile로 간다(duration 0이어도 상한 300초).
  // 갓 올린 녹음은 duration이 0이라 이게 정상 경로다.
  const withFile = one(
    [{ id: 'breakfast_prayer_tts', enabled: true }],
    { tab: 'morning', texts: { breakfast_prayer_tts: '오늘도 감사합니다' },
      audioFiles: { breakfast_prayer_tts: { exists: true, duration: 0 } } },
  )
  assert.equal(withFile.ms - STEP_GAP_MS, AUTO_AUDIO_CAP_MS)
  assert.equal(withFile.confidence, 'upperBound')

  // 녹음이 없으면 TTS로 읽는다
  const noFile = one(
    [{ id: 'breakfast_prayer_tts', enabled: true }],
    { tab: 'morning', texts: { breakfast_prayer_tts: '오늘도 감사합니다' },
      audioFiles: { breakfast_prayer_tts: { exists: false } } },
  )
  assert.equal(noFile.ms - STEP_GAP_MS, 8000)
  assert.equal(noFile.confidence, 'estimate')
})

test('유튜브 영상은 뒤 단계와 동시에 흐른다 — 합이 아니라 겹친다', () => {
  // stepVideoAfter는 SSE만 쏘고 800ms 뒤 다음 단계로 간다. 영상을 목록 중간으로 끌어
  // 올리면 뒤 단계가 영상과 **함께** 진행된다 — 그때 단순 합은 그만큼 과대평가다.
  const steps = [
    { id: 'morning_video',  label: '영상',  enabled: true, durationMin: 30 },
    { id: 'medication_tts', label: '투약',  enabled: true, delay_min: 6, content: DEFAULT_MEDICATION_TTS },
  ]
  const r = estimate(steps, { tab: 'morning', ttsRate: 0.9 })

  const medMs = STEP_GAP_MS + 6 * 60 * 1000 + ttsWaitMs(DEFAULT_MEDICATION_TTS.length, 0.9)
  const naiveSum = (STEP_GAP_MS + 30 * 60 * 1000) + medMs
  // 영상이 끝나는 시각(800 + 30분)과 순차 진행 끝(800 + medMs) 중 큰 쪽
  assert.equal(r.totalMs, STEP_GAP_MS + 30 * 60 * 1000)
  assert.ok(r.totalMs < naiveSum, '동시에 흐르는 시간을 두 번 세면 안 된다')

  // 단계별 표시는 그대로 "그 단계가 방을 차지하는 시간"이고, 겹친다는 표시가 붙는다
  assert.equal(r.steps[0].ms, STEP_GAP_MS + 30 * 60 * 1000)
  assert.equal(r.steps[0].concurrent, true)

  // 영상이 마지막이면 예전과 같다(합 = 겹침 판정 결과)
  const tail = estimate([steps[1], steps[0]], { tab: 'morning', ttsRate: 0.9 })
  assert.equal(tail.totalMs, medMs + STEP_GAP_MS + 30 * 60 * 1000)
})

test('유튜브 영상에 재생시간이 없으면 실행부와 같은 기본 10분이다', () => {
  // `parseInt(step.durationMin) || 10` — 0/빈값이면 10분이다. 0분으로 세면 30분짜리 방이
  // 비어 있는 것처럼 보인다.
  const s = one([{ id: 'morning_video', enabled: true }], { tab: 'morning' })
  assert.equal(s.ms - STEP_GAP_MS, 10 * 60 * 1000)
})

test('실행부에 없는 단계는 시간을 지어내지 않는다', () => {
  // wait_exercise는 화면에 슬라이더만 남아 있고 5개 fire*의 어느 case에도 없다 —
  // 실제로는 커스텀도 아니라 0초로 지나간다.
  const s = one([{ id: 'wait_exercise', enabled: true, waitMin: 5 }], { tab: 'exercise' })
  assert.equal(s.ms - STEP_GAP_MS, 0)

  const unknown = one([{ id: '누가_나중에_만든_단계', enabled: true }], { tab: 'morning' })
  assert.equal(unknown.ms - STEP_GAP_MS, 0)
})

test('흐름 BGM 재생목록은 마지막 곡을 뺀 각 곡의 재생시간을 기다린다', () => {
  // flowRunner: 선재생(bgm_delay) 뒤, 마지막이 아닌 곡만 duration_sec만큼 더 기다린다.
  const s = one([{
    step_type: 'bgm',
    config: { playlist: [
      { bgm_delay: 5, duration_sec: 60 },
      { bgm_delay: 5, duration_sec: 90 },
      { bgm_delay: 5, duration_sec: 30 },
    ] },
  }], { lane: 'flow' })
  assert.equal(s.ms, (5 + 5 + 5) * 1000 + (60 + 90) * 1000)
})

test('흐름 TTS의 "두 번 읽기"는 문장이 두 배가 된다', () => {
  // flowRunner: repeat_broadcast면 "…다시 한번 알려드립니다. …"로 이어 붙여 읽는다.
  // 원문 길이만 보면 절반으로 잡힌다.
  const text = chars(20)
  const once  = one([{ step_type: 'tts', config: { content: text } }], { lane: 'flow' })
  const twice = one([{ step_type: 'tts', config: { content: text, repeat_broadcast: 1 } }], { lane: 'flow' })
  assert.ok(twice.ms > once.ms * 1.8,
    `두 번 읽기가 ${twice.ms}ms로 한 번(${once.ms}ms)과 비슷하다`)
})

test('묶음(group) 단계는 소리가 없다 — 상한 3분이 아니라 0초다', () => {
  // 예전엔 default로 떨어져 흐름 음원 상한(180초)으로 잡혔다.
  const s = one([{ step_type: 'group', config: {} }], { lane: 'flow' })
  assert.equal(s.ms, 0)
  assert.equal(s.confidence, 'fixed')
})

test('흐름 음원 재생목록은 곡마다 끝까지 기다린다 — 4곡이면 4배다', () => {
  const s = one([{ step_type: 'audio', config: { playlist: [1, 2, 3, 4] } }], {
    lane: 'flow',
    audioFiles: { 1: { exists: true, duration: 60 }, 2: { exists: true, duration: 60 },
                  3: { exists: true, duration: 60 }, 4: { exists: true, duration: 60 } },
  })
  assert.equal(s.ms, 4 * (60000 + 2000))

  // 길이를 모르는 곡이 섞이면 그 곡만 상한이고 전체가 상한으로 내려간다
  const mixed = one([{ step_type: 'audio', config: { playlist: [1, 2] } }], {
    lane: 'flow',
    audioFiles: { 1: { exists: true, duration: 60 }, 2: { exists: true, duration: 0 } },
  })
  assert.equal(mixed.ms, 62000 + FLOW_AUDIO_CAP_MS)
  assert.equal(mixed.confidence, 'upperBound')
})
