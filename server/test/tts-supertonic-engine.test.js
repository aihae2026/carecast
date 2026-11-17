// Supertonic 엔진 층 (2026-09-21 사용자 지시: 기본 Supertonic · 선택 Azure · 마지막 대비 윈도우 음성).
//
// 진짜 모델은 적재하지 않는다 — 합성 프로세스(fork)를 **가짜**로 바꿔 끼운다. 여기서 고정하는 것:
//   1) 시험 안에서는 스스로 빠진다 → 진짜 모델을 적재하지 않는다.
//   2) 라이브러리·모델이 없으면 **영구 불가**로 알린다(재시도를 태우지 않고 다음 엔진으로).
//   3) 줄은 우선순위 순 — 비상 > 방송 > 미리 만들기. 지금 합성 중인 것 하나만 기다린다.
//   4) 적재 실패·시간 초과 뒤에도 다음 요청이 산다.
//   5) tts.js: 열쇠·확장자가 엔진을 따르고, WAV 에 자막 사이드카(어절 목록)가 붙는다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { EventEmitter } = require('events')

const 모델폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-st3-model-'))
const 캐시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-st3-cache-'))

const sup = require('../services/ttsEngines/supertonic')
const { 모델파일 } = require('../services/ttsEngines/supertonicWorker')

function 모델깔기() { for (const f of Object.values(모델파일)) fs.writeFileSync(path.join(모델폴더, f), 'x') }

// 16bit 모노 44100Hz WAV — 초 길이만큼
function 가짜wav(file, 초) {
  const n = Math.round(44100 * 초)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24)
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  fs.writeFileSync(file, b)
}

// 가짜 합성 프로세스. 행동을 바꿔 끼울 수 있다.
function 가짜fork(행동 = {}) {
  const 기록 = { 띄움: 0, 받음: [], 죽임: 0 }
  const fn = () => {
    기록.띄움++
    const c = new EventEmitter()
    c.kill = () => { 기록.죽임++; setImmediate(() => c.emit('exit', null)) }
    c.send = (m) => {
      기록.받음.push(m)
      if (행동.멈춤) return   // 대답 안 함(시간 초과 시험)
      setTimeout(() => {
        가짜wav(m.out, 1)
        c.emit('message', { id: m.id, ok: true, durationSec: 1 })
      }, 행동.지연 ?? 5)
    }
    setImmediate(() => {
      if (행동.적재실패) { c.emit('message', { ready: false, error: '깨진 모델' }); c.emit('exit', 1) }
      else c.emit('message', { ready: true })
    })
    return c
  }
  return { fn, 기록 }
}

function 켜기(fk) {
  process.env.CARECAST_TTS_ENGINE_IN_TESTS = '1'
  process.env.CARECAST_TTS_MODEL_DIR = 모델폴더
  sup.__resetForTests()
  sup.__setForkForTests(fk.fn)
}
function 끄기() {
  delete process.env.CARECAST_TTS_ENGINE_IN_TESTS
  delete process.env.CARECAST_TTS_MODEL_DIR
  sup.__resetForTests()
  sup.__setForkForTests(null)
}

test.after(() => {
  끄기()
  for (const d of [모델폴더, 캐시폴더]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 무시 */ } }
})

test('시험 안에서는 스스로 빠진다 — 진짜 모델을 안 올린다', async () => {
  끄기()
  assert.equal(sup.available(), false)
  assert.match(sup.unavailableReason(), /시험/)
  const tts = require('../services/tts')
  assert.ok(!tts.엔진차례().includes('supertonic'))
  await assert.rejects(sup.synthesize({ text: '안녕' }, { out: path.join(캐시폴더, 'x.wav') }), (e) => e.permanent === true)
})

test('모델 파일이 없으면 영구 불가 — 무엇이 없는지 말한다', () => {
  const fk = 가짜fork(); 켜기(fk)
  for (const f of fs.readdirSync(모델폴더)) fs.unlinkSync(path.join(모델폴더, f))
  sup.__resetForTests()
  assert.equal(sup.available(), false)
  assert.match(sup.unavailableReason(), /setup:tts/)
  assert.equal(fk.기록.띄움, 0, '없는 모델로 프로세스를 띄웠다')
})

test('속도는 설정 배율을 따른다 — ±N% 문자열도 받는다', () => {
  assert.equal(sup.speedFromRate('-10%'), 0.9)
  assert.equal(sup.speedFromRate('+0%'), 1)
  assert.equal(sup.speedFromRate('+20%'), 1.2)
  assert.equal(sup.speedFromRate(0.9), 0.9)
  assert.equal(sup.speedFromRate('이상한값'), 1)
})

test('줄은 우선순위 순 — 비상 > 방송 > 미리 만들기, 지금 것 하나만 기다린다', async () => {
  모델깔기()
  const fk = 가짜fork({ 지연: 20 }); 켜기(fk)
  const out = (n) => path.join(캐시폴더, `q${n}.wav`)
  const 첫 = sup.synthesize({ text: '첫 문장' }, { out: out(1), priority: 1 })
  await new Promise((r) => setTimeout(r, 5))   // 첫 것이 프로세스에 들어가게
  const 미리 = sup.synthesize({ text: '미리 만들기' }, { out: out(2), priority: 0 })
  const 방송 = sup.synthesize({ text: '정시 방송' }, { out: out(3), priority: 1 })
  const 비상 = sup.synthesize({ text: '화재 경보' }, { out: out(4), priority: 2 })
  await Promise.all([첫, 미리, 방송, 비상])
  assert.deepEqual(fk.기록.받음.map((m) => m.text), ['첫 문장', '화재 경보', '정시 방송', '미리 만들기'])
  assert.equal(fk.기록.띄움, 1, '모델을 요청마다 다시 올렸다')
  assert.equal(fk.기록.받음[0].speed, 1)
})

test('적재 실패는 영구 불가로 — 1분 동안 다시 띄우지 않는다', async () => {
  모델깔기()
  const fk = 가짜fork({ 적재실패: true }); 켜기(fk)
  await assert.rejects(sup.synthesize({ text: '하나' }, { out: path.join(캐시폴더, 'f1.wav') }), (e) => e.permanent === true)
  assert.equal(sup.available(), false)
  await assert.rejects(sup.synthesize({ text: '둘' }, { out: path.join(캐시폴더, 'f2.wav') }), (e) => e.permanent === true)
  assert.equal(fk.기록.띄움, 1)
})

test('시간 초과면 프로세스를 죽이고, 다음 요청은 새로 띄워 산다', async () => {
  모델깔기()
  const 멈춤 = 가짜fork({ 멈춤: true }); 켜기(멈춤)
  await assert.rejects(sup.synthesize({ text: '걸림' }, { out: path.join(캐시폴더, 't1.wav'), timeoutMs: 30 }), /시간 초과/)
  assert.equal(멈춤.기록.죽임, 1)
  const 정상 = 가짜fork()
  sup.__setForkForTests(정상.fn)
  const r = await sup.synthesize({ text: '다음' }, { out: path.join(캐시폴더, 't2.wav') })
  assert.ok(fs.existsSync(r.file))
  assert.equal(정상.기록.띄움, 1)
})

test('tts.js — Supertonic 이 맨 앞이면 WAV·새 열쇠, 자막 사이드카에 어절이 들어간다', async () => {
  모델깔기()
  const fk = 가짜fork(); 켜기(fk)
  const tts = require('../services/tts')
  // 맨 앞이 Supertonic 이다. 뒤(Azure·윈도우 음성)는 PC·설정에 따라 붙는다(각 엔진 시험이 본다).
  assert.equal(tts.엔진차례()[0], 'supertonic')
  assert.ok(!tts.엔진차례().includes('edge'), '걷어낸 옛 엔진이 차례에 남았다')
  const params = { text: '어르신 여러분, 점심 진지 드시러 오세요.', voice: 'ko-KR-SunHiNeural', rate: '-10%', pitch: '+0Hz' }
  assert.notEqual(tts.cacheKeyFor(params, 'supertonic'), tts.cacheKeyFor(params, '옛mp3'), '엔진이 달라도 같은 열쇠다 — 옛 mp3 가 계속 나간다')
  assert.match(tts.cachePathFor(params, 캐시폴더), /\.wav$/)

  const file = await tts.generateTTS(params, { priority: 2 })
  assert.match(file, /\.wav$/)
  assert.equal(tts.mimeOf(file), 'audio/wav')
  assert.equal(fk.기록.받음.at(-1).speed, 0.9, '설정 속도가 안 넘어갔다')
  const words = JSON.parse(fs.readFileSync(tts.cuesPathOf(file), 'utf8'))
  assert.ok(words.length >= 4, '자막 사이드카가 비었다 — 예약 미리 만들기가 매번 다시 합성한다')
  assert.ok(tts.readCues(file, params.text)?.lines?.length > 0, 'readCues 가 자막 줄을 못 만든다')
  tts.deleteTmpFile(file)
})

test('tts.js — 캐시: 만든 엔진의 열쇠로 두고, 맨 앞 엔진 것만 적중으로 친다', async () => {
  모델깔기()
  const fk = 가짜fork(); 켜기(fk)
  const tts = require('../services/tts')
  const params = { text: '투약 시간입니다.', voice: 'ko-KR-SunHiNeural', rate: '-10%', pitch: '+0Hz' }
  // 옛 mp3 캐시가 있어도 Supertonic 이 맨 앞이면 적중이 아니다 — 새로 만든다
  fs.writeFileSync(tts.cachePathFor(params, 캐시폴더, '옛mp3'), Buffer.alloc(2048, 1))
  fs.writeFileSync(`${tts.cachePathFor(params, 캐시폴더, '옛mp3')}.cues.json`, '[]')
  const f1 = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시폴더 })
  assert.match(f1, /\.wav$/, '옛 mp3 캐시를 적중으로 썼다')
  assert.equal(fk.기록.받음.length, 1)
  assert.ok(fs.existsSync(tts.cachePathFor(params, 캐시폴더, 'supertonic')), 'WAV 가 Supertonic 열쇠로 저장되지 않았다')
  // 두 번째는 WAV 캐시 적중 — 합성 안 함
  const f2 = await tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시폴더 })
  assert.match(f2, /\.wav$/)
  assert.equal(fk.기록.받음.length, 1, '캐시가 있는데 또 합성했다')
  tts.deleteTmpFile(f1); tts.deleteTmpFile(f2)
})

test('tts.js — 너무 짧은 WAV 는 캐시에 안 넣는다(무음이 매일 나가지 않게)', () => {
  const tts = require('../services/tts')
  const f = path.join(캐시폴더, 'short.wav')
  가짜wav(f, 0.05)
  assert.ok(fs.statSync(f).size > 512 && fs.statSync(f).size < tts.MIN_WAV_BYTES)
  const params = { text: '짧다', voice: 'v', rate: '+0%', pitch: '+0Hz' }
  모델깔기(); 켜기(가짜fork())
  const 전 = fs.readdirSync(캐시폴더).length
  // saveToCache 는 내보내지 않는다 — generateTTSWithRetry 에 짧은 파일을 내는 합성기를 끼워 본다
  return tts.generateTTSWithRetry(params, 1, { cacheDir: 캐시폴더, generate: async () => f }).then((out) => {
    assert.equal(out, f)
    assert.ok(!fs.existsSync(tts.cachePathFor(params, 캐시폴더, 'supertonic')), '0.05초 WAV 가 캐시에 들어갔다')
    assert.ok(fs.readdirSync(캐시폴더).length >= 전)
  })
})

// ── Codex ④-a 1회차 지적 다섯 ──────────────────────────────────────────────────────

// 프로세스마다 행동을 따로 주는 가짜 fork. 행동: { 멈춤, 지연, 늦은exitMs, 동기실패 }
function 차례fork(행동들) {
  const 기록 = { 띄움: 0, 받음: [] }
  const fn = () => {
    const 행동 = 행동들[기록.띄움] || {}
    기록.띄움++
    if (행동.동기실패) throw new Error('spawn ENOMEM')
    const c = new EventEmitter()
    c.kill = () => { setTimeout(() => c.emit('exit', null), 행동.늦은exitMs ?? 0) }
    c.send = (m) => {
      기록.받음.push(m.text)
      if (행동.멈춤) return
      const 끝내기 = () => setTimeout(() => { 가짜wav(m.out, 1); c.emit('message', { id: m.id, ok: true, durationSec: 1 }) }, 행동.지연 ?? 5)
      // 붙잡기: 첫 합성을 시험이 풀어 줄 때까지 끝내지 않는다 — 「그새 끝났을 것」 같은 시간 가정을 없앤다.
      if (행동.붙잡기 && 기록.받음.length === 1) 행동.붙잡기.then(끝내기)
      else 끝내기()
    }
    setImmediate(() => c.emit('message', { ready: true }))
    return c
  }
  return { fn, 기록 }
}
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))

test('[High] 죽인 프로세스의 **늦은 종료**가 새 프로세스의 일을 실패시키지 않는다', async () => {
  모델깔기()
  const fk = 차례fork([{ 멈춤: true, 늦은exitMs: 80 }, { 지연: 120 }]); 켜기(fk)
  const 첫 = sup.synthesize({ text: '걸림' }, { out: path.join(캐시폴더, 'x1.wav'), timeoutMs: 30 })
  const 둘 = sup.synthesize({ text: '다음' }, { out: path.join(캐시폴더, 'x2.wav'), timeoutMs: 2000 })
  await assert.rejects(첫, /시간 초과/)
  const r = await 둘   // A 의 exit(80ms)가 B 의 합성(120ms) 도중에 온다
  assert.ok(fs.existsSync(r.file))
  assert.equal(fk.기록.띄움, 2)
})

test('[High] 시간 예산은 **줄에 선 순간부터** — 기다리다 다 쓰면 보내지도 않고 끝난다', async () => {
  모델깔기()
  const fk = 차례fork([{ 지연: 150 }]); 켜기(fk)
  const 앞 = sup.synthesize({ text: '긴 앞 문장' }, { out: path.join(캐시폴더, 'b1.wav'), timeoutMs: 2000 })
  const t = Date.now()
  await assert.rejects(sup.synthesize({ text: '뒤 문장' }, { out: path.join(캐시폴더, 'b2.wav'), timeoutMs: 40 }), /시간 초과/)
  assert.ok(Date.now() - t < 120, `40ms 예산이 ${Date.now() - t}ms 로 늘었다`)
  await 앞
  assert.deepEqual(fk.기록.받음, ['긴 앞 문장'], '예산이 끝난 일을 프로세스에 보냈다')
})

test('[High] tts.js — 엔진이 여럿이면 **남은 예산만** 다음 엔진에 준다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'tts.js'), 'utf8')
  const i = src.indexOf('async function generateTTS(params, opts = {})')
  const 본문 = src.slice(i, src.indexOf('\n}\n', i))
  assert.match(본문, /const 마감 = Number\.isFinite\(opts\.timeoutMs\) \? Date\.now\(\) \+ opts\.timeoutMs : null/)
  // ⑥ 부터 인터넷 엔진은 남은 몫에서 뒤 엔진 예비를 뺀 「몫」 을 쓴다 — 어느 쪽이든 **남은 예산 이하**다.
  assert.match(본문, /let 몫 = 남음/, '다음 엔진에 처음 예산을 다시 준다')
  assert.match(본문, /\{ \.\.\.opts, timeoutMs: 몫 \}/)
})

test('[High] 같은 문장에 **더 급한 방송이 합류하면** 줄에서 기다리던 합성의 순위가 오른다', async () => {
  모델깔기()
  // 2026-10-07: 예전엔 「60ms 합성이 15ms 안에는 안 끝난다」에 기댔다 — 전체 verify 로 PC 가 바쁘면 그 5ms 가
  // 60ms 를 넘겨, 비상이 합류하기 전에 일반이 다음 차례로 뽑혀 빨간불이 났다(단독 5/5 통과 · 전체에서 1 실패).
  // 이제 첫 합성은 시험이 풀어 줄 때까지 붙잡히고, 비상의 합류 기록을 본 뒤에 푼다.
  let 풀기; const 붙잡기 = new Promise((r) => { 풀기 = r })
  const fk = 차례fork([{ 지연: 5, 붙잡기 }]); 켜기(fk)
  const tts = require('../services/tts')
  const p = (text) => ({ text, voice: 'v', rate: '+0%', pitch: '+0Hz' })
  const 언제까지 = async (조건, 이름) => {
    for (let i = 0; i < 400 && !조건(); i++) await 잠깐(5)
    assert.ok(조건(), `${이름} 을(를) 2초 안에 못 봤다`)
  }
  const 원래log = console.log; let 합류함 = false; let 결과
  console.log = (...a) => { if (String(a[0]).includes('같은 문장을 이미 만드는 중')) 합류함 = true; 원래log(...a) }
  try {
    const 진행 = tts.generateTTSWithRetry(p('지금 합성 중'), 1, { cacheDir: 캐시폴더, priority: 1 })
    await 언제까지(() => fk.기록.받음.length === 1, '첫 합성이 프로세스에 간 것')
    const 미리 = tts.generateTTSWithRetry(p('화재 경보 문장'), 1, { cacheDir: 캐시폴더, priority: 0 })
    const 일반 = tts.generateTTSWithRetry(p('일반 방송 문장'), 1, { cacheDir: 캐시폴더, priority: 1 })
    await 잠깐(5)
    const 비상 = tts.generateTTSWithRetry(p('화재 경보 문장'), 1, { cacheDir: 캐시폴더, priority: 2 })   // 합류
    await 언제까지(() => 합류함, '비상의 합류')
    await 잠깐(30)
    풀기()
    결과 = await Promise.all([진행, 미리, 일반, 비상])
  } finally {
    console.log = 원래log
    풀기()   // 앞에서 실패해도 붙잡힌 합성을 풀어 준다 — 안 풀면 시험 제한시간까지 매달린다(검수 1회차 Low)
  }
  assert.deepEqual(fk.기록.받음, ['지금 합성 중', '화재 경보 문장', '일반 방송 문장'], '비상이 일반 방송 뒤로 밀렸다')
  for (const f of 결과) tts.deleteTmpFile(f)
})

test('[Medium] fork 가 곧바로 실패해도 굳지 않는다 — 다음 요청은 다시 띄운다', async () => {
  모델깔기()
  const fk = 차례fork([{ 동기실패: true }, {}]); 켜기(fk)
  await assert.rejects(sup.synthesize({ text: '하나' }, { out: path.join(캐시폴더, 'e1.wav') }), /ENOMEM/)
  const r = await sup.synthesize({ text: '둘' }, { out: path.join(캐시폴더, 'e2.wav') })
  assert.ok(fs.existsSync(r.file))
  assert.equal(fk.기록.띄움, 2, '거절된 약속을 재사용해 fork 를 다시 안 했다')
})

test('[Medium] 미리 만들기 호출은 모두 순위 0 이다', () => {
  const 읽기 = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  assert.match(읽기('routes/tts.js'), /router\.post\('\/prepare'[\s\S]*?\}, 3, \{ priority: 0 \}\)/, '/prepare')
  assert.match(읽기('services/scheduler.js'), /generateTTSWithRetry\(params, 1, \{ noCache: true, priority: 0 \}\)/, '예약 미리 만들기')
  const pre = 읽기('services/prerenderAuto.js')
  assert.equal((pre.match(/generateTTSWithRetry\([^)]*\)/g) || []).filter((c) => !/priority: 0/.test(c)).length, 0, '선제 렌더')
})
