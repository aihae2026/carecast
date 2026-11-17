-- 설정을 누가 언제 무엇에서 무엇으로 바꿨나 (2026-09-03, docs/db-retention-design.md 5번)
--
-- 왜 필요한가: settings 표에는 **현재값만** 있다. 아침방송 시각이 07:50에서 바뀌어 있어도
-- 언제 누가 왜 바꿨는지 알 길이 없었다. 볼륨·API 키·자동종료 시각도 같다.
-- 사고 추적의 출발점이 없는 셈인데, 부피는 이 시스템에서 가장 작다.
--
-- key        : 바뀐 설정 키
-- old_value  : 이전 값. **비밀키는 값을 남기지 않는다** — '(가려짐)'만 적는다.
-- new_value  : 새 값(같은 규칙)
-- changed_by : 주체. 지금 이 시스템에는 로그인이 없어 역할 수준이다('사람'·'자동').
-- changed_at : ISO 시각
--
-- 안 남기는 것: 기계가 스스로 남기는 흔적 키(*_last_fired·watchdog_alerted_*·retention_*·
-- datafix_* 등). 매일 쓰이므로 넣으면 이 표가 그것만으로 가득 차고, 정작 사람의 변경이 묻힌다.
-- 판단 규칙은 server/domain/settingsHistory.js 한 곳에 있다.
--
-- 보관 365일(운영 기록과 같다) — services/retention.js가 함께 정리한다.

CREATE TABLE IF NOT EXISTS settings_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by TEXT NOT NULL DEFAULT '사람',
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_history_at ON settings_history (changed_at);
