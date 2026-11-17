// 민감정보 필터가 실제 방송/예약 경로에서 동작하는지 검증.
// 탐지 로직 자체는 sensitive-info.test.js가 덮고, 여기서는 "서버가 실제로 막는가"만 본다.
// 서버가 단일 판단 주체라 프론트를 우회해도 막혀야 한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_sensroutes_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const ttsRoutes = require('../routes/tts')
const schedulesRoutes = require('../routes/schedules')
const draftRoutes = require('../routes/scheduleDrafts')
const { insertDraft } = require('../routes/scheduleDrafts')
const { todayStr } = require('../services/repeatSchedule')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({
    '/api/tts': ttsRoutes, '/api/schedules': schedulesRoutes, '/api/schedule-drafts': draftRoutes,
  })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function post(p, body) {
  const r = await fetch(app.baseUrl + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

const schedule = (extra) => ({
  title: '테스트 예약', target: '전체', scheduled_time: '10:00', broadcast_type: 'text',
  repeat_start_date: '2026-08-27', repeat_weekdays: [1], ...extra,
})

// ── 즉시 방송 ────────────────────────────────────────────────
test('방송: 휴대폰 번호가 있으면 400으로 차단된다', async () => {
  const r = await post('/api/tts/broadcast', { text: '보호자 연락처는 010-1234-5678 입니다' })
  assert.equal(r.status, 400)
  assert.ok(r.body.blocked.some(b => b.type === 'phone'))
})

test('방송: 주민등록번호가 있으면 400으로 차단된다', async () => {
  const r = await post('/api/tts/broadcast', { text: '주민번호 400312-1234567 확인 바랍니다' })
  assert.equal(r.status, 400)
  assert.ok(r.body.blocked.some(b => b.type === 'rrn'))
})

test('[안전] 비상방송(priority)도 예외 없이 차단된다', async () => {
  const r = await post('/api/tts/broadcast', {
    text: '응급 상황입니다. 010-1234-5678로 연락 바랍니다', priority: true, user: '비상방송',
  })
  assert.equal(r.status, 400, '비상방송이라고 개인정보가 나가면 안 된다')
})

test('방송: 이름이 있으면 409로 되묻고, 확인(ackWarnings) 후에는 진행된다', async () => {
  const text = '김철수 어르신을 찾습니다. 보신 분은 알려주세요.'
  const ask = await post('/api/tts/broadcast', { text })
  assert.equal(ask.status, 409)
  assert.equal(ask.body.needsConfirm, true)
  assert.ok(ask.body.warnings.some(w => w.type === 'name'))

  const go = await post('/api/tts/broadcast', { text, ackWarnings: true })
  assert.notEqual(go.status, 409, '확인 후에는 더 이상 되묻지 않아야 한다')
  assert.notEqual(go.status, 400)
})

test('[회귀] 평범한 방송문은 그대로 나간다', async () => {
  const r = await post('/api/tts/broadcast', { text: '어르신 여러분, 잠시 후 점심 식사가 준비됩니다.' })
  assert.notEqual(r.status, 400)
  assert.notEqual(r.status, 409)
})

// ── 예약 저장 ────────────────────────────────────────────────
test('예약: 내용에 개인정보가 있으면 400으로 저장이 막힌다', async () => {
  const r = await post('/api/schedules', schedule({ content: '연락처 010-9876-5432 안내드립니다' }))
  assert.equal(r.status, 400)
  assert.ok(r.body.blocked.some(b => b.type === 'phone'))
})

test('예약: 이름이 있으면 409로 되묻고, 확인 후 저장된다', async () => {
  const body = schedule({ content: '박민수 어르신 면회 안내드립니다' })
  const ask = await post('/api/schedules', body)
  assert.equal(ask.status, 409)

  const go = await post('/api/schedules', { ...body, ackWarnings: true })
  assert.equal(go.status, 200)
  assert.equal(typeof go.body.id, 'number')
})

test('[회귀] 평범한 예약은 그대로 저장된다', async () => {
  const r = await post('/api/schedules', schedule({ content: '오늘 오후 산책 프로그램이 있습니다.' }))
  assert.equal(r.status, 200)
})

// ── AI 초안 승인 (CC-037) ────────────────────────────────────
// 승인 경로는 POST /api/schedules를 타지 않고 insertSchedule을 직접 부른다. 그래서 필터가
// 라우트에만 붙어 있으면 **AI가 쓴 문구만 검사 없이 스피커로 나간다** — 사람이 쓴 문구보다
// 덜 꼼꼼히 읽히는 쪽이라 더 위험하다.
function pendingDraft(content) {
  return insertDraft({
    raw_input: '테스트', title: '안내', content,
    scheduled_time: '10:00', repeat_start_date: todayStr(),
  })
}

test('승인: 초안 내용에 개인정보가 있으면 400으로 막힌다', async () => {
  const draft = pendingDraft('연락처 010-9876-5432 안내드립니다')
  const r = await post(`/api/schedule-drafts/${draft.id}/approve`, {})
  assert.equal(r.status, 400)
  assert.ok(r.body.blocked?.some(b => b.type === 'phone'), '무엇이 걸렸는지 화면이 알아야 한다')
})

test('승인: 승인 카드에서 고친 내용(overrides.content)도 검사한다', async () => {
  const draft = pendingDraft('오늘 오후 산책 프로그램이 있습니다.')
  const r = await post(`/api/schedule-drafts/${draft.id}/approve`, {
    content: '주민번호 900101-1234567 확인 부탁드립니다',
  })
  assert.equal(r.status, 400)
})

test('승인: 이름이 있으면 409로 되묻고, 확인 후 승인된다', async () => {
  const draft = pendingDraft('박민수 어르신 면회 안내드립니다')
  const ask = await post(`/api/schedule-drafts/${draft.id}/approve`, {})
  assert.equal(ask.status, 409)
  assert.ok(ask.body.needsConfirm)

  const go = await post(`/api/schedule-drafts/${draft.id}/approve`, { ackWarnings: true })
  assert.equal(go.status, 200)
  assert.equal(typeof go.body.scheduleId, 'number')
})

test('[회귀] 평범한 초안은 그대로 승인된다', async () => {
  const draft = pendingDraft('오늘 오후 산책 프로그램이 있습니다.')
  const r = await post(`/api/schedule-drafts/${draft.id}/approve`, {})
  assert.equal(r.status, 200)
})

test('[회귀] 막힌 초안은 pending으로 남아 다시 고쳐 승인할 수 있다', async () => {
  const draft = pendingDraft('연락처 010-9876-5432 안내드립니다')
  await post(`/api/schedule-drafts/${draft.id}/approve`, {})
  const go = await post(`/api/schedule-drafts/${draft.id}/approve`, { content: '산책 안내입니다.' })
  assert.equal(go.status, 200, '한 번 막혔다고 초안이 죽으면 사람이 처음부터 다시 말해야 한다')
})

// ── 판정이 한 벌인지 (드리프트 방어) ──────────────────────────
test('세 경로가 sensitiveInfo.checkSensitive 하나를 쓴다 — 문구를 각자 만들지 않는다', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  for (const f of ['routes/tts.js', 'routes/schedules.js', 'routes/scheduleDrafts.js']) {
    assert.ok(src(f).includes('checkSensitive'), `${f}가 공용 판정을 안 쓴다`)
    assert.ok(!src(f).includes('detectSensitive'),
      `${f}가 detectSensitive를 직접 부른다 — 메시지·409 판정이 또 갈라진다`)
  }
})
