// **방송 로그의 펼침 단계가 그 줄 바로 아래 붙는가** (현장 지적 2026-09-15).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 사용자가 시계 옆 화살표를 눌렀는데 **아무 일도 안 일어나 보였다.**
// 실제로는 동작하고 있었다 — 단계 목록이 **표 맨 아래**에 그려졌을 뿐이다.
// 펼친 줄이 표 위쪽이면 내용은 수십 줄 밑에 나타나므로, 쓰는 사람에게는 고장이다.
//
// 원인: 펼침 행을 `filtered.map(...)` **다음에 한 번 더** 돌려서 그렸다. 첫 map 이
// 모든 로그 줄을 내보낸 **뒤에** 두 번째 map 이 모든 펼침 줄을 내보내는 구조라,
// 자리가 어긋날 수밖에 없었다. 바로 위 주석은 *"위 행 바로 아래에 붙는다"* 였다 —
// **주석이 코드보다 옳았다.**
//
// ── 왜 소스를 글자로 보나 ───────────────────────────────────────────────────
// 이 저장소에는 React 를 띄우는 장치가 없다(`node --test` 만 쓴다). 그래서 **구조**를 본다:
// 펼침 행이 로그 행과 **같은 map 안**에 있는가. 렌더 결과를 보는 것이 아니므로
// 이 시험은 "화면이 예쁘다"를 보증하지 않는다 — **자리가 어긋나는 그 구조**만 막는다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const 파일 = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'BroadcastLog.jsx')
const 소스 = fs.readFileSync(파일, 'utf8')

test('긍정 앵커 — 펼침 단추와 상태가 아직 이 파일에 있다', () => {
  assert.match(소스, /toggleSteps/, '펼침 단추가 사라졌다 — 이 시험의 대상이 없다')
  assert.match(소스, /openSteps/,   '펼침 상태가 사라졌다')
})

test('**펼침 행을 두 번째 map 으로 그리지 않는다** — 그러면 표 맨 아래로 간다', () => {
  // `filtered.map` 이 **하나**여야 한다. 둘이면 옛 구조로 돌아간 것이다.
  const 횟수 = (소스.match(/filtered\.map\s*\(/g) || []).length
  assert.equal(횟수, 1,
    `filtered.map 이 ${횟수}개다 — 펼침 행을 따로 한 번 더 돌리면 단계가 표 맨 아래에 붙는다`)
})

test('**펼침 행이 로그 행과 같은 Fragment 안에 있다**', () => {
  assert.match(소스, /import \{[^}]*\bFragment\b[^}]*\} from 'react'/,
    'Fragment 를 안 가져온다 — 한 map 에서 두 줄을 내보낼 수 없다')
  assert.match(소스, /<Fragment key=\{log\.id\}>/,
    '로그 한 줄이 Fragment 로 감싸여 있지 않다 — 펼침 행을 그 아래 둘 자리가 없다')
  // 펼침 값을 그 줄 안에서 뽑아 쓰는가. 밖에서 다시 찾으면 또 갈릴 수 있다.
  assert.match(소스, /const 펼침 = log\.runKey \? openSteps\[log\.runKey\] : null/,
    '펼침 값을 그 줄의 지역 변수로 뽑고 있지 않다')
})
