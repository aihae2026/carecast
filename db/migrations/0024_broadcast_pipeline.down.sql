-- 0024 되돌리기 (2026-09-06)
--
-- 언제 쓰나: 1단계를 되돌려야 할 때. 실행은 사람이 명시적으로 한다 —
--   node scripts/run-migration-sql.cjs db/migrations/0024_broadcast_pipeline.down.sql --db <경로>
--
-- **기본 대상은 운영 DB가 아니다.** --db 로 경로를 반드시 준다(스크립트가 강제한다).
--
-- 무엇을 잃는가: audio_cache 의 렌더 이력과, broadcasts 에 쌓인 지연 숫자
-- (scheduled_at·rendered_at·played_at·delay_ms)를 잃는다. 오디오 **파일 자체**는
-- tts-cache/ 에 그대로 남는다 — 이 마이그레이션은 파일을 안 지운다.
--
-- 되돌린 뒤에도 서버는 뜬다: schema.js 의 initDB() 가 기동 때마다 같은 ALTER 를 다시 시도해
-- 스스로 복구한다(이 저장소의 기존 방식). 그래서 "되돌렸다"를 확인하려면 **서버를 띄우기 전에**
-- 스키마를 봐야 한다.
--
-- DROP COLUMN 은 SQLite 3.35+ 가 필요하다. Node 24의 node:sqlite 는 그보다 새 판을 쓴다.

DROP INDEX IF EXISTS idx_audio_cache_expires;
DROP INDEX IF EXISTS idx_audio_cache_schedule;
DROP TABLE IF EXISTS audio_cache;

ALTER TABLE schedules  DROP COLUMN content_source;
ALTER TABLE schedules  DROP COLUMN urgency;

ALTER TABLE broadcasts DROP COLUMN content_source;
ALTER TABLE broadcasts DROP COLUMN scheduled_at;
ALTER TABLE broadcasts DROP COLUMN rendered_at;
ALTER TABLE broadcasts DROP COLUMN played_at;
ALTER TABLE broadcasts DROP COLUMN delay_ms;
