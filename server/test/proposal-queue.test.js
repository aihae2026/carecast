// "승인" 상태가 되면 queued_at이 채워져 "구현 대기"로 표시되고, 다른 상태로 바뀌거나
// dismissProposalQueue()가 호출되면 비워진다. 자동 구현은 하지 않음 — 표시만 남긴다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_proposalqueue_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { setProposalStatus, dismissProposalQueue } = require('../routes/improvementProposals')

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function insertProposal() {
  const db = getDB()
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO improvement_proposals (date, title, description, status, category, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('2026-08-24', '테스트 제안', '', '추천', '', now, now)
  return result.lastInsertRowid
}

function getRow(id) {
  return getDB().prepare('SELECT status, queued_at FROM improvement_proposals WHERE id = ?').get(id)
}

test('status를 승인으로 바꾸면 queued_at이 채워진다', () => {
  const id = insertProposal()
  const before = Date.now()
  setProposalStatus(id, '승인')
  const row = getRow(id)
  assert.equal(row.status, '승인')
  assert.ok(row.queued_at, 'queued_at이 채워져야 한다')
  const recorded = new Date(row.queued_at).getTime()
  assert.ok(recorded >= before && recorded <= Date.now())
})

test('승인이 아닌 상태로 바꾸면 queued_at이 비워진다', () => {
  const id = insertProposal()
  setProposalStatus(id, '승인')
  setProposalStatus(id, '차단')
  const row = getRow(id)
  assert.equal(row.status, '차단')
  assert.equal(row.queued_at, null)
})

test('이미 승인이고 queued_at이 있는 상태에서 다시 승인해도 시각이 덮어써지지 않는다', () => {
  const id = insertProposal()
  setProposalStatus(id, '승인')
  const first = getRow(id).queued_at
  setProposalStatus(id, '승인')
  const second = getRow(id).queued_at
  assert.equal(first, second)
})

test('dismissProposalQueue: status는 유지하고 queued_at만 비운다', () => {
  const id = insertProposal()
  setProposalStatus(id, '승인')
  dismissProposalQueue(id)
  const row = getRow(id)
  assert.equal(row.status, '승인', 'status는 승인으로 남아있어야 한다')
  assert.equal(row.queued_at, null)
})

test('허용되지 않은 status는 에러를 던진다', () => {
  const id = insertProposal()
  assert.throws(() => setProposalStatus(id, '알수없음'))
})
