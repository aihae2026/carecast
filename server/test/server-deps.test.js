// server/package.json의 의존성이 실제 사용과 어긋나는 것(CC-041).
//
// server/index.js(406행)는 require('ws')를 쓰는데 ws는 루트 package.json에만 있다 —
// Node의 상위 node_modules 탐색으로 우연히 동작할 뿐이라, server/만 따로 설치·배포하거나
// 루트에서 ws를 정리하는 순간 서버가 부팅에서 죽는다. 반대로 server/package.json의
// @anthropic-ai/sdk는 서버 소스 어디서도 require하지 않는 미사용 의존성이다(AI 연동은
// Gemini — services/geminiClient.js).
//
// 기대 동작: server/package.json dependencies에 "ws"가 있고 "@anthropic-ai/sdk"가 없다.
'use strict'

const path = require('path')
const fs = require('fs')

const test = require('node:test')
const assert = require('node:assert/strict')

const PKG_PATH = path.join(__dirname, '..', 'package.json')

test('server가 require하는 ws가 server/package.json dependencies에 선언돼 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
  const deps = pkg.dependencies || {}

  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.ok(/require\(['"]ws['"]\)/.test(indexSrc),
    '전제: index.js가 ws를 사용한다 — 사용을 걷어냈다면 이 테스트도 함께 바꿀 것')

  assert.ok(deps.ws,
    'index.js가 require하는 ws가 server/package.json에 없다 — 지금은 루트 node_modules 탐색으로 우연히 돈다')
})

test('아무도 안 쓰는 @anthropic-ai/sdk는 dependencies에서 빠져 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
  const deps = pkg.dependencies || {}

  assert.ok(!deps['@anthropic-ai/sdk'],
    '서버 소스 어디서도 require하지 않는 @anthropic-ai/sdk가 선언돼 있다 — 설치 시간·감사 표면만 늘린다')
})

// 같은 finding의 나머지 절반: 로드 실패를 완전히 침묵하는 빈 catch.
// ws가 없거나(설치 누락) 그 안의 초기화가 던지면 WebSocket 기능만 조용히 사라진다 —
// "휴대폰 마이크가 안 된다"는 신고를 받아도 서버 로그에 단서가 한 줄도 없다.
// 기능은 그대로 둔다(ws가 없어도 서버는 계속 떠야 한다) — 이유만 남긴다.
test('ws 로드 실패를 조용히 삼키지 않고 이유를 로그로 남긴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

  const wsIdx = src.indexOf("require('ws')")
  assert.ok(wsIdx > 0, '전제: index.js가 ws를 require한다')

  // ws 블록을 감싼 최상위 try의 catch(들여쓰기 없는 '} catch')만 본다
  const catchIdx = src.indexOf('\n} catch', wsIdx)
  assert.ok(catchIdx > 0, '전제: ws require가 최상위 try/catch로 감싸여 있다')
  const catchBlock = src.slice(catchIdx, src.indexOf('\n}', catchIdx + 8) + 2)

  assert.match(catchBlock, /catch\s*\(\s*\w+\s*\)/,
    '오류 객체를 받지 않는 catch다 — 무엇 때문에 꺼졌는지 남길 방법이 없다')
  assert.match(catchBlock, /console\.(warn|error)/,
    'ws 로드 실패가 로그 한 줄 없이 사라진다 — 마이크 방송이 안 되는 이유를 현장에서 알 수 없다')
})
