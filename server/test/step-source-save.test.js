// 단계 연결(`source`)의 **저장 규칙** — 실제 저장 API 를 왕복시켜 값으로 확인한다.
//
// 사용자 조건(2026-09-13):
//   조건 2 — *"`sourceResolved` 제거만으로는 부족하다. 볼륨만 바꿔 저장한 뒤 다시 조회해서
//            어느 단계에도 `source` 키가 생기지 않고, `source: null` 은 살아남는지 확인해라."*
//   조건 3 — *"서버에서 `source` 를 검증해라. 없는 파일·폴더, 잘못된 `kind`, 단계와 안 맞는
//            매체. 명시적으로 연결한 대상이 사라지면 **조용히 기본값으로 떨어지지 마라.**"*
//
// **화면을 흉내내는 것이 핵심이다.** `MorningEditor` 는 `GET` 으로 받은 것을 통째로 `POST`
// 한다. 그래서 서버가 응답에 얹은 파생 필드(`sourceResolved`)가 그대로 되돌아온다 —
// 이 시험은 그 왕복을 그대로 재현한다. 규율이 아니라 코드가 막는지 보는 자리다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stepsource_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { DEFAULT_STEPS } = require('../services/broadcastSequencer')
const { resolveStepSource, isDisconnected } = require('../domain/stepSource')
const { pickSourceFile } = require('../domain/categoryPick')
const { seedSite, TABS } = require('./helpers/siteFixtures')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': require('../routes/settings') })
})
test.after(async () => {
  await app?.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function 시설세우기(kind = 'mixed') {
  const db = getDB()
  db.prepare('DELETE FROM audio_playlist').run()
  db.prepare('DELETE FROM audio_files').run()
  db.prepare('DELETE FROM content_folders').run()
  for (const tab of TABS) db.prepare('DELETE FROM settings WHERE key = ?').run(`${tab}_steps`)
  seedSite(db, kind, { DEFAULT_STEPS })
  return db
}

const 불러오기 = () => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`).then(r => r.json())
const 저장 = (body) => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
// DB 에 **글자 그대로** 무엇이 들어갔나. 응답을 믿지 않고 저장물을 직접 본다.
const 저장된원문 = (tab) =>
  getDB().prepare('SELECT value FROM settings WHERE key = ?').get(`${tab}_steps`)?.value ?? null

// ── 조건 2 ──────────────────────────────────────────────────────────────────
test('화면이 받은 것을 그대로 되돌려 저장해도 어느 단계에도 source 키가 안 생긴다', async () => {
  시설세우기('legacy')
  const 받은것 = await 불러오기()

  // 서버가 파생 필드를 실제로 얹었는지 먼저 확인한다 — **긍정 앵커**.
  // 이게 없으면 아래 "안 생긴다"는 검사할 대상이 없어 조용히 통과한다.
  assert.ok(받은것.morning.steps.every(s => s.sourceResolved),
    'sourceResolved 가 응답에 없다 — 아래 검사가 무의미해진다')

  // 사람이 한 일: **볼륨 하나만** 바꿨다.
  받은것.morning.steps[0].volume = 33
  const res = await 저장(받은것)
  assert.equal(res.status, 200, await res.text())

  for (const tab of TABS) {
    const 원문 = 저장된원문(tab)
    assert.ok(원문, `${tab}_steps 가 저장되지 않았다`)
    assert.ok(!원문.includes('"sourceResolved"'),
      `${tab}: 파생 필드가 DB 에 들어갔다 — 되저장 사고를 못 막았다`)
    assert.ok(!원문.includes('"delayProfileResolved"'),
      `${tab}: 보정 파생 필드가 DB 에 들어갔다`)
    for (const st of JSON.parse(원문)) {
      assert.ok(!Object.prototype.hasOwnProperty.call(st, 'source'),
        `${tab} 「${st.id}」에 source 키가 생겼다 — 볼륨만 바꿨는데 연결이 박혔다`)
    }
  }
  // 바꾸려던 값은 실제로 바뀌었나 — 아무것도 저장 안 되면 위 검사도 공짜로 통과한다.
  assert.equal(JSON.parse(저장된원문('morning'))[0].volume, 33, '볼륨이 저장되지 않았다')
})

test('연결 해제(source: null)는 왕복해도 살아남는다 — 기본값이 다시 붙지 않는다', async () => {
  시설세우기('legacy')
  const 첫판 = await 불러오기()
  const 대상 = 첫판.morning.steps.find(s => s.id === 'morning_prayer')
  assert.ok(대상, 'morning_prayer 단계가 없다')
  대상.source = null
  assert.equal((await 저장(첫판)).status, 200)

  // ① DB 에 null 이 글자 그대로 남았나
  const 저장본 = JSON.parse(저장된원문('morning')).find(s => s.id === 'morning_prayer')
  assert.ok(Object.prototype.hasOwnProperty.call(저장본, 'source'), 'source 키가 사라졌다')
  assert.equal(저장본.source, null, 'null 이 안 살아남았다')

  // ② 다시 불러도 해제 상태인가 (병합이 spread 라 살아난다)
  const 둘째판 = await 불러오기()
  const 다시 = 둘째판.morning.steps.find(s => s.id === 'morning_prayer')
  assert.equal(다시.source, null, '다시 열었더니 해제가 풀렸다')
  assert.equal(다시.sourceResolved.kind, 'none')
  assert.ok(isDisconnected(다시.sourceResolved), '해제인데 해제로 안 읽힌다')

  // ③ 실행부가 **아무 파일도 안 고른다** — 기본값(morning-prayer)이 다시 붙으면 안 된다
  const file = pickSourceFile(getDB(), resolveStepSource(getDB(), 다시), 0)
  assert.equal(file, undefined, '해제한 단계인데 기본 카테고리에서 파일을 골랐다')

  // ④ 그 왕복을 한 번 더 해도 여전히 해제인가 (되저장이 해제를 지우지 않는지)
  assert.equal((await 저장(둘째판)).status, 200)
  const 셋째판 = await 불러오기()
  assert.equal(셋째판.morning.steps.find(s => s.id === 'morning_prayer').source, null,
    '두 번째 되저장에서 해제가 지워졌다')
})

test('병합은 whitelist 가 아니라 spread 다 — 모르는 키가 살아남아야 연결이 안 사라진다', () => {
  const { mergeStepsWithDefaults } = require('../services/broadcastSequencer')
  const defaults = [{ id: 'a', label: '가', enabled: true, order: 0 }]
  const saved = [{ id: 'a', label: '가', enabled: true, order: 0,
    source: { kind: 'folder', category: 'misc-audio', folderId: 7 } }]
  const merged = mergeStepsWithDefaults(defaults, saved)
  assert.deepEqual(merged[0].source, { kind: 'folder', category: 'misc-audio', folderId: 7 },
    '병합이 모르는 키를 버리면 사람이 고른 연결이 조용히 사라진다')

  // `null` 도 같다 — whitelist 로 바뀌면 이 줄이 먼저 깨진다
  const merged2 = mergeStepsWithDefaults(defaults, [{ id: 'a', order: 0, source: null }])
  assert.ok(Object.prototype.hasOwnProperty.call(merged2[0], 'source'))
  assert.equal(merged2[0].source, null)
})

// ── 조건 3: 서버 검증 ────────────────────────────────────────────────────────
test('없는 파일·없는 폴더·잘못된 kind·안 맞는 매체는 400 으로 막는다', async () => {
  const db = 시설세우기('mixed')
  const 음원폴더 = db.prepare(
    "SELECT id FROM content_folders WHERE category = 'misc-audio' AND name = '아침 음악'").get().id
  const 영상파일 = db.prepare("SELECT id FROM audio_files WHERE category = 'misc-video'").get().id

  const 사례들 = [
    ['없는 파일',      'morning_prayer', { kind: 'file', audioFileId: 999999 }],
    ['없는 폴더',      'morning_prayer', { kind: 'folder', category: 'misc-audio', folderId: 999999 }],
    ['잘못된 kind',    'morning_prayer', { kind: 'playlist', category: 'misc-audio' }],
    ['kind 없음',      'morning_prayer', { category: 'misc-audio' }],
    ['음원 자리에 영상', 'morning_prayer', { kind: 'file', audioFileId: 영상파일 }],
    ['영상 자리에 음원', 'exercise_video', { kind: 'folder', category: 'misc-audio', folderId: 음원폴더 }],
    ['폴더가 다른 갈래', 'morning_prayer', { kind: 'folder', category: 'misc-video', folderId: 음원폴더 }],
  ]

  for (const [이름, stepId, source] of 사례들) {
    const 판 = await 불러오기()
    const 탭 = stepId === 'exercise_video' ? 'exercise' : 'morning'
    const 전 = 저장된원문(탭)
    const 대상 = 판[탭].steps.find(s => s.id === stepId)
    assert.ok(대상, `${stepId} 단계가 없다`)
    대상.source = source
    const res = await 저장(판)
    assert.equal(res.status, 400, `${이름}: 막히지 않았다`)
    const { error } = await res.json()
    assert.ok(error && error.length > 0, `${이름}: 사유가 비었다`)
    // **하나도 저장되면 안 된다** — 시각 검증과 같은 규칙(먼저 다 보고 나서 저장한다)
    assert.equal(저장된원문(탭), 전, `${이름}: 막았는데 일부가 저장됐다`)
  }
})

test('제대로 된 연결은 저장되고, 여분 키는 안 따라 들어간다', async () => {
  const db = 시설세우기('mixed')
  const folderId = db.prepare(
    "SELECT id FROM content_folders WHERE category = 'misc-audio' AND name = '아침 음악'").get().id

  const 판 = await 불러오기()
  const 대상 = 판.morning.steps.find(s => s.id === 'morning_prayer')
  대상.source = { kind: 'folder', category: 'misc-audio', folderId, 쓸데없는키: '지워져야 한다' }
  assert.equal((await 저장(판)).status, 200)

  const 저장본 = JSON.parse(저장된원문('morning')).find(s => s.id === 'morning_prayer')
  assert.deepEqual(저장본.source, { kind: 'folder', category: 'misc-audio', folderId })

  // 실제로 그 폴더의 파일이 나가는가 — 폴더 안 순서는 올린 순서(id)
  const file = pickSourceFile(db, resolveStepSource(db, 저장본), 0)
  assert.equal(file.original_name, '아침 음악 1.mp3')
})

// ── 조건 3: 연결이 끊긴 뒤 — **조용히 기본값으로 안 돌아간다** ─────────────────
test('연결한 폴더가 사라지면 건너뛰고 연결 오류를 낸다 — 기본값으로 안 돌아간다', async () => {
  const db = 시설세우기('mixed')
  const folderId = db.prepare(
    "SELECT id FROM content_folders WHERE category = 'misc-audio' AND name = '행사 안내'").get().id

  const 판 = await 불러오기()
  판.morning.steps.find(s => s.id === 'morning_prayer').source =
    { kind: 'folder', category: 'misc-audio', folderId }
  assert.equal((await 저장(판)).status, 200)

  // 폴더를 치운다 (화면 밖에서 지워진 상황 — 파일도 함께 사라진다)
  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(folderId)
  db.prepare('DELETE FROM content_folders WHERE id = ?').run(folderId)

  const 저장본 = JSON.parse(저장된원문('morning')).find(s => s.id === 'morning_prayer')
  const 연결 = resolveStepSource(db, 저장본)
  assert.equal(연결.kind, 'none', '사라진 연결인데 여전히 폴더로 읽힌다')
  assert.equal(연결.error?.code, 'FOLDER_GONE', '연결 오류가 안 붙었다')
  assert.notEqual(연결.category, 'morning-prayer',
    '**조용히 기본 카테고리로 돌아갔다** — 사람이 고른 것과 다른 소리가 나간다')
  assert.equal(pickSourceFile(db, 연결, 0), undefined, '오류인데 파일을 골랐다')

  // 이력에 실패로 적히는 사유가 있는가
  const { 단계사유, 이력판정 } = require('../domain/stepHistory')
  assert.equal(이력판정(단계사유.연결끊김).result, '실패',
    '연결이 끊겼는데 이력에 성공으로 남으면 아무도 모른다')
})

test('연결한 파일이 사라져도 같다 — 기본값으로 안 돌아간다', async () => {
  const db = 시설세우기('mixed')
  const fileId = db.prepare("SELECT id FROM audio_files WHERE original_name = '폴더 밖 음원.mp3'").get().id

  const 판 = await 불러오기()
  판.morning.steps.find(s => s.id === 'morning_prayer').source = { kind: 'file', audioFileId: fileId }
  assert.equal((await 저장(판)).status, 200)

  db.prepare('DELETE FROM audio_files WHERE id = ?').run(fileId)

  const 저장본 = JSON.parse(저장된원문('morning')).find(s => s.id === 'morning_prayer')
  const 연결 = resolveStepSource(db, 저장본)
  assert.equal(연결.error?.code, 'FILE_GONE')
  assert.equal(연결.kind, 'none')
  assert.equal(pickSourceFile(db, 연결, 0), undefined)
})

// ── 기존 커스텀 단계(파일 직접 연결)가 그대로 사는가 ──────────────────────────
test('기존 커스텀 단계의 audio_file_id·playlist 연결이 그대로 읽힌다', () => {
  const db = 시설세우기('legacy')
  const rows = db.prepare("SELECT id FROM audio_files WHERE category = 'morning-prayer' ORDER BY id").all()

  const 한파일 = resolveStepSource(db, { id: 'custom_1', customType: 'audio', audio_file_id: rows[0].id })
  assert.equal(한파일.kind, 'file')
  assert.equal(한파일.origin, 'legacy')
  assert.equal(pickSourceFile(db, 한파일, 0).id, rows[0].id)

  const 재생목록 = resolveStepSource(db, { id: 'custom_2', customType: 'audio', playlist: [rows[1].id, rows[0].id] })
  assert.equal(재생목록.kind, 'file')
  assert.equal(pickSourceFile(db, 재생목록, 0).id, rows[1].id, '재생목록의 첫 번째가 안 나온다')
  assert.equal(pickSourceFile(db, 재생목록, 1).id, rows[0].id, '두 번째 트랙이 안 나온다')
})

// ── 폴더 안 파일 순서 — 기존 규칙 유지 (사용자 조건 4) ────────────────────────
test('폴더 안에서도 재생목록이 이기고, 없으면 올린 순서다', () => {
  const db = 시설세우기('mixed')
  const folderId = db.prepare(
    "SELECT id FROM content_folders WHERE category = 'misc-audio' AND name = '아침 음악'").get().id
  // 이 폴더에 파일 하나를 더 넣어 순서를 볼 수 있게 한다
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
              VALUES ('misc-audio', 'praise3.mp3', '아침 음악 3.mp3', 150, '2026-01-03', ?)`).run(folderId)
  const 연결 = { kind: 'folder', category: 'misc-audio', folderId }

  assert.equal(pickSourceFile(db, 연결, 0).original_name, '아침 음악 1.mp3', '올린 순서가 아니다')
  assert.equal(pickSourceFile(db, 연결, 1).original_name, '아침 음악 3.mp3')

  // 재생목록을 세우면 그 순서가 이긴다 — `pickCategoryFile` 과 같은 규칙
  const ids = db.prepare('SELECT id FROM audio_files WHERE folder_id = ? ORDER BY id').all(folderId).map(r => r.id)
  const ins = db.prepare('INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, 1)')
  ins.run('misc-audio', ids[1], 0)
  ins.run('misc-audio', ids[0], 1)
  assert.equal(pickSourceFile(db, 연결, 0).original_name, '아침 음악 3.mp3', '재생목록이 안 이긴다')

  // 다른 폴더의 파일은 안 섞인다
  const 다른폴더 = db.prepare(
    "SELECT id FROM content_folders WHERE category = 'misc-audio' AND name = '행사 안내'").get().id
  const 다른것 = pickSourceFile(db, { kind: 'folder', category: 'misc-audio', folderId: 다른폴더 }, 0)
  assert.equal(다른것.original_name, '어버이날 안내.mp3', '폴더 경계를 넘어 파일을 골랐다')
})
