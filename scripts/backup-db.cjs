#!/usr/bin/env node
// DB 를 **일관된 스냅샷**으로 한 벌 뜬다. 배포 직전·되돌리기 직전에 손으로 부른다.
//
// 왜 필요한가(사용자 지시 2026-09-13): *"실행 중인 database.db 와 -wal, -shm 을 단순히
// 차례로 복사하는 방식을 확정 절차로 두지 말고, 안전한 백업 방식과 복원 검증을 명시해."*
// 맞는 지적이다. 세 파일을 **차례로** 복사하면 그 사이에 서버가 쓴다 — WAL 이 커밋되는
// 중간을 긁으면 셋의 시점이 어긋난 반쪽 스냅샷이 나온다. 크기도 정상이고 열리기도 하는데
// 내용이 깨져 있다. 백업의 가장 비싼 실패 방식이다.
//
// **이미 있는 것을 부른다.** `server/services/backup.js` 가 `VACUUM INTO` 로 뜨고
// 곧바로 열어 검증한다 — 04:30 예약 백업이 쓰는 바로 그 함수다. 여기서는 새로 만들지 않고
// 그 함수를 **시각에 매이지 않고** 부를 수 있게만 한다.
//
// **왜 예약 백업으로는 부족한가**: 현장 PC 는 `auto_shutdown_time`(18:21)에 꺼진다.
// 04:30 에는 PC 가 없다. 그래서 현장에서 예약 백업은 **사실상 안 돈다** — 배포 직전 백업은
// 사람이 이 명령으로 떠야 한다.
//
// 쓰는 법:
//   node scripts/backup-db.cjs            → server/db/backups/ 에 뜬다
//   node scripts/backup-db.cjs <보관폴더>
//
// 서버를 멈추지 않아도 된다. `VACUUM INTO` 는 읽기 스냅샷이라 방송을 방해하지 않는다.
'use strict'

const path = require('path')
const fs   = require('fs')
const { DatabaseSync } = require('node:sqlite')

const 보관폴더 = process.argv[2] || path.join(__dirname, '..', 'server', 'db', 'backups')
const DB = process.env.CARECAST_DB_PATH || path.join(__dirname, '..', 'server', 'db', 'database.db')

if (!fs.existsSync(DB)) {
  console.error('DB 가 없다:', DB)
  process.exit(1)
}

// 서버가 돌고 있을 수 있다. 잠금이 겹치면 5초 기다린다 — 즉시 던지면 백업이 그냥 없어진다.
const db = new DatabaseSync(DB)
try { db.exec('PRAGMA busy_timeout = 5000') } catch { /* 못 걸면 기본값으로 간다 */ }

const { runBackup, verifyBackup } = require(path.join(__dirname, '..', 'server', 'services', 'backup'))

// keepDays 를 크게 준다 — 이건 **사람이 부른 배포 직전 백업**이라, 예약 백업의 보관 규칙에
// 휩쓸려 지워지면 안 된다.
const r = runBackup({ db, dir: 보관폴더, keepDays: 3650 })
db.close()

if (!r.ok) {
  console.error('백업 실패:', r.reason)
  process.exit(1)
}

// ── 복원 검증 — 뜬 파일을 **실제로 열어** 본다 ─────────────────────────────
// `runBackup` 이 이미 `verifyBackup` 을 돌리지만(표 개수·필수 표 조회), 여기서는
// 사람에게 보여 줄 숫자를 따로 찍는다. **"파일이 생겼다" 는 백업이 됐다는 근거가 아니다.**
const 확인 = verifyBackup(r.file)
const 사본 = new DatabaseSync(r.file, { readOnly: true })
let 무결성
const 개수 = {}
try {
  무결성 = 사본.prepare('PRAGMA integrity_check').get()?.integrity_check ?? '못 읽음'
  for (const t of ['settings', 'schedules', 'broadcasts', 'audio_files', 'content_folders']) {
    try { 개수[t] = 사본.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c } catch { 개수[t] = '(표 없음)' }
  }
} finally { 사본.close() }

console.log('\n===== DB 백업 =====')
console.log('  원본   :', DB)
console.log('  사본   :', r.file)
console.log('  크기   :', (r.bytes / 1024).toFixed(1) + ' KB')
console.log('  방식   : VACUUM INTO (SQLite 가 직접 뜬 일관 스냅샷 — 파일 복사 아님)')
console.log('  표 수  :', 확인.tables)
console.log('  무결성 :', 무결성, 무결성 === 'ok' ? '' : '  ← **ok 가 아니면 이 백업은 못 쓴다**')
for (const [t, c] of Object.entries(개수)) console.log('  ' + t.padEnd(16), c)

if (무결성 !== 'ok') {
  console.error('\n**integrity_check 가 ok 가 아니다.** 이 파일로 복구하지 말 것.')
  process.exit(1)
}
console.log('\n※ 음원 파일(server/audio/)은 이 백업에 **안 들어간다** — 따로 복사할 것.\n')
