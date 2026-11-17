// 이번에 넣은 네 가지가 **함께** 도는지 본다. 각각은 자기 파일에서 이미 검증했지만, 실제
// 현장 흐름은 넷이 한꺼번에 걸린다 — 묶음으로 나눈 목록 + 묶음마다 예약 시각 + 음원 연속 재생
// + 예약에 건 배속. 서로 물리는 지점에서 나는 사고를 잡으려고 따로 둔다.
//
// 실제로 잡은 사고 하나: 배속을 0.5배로 걸면 60초짜리 곡이 120초 걸리는데 대기 상한은
// 62초라, 노래 한창일 때 다음 곡으로 넘어갔다(고치려던 "곡이 잘린다"가 반대로 되살아남).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowint_${process.pid}_${Date.now()}.db`)
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
const { runFlow } = require('../services/flowRunner')
const { fireSchedule } = require('../services/scheduler')
const { notifyAudioEnded, stopCurrentBroadcast } = require('../services/broadcastSequencer')

function hhmm(baseMs, plusMin = 0) {
  const d = new Date(baseMs + plusMin * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 60배속 가상 시계 — 실제 1초가 가상 1분(예약 시각이 분 단위라 실시계로는 시험할 수 없다)
function fastClock(startMs, speed = 60) {
  const realStart = Date.now()
  return () => startMs + (Date.now() - realStart) * speed
}

async function waitFor(fn, label, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`${timeoutMs}ms 안에 조건을 만족하지 못했다: ${label}`)
}

let seq = 0
function makeAudioFile(duration = 0) {
  seq++
  return getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('prayer', ?, ?, ?)
  `).run(`int${seq}.mp3`, `동요${seq}`, duration).lastInsertRowid
}

function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`통합${++seq}`, now, now).lastInsertRowid
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

test('묶음 + 예약 시각 + 연속 음원 + 배속이 한 흐름에서 함께 돈다', async () => {
  const base = new Date(2026, 7, 28, 16, 0, 0).getTime()
  const a = makeAudioFile(0)
  const b = makeAudioFile(0)

  // 현장에서 만들 법한 모양 그대로:
  //   [묶음] 동요 (16:02에 시작)  →  음원 2곡 연속
  //   [묶음] 저녁식사 안내 (16:04에 시작)  →  차임벨
  const flowId = makeFlow([
    { step_type: 'group', label: '동요',        config: { at_time: hhmm(base, 2), color: 'sky' } },
    { step_type: 'audio', label: '동요 2곡',     config: { playlist: [a, b] } },
    { step_type: 'group', label: '저녁식사 안내', config: { at_time: hhmm(base, 4), color: 'amber' } },
    { step_type: 'chime', label: '안내 차임',    config: {} },
  ])

  const clock = fastClock(base)
  const before = sent.length
  const since = () => sent.slice(before)
  const plays = () => since().filter(e => e.type === 'prayer_play')

  const running = runFlow(getDB(), flowId, { nowMs: clock, rate: 0.8 })

  // 1) 첫 곡은 예약 시각(16:02) 이후에 나가야 한다. "실제 300ms 재운 뒤 개수 0 확인" 방식은
  //    전체 스위트 병렬 부하에서 이벤트 루프가 잠깐 밀리면 60배속 가상시계가 앵커를 지나버려
  //    간헐적으로 깨졌다 — 부하와 무관하게 "나간 시점의 시계"로 판정한다.
  await waitFor(() => plays().length === 1, '첫 곡')
  assert.ok(clock() >= base + 2 * 60_000 - 1000, '예약 시각 전에 음원이 나갔다')

  // 2) 첫 곡: 예약에 건 배속이 실려야 하고, 첫 곡은 페이드하며 시작한다
  assert.equal(plays()[0].payload.rate, 0.8, '예약 배속이 흐름 단계까지 안 왔다')
  assert.ok(!plays()[0].payload.gapless, '첫 곡은 평소처럼 시작한다')

  // 3) 곡이 끝났다고 알리면 곧바로 다음 곡 — 이어지는 곡은 텀 없이 붙는다
  notifyAudioEnded(plays()[0].payload.token)
  await waitFor(() => plays().length === 2, '두 번째 곡')
  assert.equal(plays()[1].payload.gapless, true)
  assert.equal(plays()[1].payload.rate, 0.8)

  // 4) 두 번째 곡은 끝났다고 알리지 않는다 = 늘어지는 상황.
  //    16:04가 되면 저녁식사 안내 묶음이 앞을 끊고 시작해야 한다.
  await running

  const stops  = since().filter(e => e.type === 'broadcast_stopped')
  const chimes = since().filter(e => e.type === 'chime_play')
  assert.equal(chimes.length, 1, '예약 시각이 됐는데 저녁식사 안내가 안 나갔다')
  assert.equal(stops.length, 1, '앞 단계를 끊었으면 소리를 정리해야 한다')
  // 순서까지 확인 — 정지가 차임벨보다 먼저여야 앞 음원이 겹쳐 들리지 않는다
  assert.ok(since().indexOf(stops[0]) < since().indexOf(chimes[0]), '정지 신호가 안내보다 늦게 갔다')
})

test('"즉시 정지"나 다른 방송이 시작되면 흐름도 멈춘다 — 새 방송 위에 다음 곡을 덮어쓰지 않는다', async () => {
  // 흐름이 음원 종료를 기다리는 동안 stopCurrentBroadcast()(정지 버튼·수동 방송 트리거가 부른다)가
  // 대기를 깨운다. 깨어난 이유를 구분하지 않으면 흐름은 "곡이 끝났구나" 하고 **곧바로 다음 곡을
  // 새 방송 위에 얹는다.** 종료 콜백을 붙이면서 새로 생긴 결합이라 여기서 고정한다.
  const ids = [makeAudioFile(0), makeAudioFile(0)]
  const before = sent.length
  const since  = () => sent.slice(before)
  const plays  = () => since().filter(e => e.type === 'prayer_play')

  const flowId = makeFlow([
    { step_type: 'audio', label: '음원 2곡', config: { playlist: ids } },
    { step_type: 'chime', label: '뒤 차임',  config: {} },
  ])

  const running = runFlow(getDB(), flowId)
  await waitFor(() => plays().length === 1, '첫 곡')

  stopCurrentBroadcast()   // 사람이 "즉시 정지"를 눌렀다
  await running

  assert.equal(plays().length, 1, '정지했는데 다음 곡이 나갔다')
  assert.equal(since().filter(e => e.type === 'chime_play').length, 0,
    '정지했는데 흐름의 다음 단계가 계속 진행됐다')
})

test('매일 도는 자동방송이 시작되면 돌던 흐름이 끊긴다 — 수동 정지와 같은 규칙', async () => {
  // 수동 트리거(routes/morning.js)는 cancelCurrentBroadcast()를 거쳐서 흐름을 끊는데,
  // 스케줄러가 매일 부르는 fireLunch/DinnerBroadcast는 newBroadcastToken()만 불렀다.
  // 그래서 점심·저녁 자동방송이 정시에 시작해도, 앞에 돌던 동요 흐름이 그 위로 계속
  // 다음 곡을 쐈다. 자동방송 시작 = 이전 소리 정리, 시각이 왕이다.
  const seq = require('../services/broadcastSequencer')
  const ids = [makeAudioFile(0), makeAudioFile(0)]
  const before = sent.length
  const since  = () => sent.slice(before)
  const plays  = () => since().filter(e => e.type === 'prayer_play')

  const flowId = makeFlow([
    { step_type: 'audio', label: '동요 2곡', config: { playlist: ids } },
    { step_type: 'chime', label: '뒤 차임',  config: {} },
  ])
  const running = runFlow(getDB(), flowId)
  await waitFor(() => plays().length === 1, '첫 곡')

  // fireLunchBroadcast 등 모든 자동방송이 시작할 때 부르는 바로 그 함수
  seq.__test__.newBroadcastToken()
  await running

  assert.equal(plays().length, 1, '자동방송이 시작됐는데 흐름이 다음 곡을 그 위에 쐈다')
  assert.equal(since().filter(e => e.type === 'chime_play').length, 0,
    '자동방송이 시작됐는데 흐름의 다음 단계가 계속 진행됐다')
})

test('흐름 예약 발사는 흐름이 끝나길 기다리지 않는다 — 같은 분의 다른 예약을 막지 않게', async () => {
  // fireSchedule이 runFlow를 await하면, 예약 시각(at_time) 대기가 낀 흐름 하나가 스케줄러의
  // 분(分) 루프를 통째로 잡는다 — 같은 분에 걸린 다른 예약과 SwitchBot·BGM 점검이 흐름이
  // 끝날 때까지 밀린다(옛 180초 버그 때 실제로 12분씩 밀렸다). 발사만 하고 넘어가야 한다.
  const db = getDB()
  const flowId = makeFlow([{ step_type: 'delay', label: '늘어지는 단계', config: { wait_sec: 5 } }])
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays,
                           broadcast_type, flow_sequence_id)
    VALUES ('발사테스트', '', '전체', '03:00', 1, '2026-08-28', '[]', 'flow', ?)
  `).run(flowId).lastInsertRowid
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)

  const t0 = Date.now()
  await fireSchedule(s, db)
  assert.ok(Date.now() - t0 < 2000, `fireSchedule이 흐름이 끝날 때까지 붙잡혀 있었다 (${Date.now() - t0}ms)`)

  // 발사 즉시 기록돼야 다음 분에 중복 발사되지 않고, 1회성 예약도 바로 꺼진다
  const after = db.prepare('SELECT last_fired, active FROM schedules WHERE id = ?').get(id)
  assert.ok(after.last_fired, '발사 즉시 last_fired가 기록돼야 한다')
  assert.equal(after.active, 0, '1회성 예약은 발사 즉시 비활성화돼야 한다')
})

test('예약 시각이 없으면 묶음이 있어도 예전처럼 쭉 이어서 실행된다', async () => {
  const a = makeAudioFile(0)
  const before = sent.length
  const since = () => sent.slice(before)

  const flowId = makeFlow([
    { step_type: 'group', label: '앞',   config: {} },
    { step_type: 'audio', label: '음원', config: { playlist: [a] } },
    { step_type: 'group', label: '뒤',   config: {} },
    { step_type: 'chime', label: '차임', config: {} },
  ])

  const running = runFlow(getDB(), flowId)
  await waitFor(() => since().filter(e => e.type === 'prayer_play').length === 1, '음원')
  notifyAudioEnded(since().filter(e => e.type === 'prayer_play')[0].payload.token)
  await running

  assert.equal(since().filter(e => e.type === 'chime_play').length, 1)
  assert.equal(since().filter(e => e.type === 'broadcast_stopped').length, 0,
    '끊을 일이 없었는데 정지 신호를 쏘면 계속 흐르라고 둔 BGM까지 꺼진다')
  assert.equal(since().filter(e => e.type === 'prayer_play')[0].payload.rate, null,
    '배속을 안 건 예약은 원래 속도여야 한다')
})

test('예약 시각을 기다리는 동안에도 화면은 그 단계를 가리킨다 — 자동방송과 같은 규칙', async () => {
  // 자동방송 5종은 "실행 **전에** 알린다"를 불변식으로 잡고 테스트까지 걸어 뒀다
  // (broadcast-step-progress.test.js). 흐름만 앵커 대기가 끝난 **뒤에** 알리고 있어서,
  // 예약 시각까지 몇 시간을 기다리는 동안 모니터링 화면이 계속 이전 단계를 가리켰다.
  const base = new Date(2026, 7, 28, 9, 0, 0).getTime()
  const flowId = makeFlow([
    // 첫 단계는 **소리가 없는 것**을 쓴다. 차임벨은 실제로 3초를 쓰는데, 60배속 시계에서는
    // 그 3초가 가상 3시간이라 앵커를 지나가 버린다(이 테스트를 처음 쓸 때 그렇게 헛짚었다).
    { step_type: 'group', label: '묶음',      config: {} },
    { step_type: 'chime', label: '예약된 차임', config: { at_time: hhmm(base, 3) } },
  ])

  const clock = fastClock(base)   // 60배속 — 가상 3분은 실제 3초다
  const before = sent.length
  const steps = () => sent.slice(before).filter(e => e.type === 'broadcast_step')

  const running = runFlow(getDB(), flowId, { nowMs: clock })

  await waitFor(() => steps().some(e => e.payload.index === 2), '2번째 단계 알림')
  assert.ok(clock() < base + 3 * 60_000,
    '앵커에 도달한 뒤에야 알렸다 — 기다리는 동안 화면이 끝난 단계를 가리키고 있었다는 뜻이다')

  await running
})
