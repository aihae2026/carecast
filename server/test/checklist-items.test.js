// 체크리스트 문항을 화면에서 넣고 고친다 (고도화 제안 #23, 2026-09-03).
//
// 왜 필요했나: 문항 텍스트가 화면 코드의 상수였다. DB에는 값(체크·점수·메모)만 있어서
// 3주차 문항이 오면 개발자가 코드를 고쳐야 했고, 서버가 item_key를 '0'~'6'으로 못 박아
// **여덟 번째 문항은 저장 자체가 거부**됐다. 새 주차를 만들면 직전 주차 문항이 그대로 보였다.
//
// 이 기능에서 제일 위험한 것은 **열쇠(item_key)를 다시 매기는 것**이다. 값이 그 열쇠로
// 붙어 있어서, 순서를 바꾸거나 중간 문항을 지울 때 열쇠가 밀리면 **지난 주차의 체크·메모가
// 엉뚱한 문항 밑으로 옮겨간다.** 아래 사실들이 그걸 막는다.
//
// 고정하는 사실 일곱:
//  1. 문항을 넣고·고치고·지운다(7개 상한 없음)
//  2. **순서를 바꿔도 열쇠는 그대로다** — 체크·메모가 따라온다
//  3. **문구를 고쳐도 열쇠는 그대로다**
//  4. 지운 문항의 열쇠는 **다시 쓰지 않는다** — 새 문항이 옛 체크를 물려받으면 안 된다
//  5. 문항을 지우면 그 문항의 체크·메모도 함께 지운다(사용자 결정)
//  6. 값은 **그 주차에 있는 문항**에만 붙는다
//  7. 시딩은 문항이 없는 주차에만, 이미 있으면 절대 안 건드린다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_clitems_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const C = require('../domain/checklistItems')
const { upsertChecklistEntry } = require('../routes/coachingBrief')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function newWeek() {
  const db = getDB()
  return db.prepare('INSERT INTO checklist_weeks (week_label, started_at, is_current) VALUES (?, ?, 0)')
    .run(`테스트${++seq}주차`, new Date().toISOString()).lastInsertRowid
}
const check = (weekId, key, value) =>
  upsertChecklistEntry({ week_id: weekId, kind: 'checklist', item_key: key, value })
const entryOf = (weekId, key) => getDB()
  .prepare("SELECT * FROM checklist_entries WHERE week_id = ? AND kind = 'checklist' AND item_key = ?")
  .get(weekId, String(key))

test('사실1 — 넣고·고치고·지운다(7개 상한 없음)', () => {
  const db = getDB(); const w = newWeek()
  for (let i = 0; i < 8; i++) C.addItem(db, w, `문항 ${i + 1}`)
  assert.equal(C.itemsFor(db, w).length, 8, '여덟 번째에서 막히면 안 된다')

  C.updateLabel(db, w, C.itemsFor(db, w)[0].item_key, '고친 문항')
  assert.equal(C.itemsFor(db, w)[0].label, '고친 문항')

  assert.throws(() => C.addItem(db, w, '   '), /입력/, '빈 문항이 들어간다')
})

test('사실2 — 순서를 바꿔도 열쇠는 그대로다(체크가 따라온다)', () => {
  const db = getDB(); const w = newWeek()
  const a = C.addItem(db, w, '가')
  const b = C.addItem(db, w, '나')
  check(w, a, 1)                       // '가'에만 체크

  C.reorder(db, w, [b, a])             // 순서만 뒤집는다
  const items = C.itemsFor(db, w)
  assert.deepEqual(items.map(i => i.label), ['나', '가'], '순서가 안 바뀌었다')
  assert.equal(items[1].item_key, a, '열쇠가 다시 매겨졌다 — 체크가 엉뚱한 문항으로 옮겨간다')
  assert.equal(entryOf(w, a).value, 1, '체크가 따라오지 않았다')
  assert.equal(entryOf(w, b), undefined, "체크 안 한 문항에 값이 생겼다")
})

test('사실3 — 문구를 고쳐도 열쇠는 그대로다', () => {
  const db = getDB(); const w = newWeek()
  const k = C.addItem(db, w, '옛 문구')
  check(w, k, 1)
  C.updateLabel(db, w, k, '새 문구')
  assert.equal(C.itemsFor(db, w)[0].item_key, k)
  assert.equal(entryOf(w, k).value, 1, '문구를 고쳤다고 체크가 사라졌다')
})

test('사실4 — 지운 문항의 열쇠를 다시 쓰지 않는다', () => {
  const db = getDB(); const w = newWeek()
  const a = C.addItem(db, w, '지울 문항')
  check(w, a, 1)
  // 값만 남기고 문항 행을 지운 상태를 만든다(옛 데이터가 떠도는 상황)
  db.prepare('DELETE FROM checklist_items WHERE week_id = ? AND item_key = ?').run(w, a)

  const b = C.addItem(db, w, '새 문항')
  assert.notEqual(b, a, '지운 열쇠를 재사용했다 — 새 문항이 옛 체크를 물려받는다')
})

test('사실5 — 문항을 지우면 그 체크·메모도 함께 지운다', () => {
  const db = getDB(); const w = newWeek()
  const a = C.addItem(db, w, '지울 문항')
  const b = C.addItem(db, w, '남을 문항')
  check(w, a, 1); check(w, b, 1)

  C.removeItem(db, w, a)
  assert.equal(entryOf(w, a), undefined, '화면에 없는 값이 DB에 떠돈다')
  assert.equal(entryOf(w, b).value, 1, '엉뚱한 문항의 값까지 지웠다')
})

test('사실6 — 값은 그 주차에 있는 문항에만 붙는다', () => {
  const db = getDB(); const w = newWeek()
  const a = C.addItem(db, w, '있는 문항')
  assert.doesNotThrow(() => check(w, a, 1))
  assert.throws(() => check(w, '999', 1), /문항/, '없는 문항에 값이 저장된다')
})

test('사실7 — 시딩은 빈 주차에만, 이미 있으면 안 건드린다', () => {
  const db = getDB(); const w = newWeek()
  db.prepare('UPDATE checklist_weeks SET week_label = ? WHERE id = ?').run('1주차', w)

  assert.equal(C.seedMissingWeeks(db) >= 1, true)
  const seeded = C.itemsFor(db, w)
  assert.equal(seeded.length, C.SEED_SETS['1주차'].length, '1주차 문항이 그대로 들어와야 한다')
  assert.equal(seeded[0].label, C.SEED_SETS['1주차'][0])

  // 사람이 고친 뒤 다시 돌려도 되돌아가면 안 된다
  C.updateLabel(db, w, seeded[0].item_key, '사람이 고친 문항')
  C.seedMissingWeeks(db)
  assert.equal(C.itemsFor(db, w)[0].label, '사람이 고친 문항',
    '시딩이 사람이 고친 문항을 되돌렸다')
})
