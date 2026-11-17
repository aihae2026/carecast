// 캐시 키 · 문안 정규화 · 엔진 소금 — "이미 만든 캐시를 살린다"는 약속이 걸린 자리다.
//
// 열쇠 식이 바뀌면 전면 재합성이 일어난다(첫 방송들이 전부 첫 합성이 된다). 엔진마다 소금이 다르고,
// 같은 소금이면 식이 도입 때와 글자 하나까지 같다는 것을 여기서 못박는다.
'use strict'

const crypto = require('crypto')
const test   = require('node:test')
const assert = require('node:assert/strict')

const { normalizeText, cacheKeyFor } = require('../domain/ttsSynthesis')

// 소금을 넣은 열쇠 계산식 — 2026-09-21 엔진 층 도입 때의 모양 그대로(정규화 문안 · voice · rate · pitch · 소금).
// 이 식이 바뀌면 이미 만든 캐시가 통째로 버려진다 — 정시 방송의 첫 회가 모두 「첫 합성」이 된다.
function 소금키(p, salt) {
  return crypto.createHash('sha1')
    .update([normalizeText(p.text), p.voice, p.rate, p.pitch, salt].join(String.fromCharCode(0)))
    .digest('hex')
}

const 문안 = { text: '점심 식사 시간입니다.', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }
const 엔진소금 = () => ({
  supertonic: require('../services/ttsEngines/supertonic').SALT,
  azure: require('../services/ttsEngines/azure').SALT,
  sapi: require('../services/ttsEngines/sapi').SALT,
})

test('엔진 소금을 넣은 열쇠는 도입 때 식과 같다 — 이미 만든 캐시가 살아남는다', () => {
  for (const [이름, salt] of Object.entries(엔진소금())) {
    assert.equal(cacheKeyFor(문안, salt), 소금키(문안, salt), `${이름} 열쇠 식이 바뀌었다`)
  }
})

test('엔진마다 열쇠가 다르다 — 한 엔진의 소리가 다른 엔진 캐시로 나가지 않는다', () => {
  const 열쇠들 = Object.values(엔진소금()).map((s) => cacheKeyFor(문안, s))
  assert.equal(new Set(열쇠들).size, 열쇠들.length)
  const s = 엔진소금().supertonic
  assert.equal(cacheKeyFor(문안, s), cacheKeyFor(문안, s), '같은 소금이면 같은 열쇠(결정론적)')
})

test('재생 볼륨은 합성 열쇠·볼륨 모듈 어디에도 섞이지 않는다', () => {
  const volume = require('../domain/volume')
  const src = require('fs').readFileSync(require.resolve('../domain/volume'), 'utf8')
  assert.equal(volume.SYNTH_GAIN, undefined)
  assert.doesNotMatch(src, /SYNTH_GAIN|\+2dB/, '합성 게인이 volume.js 로 새어 들어갔다 — 재생 볼륨과 섞이면 안 된다')
})

test('문안 정규화 — 표기만 다른 문장은 같은 키가 된다', () => {
  const 같아야 = [
    ['점심 식사 시간입니다.', '  점심 식사 시간입니다.  '],          // 앞뒤 공백
    ['점심 식사 시간입니다.', '점심  식사   시간입니다.'],            // 연속 공백
    ['점심 식사 시간입니다.', '점심\t식사\n시간입니다.'],             // 탭·줄바꿈
    ['ABC 123 입니다.', 'ＡＢＣ １２３ 입니다.'],                     // 전각 영숫자
    ['(안내) 입니다.', '（안내） 입니다.'],                            // 전각 괄호
  ]
  for (const [a, b] of 같아야) {
    assert.equal(normalizeText(a), normalizeText(b), `정규화가 다르다: ${a} / ${b}`)
    assert.equal(cacheKeyFor({ ...문안, text: a }), cacheKeyFor({ ...문안, text: b }))
  }
})

test('정규화가 뜻까지 바꾸지는 않는다 — 다른 문장은 다른 키다', () => {
  assert.notEqual(normalizeText('점심 식사입니다'), normalizeText('저녁 식사입니다'))
  // 한글 자모 분리(NFD, 맥·아이폰이 보낸다)는 완성형과 같은 것으로 본다
  assert.equal(normalizeText('점심'), normalizeText('점심'.normalize('NFD')))
})

test('깨끗한 문안은 정규화해도 그대로다 — 대다수 기존 캐시가 살아남는 근거', () => {
  for (const s of ['점심 식사 시간입니다.', '투약 시간입니다. 약을 준비해 주세요.']) {
    assert.equal(normalizeText(s), s)
  }
})

test('빈 값·null 에도 던지지 않는다', () => {
  assert.equal(normalizeText(''), '')
  assert.equal(normalizeText(null), '')
  assert.equal(normalizeText(undefined), '')
  assert.equal(typeof cacheKeyFor({ ...문안, text: '' }), 'string')
})
