// "인터넷이 끊겨도 대시보드가 초록"이던 것. (전수검수 CC-025)
//
// 무엇이 문제였나: 네트워크 카드가 이렇게 돼 있었다.
//   function netCard(live) {
//     if (!live?.ip) return UNKNOWN
//     return { status: 'online', value: '연결됨', detail: live.ip }
//   }
// `live.ip`는 OS가 알려주는 **랜 카드 주소**다. 공유기가 인터넷에서 끊겨도 그대로 있다.
// 그런데 케어캐스트는 안내 음성(옛 인터넷 합성 엔진)·날씨·유튜브 BGM이 전부 인터넷에 매달려 있다.
// 인터넷이 죽으면 방송이 눈에 띄게 나빠지는데 화면은 "연결됨 초록"이라 아무도 모른다.
//
// finding은 "24시간 내 성공 없으면 경고"를 권했지만 따르지 않았다 — 대시보드는 **지금**을
// 보는 화면이라 24시간은 너무 굵다. 아침에 끊긴 인터넷을 저녁까지 초록으로 보여주게 된다.
// 대신 **마지막 외부 통신의 성패**를 쓴다. 이미 하고 있는 통신(날씨·안내 음성)의 결과를
// 주워 담는 것이라 인터넷을 확인하려고 새 요청을 더 보내지 않는다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')

const net = require('../services/netHealth')

test.beforeEach(() => { net._resetForTest() })

// ── 서버 쪽 판정 ──────────────────────────────────────────────

test('한 번도 시도한 적이 없으면 모른다고 한다 — 없는 사실을 지어내지 않는다', () => {
  const s = net.summary()
  assert.equal(s.online, null)
  assert.equal(s.lastOkAt, null)
})

test('마지막 통신이 성공이면 연결된 것으로 본다', () => {
  net.record(true, '날씨')
  const s = net.summary()
  assert.equal(s.online, true)
  assert.ok(s.lastOkAt)
})

test('마지막 통신이 실패면 끊긴 것으로 본다', () => {
  net.record(true, '날씨')
  net.record(false, '안내음성')
  const s = net.summary()
  assert.equal(s.online, false)
  assert.equal(s.lastSource, '안내음성', '무엇이 실패했는지 알아야 사람이 손을 쓴다')
})

test('실패 뒤 성공하면 다시 연결로 돌아온다 — 한 번 실패했다고 굳으면 안 된다', () => {
  net.record(false, '날씨')
  net.record(true, '날씨')
  assert.equal(net.summary().online, true)
})

test('마지막 성공 시각이 남아 사람이 얼마나 됐는지 판단할 수 있다', () => {
  net.record(true, '날씨')
  const ok = net.summary().lastOkAt
  net.record(false, '유튜브')
  const s = net.summary()
  assert.equal(s.online, false)
  assert.equal(s.lastOkAt, ok, '실패해도 마지막 성공 시각은 지우지 않는다')
})

test('기록이 실패해도 던지지 않는다 — 상태 수집이 방송을 멈추면 본말전도다', () => {
  assert.doesNotThrow(() => net.record(undefined, undefined))
  assert.doesNotThrow(() => net.record(true))
})

// ── 화면 카드 ─────────────────────────────────────────────────

test('화면 카드가 인터넷 상태를 반영한다', async () => {
  const ui = await import(
    'file://' + path.join(__dirname, '..', '..', 'src', 'lib', 'systemStatus.js').replace(/\\/g, '/')
  )
  const card = (live) => ui.buildStatusCards(live).find(c => c.id === 'net')

  // 인터넷이 끊긴 상태 — 예전엔 이것도 초록 "연결됨"이었다
  const 끊김 = card({ ip: '192.168.0.5', net: { online: false, lastSource: '날씨' } })
  assert.equal(끊김.status, 'warning', '인터넷이 끊겼는데 초록이면 아무도 모른다')
  assert.doesNotMatch(끊김.value, /^연결됨$/, '"연결됨"이라고 말하면 안 된다')

  // 정상
  const 정상 = card({ ip: '192.168.0.5', net: { online: true } })
  assert.equal(정상.status, 'online')

  // 아직 아무 통신도 안 해본 상태 — 랜은 붙어 있으니 offline은 아니지만
  // "인터넷 연결됨"이라고 단정해서도 안 된다
  const 모름 = card({ ip: '192.168.0.5', net: { online: null } })
  assert.notEqual(모름.status, 'warning', '모르는 것을 경고로 띄우면 잔소리가 된다')
  assert.doesNotMatch(모름.value, /^연결됨$/,
    '랜 주소만 보고 "연결됨"이라고 하던 것이 이 finding의 내용이다')

  // net 정보 자체가 없는 옛 서버 응답 — 화면이 깨지면 안 된다
  assert.ok(card({ ip: '192.168.0.5' }))
})
