// 간편화면 사이드바는 **「간편모음」**이다 (사용자 지시 2026-09-14).
//
// ── 왜 이름을 바꾸나 ─────────────────────────────────────────────────────────
// 그 서랍에는 음량만 있는 것이 아니다 — 즉시 방송 옵션·즐겨찾기·배경음악·음량·시스템이
// 함께 산다. 「소리 조절」이라고 적혀 있으면 **거기 있는 줄 모른다.**
//
// ── 어디까지 바꾸나 ──────────────────────────────────────────────────────────
// **간편화면의 그 서랍만이다.** 관리자 화면의 음량 용어는 안 건드린다(사용자 지시) —
// 「음량 및 TTS」 같은 메뉴 이름은 그대로다. 여기서 보는 것은 셋이다:
//   · 서랍 제목(사람이 읽는 글자)
//   · 여닫는 손잡이의 접근성 이름(화면 낭독기가 읽는 것)
//   · 서랍 자체의 접근성 이름(`aria-label`)
// 셋이 갈리면 **보이는 이름과 낭독되는 이름이 달라진다** — 그게 이 저장소가 「표시와 동작이
// 갈린다」고 부르는 실패다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 걷어낸 코드만 본다 — 머리말이 제 가드를 건드리는 사고를 여러 번 겪었다. */
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DRAWER = 코드만(읽기('src/components/home/HomeDrawer.jsx'))
const SHELL  = 코드만(읽기('src/components/home/HomeShell.jsx'))

test('서랍 제목이 「간편모음」이다', () => {
  assert.match(DRAWER, /<span className="text-sm font-semibold">간편모음<\/span>/,
    '서랍 제목이 아직 「소리 조절」이다 — 거기 뭐가 들었는지 이름이 안 말해 준다')
})

test('서랍의 접근성 이름도 같다 — 보이는 글자와 낭독되는 글자가 갈리면 안 된다', () => {
  assert.match(DRAWER, /aria-label="간편모음"/, '서랍의 aria-label 이 안 따라왔다')
  assert.doesNotMatch(DRAWER, /aria-label="소리 ?조절"/, '옛 이름이 남아 있다')
})

test('여닫는 손잡이의 낭독 이름도 같다', () => {
  assert.match(SHELL, /간편모음 닫기/, '손잡이 「닫기」 낭독 이름이 안 따라왔다')
  assert.match(SHELL, /간편모음 열기/, '손잡이 「열기」 낭독 이름이 안 따라왔다')
  assert.doesNotMatch(SHELL, /'소리 조절 (열기|닫기)'/, '옛 이름이 남아 있다')
})

test('관리자 화면의 음량 용어는 안 건드린다 — 범위를 넘지 않는다', () => {
  const 관리자 = 읽기('src/components/admin/Sidebar.jsx')
  assert.match(관리자, /음량 및 TTS/,
    '관리자 메뉴 이름이 바뀌었다 — 이번 지시는 **간편화면 서랍 하나**다')
})
