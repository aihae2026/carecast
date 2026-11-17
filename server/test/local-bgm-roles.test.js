// 로컬 배경음악을 **용도별 폴더**에서 **랜덤 또는 차례로** 튼다 (사용자 지시 2026-09-21).
//
// *"폴더별-방송용 BGM, 식사용 BGM 이렇게 나눠서 … 랜덤으로 자동재생, 순차적 재생"*
// *"클래식 음악은 거의 식사용으로 해주고 happy로 되어 있는건 TTS 방송할때 랜덤으로"*
//
// 여기서 고정하는 것:
//   1) 폴더와 용도는 **설정 키**로 잇는다(bgm_folder_broadcast·bgm_folder_meal). 폴더 번호는
//      PC 마다 달라 코드에 못 적고, 이름으로 찾으면 사람이 이름을 바꾸는 순간 조용히 무음이 된다
//   2) 첫 부팅에 두 폴더를 만들고 키를 적는다. 폴더 밖(맨 위)에 있던 배경음악은 식사용으로 옮긴다
//      — 예전엔 로컬 배경음악이 전부 식사 시간대 자동 BGM 에만 쓰였다(bgmScheduler)
//   3) 고른 폴더의 활성 곡만 나간다. 비었거나 폴더가 없으면 **아무거나 틀지 않고** 이유를 말한다
//   4) 랜덤은 섞고, 차례로는 틀 때마다 한 곡씩 시작 자리가 밀린다
//   5) 용도 폴더는 지울 수 없다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmroles_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp }  = require('./helpers/testApp')
const { 재생순서, 역할들 } = require('../domain/bgmRoles')
const { 로컬BGM고르기, 역할폴더 } = require('../services/localBgm')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')
const sse = require('../services/sse')

const FIX_KEY = 'datafix_bgm_role_folders_20260921'
const db = () => getDB()
const setting = (k) => db().prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/audio': require('../routes/audio') })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

let 번호 = 0
function 곡(folderId, name, { active = 1 } = {}) {
  번호 += 1
  const r = db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id,
      source_name, license_note) VALUES ('bgm', ?, ?, 0, ?, ?, 'Pixabay', 'x')`)
    .run(`f${번호}.mp3`, name, new Date(Date.now() + 번호).toISOString(), folderId)
  const max = db().prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM audio_playlist WHERE category='bgm'").get().m
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, ?)")
    .run(r.lastInsertRowid, max + 1, active)
  return Number(r.lastInsertRowid)
}

// ── 순수 규칙 ───────────────────────────────────────────────────

test('차례로 — 시작 자리에서 돌려 세우고, 다음 자리는 한 칸 뒤', () => {
  const f = ['a', 'b', 'c']
  assert.deepEqual(재생순서(f, 'seq', 0), { 목록: ['a', 'b', 'c'], 다음자리: 1 })
  assert.deepEqual(재생순서(f, 'seq', 1), { 목록: ['b', 'c', 'a'], 다음자리: 2 })
  assert.deepEqual(재생순서(f, 'seq', 2), { 목록: ['c', 'a', 'b'], 다음자리: 0 })
  assert.deepEqual(재생순서(f, 'seq', 7), { 목록: ['b', 'c', 'a'], 다음자리: 2 }, '곡 수가 줄어도 자리가 넘치지 않는다')
  assert.deepEqual(재생순서(f, 'seq', -3), { 목록: ['a', 'b', 'c'], 다음자리: 1 }, '망가진 자리값은 처음부터')
})

test('랜덤 — 같은 곡들을 한 번씩, 순서만 섞는다', () => {
  const f = ['a', 'b', 'c', 'd', 'e']
  let 다른순서 = false
  for (let i = 0; i < 20; i++) {
    const { 목록 } = 재생순서(f, 'random', 0)
    assert.deepEqual([...목록].sort(), f, '곡이 빠지거나 겹쳤다')
    if (목록.join() !== f.join()) 다른순서 = true
  }
  assert.ok(다른순서, '스무 번 섞어도 순서가 그대로다 — 섞지 않는다')
  // 난수를 주입하면 결과가 정해진다(Fisher–Yates)
  assert.deepEqual(재생순서(['a', 'b', 'c'], 'random', 0, () => 0).목록, ['b', 'c', 'a'])
})

test('빈 목록과 모르는 순서값', () => {
  assert.deepEqual(재생순서([], 'seq', 3), { 목록: [], 다음자리: 0 })
  assert.deepEqual(재생순서(['a', 'b'], '엉뚱', 0).목록.length, 2, '모르는 값은 랜덤으로 읽는다')
})

// ── 첫 부팅 보정 ────────────────────────────────────────────────

test('첫 부팅 — 두 폴더를 만들고 키를 적고, 맨 위 배경음악을 식사용으로 옮긴다', () => {
  const 맨위 = 곡(null, '예전 곡')
  const fix = DATA_FIXES.find(f => f.key === FIX_KEY)
  assert.ok(fix, '보정 항목이 없다')
  const changed = applyDataFixes(db(), [fix])

  for (const r of 역할들) {
    const id = Number(setting(r.폴더키))
    const 폴더 = db().prepare('SELECT * FROM content_folders WHERE id=?').get(id)
    assert.ok(폴더, `${r.이름} 폴더가 없다`)
    assert.equal(폴더.category, 'bgm')
    assert.equal(폴더.name, r.이름)
  }
  const 식사 = Number(setting('bgm_folder_meal'))
  assert.equal(db().prepare('SELECT folder_id FROM audio_files WHERE id=?').get(맨위).folder_id, 식사,
    '예전 곡이 식사용으로 안 옮겨졌다 — 식사 시간 자동 BGM 이 무음이 된다')
  assert.ok(changed.some(l => /식사용/.test(l)), `무엇을 했는지 로그에 없다: ${JSON.stringify(changed)}`)

  // 두 번째 부팅 — 다시 안 돈다
  assert.deepEqual(applyDataFixes(db(), [fix]), [])
})

test('사람이 이미 같은 이름 폴더를 만들어 두었으면 그것을 쓴다(둘을 만들지 않는다)', () => {
  const fix = DATA_FIXES.find(f => f.key === FIX_KEY)
  db().prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').run(FIX_KEY, 'bgm_folder_broadcast', 'bgm_folder_meal')
  applyDataFixes(db(), [fix])
  const n = db().prepare("SELECT COUNT(*) n FROM content_folders WHERE category='bgm' AND name='방송용 BGM'").get().n
  assert.equal(n, 1, '같은 이름 폴더가 둘이 됐다')
})

// ── 고르기 ─────────────────────────────────────────────────────

test('용도 폴더의 활성 곡만 나가고, 다른 폴더·꺼진 곡은 안 섞인다', () => {
  const 방송 = Number(setting('bgm_folder_broadcast'))
  const 식사 = Number(setting('bgm_folder_meal'))
  곡(방송, 'happy piano'); 곡(방송, 'happy kids'); 곡(방송, '꺼진 곡', { active: 0 })
  곡(식사, 'classical waltz')

  const r = 로컬BGM고르기(db(), { role: 'broadcast', order: 'random' })
  assert.equal(r.ok, true, r.사유)
  assert.deepEqual(r.files.map(f => f.name).sort(), ['happy kids', 'happy piano'])
  for (const f of r.files) assert.match(f.url, /^\/audio\/bgm\/f\d+\.mp3$/)
  assert.equal(r.folderName, '방송용 BGM')

  const m = 로컬BGM고르기(db(), { role: 'meal', order: 'seq' })
  assert.ok(m.files.every(f => !/happy/.test(f.name)), '식사용에 방송용 곡이 섞였다')
})

test('차례로 — 틀 때마다 시작 곡이 한 칸씩 밀린다', () => {
  const 방송 = Number(setting('bgm_folder_broadcast'))
  const 첫곡들 = []
  for (let i = 0; i < 3; i++) 첫곡들.push(로컬BGM고르기(db(), { folderId: 방송, order: 'seq' }).files[0].name)
  assert.equal(new Set(첫곡들).size, 2, `두 곡인데 시작 곡이 번갈지 않는다: ${첫곡들}`)
  assert.equal(첫곡들[0], 첫곡들[2])
})

test('비었거나 없는 폴더면 아무거나 틀지 않고 이유를 말한다', () => {
  const 빈폴더 = Number(db().prepare("INSERT INTO content_folders (category, name, created_at) VALUES ('bgm','빈 폴더',?)")
    .run(new Date().toISOString()).lastInsertRowid)
  const 빈 = 로컬BGM고르기(db(), { folderId: 빈폴더, order: 'random' })
  assert.equal(빈.ok, false); assert.match(빈.사유, /비어/)

  const 없음 = 로컬BGM고르기(db(), { folderId: 999999, order: 'random' })
  assert.equal(없음.ok, false); assert.match(없음.사유, /폴더/)

  const 다른갈래 = Number(db().prepare("INSERT INTO content_folders (category, name, created_at) VALUES ('morning-prayer','아침 음원',?)")
    .run(new Date().toISOString()).lastInsertRowid)
  assert.equal(로컬BGM고르기(db(), { folderId: 다른갈래, order: 'random' }).ok, false, '아침 음원 폴더가 배경음악으로 나갔다')

  const 키 = setting('bgm_folder_meal')
  db().prepare("DELETE FROM settings WHERE key='bgm_folder_meal'").run()
  const 키없음 = 로컬BGM고르기(db(), { role: 'meal', order: 'random' })
  assert.equal(키없음.ok, false); assert.match(키없음.사유, /식사용/)
  db().prepare("INSERT INTO settings(key,value) VALUES('bgm_folder_meal',?)").run(키)
  assert.equal(역할폴더(db(), 'meal').ok, true)
})

// ── API ───────────────────────────────────────────────────────

test('POST /bgm/start — 고른 폴더·순서로 bgm_start 를 낸다, 비었으면 400', async () => {
  const 받은 = []
  const 원래 = sse.broadcastSSE
  sse.broadcastSSE = (type, data) => 받은.push({ type, data })
  try {
    const r = await fetch(`${app.baseUrl}/api/audio/bgm/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'broadcast', order: 'random' }),
    })
    assert.equal(r.status, 200)
    const 시작 = 받은.find(e => e.type === 'bgm_start')
    assert.ok(시작, 'bgm_start 가 안 나갔다')
    assert.ok(시작.data.files.every(f => /happy/.test(f.name)))
    assert.ok(시작.data.eventId)

    const 빈폴더 = db().prepare("SELECT id FROM content_folders WHERE name='빈 폴더'").get().id
    const e = await fetch(`${app.baseUrl}/api/audio/bgm/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: 빈폴더 }),
    })
    assert.equal(e.status, 400)
    assert.match((await e.json()).error, /비어/)
  } finally { sse.broadcastSSE = 원래 }
})

test('GET·PUT /bgm/roles — 두 용도의 폴더·곡 수·순서를 보고 순서를 바꾼다', async () => {
  const 현황 = await (await fetch(`${app.baseUrl}/api/audio/bgm/roles`)).json()
  const 목록 = 현황.roles
  assert.deepEqual(목록.map(r => r.role), ['broadcast', 'meal'])
  const 방송 = 목록.find(r => r.role === 'broadcast')
  assert.equal(방송.count, 2, '꺼진 곡까지 셌다')
  assert.equal(방송.offCount, 1, '꺼 둔 곡 수를 따로 안 센다')
  assert.equal(typeof 현황.outsideCount, 'number', '용도 밖(안 나가는) 곡 수가 없다')
  assert.equal(방송.order, 'random')

  const r = await fetch(`${app.baseUrl}/api/audio/bgm/roles/meal`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: 'seq' }),
  })
  assert.equal(r.status, 200)
  assert.equal(setting('bgm_order_meal'), 'seq')
  const 나쁨 = await fetch(`${app.baseUrl}/api/audio/bgm/roles/meal`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: 'shuffle!' }),
  })
  assert.equal(나쁨.status, 400)
})

test('용도 폴더는 지울 수 없다', async () => {
  // 빈 폴더라야 기존 「비어 있어야 지운다」 규칙을 지나 이 검사까지 온다
  const 새 = Number(db().prepare("INSERT INTO content_folders (category, name, created_at) VALUES ('bgm','임시',?)")
    .run(new Date().toISOString()).lastInsertRowid)
  const 예전 = setting('bgm_folder_broadcast')
  db().prepare("UPDATE settings SET value=? WHERE key='bgm_folder_broadcast'").run(String(새))
  try {
    const r = await fetch(`${app.baseUrl}/api/audio/folders/${새}`, { method: 'DELETE' })
    assert.equal(r.status, 409)
    assert.match((await r.json()).error, /방송용 BGM/)
    assert.ok(db().prepare('SELECT id FROM content_folders WHERE id=?').get(새), '지워졌다')
  } finally {
    db().prepare("UPDATE settings SET value=? WHERE key='bgm_folder_broadcast'").run(예전)
  }
})

// ── 2026-09-21 검수 반영 — 하위 폴더·전부 꺼짐·용도 밖 ─────────────────────────

test('용도 폴더 **아래 하위 폴더**의 곡도 나간다 — 정리하려고 폴더를 나눴다고 빠지면 안 된다', () => {
  const 방송 = Number(setting('bgm_folder_broadcast'))
  const 하위 = Number(db().prepare("INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', ?, '피아노', ?)")
    .run(방송, new Date().toISOString()).lastInsertRowid)
  곡(하위, 'happy 하위곡')
  const r = 로컬BGM고르기(db(), { role: 'broadcast', order: 'random' })
  assert.ok(r.files.some(f => f.name === 'happy 하위곡'), '하위 폴더 곡이 빠졌다')
})

test('다른 용도 폴더가 안에 들어가 있으면 그 가지는 섞지 않는다', () => {
  const 방송 = Number(setting('bgm_folder_broadcast'))
  const 식사 = Number(setting('bgm_folder_meal'))
  const 예전부모 = db().prepare('SELECT parent_id FROM content_folders WHERE id=?').get(방송).parent_id
  db().prepare('UPDATE content_folders SET parent_id=? WHERE id=?').run(식사, 방송)   // 방송용을 식사용 안으로
  try {
    const m = 로컬BGM고르기(db(), { role: 'meal', order: 'random' })
    assert.ok(m.ok === false || m.files.every(f => !/happy/.test(f.name)), '식사용에 방송용 곡이 섞였다')
    const b = 로컬BGM고르기(db(), { role: 'broadcast', order: 'random' })
    assert.ok(b.ok && b.files.every(f => /happy/.test(f.name)))
  } finally {
    db().prepare('UPDATE content_folders SET parent_id=? WHERE id=?').run(예전부모, 방송)
  }
})

test('곡은 있는데 **전부 꺼 뒀으면** 「비었다」가 아니라 「꺼져 있다」고 말한다', () => {
  const f = Number(db().prepare("INSERT INTO content_folders (category, name, created_at) VALUES ('bgm','모두꺼짐',?)")
    .run(new Date().toISOString()).lastInsertRowid)
  곡(f, '꺼둔 곡', { active: 0 })
  const r = 로컬BGM고르기(db(), { folderId: f, order: 'random' })
  assert.equal(r.ok, false)
  assert.match(r.사유, /꺼져/, `사유가 틀렸다: ${r.사유}`)
})

test('어느 용도에도 없는 곡은 「용도 밖」으로 센다 — 안 나가는 곡을 화면이 알린다', () => {
  const { 용도현황 } = require('../services/localBgm')
  const 전 = 용도현황(db()).outsideCount
  곡(null, '맨 위에 둔 곡')
  assert.equal(용도현황(db()).outsideCount, 전 + 1)
})

test('업그레이드 — 예전 로컬 BGM 단계는 식사용으로 못박혀 예전 곡이 그대로 나간다(QA 재현)', () => {
  const fix = DATA_FIXES.find(f => f.key === FIX_KEY)
  db().prepare('DELETE FROM settings WHERE key = ?').run(FIX_KEY)
  db().prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('morning_steps', JSON.stringify([
    { id: 'bgm', bgmSource: 'local' },
    { id: 'bgm_after', bgmSource: 'auto' },
    { id: 'x', bgmSource: 'yt_preset' },
    { id: 'y', bgmSource: 'local', bgmRole: 'broadcast' },
  ]))
  const changed = applyDataFixes(db(), [fix])
  const s = JSON.parse(setting('morning_steps'))
  assert.equal(s[0].bgmRole, 'meal')
  assert.equal(s[1].bgmRole, 'meal')
  assert.equal(s[2].bgmRole, undefined, '유튜브 단계를 건드렸다')
  assert.equal(s[3].bgmRole, 'broadcast', '사람이 정한 용도를 덮었다')
  assert.ok(changed.some(l => /morning_steps/.test(l)), '무엇을 바꿨는지 로그에 없다')
})

test('곡이 든 용도 폴더도 409 — 「먼저 비워 주세요」(400)가 아니다(Codex 3회차)', async () => {
  const 방송 = Number(setting('bgm_folder_broadcast'))
  const n = db().prepare('SELECT COUNT(*) n FROM audio_files WHERE folder_id=?').get(방송).n
  assert.ok(n > 0, '시험 전제: 방송용 폴더에 곡이 있어야 한다')
  const r = await fetch(`${app.baseUrl}/api/audio/folders/${방송}`, { method: 'DELETE' })
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /방송용 BGM/)
})
