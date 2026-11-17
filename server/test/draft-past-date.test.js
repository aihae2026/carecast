// CC-028 — 과거 날짜 초안 차단.
//
// 1회성 예약은 repeat_start_date 당일에만 발동한다(repeatSchedule.shouldRunToday).
// 그래서 어제 날짜로 초안이 만들어지고 사람이 승인하면 **영원히 안 울리는 예약**이 조용히
// 생긴다 — 화면에는 정상적으로 등록된 것처럼 보이므로 사람이 알아챌 방법이 없다.
// (Gemini가 "8월 20일"처럼 지난 날짜를 그대로 뱉거나, 승인 카드에서 사람이 날짜를 고칠 때 난다.)
//
// **당일은 막지 않는다.** 즉시 방송("지금 당장")이 오늘 날짜 + 방금 지난 시각으로 이 경로를
// 타므로, 시각까지 보고 막으면 즉시 방송이 통째로 깨진다. 판정 단위는 날짜 하나뿐이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_pastdate_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { insertDraft, approveDraft } = require('../routes/scheduleDrafts')
const { todayStr } = require('../services/repeatSchedule')

function shift(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const base = {
  raw_input: '어제 오후 두시에 안내 방송', title: '안내', content: '안내입니다.',
  scheduled_time: '14:00',
}

test('어제 날짜 초안은 insertDraft에서 거부된다', () => {
  const before = getDB().prepare('SELECT COUNT(*) AS n FROM schedule_drafts').get().n
  assert.throws(
    () => insertDraft({ ...base, repeat_start_date: shift(-1) }),
    /지난 날짜/,
  )
  assert.equal(
    getDB().prepare('SELECT COUNT(*) AS n FROM schedule_drafts').get().n, before,
    '거부됐으면 초안 행도 남지 않아야 한다',
  )
})

test('오늘 날짜는 통과한다 — 즉시 방송이 이 경로를 쓴다', () => {
  const draft = insertDraft({ ...base, repeat_start_date: todayStr(), scheduled_time: '00:01' })
  assert.equal(draft.status, 'pending')
})

test('내일 날짜는 통과한다', () => {
  const draft = insertDraft({ ...base, repeat_start_date: shift(1) })
  assert.equal(draft.status, 'pending')
})

test('승인 화면에서 과거 날짜로 고치면 approveDraft가 거부하고 schedules는 안 늘어난다', () => {
  const draft = insertDraft({ ...base, repeat_start_date: shift(1) })
  const before = getDB().prepare('SELECT COUNT(*) AS n FROM schedules').get().n
  assert.throws(
    () => approveDraft(draft.id, { repeat_start_date: shift(-3) }),
    /지난 날짜/,
  )
  assert.equal(getDB().prepare('SELECT COUNT(*) AS n FROM schedules').get().n, before)
  assert.equal(
    getDB().prepare('SELECT status FROM schedule_drafts WHERE id = ?').get(draft.id).status, 'pending',
    '거부됐으면 초안은 pending 그대로여야 다시 고쳐 승인할 수 있다',
  )
})

test('초안이 만들어진 뒤 날짜가 지나면(초안에 과거 날짜가 박힌 채 남으면) 승인이 거부된다', () => {
  // 하루 넘겨 잠든 초안 — insertDraft를 우회해 직접 넣어 그 상태를 만든다.
  const now = new Date().toISOString()
  const id = getDB().prepare(`
    INSERT INTO schedule_drafts
      (raw_input, title, content, scheduled_time, repeat_start_date, broadcast_type, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'text', 'pending', 'ai', ?)
  `).run('어제 방송', '안내', '안내입니다.', '14:00', shift(-1), now).lastInsertRowid
  assert.throws(() => approveDraft(Number(id), {}), /지난 날짜/)
})
