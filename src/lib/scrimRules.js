// **「곧 나갈 자동방송이 있나」를 정하는 한 곳** (사용자 지시 2026-09-15).
//
// *"자동방송 1분전에는 켜놔 그라디언트로."*
//
// 자동 일과방송은 정시에 소리가 나기 시작한다. 그 순간 화면이 **탁** 어두워지면 놀란다.
// 1분 전부터 깔아 두면 *"곧 방송이 나가는구나"* 가 먼저 읽힌다.
//
// **판정 근거는 서버가 주는 오늘 일과다**(`/api/schedules/today`). 화면이 시각을 따로
// 계산하면 서버의 판정(완료·안 나감·대기)과 갈린다 — 이 저장소가 이미 겪은 실패다
// (`HomeToday` 머리말: *"화면이 따로 계산하면 watchdog 경보와 어긋나서 사람이 둘 다
// 안 믿게 된다"*).
//
// 부품 파일이 아니라 여기 두는 이유는 둘이다 — **노드에서 그대로 시험**할 수 있고,
// 리액트 부품 파일이 부품 아닌 것을 함께 내보내면 lint 가 막는다.
'use strict'

// 얼마나 앞서 켜나. **사용자 지시가 1분이다.**
export const 미리켜는초 = 60

/**
 * 「곧 나갈 자동방송」이 있나 — 순수 판정이라 시험이 그대로 돌린다.
 * @param {Array} 목록 `/api/schedules/today` 의 items
 * @param {Date} 지금
 */
export function 곧나가나(목록, 지금 = new Date()) {
  if (!Array.isArray(목록)) return false
  const 분 = 지금.getHours() * 60 + 지금.getMinutes()
  const 초 = 분 * 60 + 지금.getSeconds()
  for (const it of 목록) {
    // **아직 안 나간 것만 본다.** 이미 끝났거나 놓친 방송 앞에 바탕을 깔 이유가 없다.
    if (it?.status !== 'pending') continue
    const m = /^(\d{1,2}):(\d{2})/.exec(String(it.time || ''))
    if (!m) continue
    const 예정초 = (Number(m[1]) * 60 + Number(m[2])) * 60
    const 남은초 = 예정초 - 초
    if (남은초 > 0 && 남은초 <= 미리켜는초) return true
  }
  return false
}
