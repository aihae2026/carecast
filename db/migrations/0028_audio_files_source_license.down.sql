-- 0028 되돌리기 (2026-09-21)
--
-- 언제 쓰나: 음원 출처·이용 조건 칸을 되돌려야 할 때. 실행은 사람이 명시적으로 한다 —
--   node scripts/run-migration-sql.cjs db/migrations/0028_audio_files_source_license.down.sql --db <경로>
--
-- **기본 대상은 운영 DB가 아니다.** --db 로 경로를 반드시 준다(스크립트가 강제한다).
--
-- 무엇을 잃는가: 곡마다 적어 둔 출처·주소·이용 조건. **분쟁 때 근거가 되는 기록이다** —
-- 되돌리기 전에 `SELECT id, original_name, source_name, source_url, license_note FROM audio_files`
-- 결과를 따로 보관할 것. 음원 파일과 나머지 칸은 그대로다.
--
-- 되돌린 뒤에도 서버는 뜬다 — `schema.js` 의 initDB() 가 기동 때마다 같은 ALTER 를 다시 시도해
-- 스스로 복구한다(칸은 빈 채로 돌아온다).

ALTER TABLE audio_files DROP COLUMN license_note;
ALTER TABLE audio_files DROP COLUMN source_url;
ALTER TABLE audio_files DROP COLUMN source_name;
