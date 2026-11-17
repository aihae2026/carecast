// 설정 읽기 — 매번 다시 prepare하고, 한 번에 될 일을 열세 번 물어보던 것.
//
// 자연어 예약 문장 하나를 파싱할 때마다 settings 단건 조회가 13회 났다:
// 일과방송 5종 × (켜짐·시각) + 정성어 볼륨 3단계. 전부 같은 표의 다른 키다.
// 게다가 `db.prepare(...)`를 호출할 때마다 새로 만들었다 — 문장은 안 바뀌는데.
//
// 값이 바뀌면 안 된다: **캐시하는 것은 준비된 문장이지 값이 아니다.** 설정을 바꾸면
// 다음 조회가 새 값을 봐야 한다(그러지 않으면 볼륨을 바꿔도 방송이 옛 값으로 나간다).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_setread_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { rawSetting, rawSettings } = require('../domain/settingsRead')
const { readVolumeLevels, readVolume, writeVolumes } = require('../domain/volume')
const { readEnabledAutoTimes } = require('../domain/autoBroadcasts')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// db.prepare 호출 횟수를 센다 — 준비된 문장을 재사용하는지 보는 유일한 방법이다
function countPrepares(fn) {
  const db = getDB()
  const orig = db.prepare.bind(db)
  let n = 0
  db.prepare = (sql) => { n++; return orig(sql) }
  try { fn(db) } finally { db.prepare = orig }
  return n
}

test('같은 키를 여러 번 읽어도 문장은 한 번만 준비한다', () => {
  rawSetting(getDB(), 'morning_time')   // 첫 호출에서 만들어 둔다
  const n = countPrepares(db => { for (let i = 0; i < 20; i++) rawSetting(db, 'morning_time') })
  assert.equal(n, 0, `20번 읽는데 prepare가 ${n}번 났다 — 문장을 재사용하지 않는다`)
})

test('여러 키를 한 번에 읽는다', () => {
  const db = getDB()
  db.prepare("INSERT INTO settings (key, value) VALUES ('배치테스트A','1') ON CONFLICT(key) DO UPDATE SET value='1'").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('배치테스트B','2') ON CONFLICT(key) DO UPDATE SET value='2'").run()
  const got = rawSettings(db, ['배치테스트A', '배치테스트B', '없는키'])
  assert.equal(got.get('배치테스트A'), '1')
  assert.equal(got.get('배치테스트B'), '2')
  assert.equal(got.get('없는키'), null, '없는 키는 null이어야 한다 — undefined면 호출부가 갈린다')
})

test('일과방송 시각 조회가 표를 열 번 두드리지 않는다', () => {
  readEnabledAutoTimes(getDB())   // 문장 준비를 끝내 둔다
  const n = countPrepares(db => readEnabledAutoTimes(db))
  assert.ok(n <= 1, `조회 한 번에 prepare가 ${n}번 났다 — 키마다 따로 묻고 있다`)
})

test('정성어 볼륨 3단계도 한 번에 읽는다', () => {
  readVolumeLevels(getDB())
  const n = countPrepares(db => readVolumeLevels(db))
  assert.ok(n <= 1, `prepare가 ${n}번 났다`)
})

test('[회귀] 값을 바꾸면 다음 조회가 새 값을 본다 — 캐시하는 건 문장이지 값이 아니다', () => {
  const db = getDB()
  writeVolumes(db, { tts: 42 })
  assert.equal(readVolume(db, 'tts'), 42)
  writeVolumes(db, { tts: 77 })
  assert.equal(readVolume(db, 'tts'), 77, '값이 캐시되면 볼륨을 바꿔도 옛 값으로 방송이 나간다')
})

test('[회귀] 일과방송 목록의 판정은 그대로다 — 켜진 것만, 시각 형식이 맞는 것만', () => {
  const db = getDB()
  const put = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  put('morning_enabled', 'true');  put('morning_time', '07:50')
  put('exercise_broadcast_enabled', 'false')
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '엉터리')
  const times = readEnabledAutoTimes(db)
  const ids = times.map(t => t.id)
  assert.ok(ids.includes('morning'))
  assert.ok(!ids.includes('exercise'), "'false'면 빠져야 한다")
  assert.ok(!ids.includes('lunch'), '시각 형식이 깨진 것은 빠져야 한다')
})
