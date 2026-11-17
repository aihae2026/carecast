// 설정 변경 기록 — 무엇을 남기고 무엇을 안 남기나 (docs/db-retention-design.md 5번, 2026-09-03).
//
// settings 표에는 **현재값만** 있었다. 아침방송 시각이 바뀌어 있어도 언제 누가 바꿨는지
// 알 길이 없었고, 볼륨·API 키도 같았다. 사고가 나면 추적의 출발점이 아예 없다.
//
// 이 파일이 정하는 것은 셋이다.
//  1) **안 남기는 키** — 기계가 스스로 매일 쓰는 흔적(*_last_fired·watchdog_alerted_*·
//     retention_*·datafix_* 등). 넣으면 이 표가 그것만으로 가득 차고 사람의 변경이 묻힌다.
//  2) **비밀은 값을 안 남긴다** — API 키·토큰·시크릿은 "바뀌었다"만 적는다. 이 표는 백업에
//     따라 들어가고 나중에 화면에도 뜬다.
//  3) **잦은 변경은 1분 묶음** — 볼륨 슬라이더 한 번에 수십 행이 생기면 아무도 안 본다.
'use strict'

// 기계가 남기는 흔적. 사람이 바꾸는 설정이 아니다.
const NOT_TRACKED_EXACT = new Set([
  'auto_update_last',            // 자동 업데이트가 매번 갱신
  'loop_last_run',
  'brief_rewrite_requested_at',
])
// 2026-09-08(P-21): `last_played_*` 는 "이 분류에서 마지막에 튼 음원"이라 **재생할 때마다**
// 기계가 갱신한다. 사람이 바꾸는 설정이 아니다. 이 줄이 없으면 음원을 틀 때마다 기록이 쌓여
// 사람의 변경이 그 속에 묻힌다 — 사실4 가 막으려던 바로 그 일이다.
// 2026-09-21: `local_bgm_seq_*` 도 같다 — 배경음악을 「차례로」 틀 때마다 다음 시작 곡 자리를
// 기계가 적는다(domain/bgmRoles.js 차례키).
const NOT_TRACKED_PREFIX = ['retention_', 'datafix_', 'watchdog_alerted_', 'last_played_', 'local_bgm_seq_', 'media_seq_']
// 2026-09-26: `schedule_<id>_last_broadcast` 도 같다 — 예약이 나갈 때마다 결과 연결 번호를 기계가
// 적는다(domain/scheduleOutcome.js). 예약마다 키가 달라 1분 묶음에도 안 걸려 매일 쌓였다.
const NOT_TRACKED_SUFFIX = ['_last_fired', '_last_started', '_last_broadcast']

// 값이 남으면 안 되는 키. 이름 생김새로 판정한다 — 새 키가 늘어도 규칙이 따라간다.
const SECRET_RE = /(api_key|_key$|secret|token|password|passwd|credential)/i
const MASK = '(가려짐)'

/** 이 키의 변경을 기록하나. */
function isTracked(key) {
  const k = String(key || '')
  if (!k) return false
  if (NOT_TRACKED_EXACT.has(k)) return false
  if (NOT_TRACKED_PREFIX.some(p => k.startsWith(p))) return false
  if (NOT_TRACKED_SUFFIX.some(sfx => k.endsWith(sfx))) return false
  return true
}

/** 값을 그대로 남겨도 되나. 아니면 가린 문자열을 준다. */
function maskValue(key, value) {
  if (SECRET_RE.test(String(key || ''))) return value == null || value === '' ? null : MASK
  const v = value == null ? null : String(value)
  // 방송 문구·단계 JSON은 길다. 이 표는 "무엇이 바뀌었나"를 보는 곳이지 원문 보관소가 아니다.
  return v != null && v.length > 200 ? `${v.slice(0, 200)}…(${v.length}자)` : v
}

const GROUP_MS = 60_000   // 1분 안의 같은 키·같은 주체 변경은 한 줄로 접는다

/**
 * 변경 하나를 남긴다. **어떤 경우에도 던지지 않는다** — 기록하려다 설정 저장이 실패하면
 * 본말전도다(경보 서비스와 같은 규칙).
 * @returns {'skip'|'insert'|'merge'} 무엇을 했는지(테스트·진단용)
 */
function record(db, key, oldValue, newValue, by = '사람', now = new Date()) {
  try {
    if (!isTracked(key)) return 'skip'
    const before = oldValue == null ? null : String(oldValue)
    const after  = newValue == null ? null : String(newValue)
    if (before === after) return 'skip'          // 같은 값 저장은 변경이 아니다

    const at = now.toISOString()
    const last = db.prepare(
      'SELECT id, changed_at, old_value FROM settings_history WHERE key = ? AND changed_by = ? ORDER BY id DESC LIMIT 1'
    ).get(key, by)

    // 1분 안이면 **처음 값은 그대로 두고 마지막 값만 갱신**한다 —
    // 슬라이더를 30번 움직여도 "이 값에서 저 값으로"가 한 줄로 남는다.
    if (last && now.getTime() - Date.parse(last.changed_at) < GROUP_MS) {
      db.prepare('UPDATE settings_history SET new_value = ?, changed_at = ? WHERE id = ?')
        .run(maskValue(key, after), at, last.id)
      return 'merge'
    }

    db.prepare(
      'INSERT INTO settings_history (key, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run(key, maskValue(key, before), maskValue(key, after), by, at)
    return 'insert'
  } catch (e) {
    console.error('[설정기록] 남기기 실패(설정 저장은 계속):', e.message)
    return 'skip'
  }
}

/** 최근 변경 목록. 화면·진단이 읽는다. */
function recent(db, limit = 100) {
  return db.prepare('SELECT * FROM settings_history ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 100, 1000))
}

module.exports = { record, recent, isTracked, maskValue, MASK, GROUP_MS }
