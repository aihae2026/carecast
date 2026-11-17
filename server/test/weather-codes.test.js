// 기상청 규격을 **방송에 나갈 낱말**로 옮기는 규칙 (domain/weatherCodes.js).
//
// 이 함수들이 아침 방송의 문장을 만든다 — "구름많음", "비가 오겠습니다", "오후 세 시",
// 체감온도. 2026-09-05에 services/weather.js에서 domain으로 내리면서 **테스트가 하나도 없다는
// 것**을 알았다(그 전에는 fetch와 캐시에 파묻혀 있어 부르기도 어려웠다).
//
// 여기 적은 값은 그날 실제로 돌려 본 결과다. 지어낸 기대값이 아니다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const {
  skyToText, ptyToText, uvLevel, DUST_GRADE, parseRn1,
  subjectParticle, timeToKorean, calcApparentTemp,
} = require('../domain/weatherCodes')

test('하늘 상태 코드를 우리 낱말로', () => {
  assert.equal(skyToText('1'), '맑음')
  assert.equal(skyToText('3'), '구름많음')
  assert.equal(skyToText('4'), '흐림')
  // 모르는 코드는 **지어내지 않는다.** 없는 날씨를 방송하는 것이 가장 나쁘다.
  assert.equal(skyToText('9'), null)
})

test('강수 형태 코드를 우리 낱말로', () => {
  assert.equal(ptyToText('0'), '없음')
  assert.equal(ptyToText('1'), '비')
  assert.equal(ptyToText('2'), '비/눈')
  assert.equal(ptyToText('3'), '눈')
  assert.equal(ptyToText('4'), '소나기')
})

test('자외선·미세먼지 등급', () => {
  assert.equal(uvLevel(0), '낮음')
  assert.equal(uvLevel(3), '보통')
  assert.equal(uvLevel(6), '높음')
  assert.equal(uvLevel(8), '매우높음')
  assert.equal(uvLevel(11), '위험')
  assert.deepEqual(DUST_GRADE, { 1: '좋음', 2: '보통', 3: '나쁨', 4: '매우나쁨' })
})

test('강수량 문구를 숫자로 — "강수없음"과 "1mm 미만"을 가른다', () => {
  assert.equal(parseRn1('강수없음'), 0)
  assert.equal(parseRn1('1mm 미만'), 0.5)   // 0으로 접으면 "비 안 온다"가 된다
  assert.equal(parseRn1('3.5'), 3.5)
  assert.equal(parseRn1('0.0'), 0)
})

test('주격 조사 — 받침이 있으면 이, 없으면 가', () => {
  assert.equal('비' + subjectParticle('비'), '비가')
  assert.equal('눈' + subjectParticle('눈'), '눈이')
  assert.equal('바람' + subjectParticle('바람'), '바람이')
  assert.equal('소나기' + subjectParticle('소나기'), '소나기가')
})

test('시각을 사람이 읽는 말로 — 자정·낮 열두 시를 가른다', () => {
  assert.equal(timeToKorean('0000'), '자정')
  assert.equal(timeToKorean('0100'), '새벽 한 시')
  assert.equal(timeToKorean('0600'), '오전 여섯 시')
  assert.equal(timeToKorean('1200'), '낮 열두 시')
  assert.equal(timeToKorean('1300'), '오후 한 시')
  assert.equal(timeToKorean('1900'), '저녁 일곱 시')
  assert.equal(timeToKorean('2300'), '밤 열한 시')
})

// 인자 차례가 (기온, 풍속, 습도)다. 2026-09-05에 이 차례를 헷갈려 "여름 공식이 안 돈다"고
// 잘못 읽은 적이 있다 — 그래서 차례 자체를 여기서 고정한다.
test('체감온도 — 인자는 (기온, 풍속, 습도) 차례다', () => {
  // 여름: 더위지수가 기온보다 **높게** 나온다
  assert.ok(calcApparentTemp(33, 1, 70) > 33, '습한 더위에서 체감이 기온보다 낮으면 차례가 뒤집힌 것이다')
  // 겨울: 찬바람에 기온보다 **낮게** 나온다
  assert.ok(calcApparentTemp(0, 8, 60) < 0, '찬바람에 체감이 기온보다 높으면 차례가 뒤집힌 것이다')
  // 둘 다 아니면 기온 그대로
  assert.equal(calcApparentTemp(20, 2, 50), 20)
})
