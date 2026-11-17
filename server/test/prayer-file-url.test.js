// 식전 음원이 404로 조용히 무음이 되던 것. (전수검수 CC-030)
//
// 무엇이 문제였나: 파일은 **id로** 고르는데 주소는 **카테고리 상수로** 만들었다.
//   let prayerFile = fileId ? (SELECT * FROM audio_files WHERE id = ?) : null   ← 카테고리 무관
//   ...
//   url: `/audio/${prayerCat}/${prayerFile.filename}`                           ← 항상 상수
//
// 음원은 `server/public/audio/<카테고리>/` 아래에 저장된다(업로드 시 category 폴더로 들어간다).
// 그래서 관리자가 점심 식전 음원 파일로 다른 카테고리의 파일을 고르면 주소가
// `/audio/lunch-prayer/그파일.mp3`가 되는데 실제 파일은 `/audio/staff/`에 있다 → **404**.
//
// 더 나쁜 것: 그 뒤에 `bgm_lunch_prayer_fired`를 오늘로 찍는다. 그러니 **그날 식전 음원은 영영
// 안 나가고 기록상으로는 나간 것**이 된다. 소리도 없고 에러도 없다.
//
// 그리고 파일을 아예 못 찾으면 `if (prayerFile)`에서 통째로 건너뛴다 — 로그 한 줄도 없다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_prayerurl_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// SSE는 실제로 내보내지 않고 주워 담는다 — 소리를 내지 않고 "무엇을 보내려 했는지"만 본다
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true,
  exports: { broadcastSSE: (event, data) => { sent.push({ event, data }); return 1 } },
}

const raised = []
const alertPath = require.resolve('../services/alert')
require.cache[alertPath] = {
  id: alertPath, filename: alertPath, loaded: true,
  exports: { raise: (kind, message) => raised.push({ kind, message }), MAX_MESSAGE: 300 },
}

const { initDB, getDB } = require('../db/schema')
const { checkBGMSchedule } = require('../services/bgmScheduler')

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 무시 */ } }
})

const 오늘 = '2026-08-30'

function set(key, value) {
  getDB().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

function 음원추가(category, filename) {
  return getDB().prepare(
    'INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at) VALUES (?, ?, ?, 0, ?)'
  ).run(category, filename, filename, new Date().toISOString()).lastInsertRowid
}

function 점심안내준비({ fileId = '', fired = '' } = {}) {
  sent.length = 0
  raised.length = 0
  set('bgm_lunch_enabled', 'true')
  set('bgm_lunch_start', '11:50')
  set('bgm_lunch_prayer_enabled', 'true')
  set('bgm_lunch_prayer_offset', '5')
  set('bgm_lunch_prayer_file_id', fileId)
  set('bgm_lunch_prayer_fired', fired)
}

const 음원이벤트 = () => sent.find(s => s.event === 'prayer_play')

// ── 주소가 실제 파일 위치를 가리킨다 ─────────────────────────

test('다른 카테고리 파일을 골라도 그 파일이 있는 곳을 가리킨다', async () => {
  const id = 음원추가('staff', '직원안내.mp3')
  점심안내준비({ fileId: String(id) })

  await checkBGMSchedule(getDB(), '11:45', 오늘)   // 11:50 - 5분

  const ev = 음원이벤트()
  assert.ok(ev, '식전 음원 방송 이벤트가 나가야 한다')
  assert.equal(ev.data.url, '/audio/staff/직원안내.mp3',
    '카테고리 상수로 주소를 만들면 파일이 없는 곳을 가리켜 404 무음이 된다')
})

test('같은 카테고리 파일이면 지금까지와 똑같다', async () => {
  const id = 음원추가('lunch-prayer', '점심안내.mp3')
  점심안내준비({ fileId: String(id) })

  await checkBGMSchedule(getDB(), '11:45', 오늘)
  assert.equal(음원이벤트().data.url, '/audio/lunch-prayer/점심안내.mp3')
})

test('파일을 안 고르면 카테고리 첫 번째를 쓰고, 그 주소도 맞다 (기존 동작 보존)', async () => {
  음원추가('lunch-prayer', '기본안내.mp3')
  점심안내준비({ fileId: '' })

  await checkBGMSchedule(getDB(), '11:45', 오늘)
  const ev = 음원이벤트()
  assert.ok(ev)
  assert.match(ev.data.url, /^\/audio\/lunch-prayer\//)
})

// ── 못 찾으면 조용히 넘어가지 않는다 ─────────────────────────

test('틀 파일이 하나도 없으면 사람에게 알린다 — 예전엔 로그 한 줄도 없었다', async () => {
  const db = getDB()
  db.prepare("DELETE FROM audio_files").run()
  점심안내준비({ fileId: '' })

  await checkBGMSchedule(db, '11:45', 오늘)

  assert.equal(음원이벤트(), undefined, '없는 파일을 틀라고 보내면 안 된다')
  assert.equal(raised.length, 1, '조용히 건너뛰면 어르신이 말해 주기 전엔 아무도 모른다')
  // 문구는 무엇이 안 나갔는지(어느 끼니의 식전 음원인지) 밝힌다
  assert.match(raised[0].message, /lunch 식전 음원/, '무슨 방송이 안 나갔는지 문장에 있어야 한다')
})

test('지정한 파일이 지워졌으면 카테고리 첫 번째로 대신 나간다', async () => {
  const db = getDB()
  db.prepare('DELETE FROM audio_files').run()
  음원추가('lunch-prayer', '남아있는안내.mp3')
  점심안내준비({ fileId: '99999' })   // 지워진 id

  await checkBGMSchedule(db, '11:45', 오늘)
  const ev = 음원이벤트()
  assert.ok(ev, '지정 파일이 없다고 식전 음원을 통째로 거르면 안 된다 — 대안이 있다')
  assert.equal(ev.data.url, '/audio/lunch-prayer/남아있는안내.mp3')
})

// ── 하루 한 번 표시는 나갔을 때만 ────────────────────────────

test('안 나갔으면 "오늘 나감" 표시를 하지 않는다', async () => {
  const db = getDB()
  db.prepare('DELETE FROM audio_files').run()
  점심안내준비({ fileId: '' })

  await checkBGMSchedule(db, '11:45', 오늘)

  const fired = db.prepare("SELECT value FROM settings WHERE key='bgm_lunch_prayer_fired'").get()?.value
  assert.notEqual(fired, 오늘,
    '안 나간 방송을 나갔다고 적으면 이력이 거짓말을 하고 다시 시도할 기회도 사라진다')
})
