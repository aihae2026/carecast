// 이력을 걸러 보고 파일로 낸다 (docs/db-retention-design.md 4번, 2026-09-03).
//
// 왜 필요했나: 보관 기간이 1년이 되었는데 화면은 **최근 500건을 받아 화면에서 걸렀다.**
// 500건 밖의 것은 아무리 걸러도 안 나오므로 "작년 이맘때 뭘 틀었나"에 답하지 못한다.
// 쌓기만 하고 꺼내 볼 수 없으면 그게 블랙박스다.
//
// 고정하는 사실 여섯:
//  1. 날짜 범위로 거른다 — 경계(from·to 당일)를 포함한다
//  2. 유형·성공여부로 거른다. **'전체'는 거르지 않는다** — 실패를 기본으로 감추면 안 된다
//  3. 이상한 값은 조건으로 안 쓴다(빈 값·엉뚱한 모양) — 조용히 0건이 되면 더 위험하다
//  4. CSV는 화면과 **같은 조건**을 쓴다
//  5. CSV에 BOM이 붙는다 — 없으면 엑셀이 한글을 깨서 연다
//  6. 큰따옴표·쉼표가 든 문구도 한 칸으로 온전히 나간다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bexport_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')

// 라우터를 통째로 띄우지 않고 **핸들러만** 부른다 — 이 저장소에는 supertest가 없고,
// 새 테스트 하네스를 들이지 않는 것이 회귀 규칙이다(tests/regression/README.md).
const router = require('../routes/broadcasts')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath
    && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

/** 가짜 req/res로 핸들러를 부르고 결과를 받는다. */
function call(handler, query = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      json(body) { resolve({ status: this.statusCode, body, headers: this.headers }) },
      send(text) { resolve({ status: this.statusCode, text, headers: this.headers }) },
    }
    handler({ query }, res)
  })
}

test.before(() => {
  initDB()
  const ins = getDB().prepare(
    'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
  ins.run('2026-01-01', '09:00', '예약', '새해 안내',            '자동', '전체', 1)
  ins.run('2026-06-15', '10:00', '예약', '점심 안내',            '자동', '전체', 1)
  ins.run('2026-06-15', '11:00', '경보', '[아침방송] 안 나갔습니다', '자동', '-',   0)
  ins.run('2026-09-03', '12:00', 'TTS', '따옴표 "테스트", 쉼표까지', '방송담당', '전체', 1)
})
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const list = (q) => call(findRoute('get', '/'), q).then(r => r.body)

test('사실1 — 날짜 범위로 거르고, 경계를 포함한다', async () => {
  const all = await list({})
  assert.equal(all.length, 4)

  const june = await list({ from: '2026-06-15', to: '2026-06-15' })
  assert.equal(june.length, 2, '경계 당일이 빠졌다')

  const half = await list({ from: '2026-06-01' })
  assert.equal(half.length, 3)
})

test('사실2 — 유형·성공여부로 거른다. 전체는 거르지 않는다', async () => {
  assert.equal((await list({ type: '경보' })).length, 1)
  assert.equal((await list({ type: '전체' })).length, 4, "'전체'가 조건으로 들어갔다")

  const failed = await list({ success: '0' })
  assert.equal(failed.length, 1)
  assert.equal(failed[0].type, '경보')

  // 실패를 기본으로 감추면 그게 블랙박스다 — 아무 것도 안 주면 성공·실패가 다 온다
  assert.equal((await list({ success: '' })).length, 4)
})

test('사실3 — 이상한 값은 조건으로 안 쓴다', async () => {
  for (const bad of ['2026-6-15', '어제', '2026/06/15', '']) {
    assert.equal((await list({ from: bad })).length, 4,
      `'${bad}'가 조건이 되어 결과가 줄었다 — 조용히 0건이 되면 더 위험하다`)
  }
  assert.equal((await list({ success: '9' })).length, 4)
})

test('사실4·5·6 — CSV가 같은 조건을 쓰고, BOM이 붙고, 문구가 온전하다', async () => {
  const r = await call(findRoute('get', '/export.csv'), { type: '경보' })

  assert.match(r.headers['content-type'], /text\/csv/)
  assert.match(r.headers['content-disposition'], /attachment; filename="carecast-broadcasts-\d{4}-\d{2}-\d{2}\.csv"/)

  assert.equal(r.text.charCodeAt(0), 0xFEFF, 'BOM이 없으면 엑셀이 한글을 깨서 연다')

  const rows = r.text.slice(1).split('\r\n')
  assert.equal(rows.length, 2, '머리글 + 경보 1줄이어야 한다(조건이 화면과 같아야 한다)')
  // 2026-09-03: 발사에서 소리 지시까지 걸린 시간(준비)이 칸 하나로 붙었다 —
  // 이력의 시각은 발사 시각이라, 이 값이 없으면 정시성을 파일로 보일 수 없다.
  assert.equal(rows[0], '"날짜","시각","유형","내용","담당","대상","결과","준비(초)"')
  assert.match(rows[1], /"경보"/)
  assert.match(rows[1], /"실패",""$/, '안 잰 행의 준비 칸은 빈칸이어야 한다')

  // 큰따옴표·쉼표가 든 문구
  const all = await call(findRoute('get', '/export.csv'), {})
  const line = all.text.split('\r\n').find(l => l.includes('따옴표'))
  assert.ok(line.includes('"따옴표 ""테스트"", 쉼표까지"'),
    '큰따옴표를 두 번 쓰지 않으면 칸이 밀려 파일이 통째로 어긋난다')
})

test('전체 삭제는 여전히 막혀 있다 — 기준 날짜가 필요하다', async () => {
  const r = await call(findRoute('delete', '/'), {})
  assert.equal(r.status, 400)
  assert.match(r.body.error, /before=YYYY-MM-DD/)
})
