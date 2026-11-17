// 문장 사이 쉼 · 미리 만들기 고음질 (사용자 지시 2026-09-22 「문장사이 쉼 넣어주고, 합성 단계 수는 미리 합성할 때 자동방송처럼」).
//
// 고정하는 사실:
//   1) 쉼 0(기본)·보통 단계면 캐시 열쇠가 **예전 그대로**다 — 만들어 둔 음성을 다시 만들지 않는다
//   2) 쉼·고음질은 열쇠를 가른다(쉼을 바꾸면 새로 만들고, 고음질판은 보통판과 따로 산다)
//   3) 방송 경로는 **고음질판이 있으면 그것을** 쓴다 — 없으면 보통 캐시(급한 방송이 느려지지 않는다)
//   4) 합성 프로세스에 단계·쉼이 실려 간다(고음질 16, 보통 8) · 쉼을 넣으면 자막이 문장별 구간을 따른다
//   5) 설정 저장·미리듣기는 0~2000 정수만 받는다
//   6) 미리 만들기(자동방송·예약 준비)는 고음질을 청한다 · 방송 준비 판정은 고음질판도 준비된 것으로 본다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stpause_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')

const { initDB, getDB } = require('../db/schema')
const sup = require('../services/ttsEngines/supertonic')
const { 모델파일 } = require('../services/ttsEngines/supertonicWorker')
const tts = require('../services/tts')
const 문장 = require('../domain/ttsSentences')
const { startTestApp } = require('./helpers/testApp')

const 모델폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stpause-model-'))
const 캐시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stpause-cache-'))
let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': require('../routes/settings'), '/api/tts': require('../routes/tts') })
})
test.after(async () => {
  if (app) await app.close()
  tts.__setEngineOrderForTests(null)
  delete process.env.CARECAST_TTS_ENGINE_IN_TESTS
  delete process.env.CARECAST_TTS_MODEL_DIR
  sup.__resetForTests(); sup.__setForkForTests(null)
  for (const d of [모델폴더, 캐시폴더]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 무시 */ } }
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 그만 */ } }
})

const 쉼설정 = (v) => {
  if (v === null) getDB().prepare("DELETE FROM settings WHERE key = 'tts_sentence_pause_ms'").run()
  else getDB().prepare("INSERT INTO settings (key, value) VALUES ('tts_sentence_pause_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v))
}
const params = { text: '어르신 여러분. 점심 진지 드시러 오세요.', voice: 'ko-KR-SunHiNeural', rate: '-10%', pitch: '+0Hz' }
function 가짜wav(파일) {
  const n = 44100
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  fs.mkdirSync(path.dirname(파일), { recursive: true })
  fs.writeFileSync(파일, b)
  return 파일
}

test('문장 나누기·쉼 읽기 규칙', () => {
  assert.deepEqual(문장.문장나누기('안녕하세요. 점심입니다!\n다음 줄'), ['안녕하세요.', '점심입니다!', '다음 줄'])
  assert.deepEqual(문장.문장나누기('3.5도 입니다'), ['3.5도 입니다'], '소수점에서 문장을 나눴다')
  assert.equal(문장.쉼정리(undefined), 0)
  assert.equal(문장.쉼정리('700'), 700)
  assert.equal(문장.쉼정리(99999), 2000)
  assert.equal(문장.쉼정리(true), 0)
  for (const 틀림 of [-1, 2001, 1.5, 'abc', '', true, null, [500]]) assert.equal(문장.쉼읽기엄격(틀림), null, `${JSON.stringify(틀림)} 을 받았다`)
  assert.equal(문장.쉼읽기엄격('500'), 500)
  assert.equal(문장.쉼읽기엄격(0), 0)
})

test('1·2) 쉼 0·보통 단계면 열쇠가 예전 그대로, 쉼·고음질은 열쇠를 가른다', () => {
  쉼설정(null)
  const 기본 = tts.cacheKeyFor(params, 'supertonic')
  assert.equal(tts.cacheKeyFor({ ...params, 쉼: 0 }, 'supertonic'), 기본)
  assert.equal(sup.쉼소금(0), '')
  assert.equal(sup.소금(1, sup.단계of({})), sup.SALT, '보통 단계의 소금이 바뀌었다 — 만들어 둔 음성이 전부 무효가 된다')
  assert.notEqual(tts.cacheKeyFor({ ...params, 쉼: 500 }, 'supertonic'), 기본)
  assert.notEqual(tts.cacheKeyFor({ ...params, 고음질: true }, 'supertonic'), 기본)
  쉼설정(500)
  assert.equal(tts.cacheKeyFor(params, 'supertonic'), tts.cacheKeyFor({ ...params, 쉼: 500 }, 'supertonic'), '설정을 바꿨는데 준비 확인이 옛 쉼으로 센다')
  쉼설정(null)
  // 다른 엔진 열쇠에는 영향이 없다
  assert.equal(tts.cacheKeyFor({ ...params, 쉼: 500, 고음질: true }, 'azure'), tts.cacheKeyFor(params, 'azure'))
})

test('3) 방송 경로는 고음질판이 있으면 그것을 쓴다 — 합성하지 않는다', async () => {
  쉼설정(null)
  tts.__setEngineOrderForTests(() => ['supertonic'])
  const 글 = { ...params, text: '고음질 우선 시험 문장입니다.' }
  const 고 = tts.cachePathFor({ ...글, sid: 1, 쉼: 0, 고음질: true }, 캐시폴더, 'supertonic')
  가짜wav(고); fs.writeFileSync(tts.cuesPathOf(고), '[]')
  let 합성 = 0
  const out = await tts.generateTTSWithRetry(글, 1, { generate: async () => { 합성++; return 가짜wav(path.join(os.tmpdir(), `cc-stp-${Date.now()}.wav`)) }, cacheDir: 캐시폴더 })
  assert.equal(합성, 0, '고음질판이 있는데 다시 합성했다')
  assert.ok(fs.existsSync(out))
  try { fs.unlinkSync(out) } catch { /* 임시 */ }
  // 고음질판이 없으면 보통 합성(청한 것에 고음질이 안 붙는다)
  const 받음 = []
  const 둘 = await tts.generateTTSWithRetry({ ...params, text: '보통 합성 시험입니다.' }, 1,
    { generate: async (p) => { 받음.push(p); return 가짜wav(path.join(os.tmpdir(), `cc-stp2-${Date.now()}.wav`)) }, cacheDir: 캐시폴더 })
  assert.equal(받음.length, 1)
  assert.ok(!받음[0].고음질, '급한 방송이 고음질로 합성됐다 — 느려진다')
  try { fs.unlinkSync(둘) } catch { /* 임시 */ }
  tts.__setEngineOrderForTests(null)
})

test('4) 합성 프로세스에 단계·쉼이 실려 간다', async () => {
  for (const f of Object.values(모델파일)) fs.writeFileSync(path.join(모델폴더, f), 'x')
  const 받음 = []
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  process.env.CARECAST_TTS_MODEL_DIR = 모델폴더
  sup.__resetForTests()
  sup.__setForkForTests(() => {
    const c = new EventEmitter()
    c.kill = () => setImmediate(() => c.emit('exit', null))
    c.send = (m) => {
      받음.push(m)
      setTimeout(() => { fs.writeFileSync(m.out, 'RIFF'); c.emit('message', { id: m.id, ok: true, durationSec: 3, 구간: [[0, 1], [1.5, 3]] }) }, 5)
    }
    setImmediate(() => c.emit('message', { ready: true }))
    return c
  })
  const r = await sup.synthesize({ text: '하나. 둘.', 고음질: true, 쉼: 500 }, { out: path.join(캐시폴더, 'p1.wav') })
  await sup.synthesize({ text: '보통' }, { out: path.join(캐시폴더, 'p2.wav') })
  assert.deepEqual(받음.map(m => [m.numSteps, m.pauseMs]), [[16, 500], [8, 0]])
  assert.deepEqual(r.구간, [[0, 1], [1.5, 3]], '문장 구간이 부모로 안 올라왔다 — 자막이 쉼 동안 앞서간다')
})

test('5) 설정 저장·미리듣기는 0~2000 정수만', async () => {
  const 저장 = (body) => fetch(`${app.baseUrl}/api/settings/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const 읽기 = async () => (await (await fetch(`${app.baseUrl}/api/settings/tts`)).json()).sentencePauseMs
  쉼설정(null)
  assert.equal(await 읽기(), 0, '설정이 없는데 쉼이 0 이 아니다')
  assert.equal((await 저장({ sentencePauseMs: 700 })).status, 200)
  assert.equal(await 읽기(), 700)
  for (const 틀림 of [2001, -1, 'abc', true, 1.5]) {
    assert.equal((await 저장({ sentencePauseMs: 틀림 })).status, 400, `${JSON.stringify(틀림)} 을 저장했다`)
  }
  assert.equal(await 읽기(), 700, '틀린 값이 저장값을 바꿨다')
  const 미리 = await fetch(`${app.baseUrl}/api/tts/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '시험', pauseMs: 5000 }),
  })
  assert.equal(미리.status, 400, '미리듣기가 범위 밖 쉼을 받았다')
  쉼설정(null)
})

test('6) 미리 만들기는 고음질을 청하고, 방송 준비 판정은 고음질판도 준비된 것으로 본다', () => {
  const 읽기 = (f) => fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8')
  assert.match(읽기('prerenderAuto.js'), /const 고 = \{ \.\.\.it\.params, 고음질: true \}/, '자동방송 미리 만들기가 고음질을 안 청한다')
  assert.match(읽기('prerenderAuto.js'), /ttsParamsFor\(db, text, \{\}\), 고음질: true/, '아침 조각 미리 만들기가 고음질을 안 청한다')
  assert.match(읽기('scheduler.js'), /const params = \{ \.\.\.보통, 고음질: true \}/, '예약 미리 만들기가 고음질을 안 청한다')
  assert.match(읽기('renderOnDemand.js'), /있나\(\{ \.\.\.params, 고음질: true \}\)/, '고음질판을 캐시 미스로 센다')
})

test('Codex 1회차 ④ — 줄바꿈만으로는 안 나눈다(열쇠가 같은 두 문안은 같은 쉼 자리)', () => {
  assert.deepEqual(문장.문장나누기('가\n나'), 문장.문장나누기('가 나'))
  assert.deepEqual(문장.문장나누기('가.\n나'), ['가.', '나'])
})

test('Codex 1회차 ① — 급한 방송이 오면 고음질 미리 만들기를 끊고 뒤로 돌린다', async () => {
  for (const f of Object.values(모델파일)) fs.writeFileSync(path.join(모델폴더, f), 'x')
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  process.env.CARECAST_TTS_MODEL_DIR = 모델폴더
  sup.__resetForTests()
  const 보냄 = []
  let 띄운수 = 0
  sup.__setForkForTests(() => {
    띄운수++
    const c = new EventEmitter()
    c.kill = () => setImmediate(() => c.emit('exit', null))
    c.send = (m) => {
      보냄.push(m.text)
      // 고음질 미리 만들기는 첫 프로세스에서 **응답하지 않는다**(오래 걸리는 긴 문안) — 끊기지 않으면 급한 방송이 못 나간다
      if (m.numSteps === 16 && 띄운수 === 1) return
      setTimeout(() => { fs.writeFileSync(m.out, 'RIFF'); c.emit('message', { id: m.id, ok: true, durationSec: 1 }) }, 5)
    }
    setImmediate(() => c.emit('message', { ready: true }))
    return c
  })
  const 미리 = sup.synthesize({ text: '긴 미리 만들기', 고음질: true }, { out: path.join(캐시폴더, 'pre.wav'), priority: 0, timeoutMs: 5000 })
  await new Promise(r => setTimeout(r, 30))   // 미리 만들기가 합성에 들어갈 때까지
  const t0 = Date.now()
  await sup.synthesize({ text: '급한 방송' }, { out: path.join(캐시폴더, 'now.wav'), priority: 1, timeoutMs: 2000 })
  assert.ok(Date.now() - t0 < 1500, '급한 방송이 고음질 미리 만들기를 기다렸다')
  await 미리   // 뒤로 밀린 미리 만들기는 새 프로세스에서 끝난다
  assert.deepEqual(보냄, ['긴 미리 만들기', '급한 방송', '긴 미리 만들기'])
  sup.__resetForTests(); sup.__setForkForTests(null)
})

test('Codex 1회차 ②③ — 예약 점검은 고음질판도 준비됨으로, Azure 실패 뒤에도 고음질판부터', () => {
  const 읽기 = (f) => fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8')
  const s = 읽기('scheduler.js')
  assert.match(s, /function 예약준비됨\(params\) \{\s*return scheduleAudioReady\(\{ \.\.\.params, 고음질: true \}\) \|\| scheduleAudioReady\(params\)/)
  assert.ok(!/return params && !scheduleAudioReady\(params\)/.test(s), '예약 점검이 보통판만 본다 — 고음질판만 있는 예약이 점검 몫을 소진한다')
  assert.ok(!/keys\.has\(key\) \|\| scheduleAudioReady\(params\)/.test(s), '예약 점검 반복이 보통판만 본다')
  assert.match(읽기('tts.js'), /const 뒤판 = engine === 'supertonic' && !params\.고음질/, '앞 엔진 실패 뒤 고음질판을 안 본다')
})

test('Codex 1회차 ③ — Azure 가 앞인데 실패하면, 이 PC 음성의 고음질판을 합성 없이 쓴다', async () => {
  tts.__setEngineOrderForTests(() => ['azure', 'supertonic'])
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  process.env.CARECAST_TTS_MODEL_DIR = 모델폴더
  sup.__resetForTests()
  let 합성 = 0
  sup.__setForkForTests(() => { 합성++; throw new Error('합성하면 안 된다') })
  const 글 = { ...params, text: 'Azure 실패 뒤 고음질판 시험입니다.' }
  const 고 = tts.cachePathFor({ ...글, sid: 1, 쉼: 0, 고음질: true }, 캐시폴더, 'supertonic')
  가짜wav(고); fs.writeFileSync(tts.cuesPathOf(고), '[]')
  const out = await tts.generateTTSWithRetry(글, 1, { cacheDir: 캐시폴더, deadlineMs: 3000 })
  assert.equal(합성, 0, 'Azure 실패 뒤 고음질판이 있는데 이 PC 음성으로 다시 합성했다')
  assert.ok(fs.existsSync(out))
  try { fs.unlinkSync(out) } catch { /* 임시 */ }
  tts.__setEngineOrderForTests(null)
  sup.__resetForTests(); sup.__setForkForTests(null)
})
