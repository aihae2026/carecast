-- schedules.audio_file_id — "음원선택" 방송 유형(broadcast_type='audio')이 재생할 파일을
-- 가리키는 컬럼. 그동안 이 컬럼 자체가 없어서 routes/schedules.js가 값을 저장할 곳이 없이
-- 조용히 버려지고 있었다(실제로 소리가 안 나가는 버그). audio_files.id를 참조하지만
-- 이 프로젝트는 SQLite FK를 강제하지 않으므로(PRAGMA foreign_keys 미설정) 느슨한 참조다.
ALTER TABLE schedules ADD COLUMN audio_file_id INTEGER DEFAULT NULL;
