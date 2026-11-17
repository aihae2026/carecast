// 고도화 제안 화면의 "루프 설정" 저장/조회 — settings 테이블 재사용, 새 테이블 없음
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_loopcfg_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { getLoopSettings, saveLoopSettings, markLoopRun } = require('../routes/improvementProposals')

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('설정한 적 없으면 기본값(꺼짐 · 매일)을 반환한다', () => {
  const s = getLoopSettings()
  assert.equal(s.enabled, false)
  assert.equal(s.cadence, 'daily')
})

test('저장하면 그대로 재조회된다', () => {
  saveLoopSettings({ enabled: true, cadence: 'weekly' })
  const s = getLoopSettings()
  assert.equal(s.enabled, true)
  assert.equal(s.cadence, 'weekly')
})

test('cadence는 daily/weekly만 허용한다', () => {
  assert.throws(() => saveLoopSettings({ enabled: true, cadence: 'hourly' }))
})

test('다시 저장하면 이전 값을 덮어쓴다 (누적 안 됨)', () => {
  saveLoopSettings({ enabled: true, cadence: 'daily' })
  saveLoopSettings({ enabled: false, cadence: 'weekly' })
  const s = getLoopSettings()
  assert.equal(s.enabled, false)
  assert.equal(s.cadence, 'weekly')
})

test('한 번도 실행 안 했으면 lastRun은 null이다', () => {
  const s = getLoopSettings()
  assert.equal(s.lastRun, null)
})

test('markLoopRun 호출하면 lastRun이 현재 시각으로 기록된다', () => {
  const before = Date.now()
  markLoopRun()
  const s = getLoopSettings()
  assert.ok(s.lastRun, 'lastRun이 채워져야 한다')
  const recorded = new Date(s.lastRun).getTime()
  assert.ok(recorded >= before && recorded <= Date.now(), 'lastRun이 방금 시각이어야 한다')
})
