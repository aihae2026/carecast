// 정적 4종 선제 렌더 — 미리 만든 것이 발사 때 **실제로 쓰이는가**.
//
// 이 테스트의 핵심은 하나다: **캐시 키가 맞는가.**
// 미리 만든 것과 발사 때 찾는 것이 글자 하나라도 다르면 캐시가 안 맞고, 발사 경로가
// 예전처럼 합성한다 — 그러면 아무것도 안 고친 것이 된다. 그런데 그 실패는 **조용하다**
// (소리는 나가고 1분 늦을 뿐이라 아무도 모른다). 그래서 소스 대조로 못박는다.
//
// 실제 합성(옛 인터넷 합성 엔진)은 하지 않는다. 네트워크와 시간이 들고, 여기서 확인할 것은
// "무엇을 어떤 파라미터로 만들 것인가"이지 소리 자체가 아니다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_prerender_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const pre = require('../services/prerenderAuto')
const { cacheKeyFor } = require('../domain/ttsSynthesis')

const set = (k, v) => getDB()
  .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run(k, String(v))

test.before(() => {
  initDB()
  for (const k of ['exercise_broadcast_enabled', 'lunch_broadcast_enabled',
    'dinner_broadcast_enabled', 'evening_prayer_enabled', 'morning_enabled']) set(k, 'true')
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('정적 4종의 문안을 모은다 — 아침은 안 들어간다', () => {
  const items = pre.staticTexts(getDB())
  const lanes = [...new Set(items.map((i) => i.lane))].sort()
  assert.deepEqual(lanes, ['dinner', 'evening_prayer', 'exercise', 'lunch'])
  assert.equal(items.some((i) => i.lane === 'morning'), false,
    '아침은 가변이라 여기서 다루지 않는다(2-b)')
  assert.ok(items.length >= 4, `문안이 너무 적다: ${items.length}건`)
})

test('꺼 둔 방송은 미리 만들지 않는다', () => {
  set('exercise_broadcast_enabled', 'false')
  const 꺼짐 = pre.staticTexts(getDB())
  assert.equal(꺼짐.some((i) => i.lane === 'exercise'), false, '꺼 둔 방송을 미리 만들고 있다')
  set('exercise_broadcast_enabled', 'true')
  assert.equal(pre.staticTexts(getDB()).some((i) => i.lane === 'exercise'), true)
})

test('TTS 파라미터가 실행부(stepTTS)와 같은 방법으로 만들어진다 — 다르면 캐시가 안 맞는다', () => {
  // 소스를 대조한다. 동작만 보면 "지금은 마침 같다"와 구별되지 않는다(원칙 8).
  const stepsSrc = fs.readFileSync(require.resolve('../services/broadcastSteps'), 'utf8')
  const preSrc   = fs.readFileSync(require.resolve('../services/prerenderAuto'), 'utf8')
  for (const 조각 of [
    "voiceMap[opts.ttsVoice] || getSetting(db, 'tts_voice_morning', 'ko-KR-SunHiNeural')",
    "parseFloat(getSetting(db, 'tts_rate',  '0.9')) || 0.9",
    "parseFloat(getSetting(db, 'tts_pitch', '1'))   || 1",
  ]) {
    assert.ok(stepsSrc.includes(조각), `실행부가 바뀌었다: ${조각}`)
  }
  // 선제 렌더는 같은 값을 쓰되 step 을 인자로 받는다(opts 대신 step)
  assert.match(preSrc, /voiceMap\[step\.ttsVoice\] \|\| getSetting\(db, 'tts_voice_morning'/)
  assert.match(preSrc, /getSetting\(db, 'tts_rate',\s*'0\.9'\)/)
  assert.match(preSrc, /getSetting\(db, 'tts_pitch', '1'\)/)
})

test('단계의 목소리 덮어쓰기를 반영한다 — 안 하면 그 단계만 캐시가 빗나간다', () => {
  const db = getDB()
  const 기본 = pre.ttsParamsFor(db, '안내입니다', {})
  const 남자 = pre.ttsParamsFor(db, '안내입니다', { ttsVoice: 'male' })
  assert.notEqual(기본.voice, 남자.voice)
  assert.equal(남자.voice, 'ko-KR-InJoonNeural')
  // 목소리가 다르면 캐시 키도 달라야 한다(같으면 엉뚱한 목소리가 재생된다)
  assert.notEqual(cacheKeyFor(기본), cacheKeyFor(남자))
})

test('편집기에서 끈 단계는 미리 만들지 않는다', () => {
  const db = getDB()
  const 전 = pre.staticTexts(db).filter((i) => i.lane === 'dinner').length
  set('dinner_steps', JSON.stringify([{ id: 'dinner_tts', label: '저녁 안내', enabled: false, order: 0 }]))
  const 후 = pre.staticTexts(db).filter((i) => i.lane === 'dinner').length
  assert.ok(후 < 전, `끈 단계가 그대로 남아 있다 (전 ${전} → 후 ${후})`)
  set('dinner_steps', '')
})

test('readiness 는 합성하지 않고 준비 상태만 센다', () => {
  const { CACHE_DIR } = require('../services/tts')
  const 세기 = () => { try { return fs.readdirSync(CACHE_DIR).length } catch { return 0 } }

  const 전 = 세기()
  const r = pre.readiness(getDB())
  const 후 = 세기()

  assert.equal(typeof r.total, 'number')
  assert.ok(Array.isArray(r.missing))
  assert.equal(r.ready + r.missing.length, r.total, '준비된 것 + 없는 것 = 전체여야 한다')
  // **아무것도 만들지 않아야 한다.** 관찰용 함수가 합성을 시작하면 관찰이 대상을 바꾼다.
  assert.equal(후, 전, `readiness 가 캐시 파일을 만들었다 (${전} → ${후})`)
  // ready 개수 자체는 기계마다 다르다(이 PC 는 이미 방송을 낸 적이 있어 캐시가 있다).
  // 그래서 값이 아니라 **범위와 무부작용**만 본다.
  assert.ok(r.ready >= 0 && r.ready <= r.total)
})

test('성격이 가변으로 바뀌면 선제 렌더에서 빠진다', () => {
  const seq = require('../services/broadcastSequencer')
  const 원래 = seq.LANES.dinner.contentSource
  seq.LANES.dinner.contentSource = 'system_template'
  try {
    assert.equal(pre.staticTexts(getDB()).some((i) => i.lane === 'dinner'), false,
      '가변이 된 방송을 아직도 정적으로 미리 만들고 있다')
  } finally {
    seq.LANES.dinner.contentSource = 원래
  }
})
