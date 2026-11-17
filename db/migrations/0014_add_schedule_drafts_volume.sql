-- schedule_drafts.main_volume / bgm_volume — AI 초안도 "볼륨은 잔잔하게"를 담을 수 있게 한다.
--
-- 없을 때의 문제: 규칙 파서(QuickSchedulePhrase)는 볼륨을 읽는데 AI 파서(TTSBroadcast)는
-- 담을 자리가 없어서, 같은 문장을 어느 화면에 넣었느냐에 따라 결과가 달랐다.
--
-- 볼륨은 Gemini에게 묻지 않는다. 규칙 파서와 **같은 사전**(server/domain/ontology.js의
-- detectVolume)으로 원문에서 읽는다 — 모델이 숫자를 지어낼 여지가 없고, 관리자 화면에서
-- 조정한 정성어 수치(volume_word_quiet/loud)가 두 경로에 똑같이 적용된다.
--
-- schedules 쪽과 같은 원칙: NULL이면 시스템 기본값. 0은 무음이라는 유효한 값이다.
ALTER TABLE schedule_drafts ADD COLUMN main_volume INTEGER DEFAULT NULL;
ALTER TABLE schedule_drafts ADD COLUMN bgm_volume  INTEGER DEFAULT NULL;
