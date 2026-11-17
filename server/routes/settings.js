const express = require('express')
const { getDB } = require('../db/schema')

const router = express.Router()

// 설정 값 읽기 헬퍼
function getSetting(db, key, defaultValue = '') { return rawSetting(db, key) ?? defaultValue }

// 설정 값 저장 헬퍼 (upsert)
// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting } = require('../domain/settingsRead')
const { findBrokenField, brokenTextMessage, hasBrokenText } = require('../domain/text')

// 일과방송 5종의 기본 시각은 domain/autoBroadcasts.js 한 곳에서 온다(2026-09-01 TD-07).
// 예전엔 이 화면이 자기 기본값을 따로 갖고 있었고, morning_time 하나는 값까지 갈라져
// 있었다(여기 '08:30' vs 실제 발동 '07:50'). 설정이 비어 있는 PC에서 **화면이 보여주는
// 시각과 실제로 나가는 시각이 달랐다.**
const { AUTO_BROADCASTS, 유효시각 } = require('../domain/autoBroadcasts')
// 제미나이 모델 기본값의 단일 출처 — 예전엔 이 파일이 자기 값을 따로 갖고 있었고
// 실제 호출과 갈렸다(domain/geminiModel.js 머리말).
const { DEFAULT_GEMINI_MODEL, AUTO, isAutoModel, currentGeminiModel } = require('../domain/geminiModel')
const autoDefaultTime = id => AUTO_BROADCASTS.find(b => b.id === id).defaultTime
const autoNameKey     = id => AUTO_BROADCASTS.find(b => b.id === id).nameKey

// 저장된 출력장치 이름을 읽되, **이미 깨져 있으면 치우고 빈 값을 돌려준다.**
//
// 2026-08-30에 실제로 이 값이 U+FFFD(글자 깨짐 표시)로 뒤덮인 채 들어앉아 있었다. 이제
// 저장 경로는 sanitizeDeviceName이 막지만, **이미 들어가 있는 값은 아무도 안 치운다** —
// 서버는 그걸 계속 못 찾아 기본 장치로 재생하고, audioDeviceWatcher는 2분마다 헛복원을
// 시도하며, 화면은 "설정돼 있네" 하고 넘어간다. 읽는 김에 정리하는 것이 가장 확실하다.
// 깨진 값은 복구가 불가능하므로(원본 바이트가 사라졌다) 지우는 것 말고 할 수 있는 게 없다.
function readAudioDevice(db) {
  const raw = getSetting(db, 'audio_device', '')
  const checked = require('../services/audioDevices').sanitizeDeviceName(raw)
  if (checked.ok) return checked.value
  console.warn(`[설정] 저장돼 있던 출력장치 이름이 깨져 있어 비웁니다 — 관리자 화면에서 다시 골라주세요`)
  setSetting(db, 'audio_device', '')
  try { require('../services/audioDevices').clearDeviceCache() } catch { /* 캐시 없으면 무시 */ }
  return ''
}

// ── 이 PC의 역할 (현장 PC / 개발·테스트 PC) ──────────────────
//
// 왜 있나: 같은 코드가 현장 PC와 개발 PC 양쪽에서 도는데, 어떤 동작은 현장에서만 옳다.
// 지금 이 판정에 걸린 것은 **출력장치 강제 복원**(audioDeviceWatcher) 하나다 — 현장에서는
// 누가 장치를 바꿔도 방송이 스피커로 나가게 해 주는 안전장치지만, 개발 PC에서는 개발자가
// 고른 사운드 장치를 2분마다 뺏어가는 짓이 된다.
// 기본은 브랜치 자동 판정(main = 현장)이고, 여기서 사람이 덮어쓸 수 있다.

// GET /api/settings/pc-role
router.get('/pc-role', (req, res) => {
  try {
    const db = getDB()
    const { getRole, detectBranch, roleLabel, SITE, DEV } = require('../services/pcRole')
    const override = getSetting(db, 'pc_role', '')
    const branch   = detectBranch()
    const role     = getRole(db)
    res.json({
      role,                                   // 'site' | 'dev' — 실제로 적용 중인 값
      label:  roleLabel(role),
      override: (override === SITE || override === DEV) ? override : 'auto',
      branch,                                 // 빈 문자열이면 브랜치를 못 읽은 것
      source: (override === SITE || override === DEV) ? '설정' : '브랜치',
    })
  } catch (err) {
    console.error('[settings/pc-role GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/pc-role  { role: 'auto' | 'site' | 'dev' }
router.post('/pc-role', (req, res) => {
  const { SITE, DEV } = require('../services/pcRole')
  const wanted = String(req.body?.role ?? '').trim()
  if (!['auto', SITE, DEV].includes(wanted)) {
    return res.status(400).json({ error: "role은 'auto' · 'site' · 'dev' 중 하나여야 합니다." })
  }
  try {
    const db = getDB()
    // 'auto'는 값을 비워 브랜치 판정으로 되돌린다 — 별도 표식을 남기면 의미가 둘이 된다
    setSetting(db, 'pc_role', wanted === 'auto' ? '' : wanted)
    // 다음 서버 시작부터 반영된다. 지금 돌고 있는 감시를 여기서 끄지 않는 이유:
    // 현장 PC에서 실수로 '개발'을 골랐다가 되돌릴 때, 감시를 껐다 켜는 경로를 하나 더
    // 만들면 그 경로가 또 하나의 실패 지점이 된다. 재시작이 확실하고 드문 일이다.
    res.json({ ok: true, restartRequired: true })
  } catch (err) {
    console.error('[settings/pc-role POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/tts — TTS 설정 불러오기
router.get('/tts', (req, res) => {
  try {
    const db = getDB()
    res.json({
      voiceNormal:    getSetting(db, 'tts_voice_normal',    'ko-KR-SunHiNeural'),
      // 예전 기본값 ko-KR-GookMinNeural 은 **없는 목소리**였다(2026-09-18 제출판 아침 방송 500).
      // 저장소의 다른 모든 기본값이 SunHi 이고 이 한 줄만 달랐다.
      voiceMorning:   getSetting(db, 'tts_voice_morning',   'ko-KR-SunHiNeural'),
      voiceEmergency: getSetting(db, 'tts_voice_emergency', 'ko-KR-InJoonNeural'),
      rate:        parseFloat(getSetting(db, 'tts_rate',   '0.9')),
      pitch:       parseFloat(getSetting(db, 'tts_pitch',  '1')),
      // 예전엔 tts_volume이라는 이 화면 전용 키에 저장했는데 재생 코드가 아무도 읽지 않아서
      // 이 슬라이더는 소리에 영향이 없었다(2026-08-28 발견). 이제 안내 음성 채널을 직접 본다.
      volume:      require('../domain/volume').readVolume(db, 'tts'),
      audioDevice: readAudioDevice(db),  // 오디오 출력 장치명 (빈 문자열 = 기본 장치)
      // ── 시작음·종료음 — **브라우저가 아니라 여기가 정본이다** (사용자 결정 2026-09-13)
      // 그전에는 `localStorage['carecast:ttsChimeStart']` 에 있었다. 그러면 **PC·브라우저마다
      // 값이 갈린다** — 현장 PC 에서 끈 것이 직원 폰에서는 켜져 있다. 이 저장소가 볼륨에서
      // 똑같이 다쳤던 모양이다(볼륨을 서버 채널로 옮긴 이유, CLAUDE.md 볼륨 규칙).
      // 기본값은 **둘 다 켜짐** — 지금까지의 동작(`readToggle` 의 기본이 true)과 같다.
      chimeStart: getSetting(db, 'tts_chime_start', '1') !== '0',
      chimeEnd:   getSetting(db, 'tts_chime_end',   '1') !== '0',
      // 이 PC 음성(Supertonic)의 화자 0~9 (사용자 결정 2026-09-22, 기본 1 = 현장에서 고른 목소리)
      supertonicSid: require('../services/ttsEngines/supertonic').화자정리(getSetting(db, 'tts_supertonic_sid', '')),
      // 문장 사이 쉼(ms, 0 = 안 씀) — 이 PC 음성만(2026-09-22)
      sentencePauseMs: require('../domain/ttsSentences').쉼정리(getSetting(db, 'tts_sentence_pause_ms', '0')),
    })
  } catch (err) {
    console.error('[settings/tts GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/tts — TTS 설정 저장
router.post('/tts', (req, res) => {
  const { voiceNormal, voiceMorning, voiceEmergency, rate, pitch, volume, audioDevice, chimeStart, chimeEnd, supertonicSid } = req.body

  // 장치 이름 검사를 **모든 쓰기보다 먼저** 한다. 뒤에서 막으면 한 요청의 일부만 반영되어
  // 화면과 서버가 어긋난다(사람은 "저장됐다"고 보는데 값은 절반만 들어간 상태).
  // `보냈나()` 로 가른다(P-115) — `!== undefined` 는 `null` 을 통과시켜 **기존 장치를
  // 지웠다.** 빈 문자열(`''`)은 그대로 받는다: 그건 "Windows 기본 장치" 라는 **뜻이 있는 값**이다.
  let deviceValue = null
  if (보냈나(req.body, 'audioDevice')) {
    const checked = require('../services/audioDevices').sanitizeDeviceName(audioDevice)
    if (!checked.ok) return res.status(400).json({ error: checked.error })
    deviceValue = checked.value
  }
  // 목소리 검사도 **모든 쓰기보다 먼저**다(위와 같은 이유). 서버가 목소리 목록을 몰라서
  // 없는 ko-KR-GookMinNeural 이 그대로 저장돼 아침 방송이 죽었다(2026-09-18). 빈 값도
  // 막는다 — `tts_voice_normal = ''` 이면 방송이 쓰는 목소리가 엉킨다(EV-003961).
  // 화자 번호도 **쓰기 전에** 막는다 — 틀린 값을 조용히 1로 바꿔 저장하면 사람이 고른 것과 나가는 목소리가 갈린다.
  if (보냈나(req.body, 'supertonicSid')) {
    // 엄격하게 — 숫자 0~9 이거나 그 숫자만 든 글자(QA: false 가 0번, [3] 이 3번으로 저장됐다)
    const n = require('../domain/bgmRoles').번호읽기(supertonicSid, 0, 9)
    if (n === null) return res.status(400).json({ error: '이 PC 음성 목소리는 0~9 번 중에서 고릅니다.' })
  }
  if (보냈나(req.body, 'sentencePauseMs') && require('../domain/ttsSentences').쉼읽기엄격(req.body.sentencePauseMs) === null) {
    return res.status(400).json({ error: '문장 사이 쉼은 0~2000 밀리초(0~2초) 사이 정수로 정합니다.' })
  }
  const { 있는목소리인가 } = require('../domain/ttsVoices')
  for (const f of ['voiceNormal', 'voiceMorning', 'voiceEmergency']) {
    if (보냈나(req.body, f) && !있는목소리인가(req.body[f])) {
      return res.status(400).json({ error: `없는 목소리입니다: ${JSON.stringify(req.body[f])}` })
    }
  }

  try {
    const db = getDB()
    // **`!== undefined` 가 `null` 을 통과시켰다**(P-115). `null` 이 오면 `String(null)` 로
    // `"null"` 이 저장됐고(P-114 가 그것을 `""` 로 바꿨지만) **기존 목소리는 여전히 잃었다.**
    // [FACT] EV-003983 — `{"voiceNormal":null}` 에 `"ko-KR-InJoonNeural"` → `""`.
    // 위 `보냈나()` 가 "안 보낸 것" 과 "정하려 한 것" 을 가른다 — 같은 규칙을 여기도 쓴다.
    if (보냈나(req.body, 'voiceNormal'))    setSetting(db, 'tts_voice_normal',    voiceNormal)
    if (보냈나(req.body, 'voiceMorning'))   setSetting(db, 'tts_voice_morning',   voiceMorning)
    if (보냈나(req.body, 'voiceEmergency')) setSetting(db, 'tts_voice_emergency', voiceEmergency)
    if (보냈나(req.body, 'rate'))           setSetting(db, 'tts_rate',            rate)
    if (보냈나(req.body, 'pitch'))          setSetting(db, 'tts_pitch',           pitch)
    if (보냈나(req.body, 'volume'))         require('../domain/volume').writeVolumes(db, { tts: volume })
    // 참·거짓을 '1'/'0' 으로 적는다 — settings 는 글자만 담는다. `보냈나()` 로 갈라야
    // 한 칸만 보낸 요청이 나머지를 지우지 않는다(P-115 와 같은 규칙).
    if (보냈나(req.body, 'chimeStart'))     setSetting(db, 'tts_chime_start', chimeStart ? '1' : '0')
    if (보냈나(req.body, 'chimeEnd'))       setSetting(db, 'tts_chime_end',   chimeEnd   ? '1' : '0')
    if (보냈나(req.body, 'supertonicSid'))  setSetting(db, 'tts_supertonic_sid', String(require('../domain/bgmRoles').번호읽기(supertonicSid, 0, 9)))
    if (보냈나(req.body, 'sentencePauseMs')) setSetting(db, 'tts_sentence_pause_ms', String(require('../domain/ttsSentences').쉼읽기엄격(req.body.sentencePauseMs)))
    if (deviceValue !== null) {
      setSetting(db, 'audio_device', deviceValue)
      // 장치가 바뀌면 캐시 초기화 → 다음 방송 시 새 장치로 re-resolve
      try { require('../services/audioDevices').clearDeviceCache() } catch { /* 캐시 비우기 실패는 다음 방송이 옛 장치로 한 번 더 나가는 것뿐이다 — 설정 저장 자체를 되돌리지 않는다 */ }
      // 마이크 생방송용 상주 플레이어는 **뜰 때 장치를 물고 간다**(audioPlayer). 안 내리면
      // 캐시를 비워도 그 프로세스만 옛 장치로 계속 나간다. 내려도 다음 생방송에서 다시 뜬다.
      try { require('../services/audioPlayer').stop() } catch { /* 안 떠 있으면 내릴 것도 없다 */ }
      // 비운 캐시를 곧바로 다시 채운다 — 안 채우면 다음 차임벨이 (기다리지 않는 규칙 때문에)
      // 기본 장치로 나간다. 기다리지 않는다: 저장 응답이 PowerShell 조회에 묶이면 안 된다.
      try { require('../services/audioDevices').warmDeviceCache() } catch { /* 실패해도 다음 방송이 채운다 */ }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/tts POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/weather-alert — 기상특보 자동방송 설정 (기본: 꺼짐)
router.get('/weather-alert', (req, res) => {
  try {
    const db = getDB()
    res.json({ autoBroadcastEnabled: getSetting(db, 'weather_alert_broadcast_enabled', 'false') === 'true' })
  } catch (err) {
    console.error('[settings/weather-alert GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/weather-alert — 기상특보 자동방송 켜기/끄기
router.post('/weather-alert', (req, res) => {
  try {
    const db = getDB()
    setSetting(db, 'weather_alert_broadcast_enabled', req.body.autoBroadcastEnabled ? 'true' : 'false')
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/weather-alert POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/broadcast-prompt — AI 방송문 작성 지침 (미설정 시 빈 문자열 = 기본값 사용)
router.get('/broadcast-prompt', (req, res) => {
  try {
    const db = getDB()
    const { DEFAULT_SYSTEM_PROMPT } = require('../domain/broadcastPrompt')
    res.json({ prompt: getSetting(db, 'broadcast_system_prompt', ''), defaultPrompt: DEFAULT_SYSTEM_PROMPT })
  } catch (err) {
    console.error('[settings/broadcast-prompt GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── 로컬 AI(1차) 허용 스위치 ──────────────────────────────────────────────
//
// **"허용"과 "가능"은 다른 것이고, 둘 다 참이어야 1차가 돈다.**
//   허용 = 사람이 이 화면에서 켠 것        ← 여기(서버 설정, 모든 PC 공통)
//   가능 = 그 브라우저에 모델이 실제로 있나 ← localStorage 진단(PC 마다 다르다)
//
// 왜 나눴나: 서버 설정 하나로만 두면 관리자 PC 에서 켠 것이 **방송용 PC 에도 켜진다** —
// 사양이 달라 그 PC 에서는 매번 1차가 실패하고 그만큼 사람이 기다린다.
// 반대로 진단만 근거로 삼으면 **사람이 승인한 적 없는데** 모델이 도는 PC 가 생긴다.
//
// 기본은 꺼짐이다. 켜는 것은 언제나 사람의 명시적 행동이다.
// 이 값은 방송에 영향을 주지 않는다 — 방송 실행 경로는 LLM 을 안 쓴다.
// **대시보드의 "AI 방송 도우미" 스위치를 여기서 함께 본다.**
// 1차 로컬은 브라우저에서 돌아서 `/api/ai/generate` 의 403 가드를 **안 지난다** —
// 이 창구가 막지 않으면 사람이 기능을 꺼도 문구가 계속 만들어진다. 끈 사람은 껐다고
// 믿고 있으므로, 조용히 도는 쪽이 훨씬 나쁘다. 브라우저는 이 값 하나만 보면 된다.
router.get('/local-ai', (req, res) => {
  try {
    const { isFeatureEnabled } = require('../services/features')
    const 허용 = getSetting(getDB(), 'local_ai_enabled', '') === '1'
    res.json({
      enabled: 허용 && isFeatureEnabled('ai'),
      // 왜 꺼졌는지 구분해서 알려 준다 — 화면이 "켰는데 왜 안 되냐"에 답할 수 있어야 한다
      localAllowed: 허용,
      aiFeature: isFeatureEnabled('ai'),
    })
  } catch (err) {
    console.error('[settings/local-ai GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/local-ai', (req, res) => {
  try {
    setSetting(getDB(), 'local_ai_enabled', req.body?.enabled ? '1' : '')
    res.json({ ok: true, enabled: !!req.body?.enabled })
  } catch (err) {
    console.error('[settings/local-ai POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/broadcast-prompt — 저장. 빈 문자열로 저장하면 코드 기본값으로 되돌아감
router.post('/broadcast-prompt', (req, res) => {
  try {
    const db = getDB()
    setSetting(db, 'broadcast_system_prompt', (req.body.prompt ?? '').trim())
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/broadcast-prompt POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/ai — AI 제공자 설정 불러오기 (기본: gemini)
router.get('/ai', (req, res) => {
  try {
    const db = getDB()
    res.json({
      provider:    getSetting(db, 'ai_provider',  'gemini'),
      // **저장된 그대로** 보낸다 — 비었으면 'auto'. 예전엔 빈 칸에 기본 모델 이름을 채워 보냈고,
      // 화면이 그것을 입력칸에 넣었다가 「저장」(키만 바꾸려 해도)에 그 이름이 박혔다. 현장
      // 2.5-flash 고정이 그렇게 생겼다(2026-10-23, domain/geminiModel.js 머리말).
      geminiModel: isAutoModel(getSetting(db, 'gemini_model', '')) ? AUTO : getSetting(db, 'gemini_model', ''),
      // 지금 실제로 부르는 모델 — 화면의 「지금: X」. 호출부와 **같은 함수**로 구한다.
      resolvedModel: currentGeminiModel(db),
      autoModel:     getSetting(db, 'gemini_model_auto', ''),
      autoAt:        getSetting(db, 'gemini_model_auto_at', ''),
      // 자동으로 바꾸기 전 사람이(또는 옛 화면이) 저장해 두었던 값 — 「되돌리기」에 쓴다
      beforeAuto:    getSetting(db, 'gemini_model_before_auto', ''),
      // 화면이 "기본: xxx" 를 자기가 짓지 않게 함께 보낸다. 예전엔 화면이 따로 박아 뒀고
      // 그 값이 서버와 달라서, **보여 주는 모델과 실제로 부르는 모델이 갈렸다.**
      defaultModel: DEFAULT_GEMINI_MODEL,
    })
  } catch (err) {
    console.error('[settings/ai GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/ai — AI 제공자·모델명 저장 (각 필드 optional)
router.post('/ai', (req, res) => {
  const { provider, geminiModel } = req.body
  // 외부 AI 는 Gemini 하나다(README 4.5) — 쓰지 않는 제공자는 받지 않는다(2026-11-10 추가 점검).
  // 예전에 'claude' 로 저장된 현장은 실행 쪽(ai.js·scheduleDrafts.js)이 지금처럼 「Gemini만 지원」으로 멈춘다 —
  // 몰래 Gemini 로 보내기 시작하지 않는다. 화면에서 Gemini 를 고르면 풀린다.
  if (provider !== undefined && provider !== 'gemini') {
    return res.status(400).json({ error: '유효하지 않은 AI 제공자입니다. 지금은 Gemini 만 지원합니다.' })
  }
  try {
    const db = getDB()
    if (provider    !== undefined) setSetting(db, 'ai_provider',  provider)
    // 비우거나 'auto' 면 자동 — 모델 이름을 박지 않는다(위 GET 주석의 고정 경로)
    if (geminiModel !== undefined) {
      // 이름은 URL 경로에 그대로 들어간다(ai.js·geminiSchedule.js) — 모델 이름에 쓰는 글자만 받는다(2026-10-23 QA)
      if (!isAutoModel(geminiModel) && !/^[A-Za-z0-9._-]+$/.test(String(geminiModel).trim())) {
        return res.status(400).json({ error: '모델 이름은 영문·숫자와 . - _ 만 쓸 수 있습니다. (예: gemini-3.7-flash)' })
      }
      setSetting(db, 'gemini_model', isAutoModel(geminiModel) ? AUTO : String(geminiModel).trim())
      // 자동을 켜는 순간 아직 고른 값이 없으면 바로 한 번 고른다(기다리지 않는다)
      if (isAutoModel(geminiModel) && !getSetting(db, 'gemini_model_auto', '')) {
        require('../services/geminiModelAuto').refreshAutoModel({ db })
          .then(r => console.log(`[Gemini 모델] 자동 켬 — ${r}`))
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/ai POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// /api-keys 가 다루는 설정 키 — GET 이 읽는 것과 POST 가 쓸 수 있는 것이 **같은 목록**이다.
// 왜 목록이 있나(ISSUE-005, 2026-09-06): POST 가 key 를 검사하지 않아 audio_device(정규 경로는
// sanitizeDeviceName 필수)·auto_shutdown_time(쓰는 순간 PC 종료 무장)·자동방송 시각까지 이 라우트로
// 검증 없이 덮어쓸 수 있었다(EV-000462). 기상청·에어코리아·캘린더·스위치봇 키는 각자 전용
// 라우트가 있으므로 여기 넣지 않는다. server/test/api-keys-allowlist.test.js 가 고정한다.
// **Gemini 하나만**(2026-11-10 추가 점검). 예전엔 anthropic·claude 키도 받았는데 그 키를 쓰는 곳이
// 없었다 — 받기만 하고 안 쓰는 비밀값은 저장할 이유가 없고, 문서(외부 AI 는 Gemini)와도 어긋났다.
const AI_API_KEYS = {
  gemini:    'gemini_api_key',
}
const AI_API_KEY_NAMES = new Set(Object.values(AI_API_KEYS))

// GET /api/settings/api-keys — API 키 현황 (마스킹 처리)
router.get('/api-keys', (req, res) => {
  try {
    const db   = getDB()
    const mask = (val) => val ? '••••••••' + val.slice(-4) : null
    const out  = {}
    for (const [name, settingKey] of Object.entries(AI_API_KEYS)) {
      const val = getSetting(db, settingKey, '')
      out[name] = { set: !!val, masked: mask(val) }
    }
    res.json(out)
  } catch (err) {
    console.error('[settings/api-keys GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/api-keys — API 키 저장 (위 목록의 키만)
router.post('/api-keys', (req, res) => {
  const { key, value } = req.body
  if (!key || !value?.trim()) return res.status(400).json({ error: '키와 값을 입력해주세요.' })
  if (!AI_API_KEY_NAMES.has(key)) {
    return res.status(400).json({ error: `이 경로로 저장할 수 없는 키입니다: ${String(key).slice(0, 40)}` })
  }
  try {
    setSetting(getDB(), key, value.trim())
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/api-keys POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/morning — 아침 방송 설정 불러오기
router.get('/morning', (req, res) => {
  try {
    const db       = getDB()
    const raw      = getSetting(db, 'morning_segments', '')
    // 손상 JSON이면 이 라우트가 영영 500이 되고, 이 설정을 고치는 화면 자체가 안 열린다(CC-044).
    // readSegments()와 같은 패턴: try + 기본값(null = 기본 세그먼트 사용 신호) 폴백.
    let segments = null
    if (raw) {
      try { segments = JSON.parse(raw) }
      catch (e) { console.warn('[settings/morning GET] morning_segments 손상 JSON — 기본값으로 응답:', e.message) }
    }
    res.json({
      enabled:    getSetting(db, 'morning_enabled', 'true') === 'true',
      time:       getSetting(db, 'morning_time', autoDefaultTime('morning')),
      segments,
      bgmEnabled:   getSetting(db, 'morning_bgm_enabled',   '0') === '1',
      bgmDelay:     Number(getSetting(db, 'morning_bgm_delay',     '5')),
      bgmEndDelay:  Number(getSetting(db, 'morning_bgm_end_delay', '0')),
    })
  } catch (err) {
    console.error('[settings/morning GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/morning — 아침 방송 설정 저장
router.post('/morning', (req, res) => {
  const { enabled, time, segments, bgmEnabled, bgmDelay, bgmEndDelay } = req.body
  try {
    const db = getDB()
    if (enabled    !== undefined) setSetting(db, 'morning_enabled',     String(enabled))
    if (time       !== undefined) setSetting(db, 'morning_time',        time)
    if (segments   !== undefined) setSetting(db, 'morning_segments',    JSON.stringify(segments))
    if (bgmEnabled   !== undefined) setSetting(db, 'morning_bgm_enabled',   bgmEnabled ? '1' : '0')
    if (bgmDelay     !== undefined) setSetting(db, 'morning_bgm_delay',     String(bgmDelay))
    if (bgmEndDelay  !== undefined) setSetting(db, 'morning_bgm_end_delay', String(bgmEndDelay))
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/morning POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── 기상청 API 설정 ──────────────────────────────────────

// GET /api/settings/kma — 기상청 API 설정 불러오기
router.get('/kma', (req, res) => {
  try {
    const db         = getDB()
    const key        = getSetting(db, 'kma_api_key',        '')
    const apihubKey  = getSetting(db, 'kma_apihub_key',     '')
    const alertKey   = getSetting(db, 'kma_alert_api_key',  '')
    const livingKey  = getSetting(db, 'kma_living_api_key', '')
    res.json({
      apiKeySet:          !!key,
      apiKeyMasked:       key       ? '••••' + key.slice(-6)       : null,
      apihubKeySet:       !!apihubKey,
      apihubKeyMasked:    apihubKey ? '••••' + apihubKey.slice(-6) : null,
      alertApiKeySet:     !!alertKey,
      alertApiKeyMasked:  alertKey  ? '••••' + alertKey.slice(-6)  : null,
      livingApiKeySet:    !!livingKey,
      livingApiKeyMasked: livingKey ? '••••' + livingKey.slice(-6) : null,
      // 기본값은 일반 예시(서울)다 — `weather.js` 의 DEFAULT_* 와 같다(공개판 정리 2026-10-17).
      nx:        getSetting(db, 'kma_nx',      '60'),
      ny:        getSetting(db, 'kma_ny',      '127'),
      stn:       getSetting(db, 'kma_stn',     '108'),
      uvStn:     getSetting(db, 'kma_uv_stn',  '108'),
      areaNo:    getSetting(db, 'kma_area_no', '1100000000'),
      uvAreaNo:  getSetting(db, 'uv_area_no',  '1100000000'),
      // 위도·경도는 **기본값을 채워 보내지 않는다.** 빈 값이면 화면이 「아직 안 넣었다」를
      // 말할 수 있어야 한다 — `weather.js` 의 기본값(만든 곳 좌표)을 여기서 흉내 내면
      // 사람은 자기 시설 좌표가 들어간 줄 안다.
      lat:       getSetting(db, 'location_lat', ''),
      lon:       getSetting(db, 'location_lon', ''),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/kma — 기상청 API 설정 저장
router.post('/kma', (req, res) => {
  const { apiKey, apihubKey, alertApiKey, livingApiKey, nx, ny, stn, uvStn, areaNo, uvAreaNo, lat, lon } = req.body
  // ── **위도·경도** (2026-09-18) ────────────────────────────────────────────────────
  // `weather.js:371,533` 이 Open-Meteo 를 부를 때 `location_lat`·`location_lon` 을 읽는데 **그 값을
  // 저장하는 경로가 어디에도 없었다.** 화면에서 위경도를 넣고 「격자 계산」을 눌러도 격자만 저장돼,
  // 기상청이 막히면 어느 기관이든 기본값 위치의 날씨가 조용히 나갔다.
  //
  // **빈 값은 저장하지 않고 건너뛴다**(독립 검수 2026-09-18). 빈 문자열을 넣으면 그 행이 생기는데,
  // 읽는 쪽이 `rawSetting(db,key) ?? 기본값` 이라 **빈 문자열은 `??` 를 통과한다** — 기본값으로
  // 돌아가지 않고 `latitude=` 인 주소가 만들어져 Open-Meteo 가 통째로 죽는다. 고치기 전(남의 동네
  // 날씨)보다 나쁜 회귀라, 지우기는 지원하지 않는다.
  //
  // **전부 검사한 뒤 전부 쓴다.** 앞 판은 위도를 쓰고 나서 경도를 검사해, 경도가 틀리면 위도만
  // 바뀐 채 「저장 실패」가 떴다 — 두 값이 다른 동네를 가리키는 좌표쌍이 남는다.
  const 좌표 = []
  for (const [키, 값, 이름, 한계] of [['location_lat', lat, '위도', 90], ['location_lon', lon, '경도', 180]]) {
    if (값 === undefined) continue
    const 글 = String(값).trim()
    if (글 === '') continue
    const n = Number(글)
    if (!Number.isFinite(n)) return res.status(400).json({ error: `${이름}는 숫자여야 합니다` })
    if (Math.abs(n) > 한계) return res.status(400).json({ error: `${이름}가 범위(±${한계})를 벗어났습니다 — 위도와 경도가 뒤바뀌지 않았는지 보세요` })
    좌표.push([키, String(n)])
  }

  try {
    const db = getDB()
    for (const [키, 값] of 좌표) setSetting(db, 키, 값)
    if (apiKey       !== undefined) setSetting(db, 'kma_api_key',        apiKey)
    if (apihubKey    !== undefined) setSetting(db, 'kma_apihub_key',     apihubKey)
    if (alertApiKey  !== undefined) setSetting(db, 'kma_alert_api_key',  alertApiKey)
    if (livingApiKey !== undefined) setSetting(db, 'kma_living_api_key', livingApiKey)
    if (nx           !== undefined) setSetting(db, 'kma_nx',             nx)
    if (ny           !== undefined) setSetting(db, 'kma_ny',             ny)
    if (stn          !== undefined) setSetting(db, 'kma_stn',            stn)
    if (uvStn        !== undefined) setSetting(db, 'kma_uv_stn',         uvStn)
    if (areaNo       !== undefined) setSetting(db, 'kma_area_no',        areaNo)
    if (uvAreaNo     !== undefined) setSetting(db, 'uv_area_no',         uvAreaNo)
    try { require('../services/weather').clearWeatherCache() } catch { /* 캐시 비우기 실패는 다음 조회까지 옛 날씨를 쓰는 것뿐이다 — 설정 저장을 되돌리지 않는다 */ }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 에어코리아 API 설정 ────────────────────────────────────

// GET /api/settings/airkorea — 에어코리아 API 설정 불러오기
router.get('/airkorea', (req, res) => {
  try {
    const db  = getDB()
    const key = getSetting(db, 'airkorea_api_key', '')
    res.json({
      apiKeySet:     !!key,
      apiKeyMasked:  key ? '••••' + key.slice(-6) : null,
      station:       getSetting(db, 'airkorea_station', '중구'),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/airkorea — 에어코리아 API 설정 저장
router.post('/airkorea', (req, res) => {
  const { apiKey, station } = req.body
  try {
    const db = getDB()
    if (apiKey   !== undefined) setSetting(db, 'airkorea_api_key', apiKey)
    if (station  !== undefined) setSetting(db, 'airkorea_station', station)
    try { require('../services/weather').clearWeatherCache() } catch { /* 캐시 비우기 실패는 다음 조회까지 옛 값을 쓰는 것뿐이다 — 설정 저장을 되돌리지 않는다 */ }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Google Calendar 앱 설정 ────────────────────────────────

// GET /api/settings/gcal — Google Calendar 앱 설정 불러오기 (토큰 제외)
router.get('/gcal', (req, res) => {
  try {
    const db = getDB()
    res.json({
      clientId:     getSetting(db, 'gcal_client_id',     ''),
      calendarId:   getSetting(db, 'gcal_calendar_id',   'primary'),
      redirectUri:  getSetting(db, 'gcal_redirect_uri',  'http://localhost:3001/api/calendar/callback'),
      connected:    !!getSetting(db, 'gcal_refresh_token', ''),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/gcal — Google Calendar 앱 설정 저장 (토큰 제외)
router.post('/gcal', (req, res) => {
  const { clientId, clientSecret, calendarId, redirectUri } = req.body
  try {
    const db = getDB()
    if (clientId    !== undefined) setSetting(db, 'gcal_client_id',     clientId)
    if (clientSecret!== undefined) setSetting(db, 'gcal_client_secret', clientSecret)
    if (calendarId  !== undefined) setSetting(db, 'gcal_calendar_id',   calendarId)
    if (redirectUri !== undefined) setSetting(db, 'gcal_redirect_uri',  redirectUri)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Azure 음성(선택 안내 음성 엔진, 2026-09-21) ─────────────────────────────
// 키는 가려서만 내보낸다. 저장할 때 SwitchBot 과 같은 규칙으로 막는다 — 키는 HTTP 헤더에 그대로 실린다.
// 설정 이력은 writeSetting 이 남기고, 이름이 `_key` 로 끝나 이력에는 「(가려짐)」으로 적힌다(settingsHistory).

router.get('/azure-speech', (req, res) => {
  try { res.json(require('../services/ttsEngines/azure').상태()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/azure-speech', (req, res) => {
  const { key, region } = req.body || {}
  for (const [이름, 값] of [['Azure 키', key], ['지역', region]]) {
    if (값 !== undefined && 값 !== null && typeof 값 !== 'string') {
      return res.status(400).json({ error: `${이름} 은 글자만 받습니다.` })
    }
    if (hasBrokenText(값, { allowNewlines: false })) return res.status(400).json({ error: brokenTextMessage(이름) })
  }
  const { 지역모양 } = require('../services/ttsEngines/azure')
  // 지역은 요청 주소(https://<지역>.tts.speech.microsoft.com)에 들어간다 — 영문·숫자·하이픈만.
  if (region !== undefined && region !== null && String(region).trim() && !지역모양.test(String(region).trim())) {
    return res.status(400).json({ error: '지역은 koreacentral 처럼 영문·숫자·하이픈만 받습니다.' })
  }
  try {
    const db = getDB()
    // 빈 글자는 「지운다」다(키를 빼면 이 엔진이 차례에서 빠진다).
    if (key !== undefined && key !== null) setSetting(db, 'azure_speech_key', String(key).trim())
    if (region !== undefined && region !== null) setSetting(db, 'azure_speech_region', String(region).trim().toLowerCase())
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 연결 확인 — 짧은 문장 하나를 합성해 본다(소리는 내지 않고 버린다).
router.post('/azure-speech/test', async (req, res) => {
  const azure = require('../services/ttsEngines/azure')
  if (!azure.available()) return res.json({ ok: false, error: azure.상태().keySet ? '인터넷 차단 모드이거나 지역이 비었습니다.' : '키를 먼저 저장하세요.' })
  const out = azure.tmpOut(`test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`)
  const t0 = Date.now()
  try {
    const voice = rawSetting(getDB(), 'tts_voice_normal') || 'ko-KR-SunHiNeural'
    await azure.synthesize({ text: '연결 확인입니다.', voice, rate: '+0%', pitch: '+0Hz' }, { out, timeoutMs: 8000 })
    res.json({ ok: true, ms: Date.now() - t0 })
  } catch (err) {
    res.json({ ok: false, error: azure.비밀지우기(err.message, String(rawSetting(getDB(), 'azure_speech_key') ?? '')) })
  } finally {
    try { require('fs').unlinkSync(out) } catch { /* 없으면 그만 */ }
  }
})

// ── SwitchBot 설정 ────────────────────────────────────────────

// GET /api/settings/switchbot — SwitchBot 설정 불러오기 (토큰은 마스킹)
router.get('/switchbot', (req, res) => {
  try {
    const db     = getDB()
    const token  = getSetting(db, 'switchbot_token',  '')
    const secret = getSetting(db, 'switchbot_secret', '')
    const mask   = (val) => val ? '••••' + val.slice(-4) : null
    res.json({
      tokenSet:     !!token,
      tokenMasked:  mask(token),
      secretSet:    !!secret,
      secretMasked: mask(secret),
      deviceId:     getSetting(db, 'switchbot_device_id',    ''),
      onTime:       getSetting(db, 'switchbot_on_time',      '07:45'),
      offTime:      getSetting(db, 'switchbot_off_time',     '17:30'),
      autoControl:  getSetting(db, 'switchbot_auto_control', 'true') === 'true',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/switchbot — SwitchBot 설정 저장
router.post('/switchbot', (req, res) => {
  const { token, secret, deviceId, onTime, offTime, autoControl } = req.body
  // **들어올 때 막는다**(UX-10, Codex R8 지적 2026-09-11).
  //
  // 이 세 값은 나중에 HTTP 헤더에 그대로 실린다. 줄바꿈·NUL 이 섞이면 `fetch` 가
  // **토큰을 통째로 담은 오류**를 던지고, 그 문구가 연결 테스트 결과를 타고 화면까지 갔다
  // (EV-004698). `services/switchbot.js` 가 부르기 전에 한 번 더 막고 오류에서 비밀을
  // 지우지만, 그것은 **이미 저장된 뒤**의 방어다 — 값이 DB 에 들어앉으면 사람이 다시
  // 붙여 넣을 때까지 이 연동이 죽어 있고, 왜 죽었는지는 화면만 보고 알기 어렵다.
  //
  // 그래서 저장을 거절한다. 판정은 `domain/text.js` 한 곳이다(출력장치 이름과 같은 규칙) —
  // 이 값들도 **이름 칸**이라 줄바꿈·탭까지 거부한다.
  // **먼저 형식을 본다**(Codex R10 지적 2026-09-12). `hasBrokenText` 는 문자열이 아니면
  // 통과시키고(형식 검사는 부르는 쪽의 몫이라고 그 함수가 적어 뒀다), `writeSetting` 은
  // 나중에 `String(value)` 로 바꾼다 — 그래서 **배열로 보내면** 제어문자가 검사를 비켜
  // DB 까지 닿았다(`['ABCNULdef']` → `"ABCNULdef"`). 검사를 더해 놓고도 구멍이 남는
  // 전형적인 모양이라, 형식을 먼저 가른다.
  for (const [이름, 값] of [['API Token', token], ['Client Secret', secret], ['Device ID', deviceId]]) {
    if (값 !== undefined && 값 !== null && typeof 값 !== 'string') {
      return res.status(400).json({ error: `${이름} 은 글자만 받습니다.` })
    }
  }
  // 깨진 글자·제어문자. **판정은 `domain/text.js` 한 곳이다** — 처음엔 줄바꿈·탭 검사를
  // 이 라우트에서 다시 적었는데(같은 정규식을 두 벌로), 그 함수에 이미 `allowNewlines:false`
  // 가 있었다(Codex R10 지적). 이 값들은 헤더에 그대로 실리므로 그 옵션을 쓴다.
  for (const [이름, 값] of [['API Token', token], ['Client Secret', secret], ['Device ID', deviceId]]) {
    if (hasBrokenText(값, { allowNewlines: false })) {
      return res.status(400).json({ error: brokenTextMessage(이름) })
    }
  }
  try {
    const db = getDB()
    if (token       !== undefined) setSetting(db, 'switchbot_token',        token)
    if (secret      !== undefined) setSetting(db, 'switchbot_secret',       secret)
    if (deviceId    !== undefined) setSetting(db, 'switchbot_device_id',    deviceId)
    if (onTime      !== undefined) setSetting(db, 'switchbot_on_time',      onTime)
    if (offTime     !== undefined) setSetting(db, 'switchbot_off_time',     offTime)
    if (autoControl !== undefined) setSetting(db, 'switchbot_auto_control', String(autoControl))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 인사·식사 안내 템플릿 ──────────────────────────────────────────────
const DEFAULT_MORNING_GREETING = `어르신들 안녕히 주무셨습니까?
오늘도 새로운 하루에 감사드리며 힘차게 시작하겠습니다.`

// 공개판 기본 문구는 종교 중립이다(broadcastDefaults.js 머리 주석 참고).
const DEFAULT_MEAL_PRAYER = `오늘도 정성껏 마련된 이 음식에 감사드립니다.
우리 모두 늘 기쁘고 건강하게 지내기를 바랍니다.`

// ⚠️ 현재 미사용 — 이 라우트를 부르던 유일한 화면(ScheduledBroadcast.jsx의 TemplateEditor)이
// 어디에도 렌더링되지 않는 죽은 코드라 제거됐다. 게다가 여기서 저장하는 tpl_* 설정 키는
// 방송 시퀀서(broadcastSequencer.js)가 전혀 읽지 않아서, 저장해도 실제 방송에 반영되지 않았다.
// (실제 식사 안내 문구는 BREAKFAST_PRAYER_DEFAULT 등 + breakfast_prayer_tts 같은 별도 키를 쓴다)
// 라우트 자체 삭제는 별도 판단으로 남겨둠.
// GET /api/settings/prayer-templates — 식사 안내 템플릿 조회
router.get('/prayer-templates', (req, res) => {
  try {
    const db = getDB()
    res.json({
      morningGreeting:    getSetting(db, 'tpl_morning_greeting',     DEFAULT_MORNING_GREETING),
      mealPrayer:         getSetting(db, 'tpl_meal_prayer',          DEFAULT_MEAL_PRAYER),
      lunchPrayerSuffix:  getSetting(db, 'tpl_lunch_prayer_suffix',  '어르신들 점심 진지 맛있게 드십시오.'),
      dinnerPrayerSuffix: getSetting(db, 'tpl_dinner_prayer_suffix', '어르신들 저녁 진지 맛있게 드십시오.'),
    })
  } catch (err) {
    console.error('[settings/prayer-templates GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/prayer-templates — 식사 안내 템플릿 저장
router.post('/prayer-templates', (req, res) => {
  const { morningGreeting, mealPrayer, lunchPrayerSuffix, dinnerPrayerSuffix } = req.body
  try {
    const db = getDB()
    if (morningGreeting    !== undefined) setSetting(db, 'tpl_morning_greeting',     morningGreeting)
    if (mealPrayer         !== undefined) setSetting(db, 'tpl_meal_prayer',          mealPrayer)
    if (lunchPrayerSuffix  !== undefined) setSetting(db, 'tpl_lunch_prayer_suffix',  lunchPrayerSuffix)
    if (dinnerPrayerSuffix !== undefined) setSetting(db, 'tpl_dinner_prayer_suffix', dinnerPrayerSuffix)
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/prayer-templates POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── 방송 일정 편집기 설정 ──────────────────────────────────────
//
// 읽는 규칙은 domain/broadcastScheduleRead.js로 내려갔다(2026-09-05). 라우트만 여기 남는다 —
// 그 규칙을 편집기 화면과 예상시간이 **같이** 봐야 하고, 라우트 파일끼리는 서로 못 부른다
// (route-wiring.test.js). 여기 있던 본문은 그 파일에 줄 단위로 그대로 있다.
const { buildBroadcastSchedule, readBgmUsage, buildBroadcastEstimate } = require('../domain/broadcastScheduleRead')
// GET /api/settings/bgm-usage
router.get('/bgm-usage', (req, res) => {
  try {
    res.json(readBgmUsage(getDB()))
  } catch (err) {
    console.error('[settings/bgm-usage GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/broadcast-schedule — 5개 방송 설정 일괄 반환
router.get('/broadcast-schedule', (req, res) => {
  try {
    res.json(buildBroadcastSchedule(getDB()))
  } catch (err) {
    console.error('[settings/broadcast-schedule GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/broadcast-schedule/estimate — 방송별 예상 소요시간
// 재료를 모으는 일은 domain/broadcastScheduleRead의 buildBroadcastEstimate가 한다.
router.get('/broadcast-schedule/estimate', (req, res) => {
  try {
    res.json(buildBroadcastEstimate(getDB()))
  } catch (err) {
    console.error('[settings/broadcast-schedule/estimate GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/broadcast-schedule — 4개 시간대 방송 설정 일괄 저장
// 자동방송 5종의 "칸 이름 → 저장할 시각" 짝. 검증도 저장도 이 목록 하나를 본다 —
// 다섯 곳에 검사를 따로 적으면 새 방송이 늘 때 한 곳이 빠진다(P-36).
const 시각칸 = [
  ['morning', 'time'], ['exercise', 'time'], ['lunch', 'time'],
  ['dinner', 'time'], ['evening_prayer', 'time'],
]

// ── 저장 직전에 단계 배열을 다듬는다 (설계 §2-D, 2026-09-13) ────────────────────
//
// **왜 코드로 막나**: 화면은 `GET` 으로 받은 것을 통째로 `POST` 한다
// (`MorningEditor.jsx` — 불러온 설정 객체를 그대로 돌려보낸다). 서버가 응답에 파생 필드를
// 붙이면 **화면을 열고 볼륨 하나만 바꿔 저장하는 순간 그 파생값이 DB 에 박힌다.**
// 다섯 방송의 모든 단계에 기본 연결이 써지는 것이고, 그것은 되돌리기 어려운 쓰기다.
// 규율로는 못 막는다 — 규율은 한 번만 어긋나면 끝이고, 어긋난 것을 아무도 못 본다.
//
// 하는 일 둘:
//   ① `sourceResolved` 를 **걷어낸다.** 읽기 전용 파생 필드라 DB 에 들어갈 이유가 없다.
//   ② `source` 가 **실려 온 단계만** 검증한다. 안 실려 온 단계는 **손대지 않는다** —
//      여기서 기본값을 채워 넣으면 ①을 막은 의미가 없어진다.
const { validateSource, defaultMediaFor } = require('../domain/stepSource')

function 단계정리(db, steps, 탭이름) {
  if (!Array.isArray(steps)) return { steps, error: null }
  const out = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') { out.push(step); continue }
    // ① 파생 필드 제거 — 있든 없든 결과에 안 남는다.
    // **둘 다 걷는다.** 처음엔 `sourceResolved` 만 걷었는데, 같은 자리에서 얹는
    // `delayProfileResolved` 가 그대로 DB 에 들어갔다(2026-09-13, 시험이 잡았다).
    // 파생 필드를 하나 더 얹을 때 이 줄을 같이 안 고치면 같은 사고가 되풀이된다 —
    // `step-source-save.test.js` 가 저장된 JSON 원문에서 이름을 찾아 막는다.
    const { sourceResolved: _버림1, delayProfileResolved: _버림2, ...나머지 } = step
    void _버림1; void _버림2

    // ② 연결 검증 — **키가 있을 때만**
    if (Object.prototype.hasOwnProperty.call(나머지, 'source') && 나머지.source !== null) {
      const 결과 = validateSource(db, 나머지.source, { media: defaultMediaFor(String(나머지.id || ''), 나머지) })
      if (결과.error) {
        return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: ${결과.error.message}` }
      }
      // 검증이 정규화한 모양으로 저장한다 — 화면이 보낸 여분 키가 DB 에 쌓이지 않게.
      // `error` 는 파생값이라 뺀다(늘 null 이고, 저장되면 다음 검증을 헷갈리게 한다).
      const { kind, category, folderId, audioFileId } = 결과.source
      나머지.source = kind === 'file' ? { kind, audioFileId } : { kind, category, folderId }
    }

    // ③ 배경음악 폴더·차례(2026-09-21) — 모르는 값은 저장 때 막는다. 안 막으면 방송 시각에야
    // 「모르는 용도」로 BGM 이 빠진다. 빈 값(undefined·null)은 「서버 기본」이라 그대로 둔다.
    const { 역할찾기, 순서들 } = require('../domain/bgmRoles')
    // BGM 소스는 이 PC 음원 하나다(2026-09-21 외부 연동 제거). 'auto' 는 예전 저장값이라 받는다 —
    // 방송은 소스와 상관없이 용도 폴더에서 고른다(broadcastSteps.stepBGMStart).
    const 아는소스 = ['auto', 'local']
    if (나머지.bgmSource != null && !아는소스.includes(나머지.bgmSource)) {
      return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: 모르는 BGM 소스입니다(${나머지.bgmSource})` }
    }
    if (나머지.bgmRole != null && !역할찾기(나머지.bgmRole)) {
      return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: 모르는 BGM 폴더입니다(${나머지.bgmRole})` }
    }
    if (나머지.bgmOrder != null && !순서들.includes(나머지.bgmOrder)) {
      return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: BGM 차례는 랜덤 또는 차례로만 됩니다` }
    }
    // 사람이 만든 BGM 폴더(2026-09-22) — 번호가 BGM 폴더인지 저장 때 본다. 틀린 번호가 저장되면 방송 때
    // 대신 트는 폴더로 조용히 바뀐다(경보는 나지만 매번 난다). 빈 값은 「용도 폴더」라 그대로 둔다.
    if (나머지.bgmFolderId != null && 나머지.bgmFolderId !== '') {
      // 엄격하게 읽는다(QA: `true` 가 1번 폴더로 저장됐다) — 숫자이거나 숫자만 든 글자만.
      const 번호 = require('../domain/bgmRoles').번호읽기(나머지.bgmFolderId)
      const 있음 = 번호 && db.prepare("SELECT 1 FROM content_folders WHERE id = ? AND category = 'bgm'").get(번호)
      if (!있음) {
        return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: 고른 BGM 폴더가 없습니다 — 다른 폴더를 골라 주세요` }
      }
      // 기본 폴더(방송용·식사용)를 번호로 보냈으면 **용도로 바꿔 적는다** — 폴더 하나에 값 하나(QA).
      const 용도 = require('../services/localBgm').폴더의용도(db, 번호)
      if (용도) { 나머지.bgmRole = 용도; delete 나머지.bgmFolderId }
      else 나머지.bgmFolderId = 번호
    }
    // 곡 하나(2026-09-22) — 배경음악 곡인지 저장 때 본다. 곡을 고르면 폴더 번호는 지운다(값 하나에 뜻 하나).
    if (나머지.bgmFileId != null && 나머지.bgmFileId !== '') {
      const 번호 = require('../domain/bgmRoles').번호읽기(나머지.bgmFileId)
      const 있음 = 번호 && db.prepare("SELECT 1 FROM audio_files WHERE id = ? AND category = 'bgm'").get(번호)
      if (!있음) {
        return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: 고른 배경음악 곡이 없습니다 — 다른 곡을 골라 주세요` }
      }
      나머지.bgmFileId = 번호
      delete 나머지.bgmFolderId
    }
    if (나머지.mediaOrder != null && !순서들.includes(나머지.mediaOrder)) {
      return { steps: null, error: `${탭이름} 「${나머지.label || 나머지.id}」: 영상 차례는 랜덤 또는 차례로만 됩니다` }
    }
    out.push(나머지)
  }
  return { steps: out, error: null }
}

router.post('/broadcast-schedule', (req, res) => {
  try {
    const db = getDB()
    const { morning, exercise, lunch, dinner, breakfastPrayerTts, evening_prayer } = req.body

    // ── 시각 형식 검증 — **저장 전에 한 번에** (P-36, 2026-09-11) ──────────────
    // 예전엔 아무 검사도 없었다. 형식이 깨진 값이 들어가면 발동부(문자열 정확일치)도
    // 감시(watchdog)도 **둘 다 침묵**해서, 사람에게는 "저장했는데 왜 안 나가지"만 남는다.
    // 같은 실패를 예약 라우트는 이미 400 으로 막고 있었다 — 비대칭이었다.
    //
    // **먼저 다 보고 나서 저장한다.** 중간에 막으면 앞의 몇 개는 이미 저장돼 반쯤 바뀐
    // 상태가 남는다. 규칙은 `domain/autoBroadcasts.유효시각` 한 곳에 있다(빈 값 = 끄기).
    const 값들 = { morning, exercise, lunch, dinner, evening_prayer }
    for (const [키, 필드] of 시각칸) {
      const 묶음 = 값들[키]
      if (!묶음 || 묶음[필드] === undefined) continue
      if (!유효시각(묶음[필드])) {
        return res.status(400).json({
          error: '방송 시간이 올바르지 않습니다. (예: 09:30 — 비우면 그 방송을 쓰지 않습니다)',
        })
      }
    }

    // ── 단계 배열 다듬기·검증 — **저장 전에 다섯을 한꺼번에** (설계 §2-D) ──────────
    // 시각 검증과 같은 이유로 먼저 다 본다. 중간에 막으면 앞의 몇 개는 이미 저장돼
    // 반쯤 바뀐 상태가 남는다.
    const 정리된단계 = {}
    for (const [키, 묶음, 이름] of [
      ['morning', morning, '아침 방송'], ['exercise', exercise, '국민체조'],
      ['lunch', lunch, '점심 방송'], ['dinner', dinner, '저녁 방송'],
      ['evening_prayer', evening_prayer, '저녁 마무리'],
    ]) {
      if (!묶음 || 묶음.steps === undefined) continue
      const r = 단계정리(db, 묶음.steps, 이름)
      if (r.error) return res.status(400).json({ error: r.error })
      정리된단계[키] = r.steps
    }

    // ── 안내 문구 개인정보 검사 — 저장 전에 한꺼번에 (추가 점검 2026-11-01) ──────────────
    // 일과방송 문구는 매일 정해진 시각에 **아무도 안 보는 상태로** 전관에 읽힌다(Azure 엔진이면 외부로도
    // 나간다). 예약(schedules.js)·방송 순서(flows.js)는 저장 때 막는데 여기만 빠져 있었다.
    // 문구 칸(이름에 tts 가 든 칸)과 단계 안의 문안(content)을 모아 한 번에 본다 — 하나라도 걸리면
    // 아무것도 쓰지 않는다(위 시각·단계 검증과 같은 이유). 이름 등 확인 항목은 409 로 되묻는다.
    {
      const 문안 = []
      const 모으기 = (묶음) => {
        if (!묶음 || typeof 묶음 !== 'object') return
        for (const [칸, 값] of Object.entries(묶음)) {
          if (/tts/i.test(칸) && typeof 값 === 'string' && 값.trim()) 문안.push(값)
        }
        for (const 단계 of Array.isArray(묶음.steps) ? 묶음.steps : []) {
          if (typeof 단계?.content === 'string' && 단계.content.trim()) 문안.push(단계.content)
        }
      }
      for (const 묶음 of [morning, exercise, lunch, dinner, evening_prayer]) 모으기(묶음)
      if (typeof breakfastPrayerTts === 'string' && breakfastPrayerTts.trim()) 문안.push(breakfastPrayerTts)
      if (문안.length) {
        const { checkSensitive } = require('../services/sensitiveInfo')
        const verdict = checkSensitive(문안.join('\n'), { acknowledged: !!req.body?.ackWarnings, verb: '저장' })
        if (!verdict.ok) return res.status(verdict.status).json(verdict.body)
      }
    }

    if (morning) {
      if (morning.enabled               !== undefined) setSetting(db, 'morning_enabled',          String(morning.enabled))
      if (morning.name !== undefined) setSetting(db, autoNameKey('morning'), String(morning.name).trim())
      if (morning.time                  !== undefined) setSetting(db, 'morning_time',              morning.time)
      if (morning.steps                 !== undefined) setSetting(db, 'morning_steps',             JSON.stringify(정리된단계.morning))
      if (morning.bgmDuration           !== undefined) setSetting(db, 'morning_bgm_duration',      String(morning.bgmDuration))
      if (morning.morningPrayerIntroTts !== undefined) setSetting(db, 'morning_prayer_intro_tts', morning.morningPrayerIntroTts)
    }
    if (exercise) {
      if (exercise.enabled !== undefined) setSetting(db, 'exercise_broadcast_enabled', String(exercise.enabled))
      if (exercise.name !== undefined) setSetting(db, autoNameKey('exercise'), String(exercise.name).trim())
      if (exercise.time    !== undefined) setSetting(db, 'exercise_broadcast_time',    exercise.time)
      if (exercise.steps   !== undefined) setSetting(db, 'exercise_steps',             JSON.stringify(정리된단계.exercise))
      if (exercise.tts     !== undefined) setSetting(db, 'exercise_tts',               exercise.tts)
    }
    if (lunch) {
      if (lunch.enabled             !== undefined) setSetting(db, 'lunch_broadcast_enabled', String(lunch.enabled))
      if (lunch.name !== undefined) setSetting(db, autoNameKey('lunch'), String(lunch.name).trim())
      if (lunch.time                !== undefined) setSetting(db, 'lunch_broadcast_time',    lunch.time)
      if (lunch.steps               !== undefined) setSetting(db, 'lunch_steps',             JSON.stringify(정리된단계.lunch))
      if (lunch.tts                 !== undefined) setSetting(db, 'lunch_tts',               lunch.tts)
      if (lunch.prayerTts           !== undefined) setSetting(db, 'lunch_prayer_tts',        lunch.prayerTts)
      if (lunch.bgmDuration         !== undefined) setSetting(db, 'lunch_bgm_duration',      String(lunch.bgmDuration))
      if (lunch.lunchPrayerIntroTts !== undefined) setSetting(db, 'lunch_prayer_intro_tts', lunch.lunchPrayerIntroTts)
    }
    if (dinner) {
      if (dinner.enabled              !== undefined) setSetting(db, 'dinner_broadcast_enabled', String(dinner.enabled))
      if (dinner.name !== undefined) setSetting(db, autoNameKey('dinner'), String(dinner.name).trim())
      if (dinner.time                 !== undefined) setSetting(db, 'dinner_broadcast_time',    dinner.time)
      if (dinner.steps                !== undefined) setSetting(db, 'dinner_steps',             JSON.stringify(정리된단계.dinner))
      if (dinner.tts                  !== undefined) setSetting(db, 'dinner_tts',               dinner.tts)
      if (dinner.prayerTts            !== undefined) setSetting(db, 'dinner_prayer_tts',        dinner.prayerTts)
      if (dinner.bgmDuration          !== undefined) setSetting(db, 'dinner_bgm_duration',      String(dinner.bgmDuration))
      if (dinner.dinnerPrayerIntroTts !== undefined) setSetting(db, 'dinner_prayer_intro_tts', dinner.dinnerPrayerIntroTts)
    }
    if (breakfastPrayerTts !== undefined) setSetting(db, 'breakfast_prayer_tts', breakfastPrayerTts)
    if (evening_prayer) {
      if (evening_prayer.enabled !== undefined) setSetting(db, 'evening_prayer_enabled', String(evening_prayer.enabled))
      if (evening_prayer.name !== undefined) setSetting(db, autoNameKey('evening_prayer'), String(evening_prayer.name).trim())
      if (evening_prayer.time    !== undefined) setSetting(db, 'evening_prayer_time',    evening_prayer.time)
      if (evening_prayer.steps   !== undefined) setSetting(db, 'evening_prayer_steps',   JSON.stringify(정리된단계.evening_prayer))
      if (evening_prayer.tts        !== undefined) setSetting(db, 'evening_prayer_tts',  evening_prayer.tts)
      if (evening_prayer.tts2       !== undefined) setSetting(db, 'evening_prayer_tts2', evening_prayer.tts2)
      if (evening_prayer.closingTts !== undefined) setSetting(db, 'evening_closing_tts', evening_prayer.closingTts)
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[settings/broadcast-schedule POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── 기능 활성화 토글 ────────────────────────────────────────────

// 대시보드 "기능 활성화" 토글 중 실제 방송 동작을 좌우하는 4개는 feature_toggles가 아니라
// 각 기능의 진짜 제어 키를 직접 읽고 쓴다.
//
// 예전엔 4개 모두 feature_toggles에만 저장됐고 그 키를 읽는 코드가 아무 데도 없어서,
// "자동 아침 방송"을 꺼도 다음날 아침 방송이 그대로 나갔다(스케줄러는 morning_enabled를 읽음).
// 직원이 "껐다"고 믿는데 방송이 나가는 운영 위험이라 실제 키에 연결했다.
// 나머지 토글(tts/ai/calendar/bgm/mic/approve)은 아직 대응 동작이 없어 기존처럼 저장만 한다.
function readSegments(db) {
  const { DEFAULT_SEGMENTS } = require('../services/morning')
  const raw = getSetting(db, 'morning_segments', '')
  if (!raw) return DEFAULT_SEGMENTS.map(s => ({ ...s }))
  try {
    const saved = JSON.parse(raw)
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_SEGMENTS.map(s => ({ ...s }))
  } catch {
    return DEFAULT_SEGMENTS.map(s => ({ ...s }))
  }
}

function segmentEnabled(db, id) {
  return readSegments(db).find(s => s.id === id)?.enabled !== false
}

// 세그먼트 여러 개의 enabled를 한 번에 갱신 (나머지 세그먼트/순서는 그대로 보존)
function setSegmentsEnabled(db, patch) {
  const next = readSegments(db).map(s =>
    Object.prototype.hasOwnProperty.call(patch, s.id) ? { ...s, enabled: !!patch[s.id] } : s
  )
  setSetting(db, 'morning_segments', JSON.stringify(next))
}

// GET /api/settings/features
router.get('/features', (req, res) => {
  try {
    const db = getDB()
    const raw = getSetting(db, 'feature_toggles', '')
    // calendar/bgm/approve는 화면에서 제거됨 — calendar/bgm은 각각 API 연동·방송 설정
    // 화면에서 관리되고, approve(방송 승인)는 기능 자체가 구현된 적이 없다.
    // 예전에 저장돼 남아있는 키가 그대로 응답에 섞여 나오지 않도록 아는 키만 통과시킨다.
    const defaults = { tts: true, ai: true, mic: true }
    const parsed = raw ? JSON.parse(raw) : {}
    const saved = Object.fromEntries(
      Object.keys(defaults).filter(k => typeof parsed[k] === 'boolean').map(k => [k, parsed[k]])
    )
    res.json({
      ...defaults,
      ...saved,
      // 아래 4개는 저장된 토글값이 아니라 실제 제어 키를 그대로 반영한다 —
      // 다른 화면(자동방송순서편집기 등)에서 끈 것도 대시보드에 바로 보이게 하기 위함
      morning: getSetting(db, 'morning_enabled', 'true') === 'true',
      alert:   getSetting(db, 'weather_alert_broadcast_enabled', 'false') === 'true',
      weather: segmentEnabled(db, 'weather'),
      dust:    segmentEnabled(db, 'dust'),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/features
router.post('/features', (req, res) => {
  try {
    const db = getDB()
    const body = req.body ?? {}

    if (body.morning !== undefined) setSetting(db, 'morning_enabled', String(!!body.morning))
    if (body.alert   !== undefined) setSetting(db, 'weather_alert_broadcast_enabled', String(!!body.alert))

    // 아침 안내문 세그먼트 — "특보 안내"는 특보 자동방송과 안내문 속 특보 문장을 함께 끈다
    const segPatch = {}
    if (body.weather !== undefined) segPatch.weather = body.weather
    if (body.dust    !== undefined) segPatch.dust    = body.dust
    if (body.alert   !== undefined) segPatch.alert   = body.alert
    if (Object.keys(segPatch).length) setSegmentsEnabled(db, segPatch)

    // feature_toggles에는 라우트 가드용 스위치만 남긴다.
    // - morning/alert/weather/dust : 실제 제어 키로 옮겼으므로 중복 저장하지 않음(값이 갈라지는 것 방지)
    // - calendar/bgm/approve       : 화면에서 제거된 항목이라 저장하지 않음(예전 값도 여기서 정리됨)
    const GATE_KEYS = ['tts', 'ai', 'mic']
    const rest = Object.fromEntries(
      GATE_KEYS.filter(k => typeof body[k] === 'boolean').map(k => [k, body[k]])
    )
    setSetting(db, 'feature_toggles', JSON.stringify(rest))

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/settings/auto-shutdown
router.get('/auto-shutdown', (req, res) => {
  try {
    const db = getDB()
    res.json({ time: getSetting(db, 'auto_shutdown_time', '') })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/auto-shutdown
/**
 * **보낸 값인가, 안 보낸 값인가** (P-115, 2026-09-11).
 *
 * 이 저장소에는 **키 누락 = 기존 값 유지** 라는 관행이 이미 둘 있다 —
 * [FACT] `settings.js:128-131`(`if (x !== undefined)`) · `schedules.js:338-341`
 * (`hasOwnProperty ? … : existing`). `/org` 와 `/auto-shutdown` 만 그 관행을 벗어나
 * `?? ''` 로 **지웠다.**
 *
 * [FACT] EV-003983 — 그래서 `POST /auto-shutdown {}` 한 번에 `19:45` 가 `""` 가 됐다.
 * **현장 자동종료 18:21 이 같은 길로 지워진다.**
 *
 * `null` 도 "안 보낸 것" 으로 본다. 그 뜻이 이 저장소에 확립돼 있지 않고, 지우는 쪽이
 * 되돌리기 어렵기 때문이다(CLAUDE.md 개입 기준 '나'). **명시적 해제에는 이미 `""` 라는
 * 표기가 있다** — 빈 시각 = 자동종료 안 함(AP-0012), 빈 장치 = Windows 기본 장치.
 *
 * @returns {boolean} 이 요청이 그 필드를 **정하려 한** 것인가
 */
function 보냈나(body, field) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, field)) return false
  return body[field] !== null && body[field] !== undefined
}

router.post('/auto-shutdown', (req, res) => {
  try {
    // **안 보냈으면 손대지 않는다.** 지금 값을 그대로 되쓴다 —
    // 아래 `유효시각`·`scheduleAutoShutdown` 이 같은 값을 봐야 하므로 여기서 한 번에 정한다.
    const time = 보냈나(req.body, 'time')
      ? req.body.time
      : getSetting(getDB(), 'auto_shutdown_time', '')
    // **여기가 더 위험하다** — 이 값은 PC 를 끄는 시각이다(2026-09-11 검수 신규 발견).
    // 형식이 깨지면 `autoShutdown.js` 의 `split(':')` 이 NaN 을 내고 조용히 return 한다.
    // 저장은 성공하고 화면에는 그 값이 보이는데 **PC 는 영영 안 꺼진다.**
    // 자동방송 시각과 같은 규칙을 쓴다 — 빈 값은 "끄지 않는다"라 유효하다.
    if (!유효시각(time)) {
      return res.status(400).json({
        error: '종료 시각이 올바르지 않습니다. (예: 18:21 — 비우면 자동으로 끄지 않습니다)',
      })
    }
    // `time` 은 위에서 이미 정해졌다 — 보냈으면 그 값, 안 보냈으면 **지금 저장된 값**.
    // 그래서 여기서 `?? ''` 로 다시 덮지 않는다(그 한 줄이 P-115 의 절반이었다).
    setSetting(getDB(), 'auto_shutdown_time', time)
    // 스케줄 즉시 재적용
    const { scheduleAutoShutdown, cancelAutoShutdown } = require('../services/autoShutdown')
    if (time) scheduleAutoShutdown()
    else cancelAutoShutdown()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 방송 감시·백업 (2026-09-23) ────────────────────────────────
// 서버는 오래전부터 이 넷을 읽는데 **바꾸는 칸이 없었다.** 규칙·범위·기본값은
// `domain/watchSettings` 한 곳이다. 백업 시각은 저장하는 즉시 다시 예약한다.

// GET /api/settings/watch
router.get('/watch', (req, res) => {
  try {
    res.json(require('../domain/watchSettings').읽기(getDB()))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/watch — 보낸 칸만 바꾼다. 하나라도 틀리면 아무것도 저장하지 않는다.
router.post('/watch', (req, res) => {
  try {
    const 본 = require('../domain/watchSettings').검사(req.body)
    if (!본.ok) return res.status(400).json({ error: 본.사유, field: 본.field })
    const db = getDB()
    // 쓰다가 실패해도 반쪽만 저장되지 않게 한 묶음으로 쓴다 — 화면은 「저장하지 못했습니다」라고
    // 하는데 일부만 바뀌어 있으면 사람이 무엇이 저장됐는지 모른다(2026-09-23 코드 검수 Low).
    db.exec('BEGIN')
    try {
      for (const [key, value] of 본.쓸것) setSetting(db, key, value)
      db.exec('COMMIT')
    } catch (err) {
      try { db.exec('ROLLBACK') } catch { /* 이미 풀렸으면 무시 */ }
      throw err
    }
    if (본.백업바뀜) require('../services/backup').rescheduleBackup(db)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 영상 오디오 딜레이 (TV 싱크 보정) ──────────────────────────

// 보정 규칙·기본값·범위의 단일 출처는 `domain/videoSync` 다 — 라우트가 규칙을
// 따로 들고 있으면 화면과 서버가 다른 것을 믿게 된다(2026-09-16).
const {
  딜레이키, 자막오프셋키, 딜레이기본, 자막오프셋기본, 보정값읽기, 자막오프셋읽기,
} = require('../domain/videoSync')

// ── **보정값은 하나다** (사용자 지시 2026-09-16) ──────────────────────────
// *"이거 영상 하나로 통일해줘, 어차피 동일하게 TV에서 수신받아서 약간씩 늦는거잖아"*
//
// 앞 판은 라우트가 셋이었다(공용·국민체조·식사전). 국민체조와 식사전은 **같은 것을
// 재고 있었다** — 지연은 영상이 무엇이냐가 아니라 캡처카드→TV 경로에서 오고, 그
// 경로는 영상마다 다르지 않다. 현장 값도 둘 다 400 이었다.
// 갈래를 고를 일이 없어지면 **틀리게 고를 수도 없다**(V③ R18·R23 이 그 사고였다).
// 규칙·기본값·범위는 전부 `domain/videoSync` 한 곳에 있다.

// GET /api/settings/video-audio-delay
router.get('/video-audio-delay', (req, res) => {
  try {
    const db = getDB()
    const parsed = parseInt(getSetting(db, 딜레이키, String(딜레이기본)))
    res.json({ delayMs: isNaN(parsed) ? 딜레이기본 : parsed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/video-audio-delay
router.post('/video-audio-delay', (req, res) => {
  try {
    const 본 = 보정값읽기(req.body?.delayMs)
    if (!본.ok) return res.status(400).json({ error: 본.사유 })
    setSetting(getDB(), 딜레이키, String(본.값))
    res.json({ ok: true, delayMs: 본.값 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 비상방송 문안 (사용자 지시 2026-09-16) ────────────────────────────────
// *"비상방송관리는 수정 편집할 수 있게 해줘야지"*
//
// 문안이 소스 파일에 박혀 있어 현장에서 못 고쳤다. 그런데 이 글은 **그 시설의 말**이다 —
// 대피로 이름·집합 장소·호칭이 시설마다 다르다. 규칙은 `domain/emergencyPresets` 한 곳.

// GET /api/settings/emergency-presets
router.get('/emergency-presets', (req, res) => {
  try {
    const { 설정키, 기본문안, 목록읽기 } = require('../domain/emergencyPresets')
    const raw = getSetting(getDB(), 설정키, '')
    if (!raw) return res.json({ presets: 기본문안, 기본값인가: true })
    let 판 = null
    try { 판 = JSON.parse(raw) } catch { /* 깨졌으면 기본값으로 — 빈 화면보다 낫다 */ }
    const 본 = 목록읽기(판)
    // **저장된 것이 깨졌어도 빈 화면을 주지 않는다.** 급할 때 읽을 것이 없으면 그게 사고다.
    if (!본.ok) return res.json({ presets: 기본문안, 기본값인가: true, 경고: 본.사유 })
    res.json({ presets: 본.값, 기본값인가: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/emergency-presets
router.post('/emergency-presets', (req, res) => {
  try {
    const { 설정키, 목록읽기 } = require('../domain/emergencyPresets')
    const 본 = 목록읽기(req.body?.presets)
    if (!본.ok) return res.status(400).json({ error: 본.사유 })
    setSetting(getDB(), 설정키, JSON.stringify(본.값))
    res.json({ ok: true, presets: 본.값 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 자막 오프셋 (사용자 지시 2026-09-16) ──────────────────────────────────
// *"자막도 속도도 물려서 자막은 조금 늦어, 그래서 조금 빠르게 설정할 수 있도록"*
//
// 자막은 지금까지 소리 보정을 **그대로** 따라갔다. 소리를 늦추면 자막도 같이 늦는데,
// 사람 눈은 귀보다 자막을 먼저 찾아서 그게 늦게 느껴진다. 그 위에 더하는 값이다.
// **음수가 된다** — 당기는 것이 이 값의 존재 이유다(영상 보정은 0 밑으로 못 간다).

// GET /api/settings/caption-offset
router.get('/caption-offset', (req, res) => {
  try {
    const db = getDB()
    const parsed = parseInt(getSetting(db, 자막오프셋키, String(자막오프셋기본)))
    res.json({ offsetMs: isNaN(parsed) ? 자막오프셋기본 : parsed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/caption-offset
router.post('/caption-offset', (req, res) => {
  try {
    const 본 = 자막오프셋읽기(req.body?.offsetMs)
    if (!본.ok) return res.status(400).json({ error: 본.사유 })
    setSetting(getDB(), 자막오프셋키, String(본.값))
    res.json({ ok: true, offsetMs: 본.값 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 방송 BGM 기본 볼륨 ──────────────────────────────────────

// GET /api/settings/bgm-broadcast-default
router.get('/bgm-broadcast-default', (req, res) => {
  try {
    const db = getDB()
    res.json({ bgmDefault: require('../domain/volume').readVolume(db, 'bgm') })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/bgm-broadcast-default
router.post('/bgm-broadcast-default', (req, res) => {
  try {
    const { bgmDefault } = req.body
    if (bgmDefault === undefined || isNaN(Number(bgmDefault))) {
      return res.status(400).json({ error: 'bgmDefault 값이 필요합니다.' })
    }
    // 정규 키(vol_bgm)와 옛 이름(bgm_broadcast_default)을 writeVolumes가 함께 갱신한다
    require('../domain/volume').writeVolumes(getDB(), { bgm: bgmDefault })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 자연어 볼륨 표현 수치 ────────────────────────────────────
// "볼륨은 잔잔하게"가 몇 %인지는 스피커·공간마다 다르다. 코드에 박아두면 어르신들이
// "너무 작다"고 할 때마다 배포를 다시 해야 해서, 현장에서 고칠 수 있게 설정으로 뺐다.
// 낱말 목록 자체는 server/domain/ontology.js(VOLUME_LEVELS)가 갖고, 숫자만 여기서 관리한다.

// GET /api/settings/volume-words
router.get('/volume-words', (req, res) => {
  try {
    res.json(require('../domain/volume').readVolumeLevels(getDB()))
  } catch (err) {
    console.error('[settings/volume-words GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/volume-words — { quiet?, loud? }
router.post('/volume-words', (req, res) => {
  const { quiet, loud } = req.body || {}
  const invalid = (v) => {
    if (v === undefined || v === null || v === '') return false
    if (typeof v !== 'number' && typeof v !== 'string') return true
    const n = Number(v)
    return !Number.isFinite(n) || n < 0 || n > 100
  }
  if (invalid(quiet) || invalid(loud)) {
    return res.status(400).json({ error: '볼륨은 0~100 사이 숫자여야 합니다.' })
  }
  if (quiet === undefined && loud === undefined) {
    return res.status(400).json({ error: '저장할 값이 없습니다.' })
  }
  try {
    const applied = require('../domain/volume').writeVolumeLevels(getDB(), { quiet, loud })
    res.json({ ok: true, ...applied })
  } catch (err) {
    console.error('[settings/volume-words POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/generate-cert — 모바일 마이크용 자체서명 인증서 수동 생성
router.post('/generate-cert', (req, res) => {
  const { spawnSync } = require('child_process')
  const path = require('path')
  const { networkCandidates } = require('../domain/networkAddresses')
  const fs   = require('fs')

  const sslDir  = path.join(__dirname, '..', 'ssl')
  const keyPath = path.join(sslDir, 'key.pem')
  const crtPath = path.join(sslDir, 'cert.pem')

  if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
    return res.json({ ok: true, message: '인증서가 이미 존재합니다. 서버를 재시작하면 HTTPS(3443)가 활성화됩니다.' })
  }

  try { fs.mkdirSync(sslDir, { recursive: true }) } catch { /* 이미 있으면 무시 — 바로 아래에서 인증서를 쓰다 실패하면 그때 오류가 난다 */ }

  const ips = [...new Set(['127.0.0.1', ...networkCandidates().map(row => row.address)])]
  const sanIPs = ips.map(ip => `IP:${ip}`).join(',')
  const san    = `subjectAltName=${sanIPs},DNS:localhost`

  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\mingw64\\bin\\openssl.exe',
  ]
  let result = null
  for (const cmd of candidates) {
    result = spawnSync(cmd, [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', crtPath,
      '-days', '730', '-nodes',
      '-subj', '/CN=carecast-local',
      '-addext', san,
    ], { stdio: 'pipe' })
    if (result.status === 0) break
    if (result.error?.code !== 'ENOENT') break
  }

  // openssl 이 없는 PC(설치본 노트북) — Windows 기본 기능으로 만든다(services/httpsCert, 2026-09-17).
  if (!result || result.status !== 0) {
    try {
      const 인증서 = require('../services/httpsCert')
      if (!fs.existsSync(path.join(sslDir, 인증서.PFX이름)) && 인증서.인증서만들기(ips, { 폴더: sslDir })) {
        return res.json({ ok: true, message: `인증서 생성 완료 (${ips.join(', ')})
서버를 재시작하면 모바일 마이크(HTTPS 3443)가 활성화됩니다.` })
      }
      if (fs.existsSync(path.join(sslDir, 인증서.PFX이름))) {
        return res.json({ ok: true, message: '인증서가 이미 존재합니다. 서버를 재시작하면 HTTPS(3443)가 활성화됩니다.' })
      }
    } catch { /* 아래 원래 실패 안내로 간다 */ }
  }
  if (!result || result.status !== 0) {
    const msg = result?.stderr?.toString() || result?.error?.message || 'openssl 실행 실패'
    console.error('[인증서 생성 실패]', msg)
    return res.status(500).json({ error: `인증서 생성 실패: ${msg}\nGit이 설치되어 있는지 확인하세요.` })
  }

  console.log(`[인증서 생성] 완료 (SAN: ${sanIPs})`)
  res.json({ ok: true, message: `인증서 생성 완료 (${ips.join(', ')})\n서버를 재시작하면 모바일 마이크(HTTPS 3443)가 활성화됩니다.` })
})

// ── 기관 이름·표어 — 방송 대기화면의 큰 글씨 ──────────────────
//
// 홀 TV를 통째로 덮는 화면에 나가는 유일한 글자다. 여기가 코드에 박혀 있으면 다른 기관은
// 소스를 고치고 다시 빌드해야 쓸 수 있다(도입 가이드 4-2가 그렇게 안내하고 있었다).
//
// **기본값은 비운다.** 남의 기관 이름을 기본값으로 두면 설치하자마자 그 이름이 홀 TV에
// 걸린다 — 그것만으로 못 쓰는 물건이 된다. 비어 있으면 화면이 그 줄을 아예 안 그린다
// (BroadcastIndicators). 우리 현장도 예외가 아니라, 설정 화면에서 한 번 넣는다.
const ORG_TEXT_MAX = 40   // 화면 높이의 6분의 1만 한 글씨라 이보다 길면 줄이 넘친다

// GET /api/settings/place-name?lat=..&lon=.. — 좌표를 「서울특별시 용산구 …」로 (초기 설정 시설 위치 확인용).
// 저장하지 않는다. 묻는 규칙(초당 1건·출처 표시)은 services/placeName.js 한 곳에 있다.
router.get('/place-name', async (req, res) => {
  const r = await require('../services/placeName').지역이름(req.query.lat, req.query.lon)
  res.json(r)
})

// GET /api/settings/org
router.get('/org', (req, res) => {
  try {
    const db = getDB()
    const 글자 = require('../domain/broadcastTextSize')
    res.json({
      name: getSetting(db, 'org_name', ''), slogan: getSetting(db, 'org_slogan', ''),
      // 방송 화면 글자 크기(크게·중간·작게). 이 화면의 글자라 기관 문구와 함께 싣는다 —
      // 같은 창이 같은 때에 읽고, 같은 SSE(`org_info`)로 바뀐 값을 받는다.
      textSize: 글자.정리(getSetting(db, 글자.설정키, 글자.기본)),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/org
router.post('/org', (req, res) => {
  try {
    // **안 보낸 필드는 손대지 않는다**(P-115). 전에는 `?? ''` 라 한 필드만 보내면
    // 나머지가 지워졌다 — [FACT] EV-003983: `POST {"slogan":"X"}` 에 `org_name` 이
    // `"TEST-ORG-A1"` → `""` 가 됐다. 홀 TV 의 기관 이름이 그렇게 사라진다.
    const db0 = getDB()
    const 지금 = (key) => getSetting(db0, key, '')
    const name   = String(보냈나(req.body, 'name')   ? req.body.name   : 지금('org_name')).trim().slice(0, ORG_TEXT_MAX)
    const slogan = String(보냈나(req.body, 'slogan') ? req.body.slogan : 지금('org_slogan')).trim().slice(0, ORG_TEXT_MAX)
    // 깨진 글자(U+FFFD)를 저장하지 않는다. 이 값은 홀 TV에 가장 크게 걸리는 글자라,
    // 네모가 섞이면 그 화면이 통째로 망가져 보인다. audio_device가 실제로 그렇게 깨진 채
    // 들어앉아 있던 적이 있다(위 readAudioDevice).
    const broken = findBrokenField({ '기관 이름': name, '표어': slogan })
    if (broken) return res.status(400).json({ error: brokenTextMessage(broken) })
    // ── 방송 화면 글자 크기 (사용자 지시 2026-09-16) ──────────────────────────────
    // 안 보냈으면 지금 값 그대로다(P-115 와 같은 규칙). **보냈는데 모르는 값이면 거절한다** —
    // 조용히 기본값으로 바꿔 저장하면 사람은 「중간」을 골랐는데 화면은 「크게」로 남는다.
    const 글자 = require('../domain/broadcastTextSize')
    let textSize = 글자.정리(getSetting(db0, 글자.설정키, 글자.기본))
    if (보냈나(req.body, 'textSize')) {
      if (!글자.크기들.includes(req.body.textSize)) {
        return res.status(400).json({ error: '글자 크기는 크게·중간·작게 중에서 골라 주세요.' })
      }
      textSize = req.body.textSize
    }
    const db = getDB()
    setSetting(db, 'org_name', name)
    setSetting(db, 'org_slogan', slogan)
    setSetting(db, 글자.설정키, textSize)
    // ── **저장한 순간 홀 TV 가 바뀐다** (사용자 지적 2026-09-13) ─────────────────────
    // *"기관정보 저장했잖아 왜 안 나와"* — 맞다. 방송 화면(`BroadcastIndicators`)은 이 값을
    // **한 번 읽고 다시는 안 읽었다**(`orgReadyRef`). 그래서 설정에서 저장해도 그 창은 옛
    // 값(빈 문자열)을 계속 들고 있었고, 마법사를 끝까지 진행해도 마찬가지였다.
    // 홀 TV 는 **다른 창·다른 PC** 일 수 있으므로 화면 안의 이벤트로는 못 닿는다 — SSE 로 쏜다.
    // 실패해도 저장은 그대로다: 알림 때문에 설정 저장을 되돌리지 않는다.
    try { require('../services/sse').broadcastSSE('org_info', { name, slogan, textSize }) } catch { /* 알림 실패는 저장과 무관하다 */ }
    res.json({ ok: true, name, slogan, textSize })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 준비물 점검 (사용자 지시 2026-09-16) ──────────────────────────────────
// *"꼭 필수적으로 설치하는거 운영하기 위해서 체크리스트 세워서 없으면 하나하나씩
//   다운로드 받을 수 있게"*
//
// 없는 것을 **쓰려고 할 때** 알게 되는 구조였다(받아쓰기 단추를 누르고 나서야
// "이 PC에 없습니다"). 설치할 때 한 번에 확인하고 받아 두면 그런 일이 안 생긴다.
// 판정 규칙은 `services/prerequisites` 한 곳이다.

// GET /api/settings/prerequisites — 이 PC 에 무엇이 있고 무엇이 없나.
router.get('/prerequisites', async (req, res) => {
  try {
    const { 현황 } = require('../services/prerequisites')
    res.json({ items: await 현황() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 초기 설정을 **처음 한 번 띄운다** (사용자 지시 2026-09-16) ─────────────
// *"초기설정 메뉴에 있는거 설치하고 맨처음에 떴으면 좋겠는데"*
//
// 「처음인가」의 판정은 **설정 하나로 하지 않는다.** `setup_done_at` 만 보면, 그 값을
// 쓰기 전에 쓰다가 서버가 죽은 PC 나 설정을 손으로 지운 PC 에서 **이미 쓰던 시설에
// 마법사가 다시 뜬다.** 그래서 「정말 새 PC 인가」를 함께 본다 — 기관 이름도 없고
// 예약도 하나 없으면 그때가 처음이다.
//
// **막지는 않는다.** 마법사는 언제든 메뉴로 들어갈 수 있고, 이 값은 「자동으로 띄울까」
// 하나만 정한다.
// ── **예약·기관 이름으로 판정하지 않는다** (사용자 신고 2026-09-16 N2 — 설치했는데 안 떴다) ──
// 설치팩의 `site-baseline.json` 이 첫 기동 때 **예약(환기방송)·기관 설정을 심는다.**
// 그래서 「예약도 기관 이름도 없어야 처음」이던 앞 판은 설치 직후를 「쓰던 PC」로 읽었다.
// **쓰던 PC 의 표지는 방송 기록이다** — 기초값이 심지 않고, 실제로 방송이 나간 PC 에만 쌓인다.
// 기록 정리(`services/retention.js`)는 **보관 기간이 지난 것만** 지운다. 매일 자동방송이 도는
// PC 는 늘 최근 기록이 있어 「처음」이 안 된다. 보관 기간보다 오래 꺼져 있던 PC 는 다시 뜰 수
// 있지만, 마법사는 막지 않고(「나중에 설정하기」) 끝내면 `setup_done_at` 이 남아 다시 안 뜬다.
router.get('/setup-state', (req, res) => {
  try {
    const db = getDB()
    const 끝낸때 = getSetting(db, 'setup_done_at', '')
    let 방송수 = 0
    // **감시가 적은 행은 「방송을 한 흔적」이 아니다** (적대적 검증 T-32-1, 2026-09-17).
    // 새 설치에도 자동방송이 켜진 채 심기고, 감시(`watchdog.js`)는 매분 이미 지난 방송을 「서버 꺼짐·
    // 확인 불가」 행과 경보 행으로 적는다. 그것까지 세면 08:40 이후 설치한 PC 가 1분 뒤 「쓰던 PC」가 돼
    // 초기 설정이 안 떴다. 그래서 경보 행과 그 두 사유 코드를 뺀다(코드값은 `domain/broadcastRecord` 한 곳).
    const { 사유 } = require('../domain/broadcastRecord')
    try {
      방송수 = db.prepare(
        "SELECT COUNT(*) AS n FROM broadcasts WHERE type != '경보' AND (fail_reason IS NULL OR fail_reason NOT IN (?, ?))"
      ).get(사유.서버미가동, 사유.확인불가)?.n ?? 0
    } catch { /* 표가 없으면 0 */ }
    res.json({
      끝냈나: !!끝낸때,
      // 끝낸 적도 없고 방송을 한 번도 안 한 PC 만 「처음」이다.
      처음인가: !끝낸때 && 방송수 === 0,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/settings/setup-state — 「봤다」로 표시한다(끝냈든 나중에 하든).
router.post('/setup-state', (req, res) => {
  try {
    setSetting(getDB(), 'setup_done_at', new Date().toISOString())
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 이용 조건 동의 (사용자 지시 2026-10-07) ──────────────────────────────────────────────
// 기록만 한다 — 방송은 이 값을 보지 않는다(`domain/licenseConsent.js` 머리말).
// GET → { consent: { version, by, at } | null }
router.get('/license-consent', (req, res) => {
  try {
    res.json({ consent: require('../domain/licenseConsent').읽기(getDB()) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST { version: 'YYYY-MM-DD', by: '이름·직책' } → { ok, consent }
router.post('/license-consent', (req, res) => {
  try {
    const 동의 = require('../domain/licenseConsent')
    const 값 = 동의.검사(req.body)
    if (값.error) return res.status(400).json({ error: 값.error })
    res.json({ ok: true, consent: 동의.쓰기(getDB(), 값) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/settings/setup-firewall — 초기 설정 「휴대폰 접속 허용하기」 ────────────────
// 방화벽을 여는 일은 설치팩의 `CareCast-방화벽-열기.bat` 이 한다(스스로 관리자 권한을 요청하고
// 같은 공유기(로컬 서브넷)에서만 3001·3443 을 연다 — 네트워크 종류(개인·공용)는 가리지 않는다). 서버는 **그 파일을 띄워 주기만** 한다.
//  · **이 PC 에서 연 화면만** — 휴대폰이 누르면 방송 PC 에 누가 띄웠는지 모르는 권한 창이 뜬다.
//  · **권한 창 결과는 모른다** — 사람이 「예」를 눌렀는지 서버는 알 수 없으므로 「열었다」고 답하지 않는다.
//  · **시험 중에는 절대 띄우지 않는다** — `npm test` 가 개발 PC 의 방화벽을 건드리면 안 된다.
// 판정은 순수 함수로 떼어 두었다(`방화벽창구`) — 실제 실행 없이 시험이 조건을 고정한다.
const 방화벽파일 = require('path').join(__dirname, '..', '..', 'CareCast-방화벽-열기.bat')
function 방화벽창구(req, { 있나, 띄우기, 시험중 }) {
  if (!require('../services/sse').isLocalRequest(req)) {
    return { status: 403, body: { error: '방송 PC 에서 연 화면에서만 할 수 있습니다.' } }
  }
  if (시험중) return { status: 200, body: { 띄움: false, 시험: true } }
  if (!있나(방화벽파일)) {
    return { status: 404, body: { error: '이 PC 에는 방화벽 열기 파일이 없습니다 — 설치본에서만 됩니다. 시작 메뉴의 「휴대폰 접속 허용(방화벽)」을 찾아 보세요.' } }
  }
  띄우기(방화벽파일)
  return { status: 200, body: { 띄움: true } }
}
router.post('/setup-firewall', (req, res) => {
  try {
    const { status, body } = 방화벽창구(req, {
      있나: (p) => require('fs').existsSync(p),
      띄우기: (p) => {
        // 새 콘솔 창으로 띄운다 — 파일이 스스로 권한을 올리고 결과를 보여 준 뒤 멈춘다(pause).
        const child = require('child_process').spawn('cmd.exe', ['/c', 'start', '""', p], { detached: true, stdio: 'ignore', windowsHide: false })
        child.unref()
      },
      시험중: require('../services/hardwareMode').hardwareDisabled(),
    })
    res.status(status).json(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.방화벽창구 = 방화벽창구
