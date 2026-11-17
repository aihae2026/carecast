// 모니터링 창 진입점 — **찾기 쉬운 자리에, 한 곳에서 만든다** (사용자 지시 2026-09-14).
//
// ── 무엇이 문제였나 ──────────────────────────────────────────────────────────
// 단추가 간편모음 **맨 아래** 「시스템」 패널 안에만 있었다 — 실측 `top: 2411px`.
// 서랍을 열고 한참 내려야 나오고, 휴대폰에서는 사실상 못 찾는다.
//
// ── 고친 방향 ────────────────────────────────────────────────────────────────
// 서랍 **맨 위**에 한 줄로 둔다. 그런데 같은 단추를 두 자리에 **복사**하면 팝업 차단
// 안내가 한쪽에만 붙거나 문구가 갈린다 — 이 저장소가 여러 번 데인 모양이다.
// 그래서 **부품 하나**(`MonitorOpenButton`)로 만들고 두 자리가 그것을 쓴다.
//
// ── 「방송 화면」과 섞지 않는다 ──────────────────────────────────────────────
// 저쪽은 **소리를 내는** 화면이고 이쪽은 **보기만 하는** 창이다. 창 이름도 따로 쓴다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT  = path.join(__dirname, '..', '..')
const 읽기  = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('단추를 만드는 자리가 **하나**다 — 사본을 두지 않는다', () => {
  const 만드는곳 = []
  for (const f of ['src/components/home/MonitorOpenButton.jsx',
                   'src/components/easy/SystemStatusCompact.jsx',
                   'src/components/easy/TopBar.jsx',
                   'src/pages/HomeMode.jsx']) {
    const s = 코드만(읽기(f))
    if (/모니터링 창 열기\s*\n?\s*<\/button>|>\s*모니터링 창 열기/.test(s)) 만드는곳.push(f)
  }
  assert.deepEqual(만드는곳, ['src/components/home/MonitorOpenButton.jsx'],
    `단추 글자를 만드는 자리가 여럿이다 — 문구·팝업 안내가 갈린다: ${만드는곳.join(', ')}`)
})

test('간편모음 **맨 위**에 있다 — 서랍을 열면 바로 보여야 한다', () => {
  const s = 코드만(읽기('src/pages/HomeMode.jsx'))
  const i = s.indexOf('<HomeDrawer')
  const j = s.indexOf('<HomePanel', i)
  assert.ok(i > 0 && j > i, '서랍과 첫 패널을 못 찾았다')
  const 사이 = s.slice(i, j)
  assert.match(사이, /<MonitorOpenButton/,
    '모니터링이 서랍의 첫 패널보다 뒤에 있다 — 한참 내려야 나온다')
})

test('시스템 패널에도 **같은 부품**이 남아 있다 — 옛 자리를 잃지 않는다', () => {
  const s = 코드만(읽기('src/components/easy/SystemStatusCompact.jsx'))
  assert.match(s, /<MonitorOpenButton/, '옛 자리의 진입점이 통째로 사라졌다')
})

test('팝업이 막히면 **말해 준다** — 눌렀는데 아무 일도 없으면 고장으로 읽힌다', () => {
  const s = 코드만(읽기('src/components/home/MonitorOpenButton.jsx'))
  assert.match(s, /모니터창열기\(\)/, '창 여는 규칙(단일 출처)을 안 쓴다')
  assert.match(s, /role="alert"/, '차단 안내가 보조기술에 안 알려진다')
  assert.match(s, /팝업 차단/, '차단 안내 문구가 없다')
})

test('「방송 화면」과 섞지 않는다 — 다른 창 이름을 쓴다', () => {
  const m = 읽기('src/lib/monitorWindow.js')
  assert.match(m, /carecast_monitor/, '모니터링 창이 제 이름을 안 갖는다')
  const s = 코드만(읽기('src/components/home/MonitorOpenButton.jsx'))
  assert.doesNotMatch(s, /방송 화면/, '같은 단추가 방송 화면까지 겸한다')
})
