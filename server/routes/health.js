// GET /api/health — "떠 있음"이 아니라 "돌고 있음"을 답한다.
//
// 왜 필요했나(2026-08-29 리뷰 CC-012): 시작 bat의 재시작 판정이 `netstat | findstr ":3001"
// | findstr "LISTEN"` 하나뿐이었다. 포트는 express가 잡고 있으면 계속 LISTEN이므로,
//   · 이벤트 루프가 멎어도
//   · 스케줄러 cron이 죽어도
//   · 현장 PC 재생 창이 닫혀도
// bat은 "정상"으로 본다. 무인 운영에서 이건 아무도 모르는 무음이 된다.
//
// 그래서 **스케줄러가 마지막으로 돈 시각**을 생존 지표로 쓴다. 정시 방송 6회가 전부 이
// cron에 달려 있으므로, 이게 멈췄다는 것과 방송이 안 나간다는 것은 같은 말이다.
'use strict'

const express = require('express')
const router  = express.Router()

// 몇 분 걸러도 봐준다 — 무거운 방송 시퀀스가 도는 동안 tick이 밀릴 수 있다.
// 3분은 "두 번 연속 걸렀다"는 뜻이라 우연이 아니다.
const STALE_MS = 3 * 60 * 1000
// 기동 직후엔 아직 tick이 없다. 이때 503을 주면 bat이 죽이고 다시 띄우는 **부팅 루프**가 된다.
const BOOT_GRACE_MS = 2 * 60 * 1000

/**
 * 생존 판정. 순수 함수라 시계를 주입해 테스트한다.
 * @returns {{ok:boolean, reason:string, sinceTickMs:number|null}}
 */
function healthState({ now = Date.now(), startedAt = 0, lastTickAt = null } = {}) {
  const upMs = now - startedAt
  if (lastTickAt == null) {
    return upMs < BOOT_GRACE_MS
      ? { ok: true,  reason: '기동 직후 — 첫 스케줄러 tick 대기 중', sinceTickMs: null }
      : { ok: false, reason: '스케줄러가 한 번도 돌지 않았다', sinceTickMs: null }
  }
  const sinceTickMs = now - lastTickAt
  return sinceTickMs < STALE_MS
    ? { ok: true,  reason: '정상', sinceTickMs }
    : { ok: false, reason: `스케줄러가 ${Math.round(sinceTickMs / 1000)}초째 돌지 않았다`, sinceTickMs }
}

router.get('/', (req, res) => {
  const { getLastTickAt } = require('../services/scheduler')
  const state = healthState({
    startedAt:  Date.now() - Math.round(process.uptime() * 1000),
    lastTickAt: getLastTickAt(),
  })

  // DB는 **판정에 넣지 않고 알리기만 한다.** 손상된 DB는 재시작해도 안 낫는데, 503을 주면
  // bat이 무한 재시작을 돌게 된다. 사람이 봐야 하는 정보라 본문에는 싣는다.
  let db = 'ok'
  try { require('../db/schema').getDB().prepare('SELECT 1').get() }
  catch (e) { db = `error: ${e.message.slice(0, 120)}` }

  // 현장 PC 재생 창이 붙어 있는지 — 0이면 방송이 무음이다. 이것도 알리기만 한다
  // (창이 닫힌 것은 서버를 재시작해서 고칠 수 있는 문제가 아니다. 경보 배너가 따로 알린다).
  let localClients = null
  // 그중 생존 신호가 아직 유효한 수. 둘이 다르면 **유령 연결이 쌓여 있다는 뜻이다** —
  // 2026-09-02에 크롬을 다 닫고도 5로 남던 그 상태를 여기서 바로 볼 수 있게 한다(H15).
  let localClientsAlive = null
  // 그중 **소리를 낼 수 있다고 알린** 창의 수(현장 사고 2026-09-15). `localClientsAlive` 와
  // 다르면 **창은 붙어 있는데 소리가 잠긴 것**이다 — 그날 07:50 방송이 그 상태로 지나갔고
  // 이력에는 성공으로 남았다. 여기 나오면 사람이 한눈에 본다.
  let localSoundReady = null
  try {
    const sse = require('../services/sse')
    localClients      = sse.localClientCount()
    localClientsAlive = sse.localAliveCount()
    localSoundReady   = sse.소리낼수있는창수()
  } catch { /* 무시 */ }

  // 가동 기록 — **예약 감시가 조용히 꺼졌는지**를 여기서 본다(P-24).
  // `recordBoot` 이 실패하면 생존 표식이 매분 no-op 이 되고, 예약 누락 감시가 통째로
  // 건너뛰어진다. 남는 흔적은 기동 때 console.warn 한 줄뿐이라 아무도 모른다.
  // **판정(ok)에는 안 넣는다** — 손상된 기록은 재시작해도 안 낫고, 503 을 주면 시작 bat 이
  // 무한 재시작을 돈다. DB 를 알리기만 하는 것과 같은 규칙이다.
  let boot
  try { boot = require('../services/serverBoot').bootStatus(require('../db/schema').getDB()) }
  catch (e) { boot = { recorded: null, last: null, scheduleWatchdog: 'unknown', note: e.message.slice(0, 120) } }

  // 기동 준비(문안 미리 만들기)가 도는 중인가. **판정(ok)에는 안 넣는다** —
  // 준비 중이어도 서버는 멀쩡히 돌고 방송도 나간다. 화면이 「지금 설정 중입니다」를
  // 띄울 근거로만 쓴다(사용자 지시 2026-09-16).
  let warmup = null
  try { warmup = require('../services/bootWarmup').준비중() } catch { /* 없으면 안 띄운다 */ }

  res.status(state.ok ? 200 : 503).json({
    ok:          state.ok,
    warmup,
    reason:      state.reason,
    uptimeSec:   Math.round(process.uptime()),
    lastTickAt:  getLastTickAt(),
    sinceTickSec: state.sinceTickMs == null ? null : Math.round(state.sinceTickMs / 1000),
    db,
    localClients,
    localClientsAlive,
    localSoundReady,
    boot,
  })
})

module.exports = router
module.exports.healthState  = healthState
module.exports.STALE_MS     = STALE_MS
module.exports.BOOT_GRACE_MS = BOOT_GRACE_MS
