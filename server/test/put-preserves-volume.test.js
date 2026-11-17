// PUT /api/schedules/:id가 예약별 볼륨·배속을 조용히 지우던 것.
//
// PUT이 세 컬럼(bgm_volume/main_volume/playback_rate)을 req.body 값으로 무조건 덮어써서,
// 그 키를 모르는 클라이언트(자동 업데이트 전 번들을 띄워둔 관리자 탭)가 제목만 고쳐
// 저장해도 값이 전부 NULL로 지워졌다 — "잔잔하게 방송해줘"로 만든 예약이 다음 발동에
// 기본 볼륨으로 크게 나간다. 키가 아예 없으면(구버전) 기존 값을 보존하고, 키를 명시적으로
// null로 보내면(비우기) 기존대로 지운다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_putvol_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const schedulesRoutes = require('../routes/schedules')

let app
test.before(async () => { initDB(); app = await startTestApp({ '/api/schedules': schedulesRoutes }) })

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function req(method, p, body) {
  const r = await fetch(app.baseUrl + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

// 자동 업데이트 전 번들이 보내던 payload — 세 신규 컬럼 키가 아예 없다
const OLD_BUNDLE_PAYLOAD = {
  title: '산책 안내', content: '산책 시간입니다. 감사합니다.', target: '전체',
  scheduled_time: '15:00', active: 1, broadcast_type: 'text',
  bgm_enabled: 0, bgm_type: 'preset', bgm_value: '', bgm_title: '', bgm_delay: 5,
  repeat_broadcast: 0, repeat_start_date: '2026-08-30', repeat_weekdays: [],
}

async function createWithVolumes() {
  const { status, body } = await req('POST', '/api/schedules', {
    ...OLD_BUNDLE_PAYLOAD,
    bgm_volume: 30, main_volume: 40, playback_rate: 0.8,
  })
  assert.equal(status, 200, `생성 실패: ${JSON.stringify(body)}`)
  const row = getDB().prepare('SELECT * FROM schedules ORDER BY id DESC LIMIT 1').get()
  assert.equal(row.bgm_volume, 30)
  return row.id
}

test('볼륨 키가 없는 PUT(구버전 탭)은 기존 볼륨·배속을 보존한다', async () => {
  const id = await createWithVolumes()
  const { status } = await req('PUT', `/api/schedules/${id}`, { ...OLD_BUNDLE_PAYLOAD, title: '산책 안내(수정)' })
  assert.equal(status, 200)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.title, '산책 안내(수정)', '제목 수정 자체는 반영돼야 한다')
  assert.equal(row.bgm_volume, 30, '키가 없다고 볼륨을 지우면 "잔잔하게" 예약이 크게 나간다')
  assert.equal(row.main_volume, 40)
  assert.equal(row.playback_rate, 0.8)
})

test('명시적으로 null을 보내면 기존대로 비워진다(기본값 복귀)', async () => {
  const id = await createWithVolumes()
  const { status } = await req('PUT', `/api/schedules/${id}`,
    { ...OLD_BUNDLE_PAYLOAD, bgm_volume: null, main_volume: null, playback_rate: null })
  assert.equal(status, 200)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.bgm_volume, null)
  assert.equal(row.main_volume, null)
  assert.equal(row.playback_rate, null)
})

test('새 값을 보내면 그 값으로 바뀐다 (회귀)', async () => {
  const id = await createWithVolumes()
  await req('PUT', `/api/schedules/${id}`, { ...OLD_BUNDLE_PAYLOAD, bgm_volume: 55 })
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  assert.equal(row.bgm_volume, 55)
})
