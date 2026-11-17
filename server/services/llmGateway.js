// LLM 호출의 단일 창구 — **어느 단계가 쓰였는지 함께 돌려준다.**
//
// 3단 폴백에서 이 파일이 맡는 것은 **2차(외부 API) → 3차(템플릿)** 이다.
// 1차(로컬 모델)는 **브라우저에서 돈다** — 크롬 내장 Prompt API 는 서버에 없다.
// 그래서 순서는 이렇게 나뉜다:
//
//   브라우저: 1차 로컬 시도 → 실패하면 서버로 요청
//   서버(여기): 2차 API 시도 → 실패하면 3차 템플릿
//
// 이 분담을 지키는 이유: 서버가 로컬 모델을 흉내 내려 하면 "어느 PC 의 로컬이냐"가
// 곧바로 문제가 된다. 방송용 PC 와 관리자 PC 는 사양이 다르다(설계 문서 §B-2).
//
// **어느 단계가 쓰였는지(via)를 반드시 함께 돌려준다.** 그것이 없으면 화면이 배지를
// 못 그리고, 사람은 템플릿이 만든 문장을 LLM 이 쓴 것으로 오해한다.
'use strict'

const { buildAnnouncement } = require('../domain/llmTemplate')

/** 응답이 쓸 만한가. 빈 문자열·공백만은 **성공으로 위장된 실패**다. */
function 쓸만한가(text) {
  return typeof text === 'string' && text.trim().length > 0
}

/**
 * 방송 문구를 얻는다. 2차 → 3차 순서로 시도한다.
 *
 * @param {object} 인자
 *   - situation {string}  상황 한 줄
 *   - callApi   {function} 2차 호출(주입). 없으면 곧바로 3차로 간다
 * @returns {Promise<{text: string, via: 'api'|'template', reason?: string}>}
 *          **던지지 않는다.** 어떤 경우에도 문장 하나는 돌려준다 —
 *          이 자리에서 던지면 화면이 빈손이 되고, 사람은 왜 안 되는지 모른다.
 */
async function generateAnnouncement({ situation, callApi } = {}) {
  if (typeof callApi === 'function') {
    try {
      const text = await callApi(situation)
      if (쓸만한가(text)) return { text: text.trim(), via: 'api' }
      // 빈 응답 — 성공 코드로 왔어도 쓸 수 없다. 다음 단계로 간다.
      return { text: buildAnnouncement(situation), via: 'template', reason: 'API 가 빈 응답을 냈다' }
    } catch (e) {
      // 타임아웃·예외·키 없음 — 원인을 가리지 않는다. 사람이 기다리는 자리다.
      return { text: buildAnnouncement(situation), via: 'template', reason: `API 실패: ${e.message}` }
    }
  }
  return { text: buildAnnouncement(situation), via: 'template', reason: 'API 경로 없음' }
}

/**
 * 어느 단계가 쓰였는지 사람이 읽을 한 줄. 로그와 배지가 같은 말을 쓰게 한다.
 * 화면이 따로 문구를 지으면 같은 사건이 두 가지 말로 보인다(경보에서 겪었다).
 */
function viaLabel(via) {
  // 'rule' 은 자연어 파싱 전용이다 — 그 경로의 비-AI 단계는 정해진 틀이 아니라
  // 규칙 파서라, '템플릿'이라 부르면 사람이 무엇이 읽었는지 잘못 안다(2026-09-06).
  return { local: '로컬', api: 'API', rule: '규칙', template: '템플릿' }[via] || via
}

// ── 자연어 → 예약 초안 파싱의 폴백 ──────────────────────────────────────
//
// **3차에 새 파서를 만들지 않는다.** `services/schedulePhrase.js` 가 이미 있고,
// 쉬운 화면의 "예약 추가" 문장 입력이 그것을 쓴다. 같은 일을 두 번 구현하면 두 곳이
// 갈리고, 갈린 쪽이 조용히 틀린 예약을 만든다 — 이번에 방송 시각 사본으로 겪은 것과 같다.

/**
 * 규칙 파서의 결과를 **초안이 쓰는 필드 이름**으로 옮긴다.
 *
 * 두 파서가 이름을 다르게 쓴다: 규칙은 `scheduled_time`, 초안 경로는 `time` 이다.
 * 여기서 안 맞추면 값이 통째로 새고, 화면에는 "시각을 못 읽었다"로 보인다.
 *
 * **못 읽은 것(ambiguous)은 그대로 넘긴다.** 조용히 정하지 않는다 —
 * 화면이 그것으로 사람에게 되묻는다(CLAUDE.md 검토 게이트).
 */
function toDraftShape(ruleResult = {}, today = null) {
  return {
    date: ruleResult.date ?? today,
    time: ruleResult.scheduled_time ?? ruleResult.time ?? null,
    title: ruleResult.title ?? '',
    content: ruleResult.content ?? '',
    broadcast_type: ruleResult.broadcast_type ?? 'text',
    ambiguous: ruleResult.ambiguous ?? [],
  }
}

/**
 * 파싱 결과가 쓸 만한가. **시각이 없으면 예약을 만들 수 없다.**
 *
 * 규칙 파서에는 `time` 만 보면 안 된다 — 시각을 못 읽어도 `09:00` 을 채우고
 * `ambiguous` 에 `time_missing` 을 남긴다(`schedulePhrase.js:278-284`).
 * 그래서 **못 읽었다는 표시를 함께 본다.** 안 그러면 규칙은 언제나 성공으로 보인다.
 */
function 파싱쓸만한가(p) {
  if (!p || typeof p !== 'object' || !p.time) return false
  return !(p.ambiguous || []).includes('time_missing')
}

/**
 * 문장 → 예약 초안. **규칙 먼저, 못 읽었을 때만 API.** (2026-09-06 순서를 뒤집었다)
 *
 * 왜 뒤집었나 — 실측이 근거다:
 *   제미나이 **10.5초**([FACT] EV-000755) vs 규칙 파서 **밀리초**.
 *   그리고 현장 말투("매일 오후 3시에 산책 안내")는 규칙이 이미 정확히 읽는다(EV-000693).
 * 예전 순서는 **빠르고 정확한 쪽을 10초 기다린 뒤에야** 썼다.
 *
 * **API 를 부르는 조건은 좁게 잡는다 — 규칙이 시각을 못 읽었을 때뿐이다.**
 * "애매한 게 하나라도 있으면"으로 넓히면 오전/오후 같은 흔한 애매함마다 10초를 쓰게 되고,
 * 그건 모델도 모르는 것이라 얻는 것도 없다. 그 애매함은 확인 카드가 사람에게 되묻는다.
 *
 * **던지지 않는다.** 여기서 던지면 화면이 빈손이 되고 사람은 문장을 다시 쓸 수밖에 없다.
 */
async function parseWithFallback({ text, today, callApi, now = new Date(), context } = {}) {
  const src = typeof text === 'string' ? text : ''

  // 1차 — 규칙. 인터넷도 키도 필요 없고 즉시 끝난다.
  // **원본(raw)도 함께 들고 다닌다** — `toDraftShape` 는 초안이 쓰는 다섯 칸만 남기는데,
  // 규칙 파서는 반복 요일·볼륨·흐름 id 까지 읽는다. 규칙이 1차가 된 지금 그걸 떨구면
  // "예약 추가" 모달이 비어 채워진다.
  const raw = 규칙원본(src, now, context)
  const 규칙 = toDraftShape(raw, today)
  if (파싱쓸만한가(규칙)) return { parsed: 규칙, raw, via: 'rule' }

  // 2차 — 규칙이 시각을 못 읽었다. 이때만 모델에게 물어본다.
  if (typeof callApi === 'function') {
    try {
      const parsed = await callApi(src)
      if (파싱쓸만한가(parsed)) {
        return { parsed, raw: applyApiTime(raw, parsed), via: 'api', reason: '규칙이 시각을 못 읽어 AI 에게 물었다' }
      }
      return { parsed: 규칙, raw, via: 'rule', reason: 'AI 도 시각을 못 읽었다' }
    } catch (e) {
      return { parsed: 규칙, raw, via: 'rule', reason: `AI 실패: ${e.message}` }
    }
  }
  // 3차 — 물어볼 곳이 없다. 규칙 결과를 **애매한 채로** 돌려준다.
  // 조용히 정하지 않는다 — 화면이 그것으로 사람에게 되묻는다(CLAUDE.md 검토 게이트).
  return { parsed: 규칙, raw, via: 'rule', reason: 'AI 경로 없음 — 확인이 필요하다' }
}

/**
 * AI 가 읽은 시각을 규칙 결과에 **덮어씌운다.** 규칙이 읽은 나머지(반복·볼륨·흐름)는 살린다.
 *
 * AI 결과로 통째로 갈아치우지 않는 이유: 규칙만 아는 것이 있다 —
 * 저장된 흐름 이름, 관리자 화면에서 조정한 볼륨 정성어, 일과방송 시각 충돌.
 * 모델은 그 표를 본 적이 없다.
 */
function applyApiTime(raw, api) {
  if (!raw || typeof raw !== 'object') return raw
  const 합친것 = { ...raw, scheduled_time: api.time }
  if (api.date) 합친것.repeat_start_date = api.date
  if (api.title) 합친것.title = api.title
  if (api.content) 합친것.content = api.content
  // 시각을 읽었으므로 그 되물음은 없앤다. 나머지 애매함은 그대로 둔다.
  합친것.ambiguous = (raw.ambiguous || []).filter(a => a !== 'time_missing')
  return 합친것
}

/**
 * 규칙 파서를 부른다. **문맥을 반드시 함께 넘긴다.**
 *
 * 안 넘기면 흐름 이름·볼륨 낱말·일과방송 시각 충돌이 통째로 빠진다 —
 * 같은 문장이 어느 길로 갔느냐에 따라 다른 예약이 된다(`domain/phraseContext.js` 참고).
 */
function 규칙원본(text, now, context) {
  try {
    const { parseSchedulePhrase } = require('./schedulePhrase')
    return parseSchedulePhrase(text, now, context || undefined)
  } catch (e) {
    // 규칙 파서까지 실패하면 빈 결과라도 준다 — 화면이 빈손이 되면 안 된다.
    return { ambiguous: [`규칙 파서 실패: ${e.message}`, 'time_missing'] }
  }
}

// ── 자막 다듬기의 폴백 ──────────────────────────────────────────────────
//
// **3차는 "원문 그대로"다.** 받아쓴 글자를 고칠 규칙이 우리에게 없다 — 정본이 있는 음원은
// 애초에 정본을 쓰면 되고(routes/audio.js 의 default-text), 정본이 없는 것이 이 기능의 대상이다.
// 그래서 없는 규칙을 지어내는 대신 **아무것도 안 고치고, 안 고쳤다고 밝힌다.**
//
// 이 폴백의 값어치는 "더 잘 고치는 것"이 아니라 **"버튼이 막다른 길이 되지 않는 것"** 이다.
// 예전에는 키가 없거나 API 가 죽으면 400·502 로 끝나서, 사람이 편집기에서 할 수 있는 일이
// 없었다. 이제는 원문을 그대로 돌려주고 화면이 이유를 적는다.
//
// **줄 수는 어느 단계에서도 안 바뀐다.** 줄이 하나라도 어긋나면 자막 시각이 통째로 밀린다 —
// 조용히 밀린 자막이 이 기능에서 가장 나쁜 결과다. AI 가 줄 수를 바꿔 오면 그 결과를 버리고
// 3차로 간다(예전에는 502 로 끝냈다).

/** 다듬은 결과가 쓸 만한가. **줄 수가 다르면 쓸 수 없다** — 타이밍이 어긋난다. */
function 다듬기쓸만한가(고침, 원본) {
  return Array.isArray(고침) && 고침.length === 원본.length
}

/**
 * 자막 줄을 다듬는다. 2차(API) → 3차(원문 그대로).
 *
 * @returns {Promise<{lines: string[], via: 'api'|'template', reason?: string}>}
 *          **던지지 않는다.** 최악에도 원문이 그대로 돌아온다.
 */
async function polishWithFallback({ lines, callApi } = {}) {
  const 원본 = Array.isArray(lines) ? lines : []

  if (typeof callApi === 'function') {
    try {
      const 고침 = await callApi(원본)
      if (다듬기쓸만한가(고침, 원본)) {
        // 빈 줄로 돌아온 자리는 원문을 남긴다 — 자막에 빈칸이 뜨면 그 구간이 사라진 것처럼 보인다
        return { lines: 고침.map((l, i) => String(l ?? '').trim() || 원본[i]), via: 'api' }
      }
      const 몇줄 = Array.isArray(고침) ? 고침.length : '?'
      return { lines: 원본, via: 'template', reason: `AI 가 줄 수를 바꿨다(${원본.length}줄 → ${몇줄}줄)` }
    } catch (e) {
      return { lines: 원본, via: 'template', reason: `API 실패: ${e.message}` }
    }
  }
  return { lines: 원본, via: 'template', reason: 'API 경로 없음' }
}

module.exports = {
  generateAnnouncement, viaLabel, 쓸만한가,
  parseWithFallback, toDraftShape, 파싱쓸만한가, applyApiTime,
  polishWithFallback, 다듬기쓸만한가,
}
