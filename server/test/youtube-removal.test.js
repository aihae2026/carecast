// 외부 동영상 서비스(유튜브) 연동 제거 — 3단계 (사용자 지시 2026-09-21).
//
// *"youtube를 완전히 다 뺴야해 알지? 설정부분 연결된거도 잘 봐"*
// 사용자 결정 넷(전부 추천안): 방송 뒤 계절 영상 → 이 PC 「배경 영상」 · TV 송출 예약·흐름 → 삭제 ·
// TV 볼륨 → 없애기 · DB 의 유튜브 데이터 → **파일로 보관한 뒤 삭제**(API 키는 가림).
//
// 여기서 고정하는 것:
//   1) 부팅 보정은 **보관 파일을 먼저 쓰고** 지운다. 파일을 못 쓰면 아무것도 안 지운다.
//   2) API 키는 보관 파일에도 **가려서** 남는다(끝 네 자리만).
//   3) 저장된 단계·예약·흐름의 BGM 은 이 PC 음원으로, TV 송출은 지워지고, 표·칸도 걷힌다.
//   4) 두 번째 부팅에는 아무 일도 안 한다(보관 파일도 안 만든다).
//   5) 제품 코드에 유튜브가 남지 않는다 — 걷어낸 것을 기록하는 자리(보정·마이그레이션·기초값 변환)만 예외.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ytremoval_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const 걷기 = require('../config/youtubeRemovalFix')

const ROOT = path.join(__dirname, '..', '..')
const 보관폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ytremoval-'))

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
  try { fs.rmSync(보관폴더, { recursive: true, force: true }) } catch { /* 무시 */ }
})

// 걷어내기 **전** 판의 DB 모양을 만든다 — 이전 앱의 initDB 가 하던 그대로(표 하나·칸 셋).
function 옛판세우기(db) {
  try { db.exec("ALTER TABLE audio_files ADD COLUMN source_type TEXT DEFAULT 'file'") } catch { /* 이미 있으면 */ }
  try { db.exec('ALTER TABLE audio_files ADD COLUMN youtube_video_id TEXT') } catch { /* 이미 있으면 */ }
  try { db.exec('ALTER TABLE audio_files ADD COLUMN youtube_url TEXT') } catch { /* 이미 있으면 */ }
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, channel TEXT DEFAULT '',
    video_id TEXT, embed_url TEXT, thumbnail TEXT, folder TEXT DEFAULT 'general', added_at TEXT)`)
  const put = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  put('youtube_api_key', 'AIzaSyTEST_SECRET_1234')
  put('vol_tv', '80')
  put('vol_tv_decided', '1')
  put('morning_bgm_type', 'preset')
  put('morning_steps', JSON.stringify([
    { id: 'bgm', label: 'BGM 시작', enabled: true, order: 0, bgmSource: 'yt_preset', bgmKeyword: '클래식', bgmVolume: 40 },
    { id: 'morning_video', label: '아침 후 YouTube 영상', enabled: true, order: 1, videoId: 'x', videoSearch: 'seasonal', durationMin: 15 },
    { id: 'custom_youtube_tv_1', label: 'TV', enabled: true, order: 2, customType: 'youtube_tv', playlist: [1] },
    { id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true, order: 3 },
  ]))
  db.prepare("INSERT INTO youtube_favorites (title, video_id) VALUES ('즐겨찾기 곡', 'v1')").run()
  const 링크 = db.prepare("INSERT INTO audio_files (category, filename, original_name, uploaded_at, source_type, youtube_video_id) VALUES ('exercise-video', '', '링크 영상', '2026-01-01', 'youtube', 'abc')").run().lastInsertRowid
  db.prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('exercise-video', ?, 99, 1)").run(링크)
  const 예약 = (type, bgm) => db.prepare(`INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type, bgm_enabled, bgm_type, bgm_value)
    VALUES (?, '', '전체', '10:00', 1, '2026-01-01', '[]', ?, 1, ?, ?)`).run(`${type}-${bgm}`, type, bgm, '검색어').lastInsertRowid
  const tv예약 = 예약('youtube-tv', 'preset')
  const 안내예약 = 예약('text', 'favorites_general_seq')
  const 흐름 = db.prepare("INSERT INTO flow_sequences (name, created_at, updated_at) VALUES ('흐름', '2026', '2026')").run().lastInsertRowid
  db.prepare("INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, 0, 'video', 'TV', '{}')").run(흐름)
  const 흐름bgm = db.prepare("INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, 1, 'bgm', 'BGM', ?)").run(
    흐름, JSON.stringify({ playlist: [{ bgm_type: 'url', bgm_value: 'https://x' }, { bgm_type: 'local_meal' }] })).lastInsertRowid
  return { 링크, tv예약, 안내예약, 흐름bgm }
}

const 칸있나 = (db, 칸) => db.prepare('PRAGMA table_info(audio_files)').all().some(c => c.name === 칸)
const 표있나 = (db, 표) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(표)
const 설정 = (db, k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null

test('보관 파일을 쓰지 못하면 **아무것도 안 지운다** — 다음 부팅에 다시 돈다', () => {
  const db = getDB()
  const 옛 = 옛판세우기(db)
  // 폴더 자리에 **파일**을 두어 mkdir 이 실패하게 한다
  const 막힌곳 = path.join(보관폴더, '막힘')
  fs.writeFileSync(막힌곳, 'x')
  assert.throws(() => 걷기.run(db, { 보관폴더: path.join(막힌곳, '안쪽') }), '보관을 못 했는데 던지지 않았다')
  assert.ok(db.prepare('SELECT 1 FROM audio_files WHERE id = ?').get(옛.링크), '보관 못 한 채 지웠다')
  assert.equal(설정(db, 'youtube_api_key'), 'AIzaSyTEST_SECRET_1234', '보관 못 한 채 설정을 지웠다')
  assert.ok(표있나(db, 'youtube_favorites'), '보관 못 한 채 표를 지웠다')
})

test('보관 → 고치기·지우기 → 표·칸 삭제 — 한 번에 끝나고, 키는 가려서 남는다', () => {
  const db = getDB()
  const 옛 = { 링크: db.prepare("SELECT id FROM audio_files WHERE source_type = 'youtube'").get().id,
    tv예약: db.prepare("SELECT id FROM schedules WHERE broadcast_type = 'youtube-tv'").get().id,
    안내예약: db.prepare("SELECT id FROM schedules WHERE bgm_type = 'favorites_general_seq'").get().id,
    흐름bgm: db.prepare("SELECT id FROM flow_sequence_steps WHERE step_type = 'bgm'").get().id }
  const 줄 = 걷기.run(db, { 보관폴더, 지금: new Date('2026-09-21T01:02:03Z') })
  assert.ok(줄.some(l => l.includes('지우기 전 보관')), '보관했다는 줄이 없다')

  // ① 보관 파일
  const 파일들 = fs.readdirSync(보관폴더).filter(f => f.startsWith('youtube-removed-'))
  assert.equal(파일들.length, 1, '보관 파일이 하나가 아니다')
  const 보관본문 = fs.readFileSync(path.join(보관폴더, 파일들[0]), 'utf8')
  const 보관 = JSON.parse(보관본문)
  assert.ok(!보관본문.includes('AIzaSyTEST_SECRET_1234'), 'API 키가 보관 파일에 그대로 남았다')
  assert.match(보관.settings.youtube_api_key, /1234\)$/, '가린 키가 끝 네 자리를 안 남긴다 — 어느 키였는지 모른다')
  assert.equal(보관.youtube_favorites.length, 1)
  assert.equal(보관.audio_files.length, 1)
  assert.equal(보관.schedules_deleted.length, 1)
  assert.equal(보관.flow_steps_deleted.length, 1)
  assert.ok(보관.steps.morning_steps.includes('yt_preset'), '고치기 전 단계 원본이 보관에 없다')

  // ② 고치기·지우기
  const 단계 = JSON.parse(설정(db, 'morning_steps'))
  const bgm = 단계.find(s => s.id === 'bgm')
  assert.equal(bgm.bgmSource, 'local')
  assert.equal(bgm.bgmKeyword, undefined, '검색어가 남았다')
  assert.equal(bgm.bgmVolume, 40, '사람이 정한 BGM 볼륨이 사라졌다')
  const 영상 = 단계.find(s => s.id === 'morning_video')
  assert.equal(영상.videoSearch, undefined)
  assert.equal(영상.durationMin, 15, '재생 시간이 사라졌다')
  assert.match(영상.label, /배경 영상/)
  assert.ok(!단계.some(s => s.customType === 'youtube_tv'), 'TV 송출 단계가 남았다')
  assert.ok(단계.some(s => s.id === 'morning_prayer'), '상관없는 단계가 사라졌다')
  for (const k of ['youtube_api_key', 'vol_tv', 'vol_tv_decided', 'morning_bgm_type']) {
    assert.equal(설정(db, k), null, `${k} 가 남았다`)
  }
  assert.equal(db.prepare('SELECT 1 FROM schedules WHERE id = ?').get(옛.tv예약), undefined, 'TV 송출 예약이 남았다')
  const 안내 = db.prepare('SELECT bgm_type, bgm_value FROM schedules WHERE id = ?').get(옛.안내예약)
  assert.equal(안내.bgm_type, 'local_broadcast_seq', '「차례로」였던 것이 차례로를 잃었다')
  assert.equal(안내.bgm_value, '')
  assert.equal(db.prepare("SELECT COUNT(*) c FROM flow_sequence_steps WHERE step_type = 'video'").get().c, 0)
  const 흐름설정 = JSON.parse(db.prepare('SELECT config FROM flow_sequence_steps WHERE id = ?').get(옛.흐름bgm).config)
  assert.deepEqual(흐름설정.playlist.map(p => p.bgm_type), ['local_broadcast', 'local_meal'], '재생목록 곡마다 고치지 않았다')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audio_playlist WHERE audio_file_id = ?').get(옛.링크).c, 0, '링크 영상이 재생목록에 남았다')

  // ③ 표·칸
  assert.equal(표있나(db, 'youtube_favorites'), false)
  for (const 칸 of ['source_type', 'youtube_video_id', 'youtube_url']) assert.equal(칸있나(db, 칸), false, `${칸} 칸이 남았다`)

  // 설정 기록에는 키 값이 안 남는다(비밀은 「바뀌었다」만)
  const 기록 = db.prepare("SELECT old_value FROM settings_history WHERE key = 'youtube_api_key'").all()
  assert.ok(기록.every(r => !String(r.old_value || '').includes('SECRET')), '설정 기록에 키가 남았다')
})

test('두 번째에는 아무 일도 안 한다 — 보관 파일도 안 만든다', () => {
  const 전 = fs.readdirSync(보관폴더).length
  const 줄 = 걷기.run(getDB(), { 보관폴더 })
  assert.deepEqual(줄, [])
  assert.equal(fs.readdirSync(보관폴더).length, 전)
})

test('부팅 보정 목록에 들어 있다 — 마커는 성공한 뒤에만 선다', () => {
  const { DATA_FIXES } = require('../config/dataFixes')
  assert.ok(DATA_FIXES.some(f => f.key === 'datafix_youtube_removal_20260921'), '부팅 보정에 안 걸렸다 — 현장 DB 가 그대로 남는다')
})

test('새 설치는 걷어낸 표·칸을 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'db', 'schema.js'), 'utf8')
  assert.ok(!/CREATE TABLE IF NOT EXISTS youtube_favorites/.test(src))
  assert.ok(!/ADD COLUMN (source_type|youtube_video_id|youtube_url)/.test(src))
  const 기대 = require('../../db/schema.expected.json')
  assert.equal(기대.youtube_favorites, undefined)
  assert.ok(!기대.audio_files.columns.includes('youtube_video_id'))
})

// ── 제품 코드에 남지 않는다 ─────────────────────────────────────────────────────
// 예외는 **걷어낸 것을 기록·변환하는 자리**뿐이다: 부팅 보정(보관 뒤 삭제), 기초값 뽑기의 옛 DB 변환,
// 그 둘을 가리키는 한 줄, 마이그레이션 기록. 나머지 어디에서든 다시 나타나면 되살아난 것이다.
test('제품 코드에 유튜브가 남지 않는다 — 기록·변환 자리만 예외', () => {
  const 예외 = new Set([
    'server/config/youtubeRemovalFix.js', 'server/config/dataFixes.js', 'server/config/site-baseline.json',
    'server/db/schema.js', 'scripts/make-site-baseline.cjs',
  ])
  const 걸린것 = []
  const 훑기 = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) { if ((!['node_modules', 'test', 'db', 'public', 'backups'].includes(e.name)) || rel === 'server/db') 훑기(rel); continue }
      if (!/\.(js|jsx|cjs|mjs|json|css)$/.test(e.name) || 예외.has(rel)) continue
      if (/youtube|유튜브|yt_|ytBGM/i.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) 걸린것.push(rel)
    }
  }
  훑기('src'); 훑기('server'); 훑기('scripts')
  assert.deepEqual(걸린것, [], `걷어낸 유튜브가 되살아났다: ${걸린것.join(', ')}`)
})

// ── Codex 3단계 1회차 지적 셋 (2026-09-21) ─────────────────────────────────────────────

test('단계의 순차 재생은 옮겨 적힌다 — 차례로(_seq)였던 단계가 랜덤이 되지 않는다', () => {
  const { steps } = 걷기.단계고치기([
    { id: 'a', label: '차례', bgmSource: 'yt_favorites_general_seq', bgmKeyword: 'x' },
    { id: 'b', label: '랜덤', bgmSource: 'yt_favorites_general' },
    { id: 'c', label: '이미 고른 차례', bgmSource: 'yt_search_seq', bgmOrder: 'random' },
  ])
  assert.equal(steps[0].bgmSource, 'local')
  assert.equal(steps[0].bgmOrder, 'seq', '순차였던 단계가 순차로 남지 않았다')
  assert.equal('bgmKeyword' in steps[0], false)
  assert.equal(steps[1].bgmOrder, undefined, '랜덤이던 단계에 순차가 붙었다')
  assert.equal(steps[2].bgmOrder, 'random', '이미 적힌 차례를 덮어썼다')
})

test('배경음악 카드는 서버가 아는 지금 상태를 묻는다 — 다른 PC·재진입에서도 멈출 수 있다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/easy/LocalBGMCard.jsx'), 'utf8')
  assert.match(src, /getNowPlaying\(\)/, '카드가 서버 상태를 안 묻는다 — 같은 창 신호만으로는 원격에서 늘 「없음」이다')
  assert.match(src, /setIsPlaying\(!!np\?\.bgm\)/, '서버 상태의 bgm 칸으로 재생 여부를 정하지 않는다')
  assert.match(src, /clearInterval/, '묻기를 화면이 사라질 때 멈추지 않는다')
})

test('BGM 미리듣기의 늦은 재생 거절은 **자기 곡일 때만** 끈다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  assert.match(src, /a\.play\(\)\.catch\(\(\) => \{ if \(previewBgmRef\.current === a\) stopPreviewBgm\(\) \}\)/,
    '앞 곡의 거절이 새 곡까지 끈다')
})
