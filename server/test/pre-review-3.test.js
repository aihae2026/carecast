// 2차 검토 반영 뒤 같은 관점의 추가 점검(2026-11-10) — 전문가가 다음에 짚을 만한 것을 먼저 막는다.
//
//  ① 예약 발사·미리 만들기·자동방송 단계에도 **실행 직전** 민감정보 검사(흐름과 같은 원칙 — 1차 4-1)
//     저장 때만 검사하면 규칙이 강해지기 전에 저장된 문구가 그대로 나간다.
//  ② 개발 콘솔 라우트의 바꾸기·실행은 이 PC 에서만, 개발 점검(run-verify)은 설치판에서 안 돈다
//  ③ 쓰지 않는 Anthropic/Claude 키·제공자를 받지 않는다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_prereview3_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 합성·저장·차임은 가짜로(진짜 모델·스피커를 안 부른다) — delivery-truth.test.js 와 같은 방식 ──
const 합성 = []
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async (p) => { 합성.push(p.text); return '/tmp/fake.wav' },
    generateTTSWithRetry: async (p) => { 합성.push(p.text); return '/tmp/fake.wav' },
    readCues: () => null, deleteTmpFile: () => {}, rateToStr: () => '+0%', pitchToStr: () => '+0Hz',
    cachePathFor: () => '/tmp/none.wav', getPythonPath: () => null, MIN_CACHE_BYTES: 1, BROADCAST_BUDGET_MS: 1000,
  },
}
const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true,
  exports: { storeAudio: () => 'fake-audio-id', consumeAudio: () => null },
}
const 받아온소리 = []
const renderPath = require.resolve('../services/renderOnDemand')
require.cache[renderPath] = {
  id: renderPath, filename: renderPath, loaded: true, exports: {
    obtainAudio: async (p) => { 받아온소리.push(p.text); throw new Error('시험: 여기까지 오면 안 된다') },
    isReady: () => false, recordMiss: () => {},
  },
}

const { initDB, getDB } = require('../db/schema')
initDB()
const { fireSchedule, queueSchedulePrewarm, waitForSchedulePrewarm } = require('../services/scheduler')

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 그만 */ } }
})

let seq = 0
function 예약(content) {
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, ?, '전체', '10:00', 1, '2026-11-10', '[]', 'text')
  `).run(`추가점검${++seq}`, content).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

// ── ① 실행 직전 검사 ──────────────────────────────────────────────────────────
test('① 예약 발사: 저장 뒤 규칙이 강해져도 번호가 든 예약은 합성·방송하지 않는다', async () => {
  합성.length = 0
  const s = 예약('보호자 연락처 010-1234-5678 201호로 전화 주세요')
  await fireSchedule(s, getDB())
  assert.equal(합성.length, 0, '번호가 든 예약 문구를 합성했다')
  const 이력 = getDB().prepare("SELECT * FROM broadcasts WHERE type = '예약' ORDER BY id DESC LIMIT 1").get()
  assert.equal(이력.success, 0, '방송 안 한 것을 성공으로 적었다')
  assert.doesNotMatch(이력.content, /1234|5678/, '막은 번호를 이력에 그대로 남겼다')
  const 경보 = getDB().prepare("SELECT * FROM broadcasts WHERE type = '경보' AND content LIKE ? ORDER BY id DESC LIMIT 1").get(`%${s.title}%`)
  assert.ok(경보, '경보가 없다 — 사람이 모른 채 방송이 빠진다')
  assert.doesNotMatch(경보.content, /1234|5678/, '경보 문구에 번호가 그대로 들어갔다')
})

test('① 예약 발사: 깨끗한 문구는 예전처럼 합성한다', async () => {
  합성.length = 0
  await fireSchedule(예약('점심 식사 시간입니다. 2층 식당으로 오세요.'), getDB())
  assert.equal(합성.length, 1, '멀쩡한 예약이 안 나갔다')
})

test('① 미리 만들기: 번호가 든 예약은 미리 합성하지 않는다(깨끗한 것은 합성)', async () => {
  합성.length = 0
  const 나쁜 = 예약('주민번호 900101-1234567 확인 부탁드립니다')
  queueSchedulePrewarm(getDB(), 나쁜.id)
  await waitForSchedulePrewarm()
  assert.equal(합성.length, 0, '번호가 든 예약을 미리 합성했다(Azure 면 외부 전송)')
  const 좋은 = 예약('오후 체조 시간입니다')
  queueSchedulePrewarm(getDB(), 좋은.id)
  await waitForSchedulePrewarm()
  assert.equal(합성.length, 1, '멀쩡한 예약의 미리 만들기가 멈췄다')
})

test('① 자동방송 단계: 번호가 든 안내 문구는 소리를 받아 오기 전에 그 단계만 실패시킨다', async () => {
  받아온소리.length = 0
  const { stepTTS, stepPrayerTTS } = require('../services/broadcastSteps')
  for (const 단계 of [stepTTS, stepPrayerTTS]) {
    await assert.rejects(단계(getDB(), '문의 010 1234 5678 로 연락 주세요', '시험 안내', null),
      (e) => /개인정보/.test(e.message) && !/1234|5678/.test(e.message))
  }
  assert.equal(받아온소리.length, 0, '번호가 든 문구로 소리를 만들러 갔다')
})

test('① 자동방송 단계: 번호만 보고 날짜는 막지 않는다(자동으로 지은 문구에 옛 날짜가 들어간다)', async () => {
  받아온소리.length = 0
  const { stepTTS } = require('../services/broadcastSteps')
  // 검사를 통과하면 소리를 받으러 간다(시험용 가짜가 던져서 여기서 멈춘다)
  await assert.rejects(stepTTS(getDB(), '오늘은 1919년 3월 1일 삼일절을 기억하는 날입니다', '시험 안내', null), /여기까지 오면 안 된다/)
  assert.equal(받아온소리.length, 1, '날짜를 생년월일로 보고 자동방송을 막았다')
})

// ── ② 개발 콘솔 라우트 ─────────────────────────────────────────────────────────
test('② 개발 라우트: 바꾸기·실행은 이 PC 에서만, 읽기는 그대로', () => {
  const { 이PC에서만바꾸기 } = require('../services/devGuard')
  const 부르기 = (method, remoteAddress) => {
    let 통과 = false, 상태 = 200
    const res = { status(c) { 상태 = c; return this }, json() { return this } }
    이PC에서만바꾸기({ method, socket: { remoteAddress } }, res, () => { 통과 = true })
    return { 통과, 상태 }
  }
  assert.deepEqual(부르기('POST', '192.168.0.55'), { 통과: false, 상태: 403 })
  assert.deepEqual(부르기('DELETE', '192.168.0.55'), { 통과: false, 상태: 403 })
  assert.equal(부르기('GET', '192.168.0.55').통과, true, '원격 화면의 읽기까지 막았다')
  assert.equal(부르기('POST', '127.0.0.1').통과, true, '이 PC 의 개발 콘솔을 막았다')
  assert.equal(부르기('POST', '::ffff:127.0.0.1').통과, true)

  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  for (const 길 of ['/api/devlog', '/api/dev/proposals', '/api/dev/brief', '/api/dev/nl-stats', '/api/dev/arch']) {
    assert.match(index, new RegExp(`app\\.use\\('${길.replace(/\//g, '\\/')}',\\s*이PC에서만바꾸기`),
      `${길} 에 이 PC 제한이 없다`)
  }
})

test('② 개발 점검(run-verify)은 설치판(git 저장소 없음)에서 돌리지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'coachingBrief.js'), 'utf8')
  const at = src.indexOf("router.post('/checkins/run-verify'")
  assert.ok(at > 0)
  assert.match(src.slice(at, at + 600), /\.git/, '설치판에서도 npm 명령을 실행한다')
})

// ── ③ 쓰지 않는 AI 키 ─────────────────────────────────────────────────────────
test('③ 쓰지 않는 Anthropic/Claude 키와 제공자는 받지 않는다', async () => {
  const { startTestApp } = require('./helpers/testApp')
  const app = await startTestApp({ '/api/settings': require('../routes/settings') })
  try {
    const post = (p, body) => fetch(app.baseUrl + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    for (const key of ['anthropic_api_key', 'claude_api_key']) {
      assert.equal((await post('/api/settings/api-keys', { key, value: 'sk-test-123' })).status, 400, `${key} 를 받는다`)
    }
    assert.equal((await post('/api/settings/ai', { provider: 'claude' })).status, 400, 'claude 제공자를 받는다')
    assert.equal((await post('/api/settings/ai', { provider: 'gemini' })).status, 200)
    const keys = await (await fetch(app.baseUrl + '/api/settings/api-keys')).json()
    assert.doesNotMatch(JSON.stringify(keys), /anthropic|claude/, '쓰지 않는 키 칸을 화면에 내보낸다')
  } finally { await app.close() }
})

// ── ④ 인증서 암호를 코드에 박지 않는다 ─────────────────────────────────────────
test('④ 새 인증서는 만들 때마다 무작위 암호를 쓰고, 그 암호로 읽는다', () => {
  const 인증서 = require('../services/httpsCert')
  const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cert-pass-'))
  try {
    const 만든암호 = []
    const 만들기 = () => 인증서.인증서만들기(['192.168.0.5'], { platform: 'win32', 폴더, log: {},
      spawnSync: (cmd, args) => { 만든암호.push(args[args.indexOf('-Pass') + 1]); fs.writeFileSync(path.join(폴더, 'cert.pfx'), 'x'); return { status: 0 } } })
    assert.equal(만들기(), true)
    assert.equal(만들기(), true)
    assert.equal(만든암호.length, 2)
    assert.notEqual(만든암호[0], 만든암호[1], '암호가 매번 같다 — 코드에 박힌 값이다')
    for (const p of 만든암호) assert.ok(p.length >= 16 && p !== 'carecast-local', `암호가 약하다: ${p}`)
    assert.equal(인증서.인증서읽기(폴더).passphrase, 만든암호[1], '마지막에 만든 인증서의 암호로 읽지 않는다')
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'services', 'httpsCert.js'), 'utf8'),
      /'-Pass', PFX암호\b/, '고정 암호를 스크립트에 넘긴다')
  } finally { fs.rmSync(폴더, { recursive: true, force: true }) }
})

test('④ 이미 설치된 PC(암호 파일 없는 옛 인증서)는 예전 암호로 그대로 읽는다', () => {
  const 인증서 = require('../services/httpsCert')
  const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cert-old-'))
  try {
    fs.writeFileSync(path.join(폴더, 'cert.pfx'), 'x')
    assert.equal(인증서.인증서읽기(폴더).passphrase, 'carecast-local', '업데이트하자마자 HTTPS 가 꺼진다')
  } finally { fs.rmSync(폴더, { recursive: true, force: true }) }
})
