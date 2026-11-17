// 자동방송이 "예정 시각에서 첫 소리까지" 몇 ms 걸렸나.
//
// 왜 필요한가(2026-09-06): 12:00 예약이 12:01 전후에 나가는 문제를 고치는 중인데,
// **그 지연을 재는 자리가 없었다.** broadcasts.prep_ms 는 예약 방송만 재고,
// 자동 5종에는 아무 숫자도 안 남는다. 재지 않으면 고쳐졌는지도 모른다.
//
// 무엇을 재는가: **예정 시각 → 첫 재생 지시**다.
//   · 예정 시각 — settings 의 그 방송 시각(오늘 날짜에 붙인 것)
//   · 첫 재생 지시 — 그 방송의 첫 TTS 단계가 SSE 를 내보낸 순간
// 스케줄러 tick 이 도는 시점이 아니라 **예정 시각**을 기준으로 잡는 이유는, 사람이 느끼는
// 지연이 "12:00이라 했는데 12:01에 나왔다"이지 "tick 이후 몇 ms"가 아니기 때문이다.
//
// 이 파일은 **재기만 한다.** 아무것도 막지 않고 던지지 않는다 — 계측이 방송을 죽이면 안 된다.
'use strict'

// runId → { scheduledAt, laneStartedAt, firstAudioAt }
// 방송 하나가 끝나면 지운다. 동시에 도는 방송은 하나뿐이지만(취소 세대가 그것을 보장한다)
// 키를 runId 로 두면 나중에 겹치더라도 섞이지 않는다.
const 진행중 = new Map()

/** 방송 시작 — 예정 시각과 함께 연다. scheduledAt 은 ms(예정 시각의 오늘 날짜 기준). */
function laneStarted(runId, scheduledAt, now = Date.now()) {
  if (!runId) return
  진행중.set(runId, { scheduledAt: scheduledAt ?? null, laneStartedAt: now, firstAudioAt: null })
}

/** 첫 재생 지시 — **처음 한 번만** 찍는다. 두 번째 TTS 단계는 지연이 아니라 방송 길이다. */
function markFirstAudio(runId, now = Date.now()) {
  const t = 진행중.get(runId)
  if (!t || t.firstAudioAt) return
  t.firstAudioAt = now
}

/**
 * 지금까지 잰 것을 꺼내고 지운다.
 * @returns {{scheduledAt:number|null, playedAt:number|null, delayMs:number|null}}
 */
function takeTiming(runId) {
  const t = 진행중.get(runId)
  진행중.delete(runId)
  if (!t) return { scheduledAt: null, playedAt: null, delayMs: null }
  const playedAt = t.firstAudioAt
  const delayMs = (t.scheduledAt != null && playedAt != null) ? playedAt - t.scheduledAt : null
  return { scheduledAt: t.scheduledAt, playedAt, delayMs }
}

/** 오늘 날짜에 HH:MM 을 붙여 ms 로. 못 읽으면 null(계측을 포기하되 방송은 그대로). */
function scheduledMsToday(hhmm, now = new Date()) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '')
  if (!m) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}

/** 시험용 — 남은 것을 지운다. */
function _reset() { 진행중.clear() }

module.exports = { laneStarted, markFirstAudio, takeTiming, scheduledMsToday, _reset }
