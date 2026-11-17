'use strict'
// **네트워크를 끈 설정에서 날씨를 안 부른 것은 오류가 아니다** (2026-10-17, Windows Sandbox 설치 시험 c12).
//
// `CARECAST_NO_NETWORK=1` 로 켠 서버의 로그에
//   [error] [weather/chip] 네트워크 차단 모드 — 날씨 조회을(를) 하지 않았습니다
// 가 남았다. 바깥 호출을 끈 것은 사용자가 정한 일이라 정보 수준이어야 하고,
// 「조회을(를)」 조사도 받침에 맞춰 「조회를」로 써야 한다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_netlog_${process.pid}_${Date.now()}.db`)
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { blockedError, 차단인가 } = require('../services/networkMode')

test('막은 이유 문장의 조사가 받침에 맞는다', () => {
  assert.match(blockedError('날씨 조회').message, /날씨 조회를 하지 않았습니다$/)
  assert.match(blockedError('Gemini 호출').message, /Gemini 호출을 하지 않았습니다$/)
  assert.match(blockedError('스마트플러그 제어').message, /제어를 하지 않았습니다$/)
  assert.match(blockedError('SwitchBot 장치 목록').message, /목록을 하지 않았습니다$/)
  assert.ok(!blockedError('날씨 조회').message.includes('을(를)'))
})

test('막은 오류는 표시가 있어 진짜 오류와 가를 수 있다', () => {
  assert.equal(차단인가(blockedError('날씨 조회')), true)
  assert.equal(차단인가(new Error('네트워크 차단 모드 흉내')), false)
  assert.equal(차단인가(null), false)
})

test('네트워크를 끈 서버에서 날씨 칩을 물으면 error 가 아니라 정보로 남긴다', async () => {
  const 옛값 = process.env.CARECAST_NO_NETWORK
  process.env.CARECAST_NO_NETWORK = '1'
  const 오류 = []
  const 정보 = []
  const 원래 = { error: console.error, log: console.log }
  console.error = (...a) => { 오류.push(a.join(' ')) }
  console.log = (...a) => { 정보.push(a.join(' ')) }
  // 시험 DB 에는 키·좌표가 없어 서비스가 안쪽에서 null 로 끝난다. 설치 시험(c12)에서 실제로 난 것처럼
  // 서비스가 **차단 거절을 던지는** 경우를 만든다(라우트가 구조 분해로 받기 전에 바꿔 끼운다).
  const 날씨서비스 = require('../services/weather')
  const 원래받기 = 날씨서비스.fetchWeather
  날씨서비스.fetchWeather = async () => { throw blockedError('날씨 조회') }
  delete require.cache[require.resolve('../routes/weather')]
  const app = express()
  app.use('/api/weather', require('../routes/weather'))
  날씨서비스.fetchWeather = 원래받기
  const server = app.listen(0)
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/weather/chip`)
    const body = await res.json()
    assert.equal(res.status, 503, JSON.stringify(body))
    assert.match(body.error, /네트워크 차단 모드/)
  } finally {
    server.close()
    console.error = 원래.error
    console.log = 원래.log
    if (옛값 === undefined) delete process.env.CARECAST_NO_NETWORK
    else process.env.CARECAST_NO_NETWORK = 옛값
  }
  assert.deepEqual(오류.filter((l) => l.includes('weather')), [], `error 로 남겼다: ${오류.join(' / ')}`)
  assert.ok(정보.some((l) => l.includes('[weather/chip]') && l.includes('날씨 조회를')), `정보 줄이 없다: ${정보.join(' / ')}`)
})

// 2026-10-17 설치 시험 c15: 라우트만 고치고 서비스 안쪽 catch 두 곳이 남아
//   [error] [fetchMinMaxFromOpenMeteo] 네트워크 차단 모드 — 날씨 조회를 하지 않았습니다
//   [error] [fetchApparentTemp] 네트워크 차단 모드 — 날씨 조회를 하지 않았습니다
// 가 찍혔다. 서비스 안쪽에서 삼키는 catch 도 차단은 정보 수준으로 남겨야 한다.
test('네트워크를 끈 서버에서 날씨 서비스 안쪽 catch 도 error 를 남기지 않는다', async () => {
  const 옛값 = process.env.CARECAST_NO_NETWORK
  process.env.CARECAST_NO_NETWORK = '1'
  const 오류 = []
  const 정보 = []
  const 원래 = { error: console.error, log: console.log, warn: console.warn }
  console.error = (...a) => { 오류.push(a.join(' ')) }
  console.log = (...a) => { 정보.push(a.join(' ')) }
  console.warn = () => {}
  try {
    const 날씨서비스 = require('../services/weather')
    await 날씨서비스.fetchMinMaxTemp()
    await 날씨서비스.fetchApparentTemp()
  } finally {
    Object.assign(console, 원래)
    if (옛값 === undefined) delete process.env.CARECAST_NO_NETWORK
    else process.env.CARECAST_NO_NETWORK = 옛값
  }
  assert.deepEqual(오류.filter((l) => l.includes('네트워크 차단 모드')), [], `error 로 남겼다: ${오류.join(' / ')}`)
  for (const 태그 of ['[fetchMinMaxFromOpenMeteo]', '[fetchApparentTemp]']) {
    assert.ok(정보.some((l) => l.includes(태그) && l.includes('날씨 조회를')), `${태그} 정보 줄이 없다: ${정보.join(' / ')}`)
  }
})

test('날씨 서비스의 catch 는 err.message 를 바로 console.error 로 찍지 않는다(실패기록 을 쓴다)', () => {
  const 본문 = require('node:fs').readFileSync(require.resolve('../services/weather'), 'utf8')
  const 남은 = 본문.split('\n').filter((l) => /console\.error\([^)]*\berr\.message\)/.test(l))
  assert.deepEqual(남은, [], `차단 오류까지 [error] 로 남길 자리: ${남은.join(' / ')}`)
})
