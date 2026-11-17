// 사람이 만든 BGM 폴더를 방송이 고른다 (사용자 결정 2026-09-22 「폴더를 자유롭게 늘림」).
//
// 저장값 `local_f<폴더 번호>`(+`_seq`) — 번호로 잇는다(이름을 바꿔도 끊기지 않는다). 두 용도 폴더는
// `local_broadcast`·`local_meal` 그대로다. 여기서 고정하는 것:
//   1) `local_f<id>` 는 그 폴더 곡을, `_seq` 는 차례로 튼다 — 용도 규칙보다 먼저 본다
//   2) 사람이 만든 폴더를 못 쓰면(없음·비었음·전부 꺼짐) 기본 용도 폴더로 **대신 틀고 경보**를 낸다
//   3) 용도 폴더는 번호로 와도 용도로 읽고, 실패해도 다른 용도로 **대신하지 않는다**(dc93cc79)
//   4) 자동방송 단계(stepBGMStart)도 같은 규칙 — 대신 틀 곳은 그 방송의 기본 용도(점심=식사용)
//   5) 옛 값(local_broadcast·local_meal)은 전과 같다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmuserfolders_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// 화면으로 나가는 신호를 잡는다(경보·bgm_start).
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
const { 폴더값 } = require('../domain/bgmRoles')
const { 폴더목록 } = require('../services/localBgm')
const { stepBGMStart } = require('../services/broadcastSteps')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')

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
test.beforeEach(() => { sent.length = 0 })

const 용도폴더 = (role) => Number(db().prepare('SELECT value FROM settings WHERE key=?').get(`bgm_folder_${role}`).value)
function 폴더만들기(name, parent = null) {
  return Number(db().prepare("INSERT INTO content_folders (category, name, parent_id) VALUES ('bgm', ?, ?)").run(name, parent).lastInsertRowid)
}
let n = 0
function 곡(folderId, name, active = 1) {
  n += 1
  const id = db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
    VALUES ('bgm', ?, ?, 0, ?, ?)`).run(`u${n}.mp3`, name, new Date().toISOString(), folderId).lastInsertRowid
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, ?)").run(id, n, active)
}
const 경보들 = () => sent.filter(s => s.type === 'system_alert').map(s => s.payload)
const 곡이름 = (r) => r.files.map(f => f.name)

test('저장값 규칙: local_f<번호>(+_seq) 만 폴더 값이다', () => {
  assert.deepEqual(폴더값('local_f12'), { folderId: 12, 차례: false })
  assert.deepEqual(폴더값('local_f12_seq'), { folderId: 12, 차례: true })
  for (const 아님 of ['local_broadcast', 'local_meal_seq', 'local_f0', 'local_f', 'local_fx', '', null, 'local_f12_seqx']) {
    assert.equal(폴더값(아님), null, `${아님} 을 폴더 값으로 읽었다`)
  }
})

test('1) local_f<id> 는 그 폴더 곡을 튼다 — 방송용이 섞이지 않는다', async () => {
  곡(용도폴더('broadcast'), '방송곡')
  const 클래식 = 폴더만들기('클래식')
  곡(클래식, '클래식1'); 곡(클래식, '클래식2')
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_f${클래식}` })
  assert.ok(r, '사람이 만든 폴더를 못 풀었다')
  assert.deepEqual(곡이름(r).sort(), ['클래식1', '클래식2'])
  assert.equal(r.folderName, '클래식')
  assert.equal(r.대체, undefined, '대신 튼 것이 아닌데 대체 표시가 붙었다')
  assert.equal(경보들().length, 0)
})

test('1) _seq 는 차례로 — 적힌 순서대로 시작 곡이 한 칸씩 민다', async () => {
  const 트로트 = 폴더만들기('트로트')
  곡(트로트, '가'); 곡(트로트, '나'); 곡(트로트, '다')
  const a = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_f${트로트}_seq` })
  const b = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_f${트로트}_seq` })
  assert.deepEqual(곡이름(a), ['가', '나', '다'])
  assert.deepEqual(곡이름(b), ['나', '다', '가'])
})

test('2) 없어진 폴더 → 방송용으로 대신 틀고 경보 — 무엇이 나갔는지 거짓이 없다', async () => {
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_f99999' })
  assert.ok(r, '없어진 폴더라고 BGM 을 통째로 뺐다 — 대신 틀어야 한다')
  assert.equal(r.대체, true)
  assert.equal(r.folderName, '방송용 BGM')
  const a = 경보들()
  assert.equal(a.length, 1, '대신 틀면서 경보를 안 냈다 — 사람은 폴더가 없어진 줄 모른다')
  assert.equal(a[0].kind, '배경음악')
  assert.match(a[0].message, /방송용 BGM/)
})

test('2) 비었거나 곡이 전부 꺼진 사람 폴더도 대신 튼다(곡을 옮겨 비는 일은 삭제 막기로 못 막는다)', async () => {
  const 빈 = 폴더만들기('빈폴더')
  const 꺼짐 = 폴더만들기('꺼둔폴더'); 곡(꺼짐, '꺼둔곡', 0)
  for (const id of [빈, 꺼짐]) {
    sent.length = 0
    const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_f${id}` })
    assert.equal(r?.대체, true, `폴더 ${id} 를 대신 틀지 않았다`)
    assert.equal(경보들().length, 1)
  }
})

test('3) 용도 폴더는 번호로 와도 용도로 읽고, 비어도 다른 용도로 대신하지 않는다', async () => {
  // 식사용 폴더는 비어 있다(이 파일에서 곡을 안 넣었다). 방송용으로 넘어가면 식사 중에 방송곡이 섞인다.
  const r = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: `local_f${용도폴더('meal')}` })
  assert.equal(r, null, '비어 있는 식사용 대신 방송용 곡을 틀었다')
  assert.equal(경보들().length, 0, '용도 폴더 실패에 대신 틀기 경보를 냈다')
})

test('5) 옛 값은 전과 같다 — local_broadcast 는 방송용, 빈 local_meal 은 null', async () => {
  const a = await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_broadcast' })
  assert.deepEqual(곡이름(a), ['방송곡'])
  assert.equal(await resolveBGM(db(), { bgm_enabled: 1, bgm_type: 'local_meal' }), null)
  assert.equal(경보들().length, 0)
})

test('4) 자동방송 단계 — bgmFolderId 폴더 곡을 틀고, 못 쓰면 그 방송의 기본 용도(점심=식사용)로', () => {
  const 동요 = 폴더만들기('동요'); 곡(동요, '동요1')
  stepBGMStart(db(), 'morning', 0, { bgmFolderId: 동요 })
  const 시작 = sent.filter(s => s.type === 'bgm_start')
  assert.equal(시작.length, 1)
  assert.deepEqual(시작[0].payload.files.map(f => f.name), ['동요1'])

  곡(용도폴더('meal'), '식사곡')
  sent.length = 0
  stepBGMStart(db(), 'lunch', 0, { bgmFolderId: 99999 })
  const 대신 = sent.filter(s => s.type === 'bgm_start')
  assert.deepEqual(대신[0]?.payload.files.map(f => f.name), ['식사곡'], '점심 단계가 식사용이 아닌 곳으로 대신 나갔다')
  assert.equal(경보들().length, 1)
})

test('폴더 목록 — 모든 BGM 폴더를 지금 이름·용도·곡 수와 함께 준다(하위 폴더 곡 포함)', () => {
  const 가요 = 폴더만들기('가요')
  const 하위 = 폴더만들기('가요-옛날', 가요)
  곡(가요, '가요1'); 곡(하위, '가요2'); 곡(하위, '가요3', 0)
  const 목록 = 폴더목록(db())
  const 찾기 = (id) => 목록.find(f => f.id === id)
  assert.equal(찾기(가요).count, 2, '하위 폴더 곡을 안 셌다')
  assert.equal(찾기(가요).offCount, 1)
  assert.equal(찾기(가요).role, null)
  assert.equal(찾기(하위).parent_id, 가요)
  assert.equal(찾기(용도폴더('broadcast')).role, 'broadcast')
  assert.equal(찾기(용도폴더('meal')).role, 'meal')

  // 이름을 바꾸면 목록이 새 이름을 준다(번호는 그대로).
  db().prepare('UPDATE content_folders SET name = ? WHERE id = ?').run('트로트 가요', 가요)
  assert.equal(폴더목록(db()).find(f => f.id === 가요).name, '트로트 가요')
})

test('큰 번호·앞자리 0 은 폴더 값이 아니다 — 조용히 1번 폴더로 바뀌지 않는다(QA)', async () => {
  assert.equal(폴더값('local_f99999999999999999999999'), null)
  assert.equal(폴더값('local_f012'), null)
  sent.length = 0
  // 번호로 못 읽는 값이 단계에 들어 있으면 없는 폴더로 보고 **대신 틀고 경보**를 낸다(조용히 다른 폴더 아님)
  const { 방송BGM고르기 } = require('../services/localBgm')
  const r = 방송BGM고르기(db(), { folderId: '1e23', role: 'broadcast' })
  assert.equal(r.대체, true, '못 읽는 번호가 조용히 어떤 폴더로 읽혔다')
  assert.equal(경보들().length, 1)
})
