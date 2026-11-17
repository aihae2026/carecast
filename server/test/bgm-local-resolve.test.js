// 예약·흐름·즉시방송·홈 배경음방송이 **로컬 폴더**를 고를 수 있다 (2026-09-21).
//
// 이 넷은 전부 `resolveBGM` 하나를 거쳐 BGM 을 푼다. 예전엔 그 함수가 유튜브만 풀었고, 푼 결과를
// 받는 네 곳이 **각자** `bgm_youtube_start` 를 적었다. 그래서 로컬을 더하려면 네 곳을 다 고쳐야
// 했고, 나중에 유튜브를 지울 때 또 네 곳을 고쳐야 했다. 푸는 곳(resolveBGM)과 내는 곳(emitBGM)을
// 각각 하나로 모은다.
//
// 여기서 고정하는 것:
//   1) `local_broadcast`·`local_meal`(+`_seq`) 은 그 용도 폴더의 곡을 `kind:'local'` 로 푼다
//   2) 폴더가 비면 null — **유튜브로 몰래 넘어가지 않는다**
//   3) (외부 동영상 갈래는 2026-09-21 걷어냈다 — 옛 값도 이 PC 방송용 폴더로 읽는다)
//   4) emitBGM 은 늘 `bgm_start` 를 낸다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmresolve_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { resolveBGM } = require('../services/broadcastConfig')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')
const sse = require('../services/sse')

const db = () => getDB()
test.before(() => {
  initDB()
  applyDataFixes(db(), DATA_FIXES.filter(f => f.key === 'datafix_bgm_role_folders_20260921'))
})
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

const 폴더 = (role) => Number(db().prepare('SELECT value FROM settings WHERE key=?').get(`bgm_folder_${role}`).value)
let n = 0
function 곡(role, name) {
  n += 1
  const id = db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
    VALUES ('bgm', ?, ?, 0, ?, ?)`).run(`r${n}.mp3`, name, new Date().toISOString(), 폴더(role)).lastInsertRowid
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, 1)").run(id, n)
}

test('로컬 용도는 그 폴더의 곡을 kind:local 로 푼다', async () => {
  곡('broadcast', 'happy piano'); 곡('broadcast', 'happy kids'); 곡('meal', 'waltz')
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_broadcast', bgm_delay: 3, bgm_end_delay: 2 })
  assert.equal(r.kind, 'local')
  assert.deepEqual(r.files.map(f => f.name).sort(), ['happy kids', 'happy piano'])
  assert.equal(r.delay, 3)
  assert.equal(r.endDelay, 2)
  assert.ok(Number.isFinite(r.bgmDefault))
  assert.equal(r.bgmTitle, r.files[0].name, '제목은 첫 곡이다 — 방송 이력에 무엇이 나갔는지 남는다')

  const m = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_meal_seq' })
  assert.deepEqual(m.files.map(f => f.name), ['waltz'])
})

test('폴더가 비면 null — 유튜브로 넘어가지 않는다', async () => {
  db().prepare('DELETE FROM audio_playlist WHERE audio_file_id IN (SELECT id FROM audio_files WHERE folder_id = ?)').run(폴더('meal'))
  const 전fetch = globalThis.fetch
  let 인터넷 = false
  globalThis.fetch = async () => { 인터넷 = true; return { json: async () => ({ items: [] }) } }
  try {
    assert.equal(await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_meal' }), null)
  } finally { globalThis.fetch = 전fetch }
  assert.equal(인터넷, false, '로컬이 비었다고 인터넷을 탔다')
})


test('emitBGM — 늘 bgm_start 하나다(2026-09-21 외부 동영상 갈래 제거)', () => {
  const { emitBGM } = require('../services/bgmEmit')
  const 받은 = []
  const 원래 = sse.broadcastSSE
  sse.broadcastSSE = (type, data) => 받은.push({ type, data })
  try {
    emitBGM({ kind: 'local', files: [{ url: '/audio/bgm/a.mp3', name: 'a' }], bgmTitle: 'a', bgmDefault: 40 }, { durationSec: 30 })
    emitBGM({ kind: 'local', files: [{ url: '/audio/bgm/b.mp3', name: 'b' }], bgmTitle: 'b', bgmDefault: 50 })
  } finally { sse.broadcastSSE = 원래 }

  assert.equal(받은[0].type, 'bgm_start')
  assert.deepEqual(Object.keys(받은[0].data).sort(), ['bgmDefault', 'durationMin', 'durationSec', 'eventId', 'files'])
  assert.equal(받은[0].data.durationSec, 30)
  assert.equal(받은[1].type, 'bgm_start')
  assert.notEqual(받은[0].data.eventId, 받은[1].data.eventId, '탭 중복재생 방지 번호가 겹친다')
})
