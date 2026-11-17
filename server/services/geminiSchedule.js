// 문장 하나를 제미나이에게 보내 **예약 필드**(날짜·시각·유형·제목·내용)를 받아 온다.
//
// 왜 여기로 내려왔나(2026-09-06): 이 함수를 **두 라우트가 쓴다** —
// `routes/scheduleDrafts.js`(AI 패널의 예약 만들기)와 `routes/schedules.js`(예약 카드 위
// 문장 입력). 라우트가 라우트를 부르면 `route-wiring.test.js` 가 막는다:
// "창구가 창구를 부르고 있다 — 공유물은 services/나 domain/으로 내릴 것".
//
// 사본을 만들지 않은 이유는 그 규칙과 같다 — **프롬프트가 두 벌이 되면 갈리고,
// 갈린 쪽이 조용히 다른 예약을 만든다.**
//
// 이 파일은 **부르기만 한다.** 언제 부를지(규칙이 먼저인지)는 `services/llmGateway.js` 가 정한다.
'use strict'

const { fetchGeminiWithRetry } = require('./geminiClient')

const PARSE_SYSTEM_PROMPT = `당신은 노인요양원 방송 예약 문장을 분석하는 도우미입니다.
사용자가 입력한 한국어 문장에서 날짜, 시간, 방송 제목, 방송 내용을 뽑아 아래 JSON 형식으로만 답하세요.
다른 설명·따옴표·마크다운 코드블록 없이 순수 JSON 객체 하나만 출력하세요.

{"date": "YYYY-MM-DD 또는 모르면 null", "time": "HH:mm(24시간) 또는 모르면 null", "broadcast_type": "text | chime | bgm 중 하나", "title": "짧은 제목", "content": "실제 방송으로 나갈 안내 문구(2~3문장, 어르신들께 공손하고 친근하게, 마지막은 '감사합니다.'로 끝남)"}

규칙:
- "오후 두시"는 14:00, "오전 아홉시"는 09:00처럼 24시간제로 변환
- 상대적 날짜("내일", "다음주 월요일")는 주어진 오늘 날짜를 기준으로 계산해서 실제 YYYY-MM-DD로 변환
- 날짜나 시간을 문장에서 전혀 알 수 없으면 해당 값은 null
- broadcast_type은 반드시 셋 중 하나만 쓰고, 다른 값은 절대 만들지 마세요:
  - "text": 안내 문구를 음성으로 읽어주는 일반 방송 (대부분 여기에 해당하며 기본값입니다)
  - "chime": 차임벨·종소리만 울리는 방송 ("차임벨 울려줘", "식사 종 울려줘")
  - "bgm": 배경음악·노래만 트는 방송 ("클래식 음악 틀어줘")
- 읽어줄 안내 문구가 조금이라도 필요하면 "text"입니다. 애매하면 "text"를 고르세요.
- "chime"이면 읽을 문구가 없으므로 content는 빈 문자열("")로 두세요.
- "bgm"이면 content에 안내 문구 대신 **틀어달라는 음악의 검색어**(장르·가수·곡명)만 적으세요.
  예: "트로트 틀어줘" → "트로트", "동요 틀어줘" → "동요". 문장에 검색어가 없으면 ""로 두세요.`

// Gemini가 돌려준 시각을 HH:mm으로 강제 정규화한다. 프롬프트가 24시간제를 요구해도 형식
// 준수는 보장이 아니다 — '9:00'처럼 0이 안 채워진 값은 지난시각 보정('9:00' <= '14:00'이
// 문자열 비교로 false)과 스케줄러의 정확 일치 발동('09:00'과 불일치)을 모두 통과 못 해,
// 조용히 영원히 안 울리는 예약이 된다. 시각으로 읽을 수 없는 값은 null(= 시각 없음)로
// 돌려 기존 422 경로를 타게 한다.
function normalizeHHMM(time) {
  if (typeof time !== 'string') return null
  const m = time.trim().match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function parseWithGemini(text, apiKey, model) {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `오늘 날짜: ${todayStr}\n문장: ${text}` }] }],
        systemInstruction: { parts: [{ text: PARSE_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 1200, temperature: 0.2, responseMimeType: 'application/json' },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // 503(UNAVAILABLE)은 fetchGeminiWithRetry가 재시도까지 한 뒤에도 실패한 것 — 영어 원문 대신
    // 사용자에게 바로 이해되는 안내로 바꾼다(ai.js와 통일).
    if (res.status === 503) throw new Error('AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.')
    throw new Error(err.error?.message || `Gemini API 오류 (${res.status})`)
  }
  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!raw) throw new Error('Gemini 응답이 비어 있습니다.')
  let parsed
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('AI 응답을 이해하지 못했습니다. 문장을 조금 더 구체적으로 입력해주세요.') }
  // 형식을 여기서 못박아야 아래의 모든 문자열 비교(지난시각 보정)와 스케줄러의 정확 일치
  // 발동이 안전해진다 — normalizeHHMM 주석 참고.
  parsed.time = normalizeHHMM(parsed.time)
  return parsed
}

module.exports = { parseWithGemini, normalizeHHMM, PARSE_SYSTEM_PROMPT }
