// 예약별 재생 배속(schedules.playback_rate) — 음원·영상을 느리게/빠르게 튼다.
//
// 왜: 노래방 방송처럼 어르신들이 따라 부르는 방송은 원래 속도가 너무 빠르다. 방송 때마다
// 사람이 손으로 맞출 수는 없으니 예약에 걸어둔다.
// 볼륨과 같은 원칙이다 — 전역 설정을 바꿨다 되돌리지 않고, 이 예약의 방송 이벤트에만 싣는다.
// NULL이면 1.0배(원래 속도). 0.5~1.5배만 받는다(그 밖은 알아듣기 어렵거나 소리가 뭉갠다).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_rate_${process.pid}_${Date.now()}.db`)
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
const { fireSchedule } = require('../services/scheduler')
const { normalizePlaybackRate } = require('../services/scheduleStore')
const { invalidPlaybackRate }   = require('../routes/schedules')

let seq = 0
function makeAudioFile() {
  seq++
  return getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('prayer', ?, ?, 1)
  `).run(`rate${seq}.mp3`, `배속음원${seq}`).lastInsertRowid
}

function makeSchedule(fields) {
  const db = getDB()
  const id = db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays,
                           broadcast_type, audio_file_id, flow_sequence_id, playback_rate)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', '[]', ?, ?, ?, ?)
  `).run(`배속테스트${++seq}`, fields.broadcast_type, fields.audio_file_id ?? null,
    fields.flow_sequence_id ?? null, fields.playback_rate ?? null).lastInsertRowid
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

const lastOf = (type) => [...sent].reverse().find(e => e.type === type)

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 값 다듬기 ────────────────────────────────────────────────
test('배속은 숫자만 받고 0.5~1.5배로 자른다', () => {
  assert.equal(normalizePlaybackRate(0.75), 0.75)
  assert.equal(normalizePlaybackRate('1.25'), 1.25)
  assert.equal(normalizePlaybackRate(0.1), 0.5, '너무 느리면 말이 뭉개진다')
  assert.equal(normalizePlaybackRate(9), 1.5)
})

test('비어 있거나 말이 안 되면 NULL — 원래 속도로 둔다', () => {
  assert.equal(normalizePlaybackRate(null), null)
  assert.equal(normalizePlaybackRate(''), null)
  assert.equal(normalizePlaybackRate('빠르게'), null)
  assert.equal(normalizePlaybackRate([]), null, '[]가 0으로 통과하면 재생이 멈춘다')
  assert.equal(normalizePlaybackRate(0), null)
})

test('저장 요청 검증: 범위 밖 숫자는 조용히 자르지 않고 되묻는다', () => {
  assert.equal(invalidPlaybackRate(undefined), false)
  assert.equal(invalidPlaybackRate(''), false)
  assert.equal(invalidPlaybackRate(0.8), false)
  assert.equal(invalidPlaybackRate(0.2), true)
  assert.equal(invalidPlaybackRate(2), true)
  assert.equal(invalidPlaybackRate('느리게'), true)
})

// ── 실제 방송 이벤트까지 도달하는가 ──────────────────────────
test('음원 예약: prayer_play에 그 예약의 배속이 실린다', async () => {
  const s = makeSchedule({ broadcast_type: 'audio', audio_file_id: makeAudioFile(), playback_rate: 0.8 })
  await fireSchedule(s, getDB())
  assert.equal(lastOf('prayer_play')?.payload.rate, 0.8)
})

test('영상 예약: video_play에 그 예약의 배속이 실린다', async () => {
  const s = makeSchedule({ broadcast_type: 'video', audio_file_id: makeAudioFile(), playback_rate: 0.7 })
  await fireSchedule(s, getDB())
  assert.equal(lastOf('video_play')?.payload.rate, 0.7)
})

test('배속을 안 정한 예약은 rate가 null — 원래 속도로 재생된다', async () => {
  const s = makeSchedule({ broadcast_type: 'audio', audio_file_id: makeAudioFile() })
  await fireSchedule(s, getDB())
  assert.equal(lastOf('prayer_play')?.payload.rate, null)
})

test('흐름 예약: 예약에 건 배속이 흐름 안의 음원까지 따라간다', async () => {
  const db = getDB()
  const now = new Date().toISOString()
  const flowId = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('배속흐름', now, now).lastInsertRowid
  db.prepare(`
    INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config)
    VALUES (?, 0, 'audio', '동요', ?)
  `).run(flowId, JSON.stringify({ playlist: [makeAudioFile()] }))

  const s = makeSchedule({ broadcast_type: 'flow', flow_sequence_id: flowId, playback_rate: 0.9 })
  await fireSchedule(s, db)
  assert.equal(lastOf('prayer_play')?.payload.rate, 0.9,
    '예약에 걸어둔 배속이 흐름 단계에도 적용돼야 한다 — 화면에서 두 번 설정하게 만들지 않는다')
})
