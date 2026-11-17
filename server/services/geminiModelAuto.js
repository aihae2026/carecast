// 제미나이 모델 **자동 선택** — 구글 목록에서 가장 최신 정식 Flash 를 골라 `gemini_model_auto` 에 둔다.
//
// 왜 있나(2026-10-23): 저장된 모델 이름은 영원히 고정이라, 구글이 그 모델을 닫으면 AI 가 조용히
// 404 로 죽었다(현장 'gemini-2.5-flash'). 규칙과 「속도로 거르지 않는다」는 결정은
// domain/geminiModel.js 머리말에 있다.
//
// 하는 일 셋:
//   ① 하루 한 번(부팅 몇 분 뒤 첫 회) 목록을 받아 고른다 — 채택 전 짧은 시험 호출이 통과해야 바꾼다
//   ② 모델이 없어졌다는 404 신고를 받으면 10분에 한 번까지 다시 고른다(geminiClient 의 이음새)
//   ③ 사람이 직접 넣은 모델이 없어졌으면 **경보만** 낸다 — 몰래 다른 모델로 바꾸지 않는다(하루 1회)
//
// geminiClient.js 에 넣지 않은 이유: 그쪽은 요청 가드 전용이다. 여기는 DB·타이머를 쓰고
// 시험 호출로 그 래퍼를 다시 부른다 — 한 파일에 두면 순환이 된다.
'use strict'

const { rawSetting } = require('../domain/settingsRead')
const { pickLatestFlash, isAutoModel } = require('../domain/geminiModel')

const LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const DAY_MS = 24 * 60 * 60 * 1000
const FIRST_DELAY_MS = 5 * 60 * 1000       // 부팅 직후 첫 방송·예열과 네트워크를 다투지 않게
const MISSING_COOLDOWN_MS = 10 * 60 * 1000

const put = (db, k, v) => db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(k, String(v))

const MAX_PAGES = 10

/**
 * 이 키로 문구를 만들 수 있는 모델 이름 목록. 실패면 `{ models: [], reason }`.
 * **끝 쪽까지 받는다**(2026-10-23 검수 High). 구글 목록은 기본 50개씩 쪽으로 나뉜다 — 첫 쪽만 보면
 * 최신 Flash 가 2쪽에 있을 때 못 따라가고 옛 모델로 내려간다. 관리자 화면 「목록 불러오기」도 이것을 쓴다.
 */
async function listGenerateModels(apiKey) {
  const { fetchGeminiWithRetry } = require('./geminiClient')
  const 모음 = []
  let pageToken = ''
  for (let 쪽 = 0; 쪽 < MAX_PAGES; 쪽++) {
    const url = `${LIST_URL}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const r = await fetchGeminiWithRetry(url,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } }, { timeoutMs: 15000 })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      // 중간 쪽에서 실패하면 **반쪽 목록으로 고르지 않는다** — 그것이 이 함수가 막으려는 실패다
      return { models: [], reason: e.error?.message || `목록을 못 받았습니다 (${r.status})` }
    }
    const data = await r.json()
    모음.push(...(data.models || []))
    pageToken = data.nextPageToken || ''
    if (!pageToken) break
  }
  const models = 모음
    // 문구를 만들 수 있는 모델만 — 임베딩 전용을 고르면 그 시각에 조용히 실패한다
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort()
  return { models }
}

/** 채택 전 시험 호출 — 'hi' 한 번. 통과하면 걸린 ms, 아니면 null. */
async function probeModel(apiKey, model) {
  const { fetchGeminiWithRetry } = require('./geminiClient')
  const t0 = Date.now()
  const r = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 5 } }),
    })
  return r.ok ? Date.now() - t0 : null
}

/**
 * 한 번 고른다. 결과를 문장으로 돌려준다(로그용). 던지지 않는다 — 실패해도 캐시는 그대로 둔다.
 * 주입 이음새(listFn·probeFn·now)는 시험용이다.
 */
async function refreshAutoModel({
  db = require('../db/schema').getDB(),
  listFn = listGenerateModels, probeFn = probeModel, now = Date.now,
  models: 받은목록 = null,
} = {}) {
  try {
    // 사람이 모델을 직접 골랐으면 고르지 않는다 — 안 쓰는 모델을 시험 호출해 돈을 쓰고, 그 호출이
    // 404 면 쓰지도 않는 모델 이름으로 경보가 났다(2026-10-23 검수 Low). 자동을 켜는 순간 다시 고른다.
    if (!isAutoModel(rawSetting(db, 'gemini_model'))) return '모델을 직접 골라 둠 — 건너뜀'
    if (require('./networkMode').networkDisabled()) return '네트워크 차단 모드 — 건너뜀'
    const apiKey = rawSetting(db, 'gemini_api_key')
    if (!apiKey) return 'API 키 없음 — 건너뜀'
    const { models, reason } = 받은목록 ? { models: 받은목록 } : await listFn(apiKey)
    const 후보 = pickLatestFlash(models)
    if (!후보) return `고를 모델이 없음(${reason || '정식 Flash 없음'}) — 지금 값 유지`
    const 지금 = rawSetting(db, 'gemini_model_auto')
    // **내려가지 않는다.** 지금 쓰는 모델이 목록에 그대로 있는데 후보가 더 낮으면 목록이 덜 온 것이다.
    // 지금 모델이 목록에서 사라졌을 때만(구글이 닫음) 낮은 판으로도 옮긴다.
    if (지금 && 후보 !== 지금 && models.includes(지금) && pickLatestFlash([지금, 후보]) === 지금) {
      put(db, 'gemini_model_auto_at', new Date(now()).toISOString())
      return `그대로 ${지금}(목록의 최고 ${후보} 가 더 낮음)`
    }
    if (후보 !== 지금) {
      const ms = await probeFn(apiKey, 후보)
      if (ms == null) return `${후보} 시험 호출 실패 — ${지금 || '기본값'} 유지`
      put(db, 'gemini_model_auto_probe_ms', ms)
      put(db, 'gemini_model_auto', 후보)
    }
    put(db, 'gemini_model_auto_at', new Date(now()).toISOString())
    return 후보 === 지금 ? `그대로 ${후보}` : `${지금 || '(없음)'} → ${후보}`
  } catch (e) {
    return `실패(${e.message}) — 지금 값 유지`
  }
}

// ── 404 신고 (geminiClient 의 이음새로 들어온다) ─────────────────────────
let 마지막갱신 = 0
const 경보한날 = new Map()   // 모델 → 'YYYY-MM-DD'

function onModelMissing(model, { db = require('../db/schema').getDB(), now = Date.now,
  raise = (k, m) => require('./alert').raise(k, m), refresh = refreshAutoModel } = {}) {
  const saved = rawSetting(db, 'gemini_model')
  if (isAutoModel(saved)) {
    // 자동인데 고른 모델이 없어졌다 — 다시 고른다. 이번 요청은 이미 폴백이 받았다.
    if (now() - 마지막갱신 < MISSING_COOLDOWN_MS) return
    마지막갱신 = now()
    Promise.resolve(refresh({ db, now }))
      .then(r => console.log(`[Gemini 모델] ${model} 이(가) 없어져 다시 골랐습니다: ${r}`))
      .catch(() => {})
    return
  }
  // 사람이 넣은 모델 — 바꾸지 않고 알린다. 같은 모델은 하루 한 번.
  const 오늘 = new Date(now()).toISOString().slice(0, 10)
  if (경보한날.get(model) === 오늘) return
  경보한날.set(model, 오늘)
  raise('AI', `설정한 Gemini 모델(${model})을 구글이 더 이상 제공하지 않습니다. 관리자 → API 설정에서 「자동으로 최신 모델 쓰기」를 켜 주세요. 그동안 AI 문구는 정해진 틀로 대신 만듭니다.`)
}

let 시작함 = false
function startAutoModelSchedule() {
  if (시작함) return
  시작함 = true
  const 한번 = () => refreshAutoModel()
    .then(r => console.log(`[Gemini 모델] 자동 선택: ${r}`))
    .catch(() => {})
  setTimeout(한번, FIRST_DELAY_MS).unref?.()
  setInterval(한번, DAY_MS).unref?.()
}

function _resetForTest() { 마지막갱신 = 0; 경보한날.clear() }

module.exports = {
  listGenerateModels, probeModel, refreshAutoModel, onModelMissing, startAutoModelSchedule, _resetForTest,
}
