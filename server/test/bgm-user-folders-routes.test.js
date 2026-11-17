// 사람이 만든 BGM 폴더 — 조회·미리듣기·지우기 막기·단계 저장 검증 (2026-09-22).
//
//   · GET /api/audio/bgm/folders 는 모든 BGM 폴더를 지금 이름·곡 수와 함께 준다
//   · GET /api/audio/bgm/preview?folderId= 는 그 폴더에서만 고른다(비었으면 대신 틀지 않고 비었다고 답한다)
//   · 예약·흐름·자동방송 단계가 고른 폴더는 비어 있어도 지울 수 없다(409, 어디서 쓰는지 이름을 댄다)
//   · 자동방송 단계에 없는 폴더 번호를 저장하면 400
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmfolderroutes_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')

let app
test.before(async () => {
  initDB()
  applyDataFixes(getDB(), DATA_FIXES.filter(f => f.key === 'datafix_bgm_role_folders_20260921'))
  app = await startTestApp({ '/api/audio': require('../routes/audio'), '/api/settings': require('../routes/settings') })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

const db = () => getDB()
const 폴더만들기 = (name) => Number(db().prepare("INSERT INTO content_folders (category, name) VALUES ('bgm', ?)").run(name).lastInsertRowid)
let n = 0
function 곡(folderId, name) {
  n += 1
  const id = db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
    VALUES ('bgm', ?, ?, 0, ?, ?)`).run(`rt${n}.mp3`, name, new Date().toISOString(), folderId).lastInsertRowid
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, 1)").run(id, n)
}
const 받기 = async (p) => { const r = await fetch(app.baseUrl + p); return { status: r.status, body: await r.json() } }
const 지우기 = async (id) => { const r = await fetch(`${app.baseUrl}/api/audio/folders/${id}`, { method: 'DELETE' }); return { status: r.status, body: await r.json() } }
const 단계저장 = (steps) => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lunch: { steps } }),
})

test('폴더 목록 — 두 용도 폴더와 사람이 만든 폴더를 이름·곡 수와 함께', async () => {
  const 클래식 = 폴더만들기('클래식'); 곡(클래식, '클1')
  const { status, body } = await 받기('/api/audio/bgm/folders')
  assert.equal(status, 200)
  const 찾기 = (f) => body.folders.find(f)
  assert.equal(찾기(f => f.id === 클래식)?.count, 1)
  assert.ok(찾기(f => f.role === 'broadcast'), '방송용 폴더가 목록에 없다')
  assert.ok(찾기(f => f.role === 'meal'), '식사용 폴더가 목록에 없다')
})

test('미리듣기 — folderId 로 그 폴더 곡만, 빈 폴더는 대신 틀지 않고 비었다고', async () => {
  const 트로트 = 폴더만들기('트로트'); 곡(트로트, '트1')
  const a = await 받기(`/api/audio/bgm/preview?folderId=${트로트}`)
  assert.equal(a.body.ok, true)
  assert.equal(a.body.name, '트1')
  const 빈 = 폴더만들기('빈미리듣기')
  const b = await 받기(`/api/audio/bgm/preview?folderId=${빈}`)
  assert.equal(b.body.ok, false, '빈 폴더 미리듣기가 다른 폴더 곡을 틀었다 — 들은 것과 고른 것이 다르다')
  assert.match(b.body.reason, /비어 있습니다/)
})

test('쓰이는 폴더는 비어 있어도 못 지운다 — 예약·흐름·자동방송 단계, 어디서 쓰는지 이름을 댄다', async () => {
  const 예약용 = 폴더만들기('예약용')
  db().prepare("INSERT INTO schedules (title, content, scheduled_time, bgm_enabled, bgm_type) VALUES ('점심 안내', 'x', '2026-09-23T11:30', 1, ?)").run(`local_f${예약용}_seq`)
  const r1 = await 지우기(예약용)
  assert.equal(r1.status, 409, '예약이 고른 폴더를 지웠다')
  assert.ok(r1.body.bgmUsedBy.some(s => /예약 「점심 안내」/.test(s)), JSON.stringify(r1.body))

  const 흐름용 = 폴더만들기('흐름용')
  const 흐름 = db().prepare("INSERT INTO flow_sequences (name, created_at, updated_at) VALUES ('오후 체조', datetime('now'), datetime('now'))").run().lastInsertRowid
  db().prepare("INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, 0, 'bgm', '반주', ?)")
    .run(흐름, JSON.stringify({ playlist: [{ bgm_type: `local_f${흐름용}` }] }))
  const r2 = await 지우기(흐름용)
  assert.equal(r2.status, 409, '흐름이 고른 폴더를 지웠다')
  assert.ok(r2.body.bgmUsedBy.some(s => /흐름 「오후 체조」/.test(s)))

  const 단계용 = 폴더만들기('단계용')
  const s = await 단계저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmSource: 'local', bgmFolderId: 단계용 }])
  assert.equal(s.status, 200, await s.text())
  const r3 = await 지우기(단계용)
  assert.equal(r3.status, 409, '자동방송 단계가 고른 폴더를 지웠다')
  assert.ok(r3.body.bgmUsedBy.some(x => /자동방송/.test(x)))

  // BGM 을 꺼 둔 예약은 세지 않는다 — 화면에서 고르개가 숨어 바꿀 길이 없는데 삭제만 막혔다(코드 검수 Medium)
  const 꺼둔 = 폴더만들기('꺼둔예약용')
  db().prepare("INSERT INTO schedules (title, content, scheduled_time, bgm_enabled, bgm_type) VALUES ('BGM 끈 안내', 'x', '2026-09-23T15:00', 0, ?)").run(`local_f${꺼둔}`)
  assert.equal((await 지우기(꺼둔)).status, 200, 'BGM 을 끈 예약 때문에 폴더를 못 지웠다 — 풀 길이 없는 막힘')

  const 안씀 = 폴더만들기('안쓰는폴더')
  assert.equal((await 지우기(안씀)).status, 200, '아무도 안 쓰는 빈 폴더를 못 지웠다')
})

test('자동방송 단계 — 없는 BGM 폴더 번호는 400, 저장된 값은 안 바뀐다', async () => {
  const 좋은 = 폴더만들기('좋은폴더')
  assert.equal((await 단계저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFolderId: 좋은 }])).status, 200)
  for (const 나쁜 of [99999, 'abc', -1]) {
    const r = await 단계저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFolderId: 나쁜 }])
    assert.equal(r.status, 400, `bgmFolderId=${나쁜} 를 받았다`)
  }
  const 저장된 = JSON.parse(db().prepare("SELECT value FROM settings WHERE key='lunch_steps'").get().value)
  assert.equal(저장된[0].bgmFolderId, 좋은)
})

test('엄격한 번호 — true·[7]·"0x7"·"7.0" 은 400, 기본 폴더 번호는 용도로 바꿔 적는다(QA 2026-09-22)', async () => {
  const 좋은 = 폴더만들기('엄격폴더')
  for (const 나쁜 of [true, [좋은], `0x${좋은}`, `${좋은}.0`, `${좋은}abc`]) {
    const r = await 단계저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFolderId: 나쁜 }])
    assert.equal(r.status, 400, `bgmFolderId=${JSON.stringify(나쁜)} 를 받았다 — 조용히 다른 번호가 된다`)
  }
  const 식사 = Number(db().prepare("SELECT value FROM settings WHERE key='bgm_folder_meal'").get().value)
  assert.equal((await 단계저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFolderId: String(식사) }])).status, 200)
  const [s] = JSON.parse(db().prepare("SELECT value FROM settings WHERE key='lunch_steps'").get().value)
  assert.equal(s.bgmRole, 'meal', '기본 폴더 번호를 용도로 안 바꿨다 — 폴더 하나에 값 둘')
  assert.equal(s.bgmFolderId, undefined)
})

test('예약 저장도 BGM 폴더를 본다 — 없는 폴더는 400(방송마다 경보가 나지 않게, QA 미확인 1)', async () => {
  const app2 = await startTestApp({ '/api/schedules': require('../routes/schedules') })
  try {
    const 몸 = (bgm_type) => JSON.stringify({ title: '폴더 확인', content: '안내입니다', scheduled_time: '11:30',
      repeat_start_date: '2026-09-23', repeat_weekdays: [], bgm_enabled: 1, bgm_type })
    const 없는 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 몸('local_f424242') })
    assert.equal(없는.status, 400, '없는 BGM 폴더를 든 예약을 저장했다')
    const 있는폴더 = 폴더만들기('예약확인폴더')
    const 있는 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 몸(`local_f${있는폴더}_seq`) })
    assert.equal(있는.status, 200, await 있는.text())
    const 옛값 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 몸('local_meal') })
    assert.equal(옛값.status, 200, '용도 값 예약을 막았다')
    // BGM 을 끈 예약은 폴더를 안 본다(Codex Medium) — 고르개가 숨어 바꿀 길이 없는데 제목·시간 수정까지 막혔다
    const 끈몸 = JSON.parse(몸('local_f424242')); 끈몸.bgm_enabled = 0
    const 끈 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(끈몸) })
    assert.equal(끈.status, 200, 'BGM 을 끈 예약을 없는 폴더 때문에 막았다')
    // 켬 판정은 저장과 같은 규칙 — 글자 '0' 은 저장에서 켬(1)이 되므로 검사도 켬으로 본다(Codex 2회차)
    const 글자0 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...끈몸, bgm_enabled: '0' }) })
    assert.equal(글자0.status, 400, "bgm_enabled '0' 이 검사는 꺼짐·저장은 켬으로 갈렸다 — 없는 폴더가 켜진 예약으로 저장된다")
    const id = (await 끈.json()).id
    if (id) {
      const 수정 = await fetch(`${app2.baseUrl}/api/schedules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...끈몸, target: '전체', title: '제목만 고침' }) })
      assert.equal(수정.status, 200, 'BGM 을 끈 예약의 제목 수정을 막았다: ' + await 수정.clone().text())
    }
  } finally { await app2.close() }
})
