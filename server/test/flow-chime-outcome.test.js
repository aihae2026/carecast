// ISSUE-009 — 흐름(flow) 안의 차임 단계도 재생 결과를 본다
//
// 왜 필요한가(2026-09-06 검수, EV-000504): 예약 유형 'chime' 은 playChime 에 콜백을 넘겨 이력을
// SUCCEEDED/FAILED 로 정정하는데(ISSUE-002), **같은 차임이 흐름의 한 단계로 울릴 때는** 콜백이
// 없었다(flowRunner.js 의 chime 분기). 결과를 받을 창구가 없으니 차임이 안 울려도 그 흐름 이력은
// 성공으로 남았다.
//
// 고친 규약:
//   · 흐름의 차임 단계는 콜백으로 결과를 받는다. 다만 **콜백을 기다리지는 않는다** — 기존 3초 창
//     (차임 길이) 안에 온 결과만 본다. 실패(spawn 오류)는 수 ms, 정상 완료는 1~2초 안에 오므로 실제
//     경우는 다 잡히고, 콜백을 안 부르는 옛 스텁(여러 테스트)이 흐름을 영영 멈추게 하지 않는다.
//   · 실패해도 흐름은 **계속 간다** — 뒤에 오는 안내 방송이 차임보다 중요하다. 대신 그 단계는
//     단계 이력(broadcast_steps)에 실패로 적히고, 흐름 이력 행은 실패 + 사유로 정산된다.
//
// 이 파일은 tests/audit/p-07-flow-chime-result-ignored.test.cjs(결함 재현, "콜백이 없다"가 통과
// 조건)의 기대값을 뒤집어 옮긴 것이다. 실제 스피커는 울리지 않는다 — 차임·SSE 는 스텁, DB 는 임시 파일.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowchime_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 차임 스텁: 모드에 따라 콜백을 곧바로 부르거나(ok/fail) 아예 안 부른다(silent) ──
let chimeMode = 'ok'
const chimeCalls = []
const CHIME_PATH = require.resolve('../services/chimePlayer')
require.cache[CHIME_PATH] = {
  id: CHIME_PATH, filename: CHIME_PATH, loaded: true,
  exports: {
    playChime: (type, volumePct, onDone) => {
      chimeCalls.push({ type, volumePct, hasCallback: typeof onDone === 'function' })
      if (chimeMode === 'fail' && typeof onDone === 'function') onDone(false)
      if (chimeMode === 'ok'   && typeof onDone === 'function') onDone(true)
      // 'silent' — 콜백을 안 부른다(옛 스텁들과 같은 형태)
    },
    resolveChimeVolume: () => 0.8,
    normalizeChimeType: (t) => t || 'general',
    CHIME_TYPES: ['general'],
  },
}
const SSE_PATH = require.resolve('../services/sse')
require.cache[SSE_PATH] = {
  id: SSE_PATH, filename: SSE_PATH, loaded: true,
  exports: { broadcastSSE: () => 1, addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1 },
}

const { initDB, getDB } = require('../db/schema')
const flowRunner = require('../services/flowRunner')
const { fireSchedule } = require('../services/scheduler')
const { FAILED, SUCCEEDED } = require('../domain/broadcastOutcome')

test.before(() => { initDB() })
test.after(() => {
  delete require.cache[CHIME_PATH]
  delete require.cache[SSE_PATH]
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

let seq = 0
function makeFlowSchedule(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const flowId = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`차임흐름${++seq}`, now, now).lastInsertRowid
  const ins = db.prepare('INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, ?, ?, ?, ?)')
  steps.forEach((s, i) => ins.run(flowId, i, s.step_type, s.label || '', JSON.stringify(s.config || {})))
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type, flow_sequence_id)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', '[0,1,2,3,4,5,6]', 'flow', ?)
  `).run(`차임흐름예약${seq}`, flowId).lastInsertRowid
  return { schedule: db.prepare('SELECT * FROM schedules WHERE id = ?').get(id), flowId }
}

const logOf = (title) =>
  getDB().prepare('SELECT * FROM broadcasts WHERE content LIKE ? ORDER BY id DESC LIMIT 1').get(title + '%')
const stepRowsOf = (flowId) =>
  getDB().prepare('SELECT * FROM broadcast_steps WHERE title = ? ORDER BY id').all(`흐름#${flowId}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 차임 단계는 3초 창을 채우고 끝난다 — 흐름 정산까지 그보다 조금 더 기다린다
const CHIME_STEP_MS = 3000
const SETTLE_MS = CHIME_STEP_MS + 700

test('ISSUE-009: 흐름의 차임 단계는 playChime 에 콜백을 넘긴다', async () => {
  chimeMode = 'ok'; chimeCalls.length = 0
  await flowRunner.runStep(getDB(), { step_type: 'chime', config: '{}', step_order: 0 }, { isCancelled: () => false })
  assert.equal(chimeCalls.length, 1, '차임이 한 번 불려야 한다')
  assert.equal(chimeCalls[0].hasCallback, true, '흐름이 차임에 결과 콜백을 넘기지 않는다 — ISSUE-009')
})

test('ISSUE-009: 차임 실패는 단계 결과로 드러나고, 흐름을 던지지 않는다', async () => {
  chimeMode = 'fail'; chimeCalls.length = 0
  const r = await flowRunner.runStep(getDB(), { step_type: 'chime', config: '{}', step_order: 0 }, { isCancelled: () => false })
  assert.ok(r !== undefined && r !== flowRunner.CANCELLED,
    `차임이 실패했는데 단계 결과가 성공(undefined)이다: ${String(r)}`)
})

test('ISSUE-009: 콜백을 안 부르는 차임이어도 흐름은 3초 창 뒤에 넘어간다(매달리지 않는다)', async () => {
  chimeMode = 'silent'; chimeCalls.length = 0
  const t0 = Date.now()
  const r = await Promise.race([
    flowRunner.runStep(getDB(), { step_type: 'chime', config: '{}', step_order: 0 }, { isCancelled: () => false }),
    sleep(CHIME_STEP_MS + 1500).then(() => 'STILL_HANGING'),
  ])
  assert.notEqual(r, 'STILL_HANGING', '콜백이 없는 차임에서 흐름이 매달린다 — 옛 스텁·비정상 재생기에서 흐름이 멈춘다')
  // **의도는 "모름 ≠ 실패" 이고 그것은 그대로다.** 다만 처음엔 그 의도를 `r === undefined`
  // 라는 **표현**으로 고정했는데, `undefined` 는 정상 성공과 **구별되지 않는다** —
  // 부르는 쪽(`flowRunner` 의 이력 기록)이 둘을 같게 보고 **성공으로 적었고**, 연속 실패
  // 카운터가 그것을 "실제로 울렸다" 로 읽어 연속을 끊었다(Codex 소급 검수 RB-01,
  // [FACT] EV-004290). 기대를 구현에 맞춘 것이 아니라, **그 단언이 결함을 가능하게 하는
  // 표현을 고정하고 있었다.** 이제 의도를 직접 검사한다.
  const { 단계사유, 이력판정 } = require('../domain/stepHistory')
  assert.notEqual(이력판정(r)?.result, '실패', '결과를 모르는 것은 실패가 아니다(하드웨어 비활성과 같은 대우)')
  assert.equal(r, 단계사유.모름, '모름이 성공과 구별되지 않는 값으로 돌아온다 — 부르는 쪽이 성공으로 적는다')
  assert.ok(Date.now() - t0 >= CHIME_STEP_MS - 50, '차임 길이(3초) 창은 그대로 지켜야 한다')
})

test('ISSUE-009: 차임 1회 실패는 단계 이력에만 남고 흐름 이력은 성공이다(보조 신호)', async () => {
  chimeMode = 'fail'; chimeCalls.length = 0
  const { schedule, flowId } = makeFlowSchedule([{ step_type: 'chime', label: '시작 차임' }, { step_type: 'delay', config: { wait_sec: 0 } }])
  await fireSchedule(schedule, getDB())
  await sleep(SETTLE_MS)

  const row = logOf(schedule.title)
  assert.ok(row, '흐름 이력 행이 없다')
  assert.equal(row.success, SUCCEEDED,
    `차임 1회 실패로 흐름 이력이 실패가 됐다(success=${row.success}) — 차임은 보조 신호다(사용자 결정 2026-09-07)`)
  assert.doesNotMatch(String(row.content), /차임벨/, `1회 실패인데 흐름 이력에 사유가 붙었다: ${row.content}`)

  const steps = stepRowsOf(flowId)
  const chimeStep = steps.find((s) => s.label === '시작 차임')
  assert.ok(chimeStep, `단계 이력에 차임 단계가 없다: ${JSON.stringify(steps)}`)
  assert.equal(chimeStep.result, '실패', '단계 이력이 차임 실패를 실패로 적지 않았다 — 여기까지 감추면 아무도 못 본다')
  assert.match(String(chimeStep.detail), /차임벨/, '단계 이력의 사유에 차임벨이 없다')
  // 흐름은 계속 갔다 — 뒤 단계(delay)도 기록됐다
  assert.ok(steps.length >= 2, `차임 실패 뒤 단계가 진행되지 않았다: ${steps.length}단계`)
})

test('ISSUE-009: 같은 흐름의 차임이 연속 3회 실패하면 그때 흐름 이력을 실패로 올린다', async () => {
  chimeMode = 'fail'; chimeCalls.length = 0
  const { schedule } = makeFlowSchedule([{ step_type: 'chime', label: '시작 차임' }])

  // 1·2회차 — 흐름 이력은 성공이어야 한다
  for (const 회차 of [1, 2]) {
    await fireSchedule(schedule, getDB())
    await sleep(SETTLE_MS)
    assert.equal(logOf(schedule.title).success, SUCCEEDED, `${회차}회차에서 벌써 흐름 이력이 실패다 — 승격이 너무 이르다`)
  }

  // 3회차 — 여기서 올라간다
  await fireSchedule(schedule, getDB())
  await sleep(SETTLE_MS)
  const row = logOf(schedule.title)
  assert.equal(row.success, FAILED, `연속 3회 실패인데 흐름 이력이 실패가 아니다(success=${row.success})`)
  assert.match(String(row.content), /연속 3회/, `승격 사유가 이력에 없다: ${row.content}`)
})

test('ISSUE-009: 사이에 성공이 끼면 연속 카운트가 리셋된다', async () => {
  const { schedule } = makeFlowSchedule([{ step_type: 'chime', label: '시작 차임' }])

  chimeMode = 'fail'
  for (const 회차 of [1, 2]) {
    await fireSchedule(schedule, getDB()); await sleep(SETTLE_MS)
    assert.equal(logOf(schedule.title).success, SUCCEEDED, `${회차}회차에서 벌써 흐름 이력이 실패다`)
  }

  chimeMode = 'ok'                                   // 3회차는 성공 — 여기서 끊긴다
  await fireSchedule(schedule, getDB()); await sleep(SETTLE_MS)
  assert.equal(logOf(schedule.title).success, SUCCEEDED, '성공 회차인데 흐름 이력이 실패다')

  chimeMode = 'fail'                                 // 4회차는 실패지만 연속 1회째다
  await fireSchedule(schedule, getDB()); await sleep(SETTLE_MS)
  const row = logOf(schedule.title)
  assert.equal(row.success, SUCCEEDED,
    `성공이 끼었는데도 승격됐다(success=${row.success}) — 연속 카운트가 리셋되지 않는다`)
})

test('ISSUE-009: 차임이 성공하면 흐름 이력은 성공이다(대조군)', async () => {
  chimeMode = 'ok'; chimeCalls.length = 0
  const { schedule } = makeFlowSchedule([{ step_type: 'chime', label: '시작 차임' }])
  await fireSchedule(schedule, getDB())
  await sleep(SETTLE_MS)
  const row = logOf(schedule.title)
  assert.ok(row, '흐름 이력 행이 없다')
  assert.equal(row.success, SUCCEEDED, `차임이 성공했는데 흐름 이력이 성공이 아니다(success=${row.success})`)
})

test('ISSUE-009: 소스 대조 — flowRunner 의 playChime 호출에 결과 콜백이 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const lines = src.split('\n').filter((l) => l.includes('playChime('))
  assert.equal(lines.length, 1, `playChime 호출이 하나여야 한다. 실제: ${lines.length}`)
  // `[^)]*` 로 쓰면 콜백 인자 `(ok)` 의 닫는 괄호에서 멈춰 콜백이 있어도 못 본다 — 줄 전체를 본다
  assert.match(lines[0], /playChime\(.*(=>|function)/, `flowRunner 의 playChime 호출에 콜백이 없다: ${lines[0].trim()}`)
})
