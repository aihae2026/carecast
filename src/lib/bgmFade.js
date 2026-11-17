// BGM 을 끌 때의 **페이드 길이**와, 그 페이드를 포함해 **언제 정지를 쏠지**.
//
// 왜 필요했나(UX-17 ④, 2026-09-11): 수용 기준은
// *"TTS 종료 후 BGM 5초 → 종료. **5초 안에 페이드 시간이 포함**된다(페이드 때문에 5초가
// 더 붙지 않는다)"* 인데, 실측하니 **5374ms** 였다([FACT] EV-003954).
//
// 원인은 순서다. 안내가 끝나면 `endDelay` 만큼 기다렸다가 정지를 쏘고, **받은 쪽이 그때부터**
// 페이드를 시작한다. 그래서 실제 무음까지는 `endDelay + 페이드` 가 걸린다.
//
//   (예전)  안내 끝 ──5000ms 대기──▶ 정지 신호 ──300ms 페이드──▶ 무음   = 5300ms+
//   (지금)  안내 끝 ──4700ms 대기──▶ 정지 신호 ──300ms 페이드──▶ 무음   = 5000ms
//
// **숫자를 두 곳에 적지 않으려고 여기 모았다.** 빼는 쪽(훅)과 페이드를 거는 쪽(재생기)이
// 각자 300 을 적으면, 한쪽만 고치는 날 꼬리가 조용히 어긋난다 — 이 저장소가 볼륨 기본값과
// 음원 경로에서 반복해 겪은 모양이다(FP-0005).

/** BGM 정지 페이드 길이(ms). 이 값이 정본이다 — 재생기도 여기서 가져다 쓴다. */
export const BGM_STOP_FADE_MS = 300

/**
 * 페이드를 몇 ms 간격으로 나누는가. 재생기의 `fadeTo` 가 쓰는 값과 같아야 한다
 * (`MusicPlayer.jsx` 의 `fadeTo` — `steps = round(ms/40)`, `setInterval(…, 40)`).
 */
export const BGM_FADE_STEP_MS = 40

/**
 * **실제로 걸리는** 페이드 길이(ms).
 *
 * 300 을 40ms 씩 나누면 8스텝이라 **320ms** 가 걸린다 — 적어 둔 300 이 아니다.
 * 그 20ms 차이 때문에 재 보면 늘 상한을 조금 넘었다([FACT] EV-004720 — 5061ms).
 * 당길 때는 **적어 둔 값이 아니라 실제로 걸리는 값**을 빼야 한다.
 */
export const 실제페이드ms =
  Math.max(1, Math.round(BGM_STOP_FADE_MS / BGM_FADE_STEP_MS)) * BGM_FADE_STEP_MS

/**
 * 정지를 쏠 때 **실제로 당기는 양**(ms) — 실제 페이드 + 한 틱.
 *
 * 타이머는 부탁한 시각에 정확히 오지 않는다. 한 틱(40ms)을 더 당겨서 **꼬리 안쪽에서
 * 끝나게** 한다. 음악이 40ms 일찍 조용해지는 것과 5초를 넘기는 것 중에서는 앞이 맞다 —
 * 수용 기준이 *"페이드 때문에 5초가 더 붙지 않는다"* 이기 때문이다.
 * **기준을 구현에 맞춰 낮추는 대신 구현을 기준 안으로 넣는다.**
 */
export const 당길ms = 실제페이드ms + BGM_FADE_STEP_MS

/**
 * **이번 정지에 쓸 페이드 길이**(ms). 꼬리가 페이드보다 짧으면 그 꼬리에 맞춰 줄인다.
 *
 * 예전엔 꼬리가 0이어도 재생기가 늘 300ms(실제 320ms) 페이드를 걸었다 — 화면은
 * *"0초 = 즉시 종료"* 라고 안내하는데(`ScheduleModal.jsx`) 실제로는 0.32초가 더 붙었다
 * (Codex 재현, 2026-09-11 EV-004737). 꼬리 안에 넣겠다면 **꼬리보다 길면 안 된다.**
 */
export function bgmFadeMsFor(endDelayMs) {
  const n = Number(endDelayMs)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(BGM_STOP_FADE_MS, n)
}

/**
 * 페이드가 **얼마나 진행됐는가**(0~1). 지난 시간으로 센다.
 *
 * 재생기와 측정기가 **같은 이 함수**를 쓴다 — 측정기가 제 나름대로 다시 구현하면
 * 재생기를 틱 세기로 되돌려도 측정이 못 잡는다(Codex 지적, EV-004737).
 */
/**
 * **지금부터 마감까지** 쓸 페이드 길이(ms).
 *
 * 길이만 받으면 신호가 배달되는 데 걸린 시간이 꼬리 위에 그대로 얹힌다 —
 * 짧은 꼬리(0.1초)에서는 그것만으로 넘쳤다(Codex 재현, EV-004753).
 * 마감 시각을 받으면 늦게 도착한 만큼 알아서 줄어든다. **추측이 아니라 시각으로 푼다.**
 * 한 틱을 더 빼서 **안쪽에서** 끝낸다 — 조금 일찍 조용해지는 쪽이 맞다.
 */
export function 남은페이드ms(쓸페이드, 마감시각, 지금ms) {
  const 기본 = Math.max(0, Number(쓸페이드) || 0)
  const 마감 = Number(마감시각)
  if (!Number.isFinite(마감)) return 기본
  const 남음 = 마감 - Number(지금ms) - BGM_FADE_STEP_MS
  return Math.max(0, Math.min(기본, 남음))
}

export function 페이드진행(시작ms, 지금ms, 총ms) {
  const 총 = Math.max(1, Number(총ms) || 0)
  return Math.min(1, Math.max(0, (Number(지금ms) - Number(시작ms)) / 총))
}

/**
 * 안내가 끝난 뒤 **정지 신호를 언제 쏠지**(ms).
 *
 * 꼬리 전체(`endDelayMs`) 안에 페이드가 들어가도록 페이드 길이만큼 당긴다.
 * 꼬리가 페이드보다 짧으면 **0** 이다 — 음수로 밀면 안내가 끝나기도 전에 음악이 준다.
 * 그때는 꼬리 전체가 페이드가 되고, 그것이 "5초 안에 포함" 의 뜻에 가장 가깝다.
 */
export function bgmStopAfterMs(endDelayMs) {
  const n = Number(endDelayMs)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(0, n - 당길ms)
}
