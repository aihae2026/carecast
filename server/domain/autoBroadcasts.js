// 하루 일과 자동방송 정의 — 이름·시각 설정키·on/off 설정키를 한 곳에 모은다.
//
// 왜 필요했나: 자연어 예약이 일과방송과 같은 시각에 잡히면 두 방송이 겹쳐 소리가 섞인다.
// 그걸 경고하려면 "지금 켜져 있는 일과방송이 몇 시인가"를 알아야 하는데, 그 정보는
// scheduler.js의 매분 루프 안에 흩어져 있었다(설정키가 코드 중간중간에 문자열로 박혀 있음).
//
// **이 파일이 일과방송 5종의 단일 정의다 — 발동부(scheduler.js)도 이 표를 본다.**
// 2026-09-01(TD-02)까지는 "정의만 갖고 실행은 scheduler.js가 자기 방식으로" 였는데,
// 그러다 보니 같은 설정키·기본 시각이 발동부에 문자열로 또 적혀 있었고 둘이 갈라지면
// **화면이 보여주는 시각과 실제로 나가는 시각이 달라졌다.** 사용자 판단으로 합쳤다.
//
// 표에 줄을 더하면 scheduler.js의 AUTO_FIRE에 발사 함수를 짝지어야 한다 —
// 안 지으면 서버가 뜰 때 바로 걸린다(scheduler.js의 시작 검사).
// 발동 규칙이 실제로 지켜지는지는 server/test/auto-broadcast-tick.test.js가
// tick을 돌려 대조한다(소스 대조가 아니라 실행이다).
'use strict'

// ── defaultTime 은 "정본"이 아니다 (2026-09-06) ────────────────────────────
//
// **실제 방송 시각의 정본은 `settings` 표다.** 여기 defaultTime 은 그 설정이 **비어 있을 때만**
// 쓰는 초기값이고, 현장 값과 **일부러 다르게 둔다.**
//
// 왜 맞추지 않나: settings 가 지워지는 사고가 났을 때 현장과 같은 시각으로 나가면
// **정상처럼 보이는 오작동**이 된다. 08:40·11:15·16:15 로 나가면 사람이 바로 알아챈다.
// 무인 운영에서 가장 나쁜 것은 조용한 실패다.
//
// 이 값을 "정본"으로 읽고 다른 곳에 옮겨 적은 것이 2026-09-06 사고의 출발점이었다 —
// 배포 게이트가 이 값을 복사해 두는 바람에 현장의 세 방송(09:00·11:10·16:14) 직전이
// 금지 구간으로 안 잡혔다. 지금 게이트는 site-baseline.json 을 읽는다.
// 사본이 현장과 어긋나는지는 `npm run verify:times` 가 본다.
// ─────────────────────────────────────────────────────────────────────
//
// 순서는 하루 흐름대로. defaultTime은 scheduler.js가 설정값이 없을 때 쓰는 값과 같아야 한다.
// firedKey는 scheduler.js가 "오늘 이미 나갔다"를 표시하는 settings 키다 — 누락 감시(watchdog.js)가
// 이 키를 보고 판정하므로, 어긋나면 감시가 조용히 쓸모없어진다(watchdog.test.js가 소스와 대조한다).
// startedKey는 시퀀스가 **시작할 때** 찍는다(broadcastSequencer). firedKey만으로는 "나가는 중"과
// "안 나갔다"가 구별되지 않아 5분을 넘기는 방송(저녁 마무리 5.6분, 아침 투약안내 대기만 6분)이
// 매일 누락으로 찍혔다(2026-09-01).
const AUTO_BROADCASTS = [
  { id: 'morning',        label: '아침 종합 방송', timeKey: 'morning_time',            enabledKey: 'morning_enabled',            defaultTime: '07:50', firedKey: 'morning_last_fired', startedKey: 'morning_last_started', runLabel: '아침', errorLabel: '아침방송 오류', displayName: '아침 방송', nameKey: 'morning_display_name' },
  { id: 'exercise',       label: '국민체조',       timeKey: 'exercise_broadcast_time', enabledKey: 'exercise_broadcast_enabled', defaultTime: '08:40', firedKey: 'exercise_last_fired', startedKey: 'exercise_last_started', runLabel: '체조', errorLabel: '국민체조 오류', displayName: '국민체조', nameKey: 'exercise_display_name' },
  { id: 'lunch',          label: '점심 식사 전 방송', timeKey: 'lunch_broadcast_time',  enabledKey: 'lunch_broadcast_enabled',    defaultTime: '11:15', firedKey: 'lunch_last_fired', startedKey: 'lunch_last_started', runLabel: '점심', errorLabel: '점심방송 오류', displayName: '식사전 체조(점심)', nameKey: 'lunch_display_name' },
  { id: 'dinner',         label: '저녁 식사 전 방송', timeKey: 'dinner_broadcast_time', enabledKey: 'dinner_broadcast_enabled',   defaultTime: '16:15', firedKey: 'dinner_last_fired', startedKey: 'dinner_last_started', runLabel: '저녁', errorLabel: '저녁방송 오류', displayName: '식사전 체조(저녁)', nameKey: 'dinner_display_name' },
  { id: 'evening_prayer', label: '저녁 마무리',    timeKey: 'evening_prayer_time',     enabledKey: 'evening_prayer_enabled',     defaultTime: '18:00', firedKey: 'evening_prayer_last_fired', startedKey: 'evening_prayer_last_started', runLabel: '저녁 마무리', errorLabel: '저녁 마무리 오류', displayName: '저녁 마무리', nameKey: 'evening_prayer_display_name' },
]

const { rawSettings } = require('./settingsRead')

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * **저장해도 되는 시각인가** (P-36 + 자동종료, 2026-09-11).
 *
 * 읽는 규칙(`autoTime`)과 **쓰는 규칙이 같은 자리에 있어야 한다.** 예전엔 읽기만 여기 있고
 * 저장하는 라우트는 아무 검사도 안 했다 — 형식이 깨진 값이 들어가면
 *   · 발동부(`scheduler.js`)는 문자열 정확일치라 영원히 안 맞고,
 *   · 감시(`watchdog.js`)도 그 값을 못 읽어 그냥 지나간다.
 * **둘 다 침묵한다.** 사람에게는 "저장했는데 왜 안 나가지"만 남는다.
 * 같은 실패를 예약(`routes/schedules.js`)은 이미 400 으로 막고 있었다 — 비대칭이었다.
 *
 * **빈 문자열은 유효하다.** 이 저장소에서 빈 시각은 "이 방송을 쓰지 않는다"는 뜻으로
 * 확정돼 있다(위 `autoTime` 머리말, AP-0012). 예약 쪽 규칙을 그대로 가져오면 끄기가 막힌다.
 *
 * **다듬지 않는다.** `' 09:00'` 을 `'09:00'` 으로 고쳐 받으면 저장은 되는데 발동부는
 * 다른 값을 보게 된다 — 고치려던 것과 같은 종류의 어긋남이다.
 *
 * @param {*} v 화면이 보낸 날것 그대로의 값
 * @returns {boolean} 저장해도 되면 true
 */
function 유효시각(v) {
  if (v === '' || v === null || v === undefined) return true   // 끄기 — 유효한 뜻이다
  return typeof v === 'string' && HHMM.test(v)
}

/**
 * 자동방송 시각을 읽는 **단일 규칙** (P-35, 사용자 결정 2026-09-08 · AP-0012).
 *
 * 이 표가 "시각의 단일 출처"를 자처하면서 **읽는 방법**은 각 호출부에 맡겨 뒀던 것이 문제였다.
 * 발동부는 `?? defaultTime`, 감시·화면은 `|| defaultTime` 을 써서 **빈 값의 뜻이 정반대**였다.
 * 그래서 사람이 끄려고 시각을 비운 방송이 **안 나가면서 매일 누락으로 찍혔다**(EV-001351·EV-001357).
 *
 * 확정된 뜻은 이렇다:
 *   - 키 자체가 없다(설정을 만든 적 없음) → 정의표의 `defaultTime`
 *   - **빈 값으로 저장했다 → 사람이 껐다. 발동하지 않는다**
 *   - 형식이 깨졌다 → 발동하지 않는다(기본값으로 대신 채우지 않는다)
 *
 * 빈 값을 기본시각으로 되살리면 **관리자가 지운 시각에 방송이 나간다.** 요양시설에서는
 * "안 나감"보다 "안 나가야 할 것이 나감"이 되돌리기 어렵다 — 그래서 이 방향으로 정했다.
 *
 * @param   {string|null|undefined} raw   settings 에서 읽은 날것 그대로의 값
 * @param   {{defaultTime:string}}  spec  AUTO_BROADCASTS 의 한 줄
 * @returns {string|null}  쓸 수 있는 HH:MM, 또는 **발동하지 않아야 하면 null**
 */
function autoTime(raw, spec) {
  const t = String(raw ?? spec.defaultTime)  // 키가 아예 없을 때만 기본값이 나선다
  // **다듬지 않고 그대로 본다.** 발동부(scheduler.js)는 저장된 값을 문자열 정확일치로
  // 비교하므로, 여기서 `' 09:00'` 을 `'09:00'` 으로 고쳐 주면 **발동부는 안 내보내는데
  // 감시는 유효로 읽는** 새 어긋남이 생긴다 — 고치려던 것과 같은 종류의 결함이다
  // (2026-09-08 독립 검수 지적). 공백이 섞인 값은 형식 검사에서 그냥 탈락한다.
  return HHMM.test(t) ? t : null
}

/**
 * 지금 **켜져 있는** 일과방송의 시각 목록.
 * scheduler.js가 `enabled === 'true'`로 엄격 비교하므로 여기서도 같은 규칙을 쓴다 —
 * 느슨하게 보면 꺼져 있는 방송까지 겹침 경고가 떠서 잔소리가 된다.
 *
 * @returns {Array<{id, label, time}>}
 */
function readEnabledAutoTimes(db) {
  // 5종 × (켜짐·시각) = 10번 묻던 것을 한 번에. 판정 규칙은 그대로다.
  const got = rawSettings(db, AUTO_BROADCASTS.flatMap(s => [s.enabledKey, s.timeKey]))
  const out = []
  for (const spec of AUTO_BROADCASTS) {
    if (got.get(spec.enabledKey) !== 'true') continue
    const time = autoTime(got.get(spec.timeKey), spec)
    if (time) out.push({ id: spec.id, label: spec.label, time })
  }
  return out
}

/**
 * 화면에 보여줄 **방송 이름** 5종. 사람이 바꿀 수 있고, 안 바꿨으면 기본 이름을 준다.
 *
 * 이 이름은 **표시 전용**이다. 방송 이력에 남는 문구("아침 방송")는
 * broadcastSequencer의 LANES가 정하는 고정 문구이고, 이름을 바꿨다고 지난 이력의 뜻이
 * 달라지면 안 되기 때문에 따라가지 않는다(auto-broadcast-names.test.js가 그 경계를 고정).
 *
 * 빈 값·공백만 있는 값은 기본 이름으로 되돌린다 — 이름 없는 방송이 목록에 생기면
 * 사이드바에서 고를 수가 없다.
 *
 * @returns {Object<string, string>} { morning: '아침 방송', ... }
 */
function readAutoNames(db) {
  const got = rawSettings(db, AUTO_BROADCASTS.map(s => s.nameKey))
  const out = {}
  for (const spec of AUTO_BROADCASTS) {
    out[spec.id] = String(got.get(spec.nameKey) ?? '').trim() || spec.displayName
  }
  return out
}

module.exports = { AUTO_BROADCASTS, autoTime, 유효시각, readEnabledAutoTimes, readAutoNames }
