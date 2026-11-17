-- 방송이 어느 단계까지 갔나 (2026-09-03, docs/db-retention-design.md 6번)
--
-- 왜 필요한가: 이력은 방송 1건에 성공/실패 **한 줄**이다. 5분짜리 아침방송이
-- "차임 → 인사 → 날씨 → 안내 음원 → BGM" 중 **어느 단계에서 멎었는지**는 어디에도 안 남는다.
-- 실패한 단계는 경보로 알리지만(alert.raise), 정상적으로 스킵된 단계나 각 단계가 얼마나
-- 걸렸는지는 서버 콘솔 로그에만 있고 그 로그는 30일 뒤 사라진다.
--
-- run_key    : 방송 한 편을 잇는 열쇠. 로그 이름표와 **같은 값**이다(runContext.currentRunId,
--              예: '아침-12'). 이력 행과 이어 붙이는 대신 이것을 쓰는 이유는, 이력 행이
--              시퀀스가 **끝날 때** 만들어져서 단계가 도는 동안에는 아직 id가 없기 때문이다.
-- step_no    : 그 방송 안에서 몇 번째 단계인가(1부터)
-- label      : 단계 이름(화면에 보이는 것과 같다)
-- result     : '성공' · '실패' — 스킵은 단계 처리기가 알아서 넘기므로 여기 안 온다
-- ms         : 그 단계에 걸린 밀리초. **prep_ms(0018)가 예약에만 있던 것을 여기서 메운다** —
--              자동방송은 단계마다 시각이 남으므로 "어디서 시간이 갔나"를 볼 수 있다.
-- detail     : 실패 사유 등 한 줄
--
-- 부피: 방송 1건당 3~10행, 하루 최대 60행, 연 2만 행. 보관은 운영 기록과 같은 365일이다.

CREATE TABLE IF NOT EXISTS broadcast_steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key    TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  step_no    INTEGER NOT NULL,
  label      TEXT    NOT NULL,
  result     TEXT    NOT NULL,
  ms         INTEGER,
  detail     TEXT,
  started_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_steps_run ON broadcast_steps (run_key);
CREATE INDEX IF NOT EXISTS idx_broadcast_steps_at  ON broadcast_steps (started_at);
