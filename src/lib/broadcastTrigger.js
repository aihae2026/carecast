// **지금 내보내기 — 어느 API 를 부를지 정하는 한 곳.**
//
// 오늘 목록의 한 줄은 둘 중 하나다:
//   · 자동 일과방송 — `{ kind:'auto', id:'morning'|… }` → 그 방송 전용 발사 경로
//   · 예약        — `{ kind:'schedule', id:<숫자> }`     → `POST /api/schedules/:id/trigger`
//
// **새 발사 경로를 만들지 않는다.** 소리를 내는 길이 하나 늘면 정지·겹침·이력 규칙을
// 그만큼 또 지켜야 한다. 여기 있는 것은 전부 `ScheduledBroadcastMini` 가 이미 쓰던 것이고,
// 배타 잠금은 `tests/regression/broadcast-exclusive.test.mjs` 가 고정하고 있다.
//
// 규칙을 이 파일로 뺀 이유: 이제 **두 화면**(쉬운 화면의 예약 미니, 통합 홈의 오늘 목록)이
// 같은 판단을 한다. 두 벌로 두면 한쪽만 고쳐지는 날이 오고, 그때 **한 화면에서는 나가고
// 다른 화면에서는 안 나간다.**
//
// ── `api` 를 맨 위에서 가져오지 않는 이유 ────────────────────────────────────
// `lib/api.js` 는 `fetch`·`localStorage` 를 쓰는 **브라우저 모듈**이다. 맨 위에서 가져오면
// 이 파일도 브라우저 전용이 되어 **노드에서 못 돌린다** — 그러면 아래 판단 규칙을
// 시험이 **실제로 돌려 볼 수 없고**, 소스를 글자로 읽는 가짜 오라클만 남는다
// (이 저장소가 이미 세 번 겪었다). 그래서 **부를 때만** 가져온다.

/** 자동 일과방송 5종 → `lib/api.js` 의 함수 이름. 열쇠는 `domain/autoBroadcasts.js` 의 id 다. */
const AUTO_ENDPOINT = {
  morning:        'triggerMorningBroadcast',
  exercise:       'triggerExerciseBroadcast',
  lunch:          'triggerLunchBroadcast',
  dinner:         'triggerDinnerBroadcast',
  evening_prayer: 'triggerEveningPrayerBroadcast',
}

/**
 * 이 줄을 **지금 내보낼 수 있는가.**
 * 모르는 자동방송 id 면 못 낸다 — **눌러도 아무 일이 없는 단추**를 두는 것보다
 * 단추를 안 그리는 것이 낫다. 순수 함수다(부작용도 브라우저 의존도 없다).
 */
export function canTriggerRow(item) {
  if (!item) return false
  if (item.kind === 'auto') return typeof AUTO_ENDPOINT[item.id] === 'string'
  return item.id != null
}

/**
 * 이 줄을 지금 내보낸다. **부르는 쪽이 사람 확인을 먼저 받았어야 한다**(가이드라인 G-42) —
 * 이 함수는 확인하지 않는다. 전관 스피커로 나가는 것이라 되돌릴 수 없다.
 */
export async function triggerRow(item) {
  if (!canTriggerRow(item)) throw new Error('내보낼 수 없는 줄입니다')
  const api = await import('./api.js')
  if (item.kind === 'auto') return item.startIndex === undefined
    ? api[AUTO_ENDPOINT[item.id]]()
    : api[AUTO_ENDPOINT[item.id]]({ startIndex: item.startIndex, startStepId: item.startStepId })
  return api.triggerSchedule(item.id)
}

/**
 * 자동 일과방송 5종의 발사 손잡이. 쉬운 화면(`ScheduledBroadcastMini`)이 제 표에 끼워 쓴다.
 * **같은 `triggerRow` 를 지난다** — 판단이 한 곳이라는 뜻이다.
 */
export const AUTO_TRIGGER = Object.fromEntries(
  Object.keys(AUTO_ENDPOINT).map(id => [id, () => triggerRow({ kind: 'auto', id })]),
)

/**
 * **확인을 받은 뒤에 무엇을 부를지.** 확인을 받는 일 자체는 화면이 한다(`ConfirmDialog`).
 *
 * 왜 화면 밖인가(V③ R23 지적 1, 2026-09-14): 「누르면 바로 안 나가고 확인을 거친다」를
 * 지키던 가드가 **소스 글자만** 봤다. 검수관이 짚었다 — *"확인 전후 발사 횟수를 단언하지
 * 않는다."* 맞는 말이다. 판단을 여기로 내리면 시험이 **발사 창구를 대역으로 갈아 끼워**
 * 몇 번 불렀는지·어느 쪽을 불렀는지를 실제로 셀 수 있다.
 *
 * **아무것도 안 고른 상태(`물음` 이 비었다)면 한 번도 안 부른다.** 그게 이 함수의 요지다 —
 * 확인 창이 닫혀 있는 동안 전관 방송이 나가는 길이 없어야 한다.
 *
 * @param {null|{줄:object, 자동인가:boolean}} 물음 화면이 쥐고 있는 확인 대상
 * @param {{자동발사:Function, 예약발사:Function}} 창구 부를 곳. 시험은 대역을 넣는다
 * @returns {Promise<{부름:number, 어디?:'자동'|'예약'}>}
 */
export async function 확인뒤발사(물음, { 자동발사, 예약발사 } = {}) {
  if (!물음 || !물음.줄) return { 부름: 0 }
  if (물음.자동인가) { await 자동발사(물음.줄); return { 부름: 1, 어디: '자동' } }
  await 예약발사(물음.줄)
  return { 부름: 1, 어디: '예약' }
}
