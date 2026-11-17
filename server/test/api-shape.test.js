// 고도화 리스트에서 승인된 "API 응답 형태 검증(test-api)" — 프론트(src/lib/api.js 호출부)가
// 실제로 destructure하는 필드가 서버 응답에 그대로 있는지 확인한다. 오늘 세션에서
// audio_file_id/flow_sequence_id가 라우트에서 조용히 drop되던 버그가 있었는데, 그런 종류의
// 회귀를 다음부터는 사람이 화면을 눌러보기 전에 여기서 잡기 위한 것.
//
// server/index.js(운영 진입점)는 건드리지 않고, 검증할 라우트만 빈 익스프레스 앱에 얹어서
// 임시 포트로 띄운다(server/test/helpers/testApp.js). 운영 DB를 절대 건드리지 않도록
// CARECAST_DB_PATH로 임시 DB를 쓴다(라우트를 require하기 전에 반드시 먼저 설정).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_apishape_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

const schedulesRoutes = require('../routes/schedules')
const flowsRoutes = require('../routes/flows')
const proposalsRoutes = require('../routes/improvementProposals')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({
    '/api/schedules': schedulesRoutes,
    '/api/flows': flowsRoutes,
    '/api/dev/proposals': proposalsRoutes,
  })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function getJson(pathname) {
  const r = await fetch(app.baseUrl + pathname)
  return { status: r.status, body: await r.json() }
}
async function postJson(pathname, payload) {
  const r = await fetch(app.baseUrl + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  return { status: r.status, body: await r.json() }
}

test('GET /api/schedules — 배열이고, 프론트가 쓰는 필드(broadcast_type/audio_file_id/flow_sequence_id 등)가 라운드트립된다', async () => {
  const create = await postJson('/api/schedules', {
    title: '형태검증용 예약', content: '', target: '전체', scheduled_time: '10:00',
    broadcast_type: 'audio', audio_file_id: 42,
    repeat_start_date: '2026-08-25', repeat_weekdays: [1, 2, 3],
  })
  assert.equal(create.status, 200)
  assert.equal(typeof create.body.ok, 'boolean')
  assert.equal(typeof create.body.id, 'number')

  const list = await getJson('/api/schedules')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.body), 'GET /api/schedules는 배열을 반환해야 한다(WeeklySchedule.jsx가 배열로 바로 다룸)')

  const created = list.body.find(s => s.id === create.body.id)
  assert.ok(created, '방금 만든 예약이 목록에 있어야 한다')
  for (const field of ['id', 'title', 'target', 'scheduled_time', 'broadcast_type', 'active', 'repeat_weekdays', 'audio_file_id', 'flow_sequence_id']) {
    assert.ok(Object.hasOwn(created, field), `schedules 응답에 "${field}" 필드가 있어야 한다`)
  }
  // 오늘 세션에서 실제로 조용히 drop됐던 버그(§0A) — 값이 들어간 그대로 나와야 한다
  assert.equal(created.audio_file_id, 42, 'audio_file_id가 저장·응답에 그대로 라운드트립돼야 한다(과거 이 필드가 조용히 drop된 적 있음)')
})

test('GET /api/schedules — managed_by가 저장·응답에 그대로 라운드트립된다(자동방송순서편집기 커스텀 자동순서 구분용)', async () => {
  const create = await postJson('/api/schedules', {
    title: '커스텀 자동순서 테스트', target: '전체', scheduled_time: '06:30',
    broadcast_type: 'flow', flow_sequence_id: 1, managed_by: 'morning_editor',
    repeat_start_date: '2026-08-26', repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
  })
  assert.equal(create.status, 200)

  const list = await getJson('/api/schedules')
  const created = list.body.find(s => s.id === create.body.id)
  assert.ok(created)
  assert.equal(created.managed_by, 'morning_editor')
})

test('POST /api/schedules — broadcast_type=flow인데 flow_sequence_id 없으면 400과 error 메시지', async () => {
  const res = await postJson('/api/schedules', {
    title: '흐름 미선택 예약', target: '전체', scheduled_time: '10:00', broadcast_type: 'flow',
    repeat_start_date: '2026-08-25', repeat_weekdays: [],
  })
  assert.equal(res.status, 400)
  assert.equal(typeof res.body.error, 'string')
})

test('GET /api/flows — { items: [...] } 형태, 각 항목에 step_count가 있다(FlowBuilder.jsx가 그대로 씀)', async () => {
  const create = await postJson('/api/flows', {
    name: '형태검증 흐름',
    steps: [{ step_type: 'delay', config: { wait_sec: 3 } }, { step_type: 'chime', config: {} }],
  })
  assert.equal(create.status, 200)
  assert.equal(typeof create.body.id, 'number')

  const list = await getJson('/api/flows')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.body.items), 'GET /api/flows는 { items: [...] } 형태여야 한다')
  const created = list.body.items.find(f => f.id === create.body.id)
  assert.ok(created)
  assert.equal(created.step_count, 2)

  const detail = await getJson(`/api/flows/${create.body.id}`)
  assert.equal(detail.status, 200)
  assert.ok(Array.isArray(detail.body.steps), 'GET /api/flows/:id는 steps 배열을 포함해야 한다(FlowEditorModal이 .map으로 바로 씀)')
  for (const step of detail.body.steps) {
    for (const field of ['id', 'sort_order', 'step_type', 'config']) {
      assert.ok(Object.hasOwn(step, field), `flow step 응답에 "${field}" 필드가 있어야 한다`)
    }
    assert.equal(typeof step.config, 'object', 'config는 문자열이 아니라 파싱된 객체여야 한다(FlowEditorModal이 step.config.content처럼 바로 접근함)')
  }
})

test('GET /api/dev/proposals — { groups: [{ date, entries }] } 형태, entries 항목에 상태 필드가 있다', async () => {
  await postJson('/api/dev/proposals', { date: '2026-08-25', title: '형태검증 제안', description: '설명', status: '추천', category: '테스트' })
  const res = await getJson('/api/dev/proposals')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.groups), 'GET /api/dev/proposals는 { groups: [...] } 형태여야 한다')
  const group = res.body.groups.find(g => g.date === '2026-08-25')
  assert.ok(group)
  assert.ok(Array.isArray(group.entries))
  for (const field of ['id', 'title', 'description', 'status', 'category', 'queued_at']) {
    assert.ok(Object.hasOwn(group.entries[0], field), `proposal 응답에 "${field}" 필드가 있어야 한다`)
  }
})
