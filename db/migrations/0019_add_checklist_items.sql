-- 주차별 체크리스트 문항을 DB로 (2026-09-03, 고도화 제안 #23)
--
-- 왜 필요한가: 문항 텍스트가 **코드 상수**였다(ImprovementProposals.jsx의 CHECKLIST_SETS).
-- DB에는 값(체크 여부·점수·메모)만 있고 문항은 코드에 있어서, 3주차 문항이 오면 개발자가
-- 코드를 고쳐야 했다. 새 주차를 만들면 직전 주차 문항이 그대로 보이는 것도 그 때문이다.
--
-- item_key    : 값(checklist_entries.item_key)과 잇는 열쇠. **한 번 정하면 절대 안 바꾼다.**
--               순서를 바꾸거나 중간 문항을 지울 때 열쇠를 다시 매기면 지난 주차의 체크·메모가
--               엉뚱한 문항 밑으로 옮겨간다. 순서는 sort_order로만 바꾼다.
-- label       : 문항 텍스트.
-- sort_order  : 화면에 보이는 순서.
--
-- 기존 주차의 문항은 서버가 1회 시딩한다(server/db/schema.js) — 안 하면 지금 화면에 보이는
-- 1·2주차 문항이 통째로 사라진다. 이미 행이 있으면 건드리지 않는다(볼륨 시딩과 같은 규칙).
--
-- 7문항 상한(코드의 CHECKLIST_KEYS '0'~'6')도 이 표가 생기면서 사라진다 —
-- 검사는 "그 주차에 실제로 있는 문항인가"로 바뀐다.

CREATE TABLE IF NOT EXISTS checklist_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id    INTEGER NOT NULL REFERENCES checklist_weeks(id),
  item_key   TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_items_week_key
  ON checklist_items (week_id, item_key);
