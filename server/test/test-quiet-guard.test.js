// 테스트가 러너 스트림에 앱 로그를 쏟지 않는다 (2026-09-03 저녁).
//
// 왜 필요했나: 하루에 **네 번** `npm run verify`가 assertion 실패가 아니라
// `Unable to deserialize cloned data due to invalid or unsupported version.`으로 넘어졌다.
// 매번 다른 파일이었고, 단독 실행·재실행에서는 늘 통과했다. 그때마다 5~6분씩 다시 돌렸다.
//
// 실측(2026-09-03):
//   · 테스트 파일 179개 · CPU 12코어 → **열두 프로세스가 동시에** 돈다
//   · 그 프로세스들이 합본 한 번에 앱 로그 **1394줄**(대부분 한글)을 러너 스트림에 쏟는다
//   · 억제 후 **0줄**, 시간 59초 → 58초, 통과 수 1454 그대로
//
// 동시성을 낮추는 길도 있었지만 택하지 않았다 — 합본이 느려지면 결국 아무도 안 돌린다.
// 원인(쏟아지는 출력) 쪽을 줄이는 것이 값이 같고 대가가 없다.
//
// 고정하는 사실 셋:
//  1. 테스트 실행이 조용히 시키는 preload를 지난다
//  2. 눈으로 봐야 할 때 되돌릴 길이 있다(CARECAST_TEST_VERBOSE=1)
//  3. 그 preload가 테스트 파일로 오해되지 않는다(.cjs — 러너의 *.test.js 글롭 밖)
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SERVER = path.join(__dirname, '..')

test('사실1 — 테스트 실행이 조용히 시키는 preload를 지난다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.test, /--require \.\/test\/quiet\.cjs/,
    'preload가 빠지면 로그 1400줄이 다시 러너 스트림으로 쏟아진다')
  assert.ok(fs.existsSync(path.join(SERVER, 'test', 'quiet.cjs')), 'preload 파일이 없다')
})

test('사실2 — 눈으로 봐야 할 때 되돌릴 길이 있다', () => {
  const src = fs.readFileSync(path.join(SERVER, 'test', 'quiet.cjs'), 'utf8')
  // **조건식 자체를 짚는다.** 낱말만 세면 주석에 남아 있는 것으로도 통과한다
  // (2026-09-03 뮤테이션에서 실제로 그렇게 새어 나갔다).
  assert.match(src, /if \(process\.env\.CARECAST_TEST_VERBOSE !== '1'\)/,
    '로그를 볼 방법이 없으면 디버깅할 때 테스트를 뜯어고치게 된다')
  // 억제 대상에 error까지 들어가 있어야 한다 — 남은 317줄이 전부 그쪽이었다
  for (const m of ['log', 'warn', 'error']) {
    assert.match(src, new RegExp(`console\\.${m} = noop`), `console.${m}가 안 막혔다`)
  }
})

test('사실3 — preload가 테스트 파일로 오해되지 않는다', () => {
  const files = fs.readdirSync(path.join(SERVER, 'test'))
  assert.ok(files.includes('quiet.cjs'))
  assert.ok(!files.includes('quiet.test.js'), '이름이 *.test.js면 러너가 테스트로 집어간다')
})

test('지금 이 실행에서도 실제로 조용하다', () => {
  // preload가 걸렸다면 console.log는 우리가 넣은 no-op이다. 걸리지 않았다면 원래 함수다.
  // (CARECAST_TEST_VERBOSE=1로 돌리는 사람도 있으므로 그때는 건너뛴다.)
  if (process.env.CARECAST_TEST_VERBOSE === '1') return
  assert.equal(console.log.name, 'noop',
    'preload가 이 실행에 안 걸렸다 — package.json 스크립트로 돌리지 않았거나 --require가 빠졌다')
})
