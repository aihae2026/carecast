// 차임 연속 실패를 **회차**로 센다 (P-49, 2026-09-10 수정).
//
// 이 파일은 `test/repro/P-49-chime-streak-shared-label.test.js` 를 대신한다. 그 파일은
// RED 로 커밋돼 있었고(`npm test` 의 glob 밖이라 verify 를 안 깼다), 고쳐졌으므로 여기로
// 올려 **회귀 가드**가 된다.
//
// ── 무엇이 틀려 있었나 ────────────────────────────────────────────────────
// "차임이 연속 3회 실패하면 흐름 이력을 실패로 올린다"(사용자 결정 2026-09-07)에서
// **3회의 단위가 회차였는데 코드는 이력 줄을 셌다.**
//
//  ① 한 흐름에 라벨 없는 차임이 셋이면 이력에 `'chime'` 한 칸으로 셋이 남는다
//     (`routes/flows.js:59` 가 무라벨을 빈 문자열로 저장, `FlowBuilder.jsx:68` 의 기본값이
//     무라벨 — **무라벨이 기본 조작 경로다**). 그래서 **한 회차가 통째로 실패하면 그 자리에서
//     '연속 3회'** 가 됐다. 연속이 아니다.
//  ② 사람이 흐름을 정지하면 차임을 시도조차 안 하는데, 그 회차가 '성공'으로 적혀
//     연속을 끊었다 — 차임 장치가 계속 죽어 있어도 승격이 영영 안 온다.
//
// ── 이 검사가 기대값을 어디서 가져오나 ────────────────────────────────────
// **승격 기준 3은 여기 손으로 적는다.** `CHIME_FAIL_PROMOTE` 를 읽어 오면 그 상수를 1로
// 바꾸는 변이가 기대값까지 데려가 통과한다. 상수는 "제품과 검사가 같은 것을 보는가"를
// 확인하는 데만 쓴다(맨 아래 한 건).
// 세는 함수는 **진짜 것을 부른다** — 질의를 옮겨 적었더니 원본이 바뀐 뒤에도 재현이
// 옛 코드를 흉내 내고 있었다.
'use strict'

const path = require('path')
const os = require('os')

process.env.CARECAST_DB_PATH = path.join(
  os.tmpdir(), `carecast_p49_${process.pid}_${Date.now()}.db`)

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { getDB, initDB } = require('../db/schema')
const stepHistory = require('../domain/stepHistory')
const { chimeFailStreak, CHIME_FAIL_PROMOTE } = require('../services/flowRunner')

initDB()

const 흐름 = '흐름#7'
const 승격기준 = 3   // 손으로 적는다. 구현에서 가져오지 않는다.

/** 단계 이력 한 줄. runKey 를 직접 주므로 방송 구간 밖에서도 남는다. */
function 기록(db, { 회차, 결과, 사유 = null, 라벨 = 'chime' }) {
  const 남았나 = stepHistory.record(db, {
    title: 흐름, step: { label: 라벨 }, result: 결과, ms: 10, detail: 사유, runKey: 회차,
  })
  assert.equal(남았나, true, '이력이 안 남았다 — 이 검사의 앵커가 무너졌다')
}

const 차임고장 = (db, 회차, 라벨) =>
  기록(db, { 회차, 결과: '실패', 사유: stepHistory.사유문구.차임고장, 라벨 })
const 차임울림 = (db, 회차, 라벨) => 기록(db, { 회차, 결과: '성공', 라벨 })
const 정지 = (db, 회차, 라벨) =>
  기록(db, { 회차, 결과: '실패', 사유: stepHistory.사유문구.정지, 라벨 })

function 비운다() {
  const db = getDB()
  db.prepare('DELETE FROM broadcast_steps').run()
  return db
}

test('한 회차에 무라벨 차임 셋이 다 실패해도 1회차다 — 그 자리에서 승격되면 안 된다', () => {
  const db = 비운다()
  // FlowBuilder 기본값대로 셋 다 라벨이 없다 → 이력에는 전부 'chime'
  차임고장(db, 'run-A'); 차임고장(db, 'run-A'); 차임고장(db, 'run-A')

  // 넷째 차임이 방금 또 실패했다(아직 기록 전). 같은 회차이므로 여전히 1이어야 한다.
  const streak = chimeFailStreak(db, 흐름, 'chime', 'run-A')
  assert.equal(streak, 1,
    `한 회차 실패가 ${streak}회로 읽혔다 — 무라벨 차임 여럿이 한 칸을 공유해 즉시 승격된다(P-49 ①)`)
  assert.ok(streak < 승격기준, '한 회차만으로 흐름 이력이 실패로 올라간다')
})

test('회차가 셋 연달아 고장 나면 승격된다 — 고쳐서 안 잡히면 안 된다', () => {
  const db = 비운다()
  차임고장(db, 'run-1')
  차임고장(db, 'run-2')
  // 이번 회차(run-3)가 방금 실패했다. 아직 기록 전이라 열쇠로 넘긴다.
  const streak = chimeFailStreak(db, 흐름, 'chime', 'run-3')
  assert.equal(streak, 3, `연속 3회차인데 ${streak}로 읽혔다 — 진짜 고장을 놓친다`)
  assert.ok(streak >= 승격기준)
})

test('실제로 울린 회차가 끼면 끊긴다 — 고장이 아닌 것을 고장으로 세지 않는다', () => {
  const db = 비운다()
  차임고장(db, 'run-1')
  차임울림(db, 'run-2')      // 이 회차에는 차임이 나갔다
  차임고장(db, 'run-3')
  const streak = chimeFailStreak(db, 흐름, 'chime', 'run-4')
  assert.equal(streak, 2, `${streak}로 읽혔다 — 중간에 울린 회차가 연속을 안 끊었다`)
})

test('사람이 정지한 회차는 세지도 끊지도 않는다 — 정지 한 번이 진짜 고장을 지우면 안 된다', () => {
  const db = 비운다()
  차임고장(db, 'run-1')
  차임고장(db, 'run-2')
  정지(db, 'run-3')          // 차임을 시도조차 안 했다
  const streak = chimeFailStreak(db, 흐름, 'chime', 'run-4')
  assert.equal(streak, 3,
    `${streak}로 읽혔다 — 정지가 연속을 끊어, 차임 장치가 계속 죽어 있어도 승격이 영영 안 온다(P-49 ②)`)
})

test('라벨이 다른 차임은 따로 센다 — 서로의 실패를 합산하지 않는다', () => {
  const db = 비운다()
  차임고장(db, 'run-1', '시작차임')
  차임고장(db, 'run-2', '시작차임')
  차임고장(db, 'run-1', '마침차임')
  assert.equal(chimeFailStreak(db, 흐름, '마침차임', 'run-2'), 2,
    '마침차임의 연속이 시작차임 것까지 세었거나 못 세었다')
})

test('다른 흐름의 이력을 끌어오지 않는다', () => {
  const db = 비운다()
  차임고장(db, 'run-1'); 차임고장(db, 'run-2')
  assert.equal(chimeFailStreak(db, '흐름#99', 'chime', 'run-3'), 1,
    '다른 흐름(#7)의 실패를 #99 가 세었다')
})

test('세다가 잘못돼도 방송을 막지 않는다 — 0을 돌려준다', () => {
  const 망가진DB = { prepare() { throw new Error('일부러 낸 오류') } }
  assert.equal(chimeFailStreak(망가진DB, 흐름, 'chime', 'run-1'), 0)
})

test('제품과 검사가 같은 승격 기준을 본다', () => {
  // 위 기대값들은 3을 손으로 적었다. 제품이 그 값을 바꾸면 여기서 드러난다 —
  // 기대값이 조용히 따라 움직이지 않고, 사람이 결정을 다시 보게 된다.
  assert.equal(CHIME_FAIL_PROMOTE, 승격기준,
    `제품의 승격 기준이 ${CHIME_FAIL_PROMOTE}로 바뀌었다 — 사용자 결정(2026-09-07)이 바뀐 것인지 확인할 것`)
})

test('실패 사유 문구를 흐름이 베껴 적지 않는다 — 정본은 domain/stepHistory.js 하나다', () => {
  const fs = require('fs')
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const 본문 = src.split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(String.fromCharCode(10))
  // 흐름은 이력을 쓰는 쪽이라 문구가 나오는 것이 정상이다. 다만 **세는 쪽**이 그 문구를
  // 다시 적으면 한쪽만 고치는 날 판정이 어긋난다.
  assert.match(본문, /차임고장인가/, '세는 쪽이 단일 출처 판정을 안 쓴다')
  assert.match(본문, /차임정상인가/, '끊는 판정도 단일 출처여야 한다')
})
