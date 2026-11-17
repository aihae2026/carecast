// 자연어 예약 누적 학습 — 3단계 "제안만 한다" (docs/nl-learning-design.md §2-3단계)
//
// 2단계 통계(nlStats)에서 임계를 넘은 낱말이 나오면 **고도화 제안 행(status 추천)을
// 만드는 것까지만** 한다. 사전(ontology)·기본값은 절대 자동으로 바뀌지 않는다 —
// 사람이 제안을 승인한 뒤 코드(ontology.js)에 손으로 반영한다(설계 §3의 경계,
// CLAUDE.md 검토 게이트). 요양원 방송에서 가장 찾기 어려운 실패가 조용한 오작동이다.
//
// 부르는 곳은 approveDraft 하나다 — 표본이 늘어나는 유일한 순간이라 매분 돌 이유가 없다.
// 실패해도 승인을 막지 않는다(호출부가 try/catch로 감싼다).
//
// 임계값은 설정 키다 — 설계 §4-3 "현장 표본을 보고 정한다"가 아직 열려 있어서,
// 코드에 못 박는 대신 보수적 기본값으로 두고 현장에서 조정한다:
//   nl_suggest_min_count    낱말 빈도 최소치(기본 8)
//   nl_suggest_min_edit_pct 그 낱말이 든 문장에서 유형까지 고친 비율 %(기본 60)
// 표본 최소치는 2단계와 같은 키(nl_stats_min_samples)·같은 창(nl_stats_window)을 쓴다 —
// 화면이 "아직 안 쌓였습니다"라고 말하는데 제안이 생기면 서로 거짓말이 된다.
//
// **같은 낱말은 한 번만 제안한다** — 상태(추천·보류·완료)와 무관하게, 제목이 같은 행이
// 있으면 안 만든다. 이것이 2단계 문서의 주의("창 밖으로 나간 표본은 집계에서 사라진다 —
// 기억하려면 3단계가 제안 행으로 굳혀야 한다")를 닫고, 사람이 보류한 결정을 통계가
// 되살리는 일도 막는다.
'use strict'

// 표본 고르기·창·최소 표본은 **2단계와 같은 함수**를 쓴다(loadNlStats) — 화면이
// "아직 안 쌓였습니다"라고 말하는데 제안이 생기면 서로 거짓말이 된다.
const { loadNlStats, settingInt } = require('./nlStats')

const DEFAULT_MIN_COUNT = 8
const DEFAULT_MIN_EDIT_PCT = 60

function proposalTitle(word) {
  return `[자연어 학습] '${word}' 동의어 검토`
}

/**
 * 임계를 넘은 낱말들을 고도화 제안으로 굳힌다. 반환 { created: [낱말...] }.
 * opts는 테스트용 덮어쓰기 — 운영에서는 설정 키를 읽는다.
 */
function maybeSuggest(db, opts = {}) {
  const minCount   = opts.minCount   ?? settingInt(db, 'nl_suggest_min_count', DEFAULT_MIN_COUNT)
  const minEditPct = opts.minEditPct ?? settingInt(db, 'nl_suggest_min_edit_pct', DEFAULT_MIN_EDIT_PCT)

  const stats = loadNlStats(db, { minSamples: opts.minSamples, window: opts.window, topN: 50 })
  if (!stats.enough || !stats.unknownWords) return { created: [] }

  const created = []
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  for (const w of stats.unknownWords) {
    // **한 번에 하나만**(2026-09-03 레드 검증 발견5). 같은 문장에 든 낱말들은 count·
    // withTypeEdit가 정확히 같아서 임계를 함께 넘는다 — "어르신 생신잔치 반짝조명"이면
    // 세 개가 한꺼번에 제안이 되어 목록이 무의미한 후보로 덮인다. 제목 중복 제거가
    // **영구**라 잘못 생긴 행은 지워도 판단 근거가 안 남는다. 목록은 유형 수정 순으로
    // 정렬돼 있으니 맨 앞이 가장 값어치 있는 후보고, 나머지는 다음 승인 때 다시 걸린다.
    if (created.length >= 1) break
    if (w.count < minCount) continue
    if (w.withTypeEdit * 100 < w.count * minEditPct) continue
    const title = proposalTitle(w.word)
    // 상태 불문 — 한 번 제안한 낱말은 다시 안 꺼낸다(사람 결정 존중 + 기억 굳히기)
    if (db.prepare('SELECT 1 FROM improvement_proposals WHERE title = ?').get(title)) continue
    db.prepare(`
      INSERT INTO improvement_proposals (date, title, description, status, category, created_at, updated_at)
      VALUES (?, ?, ?, '추천', '자연어 학습', ?, ?)
    `).run(today, title,
      `최근 승인 ${stats.samples}건에서 '${w.word}'가 ${w.count}번 나왔고, `
      + `그중 ${w.withTypeEdit}번은 사람이 방송 유형까지 고쳤습니다. `
      + `사전(server/domain/ontology.js)의 동의어에 넣을지 검토하세요 — `
      + `승인해도 자동 반영은 없으며, 코드에 손으로 넣어야 파서 둘(규칙·AI)이 함께 배웁니다.`,
      now, now)
    created.push(w.word)
    console.log(`[자연어 학습] 동의어 후보 제안 생성: '${w.word}' (${w.withTypeEdit}/${w.count})`)
  }
  return { created }
}

module.exports = { maybeSuggest, DEFAULT_MIN_COUNT, DEFAULT_MIN_EDIT_PCT }
