-- 서버 가동 구간 기록 — 예약 방송 누락 감시의 선행 조건 (ISSUE-006, 2026-09-07)
--
-- 왜 필요한가: 누락 감시가 "예정 시각이 지났는데 안 나갔다"를 판정하려면 **그 시각에 서버가
-- 떠 있었는가**를 알아야 한다. 지금은 알 방법이 없다 — /api/health 의 uptime 은 process.uptime()
-- 이라 프로세스가 죽으면 사라지고([FACT] EV-001000, routes/health.js:43), settings 에도 기록이 없다.
--
-- 없으면 어떻게 되나(실측): 이 개발 PC 의 환기방송 09:10·09:20(schedules id 15·16)은 이력이
-- **한 건도 없다**([FACT] EV-001004). last_fired 경로가 고장난 게 아니라 그 시각에 서버가 없었다 —
-- 09시대 이력은 기동 직후의 경보뿐이고 시각이 09:12·09:28·09:30·09:33 이다([FACT] EV-001005).
-- 이 표가 없으면 개발 PC 는 **매일 오경보 2건**을 낸다. 감시가 잔소리가 되면 사람이 안 본다.
--
-- 이 마이그레이션은 **표를 더하기만 한다.** 기존 표·행을 건드리지 않는다. 백필도 없다 —
-- 과거 구간은 복원할 방법이 없고(로그로 추정만 가능), 기록이 없는 날은 감시가 "모름"으로 넘긴다.

CREATE TABLE IF NOT EXISTS server_boot (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,   -- 기동 시각(ISO8601 로컬). 프로세스마다 한 행
  last_seen_at TEXT NOT NULL,   -- 스케줄러 tick 이 매분 갱신. "여기까지는 확실히 살아 있었다"
  stopped_at   TEXT,            -- 정상 종료 시각. **비정상 종료면 NULL 그대로**(사용자 결정)
  git_branch   TEXT,            -- 그 프로세스가 돌던 브랜치(현장/개발 구분에 쓴다)
  pid          INTEGER
);

-- 감시는 "오늘 구간"만 훑는다. 날짜 앞부분으로 자르므로 started_at 정렬 인덱스면 충분하다.
CREATE INDEX IF NOT EXISTS idx_server_boot_started ON server_boot (started_at);

-- last_seen_at 이 왜 따로 있나(stopped_at 만으로는 안 되는 이유):
--   비정상 종료(PC 전원 끔·크래시·자동업데이트 재시작)에서는 stopped_at 이 NULL 이다.
--   그 구간의 끝을 "다음 기동 시각"으로 잡으면 **밤새 꺼져 있던 시간이 통째로 가동 구간이 된다** —
--   전날 22시에 PC 를 끄고 오늘 09:34 에 켜면 09:10 예약이 "서버가 떠 있었다"로 잡혀 오경보가 난다.
--   매분 갱신하는 last_seen_at 이 있으면 그 구간은 22시쯤에서 끊긴다(오차 최대 1분).
