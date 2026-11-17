// 주차별 체크리스트 **문항**을 다루는 한 곳 (고도화 제안 #23, 2026-09-03).
//
// 왜 필요했나: 문항 텍스트가 화면 코드의 상수였다(ImprovementProposals.jsx의 CHECKLIST_SETS).
// DB에는 값(체크·점수·메모)만 있어서, 3주차 문항이 오면 개발자가 코드를 고쳐야 했고
// 새 주차를 만들면 직전 주차 문항이 그대로 보였다.
//
// **이 파일에서 가장 중요한 규칙: `item_key`는 한 번 정하면 안 바꾼다.**
// 값(checklist_entries.item_key)이 그 열쇠로 붙어 있다. 순서를 바꾸거나 중간 문항을 지울 때
// 열쇠를 다시 매기면 **지난 주차의 체크·메모가 엉뚱한 문항 밑으로 옮겨간다.**
// 순서는 sort_order로만 바꾸고, 새 문항은 늘 "지금까지 쓴 적 없는 번호"를 받는다.
'use strict'

// 시딩용 원본 — 화면 코드에 있던 CHECKLIST_SETS를 그대로 옮겨 적었다.
// **이 상수는 시딩에만 쓴다.** 시딩 뒤로는 DB가 단일 출처이고, 여기를 고쳐도 아무 일도 없다.
// (그래서 새 주차 문항을 여기에 추가하지 않는다 — 화면에서 넣는 것이 이 기능의 목적이다.)
const SEED_SETS = {
  '1주차': [
    '본선에서 해결하려는 문제를 한 문장으로 쉽게 설명 가능하다',
    '실제 사용자 또는 내부 구성원에게 간단히 보여주고 의견을 받아본 적이 있다',
    '본선 4주 안에 만들 결과물의 최종 형태와 핵심 기능이 명확히 정해졌다',
    '구현을 위해 필요한 주요 작업과 일정이 정리되었다',
    '핵심 기능 중 일부를 구현하거나 기존 프로토타입을 업데이트하고 있다',
    '현재 가장 큰 기술적 난관이 무엇인지 파악되어 있다',
    '개인정보나 민감정보가 포함될 가능성이 있는지 확인했다',
  ],
  '2주차': [
    '핵심 기능 중 최소 1개 이상이 완벽하게 작동한다',
    '실제 사용자 또는 내부 구성원에게 현재 구현된 기능을 보여주고 의견을 받아봤다',
    '팀 내부에서 해결하기 어려운 기술적 문제는 코치가 이해하기 쉽게 정리하여 공유하고 있다',
    '개인정보·민감정보가 포함되는 기능에 대한 대비가 되어 있다',
    '남은 2주 동안 해야 할 작업과 일정이 정리되어 있다',
    '현재 속도를 기준으로 본선 기간 안에 최종 결과물을 완성할 수 있는지 판단했다',
  ],
}
// 라벨만 만들어 둔 주차(문항이 아직 안 온 주차)는 예전 화면이 "가장 최근 문항"을 보여줬다.
// 시딩도 같은 규칙을 따른다 — 안 그러면 지금 보이던 문항이 사라진다.
const SEED_LATEST = Object.values(SEED_SETS).at(-1)

function itemsFor(db, weekId) {
  return db.prepare(
    'SELECT id, item_key, label, sort_order FROM checklist_items WHERE week_id = ? ORDER BY sort_order, id'
  ).all(weekId)
}

/** 그 주차에 실제로 있는 문항인가. 서버 검증이 이걸로 바뀌었다(옛 '0'~'6' 고정 목록 폐기). */
function hasItem(db, weekId, itemKey) {
  return !!db.prepare('SELECT 1 FROM checklist_items WHERE week_id = ? AND item_key = ?')
    .get(weekId, String(itemKey))
}

/**
 * **지금까지 쓴 적 없는** 열쇠를 준다. 지운 문항의 열쇠도 다시 쓰지 않는다 —
 * 값이 남아 있을 수 있고, 그러면 새 문항이 옛 체크를 물려받는다.
 */
function nextItemKey(db, weekId) {
  const used = new Set([
    ...db.prepare('SELECT item_key FROM checklist_items WHERE week_id = ?').all(weekId).map(r => r.item_key),
    // 지운 문항의 값이 아직 남아 있을 수 있다
    ...db.prepare("SELECT item_key FROM checklist_entries WHERE week_id = ? AND kind = 'checklist'")
      .all(weekId).map(r => r.item_key),
  ])
  let n = 0
  while (used.has(String(n))) n += 1
  return String(n)
}

function addItem(db, weekId, label) {
  const text = String(label ?? '').trim()
  if (!text) throw new Error('문항 내용을 입력해주세요.')
  const key = nextItemKey(db, weekId)
  const max = db.prepare('SELECT MAX(sort_order) m FROM checklist_items WHERE week_id = ?').get(weekId)?.m
  db.prepare('INSERT INTO checklist_items (week_id, item_key, label, sort_order) VALUES (?, ?, ?, ?)')
    .run(weekId, key, text, Number.isFinite(max) ? max + 1 : 0)
  return key
}

/** 문구만 고친다. **열쇠는 안 건드린다** — 그 문항에 붙은 체크·메모가 그대로 따라와야 한다. */
function updateLabel(db, weekId, itemKey, label) {
  const text = String(label ?? '').trim()
  if (!text) throw new Error('문항 내용을 입력해주세요.')
  const r = db.prepare('UPDATE checklist_items SET label = ? WHERE week_id = ? AND item_key = ?')
    .run(text, weekId, String(itemKey))
  if (r.changes === 0) throw new Error('그 문항을 찾을 수 없습니다.')
}

/** 순서만 바꾼다(열쇠 재사용 금지 규칙과 한 몸이다). keys는 위에서 아래 순서. */
function reorder(db, weekId, keys) {
  const stmt = db.prepare('UPDATE checklist_items SET sort_order = ? WHERE week_id = ? AND item_key = ?')
  keys.forEach((k, i) => stmt.run(i, weekId, String(k)))
}

/**
 * 문항을 지운다. **그 문항의 값(체크·메모)도 함께 지운다**(사용자 결정 2026-09-03).
 * 남기면 화면에 없는 값이 DB에 떠돌고, 나중에 같은 열쇠가 재사용되면 되살아난다.
 * (nextItemKey가 재사용을 막지만, 두 겹으로 막는다.)
 */
function removeItem(db, weekId, itemKey) {
  const key = String(itemKey)
  db.prepare('DELETE FROM checklist_items WHERE week_id = ? AND item_key = ?').run(weekId, key)
  db.prepare("DELETE FROM checklist_entries WHERE week_id = ? AND kind = 'checklist' AND item_key = ?")
    .run(weekId, key)
}

/**
 * 문항이 하나도 없는 주차에 옛 코드 상수를 1회 넣는다.
 * **이미 있으면 절대 건드리지 않는다** — 사람이 화면에서 고친 문항을 되돌리면 안 된다
 * (볼륨 시딩·site-baseline과 같은 규칙).
 * @returns {number} 문항을 채운 주차 수
 */
function seedMissingWeeks(db) {
  let seeded = 0
  const weeks = db.prepare('SELECT id, week_label FROM checklist_weeks').all()
  for (const w of weeks) {
    const count = db.prepare('SELECT COUNT(*) c FROM checklist_items WHERE week_id = ?').get(w.id).c
    if (count > 0) continue
    const labels = SEED_SETS[w.week_label] ?? SEED_LATEST
    labels.forEach((label, i) => {
      db.prepare('INSERT INTO checklist_items (week_id, item_key, label, sort_order) VALUES (?, ?, ?, ?)')
        .run(w.id, String(i), label, i)
    })
    seeded += 1
  }
  return seeded
}

module.exports = {
  itemsFor, hasItem, nextItemKey, addItem, updateLabel, reorder, removeItem,
  seedMissingWeeks, SEED_SETS,
}
