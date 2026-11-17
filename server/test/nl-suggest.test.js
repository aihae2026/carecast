// 자연어 학습 3단계 — "제안만 한다" (docs/nl-learning-design.md §2-3단계)
//
// 2단계 통계에서 임계를 넘은 낱말이 나오면 **고도화 제안 행(status 추천)만** 만든다.
// 사전(ontology)·기본값은 절대 자동으로 바뀌지 않는다 — 사람이 제안을 승인한 뒤
// 코드에 손으로 반영한다(설계 §3, CLAUDE.md 검토 게이트).
//
// 임계값은 설정 키다(설계 §4-3 "현장 표본을 보고 정한다" — 코드에 못 박는 대신
// 보수적 기본값으로 열어 두고 현장에서 조정한다):
//   nl_suggest_min_count(기본 8) · nl_suggest_min_edit_pct(기본 60)
//
// 고정하는 사실:
//  1. 임계를 넘은 낱말 → 제안 행이 생긴다(추천 · 자연어 학습 분류 · 낱말과 근거 숫자 포함)
//  2. 같은 낱말은 두 번 제안하지 않는다 — 제안 행이 "한 번 본 것"을 굳힌다
//     (통계 창(window) 밖으로 표본이 밀려나도 제안은 남는다 — 2단계 문서의 주의를 닫는다)
//  3. 표본이 최소치 미만이면 아무것도 안 만든다
//  4. 임계 미달(수정률 낮음)이면 안 만든다 — 자주 나오기만 하는 방송 주제 낱말
//  5. 승인 경로(approveDraft)가 이 검사를 부른다 — 표본이 늘어나는 유일한 순간이다
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_nlsuggest_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { maybeSuggest } = require('../domain/nlSuggest')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// 승인된 초안 표본 한 줄. word가 든 문장이고, typeEdited면 사람이 유형을 고친 것으로 남긴다.
function seedDraft(db, word, typeEdited) {
  db.prepare(`
    INSERT INTO schedule_drafts (raw_input, title, scheduled_time, repeat_start_date, broadcast_type, status, edited_fields, approved_json, created_at)
    VALUES (?, ?, '14:00', '2026-09-04', 'text', 'approved', ?, ?, '2026-09-03T20:00:00Z')
  `).run(
    `내일 ${word} 방송 부탁`, '표본',
    typeEdited ? '["broadcast_type"]' : '[]',
    typeEdited ? '{"broadcast_type":"youtube-tv"}' : '{}',
  )
}

function proposalsWith(db, word) {
  return db.prepare('SELECT * FROM improvement_proposals WHERE title LIKE ?').all(`%${word}%`)
}

test('임계를 넘은 낱말은 고도화 제안 행이 된다 — 추천 상태, 근거 숫자 포함', () => {
  const db = getDB()
  for (let i = 0; i < 20; i++) seedDraft(db, '반짝조명', i < 16)  // 20건 중 16건 유형 수정(80%)

  const r = maybeSuggest(db, { minSamples: 10, minCount: 8, minEditPct: 60 })
  assert.equal(r.created.length, 1, `제안이 안 만들어졌다 (${JSON.stringify(r)})`)

  const rows = proposalsWith(db, '반짝조명')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, '추천', '자동 생성 제안이 추천이 아니다 — 사람 승인 전에 큐로 가면 안 된다')
  assert.match(rows[0].description, /20|16/, '근거 숫자(빈도·수정 횟수)가 설명에 없다 — 사람이 판단할 재료가 없다')
  assert.match(rows[0].description, /ontology/, '반영 위치(ontology.js 손 반영)가 설명에 없다')
})

test('같은 낱말은 두 번 제안하지 않는다 — 제안 행이 기억을 굳힌다', () => {
  const db = getDB()
  const r = maybeSuggest(db, { minSamples: 10, minCount: 8, minEditPct: 60 })
  assert.equal(r.created.length, 0, '같은 낱말이 다시 제안됐다 — 승인할 때마다 제안이 불어난다')
  assert.equal(proposalsWith(db, '반짝조명').length, 1)
})

test('제안을 거절(보류)해도 다시 만들지 않는다 — 상태와 무관하게 한 번뿐', () => {
  const db = getDB()
  db.prepare("UPDATE improvement_proposals SET status = '보류' WHERE title LIKE '%반짝조명%'").run()
  const r = maybeSuggest(db, { minSamples: 10, minCount: 8, minEditPct: 60 })
  assert.equal(r.created.length, 0, '보류한 제안이 되살아난다 — 사람 결정을 통계가 뒤집는다')
})

test('수정률이 임계 미달이면 안 만든다 — 자주 나오기만 하는 방송 주제 낱말', () => {
  const db = getDB()
  db.prepare("DELETE FROM schedule_drafts").run()
  for (let i = 0; i < 20; i++) seedDraft(db, '경로잔치', i < 2)   // 20건 중 2건만 유형 수정(10%)
  const r = maybeSuggest(db, { minSamples: 10, minCount: 8, minEditPct: 60 })
  assert.equal(r.created.length, 0)
  assert.equal(proposalsWith(db, '경로잔치').length, 0,
    '방송 주제 낱말까지 제안됐다 — 임계값이 안 걸리고 있다')
})

test('표본이 최소치 미만이면 아무것도 안 한다', () => {
  const db = getDB()
  db.prepare("DELETE FROM schedule_drafts").run()
  for (let i = 0; i < 5; i++) seedDraft(db, '새벽체조', true)
  const r = maybeSuggest(db, { minSamples: 10, minCount: 3, minEditPct: 50 })
  assert.equal(r.created.length, 0, '표본 다섯 건으로 규칙을 만들었다 — 그게 곧 오작동이다')
})

test('승인 경로가 이 검사를 부른다 — 표본이 늘어나는 유일한 순간', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scheduleDrafts.js'), 'utf8')
  assert.match(src, /nlSuggest|maybeSuggest/,
    'approveDraft가 3단계 검사를 안 부른다 — 통계가 임계를 넘어도 아무도 모른다')
})
