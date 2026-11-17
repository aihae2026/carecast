// 어르신께 나가는 미세먼지 문장이 깨지던 것. (전수검수 CC-017)
//
// 실제로 방송되던 문장 — 재현해서 확인했다:
//   "미세먼지 농도는 NaN 마이크로그램으로 null 수준입니다."
//
// 왜 이렇게 되나:
//   · 에어코리아가 값을 안 주면 weather.js가 `pm10: item.pm10Value ?? '-'`로 대시를 넣는다
//   · `parseInt('-')` → NaN
//   · `toSinoKorean(NaN)`은 **던지지 않고** 문자열 "NaN"을 돌려준다(76번 줄이 그렇게 짜여 있다)
//   · 등급도 `DUST_GRADE[...] || null`이라 없으면 null인데, 템플릿에 넣으면 "null"이 된다
//
// **finding의 설명은 틀렸다** — "toSinoKorean은 NaN에 throw"라고 적혀 있는데 던지지 않는다.
// 던졌으면 차라리 방송이 멈춰서 눈에 띄었을 텐데, 조용히 이상한 문장이 그대로 나갔다.
//
// 같은 파일의 'weather' 문장은 값마다 널 가드가 있고 없으면 빈 문자열로 떨어진다.
// 'dust'만 무방비였다 — 그래서 여기만 고친다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { buildSegmentText } = require('../services/morning')

const dust = (air) => buildSegmentText('dust', { air })

// ── 깨진 문장이 나가지 않는다 ─────────────────────────────────

test('값도 등급도 없으면 문장을 통째로 뺀다 — 침묵이 헛소리보다 낫다', () => {
  assert.equal(dust({ pm10: '-', pm10Grade: null }), '')
})

test('"NaN"도 "null"도 어떤 경우에도 방송문에 들어가지 않는다', () => {
  const 경우들 = [
    { pm10: '-',       pm10Grade: null },
    { pm10: '-',       pm10Grade: '좋음' },
    { pm10: '30',      pm10Grade: null },
    { pm10: null,      pm10Grade: null },
    { pm10: undefined, pm10Grade: undefined },
    { pm10: '',        pm10Grade: '' },
    { pm10: '알수없음', pm10Grade: null },
  ]
  for (const air of 경우들) {
    const 문장 = dust(air)
    assert.doesNotMatch(문장, /NaN/,  `${JSON.stringify(air)} → "${문장}"`)
    assert.doesNotMatch(문장, /null/, `${JSON.stringify(air)} → "${문장}"`)
    assert.doesNotMatch(문장, /undefined/, `${JSON.stringify(air)} → "${문장}"`)
  }
})

test('미세먼지 정보 자체가 없으면 빈 문자열 (기존 동작 보존)', () => {
  assert.equal(buildSegmentText('dust', { air: null }), '')
  assert.equal(buildSegmentText('dust', {}), '')
})

// ── 아는 만큼은 알려준다 ──────────────────────────────────────
//
// 전부 아니면 전무로 만들면, 등급만 아는 날에도 아무 말을 안 하게 된다.
// 마스크를 쓸지 말지는 등급만 알아도 판단할 수 있다 — 그 정보를 버릴 이유가 없다.

test('값과 등급이 다 있으면 지금까지처럼 둘 다 말한다', () => {
  const 문장 = dust({ pm10: '30', pm10Grade: '좋음' })
  assert.match(문장, /삼십/,  '숫자는 한글로 읽어야 TTS가 제대로 발음한다')
  assert.match(문장, /좋음/)
  assert.match(문장, /마이크로그램/)
})

test('등급만 있으면 등급만 말한다 — 마스크 판단에는 그것으로 충분하다', () => {
  const 문장 = dust({ pm10: '-', pm10Grade: '나쁨' })
  assert.match(문장, /나쁨/)
  assert.doesNotMatch(문장, /마이크로그램/, '없는 숫자를 지어내면 안 된다')
})

test('값만 있으면 값만 말한다 — 등급을 지어내지 않는다', () => {
  const 문장 = dust({ pm10: '45', pm10Grade: null })
  assert.match(문장, /사십오/)
  assert.match(문장, /마이크로그램/)
  assert.doesNotMatch(문장, /수준/, '등급을 모르면서 "수준입니다"라고 하면 안 된다')
})

test('0도 값으로 인정한다 — 아주 좋은 날을 "정보 없음"으로 만들면 안 된다', () => {
  const 문장 = dust({ pm10: '0', pm10Grade: '좋음' })
  assert.match(문장, /영/)
  assert.match(문장, /마이크로그램/)
})

test('음수처럼 말이 안 되는 값은 값이 없는 것으로 본다', () => {
  const 문장 = dust({ pm10: '-5', pm10Grade: '좋음' })
  assert.doesNotMatch(문장, /마이크로그램/, '농도가 음수일 수는 없다')
  assert.match(문장, /좋음/)
})

test('문장은 항상 마침표로 끝난다 — TTS가 문장 경계에서 쉰다', () => {
  for (const air of [
    { pm10: '30', pm10Grade: '좋음' },
    { pm10: '-',  pm10Grade: '나쁨' },
    { pm10: '45', pm10Grade: null },
  ]) {
    assert.match(dust(air), /\.$/, JSON.stringify(air))
  }
})
