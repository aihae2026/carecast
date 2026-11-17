'use strict'
// UX-10 — **제어문자가 섞인 자격증명은 저장 자체를 거절한다** (2026-09-12).
//
// 사연: 이 세 값은 나중에 HTTP 헤더에 그대로 실린다. 줄바꿈·NUL 이 섞이면 `fetch` 가
// **토큰을 통째로 담은 오류**를 던지고, 그 문구가 연결 테스트 결과를 타고 화면까지 갔다
// (EV-004698). 부르기 전에 막는 검사와 오류에서 비밀을 지우는 장치는 이미 있었는데,
// 둘 다 **이미 저장된 뒤**의 방어다 — 값이 DB 에 들어앉으면 사람이 다시 붙여 넣을 때까지
// 이 연동이 죽어 있다.
//
// **이 시험은 동작을 본다.** 처음엔 "라우트에 이런 정규식이 있다"를 요구했는데, 그 요구가
// 오히려 **중복 구현을 고정하고 있었다**(Codex R10 지적: 같은 판정이 `domain/text.js` 에
// 이미 있다). 소스 모양이 아니라 **거절하는지 · 쓰기가 안 일어나는지**를 본다.
//
// 소스에 실제 제어문자 바이트를 넣지 않는다 — 코드점으로 만든다(CLAUDE.md).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
const NUL = String.fromCharCode(0)
const 깨진글자 = String.fromCharCode(0xFFFD)

// 라우트 핸들러만 떼어 돌린다. DB 경계는 스텁으로 바꿔 **쓰기가 몇 번 일어났는지** 센다 —
// "400 을 준다"만 보면 400 을 주면서 저장도 하는 경우를 놓친다.
function 핸들러불러오기() {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'settings.js'), 'utf8')
  const i = src.indexOf("router.post('/switchbot'")
  assert.notEqual(i, -1, '스위치봇 저장 경로가 없다 — 이 가드를 옮길 것')
  const 끝 = src.indexOf('\n})', i)
  assert.notEqual(끝, -1, '저장 경로의 끝을 못 찾았다')
  // `router.post('/switchbot', (req, res) => { … })` 에서 **함수만** 꺼낸다.
  const 본문 = src.slice(src.indexOf('{', src.indexOf('=>', i)) + 1, 끝)

  const 쓴것 = []
  const { findBrokenField, brokenTextMessage, hasBrokenText } = require('../domain/text')
  const sandbox = {
    getDB: () => ({}),
    setSetting: (db, key, value) => { 쓴것.push([key, value]) },
    findBrokenField, brokenTextMessage, hasBrokenText,
    String, Object, Array, JSON, RegExp, console,
  }
  vm.createContext(sandbox)
  vm.runInContext(`globalThis.__핸들러 = (req, res) => {${본문}}`, sandbox)
  return { 핸들러: sandbox.__핸들러, 쓴것 }
}

function 보내기(몸통) {
  const { 핸들러, 쓴것 } = 핸들러불러오기()
  let 상태 = 200; let 응답 = null
  const res = {
    status(c) { 상태 = c; return this },
    json(o) { 응답 = o; return this },
  }
  핸들러({ body: 몸통 }, res)
  return { 상태, 응답, 쓴것 }
}

test('UX-10: 멀쩡한 값은 저장된다 — 가드가 전부를 막지 않는다', () => {
  const r = 보내기({ token: 'ABCdef123-_=', secret: 'XYZ987', deviceId: 'AA11BB22' })
  assert.equal(r.상태, 200, `멀쩡한 값을 막는다: ${JSON.stringify(r.응답)}`)
  assert.equal(r.쓴것.length, 3, `저장이 ${r.쓴것.length}건이다 — 세 값이 다 들어가야 한다`)
})

test('UX-10: 제어문자·깨진 글자가 섞이면 거절하고 **아무것도 쓰지 않는다**', () => {
  for (const [이름, 몸통] of [
    ['토큰 NUL',        { token: `ABC${NUL}def` }],
    ['시크릿 NUL',      { secret: `ABC${NUL}def` }],
    ['장치ID NUL',      { deviceId: `ABC${NUL}def` }],
    ['토큰 깨진 글자',   { token: `ABC${깨진글자}def` }],
    ['토큰 줄바꿈',      { token: 'ABC\ndef' }],
    ['토큰 탭',          { token: 'ABC\tdef' }],
    ['토큰 CR',          { token: 'ABC\rdef' }],
  ]) {
    const r = 보내기(몸통)
    assert.equal(r.상태, 400, `${이름}: 거절하지 않았다`)
    assert.equal(r.쓴것.length, 0,
      `${이름}: 400 을 주면서 ${r.쓴것.length}건을 저장했다 — 값이 DB 에 들어앉는다`)
    assert.ok(!String(r.응답?.error || '').includes(NUL),
      `${이름}: 오류 문구에 제어문자가 그대로 실렸다`)
  }
})

// Codex R10 이 잡은 구멍: `hasBrokenText` 는 **문자열이 아니면 통과**시키고(형식 검사는
// 부르는 쪽의 몫이라고 그 함수가 적어 뒀다), `writeSetting` 은 나중에 `String(value)` 로
// 바꾼다. 그래서 배열로 보내면 제어문자가 검사를 비켜 DB 까지 닿았다.
test('UX-10: 글자가 아닌 것(배열·객체)으로 보내도 비켜 가지 못한다', () => {
  for (const [이름, 값] of [
    ['배열',        [`ABC${NUL}def`]],
    ['중첩 배열',   [[`ABC${NUL}def`]]],
    ['객체',        { toString: () => `ABC${NUL}def` }],
    ['숫자',        12345],
  ]) {
    for (const 칸 of ['token', 'secret', 'deviceId']) {
      const r = 보내기({ [칸]: 값 })
      assert.equal(r.상태, 400, `${칸}=${이름}: 거절하지 않았다`)
      assert.equal(r.쓴것.length, 0,
        `${칸}=${이름}: ${r.쓴것.length}건을 저장했다 — String() 을 지나 제어문자가 DB 로 간다`)
    }
  }
})

test('UX-10: 안 보낸 칸은 건드리지 않는다 — 기존 정책을 깨지 않는다', () => {
  const r = 보내기({ onTime: '07:45' })
  assert.equal(r.상태, 200)
  assert.deepEqual(r.쓴것.map(([k]) => k), ['switchbot_on_time'],
    '안 보낸 자격증명까지 덮어썼다 — 빈 값으로 지워질 수 있다')
})

test('UX-10: 판정을 라우트에서 다시 구현하지 않았다 — 같은 규칙 한 곳을 쓴다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'settings.js'), 'utf8')
  const i = src.indexOf("router.post('/switchbot'")
  const 본문 = src.slice(i, src.indexOf('\n})', i))
  assert.match(본문, /hasBrokenText\([^)]*allowNewlines: false/,
    'domain/text.js 의 규칙을 안 쓴다 — 두 벌이 되면 한쪽만 고치는 날이 온다')
  assert.ok(!/uFFFD/.test(본문), '깨진 글자 판정을 라우트에서 다시 적었다')
})
