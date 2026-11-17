// BGM 을 폴더째가 아니라 **곡 하나**로 고른다 (사용자 지시 2026-09-22 「폴더별로도 할 수 있지만 개별적 파일로도」).
//
// 저장값 `local_a<곡 번호>` — 차례(`_seq`)가 없다. 고정하는 것:
//   1) 저장값 규칙: local_a<번호> 만 곡 값이다(폴더 값·용도 값과 섞이지 않는다)
//   2) 예약·흐름(resolveBGM)은 그 곡 하나만 튼다 — 재생목록에서 꺼 둔 곡이라도 사람이 고른 것이면 튼다
//   3) 곡이 없어졌으면 방송용으로 대신 틀고 경보를 낸다(무음으로 떨어뜨리지 않는다)
//   4) 자동방송 단계(bgmFileId)도 같은 규칙 — 대신 틀 곳은 그 방송의 기본 용도(점심=식사용)
//   5) GET /bgm/folders 는 곡 목록도 준다 · /bgm/preview?fileId= 는 그 곡(대신 틀지 않는다)
//   6) 자동방송 단계에 없는 곡 번호를 저장하면 400 · 예약 저장도 없는 곡이면 400
//   7) 화면 규칙(bgmTypes): 곡 값에는 차례가 붙지 않는다 · 단계 값으로 오간다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmsong_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

const { initDB, getDB } = require('../db/schema')
const { resolveBGM } = require('../services/broadcastConfig')
const { 곡값, 폴더값 } = require('../domain/bgmRoles')
const { stepBGMStart } = require('../services/broadcastSteps')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  applyDataFixes(getDB(), DATA_FIXES.filter(f => f.key === 'datafix_bgm_role_folders_20260921'))
  app = await startTestApp({ '/api/audio': require('../routes/audio'), '/api/settings': require('../routes/settings') })
})
const { audioFilePath } = require('../domain/audioPaths')
const 만든파일 = []
test.after(async () => {
  if (app) await app.close()
  for (const p of 만든파일) { try { fs.unlinkSync(p) } catch { /* 이미 없으면 그만 */ } }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})
test.beforeEach(() => { sent.length = 0 })

const db = () => getDB()
const 용도폴더 = (role) => Number(db().prepare('SELECT value FROM settings WHERE key=?').get(`bgm_folder_${role}`).value)
const 폴더만들기 = (name) => Number(db().prepare("INSERT INTO content_folders (category, name) VALUES ('bgm', ?)").run(name).lastInsertRowid)
let n = 0
// 곡 하나는 디스크에 파일이 있어야 튼다(Codex High) — 시험 파일은 작업 폴더의 음원 자리에 만들고 끝나면 지운다.
function 곡(folderId, name, active = 1, 파일있음 = true) {
  n += 1
  const 이름 = `__test_song_${process.pid}_${n}.mp3`
  if (파일있음) { const p = audioFilePath('bgm', 이름); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); 만든파일.push(p) }
  const id = Number(db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
    VALUES ('bgm', ?, ?, 0, ?, ?)`).run(이름, name, new Date().toISOString(), folderId).lastInsertRowid)
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, ?)").run(id, n, active)
  return id
}
const 경보들 = () => sent.filter(s => s.type === 'system_alert').map(s => s.payload)
const 받기 = async (p) => { const r = await fetch(app.baseUrl + p); return { status: r.status, body: await r.json() } }

test('1) 저장값 규칙 — local_a<번호> 만 곡 값이고, 폴더 값과 섞이지 않는다', () => {
  assert.deepEqual(곡값('local_a7'), { fileId: 7 })
  for (const 아님 of ['local_a0', 'local_a', 'local_a7_seq', 'local_f7', 'local_broadcast', '', null]) {
    assert.equal(곡값(아님), null, `${아님} 을 곡 값으로 읽었다`)
  }
  assert.equal(폴더값('local_a7'), null, '곡 값을 폴더 값으로 읽었다')
})

test('2) 예약·흐름은 그 곡 하나만 튼다 — 꺼 둔 곡이라도 사람이 고른 것이면', async () => {
  const 가요 = 폴더만들기('가요')
  곡(가요, '가요1')
  const 고른곡 = 곡(가요, '가요2', 0)
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_a${고른곡}` })
  assert.ok(r, '곡 하나를 못 풀었다')
  assert.deepEqual(r.files.map(f => f.name), ['가요2'])
  assert.equal(r.대체, undefined)
  assert.equal(경보들().length, 0)
})

test('3) 곡이 없어졌으면 방송용으로 대신 틀고 경보를 낸다', async () => {
  곡(용도폴더('broadcast'), '방송곡')
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_a999999' })
  assert.ok(r, '곡이 없다고 무음으로 떨어졌다')
  assert.ok(r.files.some(f => f.name === '방송곡'))
  assert.equal(r.대체, true)
  assert.equal(경보들().length, 1)
})

test('4) 자동방송 단계 bgmFileId — 그 곡, 없으면 그 방송의 기본 용도(점심=식사용)로', () => {
  const 동요 = 폴더만들기('동요')
  const 한곡 = 곡(동요, '동요한곡')
  stepBGMStart(db(), 'morning', 0, { bgmFileId: 한곡 })
  const 시작 = sent.filter(s => s.type === 'bgm_start')
  assert.deepEqual(시작[0]?.payload.files.map(f => f.name), ['동요한곡'])

  곡(용도폴더('meal'), '식사곡')
  sent.length = 0
  stepBGMStart(db(), 'lunch', 0, { bgmFileId: 999999 })
  const 대신 = sent.filter(s => s.type === 'bgm_start')
  assert.ok(대신[0]?.payload.files.every(f => f.name === '식사곡'), '점심 단계가 식사용이 아닌 곳으로 대신 나갔다')
  assert.equal(경보들().length, 1)
})

test('5) 목록은 곡도 준다 · 미리듣기 fileId 는 그 곡, 없으면 대신 틀지 않는다', async () => {
  const 폴더 = 폴더만들기('미리')
  const 한곡 = 곡(폴더, '미리곡')
  const 목록 = await 받기('/api/audio/bgm/folders')
  assert.equal(목록.status, 200)
  assert.ok(Array.isArray(목록.body.songs), '곡 목록이 없다')
  const 찾음 = 목록.body.songs.find(s => s.id === 한곡)
  assert.equal(찾음?.name, '미리곡')
  assert.equal(찾음?.folder_id, 폴더)

  const 들음 = await 받기(`/api/audio/bgm/preview?fileId=${한곡}`)
  assert.equal(들음.body.ok, true)
  assert.equal(들음.body.name, '미리곡')
  const 없음 = await 받기('/api/audio/bgm/preview?fileId=999999')
  assert.equal(없음.body.ok, false, '없는 곡 미리듣기가 다른 곡을 틀었다')
})

test('6) 자동방송 단계 — 있는 곡은 저장되고 폴더 번호는 지워진다, 없는 곡 번호는 400', async () => {
  const 저장 = (steps) => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lunch: { steps } }),
  })
  const 폴더 = 폴더만들기('저장')
  const 한곡 = 곡(폴더, '저장곡')
  const 좋음 = await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFileId: 한곡, bgmFolderId: 폴더 }])
  assert.equal(좋음.status, 200)
  const 저장된 = (await 받기('/api/settings/broadcast-schedule')).body
  const 단계 = 저장된.lunch?.steps?.find(s => s.id === 'bgm')
  assert.equal(단계?.bgmFileId, 한곡)
  assert.equal(단계?.bgmFolderId, undefined, '곡과 폴더가 함께 남았다 — 값 하나에 고른 것 하나')

  const 나쁨 = await 저장([{ id: 'bgm', label: 'BGM', enabled: true, bgmFileId: 999999 }])
  assert.equal(나쁨.status, 400)
})

test('7) 화면 규칙 — 곡 값에는 차례가 붙지 않고, 단계 값과 오간다', async () => {
  const t = await import('../../src/lib/bgmTypes.js')
  assert.equal(t.bgmTypeFrom('local_a5', 'seq'), 'local_a5', '곡 하나에 _seq 가 붙었다')
  assert.equal(t.곡하나인가('local_a5'), true)
  assert.equal(t.곡하나인가('local_f5'), false)
  assert.deepEqual(t.stepFieldsOfSource('local_a7'), { bgmRole: undefined, bgmFolderId: undefined, bgmFileId: 7 })
  assert.equal(t.sourceOfStep({ bgmFileId: 7 }), 'local_a7')
  // 폴더로 바꾸면 곡 번호가 지워진다(값 하나에 고른 것 하나)
  assert.equal(t.stepFieldsOfSource('local_f3').bgmFileId, undefined)
  const p = await import('../../src/lib/bgmPreview.js')
  assert.deepEqual(p.bgmPreviewPlan({ id: 'bgm_start', bgmFileId: 7 }, 'morning'), { kind: 'local', role: 'broadcast', fileId: 7 })
})

test('8) 목록에만 있고 파일이 없는 곡 — 무음 성공이 아니라 대신 틀고 경보(Codex High)', async () => {
  곡(용도폴더('broadcast'), '방송곡2')
  const 유령 = 곡(폴더만들기('유령'), '유령곡', 1, false)
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_a${유령}` })
  assert.ok(r, '무음으로 떨어졌다')
  assert.equal(r.대체, true, '파일 없는 곡을 성공으로 냈다')
  assert.ok(!r.files.some(f => f.name === '유령곡'))
  assert.equal(경보들().length, 1)
  const 들음 = await 받기(`/api/audio/bgm/preview?fileId=${유령}`)
  assert.equal(들음.body.ok, false, '파일 없는 곡 미리듣기가 성공으로 나왔다')
})

test('9) 모양이 틀린 곡 값(local_a7_seq) — 저장은 400, 방송은 옛 값으로 읽지 않고 대신+경보(Codex Medium)', async () => {
  const 한곡 = 곡(폴더만들기('모양'), '모양곡')
  const app2 = await startTestApp({ '/api/schedules': require('../routes/schedules') })
  try {
    const r = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '곡 확인', content: '안내', scheduled_time: '11:30', repeat_start_date: '2026-09-23', repeat_weekdays: [], bgm_enabled: 1, bgm_type: `local_a${한곡}_seq` }) })
    assert.equal(r.status, 400, '모양이 틀린 곡 값을 저장했다')
    const 좋음 = await fetch(`${app2.baseUrl}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '곡 확인2', content: '안내', scheduled_time: '11:30', repeat_start_date: '2026-09-23', repeat_weekdays: [], bgm_enabled: 1, bgm_type: `local_a${한곡}` }) })
    assert.equal(좋음.status, 200, await 좋음.text())
  } finally { await app2.close() }
  // 방송용 기본 순서가 「차례로」이고 곡이 둘 이상이어야 차례가 밀리는지 보인다(Codex 2회차 재현 조건)
  const 순서 = await fetch(`${app.baseUrl}/api/audio/bgm/roles/broadcast`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: 'seq' }) })
  assert.equal(순서.status, 200)
  곡(용도폴더('broadcast'), '차례곡1'); 곡(용도폴더('broadcast'), '차례곡2')
  const 차례 = () => db().prepare("SELECT key, value FROM settings WHERE key LIKE 'local_bgm_seq_%' ORDER BY key").all()
  for (const 값 of [`local_a${한곡}_seq`, 'local_a999999']) {
    sent.length = 0
    const 전 = 차례()
    const b = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 값 })
    assert.equal(b?.대체, true, `${값}: 틀린·없는 곡 값을 옛 값(방송용)으로 조용히 읽었다`)
    assert.equal(경보들().length, 1)
    assert.deepEqual(차례(), 전, `${값}: 곡 대신 틀기가 방송용 「차례로」 자리를 밀었다`)
  }
  await fetch(`${app.baseUrl}/api/audio/bgm/roles/broadcast`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: 'random' }) })
})

test('10) 곡 하나로 쓰는 파일은 지울 수 없다 — 예약·흐름·자동방송 단계(Codex Medium)', async () => {
  const { 쓰는곳 } = require('../domain/fileRefs')
  const 예약곡 = 곡(null, '예약곡')
  db().prepare("INSERT INTO schedules (title, content, scheduled_time, bgm_enabled, bgm_type) VALUES ('곡 예약', 'x', '2026-09-23T15:00', 1, ?)").run(`local_a${예약곡}`)
  assert.ok(쓰는곳(db(), 예약곡).some(x => /곡 예약/.test(x)), '예약이 곡 하나로 쓰는 파일을 못 잡았다')
  const r = await fetch(`${app.baseUrl}/api/audio/${예약곡}`, { method: 'DELETE' })
  assert.equal(r.status, 409, '쓰는 곡을 지웠다')

  const 끈곡 = 곡(null, '끈예약곡')
  db().prepare("INSERT INTO schedules (title, content, scheduled_time, bgm_enabled, bgm_type) VALUES ('BGM 끈', 'x', '2026-09-23T15:00', 0, ?)").run(`local_a${끈곡}`)
  assert.equal(쓰는곳(db(), 끈곡).length, 0, 'BGM 을 끈 예약이 곡 삭제를 막았다')

  const 흐름곡 = 곡(null, '흐름곡')
  const fid = db().prepare("INSERT INTO flow_sequences (name, created_at, updated_at) VALUES ('곡 흐름', ?, ?)").run(new Date().toISOString(), new Date().toISOString()).lastInsertRowid
  db().prepare("INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, 1, 'bgm', 'BGM', ?)")
    .run(fid, JSON.stringify({ bgm_type: `local_a${흐름곡}` }))
  assert.ok(쓰는곳(db(), 흐름곡).some(x => /곡 흐름/.test(x)), '흐름이 곡 하나로 쓰는 파일을 못 잡았다')

  const 단계곡 = 곡(null, '단계곡')
  const s = await fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lunch: { steps: [{ id: 'bgm', label: 'BGM', enabled: true, bgmFileId: 단계곡 }] } }) })
  assert.equal(s.status, 200)
  assert.ok(쓰는곳(db(), 단계곡).some(x => /자동방송/.test(x)), '자동방송 단계가 곡 하나로 쓰는 파일을 못 잡았다')
})

test('11) 곡 하나를 고르면 폴더 경고(「「」 폴더를 찾지 못했습니다」)가 뜨지 않는다 — 사용자 화면 2026-09-22', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/shared/BgmSourcePicker.jsx'), 'utf8')
  const m = /const 기본없음 = Boolean\(([^)]*)\)/.exec(src)
  assert.ok(m, '긍정 앵커 — 기본없음 판정이 있다')
  assert.ok(m[1].includes('!곡모드'), '곡 하나 값을 기본 폴더 없음으로 읽는다 — 빈 이름 폴더 경고가 뜬다')
})
