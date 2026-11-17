// 예약 감시가 조용히 꺼진 것을 볼 수 있게 한다 (P-24, 2026-09-10).
//
// **무엇이 조용한가**: `recordBoot` 이 실패하면(표가 없다·DB 가 잠겼다) `bootRowId` 가
// 영구 `null` 이고, 그러면 `heartbeat` 이 **매분 아무것도 안 한다.** 가동 구간이 안 쌓이니
// `wasUpAt` 은 언제나 `null` 이고, `checkMissedSchedules` 는 `!== true` 로 **예약을 통째로
// 건너뛴다.** 남는 흔적은 기동 때 `console.warn` 한 줄뿐인데 그 창은 아무도 안 본다.
//
// 그래서 **"감시가 꺼진 것"과 "누락이 없는 것"이 화면에서 똑같아 보인다.**
// 이 저장소에서 가장 비싼 오판이 그 종류다(무음·조용한 실패).
//
// **고친 것은 판정이 아니라 가시성이다.** `/api/health` 의 `ok` 는 안 건드린다 —
// 손상된 기록은 재시작해도 안 낫고, 503 을 주면 시작 bat 이 무한 재시작을 돈다.
// 그 규칙은 이미 `db` 필드가 따르고 있다(알리기만 한다).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_bootvis_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const boot = require('../services/serverBoot')
const watchdog = require('../services/watchdog')

initDB()
test.after(() => {
  boot._reset()
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

test('앵커: 기동 기록을 남겼으면 감시가 켜졌다고 말한다', () => {
  boot._reset()
  getDB().prepare('DELETE FROM server_boot').run()
  const id = boot.recordBoot(getDB())
  assert.ok(id, '기동 기록이 안 남았다 — 이 검사의 앵커가 무너졌다')

  const s = boot.bootStatus(getDB())
  assert.equal(s.recorded, true)
  assert.equal(s.scheduleWatchdog, 'on')
  assert.equal(s.note, null, '정상인데 경고 문구가 붙었다 — 잔소리가 된다')
  assert.ok(s.last && s.last.startedAt, '마지막 가동 행을 안 싣는다')
})

test('P-24: 기동 기록을 못 남겼으면 그 사실을 말한다 — 조용히 넘어가지 않는다', () => {
  boot._reset()   // recordBoot 이 실패한 것과 같은 상태(bootRowId === null)
  const s = boot.bootStatus(getDB())
  assert.equal(s.recorded, false)
  assert.equal(s.scheduleWatchdog, 'off',
    '감시가 못 도는데 켜졌다고 말한다 — 사람이 "누락이 없다"로 읽는다')
  assert.match(s.note, /예약 누락 감시/, '무엇이 안 도는지 안 알려준다')
})

test('P-24: 표에 옛 행이 있어도 이번 가동이 기록 안 됐으면 off 다', () => {
  // 어제 것이 남아 있다고 오늘 감시가 도는 것은 아니다 — 이번 가동의 구간이 안 쌓인다.
  boot._reset()
  const s = boot.bootStatus(getDB())
  assert.ok(s.last, '표에 옛 행이 있어야 이 검사가 뜻이 있다')
  assert.equal(s.scheduleWatchdog, 'off', '옛 행을 보고 켜졌다고 말한다')
})

test('P-24: 그 상태에서 예약 감시가 실제로 통째로 건너뛴다 — 이것이 숨어 있던 결과다', () => {
  const db = getDB()
  db.prepare('DELETE FROM server_boot').run()
  db.prepare('DELETE FROM schedules').run()
  db.prepare("DELETE FROM settings WHERE key LIKE 'watchdog_alerted_schedule_%'").run()

  const 오늘 = new Date()
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES ('가동기록없음시험', '내용', '전체', '09:10', 1, ?, ?, 'text')
  `).run(ymd(오늘), JSON.stringify([0, 1, 2, 3, 4, 5, 6]))

  const 열시 = new Date(오늘); 열시.setHours(10, 0, 0, 0)
  assert.equal(watchdog.checkMissedSchedules(db, { now: 열시 }).length, 0,
    '가동 기록이 없으면 감시는 아무것도 안 한다 — 이 사실 자체는 옳다(모르는 것으로 경보를 내지 않는다). '
    + '문제는 그것이 화면에서 "누락 없음"과 구별되지 않는 것이고, bootStatus 가 그 구별을 만든다')
})

test('조회가 깨져도 던지지 않는다 — 상태를 보려다 서버가 멎으면 본말전도다', () => {
  const 망가진DB = { prepare() { throw new Error('일부러 낸 오류') } }
  const s = boot.bootStatus(망가진DB)
  assert.equal(s.scheduleWatchdog, 'unknown', '모르는 것을 on/off 로 단정한다')
  assert.match(s.note, /조회 실패/)
})

test('/api/health 가 그 상태를 싣는다 — 사람이 보는 자리는 여기다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'health.js'), 'utf8')
  const LF = String.fromCharCode(10)
  const 본문 = src.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  assert.match(본문, /bootStatus\(/, '건강검진이 가동 기록 상태를 안 읽는다')
  assert.match(본문, /^\s*boot,$/m, '읽고도 응답에 안 싣는다')
  // 판정에는 안 넣는다 — 넣으면 시작 bat 이 무한 재시작을 돈다.
  assert.doesNotMatch(본문, /state\.ok && boot/, '가동 기록을 생존 판정에 넣었다 — 부팅 루프가 된다')
})
