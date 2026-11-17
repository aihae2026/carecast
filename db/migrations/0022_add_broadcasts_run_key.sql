-- 이력 한 줄과 그 방송의 단계 기록을 잇는 열쇠 (2026-09-03, docs/db-retention-design.md 6번)
--
-- 0021이 단계 기록(broadcast_steps)을 run_key('아침-12')로 남기기 시작했다. 그런데 이력
-- (broadcasts)에는 그 열쇠가 없어서, **화면이 이력 한 줄을 펼쳐 그 방송의 단계를 보여줄 수가
-- 없다.** 제목·시각으로 맞추는 방법은 같은 제목이 하루에 두 번 나가면 곧바로 어긋난다.
--
-- run_key : 로그 이름표와 같은 값. 방송 구간 밖에서 남는 이력(수동 기록·경보)은 NULL이다 —
--           NULL은 "이을 단계가 없다"는 뜻이고, 화면은 그 줄에 펼치기를 안 보여준다.

ALTER TABLE broadcasts ADD COLUMN run_key TEXT DEFAULT NULL;
