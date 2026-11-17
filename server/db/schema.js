// Node.js 22 내장 SQLite 사용 (별도 패키지 설치 불필요)
const { DatabaseSync } = require('node:sqlite')
const path = require('path')
const fs   = require('fs')

// CARECAST_DB_PATH — 테스트에서 운영 DB 대신 임시 DB를 쓰기 위한 override (평소엔 미설정, 기본 경로 사용)
const 기본DB경로 = path.join(__dirname, 'database.db')
const DB_PATH = process.env.CARECAST_DB_PATH || 기본DB경로

/**
 * 두 경로가 **같은 파일을 가리키나** (V③ R8 지적, 2026-09-14).
 *
 * 처음에는 문자열로 비교했다. 그런데 `server/db/database.db`(상대경로)나 슬래시를 바꾼
 * 표기는 **같은 파일인데 글자가 달라서** 빗장을 그냥 지났다 — 검수관이 그 경로로 실제
 * 기본 DB 에 닿는 것을 보여 줬다. 절대경로로 펴고, 구분자를 맞추고, **윈도우는 대소문자를
 * 안 가린다**. `:memory:` 는 파일이 아니라 특수 이름이라 따로 본다.
 */
function 같은파일인가(a, b) {
  if (a === ':memory:' || b === ':memory:') return a === b
  // **윈도우 확장 경로까지 편다**(V③ R10 지적, 2026-09-14). `\\?\C:\...` 는 같은 파일을
  // 가리키는 또 다른 표기인데 `path.resolve` 가 그 접두사를 안 걷는다. 둘 다 같은 표기로
  // 바꿔 놓고 비교한다 — `toNamespacedPath` 는 윈도우가 아니면 그대로 돌려준다.
  const 펴기 = (p) => path.toNamespacedPath(path.resolve(p)).split(/[\\/]+/).join(path.sep)
  const x = 펴기(a), y = 펴기(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}
let db

// ── **시험은 기본 경로의 DB 를 못 연다** (2026-09-14) ────────────────────────────
// 시험 파일이 `CARECAST_DB_PATH` 를 안 정한 채 제품 모듈을 부르면 이 읽기가 **기본 경로**
// 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를 돌리면 운영 DB** 를
// 연다(없으면 새로 만들기까지 한다). 2026-09-14 에 실제로 일곱 파일이 그랬고, 그 탓에
// 외부 독립 검수가 "무시 대상 파일이 늘었다"로 두 번 멈췄다.
//
// **개별 시험을 하나씩 고치는 것으로 끝내지 않는다** — `autoShutdown` 이 같은 자리에 적어
// 둔 그대로다: *"그 방법은 그 시험 파일에만 걸린다. 새 시험이 이 경로를 건드리면 또
// 뚫린다."* 그래서 **부류로** 막는다. 막히면 무엇을 하면 되는지도 함께 말한다.
//
// 운영에는 아무 영향이 없다 — 판정 근거가 DB 나 설정이 아니라 **프로세스**다.
function 기본경로차단확인() {
  // ── **환경변수가 아니라 `DB_PATH` 를 본다** (V③ 지적, 2026-09-14) ──────────────
  // 처음에는 `process.env.CARECAST_DB_PATH` 가 있으면 통과시켰다. 그런데 `DB_PATH` 는
  // **모듈을 불러오는 순간 굳는다**(위 :6). 그래서 시험이 `require` 를 먼저 하고 그 뒤에
  // 환경변수를 정하면 — 흔한 실수다 — **환경변수는 있는데 실제로 여는 것은 기본 경로**다.
  // 검수관이 그 순서를 실제로 돌려 보여 줬다: 빗장이 안 걸린 채 운영 DB 를 열려고 했다.
  // 그러므로 **지금 열려는 경로가 기본 경로인가**만 본다. 굳은 값과 비교하니 순서에 안 속는다.
  if (!같은파일인가(DB_PATH, 기본DB경로)) return          // 제 임시 DB 를 쓰고 있다
  if (!require('../domain/testMode').테스트중()) return   // 평범한 서버 기동
  throw new Error([
    '시험이 기본 경로의 DB 를 열려고 했습니다 — 현장에서는 운영 DB 입니다.',
    '이 시험 파일 맨 위(제품 모듈을 require 하기 **전** — 뒤에 정하면 안 먹습니다)에 넣어 주세요:',
    "  process.env.CARECAST_DB_PATH = require('node:path').join(",
    "    require('node:os').tmpdir(), `carecast_test_이름_${process.pid}_${Date.now()}.db`)",
  ].join('\n'))
}

function getDB() {
  if (!db) {
    기본경로차단확인()
    db = new DatabaseSync(DB_PATH)
    // 연결 설정을 한 곳에 모아 **명시**한다(2026-08-29 리뷰 CC-020).
    // 예전엔 journal_mode 하나만 있어서 나머지는 SQLite·node 기본값에 맡겨져 있었고,
    // 그 기본값이 바뀌면 아무도 모르게 동작이 달라진다. db-pragmas.test.js가 실측으로 고정한다.
    for (const pragma of [
      // WAL — 읽기가 쓰기를 막지 않는다. 매분 도는 스케줄러와 화면 폴링이 겹쳐도 안 밀린다.
      'PRAGMA journal_mode = WAL',
      // **이게 없었다.** 기본값 0이라 잠금이 겹치는 순간 SQLITE_BUSY로 **즉시** 던진다.
      // 이 서버에서 실제로 겹칠 수 있는 지점: 백업(VACUUM INTO)이 읽는 동안의 쓰기,
      // 부트 마이그레이션과 첫 요청, 개발 PC와 현장 PC가 같은 파일을 여는 사고.
      // 5초를 기다려 보고도 안 되면 그때 던진다 — 그 정도면 진짜 문제다.
      'PRAGMA busy_timeout = 5000',
      // 외래키. node:sqlite는 기본으로 켜 주지만 그 기본값에 기대지 않는다.
      'PRAGMA foreign_keys = ON',
    ]) {
      try { db.exec(pragma) } catch (e) { console.warn('[DB] PRAGMA 실패:', pragma, e.message) }
    }
    // synchronous는 **일부러 건드리지 않는다.** 실측값이 FULL(2)이고, 리뷰가 제안한 NORMAL로
    // 낮추면 정전 시 마지막 커밋들을 잃을 수 있다. 요양원 PC는 정전이 실제 시나리오이고,
    // 이 DB는 하루 수백 건 규모라 FULL의 비용이 무시할 만하다 — 안전한 쪽을 유지한다.
  }
  return db
}

function initDB() {
  const database = getDB()

  // 방송 로그 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      time    TEXT,
      type    TEXT,
      content TEXT,
      user    TEXT,
      target  TEXT,
      success INTEGER
    )
  `)

  // 예약 방송 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT,
      content        TEXT,
      target         TEXT,
      scheduled_time TEXT,
      repeat_type    TEXT,
      active         INTEGER DEFAULT 1,
      last_fired     TEXT
    )
  `)

  // broadcasts 테이블 date 컬럼 마이그레이션 (기존 설치 호환)
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN date TEXT') } catch { /* 이미 있으면 무시 — 이 초기화는 매 부팅 돌아도 안전해야 한다 */ }

  // 기존 DB에 last_fired 컬럼이 없는 경우 마이그레이션
  try { database.exec('ALTER TABLE schedules ADD COLUMN last_fired TEXT') } catch { /* 이미 있으면 무시 */ }
  // broadcast_type 컬럼 마이그레이션 (녹음 음원/차임벨 예약 타입 지원)
  try { database.exec("ALTER TABLE schedules ADD COLUMN broadcast_type TEXT DEFAULT 'text'") } catch { /* 이미 있으면 무시 */ }
  // BGM 관련 컬럼 마이그레이션
  try { database.exec('ALTER TABLE schedules ADD COLUMN bgm_enabled INTEGER DEFAULT 0') } catch { /* 이미 있으면 무시 */ }
  try { database.exec("ALTER TABLE schedules ADD COLUMN bgm_type TEXT DEFAULT 'preset'") } catch { /* 이미 있으면 무시 */ }
  try { database.exec("ALTER TABLE schedules ADD COLUMN bgm_value TEXT DEFAULT ''") } catch { /* 이미 있으면 무시 */ }
  try { database.exec("ALTER TABLE schedules ADD COLUMN bgm_title TEXT DEFAULT ''") } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedules ADD COLUMN bgm_delay INTEGER DEFAULT 5') } catch { /* 이미 있으면 무시 */ }
  // 0027 — TTS 가 끝난 뒤 BGM 을 몇 초 더 흘릴까(UX-17).
  // **DEFAULT 0 이다(5 가 아니다).** 5 로 주면 ALTER 가 기존 예약을 전부 5 로 채워서
  // 현장에서 이미 돌고 있는 방송의 소리 길이가 그 자리에서 바뀐다. 지금 동작(즉시 정지)이
  // 기존 행의 사실이므로 그대로 둔다 — 새 예약의 기본 5초는 코드가 정한다
  // (`services/scheduleStore.js` · `src/lib/scheduleUtils.js` 의 BGM_DEFAULTS).
  try { database.exec('ALTER TABLE schedules ADD COLUMN bgm_end_delay INTEGER DEFAULT 0') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedules ADD COLUMN repeat_broadcast INTEGER DEFAULT 0') } catch { /* 이미 있으면 무시 */ }
  // 그룹 방송 컬럼 마이그레이션 (1차/2차 묶음 표시)
  try { database.exec("ALTER TABLE schedules ADD COLUMN group_id TEXT DEFAULT NULL") } catch { /* 이미 있으면 무시 */ }
  // audio_file_id 컬럼 마이그레이션 — "음원선택" 방송 유형(broadcast_type='audio')이 재생할 파일을
  // 가리키는 컬럼이 그동안 아예 없어서, routes/schedules.js가 이 값을 저장할 곳이 없이 조용히
  // 버려지고 있었다(실제로 소리가 안 나가는 버그). audio_files.id를 참조(느슨한 참조, FK 강제 없음).
  try { database.exec('ALTER TABLE schedules ADD COLUMN audio_file_id INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 예약별 BGM 볼륨 — NULL이면 시스템 기본값(domain/volume.js의 bgm 채널)을 그대로 쓴다.
  // 전역 설정을 바꿨다가 되돌리는 방식 대신, 이 방송에만 실리는 값으로 둔다(되돌릴 상태가 없다).
  try { database.exec('ALTER TABLE schedules ADD COLUMN bgm_volume INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 이 방송의 '주 소리' 볼륨 — 유형에 따라 안내 음성/차임벨/음원/영상 채널에 적용된다
  // (domain/volume.js의 mainChannelFor 참고). NULL이면 시스템 기본값. BGM 반주는 bgm_volume이 따로 맡는다.
  try { database.exec('ALTER TABLE schedules ADD COLUMN main_volume INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 이 예약이 트는 음원·영상의 재생 배속(0.5~1.5). NULL이면 1.0배(원래 속도).
  // 노래방 방송처럼 따라 부르는 방송을 느리게 틀기 위한 값 — 볼륨과 같이 이 예약에만 실린다.
  try { database.exec('ALTER TABLE schedules ADD COLUMN playback_rate REAL DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }

  // ── 방송 흐름(순서) 만들기 — 애플 단축어처럼 TTS/BGM/음원/차임벨/대기 블록을 순서대로 저장 ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS flow_sequences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS flow_sequence_steps (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_sequence_id  INTEGER NOT NULL REFERENCES flow_sequences(id),
      sort_order        INTEGER NOT NULL DEFAULT 0,
      step_type         TEXT NOT NULL,
      label             TEXT DEFAULT '',
      config            TEXT NOT NULL DEFAULT '{}'
    )
  `)
  // schedules가 흐름을 참조하는 컬럼 — broadcast_type='flow'일 때 사용
  try { database.exec('ALTER TABLE schedules ADD COLUMN flow_sequence_id INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 이 예약을 어떤 화면이 관리하는지 표시 — 자동방송순서편집기가 만든 커스텀 자동순서는
  // 'morning_editor', 일반 예약은 NULL. 사이드바 목록 필터링용 느슨한 마커.
  try { database.exec("ALTER TABLE schedules ADD COLUMN managed_by TEXT DEFAULT NULL") } catch { /* 이미 있으면 무시 */ }

  // 반복설정 캘린더 스타일 마이그레이션 (반복시작일/반복종료일/반복요일)
  // repeat_type(문자열 enum) → repeat_start_date/repeat_end_date/repeat_weekdays로 대체.
  // repeat_type 컬럼 자체는 삭제하지 않고 남겨두되(CLAUDE.md DB 규칙 — 컬럼 삭제는 사람 승인 필수),
  // 새 스케줄러 로직(server/services/repeatSchedule.js)은 이 3개 컬럼만 사용한다.
  try { database.exec("ALTER TABLE schedules ADD COLUMN repeat_start_date TEXT") } catch { /* 이미 있으면 무시 */ }
  try { database.exec("ALTER TABLE schedules ADD COLUMN repeat_end_date TEXT") } catch { /* 이미 있으면 무시 */ }
  try { database.exec("ALTER TABLE schedules ADD COLUMN repeat_weekdays TEXT") } catch { /* 이미 있으면 무시 */ }

  // 기존 repeat_type 값을 새 컬럼으로 1회성 백필 (repeat_weekdays가 아직 비어있는 행만 대상)
  try {
    const REPEAT_TYPE_TO_WEEKDAYS = {
      '매일':   [0, 1, 2, 3, 4, 5, 6],
      '평일':   [1, 2, 3, 4, 5],
      '주말':   [0, 6],
      '월수금': [1, 3, 5],
      '화목':   [2, 4],
      '주간':   [1], // 기존 서버 로직이 실제로는 "매주 월요일만"이었음 — 그 동작 그대로 보존
      '1회':    [], // 빈 배열 = 1회성
    }
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` // 로컬(KST) 날짜
    const legacyRows = database.prepare(
      "SELECT id, repeat_type FROM schedules WHERE repeat_weekdays IS NULL"
    ).all()
    for (const row of legacyRows) {
      if (row.repeat_type === '월간') {
        // 월간(매월 1일 발동)은 새 요일 기반 모델로 표현 불가 → 지원 종료.
        // 오발동 방지를 위해 비활성화하고 운영자가 수동으로 재설정하도록 남겨둔다.
        database.prepare("UPDATE schedules SET active = 0, repeat_weekdays = '[]' WHERE id = ?").run(row.id)
        console.log(`[DB] schedules.id=${row.id} repeat_type='월간' → 새 모델 미지원, 비활성화(재설정 필요)`)
        continue
      }
      const weekdays = REPEAT_TYPE_TO_WEEKDAYS[row.repeat_type] ?? [0, 1, 2, 3, 4, 5, 6]
      database.prepare(
        "UPDATE schedules SET repeat_start_date = ?, repeat_weekdays = ? WHERE id = ?"
      ).run(today, JSON.stringify(weekdays), row.id)
    }
    if (legacyRows.length) {
      console.log(`[DB] schedules 반복설정 백필 완료: ${legacyRows.length}건`)
    }
  } catch (err) {
    console.error('[DB] 반복설정 백필 실패:', err.message)
  }

  // 환기 방송 자동 그룹 페어링 (title/content에 '환기' 포함 + 20분 이내 쌍 → 동일 group_id)
  try {
    const { randomUUID } = require('crypto')
    const ventRows = database.prepare(
      "SELECT id, scheduled_time FROM schedules WHERE (title LIKE '%환기%' OR content LIKE '%환기%') AND group_id IS NULL AND active = 1 ORDER BY scheduled_time"
    ).all()
    const used = new Set()
    for (let i = 0; i < ventRows.length; i++) {
      if (used.has(ventRows[i].id)) continue
      for (let j = i + 1; j < ventRows.length; j++) {
        if (used.has(ventRows[j].id)) continue
        const [ah, am] = ventRows[i].scheduled_time.split(':').map(Number)
        const [bh, bm] = ventRows[j].scheduled_time.split(':').map(Number)
        const diff = Math.abs((bh * 60 + bm) - (ah * 60 + am))
        if (diff <= 20) {
          const gid = randomUUID()
          database.prepare('UPDATE schedules SET group_id = ? WHERE id = ?').run(gid, ventRows[i].id)
          database.prepare('UPDATE schedules SET group_id = ? WHERE id = ?').run(gid, ventRows[j].id)
          used.add(ventRows[i].id)
          used.add(ventRows[j].id)
          console.log(`[DB] 환기 방송 그룹 자동 페어링: id=${ventRows[i].id} ↔ id=${ventRows[j].id}`)
          break
        }
      }
    }
    // 이미 페어링됐거나 방금 페어링된 환기 방송 title → '🌿환기방송' 통일
    database.prepare(
      "UPDATE schedules SET title = '🌿환기방송' WHERE (title LIKE '%환기%') AND group_id IS NOT NULL AND title != '🌿환기방송'"
    ).run()
  } catch { /* 표시 이름 통일은 실패해도 방송에 지장이 없다 — 부팅을 막지 않는다 */ }

  // 즐겨찾기 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      label   TEXT,
      content TEXT,
      voice   TEXT
    )
  `)

  // 설정 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  // 사용자 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT,
      role          TEXT,
      password_hash TEXT
    )
  `)

  // 음원 파일 테이블 (BGM / 녹음 음원 / 직원멘트)
  database.exec(`
    CREATE TABLE IF NOT EXISTS audio_files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category      TEXT    NOT NULL,
      filename      TEXT    NOT NULL,
      original_name TEXT    NOT NULL,
      duration      INTEGER DEFAULT 0,
      uploaded_at   TEXT,
      last_played   INTEGER
    )
  `)

  // BGM 재생목록 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS audio_playlist (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category      TEXT    NOT NULL,
      audio_file_id INTEGER NOT NULL,
      sort_order    INTEGER DEFAULT 0,
      active        INTEGER DEFAULT 1,
      FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
    )
  `)

  // 음원 자막 (배리어프리 2단계, db/migrations/0023)
  //
  // audio_files에 컬럼으로 안 붙인 이유: 그 표는 방송 경로에서 `SELECT *`로 읽히는 곳이
  // 여섯 군데인데, 자막 JSON은 3분짜리 녹음 문안이 10KB를 넘는다. 컬럼으로 두면 목록 응답과
  // SSE 페이로드에 그 덩어리가 통째로 끌려 들어간다. 자막은 재생 직전에 따로 받아 간다.
  //
  // status가 'ready'인 것만 방송 화면에 나간다 — 받아쓰기·AI가 만든 초안은 사람이 확인하고
  // 올려야 한다(CLAUDE.md 검토 게이트).
  database.exec(`
    CREATE TABLE IF NOT EXISTS audio_subtitles (
      audio_file_id INTEGER PRIMARY KEY,
      cues          TEXT    NOT NULL,
      source        TEXT    NOT NULL DEFAULT 'manual',
      status        TEXT    NOT NULL DEFAULT 'draft',
      updated_at    TEXT    NOT NULL
    )
  `)

  // (링크 등록용 칸 셋과 즐겨찾기 표는 2026-09-21 걷어냈다 — db/migrations/0029, 지우는 일은
  //  config/youtubeRemovalFix.js 가 보관한 뒤에 한다. 새로 만들지 않는다.)

  // 음원/동영상 관리 Phase 6b — 진짜 폴더 계층 구조. category='misc'는 시스템 방송
  // 카테고리가 아니라 사용자가 자유롭게 만드는 최상위 폴더용 pseudo-카테고리이며
  // broadcastSequencer.js의 어떤 stepAudioFile/stepVideoFile 호출도 'misc'를
  // 참조하지 않으므로 자동방송에 절대 섞이지 않는다.
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      category   TEXT NOT NULL,
      parent_id  INTEGER,
      name       TEXT NOT NULL,
      created_at TEXT,
      FOREIGN KEY (parent_id) REFERENCES content_folders(id) ON DELETE CASCADE
    )
  `)
  try { database.exec('ALTER TABLE audio_files ADD COLUMN folder_id INTEGER') } catch { /* 이미 있으면 무시 */ }

  // 음원의 출처·이용 조건(0028, 2026-09-21) — 규칙은 domain/audioSource.js. DEFAULT 를 주지
  // 않는다: 기존 행은 「적은 적 없음」(NULL)이 사실이다(db-add-column 규칙).
  for (const col of ['source_name', 'source_url', 'license_note']) {
    try { database.exec(`ALTER TABLE audio_files ADD COLUMN ${col} TEXT`) } catch { /* 이미 있으면 무시 */ }
  }

  // 폴더(카테고리)별 메모 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS category_notes (
      category   TEXT PRIMARY KEY,
      note       TEXT DEFAULT '',
      updated_at TEXT
    )
  `)

  // 영상 카테고리(exercise-video/lunch-video/dinner-video) 재생목록 백필.
  // 지금까지 stepVideoFile()은 audio_files를 id순 정렬해 첫 번째 파일을 그냥 재생했는데,
  // 이제는 audio_playlist의 활성 항목을 재생하도록 바뀐다(관리자가 여러 영상을 등록해도
  // 어떤 게 실제로 나가는지 고를 수 있게 하기 위함, Phase 6). 이미 업로드된 영상인데
  // playlist에 없는 행이 있으면 여기서 자동 등록해줘야 마이그레이션 직후에도 계속
  // 방송이 나간다(안 하면 현장에서 조용히 영상이 재생 안 되는 회귀 발생).
  try {
    const VIDEO_CATS_FOR_BACKFILL = ['exercise-video', 'lunch-video', 'dinner-video', 'scene-video']
    for (const cat of VIDEO_CATS_FOR_BACKFILL) {
      const missing = database.prepare(`
        SELECT af.id FROM audio_files af
        WHERE af.category = ?
          AND NOT EXISTS (SELECT 1 FROM audio_playlist ap WHERE ap.audio_file_id = af.id AND ap.category = af.category)
        ORDER BY af.id
      `).all(cat)
      if (!missing.length) continue
      const maxOrder = database.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) as m FROM audio_playlist WHERE category = ?'
      ).get(cat)?.m ?? -1
      let next = maxOrder + 1
      for (const row of missing) {
        database.prepare(
          'INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, 1)'
        ).run(cat, row.id, next++)
      }
      console.log(`[DB] ${cat} 재생목록 백필 완료: ${missing.length}건`)
    }
  } catch (err) {
    console.error('[DB] 영상 재생목록 백필 실패:', err.message)
  }

  database.prepare(`
    CREATE TABLE IF NOT EXISTS devlog_notes (
      hash   TEXT PRIMARY KEY,
      note   TEXT DEFAULT '',
      hidden INTEGER DEFAULT 0
    )
  `).run()

  // 자율 점검 루프가 찾아낸 고도화 제안 — 일자별로 저장하고, 승인/추천/차단/보류 상태로 관리
  database.prepare(`
    CREATE TABLE IF NOT EXISTS improvement_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT '추천',
      category    TEXT DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `).run()

  // improvement_proposals.queued_at 컬럼 마이그레이션 — "승인" 상태이면서 아직 구현 안 된
  // 항목을 표시하는 용도(다음 세션 시작 시 우선 확인 대상). status가 승인이 아니게 되거나
  // 구현이 끝나면 null로 비워짐(server/routes/improvementProposals.js 참고).
  try {
    const cols = database.prepare("PRAGMA table_info(improvement_proposals)").all()
    if (!cols.find(c => c.name === 'queued_at')) {
      database.prepare("ALTER TABLE improvement_proposals ADD COLUMN queued_at TEXT").run()
      console.log('[DB] improvement_proposals.queued_at 컬럼 추가됨')
    }
  } catch { /* 컬럼이 이미 있거나 확인 실패 시 조용히 넘어감(기존 마이그레이션 블록과 동일 패턴) */ }

  // ── Phase 5: 코칭 브리프(고도화 제안 페이지 확장) ──────────────────
  // 실행 기록 — 언제 무엇을 어떤 방법으로 확인했는지 로그(추가만, 과거 기록 삭제 없음)
  database.exec(`
    CREATE TABLE IF NOT EXISTS checkin_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name  TEXT NOT NULL,
      result     TEXT NOT NULL,
      note       TEXT DEFAULT '',
      checked_at TEXT NOT NULL
    )
  `)

  // 체크리스트 주차 — is_current=1인 행이 지금 편집 대상, 나머지는 과거 기록(읽기전용, 삭제 금지)
  database.exec(`
    CREATE TABLE IF NOT EXISTS checklist_weeks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_label TEXT NOT NULL,
      started_at TEXT NOT NULL,
      is_current INTEGER DEFAULT 0
    )
  `)

  // 체크리스트 7항목 + 평가점수 5항목을 kind로 구분해 한 테이블에 (라벨 텍스트는 코드 상수)
  database.exec(`
    CREATE TABLE IF NOT EXISTS checklist_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id    INTEGER NOT NULL REFERENCES checklist_weeks(id),
      kind       TEXT NOT NULL,
      item_key   TEXT NOT NULL,
      value      REAL NOT NULL DEFAULT 0,
      note       TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `)

  // 방송 단계별 실행 기록(0021). 이력은 방송 1건에 한 줄이라 "어느 단계에서 멎었나"가
  // 안 남았다. run_key는 로그 이름표와 같은 값이라 로그와 이력을 맞대어 볼 수 있다.
  database.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_steps (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key    TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      step_no    INTEGER NOT NULL,
      label      TEXT    NOT NULL,
      result     TEXT    NOT NULL,
      ms         INTEGER,
      detail     TEXT,
      started_at TEXT    NOT NULL
    )
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_steps_run ON broadcast_steps (run_key)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_steps_at  ON broadcast_steps (started_at)')

  // 서버 가동 구간(0025). 예약 누락 감시가 "그 시각에 서버가 떠 있었나"를 물으려면 이게 있어야 한다.
  // 없으면 밤새 꺼져 있던 시간의 예약이 전부 누락으로 잡힌다(ISSUE-006, 실측 근거는 마이그레이션 주석).
  // last_seen_at 은 스케줄러 tick 이 매분 갱신한다 — 비정상 종료 구간의 끝을 여기서 얻는다.
  database.exec(`
    CREATE TABLE IF NOT EXISTS server_boot (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at   TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      stopped_at   TEXT,
      git_branch   TEXT,
      pid          INTEGER
    )
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_server_boot_started ON server_boot (started_at)')

  // 설정 변경 기록(0020). settings에는 현재값만 있어서 "언제 누가 바꿨나"를 알 길이 없었다.
  // 비밀키는 값을 안 남긴다. 기계가 남기는 흔적 키는 애초에 기록하지 않는다
  // (판단은 domain/settingsHistory.js 한 곳).
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      changed_by TEXT NOT NULL DEFAULT '사람',
      changed_at TEXT NOT NULL
    )
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_settings_history_at ON settings_history (changed_at)')

  // 주차별 체크리스트 **문항**(0019). 값(checklist_entries)과 문항을 가르는 표다 —
  // 예전엔 문항 텍스트가 코드 상수라 새 주차 문항이 오면 개발자가 코드를 고쳐야 했다.
  // item_key는 값과 잇는 열쇠라 **한 번 정하면 안 바꾼다**(순서는 sort_order로만).
  database.exec(`
    CREATE TABLE IF NOT EXISTS checklist_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id    INTEGER NOT NULL REFERENCES checklist_weeks(id),
      item_key   TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_items_week_key
      ON checklist_items (week_id, item_key)
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS coach_questions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      question   TEXT NOT NULL,
      context    TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS similar_cases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      source_label TEXT DEFAULT '',
      source_url   TEXT DEFAULT '',
      sort_order   INTEGER DEFAULT 0
    )
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS brief_references (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      label      TEXT NOT NULL,
      detail     TEXT DEFAULT '',
      url        TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )
  `)

  // 자연어 방송 예약 초안(2026-08-27) — AI(Gemini)가 문장에서 뽑은 예약을 사람이 승인해야만
  // schedules에 반영된다. QuickSchedulePhrase(/api/schedules/parse-phrase, 규칙 기반)와는
  // 별도 경로 — 이쪽은 방송 문구까지 Gemini가 생성해준다.
  database.exec(`
    CREATE TABLE IF NOT EXISTS schedule_drafts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_input          TEXT NOT NULL,
      title              TEXT NOT NULL,
      content            TEXT DEFAULT '',
      scheduled_time     TEXT NOT NULL,
      repeat_start_date  TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending',
      created_at         TEXT NOT NULL,
      resolved_at        TEXT
    )
  `)

  // 이 예약에만 적용할 볼륨 — 규칙 파서와 같은 사전(ontology.detectVolume)으로 읽어 담는다.
  // AI 경로도 "볼륨은 잔잔하게"를 담을 자리가 있어야 두 경로의 결과가 갈리지 않는다.
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN main_volume INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN bgm_volume INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }

  // 방송 유형 컬럼 마이그레이션 — AI 파서가 차임벨·BGM 초안도 만들 수 있게 되면서 필요해졌다.
  // 이 값이 없던 시절의 초안은 전부 TTS(text)였으므로 기본값도 'text'다.
  try { database.exec("ALTER TABLE schedule_drafts ADD COLUMN broadcast_type TEXT DEFAULT 'text'") } catch { /* 이미 있으면 무시 */ }

  // 파싱 실패 기록 마이그레이션 — 지금까지 실패는 아무 데도 남지 않아서(AI는 422/500 응답만,
  // 규칙 파서는 초안 자체를 안 만듦) "자연어 예약 성공률 90%"를 측정할 숫자가 없었다.
  // source: 어느 파서였나('ai' | 'rule'). 기존 행은 전부 AI 초안이므로 기본값이 맞다.
  // failure_reason: 파싱 품질 문제와 시스템 문제를 구분한다(services/parseFailures.js).
  try { database.exec("ALTER TABLE schedule_drafts ADD COLUMN source TEXT DEFAULT 'ai'") } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN failure_reason TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 누적 학습 재료(0017) — 사람이 승인하며 고친 것을 남긴다. NULL은 "안 고쳤음"이 아니라
  // "모름"이다(옛 행). 집계는 채워진 행만 분모로 삼는다 — docs/nl-learning-design.md
  // 이력 ↔ 단계 기록을 잇는 열쇠(0022). 로그 이름표와 같은 값이고, 방송 구간 밖에서 남는
  // 이력(수동·경보)은 NULL이다 — "이을 단계가 없다"는 뜻이다.
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN run_key TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 발사 → 재생 지시까지 걸린 밀리초(0018). NULL은 "안 쟀음"이다 — 옛 행과 TTS를 안 쓰는 유형.
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN prep_ms INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN schedule_id INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN approved_json TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE schedule_drafts ADD COLUMN edited_fields TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }

  // ── 예약 방송 render/play 분리(0024) ────────────────────────────────────
  // 배경·흐름도: docs/flows/broadcast-pipeline.md · 이력: db/migrations/0024_broadcast_pipeline.sql
  //
  // 렌더 결과를 파일시스템 말고 여기서도 관리하는 이유: 지금도 tts-cache/에 mp3가 쌓이지만
  // **언제 만든 것인지·어느 예약 것인지·가변인지**를 아무도 몰라서, 가변 문안의 오디오를
  // 예약 시각 뒤에 폐기할 수가 없다. 어제 날씨가 오늘 나가는 것을 막는 것이 이 표의 일이다.
  database.exec(`
    CREATE TABLE IF NOT EXISTS audio_cache (
      cache_key      TEXT PRIMARY KEY,
      schedule_id    INTEGER,
      content_source TEXT    NOT NULL DEFAULT 'manual',
      text_hash      TEXT,
      voice          TEXT,
      rate           TEXT,
      pitch          TEXT,
      salt           TEXT    NOT NULL,
      file_path      TEXT    NOT NULL,
      bytes          INTEGER,
      rendered_at    TEXT    NOT NULL,
      expires_at     TEXT
    )
  `)
  try { database.exec('CREATE INDEX IF NOT EXISTS idx_audio_cache_schedule ON audio_cache (schedule_id)') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('CREATE INDEX IF NOT EXISTS idx_audio_cache_expires  ON audio_cache (expires_at)') } catch { /* 이미 있으면 무시 */ }

  // schedules.content_source 가 **렌더 판정의 권위**다. broadcasts 쪽 같은 이름 컬럼은
  // "그때 무엇으로 나갔나"의 스냅샷이라 값이 다를 수 있다(등록 뒤 문안을 고친 경우).
  // 렌더 시점 결정은 반드시 schedules 것을 읽는다 — 이력으로는 방송 전 판단을 못 한다.
  try { database.exec("ALTER TABLE schedules ADD COLUMN content_source TEXT DEFAULT 'manual'") } catch { /* 이미 있으면 무시 */ }
  // 유예 판정 1순위. 'normal' | 'emergency'. 긴급은 유예 없이 성공까지 재시도하므로
  // **사람이 명시적으로만** 지정한다 — 잘못 들어가면 무한 재시도가 된다.
  try { database.exec("ALTER TABLE schedules ADD COLUMN urgency TEXT DEFAULT 'normal'") } catch { /* 이미 있으면 무시 */ }

  try { database.exec('ALTER TABLE broadcasts ADD COLUMN content_source TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 예정 시각이 있어야 지연이 계산된다. prep_ms(발사→재생 지시)만으로는 "예정보다 얼마나
  // 늦었나"를 못 본다 — 지금 고치려는 것이 바로 그 숫자다.
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN scheduled_at TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN rendered_at  TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN played_at    TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN delay_ms     INTEGER DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }
  // 0026 — 왜 실패했나를 **코드**로 남긴다(P-95). `success = 0` 은 "안 나갔다"만 말한다.
  // **DEFAULT NULL 이다** — 기존 행을 안 채운다. NULL = "사유를 안 남기던 때"이고 그것이
  // '기록 없음'과 '사유 있음'을 가른다(CLAUDE.md DB 규칙: DEFAULT 를 주면 IS NULL 분류가 죽는다).
  try { database.exec('ALTER TABLE broadcasts ADD COLUMN fail_reason TEXT DEFAULT NULL') } catch { /* 이미 있으면 무시 */ }

  // 기존 행 채우기 — **비워 두면 안 된다.** isVariable()은 모르는 값을 가변으로 보므로
  // (안전한 쪽), 비워 두면 기존 예약 전부가 가변으로 판정되어 매일 재합성 + 캐시 폐기가
  // 반복된다. 정시성을 고치려는 작업이 합성량을 늘리는 역전이 일어난다.
  //
  // 분류는 결정론적이다. 낱말로 추정하지 않는다 — 토큰이 있으면 가변, 시스템이 관리하면
  // system_template, 나머지는 manual. 애매한 건(토큰 없이 날씨 낱말만 있는 문안)은
  // **자동 판단하지 않고** manual 로 두어 오늘과 똑같이 동작하게 하고,
  // `node scripts/report-content-source.cjs` 가 사람에게 목록으로 보고한다.
  // **딱 한 번만 돈다.** 매 기동마다 돌리면, 사람이 나중에 손으로 'manual'로 정해 둔 행을
  // 서버가 다시 system_template 으로 되돌린다 — 사람의 결정을 기계가 덮는 자리가 된다.
  // ADD COLUMN 의 DEFAULT 가 기존 행을 이미 'manual'로 채우므로 조건은 "IS NULL"이 아니라
  // "아직 기본값 그대로"다(2026-09-06 샌드박스 실측에서 IS NULL 조건이 한 건도 안 걸렸다).
  try {
    const done = database.prepare("SELECT value FROM settings WHERE key = 'schema_0024_backfilled'").get()
    if (!done) {
      database.exec("UPDATE schedules SET urgency = 'normal' WHERE urgency IS NULL")
      database.exec("UPDATE schedules SET content_source = 'manual_template' WHERE content_source = 'manual' AND content LIKE '%{{%' AND content LIKE '%}}%'")
      database.exec("UPDATE schedules SET content_source = 'system_template' WHERE content_source = 'manual' AND managed_by = 'morning_editor'")
      // 'ai' 는 LLM 문안이라 system_template 과 다르게 다룬다(폴백 정책이 갈릴 수 있다)
      database.exec("UPDATE schedules SET content_source = 'llm' WHERE content_source = 'manual' AND managed_by = 'ai'")
      database.exec("UPDATE schedules SET content_source = 'manual' WHERE content_source IS NULL")
      database.prepare("INSERT INTO settings (key, value) VALUES ('schema_0024_backfilled', ?)").run(new Date().toISOString())
      console.log('[스키마] 0024 — 기존 예약의 content_source·urgency 를 채웠습니다 (1회). 확인: node scripts/report-content-source.cjs')
    }
  } catch (e) { console.warn('[스키마] content_source 채우기 실패(기동은 계속):', e.message) }

  // 볼륨 기본값 시딩 — 지금까지 settings에 볼륨 키가 하나도 저장된 적이 없어서, 화면·SSE·
  // 실제 재생이 각자의 코드 기본값을 쓰다 보니 "화면엔 50인데 방송은 70"처럼 어긋나 있었다.
  // 이미 값이 있으면 절대 덮어쓰지 않는다(현장에서 맞춰 둔 볼륨 보존) — domain/volume.js 참고.
  try { require('../domain/volume').seedVolumeDefaults(database) } catch (e) { console.warn('[볼륨 시딩]', e.message) }

  // 최초 1회 시딩 — 코칭 브리프 문서 원문 그대로
  try {
    const caseCount = database.prepare('SELECT COUNT(*) as c FROM similar_cases').get().c
    if (caseCount === 0) {
      const insCase = database.prepare(
        'INSERT INTO similar_cases (title, description, source_label, source_url, sort_order) VALUES (?, ?, ?, ?, ?)'
      )
      insCase.run('성공 — 정보·케어 접근성 향상', '해외 장기요양시설의 스마트스피커 도입 연구들에서 리마인더·정보접근·직원 업무 지원 효과 확인.', 'Oxford Innovation in Aging', 'https://academic.oup.com/innovateage/article/6/4/igac024/6569144', 0)
      insCase.run('실패 요인 — 음성인식·교육 장벽', '어르신 발화 인식 오류, Wi-Fi/기기 설정을 직접 못 함, 직원 교육 부족 시 활용도 급감이 반복 지적됨.', 'JMIR 지역 도입 연구', 'https://preprints.jmir.org/preprint/26767', 1)
      insCase.run('일반 AI 프로젝트 실패율 60~90%', '원인은 대부분 기술이 아니라 목표 불명확·워크플로 미통합. CareCast는 이미 실제 운영에 통합돼 이 패턴을 피함.', 'RAND 보고서', 'https://www.rand.org/pubs/research_reports/RRA2680-1.html', 2)
      console.log('[DB] similar_cases 초기 시딩 완료')
    }
  } catch (err) { console.error('[DB] similar_cases 시딩 실패:', err.message) }

  try {
    const refCount = database.prepare('SELECT COUNT(*) as c FROM brief_references').get().c
    if (refCount === 0) {
      const insRef = database.prepare(
        'INSERT INTO brief_references (label, detail, url, sort_order) VALUES (?, ?, ?, ?)'
      )
      // **개발 저장소 줄은 심지 않는다** (2026-09-18). 비공개 저장소라 설치한 기관이 누르면 404 가 뜬다.
      // 화면에 죽은 링크를 놓지 않는다 — 우리 PC 에 이미 들어간 줄은 그대로 두고(있는 값은 안 덮는다) 새 설치에만 적용된다.
      insRef.run('자동 검증 결과', 'npm run verify', '', 0)
      insRef.run('프로젝트 개발 문서', '저장소의 CLAUDE.md · TASKS.md', '', 1)
      insRef.run('장기요양시설 스마트스피커 연구', 'Oxford Innovation in Aging', 'https://academic.oup.com/innovateage/article/6/4/igac024/6569144', 2)
      insRef.run('지역 단위 도입 장벽 연구', 'JMIR Preprints #26767', 'https://preprints.jmir.org/preprint/26767', 3)
      insRef.run('AI 프로젝트 실패 원인 보고서', 'RAND Corporation', 'https://www.rand.org/pubs/research_reports/RRA2680-1.html', 4)
      insRef.run('AI 챌린지 해 코칭 안내', '참가팀 제공 자료', '', 5)
      console.log('[DB] brief_references 초기 시딩 완료')
    }
  } catch (err) { console.error('[DB] brief_references 시딩 실패:', err.message) }

  // 첫 주차 자동 생성(아직 하나도 없을 때만)
  try {
    const weekCount = database.prepare('SELECT COUNT(*) as c FROM checklist_weeks').get().c
    if (weekCount === 0) {
      database.prepare(
        'INSERT INTO checklist_weeks (week_label, started_at, is_current) VALUES (?, ?, 1)'
      ).run('1주차', new Date().toISOString())
      console.log('[DB] checklist_weeks 첫 주차 생성')
    }
  } catch (err) { console.error('[DB] checklist_weeks 초기 생성 실패:', err.message) }

  // 로드맵(맨 위 4주 간트차트) — settings 키로 관리, 최초 1회만 시딩(이후엔 관리자가 클릭으로 조정)
  try {
    const existing = database.prepare("SELECT value FROM settings WHERE key = 'roadmap_weeks'").get()
    if (!existing) {
      const roadmap = [
        { label: '1주차', dateRange: '8.24~8.28', title: '기능 보강 및 코칭 브리프 정비', status: 'active', detail: '예약 반복설정 재설계, 음원·동영상 관리 폴더 탐색기 재구축, 코칭 브리프 통합' },
        { label: '2주차', dateRange: '8.31~9.4',  title: '사용자 경험 반영·수정', status: 'upcoming', detail: '현장 피드백 기반 UI 반복 개선' },
        { label: '3주차', dateRange: '9.7~9.11',  title: 'UX/UI 디자인', status: 'upcoming', detail: '' },
        { label: '4주차', dateRange: '9.14~9.18', title: '패키징 작업', status: 'upcoming', detail: '설치 스크립트 확산 준비' },
      ]
      database.prepare("INSERT INTO settings (key, value) VALUES ('roadmap_weeks', ?)").run(JSON.stringify(roadmap))
      console.log('[DB] roadmap_weeks 초기 시딩 완료')
    }
  } catch (err) { console.error('[DB] roadmap_weeks 시딩 실패:', err.message) }

  // 음원 저장 디렉토리 초기화 (exercise 카테고리 추가)
  const audioCats = ['bgm', 'morning-prayer', 'lunch-prayer', 'dinner-prayer', 'staff', 'exercise']
  for (const cat of audioCats) {
    fs.mkdirSync(require('../domain/audioPaths').audioCategoryDir(cat), { recursive: true })
  }

  // 기본 즐겨찾기 (최초 1회)
  const favCount = database.prepare('SELECT COUNT(*) as cnt FROM favorites').get()
  if (favCount.cnt === 0) {
    const ins = database.prepare('INSERT INTO favorites (label, content, voice) VALUES (?, ?, ?)')
    ins.run('식사 안내',    '어르신 여러분, 식사 시간이 되었습니다. 식당으로 이동해 주시기 바랍니다.',    'ko-KR-SunHiNeural')
    ins.run('약 복용',      '약 복용 시간입니다. 담당 간호사에게 약을 받아 복용해 주시기 바랍니다.',      'ko-KR-SunHiNeural')
    ins.run('프로그램 시작','오늘의 프로그램이 시작됩니다. 1층 강당으로 모여 주시기 바랍니다.',           'ko-KR-SunHiNeural')
    ins.run('보호자 안내',  '보호자분께서 방문하셨습니다. 1층 접수처로 나와 주시기 바랍니다.',            'ko-KR-SunHiNeural')
  }

  // ── 방송 일정 설정 마이그레이션 ───────────────────────────
  // 문구 상수는 domain/broadcastDefaults.js에서 — 예전엔 broadcastSequencer(services)를
  // 통째로 당겼는데, 그쪽은 morning → schema로 되돌아오는 순환 고리라 lazy require로만
  // 버티는 배선이었다(배선도 ②). domain은 이 파일을 모른다.
  const {
    BREAKFAST_PRAYER_DEFAULT,
    LUNCH_PRAYER_DEFAULT,
    DINNER_PRAYER_DEFAULT,
    EXERCISE_TTS_DEFAULT,
    LUNCH_TTS_DEFAULT,
    DINNER_TTS_DEFAULT,
  } = require('../domain/broadcastDefaults')

  // morning_time: 08:30 → 07:50 업데이트
  try {
    const mt = database.prepare("SELECT value FROM settings WHERE key='morning_time'").get()
    if (!mt) {
      database.prepare("INSERT INTO settings (key, value) VALUES ('morning_time', '07:50')").run()
    } else if (mt.value === '08:30') {
      database.prepare("UPDATE settings SET value='07:50' WHERE key='morning_time'").run()
      console.log('[DB] morning_time 08:30 → 07:50 업데이트')
    }
  } catch { /* 부팅 시 값 보정 — 실패해도 서버 기동을 막지 않는다(설정은 화면에서 고칠 수 있다) */ }

  // 새 방송 시간 기본값 설정 (최초 1회)
  const newSettings = [
    // **아침·저녁 마무리도 켠 값을 심는다**(2026-10-23 배포판 점검에서 발견). 스케줄러·오늘 일과·감시는 이 칸이
    // 실제로 'true' 일 때만 방송으로 친다(`autoBroadcasts.readEnabledAutoTimes`). 그런데 셋(체조·점심·저녁)만
    // 심고 이 둘은 안 심어서, **새로 설치한 PC 는 설정 화면엔 「켜짐」인데 07:50·18:00 방송이 나가지 않았다**
    // (화면은 없으면 켜짐으로 읽는다). 이미 값이 있으면 안 덮는다 — 사람이 끈 것은 그대로다.
    ['morning_enabled',            'true'],
    ['evening_prayer_enabled',     'true'],
    ['exercise_broadcast_time',    '09:00'],
    ['exercise_broadcast_enabled', 'true'],
    ['lunch_broadcast_time',       '11:15'],
    ['lunch_broadcast_enabled',    'true'],
    // **16:15 다**(2026-09-18 사용자 결정, T-33). 여기가 `16:20` 이라 **새로 설치한 PC 만**
    // 문서와 달랐다 — README·매뉴얼·`autoBroadcasts.defaultTime` 은 전부 16:15 인데, 심어
    // 버리면 그 기본값은 영영 안 쓰인다. 현장은 사람이 맞춘 값이라 이 줄과 무관하다
    // (이미 값이 있으면 안 덮는다). `server/test/fresh-install-times.test.js` 가 고정한다.
    ['dinner_broadcast_time',      '16:15'],
    ['dinner_broadcast_enabled',   'true'],
    ['exercise_tts',               EXERCISE_TTS_DEFAULT],
    ['lunch_tts',                  LUNCH_TTS_DEFAULT],
    ['dinner_tts',                 DINNER_TTS_DEFAULT],
    ['breakfast_prayer_tts',       BREAKFAST_PRAYER_DEFAULT],
    ['lunch_prayer_tts',           LUNCH_PRAYER_DEFAULT],
    ['dinner_prayer_tts',          DINNER_PRAYER_DEFAULT],
  ]
  for (const [key, value] of newSettings) {
    try {
      database.prepare(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
      ).run(key, value)
    } catch { /* INSERT OR IGNORE라 이미 있으면 아무 일도 안 한다 — 실패해도 기본값이 없을 뿐이다 */ }
  }

  // (예전 이 자리에는 처음 운영한 한 시설의 에어코리아 측정소 옛 이름을 새 이름으로 바꾸는 부팅 보정이
  //  있었다. 측정소 이름이 곧 시설 위치라 공개판에서 뺐다(2026-10-17). 그 시설은 오래전에 바뀐 값으로
  //  돌고 있고, 새 설치에는 그 옛 이름이 생길 길이 없어 실제 동작은 달라지지 않는다.)

  console.log('[DB] 데이터베이스 초기화 완료')
}

module.exports = { getDB, initDB }
