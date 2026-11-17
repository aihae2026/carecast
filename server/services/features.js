// 대시보드 "기능 활성화" 토글 조회 헬퍼.
//
// 실제 방송 동작을 좌우하는 일부 토글(자동 아침 방송/특보/날씨/미세먼지)은 각 기능의
// 고유 설정 키를 쓰고, routes/settings.js가 그쪽으로 읽고 쓴다. 여기서 다루는 건
// 그 외의 "수동 조작 차단" 스위치(tts/ai/mic)로, settings.feature_toggles에 저장된다.
//
// 기본값은 켜짐(true) — 설정이 없거나 깨져 있을 때 기능이 조용히 막히면
// 현장에서 원인을 찾기 어려우므로, 막는 쪽이 아니라 열어두는 쪽으로 실패한다.
const { rawSetting } = require('../domain/settingsRead')
const { getDB } = require('../db/schema')

const DEFAULTS = { tts: true, ai: true, mic: true }

function isFeatureEnabled(key) {
  try {
    const raw = rawSetting(getDB(), 'feature_toggles')
    if (!raw) return DEFAULTS[key] ?? true
    const saved = JSON.parse(raw)
    if (typeof saved[key] !== 'boolean') return DEFAULTS[key] ?? true
    return saved[key]
  } catch {
    return DEFAULTS[key] ?? true
  }
}

// 라우트에서 쓰는 가드 — 꺼져 있으면 403과 사람이 읽을 수 있는 사유를 응답하고 true를 반환
function blockIfDisabled(res, key, label) {
  if (isFeatureEnabled(key)) return false
  res.status(403).json({
    error: `${label} 기능이 꺼져 있습니다. 관리자 화면 대시보드의 "기능 활성화"에서 켜주세요.`,
    disabledFeature: key,
  })
  return true
}

module.exports = { isFeatureEnabled, blockIfDisabled }
