// P-61 · P-62 — 이력이 재생 결과를 안 보던 두 자리 (2026-09-10).
//
// 한 뿌리다: **"소리를 냈다고 주장하고 결과를 안 본다."**
//   P-61 즉시 방송(routes/tts.js) — 재생 **전에** `success=1` 을 박고, 거절되면 로그만 남겼다.
//   P-62 마이크(routes/mic.js) — 이력 행 **자체가 없었다.**
// 둘 다 무음인데 기록은 멀쩡한 상태를 만든다. 이 저장소에서 가장 비싼 실패다.
//
// **처음엔 소스에 글자가 있는지만 봤다가 변이 둘을 놓쳤다**([FACT] EV-003143 —
// 그 줄을 안 밟게 만드는 변이가 통과했다). 그래서 규칙을 `domain/broadcastRecord.js` 로
// 빼고 **진짜 DB 로** 잰다. 소스 대조는 "두 라우트가 그 단일 출처를 쓰는가"에만 남긴다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bhist_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { 시작기록, 실패로정정 } = require('../domain/broadcastRecord')

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

const 행 = (id) => getDB().prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)

test('시작기록: 행을 남기고 낙관적으로 성공을 적는다 — 프로세스가 죽어도 시도는 남는다', () => {
  const id = 시작기록(getDB(), { type: 'TTS', content: '점심 안내입니다', user: '수동', target: '전체' })
  assert.ok(id, '이력 id 를 안 돌려줬다 — 나중에 어느 줄을 고칠지 모른다')
  const r = 행(id)
  assert.equal(r.type, 'TTS')
  assert.equal(r.content, '점심 안내입니다')
  assert.equal(r.success, 1, '시도 시점에는 성공으로 둔다 — 결과는 재생이 끝나야 안다')
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `날짜 형식이 다르다: ${r.date}`)
  // **초까지 적는다**(2026-09-13, 커밋 33d3a26 "이력에 초 표시"). 같은 분에 여러 방송이
  // 나가면 목록에서 순서를 못 가렸다 — 사람이 "이게 먼저인가"를 물어야 했다.
  //
  // 이 줄은 그때 **안 따라 고쳐져 빨간불이 나 있었다.** 여기 적어 두는 이유가 그것이다:
  // `nowHHMM` 을 쓰던 자리에 `nowHHMMSS` 를 넣었으면 그 형식을 보는 시험도 같은 커밋에서
  // 옮겨야 한다(CLAUDE.md "파일을 가를 때 — 가드는 따라 옮긴다").
  //
  // ⚠ **발동 조건은 여전히 분 단위다.** 스케줄러는 `nowHHMM` 으로 문자열을 정확히 비교하고
  // (`time <= nowHHMM`), 초가 붙은 것은 **이력에 적는 값뿐**이다. 둘을 한 함수로 합치면
  // 방송이 나가는 조건이 조용히 달라진다 — `repeatSchedule.js` 가 둘을 갈라 둔 이유다.
  assert.match(r.time, /^\d{2}:\d{2}:\d{2}$/, `시각 형식이 다르다: ${r.time}`)
})

test('실패로정정: 재생이 거절되면 그 줄이 실패가 된다', () => {
  const id = 시작기록(getDB(), { type: '마이크', content: '마이크 방송(녹음)' })
  assert.equal(행(id).success, 1, '표본 준비 실패')
  assert.equal(실패로정정(getDB(), id, '하드웨어 접근 없음 모드'), true)
  assert.equal(행(id).success, 0,
    '재생이 거절됐는데 이력은 성공으로 남는다 — 무음인데 기록만 멀쩡한 상태다')
})

test('실패로정정: id 가 없으면 아무것도 안 한다 — 이력을 못 남긴 경우다', () => {
  assert.equal(실패로정정(getDB(), null), false)
  assert.equal(실패로정정(getDB(), undefined), false)
})

test('시작기록: DB 가 막혀도 던지지 않는다 — 이력 때문에 방송을 막지 않는다', () => {
  const 망가진 = { prepare: () => { throw new Error('DB 가 잠겼습니다') } }
  assert.equal(시작기록(망가진, { type: 'TTS', content: 'x' }), null,
    '이력 실패가 예외로 새어 나가면 방송 자체가 죽는다')
  assert.equal(실패로정정(망가진, 1), false)
})

test('시작기록: 기본값은 수동·전체다 — 부르는 쪽이 매번 안 적어도 된다', () => {
  const id = 시작기록(getDB(), { type: '마이크', content: '마이크 방송(녹음)' })
  const r = 행(id)
  assert.equal(r.user, '수동')
  assert.equal(r.target, '전체')
})

// ── 두 라우트가 **같은 단일 출처**를 쓰는가 ─────────────────────────────
// 오늘 고친 결함 중 여럿이 "두 경로 중 한쪽만 고쳐서 생긴 것"이었다(P-43·P-54·P-83·P-84·P-86).

const LF = String.fromCharCode(10)
const 본문 = (f) => fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8')
  .split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)

test('P-61 · P-62: 두 라우트가 broadcastRecord 를 쓴다 — 각자 INSERT 하지 않는다', () => {
  for (const f of ['tts.js', 'mic.js']) {
    const s = 본문(f)
    assert.match(s, /enqueue\(/, `${f} 가 enqueue 를 안 부른다 — 앵커가 무너졌다`)
    assert.match(s, /broadcastRecord/, `${f} 가 단일 출처를 안 쓴다`)
    // **대입 모양을 정확히 본다.** 그냥 `시작기록(` 만 찾으면 `null && 시작기록(...)` 같은
    // 무력화 변이가 통과한다([FACT] EV-003150 — 실제로 살아남았다).
    assert.match(s, /const 이력id = 시작기록\(/, `${f} 가 이력을 안 남긴다(또는 그 호출이 무력화됐다)`)
    assert.match(s, /실패로정정\(/, `${f} 가 재생 실패를 이력에 안 되돌린다`)
    assert.doesNotMatch(s, /INSERT INTO broadcasts/,
      `${f} 가 직접 INSERT 한다 — 두 벌이 되면 한쪽만 고치는 일이 반드시 생긴다`)
  }
})

test('P-62: 마이크 이력에 음성 내용·파일 이름을 적지 않는다 — 어르신 이야기가 섞일 수 있다', () => {
  const s = 본문('mic.js')
  assert.match(s, /'마이크 방송\(녹음\)'/, '고정 문구가 아니다')
  assert.doesNotMatch(s, /시작기록\([\s\S]{0,200}originalname/,
    '업로드 파일 이름을 이력에 넣는다 — 개인정보가 섞일 수 있다')
})

// ── P-8 — 수동 차임 세 곳이 실패를 남긴다 (2026-09-10) ──────────────────
// 예전엔 이력 행이 **아예 없어서** 차임이 안 울려도 어디에도 안 남았다.
// **성공은 안 남긴다** — 즉시 방송의 차임은 그 방송 행이 이미 덮는다.
// 아무도 못 보는 것은 실패 쪽이다. 예약 차임은 ISSUE-002 수정으로 이미 남긴다.

test('실패기록: 행이 없는 실패도 남는다 — 시작도 못 한 방송·차임', () => {
  const { 실패기록 } = require('../domain/broadcastRecord')
  const id = 실패기록(getDB(), { type: '차임벨', content: '즉시 방송 시작 차임벨 재생 실패' })
  assert.ok(id, '실패 기록조차 못 남기면 그 방송은 이력에서 통째로 사라진다')
  const r = 행(id)
  assert.equal(r.success, 0, '실패로 안 적혔다')
  assert.equal(r.type, '차임벨')
})

test('P-8: 수동 차임 세 곳이 결과 콜백을 받는다 — 예전엔 인자 하나만 넘겼다', () => {
  const 자리 = [
    ['tts.js', /playChime\('general', null, \(ok\) =>/, '즉시 방송 시작 차임'],
    ['tts.js', /playChime\('end', null, \(ok\) =>/, '즉시 방송 종료 차임'],
    ['mic.js', /playChime\(type, null, \(ok\) =>/, '수동 차임 라우트'],
  ]
  for (const [f, re, 이름] of 자리) {
    assert.match(본문(f), re, `${이름}(${f})이 결과를 안 받는다 — 안 울려도 아무도 모른다`)
  }
})

test('P-8: 차임 실패만 남기고 성공은 안 남긴다 — 이력이 차임으로 덮이면 안 된다', () => {
  for (const f of ['tts.js', 'mic.js']) {
    const s = 본문(f)
    assert.match(s, /if \(!ok\) 실패기록\(/, `${f} 가 실패 조건 없이 기록한다`)
  }
})
