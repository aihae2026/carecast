// 디자인 토큰이 디자인 시스템 캔버스와 갈리지 않는다 (2026-09-04).
//
// 원본은 아티팩트 "CareCast 디자인 시스템"(17bd2f6a)이고, src/styles/tokens.css는
// 그 값을 코드가 읽을 수 있게 **옮겨 적은 것**이다. 옮겨 적은 것은 갈라진다 —
// 이 저장소가 반복해 겪은 실패 유형이 정확히 그것이라(볼륨 기본값이 두 벌, 시각
// 리터럴이 세 곳) 값이 바뀌면 여기서 걸리게 한다. 캔버스를 고쳤으면 이 파일도 같이 고친다.
//
// 고정하는 사실:
//  1. 브랜드 라벤더와 중립 색이 캔버스 값 그대로다
//  2. **라벤더는 글자로 쓰지 않는다** — 이름이 그 규칙을 담고 있다(brand=채움, brand-ink=글자)
//  3. 반응형 중단점이 캔버스가 정한 390 · 834 · 1440이다
//  4. Tailwind 기본 중단점을 지우지 않았다 — 지우면 지금 md:를 쓰는 화면이 그 자리에서 깨진다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// 캔버스에서 읽은 값 — 여기가 사본의 기준점이다
const CANVAS = {
  '--ds-brand':      '#C3ACFF',
  '--ds-brand-mid':  '#CDB3FF',
  '--ds-brand-tint': '#E3D3FF',
  '--ds-brand-soft': '#F1EDFF',
  '--ds-brand-ink':  '#7C58C3',
  '--ds-bg':         '#F7F6FC',
  '--ds-surface':    '#FFFFFF',
  '--ds-border':     '#E0DEE9',
  '--ds-text':       '#201D28',
  '--ds-text-sub':   '#72707A',
  // 라벤더 판 위의 칩 — 글자색을 10%로 깐 것이다. 알파가 붙은 색은 Tailwind v3에서
  // `bg-ds-text/10`으로 못 만든다(var() 색에는 투명도 수식어가 안 먹는다). 그래서
  // 값 자체를 토큰으로 둔다. 이것이 화면에서 hex를 없앨 수 있었던 마지막 조각이다.
  '--ds-chip-on-brand': '#201D281A',
  // 종류색 — 캔버스가 여섯을 정했다(안내 #286AC8 · BGM #BD4049 · 즉시 #B84800 ·
  // 예약 #9E5C00 · 완료 #007F39 · 흐름=브랜드). **쓰는 화면이 생길 때 옮겨 적는다** —
  // 지금 옮긴 셋은 간편화면 타일이 실제로 쓰는 것뿐이고, 안내·예약은 아직 쓰는 곳이 없다.
  '--ds-kind-now':       '#B84800',
  '--ds-kind-now-soft':  '#FFEAE0',
  '--ds-kind-bgm':       '#BD4049',
  '--ds-kind-bgm-soft':  '#FFE9E8',
  '--ds-kind-done':      '#007F39',
  '--ds-kind-done-soft': '#E1F7E7',
}

test('토큰 값이 디자인 시스템 캔버스와 같다', () => {
  const css = read('src/styles/tokens.css')
  for (const [name, hex] of Object.entries(CANVAS)) {
    const m = new RegExp(name.replace(/-/g, '\\-') + ':\\s*(#[0-9A-Fa-f]{6,8})').exec(css)
    assert.ok(m, `${name}이 tokens.css에 없다`)
    assert.equal(m[1].toUpperCase(), hex,
      `${name}이 캔버스(${hex})와 다르다 — 값이 갈리면 화면과 디자인이 다른 것을 말한다`)
  }
})

test('라벤더를 글자로 쓰지 않는다는 규칙이 토큰에 남아 있다', () => {
  const css = read('src/styles/tokens.css')
  assert.match(css, /--ds-brand:\s*#C3ACFF;\s*\/\* 채움 전용/,
    'brand가 채움 전용이라는 표시가 사라졌다 — 흰 바탕에 글자로 쓰면 1.97:1이라 규칙 위반이다')
  assert.match(css, /--ds-brand-ink:\s*#7C58C3/, '라이트에서 글자로 쓸 색이 없다')
  // 다크에서는 라벤더가 9.72:1이라 글자로 안전하다 — 그래서 brand-ink가 갈아탄다
  const dark = css.slice(css.indexOf("data-theme='dark'"))
  assert.match(dark, /--ds-brand-ink:\s*#C3ACFF/,
    '다크에서 글자색이 안 바뀐다 — 다크 바탕에 #7C58C3은 너무 어둡다')
})

test('반응형 사다리가 390 · 834 · 1024 · 1440이다', () => {
  const cfg = read('tailwind.config.js')
  // 캔버스는 셋(390·834·1440)을 정했고, 1024는 2026-09-04에 더했다 — 834 다음이 바로
  // 1440이면 그 사이 600px가 통째로 늘어나는 구간이 된다(사용자가 약 1000px에서 지적).
  // 1024는 표준 사다리와 실제 기기(iPad Pro 12.9" 세로)가 같이 가리키는 자리다.
  for (const [name, px] of [['phone', '390px'], ['tablet', '834px'], ['laptop', '1024px'], ['wide', '1440px']]) {
    assert.match(cfg, new RegExp(name + ":\\s*'" + px + "'"),
      `중단점 ${name}(${px})이 없거나 값이 다르다`)
  }
})

test('화면이 최대 폭을 정한다 — 중단점만으로는 늘어짐을 못 막는다', () => {
  const s = read('src/pages/SimpleMode.jsx')
  assert.match(s, /max-w-\[834px\][\s\S]{0,40}wide:max-w-\[1440px\]/,
    '최대 폭이 없다 — 중단점 사이 폭에서는 내용이 그냥 늘어난다. '
    + '세로로 쌓는 동안은 834로 묶고, 두 판이 되는 wide에서만 1440까지 편다')
})

test('Tailwind 기본 중단점을 지우지 않았다 — 지우면 지금 md:를 쓰는 화면이 깨진다', () => {
  const cfg = read('tailwind.config.js')
  const i = cfg.indexOf('screens:')
  assert.notEqual(i, -1, 'screens 정의를 못 찾았다')
  // theme.extend 안에 있어야 더하기다. theme 바로 아래면 기본값을 통째로 갈아치운다.
  const beforeScreens = cfg.slice(0, i)
  const extendAt = beforeScreens.lastIndexOf('extend:')
  const themeAt = beforeScreens.lastIndexOf('theme:')
  assert.ok(extendAt > themeAt,
    'screens가 theme.extend 밖에 있다 — Tailwind 기본 중단점이 통째로 사라져서 '
    + '지금 md:·lg:를 쓰는 화면(ScheduledBroadcast 등)이 그 자리에서 깨진다')
})

// 2026-09-04 — 사용자가 "var(--ds-)로 합친다"고 정한 뒤 생긴 규칙.
// Tailwind에 ds 색을 등록하면 `bg-ds-brand`처럼 이름으로 쓸 수 있는데, 등록할 때
// **값을 다시 적으면 사본이 도로 늘어난다**(config가 네 번째 사본이 된다).
// 그래서 config는 `var(--ds-*)` 참조만 적고, 아래 두 검사가 그것을 고정한다.
test('Tailwind의 ds 색이 값을 다시 적지 않는다 — var() 참조만', () => {
  const cfg = read('tailwind.config.js')
  const at = cfg.indexOf('ds: {')
  assert.notEqual(at, -1, 'tailwind.config.js에 ds 색 등록이 없다')
  const block = cfg.slice(at, cfg.indexOf('}', at))
  const hexes = [...new Set([...block.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map(m => m[0]))]
  assert.deepEqual(hexes, [],
    `ds 색에 값을 직접 적었다(${hexes.join(' ')}) — var(--ds-*)로만 가리켜야 tokens.css가 유일한 출처로 남는다`)
})

test('Tailwind의 ds 색과 tokens.css의 토큰이 1:1이다', () => {
  const cfg = read('tailwind.config.js')
  const css = read('src/styles/tokens.css')
  // 라이트 :root만 본다 — 다크 절은 같은 이름을 덮어쓰는 것이라 새 토큰이 아니다
  const root = css.slice(css.indexOf(':root'), css.indexOf("data-theme='dark'"))
  // ── **채널 꼴을 같은 이름으로 본다** (2026-09-16) ────────────────────────────
  // 색 토큰이 두 줄로 갈렸다: `--ds-v3-tts-rgb: 37 99 235;` 와 그것을 조립한
  // `--ds-v3-tts: rgb(var(--ds-v3-tts-rgb));`. Tailwind 는 **채널 쪽**을 가리킨다
  // (`rgb(var(--ds-v3-tts-rgb) / <alpha-value>)`) — 그래야 `bg-…/40` 같은 투명도가 먹는다.
  //
  // **왜 갈랐나**: Tailwind v3 는 `var()` 색에 투명도 수식어를 못 붙인다. 붙이면 그
  // 클래스가 **아예 안 만들어져서**, 화면에서는 그 배경·테두리가 조용히 사라진다.
  // 실측으로 확인했다 — `bg-ds-v3-tts-bg/40` 이 빌드된 CSS 에 **0건**이었다(2026-09-16).
  // 이 저장소는 그 함정을 `tokens.css` 주석에 이미 적어 두고도 다시 밟았다.
  //
  // 그래서 **`-rgb` 꼬리를 떼고** 같은 이름으로 견준다. 「한쪽에만 있으면 조용히 안
  // 먹는다」는 이 시험의 뜻은 그대로다.
  const 이름만 = (n) => n.replace(/-rgb$/, '')
  const defined = [...new Set([...root.matchAll(/(--ds-[a-z0-9-]+)\s*:/g)].map(m => 이름만(m[1])))].sort()
  const wired   = [...new Set([...cfg.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map(m => 이름만(m[1])))].sort()
  assert.deepEqual(wired, defined,
    '토큰과 Tailwind 등록이 어긋났다 — 한쪽에만 있으면 화면에서 '
    + '어떤 이름은 되고 어떤 이름은 조용히 안 먹는다(클래스 오타와 구분이 안 된다).\n'
    + `  tokens.css에만: ${defined.filter(n => !wired.includes(n)).join(' ') || '없음'}\n`
    + `  config에만:     ${wired.filter(n => !defined.includes(n)).join(' ') || '없음'}`)
})
