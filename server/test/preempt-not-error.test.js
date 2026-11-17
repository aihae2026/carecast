// P-31 — 밀림이 대시보드 "오류" 숫자를 올린다 (2026-09-10).
//
// 밀림(다른 방송이 앞 소리를 밀어냄)은 이력에 `success = 0` 으로 남는다 —
// ISSUE-010 의 사용자 결정(2026-09-07)이 "이력에는 남기고 배너는 안 띄운다"였다.
// 그런데 오류 카드가 그것까지 세서 **수동재생으로 정시 방송을 앞당길 때마다 1씩 올랐다.**
// 배너는 조용한데 숫자만 오르니 "화면은 조용하다"가 절반만 참이었다.
// [FACT] 원문 지적 — 어느 테스트도 이것을 안 봤다.
//
// 밀림은 실패가 아니라 **의도된 교체**다. 오류에서 뺀다. 이력에서는 안 뺀다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_pne_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { 밀림표식, 밀림문구 } = require('../domain/broadcastRecord')

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

const 이번달 = (() => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
})()

function 넣기(content, success) {
  getDB().prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?,?,?,?,?,?,?)')
    .run(`${이번달}-05`, '11:10', '자동', content, '자동', '전체', success)
}

// 라우트를 태우지 않고 **같은 질의**를 잰다 — 라우트는 express·미들웨어가 필요하다.
// 질의문이 갈리면 아래 소스 대조가 잡는다.
// 라우트와 **같은 질의**를 잰다(0026 이후 코드 우선). 질의문이 갈리면 아래 소스 대조가 잡는다.
const 오류수 = () => getDB().prepare(
  'SELECT COUNT(*) as cnt FROM broadcasts WHERE date LIKE ? AND success = 0'
  + ' AND (fail_reason IS NULL OR fail_reason != ?)'
  + ' AND NOT (fail_reason IS NULL AND content LIKE ?)'
).get(`${이번달}-%`, require('../domain/broadcastRecord').사유.밀림, `%${밀림표식}%`).cnt

test('P-31: 밀림은 오류로 안 센다', () => {
  getDB().prepare('DELETE FROM broadcasts').run()
  넣기(밀림문구('점심 방송'), 0)
  assert.equal(오류수(), 0, '밀림을 오류로 셌다 — 수동재생 한 번에 오류 카드가 1씩 오른다')
})

test('P-31: 진짜 실패는 그대로 센다 — 대조군', () => {
  getDB().prepare('DELETE FROM broadcasts').run()
  넣기('점심 방송', 0)
  넣기('아침 방송', 0)
  assert.equal(오류수(), 2, '진짜 실패까지 빼면 오류 카드가 영영 0이 된다')
})

test('P-31: 섞여 있어도 밀림만 빠진다', () => {
  getDB().prepare('DELETE FROM broadcasts').run()
  넣기(밀림문구('점심 방송'), 0)
  넣기('저녁 방송', 0)
  넣기('아침 방송', 1)
  assert.equal(오류수(), 1)
})

test('P-31: 이력 자체에서는 안 뺀다 — 사용자 결정(2026-09-07)이 "이력에는 남긴다"였다', () => {
  getDB().prepare('DELETE FROM broadcasts').run()
  넣기(밀림문구('점심 방송'), 0)
  const 전체 = getDB().prepare('SELECT COUNT(*) as cnt FROM broadcasts').get().cnt
  assert.equal(전체, 1, '밀림 행을 이력에서 지웠다 — 그러면 또 조용히 사라진다')
})

// ── 네 자리가 같은 문구를 보는가 ────────────────────────────────────────
const LF = String.fromCharCode(10)
const 소스 = (p) => fs.readFileSync(path.join(__dirname, '..', ...p.split('/')), 'utf8')
  .split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)

test('P-31: 밀림 문구를 베껴 적은 곳이 없다 — 단일 출처를 읽는다', () => {
  // 2026-09-10(P-97): 두 라우트는 이제 밀림을 **직접 안 본다** — 오류 집계 질의가
  // `domain/broadcastRecord.오류수` 로 올라갔고 밀림 제외도 거기서 한다.
  // 그래서 "단일 출처를 읽는가"는 정본을 읽는 서비스들에 대해서만 묻고,
  // "문구를 베끼지 않았는가"는 네 자리 모두에 그대로 묻는다.
  for (const f of ['services/broadcastSequencer.js', 'services/watchdog.js']) {
    assert.match(소스(f), /밀림(표식|문구)/, `${f} 가 단일 출처를 안 쓴다`)
  }
  for (const f of ['services/broadcastSequencer.js', 'services/watchdog.js',
    'routes/status.js', 'routes/broadcasts.js']) {
    assert.doesNotMatch(소스(f), /다른 방송에 밀려 중단됨/,
      `${f} 가 문구를 베껴 적었다 — 한 곳만 고치는 날 조용히 어긋난다`)
  }
})

test('P-31: 두 오류 집계가 같은 규칙을 쓴다', () => {
  // 2026-09-10(P-97): 질의가 `오류수` 한 곳으로 올라갔다. **뜻은 그대로다** —
  // 두 집계가 같은 규칙을 쓰는지 본다. 이제 "같은 함수를 부르는가"로 묻는다.
  for (const f of ['routes/status.js', 'routes/broadcasts.js']) {
    assert.match(소스(f), /오류수\(db,/, `${f} 의 오류 집계가 단일 출처를 안 쓴다`)
  }
  const 정본 = 소스('domain/broadcastRecord.js')
  assert.match(정본, /고장아닌사유/, '오류에서 뺄 사유 목록이 사라졌다')
  assert.match(정본, /fail_reason NOT IN/, '오류 집계가 사유를 안 뺀다')
})

// ── P-32 — 수동재생(미리듣기)의 밀림도 남긴다. **일부러 그렇다** ───────
// 물음이었지 결함이 아니었다: "성공 경로도 manual 을 안 가리므로 기존 관례와는
// 일관되지만, 의도인지 확인된 적이 없다." 이제 확인해 적는다.
//   · 남기는 이유 — 미리듣기도 스피커로 **진짜 나간 소리**다. 빼면 홀에서 들린 것이
//     기록에 없는 상태가 된다(이 저장소가 가장 비싸게 데인 유형).
//   · 아프던 것은 따로였다 — 밀린 미리듣기가 오류 숫자를 올리던 것(P-31). 그쪽을 고쳤다.
// 바꾸려면 `logPreempted` 한 줄이지만 "홀에서 들린 소리를 기록에서 지운다"는 뜻이라
// 사람이 정할 일이다. 그래서 **지금 동작을 못 박아** 다음 사람이 모르고 바꾸지 않게 한다.

test('P-32: 밀림 기록은 수동재생을 안 가린다 — 성공 경로와 같은 규칙이다', () => {
  const s = 소스('services/broadcastSequencer.js')
  const i = s.indexOf('const logPreempted')
  assert.ok(i >= 0, 'logPreempted 가 사라졌다 — 앵커가 무너졌다')
  const 본문 = s.slice(i, s.indexOf('\n  }', i))
  assert.doesNotMatch(본문, /opts\.manual/,
    '밀림 기록이 수동재생을 가린다 — 홀에서 들린 소리가 기록에서 사라진다. '
    + '바꾸는 것이 의도라면 이 검사와 그 위 주석을 같이 고칠 것(P-32)')
  // 대조군: 시작 표시(markStarted)는 **가린다** — 그건 "정상 진행 중" 표식이라 뜻이 다르다.
  const j = s.indexOf('const markStarted')
  assert.match(s.slice(j, s.indexOf('\n  }', j)), /if \(opts\.manual\) return/,
    '시작 표시가 수동재생을 안 가린다 — 감시가 미리듣기를 정시 방송으로 오해한다')
})
