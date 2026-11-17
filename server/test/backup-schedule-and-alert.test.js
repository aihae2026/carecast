// P-91 ①② — 알림 래퍼와 스케줄 시각 파싱이 무테스트였다 (2026-09-10).
//
// ① `runBackupAndReport()` 는 실패 시 `alert.raise` 를 부르는 래퍼인데 **부르는 테스트가 0건**
//    이었다. `backup.test.js` 는 순수 함수 `runBackup()` 만 부른다. 즉 백업이 조용히 안 되고
//    있어도 **경보가 실제로 나가는지 아무도 안 봤다** — 그게 이 기능의 존재 이유인데.
// ② `startBackupSchedule`·`startRetentionSchedule` 도 호출 0건이었다. 잘못된 `backup_time`
//    (`"25:99"`·빈 값)이 기본값으로 떨어지는지 미검증. 틀리면 **백업이 영영 안 돈다.**
//
// 실부작용 없음 — `node-cron`·`alert` 를 require.cache 로 갈아끼우고, 기동 직후 타이머는
// 이 테스트가 끝난 뒤 도는 것을 막으려고 `setTimeout` 도 잠깐 갈아끼운다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_backupsched_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 경보를 관찰한다 ────────────────────────────────────────────
const raised = []
const alertPath = require.resolve('../services/alert')
require.cache[alertPath] = {
  id: alertPath, filename: alertPath, loaded: true,
  exports: { raise: (kind, message) => raised.push({ kind, message }), MAX_MESSAGE: 300 },
}

// ── cron 을 관찰한다 ───────────────────────────────────────────
const 예약된 = []
const cronPath = require.resolve('node-cron')
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: (expr, fn, opts) => { 예약된.push({ expr, opts }); return { stop() {} } } },
}

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const backup = require('../services/backup')
const retention = require('../services/retention')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

// 기동 직후 1회 타이머가 테스트 뒤에 도는 것을 막는다 — 그 타이머는 여기서 볼 대상이 아니다.
function 타이머없이(fn) {
  const 원래 = global.setTimeout
  const 걸린것 = []
  global.setTimeout = (cb, ms) => { 걸린것.push(ms); return { unref() {} } }
  try { fn() } finally { global.setTimeout = 원래 }
  return 걸린것
}

// ── ① 실패하면 경보가 나간다 ───────────────────────────────────

test('P-91 ①: 백업이 실패하면 alert.raise 가 불린다 — 조용히 안 되는 것이 이 결함의 본질이었다', () => {
  raised.length = 0
  // 쓸 수 없는 경로를 준다. runBackup 은 ok:false 를 내고 래퍼가 경보를 올려야 한다.
  const 결과 = backup.runBackupAndReport({ db: getDB(), dir: path.join(TEST_DB_PATH, '없는', '폴더') })
  assert.equal(결과.ok, false, '이 표본은 실패해야 의미가 있다 — 성공했으면 표본이 틀렸다')
  assert.equal(raised.length, 1, `경보가 ${raised.length}건 나갔다 — 실패를 알리지 않으면 백업이 없는 줄도 모른다`)
  assert.equal(raised[0].kind, '백업')
  assert.match(raised[0].message, /백업/, '사람이 읽고 무슨 일인지 알 수 있어야 한다')
})

test('P-91 ①: 백업이 성공하면 경보를 안 올린다 — 대조군', () => {
  raised.length = 0
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bk-'))
  const 결과 = backup.runBackupAndReport({ db: getDB(), dir })
  assert.equal(결과.ok, true, `성공해야 하는데 실패했다: ${결과.reason}`)
  assert.equal(raised.length, 0, '멀쩡한 백업에 경보를 올리면 사람이 경보를 안 믿게 된다')
})

// ── ② 잘못된 시각은 기본값으로 떨어진다 ────────────────────────

test('P-91 ②: backup_time 이 잘못돼도 기본 시각으로 예약된다 — 안 그러면 백업이 영영 안 돈다', () => {
  for (const 나쁜값 of ['25:99', '', 'abc', '9:5', '24:00']) {
    예약된.length = 0
    writeSetting(getDB(), 'backup_time', 나쁜값)
    타이머없이(() => backup.startBackupSchedule(getDB()))
    assert.equal(예약된.length, 1, `"${나쁜값}" 에서 cron 예약이 ${예약된.length}건이다`)
    assert.match(예약된[0].expr, /^\d+ \d+ \* \* \*$/, `cron 식이 깨졌다: ${예약된[0].expr}`)
    assert.equal(예약된[0].opts &&예약된[0].opts.timezone, 'Asia/Seoul', '시간대가 빠지면 UTC 로 돈다')
  }
})

test('P-91 ②: 제대로 된 backup_time 은 그 시각으로 예약된다 — 대조군', () => {
  예약된.length = 0
  writeSetting(getDB(), 'backup_time', '03:07')
  타이머없이(() => backup.startBackupSchedule(getDB()))
  assert.equal(예약된[0].expr, '7 3 * * *', `설정한 시각이 안 들어갔다: ${예약된[0].expr}`)
})

test('P-91 ②: 보관 정리도 같은 규칙이다', () => {
  예약된.length = 0
  writeSetting(getDB(), 'retention_time', '25:99')
  타이머없이(() => retention.startRetentionSchedule(getDB()))
  assert.equal(예약된.length, 1, '보관 정리가 예약되지 않았다')
  assert.match(예약된[0].expr, /^\d+ \d+ \* \* \*$/, `cron 식이 깨졌다: ${예약된[0].expr}`)

  예약된.length = 0
  writeSetting(getDB(), 'retention_time', '04:21')
  타이머없이(() => retention.startRetentionSchedule(getDB()))
  assert.equal(예약된[0].expr, '21 4 * * *', `설정한 시각이 안 들어갔다: ${예약된[0].expr}`)
})

// ── P-88 · P-89 — 조용한 실패 둘을 막는다 (2026-09-10) ──────────────────

test('P-88: 보관 정리가 실패하면 경보가 나간다 — 백업만 알리던 비대칭을 없앤다', () => {
  raised.length = 0
  // 정리 SQL 이 실패하도록 망가진 핸들을 준다. prepare 가 던지면 catch 로 간다.
  const 망가진 = { prepare: () => { throw new Error('DB 가 잠겼습니다') } }
  const r = retention.runRetention({ db: 망가진, now: new Date('2026-09-03T05:00:00+09:00') })
  assert.ok(r.error, '이 표본은 실패해야 의미가 있다')
  const 보관경보 = raised.filter((x) => x.kind === '보관')
  assert.equal(보관경보.length, 1,
    `정리 실패 경보가 ${보관경보.length}건이다 — 무인 현장 PC 에서 콘솔은 아무도 안 본다.`
    + ' 몇 달 뒤 DB 가 부풀어 느려질 때에야 알게 된다')
  assert.match(보관경보[0].message, /정리/, '사람이 읽고 무슨 일인지 알 수 있어야 한다')
})

test('P-88: 정리가 성공하면 경보를 안 올린다 — 대조군', () => {
  raised.length = 0
  retention.runRetention({ db: getDB(), now: new Date('2026-09-03T05:00:00+09:00') })
  assert.deepEqual(raised.filter((x) => x.kind === '보관'), [],
    '멀쩡한 정리에 경보를 올리면 사람이 경보를 안 믿게 된다')
})

test('P-89: 같은 이름의 백업이 깨져 있으면 건너뛰지 않고 다시 뜬다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bk2-'))
  const now = new Date('2026-09-03T05:00:00+09:00')
  // 첫 백업으로 파일 이름을 알아낸 뒤, 그 자리에 **깨진 파일**을 놓는다.
  const 첫 = backup.runBackup({ db: getDB(), dir, now })
  assert.equal(첫.ok, true, `표본 준비 실패: ${첫.reason}`)
  fs.writeFileSync(첫.file, 'VACUUM 도중 죽어서 남은 쓰레기')

  const 둘 = backup.runBackup({ db: getDB(), dir, now })
  assert.equal(둘.ok, true, `깨진 파일을 만나면 다시 떠야 한다: ${둘.reason}`)
  assert.notEqual(둘.skipped, true,
    '깨진 파일을 "이미 있다"며 건너뛰었다 — 사람은 백업이 있는 줄 안다(가장 비싼 착각)')
  assert.equal(backup.verifyBackup(둘.file).ok, true, '다시 뜬 파일도 안 멀쩡하다')
})

test('P-89: 멀쩡한 백업이 이미 있으면 그대로 건너뛴다 — 대조군', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bk3-'))
  const now = new Date('2026-09-03T05:00:00+09:00')
  assert.equal(backup.runBackup({ db: getDB(), dir, now }).ok, true)
  const 둘 = backup.runBackup({ db: getDB(), dir, now })
  assert.equal(둘.skipped, true, '멀쩡한데도 매번 다시 뜨면 같은 분에 두 번 부를 때 낭비다')
})
