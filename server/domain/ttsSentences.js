'use strict'
// 문장 사이 쉼 (사용자 지시 2026-09-22 「문장사이 쉼, 넣어줘」).
//
// 엔진의 `silenceScale` 은 Supertonic 3 에서 **효과가 없었다** — 0·0.2·0.5·1·2·3 을 줘도 같은 문장이
// 모두 7.41초로 나왔다(실측). 그래서 문장을 나눠 따로 만들고 사이에 무음을 넣는다.
// 합성(supertonicWorker)과 자막(tts.js)이 **같은 규칙으로** 나눠야 자막이 문장마다 맞는다 — 규칙은 여기 하나.

const 쉼범위 = { 최소: 0, 최대: 2000 }   // 밀리초. 0 = 쓰지 않음(예전과 같은 소리·같은 캐시 열쇠)

/**
 * 문장 끝(. ! ? 。 …) 뒤의 빈칸(줄바꿈 포함)에서 나눈다. 빈 조각은 버린다.
 * **캐시 열쇠와 같은 정규화(ttsSynthesis.normalizeText) 뒤에 나눈다**(Codex 2026-09-22 Medium) — 열쇠는 줄바꿈을
 * 빈칸으로 합치므로 「A\nB」와 「A B」가 같은 열쇠다. 줄바꿈만으로 나누면 같은 열쇠에 쉼 자리가 다른 소리가 섞인다.
 */
function 문장나누기(text) {
  const 정규 = require('./ttsSynthesis').normalizeText(text)
  return 정규.split(/(?<=[.!?。…])\s+/).map((s) => s.trim()).filter(Boolean)
}

/** 저장값·요청값 → 0~2000 정수(ms). 못 읽으면 0(쓰지 않음). 합성·열쇠가 쓴다. */
function 쉼정리(v) {
  const n = Number(v)
  if (v === null || v === '' || typeof v === 'boolean' || !Number.isFinite(n)) return 0
  return Math.min(쉼범위.최대, Math.max(쉼범위.최소, Math.round(n)))
}

/** 설정 저장·미리듣기 요청 — 엄격하게. 0~2000 정수(또는 그 숫자만 든 글자)만, 아니면 null. */
function 쉼읽기엄격(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 쉼범위.최소 && v <= 쉼범위.최대 ? v : null
  if (typeof v === 'string' && /^\d{1,4}$/.test(v.trim())) return 쉼읽기엄격(Number(v.trim()))
  return null
}

module.exports = { 문장나누기, 쉼정리, 쉼읽기엄격, 쉼범위 }
