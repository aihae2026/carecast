// DB 연결 설정이 실제로 걸려 있는가 (2026-08-29 리뷰 CC-020).
//
// 예전엔 journal_mode 하나만 명시하고 나머지는 SQLite·node 기본값에 맡겨져 있었다.
// 기본값은 라이브러리 버전에 따라 바뀔 수 있고, 바뀌어도 아무도 모른다 — 그래서 실측으로 고정한다.
//
// 이 파일은 finding의 제안 중 **적용하지 않은 것**도 함께 고정한다. 다음 사람이 "리뷰에
// 있는데 왜 안 했지?" 하고 되돌리지 않도록.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_pragma_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const pragma = (k) => Object.values(getDB().prepare(`PRAGMA ${k}`).get())[0]

test('WAL — 읽기가 쓰기를 막지 않는다', () => {
  assert.equal(pragma('journal_mode'), 'wal')
})

test('busy_timeout이 걸려 있다 — 기본값 0이면 잠금이 겹치는 순간 즉시 던진다', () => {
  // 실제로 겹칠 수 있는 지점: 백업(VACUUM INTO)이 읽는 동안의 쓰기, 부트 마이그레이션과
  // 첫 요청, 개발 PC와 현장 PC가 같은 파일을 여는 사고.
  const t = pragma('busy_timeout')
  assert.ok(t >= 3000, `busy_timeout이 ${t}ms — 짧으면 잠깐의 잠금에도 방송 기록이 실패한다`)
})

test('foreign_keys가 켜져 있다 — node:sqlite 기본값에 기대지 않는다', () => {
  assert.equal(pragma('foreign_keys'), 1)
})

test('synchronous를 NORMAL로 낮추지 않는다 — 리뷰 제안을 일부러 안 따랐다', () => {
  // CC-020은 synchronous=NORMAL을 제안했지만 실측값이 이미 FULL(2)이었다. 낮추면 정전 시
  // 마지막 커밋들을 잃을 수 있다. 요양원 PC는 정전이 실제 시나리오이고, 이 DB는 하루 수백 건
  // 규모라 FULL의 비용이 무시할 만하다 — 안전한 쪽을 유지한다.
  assert.equal(pragma('synchronous'), 2, 'FULL(2)이어야 한다. 낮추려면 정전 시 손실을 감수한다는 판단이 먼저다')
})

test('schedules.audio_file_id에는 외래키가 없다 — FK만 켜도 고아를 못 막는다는 사실을 고정한다', () => {
  // CC-020은 "FK OFF라서 고아 audio_file_id가 무음+success=1을 유발한다"고 적었는데,
  // FK는 이미 켜져 있었고 이 컬럼에는 제약 선언 자체가 없다. 그래서 참조가 깨졌는지는
  // 발사 시점에 조회해서 판정한다(scheduler.reportMissingSource, delivery-truth.test.js).
  const sql = getDB().prepare("SELECT sql FROM sqlite_master WHERE name = 'schedules'").get().sql
  assert.ok(!/FOREIGN KEY/i.test(sql),
    'FK가 생겼다면 참조 깨짐 판정을 DB에 맡길 수 있다 — scheduler의 런타임 검사를 다시 볼 것')
})
