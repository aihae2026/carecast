// 방송 감시·백업 설정 — 서버는 읽는데 화면에 칸이 없던 넷 (2026-09-23).
//
// ── 무엇이 없었나 ──────────────────────────────────────────────────────────
// `backup_time` · `watchdog_grace_min` · `watchdog_run_grace_min` · `schedule_defer_max_min`
// 은 코드 주석마다 「설정으로 바꾼다」고 적혀 있었다. 그런데 바꾸는 칸이 어디에도 없었다 —
// DB 를 직접 고치지 않으면 기본값으로만 돌았다.
//
// ── 이 파일이 고정하는 것 ────────────────────────────────────────────────────
//   ① 저장된 것이 없으면 **각 기능이 실제로 쓰는 기본값**을 보여 준다(화면과 동작이 갈리지 않게)
//   ② 범위 밖·숫자 아님·깨진 시각은 400 이고, **하나라도 틀리면 아무것도 저장하지 않는다**
//   ③ 안 보낸 칸은 지금 값을 그대로 둔다(P-115 — 키 누락이 지우기가 되면 안 된다)
//   ④ 저장한 값을 **실제로 읽는 쪽**(감시·미룸 상한)이 그대로 받는다
//   ⑤ 백업 시각은 저장하는 즉시 새 시각으로 다시 예약된다 — 예전엔 서버를 켤 때 한 번만 읽었다
//
// 실부작용 없음 — `node-cron` 을 갈아끼워 예약을 세기만 하고, 기동 백업 타이머도 막는다.
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-watchset-'))
process.env.CARECAST_DB_PATH = path.join(TMPDIR, 'test.db')
process.env.CARECAST_NO_HARDWARE = '1'

// ── cron 을 관찰한다 (진짜 예약을 걸지 않는다) ─────────────────────────────
const 예약된 = []
const cronPath = require.resolve('node-cron')
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: {
    schedule: (expr, fn) => {
      const 작업 = { expr, fn, 멈춤: false, stop() { this.멈춤 = true } }
      예약된.push(작업)
      return 작업
    },
  },
}

const { getDB, initDB } = require('../db/schema')
initDB()

const router = require('../routes/settings')
const backup = require('../services/backup')
const watchdog = require('../services/watchdog')
const { DEFAULT_GRACE_MIN, DEFAULT_RUN_GRACE_MIN } = watchdog
const 감시설정 = require('../domain/watchSettings')
// 실제 소비처를 부른다 — 읽기 함수를 직접 부르면 소비처가 설정을 무시해도 초록이 된다(Codex 검수 TEST_GAP).
const { _defer: 스케줄러 } = require('../services/scheduler')

test.after(() => {
  try { fs.rmSync(TMPDIR, { recursive: true, force: true }) } catch { /* 무시 */ }
})

function 핸들러(method, routePath) {
  const layer = router.stack.find(l => l.route?.path === routePath && l.route?.methods?.[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 를 못 찾았다 — 이 검사를 옮길 것`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function 부르기(handle, body) {
  return new Promise((resolve) => {
    let status = 200
    const res = {
      status(c) { status = c; return this },
      json(b) { resolve({ status, body: b }) },
    }
    handle({ body }, res)
  })
}

const 읽기 = () => 부르기(핸들러('get', '/watch'), undefined)
const 저장 = (body) => 부르기(핸들러('post', '/watch'), body)
const 저장된 = (key) =>
  getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
const 지우기 = () => getDB().prepare(
  "DELETE FROM settings WHERE key IN ('backup_time','watchdog_grace_min','watchdog_run_grace_min','schedule_defer_max_min')"
).run()

function 타이머없이(fn) {
  const 원래 = global.setTimeout
  global.setTimeout = () => ({ unref() {} })
  try { return fn() } finally { global.setTimeout = 원래 }
}

// ── ① 기본값 ────────────────────────────────────────────────────────────────
test('① 저장된 것이 없으면 각 기능이 실제로 쓰는 기본값을 보여 준다', async () => {
  지우기()
  const r = await 읽기()
  assert.equal(r.status, 200)
  assert.equal(r.body.backupTime,  backup.DEFAULT_TIME)
  assert.equal(r.body.graceMin,    DEFAULT_GRACE_MIN)
  assert.equal(r.body.runGraceMin, DEFAULT_RUN_GRACE_MIN)
  assert.equal(r.body.deferMaxMin, 감시설정.DEFAULT_DEFER_MAX_MIN)
  // 화면이 범위를 따로 들고 있지 않게 서버가 함께 준다
  assert.equal(r.body.limits.graceMin.min, 1)
})

// ── ② 검사 ──────────────────────────────────────────────────────────────────
test('② 범위 밖·숫자 아님·깨진 시각은 400 이고 아무것도 저장하지 않는다', async () => {
  지우기()
  const 나쁜것들 = [
    { graceMin: 0 }, { graceMin: 61 }, { graceMin: 2.5 }, { graceMin: 'abc' }, { graceMin: '' },
    { runGraceMin: 9 }, { runGraceMin: 241 },
    { deferMaxMin: 0 }, { deferMaxMin: 61 },
    { backupTime: '25:00' }, { backupTime: '4:30' }, { backupTime: '' }, { backupTime: 430 },
  ]
  for (const 나쁜값 of 나쁜것들) {
    // 옳은 칸 하나를 섞는다 — 틀린 칸이 있으면 옳은 칸도 저장되지 않아야 한다
    const r = await 저장({ runGraceMin: 90, ...나쁜값 })
    assert.equal(r.status, 400, `${JSON.stringify(나쁜값)} 이 통과했다`)
    assert.ok(r.body.error, '사람이 읽을 사유가 없다')
    // 화면이 그 칸 바로 아래에 사유를 띄우려면 어느 칸인지 알아야 한다
    assert.equal(r.body.field, Object.keys(나쁜값)[0], `${JSON.stringify(나쁜값)} 의 틀린 칸을 못 짚었다`)
  }
  assert.equal(저장된('watchdog_run_grace_min'), undefined, '틀린 칸이 섞인 요청에서 옳은 칸만 저장됐다')
})

test('② 대조군 — 범위 끝값과 숫자 글자는 받는다', async () => {
  지우기()
  const r = await 저장({ graceMin: '1', runGraceMin: 240, deferMaxMin: 60, backupTime: '23:59' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(저장된('watchdog_grace_min'), '1')
  assert.equal(저장된('watchdog_run_grace_min'), '240')
  assert.equal(저장된('schedule_defer_max_min'), '60')
  assert.equal(저장된('backup_time'), '23:59')
})

// ── ③ 안 보낸 칸 ────────────────────────────────────────────────────────────
test('③ 안 보낸 칸은 지금 값을 그대로 둔다 — null 도 안 보낸 것이다', async () => {
  지우기()
  await 저장({ graceMin: 7, runGraceMin: 90, deferMaxMin: 15, backupTime: '03:10' })
  const r = await 저장({ graceMin: 8, runGraceMin: null })
  assert.equal(r.status, 200)
  assert.equal(저장된('watchdog_grace_min'), '8')
  assert.equal(저장된('watchdog_run_grace_min'), '90')
  assert.equal(저장된('schedule_defer_max_min'), '15')
  assert.equal(저장된('backup_time'), '03:10')
  const 빈요청 = await 저장({})
  assert.equal(빈요청.status, 200)
  assert.equal(저장된('watchdog_grace_min'), '8', '빈 요청이 값을 지웠다')
})

// ── ④ 실제로 읽는 쪽 ────────────────────────────────────────────────────────
test('④ 저장한 유예를 감시(checkMissed)가 실제로 쓴다 — 기본 5분이 아니라 12분 뒤에 안 나감으로 본다', async () => {
  지우기()
  const db = getDB()
  db.prepare("INSERT INTO settings (key, value) VALUES ('morning_enabled','true'),('morning_time','07:50') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
  await 저장({ graceMin: 12 })
  // 07:50 + 11분 — 기본값(5분)이면 이미 누락이다. 12분을 썼으면 아직이다.
  const 아직 = watchdog.checkMissed(db, { now: new Date(2026, 8, 24, 8, 1) })
  assert.equal(아직.length, 0, `저장한 12분을 안 쓰고 더 짧은 유예로 판정했다: ${JSON.stringify(아직)}`)
  // 07:50 + 13분 — 이제는 누락이다(긍정 앵커: 감시가 이 방송을 실제로 보고 있다)
  const 지남 = watchdog.checkMissed(db, { now: new Date(2026, 8, 24, 8, 3) })
  assert.equal(지남.length, 1, `12분이 지났는데 누락으로 안 봤다 — 이 시험이 헛돈다: ${JSON.stringify(지남)}`)
  // 화면이 다시 열어도 같은 값이다
  const r = await 읽기()
  assert.equal(r.body.graceMin, 12)
})

test('④ 저장한 미룸 상한을 스케줄러가 실제로 쓴다 — 비었거나 깨진 값은 기본값', async () => {
  지우기()
  const db = getDB()
  await 저장({ deferMaxMin: 25 })
  assert.equal(스케줄러.deferMaxMin(db), 25, '스케줄러가 저장한 상한을 안 쓴다')
  const r = await 읽기()
  assert.equal(r.body.deferMaxMin, 25)
  for (const 값 of [null, '', 'abc', '0', '-3']) {
    지우기()
    if (값 !== null) db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_defer_max_min', ?)").run(값)
    assert.equal(스케줄러.deferMaxMin(db), 감시설정.DEFAULT_DEFER_MAX_MIN, `'${값}' 에서 기본값이 아니다`)
    assert.equal((await 읽기()).body.deferMaxMin, 감시설정.DEFAULT_DEFER_MAX_MIN, `화면이 '${값}' 에서 스케줄러와 다른 값을 보여 준다`)
  }
})

test('② 쓰다가 실패하면 앞 칸도 남지 않는다 — 한 묶음으로 쓴다', async () => {
  지우기()
  const db = getDB()
  // 세 번째 칸(미룸 상한)을 쓸 때 DB 가 거절하게 한다. 앞의 두 칸은 이미 쓴 뒤다.
  db.exec("CREATE TRIGGER 시험_쓰기실패 BEFORE INSERT ON settings WHEN NEW.key = 'schedule_defer_max_min' BEGIN SELECT RAISE(ABORT, '시험이 일부러 막음'); END")
  try {
    const r = await 저장({ graceMin: 7, runGraceMin: 90, deferMaxMin: 20 })
    assert.equal(r.status, 500)
  } finally { db.exec('DROP TRIGGER 시험_쓰기실패') }
  assert.equal(저장된('watchdog_grace_min'), undefined, '실패한 요청의 앞 칸이 저장됐다 — 화면은 「저장 못 함」인데 일부만 바뀐다')
  assert.equal(저장된('watchdog_run_grace_min'), undefined)
  // 대조군: 트리거를 걷으면 같은 요청이 저장된다
  assert.equal((await 저장({ graceMin: 7, runGraceMin: 90, deferMaxMin: 20 })).status, 200)
  assert.equal(저장된('watchdog_grace_min'), '7')
})

// ── ⑤ 백업 시각 즉시 반영 ────────────────────────────────────────────────────
test('⑤ 백업 시각을 저장하면 옛 예약을 멈추고 새 시각으로 다시 예약한다', async () => {
  지우기()
  예약된.length = 0
  타이머없이(() => backup.startBackupSchedule(getDB()))
  assert.equal(예약된.length, 1)
  const 옛것 = 예약된[0]
  assert.equal(옛것.expr, '30 4 * * *')

  const r = await 저장({ backupTime: '02:15' })
  assert.equal(r.status, 200)
  assert.equal(예약된.length, 2, '새 시각으로 다시 예약하지 않았다 — 서버를 껐다 켜야만 바뀐다')
  assert.equal(예약된[1].expr, '15 2 * * *')
  assert.equal(옛것.멈춤, true, '옛 예약이 살아 있다 — 하루에 백업이 두 번 돈다')
})

test('⑤ 다시 예약한 뒤 늦게 도착한 옛 실행은 백업하지 않는다 — stop 만으로는 대기 중 실행이 남는다', () => {
  예약된.length = 0
  const 실행한것 = []
  const 실행 = (o) => 실행한것.push(o)
  backup.rescheduleBackup(getDB(), { 실행 })
  backup.rescheduleBackup(getDB(), { 실행 })
  assert.equal(예약된.length, 2)
  예약된[0].fn()   // 옛 예약의 콜백이 이미 대기열에 들어가 있다가 이제 도착했다
  assert.equal(실행한것.length, 0, '옛 예약이 돌았다 — 두 시각 모두 백업한다')
  예약된[1].fn()   // 긍정 앵커: 새 예약은 실제로 돈다
  assert.equal(실행한것.length, 1, '새 예약이 안 돈다 — 위 단언이 헛돈다')
})

test('⑤ 백업 시각을 안 보내면 다시 예약하지 않는다', async () => {
  예약된.length = 0
  const r = await 저장({ graceMin: 6 })
  assert.equal(r.status, 200)
  assert.equal(예약된.length, 0, '백업 시각을 안 바꿨는데 다시 예약했다')
})
