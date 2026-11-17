'use strict'

// 실행 순서와 부작용 경계를 확인한다. 운영 DB·스피커·외부 API는 쓰지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dbPath = path.join(os.tmpdir(), `carecast_test_resume_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = dbPath
process.env.CARECAST_NO_HARDWARE = '1'

function stub(name, exports) {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let tokens = 0
let cancellations = 0
const events = []
const fired = []
stub('../services/sse', { broadcastSSE: (type, data) => events.push({ type, data }) })
stub('../services/broadcastSteps', {})
stub('../services/morning', {
  getMorningData: async () => { throw new Error('외부 자료를 조회하면 안 된다') },
  buildSegmentText: () => '', DEFAULT_SEGMENTS: [], buildMorningText: async () => '',
})
stub('../services/tts', {})
stub('../services/broadcastGate', {
  newBroadcastToken: () => { tokens++; return Symbol('test') },
  isCancelled: () => false, cancelGeneration: () => 0,
  cancelCurrentBroadcast: () => { cancellations++ },
  stopCurrentBroadcast: () => {}, wasHumanStopSince: () => false,
  broadcastStart: () => events.push({ type: 'start' }),
  broadcastComplete: () => events.push({ type: 'complete' }),
  tokenDelay: async () => {},
})
stub('../services/sitePlayer', {
  hasSitePlayer: () => true, 무창사건수: () => 0, 담당바뀜수: () => 0, 소리낼수있나: () => true,
})
stub('../services/runContext', { currentRunId: () => 'resume-test' })
// 진짜 takeTiming의 값 없는 계약도 null이다. undefined는 SQLite 바인딩을 실패시킨다.
stub('../services/laneTiming', {
  laneStarted: () => {},
  takeTiming: () => ({ scheduledAt: null, playedAt: null, delayMs: null }),
})
stub('../services/alert', { raise: () => { throw new Error('예상하지 않은 경보') } })
stub('../domain/stepHistory', { 이력판정: () => ({ result: '성공' }), record: () => {} })

const { initDB, getDB } = require('../db/schema')
const { writeSetting, rawSetting } = require('../domain/settingsRead')
const seq = require('../services/broadcastSequencer')
const paths = [
  ['/trigger', 'morning', 'fireMorningBroadcast'],
  ['/trigger/exercise', 'exercise', 'fireExerciseBroadcast'],
  ['/trigger/lunch', 'lunch', 'fireLunchBroadcast'],
  ['/trigger/dinner', 'dinner', 'fireDinnerBroadcast'],
  ['/trigger/evening-prayer', 'evening_prayer', 'fireEveningPrayerBroadcast'],
]
// 라우트의 배선은 진짜로 실행하되 소리 실행 경계만 대역으로 바꾼다.
stub('../services/broadcastSequencer', {
  ...seq,
  ...Object.fromEntries(paths.map(([, tab, name]) => [name, async (_db, opts) => fired.push({ tab, opts })])),
})
const router = require('../routes/morning')
const steps = [
  { id: 'resume_a', label: '더미 시작', enabled: true, order: 0 },
  { id: 'resume_off', label: '더미 꺼짐', enabled: false, order: 1 },
  { id: 'resume_b', label: '더미 이어서', enabled: true, order: 2 },
  { id: 'resume_c', label: '더미 마지막', enabled: true, order: 3 },
]
let db
test.before(() => { initDB(); db = getDB() })
test.after(() => {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})
test.beforeEach(() => { tokens = 0; cancellations = 0; events.length = 0; fired.length = 0 })

function handler(method, routePath) {
  const layer = router.stack.find(x => x.route?.path === routePath && x.route.methods[method])
  assert.ok(layer, `${method} ${routePath} 라우트 필요`)
  return layer.route.stack[0].handle
}
async function request(method, routePath, body = {}, params = {}) {
  let result
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(value) { result = { status: this.statusCode, body: value }; return this },
  }
  await handler(method, routePath)({ body, params, query: {} }, res)
  assert.ok(result, '응답이 있어야 한다')
  return result
}

test('시작 위치 기본값은 0이고 명시한 활성 단계만 선택된다', () => {
  assert.equal(seq.validateStartIndex(steps, {}), 0)
  assert.equal(seq.validateStartIndex(steps, { manual: true, startIndex: 2 }), 2)
  assert.equal(seq.validateStartIndex([], {}), 0, '기존 빈 구성 호출은 보존한다')
})

test('범위·유형·꺼진 단계·자동 중간 실행을 거절한다', () => {
  for (const startIndex of [-1, 1, 4, 1.5, '2', null, [], {}, NaN, Infinity]) {
    assert.throws(() => seq.validateStartIndex(steps, { manual: true, startIndex }),
      error => error.status === 400, String(startIndex))
  }
  assert.throws(() => seq.validateStartIndex(steps, { startIndex: 2 }), error => error.status === 400)
})

test('실행기는 기본 전체 실행과 선택 이후 실행을 구분하며 수동 마커를 보존한다', async () => {
  writeSetting(db, 'resume_test_steps', JSON.stringify(steps))
  writeSetting(db, 'resume_test_last_fired', 'unchanged')
  const lane = { tab: 'resume_test', title: '더미 방송', runLog: '더미', logContent: '더미', lastFiredKey: 'resume_test_last_fired' }
  const visited = []
  await seq.__test__.runBroadcastLane(db, lane, { manual: true }, async step => { visited.push(step.id) })
  assert.deepEqual(visited, ['resume_a', 'resume_b', 'resume_c'])
  visited.length = 0
  await seq.__test__.runBroadcastLane(db, lane, { manual: true, startIndex: 2 }, async step => { visited.push(step.id) })
  assert.deepEqual(visited, ['resume_b', 'resume_c'])
  assert.equal(rawSetting(db, 'resume_test_last_fired'), 'unchanged')
  assert.equal(tokens, 2)
})

// 2026-09-26(C1~C3·I1 독립 검수): 위 시험의 가짜 탭 `resume_test` 는 AUTO_BROADCASTS 에 없어서
// 시작 표시(`*_last_started`)는 수동이든 아니든 원래 안 찍힌다 — 그 쪽 단언은 대상이 없었다(TEST_GAP).
// 여기서는 **실제 자동방송 탭**으로 중간부터 수동 재생해 시작·완료 표시가 그대로인지 본다.
test('실제 자동방송 탭을 중간부터 수동 재생해도 시작·완료 표시를 건드리지 않는다', async () => {
  const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
  const spec = AUTO_BROADCASTS.find(x => x.id === 'exercise')
  assert.ok(spec && spec.startedKey, '감시 대상 표에 체조가 있어야 한다(대상 앵커)')
  const real = seq.getSteps(db, 'exercise')
  const enabled = real.map((s, i) => (s.enabled ? i : -1)).filter(i => i >= 0)
  assert.ok(enabled.length >= 2, '중간 시작을 하려면 켜진 단계가 둘 이상이어야 한다')
  writeSetting(db, spec.startedKey, 'unchanged-start')
  writeSetting(db, 'exercise_last_fired', 'unchanged-fired')
  const lane = { tab: 'exercise', title: '체조', runLog: '체조', logContent: '체조 방송', lastFiredKey: 'exercise_last_fired' }
  await seq.__test__.runBroadcastLane(db, lane, { manual: true, startIndex: enabled[1] }, async () => {})
  assert.equal(rawSetting(db, spec.startedKey), 'unchanged-start')
  assert.equal(rawSetting(db, 'exercise_last_fired'), 'unchanged-fired')
})

// 2026-09-26(같은 검수 Medium): 「여기부터 재생」으로 중간부터 틀었는데 이력에는 전체 방송 문구가 남았다.
// 이력은 「홀에서 무엇이 나갔나」를 답하는 기록이라(P-32), 앞 단계가 안 나갔다는 흔적이 있어야 한다.
test('중간부터 수동 재생하면 이력 문구에 시작 단계가 붙고, 처음부터면 그대로다', async () => {
  writeSetting(db, 'resume_test_steps', JSON.stringify(steps))
  const lane = { tab: 'resume_test', title: '더미 방송', runLog: '더미', logContent: '더미 방송 문구', lastFiredKey: 'resume_test_last_fired' }
  const last = () => db.prepare('SELECT content FROM broadcasts ORDER BY id DESC LIMIT 1').get().content
  await seq.__test__.runBroadcastLane(db, lane, { manual: true, startIndex: 2 }, async () => {})
  assert.equal(last(), '더미 방송 문구 (2단계 「더미 이어서」부터)')
  await seq.__test__.runBroadcastLane(db, lane, { manual: true }, async () => {})
  assert.equal(last(), '더미 방송 문구')
})

test('실행기의 잘못된 시작 위치는 토큰 발급·시작 알림보다 먼저 거절된다', async () => {
  writeSetting(db, 'resume_test_steps', JSON.stringify(steps))
  await assert.rejects(seq.__test__.runBroadcastLane(db, { tab: 'resume_test' },
    { manual: true, startIndex: 99 }, async () => { assert.fail('단계 실행 금지') }),
    error => error.status === 400)
  assert.equal(tokens, 0)
  assert.equal(cancellations, 0)
  assert.deepEqual(events, [])
})

for (const [routePath, tab] of paths) {
  test(`${tab}: 목록이 바뀌어 단계 ID가 다르면 방송을 취소하지 않는다`, async () => {
    const startIndex = seq.getSteps(db, tab).findIndex(step => step.enabled)
    const response = await request('post', routePath, { startIndex, startStepId: 'stale_dummy_step' })
    assert.equal(response.status, 400)
    assert.equal(cancellations, 0)
    assert.deepEqual(fired, [])
  })
  test(`${tab}: 유효하지 않은 요청은 현재 방송을 취소하지 않는다`, async () => {
    const source = seq.getSteps(db, tab)
    for (const startIndex of [-1, source.length, 0.5, '0', null, [], {}]) {
      const response = await request('post', routePath, { startIndex })
      assert.equal(response.status, 400, JSON.stringify(startIndex))
    }
    assert.equal(cancellations, 0)
    assert.deepEqual(fired, [])
  })
  test(`${tab}: 선택한 위치를 수동 실행으로 전달한다`, async () => {
    const startIndex = seq.getSteps(db, tab).findIndex(step => step.enabled)
    assert.ok(startIndex >= 0)
    const response = await request('post', routePath, { startIndex })
    assert.equal(response.status, 200)
    assert.equal(cancellations, 1)
    assert.equal(fired.length, 1)
    assert.equal(fired[0].tab, tab)
    assert.equal(fired[0].opts.manual, true)
    assert.equal(fired[0].opts.startIndex, startIndex)
  })
  test(`${tab}: 단계 조회는 실행기의 순서·활성 상태를 그대로 보여 준다`, async () => {
    const response = await request('get', '/steps/:tab', {}, { tab })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.steps, seq.getSteps(db, tab).map((step, index) => ({
      // `customType` — 사람이 추가한 단계의 종류(2026-09-17 N19, 간편 화면이 편집기와 같은 색으로 그린다).
      id: step.id, label: step.label, enabled: step.enabled, index, customType: step.customType || null,
    })))
    assert.equal(cancellations, 0)
    assert.deepEqual(fired, [])
  })
}
