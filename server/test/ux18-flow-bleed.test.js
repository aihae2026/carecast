'use strict'
// UX-18 — **다음 단계 침범**과 **연속 실행** (2026-09-12).
//
// 이 항목의 남은 두 가지를 실제 흐름으로 돌려서 본다. 앞의 것들(잔여 소리·중복 타이머)은
// 자기 파일에서 이미 검증했다(`ux18-flow-timer-leak.test.js` 등).
//
// **다음 단계 침범이란**: 앞 단계의 음원이 아직 도는 중에 뒤 단계의 예약 시각이 와서
// 흐름이 건너뛸 때, **정지 신호를 안 쏘면 앞 소리가 새 단계 위에 그대로 얹힌다.**
// 화면에는 새 단계가 떠 있는데 귀에는 두 소리가 겹쳐 들린다 — 현장에서 "뭐가 나오는지
// 모르겠다"가 되는 자리다. 그래서 **순서**를 본다: 정지가 다음 재생보다 먼저인가.
//
// **연속 실행이란**: 같은 흐름이 잇달아 두 번 도는 것(스케줄러가 매분 보므로 실제로 난다).
// 앞 회차의 흔적(실행 중 표식·취소 세대)이 남으면 두 번째가 조용히 건너뛰어진다 —
// 오류도 안 나고 이력만 비는 가장 찾기 어려운 실패다.
const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ux18bleed_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// SSE 를 가로채 **나간 순서 그대로** 모은다. 이 시험의 판정이 곧 순서다.
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}
// 차임은 서버 스피커라 실제로 울리면 안 된다.
const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: { ...realChime, playChime: () => {} },
}

const { initDB, getDB } = require('../db/schema')
const { runFlow } = require('../services/flowRunner')

function hhmm(baseMs, plusMin = 0) {
  const d = new Date(baseMs + plusMin * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 60배속 가상 시계 — 예약 시각이 분 단위라 실시계로는 시험할 수 없다.
function fastClock(startMs, speed = 60) {
  const realStart = Date.now()
  return () => startMs + (Date.now() - realStart) * speed
}

async function waitFor(fn, label, timeoutMs = 12000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`${timeoutMs}ms 안에 조건을 만족하지 못했다: ${label}`)
}

let seq = 0
function makeAudioFile() {
  seq++
  return getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('prayer', ?, ?, 0)
  `).run(`bleed${seq}.mp3`, `곡${seq}`).lastInsertRowid
}

function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`침범${++seq}`, now, now).lastInsertRowid
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
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('UX-18: 앞 단계를 끊고 넘어갈 때 **정지가 다음 재생보다 먼저** 나간다', async () => {
  const base = new Date(2026, 8, 12, 10, 0, 0).getTime()
  const a = makeAudioFile()
  const b = makeAudioFile()

  // 첫 곡은 **끝났다고 알리지 않는다** = 늘어지는 상황. 10:02 에 뒤 단계가 시작해야 한다.
  const flowId = makeFlow([
    { step_type: 'audio', label: '늘어지는 곡', config: { playlist: [a] } },
    { step_type: 'group', label: '안내',        config: { at_time: hhmm(base, 2), color: 'amber' } },
    { step_type: 'audio', label: '다음 곡',      config: { playlist: [b] } },
  ])

  const clock = fastClock(base)
  const before = sent.length
  const since = () => sent.slice(before)

  const running = runFlow(getDB(), flowId, { nowMs: clock })
  // **마지막 곡은 끝났다고 알려 준다.** 그 뒤에는 앵커가 없어서, 안 알리면 흐름이 대기
  // 상한(실시계 3분)을 꽉 채운다 — 시험이 느려지는 것이 아니라 아예 안 끝난다.
  await waitFor(() => since().filter(e => e.type === 'prayer_play').length === 2, '다음 단계의 곡')
  const 마지막 = since().filter(e => e.type === 'prayer_play').at(-1)
  require('../services/broadcastSequencer').notifyAudioEnded(마지막.payload.token)
  await running

  const 순서 = since().filter(e => e.type === 'prayer_play' || e.type === 'broadcast_stopped')
    .map(e => e.type)

  assert.ok(순서.length >= 3,
    `재생·정지 신호가 ${순서.length}건뿐이다 — 흐름이 끝까지 안 갔다: ${순서.join(' → ')}`)
  assert.equal(순서[0], 'prayer_play', '첫 곡이 안 나갔다')

  const 정지 = 순서.indexOf('broadcast_stopped')
  assert.notEqual(정지, -1,
    '끊고 넘어가면서 정지 신호를 안 쐈다 — 앞 곡이 다음 단계 위에 그대로 얹힌다')

  const 다음재생 = 순서.indexOf('prayer_play', 1)
  assert.notEqual(다음재생, -1, '다음 단계의 곡이 안 나갔다')
  assert.ok(정지 < 다음재생,
    `정지가 다음 재생보다 **뒤에** 나갔다(${순서.join(' → ')}) — `
    + '그 사이에 두 소리가 겹쳐 들린다')
})

// **반대쪽("제 시간에 끝난 단계는 정지를 안 쏜다")을 여기서 안 보는 이유.**
//
// 처음엔 차임 둘 사이에 앵커를 둔 흐름으로 쓰려 했는데, 차임 단계는 결과를 기다리며
// **실시계로 3초**를 잔다(`flowRunner.js` 의 `cancellableSleep(3000, …)`). 이 시험의
// 60배속 가상시계에서 그 3초는 **3분**이라, +2분 앵커가 차임이 도는 동안 지나간다 —
// 즉 `cutShort` 가 참이 되는 것이 **맞다.** 시험 전제가 성립하지 않는 것이지 결함이 아니다.
//
// 그 판정은 `shouldStopBeforeAnchor` 한 함수가 하고, `flow-anchor-stop.test.js` 와
// `step-outcome.test.js` 가 그 함수를 직접 불러 양쪽을 고정한다. 여기서 가상시계로 다시
// 만들면 **시계 설정에 따라 깨지는 시험**이 하나 늘 뿐이다.

test('UX-18: 같은 흐름을 잇달아 두 번 돌려도 두 번째가 조용히 건너뛰어지지 않는다', async () => {
  const base = new Date(2026, 8, 12, 12, 0, 0).getTime()
  const a = makeAudioFile()
  const flowId = makeFlow([{ step_type: 'chime', label: '차임', config: {} },
    { step_type: 'audio', label: '곡', config: { playlist: [a] } }])

  const 회차 = async () => {
    const before = sent.length
    const clock = fastClock(base)
    const running = runFlow(getDB(), flowId, { nowMs: clock })
    // 곡이 나가면 끝났다고 알려 흐름을 끝까지 보낸다.
    await waitFor(() => sent.slice(before).some(e => e.type === 'prayer_play'), '곡')
    const tok = sent.slice(before).find(e => e.type === 'prayer_play').payload.token
    require('../services/broadcastSequencer').notifyAudioEnded(tok)
    const 결과 = await running
    return { 결과, 나간것: sent.slice(before).map(e => e.type) }
  }

  const 첫 = await 회차()
  const 둘 = await 회차()

  assert.ok(첫.나간것.includes('prayer_play'), `1회차가 안 나갔다: ${첫.나간것.join(', ')}`)
  assert.ok(둘.나간것.includes('prayer_play'),
    `2회차가 조용히 건너뛰어졌다 — 앞 회차의 실행 중 표식이 안 걷혔다: ${둘.나간것.join(', ')}`)
  assert.equal(첫.결과, 둘.결과,
    `같은 흐름인데 1회차(${첫.결과})와 2회차(${둘.결과})의 결과가 다르다`)
  // 차임도 두 번 다 울려야 한다 — 한 번만 울리면 앞 회차 상태가 남은 것이다.
  assert.equal(첫.나간것.filter(t => t === 'chime_play').length, 1)
  assert.equal(둘.나간것.filter(t => t === 'chime_play').length, 1,
    '2회차의 차임이 안 울렸다 — 회차 사이에 상태가 남는다')
})
