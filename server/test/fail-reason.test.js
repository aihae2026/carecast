// 0026 — 방송이 왜 실패했나를 **코드**로 남긴다 (P-95, 사용자 승인 2026-09-10 §4).
//
// `success = 0` 은 "안 나갔다"만 말한다. 그래서 두 자리가 **이력 문구를 정확일치로 짝맞춰**
// 뜻을 읽고 있었다(밀림 경보 문구·오류 집계 제외). 문구를 바꾸는 날 조용히 어긋난다.
//
// **승인 조건이 요구한 것을 하나씩 본다**(§4):
//   ① 기존 기록 보존 — 옛 행은 NULL 그대로, 백필 없음
//   ② '기록 없음'과 구분 — NULL vs 코드
//   ③ 민감정보 미저장 — 정해진 코드만, 원본 메시지·토큰·문안 금지
//   ④ 신규 DB · 기존 DB 업그레이드 · 마이그레이션 재실행 · 이전 앱 호환 · 조회·집계 경로
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_failreason_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')

const { initDB, getDB } = require('../db/schema')
const BR = require('../domain/broadcastRecord')

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

const 칸들 = (db, 표) => db.prepare(`PRAGMA table_info(${표})`).all().map((c) => c.name)
const 행 = (id) => getDB().prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)

// ── ④ 신규 DB ──────────────────────────────────────────────────────────

test('신규 DB 에 fail_reason 칸이 있다', () => {
  assert.ok(칸들(getDB(), 'broadcasts').includes('fail_reason'), '새로 만든 DB 에 칸이 없다')
})

test('기대 스키마와 실제가 맞다 — verify:db 가 보는 그 목록', () => {
  const expected = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'schema.expected.json'), 'utf8'))
  assert.ok(expected.broadcasts.columns.includes('fail_reason'),
    '기대 스키마에 안 넣었다 — verify:db 가 드리프트로 잡는다')
})

// ── ③ 민감정보 미저장 ───────────────────────────────────────────────────

test('정해진 코드만 들어간다 — 원본 오류·토큰·문안을 그대로 안 담는다', () => {
  assert.equal(BR.사유코드('preempted'), 'preempted')
  assert.equal(BR.사유코드('human_stop'), 'human_stop')
  // 목록 밖은 굵게 접는다. 자유 문자열이 이력에 흘러 들어가면 안 된다.
  assert.equal(BR.사유코드('Error: ECONNREFUSED 192.168.0.5:8080'), 'error')
  assert.equal(BR.사유코드('Bearer abc.def.ghi'), 'error')
  assert.equal(BR.사유코드('오늘 점심 안내입니다'), 'error')
  // 없는 것은 없는 것이다 — 빈 값을 error 로 만들지 않는다
  assert.equal(BR.사유코드(null), null)
  assert.equal(BR.사유코드(''), null)
  assert.equal(BR.사유코드(undefined), null)
})

test('실제로 저장된 값도 코드뿐이다 — 메시지는 로그로만 간다', () => {
  const id = BR.시작기록(getDB(), { type: 'TTS', content: '점심 안내' })
  BR.실패로정정(getDB(), id, 'Error: ECONNREFUSED 192.168.0.5:8080 토큰 abc123', 'Error: ECONNREFUSED …')
  const r = 행(id)
  assert.equal(r.fail_reason, 'error', '목록 밖 사유를 그대로 담았다')
  assert.doesNotMatch(String(r.fail_reason), /ECONNREFUSED|192\.168|abc123/, '원본 문자열이 이력에 들어갔다')
})

// ── ①② 기존 기록 보존 · '기록 없음' 구분 ────────────────────────────────

test('사유를 안 주면 NULL 이다 — "기록 없음"과 "사유 있음"이 갈린다', () => {
  const id = BR.시작기록(getDB(), { type: 'TTS', content: 'x' })
  BR.실패로정정(getDB(), id)               // 코드 없이
  const r = 행(id)
  assert.equal(r.success, 0, '실패로는 적혀야 한다')
  assert.equal(r.fail_reason, null, '사유를 안 줬는데 무언가 채웠다 — 추측이 기록이 된다')
})

test('성공 행은 사유 칸이 NULL 이다', () => {
  const id = BR.시작기록(getDB(), { type: 'TTS', content: 'y' })
  assert.equal(행(id).fail_reason, null)
})

// ── ④ 기존 DB 업그레이드 · 재실행 · 중간 실패 · 이전 앱 호환 ─────────────

function 옛DB만들기() {
  const p = path.join(os.tmpdir(), `carecast_old_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  const db = new DatabaseSync(p)
  // 0026 **이전** 모양: fail_reason 이 없다
  db.exec(`CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, time TEXT, type TEXT,
    content TEXT, user TEXT, target TEXT, success INTEGER)`)
  db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success) VALUES (?,?,?,?,?,?,?)')
    .run('2026-09-01', '11:10', '자동', '점심 방송 — 다른 방송에 밀려 중단됨', '자동', '전체', 0)
  db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success) VALUES (?,?,?,?,?,?,?)')
    .run('2026-09-01', '07:50', '자동', '아침 방송', '자동', '전체', 1)
  return { p, db }
}
const 마이그 = fs.readFileSync(
  path.join(__dirname, '..', '..', 'db', 'migrations', '0026_broadcasts_fail_reason.sql'), 'utf8')
const 되돌리기 = fs.readFileSync(
  path.join(__dirname, '..', '..', 'db', 'migrations', '0026_broadcasts_fail_reason.down.sql'), 'utf8')
const SQL만 = (s) => s.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('--')).join(String.fromCharCode(10))

test('기존 DB 업그레이드: 칸이 생기고 **기존 행은 그대로**다 — 백필 없음', () => {
  const { p, db } = 옛DB만들기()
  try {
    const 전 = db.prepare('SELECT * FROM broadcasts ORDER BY id').all()
    db.exec(SQL만(마이그))
    assert.ok(칸들(db, 'broadcasts').includes('fail_reason'), '칸이 안 생겼다')
    const 후 = db.prepare('SELECT * FROM broadcasts ORDER BY id').all()
    assert.equal(후.length, 전.length, '행 수가 변했다')
    for (let i = 0; i < 전.length; i++) {
      assert.equal(후[i].content, 전[i].content, '내용이 변했다')
      assert.equal(후[i].success, 전[i].success, 'success 가 변했다')
      assert.equal(후[i].fail_reason, null,
        '기존 행에 값을 채웠다 — 과거 사유는 추측이고, DEFAULT 를 주면 IS NULL 분류가 죽는다')
    }
  } finally { db.close(); try { fs.unlinkSync(p) } catch { /* 무시 */ } }
})

test('마이그레이션 재실행: 두 번 돌려도 데이터가 안 변한다', () => {
  const { p, db } = 옛DB만들기()
  try {
    db.exec(SQL만(마이그))
    db.prepare('UPDATE broadcasts SET fail_reason = ? WHERE id = 1').run('preempted')
    // 두 번째 실행은 "이미 있다"로 실패한다 — 그것이 정상이고, **데이터는 그대로여야 한다**
    let 두번째던짐 = false
    try { db.exec(SQL만(마이그)) } catch { 두번째던짐 = true }
    assert.equal(두번째던짐, true, '같은 칸을 두 번 더할 수 있었다 — SQLite 동작이 바뀌었다')
    assert.equal(db.prepare('SELECT fail_reason FROM broadcasts WHERE id = 1').get().fail_reason, 'preempted',
      '재실행이 값을 지웠다')
    assert.equal(db.prepare('SELECT COUNT(*) c FROM broadcasts').get().c, 2, '재실행이 행을 건드렸다')
  } finally { db.close(); try { fs.unlinkSync(p) } catch { /* 무시 */ } }
})

test('되돌리기: 칸만 사라지고 행·success 는 남는다', () => {
  const { p, db } = 옛DB만들기()
  try {
    db.exec(SQL만(마이그))
    db.prepare('UPDATE broadcasts SET fail_reason = ? WHERE id = 1').run('preempted')
    db.exec(SQL만(되돌리기))
    assert.ok(!칸들(db, 'broadcasts').includes('fail_reason'), '칸이 안 사라졌다')
    const rows = db.prepare('SELECT * FROM broadcasts ORDER BY id').all()
    assert.equal(rows.length, 2, '되돌리기가 행을 지웠다')
    assert.equal(rows[0].success, 0, 'success 가 변했다')
    assert.equal(rows[0].content, '점심 방송 — 다른 방송에 밀려 중단됨', '내용이 변했다')
  } finally { db.close(); try { fs.unlinkSync(p) } catch { /* 무시 */ } }
})

test('되돌린 DB 로도 서버가 뜬다 — initDB 가 스스로 칸을 되살린다', () => {
  const { p, db } = 옛DB만들기()
  db.close()
  const 원래 = process.env.CARECAST_DB_PATH
  try {
    process.env.CARECAST_DB_PATH = p
    delete require.cache[require.resolve('../db/schema')]
    const s2 = require('../db/schema')
    s2.initDB()
    assert.ok(칸들(s2.getDB(), 'broadcasts').includes('fail_reason'),
      'initDB 가 칸을 안 되살린다 — 되돌린 DB 로 뜨면 그 뒤 INSERT 가 전부 죽는다')
  } finally {
    process.env.CARECAST_DB_PATH = 원래
    delete require.cache[require.resolve('../db/schema')]
    require('../db/schema')
    try { fs.unlinkSync(p) } catch { /* 무시 */ }
  }
})

test('이전 앱 호환: 칸 이름을 명시한 옛 INSERT·SELECT 가 그대로 돈다', () => {
  const { p, db } = 옛DB만들기()
  try {
    db.exec(SQL만(마이그))
    // 옛 코드가 쓰던 모양 그대로 — fail_reason 을 모른다
    db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success) VALUES (?,?,?,?,?,?,?)')
      .run('2026-09-02', '09:00', '자동', '국민체조 방송', '자동', '전체', 1)
    const r = db.prepare('SELECT * FROM broadcasts WHERE date = ?').get('2026-09-02')
    assert.equal(r.success, 1, '옛 INSERT 가 깨졌다')
    assert.equal(r.fail_reason, null, '옛 INSERT 에 값이 끼어들었다')
  } finally { db.close(); try { fs.unlinkSync(p) } catch { /* 무시 */ } }
})

// ── ④ 조회·집계 경로 ───────────────────────────────────────────────────

test('오류 집계: 코드가 있으면 코드로, 옛 행은 문구로 — 둘 다 밀림을 뺀다', () => {
  const db = getDB()
  db.prepare('DELETE FROM broadcasts').run()
  const 이번달 = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` })()
  const 넣기 = (content, success, reason) =>
    db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success,fail_reason) VALUES (?,?,?,?,?,?,?,?)')
      .run(`${이번달}-05`, '11:10', '자동', content, '자동', '전체', success, reason)

  넣기(BR.밀림문구('점심 방송'), 0, BR.사유.밀림)     // 새 행 — 코드로 빠진다
  넣기(BR.밀림문구('저녁 방송'), 0, null)             // 옛 행 — 문구로 빠진다
  넣기('아침 방송', 0, BR.사유.기타)              // 진짜 실패(코드 있음)
  넣기('국민체조 방송', 0, null)                      // 진짜 실패(옛 행)

  const cnt = db.prepare(
    'SELECT COUNT(*) as cnt FROM broadcasts WHERE date LIKE ? AND success = 0'
    + ' AND (fail_reason IS NULL OR fail_reason != ?)'
    + ' AND NOT (fail_reason IS NULL AND content LIKE ?)'
  ).get(`${이번달}-%`, BR.사유.밀림, `%${BR.밀림표식}%`).cnt
  assert.equal(cnt, 2, '밀림 둘은 빠지고 진짜 실패 둘만 남아야 한다')
})

test('두 집계 경로가 같은 질의를 쓴다 — 한쪽만 고치면 또 어긋난다', () => {
  const LF = String.fromCharCode(10)
  const 본문 = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8')
    .split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  // 2026-09-10(P-97): 질의를 `domain/broadcastRecord.오류수` 로 올렸다. 이 가드가 지키려던
  // 것("한쪽만 고치면 두 숫자가 갈린다")은 그대로고, **이제 갈릴 자리 자체가 없다** —
  // 두 라우트가 같은 함수를 부르는지만 본다. 실제로 오늘 한쪽만 고쳤다가 여기서 잡혔다.
  for (const f of ['routes/status.js', 'routes/broadcasts.js']) {
    const s = 본문(f)
    assert.match(s, /오류수\(db,/, `${f} 가 단일 출처를 안 쓴다`)
    assert.doesNotMatch(s, /SELECT COUNT\(\*\) as cnt FROM broadcasts WHERE date LIKE \? AND success = 0/,
      `${f} 가 오류 집계 질의를 직접 적었다 — 두 벌이 되면 한쪽만 고치는 일이 반드시 생긴다`)
  }
  // 긍정 앵커 — 정본이 사라지면 위 부정 단언이 조용히 통과한다.
  const 정본 = 본문('domain/broadcastRecord.js')
  assert.match(정본, /function 오류수\(db, 월접두\)/, '오류 집계 정본이 사라졌다')
})
