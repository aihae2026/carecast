// DB 백업 — 잃지 않기 위한 장치.
//
// 왜 필요했나(2026-08-29 리뷰 CC-021): 이 시스템의 **모든 것**이 SQLite 파일 하나에 있다.
// 예약·자동방송 시각·볼륨·API 키·방송 이력·아침 안내문 설정까지 전부. 그런데 백업이
// 코드에 전혀 없었다. CLAUDE.md에 "DB 구조 변경 전 백업하라"는 사람 규율만 있었고,
// `db/backups/`는 gitignore에만 있고 만드는 사람이 없었다.
//
// 무인 6개월 운영에서 이 파일이 깨지면(디스크 불량·정전 중 쓰기·실수로 삭제) 복구 경로가
// 없다. 오늘까지의 작업이 전부 "실패를 알아채게" 하는 것이었다면, 이건 "잃지 않게" 하는 쪽이다.
//
// 방식은 VACUUM INTO다. 파일을 그냥 복사하면 WAL 모드에서 **반쪽짜리 스냅샷**이 나온다
// (커밋되지 않은 -wal 내용이 빠지거나 섞인다). VACUUM INTO는 SQLite가 직접 일관된 스냅샷을
// 새 파일로 쓰고, 덤으로 조각모음까지 한다. 별도 checkpoint가 필요 없다.
'use strict'

const { rawSetting } = require('../domain/settingsRead')

const fs   = require('fs')
const path = require('path')
const cron = require('node-cron')

const DEFAULT_DIR       = path.join(__dirname, '..', 'db', 'backups')
const DEFAULT_KEEP_DAYS = 30          // fileLog·tts-cache와 같은 기간
const DEFAULT_TIME      = '04:30'     // 방송이 없는 시간대. settings의 backup_time으로 바꾼다

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

const FILE_RE = /^carecast_\d{8}_\d{4}\.db$/

/**
 * 백업 파일이 실제로 열리고 내용이 들어 있는지 확인한다.
 *
 * **이게 없으면 "백업이 있다"는 착각만 쌓인다.** 깨진 파일을 30일치 모아둬도 복구가 안 된다.
 * @returns {{ok:boolean, tables:number, reason:string}}
 */
function verifyBackup(file) {
  let db = null
  try {
    const { DatabaseSync } = require('node:sqlite')
    db = new DatabaseSync(file, { readOnly: true })
    const tables = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c
    // 이 시스템이 반드시 갖고 있어야 하는 표 — 하나라도 없으면 복구에 쓸 수 없다
    for (const t of ['settings', 'schedules', 'broadcasts']) {
      db.prepare(`SELECT count(*) c FROM ${t}`).get()
    }
    if (tables < 5) return { ok: false, tables, reason: `테이블이 ${tables}개뿐이다` }
    return { ok: true, tables, reason: '정상' }
  } catch (e) {
    return { ok: false, tables: 0, reason: e.message }
  } finally {
    // **반드시 닫는다.** 검증이 실패한 경우 호출부가 그 깨진 파일을 지우는데, Windows에서는
    // 핸들이 열려 있으면 unlink가 EBUSY로 실패한다. 그러면 지우려던 깨진 백업이 그대로
    // 남아서 "백업이 있다"는 착각만 쌓인다 — 이 함수를 만든 이유와 정반대가 된다.
    try { db?.close() } catch { /* 이미 닫혔으면 무시 */ }
  }
}

/**
 * keepDays보다 오래된 백업을 지운다.
 * 백업이 디스크를 채워서 방송 기록 쓰기를 막으면 본말전도다(fileLog와 같은 이유).
 * @returns {number} 지운 수
 */
function pruneBackups(dir = DEFAULT_DIR, keepDays = DEFAULT_KEEP_DAYS) {
  let removed = 0
  try {
    const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!FILE_RE.test(name)) continue          // 우리가 만든 것만 건드린다
      const f = path.join(dir, name)
      try {
        if (fs.statSync(f).mtimeMs < cutoff) { fs.unlinkSync(f); removed++ }
      } catch { /* 다른 프로세스가 이미 지웠으면 무시 */ }
    }
  } catch { /* 디렉터리가 없으면 지울 것도 없다 */ }
  return removed
}

/**
 * 백업 1회. 성공하면 { ok:true, file, bytes }, 실패하면 { ok:false, reason }.
 * **어떤 경우에도 던지지 않는다** — 백업하다 서버가 죽으면 백업을 넣은 의미가 없다.
 *
 * @param {object} opts.db        열려 있는 DB 핸들(운영은 getDB()). VACUUM INTO를 여기서 실행한다
 * @param {string} opts.dir       보관 위치
 * @param {number} opts.keepDays  보관 기간
 * @param {Date}   opts.now       파일 이름용 시계(테스트 주입)
 */
function runBackup({ db = null, dir = DEFAULT_DIR, keepDays = DEFAULT_KEEP_DAYS, now = new Date() } = {}) {
  let file = null
  try {
    fs.mkdirSync(dir, { recursive: true })
    const conn = db || require('../db/schema').getDB()
    file = path.join(dir, `carecast_${stamp(now)}.db`)

    // VACUUM INTO는 대상 파일이 이미 있으면 실패한다. 같은 분에 두 번 부른 경우(기동 직후 +
    // 예약 시각이 겹칠 때) 조용히 성공으로 처리한다 — 이미 그 시점 스냅샷이 있다.
    // ── P-89: 있다고 해서 멀쩡한 것은 아니다 ─────────────────────────
    // 예전엔 존재만 보고 성공으로 넘어갔다. 그런데 `VACUUM INTO` 도중 프로세스가 강제
    // 종료되면(정전 · 자동 업데이트 재시작 · 자동종료) **같은 파일명으로 손상된 파일이
    // 남는다.** 그 뒤 같은 분 안에 재기동하면(기동 5초 뒤 백업이 돈다) 그 깨진 파일을
    // 보고 "이미 있다"며 넘어가고, 사람은 백업이 있는 줄 안다 — 가장 비싼 착각이다.
    // 그래서 **검증까지 통과해야** 건너뛴다. 깨졌으면 지우고 다시 뜬다.
    if (fs.existsSync(file)) {
      const 기존 = verifyBackup(file)
      if (기존.ok) return { ok: true, file, bytes: fs.statSync(file).size, tables: 기존.tables, skipped: true }
      console.warn(`[백업] 같은 이름의 파일이 있는데 검증에 실패했다(${기존.reason}) — 지우고 다시 뜬다`)
      try { fs.unlinkSync(file) } catch { /* 못 지우면 아래 VACUUM 이 실패로 알린다 */ }
    }

    // SQLite 문자열 리터럴은 역슬래시를 이스케이프로 보지 않으므로 Windows 경로가 그대로 들어간다.
    // 작은따옴표만 SQL 규칙대로 두 번 써서 막는다.
    conn.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)

    const check = verifyBackup(file)
    if (!check.ok) {
      // 깨진 백업은 남겨두면 "있다"는 착각만 준다
      try { fs.unlinkSync(file) } catch { /* 무시 */ }
      return { ok: false, reason: `백업 검증 실패: ${check.reason}` }
    }

    const bytes   = fs.statSync(file).size
    const removed = pruneBackups(dir, keepDays)
    return { ok: true, file, bytes, tables: check.tables, removed }
  } catch (e) {
    return { ok: false, reason: e.message, file }
  }
}

// 실패를 사람에게 알린다. 백업이 조용히 안 되고 있는 것이 이 finding의 본질이었다.
function runBackupAndReport(opts = {}) {
  const r = runBackup(opts)
  if (r.ok) {
    if (!r.skipped) {
      console.log(`[백업] ${path.basename(r.file)} (${Math.round(r.bytes / 1024)}KB, 표 ${r.tables}개)` +
                  (r.removed ? ` · 오래된 ${r.removed}개 정리` : ''))
    }
  } else {
    console.error('[백업] 실패:', r.reason)
    try { require('./alert').raise('백업', `DB 백업에 실패했습니다: ${r.reason}`) }
    catch { /* 경보 통로까지 막힌 상황 — 로그는 위에서 남겼다 */ }
  }
  return r
}

/**
 * 기동 시 1회 + 매일 정해진 시각에.
 *
 * 기동 백업을 함께 두는 이유: 현장 PC는 자동 종료·재시작을 쓰기 때문에, 예약 시각에 PC가
 * 꺼져 있으면 그날 백업이 통째로 없다. 기동 때 한 번 뜨면 최소 하루 한 벌은 남는다.
 * 방송 중인지는 보지 않는다 — VACUUM INTO는 읽기 스냅샷이라 재생을 방해하지 않는다.
 */
function startBackupSchedule(db) {
  setTimeout(() => runBackupAndReport({ db }), 5000)   // 기동 직후 스키마 초기화가 끝나고 나서
  rescheduleBackup(db)
}

// 걸어 둔 매일 백업 예약. 다시 걸 때 옛 것을 멈추려고 붙들어 둔다.
let 매일예약 = null
// 몇 번째로 건 예약인가. 콜백이 자기 세대가 아니면 아무것도 안 한다 — 아래 「stop 만으로는 모자라다」.
let 예약세대 = 0

/**
 * 매일 백업을 **지금 저장된 시각으로** (다시) 예약한다.
 *
 * 예전엔 서버를 켤 때 한 번만 읽었다 — 설정 화면에서 시각을 바꿔도 다음 재시작까지 옛 시각에 돌았다
 * (2026-09-23 설정 화면을 붙이며 고침). 옛 예약을 멈추지 않으면 하루에 두 번 돈다.
 *
 * **stop 만으로는 모자라다**(2026-09-24 Codex 검수 Low). node-cron 4.2.1 은 실행을 따로 타이머에 넣고
 * `stop()` 은 박동 타이머만 걷는다(runner.js:66·131). 04:30 실행이 이미 대기열에 들어간 순간 04:31 로
 * 바꾸면 두 시각 모두 돈다. 그래서 콜백이 제 세대를 확인한다.
 *
 * @param {object} [opts]
 * @param {Function} [opts.실행] 예약 시각에 부를 것. 시험이 실제 백업 없이 세려고 바꿔 넣는다.
 */
function rescheduleBackup(db, { 실행 = runBackupAndReport } = {}) {
  if (매일예약) { try { 매일예약.stop() } catch { /* 이미 멈췄으면 무시 */ } }
  const 내세대 = ++예약세대

  const time = (() => {
    try { return rawSetting(db, 'backup_time') || DEFAULT_TIME }
    catch { return DEFAULT_TIME }
  })()
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  const [hh, mm] = m ? [Number(m[1]), Number(m[2])] : DEFAULT_TIME.split(':').map(Number)

  매일예약 = cron.schedule(`${mm} ${hh} * * *`, () => {
    if (내세대 !== 예약세대) return   // 새 예약이 걸린 뒤 늦게 도착한 옛 실행이다
    실행({ db })
  }, { timezone: 'Asia/Seoul' })
  console.log(`[백업] 매일 ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} DB 백업 (보관 ${DEFAULT_KEEP_DAYS}일, backup_time으로 조정)`)
}

module.exports = {
  runBackup, runBackupAndReport, pruneBackups, verifyBackup, startBackupSchedule, rescheduleBackup,
  DEFAULT_DIR, DEFAULT_KEEP_DAYS, DEFAULT_TIME, FILE_RE,
}
