'use strict'
// **방송 화면 글자 — 크기 설정 · 세로 위치 · 줄바꿈** (사용자 지시 2026-09-16, 사진 1장).
//
// *"그 방송화면에 자막 크기 설정할 수 있게 끔 하게 해줘, 설정에서 크게, 중간, 작게.
//   그리고 자막이 너무 상단으로 올라온 것 같지 않아? 중간쯤 위치해야지, 그리고 저렇게
//   화면에 따라 줄틀어지는거 안예쁘잖아"*
//
// 사진의 문제는 셋이었다:
//   ① 크기를 고를 길이 없다
//   ② 글자 덩어리가 화면 위쪽에 붙었다 — 09-13 에 정한 「16vh 들어올림」이 글자를
//      1.5배로 키운(09-15) 뒤에는 너무 많았다
//   ③ 「함께하는 하루, 즐거 / 운 동행」 꼴 — 한국어 기본 줄바꿈이 **글자 단위**라 낱말 한가운데서 끊겼다
//
// DB 는 임시 파일이다. 방송·장치는 안 건드린다(설정 저장과 SSE 알림뿐).

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_textsize_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB }       = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const settingsRoutes   = require('../routes/settings')
const 서버글자         = require('../domain/broadcastTextSize')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 주석은 걷고 본다 — 이 저장소 주석은 고친 옛 코드(16vh 등)를 그대로 인용한다.
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const get  = async (p) => { const r = await fetch(app.baseUrl + p); return { status: r.status, body: await r.json() } }
const post = async (p, body) => {
  const r = await fetch(app.baseUrl + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

// ── ① 저장 ─────────────────────────────────────────────────────────────────
test('**처음에는 「크게」다** — 설정을 넣었다고 이미 쓰던 화면이 작아지면 안 된다', async () => {
  const r = await get('/api/settings/org')
  assert.equal(r.status, 200)
  assert.equal(r.body.textSize, 'large')
})

test('**「중간」을 고르면 저장되고 다시 읽힌다**', async () => {
  const w = await post('/api/settings/org', { textSize: 'medium' })
  assert.equal(w.status, 200)
  assert.equal(w.body.textSize, 'medium')
  assert.equal((await get('/api/settings/org')).body.textSize, 'medium')
})

test('**모르는 값은 거절한다** — 조용히 기본값으로 바꿔 저장하면 사람은 고른 줄 안다', async () => {
  await post('/api/settings/org', { textSize: 'small' })
  const w = await post('/api/settings/org', { textSize: 'huge' })
  assert.equal(w.status, 400)
  assert.equal((await get('/api/settings/org')).body.textSize, 'small', '거절했는데 값이 바뀌었다')
})

test('**크기를 안 보내면 그대로다** — 문구만 저장해도 크기가 되돌아가지 않는다(P-115)', async () => {
  await post('/api/settings/org', { textSize: 'medium' })
  await post('/api/settings/org', { name: '시험 기관' })
  assert.equal((await get('/api/settings/org')).body.textSize, 'medium')
})

test('**저장하면 SSE 로 크기까지 싣는다** — 다른 PC 의 홀 화면이 바로 바뀌어야 한다', () => {
  const src = 코드만(읽기('server/routes/settings.js'))
  assert.match(src, /broadcastSSE\('org_info', \{ name, slogan, textSize \}\)/,
    '알림에 크기를 안 싣는다 — 저장해도 홀 화면이 새로고침 전까지 옛 크기다')
})

// ── 두 목록 대조 ────────────────────────────────────────────────────────────
test('**서버가 받는 이름과 화면이 아는 이름이 같다**', () => {
  const 화면 = require('../../src/lib/broadcastTextSize.js')
  assert.deepEqual(화면.글자크기들.map(x => x.id), 서버글자.크기들,
    '서버와 화면의 크기 목록이 다르다 — 저장은 되는데 화면이 모르는 값이 생긴다')
  assert.equal(화면.기본글자크기, 서버글자.기본)
})

test('**「크게」는 지금 크기이고, 아래로만 줄인다**', () => {
  const { 글자배율 } = require('../../src/lib/broadcastTextSize.js')
  assert.equal(글자배율('large'), 1, '「크게」가 1 이 아니다 — 설정을 안 건드린 화면이 바뀐다')
  assert.ok(글자배율('medium') < 1 && 글자배율('small') < 글자배율('medium'), '크기 순서가 뒤집혔다')
  // **위로 키우지 않는다.** 자막은 한 줄 글자 수(MAX_CHARS)와 짝이라, 글씨만 키우면 넘친다.
  assert.equal(글자배율('모르는값'), 1, '모르는 값을 1 이 아닌 배율로 읽는다')
})

// ── 화면이 실제로 쓰는가 ────────────────────────────────────────────────────
test('**표어·기관 이름에 배율과 낱말 줄바꿈이 둘 다 걸린다**', () => {
  const src = 코드만(읽기('src/components/broadcast/BroadcastIndicators.jsx'))
  const 걸린수 = (src.match(/\.\.\.방송글자줄바꿈, fontSize: 크기곱\([^)]*\)[^,]*, 글자배율\(org\.textSize\)\)/g) || []).length
  assert.equal(걸린수, 2, `표어·기관 이름 중 ${걸린수}줄만 걸렸다 — 한 줄만 크기가 바뀌거나 낱말 중간에서 끊긴다`)
})

test('**낱말 한가운데서 안 끊는다** — keep-all · balance', () => {
  const { 방송글자줄바꿈 } = require('../../src/lib/broadcastTextSize.js')
  assert.equal(방송글자줄바꿈.wordBreak, 'keep-all', '글자 단위로 끊는다 — 「아름 / 다운」 이 된다')
  assert.equal(방송글자줄바꿈.textWrap, 'balance', '줄 길이를 안 맞춘다 — 한 줄만 길고 뒤에 두 글자가 남는다')
})

test('**글자 덩어리가 거의 가운데다** — 16vh 들어올림으로 돌아가지 않는다', () => {
  const src = 코드만(읽기('src/components/broadcast/BroadcastIndicators.jsx'))
  const m = /justify-center[\s\S]{0,120}?pb-\[(\d+)vh\]/.exec(src)
  assert.ok(m, '긍정 앵커 — 방송 화면 틀의 아래 여백을 못 찾았다')
  assert.ok(Number(m[1]) <= 8, `아래 여백이 ${m[1]}vh 다 — 글자가 화면 위쪽에 붙는다(사용자 지적 2026-09-16)`)
})

test('**자막도 같은 설정을 따른다** — 표어만 작아지고 자막은 그대로면 한 화면이 따로 논다', () => {
  const src = 코드만(읽기('src/components/broadcast/BroadcastCaption.jsx'))
  assert.match(src, /const 사용자배율 = useBroadcastTextScale\(\)/, '자막이 설정을 안 읽는다')
  assert.match(src, /const 배율 = scale \* 사용자배율/, '미리보기 배율과 사용자 배율을 안 곱한다')
  assert.doesNotMatch(src, /sized\((CUR|SIDE)_SIZE, scale\)/, '설정을 무시하고 미리보기 배율만 쓰는 자리가 남았다')
  // 기준 상수는 그대로다 — MAX_CHARS 와 짝(caption-size-pairing.test.js 가 그 짝을 본다)
  assert.match(src, /const CUR_SIZE {2}= 'clamp\(3rem, 11vw, 8\.5rem\)'/, '기준 크기 상수를 바꿨다 — MAX_CHARS 짝이 깨진다')
})

test('**설정 화면이 크기를 함께 저장한다**', () => {
  const src = 코드만(읽기('src/components/admin/sections/systemSettingsBroadcast.jsx'))
  assert.match(src, /saveOrgInfo\(\{ name: orgName, slogan: orgSlogan, textSize: orgTextSize \}\)/,
    '고른 크기를 저장 요청에 안 싣는다 — 눌러도 아무 일이 없다')
  assert.match(src, /글자크기들\.map/, '크게·중간·작게 단추를 목록에서 안 만든다')
  assert.doesNotMatch(src, /새로고침해야 반영/, '틀린 안내가 남았다 — 09-13 부터 저장하면 바로 반영된다')
})
