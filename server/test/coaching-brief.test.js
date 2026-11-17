// Phase 5 코칭 브리프: 체크리스트 새 주차 생성 시 과거 주차가 보존되는지, 점수/체크 upsert가
// 중복 행을 만들지 않는지, 유사사례·참고문헌·코치질문 CRUD가 정상 동작하는지 검증.
// 운영 DB(server/db/database.db)를 절대 건드리지 않도록 CARECAST_DB_PATH로 임시 DB를 쓴다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_brief_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startNewWeek, upsertChecklistEntry } = require('../routes/coachingBrief')

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('initDB는 첫 주차(1주차)를 자동 시딩한다', () => {
  const db = getDB()
  const current = db.prepare('SELECT * FROM checklist_weeks WHERE is_current = 1').get()
  assert.ok(current, '현재 주차가 있어야 한다')
  assert.equal(current.week_label, '1주차')
})

test('initDB는 similar_cases 3건, brief_references 6건을 시딩한다', () => {
  const db = getDB()
  assert.equal(db.prepare('SELECT COUNT(*) c FROM similar_cases').get().c, 3)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM brief_references').get().c, 6)
})

test('startNewWeek: 이전 주차는 is_current=0으로 바뀌고 과거 기록에 남는다', () => {
  const db = getDB()
  const before = db.prepare('SELECT * FROM checklist_weeks WHERE is_current = 1').get()
  const newId = startNewWeek('2주차')

  const oldRow = db.prepare('SELECT * FROM checklist_weeks WHERE id = ?').get(before.id)
  assert.equal(oldRow.is_current, 0, '이전 주차는 더 이상 current가 아니어야 한다')

  const newRow = db.prepare('SELECT * FROM checklist_weeks WHERE id = ?').get(newId)
  assert.equal(newRow.is_current, 1)
  assert.equal(newRow.week_label, '2주차')

  const currentCount = db.prepare('SELECT COUNT(*) c FROM checklist_weeks WHERE is_current = 1').get().c
  assert.equal(currentCount, 1, 'current 주차는 항상 하나여야 한다')
})

test('upsertChecklistEntry: 같은 week_id/kind/item_key로 반복 저장해도 행이 하나로 유지된다', () => {
  const weekId = startNewWeek('테스트주차')
  // 2026-09-03(0019)부터 값은 **그 주차에 실제로 있는 문항**에만 붙는다 — 문항이 DB로 옮겨왔다.
  // 예전엔 '0'~'6'이면 무조건 받았고, 그래서 여덟 번째 문항을 만들 수가 없었다.
  const itemKey = require('../domain/checklistItems').addItem(getDB(), weekId, '테스트 문항')
  upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: itemKey, value: 1 })
  upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: itemKey, value: 0 })
  upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: itemKey, value: 1 })

  const db = getDB()
  const rows = db.prepare('SELECT * FROM checklist_entries WHERE week_id = ? AND kind = ? AND item_key = ?')
    .all(weekId, 'checklist', itemKey)
  assert.equal(rows.length, 1, '중복 행이 생기면 안 된다')
  assert.equal(rows[0].value, 1, '가장 마지막 값으로 덮어써야 한다')
})

test('upsertChecklistEntry: score 항목은 근거 메모(note)도 함께 저장된다', () => {
  const weekId = startNewWeek('점수테스트주차')
  upsertChecklistEntry({ week_id: weekId, kind: 'score', item_key: 'importance', value: 4.5, note: '근거 설명' })

  const db = getDB()
  const row = db.prepare('SELECT * FROM checklist_entries WHERE week_id = ? AND kind = ? AND item_key = ?')
    .get(weekId, 'score', 'importance')
  assert.equal(row.value, 4.5)
  assert.equal(row.note, '근거 설명')
})

test('upsertChecklistEntry: 유효하지 않은 kind/item_key 조합은 에러를 던진다', () => {
  const weekId = startNewWeek('오류테스트주차')
  assert.throws(() => upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: '99', value: 1 }))
  assert.throws(() => upsertChecklistEntry({ week_id: weekId, kind: 'score', item_key: 'unknown', value: 1 }))
})

test('similar_cases / brief_references / coach_questions: 추가·수정·삭제가 정상 동작한다', () => {
  const db = getDB()

  const caseId = db.prepare(`
    INSERT INTO similar_cases (title, description, source_label, source_url, sort_order) VALUES (?, ?, ?, ?, ?)
  `).run('테스트 사례', '설명', '', '', 99).lastInsertRowid
  db.prepare('UPDATE similar_cases SET title = ? WHERE id = ?').run('수정된 사례', caseId)
  assert.equal(db.prepare('SELECT title FROM similar_cases WHERE id = ?').get(caseId).title, '수정된 사례')
  db.prepare('DELETE FROM similar_cases WHERE id = ?').run(caseId)
  assert.equal(db.prepare('SELECT * FROM similar_cases WHERE id = ?').get(caseId), undefined)

  const refId = db.prepare(`
    INSERT INTO brief_references (label, detail, url, sort_order) VALUES (?, ?, ?, ?)
  `).run('테스트 참고문헌', '', '', 99).lastInsertRowid
  db.prepare('DELETE FROM brief_references WHERE id = ?').run(refId)
  assert.equal(db.prepare('SELECT * FROM brief_references WHERE id = ?').get(refId), undefined)

  const qId = db.prepare(`
    INSERT INTO coach_questions (question, context, sort_order, created_at) VALUES (?, ?, ?, ?)
  `).run('테스트 질문', '', 0, new Date().toISOString()).lastInsertRowid
  db.prepare('DELETE FROM coach_questions WHERE id = ?').run(qId)
  assert.equal(db.prepare('SELECT * FROM coach_questions WHERE id = ?').get(qId), undefined)
})

test('roadmap_weeks 설정이 초기 시딩되어 있고 JSON 배열로 파싱된다', () => {
  const db = getDB()
  const v = db.prepare("SELECT value FROM settings WHERE key = 'roadmap_weeks'").get()?.value
  assert.ok(v, 'roadmap_weeks가 시딩되어 있어야 한다')
  const parsed = JSON.parse(v)
  assert.equal(parsed.length, 4)
})

// ── 화면의 주차별 체크리스트 문항 ↔ 서버 CHECKLIST_KEYS 드리프트 가드 ──
// 문항 라벨은 화면 상수, 값은 DB에 item_key('0'~'6')로 저장된다. 화면에 여덟 번째 문항을
// 적으면 저장이 조용히 거부되므로(upsertChecklistEntry가 throw) 소스를 직접 대조한다.
// 코치 자료 스크립트도 같은 사실을 따라야 한다. 2026-09-05까지 이 스크립트만 옛 화면 소스를
// 긁고 있었고, 못 찾으면 조용히 빈 목록을 돌려줘 자료에 "항목 0"이 찍혔다.
test('코치 자료의 문항 라벨은 DB에서 온다 — 화면 소스를 긁지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/build-coach-packet.cjs'), 'utf8')
  // 주석에서 옛 잘못을 설명하는 것은 괜찮다 — 막으려는 것은 **그 상수를 코드로 찾는 것**이다
  // (category-pick.test.js가 같은 구분을 쓴다).
  assert.doesNotMatch(src, /const CHECKLIST_SETS|match\([^)]*CHECKLIST_SETS/,
    '스크립트가 아직 화면 상수를 찾고 있다 — 그 상수는 0019에서 DB로 갔다')
  assert.match(src, /FROM checklist_items WHERE week_id = \?/,
    '스크립트가 문항 표를 안 읽는다 — 라벨 없이 "항목 0"이 찍힌다')
})

test('문항은 코드 상수가 아니라 DB에 있다 — 7개 상한이 없다', () => {
  // 2026-09-03(0019, 고도화 제안 #23): 문항이 화면 상수(CHECKLIST_SETS)에서 DB로 옮겨왔다.
  // 예전 이 테스트는 "상수의 문항 수가 서버 키 7개를 넘지 않는지"를 지켰는데, 그 상한 자체가
  // 화면에서 문항을 넣지 못하게 막던 것이라 함께 없앴다. 이제 지킬 사실이 반대다.
  // 2026-09-05: 체크리스트 화면이 coachingBriefChecklist.jsx로 갈려 나갔다(순수 이동).
  // **이 단언은 "없을 것"만 보므로, 옛 파일을 계속 보면 아무 신호 없이 통과한다** — 감시가
  // 조용히 사라지는 것이다. 그래서 경로를 옮기고, 아래에 "감시할 화면이 이 파일에 있다"는
  // 앵커를 함께 세운다(docs/big-file-split-design.md가 경고하는 거짓 초록).
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/components/admin/sections/coachingBriefChecklist.jsx'), 'utf8')
  assert.match(src, /function ChecklistScoreCard/,
    '체크리스트 화면이 이 파일에 없다 — 아래 단언은 감시할 대상이 없는 채로 통과한다')
  assert.doesNotMatch(src, /const CHECKLIST_SETS = \{/,
    '화면에 문항 상수가 되살아났다 — 그러면 DB와 두 벌이 되어 한쪽만 고쳐진다')

  const { checklistItems } = require('../routes/coachingBrief')
  const db = getDB()
  const weekId = startNewWeek('상한없음주차')
  // 여덟 개 이상도 들어간다(옛 '0'~'6' 고정이면 여기서 막혔다)
  for (let i = 0; i < 9; i++) checklistItems.addItem(db, weekId, `문항 ${i + 1}`)
  assert.equal(checklistItems.itemsFor(db, weekId).length, 9)

  // 그리고 그 아홉 번째 문항에도 값이 붙는다
  const last = checklistItems.itemsFor(db, weekId).at(-1)
  upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: last.item_key, value: 1 })
  const row = db.prepare('SELECT value FROM checklist_entries WHERE week_id = ? AND item_key = ?')
    .get(weekId, last.item_key)
  assert.equal(row.value, 1, '여덟 번째 이후 문항이 저장되지 않는다')
})
