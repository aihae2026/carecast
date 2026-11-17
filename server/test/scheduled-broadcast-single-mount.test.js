// 방송 SSE 처리기(useScheduledBroadcast)는 앱에 하나만 있어야 한다 (2026-09-02)
//
// 왜: `initSSE`는 멱등이 아니다 — 부를 때마다 이벤트마다 **새 처리기**를 붙인다. 이 훅이
// 두 번 마운트되면 같은 방송에 재생 경로가 두 번 돌아 **안내 음성이 겹친다.**
//
// 예전엔 App.jsx 안의 모듈 사설 함수라 두 번 마운트가 구조적으로 불가능했다. 2026-09-01에
// 파일을 가르며 `src/hooks/`에 놓이자 useAudioListener와 나란한 **평범한 훅 모양**이 됐다 —
// 다른 화면에서 한 번 더 쓰기 쉬워졌다는 뜻이고, 막는 것은 아무것도 없었다.
// (레드 코드 지적. 그날 미리듣기가 겹치는 소리로 이미 한 번 고생했다.)
//
// 이 가드는 "쓰는 자리가 하나"를 고정한다. 훅 안의 셈(살아있는처리기)은 두 번째 그물이다 —
// 던지지 않고 콘솔에만 남긴다. 방송 도중 화면이 죽는 것이 겹쳐 들리는 것보다 나쁘다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src')
const HOOK = 'hooks/useScheduledBroadcast.js'

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(path.relative(SRC, p).split(path.sep).join('/'))
  }
  return out
}

test('방송 SSE 처리기를 쓰는 곳은 한 군데뿐이다 — 둘이면 안내 음성이 겹친다', () => {
  const 쓰는곳 = []
  for (const rel of walk(SRC)) {
    if (rel === HOOK) continue
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    // 호출만 센다. import 줄은 호출이 아니다(`from '...'`로 끝난다).
    for (const line of src.split('\n')) {
      if (/useScheduledBroadcast\s*\(/.test(line)) 쓰는곳.push(`${rel}: ${line.trim()}`)
    }
  }
  assert.equal(쓰는곳.length, 1,
    `방송 SSE 처리기를 ${쓰는곳.length}곳에서 쓴다 — 앱에 하나여야 한다:\n  ${쓰는곳.join('\n  ')}`)
  assert.match(쓰는곳[0], /^App\.jsx:/,
    `쓰는 자리가 App.jsx가 아니다 — 화면 조립의 꼭대기 한 곳이어야 한다: ${쓰는곳[0]}`)
})

test('훅 스스로도 둘이 뜬 것을 알아챈다 — 소스 가드가 못 보는 경로를 위한 두 번째 그물', () => {
  const src = fs.readFileSync(path.join(SRC, HOOK), 'utf8')
  assert.match(src, /살아있는처리기/, '마운트 수를 세지 않는다')
  assert.match(src, /console\.error\(/, '둘이 떠도 아무 말이 없다')
  assert.doesNotMatch(src, /throw new Error\([^)]*살아있는처리기/,
    '둘이 떴다고 던지면 안 된다 — 방송 도중 화면이 죽는 것이 겹쳐 들리는 것보다 나쁘다')
})
