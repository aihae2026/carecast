// 제미나이 **모델 이름의 단일 출처**.
//
// 왜 생겼나(2026-09-06): 기본값이 일곱 곳에 박혀 있었고 **값이 둘로 갈려 있었다** —
// 실제 호출은 `gemini-3.5-flash`, 관리자 화면과 저장 기본값은 `gemini-3.6-flash`.
// 설정이 비어 있으면 **화면은 3.6 이라 하는데 소리는 3.5 로 나갔다.**
// 볼륨에서 겪은 "같은 값의 이름이 여럿인데 기본값이 제각각"과 같은 결함이다.
//
// **정본을 3.7-flash 로 올렸다(2026-09-06 실측).** 같은 문장·같은 키로 잰 값이다:
//
//   gemini-3.5-flash   8.7초 · 13.6초 · 19.3초      ← 예전 정본
//   gemini-3.6-flash   25.0초 (답도 잘려 나왔다)
//   gemini-3.7-flash   1.6초 · 3.2초 · 2.2초 · 3.6초 ← 지금 정본
//   gemini-3.8-flash   2.2초 · 2.4초 (한 번 503)
//
// 예전 정본 3.5-flash 는 2026-08-24 에 3.6 보다 빠르다는 이유로 골랐던 것인데, 그 뒤 구글이
// 3.7·3.8 을 냈고 판이 뒤집혔다. **모델 선택은 시간이 지나면 썩는다** — 그래서 관리자 화면에
// "쓸 수 있는 모델 목록 불러오기"를 뒀다(`routes/ai.js` 의 `GET /models`).
//
// **모델 이름을 코드에 다시 박지 않는다.** 구글이 모델을 갈아치우면 고칠 곳이 또 일곱 곳이 된다.
// 현장에서 바꿀 수 있는 자리는 관리자 화면(`settings.gemini_model`)이고, 여기 값은
// **그 설정이 비어 있을 때만** 쓰는 초기값이다 — 즉 **새 PC 가 처음 받는 값**이다.
'use strict'

const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash'

module.exports = { DEFAULT_GEMINI_MODEL }

// ── 자동으로 최신 Flash 를 따라간다 (2026-10-23 사용자 요청) ─────────────────
//
// *"현장은 2.5 에서 고정이 되어 있어서 난감했었어, 자동으로 따라 가게끔"*.
// 고정은 이렇게 생겼다: 설정 화면이 빈 칸에 기본 모델 이름을 채워 보여 주고, 「저장」을 누르면
// (키만 바꾸려 했어도) 그 이름이 `gemini_model` 에 박혔다. 그 뒤로 구글이 모델을 닫아도
// 저장값은 그대로였다 — `scripts/make-site-baseline.cjs` 가 기록한 현장 값 'gemini-2.5-flash'.
//
// 그래서 `gemini_model` 의 기본값을 **'auto'** 로 둔다. auto 면 하루 한 번 구글의 모델 목록에서
// 고른 「가장 최신 정식 Flash」(`gemini_model_auto`, services/geminiModelAuto.js 가 채운다)를 쓴다.
// 사람이 모델 이름을 직접 넣으면 그 값을 그대로 쓴다(자동을 끈 것).
//
// **속도로 거르지 않는다.** 짧은 시험 호출로는 3.6 의 25초(긴 문안+생각 토큰)를 재현하지 못해
// 문턱을 두면 거짓 안심만 준다. 느린 판은 20초 타임아웃 → 정해진 틀 폴백이 받고, 사람은 자동을 끄면 된다.
const AUTO = 'auto'

// 정식 Flash 만 — preview·exp·lite·숫자 접미(-001)·별칭(-latest)은 뺀다.
const 정식FLASH = /^gemini-(\d+)(?:\.(\d+))?-flash$/

/** 이름 목록에서 버전이 가장 높은 정식 Flash. 없으면 null. `4` 는 `4.0` 으로 본다. */
function pickLatestFlash(names) {
  let best = null
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || '').replace(/^models\//, '')
    const m = 정식FLASH.exec(name)
    if (!m) continue
    const v = [Number(m[1]), Number(m[2] || 0)]
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && v[1] > best.v[1])) best = { name, v }
  }
  return best ? best.name : null
}

/** 저장값이 「자동」인가 — 비었거나 'auto'. */
function isAutoModel(saved) {
  const s = String(saved ?? '').trim()
  return !s || s.toLowerCase() === AUTO
}

/**
 * 지금 부를 모델 이름(동기). auto 면 자동으로 고른 값 → 없으면 코드 기본값.
 * 모든 호출부가 이것만 쓴다 — `gemini_model` 을 직접 읽으면 'auto' 가 모델 이름으로 나간다.
 */
function currentGeminiModel(db) {
  const { rawSetting } = require('./settingsRead')
  const conn = db || require('../db/schema').getDB()
  const saved = rawSetting(conn, 'gemini_model')
  if (!isAutoModel(saved)) return String(saved).trim()
  return rawSetting(conn, 'gemini_model_auto') || DEFAULT_GEMINI_MODEL
}

module.exports.AUTO = AUTO
module.exports.pickLatestFlash = pickLatestFlash
module.exports.isAutoModel = isAutoModel
module.exports.currentGeminiModel = currentGeminiModel
