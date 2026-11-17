-- schedules.managed_by — 이 예약이 어떤 화면에서 만들어졌는지 표시하는 느슨한 마커.
-- 자동방송순서편집기(MorningEditor.jsx) 좌측 사이드바에서 만든 "커스텀 자동순서"는
-- broadcast_type='flow'인 일반 예약(주간방송일정및예약에서 만든 것)과 같은 schedules
-- 테이블을 쓰지만, 사이드바 목록에는 이 값이 'morning_editor'인 것만 보여줘야 섞이지 않는다.
-- NULL이면 일반 예약(기존 전부).
ALTER TABLE schedules ADD COLUMN managed_by TEXT DEFAULT NULL;
