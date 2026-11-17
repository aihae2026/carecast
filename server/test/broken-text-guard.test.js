// 2026-08-31. 글자가 깨진 문자열(U+FFFD)이 방송 문구·예약·기록으로 들어가는 것을 막는다.
//
// 실제로 겪은 일: Windows(Git Bash)에서 curl로 한글 JSON을 POST하면 본문이 CP949로 나가고
// 서버는 UTF-8로 읽어서 글자마다 U+FFFD가 박힌다. 요청은 200 OK라 아무도 모르고, DB에는
// 뜻을 알 수 없는 기록만 남는다(이 저장소에서 8칸이 그렇게 망가져 있었다 —
// scripts/repair-mojibake-rows.cjs).
//
// 예약 문구라면 더 나쁘다 — 깨진 글자가 그대로 TTS로 나가 어르신에게 읽힌다.
// 같은 가드가 이미 출력장치 이름에 있었다(audioDevices.sanitizeDeviceName).
// 같은 실패 모드에는 같은 안전장치를 단다(이 저장소 규칙 5), 그리고 두 벌로 만들지 않는다.
//
// U+FFFD와 제어문자는 **escape 표기로만** 적는다 — 실제 바이트를 소스에 박으면 git이 이 파일을
// 바이너리로 취급해 사람이 diff를 못 읽는다(CLAUDE.md).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_brokentext_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { hasBrokenText } = require('../domain/text')
const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

const BROKEN = '\uFFFD\uFFFD\uFFFD'
let app

test.before(async () => {
  initDB()
  app = await startTestApp({
    '/api/schedules': require('../routes/schedules'),
    '/api/dev/proposals': require('../routes/improvementProposals'),
  })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

test('hasBrokenText는 U+FFFD와 제어문자를 잡고 멀쩡한 한글은 통과시킨다', () => {
  assert.equal(hasBrokenText('점심 식사 안내드립니다'), false)
  assert.equal(hasBrokenText(''), false)
  assert.equal(hasBrokenText(null), false)
  assert.equal(hasBrokenText('줄바꿈은\n허용한다'), false, 'TTS 문구에 줄바꿈이 들어간다')
  assert.equal(hasBrokenText('탭도\t허용한다'), false)
  assert.equal(hasBrokenText('캐리지리턴도\r허용한다'), false)
  assert.equal(hasBrokenText(BROKEN), true)
  assert.equal(hasBrokenText('앞은 멀쩡한데 뒤가 ' + BROKEN), true)
  assert.equal(hasBrokenText('제어문자도 막는다\u0007'), true)
})

test('예약 제목이 깨져 있으면 400으로 막는다', async () => {
  const res = await fetch(`${app.baseUrl}/api/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: BROKEN, content: '점심 안내', scheduled_time: '11:15',
      repeat_start_date: '2026-08-31', broadcast_type: 'text',
    }),
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /깨져/)
})

test('예약 내용이 깨져 있으면 400으로 막는다 — 그대로 두면 TTS가 읽는다', async () => {
  const res = await fetch(`${app.baseUrl}/api/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '점심 안내', content: BROKEN, scheduled_time: '11:16',
      repeat_start_date: '2026-08-31', broadcast_type: 'text',
    }),
  })
  assert.equal(res.status, 400)
})

test('멀쩡한 예약은 그대로 저장된다 — 가드가 정상 경로를 막지 않는다', async () => {
  const res = await fetch(`${app.baseUrl}/api/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '점심 식사 안내', content: '잠시 후 점심 식사가 있겠습니다.', scheduled_time: '11:17',
      repeat_start_date: '2026-08-31', broadcast_type: 'text',
    }),
  })
  assert.equal(res.status, 200)
})

test('고도화 제안 제목이 깨져 있으면 400으로 막는다', async () => {
  const res = await fetch(`${app.baseUrl}/api/dev/proposals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-08-31', title: BROKEN }),
  })
  assert.equal(res.status, 400)
})

test('TTS 방송 라우트와 진행 기록 라우트도 같은 가드를 쓴다', () => {
  // 라우트마다 hasBrokenText / findBrokenField 중 맞는 쪽을 쓴다 — 고정할 것은 "domain/text.js
  // 한 곳을 지난다"이지 함수 이름이 아니다.
  for (const file of ['tts.js', 'coachingBrief.js', 'schedules.js', 'improvementProposals.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', file), 'utf8')
    assert.match(src, /require\('\.\.\/domain\/text'\)/, `${file}에 깨진 글자 가드가 없다`)
  }
})

test('출력장치 이름 가드도 같은 한 곳을 쓴다 — 두 벌로 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'audioDevices.js'), 'utf8')
  assert.match(src, /hasBrokenText/, 'sanitizeDeviceName이 자기만의 U+FFFD 검사를 들고 있다')
  assert.match(src, /require\('\.\.\/domain\/text'\)/)
})
