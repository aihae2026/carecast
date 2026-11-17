// 일과방송 5종을 화면에 뭐라고 부를지 — **서버가 정하고 화면은 받아 쓴다.**
//
// 그전에는 이름이 화면마다 따로 박혀 있었다(자동방송순서편집기 TABS · 주간표 AUTO_META ·
// 예약방송관리 AUTO_META · 쉬운화면). 그래서 **같은 방송이 화면마다 다른 이름으로**
// 불리고 있었다 — 자동방송순서편집기에서는 '식사전 체조'가 점심·저녁 둘 다였고,
// 주간표에서는 '식사전 체조(점심)'·'(저녁)'였다.
//
// 이름은 `GET /api/settings/broadcast-schedule`이 `name`으로 실어 준다(사람이 바꾼 값,
// 안 바꿨으면 기본 이름). 아래 기본값은 **화면이 아직 서버 응답을 못 받았을 때만** 쓴다 —
// 이름 자리가 잠깐 비면 사이드바가 흔들려 보인다.
// 서버 표(server/domain/autoBroadcasts.js)와 같은지는 auto-broadcast-names.test.js가 대조한다.

export const AUTO_DEFAULT_NAMES = {
  morning:        '아침 방송',
  exercise:       '국민체조',
  lunch:          '식사전 체조(점심)',
  dinner:         '식사전 체조(저녁)',
  evening_prayer: '저녁 마무리',
}

/**
 * @param {object|null} schedule  getBroadcastSchedule() 응답
 * @param {string} id             morning · exercise · lunch · dinner · evening_prayer
 */
export function autoName(schedule, id) {
  return String(schedule?.[id]?.name ?? '').trim() || AUTO_DEFAULT_NAMES[id] || id
}
