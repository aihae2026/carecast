// CARECAST_NO_NETWORK — 네트워크 차단 모드 (P-11, 사용자 승인 2026-09-10 §2).
//
// 계약표: `docs/audit/NETWORK_FLAG_DESIGN.md`. 이 검사는 그 표를 지킨다.
//
// **세 가지를 따로 본다.**
//   ① 미설정이면 아무것도 안 바뀐다 — 기존 동작 보존이 첫째 조건이다.
//   ② 켜면 바깥 호출이 **거절**된다 — 조용히 성공으로 위장하지 않는다(CC-008 delivery-truth).
//   ③ 차단된 것은 이력에 **성공으로 안 적힌다.**
// 그리고 `CARECAST_NO_HARDWARE` 의 뜻이 **안 바뀌었는지**도 함께 고정한다.
//
// 실부작용 없음 — 차단 경로만 태운다. 진짜 바깥으로 나가는 호출은 하지 않는다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_netmode_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { networkDisabled, blockedError } = require('../services/networkMode')

test.before(() => { initDB() })
test.after(() => {
  delete process.env.CARECAST_NO_NETWORK
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

async function 켜고(fn) {
  process.env.CARECAST_NO_NETWORK = '1'
  try { return await fn() } finally { delete process.env.CARECAST_NO_NETWORK }
}

// ── ① 기존 동작 보존 ────────────────────────────────────────────────────

test('미설정이면 차단하지 않는다 — 새 플래그의 기본값은 "아무것도 안 바꾼다"', () => {
  delete process.env.CARECAST_NO_NETWORK
  assert.equal(networkDisabled(), false)
  for (const 값 of ['0', 'false', '', 'yes', 'true', '1']) {
    process.env.CARECAST_NO_NETWORK = 값
    assert.equal(networkDisabled(), 값 === '1',
      `"${값}" 을 잘못 읽는다 — 오직 '1' 만 켜짐이다(hardwareMode 와 같은 규칙)`)
  }
  delete process.env.CARECAST_NO_NETWORK
})

test('CARECAST_NO_HARDWARE 의 뜻은 안 바뀌었다 — 두 스위치는 독립이다', async () => {
  const { hardwareDisabled } = require('../services/hardwareMode')
  // node --test 안에서는 NODE_TEST_CONTEXT 때문에 하드웨어가 이미 꺼져 있다(그 계약 그대로).
  assert.equal(hardwareDisabled(), true, 'hardwareMode 의 테스트 자동 감지가 사라졌다')
  await 켜고(async () => assert.equal(hardwareDisabled(), true, '네트워크 플래그가 하드웨어 판정을 건드렸다'))
  assert.equal(networkDisabled(), false,
    '하드웨어가 꺼졌다고 네트워크까지 막으면 기존 테스트의 전제가 통째로 바뀐다')
})

// ── ② 켜면 거절한다 (조용히 성공으로 위장하지 않는다) ────────────────────

test('켜면 Gemini 호출이 거절된다 — 유료 호출이라 특히 값어치가 있다', async () => {
  const { fetchGeminiWithRetry } = require('../services/geminiClient')
  await 켜고(() => assert.rejects(
    fetchGeminiWithRetry('https://generativelanguage.googleapis.com/x', {}),
    /네트워크 차단 모드/, 'Gemini 가 안 막혔다'))
})

test('켜면 스마트플러그 제어가 거절된다 — 클라우드 경유라 여기서 막힌다', async () => {
  const { sendCommand } = require('../services/switchbot')
  await 켜고(() => assert.rejects(sendCommand('press'), /네트워크 차단 모드/, 'SwitchBot 이 안 막혔다'))
})

// 2026-09-21: 안내 음성 기본 엔진이 이 PC 안에서 합성한다(Supertonic) — 차단 모드에서도 **허용**이다
// (NETWORK_FLAG_DESIGN 덧붙임). 인터넷을 타는 것은 선택 엔진 Azure 뿐이고, 그것만 막힌다.
test('켜면 인터넷 음성(Azure)이 빠진다 — 합성은 조용히 빈 파일을 주지 않는다 (P-11 본체)', async () => {
  const azure = require('../services/ttsEngines/azure')
  const { generateTTS } = require('../services/tts')
  await 켜고(async () => {
    assert.equal(azure.available(), false, '차단 모드에서 Azure 가 차례에 남았다')
    // 시험 안에서는 엔진이 모두 빠진다 — 빈 파일로 성공하지 않고 거절해야 한다.
    await assert.rejects(generateTTS({ text: '점심 안내입니다' }), /엔진이 없다/)
  })
})

test('거절 문장이 사람 말이다 — 왜 막혔는지 알 수 있어야 한다', () => {
  const e = blockedError('날씨 조회')
  assert.match(e.message, /네트워크 차단 모드/)
  assert.match(e.message, /날씨 조회/, '무엇이 막혔는지 안 적혀 있다')
})

// ── ③ 차단된 것을 성공으로 기록하지 않는다 ──────────────────────────────

test('차단된 방송은 이력에 성공으로 안 남는다', () => {
  const { 시작기록, 실패로정정 } = require('../domain/broadcastRecord')
  const db = getDB()
  // 즉시 방송 경로의 모양: 낙관적으로 남기고 → 합성/재생이 거절되면 되돌린다.
  const id = 시작기록(db, { type: 'TTS', content: '차단 시험' })
  실패로정정(db, id, blockedError('음성 합성(Azure)').message)
  const r = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)
  assert.equal(r.success, 0,
    '차단됐는데 성공으로 남았다 — 무음인데 기록만 멀쩡한 상태다(이 저장소에서 가장 비싼 실패)')
})

// ── 바깥으로 나가는 파일이 **하나도 빠짐없이** 게이트를 지나는가 ──────────
// 새 파일이 fetch 를 들고 들어오면 조용히 가드 밖이 된다 — `fetch-timeout.test.js` 와 같은
// 방식(파일 목록 소스 대조)으로 막는다.

const 바깥호출파일 = [
  ['services', 'weather.js'], ['services', 'calendar.js'], ['services', 'switchbot.js'],
  ['services', 'geminiClient.js'],
  // (방송 실행부의 외부 동영상 호출 셋은 2026-09-21 걷어냈다 — BGM·영상은 이 PC 파일이다)
  ['routes', 'weather.js'], ['routes', 'weatherAlert.js'],
]

test('바깥으로 나가는 파일은 전부 네트워크 게이트를 본다', () => {
  const 안본것 = []
  for (const parts of 바깥호출파일) {
    const src = fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    // 직접 판정하든(networkDisabled) 공용 게이트를 부르든(바깥호출차단) 둘 다 인정한다.
    if (!/networkDisabled\(\)|바깥호출차단\(/.test(src)) 안본것.push(parts.join('/'))
  }
  assert.deepEqual(안본것, [],
    `게이트를 안 지나는 파일이 있다: ${안본것.join(', ')} — 반만 막고 "네트워크 차단"이라 하면 안 된다`)
})

test('게이트 목록이 실제 fetch 보유 파일과 어긋나지 않는다', () => {
  // 목록이 낡으면 새 파일이 조용히 빠진다. 반대로 fetch 가 없어진 파일이 남아도 알아야 한다.
  const 훑기 = (d) => fs.readdirSync(path.join(__dirname, '..', d))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /fetch\(/.test(fs.readFileSync(path.join(__dirname, '..', d, f), 'utf8')))
    .map((f) => `${d}/${f}`)
  const 실제 = [...훑기('services'), ...훑기('routes')].sort()
  const 목록 = 바깥호출파일.map((p) => p.join('/')).sort()
  assert.deepEqual(실제, 목록,
    `fetch 를 가진 파일과 목록이 다르다.\n  실제: ${실제.join(', ')}\n  목록: ${목록.join(', ')}`)
})

test('공용 게이트가 행동으로 막는다 — 파일마다 각자 정의하지 않는다', async () => {
  const { 바깥호출차단 } = require('../services/networkMode')
  // 꺼져 있으면 아무 일도 없다
  delete process.env.CARECAST_NO_NETWORK
  assert.doesNotThrow(() => 바깥호출차단('시험', '무엇'))
  // 켜면 던진다
  await 켜고(async () => assert.throws(() => 바깥호출차단('시험', '유튜브 조회'), /네트워크 차단 모드/))
})

test('게이트를 부르는 횟수가 fetch 횟수와 같다 — 한 자리만 빠지면 잡는다', () => {
  const 부르는파일 = [
    ['routes', 'weather.js'], ['routes', 'weatherAlert.js'],
  ]
  const 어긋남 = []
  for (const parts of 부르는파일) {
    const src = fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    const f = (src.match(/fetch\(/g) || []).length
    // 정의 한 줄은 빼고 **부른 횟수**만 센다
    const g = (src.match(/^\s*바깥막힘\(\)/gm) || []).length
    if (f !== g) 어긋남.push(`${parts.join('/')}: fetch ${f} vs 게이트 ${g}`)
  }
  assert.deepEqual(어긋남, [], `바깥 호출과 게이트 수가 다르다 — ${어긋남.join(' / ')}`)
})

test('각 파일의 게이트는 공용 함수를 부른다 — 자체 정의로 되돌아가지 않는다', () => {
  const 부르는파일 = ['routes/weather.js', 'routes/weatherAlert.js']
  for (const f of 부르는파일) {
    const src = fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8')
    // **정의 모양을 정확히** 본다. `바깥호출차단(` 만 찾으면 `0 && 바깥호출차단(...)`
    // 같은 무력화 변이가 통과한다([FACT] EV-003228 — 실제로 살아남았다).
    assert.match(src, /const 바깥막힘 = \(\) => 바깥호출차단\('/,
      `${f} 가 공용 게이트를 안 쓴다 — 자체 정의를 무력화하는 변이를 아무도 못 잡는다`)
  }
})

test('로컬 수신은 안 막는다 — 막으면 화면이 서버에 못 붙어 시스템이 죽는다', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.match(idx, /httpServer\.listen\(/, '앵커: 로컬 수신 자리가 사라졌다')
  assert.doesNotMatch(idx, /networkDisabled/,
    '네트워크 플래그가 로컬 수신 쪽에 들어갔다 — 계약표 C 갈래를 어겼다')
})
