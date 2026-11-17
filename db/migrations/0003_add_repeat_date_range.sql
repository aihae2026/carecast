-- 예약 반복설정을 repeat_type(enum 문자열) 대신 캘린더 앱 스타일(반복시작일/반복종료일/반복요일)로 표현.
-- repeat_type 컬럼은 삭제하지 않고 유지(레거시 표시용) — 새 로직은 아래 3개 컬럼만 사용한다.
-- 기존 행 백필(월간 제외 전부 요일 세트로 변환)은 server/db/schema.js의 initDB()에서 처리한다.
ALTER TABLE schedules ADD COLUMN repeat_start_date TEXT;
ALTER TABLE schedules ADD COLUMN repeat_end_date TEXT;
ALTER TABLE schedules ADD COLUMN repeat_weekdays TEXT;
