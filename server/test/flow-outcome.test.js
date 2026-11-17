// 흐름 방송이 "나갔다"고 적히는 시점이 진실인가. (전수검수 CC-003)
//
// 무엇이 문제였나: 흐름 방송(연속 방송)은 `at_time` 대기 때문에 수십 분 걸릴 수 있다.
// 그래서 scheduler는 runFlow를 **발사만 하고 기다리지 않는다** — 기다리면 같은 분에 걸린
// 다른 예약과 SwitchBot·BGM 점검이 통째로 밀린다(음원 180초 고정 대기 시절 12분씩 밀렸던
// 그 사고). 이 판단 자체는 옳고 여기서 바꾸지 않는다.
//
// 문제는 **결과를 적는 시점도 같이 앞당겨진 것**이다. 시작하자마자 이력 행을 남기고
// last_fired를 찍고 1회성 예약을 비활성화한다. 그 뒤 흐름이 3단계에서 죽어도
//   · 이력에는 "나갔다"로 남고
//   · last_fired 때문에 그날 다시 발동하지 않으며
//   · 실패는 console.error 한 줄뿐이라 화면·이력 어디에도 안 남는다
// 어르신이 말해 주기 전엔 아무도 모른다. 이번 검수의 "실패 관측 불가"가 남아 있던 자리다.
//
// 고치는 방향: **중복 발사를 막는 기록(last_fired·1회성 비활성화)은 즉시 그대로 두고,
// 성공 여부만 나중에 정정한다.** 그래서 이력 행의 success에 값 하나를 더 쓴다.
//   0 = 실패    1 = 성공    2 = 진행 중(아직 나갔다는 증거 없음)
// 컬럼을 새로 만들지 않은 이유: DDL 없이 되고, 집계 SQL이 전부 `= 1`/`= 0` 명시라
// 2가 성공에도 오류에도 안 섞인다(착수 전 전수조사로 확인).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowoutcome_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 소리를 내지 않는다 (scheduler를 require하기 전에 심는다) ──
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true,
  exports: { playChime: () => {}, resolveChimeVolume: () => 0.8 },
}
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS: async () => '/tmp/fake.mp3', generateTTSWithRetry: async () => '/tmp/fake.mp3',
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {}, rateToStr: () => '+0%', pitchToStr: () => '+0Hz', getPythonPath: () => null,
  },
}
const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true,
  exports: { storeAudio: () => 'fake-audio-id', consumeAudio: () => null },
}

// ── 흐름 실행기는 이 파일이 결과를 조종해야 하므로 스텁한다 ──
// scheduler가 흐름 분기 안에서 지연 require하므로 캐시 선점이 통한다.
let flowResult = { kind: 'completed' }
const flowRunnerPath = require.resolve('../services/flowRunner')
require.cache[flowRunnerPath] = {
  id: flowRunnerPath, filename: flowRunnerPath, loaded: true, exports: {
    runFlow: (() => {
      const fn = async () => {
        if (flowResult.kind === 'throw') throw new Error(flowResult.message || '단계 실패')
        return flowResult.kind        // 'completed' | 'cancelled' | 'skipped'
      }
      // 'pending'은 영영 안 끝나게 둔다 — "아직 진행 중"인 순간을 관찰해야 하는 테스트가 있다
      return (...args) => (flowResult.kind === 'pending' ? new Promise(() => {}) : fn(...args))
    })(),
  },
}

const { initDB, getDB } = require('../db/schema')
const outcome = require('../domain/broadcastOutcome')
const { settleFlowLog, recoverInterrupted } = require('../services/flowOutcome')
const { fireSchedule } = require('../services/scheduler')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function makeFlowSchedule({ oneTime = false } = {}) {
  const db = getDB()
  const now = new Date().toISOString()
  const flowId = db.prepare(
    'INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)'
  ).run(`흐름${++seq}`, now, now).lastInsertRowid
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type, flow_sequence_id)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', ?, 'flow', ?)
  `).run(`흐름예약${seq}`, oneTime ? '[]' : '[0,1,2,3,4,5,6]', flowId).lastInsertRowid
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

// 정산이 실패 사유를 내용 뒤에 붙이므로 앞부분으로 찾는다
const logOf = (title) =>
  getDB().prepare("SELECT * FROM broadcasts WHERE content LIKE ? ORDER BY id DESC LIMIT 1").get(title + '%')

// 흐름은 발사 후 비동기로 정산된다 — 그 microtask가 돌 틈을 준다
const settled = () => new Promise(r => setTimeout(r, 30))

// ── 값의 뜻 ────────────────────────────────────────────────────

test('진행 중은 성공도 실패도 아닌 세 번째 값이다', () => {
  assert.equal(outcome.FAILED, 0)
  assert.equal(outcome.SUCCEEDED, 1)
  assert.equal(outcome.RUNNING, 2)
  assert.notEqual(outcome.RUNNING, outcome.SUCCEEDED)
  assert.notEqual(outcome.RUNNING, outcome.FAILED)
})

// 화면도 같은 값을 봐야 한다. `src/lib/broadcastStatus.js`가 그 값을 **사본으로** 들고 있는데
// (프론트엔드 테스트 러너가 없어서 순수 함수로 떼어낸 것이다), 2026-09-05까지 **그 사본이
// 서버와 갈렸는지 보는 곳이 없었다.** 그 파일 머리말은 "flow-outcome.test.js가 대조한다"고
// 적고 있었지만 실제로는 서버 상수만 봤다 — 주석이 없는 가드를 있다고 말하고 있었다.
//
// 갈리면 방송 이력 화면이 **거짓 상태**를 보여준다. 서버가 2(진행 중)로 적은 방송을 화면이
// 성공으로 읽는 식이다. 이 화면이 있는 이유가 "안 나간 방송을 알아채는 것"이라 그건 치명적이다.
test('화면이 든 상태 값 사본이 서버와 같다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'broadcastStatus.js'), 'utf8')
  const 값 = (name) => {
    const m = new RegExp('export const ' + name + '\\s*=\\s*(\\d+)').exec(src)
    assert.ok(m, `화면에서 ${name}을 못 찾았다 — 사본이 사라졌으면 이 검사도 뜻을 잃는다`)
    return Number(m[1])
  }
  assert.equal(값('SUCCEEDED'), outcome.SUCCEEDED, '성공 값이 서버와 다르다')
  assert.equal(값('RUNNING'),   outcome.RUNNING,   '진행 중 값이 서버와 다르다')

  // **모르는 값을 성공으로 봐주지 않는다.** 애매할 때 성공 쪽으로 기울면 이 화면의 존재
  // 이유가 사라진다(그 파일 머리말이 못 박아 둔 규칙이다).
  assert.match(src, /return 'fail'/, '모르는 값이 실패로 안 떨어진다')
})

// ── 시작 시점 ──────────────────────────────────────────────────

test('흐름을 시작하면 이력 행은 "진행 중"으로 남는다 — 아직 나갔다는 증거가 없다', async () => {
  flowResult = { kind: 'pending' }   // 아무것도 안 끝나게
  const s = makeFlowSchedule()
  await fireSchedule(s, getDB())

  const row = logOf(s.title)
  assert.ok(row, '이력 행 자체는 즉시 남아야 한다 — 없으면 "없었던 것"과 구별이 안 된다')
  assert.equal(row.success, outcome.RUNNING,
    '시작만 했는데 성공으로 적으면 흐름이 죽어도 이력은 정상으로 보인다')
})

test('중복 발사를 막는 기록은 지금처럼 즉시 찍힌다 — 이건 절대 미루면 안 된다', async () => {
  flowResult = { kind: 'pending' }
  const s = makeFlowSchedule({ oneTime: true })
  await fireSchedule(s, getDB())

  const after = getDB().prepare('SELECT last_fired, active FROM schedules WHERE id = ?').get(s.id)
  assert.ok(after.last_fired, 'last_fired가 안 찍히면 다음 분에 같은 방송이 또 나간다')
  assert.equal(after.active, 0, '1회성 예약은 즉시 비활성화돼야 한다')
})

// ── 끝난 뒤 정산 ───────────────────────────────────────────────

test('흐름이 끝까지 가면 성공으로 정정된다', async () => {
  flowResult = { kind: 'completed' }
  const s = makeFlowSchedule()
  await fireSchedule(s, getDB())
  await settled()

  assert.equal(logOf(s.title).success, outcome.SUCCEEDED)
})

test('흐름이 예외로 죽으면 실패로 정정되고 경보가 남는다', async () => {
  const raised = []
  const alertPath = require.resolve('../services/alert')
  const real = require.cache[alertPath]
  require.cache[alertPath] = {
    id: alertPath, filename: alertPath, loaded: true,
    exports: { raise: (kind, message) => raised.push({ kind, message }), MAX_MESSAGE: 300 },
  }
  try {
    flowResult = { kind: 'throw', message: '음원 파일 없음' }
    const s = makeFlowSchedule()
    await fireSchedule(s, getDB())
    await settled()

    assert.equal(logOf(s.title).success, outcome.FAILED)
    assert.equal(raised.length, 1, 'console.error 한 줄로 끝나면 아무도 모른다')
    assert.match(raised[0].message, /음원 파일 없음/, '무엇 때문에 죽었는지 문장에 있어야 한다')
  } finally {
    if (real) require.cache[alertPath] = real; else delete require.cache[alertPath]
  }
})

test('사람이 정지를 누른 것은 실패로 적되 경보는 안 띄운다', async () => {
  const raised = []
  const alertPath = require.resolve('../services/alert')
  const real = require.cache[alertPath]
  require.cache[alertPath] = {
    id: alertPath, filename: alertPath, loaded: true,
    exports: { raise: (kind, message) => raised.push({ kind, message }), MAX_MESSAGE: 300 },
  }
  try {
    flowResult = { kind: 'cancelled' }
    const s = makeFlowSchedule()
    await fireSchedule(s, getDB())
    await settled()

    const row = logOf(s.title)
    assert.equal(row.success, outcome.FAILED, '끝까지 안 나간 건 사실이므로 성공은 아니다')
    assert.equal(raised.length, 0, '사람이 직접 누른 정지를 경보로 띄우면 잔소리가 된다')
  } finally {
    if (real) require.cache[alertPath] = real; else delete require.cache[alertPath]
  }
})

// ── 서버가 죽었을 때 ───────────────────────────────────────────

test('기동 시 남아 있던 "진행 중" 행은 실패로 정리된다 — 영원히 진행 중일 수는 없다', () => {
  const db = getDB()
  const id = db.prepare(
    "INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES ('2026-08-30','07:50','예약','아침 흐름','자동','전체',?)"
  ).run(outcome.RUNNING).lastInsertRowid

  const n = recoverInterrupted(db)
  assert.ok(n >= 1, '정리한 건수를 돌려줘야 부팅 로그에 남길 수 있다')

  const row = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)
  assert.equal(row.success, outcome.FAILED)
  assert.match(row.content, /중단/, '왜 실패인지 이력만 보고 알 수 있어야 한다')
})

test('정리는 진행 중 행만 건드린다 — 성공·실패 기록을 덮으면 안 된다', () => {
  const db = getDB()
  const ok = db.prepare(
    "INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES ('2026-08-30','08:00','예약','멀쩡한 기록','자동','전체',1)"
  ).run().lastInsertRowid
  recoverInterrupted(db)
  assert.equal(db.prepare('SELECT success FROM broadcasts WHERE id = ?').get(ok).success, 1)
})

// ── 집계에 새지 않는다 ─────────────────────────────────────────

test('진행 중 행은 성공 집계에도 오류 집계에도 안 잡힌다', () => {
  const db = getDB()
  const before = {
    ok:   db.prepare("SELECT COUNT(*) c FROM broadcasts WHERE success = 1").get().c,
    fail: db.prepare("SELECT COUNT(*) c FROM broadcasts WHERE success = 0").get().c,
  }
  db.prepare(
    "INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES ('2026-08-30','09:00','예약','집계테스트','자동','전체',?)"
  ).run(outcome.RUNNING)

  assert.equal(db.prepare("SELECT COUNT(*) c FROM broadcasts WHERE success = 1").get().c, before.ok,
    '아직 안 끝난 방송이 성공 통계를 부풀리면 안 된다')
  assert.equal(db.prepare("SELECT COUNT(*) c FROM broadcasts WHERE success = 0").get().c, before.fail,
    '아직 안 끝난 방송을 오류로 세면 대시보드가 거짓 경보가 된다')
})

// ── 정산 함수 자체 ─────────────────────────────────────────────

test('settleFlowLog는 없는 행 id를 받아도 던지지 않는다 — 정산이 서버를 멈추면 안 된다', () => {
  assert.doesNotThrow(() => settleFlowLog(getDB(), 999999, 'completed'))
  assert.doesNotThrow(() => settleFlowLog(getDB(), null, 'completed'))
})

// ── 화면과 서버가 같은 뜻으로 읽는가 ───────────────────────────

test('화면 매퍼가 서버 값과 어긋나지 않는다', async () => {
  const ui = await import(
    'file://' + path.join(__dirname, '..', '..', 'src', 'lib', 'broadcastStatus.js').replace(/\\/g, '/')
  )
  assert.equal(ui.statusOf(outcome.SUCCEEDED), 'success')
  assert.equal(ui.statusOf(outcome.FAILED),    'fail')
  assert.equal(ui.statusOf(outcome.RUNNING),   'running')
  assert.equal(ui.statusOf(undefined), 'fail', '모르는 값은 성공으로 봐주지 않는다')
})

// ── 흐름이 왜 끝까지 못 갔는지 가려서 적는다 (P-34, 2026-09-11) ──────────────
//
// `runFlow` 는 사유를 **셋으로 갈라** 돌려준다 — `cancelled`(사람이 정지) ·
// `preempted`(다른 방송이 밀어냄) · `skipped`(조건이 안 맞아 안 나감).
// 그런데 이력 문구는 **한 줄**이었다: `"끝까지 진행되지 않음(정지 또는 중복 실행)"`.
// 현장에서 "왜 안 나갔냐" 고 물을 때 그 줄로는 답을 못 한다 — 사람이 끈 것과 시스템이
// 밀어낸 것은 **다음에 할 일이 다르다.**
//
// 문구는 `domain/broadcastOutcome` 한 곳에 둔다. scheduler 에 베껴 적으면 흐름·예약·
// 자동방송이 같은 사건을 다르게 말하게 된다(FP-0005 가 이 저장소에서 반복된 모양이다).
test('P-34 — 끝까지 못 간 사유를 셋으로 가른다', () => {
  const { 흐름사유문구 } = require('../domain/broadcastOutcome')
  assert.equal(typeof 흐름사유문구, 'function',
    '사유 문구의 단일 출처가 없다 — 부르는 쪽마다 적으면 같은 사건을 다르게 말한다')

  const 정지 = 흐름사유문구('cancelled')
  const 밀림 = 흐름사유문구('preempted')
  const 건너뜀 = 흐름사유문구('skipped')
  for (const [이름, 값] of [['cancelled', 정지], ['preempted', 밀림], ['skipped', 건너뜀]]) {
    assert.ok(값 && 값.length > 0, `${이름} 의 사유 문구가 비었다`)
  }
  assert.notEqual(정지, 밀림, '사람이 정지한 것과 다른 방송이 밀어낸 것이 같은 문구다 — 다음에 할 일이 다르다')
  assert.notEqual(정지, 건너뜀, '정지와 건너뜀이 같은 문구다')
  assert.notEqual(밀림, 건너뜀, '밀림과 건너뜀이 같은 문구다')

  // 끝까지 간 것들은 그대로다(회귀 방지)
  assert.equal(흐름사유문구('completed'), '', '정상 완료에 사유가 붙었다')
  assert.match(흐름사유문구('completed_no_player'), /창/, '창 없음 문구가 바뀌었다')
  assert.match(흐름사유문구('completed_with_failures'), /차임/, '차임 연속 실패 문구가 바뀌었다')

  // 모르는 값도 조용히 빈 문구가 되면 안 된다 — 빈 문구는 "정상 완료" 로 읽힌다
  assert.ok(흐름사유문구('무슨값인지모름').length > 0, '모르는 결과가 빈 문구가 됐다 — 정상 완료로 읽힌다')
})

test('P-34 — scheduler 가 그 단일 출처를 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  assert.match(src, /흐름사유문구\(/, 'scheduler 가 사유 문구를 따로 적고 있다')
  assert.doesNotMatch(src, /끝까지 진행되지 않음\(정지 또는 중복 실행\)/,
    '뭉개진 옛 문구가 아직 남아 있다')
})
