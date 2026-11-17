-- schedule_drafts에 "사람이 무엇을 고쳤나"를 남기는 컬럼 셋 (2026-09-03, 고도화 제안 #10 1단계)
--
-- 왜 필요한가: 자연어 예약은 지금도 원문(raw_input)과 AI가 읽어낸 값을 남기지만,
-- **사람이 승인하며 고친 값은 어디에도 안 남는다.** approveDraft(id, overrides)의
-- overrides가 곧 "AI가 틀린 것"인데 insertSchedule로 흘러가고 버려지고, 만들어진
-- 예약 id도 초안 행에 안 적혀서 나중에 초안↔최종을 맞대어 볼 길이 없었다.
-- "AI가 무엇을 자꾸 틀리나"가 학습의 핵심 재료인데 그것이 수집되지 않고 있었다.
-- 설계·단계 계획은 docs/nl-learning-design.md.
--
-- schedule_id    : 승인으로 만들어진 schedules 행 id. 초안↔최종을 잇는 유일한 끈.
--                  FK 선언은 하지 않는다 — 이 저장소는 schedules를 참조하는 다른 곳에도
--                  FK를 안 걸었고(예: schedules.audio_file_id), 예약이 지워져도 "그때
--                  이렇게 확정했다"는 기록은 남아야 한다.
-- approved_json  : 승인 시점의 최종값 스냅샷(JSON). 예약이 나중에 수정·삭제돼도
--                  그 시점의 확정값이 남아야 초안과 비교할 수 있다.
-- edited_fields  : 사람이 고친 필드 이름 목록(JSON 배열). 승인 시점에 계산해 굳혀 둔다 —
--                  나중에 세는 쪽이 스키마 변화에 안 흔들린다.
--
-- **기존 행은 전부 NULL이고, NULL은 "안 고쳤음"이 아니라 "모름"이다.**
-- 집계는 반드시 이 컬럼이 채워진 행만 분모로 삼아야 한다(docs/nl-learning-design.md §2).
--
-- 실제 반영은 server/db/schema.js initDB()의 try { ALTER TABLE ... } catch {} 블록이 한다.

ALTER TABLE schedule_drafts ADD COLUMN schedule_id INTEGER DEFAULT NULL;
ALTER TABLE schedule_drafts ADD COLUMN approved_json TEXT DEFAULT NULL;
ALTER TABLE schedule_drafts ADD COLUMN edited_fields TEXT DEFAULT NULL;
