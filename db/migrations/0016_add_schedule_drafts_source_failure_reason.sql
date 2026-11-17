-- schedule_drafts에 파싱 경로·실패 사유 기록 컬럼 추가 (2026-08-28 자연어 파싱 실패 기록 작업분)
--
-- 이 두 컬럼은 코드(server/db/schema.js)와 db/schema.expected.json에는 들어갔는데
-- 마이그레이션 파일이 누락된 채 커밋됐다 — 2026-08-29 코드 리뷰에서 발견해 소급 기록한다.
-- (CLAUDE.md 4번 규칙: 스키마 변경은 마이그레이션 + expected.json + verify:db 3종 세트)
--
-- source        : 초안을 만든 파서 경로. 'ai'(Gemini 초안) / 'rule'(규칙 파서 실패 기록).
--                 경로별 성공률을 나눠 봐야 어느 파서가 약한지 알 수 있다.
-- failure_reason: 파싱 실패 사유 코드(server/services/parseFailures.js의 FAILURE_REASONS).
--                 실패한 원문과 사유가 남아야 파서를 고칠 단서가 된다.
--
-- 실제 반영은 server/db/schema.js initDB()의 try { ALTER TABLE ... } catch {} 블록이 한다.

ALTER TABLE schedule_drafts ADD COLUMN source TEXT DEFAULT 'ai';
ALTER TABLE schedule_drafts ADD COLUMN failure_reason TEXT DEFAULT NULL;
