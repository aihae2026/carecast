// "이 방송은 대략 몇 분 걸린다" — 순서편집기 머리에 뜨는 숫자의 계산.
//
// 이 값은 장식이 아니라 **주장**이다. 사람이 이걸 보고 다음 방송 시각을 정한다. 그래서
// 규칙은 전부 서버가 **실제로 기다리는 시간**에서 가져왔고, 계산식은 베껴 적지 않고
// 실행 경로의 함수를 그대로 불러 쓴다(4.5자/초 같은 상수가 바뀌면 추정도 같이 움직여야 한다).
//
// 여기서 조심한 것 다섯:
//
// 1) **식이 셋이다.** 자동방송 TTS(ttsWaitMs, 4.5자/초·배속 비례), 식사 안내 TTS(3.5자/초·
//    배속 무시), 흐름 TTS(글자수×180ms). 하나로 합치면 어느 한쪽이 반드시 틀린다.
//    게다가 한 자동방송 안에서도 갈린다 — 커스텀 tts/message는 자동 식(stepTTS)으로 가고,
//    커스텀 audio/chime/delay/bgm은 flowRunner.runStep(흐름 식)으로 간다.
//
// 2) **BGM은 총 시간을 늘리지 않는다.** 음악은 다음 단계들 밑에 계속 깔린다 — 재생 시간을
//    더하면 같은 시간을 두 번 센다. 더하는 것은 시작 직후의 고정 대기(선재생)뿐이다.
//
// 3) **방송 뒤 배경 영상은 반대이면서 또 다르다.** 서버는 SSE만 쏘고 800ms 뒤 다음 단계로 가지만
//    화면은 durationMin 동안 계속 튼다. 사람이 알고 싶은 건 "방이 언제 비는가"라 재생 시간을
//    세야 하는데, **뒤 단계와 동시에 흐른다.** 그래서 총합은 단순 합이 아니라
//    max(순차 진행, 영상이 끝나는 시각)이다. 영상을 중간으로 끌어 올리면 이 차이가 드러난다.
//
// 4) **"파일이 없다"와 "길이를 모른다"는 다르다.** 실행부는 파일이 아예 없으면 **대기 없이
//    건너뛴다**(stepAudioFile/stepVideoFile의 `if (!file) return`). 그걸 상한 300초로 세면
//    없는 소리를 5분짜리로 적는 것이 된다. 재료를 모으는 쪽이 둘을 갈라서 넘겨야 한다.
//
// 5) **모르는 것은 모른다고 말한다.** 재생시간이 없는 음원은 상한까지만 알 수 있고 실제로는
//    대개 훨씬 짧다. 단계마다 confidence를 달고, 전체는 **가장 약한 것**을 따른다.
'use strict'

// 자동방송 5종이 단계마다 본작업 전에 쓰는 고정 간격(broadcastSequencer의 for 루프).
// 흐름(runFlow)에는 이 간격이 없다.
const STEP_GAP_MS = 800

// BGM 시작 뒤의 고정 대기. **같은 id라도 방송마다 다르다** — 그래서 탭을 재료로 받는다.
const BGM_LEAD_MS = {
  morning:        { bgm: 1500, bgm_after: 1000 },
  exercise:       { bgm: 1500 },
  lunch:          { bgm_start: 1500, bgm: 0 },
  dinner:         { bgm_start: 1500, bgm: 0 },
  evening_prayer: { bgm: 3500, bgm_closing: 2000, bgm_final: 2000 },
}

const BGM_DELAY_DEFAULT_SEC = 5     // 커스텀·흐름 BGM 단계의 선재생(flowRunner)
const MEDICATION_DELAY_MIN  = 6     // 투약 안내 기본 대기(`Number(step.delay_min) || 6`)
const CHIME_MS              = 3000  // 차임벨 뒤 대기(flowRunner)
const SCENE_VIDEO_DEFAULT_MIN = 10  // 배경 영상에 durationMin이 없을 때(`parseInt(...) || 10`)

// 재생시간을 모를 때의 **상한**. 경로마다 다르다 — 자동방송의 고정 음원 단계는 호출부가
// 300초를 넘기고(stepAudioFile의 시그니처 기본값 180이 아니다), 흐름·커스텀 음원은 180초,
// 업로드 영상은 480초다. 시그니처만 보고 180으로 통일하면 자동방송이 2분 짧게 나온다.
const AUTO_AUDIO_CAP_MS = 300 * 1000
const FLOW_AUDIO_CAP_MS = 180 * 1000
const VIDEO_FILE_CAP_MS = 480 * 1000
const VIDEO_FADE_MS     = 1500      // stepVideoFile이 BGM 페이드아웃을 기다리는 시간

// 서버가 그 자리에서 문장을 조립해 읽는 안내 — 사람이 넣는 문구 칸이 없어 길이를 미리 모른다.
// 날짜+날씨+미세먼지+특보+일정을 이어 붙이면 길게는 250자쯤 된다(services/morning.js).
// 그래서 그 길이를 **상한**으로 잡는다. 6초(빈 문자열)로 잡으면 30~60초짜리를 통째로 놓친다.
const ASSEMBLED_TEXT_IDS = new Set(['date_weather_schedule', 'date_weather'])
const ASSEMBLED_TEXT_CAP_CHARS = 250

// 식사 안내 — stepPrayerTTS는 3.5자/초에 하한 8초이고 배속 설정을 보지 않는다(0.80 고정).
// 다만 **녹음 파일이 있으면 그 음원을 튼다**(stepMealPrayer). 파일이 있는데 길이를 모르면
// TTS가 아니라 음원 상한이다.
const GRACE_TTS_IDS = new Set(['breakfast_prayer_tts', 'lunch_prayer_tts', 'dinner_prayer_tts'])
function graceTtsMs(len) { return Math.max(8000, Math.ceil(len / 3.5) * 1000 + 3000) }

// 실행부의 stepTTS·stepPrayerTTS는 첫 줄이 `if (!text?.trim()) return`이다 — 문구가 비면
// **아무 소리도 안 난다**. 하한 6초·8초를 붙이면 나가지도 않을 시간을 방송 길이에 넣는 것이다.
// (저녁 마무리 3종만 실행부에 `|| 기본문구`가 있어 빈칸이어도 기본 문구가 나간다. 그쪽은
//  라우트가 채워서 넘기므로 여기 오는 문구는 이미 기본값이다.)
const blank = (t) => !String(t ?? '').trim()

// "이건 나가야 하는데 안 나간다"의 사유. **사람이 읽을 문장**이다 — 화면이 그대로 보여준다.
// 대기·묶음처럼 원래 소리가 없는 단계에는 붙이지 않는다. 붙이면 목록이 잔소리가 되고,
// 잔소리가 되면 사람이 진짜 경고를 안 본다.
const SKIP = {
  noText:     '문구가 비어 있어 소리가 나지 않습니다',
  noAudio:    '음원 파일이 없습니다',
  noVideo:    '영상 파일이 없습니다',
  noPick:     '파일을 아직 고르지 않았습니다',
  allGone:    '고른 파일이 모두 지워졌습니다',
  noGrace:    '녹음도 없고 문구도 비어 있습니다',
  pastEndDate: '종료일이 지나 나가지 않습니다',
}

const AUDIO_STEP_IDS = new Set([
  'morning_prayer', 'lunch_prayer_audio', 'dinner_prayer_audio',
  'evening_prayer_audio', 'evening_closing_audio',
])
const UPLOAD_VIDEO_IDS = new Set(['exercise_video', 'lunch_video', 'dinner_video'])
const SCENE_VIDEO_IDS  = new Set(['morning_video', 'lunch_video_after', 'dinner_video_after'])

const TTS_STEP_IDS = new Set([
  'exercise_tts', 'lunch_tts', 'dinner_tts',
  'morning_prayer_intro', 'lunch_prayer_intro',
  'evening_prayer_tts', 'evening_prayer_tts2', 'evening_closing_tts',
  'date_weather_schedule', 'date_weather',
])

// 확신도 — 약한 순서. 전체는 가장 약한 것을 따른다.
const CONF_RANK = { fixed: 0, estimate: 1, upperBound: 2 }
const weaker = (a, b) => (CONF_RANK[b] > CONF_RANK[a] ? b : a)

// 실행 경로의 계산식을 그대로 빌려 온다. **호출 시점에 require한다** — 이 모듈은 라우트가
// 부르고, 서비스 계층은 이 모듈을 부르지 않으므로 순환은 없다. 다만 서비스 묶음(스위치봇·
// 차임 등)을 로드 시점에 끌고 들어오지 않도록 미룬다.
function ttsWaitMs(len, rate) {
  return require('../services/broadcastSequencer').ttsWaitMs(len, rate)
}
function flowTtsMs(text) {
  return require('../services/flowRunner').estimateTtsDurationMs(text)
}

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
// 실행부가 쓰는 falsy 폴백(`Number(x) || 기본값`)을 그대로 흉내 낸다 — 0을 넣으면 0이 아니라
// 기본값이 된다. `num(0, 6)`으로 쓰면 실행부는 6분을 기다리는데 추정만 0분이 된다.
const orDefault = (v, d) => (num(v, 0) || d)

function speedOf(step) {
  // 실행부(stepAudioFile·stepVideoFile)는 normalizePlaybackRate로 0.5~1.5로 자른 뒤 재생한다.
  // 범위를 여기 베껴 적으면 한쪽만 바뀌었을 때 화면 숫자가 조용히 갈라진다 — 그 함수를 그대로 쓴다.
  // (지연 require는 이 파일의 다른 실측 인용과 같은 이유다)
  const { normalizePlaybackRate } = require('../services/scheduleStore')
  return normalizePlaybackRate(step?.rate ?? step?.config?.rate) || 1
}
// 길이를 아는 파일의 대기 — 서버와 같은 식(반올림 후 여유). 음원은 +2초, 영상은 +3초.
function knownFileMs(durationSec, speed, extraMs) {
  return Math.round(durationSec / speed) * 1000 + extraMs
}

// 재료로 받은 파일 정보를 세 상태로 읽는다.
//   'missing' — 그 카테고리에 파일이 하나도 없다 → 실행부가 **건너뛴다**(0초)
//   'known'   — 길이를 안다
//   'unknown' — 파일은 있는데 duration이 0/없음 → 상한까지만 알 수 있다
// 재료를 아예 안 준 경우(undefined)는 'unknown'으로 본다 — 모른 채 0으로 적으면 방송이
// 실제보다 짧게 보이고, 그쪽이 더 위험하다(사람이 다음 방송을 너무 일찍 잡는다).
function fileStateOf(info) {
  if (info && info.exists === false) return 'missing'
  const d = num(info?.duration)
  if (d > 0) return 'known'
  return 'unknown'
}

// 흐름(runFlow) 단계 하나. 실제 규칙은 flowRunner.runStep에 있다.
function flowStepMs(step, m = {}) {
  const c = step.config || {}
  const files = m.audioFiles || {}
  const speed = speedOf(step)
  switch (step.step_type) {
    case 'tts': {
      // 두 번 읽기(repeat_broadcast)를 켜면 실제 문장이 두 배가 된다(flowRunner)
      const base = c.content || ''
      // flowRunner는 `(config.content || '').trim()`이 비면 그 자리에서 돌아온다
      if (blank(base)) return { ms: 0, confidence: 'fixed', skip: SKIP.noText }
      const text = require('./broadcastDefaults').반복문안(base, c.repeat_broadcast)
      return { ms: flowTtsMs(text), confidence: 'estimate' }
    }
    case 'bgm': {
      // 선재생 + (마지막 곡을 뺀) 각 곡의 duration_sec. 마지막 곡은 대기 없이 계속 흐른다.
      const items = Array.isArray(c.playlist) && c.playlist.length ? c.playlist : [c]
      let ms = 0
      items.forEach((it, i) => {
        ms += orDefault(it.bgm_delay ?? c.bgm_delay, BGM_DELAY_DEFAULT_SEC) * 1000
        if (i < items.length - 1) ms += Math.max(0, num(it.duration_sec)) * 1000
      })
      return { ms, confidence: 'fixed' }
    }
    case 'chime': return { ms: CHIME_MS, confidence: 'fixed' }
    case 'delay': return { ms: num(c.wait_sec) * 1000, confidence: 'fixed' }
    case 'group': return { ms: 0, confidence: 'fixed' }   // 묶음 표시용 단계 — 소리가 없다
    case 'audio':
    case 'video_file': {
      // 흐름은 영상도 음원과 **같은** audioWaitCapMs로 기다린다(flowRunner의 video_file 분기).
      // 480초·여유 3초는 자동방송의 고정 영상 단계(stepVideoFile)에만 해당한다 — 그 값을
      // 여기 쓰면 커스텀 영상 하나에 종료 시각이 5분 부푼다.
      const cap = FLOW_AUDIO_CAP_MS
      const extra = 2000
      const ids = Array.isArray(c.playlist) && c.playlist.length
        ? c.playlist
        : (c.audio_file_id ? [c.audio_file_id] : [])
      // 재생목록이 비면 flowRunner의 루프가 한 번도 안 돈다 — 아무것도 안 하므로 0초다.
      // 순서편집기가 갓 추가한 음원·영상 단계가 정확히 이 상태다(playlist: []).
      if (!ids.length) return { ms: 0, confidence: 'fixed', skip: SKIP.noPick }
      // 재생목록은 곡마다 끝까지 기다린다 — 4곡이면 4배다
      let ms = 0
      let conf = 'fixed'
      let alive = 0
      for (const id of ids) {
        const st = fileStateOf(files[id])
        if (st === 'missing') continue   // 실행부의 `if (!file) continue`
        alive++
        if (st === 'known') ms += knownFileMs(num(files[id].duration), speed, extra)
        else { ms += cap; conf = weaker(conf, 'upperBound') }
      }
      // 고른 파일이 하나도 안 남았으면 이 단계는 통째로 조용하다
      if (!alive) return { ms: 0, confidence: 'fixed', skip: SKIP.allGone }
      return { ms, confidence: conf }
    }
    default:
      return { ms: 0, confidence: 'fixed' }
  }
}

// 커스텀 단계 → 흐름 단계. **broadcastSequencer.runCustomExtraStep과 같은 목록이다** —
// 그쪽이 실제로 실행하는 모양이라, 여기서 다르게 적으면 화면 숫자가 실행과 갈라진다.
const CUSTOM_STEP_TYPES   = new Set(['bgm', 'audio', 'chime', 'delay', 'video_file'])

function customStepConfig(stepType, step) {
  switch (stepType) {
    case 'bgm':        return { playlist: step.playlist, bgm_type: step.bgm_type, bgm_value: step.bgm_value, bgm_title: step.bgm_title, bgm_delay: step.bgm_delay }
    case 'audio':      return { playlist: step.playlist, audio_file_id: step.audio_file_id, rate: step.rate }
    case 'video_file': return { playlist: step.playlist, audio_file_id: step.audio_file_id, rate: step.rate }
    case 'delay':      return { wait_sec: step.wait_sec }
    default:           return {}   // chime — 시간에 영향을 주는 값이 없다
  }
}

// 자동방송(fire*Broadcast) 단계 하나. materials로 문구·파일 상태를 받는다.
// 반환의 concurrent=true는 "이 단계는 다음 단계와 **동시에** 흐른다"는 뜻이다(배경 영상).
function autoStepMs(step, m) {
  const id    = step.id
  const texts = m.texts || {}
  const files = m.audioFiles || {}
  const rate  = m.ttsRate
  const speed = speedOf(step)
  const state = fileStateOf(files[id])
  const dur   = num(files[id]?.duration)

  // 사람이 추가한 커스텀 단계 — tts/message만 자동방송 식으로 가고 나머지는 흐름 경로다
  const ct = step.customType
  if (ct === 'tts' || ct === 'message') {
    const text = step.content || texts[id] || ''
    if (blank(text)) return { ms: 0, confidence: 'fixed', skip: SKIP.noText }
    return { ms: ttsWaitMs(text.length, rate), confidence: 'estimate' }
  }
  if (ct) {
    // 실행부(runCustomExtraStep)는 커스텀 단계를 **flowRunner.runStep에 그대로 넘긴다**.
    // 그러니 규칙도 흐름 것을 그대로 쓴다 — 여기 베껴 적으면 두 벌이 되어, 한쪽만 고쳐진
    // 순간 화면 숫자가 조용히 갈라진다(실제로 그래서 커스텀 BGM·음원이 어긋나 있었다).
    const stepType = ct
    if (!CUSTOM_STEP_TYPES.has(stepType)) return { ms: 0, confidence: 'fixed' }
    return flowStepMs({ step_type: stepType, config: customStepConfig(stepType, step) }, m)
  }
  if (ct === 'bgm') {
    // flowRunner의 bgm 루프와 같은 규칙 — 곡마다 선재생을 기다리고, **마지막이 아닌 곡만**
    // duration_sec만큼 더 기다린 뒤 다음 곡으로 넘어간다. 첫 곡만 세면 3곡짜리 단계가
    // 5초로 나와서 화면이 그 방송을 2분 넘게 짧게 적는다.
    // 재생목록이 비면 flowRunner처럼 단일 곡 한 벌로 본다.
    const items = Array.isArray(step.playlist) && step.playlist.length
      ? step.playlist
      : [{ bgm_delay: step.bgm_delay }]
    let ms = 0
    for (let i = 0; i < items.length; i++) {
      ms += orDefault(items[i].bgm_delay, BGM_DELAY_DEFAULT_SEC) * 1000
      if (i < items.length - 1) ms += Math.max(0, num(items[i].duration_sec)) * 1000
    }
    return { ms, confidence: 'fixed' }
  }
  if (ct === 'chime') return { ms: CHIME_MS, confidence: 'fixed' }
  if (ct === 'delay') return { ms: num(step.wait_sec) * 1000, confidence: 'fixed' }
  if (ct === 'audio' || ct === 'video_file') {
    const cap   = ct === 'audio' ? FLOW_AUDIO_CAP_MS : VIDEO_FILE_CAP_MS
    const extra = ct === 'audio' ? 2000 : 3000
    if (state === 'missing') return { ms: 0, confidence: 'fixed' }
    if (state === 'known')   return { ms: knownFileMs(dur, speed, extra), confidence: 'fixed' }
    return { ms: cap, confidence: 'upperBound' }
  }

  // BGM 시작 단계 — 더하는 것은 선재생뿐이다(음악은 다음 단계 밑에 계속 깔린다)
  const lead = BGM_LEAD_MS[m.tab]?.[id]
  if (lead !== undefined) return { ms: lead, confidence: 'fixed' }

  // 투약 안내 — 대기 + TTS 둘 다. 다만 **종료일이 지났으면 통째로 안 나간다**
  // (`if (step.end_date && todayStr() > step.end_date) break`).
  if (id === 'medication_tts') {
    if (step.end_date && (m.today || '') > step.end_date) {
      return { ms: 0, confidence: 'fixed', skip: SKIP.pastEndDate }
    }
    const waitMs = orDefault(step.delay_min, MEDICATION_DELAY_MIN) * 60 * 1000
    const text   = step.content || texts[id] || ''
    // 대기는 문구와 무관하게 먼저 흐른다 — 문구가 비면 그 뒤 TTS만 안 나간다.
    if (blank(text)) return { ms: waitMs, confidence: 'fixed' }
    return { ms: waitMs + ttsWaitMs(text.length, rate), confidence: 'estimate' }
  }

  if (GRACE_TTS_IDS.has(id)) {
    // 녹음 파일이 **있기만 하면** 그 음원을 튼다(길이를 몰라도 상한 300초로 기다린다).
    // 없을 때만 TTS다.
    if (step.useGraceAudio !== false && state !== 'missing') {
      if (state === 'known') return { ms: knownFileMs(dur, speed, 2000), confidence: 'fixed' }
      if (files[id] !== undefined) return { ms: AUTO_AUDIO_CAP_MS, confidence: 'upperBound' }
    }
    const graceText = texts[id] || ''
    if (blank(graceText)) return { ms: 0, confidence: 'fixed', skip: SKIP.noGrace }
    return { ms: graceTtsMs(graceText.length), confidence: 'estimate' }
  }
  if (UPLOAD_VIDEO_IDS.has(id)) {
    if (state === 'missing') return { ms: 0, confidence: 'fixed', skip: SKIP.noVideo }
    if (state === 'known')   return { ms: VIDEO_FADE_MS + knownFileMs(dur, speed, 3000), confidence: 'fixed' }
    return { ms: VIDEO_FADE_MS + VIDEO_FILE_CAP_MS, confidence: 'upperBound' }
  }
  if (SCENE_VIDEO_IDS.has(id)) {
    // 서버는 800ms만 기다리지만 화면은 durationMin 동안 계속 튼다 — 방이 그만큼 차 있다.
    // 다만 그 사이 **다음 단계가 함께 진행된다**(concurrent). 그리고 배경 영상 폴더가 비면
    // 아무것도 안 트므로 이건 확정이 아니라 상한이다.
    return {
      ms: orDefault(step.durationMin, SCENE_VIDEO_DEFAULT_MIN) * 60 * 1000,
      confidence: 'upperBound',
      concurrent: true,
    }
  }
  if (AUDIO_STEP_IDS.has(id)) {
    if (state === 'missing') return { ms: 0, confidence: 'fixed', skip: SKIP.noAudio }
    if (state === 'known')   return { ms: knownFileMs(dur, speed, 2000), confidence: 'fixed' }
    return { ms: AUTO_AUDIO_CAP_MS, confidence: 'upperBound' }
  }
  if (ASSEMBLED_TEXT_IDS.has(id) && !(texts[id] || '').length) {
    // 서버가 그 자리에서 조립하는 안내 — 길이를 미리 모른다. 6초로 단정하지 않는다.
    return { ms: ttsWaitMs(ASSEMBLED_TEXT_CAP_CHARS, rate), confidence: 'upperBound' }
  }
  if (TTS_STEP_IDS.has(id) || texts[id] != null) {
    const text = texts[id] || ''
    if (blank(text)) return { ms: 0, confidence: 'fixed', skip: SKIP.noText }
    return { ms: ttsWaitMs(text.length, rate), confidence: 'estimate' }
  }

  // 소리를 내지 않는 단계(모르는 id 포함) — 시간을 지어내지 않는다.
  // `wait_exercise`처럼 화면에만 남아 있고 실행부의 어느 case에도 없는 것도 여기로 온다.
  return { ms: 0, confidence: 'fixed' }
}

// 켜짐 판정 — 실행부는 `if (!step.enabled) continue` 하나지만, 두 종류의 단계가 여기까지
// 오는 경로가 다르다.
//  · 기본 단계: mergeStepsWithDefaults가 `{...def, ...user}`로 합치므로 enabled가 항상 채워져
//    실행부에 닿는다. 표시가 없는 채로 여기 오는 건 아직 병합 전 입력이라는 뜻이라 켜진 것으로 본다.
//  · 커스텀 단계: 같은 함수가 저장된 그대로 통과시킨다(customSteps는 병합 대상이 아니다).
//    그래서 표시가 빠진 채 실행부에 닿을 수 있고, 그때 실행부는 **건너뛴다**. 여기서 세면
//    화면이 나가지도 않을 10분짜리 대기를 방송 길이에 넣는다.
function isStepOn(step) {
  return step.customType ? Boolean(step.enabled) : step.enabled !== false
}

/**
 * 단계 배열 → 단계별 예상 시간과 총합.
 * materials = { tab, lane:'auto'|'flow', ttsRate, today:'YYYY-MM-DD',
 *               texts:{id:문구}, audioFiles:{id:{exists,duration}} }
 *
 * 총합은 단순 합이 아니다 — 배경 영상은 뒤 단계와 동시에 흐르므로
 * max(순차 진행 끝, 영상이 끝나는 시각)이다.
 */
function estimateBroadcastDuration(steps, materials = {}) {
  const lane = materials.lane === 'flow' ? 'flow' : 'auto'
  const list = Array.isArray(steps) ? steps : []
  // 꺼 둔 단계는 시퀀서가 `continue`로 건너뛴다 — 800ms 간격에 닿기도 전이다
  const on   = list.filter(s => s && isStepOn(s))

  const gap = lane === 'flow' ? 0 : STEP_GAP_MS
  let cursor = 0        // 순차로 흘러온 시각
  let busyUntil = 0     // 동시에 흐르는 것(영상)이 끝나는 시각

  const out = on.map((step, i) => {
    const r = lane === 'flow' ? flowStepMs(step, materials) : autoStepMs(step, materials)
    const ms = Math.max(0, r.ms)
    cursor += gap
    if (r.concurrent) {
      // 서버는 곧바로 다음 단계로 간다 — 방만 그만큼 더 차 있다
      busyUntil = Math.max(busyUntil, cursor + ms)
    } else {
      cursor += ms
      busyUntil = Math.max(busyUntil, cursor)
    }
    return {
      id:    step.id ?? step.step_type ?? `step_${i}`,
      label: step.label ?? '',
      ms:    gap + ms,
      confidence: r.confidence,
      ...(r.concurrent ? { concurrent: true } : {}),
      // "나가야 하는데 안 나간다"의 사유. 원래 소리가 없는 단계(대기·묶음)에는 없다.
      ...(r.skip ? { skip: r.skip } : {}),
    }
  })

  // 빠지는 단계 목록 — 화면이 세어 보지 않아도 되게 여기서 한 번에 준다
  const skippedStepIds = out.filter(o => o.skip).map(o => o.id)

  const totalMs = Math.max(cursor, busyUntil)
  const upperBoundStepIds = out.filter(s => s.confidence === 'upperBound').map(s => s.id)
  const confidence = out.reduce((acc, s) => weaker(acc, s.confidence), 'fixed')

  return {
    steps: out,
    totalMs,
    confidence,
    hasUpperBound: upperBoundStepIds.length > 0,
    upperBoundStepIds,
    skippedStepIds,
  }
}

/**
 * 시작 시각(HH:MM) + 총합 → 끝나는 시각.
 * 초는 **올림**한다 — 아직 방송 중인 분을 "끝났다"고 적으면 사람이 그 분에 다음 방송을 잡는다.
 * 자정을 넘으면 dayOffset으로 드러낸다("00:20"만 적으면 오늘 새벽으로 읽는다).
 */
function estimateEndTime(startHHMM, totalMs) {
  const [h, m] = String(startHHMM || '00:00').split(':').map(v => num(v))
  const startMin = h * 60 + m
  const addMin   = Math.ceil(Math.max(0, num(totalMs)) / 60000)
  const total    = startMin + addMin
  const dayOffset = Math.floor(total / 1440)
  const minOfDay  = ((total % 1440) + 1440) % 1440
  const hh = String(Math.floor(minOfDay / 60)).padStart(2, '0')
  const mm = String(minOfDay % 60).padStart(2, '0')
  return { time: `${hh}:${mm}`, dayOffset }
}

// 단계 id → 음원·영상 카테고리. 라우트가 그 단계에서 실제로 재생될 파일을 찾을 때 쓴다.
// 값은 broadcastSequencer의 호출부에서 그대로 가져왔다(stepAudioFile/stepVideoFile 인자).
// evening_closing_audio만 폴백이 있다 — 'evening-prayer' 파일이 없으면 'dinner-prayer'를 튼다.
const STEP_AUDIO_CATEGORY = {
  morning_prayer:        'morning-prayer',
  lunch_prayer_audio:    'lunch-prayer',
  dinner_prayer_audio:   'dinner-prayer',
  evening_prayer_audio:  'dinner-prayer',
  evening_closing_audio: 'evening-prayer',
  exercise_video:        'exercise-video',
  lunch_video:           'lunch-video',
  dinner_video:          'dinner-video',
  breakfast_prayer_tts:  'breakfast-grace',
  lunch_prayer_tts:      'lunch-grace',
  dinner_prayer_tts:     'dinner-grace',
}

// 2026-09-04: 이 구분이 사라졌다. 예전엔 재생목록을 보는 것이 **영상 단계뿐**이라 음원과
// 영상이 파일을 다르게 골랐고, 그 차이를 이 집합으로 지켰다. 이제 음원·영상·예상시간이
// 전부 `domain/categoryPick.js`의 pickCategoryFile 하나를 쓴다 — 베낄 규칙이 없으니
// 어긋날 것도 없다. 값은 다른 데서 쓰던 곳이 없어 지운다.

module.exports = {
  estimateBroadcastDuration,
  estimateEndTime,
  STEP_AUDIO_CATEGORY,
  // 화면·테스트가 근거를 짚을 수 있게 상수도 함께 내보낸다
  STEP_GAP_MS, BGM_LEAD_MS, AUTO_AUDIO_CAP_MS, FLOW_AUDIO_CAP_MS, VIDEO_FILE_CAP_MS,
  ASSEMBLED_TEXT_CAP_CHARS, SCENE_VIDEO_DEFAULT_MIN,
}
