// 고도화 제안 화면의 "코칭 브리프 다시 쓰기 요청" — settings 테이블 재사용, 새 테이블 없음
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_briefstatus_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { getBriefStatus, setBriefRewriteRequested } = require('../routes/improvementProposals')

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('요청한 적 없으면 requestedAt은 null이다', () => {
  const s = getBriefStatus()
  assert.equal(s.requestedAt, null)
})

test('요청하면 requestedAt이 현재 시각으로 기록된다', () => {
  const before = Date.now()
  setBriefRewriteRequested(true)
  const s = getBriefStatus()
  assert.ok(s.requestedAt, 'requestedAt이 채워져야 한다')
  const recorded = new Date(s.requestedAt).getTime()
  assert.ok(recorded >= before && recorded <= Date.now(), 'requestedAt이 방금 시각이어야 한다')
})

test('요청을 취소하면 requestedAt이 다시 null이 된다', () => {
  setBriefRewriteRequested(true)
  setBriefRewriteRequested(false)
  const s = getBriefStatus()
  assert.equal(s.requestedAt, null)
})
