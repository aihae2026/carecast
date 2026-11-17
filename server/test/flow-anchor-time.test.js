// 흐름 단계의 "예약 시각"(config.at_time) — 그 시각이 되면 앞 단계가 안 끝났어도 끊고 시작한다.
//
// 왜 필요한가: 앞 단계가 길어지면 뒤에 있던 저녁식사 안내가 통째로 밀린다. 실제로 그 사고가
// 났다(음원 단계가 곡당 180초를 기다려서 흐름이 12분간 묶였다 — flow-audio-gapless.test.js).
// 원인 자체는 고쳤지만, 시각이 중요한 방송은 원인이 무엇이든 제 시각에 나가야 한다.
//
// 시각은 'HH:MM'(분 단위)이라 실제 시계로 시험하면 한 번에 1분씩 기다려야 한다. 그래서
// runFlow가 시계를 주입받게 두고(opts.nowMs, 기본값 Date.now) 여기서는 60배속 시계를 쓴다.
// 운영 경로는 기본값을 그대로 쓰므로 이 주입은 테스트에서만 쓰인다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_anchor_${process.pid}_${Date.now()}.db`)
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
  id: chimePath, filename: chimePath, loaded: true, exports: {
    ...realChime,
    playChime: () => {},   // 스피커를 울리지 않는다
  },
}

const { initDB, getDB } = require('../db/schema')
const { runFlow, anchorTimeMs, nextAnchor } = require('../services/flowRunner')

// 'HH:MM' 문자열로 만들기 — 기준 시각에서 분을 더한다
function hhmm(baseMs, plusMin = 0) {
  const d = new Date(baseMs + plusMin * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 60배속 가상 시계 — 실제 1초가 가상 1분
function fastClock(startMs, speed = 60) {
  const realStart = Date.now()
  return () => startMs + (Date.now() - realStart) * speed
}

let flowSeq = 0
function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`앵커테스트${++flowSeq}`, now, now).lastInsertRowid
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

// ── 순수 함수 ────────────────────────────────────────────────
test('anchorTimeMs: HH:MM을 오늘 그 시각으로 읽는다', () => {
  const now = new Date(2026, 7, 28, 16, 0, 0).getTime()
  const at = anchorTimeMs({ config: { at_time: '17:30' } }, now)
  assert.equal(new Date(at).getHours(), 17)
  assert.equal(new Date(at).getMinutes(), 30)
})

test('anchorTimeMs: 시각이 없거나 형식이 틀리면 null — 잘못 적은 값이 방송을 끊지 않게', () => {
  const now = Date.now()
  assert.equal(anchorTimeMs({ config: {} }, now), null)
  assert.equal(anchorTimeMs({ config: { at_time: '' } }, now), null)
  assert.equal(anchorTimeMs({ config: { at_time: '25:00' } }, now), null)
  assert.equal(anchorTimeMs({ config: { at_time: '오후 다섯시' } }, now), null)
})

test('nextAnchor: 아직 오지 않은 앵커만 고른다 — 이미 지난 시각은 앞 단계를 몰살시키면 안 된다', () => {
  const now = new Date(2026, 7, 28, 17, 5, 0).getTime()
  const steps = [
    { config: {} },
    { config: { at_time: '17:00' } },   // 이미 지남 → 무시
    { config: { at_time: '18:00' } },   // 다음 앵커
  ]
  assert.equal(nextAnchor(steps, 0, now)?.index, 2)
  assert.equal(nextAnchor(steps, 3, now), null)
})

// ── 실제 흐름 ────────────────────────────────────────────────
test('예약 시각이 되면 앞 단계가 안 끝났어도 끊고 그 단계로 넘어간다', async () => {
  const base = new Date(2026, 7, 28, 16, 0, 0).getTime()
  const flowId = makeFlow([
    { step_type: 'delay', label: '긴 대기', config: { wait_sec: 3600 } },   // 1시간 — 절대 제때 안 끝난다
    { step_type: 'chime', label: '저녁식사 안내', config: { at_time: hhmm(base, 2) } },
  ])

  const started = Date.now()
  await runFlow(getDB(), flowId, { nowMs: fastClock(base) })

  const chimes = sent.filter(e => e.type === 'chime_play')
  assert.ok(chimes.length >= 1, '예약 시각이 됐는데도 앞 단계에 묶여 방송이 안 나갔다')
  assert.ok(Date.now() - started < 20000, '가상 2분(실제 2초) 만에 넘어갔어야 한다')
})

test('앞 단계가 일찍 끝나면 예약 시각까지 기다렸다가 시작한다', async () => {
  const base = new Date(2026, 7, 28, 16, 0, 0).getTime()
  const clock = fastClock(base)
  const flowId = makeFlow([
    { step_type: 'delay', label: '짧은 대기', config: { wait_sec: 1 } },
    { step_type: 'chime', label: '정시 안내', config: { at_time: hhmm(base, 3) } },
  ])

  const before = sent.filter(e => e.type === 'chime_play').length
  await runFlow(getDB(), flowId, { nowMs: clock })
  const after = sent.filter(e => e.type === 'chime_play').length

  assert.equal(after - before, 1, '차임벨이 한 번 울렸어야 한다')
  // 가상 시계로 3분 뒤(=앵커 시각 이후)에 울렸는지 — 일찍 시작해버리면 이 값이 작다
  assert.ok(clock() >= base + 3 * 60_000, '예약 시각보다 일찍 시작했다')
})

test('저장할 때 시:분 형식이 아닌 예약 시각은 거절한다 — 넣은 줄 알고 있게 두지 않는다', () => {
  const { validateSteps } = require('../routes/flows')
  const ok = [{ step_type: 'chime', config: { at_time: '17:00' } }]
  const empty = [{ step_type: 'chime', config: { at_time: '' } }]
  const bad = [{ step_type: 'chime', config: { at_time: '17시' } }]

  assert.equal(validateSteps(ok), null)
  assert.equal(validateSteps(empty), null, '비워둔 건 "예약 시각 없음"이라 정상이다')
  assert.match(validateSteps(bad) || '', /예약 시각/)
})

test('앵커가 없으면 예전과 똑같이 순서대로 실행된다', async () => {
  const flowId = makeFlow([
    { step_type: 'delay', label: '대기', config: { wait_sec: 0 } },
    { step_type: 'chime', label: '차임', config: {} },
  ])
  const before = sent.filter(e => e.type === 'chime_play').length
  await runFlow(getDB(), flowId)
  assert.equal(sent.filter(e => e.type === 'chime_play').length - before, 1)
})
