'use strict'
// UX-42 — **색만으로 상태를 구분하지 않는다. 지금 어디인지 보인다.** (2026-09-11)
//
// 둘 다 "없어도 화면은 멀쩡해 보이는" 종류라 조용히 사라진다. 그래서 글자로 고정한다.
//
//   ① 상태 점이 색점 하나뿐이면 — 적록색약(성인 남성 약 8%)과 밝은 곳의 현장 PC 화면에서
//      초록과 빨강이 같은 회색 점이 된다. 방송 시스템에서 그건 "괜찮은 줄 알았다"가 된다.
//   ② `focus:outline-none` 으로 브라우저 기본 포커스 링을 지우면 키보드로 다니는 사람이
//      지금 어디에 있는지를 통째로 잃는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const BADGE = 읽기('src/components/shared/Badge.jsx')
const CSS = 읽기('src/index.css')

test('상태 점은 색 말고도 알린다 — 글자와 모양', () => {
  // 긍정 앵커 — 감시할 대상이 이 파일에 있다.
  assert.match(BADGE, /export function StatusDot/, 'StatusDot 이 사라졌다 — 이 가드를 옮길 것')

  const 구간 = BADGE.slice(BADGE.indexOf('const dotStyles'), BADGE.indexOf('export function TypeBadge'))
  assert.ok(구간.length > 100, 'StatusDot 구간을 못 찾았다 — 이 가드를 옮길 것')

  assert.match(구간, /aria-label=/, '보조기기에 아무것도 안 알린다')
  assert.match(구간, /title=/, '마우스로도 무슨 상태인지 못 본다')
  for (const 말 of ['정상', '주의', '오류']) {
    assert.ok(구간.includes(말), `상태 "${말}" 을 글자로 안 말한다`)
  }
  // 모양이 셋 다 같으면(전부 `bg-`) 흑백에서 구분이 안 된다.
  assert.match(구간, /border-2|ring-2/, '세 상태의 모양이 같다 — 흑백에서 구분이 안 된다')
})

test('상태를 모를 때 초록으로 떨어지지 않는다', () => {
  const 구간 = BADGE.slice(BADGE.indexOf('const dotStyles'), BADGE.indexOf('export function TypeBadge'))
  assert.match(구간, /확인 불가/, '모르는 상태를 "정상" 쪽으로 읽게 둔다')
  assert.doesNotMatch(구간, /\?\?\s*dotStyles\.online/, '기본값이 정상이다 — 모름이 정상으로 보인다')
})

// `:focus-visible` 은 이 파일에 이미 다른 자리에도 있다(볼륨 슬라이더 thumb, :70).
// 그래서 **UX-42 블록만 잘라서** 본다 — 그냥 `indexOf(':focus-visible')` 로 자르면
// 슬라이더 규칙부터 읽어 엉뚱한 것을 판정한다(이 테스트를 처음 쓸 때 실제로 그랬다).
function UX42블록() {
  // `(UX-42` 는 이 파일에 다른 자리에도 있다. 이 블록만 가리키는 문장으로 찾는다.
  const 시작 = CSS.indexOf('키보드로 다니는 사람에게')
  assert.ok(시작 > -1, 'UX-42 포커스 블록이 사라졌다 — 이 가드를 옮길 것')
  const 끝 = CSS.indexOf('/* 라이트 테마 스크롤바 */', 시작)
  return CSS.slice(시작, 끝 === -1 ? CSS.length : 끝)
}

test('키보드 포커스가 보인다 — 규칙은 한 곳에만 있다', () => {
  const 블록 = UX42블록()
  assert.match(블록, /^\s*:focus-visible\s*\{[^}]*outline:/m, '전역 포커스 표시가 없다')
  // 클래스 선택자가 전역 규칙을 이기므로 입력창은 따로 적어야 한다.
  assert.match(블록, /\.input-base:focus-visible\s*\{[^}]*outline:/,
    '입력창만 조용히 포커스 표시를 잃는다 — 클래스 선택자가 전역 규칙보다 우선한다')
  // `focus:outline-none` 은 그대로 둔다(마우스 클릭에 링이 남지 않게) —
  // 지우는 것이 아니라 `:focus-visible` 로 **되살리는** 것이 이 수정의 요지다.
  assert.match(CSS, /\.input-base\b[\s\S]{0,300}focus:outline-none/,
    '마우스 클릭에도 링이 남는다 — 옛 불평이 돌아온다')
})

test('포커스 링이 `focus:outline-none` 에 지워지지 않는다', () => {
  // **브라우저가 잡은 것이다**(2026-09-11 실측). CSS 는 맞게 쓰여 있었는데 화면에서는
  // 링 색이 `rgba(0,0,0,0)` 이었다 — Tailwind 의 `focus:outline-none` 이 `outline:none`
  // 이 아니라 **투명한 테두리**를 그리고, 그 유틸리티가 클래스 선택자라 이 규칙을 이긴다.
  // src 에 그 클래스가 81곳이라 포커스 표시가 통째로 죽어 있었다.
  // 소스 문자열만 보는 가드로는 못 잡는 종류라, 최소한 `!important` 는 지키게 한다.
  const 블록 = UX42블록()
  const 규칙들 = 블록.match(/outline:[^;]+;/g) || []
  assert.ok(규칙들.length >= 2, '포커스 규칙을 못 찾았다 — 이 가드를 옮길 것')
  for (const r of 규칙들) {
    assert.match(r, /!important/, `이 규칙이 focus:outline-none 에 진다: ${r}`)
  }
  // 그 유틸리티가 아직 쓰이고 있다는 것도 앵커로 박아 둔다 — 언젠가 다 사라지면
  // 이 `!important` 도 필요 없어진다. 그때 이 테스트가 알려준다.
  const 쓰는곳 = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .filter(p => typeof p === 'string' && /\.jsx?$/.test(p))
    .filter(p => fs.readFileSync(path.join(ROOT, 'src', p), 'utf8').includes('focus:outline-none'))
  assert.ok(쓰는곳.length > 0,
    'focus:outline-none 이 이제 아무 데도 없다 — !important 를 걷어도 되는지 보라')
})

// **브라우저가 또 잡았다**(2026-09-12 실측). 규칙은 맞게 쓰여 있고 계산된 값도 2px 링인데,
// 감싼 상자가 `overflow-hidden` 이면 **링이 잘려서 안 보인다.** 링은 테두리 바깥
// 2px(offset) + 2px(두께) = 4px 에 그려지는데, 세그먼트 버튼은 그 상자의 안쪽 면에 1px 틈으로
// 붙어 있었다. `overflow-hidden` 은 둥근 모서리로 자식을 깎으려고 둔 것이라 지울 수 없어서,
// 이 안의 버튼만 링을 **안쪽**에 그린다(`outline-offset: -2px`).
//
// 소스에서 `overflow-hidden` + 자식 버튼 모양은 5곳인데 **실제로 잘린 것은 이 한 곳뿐**이었다
// (나머지는 안쪽 여백이 있어 링이 그 안에 들어간다). 그러니 그 모양을 전부 막는 가드는
// 오탐 4건이 된다(헌장 §M11) — 잘린다는 것이 확인된 이 자리만 고정한다.
// **이 가드가 확인하지 못하는 것**: 다른 화면에 같은 모양이 새로 생기는 것. 그건 기하학이라
// 소스 글자로는 판정할 수 없고, 브라우저로 재야 한다(재는 법은 이 주석 위 문단 그대로다).
test('세그먼트 버튼의 포커스 링이 `overflow-hidden` 에 잘리지 않는다', () => {
  const SRC = 읽기('src/components/admin/sections/WeeklySchedule.jsx')

  // 긍정 앵커 셋 — 감시할 대상이 아직 이 파일에 있다.
  assert.match(SRC, /const VIEWS = \[/, 'VIEWS 가 사라졌다 — 이 가드를 옮길 것')
  const 상자줄 = SRC.split(/\r?\n/).findIndex((l) => /overflow-hidden/.test(l) && /<div/.test(l))
  assert.notEqual(상자줄, -1, '세그먼트를 감싼 overflow-hidden 상자가 사라졌다 — 이 가드를 옮길 것')

  // 그 상자의 자식 줄만 잘라 본다. 줄끝은 가리지 않는다(검수 사본은 CRLF 다).
  const 줄 = SRC.split(/\r?\n/)
  const 들여 = 줄[상자줄].search(/\S/)
  const 자식 = []
  for (let j = 상자줄 + 1; j < 줄.length; j++) {
    const d = 줄[j].search(/\S/)
    if (d >= 0 && d <= 들여 && /^\s*<\//.test(줄[j])) break
    자식.push(줄[j])
  }
  // 여는 꼬리표를 `>` 로 끊으면 `onClick={() =>` 의 화살표에서 멈춘다(실제로 걸렸다).
  // `</button>` 까지를 한 조각으로 본다.
  const 버튼들 = 자식.join('\n').split('<button').slice(1)
    .map((조각) => 조각.slice(0, 조각.indexOf('</button>') + 1 || undefined))
  assert.ok(버튼들.length >= 1,
    '상자 안에 버튼이 없다 — 세그먼트가 다른 모양으로 바뀌었으면 이 가드를 고칠 것')

  for (const b of 버튼들) {
    assert.match(b, /focus-visible:\[outline-offset:-\d+px\]/,
      `이 버튼의 포커스 링이 상자에 잘린다 — 링을 안쪽에 그려야 한다: ${b.slice(0, 70)}`)
  }
})

test('색은 한 곳에서만 정한다 — 하드코딩한 색으로 갈라지지 않는다', () => {
  const 블록 = UX42블록()
  assert.doesNotMatch(블록, /#[0-9a-fA-F]{6}/,
    '포커스 색을 hex 로 박았다 — tailwind.config.js 와 갈린다')
  assert.match(블록, /theme\('colors\.cc\.primary'\)/, '테마 색을 안 쓴다')
})
