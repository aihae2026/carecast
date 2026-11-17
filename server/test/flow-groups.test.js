// 흐름 단계 묶음(step_type: 'group') — 목록을 폴더처럼 나눠 보기 위한 "머리글" 단계.
//
// 설계 판단: 묶음을 새 테이블이나 컬럼으로 만들지 않고 **단계 하나**로 뒀다.
//  - 스키마가 안 바뀐다(flow_sequence_steps 그대로).
//  - 실행기는 "그냥 넘어간다" 한 줄만 늘어난다.
//  - 드래그 재정렬·저장(전체 교체) 로직을 그대로 쓴다.
//  - 묶음이 없는 기존 흐름은 손대지 않아도 똑같이 돈다.
//  - 덤으로 예약 시각(config.at_time)을 머리글에 걸면 "이 묶음은 17:00에 시작"이 그대로 성립한다.
//    앵커 처리는 step_type을 보지 않기 때문이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_group_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: { ...realChime, playChime: () => {} },
}

const { initDB, getDB } = require('../db/schema')
const { runStep, runFlow } = require('../services/flowRunner')
const { validateSteps } = require('../routes/flows')

function hhmm(baseMs, plusMin = 0) {
  const d = new Date(baseMs + plusMin * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fastClock(startMs, speed = 60) {
  const realStart = Date.now()
  return () => startMs + (Date.now() - realStart) * speed
}

let flowSeq = 0
function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`묶음테스트${++flowSeq}`, now, now).lastInsertRowid
  const insert = db.prepare(`
    INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config)
    VALUES (?, ?, ?, ?, ?)
  `)
  steps.forEach((s, i) => insert.run(id, i, s.step_type, s.label || '', JSON.stringify(s.config || {})))
  return id
}

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('묶음 머리글은 실행할 게 없다 — 아무 소리도 내지 않고 즉시 넘어간다', async () => {
  const before = sent.length
  const started = Date.now()
  await runStep(getDB(), { step_type: 'group', label: '동요', config: { collapsed: true, color: 'rose' } })
  assert.equal(sent.length, before, '머리글이 방송 이벤트를 쏘면 안 된다')
  assert.ok(Date.now() - started < 500, '머리글에서 시간을 쓰면 안 된다')
})

test('묶음이 섞여 있어도 나머지 단계는 순서대로 그대로 실행된다', async () => {
  const flowId = makeFlow([
    { step_type: 'group', label: '동요 전 안내', config: {} },
    { step_type: 'chime', label: '차임', config: {} },
    { step_type: 'group', label: '식사 전 체조', config: {} },
    { step_type: 'chime', label: '차임2', config: {} },
  ])
  const before = sent.filter(e => e.type === 'chime_play').length
  await runFlow(getDB(), flowId)
  assert.equal(sent.filter(e => e.type === 'chime_play').length - before, 2,
    '머리글이 뒤 단계를 삼키면 안 된다')
})

test('묶음 머리글에 예약 시각을 걸면 그 묶음 전체가 그 시각에 시작한다', async () => {
  const base = new Date(2026, 7, 28, 16, 0, 0).getTime()
  const flowId = makeFlow([
    { step_type: 'delay', label: '늘어지는 앞 단계', config: { wait_sec: 3600 } },
    { step_type: 'group', label: '저녁식사 안내', config: { at_time: hhmm(base, 2) } },
    { step_type: 'chime', label: '안내 차임', config: {} },
  ])

  const before = sent.filter(e => e.type === 'chime_play').length
  const started = Date.now()
  await runFlow(getDB(), flowId, { nowMs: fastClock(base) })

  assert.equal(sent.filter(e => e.type === 'chime_play').length - before, 1,
    '묶음 머리글의 예약 시각이 앞 단계를 끊지 못했다')
  assert.ok(Date.now() - started < 20000)
})

test('묶음 머리글도 저장할 수 있는 단계 유형이다', () => {
  assert.equal(validateSteps([
    { step_type: 'group', label: '동요', config: {} },
    { step_type: 'chime', label: '차임', config: {} },
  ]), null)
})

test('묶음만 있는 흐름은 서버도 거절한다 — 방송 시각에 아무 일도 안 일어나는 흐름이라서', () => {
  // 화면(FlowBuilder)은 이미 막지만, API로 직접 저장하는 경로(다른 화면·스크립트)까지
  // 같은 규칙이어야 한다. 소리 없는 흐름은 가장 알아채기 어려운 실패다.
  const err = validateSteps([{ step_type: 'group', label: '동요', config: {} }])
  assert.match(err || '', /방송할 단계/)
})

test('저장했다 다시 불러도 묶음 이름·색·접힘·예약 시각이 그대로다', () => {
  const { replaceSteps, loadFlowWithSteps } = require('../routes/flows')
  const db = getDB()
  const now = new Date().toISOString()
  const flowId = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('왕복테스트', now, now).lastInsertRowid

  replaceSteps(db, flowId, [
    { step_type: 'group', label: '동요 전 안내', config: { collapsed: true, color: 'sky', at_time: '17:00' } },
    { step_type: 'chime', label: '차임',        config: {} },
  ])

  const loaded = loadFlowWithSteps(db, flowId)
  assert.equal(loaded.steps.length, 2)
  assert.equal(loaded.steps[0].step_type, 'group')
  assert.equal(loaded.steps[0].label, '동요 전 안내')
  assert.deepEqual(loaded.steps[0].config, { collapsed: true, color: 'sky', at_time: '17:00' })
  assert.equal(loaded.steps[1].step_type, 'chime', '묶음 뒤 단계가 순서를 잃으면 안 된다')
})
