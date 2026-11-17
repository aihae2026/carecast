// 설정을 누가 언제 무엇에서 무엇으로 바꿨나 (docs/db-retention-design.md 5번, 2026-09-03).
//
// settings 표에는 **현재값만** 있었다. 아침방송 시각이 07:50에서 바뀌어 있어도 언제 누가
// 바꿨는지 알 길이 없었고, 볼륨·API 키도 같았다 — 사고 추적의 출발점이 아예 없었다.
//
// 고정하는 사실 여덟:
//  1. 설정을 바꾸면 이전값·새값이 남는다
//  2. **같은 값 저장은 변경이 아니다** — 화면이 되보내는 값까지 세면 기록이 거짓말을 한다
//  3. **비밀키는 값을 안 남긴다** — "바뀌었다"만. 이 표는 백업에 따라 들어가고 화면에도 뜬다
//  4. 기계가 매일 쓰는 흔적 키는 아예 기록하지 않는다 — 넣으면 사람의 변경이 묻힌다
//  5. **1분 안의 같은 변경은 한 줄로 접는다** — 슬라이더 한 번에 수십 행이 생기면 안 된다
//     그때 **처음 값은 그대로 둔다**(어디서 어디로 갔는지가 남아야 한다)
//  6. 긴 값(단계 JSON·방송 문구)은 잘라 둔다 — 이 표는 원문 보관소가 아니다
//  7. 볼륨도 같은 통로를 지난다 — 사람이 가장 자주 만지는 설정이 빠지면 반쪽이다
//  8. 보관 365일 — 방송 이력과 같이 정리된다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_shist_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const H = require('../domain/settingsHistory')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const rowsFor = (key) => getDB()
  .prepare('SELECT * FROM settings_history WHERE key = ? ORDER BY id').all(key)
const clear = () => getDB().prepare('DELETE FROM settings_history').run()

test('사실1 — 바꾸면 이전값·새값이 남는다', () => {
  clear()
  const db = getDB()
  const before = require('../domain/settingsRead').rawSetting(db, 'morning_time')
  writeSetting(db, 'morning_time', '08:10')

  // 연달아 바꾸면 1분 묶음으로 한 줄에 접힌다(사실5) — 여기서 보는 것은 "무엇에서 무엇으로"다
  writeSetting(db, 'morning_time', '08:20')

  const rows = rowsFor('morning_time')
  assert.equal(rows.length, 1, '1분 안의 연속 변경은 한 줄이어야 한다')
  assert.equal(rows[0].old_value, before ?? null, '바뀌기 전 값이 안 남았다')
  assert.equal(rows[0].new_value, '08:20', '마지막 값이 안 남았다')
  assert.equal(rows[0].changed_by, '사람', '주체가 안 남았다')
  assert.ok(rows[0].changed_at, '시각이 안 남았다')
})

test('사실2 — 같은 값 저장은 변경이 아니다', () => {
  clear()
  const db = getDB()
  // **1분 묶음과 갈라서 본다.** writeSetting을 두 번 부르면 묶음 규칙이 먼저 걸려서
  // "같은 값을 걸렀는가"를 확인하지 못한다(2026-09-03 뮤테이션에서 실제로 겪음).
  assert.equal(H.record(db, 'lunch_broadcast_time', '11:10', '11:10'), 'skip',
    '안 바뀐 저장까지 세면 기록이 거짓말을 한다')
  assert.equal(rowsFor('lunch_broadcast_time').length, 0)

  // 값이 실제로 달라지면 남는다
  assert.equal(H.record(db, 'lunch_broadcast_time', '11:10', '11:20'), 'insert')
  assert.equal(rowsFor('lunch_broadcast_time').length, 1)

  // 화면이 빈 값을 어느 모양으로 되보내든(null/'') 같게 본다면 그것도 변경이 아니다
  assert.equal(H.record(db, 'kma_nx', null, null), 'skip')
})

test('사실3 — 비밀키는 값을 안 남긴다', () => {
  clear()
  writeSetting(getDB(), 'gemini_api_key', 'AIza-비밀-1234')
  writeSetting(getDB(), 'switchbot_token', 'tok-비밀')
  writeSetting(getDB(), 'switchbot_secret', 'sec-비밀')

  for (const key of ['gemini_api_key', 'switchbot_token', 'switchbot_secret']) {
    const r = rowsFor(key).at(-1)
    assert.ok(r, `${key} 변경이 아예 안 남았다`)
    assert.equal(r.new_value, H.MASK, `${key} 값이 그대로 남았다`)
  }
  const all = JSON.stringify(getDB().prepare('SELECT * FROM settings_history').all())
  assert.ok(!all.includes('비밀'), '기록 어딘가에 비밀 값이 남아 있다')
})

test('사실4 — 기계가 남기는 흔적 키는 기록하지 않는다', () => {
  clear()
  for (const key of ['morning_last_fired', 'watchdog_alerted_lunch', 'retention_last_run',
    'datafix_something_20260903', 'auto_update_last', 'dinner_last_started',
    // 2026-09-08(P-21): 음원을 틀 때마다 갱신된다. 통로를 writeSetting 으로 옮기면서
    // 흔적 키로 등록했다 — 안 하면 재생마다 기록이 쌓여 사람의 변경이 묻힌다.
    'last_played_staff',
    // 2026-09-26(C1~C3·I1 독립 검수 Medium): 예약이 자동으로 나갈 때마다 결과 연결 번호를 적는다
    // (domain/scheduleOutcome.js). 예약마다 키가 달라 1분 묶음에도 안 걸려, 매일 도는 예약 수만큼 쌓였다.
    'schedule_12_last_broadcast']) {
    writeSetting(getDB(), key, String(Date.now()))
    assert.equal(rowsFor(key).length, 0, `${key}가 기록됐다 — 매일 쓰여 사람의 변경이 묻힌다`)
  }
  // 반대로 사람이 바꾸는 것은 기록된다
  assert.equal(H.isTracked('vol_bgm'), true)
  assert.equal(H.isTracked('evening_prayer_time'), true)
})

test('사실5 — 1분 안의 같은 변경은 한 줄로 접고, 처음 값은 그대로 둔다', () => {
  clear()
  const db = getDB()
  writeSetting(db, 'vol_bgm', '50')     // 첫 줄
  for (let v = 51; v <= 70; v++) writeSetting(db, 'vol_bgm', String(v))

  const rows = rowsFor('vol_bgm')
  assert.equal(rows.length, 1, `슬라이더 한 번에 ${rows.length}줄이 생겼다`)
  assert.equal(rows[0].new_value, '70', '마지막 값이 아니다')

  // 1분이 지나면 새 줄이 생긴다
  const later = new Date(Date.now() + 2 * 60_000)
  H.record(db, 'vol_bgm', '70', '30', '사람', later)
  const after = rowsFor('vol_bgm')
  assert.equal(after.length, 2)
  assert.equal(after[1].old_value, '70')
})

test('사실6 — 긴 값은 잘라 둔다', () => {
  clear()
  const long = '가'.repeat(500)
  writeSetting(getDB(), 'morning_steps', long)
  const r = rowsFor('morning_steps').at(-1)
  assert.ok(r.new_value.length < 250, '단계 JSON 원문이 통째로 들어갔다')
  assert.match(r.new_value, /…\(500자\)$/, '잘렸다는 사실과 원래 길이가 안 보인다')
})

test('사실7 — 볼륨도 같은 통로를 지난다', () => {
  clear()
  const volume = require('../domain/volume')
  volume.writeVolumes(getDB(), { bgm: 44 })
  const keys = getDB().prepare('SELECT DISTINCT key FROM settings_history').all().map(r => r.key)
  assert.ok(keys.some(k => k.includes('bgm')),
    '볼륨이 자기 SQL로 쓰면 변경 기록이 안 남는다 — 사람이 가장 자주 만지는 설정이다')
})

// P-21 (2026-09-08) — 식사 안내(BGM·식전 안내) 설정 6키가 upsert SQL 을 직접 써서
// 이 표를 지나지 않았다. `settingsRead.js:90-92` 가 "여기가 설정 쓰기의 단일 통로다"라고
// 못박아 뒀는데 그 6키만 예외였고, **예외인 줄 아무도 몰랐다** — 빠져도 아무 데도 안 걸린다.
// 볼륨(사실7)과 같은 이유로 고정한다: 사람이 화면에서 자주 만지는 설정이다.
test('사실9 — 식사 안내 설정도 같은 통로를 지난다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes/audio.js'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

  // 긍정 앵커 — 이 파일이 정말 식사 안내 설정을 저장하는 자리인가
  assert.ok(/bgm_\$\{meal\}_start/.test(src), 'audio.js 에 식사 안내 저장이 없다 — 이 가드를 옮길 것')
  assert.ok(src.includes('writeSetting'), 'audio.js 가 writeSetting 을 안 쓴다')

  assert.doesNotMatch(src, /INSERT INTO settings \(key, value\)/,
    'audio.js 가 settings 에 직접 INSERT 한다 — 그 키만 변경 기록이 안 남는다(P-21)')
})

test('사실8 — 보관 정리가 설정 기록도 함께 지운다', () => {
  clear()
  const db = getDB()
  const R = require('../services/retention')
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  db.prepare('INSERT INTO settings_history (key, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?)')
    .run('vol_tts', '50', '60', '사람', old)
  db.prepare('INSERT INTO settings_history (key, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?)')
    .run('vol_tts', '60', '70', '사람', new Date().toISOString())

  const r = R.runRetention({ db, now: new Date() })
  assert.equal(r.changes, 1, '365일 지난 설정 기록이 안 지워졌다')
  assert.equal(rowsFor('vol_tts').length, 1)
})
