// "오늘 나갈 방송"을 한 목록으로 — 예정 / 완료 / 누락 3상태.
//
// 왜 필요했나(2026-08-29 리뷰 CC-026): 화면이 `getSchedules()`만 읽어서 **일과방송 5종이
// 아예 안 보였다.** 그것들은 `schedules` 테이블이 아니라 `settings`의 시각·활성 키로 도니까.
// 게다가 이력 화면에는 "예정" 상태가 없어서, 안 나간 방송은 화면에서 그냥 사라진다 —
// 발동 자체가 없으면 `broadcasts`에 행조차 안 생기기 때문에 "없었던 것"과 구별되지 않는다.
//
// 판정 기준은 watchdog.js와 **같아야 한다.** 화면은 "누락"이라는데 경보는 안 오거나, 그
// 반대이면 사람이 둘 다 안 믿게 된다. 그래서 같은 유예(watchdog_grace_min)를 받는다.
'use strict'

/**
 * @param {number} timeMin   예정 시각(자정부터 분)
 * @param {number} nowMin    지금(자정부터 분)
 * @param {boolean} firedToday 오늘 발동(완료) 기록이 있는가
 * @param {number} graceMin  유예. watchdog과 같은 값이어야 한다
 * @param {boolean} [startedToday] 오늘 시작 표시가 있는가 — 있으면 나가는 중이라 누락이 아니다
 */
/** 하루의 마지막 분(23:59). 오늘 목록은 오늘 안에서 판정한다(P-37). */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59

// **시작만 하고 안 끝난 방송의 유예.** `watchdog.js` 의 `DEFAULT_RUN_GRACE_MIN` 과 같은 값이고
// 같은 설정 키(`watchdog_run_grace_min`)를 받는다 — 화면과 경보가 갈리면 사람이 둘 다 안 믿는다.
// 여기 기본값은 호출부가 안 넘겼을 때의 보루다. 실제 값은 `routes/schedules.js` 가 DB 에서 읽는다.
const DEFAULT_RUN_GRACE_MIN = 60

function scheduleStatus(s, nowMin, graceMin) {
  if (!s.firedToday) return statusOf(toMinutes(s.scheduled_time), nowMin, false, graceMin)
  // 호출자가 결과를 제공하는 경우 처리 날짜만으로 완료를 추정하지 않는다.
  // 이전 순수 함수 호출자는 firedToday를 실제 성공으로 전달하던 계약을 유지한다.
  if (!Object.prototype.hasOwnProperty.call(s, 'outcome')) return 'done'
  const { FAILED, SUCCEEDED, RUNNING } = require('./broadcastOutcome')
  if (s.outcome === SUCCEEDED) return 'done'
  if (s.outcome === FAILED) return 'missed'
  if (s.outcome === RUNNING) return 'pending'
  return 'unknown'
}

function statusOf(timeMin, nowMin, firedToday, graceMin, startedToday = false,
                  runGraceMin = DEFAULT_RUN_GRACE_MIN) {
  if (firedToday) return 'done'
  // 완료 표시는 시퀀스 **끝**에 찍힌다. 시작은 했는데 아직 안 끝난 방송을 "누락"이라고 적으면
  // 저녁 마무리(5.6분)·아침 종합 방송(투약 안내만 6분)이 매일 몇 분씩 누락으로 보인다(2026-09-01).
  // 감시(watchdog.js)와 같은 근거를 본다 — 화면과 경보가 갈리면 사람이 둘 다 안 믿는다.
  //
  // ── **그런데 상한이 없었다** (현장 사고 2026-09-15) ────────────────────────
  // 예전엔 여기서 `if (startedToday) return 'pending'` 으로 **조건 없이** 끝냈다.
  // 그래서 시작 표시가 한 번 찍히면 그 방송은 **하루 종일 「대기」**였고, 화면은 그것을
  // 「다음에 나갈 방송」으로 골라 계속 띄웠다 — 09:00 국민체조가 09:26 까지 「다음」이었다
  // (09:10 환기방송이 이미 완료인데도).
  //
  // watchdog 은 같은 경우에 `started ? runGrace : grace` 로 **상한을 두고** 60분 뒤
  // 「안 끝남」을 알린다. **화면만 상한이 없어서** 화면은 「대기」, 경보는 「안 끝남」이
  // 됐다 — 이 파일 머리말이 막으려던 바로 그 어긋남이다. 그래서 유예만 길게 잡고
  // 판정은 아래 한 줄로 합친다.
  // 마감은 오늘 안에서 끝나야 한다 (P-37). nowMin 의 최대값이 1439 라, 자르지 않으면
  // 23:55 예정 + 유예 5분 = 1440 이 **어떤 분에도 닿지 못해** 영영 'pending' 으로 남는다.
  // 상한이 1438 인 것은 아래 비교가 `>` 이기 때문이다 — 23:59(1439)에 한 번은 판정이 나야 한다.
  // 감시(watchdog.js)는 `<` 로 보므로 거기서는 1439 로 자른다. 같은 뜻을 각자의 부등호에 맞춘 것이다.
  //
  // `Math.max(timeMin, …)` 은 **예정 시각 그 분을 빨갛게 칠하지 않기 위한 것**이다. 자르기만
  // 하면 23:59 예정 방송이 23:59 에 바로 '누락'이 된다 — 아직 나갈 시간인데 화면이 먼저
  // 실패라고 말하는 것이라, 감시 쪽과 같은 이유로 막는다(watchdog.js 의 clampToToday 참고).
  const 유예 = startedToday ? runGraceMin : graceMin
  const deadline = Math.max(timeMin, Math.min(timeMin + 유예, LAST_MINUTE_OF_DAY - 1))
  return nowMin > deadline ? 'missed' : 'pending'
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 오늘 목록을 만든다. 순수 함수 — DB 조회는 호출부(routes/schedules.js)가 한다.
 *
 * @param {Array}  autoTimes  [{ id, label, time, firedToday, startedToday }] 켜져 있는 일과방송
 * @param {Array}  schedules  [{ id, title, scheduled_time, broadcast_type, group_id, target, firedToday }] 오늘 도는 예약
 * @param {Date}   now
 * @param {number} graceMin
 * @returns {Array} 시각 순 정렬된 항목
 */
function buildTodayView({ autoTimes = [], schedules = [], now = new Date(), graceMin = 5,
                          runGraceMin = DEFAULT_RUN_GRACE_MIN } = {}) {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const items  = []

  for (const a of autoTimes) {
    if (!HHMM.test(a.time || '')) continue
    items.push({
      key:    `auto:${a.id}`,
      kind:   'auto',
      id:     a.id,
      label:  a.label,
      time:   a.time,
      // 일과방송은 묶음·대상이라는 개념이 없다(settings로 도는 고정 방송). 화면이 빈 배지를
      // 그리지 않도록 자리는 두되 null로 준다.
      group_id: null,
      target:   null,
      status: statusOf(toMinutes(a.time), nowMin, !!a.firedToday, graceMin, !!a.startedToday, runGraceMin),
    })
  }

  for (const s of schedules) {
    if (!HHMM.test(s.scheduled_time || '')) continue
    items.push({
      key:    `schedule:${s.id}`,
      kind:   'schedule',
      id:     s.id,
      label:  s.title || '예약 방송',
      time:   s.scheduled_time,
      type:   s.broadcast_type || 'text',
      // 화면이 "1차/2차" 묶음 배지와 대상을 그리는 데 쓴다(CC-026 화면 통합).
      // 이 둘이 없으면 화면을 이 API로 갈아탈 때 지금 있는 표시가 사라진다.
      group_id: s.group_id ?? null,
      target:   s.target   ?? null,
      // 반복 표시("월수금"·"매일"·"1회")를 화면이 그대로 그릴 수 있게 원본 필드를 싣는다.
      // 이게 없으면 이 API로 갈아탄 화면에서 그 표시가 소리 없이 사라진다(CC-026 잔여).
      repeat_weekdays:   s.repeat_weekdays   ?? null,
      repeat_start_date: s.repeat_start_date ?? null,
      repeat_end_date:   s.repeat_end_date   ?? null,
      status: scheduleStatus(s, nowMin, graceMin),
    })
  }

  // 시각 순. 같은 분이면 일과방송을 먼저 — 그쪽이 이 시스템의 기본 골격이다.
  items.sort((x, y) => (toMinutes(x.time) - toMinutes(y.time)) ||
                       (x.kind === y.kind ? 0 : x.kind === 'auto' ? -1 : 1))
  return items
}

module.exports = { buildTodayView, statusOf, toMinutes }
