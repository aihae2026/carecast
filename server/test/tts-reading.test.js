// 합성 직전 읽기 다듬기 (사용자 청취 2026-09-21: 「23.5 로보씨?」「32 미러ㅔㄹ뤠」).
//
// 기본 엔진(Supertonic 3)은 ℃·㎍/㎥ 같은 기호를 말로 못 푼다. 합성 직전에 한국어 말로 바꾸고,
// 자막·열쇠 문안은 원문 그대로 둔다. 단어는 건드리지 않는다(숫자 바로 뒤의 단위만).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { 읽기다듬기 } = require('../domain/ttsReading')

test('온도·미세먼지 — 사용자가 들은 그 문장', () => {
  assert.equal(읽기다듬기('현재 기온은 23.5℃, 미세먼지는 35㎍/㎥로 보통입니다.'),
    '현재 기온은 23.5도, 미세먼지는 35마이크로그램으로 보통입니다.')
  assert.equal(읽기다듬기('체감 30°C'), '체감 30도')
  assert.equal(읽기다듬기('3 °C 입니다'), '3도 입니다')
})

test('받침 뒤 조사를 맞춘다 — 「마이크로그램로」 가 되지 않게', () => {
  assert.equal(읽기다듬기('35㎍/㎥가 넘으면'), '35마이크로그램이 넘으면')
  assert.equal(읽기다듬기('35㎍/㎥는 보통'), '35마이크로그램은 보통')
  assert.equal(읽기다듬기('농도는 35㎍/㎥입니다'), '농도는 35마이크로그램입니다')
})

test('비·바람·기압·비율·범위', () => {
  assert.equal(읽기다듬기('비 5mm, 바람 3m/s'), '비 5밀리미터, 바람 3미터')
  assert.equal(읽기다듬기('습도 60%'), '습도 60퍼센트')
  assert.equal(읽기다듬기('1013hPa'), '1013헥토파스칼')
  assert.equal(읽기다듬기('10~20mm'), '10에서 20밀리미터')
})

test('[Codex ④-d 3회차] 복합 단위·영문이 붙은 표기·ㄹ 받침 조사', () => {
  assert.equal(읽기다듬기('5%p 올랐다'), '5퍼센트포인트 올랐다')
  assert.equal(읽기다듬기('90°CCW'), '90°CCW', '뒤에 영문이 붙은 표기를 부분만 바꿨다')
  assert.equal(읽기다듬기('10°Celsius'), '10°Celsius')
  assert.equal(읽기다듬기('1013hPa가 넘으면'), '1013헥토파스칼이 넘으면')
  assert.equal(읽기다듬기('1013hPa로 떨어졌다'), '1013헥토파스칼로 떨어졌다', 'ㄹ 받침 뒤 「로」는 그대로다')
  assert.equal(읽기다듬기('10:30 010-1234-5678'), '10:30 010-1234-5678', '시각·전화번호를 건드렸다')
})

test('단어·이미 한국어로 쓴 문장은 그대로다', () => {
  for (const t of ['summary', 'mm 단위', '미세먼지 농도는 삼십오 마이크로그램으로 보통 수준입니다.', '현재 기온은 23도입니다.']) {
    assert.equal(읽기다듬기(t), t)
  }
})

test('엔진 세 곳이 다듬은 문장으로 합성하고, 열쇠에 읽기 판이 들어간다', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'tts.js'), 'utf8')
  for (const 엔진 of ['supertonic', 'azure', 'sapi']) {
    assert.match(src, new RegExp(`${엔진}\\.synthesize\\(읽을것\\(params\\)`), `${엔진} 이 원문 그대로 합성한다`)
  }
  // 자막 사이드카는 원문 — 화면에는 사람이 쓴 글자(23.5℃)가 그대로 보여야 한다
  assert.match(src, /사이드카쓰기\(r\.file, params\.text, r\.durationSec\)/)
  assert.match(src, /\|읽기@\$\{READING_REV\}/)
})
