-- "승인" 상태인 고도화 제안 중 아직 구현되지 않은 항목을 표시하는 용도.
-- null이 아니면 "구현 대기" — 다음 세션 시작 시 우선 확인 대상(CLAUDE.md 참고).
ALTER TABLE improvement_proposals ADD COLUMN queued_at TEXT;
