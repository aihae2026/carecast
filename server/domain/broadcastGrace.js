// 준비가 안 된 방송을 **얼마나 기다려 줄 것인가** — 유예 상한.
//
// 왜 필요한가(2026-09-06): 3단계에서 트리거 경로의 합성을 걷어내면서, 캐시가 없을 때
// "즉시 렌더하고 완료되는 대로 재생"하는 길을 남겼다. 그 길에 상한이 없으면 방송이
// 언제 나갈지 모른다 — 점심 안내가 12:40에 나가는 것은 안 나가느니만 못하다.
//
// 반대로 상한이 너무 짧으면 **누락**이 된다. 요양원 일과방송은 어르신 생활리듬 신호라
// **누락이 지연보다 훨씬 큰 문제**다(사용자 결정). 그래서 기본값을 넉넉히 잡는다.
//
// ── 우선순위 (위에서 아래로, **첫 일치에서 확정**) ──────────────────────
//   1. 긴급·안내          유예 없음 — 성공할 때까지 재시도
//   2. {{시각}} 토큰 포함  30초 — 시각 자체가 내용이면 늦은 안내는 틀린 안내다
//   3. 그 외              5분
//
// 2번을 낱말이 아니라 **토큰**으로 가르는 이유: "지금 시각을 확인해 주세요" 같은 문장이
// 30초 유예로 떨어지면 안 된다. 판정은 결정론적이어야 하고, 그 사전은 contentTokens 하나다.
'use strict'

const { hasTimeToken } = require('./contentTokens')

const 기본값 = {
  emergencyMs: null,      // null = 상한 없음(성공까지 재시도)
  timeTokenMs: 30 * 1000,
  defaultMs: 5 * 60 * 1000,
}

// 설정으로 조정할 수 있게 한다 — 현장에서 "5분은 너무 길다"가 나올 수 있다.
const 설정키 = {
  timeTokenMs: 'grace_time_token_sec',
  defaultMs:   'grace_default_sec',
}

function 초설정(getSettingFn, key, 기본ms) {
  if (typeof getSettingFn !== 'function') return 기본ms
  const raw = Number(getSettingFn(key, ''))
  if (!Number.isFinite(raw) || raw <= 0) return 기본ms
  return raw * 1000
}

/**
 * 이 방송을 얼마나 기다려 줄 것인가.
 *
 * @param {{urgency?: string, content?: string}} 방송
 * @param {(key: string, def: string) => string} [getSettingFn]
 * @returns {{ms: number|null, reason: string}}  ms === null 이면 상한 없음
 */
function resolveGrace({ urgency, content } = {}, getSettingFn) {
  // 1) 긴급 — 유예 없이 성공할 때까지. **사람이 명시적으로 지정한 것만** 여기 온다.
  if (urgency === 'emergency') {
    return { ms: 기본값.emergencyMs, reason: '긴급·안내 — 성공까지 재시도' }
  }
  // 2) 시각이 내용인 방송
  if (hasTimeToken(content)) {
    return { ms: 초설정(getSettingFn, 설정키.timeTokenMs, 기본값.timeTokenMs), reason: '{{시각}} 토큰 포함' }
  }
  // 3) 그 외
  return { ms: 초설정(getSettingFn, 설정키.defaultMs, 기본값.defaultMs), reason: '일과방송 기본' }
}

module.exports = { resolveGrace, 기본값, 설정키 }
