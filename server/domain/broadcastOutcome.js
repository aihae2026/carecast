// 이력 행(`broadcasts.success`)이 가질 수 있는 값의 단일 출처.
//
// 왜 값이 셋인가(2026-08-30, 전수검수 CC-003): 흐름 방송(연속 방송)은 `at_time` 대기 때문에
// 수십 분 걸릴 수 있어서, scheduler가 **발사만 하고 기다리지 않는다.** 기다리면 같은 분에
// 걸린 다른 예약과 SwitchBot·BGM 점검이 통째로 밀린다(음원 180초 고정 대기 시절 12분씩
// 밀렸던 그 사고). 그 판단은 옳다.
//
// 문제는 결과를 적는 시점까지 같이 앞당겨진 것이었다. 시작하자마자 성공으로 적으니, 흐름이
// 3단계에서 죽어도 이력은 "나갔다"고 말하고 `last_fired` 때문에 그날 재발동도 안 됐다.
// 그래서 **"아직 나갔다는 증거가 없다"**는 세 번째 상태를 만든다. 끝나야 성공이 된다.
//
// 컬럼을 새로 만들지 않은 이유: `success`는 이미 INTEGER라 DDL이 필요 없고, 이 저장소의
// 집계 SQL이 전부 `success = 1` / `success = 0`을 **명시**해서 2가 성공에도 오류에도 안
// 섞인다(착수 전 routes/broadcasts.js·routes/status.js 전수조사로 확인). 진행 중인 방송이
// 성공 통계를 부풀리지도, 대시보드에 거짓 오류로 뜨지도 않는 게 정확히 원하는 동작이다.
'use strict'

const FAILED    = 0   // 실패 — 안 나갔거나 중간에 끊겼다
const SUCCEEDED = 1   // 성공 — 끝까지 나갔다
const RUNNING   = 2   // 진행 중 — 아직 나갔다는 증거가 없다

/** 흐름 실행 결과 → 이력에 적을 값. 모르는 결과는 성공으로 봐주지 않는다. */
function outcomeOfFlow(result) {
  return result === 'completed' ? SUCCEEDED : FAILED
}

/**
 * 이력 값 → 사람이 읽을 말 (P-6, 2026-09-08).
 *
 * **진리값으로 보면 안 된다.** `RUNNING`(2)은 truthy 라 `success ? '성공' : '실패'` 로 쓰면
 * "성공"이 된다. 위 머리말이 "집계 SQL 이 전부 `= 1`/`= 0` 을 명시해서 2가 안 섞인다"고
 * 적어 뒀는데, 그 전수조사가 **CSV 내보내기를 빠뜨렸다**(`routes/broadcasts.js` 의 export.csv).
 * CSV 는 심사·감사 때 기간을 통째로 내는 파일이라, 아직 나갔다는 증거가 없는 방송이
 * 거기서 "성공"으로 읽히면 사람이 그 숫자를 근거로 판단한다.
 *
 * 모르는 값은 성공으로 봐주지 않는다 — `outcomeOfFlow` 와 같은 방향이다.
 */
function outcomeLabel(success) {
  if (success === SUCCEEDED) return '성공'
  if (success === FAILED)    return '실패'
  if (success === RUNNING)   return '진행 중'
  return '알 수 없음'
}

/**
 * 흐름 결과 → **이력에 적을 사유 문구** (P-34, 2026-09-11).
 *
 * `runFlow` 는 끝까지 못 간 사유를 **셋으로 갈라** 돌려주는데(`cancelled`·`preempted`·
 * `skipped`) 이력에는 **한 줄**로 뭉개져 적혔다: *"끝까지 진행되지 않음(정지 또는 중복 실행)"*.
 * 현장에서 "왜 안 나갔냐" 고 물을 때 그 줄로는 답을 못 한다 — **사람이 끈 것과 시스템이
 * 밀어낸 것은 다음에 할 일이 다르다.**
 *
 * 문구를 여기 둔 이유: 부르는 쪽(scheduler)에 적으면 흐름·예약·자동방송이 같은 사건을
 * 다르게 말하게 된다. 이 저장소가 볼륨·음원 경로·차임 사유에서 반복해 겪은 모양이다(FP-0005).
 *
 * **모르는 값에 빈 문구를 주지 않는다** — 빈 문구는 화면에서 "정상 완료" 로 읽힌다.
 */
function 흐름사유문구(result) {
  switch (result) {
    case 'completed': return ''
    case 'completed_no_player':
      return '재생할 창이 없어 화면으로 나가는 단계가 소리를 못 냈습니다(차임 등 서버 스피커 단계는 나갔습니다)'
    case 'completed_with_failures':
      return '차임벨이 연속 3회 실패했습니다(나머지 단계는 진행됨)'
    case 'cancelled':  return '사람이 정지했습니다'
    case 'preempted':  return '다른 방송이 시작되어 밀렸습니다'
    case 'skipped':    return '조건이 맞지 않아 건너뛰었습니다'
    default:           return `끝까지 진행되지 않았습니다(알 수 없는 결과: ${result})`
  }
}

module.exports = { FAILED, SUCCEEDED, RUNNING, outcomeOfFlow, outcomeLabel, 흐름사유문구 }
