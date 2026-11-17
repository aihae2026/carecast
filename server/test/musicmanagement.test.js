// 음원/동영상 관리 Phase 6 스모크 테스트: YouTube video_id 파싱, 폴더 메모 upsert,
// 영상 카테고리 재생목록 백필(마이그레이션 회귀 방지).
// 운영 DB(server/db/database.db)를 절대 건드리지 않도록 CARECAST_DB_PATH로 임시 DB를 쓴다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_mm_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { getDB, initDB } = require('../db/schema')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('initDB가 스키마 초기화 시 category_notes 테이블을 만든다', () => {
  initDB()
  const db = getDB()
  const cols = db.prepare("PRAGMA table_info(category_notes)").all().map(c => c.name)
  assert.deepEqual(cols.sort(), ['category', 'note', 'updated_at'].sort())
})

test('category_notes: upsert 패턴으로 저장 후 재조회, 다시 저장하면 덮어쓴다', () => {
  const db = getDB()
  db.prepare(`
    INSERT INTO category_notes (category, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run('bgm', '첫 메모', '2026-08-25T00:00:00.000Z')

  let row = db.prepare('SELECT note FROM category_notes WHERE category = ?').get('bgm')
  assert.equal(row.note, '첫 메모')

  db.prepare(`
    INSERT INTO category_notes (category, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run('bgm', '수정된 메모', '2026-08-25T01:00:00.000Z')

  row = db.prepare('SELECT note FROM category_notes WHERE category = ?').get('bgm')
  assert.equal(row.note, '수정된 메모')

  const count = db.prepare('SELECT COUNT(*) as c FROM category_notes WHERE category = ?').get('bgm')
  assert.equal(count.c, 1, 'upsert이므로 행이 누적되지 않고 1개여야 한다')
})

test('영상 카테고리 재생목록 백필: playlist 없이 이미 있던 영상 파일이 initDB() 후 자동 등록된다', () => {
  const db = getDB()
  // 마이그레이션 이전 상태를 흉내: playlist 엔트리 없이 audio_files에만 직접 삽입
  const r1 = db.prepare(
    "INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at) VALUES ('exercise-video', 'a.mp4', '영상A', 0, ?)"
  ).run(new Date().toISOString())
  const r2 = db.prepare(
    "INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at) VALUES ('exercise-video', 'b.mp4', '영상B', 0, ?)"
  ).run(new Date().toISOString())

  initDB() // 백필 로직 재실행

  const rows = db.prepare(
    'SELECT audio_file_id, sort_order FROM audio_playlist WHERE category = ? ORDER BY sort_order'
  ).all('exercise-video')
  const ids = rows.map(r => r.audio_file_id)
  assert.ok(ids.includes(r1.lastInsertRowid), '기존 영상A가 백필로 재생목록에 등록되어야 한다')
  assert.ok(ids.includes(r2.lastInsertRowid), '기존 영상B가 백필로 재생목록에 등록되어야 한다')
})

test('영상 카테고리 재생목록 백필은 이미 등록된 항목을 중복 등록하지 않는다 (initDB 재실행 시 멱등)', () => {
  const db = getDB()
  const before = db.prepare('SELECT COUNT(*) as c FROM audio_playlist WHERE category = ?').get('exercise-video').c

  initDB()
  initDB()

  const after = db.prepare('SELECT COUNT(*) as c FROM audio_playlist WHERE category = ?').get('exercise-video').c
  assert.equal(after, before, '이미 백필된 상태에서 initDB를 다시 돌려도 재생목록 행 수가 늘어나면 안 된다')
})

// ── Phase 6b: 진짜 폴더 계층 구조(content_folders) ─────────────────

test('initDB가 스키마 초기화 시 content_folders 테이블과 audio_files.folder_id를 만든다', () => {
  const db = getDB()
  const folderCols = db.prepare('PRAGMA table_info(content_folders)').all().map(c => c.name)
  assert.deepEqual(folderCols.sort(), ['id', 'category', 'parent_id', 'name', 'created_at'].sort())
  const fileCols = db.prepare('PRAGMA table_info(audio_files)').all().map(c => c.name)
  assert.ok(fileCols.includes('folder_id'), 'audio_files에 folder_id 컬럼이 있어야 한다')
})

test('폴더 생성: 최상위 및 중첩(하위폴더의 하위폴더)이 parent_id로 정확히 연결된다', () => {
  const db = getDB()
  const top = db.prepare(
    "INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', NULL, ?, ?)"
  ).run('겨울', new Date().toISOString())
  const sub = db.prepare(
    "INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', ?, ?, ?)"
  ).run(top.lastInsertRowid, '캐롤', new Date().toISOString())

  const topLevel = db.prepare('SELECT * FROM content_folders WHERE category = ? AND parent_id IS NULL').all('bgm')
  assert.ok(topLevel.some(f => f.id === top.lastInsertRowid))

  const children = db.prepare('SELECT * FROM content_folders WHERE parent_id = ?').all(top.lastInsertRowid)
  assert.equal(children.length, 1)
  assert.equal(children[0].id, sub.lastInsertRowid)
  assert.equal(children[0].name, '캐롤')
})

test('폴더 비어있음 판정: 파일도 하위폴더도 없으면 삭제 가능, 하나라도 있으면 불가 (routes/audio.js 삭제 가드와 동일 쿼리)', () => {
  const db = getDB()
  const empty = db.prepare(
    "INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', NULL, '빈폴더', ?)"
  ).run(new Date().toISOString())
  const notEmpty = db.prepare(
    "INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', NULL, '안빈폴더', ?)"
  ).run(new Date().toISOString())
  db.prepare(
    "INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id) VALUES ('bgm', 'x.mp3', 'X', 0, ?, ?)"
  ).run(new Date().toISOString(), notEmpty.lastInsertRowid)

  const countChildren = (id) => ({
    folders: db.prepare('SELECT COUNT(*) as c FROM content_folders WHERE parent_id = ?').get(id).c,
    files:   db.prepare('SELECT COUNT(*) as c FROM audio_files WHERE folder_id = ?').get(id).c,
  })

  const emptyCounts = countChildren(empty.lastInsertRowid)
  assert.equal(emptyCounts.folders + emptyCounts.files, 0, '빈 폴더는 삭제 가능해야 한다')

  const notEmptyCounts = countChildren(notEmpty.lastInsertRowid)
  assert.ok(notEmptyCounts.folders + notEmptyCounts.files > 0, '파일이 있는 폴더는 삭제 불가로 판정돼야 한다')
})

test('folder_id 하위호환: 기존 방식대로(폴더 지정 없이) 넣은 파일은 folder_id가 NULL이고 카테고리 전체 조회에 그대로 잡힌다', () => {
  const db = getDB()
  db.prepare(
    "INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at) VALUES ('staff', 'y.mp3', 'Y', 0, ?)"
  ).run(new Date().toISOString())

  const row = db.prepare("SELECT folder_id FROM audio_files WHERE original_name = 'Y'").get()
  assert.equal(row.folder_id, null)

  const all = db.prepare("SELECT * FROM audio_files WHERE category = 'staff'").all()
  assert.ok(all.some(f => f.original_name === 'Y'), 'folder_id 미지정 파일도 카테고리 전체 조회(폴더 개념 모르는 기존 호출부)에 그대로 나와야 한다')
})

// ── **자막 꼬리표는 갈래 옆에 선다** (사용자 지시 2026-09-16) ────────────────────
//
// *"자막이 편집해서 붙으면 갈래 옆에다가 #자막 태그도 달았으면 좋겠는데"*
//
// 앞 판은 이 꼬리표를 **파일 이름 단추 안**에 뒀다. 이름이 그만큼 잘렸고, 단추 안의
// 뱃지라 눌러도 아무 일 없는 것이 단추처럼 보였다.
//
// 여기서 고정하는 것은 **자리**와 **폭**이다. 폭이 특히 조용히 깨진다 — 머리글과 줄의
// 칸 폭이 다르면 표가 통째로 어긋나는데, 그건 화면을 열어 봐야만 보인다.
test('**자막 꼬리표가 갈래 칸 안에 있다** — 이름 단추 안이 아니다', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'src/components/admin/sections/MusicManagement.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const i = 코드만.indexOf('<SubtitleBadge status=')
  assert.ok(i > 0, '자막 꼬리표를 안 그린다')

  // 이 꼬리표 **앞쪽**에 갈래 단추가 있어야 한다(같은 칸 안이라는 뜻).
  // 이름 단추 안에 있었다면 앞쪽에 `truncate text-sm` 인 이름 span 이 더 가깝다.
  const 갈래자리 = 코드만.lastIndexOf('navigateTo(it.category, [])', i)
  const 이름자리 = 코드만.lastIndexOf('{it.name || it.original_name}', i)
  assert.ok(갈래자리 > 이름자리,
    '자막 꼬리표가 아직 이름 단추 쪽에 붙어 있다 — 갈래 칸으로 옮겨야 한다')
})

// ── **폭을 맞추는 방법이 바뀌었다** (2026-09-16) ────────────────────────────────
// 앞 판은 머리글과 줄에 각각 적힌 `w-28 laptop:w-44` 라는 **두 글자를 대조**했다.
// 맞춰 보는 것 자체는 옳았지만, 그건 «두 벌이 있다» 를 전제로 한 검사다.
//
// 2026-09-16 에 자막 칸을 660 으로 넓히면서 갈래 칸이 **자막을 폈나에 따라 달라져야**
// 했고(176 → 112), 그때마다 두 자리를 같이 고치는 것은 언젠가 한쪽을 빠뜨린다.
// 그래서 폭을 `갈래칸폭` 변수 하나로 올리고 양쪽이 그것을 `style` 로 받는다.
//
// **이제 시험이 볼 것은 「같은 값인가」가 아니라 「같은 출처인가」다.** 출처가 하나면
// 다를 수가 없다 — 검사가 더 강해졌다.
test('**갈래 칸 폭이 한 곳에서 나온다** — 두 벌이면 언젠가 한쪽만 고쳐진다', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'src/components/admin/sections/MusicManagement.jsx'), 'utf8')

  assert.match(src, /const 갈래칸폭 = 자막폄 \? \d+ : \d+/,
    '갈래 칸 폭의 단일 출처가 없다')

  // 머리글과 줄이 **둘 다** 그 값을 받는다. 개수를 센다 — 하나만 받으면 표가 어긋난다.
  const 받는곳 = (src.match(/style=\{\{ width: 갈래칸폭 \}\}/g) || []).length
  assert.equal(받는곳, 2,
    `갈래칸폭을 받는 자리가 ${받는곳}곳이다 — 머리글과 줄, 둘이어야 한다`)

  // 옛 모양이 되살아나지 않았는지도 본다(주석은 걷고 본다 — 위 머리말이 옛 글자를 인용한다).
  const 코드 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(코드, /w-28 laptop:w-44/,
    '고정폭 클래스가 다시 박혔다 — 그러면 자막을 펴도 갈래 칸이 안 좁아진다')
})

test('**오른쪽 칸 폭도 한 곳에서 나온다** — 계산과 화면이 갈리면 이름 칸이 뭉갠다', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'src/components/admin/sections/MusicManagement.jsx'), 'utf8')
  const 코드 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const m = /const 오른쪽폭 = 자막폄 \? (\d+) : (\d+)/.exec(코드)
  assert.ok(m, '오른쪽 칸 폭의 단일 출처가 없다')
  // 사용자 지시: 440 의 1.5 배. 자막 편집기는 안에서 두 칸으로 또 갈려서,
  // 이 값이 줄면 문구 칸이 다시 한 글자씩 세로로 흐른다.
  assert.equal(m[1], '660', `자막을 편 폭이 ${m[1]} 이다 — 440 × 1.5 = 660 이어야 한다`)

  assert.match(코드, /style=\{좁나 \? undefined : \{ width: 오른쪽폭 \}\}/,
    '화면이 그 값을 안 받는다 — 곁칸 계산만 넓어지고 칸은 그대로다')
  assert.doesNotMatch(코드, /w-\[440px\]/, '옛 고정폭이 남아 있다 — 계산과 화면이 갈린다')
})
