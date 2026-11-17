'use strict'
// **화면 높이를 쓰는 곳은 확대를 알아야 한다** (사용자 신고 2026-09-15).
//
// *"지금! 스크롤 버그 큰화면으로 하니까 저기서 안 내려가 … 비슷한 문제 있는지 다 확인해."*
//
// ── 왜 깨지나 ──────────────────────────────────────────────────────────────
// 「크게 보기」는 `<html>` 에 `zoom` 을 건다. 그러면 안쪽의 모든 px 이 배율만큼 커져서
// 그려진다. **그런데 `vh`·`dvh` 는 확대를 모른다** — 늘 「화면 높이의 몇 %」다.
//
// 그래서 `max-h-[90dvh]` 인 모달이 1.5배에서는 **화면보다 1.5배 커지고**, 넘친 부분이
// 화면 밖으로 나가 스크롤이 죽는다. 사용자가 겪은 것이 정확히 이것이다.
//
// ── 고치는 법 ──────────────────────────────────────────────────────────────
// **배율로 나눈다**: `calc(90dvh/var(--cc-zoom,1))`. 기본값 1 이라 평소에는 글자
// 그대로 예전과 같다. 배율은 `lib/bigView.먹이기()` 가 내보낸다.
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
// *"비슷한 문제 있는지 다 확인해"* — 한 곳만 고치면 다음에 또 같은 신고가 온다.
// **화면 높이로 자기 크기를 정하는 곳을 전수로 훑어서**, 배율을 안 나눈 것이 있으면
// 빨간불을 낸다. 새로 생기는 것도 걸린다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

function 모든소스(뿌리 = SRC, 모음 = []) {
  for (const 이름 of fs.readdirSync(뿌리)) {
    const p = path.join(뿌리, 이름)
    const st = fs.statSync(p)
    if (st.isDirectory()) 모든소스(p, 모음)
    else if (/\.(jsx?|css)$/.test(이름)) 모음.push(p)
  }
  return 모음
}

// **자기 크기를 화면 높이로 정하는 것**만 본다. `padding`·`top` 같은 여백은 배율과
// 함께 커지는 것이 맞아서 안 본다 — 그것까지 나누면 확대해도 여백만 제자리라 어색하다.
const 크기속성 = /(?:^|[\s"'`:{])(?:max-h|min-h|h)-\[([^\]]*?(?:dvh|vh)[^\]]*)\]/g

test('**화면 높이로 크기를 정하는 곳이 전부 배율을 나눈다**', () => {
  const 빠진곳 = []
  for (const p of 모든소스()) {
    const src = fs.readFileSync(p, 'utf8')
    // 주석 안의 설명은 코드가 아니다 — 이 규칙을 설명하는 글이 스스로 걸리면 안 된다.
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    크기속성.lastIndex = 0
    let m
    while ((m = 크기속성.exec(코드만)) !== null) {
      if (m[1].includes('--cc-zoom')) continue
      빠진곳.push(`${path.relative(ROOT, p)} → ${m[0].trim()}`)
    }
  }
  assert.deepEqual(빠진곳, [],
    '확대하면 화면보다 커져서 스크롤이 죽는다. `calc(…/var(--cc-zoom,1))` 로 나눌 것:\n  '
    + 빠진곳.join('\n  '))
})

// ── **폭도 같다** (사용자 신고 2026-09-16) ────────────────────────────────────
// *"모바일에서 확대경 누르면 각각 사이즈에 알맞게 조절되는게 아니라 사이드바도 넘치게
//   나오잖아, 확대는 하되 최소규격이 유지될 수 있도록 조정해"*
//
// 위 높이 규칙을 만들 때 **폭은 안 봤다.** 같은 함정인데 한쪽만 막았던 것이다:
// 간편모음 서랍이 `w-[min(320px,88vw)]` 였는데, `vw` 는 확대를 모르므로 1.5배에서
// **88vw 가 그대로 화면의 88%로 계산된 뒤 1.5배로 그려져** 화면 밖으로 삐져나갔다.
// 사진에서 서랍 제목이 왼쪽으로 잘려 나간 것이 그것이다.
//
// `%` 와 `px` 는 안 본다 — 확대하면 **레이아웃 뷰포트가 그만큼 좁아져서** 100% 는
// 여전히 화면에 맞는다. 어긋나는 것은 화면을 직접 가리키는 `vw` 뿐이다.
const 폭속성 = /(?:^|[\s"'`:{])(?:max-w|min-w|w)-\[([^\]]*?vw[^\]]*)\]/g

test('**화면 폭으로 크기를 정하는 곳이 전부 배율을 나눈다**', () => {
  const 빠진곳 = []
  for (const p of 모든소스()) {
    const src = fs.readFileSync(p, 'utf8')
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    폭속성.lastIndex = 0
    let m
    while ((m = 폭속성.exec(코드만)) !== null) {
      if (m[1].includes('--cc-zoom')) continue
      // `w-screen`(100vw) 은 유틸리티 이름이라 여기 안 걸린다. 걸리는 것은
      // **대괄호로 직접 적은 값**뿐이다.
      빠진곳.push(`${path.relative(ROOT, p)} → ${m[0].trim()}`)
    }
  }
  assert.deepEqual(빠진곳, [],
    '확대하면 화면보다 넓어져서 옆으로 삐져나간다. `calc(…/var(--cc-zoom,1))` 로 나눌 것:\n  '
    + 빠진곳.join('\n  '))
})

test('긍정 앵커 — 폭을 실제로 나누는 자리가 있다', () => {
  // 위 시험은 **없을 것**만 본다 — 대상이 아예 없어도 통과한다(「파일을 가를 때」 ②).
  const drawer = fs.readFileSync(path.join(SRC, 'components/home/HomeDrawer.jsx'), 'utf8')
  assert.match(drawer, /w-\[min\(320px,calc\(88vw\/var\(--cc-zoom,1\)\)\)\]/,
    '서랍 폭이 배율을 안 나눈다 — 크게 보기에서 화면 밖으로 나간다')
  // **닫힌 자리도 같이 나눠야 한다.** 여는 폭만 나누면 닫아 둔 서랍이 덜 밀려서
  // 화면 오른쪽에 띠로 남는다.
  assert.match(drawer, /right-\[calc\(-1\*min\(320px,calc\(88vw\/var\(--cc-zoom,1\)\)\)\)\]/,
    '닫아 둔 서랍이 배율을 안 나눈다 — 화면 오른쪽에 띠가 남는다')
})

test('긍정 앵커 — 실제로 그렇게 고쳐진 자리가 있다', () => {
  // 위 시험은 **없을 것**만 본다. 대상이 아예 없어도 통과하므로, 고친 자리가
  // 남아 있는지 따로 본다(「파일을 가를 때」 규칙 ②).
  const shell = fs.readFileSync(path.join(SRC, 'components/shared/ModalShell.jsx'), 'utf8')
  assert.match(shell, /max-h-\[calc\(90dvh\/var\(--cc-zoom,1\)\)\]/,
    '모달 높이가 배율을 안 나눈다 — 크게 보기에서 스크롤이 죽는다')
  assert.match(shell, /h-\[calc\(100dvh\/var\(--cc-zoom,1\)\)\]/,
    '모달 덮개가 배율을 안 나눈다')
})

test('**배율을 CSS 가 읽을 수 있게 내보낸다** — 안 내보내면 위 계산이 늘 1 이다', () => {
  const { 먹이기 } = require('../../src/lib/bigView.js')
  const 적힌것 = {}
  const 가짜 = { style: {
    zoom: null,
    setProperty(k, v) { 적힌것[k] = v },
    removeProperty(k) { delete 적힌것[k]; if (k === 'zoom') this.zoom = null },
  } }

  먹이기(1.5, 가짜)
  assert.equal(적힌것['--cc-zoom'], '1.5', '배율을 CSS 로 안 내보낸다')

  // **1 일 때는 지운다** — 남겨 두면 평소에도 이 계산이 돌아 값이 미묘하게 달라진다.
  먹이기(1, 가짜)
  assert.equal(적힌것['--cc-zoom'], undefined, '원래 크기인데 배율 값이 남아 있다')
})
