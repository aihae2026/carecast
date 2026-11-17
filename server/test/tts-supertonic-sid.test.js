// 이 PC 음성(Supertonic)의 화자를 고른다 (사용자 결정 2026-09-22 「고를 수 있게, 하나만」, 기본 sid 1).
//
// 고정하는 사실:
//   1) sid 1 의 소금은 **예전과 한 글자도 같다** — 이미 만들어 둔 음성이 다시 합성되지 않는다
//   2) 캐시 열쇠가 화자마다 갈린다 — 설정이 없으면 sid 1 과 같은 열쇠
//   3) 설정을 바꾸면 준비 확인(열쇠 셈)도 새 화자로 센다
//   4) 한 방송은 화자를 **한 번** 정한다 — 합성 도중 설정이 바뀌어도 새 소리가 옛 열쇠 이름으로 저장되지 않는다
//   5) 합성 프로세스에 화자가 실려 간다(없으면 기본 1)
//   6) 설정 저장은 0~9 만 받는다 — 빈 값·범위 밖은 400(조용히 1로 바꾸지 않는다)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stsid_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')

const { initDB, getDB } = require('../db/schema')
const sup = require('../services/ttsEngines/supertonic')
const { 모델파일 } = require('../services/ttsEngines/supertonicWorker')
const tts = require('../services/tts')
const { startTestApp } = require('./helpers/testApp')

const 모델폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stsid-model-'))
const 캐시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stsid-cache-'))
let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': require('../routes/settings') })
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

const 화자설정 = (v) => {
  if (v === null) getDB().prepare("DELETE FROM settings WHERE key = 'tts_supertonic_sid'").run()
  else getDB().prepare("INSERT INTO settings (key, value) VALUES ('tts_supertonic_sid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v))
}
const params = { text: '어르신 여러분, 점심 진지 드시러 오세요.', voice: 'ko-KR-SunHiNeural', rate: '-10%', pitch: '+0Hz' }

test('1) sid 1 의 소금은 예전 글자 그대로다 — 만들어 둔 음성이 산다', () => {
  assert.equal(sup.SALT, 'supertonic@supertonic-3-tts-int8-2026-05-11|sid@1|steps@8')
  assert.equal(sup.소금(1), sup.SALT)
  assert.equal(sup.소금(undefined), sup.SALT)
  assert.notEqual(sup.소금(3), sup.SALT)
})

test('2·3) 열쇠가 화자마다 갈리고, 설정이 없으면 sid 1, 설정을 바꾸면 준비 확인도 새 화자로 센다', () => {
  화자설정(null)
  const 기본 = tts.cacheKeyFor(params, 'supertonic')
  assert.equal(기본, tts.cacheKeyFor({ ...params, sid: 1 }, 'supertonic'), '설정이 없는데 기본 화자 1 과 다른 열쇠다 — 캐시가 전부 무효가 된다')
  const 셋 = tts.cacheKeyFor({ ...params, sid: 3 }, 'supertonic')
  assert.notEqual(셋, 기본, '다른 화자인데 같은 열쇠다 — 옛 목소리가 캐시 적중으로 나간다')
  화자설정(3)
  assert.equal(tts.cacheKeyFor(params, 'supertonic'), 셋, '설정을 바꿨는데 준비 확인이 옛 화자로 센다')
  화자설정('')   // 빈 값은 기본
  assert.equal(tts.cacheKeyFor(params, 'supertonic'), 기본, '빈 설정을 0번 화자로 읽었다')
  화자설정(null)
})

test('4) 한 방송은 화자를 한 번 정한다 — 합성 도중 설정이 바뀌어도 캐시는 처음 화자 열쇠로', async () => {
  화자설정(3)
  tts.__setEngineOrderForTests(() => ['supertonic'])
  const 받은것 = []
  const 가짜만들기 = async (p) => {
    받은것.push(p)
    화자설정(5)   // 합성하는 사이 사람이 바꿨다
    const f = path.join(os.tmpdir(), `cc-stsid-${Date.now()}-${Math.random()}.wav`)
    const n = 44100
    const b = Buffer.alloc(44 + n * 2)
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
    b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
    fs.writeFileSync(f, b)
    return f
  }
  const 문장 = { ...params, text: '화자 고정 시험 문장입니다.' }
  const out = await tts.generateTTSWithRetry(문장, 1, { generate: 가짜만들기, cacheDir: 캐시폴더 })
  assert.equal(받은것[0].sid, 3, '합성에 방송 시작 때의 화자가 안 실렸다')
  assert.ok(fs.existsSync(tts.cachePathFor({ ...문장, sid: 3 }, 캐시폴더, 'supertonic')), '처음 화자(3) 열쇠로 캐시에 안 남았다')
  assert.ok(!fs.existsSync(tts.cachePathFor({ ...문장, sid: 5 }, 캐시폴더, 'supertonic')), '3번 목소리 소리가 5번 열쇠 이름으로 저장됐다')
  try { fs.unlinkSync(out) } catch { /* 임시 파일 */ }
  tts.__setEngineOrderForTests(null)
  화자설정(null)
})

test('5) 합성 프로세스에 화자가 실려 간다 — 없으면 기본 1', async () => {
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
      setTimeout(() => { fs.writeFileSync(m.out, 'RIFF'); c.emit('message', { id: m.id, ok: true, durationSec: 1 }) }, 5)
    }
    setImmediate(() => c.emit('message', { ready: true }))
    return c
  })
  await sup.synthesize({ text: '넷', sid: 4 }, { out: path.join(캐시폴더, 's4.wav') })
  await sup.synthesize({ text: '기본' }, { out: path.join(캐시폴더, 's1.wav') })
  await sup.synthesize({ text: '범위밖', sid: 42 }, { out: path.join(캐시폴더, 's42.wav') })
  assert.deepEqual(받음.map(m => m.sid), [4, 1, 1])
})

test('6) 설정 저장·읽기 — 기본 1, 0~9 만 받는다', async () => {
  const 저장 = (body) => fetch(`${app.baseUrl}/api/settings/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const 읽기 = async () => (await (await fetch(`${app.baseUrl}/api/settings/tts`)).json()).supertonicSid
  화자설정(null)
  assert.equal(await 읽기(), 1, '설정이 없는데 기본이 1 이 아니다')
  assert.equal((await 저장({ supertonicSid: 6 })).status, 200)
  assert.equal(await 읽기(), 6)
  assert.equal((await 저장({ supertonicSid: 0 })).status, 200, '0번 화자를 못 골랐다')
  assert.equal(await 읽기(), 0)
  for (const 나쁜 of ['', 10, -1, 2.5, 'abc']) {
    assert.equal((await 저장({ supertonicSid: 나쁜 })).status, 400, `supertonicSid=${JSON.stringify(나쁜)} 를 받았다`)
  }
  // null 은 이 경로의 규칙대로 「안 보냄」이다(P-115 — 보냈나()) — 받되 아무것도 안 바꾼다.
  assert.equal((await 저장({ supertonicSid: null })).status, 200)
  assert.equal(await 읽기(), 0, '거절했거나 안 보냈는데 저장이 바뀌었다')
})

test('엄격한 목소리 번호 — false·true·[3]·"0x3"·"3." 은 400(QA)', async () => {
  const 저장 = (body) => fetch(`${app.baseUrl}/api/settings/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  for (const 나쁜 of [false, true, [3], '0x3', '3.', '+3']) {
    assert.equal((await 저장({ supertonicSid: 나쁜 })).status, 400, `supertonicSid=${JSON.stringify(나쁜)} 를 받았다`)
  }
  assert.equal((await 저장({ supertonicSid: '4' })).status, 200, '숫자 글자를 못 받았다')
  화자설정(null)
})

test('목소리를 바꾼 직후 합성이 실패하면 다른 목소리의 지난 성공본으로 — 무음보다 낫다(코드 검수·QA)', async () => {
  tts.__setEngineOrderForTests(() => ['supertonic'])
  const 문장 = { ...params, text: '목소리 바꾼 뒤 대비 시험입니다.' }
  // 1번(기본) 목소리로 만들어 둔 성공본이 캐시에 있다
  const 옛 = tts.cachePathFor({ ...문장, sid: 1 }, 캐시폴더, 'supertonic')
  const n = 44100
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  fs.mkdirSync(path.dirname(옛), { recursive: true }); fs.writeFileSync(옛, b)
  화자설정(6)   // 6번으로 바꿨는데 합성이 실패한다
  const 실패 = async () => { throw new Error('합성 실패(시험)') }
  const out = await tts.generateTTSWithRetry(문장, 1, { generate: 실패, cacheDir: 캐시폴더 })
  assert.ok(out && fs.existsSync(out), '다른 목소리 성공본이 있는데 소리를 못 냈다 — 무음')
  try { fs.unlinkSync(out) } catch { /* 임시 파일 */ }
  tts.__setEngineOrderForTests(null)
  화자설정(null)
})
