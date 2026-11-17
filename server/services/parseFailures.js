// 자연어 예약 파싱이 실패한 기록.
//
// 왜 필요한가: 목표는 "자연어 예약 성공률 90%"인데, 지금까지 실패는 아무 데도 남지 않았다.
// AI 경로는 422/500으로 응답만 하고 끝났고, 규칙 파서 경로는 초안 자체를 만들지 않는다.
// 남는 게 없으니 무엇이 얼마나 안 되는지 알 수 없고, 고칠 단서(실패한 원문)도 없다.
//
// schedule_drafts를 그대로 쓴다 — raw_input과 status가 이미 이 용도에 맞는 컬럼이다.
// 새 테이블을 만들면 "어느 쪽이 진짜 기록인가"가 갈린다.
const { getDB } = require('../db/schema')

// 실패 사유. 파싱 품질 문제와 시스템 문제를 반드시 구분한다 — 한 덩어리로 세면
// Gemini가 과부하(503)로 죽은 날의 숫자가 파서 품질이 나빠진 것처럼 보인다.
const FAILURE_REASONS = {
  NO_DATETIME:  'no_datetime',   // AI가 응답은 했지만 날짜/시간을 못 찾음 (품질)
  TIME_MISSING: 'time_missing',  // 규칙 파서가 시각을 못 읽어 기본값이 들어감 (품질)
  AI_ERROR:     'ai_error',      // Gemini 호출 자체가 실패 (시스템)
  PAST_DATE:    'past_date',     // 읽어낸 날짜가 이미 지남 — 승인하면 영원히 안 울린다 (품질)
}

// 성공률 계산에 포함되는 사유 — 파서가 더 잘하면 줄어드는 것들만 넣는다.
const QUALITY_REASONS = [FAILURE_REASONS.NO_DATETIME, FAILURE_REASONS.TIME_MISSING, FAILURE_REASONS.PAST_DATE]

const SOURCES = { AI: 'ai', RULE: 'rule' }

/**
 * 실패한 문장을 남긴다. 기록이 실패해도 사용자 요청은 계속돼야 하므로 절대 throw 하지 않는다
 * — 로그를 남기려다 방송 예약 화면이 죽으면 본말이 전도된다.
 * @returns {number|null} 만들어진 행 id, 실패하면 null
 */
function recordParseFailure({ raw_input, reason, source }, db = getDB()) {
  try {
    const result = db.prepare(`
      INSERT INTO schedule_drafts
        (raw_input, title, content, scheduled_time, repeat_start_date,
         status, source, failure_reason, created_at)
      VALUES (?, '', '', '', '', 'failed', ?, ?, ?)
    `).run(raw_input || '', source, reason, new Date().toISOString())
    return result.lastInsertRowid
  } catch (e) {
    console.error('[parseFailures] 실패 기록 실패:', e.message)
    return null
  }
}

/**
 * 성공률 = 파싱된 것 / (파싱된 것 + 품질 실패). 시스템 실패(ai_error)는 분모에서 뺀다 —
 * API가 죽은 걸 파서 탓으로 세면 개선 여부를 판단할 수 없다. 대신 따로 보여준다.
 */
function readParseStats(db = getDB()) {
  const rows = db.prepare(`
    SELECT status, source, failure_reason, COUNT(*) AS n
    FROM schedule_drafts GROUP BY status, source, failure_reason
  `).all()

  const byReason = {}
  const bySource = {}
  let parsed = 0
  let qualityFailed = 0
  let systemFailed = 0

  for (const r of rows) {
    const source = r.source || SOURCES.AI
    bySource[source] = bySource[source] || { parsed: 0, failed: 0 }
    if (r.status === 'failed') {
      byReason[r.failure_reason] = (byReason[r.failure_reason] || 0) + r.n
      bySource[source].failed += r.n
      if (QUALITY_REASONS.includes(r.failure_reason)) qualityFailed += r.n
      else systemFailed += r.n
    } else {
      parsed += r.n
      bySource[source].parsed += r.n
    }
  }

  // 실패한 원문을 몇 개 같이 준다 — 숫자만 보면 "낮네"로 끝나고, 문장을 봐야 고칠 거리가 된다.
  const recent = db.prepare(`
    SELECT id, raw_input, failure_reason, source, created_at
    FROM schedule_drafts WHERE status = 'failed' ORDER BY id DESC LIMIT 5
  `).all()

  const denominator = parsed + qualityFailed
  return {
    recent,
    parsed,
    qualityFailed,
    systemFailed,
    total: parsed + qualityFailed + systemFailed,
    // 시도가 없으면 성공률은 숫자가 아니라 null이다 — 0%로 보이면 "다 실패했다"로 읽힌다
    successRate: denominator === 0 ? null : Math.round((parsed / denominator) * 1000) / 10,
    byReason,
    bySource,
  }
}

module.exports = { FAILURE_REASONS, QUALITY_REASONS, SOURCES, recordParseFailure, readParseStats }
