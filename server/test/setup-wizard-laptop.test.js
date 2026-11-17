'use strict'
// **노트북 실기에서 나온 초기 설정 신고 넷** (사용자 신고 2026-09-17)
//
// *"글자크기는 좋은데 … 다 짤려서 드래그 나오게 되잖아"* · *"처음시작은 보통화면이 낫지 않아?"*
// *"어느 스피커로 내보낼까요는 지금설정으로 있는걸 맨 위로 올려야지"*
// *"이 PC에 필요한 것이 있는지 볼게요, 이것도 실패하고"* (서버 응답 없음 10초 초과)
//
// 화면은 브라우저로 1536×790(노트북 125%)·1366×657 에서 장마다 넘침을 재서 확인했다. 여기서는 장치가 빠지지 않게 고정한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('초기 설정 중에는 크게 보기 배율과 상관없이 **보통 크기** — 끝나면 저장된 배율로 돌아간다', async () => {
  const 화면 = 읽기('src/components/admin/sections/SetupWizard.jsx')
  assert.match(화면, /보통으로고정\(true\); 먹이기\(1\)/, '들어올 때 보통으로 고정하지 않는다')
  // **한 줄로 못 박지 않는다**(2026-09-18). 앞 판은 `return () => { … }` 한 줄을 글자 그대로 봤는데,
  // 같은 effect 에 뒤 화면 잠금 되돌리기가 더해져 여러 줄이 되자 **뜻은 그대로인데 빨간불**이 났다.
  // 보는 것은 「나갈 때 고정을 풀고 저장된 배율로 돌린다」는 사실이지 줄바꿈이 아니다.
  const 되돌림 = 화면.slice(화면.indexOf('보통으로고정(true)'))
  assert.match(되돌림, /return \(\) => \{/, '나갈 때 되돌리는 자리가 없다')
  assert.match(되돌림, /보통으로고정\(false\)/, '나갈 때 보통 고정을 안 푼다')
  assert.match(되돌림, /먹이기\(배율읽기\(\)\)/, '나갈 때 원래 배율로 안 돌린다')
  // 고정 중에는 누가 먹여도 1 이다 — 실제 함수를 돌려 본다
  const src = 읽기('src/lib/bigView.js').replace(/^export /gm, '')
  const 모듈 = new Function(`${src}; return { 보통으로고정, 먹이기 }`)()
  const 가짜 = { style: { zoom: '', props: {}, removeProperty(k) { if (k === 'zoom') this.zoom = ''; delete this.props[k] }, setProperty(k, v) { this.props[k] = v } } }
  모듈.보통으로고정(true); 모듈.먹이기(1.5, 가짜)
  assert.equal(가짜.style.zoom, '', '고정 중인데 1.5배가 먹었다')
  모듈.보통으로고정(false); 모듈.먹이기(1.5, 가짜)
  assert.equal(가짜.style.zoom, '1.5', '고정을 풀었는데 배율이 안 돌아온다')
})

test('스피커 목록은 **지금 설정된 장치가 맨 위**', () => {
  const 화면 = 읽기('src/components/admin/sections/SetupWizard.jsx')
  assert.match(화면, /지금 > 0 \? \[전부\[지금\], \.\.\.전부\.filter\(\(_, i\) => i !== 지금\)\] : 전부/)
  assert.match(화면, /장치들 != null && 장치들\.map\(/, '정렬한 목록을 안 그린다')
})

test('필요한 것 확인은 **파이썬을 한 번만** 띄우고, 화면은 서버 한도보다 오래 기다린다', () => {
  const svc = 읽기('server/services/prerequisites.js')
  assert.match(svc, /await 파이썬모듈들\(python, \['faster_whisper'\]\)/)
  assert.ok(!/await 파이썬모듈있나/.test(svc), '모듈마다 파이썬을 따로 띄운다 — 갓 설치한 PC 에서 10초를 넘긴다')
  const 서버한도 = Number(/timeout: (\d+), windowsHide/.exec(svc)?.[1])
  const api = 읽기('src/lib/api.js')
  const 화면한도 = Number(/prerequisites`, \{\}, (\d+)\)/.exec(api)?.[1])
  assert.ok(서버한도 > 0 && 화면한도 > 서버한도, `화면(${화면한도}) 이 서버(${서버한도}) 보다 먼저 끊는다`)
})
