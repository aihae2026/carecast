// 이 서버가 언제부터 언제까지 떠 있었는가. (ISSUE-006, 2026-09-07)
//
// 왜 필요한가: 예약 누락 감시가 "예정 시각이 지났는데 안 나갔다"를 판정하려면 **그 시각에
// 서버가 떠 있었는가**를 먼저 알아야 한다. 없으면 밤새 꺼져 있던 시간의 예약이 전부 누락으로
// 잡힌다 — 이 개발 PC 의 환기방송 09:10·09:20 이 정확히 그 경우다([FACT] EV-001004·EV-001005).
// 감시가 매일 오경보를 내면 사람이 안 본다. 그게 감시를 없애는 것보다 나쁘다.
//
// 기록은 셋이다:
//   · started_at   기동 때 한 번
//   · last_seen_at 스케줄러 tick 이 **매분** 갱신 — "여기까지는 확실히 살아 있었다"
//   · stopped_at   정상 종료 때만(사용자 결정). 비정상 종료면 NULL 로 남는다
//
// 구간의 끝을 last_seen_at 으로 잡는 이유: 비정상 종료(PC 전원 끔·크래시·자동업데이트)에서는
// stopped_at 이 없다. 그때 끝을 "다음 기동 시각"으로 잡으면 **꺼져 있던 밤이 통째로 가동 구간이
// 된다.** 매분 갱신하는 표식이 있으면 그 구간은 마지막 tick 에서 끊긴다(오차 최대 1분).
//
// 이 모듈은 어떤 경우에도 던지지 않는다 — 기록하려다 서버가 죽으면 본말전도다.
'use strict'

let bootRowId = null          // 이 프로세스의 행 id. 실패했으면 null 로 남고 이후 갱신도 건너뛴다
let lastHeartbeatMin = null   // 같은 분에 두 번 쓰지 않는다(매분 tick 이라 어차피 한 번이지만)

/** 로컬 시각을 ISO8601(오프셋 포함)로. Date.parse 로 되읽을 수 있어야 한다. */
function nowISO(d = new Date()) {
  const tz = -d.getTimezoneOffset()
  const sign = tz >= 0 ? '+' : '-'
  const p = (n) => String(Math.abs(n)).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(tz / 60))}:${p(tz % 60)}`
}

function currentBranch() {
  try {
    const fs = require('fs'), path = require('path')
    const head = fs.readFileSync(path.join(__dirname, '..', '..', '.git', 'HEAD'), 'utf8').trim()
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return m ? m[1] : head.slice(0, 12)
  } catch { return null }
}

/** 기동 기록. 프로세스당 한 번만 부른다(두 번 불러도 새 행을 만들지 않는다). */
function recordBoot(db, { now = new Date() } = {}) {
  if (bootRowId !== null) return bootRowId
  try {
    const at = nowISO(now)
    bootRowId = db.prepare(
      'INSERT INTO server_boot (started_at, last_seen_at, git_branch, pid) VALUES (?, ?, ?, ?)'
    ).run(at, at, currentBranch(), process.pid).lastInsertRowid
    return bootRowId
  } catch (e) {
    console.warn('[가동기록] 기동 기록 실패(서버는 계속):', e.message)
    return null
  }
}

// **마지막 생존 표식이 실패했는가**(V③ DEV-MERGE-R10[2]).
// `recordBoot` 만 성공하면 `bootStatus` 가 「감시 켜짐」이라고 말했는데, 그 뒤 `heartbeat`
// 쓰기가 계속 실패하면 **구간의 끝이 안 자란다** — 감시는 "그 시각에 서버가 떠 있었나" 를
// 이 값으로 답하므로, 진짜 누락을 「서버가 꺼져 있었다」로 조용히 치워 버린다.
// 콘솔 경고만으로는 아무도 모른다. 상태를 묻는 창구가 이 값을 함께 봐야 한다.
let lastHeartbeatError = null

/** 살아 있다는 표식. 스케줄러 tick 이 매분 부른다. */
function heartbeat(db, { now = new Date() } = {}) {
  if (bootRowId === null) return
  const minKey = Math.floor(now.getTime() / 60000)
  if (lastHeartbeatMin === minKey) return
  lastHeartbeatMin = minKey
  try {
    db.prepare('UPDATE server_boot SET last_seen_at = ? WHERE id = ?').run(nowISO(now), bootRowId)
    lastHeartbeatError = null
  } catch (e) {
    lastHeartbeatError = e.message
    console.warn('[가동기록] 생존 표식 갱신 실패(서버는 계속):', e.message)
  }
}

/** 정상 종료 기록. 비정상 종료에서는 안 불리고, 그때 stopped_at 은 NULL 로 남는다. */
function recordStop(db, { now = new Date() } = {}) {
  if (bootRowId === null) return
  try {
    const at = nowISO(now)
    db.prepare('UPDATE server_boot SET stopped_at = ?, last_seen_at = ? WHERE id = ?').run(at, at, bootRowId)
  } catch (e) {
    console.warn('[가동기록] 종료 기록 실패:', e.message)
  }
}

/**
 * 최근 가동 구간들. 끝은 stopped_at(정상 종료) 또는 last_seen_at(그 밖)이다.
 * 하루 몇 행이라 최근 것만 읽으면 충분하다 — 감시는 오늘 시각만 묻는다.
 */
function recentIntervals(db, limit = 50) {
  try {
    return db.prepare('SELECT started_at, last_seen_at, stopped_at FROM server_boot ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ from: Date.parse(r.started_at), to: Date.parse(r.stopped_at || r.last_seen_at) }))
      .filter((x) => Number.isFinite(x.from) && Number.isFinite(x.to))
  } catch { return [] }
}

/**
 * 그 순간에 서버가 떠 있었는가.
 *
 * **기록이 하나도 없으면 `null` 을 돌려준다** — "안 떠 있었다"가 아니라 **모른다**이다.
 * 부르는 쪽이 그 둘을 갈라 다뤄야 한다. 0025 이전에 돌던 날들이 여기 걸린다.
 *
 * @returns {boolean|null}
 */
function wasUpAt(db, ms) {
  const ivs = recentIntervals(db)
  if (!ivs.length) return null
  return ivs.some((iv) => iv.from <= ms && ms <= iv.to)
}

// 서버가 **잠깐 껐다 켜진 틈**의 상한. (P-25, 2026-09-10)
//
// 자동 업데이트 재시작은 `git pull` → `npm` → 재기동이라 대개 1~3분이다. 밤새 꺼져 있던
// 것(수 시간)과는 자릿수가 다르다. 10분은 그 사이에서 넉넉히 잡은 값이고, 넘으면
// "꺼져 있었다"로 둔다 — 늘리면 개발 PC 가 매일 오경보를 내던 그 자리로 되돌아간다.
const RESTART_GAP_MIN = 10

/**
 * 그 순간이 **재시작 틈**에 떨어졌나 — 앞뒤로 서버가 떠 있었는데 그 사이만 비었나. (P-25)
 *
 * 왜 필요한가: 가동 구간은 `[started_at, last_seen_at]` 이고 생존 표식이 **분 단위**라,
 * **예정된 그 분에 재시작하면** 그 시각이 두 구간 사이 틈에 떨어진다. 그러면 `wasUpAt` 이
 * `false` 를 내고 감시는 "PC 가 꺼져 있었다"로 보고 **조용히 넘어간다.**
 *
 * 그런데 그 방송은 **진짜로 안 나갔다.** 재시작은 예약이 못 나가는 흔한 원인이고, 이 저장소는
 * main 브랜치에서 10분마다 자동 업데이트를 돈다 — 하필 그 분에 걸릴 수 있다.
 * 그래서 "꺼져 있던 밤"과 "잠깐 껐다 켠 틈"을 갈라, 뒤엣것은 **알린다.**
 */
function inRestartGap(db, ms, gapMin = RESTART_GAP_MIN) {
  const ivs = recentIntervals(db).slice().sort((a, b) => a.from - b.from)
  const 상한 = gapMin * 60000
  for (let i = 1; i < ivs.length; i++) {
    const 앞끝 = ivs[i - 1].to
    const 뒤시작 = ivs[i].from
    if (ms > 앞끝 && ms < 뒤시작 && 뒤시작 - 앞끝 <= 상한) return true
  }
  return false
}

/**
 * 가동 기록이 살아 있나 — **예약 감시가 조용히 꺼졌는지 보는 창구**(P-24, 2026-09-10).
 *
 * 무엇이 조용한가: `recordBoot` 이 실패하면(표가 없다·DB 가 잠겼다) `bootRowId` 가 영구
 * `null` 이고, 그러면 `heartbeat` 이 **매분 아무것도 안 한다**. 가동 구간이 안 쌓이니
 * `wasUpAt` 은 언제나 `null` 이고, `checkMissedSchedules` 는 `!== true` 로 **예약을 통째로
 * 건너뛴다.** 남는 흔적은 기동 때 `console.warn` 한 줄뿐인데 그 창은 아무도 안 본다.
 *
 * 즉 **"감시가 꺼진 것"과 "누락이 없는 것"이 화면에서 똑같아 보인다.** 이 시스템에서 가장
 * 비싼 오판이 그것이다. 판정을 바꾸지는 않고(`/api/health` 의 ok 에 안 넣는다 — 손상된
 * 기록은 재시작해도 안 낫고, 503 을 주면 시작 bat 이 무한 재시작을 돈다) **보이게만 한다.**
 */
function bootStatus(db) {
  const recorded = bootRowId !== null
  let last
  try {
    last = db.prepare(
      'SELECT id, started_at, last_seen_at, stopped_at FROM server_boot ORDER BY id DESC LIMIT 1'
    ).get() ?? null
  } catch (e) {
    return { recorded, last: null, scheduleWatchdog: 'unknown', note: `가동 기록 조회 실패: ${e.message.slice(0, 120)}` }
  }
  return {
    recorded,
    last: last && {
      id: last.id, startedAt: last.started_at, lastSeenAt: last.last_seen_at, stoppedAt: last.stopped_at,
    },
    // 예약 감시가 실제로 판정을 낼 수 있는 상태인가. `recordBoot` 이 실패했으면 이번 가동은
    // 구간이 안 쌓이므로, 표에 옛 행이 있어도 **오늘 예약은 못 본다.**
    // **기동 기록 하나로 「켜짐」이라 하지 않는다**(R10[2]). 생존 표식이 안 써지고 있으면
    // 구간의 끝이 멈춰 있어서, 지금 이 순간이 「서버가 꺼져 있던 시간」으로 읽힌다.
    scheduleWatchdog: (recorded && !lastHeartbeatError) ? 'on' : 'off',
    note: !recorded
      ? '가동 기록을 못 남겼습니다 — 예약 누락 감시가 이번 가동에는 동작하지 않습니다'
      : (lastHeartbeatError
        ? `생존 표식을 못 남기고 있습니다(${String(lastHeartbeatError).slice(0, 80)}) — 예약 누락 감시가 지금을 「꺼져 있던 시간」으로 봅니다`
        : null),
  }
}

/** 테스트용 — 모듈이 들고 있는 프로세스 상태를 지운다. */
function _reset() { bootRowId = null; lastHeartbeatMin = null; lastHeartbeatError = null }

module.exports = { recordBoot, heartbeat, recordStop, wasUpAt, recentIntervals, nowISO, bootStatus,
  inRestartGap, RESTART_GAP_MIN, _reset }
