-- 음원의 출처·이용 조건 (2026-09-21, 사용자 지시)
--
-- *"출처표기에 저작권한에 대해서도 적어서 분쟁안되게 로컬에서 등록해야한다고 적어주고"*
--
-- 유튜브를 걷어내면 배경음악은 기관이 직접 받아 올린 파일이 된다(첫 음원은 Pixabay).
-- 「이 음악 어디서 났냐」에 음원 행 하나로 답하려고 곡마다 셋을 적는다.
-- 무엇을 받고 막는지는 server/domain/audioSource.js 가 정한다(배경음악만 필수).
--
-- ── DEFAULT 를 주지 않는다 ──────────────────────────────────────────────
-- 기존 행은 출처를 **적은 적이 없다** — NULL 이 사실이다. 기본값을 주면 ALTER 가 기존 행을
-- 그 값으로 채워 「확인한 적 없는 출처」가 확인된 것처럼 보인다(db-add-column 규칙, 0024 사고).
--
-- 이전 앱과의 호환: 옛 코드는 이 칸을 안 읽고 안 쓴다. INSERT 는 칸 이름을 명시하고
-- SELECT * 는 여분 필드로 흘린다. 되돌리기는 `.down.sql`.

ALTER TABLE audio_files ADD COLUMN source_name TEXT;
ALTER TABLE audio_files ADD COLUMN source_url TEXT;
ALTER TABLE audio_files ADD COLUMN license_note TEXT;
