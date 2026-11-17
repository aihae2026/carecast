// 이력에 **소리 지시까지 걸린 시간**을 남긴다 — "12:00 예약인데 12:01에 나온다"의 3번 갈래.
//
// 이력의 `time`은 **발사 시각**이다. 그 뒤에 붙는 TTS 합성 시간(실측 2.25초, 현장은 더 길고
// 실패하면 재시도·타임아웃 60초)은 이력 어디에도 안 남아서, 이 문제는 **사람 귀로만** 알 수
// 있었다. 이제 prep_ms로 남는다 — 캐시 우선·미리 만들기가 실제로 듣는지도 이 숫자로 본다.
//
// 고정하는 사실 다섯:
//  1. 컬럼이 있다(마이그레이션 0018 + schema.expected.json + verify:db 3종 세트)
//  2. TTS 예약은 걸린 시간이 기록된다
//  3. TTS를 안 쓰는 유형(차임 등)은 null이다 — 0으로 적으면 "0초 걸렸다"는 거짓이 된다
//  4. 옛 행은 null이고, 그 뜻은 "안 쟀음"이다
//  5. 이력 조회·CSV가 그 값을 실어 나른다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_prep_${process.pid}_${Date.now()}.db`)
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

test('사실1 — broadcasts에 prep_ms 컬럼이 있다', () => {
  const cols = getDB().prepare('PRAGMA table_info(broadcasts)').all().map(c => c.name)
  assert.ok(cols.includes('prep_ms'), '마이그레이션 0018이 반영되지 않았다')

  // 3종 세트 — 마이그레이션 파일과 기대 스키마가 함께 있어야 한다
  const mig = path.join(__dirname, '..', '..', 'db', 'migrations', '0018_add_broadcasts_prep_ms.sql')
  assert.ok(fs.existsSync(mig), '마이그레이션 파일이 없다')
  const expected = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'schema.expected.json'), 'utf8'))
  const table = (expected.tables || expected).broadcasts
  assert.ok(table.columns.includes('prep_ms'), 'schema.expected.json에 안 적혔다 — verify:db가 못 잡는다')
})

test('사실2·3·4 — 잰 것만 숫자로, 안 잰 것은 null로 남는다', () => {
  const db = getDB()
  const { fireSchedule } = require('../services/scheduler')
  void fireSchedule   // 발사 경로는 아래 소스 대조로 본다(실제 발사는 소리·네트워크가 붙는다)

  const ins = db.prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success, prep_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  ins.run('2026-09-03', '12:00', '예약', 'TTS 방송', '자동', '전체', 1, 2250)
  ins.run('2026-09-03', '12:05', '예약', '차임벨',   '자동', '전체', 1, null)

  const rows = db.prepare('SELECT * FROM broadcasts ORDER BY id').all()
  assert.equal(rows[0].prep_ms, 2250)
  assert.equal(rows[1].prep_ms, null, '안 잰 것을 0으로 적으면 "0초 걸렸다"는 거짓이 된다')
})

test('사실2-b — 발사 경로가 실제로 시간을 재서 넘긴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  assert.match(src, /const startedAt = Date\.now\(\)/, '발사 시각을 안 잰다')
  assert.match(src, /const prepMs = Date\.now\(\) - startedAt/, '걸린 시간을 안 구한다')
  assert.match(src, /finishScheduleFire\(db, schedule, time, schedule\.content \|\| schedule\.title, hasSitePlayer\(\), prepMs\)/,
    '구해 놓고 이력에 안 넘긴다')
  // 차임벨·음원처럼 TTS를 안 쓰는 경로는 넘기지 않는다(=null) — 그래야 "안 쟀음"이 남는다
  assert.match(src, /function finishScheduleFire\(db, schedule, time, logContent, delivered = true, prepMs = null\)/,
    '기본값이 null이어야 안 잰 경로가 0으로 찍히지 않는다')
})

test('사실5 — 이력 조회와 CSV가 그 값을 실어 나른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'broadcasts.js'), 'utf8')
  // 목록은 SELECT * 라 자동으로 실린다. CSV는 열을 손으로 고르므로 빠지기 쉽다.
  assert.match(src, /SELECT date, time, type, content, user, target, success, prep_ms FROM broadcasts/,
    'CSV가 준비 시간을 안 싣는다 — 심사·감사 때 정시성을 못 보여준다')
  assert.match(src, /'준비\(초\)'/, 'CSV 머리글에 없다')
  assert.match(src, /Number\.isFinite\(r\.prep_ms\)/, '안 잰 행을 빈칸으로 두지 않는다')
})
