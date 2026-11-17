// 마지막 받침 — 윈도우 기본 한국어 음성(SAPI) (사용자 결정 2026-09-21: 브라우저 음성 대신 이것).
//
// 「어떤 경우에도 무음 금지」 — 앞 엔진이 모두 실패해도 WAV 가 나오고, 그 WAV 는 다른 엔진 것과 똑같이
// 자막·캐시를 탄다. 진짜 PowerShell·파이썬은 부르지 않는다(가짜 spawn · 가짜 엔진).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { EventEmitter } = require('events')

const sapi = require('../services/ttsEngines/sapi')
const tts = require('../services/tts')
const 캐시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sapi-cache-'))

function 가짜wav(file, 초) {
  const n = Math.round(44100 * 초)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  fs.writeFileSync(file, b)
}

// 가짜 powershell — 종료코드를 고른다. 0 이면 -Out 에 2초 WAV 를 쓴다.
function 가짜spawn(코드 = 0) {
  const 기록 = { 불림: 0, 인자: null, 글: null }
  const fn = (_cmd, args) => {
    기록.불림++; 기록.인자 = args
    const p = new EventEmitter()
    p.stderr = new EventEmitter()
    p.kill = () => {}
    setImmediate(() => {
      기록.글 = fs.readFileSync(args[args.indexOf('-In') + 1], 'utf8')
      if (코드 === 0) 가짜wav(args[args.indexOf('-Out') + 1], 2)
      p.emit('close', 코드)
    })
    return p
  }
  return { fn, 기록 }
}

function 켜기(sp) {
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  sapi.__resetForTests()
  sapi.__setSpawnForTests(sp.fn)
}
function 끄기() {
  delete process.env.CARECAST_TTS_ENGINE_IN_TESTS
  sapi.__resetForTests(); sapi.__setSpawnForTests(null)
  tts.__setEngineOrderForTests(null)
}

test.after(() => { 끄기(); try { fs.rmSync(캐시폴더, { recursive: true, force: true }) } catch { /* 무시 */ } })

test('시험 안에서는 스스로 빠진다 — 진짜 PowerShell 을 안 부른다', () => {
  끄기()
  assert.equal(sapi.available(), false)
  assert.ok(!tts.엔진차례().includes('sapi'))
})

test('속도: 설정 배율을 SAPI 칸으로(0.9 → -1)', () => {
  assert.equal(sapi.sapiRate('-10%'), -1)
  assert.equal(sapi.sapiRate('+0%'), 0)
  assert.equal(sapi.sapiRate(1.5), 5)
  assert.equal(sapi.sapiRate('+300%'), 10)
})

test('한국어 음성이 없으면(종료코드 3) 영구 불가 — 10분 동안 차례에서 빠진다', async () => {
  const sp = 가짜spawn(3); 켜기(sp)
  const out = path.join(캐시폴더, 'carecast_sapi_a.wav')
  await assert.rejects(sapi.synthesize({ text: '안녕하세요' }, { out }), (e) => e.permanent === true)
  assert.equal(sapi.available(), false)
  assert.ok(!fs.existsSync(`${out}.txt`), '임시 글 파일을 안 치웠다')
})

test('문장은 UTF-8 파일로 넘기고, WAV 길이를 머리에서 읽는다', async () => {
  const sp = 가짜spawn(0); 켜기(sp)
  const out = path.join(캐시폴더, 'carecast_sapi_b.wav')
  const r = await sapi.synthesize({ text: '어르신 여러분, 점심 드세요.', rate: '-10%' }, { out })
  assert.equal(sp.기록.글, '어르신 여러분, 점심 드세요.')
  assert.equal(sp.기록.인자[sp.기록.인자.indexOf('-Rate') + 1], '-1')
  assert.ok(Math.abs(r.durationSec - 2) < 0.01)
})

test('앞 엔진이 모두 실패하면 윈도우 음성 WAV 가 나온다 — 자막이 붙고 윈도우 음성 열쇠로 캐시된다', async () => {
  const sp = 가짜spawn(0); 켜기(sp)
  const 불림 = []
  // 앞 엔진(가짜 Azure)이 인터넷 문제로 실패한다
  tts.__setEngineOrderForTests(() => ['가짜앞', 'sapi'], {
    가짜앞: async () => { 불림.push('가짜앞'); throw new Error('인터넷 없음') },
  })
  const params = { text: '화재 경보. 즉시 대피해 주십시오.', voice: 'v', rate: '+0%', pitch: '+0Hz' }
  const file = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시폴더 })
  assert.deepEqual(불림, ['가짜앞'])
  assert.match(path.basename(file), /^carecast_sapi_.*\.wav$/)
  assert.equal(tts.mimeOf(file), 'audio/wav')
  assert.ok(tts.readCues(file, params.text)?.lines?.length > 0, '윈도우 음성에 자막이 없다')
  assert.ok(fs.existsSync(tts.cachePathFor(params, 캐시폴더, 'sapi')), '윈도우 음성 열쇠로 캐시되지 않았다')
  assert.notEqual(tts.cacheKeyFor(params, 'sapi'), tts.cacheKeyFor(params, 'supertonic'))
  tts.deleteTmpFile(file)

  // 다음에 모든 엔진이 실패해도 지난 윈도우 음성 성공본으로 나간다(무음 금지)
  tts.__setEngineOrderForTests(() => ['가짜앞'], { 가짜앞: async () => { throw new Error('또 실패') } })
  const again = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시폴더 })
  assert.match(again, /\.wav$/)
  tts.deleteTmpFile(again)
})

test('맥·리눅스에서는 빠진다(윈도우 음성이 없다)', { skip: process.platform === 'win32' }, () => {
  끄기(); process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  assert.equal(sapi.available(), false)
})

// ── Codex ④-c 1회차 ──────────────────────────────────────────────────────────────
test('[High] 결과를 못 읽으면 실패로 끝난다 — 약속이 매달리지 않는다', async () => {
  const 기록 = {}
  켜기({ fn: (_c, args) => {
    const p = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}
    // 결과 자리에 **폴더**를 만들어 읽기가 던지게 한다(EISDIR — 잠긴 파일과 같은 갈래)
    setImmediate(() => { fs.mkdirSync(args[args.indexOf('-Out') + 1]); 기록.ok = true; p.emit('close', 0) })
    return p
  } })
  const out = path.join(캐시폴더, 'carecast_sapi_dir.wav')
  const 결과 = await Promise.race([
    sapi.synthesize({ text: '안녕' }, { out }).then(() => '성공', (e) => e.message),
    new Promise((r) => setTimeout(() => r('매달림'), 2000)),
  ])
  assert.ok(기록.ok)
  assert.match(결과, /못 읽었다/)
  try { fs.rmSync(out, { recursive: true, force: true }) } catch { /* 무시 */ }
})

test('[Medium] 시간 초과 뒤 늦게 끝나도 임시 글 파일을 치운다', async () => {
  let 끝내기
  켜기({ fn: (_c, args) => {
    const p = new EventEmitter(); p.stderr = new EventEmitter()
    const 글 = args[args.indexOf('-In') + 1]
    p.kill = () => {}
    끝내기 = () => { fs.writeFileSync(글, '아직 쥐고 있던 글'); p.emit('close', 1) }   // 시간 초과 때 못 지운 것 흉내
    return p
  } })
  const out = path.join(캐시폴더, 'carecast_sapi_late.wav')
  await assert.rejects(sapi.synthesize({ text: '늦게 끝남' }, { out, timeoutMs: 20 }), /시간 초과/)
  끝내기()
  assert.ok(!fs.existsSync(`${out}.txt`), '늦게 끝난 뒤에도 임시 글 파일이 남았다')
})

test('[Codex ④-d High] 모든 엔진이 영구 실패한 뒤 재시도해도 옛 캐시로 복구한다 — undefined 를 던지지 않는다', async () => {
  const 캐시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-allfail-'))
  const params = { text: '모든 엔진 실패 문장', voice: 'v', rate: '+0%', pitch: '+0Hz' }
  // 옛 mp3 캐시(지난 성공본) — 옛 열쇠 규칙으로 심는다
  const 옛 = tts.cachePathFor(params, 캐시, '옛mp3')
  fs.writeFileSync(옛, Buffer.alloc(4096, 7)); fs.writeFileSync(`${옛}.cues.json`, '[]')
  tts.__setEngineOrderForTests(() => ['가짜'], { 가짜: async () => { const e = new Error('키 틀림'); e.permanent = true; throw e } })
  try {
    // 같은 방송(같은 제외 묶음)에서 두 번째 부름 — 부를 엔진이 없다. **undefined 가 아니라 오류로** 거절해야 한다
    // (undefined 면 재시도 경고 줄의 err.message 가 TypeError 로 터져 지난 성공본 폴백까지 못 간다).
    const 제외 = new Set()
    await assert.rejects(tts.generateTTS(params, { 제외 }), /키 틀림/)
    await assert.rejects(tts.generateTTS(params, { 제외 }), (e) => e instanceof Error && e.permanent === true)
    // 끝까지 가면 옛 캐시로 복구한다
    const f = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시, noCache: true })
    assert.match(f, /\.mp3$/, '옛 캐시로 복구하지 못했다')
    tts.deleteTmpFile(f)
  } finally {
    tts.__setEngineOrderForTests(null)
    fs.rmSync(캐시, { recursive: true, force: true })
  }
})
