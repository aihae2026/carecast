// 보관 기간 — 쌓인 것이 언제 지워지는가 (docs/db-retention-design.md, 2026-09-03).
//
// 왜 필요했나: 백업·로그 파일·TTS 캐시에는 30일 회전이 있는데 **DB 안의 행에는 보관 기간이
// 하나도 없었다.** 방송 문구에는 어르신 이름·상태가 섞일 수 있고, 개인정보는 필요한 기간만이다.
// 유일한 삭제 경로였던 전체 초기화는 흔적도 안 남겼다 — 그게 블랙박스다.
//
// 고정하는 사실 여덟:
//  1. 경보와 방송의 기간이 다르다(180 / 365) — 한 표에 섞여 있어도 type으로 갈라 적용한다
//  2. 경계에서 정확하다 — 기준일보다 **하루 이전**은 지우고, 기준일 당일은 남긴다
//  3. 점검 기록은 90일이다
//  4. 날짜가 비어 있는 행은 **안 지운다** — 나이를 모르는 행을 지우면 뭐가 사라졌는지 모른다
//  5. 기간은 설정으로 바뀐다
//  6. **지운 것도 기록한다** — 언제 몇 건인지가 settings에 남는다
//  7. 용량 경고는 넘을 때만, 하루 한 번만 — 그리고 **지우지는 않는다**
//  8. 사람이 지운 것도 기록에 남는다(전체 초기화를 대신하는 기간 삭제)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_retention_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const R = require('../services/retention')
const { writeSetting } = require('../domain/settingsRead')

const NOW = new Date('2026-09-03T05:00:00+09:00')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const daysAgo = (n) => R.cutoffDate(n, NOW)

function clearAll() {
  const db = getDB()
  db.prepare('DELETE FROM broadcasts').run()
  db.prepare('DELETE FROM checkin_runs').run()
  for (const k of Object.values(R.KEYS)) writeSetting(db, k, '')
}

function addBroadcast(type, date) {
  getDB().prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(date, '09:00', type, '내용', '자동', '전체')
}

const countBroadcasts = () => getDB().prepare('SELECT COUNT(*) c FROM broadcasts').get().c

test('사실1·2 — 경보 180일 · 방송 365일, 경계에서 정확하다', () => {
  clearAll()
  addBroadcast('경보', daysAgo(181))   // 지워진다
  addBroadcast('경보', daysAgo(179))   // 남는다 — 아직 반년이 안 됐다
  addBroadcast('예약', daysAgo(200))   // 남는다 — 방송은 1년이다
  addBroadcast('예약', daysAgo(366))   // 지워진다
  addBroadcast('예약', daysAgo(364))   // 남는다

  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(r.alert, 1, '경보 기간이 방송 기간과 같이 적용됐다')
  assert.equal(r.ops, 1)
  assert.equal(countBroadcasts(), 3)
})

test('사실3 — 점검 기록은 90일이다', () => {
  clearAll()
  const ins = getDB().prepare(
    'INSERT INTO checkin_runs (item_name, result, note, checked_at) VALUES (?, ?, ?, ?)')
  ins.run('점검A', 'ok', '', R.cutoffIso(91, NOW))
  ins.run('점검B', 'ok', '', R.cutoffIso(89, NOW))

  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(r.checkin, 1)
  assert.equal(getDB().prepare('SELECT COUNT(*) c FROM checkin_runs').get().c, 1)
})

test('사실4 — 날짜가 비어 있는 행은 안 지운다', () => {
  clearAll()
  addBroadcast('예약', null)
  addBroadcast('경보', null)
  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(r.ops + r.alert, 0)
  assert.equal(countBroadcasts(), 2, '나이를 모르는 행을 지우면 무엇이 사라졌는지 알 수 없다')
})

test('사실5 — 기간은 설정으로 바뀐다', () => {
  clearAll()
  writeSetting(getDB(), R.KEYS.ops, '30')
  addBroadcast('예약', daysAgo(31))
  addBroadcast('예약', daysAgo(29))

  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(r.ops, 1)
  assert.equal(r.policy.ops, 30)
  writeSetting(getDB(), R.KEYS.ops, '')
})

test('사실5-b — 설정값이 이상하면 기본값으로 간다', () => {
  const db = getDB()
  for (const bad of ['0', '-5', 'abc', '']) {
    writeSetting(db, R.KEYS.ops, bad)
    assert.equal(R.policyFor(db).ops, R.DEFAULTS.ops, `'${bad}'에 기본값을 안 썼다`)
  }
  writeSetting(db, R.KEYS.ops, '')
})

test('사실6 — 지운 것도 기록한다', () => {
  clearAll()
  addBroadcast('예약', daysAgo(400))
  R.runRetention({ db: getDB(), now: NOW })

  const { at, summary } = R.lastRun(getDB())
  assert.equal(at, NOW.toISOString(), '언제 정리했는지가 안 남았다')
  assert.equal(summary.ops, 1, '몇 건 지웠는지가 안 남았다')
  assert.equal(summary.policy.alert, R.DEFAULTS.alert, '어느 기준으로 지웠는지가 안 남았다')
})

test('사실7 — 용량 경고는 넘을 때만, 하루 한 번, 지우지는 않는다', () => {
  clearAll()
  addBroadcast('예약', daysAgo(400))   // 경고가 이 행을 지우면 안 된다
  const db = getDB()

  // 크기는 실제 파일로 잰다 — 3MB짜리 가짜 파일을 세워 놓고 경고선을 넘겼다 내렸다 한다
  const big = path.join(os.tmpdir(), `carecast_test_big_${process.pid}.db`)
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024))

  // 경고선 아래 — 조용하다
  writeSetting(db, R.KEYS.sizeWarn, '10')
  assert.equal(R.checkDbSize({ db, now: NOW, file: big }).alerted, false)

  // 경고선 위 — 첫 번째만 알린다
  writeSetting(db, R.KEYS.sizeWarn, '2')
  const first = R.checkDbSize({ db, now: NOW, file: big })
  assert.equal(first.alerted, true)
  assert.equal(first.mb, 3, '본체+wal 합계를 MB로 재야 한다')
  assert.equal(R.checkDbSize({ db, now: NOW, file: big }).alerted, false,
    '같은 날 또 알리면 경보가 도배돼 아무도 안 본다')

  // 다음 날이면 다시 알린다
  const tomorrow = new Date(NOW.getTime() + 86400000)
  assert.equal(R.checkDbSize({ db, now: tomorrow, file: big }).alerted, true)

  // -wal도 함께 센다 — 본체만 재면 무인 운영에서 늘어난 것을 못 본다
  fs.writeFileSync(big + '-wal', Buffer.alloc(2 * 1024 * 1024))
  writeSetting(db, R.KEYS.sizeWarn, '4')
  const withWal = R.checkDbSize({ db, now: new Date(NOW.getTime() + 2 * 86400000), file: big })
  assert.equal(withWal.mb, 5)
  assert.equal(withWal.walMb, 2)
  assert.equal(withWal.alerted, true)
  for (const f of [big, big + '-wal']) { try { fs.unlinkSync(f) } catch { /* 이미 없으면 무시 */ } }

  // **지우지 않는다** — 400일 지난 행이 그대로다(경보 몇 건은 alert.raise가 남긴 것)
  assert.equal(getDB().prepare("SELECT COUNT(*) c FROM broadcasts WHERE type != '경보'").get().c, 1,
    '용량 경고가 이력을 지웠다 — 알리기만 해야 한다')
  writeSetting(db, R.KEYS.sizeWarn, '')
})

test('사실8 — 사람이 지운 것도 남는다', () => {
  clearAll()
  const db = getDB()
  R.recordManualPurge(db, { at: NOW.toISOString(), before: '2026-01-01', removed: 12, by: '사람' })
  const list = R.manualPurges(db)
  assert.equal(list.length, 1)
  assert.equal(list[0].removed, 12)
  assert.equal(list[0].before, '2026-01-01')

  // 기록 자체가 무한히 자라면 같은 문제를 되풀이한다 — 최근 20건만 둔다
  for (let i = 0; i < 25; i++) R.recordManualPurge(db, { at: NOW.toISOString(), removed: i })
  assert.equal(R.manualPurges(db).length, 20)
  assert.equal(R.manualPurges(db)[0].removed, 24, '최근 것이 앞에 와야 한다')
})

test('사실8-b — 기간 없는 전체 삭제 경로가 코드에 없다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'broadcasts.js'), 'utf8')
  assert.doesNotMatch(src, /DELETE FROM broadcasts'\)/,
    '기준 없이 전부 지우는 경로가 남아 있다 — 지운 뒤엔 정리인지 사고인지 알 수 없다')
  assert.match(src, /before=YYYY-MM-DD/, '기준 날짜를 요구하는 안내가 없다')
  assert.match(src, /recordManualPurge/, '사람이 지운 것을 안 남긴다')
})

test('설정 읽기가 실패해도 정리는 던지지 않는다', () => {
  // 정리가 실패해서 방송이 멎으면 본말전도다
  const broken = { prepare() { throw new Error('DB 없음') } }
  const r = R.runRetention({ db: broken, now: NOW })
  assert.ok(r.error, '오류를 기록해야 한다')
  assert.equal(r.ops, 0)
})

// ── P-91 ③ — 0020·0021 표의 삭제 경계 (2026-09-10) ──────────────────────
// `settings_history`(0020)·`broadcast_steps`(0021)는 이 파일에 **이름조차 0회** 등장했다.
// 즉 그 삭제 분기는 아무도 안 봤다. CLAUDE.md DB 규칙이 경고한
// *"후속 UPDATE 가 0건을 고치고 성공으로 끝난다"* 와 같은 종류의 사각지대다.
//
// 고정하는 것 셋: ① 365일 경계에서 정확하다 ② 날짜가 비면 안 지운다
// ③ 지운 건수가 결과에 실린다(안 실리면 "정리인지 사고인지" 구분이 안 된다).

function 설정이력추가(when) {
  getDB().prepare(
    'INSERT INTO settings_history (key, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?)'
  ).run('some_key', '1', '2', 'test', when)
}
function 단계이력추가(when) {
  getDB().prepare(
    'INSERT INTO broadcast_steps (run_key, title, step_no, label, result, ms, detail, started_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('run-1', '아침', 1, '차임', '성공', 10, null, when)
}
const 설정이력수 = () => getDB().prepare('SELECT COUNT(*) c FROM settings_history').get().c
const 단계이력수 = () => getDB().prepare('SELECT COUNT(*) c FROM broadcast_steps').get().c

function 두표비우기() {
  getDB().prepare('DELETE FROM settings_history').run()
  getDB().prepare('DELETE FROM broadcast_steps').run()
}

test('P-91 ③ — settings_history 는 365일 경계에서 정확하고, 지운 수를 보고한다', () => {
  clearAll(); 두표비우기()
  설정이력추가(R.cutoffIso(366, NOW))   // 지워진다
  설정이력추가(R.cutoffIso(364, NOW))   // 남는다
  assert.equal(설정이력수(), 2, '표본이 안 들어갔다 — 이 검사가 무의미해진다')

  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(설정이력수(), 1, '366일 전 행이 안 지워졌거나 364일 전 행까지 지웠다')
  assert.equal(r.changes, 1, `지운 건수를 ${r.changes} 로 보고했다 — 이 숫자가 없으면 사라진 이력이 정리인지 사고인지 모른다`)
})

test('P-91 ③ — broadcast_steps 도 같은 규칙이다', () => {
  clearAll(); 두표비우기()
  단계이력추가(R.cutoffIso(366, NOW))
  단계이력추가(R.cutoffIso(364, NOW))
  const r = R.runRetention({ db: getDB(), now: NOW })
  assert.equal(단계이력수(), 1, '365일 경계가 틀렸다')
  assert.equal(r.steps, 1, `지운 건수를 ${r.steps} 로 보고했다`)
})

test('P-91 ③ — 두 표의 날짜 칸은 NOT NULL 이다 — 그래서 IS NOT NULL 검사는 죽은 코드다', () => {
  // 다른 표(broadcasts·checkin_runs)는 날짜가 비면 안 지운다(사실 4). 두 표는 **애초에 못 빈다.**
  // [FACT] EV-003082 — settings_history.changed_at · broadcast_steps.started_at 둘 다 NOT NULL.
  // 그러므로 `DELETE … WHERE changed_at IS NOT NULL AND …` 의 앞 절은 이 표에서는 **밟히지 않는다.**
  // 지우자는 말이 아니다 — 다른 표와 모양을 맞춘 방어이고, 이 검사는 **그 전제가 바뀌면**
  // (누가 NOT NULL 을 풀면) 알려 주라고 둔다.
  const notNull = (표, 칸) =>
    getDB().prepare(`PRAGMA table_info(${표})`).all().find((c) => c.name === 칸).notnull === 1
  assert.equal(notNull('settings_history', 'changed_at'), true,
    'changed_at 이 NULL 을 받게 바뀌었다 — 그러면 사실 4(날짜 없으면 안 지운다)를 여기서도 검사해야 한다')
  assert.equal(notNull('broadcast_steps', 'started_at'), true,
    'started_at 이 NULL 을 받게 바뀌었다 — 같은 이유로 검사를 늘려야 한다')
})

test('P-94 — 날짜가 빈 문자열이면 나이와 무관하게 지워진다 (알려진 결함)', () => {
  // NULL 은 못 넣지만 **빈 문자열은 들어간다.** 그리고 SQLite 문자열 비교에서
  // '' 는 어떤 ISO 날짜보다 작으므로 `started_at < 기준` 에 **무조건 걸린다.**
  // 오늘 만든 행이라도 날짜를 못 적으면 그날 정리에 사라진다.
  // 지금 그런 행을 쓰는 곳은 없다 — 그래서 LOW 로 등록만 하고 동작은 안 바꾼다(P-94).
  clearAll(); 두표비우기()
  단계이력추가('')
  R.runRetention({ db: getDB(), now: NOW })
  assert.equal(단계이력수(), 0,
    '동작이 바뀌었다 — 빈 날짜를 남기게 고쳤다면 P-94 를 닫고 이 검사를 뒤집을 것')
})
