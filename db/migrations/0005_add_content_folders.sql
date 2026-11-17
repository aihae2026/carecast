-- 음원/동영상 관리 Phase 6b: 진짜 폴더 계층 구조(iCloud/Google Drive 방식).
-- content_folders 한 행 = 폴더 하나. category는 시스템 12종 중 하나이거나, 카테고리에
-- 안 묶인 순수 사용자 폴더를 위한 pseudo-카테고리 'misc'(방송 엔진은 절대 참조 안 함).
-- parent_id가 NULL이면 해당 category의 최상위 폴더.
-- audio_files.folder_id가 NULL이면 지금처럼 카테고리 최상위(기존 파일 전부 이 상태 유지 —
-- 데이터 이동 없이 그대로 보인다).
CREATE TABLE IF NOT EXISTS content_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT NOT NULL,
  parent_id  INTEGER,
  name       TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES content_folders(id) ON DELETE CASCADE
);

ALTER TABLE audio_files ADD COLUMN folder_id INTEGER;
