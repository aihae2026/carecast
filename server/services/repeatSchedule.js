// 반복시작일(repeat_start_date, YYYY-MM-DD) / 반복종료일(repeat_end_date, YYYY-MM-DD, null=무기한) /
// 반복요일(repeat_weekdays, JSON 배열, 0=일~6=토, 빈 배열=1회성)로 오늘 실행 대상인지 판정하는 순수 함수.
// scheduler.js에서 분리한 이유: scheduler.js는 require 시점에 switchbot 등
// 외부 I/O를 가진 모듈들을 함께 로드해서, 이 판정 로직만 테스트하려 해도
// 무거운 부작용을 끌고 들어온다. 의존성 없는 별도 파일로 둬서 테스트에서
// 안전하게 단독으로 require할 수 있게 한다.
// 로컬(KST) 기준 YYYY-MM-DD. toISOString()은 UTC라서 자정~오전9시(KST) 사이엔
// 하루 전 날짜가 나와 반복시작일/종료일 경계 판정이 어긋난다 — 아침 시간대 방송이 많은
// 이 프로젝트 특성상 date-range 판정에는 로컬 날짜를 써야 한다.
// 인자는 선택 — 넘기지 않으면 지금이다. 시계를 주입해야 테스트가 실제 시각을 안 기다린다
// (watchdog.js가 그렇게 쓴다). 기본값이라 기존 호출부는 그대로 동작한다.
function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// DB에서 온 JSON 문자열("[1,3,5]")과, API 요청 바디에서 이미 배열로 파싱되어
// 들어오는 값(req.body.repeat_weekdays) 둘 다 받는다.
function parseWeekdays(value) {
  if (!value) return []
  const arr = Array.isArray(value) ? value : (() => {
    try { return JSON.parse(value) } catch { return [] }
  })()
  return Array.isArray(arr) ? arr.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : []
}

// repeat_weekdays가 빈 배열(요일 미선택)이면 반복 없이 repeat_start_date 당일에만 실행되는 1회성 예약
function isOneTime(schedule) {
  return parseWeekdays(schedule.repeat_weekdays).length === 0
}

function shouldRunToday(schedule, at = new Date()) {
  const today = todayStr(at)

  if (isOneTime(schedule)) {
    return schedule.repeat_start_date === today
  }

  if (schedule.repeat_start_date && today < schedule.repeat_start_date) return false
  if (schedule.repeat_end_date && today > schedule.repeat_end_date) return false

  const dow = at.getDay() // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  return parseWeekdays(schedule.repeat_weekdays).includes(dow)
}

// repeat_weekdays 배열로부터 구(舊) repeat_type 문자열을 역산한다.
// 프론트엔드는 이제 전부 새 컬럼(runsOnDate/formatRepeatLabel) 기반이라 이 값을
// 화면 판정에 쓰는 곳은 없다 — DB를 직접 조회하는 외부 도구/스크립트를 위한
// 참고용 요약 컬럼으로만 남겨둔다. 알려진 패턴과 정확히 일치하지 않는 임의의
// 요일 조합은 안전한 폴백으로 '주간'을 쓴다.
function deriveLegacyRepeatType(weekdays) {
  const set = new Set(parseWeekdays(weekdays))
  const equalsSet = (arr) => arr.length === set.size && arr.every(d => set.has(d))

  if (set.size === 0) return '1회'
  if (equalsSet([0, 1, 2, 3, 4, 5, 6])) return '매일'
  if (equalsSet([1, 2, 3, 4, 5])) return '평일'
  if (equalsSet([0, 6])) return '주말'
  if (equalsSet([1, 3, 5])) return '월수금'
  if (equalsSet([2, 4])) return '화목'
  return '주간'
}

// todayStr을 함께 내보낸다 — 이 파일의 것이 이 저장소에서 유일하게 타임존이 맞는 구현이다.
// scheduler.js와 broadcastSequencer.js에는 toISOString() 기반(=UTC) todayStr이 따로 있어서,
// 09시(KST) 이전 방송의 날짜가 하루 어긋난다. 새 코드는 반드시 이걸 쓴다.
// 지금이 몇 시 몇 분인가 — "HH:MM". todayStr의 짝이라 같은 곳에 둔다.
//
// 같은 세 줄이 services 3곳 + routes 5곳에 흩어져 있었다(2026-08-31 TD-01 후속). 시각 판정
// 규칙(자정 경계·시간대)을 바꿀 일이 생기면 여덟 곳을 다 찾아야 했고, 실제로 UTC/KST가
// 어긋나 감시가 매일 거짓 경보를 내던 전례가 있다. 스케줄러의 발동 판정이 이 값으로
// 이뤄지므로 여기가 갈라지면 방송이 통째로 안 나간다.
//
// 인자를 받는 이유: 이력을 남기는 곳들이 이미 만들어 둔 Date로 date와 time을 함께 적는다.
// 같은 순간을 두 번 읽으면 자정 직전에 날짜와 시각이 서로 다른 날을 가리킬 수 있다.
function nowHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * **이력에 적는 시각. `nowHHMM` 과 쓰임이 다르다** (2026-09-13).
 *
 * 사용자 지시: *"방송은 시간이 생명인데, 초단위 표시해야하지 않을까?"* — 맞다.
 * 정시 방송이 07:50 에 나갔는지 07:50:47 에 나갔는지는 분 단위로는 영영 알 수 없다.
 *
 * **그런데 `nowHHMM` 을 고치면 안 된다.** 그 함수는 스케줄러가 *"지금이 그 시각인가"* 를
 * 판정할 때 문자열로 비교하는 데 쓰인다(`time <= nowHHMM`). 초가 붙으면
 * `"07:50" <= "07:50:31"` 이 참이 되어 **발동 조건이 조용히 달라진다** — 이 저장소에서
 * 가장 비싼 종류의 실패다. 그래서 **함수를 나눈다.**
 *
 * 쓰는 곳은 `broadcasts` 표에 한 줄 적는 자리 둘뿐이다. 그 값은 화면 표시와 CSV
 * 내보내기에만 쓰이고 **비교·정렬에는 안 쓰인다**(정렬은 `id DESC`, 확인함).
 * 옛 행은 `HH:MM` 그대로 남는다 — 되돌려 쓰지 않는다.
 */
function nowHHMMSS(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

module.exports = { shouldRunToday, isOneTime, parseWeekdays, deriveLegacyRepeatType, todayStr, nowHHMM, nowHHMMSS }
