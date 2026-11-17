'use strict'
// UX-08 — SwitchBot **Device ID 를 고르게 한다** (2026-09-12).
//
// 그 값은 앱의 「장치 > 장치 정보」에 있는 16진 문자열이라, 옮겨 적다 한 글자만 틀려도
// 조용히 안 먹는다 — 화면은 "연결 끊김"이라 말하는데 사람은 토큰을 의심한다.
// 계정이 아는 것을 사람에게 다시 적게 하지 않는다.
//
// 이 파일이 지키는 것 셋:
//   ① 목록을 받는 경로는 **읽기만 한다** — 장치를 누르지 않는다(실부작용 금지, 헌장 §12)
//   ② 비밀(토큰·시크릿)이 응답·오류로 새지 않는다
//   ③ **"장치가 없다"와 "못 받았다"를 섞지 않는다** — 사람이 고칠 곳이 다르다
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

test('UX-08: 목록 경로가 장치를 누르지 않는다 — 읽기 전용이다', () => {
  const svc = 읽기('server', 'services', 'switchbot.js')
  // 긍정 앵커 — 목록 함수가 이 파일에 있다
  const m = /async function listDevices\(\) \{([\s\S]*?)\n\}/.exec(svc)
  assert.ok(m, 'listDevices 가 없다 — 이 가드가 볼 대상이 없다')

  assert.ok(!/sendCommand|commands|turnOn|turnOff|press/.test(m[1]),
    '목록을 받으면서 명령을 보낸다 — 이 경로는 읽기만 해야 한다(검수 중 실부작용 금지)')
  assert.match(m[1], /\/devices`/, '장치 목록 주소를 안 부른다')
  assert.ok(!/\/commands/.test(m[1]), '명령 주소를 부른다')
})

test('UX-08: deviceId 가 없어도 목록은 받을 수 있다 — 그것을 고르려고 부른다', () => {
  const svc = 읽기('server', 'services', 'switchbot.js')
  const m = /async function listDevices\(\) \{([\s\S]*?)\n\}/.exec(svc)
  assert.ok(m)
  // 상태 조회는 deviceId 를 요구한다. 목록은 **요구하면 안 된다** — 닭과 달걀이 된다.
  //
  // 규칙을 좁게 쓴다. 처음엔 `deviceId` 가 나오면 다 잡았는데, 돌려줄 항목을 고르는
  // `.filter(d => d.deviceId)` 까지 걸렸다 — 오탐이 쌓이면 다음 사람이 이 가드를 끈다(§M11).
  // 보는 것은 **막는 조건**뿐이다.
  assert.ok(!/if \([^)]*!deviceId/.test(m[1]),
    'deviceId 가 없으면 막는다 — 그것을 고르려고 부르는 목록인데 먼저 있어야 한다면 쓸 수 없다')
  assert.ok(!/const \{[^}]*deviceId[^}]*\} = getSwitchBotConfig\(\)/.test(m[1]),
    '설정에서 deviceId 를 꺼내 온다 — 목록은 그 값과 무관해야 한다')
  // 규칙이 진짜 막는 모양은 잡는지 그 자리에서 시험한다.
  assert.ok(/if \([^)]*!deviceId/.test('  if (!token || !deviceId) throw new Error("x")'),
    '규칙이 진짜 막는 조건을 못 잡는다')
  assert.ok(!/if \([^)]*!deviceId/.test('  return list.filter(d => d.deviceId)'),
    '규칙이 여전히 고르는 줄을 잡는다')

  assert.match(m[1], /!token \|\| !secret/, '토큰·시크릿이 없는데도 외부를 부른다')
})

test('UX-08: 비밀이 응답으로 새지 않는다 — 이름과 id 만 돌려준다', () => {
  const svc = 읽기('server', 'services', 'switchbot.js')
  const m = /async function listDevices\(\) \{([\s\S]*?)\n\}/.exec(svc)
  assert.ok(m)
  // 원본 응답(body)을 그대로 돌려주면 허브 구성·방 정보까지 흘러간다.
  assert.ok(!/return data\.body/.test(m[1]),
    '원본 응답을 그대로 돌려준다 — 화면이 쓰지도 않는 것이 따라가고 로그에 남는다')
  assert.match(m[1], /비밀지우기\(err, token, secret\)/,
    '오류에서 비밀을 안 지운다 — fetch 가 토큰을 담은 오류를 던진 적이 있다(EV-004698)')
})

test('UX-08: 목록을 못 받으면 빈 목록이 아니라 오류다 — 두 가지를 섞지 않는다', () => {
  const route = 읽기('server', 'routes', 'switchbot.js')
  const m = /router\.get\('\/devices'[\s\S]*?\n\}\)/.exec(route)
  assert.ok(m, '/devices 라우트가 없다 — 이 가드를 옮길 것')
  assert.match(m[1] ?? m[0], /res\.status\(502\)/,
    '실패를 200 으로 내려보낸다 — 화면이 "장치가 없다"로 읽는다')
  assert.ok(!/devices: \[\]/.test(m[0]),
    '실패할 때 빈 목록을 준다 — 토큰 문제를 장치 문제로 읽게 만든다')
})

test('UX-08: 화면이 "아직 모른다"와 "하나도 없다"를 다르게 말한다', () => {
  const ui = 읽기('src', 'components', 'admin', 'sections', 'apiSettingsIntegrations.jsx')
  // 긍정 앵커
  assert.match(ui, /const 장치불러오기 = async/, '장치 불러오기가 없다 — 가드를 옮길 것')

  // `null`(모른다)과 `[]`(없다)를 가른다
  assert.match(ui, /Array\.isArray\(장치목록\) && 장치목록\.length === 0/,
    '빈 목록만의 문구가 없다 — "아직 모른다"와 같게 보인다')
  assert.match(ui, /set장치목록\(null\)/,
    '실패할 때 목록을 null 로 돌리지 않는다 — 앞서 받은 목록이 남아 거짓으로 보인다')
  // 손으로 적는 길을 없애지 않았다 — 목록을 못 받는 상황이 실제로 있다
  assert.match(ui, /placeholder="SwitchBot 장치 ID/,
    '직접 적는 칸을 없앴다 — 목록을 못 받으면 아무것도 못 하게 된다')
})
