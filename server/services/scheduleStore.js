// 예약 방송 저장 — routes/schedules.js(POST 라우트)와 routes/scheduleDrafts.js(AI 예약 승인)가
// 공유하는 순수 INSERT와 그 주변 정규화 규칙.
//
// 왜 별도 파일인가: 두 창구가 컬럼 목록을 따로 들면 드리프트가 난다(CLAUDE.md 4번 규칙).
// 예전엔 schedules.js의 것을 scheduleDrafts.js가 require해서 단일화했는데, 그러면 창구가
// 창구를 부르게 된다(로드 부작용의 실행 시점이 로드 순서에 얽힌다) — 공유물을 services/로
// 내려 양쪽이 같은 곳을 보게 한다(route-wiring.test.js가 이 규칙을 고정).
//
// 검증(invalidScheduleFields·민감정보 필터)은 Express req/res에 결합돼 있어 라우트 쪽에만
// 남겨둔다 — scheduleDrafts.js 쪽은 사람이 초안 카드에서 내용을 직접 보고 "예약 확정"을
// 눌러야 호출되므로 별도 심사 없이도 허용한다.
'use strict'

const { getDB } = require('../db/schema')
const { deriveLegacyRepeatType } = require('./repeatSchedule')

// managed_by — 이 예약을 누가 만들었는지. 화면도 값을 실어 보내므로(자동방송 순서 편집기가
// 'morning_editor'를 보낸다) 아는 이름만 받는다. 오타('AI', 'ai ')가 그대로 저장되면
// WHERE managed_by = 'ai'로 다시 못 찾아서 "아까 등록한 거 취소"가 조용히 아무것도 못 지운다.
const MANAGED_BY_AI = 'ai'
const MANAGED_BY_VALUES = [MANAGED_BY_AI, 'morning_editor']

// 구버전 DB 호환 — schema.js initDB가 실행되기 전에 이 모듈이 먼저 로드될 경우 대비
try { getDB().exec('ALTER TABLE schedules ADD COLUMN repeat_broadcast INTEGER DEFAULT 0') } catch { /* 이미 있음 */ }

// 예약별 재생 배속 — 0.5~1.5배만 쓴다. 더 느리면 말이 뭉개지고, 더 빠르면 어르신이 못 알아들으신다.
const RATE_MIN = 0.5
const RATE_MAX = 1.5

// 숫자 또는 숫자 문자열만 볼륨으로 인정한다.
// 타입 검사 없이 Number()만 쓰면 []가 0(무음)으로 통과한다 — 방송이 조용히 안 들린다.
function isVolumeLike(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false
  if (typeof value === 'string' && value.trim() === '') return false
  return Number.isFinite(Number(value))
}

// 예약별 BGM 볼륨 — 비어 있으면 NULL(= 시스템 기본값을 그대로 쓴다)로 저장한다.
// 0은 "무음"이라는 유효한 값이므로 falsy 검사(|| null)로 지우면 안 된다.
function normalizeBgmVolume(value) {
  if (!isVolumeLike(value)) return null
  return Math.max(0, Math.min(100, Math.round(Number(value))))
}

// 예약별 재생 배속 — 비어 있으면 NULL(= 1.0배, 원래 속도)로 저장한다.
function normalizePlaybackRate(value) {
  if (!isVolumeLike(value)) return null   // 숫자·숫자문자열만 (isVolumeLike의 []·빈문자 방어를 그대로 쓴다)
  const n = Number(value)
  if (n <= 0) return null                 // 0배는 '정지'라서 값으로 인정하지 않는다
  return Math.max(RATE_MIN, Math.min(RATE_MAX, n))
}

// 순수 INSERT — 컬럼 목록의 단일 출처.
function insertSchedule({
  title, content = '', target = '전체', scheduled_time, active = 1, broadcast_type = 'text',
  // `bgm_end_delay` 기본 5 — TTS 가 끝난 뒤 BGM 이 5초 더 흐르다 부드럽게 꺼진다(UX-17).
  // **DB 의 DEFAULT 는 0 이다.** 기존 예약의 소리 길이를 그 자리에서 바꾸지 않으려고 그렇게 뒀고,
  // 새로 만드는 예약만 여기서 5를 받는다. 두 숫자가 다른 것은 의도다.
  bgm_enabled = 0, bgm_type = 'local_broadcast', bgm_value = '', bgm_title = '', bgm_delay = 5, bgm_end_delay = 5,
  repeat_broadcast = 0, group_id = null, audio_file_id = null, flow_sequence_id = null,
  repeat_start_date, repeat_end_date = null, repeat_weekdays = [], managed_by = null,
  bgm_volume = null, main_volume = null, playback_rate = null,
}) {
  const repeat_type = deriveLegacyRepeatType(repeat_weekdays)
  const result = getDB()
    .prepare(`
      INSERT INTO schedules
        (title, content, target, scheduled_time, repeat_type, active, broadcast_type,
         bgm_enabled, bgm_type, bgm_value, bgm_title, bgm_delay, bgm_end_delay, repeat_broadcast, group_id, audio_file_id, flow_sequence_id,
         repeat_start_date, repeat_end_date, repeat_weekdays, managed_by, bgm_volume, main_volume, playback_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      title.trim(), content?.trim() || '', target, scheduled_time, repeat_type, active ? 1 : 0, broadcast_type,
      bgm_enabled ? 1 : 0, bgm_type, bgm_value, bgm_title, Number(bgm_delay), Number(bgm_end_delay) || 0, repeat_broadcast ? 1 : 0,
      group_id || null, audio_file_id || null, flow_sequence_id || null,
      repeat_start_date, repeat_end_date || null, JSON.stringify(repeat_weekdays), managed_by || null,
      normalizeBgmVolume(bgm_volume), normalizeBgmVolume(main_volume), normalizePlaybackRate(playback_rate),
    )
  return result.lastInsertRowid
}

module.exports = {
  insertSchedule,
  MANAGED_BY_AI, MANAGED_BY_VALUES,
  isVolumeLike, normalizeBgmVolume, normalizePlaybackRate,
  RATE_MIN, RATE_MAX,
}
