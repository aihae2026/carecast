// 아침방송 "오늘의 한마디"(덕담) 선택 규칙
//
// 원래는 QUOTES[날짜(日) % 37]이었다. 날짜는 1~31이라 인덱스가 1~31에서만 나와
// 0번과 32~36번 여섯 개는 한 번도 방송되지 않았다. 연중 일자 기준으로 바꿔 37개를
// 모두 쓴다(37일 주기). 같은 날이면 항상 같은 덕담이라는 성질(랜덤 아님)은 유지한다.
const test   = require('node:test')
const assert = require('node:assert')

const { QUOTES, pickQuote } = require('../services/morning')

test('덕담에 "마지막"으로 시작하는 오타 문구가 없다', () => {
  const bad = QUOTES.filter(q => q.startsWith('마지막'))
  assert.deepStrictEqual(bad, [],
    `오타 문구가 남아 있다: ${JSON.stringify(bad)}`)
})

test('1년을 돌리면 덕담 37개가 모두 최소 한 번은 방송된다', () => {
  const seen = new Set()
  for (let i = 0; i < 366; i++) {
    const d = new Date(2026, 0, 1)
    d.setDate(d.getDate() + i)
    seen.add(pickQuote(d))
  }
  const never = QUOTES.filter(q => !seen.has(q))
  assert.deepStrictEqual(never, [],
    `한 번도 방송되지 않는 덕담이 있다: ${JSON.stringify(never)}`)
})

test('같은 날짜에는 항상 같은 덕담이 나온다(랜덤 아님)', () => {
  const d = new Date(2026, 7, 29)
  assert.strictEqual(pickQuote(d), pickQuote(new Date(2026, 7, 29)))
})

test('하루가 지나면 다음 덕담으로 넘어간다', () => {
  const a = pickQuote(new Date(2026, 7, 29))
  const b = pickQuote(new Date(2026, 7, 30))
  assert.notStrictEqual(a, b)
})

test('연말·연초 경계에서도 예외 없이 덕담이 나온다', () => {
  for (const d of [new Date(2026, 11, 31), new Date(2027, 0, 1)]) {
    const q = pickQuote(d)
    assert.ok(typeof q === 'string' && q.length > 0, `덕담이 비었다: ${d}`)
    assert.ok(QUOTES.includes(q), '목록에 없는 덕담이 나왔다')
  }
})

test('덕담에 똑같은 문장이 둘 이상 없다', () => {
  const seen = new Map()
  const dups = []
  QUOTES.forEach((q, i) => {
    if (seen.has(q)) dups.push({ 문구: q, 위치: [seen.get(q), i] })
    else seen.set(q, i)
  })
  assert.deepStrictEqual(dups, [],
    `같은 덕담이 여러 번 들어 있다: ${JSON.stringify(dups)}`)
})
