-- 음원/동영상 관리 Phase 6: 영상 카테고리에 YouTube 링크 항목 지원 + 폴더별 메모.
-- source_type='youtube'인 audio_files 행은 filename=NULL, original_name=제목,
-- youtube_video_id/youtube_url만 채워짐(실제 파일 없음, 디스크 unlink 스킵 대상).
-- 기존 파일 백필(video 카테고리 playlist 자동등록)은 server/db/schema.js의 initDB()에서 처리한다.
ALTER TABLE audio_files ADD COLUMN source_type TEXT DEFAULT 'file';
ALTER TABLE audio_files ADD COLUMN youtube_video_id TEXT;
ALTER TABLE audio_files ADD COLUMN youtube_url TEXT;

CREATE TABLE IF NOT EXISTS category_notes (
  category   TEXT PRIMARY KEY,
  note       TEXT DEFAULT '',
  updated_at TEXT
);
