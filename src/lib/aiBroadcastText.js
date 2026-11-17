// 「핵심 낱말 → 방송 문구」를 짓는 **한 벌**의 경로.
//
// 왜 뺐나(사용자 지적 2026-09-13: *"AI 방송문구 수정 어디갔어"*): 이 일은 쉬운 화면의
// `easy/TTSBroadcast.jsx` 안에만 있었다. 통합 홈(`/simple`)으로 옮겨 오면서 그 카드는
// 따라오지 않았고, **새 간편 화면에서는 AI 로 문구를 지을 길이 없어졌다.**
//
// 그렇다고 같은 절차를 새 화면에 다시 적으면 두 벌이 된다 — 이 저장소가 볼륨 이름 셋,
// `repeat_broadcast` 두 곳, 배포 게이트의 방송 시각으로 이미 세 번 다친 모양이다.
// 그래서 **절차만 여기로 내리고** 두 화면이 이것을 부른다. 화면은 결과를 그리기만 한다.
//
// 순서는 그대로다(바꾸지 않았다):
//   1차 — 이 브라우저 안의 모델. **진단으로 쓸 수 있다고 확인된 경우에만** 시도한다.
//          지침은 서버 것을 그대로 받아 쓴다 — 여기서 새로 지으면 로컬 문장과 서버 문장의
//          말투가 갈린다.
//   2·3차 — 서버가 판단한다(외부 AI → 정해진 틀). `via` 는 **서버가 지은 이름을 그대로** 쓴다.
//
// `via` 가 `'template'` 이면 **AI 가 아니라 정해진 틀**로 나온 문장이다. 화면은 그것을
// 눈에 띄게 알려야 한다 — 사람이 그걸 모르고 내보내면 어르신께 틀에 박힌 말이 나간다.
import { generateAI, getBroadcastPrompt } from './api'
import { generateLocal, localFirstEnabled } from './localModel'

/**
 * @param {string} 낱말        사람이 적은 핵심 내용("점심 12시 된장찌개")
 * @param {boolean} 로컬허용   설정에서 로컬 AI 를 켰는가(`local_ai_enabled`)
 * @returns {Promise<{ text: string, via: 'local'|'api'|'template'|string, reason: string }>}
 *          못 지으면 throw 한다 — 조용히 빈 문자열을 돌려주면 화면이 "AI 가 빈 문장을
 *          만들었다" 로 오독한다.
 */
export async function 방송문구짓기(낱말, 로컬허용 = false) {
  const 입력 = String(낱말 || '').trim()
  if (!입력) throw new Error('무엇을 방송할지 먼저 적어 주세요.')

  let reason = ''
  if (localFirstEnabled(로컬허용)) {
    const 지침 = await getBroadcastPrompt()
      .then(d => d?.prompt || d?.defaultPrompt || '')
      .catch(() => '')
    const r = await generateLocal(입력, 지침, { allowed: 로컬허용 })
    if (r.ok) return { text: r.text, via: 'local', reason: '' }
    reason = `로컬 실패: ${r.reason}`
  }

  const data = await generateAI(입력)
  // `provider`·`viaLabel` 도 그대로 넘긴다 — 쉬운 화면이 그 둘을 쓰고 있었다.
  // 여기서 걸러 내면 그 화면의 「· Gemini」 표시와 콘솔 기록이 조용히 죽는다.
  return {
    text: data.text,
    via: data.via || 'api',
    reason: data.reason || reason,
    provider: data.provider || '',
    viaLabel: data.viaLabel || '',
  }
}

/** 화면에 그대로 적는 한 줄. 틀로 만든 문장만 경고색이다(`강조: true`). */
export function 지은이문구(via, reason = '') {
  if (!via) return null
  if (via === 'template') {
    return { 강조: true, 글: 'AI 없이 정해진 틀로 만들었습니다 — 내용을 확인하고 고쳐 주세요.' }
  }
  const 누가 = via === 'local' ? '이 PC 안의 AI' : '외부 AI'
  return { 강조: false, 글: `${누가}가 만들었습니다.` + (reason ? ` (${reason})` : '') }
}
