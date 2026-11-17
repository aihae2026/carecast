// 전체 미리듣기에서 BGM 단계를 무엇으로 들려줄 것인가.
//
// 2026-09-21: BGM 은 이 PC 의 방송용·식사용 폴더 곡이다(외부 동영상 연동을 걷어냈다). 미리듣기는
// 그 폴더에서 **한 곡을 받아 이 브라우저에서만** 튼다 — 서버가 SSE 를 쏘지 않으므로 현장 스피커는
// 조용하다(GET /api/audio/bgm/preview, 읽기만 하고 「차례로」 자리도 안 민다). 미리듣기의 안전 규칙이 그것이다.
//
// **미리듣기가 실제 방송과 같은 곡이라고 약속하지 않는다.** 서버는 방송할 때 그 용도의 차례(랜덤·차례로)로
// 다시 고른다. 화면은 그 사실을 사람에게 말한다 — "이 곡이 나갈 겁니다"라고 단정하면 거짓말이 된다.
//
// 어느 폴더인가는 **서버 실행부와 같은 규칙**이다(broadcastSteps.stepBGMStart):
//   단계의 bgmRole → 없으면 방송 종류(점심·저녁=식사용, 나머지=방송용 — domain/bgmRoles.js 기본역할).
// 커스텀 BGM 단계는 재생목록 첫 곡의 bgm_type 을 본다(실행부도 첫 곡부터 튼다).
import { bgmSourceOf, sourceOfStep } from './bgmTypes.js'

// 자동방송 5종에 박혀 있는 BGM 단계 id들(broadcastSequencer.js의 DEFAULT_STEPS).
// 하나라도 빠뜨리면 그 단계에서만 음악이 안 깔리고, 미리듣기는 조용히 넘어간다.
const BGM_STEP_IDS = new Set(['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final'])

export function isBgmStep(step) {
  if (!step) return false
  return step.customType === 'bgm' || BGM_STEP_IDS.has(step.id)
}

// server/domain/bgmRoles.js 의 기본역할과 같은 규칙.
const 기본역할 = (tab) => (tab === 'lunch' || tab === 'dinner' ? 'meal' : 'broadcast')

/**
 * @param {object} step
 * @param {string} [tab] 자동방송 종류(morning·exercise·lunch·dinner·evening_prayer)
 * @returns {null} BGM 단계가 아님
 * @returns {{kind:'local', role:'broadcast'|'meal', folderId?: number, fileId?: number}} 이 폴더(사람이 만든 폴더면 folderId)에서 한 곡, 곡 하나면(fileId) 그 곡
 */
export function bgmPreviewPlan(step, tab) {
  if (!isBgmStep(step)) return null
  if (step.customType === 'bgm') {
    const first = (Array.isArray(step.playlist) && step.playlist.length) ? step.playlist[0] : step
    const 갈래 = bgmSourceOf(first?.bgm_type)
    const 번호 = /^local_f(\d+)$/.exec(갈래)
    if (번호) return { kind: 'local', role: 'broadcast', folderId: Number(번호[1]) }
    const 곡 = /^local_a(\d+)$/.exec(갈래)
    if (곡) return { kind: 'local', role: 'broadcast', fileId: Number(곡[1]) }
    return { kind: 'local', role: 갈래 === 'local_meal' ? 'meal' : 'broadcast' }
  }
  // 사람이 만든 폴더를 고른 단계(2026-09-22)는 그 폴더에서 — 미리듣기는 대신 틀지 않는다(서버 /bgm/preview).
  const 번호 = /^local_f(\d+)$/.exec(sourceOfStep(step) || '')
  if (번호) return { kind: 'local', role: 기본역할(tab), folderId: Number(번호[1]) }
  const 곡 = /^local_a(\d+)$/.exec(sourceOfStep(step) || '')
  if (곡) return { kind: 'local', role: 기본역할(tab), fileId: Number(곡[1]) }
  return { kind: 'local', role: step.bgmRole || 기본역할(tab) }
}
