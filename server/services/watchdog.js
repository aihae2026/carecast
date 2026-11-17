// 예정된 방송이 안 나갔다는 것을 시스템이 스스로 말한다.
//
// 왜 필요했나(2026-08-29 리뷰 CC-004): 이 시스템에는 "나갔어야 할 방송이 안 나갔다"를
// 감지하는 장치가 하나도 없었다. 발동 자체가 없으면 broadcasts 테이블에 행조차 안 생기므로,
// 이력 화면을 봐도 "없었던 것"과 "안 나간 것"이 구별되지 않는다. 금요일 저녁에 재생 창이
// 닫히면 토·일 12회가 전부 무음인데, 월요일에 어르신들이 말해서야 알게 된다.
//
// 판정 방식: scheduler.js가 발동 후 남기는 *_last_fired가 오늘 날짜인지 본다. 설정키는
// domain/autoBroadcasts.js가 단일 출처이고, watchdog.test.js가 그 키를 scheduler.js 소스와
// 대조한다 — 키가 어긋나면 감시가 조용히 쓸모없어지기 때문이다.
//
// 두 가지를 갈라서 본다(2026-09-01):
//   1) 시작조차 안 했다  → 진짜 누락. 예정 시각 + watchdog_grace_min(기본 5분)에 알린다.
//   2) 시작은 했는데 안 끝난다 → 방송이 중간에 멈춘 것. watchdog_run_grace_min(기본 60분)에 알린다.
//
// 왜 갈랐나: *_last_fired는 시퀀스 **끝**에 찍힌다. 5분 유예 하나로 완료만 보면, 5분을 넘기는
// 방송이 **매일** 누락으로 찍힌다 — 저녁 마무리 방송은 이 시스템 자신의 추정기로도 5.6분(18:06 종료)이고,
// 아침 종합 방송은 투약 안내 대기만 6분이라 아예 구조적으로 못 지킨다. 실제로 현장 이력에
// "[방송누락] 저녁 마무리(18:00)"가 매일 남으면서 방송은 정상으로 나가고 있었다.
//
// 사람이 해야 할 일도 다르다 — 앞은 서버·창을 보고, 뒤는 멈춘 방송을 본다. 그래서 문구도 다르다.
'use strict'

const cron = require('node-cron')
const { AUTO_BROADCASTS, autoTime } = require('../domain/autoBroadcasts')
const { todayStr, shouldRunToday, isOneTime } = require('./repeatSchedule')
const { raise } = require('./alert')
const { wasUpAt, inRestartGap } = require('./serverBoot')

const DEFAULT_GRACE_MIN = 5
// 시작은 했는데 안 끝난 것을 알리기까지. 아침 종합 방송은 40분을 넘기기도 해서 넉넉히 둔다.
const DEFAULT_RUN_GRACE_MIN = 60

function getSetting(db, key) { return rawSetting(db, key) }

// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting, 숫자설정 } = require('../domain/settingsRead')

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

/** 하루의 마지막 분(23:59). 감시는 **오늘 것만** 보므로 판정도 오늘 안에서 끝나야 한다. */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59

/**
 * 마감을 오늘 안으로 자른다 (P-37).
 *
 * `nowMin` 의 최대값은 1439 인데 마감은 `예정 + 유예`라, 23:55 예정 + 유예 5분 = 1440 은
 * **어떤 분에도 도달하지 못해 경보가 영영 안 났다.** 시작 후 멈춤은 유예가 60분이라
 * 22:59 이후 예정분이 전부 그랬다. 자정을 넘긴 유예는 다음 날로 넘길 수도 없다 —
 * 감시는 오늘 날짜로만 판정하기 때문이다. 그래서 하루의 끝에서 한 번은 보게 자른다.
 *
 * **다만 예정 시각 그 분에는 절대 알리지 않는다.** 그냥 1439 로 자르면 23:59 예정 방송이
 * 23:59 에 바로 누락으로 찍힌다 — 스케줄러의 같은 분 tick 이 아직 안 돌았으면 **나가는 중인
 * 방송에** 경보가 붙는 것이다(2026-09-08 독립 검수 지적). 유예를 한 번도 안 준 셈이라
 * 자르는 목적(하루 안에 한 번은 본다)보다 잃는 것이 크다.
 *
 * 그래서 자른 마감이 예정 시각보다 뒤가 되도록 되민다. 대가는 **하루 끝에 가까운 방송일수록
 * 유예가 짧아진다**는 것이다(23:00 에 시작해 멈춘 방송은 60분이 아니라 59분에 알린다).
 * 그 반대편은 "오늘 끝나도록 아무 말도 안 하는 것"이라 이쪽을 택했다.
 * 23:59 예정분은 여전히 그날 안에 못 잡는다 — 뒤로 밀 분이 없다.
 */
function clampToToday(deadlineMin, scheduledMin) {
  return Math.max(scheduledMin + 1, Math.min(deadlineMin, LAST_MINUTE_OF_DAY))
}

/**
 * 지금 시점에서 "나갔어야 하는데 안 나간" 일과방송을 찾아 경보를 남긴다.
 *
 * now를 주입받는 이유: 테스트가 실제로 11시까지 기다릴 수 없다. 운영 경로는 기본값을 쓴다.
 * 어떤 경우에도 던지지 않는다 — 감시가 서버를 멈추면 감시하려던 방송까지 죽는다.
 *
 * @returns {Array<{id, label, time}>} 이번 호출에서 새로 알린 것들
 */
// **오늘 이 방송이 "다른 방송에 밀려 중단됨"으로 이력에 남았나.**
// `logPreempted`(`broadcastSequencer.js:412`)가 그 문구로 한 줄 남긴다 — 여기서는 그 줄을 찾는다.
// 문구 정확일치에 기대는 것이 깔끔하진 않다(P-33 이 같은 부채를 적어 뒀다). 다만 지금
// `broadcasts` 에 "왜 실패했나"를 담는 칸이 없고, 칸을 더하는 것은 스키마 변경이라
// 승인 대상이다. **문구를 고칠 때 이 함수도 같이 본다** — 두 자리를 여기 적어 둔다.
const { 밀림문구 } = require('../domain/broadcastRecord')   // 문구 단일 출처(P-31)
function wasPreempted(db, today, spec) {
  try {
    // **레인 표를 복사하지 않고 읽는다.** `logContent` 는 spec.label 과 다르다
    // (`저녁 마무리` vs `저녁 마무리 방송`) — 여기에 베껴 적으면 이름이 바뀌는 날 조용히 어긋난다.
    // 지연 require 다: 감시가 시퀀서를 최상위에서 물면 로드 순서가 얽힌다.
    const LANES = require('./broadcastSequencer').LANES || {}
    const lane = LANES[spec.id]
    if (!lane || !lane.logContent) return false
    // **코드를 먼저 본다**(0026). 문자열 짝맞추기는 문구를 바꾸는 날 조용히 어긋난다.
    // `fail_reason` 이 NULL 인 **옛 행**은 그 칸이 생기기 전 기록이라 문구로 떨어진다 —
    // 호환을 위해 남기는 길이고, 옛 행이 다 정리되면(보관 365일) 자연히 안 쓰인다.
    const BR = require('../domain/broadcastRecord')
    const 코드행 = db.prepare(
      'SELECT 1 FROM broadcasts WHERE date = ? AND success = 0 AND fail_reason = ? AND content = ? LIMIT 1'
    ).get(today, BR.사유.밀림, 밀림문구(lane.logContent))
    if (코드행) return true
    const row = db.prepare(
      'SELECT 1 FROM broadcasts WHERE date = ? AND success = 0 AND fail_reason IS NULL AND content = ? LIMIT 1'
    ).get(today, 밀림문구(lane.logContent))
    return !!row
  } catch (e) {
    // 못 읽으면 **밀림이 아닌 쪽**으로 둔다 — 지금까지의 문구 그대로다.
    console.warn('[감시] 밀림 이력 조회 실패:', e.message)
    return false
  }
}

// ── 두 감시가 함께 쓰는 배관 (P-26, 2026-09-10) ──────────────────────────
//
// `checkMissed`(자동방송 5종)와 `checkMissedSchedules`(예약)가 **같은 일을 각자 적고**
// 있었다 — 하루 한 번 표식, 경보 발신, 화면용 개별 신호. 규칙이 갈리면 같은 상황에서
// 자동방송과 예약이 다르게 알린다(FAILURE_PATTERNS FP-0005 가 그 모양이다).
//
// **경보 종류 어휘도 여기 모은다.** 서버가 짓는 종류와 화면이 가리는 목록
// (`src/lib/alertStore.js` 의 `HIDDEN_KINDS`)이 서로를 모르면, 서버가 종류 이름을 바꾸는 날
// **화면이 가리던 것이 갑자기 배너로 쏟아진다.** 런타임으로 잇지는 않는다(서버는 CJS,
// 화면은 ESM) — 대신 `watchdog-shared-rules.test.js` 가 두 목록을 대조한다.
const 경보종류 = {
  누락: '방송누락',      // 안 나갔다. 사람이 배너에서 꺼 둔 종류다(HIDDEN_KINDS)
  멈춤: '방송멈춤',      // 시작은 했는데 안 끝났다. 진짜로 급해서 배너로 뜬다
  예약누락: '예약누락',  // 1회성 예약이 안 나갔다 — 오늘이 지나면 복구가 안 된다
}

/**
 * 오늘 이미 알렸나 — 아니면 표식을 세우고 `true` 를 돌려준다.
 * 매분 반복하면 이력이 경보로 뒤덮여 진짜 정보가 묻힌다.
 */
function 오늘처음알린다(db, alertedKey, today) {
  if (getSetting(db, alertedKey) === today) return false
  setSetting(db, alertedKey, today)
  return true
}

/**
 * 경보 하나를 사람과 화면에 보낸다.
 *
 * `broadcast_missed` 는 화면이 **그 방송 하나를 짚어서** 다루는 신호다. 문구도 함께 실어
 * 보낸다 — 화면이 다시 지으면 경보 id(`날짜|종류|문구`)가 갈려 같은 사건이 배너에 두 줄로 뜬다.
 * 알림이 실패해도 감시는 계속 돈다.
 *
 * @param 이미기록됨 `broadcasts` 에 그 사건이 이미 한 줄 있는가(P-28). 참이면 이력 행을 안 더한다.
 */
function 누락을알린다(db, { kind, message, detail, sse, 이미기록됨 = false }) {
  raise(kind, message, detail, null, { 이미기록됨 })
  try {
    require('./sse').broadcastSSE('broadcast_missed', { ...sse, kind, message })
  } catch { /* 알림 실패가 감시를 멈추지 않게 */ }
}

/**
 * **경보 없이** 이력에만 한 줄 남긴다 (P-97, 사용자 승인 2026-09-10).
 *
 * 예정 시각에 서버가 안 떠 있었으면 그 방송은 "고장난 것"이 아니라 **PC 가 꺼져 있던 것**이다.
 * 경보(배너·SSE)는 안 내되 **흔적은 없애지 않는다** — 나중에 "그날 왜 안 나갔나"를 물을 수
 * 있어야 한다. 사유는 `fail_reason` 코드로 갈라 남기므로 이력에서 고장과 구별된다.
 *
 * 실패해도 감시는 계속 돈다 — 기록하려다 감시가 멎으면 본말전도다.
 */
function 경보없이이력만(db, { date, time, content, 사유코드 }) {
  try {
    db.prepare(
      'INSERT INTO broadcasts (date, time, type, content, user, target, success, fail_reason)'
      + ' VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(date, time, '자동', content, '자동', '전체', 사유코드)
  } catch (e) {
    console.warn('[감시] 미실행 이력 기록 실패(감시는 계속):', e.message)
  }
}

function checkMissed(db, { now = new Date() } = {}) {
  const found = []
  try {
    const today  = todayStr(now)
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const grace  = 숫자설정(getSetting(db, 'watchdog_grace_min'), DEFAULT_GRACE_MIN)
    const runGrace = 숫자설정(getSetting(db, 'watchdog_run_grace_min'), DEFAULT_RUN_GRACE_MIN)

    for (const spec of AUTO_BROADCASTS) {
      // scheduler.js와 같은 엄격 비교 — 꺼진 방송을 안 나갔다고 알리면 잔소리가 된다
      if (getSetting(db, spec.enabledKey) !== 'true') continue

      // 시각 해석은 autoBroadcasts 의 규칙 하나만 쓴다 — 빈 값은 "사람이 껐다"이고
      // 여기서 기본시각으로 되살리면 안 나갈 방송을 매일 누락으로 알린다(P-35).
      const time = autoTime(getSetting(db, spec.timeKey), spec)
      if (!time) continue

      // 오늘 완료 기록이 있으면 정상
      if (getSetting(db, spec.firedKey) === today) continue

      // 시작 표시가 오늘이면 **나가는 중**이다. 이때는 훨씬 긴 유예로 "멈췄나"만 본다.
      const started = getSetting(db, spec.startedKey) === today
      const scheduledMin = minutesOf(time)
      const deadline = clampToToday(scheduledMin + (started ? runGrace : grace), scheduledMin)
      if (nowMin < deadline) continue

      // 하루 한 번만. 표식 규칙은 예약 감시와 **같은 배관**을 쓴다(P-26).
      if (!오늘처음알린다(db, `watchdog_alerted_${spec.id}`, today)) continue


      // 문구는 **여기서 한 번만** 짓는다. 화면(SystemAlertBanner)이 같은 문구를 따로 지어
      // 쓰고 있었는데, 상황이 둘로 갈라진 지금은 그러면 "멈췄다"가 화면에서 "안 나갔다"로
      // 둔갑한다. 게다가 경보 id가 `날짜|종류|문구`라, 문구가 갈리면 같은 사건이 배너에
      // **두 줄**로 뜬다(system_alert 한 줄 + broadcast_missed 한 줄).
      //
      // 종류도 갈라 둔다(2026-09-01, 사용자 결정). 사람이 꺼 둔 것은 '방송누락' 배너인데,
      // 그때 눈에 거슬리던 것이 바로 이번에 고친 거짓 경보였다. '방송멈춤'은 진짜로 급한
      // 일(방송이 중간에 멈춤)이라 배너로 떠야 한다 — 가리는 목록은 alertStore.HIDDEN_KINDS.
      // ── P-30: **밀린 것과 안 뜬 것은 다른 사건이다** ──────────────────
      // 이 함수는 `broadcasts` 표를 안 봤다. 그래서 다른 방송에 밀려 중단된 것까지
      // "현장 PC의 CareCast 창이 열려 있는지 확인해주세요"로 알렸다 — 창은 멀쩡히 열려
      // 있고 사람은 엉뚱한 데를 본다. ISSUE-010 이 이력에는 흔적을 남기게 고쳤는데
      // **감시는 그 흔적을 안 읽고 있었다**(그 수정의 남은 절반이다).
      // 문구만 가른다. 알리는 것 자체는 그대로다 — 밀렸어도 그 방송은 안 나간 것이다.
      const 밀림 = wasPreempted(db, today, spec)

      // ── P-97: **예정 시각에 서버가 꺼져 있었으면 경보를 안 낸다** (사용자 승인 2026-09-10)
      // 예약 감시는 이미 그 규칙이다(ISSUE-006 사용자 결정) — 자동방송만 안 봐서
      // 같은 상황에서 아침방송은 경보가 나고 같은 시각 예약은 조용했다.
      //
      // **판정은 실제 가동 기록으로만 한다.** 셋으로 갈린다:
      //   · 떠 있었다(true)     → 지금까지 그대로 알린다
      //   · 안 떠 있었다(false) → **경보 없이 이력만** — 고장이 아니라 PC 가 꺼져 있던 것
      //   · 기록이 없다(null)   → **모른다.** 알림은 그대로 내고 이력에 '확인 불가'로 남긴다
      // 모르는 것을 "꺼져 있었다"로 접으면 진짜 누락이 조용히 사라진다 — 그래서 안 접는다.
      //
      // **밀림 판정 뒤에 둔다.** 밀린 기록이 있다는 것은 **그 시각에 서버가 돌고 있었다는
      // 증거**다 — 가동 기록이 없어도 '확인 불가'로 적을 이유가 없고, 그 사건은 이미
      // 이력에 한 줄 있다(P-28).
      //
      // **재시작 틈은 예외다**(P-25). 생존 표식이 분 단위라 예정된 그 분에 재시작하면
      // false 로 떨어지는데, 그 방송은 진짜로 안 나간 것이다.
      const BR97 = require('../domain/broadcastRecord')
      if (!밀림) {
        const 예정 = new Date(now)
        예정.setHours(...time.split(':').map(Number), 0, 0)
        const 가동 = wasUpAt(db, 예정.getTime())
        if (가동 === false && !inRestartGap(db, 예정.getTime())) {
          경보없이이력만(db, {
            date: today, time, content: BR97.미가동문구(spec.label), 사유코드: BR97.사유.서버미가동,
          })
          console.log(`[감시] ${spec.label}(${time}) — 그 시각에 서버가 꺼져 있었습니다. 이력에만 남깁니다`)
          continue
        }
        if (가동 === null) {
          경보없이이력만(db, {
            date: today, time, content: BR97.확인불가문구(spec.label), 사유코드: BR97.사유.확인불가,
          })
        }
      }

      const kind    = started ? 경보종류.멈춤 : 경보종류.누락
      const message = 밀림
        ? `${spec.label}(${time})이 다른 방송에 밀려 중단됐습니다. 창 문제가 아닙니다 — 방송 이력에서 무엇이 밀어냈는지 확인해주세요.`
        : started
          ? `${spec.label}(${time}) 방송이 시작됐는데 ${runGrace}분이 지나도 끝나지 않았습니다. 현장 PC의 CareCast가 멈췄는지 확인해주세요.`
          : `${spec.label}(${time})이 나가지 않았습니다. 현장 PC의 CareCast 창이 열려 있는지 확인해주세요.`

      // ── P-28: **한 사건에 이력이 두 줄 남지 않게** ────────────────────
      // 밀린 방송은 시퀀서가 이미 `broadcasts` 에 한 줄 남겼다(`logPreempted`).
      // 여기서 경보 행을 또 넣으면 같은 사건이 이력에 **두 줄**로 보인다.
      //
      // 게다가 그 경보 행은 **오류 숫자를 다시 올린다.** P-31 이 밀림을 오류에서 뺀 근거는
      // `fail_reason` 코드와 `밀림표식` 문구인데(`routes/status.js:106-112`), 경보 행은
      // `fail_reason` 이 NULL 이고 문구도 다르다("중단됐습니다" vs "중단됨") —
      // [FACT] EV-003378 로 실측했다. 그래서 수동재생으로 정시 방송을 앞당길 때마다
      // 오류가 1씩 오르던 그 증상이 이 경로로 되살아나 있었다.
      //
      // **생략하는 것은 DB 행 하나뿐이다.** 화면 알림도 로그도 그대로 나간다(P-30 의
      // "알리는 것 자체는 그대로다"). 그리고 `wasPreempted` 가 그 표를 **직접 읽어**
      // 밀림 행이 있는 것을 확인했을 때만 생략한다 — 추측으로 지우지 않는다.
      누락을알린다(db, {
        kind, message,
        detail: { id: spec.id, label: spec.label, time, started },
        sse: { id: spec.id, label: spec.label, time, date: today, started },
        이미기록됨: 밀림,
      })

      found.push({ id: spec.id, label: spec.label, time, started })
    }
  } catch (e) {
    console.error('[감시] 누락 점검 실패:', e.message)
  }
  return found
}

// ── 예약 방송 감시 (ISSUE-006, 사용자 결정 2026-09-07) ─────────────────────
//
// 위 checkMissed 는 자동방송 5종만 본다(AUTO_BROADCASTS). 현장의 환기 방송처럼 `schedules`
// 표에 든 예약은 **아무도 안 봤다** — 같은 조건에서 자동방송은 경보가 나고 예약은 조용했다
// ([FACT] EV-000475).
//
// 대상: `active = 1` 인 **모든** 예약. managed_by 로 거르지 않고, 반복·1회성을 같이 본다.
// 유예: 자동방송과 **같은** `watchdog_grace_min`(기본 5분)을 쓴다. 별도 키를 만들지 않는다.
//
// 취소된 예약은 애초에 여기 안 들어온다 — 취소가 행 삭제이거나 `active = 0` 이기 때문이다
// ([FACT] EV-000999, routes/schedules.js:199·:388·:363). "삭제된 예약은 감시 대상이 아니다"가
// 이 설계의 정의다(사용자 결정 — 소프트 삭제로 바꾸지 않는다).

/**
 * 지금 미뤄져 대기 중인 예약인가.
 *
 * 왜 필요한가(ISSUE-006 독립 검수가 찾은 오경보 경로): 예약이 자동방송과 같은 분에 걸리거나
 * 방송 중이면 스케줄러가 **최대 `schedule_defer_max_min`(기본 10분)** 까지 미뤘다가 내보낸다
 * (`scheduler.js:590-606`). 그런데 감시 유예는 `watchdog_grace_min`(기본 5분)이라, **아직 나갈
 * 예정인 방송에 "나가지 않았습니다"를 낸다.** 1회성이면 배너에 "오늘이 지나면 다시 나가지
 * 않습니다"가 뜬 뒤 실제로는 나간다 — 감시를 못 믿게 만드는 종류의 거짓말이다.
 *
 * 유예 값을 늘리지 않고 이 검사를 택한 이유: 유예를 10분으로 올리면 **진짜 누락을 5분 더 늦게**
 * 알게 된다. 미뤄진 것은 "안 나갔다"가 아니라 "아직 안 나갔다"라 애초에 대상이 아니다.
 * (사용자 지시 "유예는 watchdog_grace_min 공유, 별도 키 만들지 말 것"도 그대로 지킨다.)
 */
function isDeferredNow(scheduleId, today, time) {
  try {
    return require('./scheduler')._defer.deferred.has(`${scheduleId}|${today}|${time}`)
  } catch { return false }
}

/** 그 예약이 오늘 실제로 나간 흔적이 이력에 있는가. 수동 실행("지금 실행")도 여기 잡힌다. */
function firedTodayInHistory(db, scheduleId, today) {
  try {
    // run_key 는 `예약<id>-<seq>` 다(runContext.withRun, scheduler.js:229). 수동 실행도 같은
    // 구간을 지나므로 찍힌다 — last_fired 는 수동일 때 일부러 안 찍히므로(schedule._manual)
    // **사람이 튼 방송을 누락으로 알리지 않으려면 이력을 함께 봐야 한다.**
    // 한계: run_key 컬럼이 생기기 전(0022 이전) 옛 행에는 값이 없다. 그 행은 못 잡는다 —
    // 오늘 이후 데이터에만 해당하므로 감시에는 영향이 없다.
    return !!db.prepare('SELECT 1 FROM broadcasts WHERE date = ? AND run_key LIKE ? LIMIT 1')
      .get(today, `예약${scheduleId}-%`)
  } catch { return false }
}

/**
 * 예정 시각이 지났는데 안 나간 예약을 찾아 경보를 남긴다.
 *
 * 제외 조건 넷(사용자 결정):
 *   · 오늘 나갈 날이 아니다 — 요일·시작일·종료일 (shouldRunToday 가 셋을 다 본다)
 *   · 이미 나갔다 — last_fired 가 오늘이거나 이력에 흔적이 있다(수동 실행 포함)
 *   · 그 시각에 서버가 안 떠 있었다 — server_boot 구간 밖(ISSUE-006 의 선행 조건)
 *   · 가동 기록이 아예 없다 — **모르는 것으로 경보를 내지 않는다**
 *
 * 어떤 경우에도 던지지 않는다.
 */
function checkMissedSchedules(db, { now = new Date() } = {}) {
  const found = []
  try {
    const today  = todayStr(now)
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const grace  = 숫자설정(getSetting(db, 'watchdog_grace_min'), DEFAULT_GRACE_MIN)

    const rows = db.prepare('SELECT * FROM schedules WHERE active = 1').all()
    for (const s of rows) {
      const time = String(s.scheduled_time || '')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue
      // 아직 유예 안에 있다. 마감은 오늘 안이되 예정 시각 그 분은 넘긴다(P-37).
      if (nowMin < clampToToday(minutesOf(time) + grace, minutesOf(time))) continue
      if (!shouldRunToday(s)) continue                    // 요일·기간 밖
      if (s.last_fired === today) continue                // 정상 발사
      if (firedTodayInHistory(db, s.id, today)) continue  // 수동 실행 등으로 이미 나갔다
      if (isDeferredNow(s.id, today, time)) continue      // 미뤄졌을 뿐 아직 나갈 예정이다

      // 그 시각에 서버가 떠 있었나. null = 가동 기록이 없다(모른다) → 알리지 않는다.
      const at = new Date(now)
      at.setHours(...time.split(':').map(Number), 0, 0)
      // **재시작 틈은 예외다**(P-25). 생존 표식이 분 단위라 예정된 그 분에 재시작하면
      // 그 시각이 두 가동 구간 사이에 떨어져 `false` 가 된다 — 그러면 **진짜 누락이
      // 조용히 제외된다.** 재시작은 예약이 못 나가는 흔한 원인이고(main 은 10분마다
      // 자동 업데이트를 돈다), 밤새 꺼진 것과는 틈의 길이가 자릿수로 다르다.
      if (wasUpAt(db, at.getTime()) !== true && !inRestartGap(db, at.getTime())) continue

      // 하루 한 번만. 매분 반복하면 이력이 경보로 뒤덮여 진짜 정보가 묻힌다.
      // 키가 예약당 하나씩 늘어나는데, 예약을 지워도 키는 남는다 — 값이 날짜뿐이라 해롭지 않다.
      if (!오늘처음알린다(db, `watchdog_alerted_schedule_${s.id}`, today)) continue

      // 1회성은 지나가면 복구가 불가능하다. 그래서 **종류를 갈라** 배너에 뜨게 한다 —
      // '방송누락' 은 사람이 꺼 둔 종류다(alertStore.HIDDEN_KINDS). 반복 예약은 내일 또 나가므로
      // 기존 등급('방송누락')을 그대로 쓴다(사용자 결정 2026-09-07).
      const once    = isOneTime(s)
      const kind    = once ? 경보종류.예약누락 : 경보종류.누락
      const title   = s.title || '(제목 없는 예약)'
      const message = once
        ? `"${title}"(${time}) 1회성 예약이 나가지 않았습니다. 오늘이 지나면 다시 나가지 않습니다.`
        : `"${title}"(${time}) 예약이 나가지 않았습니다. 현장 PC의 CareCast 창이 열려 있는지 확인해주세요.`

      누락을알린다(db, {
        kind, message,
        detail: { scheduleId: s.id, title, time, once },
        sse: { id: `schedule-${s.id}`, label: title, time, date: today, started: false },
      })

      found.push({ id: s.id, title, time, once })
    }
  } catch (e) {
    console.error('[감시] 예약 누락 점검 실패:', e.message)
  }
  return found
}

function startWatchdog(db) {
  cron.schedule('* * * * *', () => { checkMissed(db); checkMissedSchedules(db) }, { timezone: 'Asia/Seoul' })
  console.log(`[감시] 방송 누락 감시 시작 (자동방송 5종 + 예약, 예정 시각 +${DEFAULT_GRACE_MIN}분 기준, watchdog_grace_min으로 조정)`)
}

module.exports = { checkMissed, checkMissedSchedules, startWatchdog, DEFAULT_GRACE_MIN, DEFAULT_RUN_GRACE_MIN,
  경보종류 }
