// 보관 기간 — 쌓인 것을 언제 지우는가 (docs/db-retention-design.md, 2026-09-03).
//
// 왜 필요했나: 백업(30일)·로그 파일(30일)·TTS 캐시(30일)에는 회전이 있는데 **DB 안의 행에는
// 보관 기간이 하나도 없었다.** 방송 이력은 무기한으로 쌓였고, 유일한 삭제 경로는 전체 초기화
// 하나뿐이라 "필요한 만큼만 남긴다"는 선택지가 아예 없었다.
//
// 요양원 방송 문구(broadcasts.content)에는 어르신 이름·상태가 섞일 수 있다. 입력 시점
// 민감정보 검사는 있지만 통과한 문구는 영원히 남았다 — **개인정보는 필요한 기간만**이다.
//
// 설계에서 지킨 것 넷:
//  1) **층마다 기간이 다르다.** 지금은 방송과 경보가 broadcasts 한 표에 섞여 있으므로
//     표를 나누는 대신 type으로 갈라 기간을 달리 적용한다(표 분리는 별도 갈래).
//  2) **백업 직후에 지운다.** 04:30 백업 → 04:35 정리. 지우기 전 마지막 모습이 스냅샷에 남는다.
//  3) **지운 것도 기록한다.** 몇 건을 어느 기준으로 지웠는지 남기지 않으면, 사라진 이력이
//     정상 정리인지 사고인지 아무도 구분 못 한다 — 그게 블랙박스다.
//  4) **용량은 알리기만 한다.** 상한을 넘었다고 자동으로 더 지우지 않는다. 조용히 지우는
//     쪽이 언제나 더 위험하다.
'use strict'

const fs   = require('fs')
const path = require('path')
const cron = require('node-cron')

const { rawSetting, writeSetting } = require('../domain/settingsRead')

// 기본 보관 기간(일). settings로 현장에서 조정한다.
const DEFAULTS = {
  ops:        365,   // 방송이 나갔다/못 나갔다 — "작년 이맘때 뭘 틀었나"는 실제로 묻는 질문이다
  alert:      180,   // 경보 — 반년이면 계절 한 바퀴
  checkin:     90,   // 점검 실행 기록 — 기계가 남긴 흔적
  sizeWarnMb:  50,   // database.db 경고선(실측 0.2MB — 250배 여유)
}
const DEFAULT_TIME = '04:35'   // 백업(04:30) 바로 뒤

const KEYS = {
  ops:      'retention_days_ops',
  alert:    'retention_days_alert',
  checkin:  'retention_days_checkin',
  time:     'retention_time',
  sizeWarn: 'retention_size_warn_mb',
  lastRun:  'retention_last_run',
  lastSum:  'retention_last_summary',
  sizeAlert:'retention_size_alert_date',
  manual:   'retention_manual_purges',
}

/** 설정값 하나를 양의 정수로 읽는다. 이상하면 기본값 — 설정 하나 때문에 정리가 멎으면 안 된다. */
function days(db, key, fallback) {
  const n = Number(rawSetting(db, key))
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

function policyFor(db) {
  return {
    ops:        days(db, KEYS.ops,      DEFAULTS.ops),
    alert:      days(db, KEYS.alert,    DEFAULTS.alert),
    checkin:    days(db, KEYS.checkin,  DEFAULTS.checkin),
    sizeWarnMb: days(db, KEYS.sizeWarn, DEFAULTS.sizeWarnMb),
  }
}

/** n일 전 날짜를 'YYYY-MM-DD'로. broadcasts.date가 그 모양이라 문자열 비교로 잘린다. */
function cutoffDate(daysAgo, now = new Date()) {
  const d = new Date(now.getTime() - daysAgo * 86400000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** n일 전 시각을 ISO로. checked_at이 ISO라 그대로 비교한다. */
function cutoffIso(daysAgo, now = new Date()) {
  return new Date(now.getTime() - daysAgo * 86400000).toISOString()
}

/**
 * 오래된 행을 지운다. **어떤 경우에도 던지지 않는다** — 정리가 실패해서 방송이 멎으면 본말전도다.
 * @returns {{ops:number, alert:number, checkin:number, policy:object, error?:string}}
 */
function runRetention({ db = null, now = new Date() } = {}) {
  const conn = db || require('../db/schema').getDB()
  const policy = policyFor(conn)
  const result = { ops: 0, alert: 0, checkin: 0, changes: 0, steps: 0, policy }

  try {
    // 경보와 방송을 갈라 지운다. date가 비어 있는 행은 **건드리지 않는다** —
    // 나이를 모르는 행을 지우면 무엇이 사라졌는지 아무도 모른다.
    result.alert = Number(conn.prepare(
      "DELETE FROM broadcasts WHERE type = '경보' AND date IS NOT NULL AND date < ?"
    ).run(cutoffDate(policy.alert, now)).changes)

    result.ops = Number(conn.prepare(
      "DELETE FROM broadcasts WHERE type != '경보' AND date IS NOT NULL AND date < ?"
    ).run(cutoffDate(policy.ops, now)).changes)

    result.checkin = Number(conn.prepare(
      'DELETE FROM checkin_runs WHERE checked_at IS NOT NULL AND checked_at < ?'
    ).run(cutoffIso(policy.checkin, now)).changes)

    // 설정 변경 기록(0020)은 운영 기록과 같은 365일이다 — 사고 추적의 출발점이라,
    // 방송 이력만 남고 "그때 무엇을 바꿨나"가 먼저 사라지면 반쪽이 된다.
    result.changes = Number(conn.prepare(
      'DELETE FROM settings_history WHERE changed_at IS NOT NULL AND changed_at < ?'
    ).run(cutoffIso(policy.ops, now)).changes)

    // 단계별 실행 기록(0021)도 운영 기록과 같은 365일. 방송 이력만 남고 그 방송이 어느
    // 단계에서 멎었는지가 먼저 사라지면, 남은 한 줄로는 아무것도 되짚을 수 없다.
    result.steps = Number(conn.prepare(
      'DELETE FROM broadcast_steps WHERE started_at IS NOT NULL AND started_at < ?'
    ).run(cutoffIso(policy.ops, now)).changes)
  } catch (e) {
    result.error = e.message
    console.error('[보관] 정리 실패:', e.message)
    // ── P-88: 사람에게도 알린다 ─────────────────────────────────────
    // 예전엔 콘솔 한 줄이 전부였다. 무인 현장 PC 에서 콘솔은 아무도 안 본다 —
    // 정리가 몇 달째 실패해도 모르고, 알게 되는 시점은 DB 가 부풀어 느려질 때다.
    // **백업은 이미 이렇게 알린다**(`backup.js:128-131`) — 같은 시기에 만든 두 기능인데
    // 한쪽만 조용했다. 같은 통로로 맞춘다(DB·SSE·콘솔 세 곳).
    try { require('./alert').raise('보관', `오래된 기록 정리에 실패했습니다: ${e.message}`) }
    catch { /* 경보 통로까지 막힌 상황 — 로그는 위에서 남겼다 */ }
  }

  // 지운 것도 기록한다 — 이 한 줄이 없으면 사라진 이력이 정리인지 사고인지 구분이 안 된다.
  try {
    writeSetting(conn, KEYS.lastRun, now.toISOString())
    writeSetting(conn, KEYS.lastSum, JSON.stringify(result))
  } catch (e) {
    console.error('[보관] 결과 기록 실패:', e.message)
  }

  const total = result.ops + result.alert + result.checkin + result.changes + result.steps
  console.log(total === 0
    ? `[보관] 정리할 것 없음 (방송 ${policy.ops}일 · 경보 ${policy.alert}일 · 점검 ${policy.checkin}일)`
    : `[보관] 방송 ${result.ops}건 · 경보 ${result.alert}건 · 점검 ${result.checkin}건`
      + ` · 설정기록 ${result.changes}건 · 단계기록 ${result.steps}건 정리`
      + ` (${policy.ops}/${policy.alert}/${policy.checkin}일 기준)`)

  return result
}

/**
 * DB 파일이 상한을 넘었는지 본다. **넘어도 지우지 않고 알리기만 한다.**
 * 같은 날 여러 번 알리지 않는다 — 매일 도는 일이라 경보가 도배되면 아무도 안 본다.
 */
function checkDbSize({ db = null, now = new Date(), file = null } = {}) {
  const conn = db || require('../db/schema').getDB()
  const target = file || process.env.CARECAST_DB_PATH
    || path.join(__dirname, '..', 'db', 'database.db')
  try {
    // **본체와 -wal을 함께 잰다.** WAL 모드에서는 최근 쓴 것이 -wal에 있어서 본체만 재면
    // 늘어난 것을 못 본다(2026-09-03 실측: 본체 204KB인데 -wal이 403KB였다).
    // 무인으로 며칠 도는 현장에서 체크포인트가 밀리면 -wal 쪽만 계속 자란다.
    const sizeOf = (f) => { try { return fs.statSync(f).size } catch { return 0 } }
    const main = sizeOf(target)
    const wal  = sizeOf(target + '-wal')
    if (main === 0 && wal === 0) return { mb: null, limit: null, alerted: false, error: '파일 없음' }

    const mb    = (main + wal) / (1024 * 1024)
    const walMb = wal / (1024 * 1024)
    const round = (v) => Math.round(v * 10) / 10
    const limit = policyFor(conn).sizeWarnMb
    const base  = { mb: round(mb), walMb: round(walMb), limit }

    if (mb < limit) return { ...base, alerted: false }

    const today = cutoffDate(0, now)
    if (rawSetting(conn, KEYS.sizeAlert) === today) return { ...base, alerted: false }

    writeSetting(conn, KEYS.sizeAlert, today)
    require('./alert').raise('DB용량',
      `데이터베이스가 ${mb.toFixed(1)}MB로 경고선(${limit}MB)을 넘었습니다`
      + (walMb > mb / 2 ? ` — 그중 ${walMb.toFixed(1)}MB가 -wal입니다(체크포인트 확인)` : ' — 보관 기간을 확인해주세요'),
      {}, conn)
    return { ...base, alerted: true }
  } catch (e) {
    // 파일을 못 읽는 것으로 방송이 멎으면 안 된다
    return { mb: null, limit: null, alerted: false, error: e.message }
  }
}

/**
 * 사람이 기간을 지정해 지운 것을 남긴다(전체 초기화를 대신한다).
 * 최근 20건만 둔다 — 이 기록 자체가 무한히 자라면 같은 문제를 되풀이한다.
 */
function recordManualPurge(conn, entry) {
  try {
    let list = []
    try { list = JSON.parse(rawSetting(conn, KEYS.manual) || '[]') } catch { list = [] }
    if (!Array.isArray(list)) list = []
    list.unshift(entry)
    writeSetting(conn, KEYS.manual, JSON.stringify(list.slice(0, 20)))
  } catch (e) {
    console.error('[보관] 수동 삭제 기록 실패:', e.message)
  }
}

function manualPurges(conn) {
  try {
    const list = JSON.parse(rawSetting(conn, KEYS.manual) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** 마지막 정리 결과 — 화면이 "언제 몇 건 지웠나"를 보여줄 재료. */
function lastRun(conn) {
  let summary
  try { summary = JSON.parse(rawSetting(conn, KEYS.lastSum) || 'null') } catch { summary = null }
  return { at: rawSetting(conn, KEYS.lastRun) || null, summary }
}

function startRetentionSchedule(db) {
  // 기동 직후 한 번 — 정리 시각에 PC가 꺼져 있었으면(현장은 새벽에 자동 종료된다)
  // 다음 부팅 때 밀린 정리가 돈다.
  setTimeout(() => { runRetention({ db }); checkDbSize({ db }) }, 20000)

  const time = (() => {
    try { return rawSetting(db, KEYS.time) || DEFAULT_TIME } catch { return DEFAULT_TIME }
  })()
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  const [hh, mm] = m ? [Number(m[1]), Number(m[2])] : DEFAULT_TIME.split(':').map(Number)

  cron.schedule(`${mm} ${hh} * * *`, () => { runRetention({ db }); checkDbSize({ db }) },
    { timezone: 'Asia/Seoul' })

  const p = policyFor(db)
  console.log(`[보관] 매일 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} 정리`
    + ` (방송 ${p.ops}일 · 경보 ${p.alert}일 · 점검 ${p.checkin}일, 경고선 ${p.sizeWarnMb}MB)`)
}

module.exports = {
  runRetention, checkDbSize, startRetentionSchedule,
  recordManualPurge, manualPurges, lastRun, policyFor,
  cutoffDate, cutoffIso, DEFAULTS, DEFAULT_TIME, KEYS,
}
