const express   = require('express')
const { getDB } = require('../db/schema')
const { fetchWeather, fetchUVIndex } = require('../services/weather')
const { fetchGeminiWithRetry } = require('../services/geminiClient')

const router = express.Router()

// 기본 지침 본문과 그 사연은 domain/broadcastPrompt.js에 있다 — settings.js(관리자 화면에
// 기본값 표시)와 함께 쓰는 값이라 라우트 밖으로 내렸다.
const { DEFAULT_SYSTEM_PROMPT } = require('../domain/broadcastPrompt')

// DB 설정 값 읽기 헬퍼
// 설정 읽기는 domain/settingsRead 한 곳을 쓴다 — 같은 조회가 12곳에 복사돼 있었다(TD-04).
const { rawSetting } = require('../domain/settingsRead')

function getSetting(key) { return rawSetting(getDB(), key) || null }

// ─── Gemini API ───────────────────────────────────────────────────────────────

// 기본 모델 이름은 domain/geminiModel.js 한 곳에서 온다(2026-09-06). 예전엔 일곱 곳에
// 박혀 있었고 값이 둘로 갈려서, 설정이 비면 **화면은 3.6 이라 하는데 실제로는 3.5** 로 나갔다.
// 3.5-flash 를 고른 실측 근거는 그 파일 머리말에 있다.
const { currentGeminiModel } = require('../domain/geminiModel')

async function callGemini(apiKey, keyword, model, weatherCtx) {
  const userText = weatherCtx
    ? `키워드: ${keyword}\n날씨 참고: ${weatherCtx}`
    : `키워드: ${keyword}`
  const systemPrompt = getSetting('broadcast_system_prompt') || DEFAULT_SYSTEM_PROMPT
  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method:  'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents:          [{ role: 'user', parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // "생각" 토큰이 maxOutputTokens 한도를 같이 나눠 쓴다(thinkingConfig로 끄거나 줄이려
        // 해도 이 모델들은 실제로 잘 안 먹힘) — 짧아진 목표 길이(100~160자) 기준으로 재실측해
        // 2200이면 생각 토큰 + 실제 방송문이 넉넉히 들어가는 것 확인(finishReason: STOP).
        generationConfig:  { maxOutputTokens: 2200, temperature: 0.75 },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err.error?.message || `Gemini API 오류 (${res.status})`
    // 쿼터 초과 시 모델 변경 안내 포함
    if (res.status === 429 || msg.toLowerCase().includes('quota')) {
      throw new Error(`현재 모델(${model})에서 오류가 발생했습니다. 관리자 → API 설정에서 다른 모델을 고르거나 「자동으로 최신 모델 쓰기」를 켜 보세요.`)
    }
    // 503(UNAVAILABLE)은 fetchGeminiWithRetry가 이미 재시도까지 한 뒤에도 실패한 것 — 재시도로
    // 해결이 안 되는 일시적 과부하이므로 영어 원문 대신 사용자에게 바로 이해되는 안내로 바꾼다.
    if (res.status === 503) {
      throw new Error('AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.')
    }
    throw new Error(`[${model}] ${msg}`)
  }
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error('Gemini 응답이 비어 있습니다.')
  return text
}

// ─── 라우트 ───────────────────────────────────────────────────────────────────

// POST /api/ai/generate — AI 방송문 생성 (기본: Gemini, settings.gemini_model 사용)
router.post('/generate', async (req, res) => {
  // 대시보드 "AI 방송 도우미" 스위치. /test·/test-gemini(연결 테스트)는 설정 화면에서
  // 키를 확인하는 용도라 막지 않는다 — 꺼둔 상태에서도 설정은 할 수 있어야 한다.
  if (require('../services/features').blockIfDisabled(res, 'ai', 'AI 방송 도우미')) return

  const { keyword, withWeather } = req.body
  if (!keyword?.trim()) return res.status(400).json({ error: '키워드를 입력해주세요.' })

  const provider = getSetting('ai_provider') || 'gemini'
  const model    = currentGeminiModel()

  // 날씨 문맥 포함 옵션 (withWeather=true 또는 키워드에 '날씨'/'아침'/'방송' 포함 시 자동)
  let weatherCtx = null
  const needsWeather = withWeather || /날씨|아침|방송|오늘|계절/.test(keyword)
  if (needsWeather) {
    try {
      const [wx, uv] = await Promise.allSettled([fetchWeather(), fetchUVIndex()])
      const parts = []
      if (wx.status === 'fulfilled' && wx.value) {
        const w = wx.value
        if (w.weather)      parts.push(`날씨: ${w.weather}`)
        if (w.temp != null) parts.push(`기온: ${w.temp}°C`)
      }
      if (uv.status === 'fulfilled' && uv.value) {
        parts.push(`자외선: ${uv.value.grade ?? '보통'}(${uv.value.uvIndex})`)
      }
      if (parts.length > 0) weatherCtx = parts.join(', ')
    } catch { /* 날씨 문맥은 있으면 좋은 참고값이다 — 못 붙여도 AI 응답 자체는 나가야 한다 */ }
  }

  // ── 3단 폴백의 2·3차 (2026-09-06) ────────────────────────────────────
  //
  // 1차(로컬 모델)는 **브라우저가 먼저 시도하고** 실패했을 때 여기로 온다.
  // 서버가 맡는 것은 2차(외부 API) → 3차(템플릿)다.
  //
  // 예전에는 API 가 실패하면 500 을 내고 끝났다. 그러면 인터넷이 끊긴 날
  // **화면이 빈손이 되고 사람은 방송문을 못 만든다.** 이제는 템플릿이라도 돌려준다 —
  // 대신 어느 단계가 쓰였는지(via)를 함께 보내 화면이 배지로 밝힌다.
  // "LLM 이 쓴 것처럼 보이는 템플릿 문장"이 제일 나쁘다.
  if (provider !== 'gemini') {
    return res.status(400).json({ error: '현재 Gemini만 지원합니다. 관리자 설정에서 AI 제공자를 Gemini로 변경해주세요.' })
  }

  const apiKey = getSetting('gemini_api_key')
  const { generateAnnouncement, viaLabel } = require('../services/llmGateway')

  const t0 = Date.now()
  const r = await generateAnnouncement({
    situation: keyword.trim(),
    // 키가 없으면 2차를 아예 안 태운다 — 없는 키로 부르는 것은 시간만 쓴다.
    callApi: apiKey ? ((situation) => callGemini(apiKey, situation, model, weatherCtx)) : null,
  })

  console.log(`[AI/generate] ${viaLabel(r.via)}(${Date.now() - t0}ms)`
    + (r.reason ? ` — ${r.reason}` : ''))

  res.json({ text: r.text, provider, model, via: r.via, viaLabel: viaLabel(r.via), reason: r.reason })
})

// POST /api/ai/test — Gemini 연결 테스트 (settings에 저장된 모델 사용)
// /test-gemini는 화면 옛 버전이 부르던 이름이라 별칭으로 남긴다. 2026-08-31(CC-036) 전까지는
// 66줄이 통째로 복제돼 있었고 둘 다 fetch를 직접 불러 재시도·타임아웃을 건너뛰었다.
// server/test/ai-routes-dedup.test.js가 두 경로가 같은 핸들러인지 고정한다.
async function handleGeminiTest(req, res) {
  const apiKey = getSetting('gemini_api_key')
  if (!apiKey) return res.status(400).json({ ok: false, error: 'Gemini API 키가 설정되지 않았습니다.' })

  const model = currentGeminiModel()
  try {
    const response = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method:  'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents:         [{ parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    )
    if (response.ok) return res.json({ ok: true, model })
    const err = await response.json().catch(() => ({}))
    const msg = err.error?.message || '인증 실패'
    res.json({ ok: false, error: `[${model}] ${msg}` })
  } catch (err) {
    // 타임아웃도 여기로 온다(fetchGeminiWithRetry가 던지는 유일한 경우) — 연결 테스트에서는
    // 500이 아니라 화면이 그대로 보여주는 ok:false 문구가 맞다.
    res.json({ ok: false, error: err.message })
  }
}

// GET /api/ai/models — 이 키로 **지금 쓸 수 있는 모델 목록**을 구글에게 물어본다.
//
// 왜 필요한가(2026-09-06 사용자 지적): 모델명이 자유 입력칸이라 사람이 손으로 타이핑한다.
// 구글이 3.5 를 접고 4.0 을 내면 저장된 이름이 하루아침에 죽는다. 목록을 코드에 박아 두면
// 그날 아무도 안 고쳐서 같은 일이 반복된다 — **구글에게 물어보면 저절로 따라간다.**
//
// 이것이 없어도 기능은 안 멈춘다(3단 폴백이 받는다). 다만 사람이 **왜 AI 가 안 쓰이는지**
// 모르게 되므로, 고를 수 있게 해 두는 편이 낫다.
router.get('/models', async (req, res) => {
  const apiKey = getSetting('gemini_api_key')
  if (!apiKey) return res.json({ models: [], reason: 'API 키가 아직 없습니다.' })
  try {
    // 목록 받기는 services/geminiModelAuto 한 곳 — **끝 쪽까지** 받는다(첫 쪽만 보면 최신을 놓친다).
    // 그쪽도 래퍼(fetchGeminiWithRetry)를 쓴다 — 직접 fetch 금지(CLAUDE.md 규칙). 받는 곳은 v1beta/models,
    // 남기는 것은 generateContent 를 지원하는 모델뿐이다.
    const { models, reason } = await require('../services/geminiModelAuto').listGenerateModels(apiKey)
    if (reason) return res.json({ models: [], reason })
    // 받은 김에 자동 선택도 새로 한다 — 사람이 목록을 부른 순간이 「지금 최신」을 확인하기 좋은 때다.
    // 기다리지 않는다(시험 호출이 몇 초 걸린다). 던지지 않는 함수다.
    require('../services/geminiModelAuto').refreshAutoModel({ models })
      .then(r => console.log(`[Gemini 모델] 목록 조회 뒤 자동 선택: ${r}`))
    res.json({ models })
  } catch (err) {
    // 목록을 못 받는 것은 오류가 아니다 — 손으로 입력하는 길이 그대로 살아 있다
    res.json({ models: [], reason: err.message })
  }
})

router.post('/test', handleGeminiTest)
router.post('/test-gemini', handleGeminiTest)  // 하위 호환 별칭 — 같은 핸들러

module.exports = router
