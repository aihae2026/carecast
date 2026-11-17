// 방송이 어느 단계까지 갔나 (docs/db-retention-design.md 6번, 2026-09-03).
//
// 이력은 방송 1건에 성공/실패 **한 줄**이다. 5분짜리 아침방송이 "차임 → 인사 → 날씨 → 녹음 음원
// → BGM" 중 어느 단계에서 멎었는지는 서버 콘솔 로그에만 있었고 30일 뒤 사라졌다.
// 이것이 prep_ms(0018)가 예약에만 있던 빈 자리도 메운다 — 자동방송은 단계마다 시각이 남는다.
//
// 고정하는 사실 일곱:
//  1. 성공한 단계도 남는다 — 실패만 남기면 "어디까지 갔나"를 못 본다
//  2. 실패한 단계는 사유와 함께 남는다
//  3. 한 방송 안에서 **순서(step_no)가 1부터 이어진다**
//  4. **방송 구간 밖에서는 아무것도 안 남긴다** — 열쇠 없는 행은 나중에 못 읽는다
//  5. 기록이 실패해도 **던지지 않는다** — 기록하려다 방송이 멎으면 본말전도다
//  6. 모든 단계가 지나는 한 곳(runStepGuarded)에서 남긴다 — 갈래마다 붙이면 반드시 빠뜨린다
//  7. 보관 365일 — 방송 이력과 같이 정리된다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stephist_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const H = require('../domain/stepHistory')
const { withRun } = require('../services/runContext')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const clear = () => getDB().prepare('DELETE FROM broadcast_steps').run()
const allRows = () => getDB().prepare('SELECT * FROM broadcast_steps ORDER BY id').all()

test('사실1·3 — 성공한 단계도 남고, 순서가 1부터 이어진다', () => {
  clear()
  withRun('아침', () => {
    H.record(getDB(), { title: '아침 종합 방송', step: { label: '차임' },   result: '성공', ms: 1200 })
    H.record(getDB(), { title: '아침 종합 방송', step: { label: '인사' },   result: '성공', ms: 3400 })
    H.record(getDB(), { title: '아침 종합 방송', step: { label: '날씨' },   result: '성공', ms: 5000 })
  })
  const rows = allRows()
  assert.equal(rows.length, 3, '성공한 단계가 안 남으면 "어디까지 갔나"를 못 본다')
  assert.deepEqual(rows.map(r => r.step_no), [1, 2, 3], '순서가 이어지지 않는다')
  assert.deepEqual(rows.map(r => r.label), ['차임', '인사', '날씨'])
  assert.equal(rows[1].ms, 3400, '걸린 시간이 안 남았다 — prep_ms가 메우려던 자리다')
  assert.ok(rows.every(r => r.run_key.startsWith('아침-')), '로그 이름표와 같은 열쇠여야 한다')
})

test('사실2 — 실패한 단계는 사유와 함께 남는다', () => {
  clear()
  withRun('점심', () => {
    H.record(getDB(), { title: '점심 방송', step: { label: '녹음 음원' },
      result: '실패', ms: 800, detail: '파일을 찾을 수 없습니다' })
  })
  const r = allRows()[0]
  assert.equal(r.result, '실패')
  assert.match(r.detail, /파일을 찾을 수 없습니다/)
})

test('사실4 — 방송 구간 밖에서는 안 남긴다', () => {
  clear()
  const ok = H.record(getDB(), { title: '수동 미리듣기', step: { label: 'TTS' }, result: '성공', ms: 10 })
  assert.equal(ok, false, '열쇠 없는 행은 어느 방송의 단계인지 말할 수 없다')
  assert.equal(allRows().length, 0)
})

test('사실5 — 기록이 실패해도 던지지 않는다', () => {
  const broken = { prepare() { throw new Error('DB 없음') } }
  withRun('저녁', () => {
    assert.doesNotThrow(() => H.record(broken, { title: 'x', step: { label: 'y' }, result: '성공', ms: 1 }))
  })
})

test('사실3-b — 방송이 달라지면 번호가 1부터 다시 센다', () => {
  clear()
  withRun('체조', () => H.record(getDB(), { title: '국민체조', step: { label: '영상' }, result: '성공', ms: 5 }))
  withRun('저녁 마무리', () => H.record(getDB(), { title: '저녁 마무리', step: { label: '첫 안내' }, result: '성공', ms: 5 }))
  const rows = allRows()
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.step_no), [1, 1], '다른 방송인데 번호가 이어졌다')
  assert.notEqual(rows[0].run_key, rows[1].run_key)
})

test('사실6 — 모든 단계가 지나는 한 곳에서 남긴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  const i = src.indexOf('async function runStepGuarded')
  // 창을 넉넉히 잡는다. 1600 이던 때, P-22(AP-0043)로 반환값 실패 분기가 들어오자
  // catch 쪽 `detail: err.message` 가 창 밖으로 밀려 이 가드가 빨간불이 됐다(2026-09-09).
  // **가드의 뜻은 그대로다** — 성공·실패를 이 함수 한 곳에서 남기는지 본다. 창만 넓힌다.
  const body = src.slice(i, i + 2600)
  // 2026-09-10(P-57): 성공·실패가 **한 번의 record 호출**로 합쳐졌다. 예전엔 분기마다
  // `result: '성공'` / `result: '실패'` 리터럴이 있었는데, 이제 판정이
  // `domain/stepHistory.이력판정()` 한 곳에서 나온다. **가드의 뜻은 그대로다** —
  // 성공이든 실패든 이 함수 한 곳에서 남기는지 본다. 모양만 따라 옮긴다.
  assert.match(body, /이력판정\(outcome\)/,
    '판정을 단일 출처에서 안 가져온다 — 부르는 쪽이 사유를 다시 추측하고 있다')
  assert.match(body, /stepHistory'\)\.record\(db, \{\s*\n\s*title, step, result: 판정\.result/,
    '단계 결과를 안 남긴다')
  assert.match(body, /result: '실패'[\s\S]{0,80}detail: err\.message/,
    '던져서 끝난 단계의 실패 사유를 안 남긴다')

  // 흐름도 같은 표에 남는다 — 흐름은 단계가 더 길어질 수 있어 오히려 더 필요하다
  const flow = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  assert.match(flow, /stepHistory'\)\.record\(db, \{/, '흐름 단계가 안 남는다')
})

test('사실7 — 보관 정리가 단계 기록도 함께 지운다', () => {
  clear()
  const db = getDB()
  const R = require('../services/retention')
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  const ins = db.prepare(`INSERT INTO broadcast_steps
    (run_key, title, step_no, label, result, ms, detail, started_at) VALUES (?,?,?,?,?,?,?,?)`)
  ins.run('아침-1', '아침', 1, '차임', '성공', 100, null, old)
  ins.run('아침-2', '아침', 1, '차임', '성공', 100, null, new Date().toISOString())

  const r = R.runRetention({ db, now: new Date() })
  assert.equal(r.steps, 1, '365일 지난 단계 기록이 안 지워졌다')
  assert.equal(allRows().length, 1)
})

test('사실8 — 이력 줄과 단계가 열쇠로 이어진다(0022)', () => {
  const db = getDB()
  const cols = db.prepare('PRAGMA table_info(broadcasts)').all().map(c => c.name)
  assert.ok(cols.includes('run_key'), '이력에 열쇠가 없으면 화면이 그 방송의 단계를 못 찾는다')

  // 이력을 남기는 두 경로가 모두 열쇠를 싣는다 — 한쪽만 실으면 그 방송만 못 펼친다
  const seq = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  const sch = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  for (const [name, src] of [['자동방송', seq], ['예약', sch]]) {
    // run_key 가 **컬럼 목록 안에 있으면** 된다. 마지막 자리라고 가정하지 않는다 —
    // 2026-09-06에 지연 계측 컬럼(content_source·scheduled_at·played_at·delay_ms)을
    // 뒤에 더했더니 이 단언이 깨졌다. 지키려는 것은 "열쇠를 싣는가"이지 순서가 아니다.
    assert.match(src, /INSERT INTO broadcasts \([^)]*\brun_key\b/,
      `${name} 이력이 열쇠를 안 싣는다`)
    assert.match(src, /runContext'\)\.currentRunId\(\)/,
      `${name}이 로그 이름표와 다른 값을 넣고 있다`)
  }
})

test('사실9 — 화면이 열쇠 있는 줄만 펼친다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'BroadcastLog.jsx'), 'utf8')
  assert.match(src, /log\.runKey && \(/, '경보·수동 기록에도 펼치기가 보이면 눌러도 빈 목록만 나온다')
  assert.match(src, /getBroadcastSteps\(runKey\)/, '단계를 안 받아 온다')
})

// ── 결과를 **모르는** 차임이 "울렸다" 로 읽히면 안 된다 (Codex 소급 검수 RB-01, 2026-09-11) ──
//
// `flowRunner` 는 차임 결과를 3초까지만 기다리고, 그 안에 콜백이 없으면 **모른다**로 둔다.
// 그것이 의도다 — 콜백을 안 부르는 재생기가 흐름을 영영 멈추게 하면 안 되고,
// *"모르는 것은 실패가 아니다"*(`flowRunner.js` 의 차임 단계 주석).
//
// **그런데 그 모름이 이력에 `성공` 으로 적히고, 연속 실패 카운터가 그것을 "실제로 울렸다"로
// 읽어 연속을 끊었다.** 그러면 차임 장치가 계속 죽어 있어도 승격이 영영 안 온다 —
// P-49 ②가 고쳤다고 적어 둔 바로 그 실패다:
//   *"모르는 회차는 건너뛴다 — 세지도 않고 끊지도 않는다. 끊는 것은 **실제로 울린 회차**뿐이다."*
// 의도는 문서에 있었는데 판정이 그것을 안 지켰다.
test('모름은 "울렸다" 가 아니다 — 연속 실패를 끊지 않는다', () => {
  const { 이력판정, 단계사유, 사유문구, 차임정상인가, 차임고장인가 } = require('../domain/stepHistory')

  assert.equal(typeof 단계사유.모름, 'string',
    '모름을 나르는 사유 값이 없다 — 부르는 쪽이 undefined 로 넘기면 성공으로 둔갑한다')

  const 판정 = 이력판정(단계사유.모름)
  assert.ok(판정, '모름을 이력에서 통째로 빼면 "어디까지 갔나" 를 못 본다')
  // **실패로 적지 않는다** — 그 결정은 그대로다(모름 ≠ 실패).
  assert.equal(판정.result, '성공', '모름을 실패로 적었다 — 멀쩡한 방송이 실패로 찍힌다')
  assert.equal(판정.detail, 사유문구.결과모름, '무엇을 모르는지 줄에 안 남는다')

  // **그러나 연속을 끊지는 않는다.** 여기가 이 검사의 핵심이다.
  assert.equal(차임정상인가({ result: '성공', detail: 사유문구.결과모름 }), false,
    '결과를 모르는 회차가 연속 실패를 끊는다 — 차임이 죽어 있어도 경보가 영영 안 온다')
  assert.equal(차임고장인가({ result: '성공', detail: 사유문구.결과모름 }), false,
    '모름을 고장으로 셌다 — 없는 장치 고장을 신고한다')

  // 반대편: 진짜로 울린 줄은 그대로 연속을 끊어야 한다.
  assert.equal(차임정상인가({ result: '성공', detail: null }), true,
    '실제로 울린 회차가 연속을 못 끊는다 — 고친 뒤에도 경보가 계속 뜬다')
})

test('흐름 차임이 모름을 그대로 흘려보내지 않는다 — 사유 값으로 나른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const m = /if \(step\.step_type === 'chime'\)([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(m, '흐름 차임 단계를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /played === null/,
    '결과를 못 받은 경우를 따로 보지 않는다 — 그냥 돌아가면 부르는 쪽이 성공으로 적는다')
  assert.match(m[1], /단계사유\.모름|CHIME_UNKNOWN/,
    '모름을 사유 값으로 안 나른다 — undefined 는 성공과 구별되지 않는다')
})

// ── 하드웨어가 꺼져 있으면 **울린 적이 없다** (Codex 소급 검수 RB-01-R2, 2026-09-11) ──
//
// `chimePlayer` 는 `hardwareDisabled()` 면 프로세스를 안 띄우고 `onDone(true)` 를 부른다.
// 그 `true` 의 뜻은 *"재생 실패가 아니다"* 이고 그건 맞다(그 파일 주석). **그런데 부르는 쪽이
// 그것을 "울렸다" 로 읽어 연속 실패를 끊었다** — 현장 PC 에 `CARECAST_NO_HARDWARE=1` 이
// 남는 사고(2026-09)가 나면 차임이 안 울리는데 **경보도 안 온다.** 둘이 겹치면 아무도 모른다.
test('하드웨어가 꺼진 회차는 연속 실패를 끊지 않는다', () => {
  const { 이력판정, 단계사유, 사유문구, 차임정상인가, 차임고장인가 } = require('../domain/stepHistory')

  assert.equal(typeof 단계사유.안울림, 'string',
    '의도적 미재생을 나르는 사유 값이 없다 — 실제 재생 성공과 구별되지 않는다')

  const 판정 = 이력판정(단계사유.안울림)
  assert.equal(판정.result, '성공', '안 울린 것을 실패로 적었다 — 드라이런마다 실패가 쌓인다')
  assert.equal(판정.detail, 사유문구.안울림, '무엇 때문에 안 울렸는지 줄에 안 남는다')
  assert.equal(차임정상인가({ result: '성공', detail: 사유문구.안울림 }), false,
    '안 울린 회차가 연속 실패를 끊는다 — 차임이 죽어 있어도 경보가 영영 안 온다')
  assert.equal(차임고장인가({ result: '성공', detail: 사유문구.안울림 }), false,
    '안 울린 것을 고장으로 셌다 — 없는 장치 고장을 신고한다')
})

test('흐름 차임이 하드웨어 꺼짐을 성공과 구별해 나른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const m = /if \(step\.step_type === 'chime'\)([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(m, '흐름 차임 단계를 못 찾았다')
  assert.match(m[1], /hardwareDisabled|단계사유\.안울림/,
    '하드웨어 꺼짐을 안 본다 — onDone(true) 가 실제 재생 성공과 같게 읽힌다')
})
