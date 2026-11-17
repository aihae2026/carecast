// Azure 음성 — 선택 엔진 (사용자 지시 2026-09-21: 기본 Supertonic · 선택 Azure · 마지막 대비 윈도우 음성).
//
// 진짜 Azure 는 부르지 않는다(가짜 fetch). 여기서 고정하는 것:
//   1) 키·지역이 있을 때만, 인터넷 차단 모드가 아닐 때만 차례에 선다 — 순서는 Supertonic 다음.
//   2) 키가 틀리면(401·403) 영구 불가 — 그 방송에서 재시도를 태우지 않는다.
//   3) 키는 오류 문구·GET 응답·설정 이력 어디에도 그대로 나가지 않는다.
//   4) 문장은 SSML 로 이스케이프된다(< & 가 요청을 깨지 않는다).
//   5) 저장 라우트가 헤더를 깰 글자·주소를 깰 지역을 거절한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_azure_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const azure = require('../services/ttsEngines/azure')
const KEY = 'AZ-SECRET-KEY-1234567890'
const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-azure-'))
let app

function 가짜wav(초) {
  const n = Math.round(44100 * 초)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  return b
}
function 가짜fetch(응답) {
  const 기록 = []
  const fn = async (url, init) => { 기록.push({ url, init }); return 응답(url, init) }
  return { fn, 기록 }
}
const 설정 = (k, v) => getDB().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)

test.before(async () => {
  initDB()
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  app = await startTestApp({ '/api/settings': require('../routes/settings'), '/api/tts': require('../routes/tts') })
})
test.after(async () => {
  delete process.env.CARECAST_TTS_ENGINE_IN_TESTS
  delete process.env.CARECAST_NO_NETWORK
  azure.__setFetchForTests(null)
  await app.close()
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 무시 */ } }
  try { fs.rmSync(임시, { recursive: true, force: true }) } catch { /* 무시 */ }
})

test('키·지역이 있을 때만 쓴다 — 인터넷 차단 모드면 빠진다', () => {
  assert.equal(azure.available(), false)
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  assert.equal(azure.available(), true)
  process.env.CARECAST_NO_NETWORK = '1'
  assert.equal(azure.available(), false)
  delete process.env.CARECAST_NO_NETWORK
})

test('엔진 차례 — Supertonic 다음, 윈도우 음성 앞', () => {
  const tts = require('../services/tts')
  const 차례 = tts.엔진차례()
  assert.ok(차례.includes('azure'))
  if (차례.includes('supertonic')) assert.ok(차례.indexOf('supertonic') < 차례.indexOf('azure'))
  if (차례.includes('sapi')) assert.ok(차례.indexOf('azure') < 차례.indexOf('sapi'))
  assert.ok(!차례.includes('edge'), '걷어낸 옛 엔진이 차례에 남았다')
  const 상태 = tts.엔진상태()
  assert.equal(상태.find((e) => e.name === 'azure').ok, true)
})

test('SSML — 문장은 이스케이프, 모양이 틀린 목소리·속도는 안 넣는다', () => {
  const s = azure.ssmlOf({ text: '1 < 2 & "안녕"', voice: 'ko-KR-InJoonNeural', rate: '-10%', pitch: '+0Hz' })
  assert.match(s, /1 &lt; 2 &amp; &quot;안녕&quot;/)
  assert.match(s, /<voice name="ko-KR-InJoonNeural">/)
  assert.match(s, /rate="-10%"/)
  const 나쁜 = azure.ssmlOf({ text: 'x', voice: '"><evil', rate: 'fast"' })
  assert.match(나쁜, /<voice name="ko-KR-SunHiNeural">/)
  assert.doesNotMatch(나쁜, /evil|fast/)
})

test('합성 — WAV 를 받아 쓰고 길이를 돌려준다, 요청은 우리 지역·형식으로', async () => {
  const f = 가짜fetch(async () => new Response(가짜wav(1.5), { status: 200 }))
  azure.__setFetchForTests(f.fn)
  const out = path.join(임시, 'carecast_azure_a.wav')
  const r = await azure.synthesize({ text: '점심 드세요', voice: 'ko-KR-SunHiNeural', rate: '-10%' }, { out })
  assert.ok(Math.abs(r.durationSec - 1.5) < 0.01)
  assert.ok(fs.existsSync(out))
  assert.equal(f.기록[0].url, 'https://koreacentral.tts.speech.microsoft.com/cognitiveservices/v1')
  assert.equal(f.기록[0].init.headers['X-Microsoft-OutputFormat'], 'riff-44100hz-16bit-mono-pcm')
})

test('키가 틀리면(401) 영구 불가 — 오류 문구에 키가 없다', async () => {
  azure.__setFetchForTests(async () => new Response('bad', { status: 401 }))
  await assert.rejects(azure.synthesize({ text: '안녕' }, { out: path.join(임시, 'b.wav') }), (e) => {
    assert.equal(e.permanent, true)
    assert.ok(!e.message.includes(KEY))
    return true
  })
  // 요청 자체가 실패하며 오류에 키가 섞여 와도 지운다
  azure.__setFetchForTests(async () => { throw new Error(`boom ${KEY}`) })
  await assert.rejects(azure.synthesize({ text: '안녕' }, { out: path.join(임시, 'c.wav') }), (e) => !e.message.includes(KEY))
})

test('설정 라우트 — GET 은 키를 가리고, 헤더를 깰 글자·주소를 깰 지역은 거절', async () => {
  const get = await (await fetch(app.baseUrl + '/api/settings/azure-speech')).json()
  assert.equal(get.keySet, true)
  assert.ok(!JSON.stringify(get).includes(KEY), 'GET 응답에 키가 그대로 나갔다')
  assert.match(get.keyMasked, /7890$/)
  const post = async (body) => fetch(app.baseUrl + '/api/settings/azure-speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post({ key: 'abc\ndef' })).status, 400)
  assert.equal((await post({ region: 'korea.central/evil' })).status, 400)
  assert.equal((await post({ key: ['x'] })).status, 400)
  assert.equal((await post({ region: 'KoreaCentral' })).status, 200)
  assert.equal(getDB().prepare("SELECT value FROM settings WHERE key='azure_speech_region'").get().value, 'koreacentral')
  // 설정 이력에는 가려서 남는다
  const 이력 = getDB().prepare("SELECT * FROM settings_history WHERE key='azure_speech_key'").all()
  assert.ok(!JSON.stringify(이력).includes(KEY) || 이력.length === 0, '설정 이력에 키가 그대로 남았다')
  // 빈 키로 저장하면 지운다 → 차례에서 빠진다
  assert.equal((await post({ key: '' })).status, 200)
  assert.equal(azure.available(), false)
})

// ── Codex ④-b 1회차 ──────────────────────────────────────────────────────────────
function 키가있나(e, 본 = new Set()) {
  if (!e || typeof e !== 'object' || 본.has(e)) return false
  본.add(e)
  if (String(e.message ?? '').includes(KEY) || String(e.stack ?? '').includes(KEY)) return true
  return 키가있나(e.cause, 본)
}

test('[High] 얼린 오류·겹친 원인에 키가 있어도 던지는 오류 어디에도 키가 없다', async () => {
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  const 안쪽 = new Error(`inner ${KEY}`)
  const 바깥 = Object.freeze(Object.assign(new Error(`outer ${KEY}`), { cause: 안쪽 }))
  azure.__setFetchForTests(async () => { throw 바깥 })
  await assert.rejects(azure.synthesize({ text: '안녕' }, { out: path.join(임시, 'f1.wav') }), (e) => {
    assert.equal(키가있나(e), false, '오류·원인·스택 어딘가에 키가 남았다')
    return true
  })
})

test('[High] 본문을 받다 끊겨도 키를 지우고 인터넷 실패로 적는다', async () => {
  const netHealth = require('../services/netHealth')
  const 원래 = netHealth.record
  const 기록 = []
  netHealth.record = (ok, 이름) => { 기록.push([ok, 이름]) }
  try {
    azure.__setFetchForTests(async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error(`reset ${KEY}`) } }))
    await assert.rejects(azure.synthesize({ text: '안녕' }, { out: path.join(임시, 'f2.wav') }), (e) => !키가있나(e))
    assert.deepEqual(기록, [[false, '안내음성']])
  } finally { netHealth.record = 원래 }
})

test('[Medium] 머리만 있고 소리 바이트가 없는 WAV 는 실패다', async () => {
  const 머리만 = 가짜wav(1).subarray(0, 44)
  azure.__setFetchForTests(async () => new Response(머리만, { status: 200 }))
  await assert.rejects(azure.synthesize({ text: '안녕' }, { out: path.join(임시, 'f3.wav') }), /비었다/)
  assert.ok(!fs.existsSync(path.join(임시, 'f3.wav')))
})

test('[Medium] 키가 틀린(401) Azure 는 같은 방송의 재시도에서 다시 부르지 않는다', async () => {
  const tts = require('../services/tts')
  let azure불림 = 0
  azure.__setFetchForTests(async () => { azure불림++; return new Response('no', { status: 401 }) })
  tts.__setEngineOrderForTests(() => ['azure', '가짜뒤'], { 가짜뒤: async () => { throw new Error('뒤 엔진 일시 실패') } })
  try {
    const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-azure-retry-'))
    await assert.rejects(tts.generateTTSWithRetry({ text: '재시도 문장', voice: 'v', rate: '+0%', pitch: '+0Hz' }, 2, { cacheDir: 캐시, deadlineMs: 1000 }))
    assert.equal(azure불림, 1, `401 받은 Azure 를 ${azure불림}번 불렀다`)
    fs.rmSync(캐시, { recursive: true, force: true })
  } finally { tts.__setEngineOrderForTests(null) }
})

// ── 먼저 쓸 엔진 고르기 (사용자 지시 2026-09-22: 「지금이랑 azure 이거랑 선택할 수 있게」) ──────────
test('먼저 쓸 엔진 — Azure 를 고르면 맨 앞, 키가 없으면 저절로 빠져 이 PC 음성이 앞', async () => {
  const tts = require('../services/tts')
  const post = async (body) => fetch(app.baseUrl + '/api/tts/engines', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')

  assert.equal((await post({ primary: 'azure' })).status, 200)
  assert.equal(tts.먼저쓸엔진(), 'azure')
  assert.equal(tts.엔진차례()[0], 'azure', 'Azure 를 골랐는데 맨 앞이 아니다')
  assert.ok(tts.엔진차례().length >= 1)

  // 키를 지우면 고른 값은 그대로여도 Azure 는 빠진다 — 무음이 아니라 다음 엔진
  설정('azure_speech_key', '')
  assert.ok(!tts.엔진차례().includes('azure'))
  const 상태 = await (await fetch(app.baseUrl + '/api/tts/engines')).json()
  assert.equal(상태.primary, 'azure', '고른 값이 사라졌다')

  // 이 PC 음성으로 되돌리기
  설정('azure_speech_key', KEY)
  assert.equal((await post({ primary: 'supertonic' })).status, 200)
  const 차례 = tts.엔진차례()
  if (차례.includes('supertonic')) assert.equal(차례[0], 'supertonic')
  else assert.equal(차례[0], 'azure', '이 PC 음성이 없는 PC 에서는 Azure 가 앞')

  // 모르는 값은 거절
  assert.equal((await post({ primary: 'edge' })).status, 400)
  assert.equal((await post({})).status, 400)
  // 설정 이력에 남는다
  // 설정 이력은 1분 안의 연속 변경을 한 줄로 묶는다(settingsHistory) — 한 줄이 있고 마지막 값이 맞으면 된다
  const 이력 = getDB().prepare("SELECT new_value FROM settings_history WHERE key='tts_engine_primary' ORDER BY id DESC LIMIT 1").get()
  assert.equal(이력?.new_value, 'supertonic', '엔진 선택 변경이 설정 이력에 안 남았다')
})

// ── Codex ⑥ 1회차 ────────────────────────────────────────────────────────────────
test('[High] Azure 가 응답을 안 해도 뒤의 이 PC 음성 몫이 남는다 — 예산 안에 방송이 나간다', async () => {
  const tts = require('../services/tts')
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  // 신호가 끊을 때까지 매달리는 Azure
  azure.__setFetchForTests((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const 로컬파일 = path.join(임시, 'local-ok.wav')
  let 로컬불림 = 0
  tts.__setEngineOrderForTests(() => ['azure', '가짜로컬'], {
    가짜로컬: async () => { 로컬불림++; fs.writeFileSync(로컬파일, 가짜wav(1)); return 로컬파일 },
  })
  try {
    const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-azure-budget-'))
    const t0 = Date.now()
    const f = await tts.generateTTSWithRetry({ text: '예산 시험 문장', voice: 'v', rate: '+0%', pitch: '+0Hz' }, 1, { cacheDir: 캐시, deadlineMs: 3000 })
    assert.equal(로컬불림, 1, 'Azure 가 예산을 다 써 이 PC 음성이 한 번도 안 불렸다')
    assert.ok(Date.now() - t0 < 3000, `예산(3초)을 넘겼다: ${Date.now() - t0}ms`)
    tts.deleteTmpFile(f)
    fs.rmSync(캐시, { recursive: true, force: true })
  } finally { tts.__setEngineOrderForTests(null) }
})

test('[Medium] 한 방송은 시작할 때의 차례로 끝까지 — 넘겨받은 차례를 쓴다', async () => {
  const tts = require('../services/tts')
  const f = path.join(임시, 'snap.wav'); fs.writeFileSync(f, 가짜wav(1))
  tts.__setEngineOrderForTests(() => ['바뀐것'], {
    바뀐것: async () => { throw new Error('중간에 바뀐 차례를 탔다') },
    처음것: async () => f,
  })
  try {
    assert.equal(await tts.generateTTS({ text: 'x' }, { 차례: ['처음것'] }), f)
  } finally { tts.__setEngineOrderForTests(null) }
})

test('[Medium] 고른 엔진(Azure)이 실패하면 이 PC 음성으로 **미리 만들어 둔 캐시**를 쓴다 — 예약 준비도 준비됨으로 본다', async () => {
  const tts = require('../services/tts')
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  azure.__setFetchForTests(async () => new Response('no', { status: 401 }))
  const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-azure-fallback-cache-'))
  const params = { text: '미리 만든 문장', voice: 'v', rate: '+0%', pitch: '+0Hz' }
  let 합성 = 0
  tts.__setEngineOrderForTests(() => ['azure', 'supertonic'], {})
  try {
    // 이 PC 음성으로 미리 만들어 둔 것
    const 미리 = tts.cachePathFor(params, 캐시, 'supertonic')
    fs.writeFileSync(미리, 가짜wav(1)); fs.writeFileSync(`${미리}.cues.json`, JSON.stringify([[0, 1, '미리']]))
    assert.equal(tts.준비된캐시(params, (e) => tts.cachePathFor(params, 캐시, e)), 미리, '고른 엔진 캐시가 없다고 준비 안 됨으로 봤다 — 예약 준비가 매번 다시 합성한다')
    const 전 = fs.readdirSync(캐시).length
    const f = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시, generate: async (p, o) => { 합성++; return tts.generateTTS(p, o) } })
    assert.match(path.basename(f), /^carecast_cached_/, '미리 만든 캐시를 안 쓰고 다시 합성했다')
    assert.equal(fs.readdirSync(캐시).length, 전, '캐시에서 꺼낸 것을 다시 저장했다')
    tts.deleteTmpFile(f)
  } finally {
    tts.__setEngineOrderForTests(null)
    fs.rmSync(캐시, { recursive: true, force: true })
  }
  assert.equal(합성, 1)
})

test('[Medium] 화면 — 저장 응답으로 곧바로 그린다(다시 읽기 실패에도 낡지 않게)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'ttsEngineChoice.jsx'), 'utf8')
  assert.match(src, /const r = await saveTtsEnginePrimary\(value\)\s*\n\s*set상태\(\{ engines: r\?\.engines/)
})

// ── Codex ⑥ 2회차 ────────────────────────────────────────────────────────────────
test('[Medium] Azure 몫은 남은 시간보다 작다 — 빠듯해도 뒤의 이 PC 음성이 불린다', async () => {
  const tts = require('../services/tts')
  let 받은 = null
  const f = path.join(임시, 'budget-cap.wav'); fs.writeFileSync(f, 가짜wav(1))
  tts.__setEngineOrderForTests(() => ['azure', '가짜로컬'], { 가짜로컬: async () => f })
  azure.__setFetchForTests((url, init) => new Promise((_, reject) => {
    const t0 = Date.now()
    init.signal.addEventListener('abort', () => { 받은 = Date.now() - t0; reject(new Error('aborted')) })
  }))
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  try {
    const t0 = Date.now()
    await tts.generateTTS({ text: '짧은 예산' }, { timeoutMs: 1000 })
    assert.ok(Date.now() - t0 < 1400, `남은 1초를 넘겼다: ${Date.now() - t0}ms`)
    assert.ok(받은 !== null && 받은 <= 700, `Azure 에 준 몫이 남은 시간의 60% 를 넘었다: ${받은}ms`)
  } finally { tts.__setEngineOrderForTests(null) }
})

test('[Medium] 새로 만들라는 요청·자막 없는 캐시는 뒤 엔진 캐시로 대신하지 않는다', async () => {
  const tts = require('../services/tts')
  const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-nocache-'))
  const params = { text: '자막 없는 캐시', voice: 'v', rate: '+0%', pitch: '+0Hz' }
  let 합성 = 0
  const 새 = path.join(임시, 'fresh.wav')
  tts.__setEngineOrderForTests(() => ['가짜앞', '가짜뒤'], {
    가짜앞: async () => { const e = new Error('앞 실패'); e.permanent = true; throw e },
    가짜뒤: async () => { 합성++; fs.writeFileSync(새, 가짜wav(1)); return 새 },
  })
  try {
    // 뒤 엔진 캐시 — 소리는 있고 자막은 없다
    const 옛 = tts.cachePathFor(params, 캐시, '가짜뒤')
    fs.writeFileSync(옛, 가짜wav(1))
    await tts.generateTTS(params, { cacheDir: 캐시 })
    assert.equal(합성, 1, '자막 없는 캐시를 꺼내 썼다 — 자막을 영영 못 되살린다')
    // 자막까지 있어도 noCache(예약 준비)면 새로 만든다
    fs.writeFileSync(`${옛}.cues.json`, JSON.stringify([[0, 1, '옛']]))
    await tts.generateTTS(params, { cacheDir: 캐시, noCache: true })
    assert.equal(합성, 2, 'noCache 요청에서 캐시를 꺼내 썼다')
    // 자막 있고 noCache 가 아니면 꺼내 쓴다
    const c = await tts.generateTTS(params, { cacheDir: 캐시 })
    assert.equal(합성, 2)
    tts.deleteTmpFile(c)
  } finally {
    tts.__setEngineOrderForTests(null)
    fs.rmSync(캐시, { recursive: true, force: true })
  }
})

test('[High] 즉시 렌더 — 준비됨 분기에서도 유예(graceMs)를 예산으로 넘긴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'renderOnDemand.js'), 'utf8')
  const i = src.indexOf('if (isReady(params)) {')
  assert.ok(i > 0, '긍정 앵커')
  const 분기 = src.slice(i, src.indexOf('return { file, fromCache: true', i))
  assert.match(분기, /generateTTSWithRetry\(params, 1, graceMs == null \? \{\} : \{ deadlineMs: graceMs \}\)/)
})

// ── 전문가 2차 검토 4-2: 미리듣기·대체 실행으로 번호가 Microsoft 로 나가지 않는다 ─────────────
// 미리듣기는 방송·준비 요청과 달리 민감정보 검사 없이 합성했다. Azure 를 골랐거나 이 PC 음성이
// 실패해 Azure 로 넘어가면, 방송에선 막히는 번호가 미리듣기에서 외부로 나갔다.
const 번호문장 = '보호자 연락처 010-1234-5678 로 전화 주세요'

test('[4-2] Azure 경계 — 번호가 든 문장은 외부 요청을 보내지 않고 실패한다(직접 선택)', async () => {
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  const f = 가짜fetch(async () => new Response(가짜wav(1), { status: 200 }))
  azure.__setFetchForTests(f.fn)
  await assert.rejects(
    azure.synthesize({ text: 번호문장, voice: 'ko-KR-SunHiNeural' }, { out: path.join(임시, 'carecast_azure_pii.wav') }),
    /개인정보|번호/)
  assert.equal(f.기록.length, 0, '번호가 든 문장이 Azure 로 나갔다')
})

test('[4-2] 대체 실행 — 이 PC 음성이 실패해 Azure 로 넘어가도 번호는 안 나간다', async () => {
  const tts = require('../services/tts')
  설정('azure_speech_key', KEY); 설정('azure_speech_region', 'koreacentral')
  const f = 가짜fetch(async () => new Response(가짜wav(1), { status: 200 }))
  azure.__setFetchForTests(f.fn)
  tts.__setEngineOrderForTests(() => ['가짜로컬', 'azure'], {
    가짜로컬: async () => { throw new Error('로컬 합성 실패(시험)') },
  })
  try {
    const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-azure-pii-'))
    await assert.rejects(tts.generateTTSWithRetry({ text: 번호문장, voice: 'v', rate: '+0%', pitch: '+0Hz' }, 1, { cacheDir: 캐시, deadlineMs: 3000 }))
    assert.equal(f.기록.length, 0, '대체 실행에서 번호가 Azure 로 나갔다')
    fs.rmSync(캐시, { recursive: true, force: true })
  } finally { tts.__setEngineOrderForTests(null) }
})

test('[4-2] 미리듣기 — 합성 전에 공통 민감정보 검사로 막는다(어느 엔진도 안 부른다)', async () => {
  const tts = require('../services/tts')
  const f = 가짜fetch(async () => new Response(가짜wav(1), { status: 200 }))
  azure.__setFetchForTests(f.fn)
  let 불림 = 0
  tts.__setEngineOrderForTests(() => ['가짜로컬'], { 가짜로컬: async () => { 불림++; throw new Error('불리면 안 된다') } })
  try {
    const res = await fetch(app.baseUrl + '/api/tts/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 번호문장 }) })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /휴대폰번호/)
    assert.equal(불림, 0, '미리듣기가 검사 전에 합성했다')
    assert.equal(f.기록.length, 0)
  } finally { tts.__setEngineOrderForTests(null) }
})
