// 전체 미리듣기에서 이 단계를 **무엇으로** 들려줄 것인가.
//
// 왜 화면 밖으로 뺐나(2026-08-31): 이 판정이 화면 안 if-else 사슬로만 있었고, 그 사슬이
// `canPreview(step, 'audio')`를 물어보고 있었다. 그런데 그 함수는 **kind가 'audio'면
// 단계가 무엇이든 무조건 true**를 돌려준다. 그래서 BGM 단계가 음원 분기로 빨려 들어갔고,
// 뒤에 있던 BGM 분기는 한 번도 도달하지 못하는 죽은 코드였다. 화면에는 "미리듣기가 안
// 됩니다"만 떴고, 눌러보기 전에는 알 방법이 없었다.
//
// **순서가 곧 규칙인 판정은 사슬로 두면 조용히 죽는다.** 그래서 순서째로 여기 고정한다.
//
// 표(ttsIds·audioCategory·sceneVideoIds)는 화면이 넘긴다 — bgmLane.js와 같은 계약이다.
// 기본 단계의 id 목록은 화면이 이미 들고 있고, 그것을 여기 또 적으면 두 벌이 된다.

// 확장자 필수 — 서버 테스트가 이 파일을 Node ESM 로더로 직접 부른다(CLAUDE.md)
import { isBgmStep } from './bgmPreview.js'

/**
 * @returns 'chime' | 'delay' | 'tts' | 'bgm' | 'audio' | 'none'
 *   none = 브라우저에서 들려줄 수 없다(소리 없는 배경 영상, 소리 없는 단계, 모르는 단계)
 */
export function previewKindOf(step, tables = {}) {
  if (!step) return 'none'
  const { ttsIds, audioCategory = {}, sceneVideoIds } = tables

  if (step.customType === 'chime') return 'chime'
  if (step.customType === 'delay') return 'delay'

  // **BGM을 음원보다 먼저 본다.** 반대로 두면 BGM이 음원 분기로 새고, 그 단계에서는
  // 음악이 영영 안 난다 — 이 파일이 생긴 이유가 그 사고다.
  if (isBgmStep(step)) return 'bgm'

  if (step.customType === 'tts' || step.customType === 'message') return 'tts'
  if (ttsIds?.has?.(step.id)) return 'tts'

  if (step.customType === 'audio' || step.customType === 'video_file') return 'audio'
  if (audioCategory[step.id]) return 'audio'

  // 방송 뒤 배경 영상은 소리 없이 띄운다(소리는 BGM) — 들려줄 것이 없다.
  if (sceneVideoIds?.has?.(step.id)) return 'none'

  // 소리를 내지 않는 단계와 모르는 단계. 시간을 지어내거나 엉뚱한 것을 틀지 않는다.
  return 'none'
}
