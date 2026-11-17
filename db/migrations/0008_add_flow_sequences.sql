-- 방송 흐름(순서) 만들기 — 애플 단축어처럼 TTS/BGM/음원/차임벨/대기 블록을 순서대로 저장해
-- 재사용 가능한 이름 붙은 시퀀스로 관리한다. 각 단계의 타입별 설정은 config(JSON)에 저장하고,
-- 필드명은 기존 schedules 테이블의 동명 컬럼(content, bgm_type, bgm_value, ..., audio_file_id)과
-- 최대한 그대로 맞춘다(server/services/scheduler.js, ScheduledBroadcast.jsx 참고).
CREATE TABLE IF NOT EXISTS flow_sequences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_sequence_steps (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_sequence_id  INTEGER NOT NULL REFERENCES flow_sequences(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  step_type         TEXT NOT NULL,   -- 'tts' | 'bgm' | 'audio' | 'chime' | 'delay'
  label             TEXT DEFAULT '',
  config            TEXT NOT NULL DEFAULT '{}'
);

-- schedules가 흐름을 참조 — broadcast_type='flow'일 때 사용. SQLite FK를 강제하지 않으므로
-- (PRAGMA foreign_keys 미설정) 삭제 시 server/routes/flows.js에서 직접 사용 여부를 체크한다.
ALTER TABLE schedules ADD COLUMN flow_sequence_id INTEGER DEFAULT NULL;
