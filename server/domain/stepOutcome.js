// 단계 하나가 **어떻게 끝났나**를 정하는 순수 규칙 (P-47 설계안, 사용자 승인 2026-09-10 §3).
//
// 설계 근거·선택지는 `docs/audit/STEP_STATE_DESIGN.md`. 여기는 그 문서의 §2 판정 순서를
// **실행 가능한 형태**로 옮긴 것이다. **아직 아무도 이것을 안 부른다** — 값 개수(선택 A)와
// 옛 이력 처리(선택 B)가 정해지기 전에는 배선하지 않는다.
//
// 순수 함수인 이유: 실제 시계로 시험하려면 "마지막 조각에 앵커가 걸리도록" 타이밍을 맞춰야
// 하는데 그런 테스트는 병렬 부하에서 흔들린다(CC-048 에서 이미 겪었다).
// 같은 이유로 `shouldStopBeforeAnchor` 도 순수 함수로 빠져 있다(`flowRunner.js:97-100`).
'use strict'

// 네 값. **셋이 아니라 넷인 이유**는 설계안 §7 선택 A —
// 지금 '실패' 로 적히는 것(차임 고장·단계 예외)이 세 값 어디에도 없다.
const COMPLETED = 'completed'   // 끝까지 냈다
// **앵커 마감 정책이 적용됐다**는 뜻이다. "내용을 못 냈다"와 **같지 않다**(독립 검수 지적 2).
// `shouldStopBeforeAnchor` 는 원래 "소리가 남아 있을 수 있으니 경계에서 멈춘다"는 **보수적
// 정지 정책**이다(`flowRunner.js:88-93`). 마지막 음원이 앵커 시각과 겹쳐 **자연 종료**해도
// 그 판정은 참이 된다 — 내용은 다 냈는데 anchored 가 된다.
// 지금 신호로는 그 둘을 못 가른다. 그래서 **뜻을 정책으로 적는다.** 가르려면 단계가
// "스스로 끝났다"를 알려 줘야 하고, 그것은 배선 때 정할 일이다(설계안 §7 선택 C).
const ANCHORED  = 'anchored'    // 앵커 마감 **정책이 적용**됐다 (미완주와 동의어가 아니다)
const CANCELLED = 'cancelled'   // 사람이 정지했거나 다른 방송이 밀어냈다
const FAILED    = 'failed'      // 차임 고장·단계 예외 — 지금의 '실패'

/**
 * 판정 순서는 **cancelled > anchored > completed** 다(설계안 §2).
 * 사람의 의사가 먼저다 — 정지를 눌렀는데 "예정대로 마감"으로 적히면
 * 그 사람은 자기 조작이 먹었는지 알 수 없다.
 *
 * @param {object}  s
 * @param {boolean} s.실패        단계가 실패를 알려왔나(차임 고장·예외)
 * @param {boolean} s.취소됨      cancelledSinceFlowStart() — 정지·밀림
 * @param {boolean} s.잘림        cutShort — 단계가 폴링해 줬을 때만 선다(단독으로는 못 믿는다)
 * @param {number}  s.끝난시각ms  stepEndedAtMs
 * @param {number|null} s.앵커시각ms anchorAtMs — 다음 앵커 단계의 예정 시각. 없으면 null
 */
function 단계결과({ 실패 = false, 취소됨 = false, 잘림 = false, 끝난시각ms = 0, 앵커시각ms = null,
  자연종료 = false } = {}) {
  // ① 사람의 의사가 가장 먼저다.
  if (취소됨) return CANCELLED
  // ② 실패는 그다음 — 앵커가 지났더라도 "차임이 고장났다"는 사실이 더 중요하다.
  //    (앵커에 걸려 잘린 것과 고장은 다른 사건이고, 고장은 연속 카운터가 세야 한다.)
  if (실패) return FAILED
  // ③ 앵커 마감. **cutShort 단독으로 보지 않는다** — 마지막 조각 도중 앵커가 지나면
  //    그 값은 false 로 남는다(AP-0039 가 정정한 사실). 시각 비교를 같이 본다.
  // **자연 종료가 앵커와 겹친 경우는 완주다**(독립 검수 지적 2). 단계가 스스로 끝났다고
  // 알려 주면 그것을 믿는다. 안 알려 주면(지금 대부분) 정책 판정으로 떨어진다.
  if (!자연종료 && 앵커마감({ 잘림, 끝난시각ms, 앵커시각ms })) return ANCHORED
  return COMPLETED
}

/**
 * `flowRunner.shouldStopBeforeAnchor` 와 **같은 규칙**이다.
 * 두 벌로 두면 화면 정지 판정과 이력 판정이 갈린다 — 이 저장소가 여러 번 겪은 실패다.
 * 배선할 때 그쪽이 이 함수를 부르게 하거나, 이쪽이 그쪽을 부르게 **하나로 합친다**.
 * 지금은 규칙이 같음을 검사로 고정만 해 둔다(`step-outcome.test.js`).
 */
function 앵커마감({ 잘림 = false, 끝난시각ms = 0, 앵커시각ms = null } = {}) {
  if (앵커시각ms == null) return false
  return !!잘림 || 끝난시각ms >= 앵커시각ms
}

// 옛 이력을 새 값으로 **바꾸지 않는다**(설계안 §5). 읽을 때 뜻을 붙이는 자리만 둔다.
//
// **처음엔 옛 '실패' → failed 로 옮기려 했는데 틀렸다**(독립 검수 지적 1, EV-003248).
// [FACT] `flowRunner.js:468` — 취소도 '실패'로 적힌다:
//   `result: (stepResult === CANCELLED || stepResult === CHIME_FAILED) ? '실패' : '성공'`
// 그대로 옮기면 **과거의 정지를 고장으로 바꾼다** — 차임 연속 카운터가 그것을 센다.
//
// 다만 **행에 근거가 있다.** `:470-471` 이 사유를 detail 에 남긴다:
//   취소 → '정지 요청 또는 다른 방송 시작' · 차임 실패 → '차임벨 재생 실패(보조 신호 …'
// 그래서 **행 전체**를 받아 그 두 문구일 때만 갈라 준다. 추측이 아니라 기록을 읽는 것이다.
// 그 문구가 아니면 `null` — "종료 유형 미기록"이고, 넘겨짚으면 추측이 기록이 된다.
//
// **문구 짝맞추기라 취약하다**(P-95 와 같은 부채). 문구를 바꾸는 사람은 여기도 본다.
const 옛취소문구 = '정지 요청 또는 다른 방송 시작'
const 옛차임실패문구 = '차임벨 재생 실패'
function 옛값해석(row) {
  const r = row && typeof row === 'object' ? row : { result: row }
  const detail = String(r.detail || '')
  if (r.result === '실패') {
    if (detail === 옛취소문구) return CANCELLED
    if (detail.indexOf(옛차임실패문구) === 0) return FAILED
    return null                     // 사유를 안 남긴 옛 실패 — 무엇이었는지 모른다
  }
  return null                       // 옛 '성공' 안에도 취소가 섞여 있다(P-47 의 본체)
}

module.exports = { 단계결과, 앵커마감, 옛값해석, COMPLETED, ANCHORED, CANCELLED, FAILED }
