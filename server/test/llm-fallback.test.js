// LLM 폴백 — **무엇이 안 되어도 문장 하나는 나온다.**
//
// 이 테스트가 지키는 것은 하나다: 이 경로는 **던지지 않는다.**
// 여기서 던지면 화면이 빈손이 되고, 사람은 왜 안 되는지 모른 채 방송을 못 만든다.
// 인터넷이 끊긴 날에 처음 겪을 일이라, 그날 처음 깨지면 안 된다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { generateAnnouncement, viaLabel, 쓸만한가 } = require('../services/llmGateway')

test('API 가 되면 그 결과를 쓰고 via 는 api 다', async () => {
  const r = await generateAnnouncement({
    situation: '점심 배식 안내',
    callApi: async () => '어르신 여러분, 점심 식사가 준비되었습니다.',
  })
  assert.equal(r.via, 'api')
  assert.equal(r.text, '어르신 여러분, 점심 식사가 준비되었습니다.')
})

test('API 가 던지면 템플릿으로 간다 — **던지지 않는다**', async () => {
  const r = await generateAnnouncement({
    situation: '점심 배식 안내',
    callApi: async () => { throw new Error('timeout') },
  })
  assert.equal(r.via, 'template')
  assert.ok(r.text.includes('점심 배식'), '입력이 결과에 안 들어갔다')
  assert.match(r.reason, /timeout/, '왜 넘어왔는지 안 남겼다')
})

test('API 가 빈 응답을 내면 템플릿으로 간다 — 성공으로 위장된 실패', async () => {
  for (const 빈것 of ['', '   ', null, undefined]) {
    const r = await generateAnnouncement({ situation: '안내', callApi: async () => 빈것 })
    assert.equal(r.via, 'template', `빈 응답(${JSON.stringify(빈것)})을 성공으로 받았다`)
  }
})

test('API 경로가 아예 없으면 곧바로 템플릿 — 키가 없는 현장이 그렇다', async () => {
  const r = await generateAnnouncement({ situation: '저녁 프로그램 안내' })
  assert.equal(r.via, 'template')
  assert.ok(r.text.includes('저녁 프로그램'))
})

test('어떤 경우에도 빈 문장을 돌려주지 않는다', async () => {
  const 경우들 = [
    { situation: '', callApi: async () => { throw new Error('x') } },
    { situation: null },
    { situation: '안내', callApi: async () => '' },
    {},
  ]
  for (const 경우 of 경우들) {
    const r = await generateAnnouncement(경우)
    assert.ok(r.text && r.text.trim().length > 0, `빈 문장이 나왔다: ${JSON.stringify(경우)}`)
    assert.ok(['api', 'template'].includes(r.via))
  }
})

test('via 이름은 한 곳에서만 짓는다 — 로그와 배지가 같은 말을 써야 한다', () => {
  assert.equal(viaLabel('local'), '로컬')
  assert.equal(viaLabel('api'), 'API')
  assert.equal(viaLabel('template'), '템플릿')
  // 모르는 값도 그대로 보여 준다 — 화면이 빈칸이 되면 사람이 더 헷갈린다
  assert.equal(viaLabel('새단계'), '새단계')
})

test('쓸만한가 — 공백만 있는 응답은 실패다', () => {
  assert.equal(쓸만한가('안녕'), true)
  assert.equal(쓸만한가('  '), false)
  assert.equal(쓸만한가(''), false)
  assert.equal(쓸만한가(null), false)
  assert.equal(쓸만한가(123), false)
})

test('1차 로컬은 서버가 맡지 않는다 — 브라우저에서 돈다', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('../services/llmGateway'), 'utf8')
  // 서버가 로컬 모델을 흉내 내려 하면 "어느 PC 의 로컬이냐"가 곧바로 문제가 된다
  assert.doesNotMatch(src, /LanguageModel/,
    '서버가 브라우저 전용 API 를 부르려 하고 있다')
  assert.match(src, /브라우저에서 돈다/, '분담 근거가 주석에 없다')
})
