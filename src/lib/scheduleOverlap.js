// 자동방송 다섯 개가 서로 겹치는지 — 순서편집기 예상시간 줄의 "⚠ …" 경고.
//
// 왜 화면 밖으로 뺐나(2026-08-31): 판정이 JSX 안 IIFE에 있어 테스트가 하나도 없었고,
// 그 상태로 두 구멍을 안고 있었다.
//   · 끝시각과 다음 시작 시각이 **같은 분**이면 안 떴다. estimateEndTime은 초를 올림하므로
//     "11:15 종료 / 11:15 시작"은 드문 경계가 아니다. 그 분에는 아직 방송이 나가고 있다.
//   · 자정을 넘기는 방송은 **뒤에 시작하는 방송이 없어서** 후보 자체가 안 잡혔다. 경고가
//     가장 필요한 경우에 절대 안 뜬 셈이다.
//
// 서버에도 예약끼리의 겹침 판정(schedulePhrase.findAutoOverlaps)이 따로 있다. 그쪽은
// 예약 행 사이의 ±윈도우를 보고, 이쪽은 자동방송의 **예상 소요시간**을 본다 — 재료가 달라서
// 합치지 않았다. 규칙을 바꿀 일이 있으면 두 곳을 같이 본다.

/**
 * @param {string} activeTab            지금 보고 있는 방송(morning|exercise|lunch|dinner|evening_prayer)
 * @param {object} estimate             라우트 응답 { [tab]: { startTime, end: { time, dayOffset } } }
 * @param {object} settings             { [tab]: { enabled } } — 꺼 둔 방송은 후보가 아니다
 * @returns {null | { tab, startTime, sameStart, crossesMidnight }}
 */
export function findScheduleOverlap(activeTab, estimate, settings = {}) {
  const est = estimate?.[activeTab]
  if (!est?.end) return null

  // 자정을 넘기는 것은 그 자체로 경고다 — 뒤에 오는 방송을 찾을 필요가 없다.
  const crossesMidnight = est.end.dayOffset > 0

  const later = Object.entries(estimate)
    .filter(([k, v]) => k !== activeTab && v?.startTime >= est.startTime && settings[k]?.enabled !== false)
    .sort((a, b) => a[1].startTime.localeCompare(b[1].startTime))[0]

  if (!later) {
    return crossesMidnight ? { tab: null, startTime: null, sameStart: false, crossesMidnight } : null
  }

  const sameStart = later[1].startTime === est.startTime
  // **같은 분도 겹침이다.** 초를 올림해 적은 종료 시각이라, 그 분에는 아직 소리가 나고 있다.
  const overruns  = est.end.time >= later[1].startTime

  if (!crossesMidnight && !sameStart && !overruns) return null
  return { tab: later[0], startTime: later[1].startTime, sameStart, crossesMidnight }
}
