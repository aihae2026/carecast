// 자연어 초안이 "사람이 무엇을 고쳤나"를 남긴다 (고도화 제안 #10 1단계, 2026-09-03).
//
// 지금까지는 approveDraft(id, overrides)의 overrides — 곧 "AI가 틀린 것" — 가
// insertSchedule로 흘러가고 **버려졌다.** 만들어진 예약 id도 초안 행에 안 적혀서,
// 나중에 초안과 최종을 맞대어 볼 길조차 없었다. 학습의 핵심 재료가 수집되지 않고 있었다.
// 설계·경계는 docs/nl-learning-design.md.
//
// 고정하는 사실 다섯:
//  1. 승인하면 schedule_id가 적힌다 — 초안↔최종을 잇는 유일한 끈
//  2. 승인 시점의 최종값이 approved_json으로 남는다 — 예약이 나중에 바뀌어도 그때 값이 남게
//  3. 사람이 고친 필드만 edited_fields에 남는다 — 안 고쳤으면 빈 배열
//  4. 안 고치고 승인해도 빈 배열이 적힌다 — NULL('모름')과 []('안 고침')은 다른 뜻이다
//  5. 거절은 이 셋을 안 건드린다 — 왜 거절했는지 모르는 채로 학습 재료에 섞으면 안 된다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_nllearn_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const drafts = require('../routes/scheduleDrafts')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
// 내일 날짜 — approveDraft가 지난 날짜를 막는다(assertNotPastDate)
const tomorrow = () => {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeDraft(fields = {}) {
  const id = getDB().prepare(`
    INSERT INTO schedule_drafts
      (raw_input, title, content, scheduled_time, repeat_start_date, broadcast_type, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'text', 'pending', 'ai', ?)
  `).run(
    fields.raw_input ?? `내일 두시에 프로그램 안내 방송${++seq}`,
    fields.title ?? `초안${seq}`,
    fields.content ?? '프로그램 안내드립니다.',
    fields.scheduled_time ?? '14:00',
    fields.repeat_start_date ?? tomorrow(),
    new Date().toISOString(),
  ).lastInsertRowid
  return id
}

const row = (id) => getDB().prepare('SELECT * FROM schedule_drafts WHERE id = ?').get(id)

// ── 사실 1·2: 링크와 스냅샷 ────────────────────────────────────────────────────
test('승인하면 schedule_id와 승인 시점 스냅샷이 남는다', () => {
  const id = makeDraft()
  const { scheduleId } = drafts.approveDraft(id, {})
  const r = row(id)

  assert.equal(r.schedule_id, scheduleId,
    'schedule_id가 안 적혔다 — 초안과 최종 예약을 맞대어 볼 유일한 끈이 없다')
  assert.ok(r.approved_json, 'approved_json이 없다 — 예약이 나중에 바뀌면 그때 값을 알 수 없다')
  const snap = JSON.parse(r.approved_json)
  assert.equal(snap.scheduled_time, '14:00', '스냅샷이 승인 시점의 값을 안 담았다')
})

// ── 사실 3: 고친 것만 남는다 ───────────────────────────────────────────────────
test('사람이 고친 필드만 edited_fields에 남는다', () => {
  const id = makeDraft({ scheduled_time: '14:00', title: '원래 제목' })
  drafts.approveDraft(id, { scheduled_time: '02:00', title: '고친 제목' })
  const edited = JSON.parse(row(id).edited_fields)

  assert.deepEqual([...edited].sort(), ['scheduled_time', 'title'],
    '고친 필드가 정확히 안 남았다 — 무엇을 자꾸 고치는지가 학습의 재료다')
})

test('오전/오후 오독처럼 시각만 고친 경우도 잡힌다', () => {
  const id = makeDraft({ scheduled_time: '02:00' })
  drafts.approveDraft(id, { scheduled_time: '14:00' })
  assert.deepEqual(JSON.parse(row(id).edited_fields), ['scheduled_time'])
})

// ── 사실 4: 안 고침([])과 모름(NULL)은 다르다 ─────────────────────────────────
test('안 고치고 승인하면 빈 배열이 적힌다 — NULL(모름)과 구별되어야 한다', () => {
  const id = makeDraft()
  drafts.approveDraft(id, {})
  const r = row(id)
  assert.equal(r.edited_fields, '[]',
    '안 고쳤는데 NULL로 남으면 옛 행(모름)과 구별이 안 돼 집계 분모가 틀어진다')
})

test('같은 값으로 덮어써도 고친 것으로 세지 않는다', () => {
  const id = makeDraft({ title: '같은 제목', scheduled_time: '09:00' })
  drafts.approveDraft(id, { title: '같은 제목', scheduled_time: '09:00' })
  assert.equal(row(id).edited_fields, '[]',
    '화면이 값을 그대로 되보내는 것을 수정으로 세면 수정률이 부풀려진다')
})

// ── 사실 5: 거절은 안 건드린다 ─────────────────────────────────────────────────
test('거절한 초안은 학습 컬럼을 남기지 않는다 — 왜 거절했는지 모르기 때문이다', () => {
  const id = makeDraft()
  drafts.rejectDraft(id)
  const r = row(id)
  assert.equal(r.status, 'rejected')
  assert.equal(r.schedule_id, null)
  assert.equal(r.edited_fields, null,
    '거절에 빈 배열을 적으면 "안 고치고 승인함"과 섞인다')
})
