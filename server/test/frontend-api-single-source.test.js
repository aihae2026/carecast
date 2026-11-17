// 화면이 서버를 부르는 길이 다시 두 갈래가 되지 않게 막는다(TD-08).
//
// 왜 필요했나: src/lib/api.js가 있는데도 컴포넌트 7개가 fetch를 직접 불렀다(25곳).
// 그래서 타임아웃(10초)·오류 메시지 추출·민감정보 확인(409) 재요청이 그 자리들에는
// 적용되지 않았다. 한 곳에서 못 바꾸면 "화면이 멈춘 것 같다"는 신고가 왔을 때
// 손댈 자리가 25곳이 된다.
//
// 서버 테스트에 두는 이유: 이 저장소에는 프론트 테스트 러너가 없다. 소스를 읽어
// 규칙을 고정하는 방식은 route-wiring.test.js·spawn-error-guard.test.js와 같다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const SRC = path.join(__dirname, '..', '..', 'src')

// 예외 두 곳. 각각 lib/api로는 할 수 없는 일이라서 남는다.
const ALLOWED = new Map([
  ['lib/api.js', 'fetch를 실제로 부르는 곳'],
  ['hooks/useConnectionWatch.js', '연결 감시 — 3초 안에 판정해야 하는데 apiGet은 10초 고정이고 signal을 안 받는다'],
  ['components/easy/InstantBroadcast.jsx', '마이크 조각을 바이너리 그대로 올린다 — JSON.stringify를 거치면 안 된다'],
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = f => path.relative(SRC, f).split(path.sep).join('/')

test('화면은 lib/api를 통해서만 서버를 부른다', () => {
  const offenders = []
  for (const file of walk(SRC)) {
    if (ALLOWED.has(rel(file))) continue
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      // window.fetch·EventSource·new WebSocket은 대상이 아니다 — 여기서 막는 것은
      // "같은 일을 두 방식으로 하는 것"이지 브라우저 API 사용 자체가 아니다.
      if (/(^|[^.\w])fetch\s*\(/.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `화면이 fetch를 직접 부르고 있다 — src/lib/api.js의 apiGet/apiPost/apiPut/apiPatch/apiDelete를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('예외로 남긴 두 자리에는 이유가 주석으로 적혀 있다', () => {
  for (const r of ['hooks/useConnectionWatch.js', 'components/easy/InstantBroadcast.jsx']) {
    const src = fs.readFileSync(path.join(SRC, r), 'utf8')
    assert.match(src, /TD-08 예외/, `${r}에 예외 사유 주석이 없다 — 왜 남았는지 적어 둘 것`)
  }
})

test('허용 목록이 실제로 존재하는 파일만 가리킨다', () => {
  for (const r of ALLOWED.keys()) {
    assert.ok(fs.existsSync(path.join(SRC, r)), `허용 목록에 죽은 경로가 있다: ${r}`)
  }
})
