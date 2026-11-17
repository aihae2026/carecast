// "이 방송을 틀면 뭐가 빠지나" — 순서편집기의 점검 버튼이 읽는 값.
//
// 이 시스템에서 단계는 **조용히** 빠진다. 음원 파일이 없으면 실행부가 그냥 건너뛰고,
// 문구가 빈 안내는 stepTTS가 첫 줄에서 돌아온다. 소리가 안 났다는 사실 자체가 아무 데도
// 안 남으므로, 매일 저절로 나가는 방송에서 한 단계가 빠지면 **아무도 모른다.**
//
// 새 계산을 만들지 않는다. 예상 소요시간(broadcastEstimate)이 이미 그 판정을 하고 있고
// — 0초로 떨어뜨리는 자리가 곧 "안 나간다"는 자리다 — 거기에 사유만 붙인다.
// 2026-08-31에 같은 규칙을 두 벌 적어 두었다가 갈라진 사고를 냈다. 되풀이하지 않는다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_preflight_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH     = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { estimateBroadcastDuration } = require('../domain/broadcastEstimate')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

// 단계 하나짜리 방송의 그 단계 결과
function one(steps, materials = {}) {
  const r = estimateBroadcastDuration(steps, materials)
  assert.equal(r.steps.length, 1, '단계가 하나만 들어와야 한다')
  return r.steps[0]
}

// ── 안 나가는 것에는 사유가 붙는다 ──────────────────────────────

test('음원 파일이 없는 단계 — 왜 안 나가는지 적힌다', () => {
  const s = one([{ id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true }],
                { tab: 'morning', audioFiles: { morning_prayer: { exists: false } } })
  assert.ok(s.skip, '사유가 없으면 화면이 "빠진다"고만 말하고 이유를 못 댄다')
  assert.match(s.skip, /파일/)
})

test('문구가 빈 안내 단계 — 왜 안 나가는지 적힌다', () => {
  const s = one([{ id: 'exercise_tts', label: '체조 안내', enabled: true }],
                { tab: 'exercise', texts: { exercise_tts: '' } })
  assert.ok(s.skip)
  assert.match(s.skip, /문구/)
})

test('파일을 아직 안 고른 커스텀 음원 단계 — 갓 추가한 단계가 이 상태다', () => {
  const s = one([{ id: 'custom_audio_1', label: '음원 재생', enabled: true, customType: 'audio', playlist: [] }],
                { tab: 'morning' })
  assert.ok(s.skip)
  assert.match(s.skip, /고르/)
})

test('투약 안내는 종료일이 지나면 통째로 안 나간다 — 그것도 사유다', () => {
  const s = one([{ id: 'medication_tts', label: '투약 안내', enabled: true, content: '약 드세요', end_date: '2026-08-01' }],
                { tab: 'morning', today: '2026-08-31' })
  assert.ok(s.skip)
  assert.match(s.skip, /종료일/)
})

test('식사 안내 — 녹음도 없고 문구도 비면 안 나간다', () => {
  const s = one([{ id: 'breakfast_prayer_tts', label: '아침 식사 안내', enabled: true }],
                { tab: 'morning', texts: { breakfast_prayer_tts: '' } })
  assert.ok(s.skip)
})

// ── 나가는 것에는 안 붙는다 ────────────────────────────────────

test('멀쩡히 나가는 단계에는 사유가 없다 — 잔소리가 되면 사람이 목록을 안 본다', () => {
  const ok = one([{ id: 'exercise_tts', label: '체조 안내', enabled: true }],
                 { tab: 'exercise', texts: { exercise_tts: '체조 시간입니다' } })
  assert.equal(ok.skip, undefined)
})

test('길이를 몰라 상한으로 잡은 것은 "빠짐"이 아니다 — 나가긴 나간다', () => {
  const s = one([{ id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true }],
                { tab: 'morning', audioFiles: { morning_prayer: { exists: true, duration: 0 } } })
  assert.equal(s.skip, undefined, '상한은 확신도(confidence)로 이미 드러난다')
  assert.equal(s.confidence, 'upperBound')
})

test('소리가 원래 없는 단계는 "빠짐"이 아니다 — 대기·묶음은 제 일을 한 것이다', () => {
  const wait = one([{ id: 'custom_delay_1', label: '대기', enabled: true, customType: 'delay', wait_sec: 30 }],
                   { tab: 'morning' })
  assert.equal(wait.skip, undefined)
})

// ── 흐름도 같은 점검을 받는다 ──────────────────────────────────

test('흐름: 문구가 빈 TTS 단계', () => {
  const s = one([{ step_type: 'tts', label: '안내', config: { content: '  ' } }], { lane: 'flow' })
  assert.ok(s.skip)
  assert.match(s.skip, /문구/)
})

test('흐름: 파일을 안 고른 음원 단계', () => {
  const s = one([{ step_type: 'audio', label: '음원', config: { playlist: [] } }], { lane: 'flow' })
  assert.ok(s.skip)
  assert.match(s.skip, /고르/)
})

test('흐름: 재생목록에 넣은 파일이 전부 지워졌으면 안 나간다', () => {
  const s = one([{ step_type: 'audio', label: '음원', config: { playlist: [7, 8] } }],
                { lane: 'flow', audioFiles: { 7: { exists: false }, 8: { exists: false } } })
  assert.ok(s.skip)
  assert.match(s.skip, /파일/)
})

test('흐름: 한 곡이라도 살아 있으면 빠짐이 아니다', () => {
  const s = one([{ step_type: 'audio', label: '음원', config: { playlist: [7, 8] } }],
                { lane: 'flow', audioFiles: { 7: { exists: false }, 8: { exists: true, duration: 60 } } })
  assert.equal(s.skip, undefined)
})

// ── 방송 전체 요약 ────────────────────────────────────────────

test('방송 전체에 빠지는 단계가 몇 개인지 한눈에 나온다', () => {
  const r = estimateBroadcastDuration([
    { id: 'exercise_tts',  label: '체조 안내', enabled: true },
    { id: 'morning_prayer', label: '음원',     enabled: true },
  ], { tab: 'morning', texts: { exercise_tts: '' }, audioFiles: { morning_prayer: { exists: false } } })

  assert.equal(r.skippedStepIds.length, 2, '화면이 "2개 단계가 빠집니다"를 바로 말할 수 있어야 한다')
  assert.deepEqual(r.skippedStepIds, ['exercise_tts', 'morning_prayer'])
})

test('빠지는 게 없으면 빈 목록이다 — 화면이 없는 경고를 그리면 안 된다', () => {
  const r = estimateBroadcastDuration([{ id: 'exercise_tts', label: '체조 안내', enabled: true }],
                                      { tab: 'exercise', texts: { exercise_tts: '체조 시간입니다' } })
  assert.deepEqual(r.skippedStepIds, [])
})

// ── 흐름 점검 라우트 ──────────────────────────────────────────
// 화면이 흐름 하나를 통째로 물어볼 창구. 자동방송은 설정에서 단계를 읽지만 흐름은
// flow_sequence_steps 표에서 읽으므로 라우트가 따로 필요하다. **계산은 같은 함수를 쓴다.**
const { initDB, getDB } = require('../db/schema')
const { startTestApp }  = require('./helpers/testApp')
const flowRoutes        = require('../routes/flows')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/flows': flowRoutes })
})
test.after(async () => { if (app) await app.close() })

function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('점검용 흐름', now, now).lastInsertRowid
  const ins = db.prepare(
    'INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?, ?, ?, ?, ?)')
  steps.forEach((s, i) => ins.run(id, i, s.step_type, s.label || '', JSON.stringify(s.config || {})))
  return Number(id)
}

test('흐름 점검: 안 나가는 단계를 사유와 함께 돌려준다', async () => {
  const id = makeFlow([
    { step_type: 'tts',   label: '빈 안내',   config: { content: '' } },
    { step_type: 'chime', label: '차임벨',    config: {} },
    { step_type: 'audio', label: '음원 미선택', config: { playlist: [] } },
  ])

  const res = await fetch(`${app.baseUrl}/api/flows/${id}/estimate`)
  assert.equal(res.status, 200)
  const body = await res.json()

  assert.equal(body.skippedStepIds.length, 2, '빈 안내와 음원 미선택 둘이 빠진다')
  const byLabel = Object.fromEntries(body.steps.map(s => [s.label, s]))
  assert.match(byLabel['빈 안내'].skip, /문구/)
  assert.match(byLabel['음원 미선택'].skip, /고르/)
  assert.equal(byLabel['차임벨'].skip, undefined, '차임벨은 멀쩡히 나간다')
})

test('흐름 점검: 재생목록의 파일 길이를 실제 표에서 읽는다', async () => {
  const db = getDB()
  const fileId = Number(db.prepare(
    'INSERT INTO audio_files (category, filename, original_name, duration) VALUES (?, ?, ?, ?)'
  ).run('etc', 'preflight1.mp3', '점검용 음원', 120).lastInsertRowid)

  const id = makeFlow([{ step_type: 'audio', label: '음원', config: { playlist: [fileId] } }])
  const res = await fetch(`${app.baseUrl}/api/flows/${id}/estimate`)
  const body = await res.json()

  assert.deepEqual(body.skippedStepIds, [], '살아 있는 파일이니 빠지지 않는다')
  assert.equal(body.totalMs, 120 * 1000 + 2000, '흐름은 단계 사이 간격이 없다 — 곡 길이 + 여유 2초')
})

test('흐름 점검: 없는 흐름은 404다', async () => {
  const res = await fetch(`${app.baseUrl}/api/flows/999999/estimate`)
  assert.equal(res.status, 404)
})
