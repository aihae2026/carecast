-- 자율 점검 루프가 찾아낸 고도화 제안을 일자별로 저장/기억하기 위한 테이블
-- status: 승인 | 추천 | 차단 | 보류
CREATE TABLE IF NOT EXISTS improvement_proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT '추천',
  category    TEXT DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
