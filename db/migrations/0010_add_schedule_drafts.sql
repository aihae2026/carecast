-- schedule_drafts — 자연어("8월 28일 오후 두시에 프로그램 안내 방송 예약해줘")로 들어온
-- 방송 예약 요청을 AI(Gemini)가 날짜/시간/제목/내용으로 뽑아낸 초안. 사람이 승인해야만
-- schedules에 실제로 생성된다(scheduler.js는 schedules만 읽으므로 초안 상태로는
-- 방송이 절대 실행되지 않는다). status: pending / approved / rejected.
--
-- QuickSchedulePhrase.jsx(/api/schedules/parse-phrase, 규칙 기반, AI 키 불필요)와는 별도 경로다.
-- 이쪽은 Gemini로 방송 안내 문구까지 생성해주는 대신 AI 키·간헐적 503 의존이 있고,
-- parse-phrase는 오프라인으로 항상 동작하지만 시간·요일만 뽑고 문구는 생성하지 않는다.
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
);
