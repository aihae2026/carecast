-- Phase 5: "고도화 제안" 페이지를 코칭 브리프 전체 내용으로 확장.
-- 체크리스트 7항목/점수 5항목의 라벨 텍스트는 코드 상수로 관리하고, DB에는 값만 저장한다.
CREATE TABLE IF NOT EXISTS checkin_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL,
  result TEXT NOT NULL,
  note TEXT DEFAULT '',
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_label TEXT NOT NULL,
  started_at TEXT NOT NULL,
  is_current INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES checklist_weeks(id),
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  context TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS similar_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_label TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brief_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  detail TEXT DEFAULT '',
  url TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- 로드맵(맨 위 4주 간트차트)은 settings 키(roadmap_weeks, JSON)로 관리 — 전용 테이블 없음.
