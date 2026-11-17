// 예약 저장 시 값 검증.
//
// 검증이 없으면 "저장은 됐는데 절대 발동하지 않는 예약"이 만들어진다. 스케줄러는
// scheduled_time을 현재 HH:MM과 문자열로 비교하므로 '99:99'는 영원히 일치하지 않고,
// repeat_weekdays가 요일 배열이 아니면 실행 요일 판정에서 걸러진다.
// 직원 입장에선 "분명히 등록했는데 방송이 안 나가는" 상황이라 조용한 실패가 가장 나쁘다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_schedvalid_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const schedulesRoutes = require('../routes/schedules')

let app

test.before(async () => {
  initDB()
  // 스모크가 BGM 볼륨까지 보려면 곡이 있어야 한다 — 빈 폴더면 resolveBGM 이 null 이다(2026-09-21)
  require('./helpers/localBgmFixture').로컬BGM심기(require('../db/schema').getDB())
  app = await startTestApp({ '/api/schedules': schedulesRoutes })
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

const base = {
  title: '검증 테스트', target: '전체', broadcast_type: 'text', content: '안내드립니다',
  scheduled_time: '10:00', repeat_start_date: '2026-08-27', repeat_weekdays: [1],
}

test('시간 형식이 잘못되면 400 — 저장되면 영원히 발동하지 않는 예약이 된다', async () => {
  for (const bad of ['99:99', '25:00', '10:70', 'abc', '', '1030']) {
    const r = await post('/api/schedules', { ...base, scheduled_time: bad })
    assert.equal(r.status, 400, `"${bad}"은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('정상 시간은 그대로 저장된다', async () => {
  for (const good of ['00:00', '09:05', '23:59']) {
    const r = await post('/api/schedules', { ...base, scheduled_time: good })
    assert.equal(r.status, 200, `"${good}"은 저장되어야 한다`)
  }
})

test('repeat_weekdays가 배열이 아니면 400', async () => {
  const r = await post('/api/schedules', { ...base, repeat_weekdays: 'everyday' })
  assert.equal(r.status, 400)
})

test('repeat_weekdays에 0~6 범위를 벗어난 값이 있으면 400', async () => {
  for (const bad of [[9], [-1], [1, 7], ['월']]) {
    const r = await post('/api/schedules', { ...base, repeat_weekdays: bad })
    assert.equal(r.status, 400, `${JSON.stringify(bad)}은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('빈 배열(1회성)과 정상 요일 배열은 허용된다', async () => {
  assert.equal((await post('/api/schedules', { ...base, repeat_weekdays: [] })).status, 200)
  assert.equal((await post('/api/schedules', { ...base, repeat_weekdays: [0, 6] })).status, 200)
})

test('POST /api/schedules/parse-phrase — 문자열이 아닌 text는 500이 아니라 400', async () => {
  for (const bad of [123, ['a'], { a: 1 }, null]) {
    const r = await post('/api/schedules/parse-phrase', { text: bad })
    assert.equal(r.status, 400, `${JSON.stringify(bad)} → 400이어야 한다(실제 ${r.status})`)
  }
})

// ── 방송 유형 검증 (server/domain/ontology.js) ────────────────
// 자연어 예약이 text 말고 다른 유형도 만들 수 있게 되면서, 여기가 실제로 닿는 경로가 됐다.
test('재생할 파일이 없는 음원·영상 예약은 400 — 저장되면 그 시각에 조용히 아무 소리도 안 난다', async () => {
  for (const type of ['audio', 'video', 'youtube-tv']) {
    const r = await post('/api/schedules', { ...base, broadcast_type: type, content: '' })
    assert.equal(r.status, 400, `${type}은 파일 없이 거부되어야 한다(실제 ${r.status})`)
  }
})

test('알 수 없는 방송 유형은 400', async () => {
  for (const bad of ['tts', 'TEXT', 'chime2', '아무거나']) {
    const r = await post('/api/schedules', { ...base, broadcast_type: bad })
    assert.equal(r.status, 400, `"${bad}"은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('차임벨·BGM 예약은 읽을 문구가 없어도 저장된다', async () => {
  for (const type of ['chime', 'bgm']) {
    const r = await post('/api/schedules', { ...base, broadcast_type: type, content: '' })
    assert.equal(r.status, 200, `${type}은 내용 없이도 저장되어야 한다(실제 ${r.status} ${JSON.stringify(r.body)})`)
  }
})

test('스모크: "차임벨 울려줘" 한 문장이 차임벨 예약까지 도달한다', async () => {
  // 이 경로 전체(문장 → 파싱 → 저장)가 예전엔 broadcast_type을 'text'로만 만들어서,
  // 차임벨이 울리는 대신 TTS가 "차임벨 울려줘"를 그대로 읽었다.
  const parsed = await post('/api/schedules/parse-phrase', { text: '저녁 6시에 차임벨 울려줘' })
  assert.equal(parsed.status, 200)
  assert.equal(parsed.body.broadcast_type, 'chime')

  const saved = await post('/api/schedules', {
    ...base, ...parsed.body, target: '전체', content: parsed.body.content || '',
  })
  assert.equal(saved.status, 200, `저장되어야 한다(실제 ${saved.status} ${JSON.stringify(saved.body)})`)

  const { getDB } = require('../db/schema')
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(saved.body.id)
  assert.equal(row.broadcast_type, 'chime')
  assert.equal(row.scheduled_time, '18:00')
})

test('스모크: 저장된 흐름 이름을 부르면 flow 예약까지 도달한다', async () => {
  const { getDB } = require('../db/schema')
  const now = new Date().toISOString()
  const flowId = Number(
    getDB().prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('아침 방송', now, now).lastInsertRowid
  )

  const parsed = await post('/api/schedules/parse-phrase', { text: '내일 오전 8시에 아침 방송 흐름 실행해줘' })
  assert.equal(parsed.status, 200)
  assert.equal(parsed.body.broadcast_type, 'flow')
  assert.equal(parsed.body.flow_sequence_id, flowId, '라우트가 DB의 흐름 목록을 파서에 넘겨야 한다')

  const saved = await post('/api/schedules', { ...base, ...parsed.body, content: '' })
  assert.equal(saved.status, 200, `저장되어야 한다(실제 ${saved.status} ${JSON.stringify(saved.body)})`)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(saved.body.id)
  assert.equal(row.broadcast_type, 'flow')
  assert.equal(row.flow_sequence_id, flowId)
})

test('흐름 예약인데 흐름이 지정 안 되면 400', async () => {
  const r = await post('/api/schedules', { ...base, broadcast_type: 'flow', content: '', flow_sequence_id: null })
  assert.equal(r.status, 400)
})

// ── 예약별 BGM 볼륨 (2026-08-28) ──────────────────────────────
// 전역 설정을 바꿨다가 되돌리는 대신, 이 예약에만 실리는 값으로 둔다 — 되돌릴 상태가 없다.
test('BGM 볼륨을 예약에 저장하면 그 값이 그대로 남는다', async () => {
  const { getDB } = require('../db/schema')
  const r = await post('/api/schedules', { ...base, bgm_enabled: 1, bgm_volume: 30 })
  assert.equal(r.status, 200)
  assert.equal(getDB().prepare('SELECT bgm_volume FROM schedules WHERE id = ?').get(r.body.id).bgm_volume, 30)
})

test('BGM 볼륨을 비워두면 NULL로 저장된다(= 시스템 기본값 사용)', async () => {
  const { getDB } = require('../db/schema')
  for (const empty of [undefined, null, '']) {
    const r = await post('/api/schedules', { ...base, bgm_volume: empty })
    assert.equal(r.status, 200)
    assert.equal(getDB().prepare('SELECT bgm_volume FROM schedules WHERE id = ?').get(r.body.id).bgm_volume, null)
  }
})

test('0은 무음이라는 유효한 값이라 NULL로 지워지면 안 된다', async () => {
  const { getDB } = require('../db/schema')
  const r = await post('/api/schedules', { ...base, bgm_enabled: 1, bgm_volume: 0 })
  assert.equal(r.status, 200)
  assert.equal(getDB().prepare('SELECT bgm_volume FROM schedules WHERE id = ?').get(r.body.id).bgm_volume, 0)
})

test('범위를 벗어나거나 숫자가 아닌 BGM 볼륨은 400', async () => {
  for (const bad of [-1, 101, 'abc', {}, []]) {
    const r = await post('/api/schedules', { ...base, bgm_volume: bad })
    assert.equal(r.status, 400, `${JSON.stringify(bad)}은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('스모크: "볼륨은 잔잔하게" 한 문장이 예약별 BGM 볼륨까지 도달한다', async () => {
  const { getDB } = require('../db/schema')
  const { writeVolumes, readVolume } = require('../domain/volume')
  writeVolumes(getDB(), { bgm: 70 })   // 시스템 기본값

  const parsed = await post('/api/schedules/parse-phrase', {
    text: '오후 두시에 프로그램 안내해주고, 볼륨은 잔잔하게 시작해줘',
  })
  assert.equal(parsed.status, 200)
  assert.ok(parsed.body.bgm_volume > 0 && parsed.body.bgm_volume < 70,
    `정성어가 수치로 바뀌어야 한다(실제 ${parsed.body.bgm_volume})`)

  const saved = await post('/api/schedules', { ...base, ...parsed.body, bgm_enabled: 1 })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(saved.body.id)
  assert.equal(row.bgm_volume, parsed.body.bgm_volume)
  assert.equal(row.scheduled_time, '14:00')

  // 핵심 — 시스템 기본값은 건드리지 않는다(되돌릴 상태를 만들지 않는다)
  assert.equal(readVolume(getDB(), 'bgm'), 70)

  // 그 예약이 발동할 때만 그 볼륨이 실린다
  const { resolveBGM } = require('../services/scheduler')
  const resolved = await resolveBGM(getDB(), { ...row, bgm_type: 'url', bgm_value: 'abc123' })
  assert.equal(resolved.bgmDefault, row.bgm_volume)
})

test('주 소리 볼륨도 저장·검증된다', async () => {
  const { getDB } = require('../db/schema')
  const ok = await post('/api/schedules', { ...base, main_volume: 45 })
  assert.equal(ok.status, 200)
  assert.equal(getDB().prepare('SELECT main_volume FROM schedules WHERE id = ?').get(ok.body.id).main_volume, 45)

  for (const bad of [-1, 101, 'abc', {}, []]) {
    const r = await post('/api/schedules', { ...base, main_volume: bad })
    assert.equal(r.status, 400, `${JSON.stringify(bad)}은 거부되어야 한다(실제 ${r.status})`)
  }
})

// ── 볼륨 왕복 (화면에서 만지고 저장해도 값이 살아 있어야 한다) ─
test('PUT으로 수정해도 볼륨이 그대로 남는다', async () => {
  const { getDB } = require('../db/schema')
  const created = await post('/api/schedules', { ...base, main_volume: 40, bgm_enabled: 1, bgm_volume: 20 })
  assert.equal(created.status, 200)

  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(created.body.id)
  const r = await fetch(app.baseUrl + `/api/schedules/${created.body.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    // 화면(ScheduleModal/MorningEditor)이 하듯 기존 행 전체를 얹어 보낸다
    body: JSON.stringify({ ...row, repeat_weekdays: [1], title: '이름만 바꿈' }),
  })
  assert.equal(r.status, 200)
  const after = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(created.body.id)
  assert.equal(after.title, '이름만 바꿈')
  assert.equal(after.main_volume, 40)
  assert.equal(after.bgm_volume, 20)
})

test('"시스템 기본값 사용"으로 되돌리면 NULL이 된다', async () => {
  const { getDB } = require('../db/schema')
  const created = await post('/api/schedules', { ...base, main_volume: 40 })
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(created.body.id)
  const r = await fetch(app.baseUrl + `/api/schedules/${created.body.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...row, repeat_weekdays: [1], main_volume: null }),
  })
  assert.equal(r.status, 200)
  assert.equal(getDB().prepare('SELECT main_volume FROM schedules WHERE id = ?').get(created.body.id).main_volume, null)
})

test('0(무음)은 "기본값 사용"으로 잘못 해석되지 않는다', async () => {
  const { getDB } = require('../db/schema')
  const created = await post('/api/schedules', { ...base, main_volume: 0, bgm_enabled: 1, bgm_volume: 0 })
  assert.equal(created.status, 200)
  const row = getDB().prepare('SELECT main_volume, bgm_volume FROM schedules WHERE id = ?').get(created.body.id)
  assert.equal(row.main_volume, 0)
  assert.equal(row.bgm_volume, 0)
})

// ── 라우트가 일과방송 시각을 실제로 넘겨주는가 ────────────────
test('스모크: parse-phrase가 켜져 있는 일과방송과의 겹침을 알린다', async () => {
  const { getDB } = require('../db/schema')
  const put = (k, v) => getDB()
    .prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(k, v)

  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')
  const hit = await post('/api/schedules/parse-phrase', { text: '내일 오전 11시 15분 면회 안내' })
  assert.equal(hit.status, 200)
  assert.ok(hit.body.ambiguous.includes('overlaps_auto'), '라우트가 일과방송 시각을 파서에 넘겨야 한다')
  assert.equal(hit.body.auto_overlaps[0].label, '점심 식사 전 방송')

  // 꺼두면 경고가 사라져야 한다 — 안 나가는 방송으로 잔소리하면 안 된다
  put('lunch_broadcast_enabled', 'false')
  const off = await post('/api/schedules/parse-phrase', { text: '내일 오전 11시 15분 면회 안내' })
  assert.ok(!off.body.ambiguous.includes('overlaps_auto'))
})

test('스모크: 지난 시각으로 말해도 발동하지 않는 예약이 만들어지지 않는다', async () => {
  const { getDB } = require('../db/schema')
  const { shouldRunToday } = require('../services/repeatSchedule')

  // **"지난 시각" 을 지금 기준으로 만든다.** 예전엔 `오전 12시 1분` 을 박아 두고
  // "00:01 은 늘 지났다" 고 가정했는데, **00:00~00:01 사이에는 그것이 거짓**이다 —
  // 2026-09-12 00:01 에 실제로 빨간불이 났다(EV-004758). 제품이 아니라 **테스트의
  // 전제가 하루 중 1분 동안 틀린** 것이었다. 시계에 기대는 테스트는 그 시각에만 거짓말한다.
  const 두분전 = new Date(Date.now() - 2 * 60 * 1000)
  const h24 = 두분전.getHours()
  const 오전오후 = h24 < 12 ? '오전' : '오후'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const 지난시각문구 = `오늘 ${오전오후} ${h12}시 ${두분전.getMinutes()}분 면회 안내`
  const parsed = await post('/api/schedules/parse-phrase', { text: 지난시각문구 })
  assert.equal(parsed.status, 200)
  const saved = await post('/api/schedules', { ...base, ...parsed.body, content: '면회 안내' })
  assert.equal(saved.status, 200)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(saved.body.id)

  // 오늘 00:01은 이미 지났으므로 내일로 옮겨져 있어야 하고, 1회성이라도 살아 있어야 한다
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  assert.notEqual(row.repeat_start_date, todayStr, '오늘로 남으면 영원히 발동하지 않는다')
  assert.equal(shouldRunToday(row), false, '내일 것이므로 오늘은 대상이 아니다')
})

// ── 날짜도 같은 구멍이다 (2026-09-17 브라우저 전수 시험) ─────────────────────────────────────────
// 종료일이 시작일보다 앞이거나 없는 날짜(2026-13-45)면 **저장은 200 인데 영원히 안 나간다.** 실측으로 셋 다 저장됐다.
test('반복 날짜가 없는 날이거나 종료일이 시작일보다 앞이면 400 — 저장되면 영원히 안 나간다', async () => {
  for (const [이름, 바꿈] of [
    ['없는 달·날', { repeat_start_date: '2026-13-45' }],
    ['없는 날(2월 30일)', { repeat_start_date: '2026-02-30' }],
    ['형식 틀림', { repeat_start_date: '2026/09/20' }],
    ['종료일 형식 틀림', { repeat_end_date: '20260930' }],
    ['종료일이 시작일보다 앞', { repeat_start_date: '2026-09-20', repeat_end_date: '2026-09-10' }],
  ]) {
    const r = await post('/api/schedules', { ...base, ...바꿈 })
    assert.equal(r.status, 400, `${이름}은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('정상 날짜는 그대로 저장된다 — 종료일 없음·같은 날·빈 문자열', async () => {
  for (const 바꿈 of [
    { repeat_end_date: null }, { repeat_end_date: '' },
    { repeat_start_date: '2026-09-20', repeat_end_date: '2026-09-20' },
    { repeat_start_date: '2028-02-29', repeat_end_date: '2028-03-01' },
  ]) {
    const r = await post('/api/schedules', { ...base, ...바꿈 })
    assert.equal(r.status, 200, `${JSON.stringify(바꿈)} 는 저장되어야 한다(실제 ${r.status} ${JSON.stringify(r.body)})`)
  }
})
