-- 0026 되돌리기 (2026-09-10)
--
-- 언제 쓰나: 사유 칸을 되돌려야 할 때. 실행은 사람이 명시적으로 한다 —
--   node scripts/run-migration-sql.cjs db/migrations/0026_broadcasts_fail_reason.down.sql --db <경로>
--
-- **기본 대상은 운영 DB가 아니다.** --db 로 경로를 반드시 준다(스크립트가 강제한다).
--
-- 무엇을 잃는가: 그동안 쌓인 실패 사유 코드. 방송 이력 행 자체와 success 값은 그대로다.
-- 되돌린 뒤에도 서버는 뜬다 — `schema.js` 의 initDB() 가 기동 때마다 같은 ALTER 를 다시 시도해
-- 스스로 복구한다(이 저장소의 기존 방식). 그래서 "되돌렸다"를 확인하려면 **서버를 띄우기 전에**
-- 스키마를 봐야 한다.
--
-- DROP COLUMN 은 SQLite 3.35+ 가 필요하다. Node 24의 node:sqlite 는 그보다 새 판을 쓴다.

ALTER TABLE broadcasts DROP COLUMN fail_reason;
