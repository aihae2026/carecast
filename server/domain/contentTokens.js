// 문안 토큰 사전 — **단일 출처**. 화면 칩·치환기·가변 판정기가 모두 이 파일을 본다.
//
// 왜 토큰이어야 했나(2026-09-06 설계 결정): 예약 문안은 사람이 쓴 자유 문장이라,
// "날씨가 들어갔으니 가변"처럼 낱말로 추정하면 오판이 난다. 그 오판의 결과가
// **어제 날씨를 오늘 방송하는 것**인데, 무인 운영에는 정정할 사람이 없다.
// 그래서 판정을 문장 뜻이 아니라 **표기**에 건다 — `{{날씨}}` 가 있으면 가변, 없으면 정적.
// 같은 문안은 언제 판정해도 같은 답이 나온다.
//
// 이 판정 하나에 두 가지가 달려 있다:
//   렌더 시점 — 정적은 등록 즉시 1회, 가변은 예약시각 T-10분(및 그 뒤 최초 가능한 순간)
//   폴백 정책 — 가변은 렌더 실패 시 **이전 캐시를 절대 안 쓴다**
'use strict'

/**
 * 쓸 수 있는 토큰.
 * label/example 은 예약 작성 화면의 칩이 그대로 쓴다 — 화면이 목록을 따로 만들지 않는다.
 * 사전에 없는 토큰은 저장 단계에서 거부한다. 방송 시각에 `{{날시}}` 가 그대로 읽히면
 * 그것이야말로 사람이 제일 늦게 알아채는 실패다.
 */
const TOKENS = {
  날씨:     { label: '날씨',     example: '맑음',        variable: true },
  기온:     { label: '기온',     example: '26도',        variable: true },
  미세먼지: { label: '미세먼지', example: '보통',        variable: true },
  날짜:     { label: '날짜',     example: '9월 6일',     variable: true },
  요일:     { label: '요일',     example: '토요일',      variable: true },
  시각:     { label: '시각',     example: '오후 2시 30분', variable: true },
}

// `{{ 이름 }}` — 사람이 손으로 치는 자리라 안쪽 공백을 너그럽게 받는다.
// 중괄호는 이름에 못 들어간다(`[^{}]`) — 그래야 `{{a}} {{b}}` 가 하나로 안 뭉친다.
//
// 이 값을 밖으로 내보내지만 **호출부에서 exec 루프를 돌리지 않는다**(lastIndex가 남는다).
// 아래 findTokens 처럼 matchAll 을 쓰거나 String.match 를 쓴다 — 둘 다 lastIndex를 안 건드린다.
const TOKEN_RE = /\{\{\s*([가-힣A-Za-z_][^{}]*?)\s*\}\}/g

/** 화면·문서용 목록. 사전의 순서를 그대로 쓴다. */
function listTokens() {
  return Object.entries(TOKENS).map(([name, meta]) => ({ name, ...meta }))
}

/** 문안에 들어 있는 토큰 이름들(중복 포함, 나온 순서대로). */
function findTokens(content) {
  const s = String(content ?? '')
  if (!s) return []
  // 매번 새 정규식을 만든다 — 내보낸 TOKEN_RE의 lastIndex에 기대지 않는다.
  const re = new RegExp(TOKEN_RE.source, 'g')
  return [...s.matchAll(re)].map((m) => m[1].trim())
}

/** 사전에 없는 토큰 이름들. 저장 거부의 근거가 된다(기존 레코드에는 적용하지 않는다). */
function unknownTokens(content) {
  return findTokens(content).filter((name) => !(name in TOKENS))
}

/**
 * 사람이 쓴 문안의 content_source 를 정한다. **저장 시점에 한 번** 부르고 그 값을 기록한다.
 * 시스템이 짓는 문안(system_template)과 LLM 문안(llm)은 만든 쪽이 직접 지정한다.
 */
function classifyContent(content) {
  return findTokens(content).length > 0 ? 'manual_template' : 'manual'
}

/**
 * 유예 30초 대상인가 — "시각 자체가 내용인 방송".
 * 이것도 낱말이 아니라 토큰으로 가른다. "시각을 확인해 주세요"는 대상이 아니다.
 */
function hasTimeToken(content) {
  return findTokens(content).includes('시각')
}

/**
 * 정적인 문안들. **여기 있는 것만** 정적이고 나머지는 전부 가변으로 본다.
 *
 *   manual        — 사람이 쓴 고정 문장(토큰 없음)
 *   system_static — settings 의 고정 문안. 자동 5종 중 체조·점심·저녁·저녁 마무리
 *                   (`broadcastSequencer.js` 의 LANES.contentSource 가 이 값을 준다)
 *
 * system_static 이 빠져 있던 때가 있었다(2026-09-06). 렌더 판정이 LANES 를 직접 봐서
 * 겉으로는 안 걸렸지만, **이 함수를 쓰는 순간 정적 4종이 매일 재합성됐을 것**이다 —
 * 정시성을 고치려는 작업이 합성량을 늘리는 역전이다.
 */
const STATIC_SOURCES = new Set(['manual', 'system_static'])

/**
 * 가변 문안인가. 가변이면 렌더 실패 시 **이전 캐시를 쓰지 않는다.**
 *
 * 모르는 값은 **가변으로 본다**(안전한 쪽). 틀린 정보를 확신 있게 말하느니
 * 다시 만들거나 축약 문안으로 가는 편이 낫다.
 */
function isVariable(contentSource) {
  return !STATIC_SOURCES.has(contentSource)
}

/**
 * **이미 저장돼 있는 예약**의 content_source 를 정한다(마이그레이션 채우기용).
 *
 * managed_by 는 값이 둘뿐이고 뜻이 서로 다르다(scheduleStore.js:20-21):
 *   'morning_editor' — 자동방송순서편집기가 소유한 행. 시스템 서식이다  → system_template
 *   'ai'             — 자연어 초안에서 사람이 승인해 만들어진 행. LLM 문안이다 → llm
 *
 * 처음엔 둘을 묶어 system_template 으로 뒀는데, **개발 DB 에 'ai' 행이 없어서**
 * 그 오분류가 드러나지 않았다(2026-09-06). 폴백 정책이 갈릴 수 있는 값이라 구분한다.
 */
function classifyExistingSchedule({ content, managed_by: managedBy } = {}) {
  if (findTokens(content).length > 0) return 'manual_template'
  if (managedBy === 'morning_editor') return 'system_template'
  if (managedBy === 'ai') return 'llm'
  return 'manual'
}

module.exports = {
  TOKENS, TOKEN_RE, STATIC_SOURCES, listTokens, findTokens, unknownTokens,
  classifyContent, hasTimeToken, isVariable, classifyExistingSchedule,
}
