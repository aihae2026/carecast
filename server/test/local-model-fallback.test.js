// 로컬 1차가 실패할 때 **사람을 얼마나 기다리게 하는가** — 그 규칙을 고정한다.
//
// 왜 생겼나(2026-09-06 실측, EV-000755): 로컬이 실패한 뒤 API 로 넘어가 **총 19초**가 걸렸다
// (로컬 제한시간 8초 + 제미나이 10.5초). 사람이 버튼을 누르고 기다리는 자리다.
// 안 되는 PC 에서는 그 8초가 **문구를 만들 때마다** 반복된다.
//
// 여기서 잠그는 것 넷:
//  1. 연속 실패를 센다. 성공하면 지운다 — 어쩌다 한 번 실패한 PC 가 영영 안 쓰이면 안 된다.
//  2. 한도에 닿으면 **아예 시도하지 않는다**(제한시간을 안 쓴다).
//  3. 건너뛸 때도 **왜 건너뛰는지** 말한다. 조용히 안 쓰면 사람이 원인을 못 찾는다.
//  4. 데우기는 **한 번만** 하고, 만든 세션을 재사용하지 않는다(문맥이 다음 문구에 스민다).
//
// src/lib/localModel.js 는 브라우저도 React 도 모르는 순수 모듈이라 노드에서 그대로 돈다
// (guide-map.test.js 와 같은 결). localStorage 는 인자로 주입한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')
const fs     = require('fs')
const { pathToFileURL } = require('url')

const MOD = path.join(__dirname, '..', '..', 'src', 'lib', 'localModel.js')
const load = () => import(pathToFileURL(MOD).href)

/** localStorage 흉내 — 진짜를 쓰면 테스트끼리 상태가 샌다. */
function 가짜저장소() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

/**
 * 진단이 끝난 브라우저를 흉내 낸다 — 그래야 1차가 켜진다.
 * **`ko: true` 가 있어야 한다**(2026-09-06). 한국어를 확인해 보지 않은 기록은 꺼진 것으로 본다.
 */
function 준비된저장소() {
  const s = 가짜저장소()
  s.setItem('carecast:localAi:diagnosis', JSON.stringify({ status: 'available', ko: true }))
  return s
}

test('연속 실패를 세고, 성공하면 지운다', async () => {
  const { recordFailure, clearFailures, lastFailure, localGivenUp, FAIL_LIMIT } = await load()
  const s = 가짜저장소()

  assert.equal(lastFailure(s), null)
  assert.equal(localGivenUp(s), false)

  recordFailure('제한시간 초과', s)
  assert.equal(lastFailure(s).count, 1)
  assert.equal(localGivenUp(s), false, '한 번 실패했다고 포기하면 어쩌다 한 번에 꺼진다')

  recordFailure('제한시간 초과', s)
  assert.equal(lastFailure(s).count, FAIL_LIMIT)
  assert.equal(localGivenUp(s), true)

  clearFailures(s)
  assert.equal(localGivenUp(s), false, '성공해도 안 풀리면 그 PC 는 영영 로컬을 안 쓴다')
})

test('한도에 닿으면 제한시간을 쓰지 않고 곧바로 건너뛴다 — 8초를 매번 버리지 않는다', async () => {
  const { generateLocal, recordFailure, FAIL_LIMIT } = await load()
  const s = 준비된저장소()
  for (let i = 0; i < FAIL_LIMIT; i++) recordFailure('서비스가 안 돈다', s)

  // 부르면 안 되는 자리다. 불리면 그만큼 사람이 기다린 것이다.
  const 불림 = { count: 0 }
  const g = { LanguageModel: { availability: async () => 'available',
    create: async () => { 불림.count++; return { prompt: async () => '안 돼야 한다' } } } }

  const t0 = Date.now()
  const r = await generateLocal('점심 안내', '', { allowed: true, storage: s, g })
  assert.equal(r.ok, false)
  assert.equal(불림.count, 0, '포기 상태인데 모델을 불렀다 — 제한시간만큼 사람이 기다린다')
  assert.ok(Date.now() - t0 < 1000, '건너뛰는 데 시간이 걸렸다')
  assert.match(r.reason, /건너뜀/, '왜 안 썼는지 말하지 않는다 — 사람이 원인을 못 찾는다')
  assert.match(r.reason, /서비스가 안 돈다/, '원래 실패 이유가 사라졌다')
})

test('성공하면 실패 기록이 지워진다', async () => {
  const { generateLocal, recordFailure, lastFailure } = await load()
  const s = 준비된저장소()
  recordFailure('한 번 실패', s)

  const g = { LanguageModel: { availability: async () => 'available',
    create: async () => ({ prompt: async () => '어르신 여러분, 점심 식사 시간입니다.', destroy() {} }) } }

  const r = await generateLocal('점심 안내', '', { allowed: true, storage: s, g })
  assert.equal(r.ok, true, `로컬이 성공해야 한다: ${JSON.stringify(r)}`)
  assert.equal(lastFailure(s), null, '성공했는데 실패 기록이 남아 있다')
})

test('실패하면 그 이유가 기록에 남는다 — 콘솔을 안 열어도 화면이 보여 줄 수 있어야 한다', async () => {
  const { generateLocal, lastFailure } = await load()
  const s = 준비된저장소()
  const g = { LanguageModel: { availability: async () => 'available',
    create: async () => { throw new Error('service is not running') } } }

  const r = await generateLocal('점심 안내', '', { allowed: true, storage: s, g })
  assert.equal(r.ok, false)
  assert.match(lastFailure(s).reason, /service is not running/)
})

test('데우기는 한 번만 하고, 만든 세션을 재사용하지 않는다', async () => {
  const { warmupLocal, _resetWarmup } = await load()
  _resetWarmup()
  const s = 준비된저장소()
  const 만든것 = []
  const g = { LanguageModel: { availability: async () => 'available',
    create: async () => { const o = { destroyed: false, destroy() { this.destroyed = true } }; 만든것.push(o); return o } } }

  const a = await warmupLocal(true, { g, storage: s })
  const b = await warmupLocal(true, { g, storage: s })
  assert.equal(a.ok, true)
  assert.equal(만든것.length, 1, '데우기를 여러 번 했다 — 그만큼 메모리와 시간을 쓴다')
  assert.equal(b.skipped, true)
  // 세션을 붙들고 있으면 앞의 대화가 다음 문구에 스미고 토큰 한도도 함께 찬다
  assert.equal(만든것[0].destroyed, true, '데운 세션을 안 버렸다')
})

test('포기 상태에서는 데우지도 않는다', async () => {
  const { warmupLocal, _resetWarmup, recordFailure, FAIL_LIMIT } = await load()
  _resetWarmup()
  const s = 준비된저장소()
  for (let i = 0; i < FAIL_LIMIT; i++) recordFailure('안 된다', s)
  let 불림 = 0
  const g = { LanguageModel: { availability: async () => 'available', create: async () => { 불림++; return {} } } }

  const r = await warmupLocal(true, { g, storage: s })
  assert.equal(r.skipped, true)
  assert.equal(불림, 0, '포기했는데 모델을 올렸다')
})

test('데우기를 부르는 자리가 실제로 화면에 있다 — 안 부르면 첫 호출이 그대로 느리다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'TTSBroadcast.jsx'), 'utf8')
  assert.match(src, /warmupLocal\(/, '패널을 열 때 데우지 않는다')
  assert.match(src, /setAiOpen\(열림\)/, '패널 열림을 가르는 자리가 없다')
})

// ── 한국어를 못 내는 모델은 1차로 쓰지 않는다 (2026-09-06 실측) ──────────
//
// 크롬 152 는 모델이 available 이어도 **한국어를 지원 출력 언어로 치지 않는다.**
// 사용자 콘솔에 크롬이 남긴 경고: "supported output language code: [de, en, es, fr, ja]".
// 그래도 답은 나오는데, `## 점심 배식 안내 (YYYY년 YYYY월 YYYY일)` 처럼 마크다운 제목과
// 빈칸 표시가 섞인다. TTS 가 그대로 읽으면 어르신께 그 글자가 그대로 나간다.
//
// **느린 것보다 이것이 먼저다** — 빨라져도 나오는 물건이 방송문이 아니다.

test('한국어가 안 되면 1차를 안 켠다 — 모델이 준비돼 있어도', async () => {
  const { localFirstEnabled } = await load()
  const s = 가짜저장소()

  s.setItem('carecast:localAi:diagnosis', JSON.stringify({ status: 'available', ko: false }))
  assert.equal(localFirstEnabled(true, s), false,
    '한국어를 못 내는 모델로 방송문을 만들려 한다')

  s.setItem('carecast:localAi:diagnosis', JSON.stringify({ status: 'available', ko: true }))
  assert.equal(localFirstEnabled(true, s), true)
})

test('한국어를 확인해 보지 않은 옛 기록은 꺼진 것으로 본다', async () => {
  const { localFirstEnabled } = await load()
  const s = 가짜저장소()
  // ko 필드가 생기기 전에 저장된 기록. 이걸 켜진 것으로 보면 옛 브라우저가 조용히 계속 쓴다
  s.setItem('carecast:localAi:diagnosis', JSON.stringify({ status: 'available' }))
  assert.equal(localFirstEnabled(true, s), false)
})

test('지원 언어 목록을 코드에 박지 않았다 — 크롬이 한국어를 더하면 저절로 켜져야 한다', async () => {
  const { outputLanguageSupported } = await load()

  // 크롬이 아직 한국어를 안 받는 경우: 던지거나 unavailable 을 준다. 둘 다 false 다.
  const 던짐 = { LanguageModel: { availability: async () => { throw new Error('unsupported language') } } }
  assert.equal(await outputLanguageSupported(던짐), false)
  const 없음 = { LanguageModel: { availability: async () => 'unavailable' } }
  assert.equal(await outputLanguageSupported(없음), false)

  // 크롬이 나중에 한국어를 지원하면 **코드를 안 고쳐도** 참이 된다
  const 생김 = { LanguageModel: { availability: async () => 'available' } }
  assert.equal(await outputLanguageSupported(생김), true)

  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'localModel.js'), 'utf8')
  assert.doesNotMatch(src, /\[\s*'de'\s*,\s*'en'/,
    '지원 언어 목록을 박아 뒀다 — 크롬이 한국어를 더해도 아무도 안 고쳐서 영영 안 켜진다')
  assert.match(src, /outputLanguage: lang/, '언어를 물어보는 자리가 없다')
})

test('실제 호출에 출력 언어를 실어 보낸다 — 안 알리면 아무 언어로나 만든다', async () => {
  const { promptLocal, NEEDED_OUTPUT_LANGUAGE } = await load()
  let 받은옵션 = null
  const g = { LanguageModel: {
    availability: async () => 'available',
    create: async (o) => { 받은옵션 = o; return { prompt: async () => '어르신 여러분, 안녕하세요.', destroy() {} } },
  } }
  const r = await promptLocal('안내문 하나', { g })
  assert.equal(r.ok, true)
  assert.equal(받은옵션?.outputLanguage, NEEDED_OUTPUT_LANGUAGE,
    '출력 언어를 안 알린다 — 크롬이 경고만 남기고 아무 언어로나 만든다')
})
