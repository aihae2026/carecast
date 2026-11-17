// 제미나이 모델 자동 선택 (2026-10-23 사용자 요청).
//
// *"현장은 2.5 에서 고정이 되어 있어서 난감했었어, 자동으로 따라 가게끔"*.
// 고정 경로(설정 화면이 기본 이름을 박음)와 처방은 domain/geminiModel.js 머리말에 있다.
'use strict'

process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_gemini_auto_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const { getDB, initDB } = require('../db/schema')
const gm   = require('../domain/geminiModel')
const auto = require('../services/geminiModelAuto')

initDB()
const db = getDB()
const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v))
const del = (k) => db.prepare('DELETE FROM settings WHERE key = ?').run(k)
const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null
const 비우기 = () => { for (const k of ['gemini_model', 'gemini_model_auto', 'gemini_model_auto_at',
  'gemini_model_auto_probe_ms', 'gemini_model_before_auto', 'gemini_api_key']) del(k) }

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.CARECAST_DB_PATH + s) } catch { /* 없으면 그만 */ } }
})
test.beforeEach(() => { 비우기(); auto._resetForTest() })

// ── 고르기 ───────────────────────────────────────────────────
test('가장 최신 **정식** Flash 를 고른다 — preview·lite·exp·숫자 접미·별칭은 뺀다', () => {
  assert.equal(gm.pickLatestFlash([
    'models/gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.9-flash-001', 'gemini-4.1-flash-preview-05',
    'gemini-4.0-flash-lite', 'gemini-flash-latest', 'gemini-4.5-pro', 'gemini-4-flash-exp',
  ]), 'gemini-3.8-flash')
})
test('버전은 숫자로 비교한다 — 3.10 이 3.9 보다 새것, 4 는 4.0', () => {
  assert.equal(gm.pickLatestFlash(['gemini-3.9-flash', 'gemini-3.10-flash']), 'gemini-3.10-flash')
  assert.equal(gm.pickLatestFlash(['gemini-3.9-flash', 'gemini-4-flash']), 'gemini-4-flash')
})
test('고를 것이 없으면 null', () => {
  assert.equal(gm.pickLatestFlash([]), null)
  assert.equal(gm.pickLatestFlash(['gemini-4.5-pro']), null)
  assert.equal(gm.pickLatestFlash(null), null)
})

// ── 지금 부를 모델 ───────────────────────────────────────────
test('설정이 비었거나 auto 면 자동으로 고른 값, 그것도 없으면 코드 기본값', () => {
  assert.equal(gm.currentGeminiModel(db), gm.DEFAULT_GEMINI_MODEL)
  set('gemini_model_auto', 'gemini-3.8-flash')
  assert.equal(gm.currentGeminiModel(db), 'gemini-3.8-flash')
  set('gemini_model', 'auto')
  assert.equal(gm.currentGeminiModel(db), 'gemini-3.8-flash')
})
test('사람이 이름을 넣었으면 그 이름 — 자동을 끈 것이다', () => {
  set('gemini_model_auto', 'gemini-3.8-flash')
  set('gemini_model', 'gemini-4.5-pro')
  assert.equal(gm.currentGeminiModel(db), 'gemini-4.5-pro')
})

// ── 자동 선택 갱신 ───────────────────────────────────────────
test('새 후보는 시험 호출이 통과해야 채택한다', async () => {
  set('gemini_api_key', 'k')
  const r = await auto.refreshAutoModel({ db, listFn: async () => ({ models: ['gemini-3.8-flash'] }), probeFn: async () => 1234 })
  assert.match(r, /gemini-3\.8-flash/)
  assert.equal(get('gemini_model_auto'), 'gemini-3.8-flash')
  assert.equal(get('gemini_model_auto_probe_ms'), '1234')
  assert.ok(get('gemini_model_auto_at'))
})
test('시험 호출이 실패하면 지금 값을 그대로 둔다', async () => {
  set('gemini_api_key', 'k'); set('gemini_model_auto', 'gemini-3.7-flash')
  await auto.refreshAutoModel({ db, listFn: async () => ({ models: ['gemini-3.8-flash'] }), probeFn: async () => null })
  assert.equal(get('gemini_model_auto'), 'gemini-3.7-flash')
})
test('목록을 못 받아도 지금 값을 그대로 둔다', async () => {
  set('gemini_api_key', 'k'); set('gemini_model_auto', 'gemini-3.7-flash')
  await auto.refreshAutoModel({ db, listFn: async () => ({ models: [], reason: '403' }), probeFn: async () => 1 })
  assert.equal(get('gemini_model_auto'), 'gemini-3.7-flash')
})
test('API 키가 없으면 구글을 부르지 않는다', async () => {
  let 불림 = false
  const r = await auto.refreshAutoModel({ db, listFn: async () => { 불림 = true; return { models: [] } } })
  assert.equal(불림, false); assert.match(r, /키 없음/)
})
test('던지지 않는다 — 목록 조회가 터져도', async () => {
  set('gemini_api_key', 'k')
  const r = await auto.refreshAutoModel({ db, listFn: async () => { throw new Error('boom') } })
  assert.match(r, /실패/)
})

// ── 모델이 없어졌다(404) ─────────────────────────────────────
test('자동일 때 404 면 다시 고른다 — 10분에 한 번까지', () => {
  let 횟수 = 0
  const refresh = async () => { 횟수++; return 'ok' }
  let t = 1_000_000
  auto.onModelMissing('gemini-3.7-flash', { db, now: () => t, refresh, raise: () => {} })
  auto.onModelMissing('gemini-3.7-flash', { db, now: () => t + 60_000, refresh, raise: () => {} })
  assert.equal(횟수, 1)
  auto.onModelMissing('gemini-3.7-flash', { db, now: () => t + 11 * 60_000, refresh, raise: () => {} })
  assert.equal(횟수, 2)
})
test('사람이 넣은 모델이 없어지면 바꾸지 않고 알린다 — 하루 한 번', () => {
  set('gemini_model', 'gemini-2.5-flash')
  const 경보 = []
  const raise = (k, m) => 경보.push(m)
  const now = () => Date.parse('2026-10-23T03:00:00Z')
  auto.onModelMissing('gemini-2.5-flash', { db, now, raise, refresh: async () => assert.fail('명시값을 몰래 바꾸면 안 된다') })
  auto.onModelMissing('gemini-2.5-flash', { db, now, raise })
  assert.equal(경보.length, 1)
  assert.match(경보[0], /자동으로 최신 모델 쓰기/)
  assert.equal(get('gemini_model'), 'gemini-2.5-flash', '저장값은 그대로')
})

test('래퍼는 generateContent 404 를 모델 이름으로 신고하고, 응답은 그대로 돌려준다(다시 보내지 않는다)', async () => {
  const client = require('../services/geminiClient')
  const 원래fetch = global.fetch
  let 보낸횟수 = 0
  global.fetch = async () => { 보낸횟수++; return new Response('{"error":{"message":"not found"}}', { status: 404 }) }
  const 신고 = []
  client.setModelMissingHandler(m => 신고.push(m))
  try {
    const res = await client.fetchGeminiWithRetry(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"contents":[]}' })
    assert.equal(res.status, 404)
    await new Promise(r => setImmediate(r))
    assert.deepEqual(신고, ['gemini-2.5-flash'])
    assert.equal(보낸횟수, 1, '다른 모델로 몰래 다시 보내면 화면의 모델과 실제가 갈린다')
  } finally {
    global.fetch = 원래fetch
    client.setModelMissingHandler(null)
  }
})

// ── 고정을 풀고, 다시 고정되지 않게 ───────────────────────────
test('1회성 보정: 고정된 flash 값은 auto 로, 원래 값은 보관', () => {
  const fix = require('../config/dataFixes').DATA_FIXES.find(f => f.key === 'datafix_gemini_model_auto_20261023')
  assert.ok(fix, '보정이 등록돼 있다')
  set('gemini_model', 'gemini-2.5-flash')
  const 결과 = fix.run(db)
  assert.equal(get('gemini_model'), 'auto')
  assert.equal(get('gemini_model_before_auto'), 'gemini-2.5-flash')
  assert.match(결과[0], /gemini-2\.5-flash → auto/)
})
test('1회성 보정: pro·preview 처럼 일부러 고른 이름은 그대로', () => {
  const fix = require('../config/dataFixes').DATA_FIXES.find(f => f.key === 'datafix_gemini_model_auto_20261023')
  for (const v of ['gemini-4.5-pro', 'gemini-4.1-flash-preview-05', 'gemini-3.8-flash-lite']) {
    set('gemini_model', v); del('gemini_model_before_auto')
    assert.deepEqual(fix.run(db), [])
    assert.equal(get('gemini_model'), v)
  }
})

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('호출부는 gemini_model 을 직접 읽지 않는다 — auto 가 모델 이름으로 나간다', () => {
  for (const f of ['server/routes/ai.js', 'server/routes/audio.js', 'server/routes/schedules.js', 'server/routes/scheduleDrafts.js']) {
    const src = read(f)
    assert.doesNotMatch(src, /(getSetting|rawSetting)\([^)]*'gemini_model'\)/, `${f} 가 gemini_model 을 직접 읽는다 — currentGeminiModel 을 쓸 것`)
  }
})
test('설정 저장은 빈 값을 기본 모델 이름으로 박지 않는다 — 그게 고정의 원인이었다', () => {
  const s = read('server/routes/settings.js')
  assert.doesNotMatch(s, /geminiModel\.trim\(\) \|\| DEFAULT_GEMINI_MODEL/)
  assert.match(s, /isAutoModel\(geminiModel\) \? AUTO/)
  const ui = read('src/components/admin/sections/apiSettingsAI.jsx')
  assert.match(ui, /saveGeminiModel\(auto \? 'auto' : geminiModel\)/, '화면이 자동일 때 auto 를 안 보낸다')
})
test('새 키는 현장 기초값 추출에서 빠진다 — PC 마다 다르고 썩는다', () => {
  const b = read('scripts/make-site-baseline.cjs')
  for (const k of ['gemini_model_auto', 'gemini_model_auto_at', 'gemini_model_auto_probe_ms', 'gemini_model_before_auto']) {
    assert.ok(b.includes(`'${k}'`), `${k} 가 제외 목록에 없다`)
  }
})

// ── 검수 지적 (2026-10-23) ──────────────────────────────────
test('[High] 목록을 끝 쪽까지 받는다 — 최신이 2쪽에 있어도 고른다', async () => {
  const 원래fetch = global.fetch
  const 부른주소 = []
  global.fetch = async (url) => {
    부른주소.push(String(url))
    const 둘째 = String(url).includes('pageToken=p2')
    const body = 둘째
      ? { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }
      : { models: [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'p2' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const { models } = await auto.listGenerateModels('k')
    assert.deepEqual(models, ['gemini-3.7-flash', 'gemini-3.8-flash'])
    assert.equal(부른주소.length, 2)
    assert.match(부른주소[0], /pageSize=/)
  } finally { global.fetch = 원래fetch }
})
test('[High] 중간 쪽에서 실패하면 반쪽 목록으로 고르지 않는다', async () => {
  const 원래fetch = global.fetch
  let n = 0
  global.fetch = async () => (++n === 1
    ? new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'p2' }), { status: 200 })
    : new Response('{"error":{"message":"denied"}}', { status: 403 }))
  try {
    const r = await auto.listGenerateModels('k')
    assert.deepEqual(r.models, [])
    assert.ok(r.reason)
  } finally { global.fetch = 원래fetch }
})
test('[High] 지금 모델이 목록에 남아 있으면 더 낮은 판으로 내려가지 않는다', async () => {
  set('gemini_api_key', 'k'); set('gemini_model_auto', 'gemini-3.8-flash')
  await auto.refreshAutoModel({ db, listFn: async () => ({ models: ['gemini-3.7-flash', 'gemini-3.8-flash-lite', 'gemini-3.8-flash'] }),
    probeFn: async () => assert.fail('내려갈 후보를 시험하면 안 된다') })
  assert.equal(get('gemini_model_auto'), 'gemini-3.8-flash')
})
test('[High] 지금 모델을 구글이 닫았으면 낮은 판으로도 옮긴다', async () => {
  set('gemini_api_key', 'k'); set('gemini_model_auto', 'gemini-3.9-flash')
  await auto.refreshAutoModel({ db, listFn: async () => ({ models: ['gemini-3.8-flash'] }), probeFn: async () => 10 })
  assert.equal(get('gemini_model_auto'), 'gemini-3.8-flash')
})
test('[Low] 모델을 직접 골라 두었으면 고르지 않는다 — 안 쓰는 모델을 시험 호출하지 않는다', async () => {
  set('gemini_api_key', 'k'); set('gemini_model', 'gemini-4.5-pro')
  let 불림 = false
  const r = await auto.refreshAutoModel({ db, listFn: async () => { 불림 = true; return { models: ['gemini-3.8-flash'] } } })
  assert.equal(불림, false); assert.match(r, /직접 골라/)
})

// ── QA 지적 (2026-10-23) ────────────────────────────────────
test('[QA] 모델 이름은 모델 이름 글자만 받는다 — URL 경로에 그대로 들어간다', () => {
  const s = read('server/routes/settings.js')
  assert.match(s, /\/\^\[A-Za-z0-9\._-\]\+\$\/\.test\(String\(geminiModel\)\.trim\(\)\)/)
})
test('[QA] 저장하면 위쪽 「기본 AI 제공자」 카드도 다시 읽는다 — 한 화면에 모델 이름이 둘로 갈리지 않게', () => {
  const ui = read('src/components/admin/sections/apiSettingsAI.jsx')
  assert.match(ui, /dispatchEvent\(new Event\('carecast:ai-settings-saved'\)\)/)
  assert.match(ui, /addEventListener\('carecast:ai-settings-saved', 읽기\)/)
})
test('[QA] 체크만 켜고 저장 전에는 옛 모델을 「지금:」으로 보여 주지 않는다', () => {
  const ui = read('src/components/admin/sections/apiSettingsAI.jsx')
  assert.match(ui, /auto && savedAuto && resolvedModel/)
})
