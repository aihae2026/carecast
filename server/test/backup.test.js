// DB 백업이 실제로 쓸 수 있는 물건인가 (2026-08-29 리뷰 CC-021).
//
// 이 시스템의 모든 것이 SQLite 파일 하나에 있다 — 예약·자동방송 시각·볼륨·API 키·방송
// 이력까지. 그런데 백업이 코드에 전혀 없었다. CLAUDE.md에 사람 규율만 있었고 db/backups/는
// gitignore에만 있고 만드는 사람이 없었다.
//
// 백업은 "만들었다"보다 "되살릴 수 있다"가 중요하다. 그래서 만든 파일을 다시 열어 검증하는
// 경로까지 테스트한다 — 깨진 파일을 30일치 모아두면 백업이 없는 것보다 나쁘다(있다고 믿게 된다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_backup_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const backup = require('../services/backup')

const DIR = path.join(os.tmpdir(), `carecast_bkdir_${process.pid}_${Date.now()}`)

test.before(() => { initDB() })
test.after(() => {
  try { fs.rmSync(DIR, { recursive: true, force: true }) } catch { /* 무시 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('백업을 만들고, 만든 것을 다시 열어 확인까지 한다', () => {
  const r = backup.runBackup({ db: getDB(), dir: DIR, now: new Date(2026, 7, 30, 4, 30) })
  assert.equal(r.ok, true, r.reason)
  assert.ok(fs.existsSync(r.file))
  assert.ok(r.bytes > 0)
  assert.ok(r.tables >= 5, '표가 몇 개 없으면 복구에 쓸 수 없다')
  assert.match(path.basename(r.file), backup.FILE_RE, '이름 규칙이 맞아야 정리 대상으로 잡힌다')
})

test('백업본에서 실제 데이터를 읽을 수 있다 — 이게 "되살릴 수 있다"의 최소 조건', () => {
  getDB().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('backup_probe', '살아있음')

  const r = backup.runBackup({ db: getDB(), dir: DIR, now: new Date(2026, 7, 30, 5, 0) })
  assert.equal(r.ok, true, r.reason)

  const { DatabaseSync } = require('node:sqlite')
  const restored = new DatabaseSync(r.file, { readOnly: true })
  try {
    assert.equal(restored.prepare('SELECT value FROM settings WHERE key = ?').get('backup_probe')?.value, '살아있음')
  } finally { restored.close() }
})

test('깨진 파일은 검증에서 걸러지고 남지 않는다 — 있다고 믿게 만드는 게 제일 나쁘다', () => {
  const bad = path.join(os.tmpdir(), `carecast_bad_${process.pid}_${Date.now()}.db`)
  fs.writeFileSync(bad, '이건 sqlite 파일이 아니다')
  const v = backup.verifyBackup(bad)
  assert.equal(v.ok, false)
  // 검증 후 핸들이 남아 있으면 Windows에서 unlink가 EBUSY로 실패한다 →
  // 호출부가 깨진 백업을 못 지우고 그대로 쌓인다
  assert.doesNotThrow(() => fs.unlinkSync(bad), '검증이 파일 핸들을 붙잡고 있다')
})

test('같은 분에 두 번 불러도 실패하지 않는다 — 기동 백업과 예약 시각이 겹칠 수 있다', () => {
  const now = new Date(2026, 7, 30, 6, 15)
  const a = backup.runBackup({ db: getDB(), dir: DIR, now })
  const b = backup.runBackup({ db: getDB(), dir: DIR, now })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true, 'VACUUM INTO는 대상이 있으면 실패한다 — 그걸 성공으로 접어야 한다')
  assert.equal(b.skipped, true)
})

test('보관 기간이 지난 백업만 지우고 남의 파일은 안 건드린다', () => {
  const dir = path.join(DIR, 'prune')
  fs.mkdirSync(dir, { recursive: true })
  const old  = path.join(dir, 'carecast_20260101_0430.db')
  const now  = path.join(dir, 'carecast_20260830_0430.db')
  const etc  = path.join(dir, '중요메모.txt')
  for (const f of [old, now, etc]) fs.writeFileSync(f, 'x')
  const days = n => new Date(Date.now() - n * 24 * 3600 * 1000)
  fs.utimesSync(old, days(40), days(40))
  fs.utimesSync(etc, days(40), days(40))

  assert.equal(backup.pruneBackups(dir, 30), 1)
  assert.ok(!fs.existsSync(old))
  assert.ok(fs.existsSync(now), '최근 백업을 지우면 복구 경로가 사라진다')
  assert.ok(fs.existsSync(etc), '우리가 만들지 않은 파일은 손대지 않는다')
})

test('디렉터리를 못 써도 던지지 않는다 — 백업하다 서버가 죽으면 본말전도다', () => {
  const blocker = path.join(os.tmpdir(), `carecast_block_bk_${process.pid}_${Date.now()}`)
  fs.writeFileSync(blocker, 'x')            // 파일을 디렉터리 경로로 준다
  const r = backup.runBackup({ db: getDB(), dir: blocker })
  assert.equal(r.ok, false)
  assert.ok(r.reason)
  try { fs.unlinkSync(blocker) } catch { /* 무시 */ }
})

test('보관 기간이 fileLog·tts 캐시와 같다 — 같은 이유(디스크 풀)로 둔 장치다', () => {
  assert.equal(backup.DEFAULT_KEEP_DAYS, require('../services/fileLog').DEFAULT_KEEP_DAYS)
})
