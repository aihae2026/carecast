-- 외부 동영상 서비스(유튜브) 연동 제거 (2026-09-21, 사용자 결정)
--
-- *"youtube를 완전히 다 뺴야해 알지? 설정부분 연결된거도 잘 봐"*
--
-- 실제 반영은 이 파일이 아니라 부팅 보정 `server/config/youtubeRemovalFix.js` 가 한다
-- (dataFixes 의 `datafix_youtube_removal_20260921`). 순서가 규칙이라서다:
--   ① 지울 데이터(즐겨찾기·링크 등록 영상·TV 송출 예약·흐름 단계·설정값)를 먼저
--      server/db/backups/youtube-removed-*.json 에 쓴다(API 키는 가림). 못 쓰면 아무것도 안 지운다.
--   ② 값 고치기·행 지우기를 한 트랜잭션으로.
--   ③ 아래 DDL 을 맨 끝에.
-- 새 설치는 schema.js 가 이 표·칸을 더 만들지 않는다.
--
-- 되돌리기는 `.down.sql` — 빈 표·칸만 돌아온다. 데이터는 ① 의 파일에 있다.

DROP TABLE IF EXISTS youtube_favorites;
ALTER TABLE audio_files DROP COLUMN youtube_video_id;
ALTER TABLE audio_files DROP COLUMN youtube_url;
ALTER TABLE audio_files DROP COLUMN source_type;
