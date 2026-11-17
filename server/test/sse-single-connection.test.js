// 창 하나가 여는 실시간 연결(SSE)은 **하나**여야 한다.
//
// 2026-09-01에 현장 PC를 원격에서 열었더니 화면이 "불러오는 중"에서 안 풀리고
// "서버 재연결 중"이 떴다. 서버는 멀쩡했다(원격에서 잰 /api/health 4ms · CPU 3%).
// 원인은 창 하나가 SSE를 셋 열고 있던 것이다 — lib/api · MusicPlayer · SystemAlertBanner.
// 브라우저는 주소 하나당 소켓이 6개뿐이고(HTTPS가 꺼져 있어 HTTP/1.1) SSE는 그 소켓을
// 끊지 않고 붙잡는다. 창 둘이면 남는 소켓이 거의 없어 나머지 요청이 줄에서 안 빠진다.
//
// 그래서 연결을 여는 자리는 lib/api 한 곳이고, 나머지는 openSSEBus()로 나눠 쓴다.
// 이 검사가 없으면 다음에 누가 또 하나 연다 — 그때는 증상만 보고는 원인을 못 찾는다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '../../src')

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full)
  }
  return out
}

test('new EventSource는 저장소에 한 곳뿐이다 (src/lib/api.js)', () => {
  const hits = []
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8')
    const n = (src.match(/new EventSource\(/g) || []).length
    if (n > 0) hits.push({ file: path.relative(SRC, file).split(path.sep).join('/'), n })
  }
  assert.deepEqual(hits, [{ file: 'lib/api.js', n: 1 }],
    '연결을 여는 자리는 lib/api 한 곳이어야 한다. 다른 곳이 필요하면 openSSEBus()를 쓴다. 실제: ' +
    JSON.stringify(hits))
})

test('연결을 나눠 쓰던 화면들은 openSSEBus를 쓴다', () => {
  for (const rel of [
    'components/easy/MusicPlayer.jsx',
    'components/shared/SystemAlertBanner.jsx',
    'pages/MonitorPage.jsx',
  ]) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    assert.ok(src.includes('openSSEBus'), `${rel}가 공유 연결을 안 쓴다`)
  }
})

test('공유 연결은 소리 담당 이름표를 그대로 싣는다', () => {
  // 이름표(?tab=)가 빠지면 서버가 이 창을 소리 담당 후보에서 빼서 **아무도 소리를 안 낸다.**
  // 합치면서 이 한 줄을 놓치는 것이 가장 조용한 사고다.
  const api = fs.readFileSync(path.join(SRC, 'lib/api.js'), 'utf8')
  const at = api.indexOf('new EventSource(')
  const around = api.slice(Math.max(0, at - 400), at + 200)
  assert.ok(around.includes('CAN_OWN_SOUND'), '이름표 판정(CAN_OWN_SOUND)이 연결 앞에 있어야 한다')
  assert.ok(around.includes('TAB_ID'), '이름표에 TAB_ID가 실려야 한다')
})
