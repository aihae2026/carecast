-- 0029 되돌리기 (2026-09-21)
--
-- 언제 쓰나: 외부 동영상 연동을 걷어내기 전 판으로 되돌릴 때. 실행은 사람이 명시적으로 한다 —
--   node scripts/run-migration-sql.cjs db/migrations/0029_remove_youtube.down.sql --db <경로>
--
-- **기본 대상은 운영 DB가 아니다.** --db 로 경로를 반드시 준다(스크립트가 강제한다).
--
-- 무엇이 돌아오나: **빈** 표와 칸뿐이다. 지운 데이터는 server/db/backups/youtube-removed-*.json 에 있다.
-- 사실 이전 앱은 부팅 때마다 같은 CREATE/ALTER 를 시도하므로 이 파일 없이도 스스로 복구한다.

CREATE TABLE IF NOT EXISTS youtube_favorites (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT    NOT NULL,
  channel   TEXT    DEFAULT '',
  video_id  TEXT,
  embed_url TEXT,
  thumbnail TEXT,
  folder    TEXT    DEFAULT 'general',
  added_at  TEXT
);
ALTER TABLE audio_files ADD COLUMN source_type TEXT DEFAULT 'file';
ALTER TABLE audio_files ADD COLUMN youtube_video_id TEXT;
ALTER TABLE audio_files ADD COLUMN youtube_url TEXT;
