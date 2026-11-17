// 간편화면이 캔버스의 세 폭을 따른다 (2026-09-04).
//
// 디자인 시스템 캔버스가 정한 반응형 기준은 **390(1열) · 834(세로 쌓기) · 1440(두 판)**이고,
// 그 세 모습이 아트보드 셋(SimpleMobile · SimpleTablet · EasyMode 웹)으로 그려져 있다.
// 화면이 그 기준을 안 따르면 늘였다 줄일 때 깨진다 — 지금 저장소가 딱 그 상태였다
// (반응형 유틸리티가 전체에 22개뿐).
//
// 고정하는 사실:
//  1. 두 판은 **wide(1440)에서만** 나란히 선다 — 그 아래는 세로로 쌓인다
//  2. Tailwind 기본 중단점(md 768 등)을 이 화면에 섞어 쓰지 않는다 — 기준이 두 벌이 된다
//  3. 캔버스의 색을 지어내지 않고 그대로 쓴다(라벤더 판·중립 바탕)
//  4. 손가락 표적이 44px 아래로 안 내려간다(쉬운 화면에서 이미 정한 규칙)
//  5. **소리를 내는 경로가 없다** — 새 화면이 새 방송 길을 열면 정지·겹침 규칙을 또 지켜야 한다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const src = () => fs.readFileSync(path.join(ROOT, 'src', 'pages', 'SimpleMode.jsx'), 'utf8')

test('두 판은 wide(1440)에서만 나란히 선다', () => {
  const s = src()
  assert.match(s, /wide:grid-cols-\[640px_minmax\(0,1fr\)\]/,
    '1440에서 두 판(640 + 나머지)이 안 된다 — 캔버스 EasyMode 아트보드의 배치다')
  // 그 아래 폭에서는 그냥 grid 한 줄로 쌓인다: grid-cols 지정이 wide에만 붙어야 한다
  assert.ok(!/(^|\s)grid-cols-\[640px/.test(s),
    '두 판 배치가 모든 폭에 걸렸다 — 폰에서 640px 판이 화면을 넘는다')
})

test('기본 중단점을 섞어 쓰지 않는다 — 기준이 두 벌이 되면 안 된다', () => {
  const s = src()
  for (const bad of ['sm:', 'md:', 'lg:', 'xl:', '2xl:']) {
    assert.ok(!s.includes(bad),
      `${bad}를 썼다 — 이 화면의 기준은 phone/tablet/wide(390·834·1440)뿐이다. `
      + 'Tailwind 기본값(640·768·1024)과 섞이면 어느 폭에서 무엇이 바뀌는지 아무도 모른다')
  }
  assert.match(s, /wide:/, '가장 넓은 판 규칙이 아예 없다')
})

// 2026-09-04 방향 전환: 처음엔 이 자리에서 화면에 hex가 **있는지**를 봤다. 그때는 화면이
// 캔버스 색을 지어내지 않았다는 것만 확인하면 됐기 때문이다. 그런데 같은 값이 tokens.css에도
// 있어서 **사본이 셋**(캔버스 · tokens.css · 이 화면)이 됐고, 캔버스 색이 하나 바뀌면
// design-tokens.test.js는 tokens.css만 걸고 화면의 리터럴은 조용히 옛 색으로 남았다.
// 사용자가 "var(--ds-)로 합친다"고 정해서(2026-09-04), 이제 **반대를 검사한다** —
// 화면에는 hex가 하나도 없어야 한다. 값의 유일한 출처는 tokens.css다.
test('색 값을 화면에 다시 적지 않는다 — 토큰 이름으로만 쓴다', () => {
  const s = src()
  const hexes = [...new Set([...s.matchAll(/#[0-9A-Fa-f]{6,8}\b/g)].map(m => m[0]))]
  assert.deepEqual(hexes, [],
    `화면에 색 값을 직접 적었다(${hexes.join(' ')}) — 값은 tokens.css 한 곳에만 있어야 한다. `
    + '캔버스 색이 바뀌면 tokens.css만 고치면 되게, Tailwind는 bg-ds-*, 인라인은 var(--ds-*)를 쓴다')
  // 안 쓰는 것과 구분한다 — hex를 지우고 색을 통째로 빼 버려도 위 검사는 통과한다
  assert.match(s, /\bbg-ds-brand\b/, '라벤더 판이 토큰으로 칠해지지 않는다')
  assert.match(s, /var\(--ds-/, '인라인 색이 토큰을 읽지 않는다')
  assert.ok(!/cc-(bg|card|primary|text)\b/.test(s),
    '옛 팔레트(cc-*)가 섞였다 — 새 화면은 새 시스템 하나만 본다')
})

test('손가락 표적이 44px 아래로 안 내려간다', () => {
  const s = src()
  // **누르는 것만 잰다.** 아이콘 배지·점 같은 장식은 작아도 되고, 실제로 작다
  // (28px 로고 칩, 6px 점). 처음엔 h-* 전부를 셌다가 그것들에 걸렸다 — 규칙이
  // 겨냥하는 것은 손가락이 닿는 자리다.
  // `<button …>`를 정규식으로 자르면 onClick의 `=>`에 든 `>`에서 끊긴다(실제로 걸렸다).
  // 그래서 여는 태그부터 고정 길이 창을 떠서 그 안의 높이 지정을 본다.
  const buttons = [...s.matchAll(/<button\b/g)].map(m => s.slice(m.index, m.index + 700))
  assert.ok(buttons.length >= 3, '누를 수 있는 것이 거의 없다 — 검사가 헐거워졌다')
  for (const b of buttons) {
    const h = /\bh-(\d+)\b/.exec(b)
    const minH = /min-h-\[(\d+)px\]/.exec(b)
    const px = h ? Number(h[1]) * 4 : minH ? Number(minH[1]) : null
    assert.ok(px !== null && px >= 44,
      `44px보다 작거나 높이가 없는 누름 표적이 있다(${px}px) — 쉬운 화면에서 이미 정한 규칙이다:\n${b.slice(0, 120)}`)
  }
})

test('소리를 내는 경로가 없다 — 새 화면이 새 방송 길을 열지 않는다', () => {
  const s = src()
  for (const bad of ['ttsBroadcast', 'triggerSchedule', 'playChime', 'apiPost', 'broadcast-bgm-start']) {
    assert.ok(!s.includes(bad),
      `${bad}를 부른다 — 소리를 내는 길이 하나 늘면 정지·겹침 규칙(td09)을 그만큼 또 지켜야 한다. `
      + '지금은 뼈대와 기존 화면으로 보내는 것까지다')
  }
})
