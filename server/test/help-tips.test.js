// 쉬운 화면 도움말(ⓘ) — 문구 사전과 화면이 어긋나지 않게 고정한다.
//
// 사용자 요청(2026-08-31): "마우스 갖다 대면 설명 나오는 것, 다들 어떤 기능이고 어떻게
// 쓰는지 짧게 안내해 달라."
//
// 여기서 지키는 것 셋:
//
// 1) **오타 하나면 도움말이 통째로 사라진다.** 화면은 id로 문구를 꺼내 쓴다. 이름이 어긋나면
//    아무 말풍선도 안 뜨는데, 화면은 멀쩡해 보여서 아무도 모른다. 양방향으로 대조한다.
//
// 2) **도움말을 누르다 방송이 나가면 안 된다.** 즐겨찾기·차임벨은 확인 창 없이 바로 홀에
//    소리가 나는 카드다. ⓘ가 클릭을 흘려보내면 그게 실제 방송 사고가 된다.
//
// 3) **문구는 한 벌만 있어야 한다.** 사본이 생기면 한쪽만 고쳐져 화면마다 다른 설명이 뜬다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

const helpSrc = read('src', 'lib', 'helpText.js')
const tipSrc  = read('src', 'components', 'shared', 'HelpTip.jsx')

// 사전에 정의된 이름들
const defined = [...helpSrc.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*\{/gm)].map(m => m[1])

// 화면에서 부르는 이름들. 두 가지 형태가 있다:
//   <HelpTip id="volumePanel" />        — 카드 제목 옆
//   { label: '마스터', ..., help: 'volMaster' }  — 음량 슬라이더는 표에서 이름을 준다
function usedIds() {
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.jsx?$/.test(e.name)) files.push(p)
    }
  }
  walk('src')
  const ids = new Set()
  for (const f of files) {
    const s = read(...f.split('/'))
    for (const m of s.matchAll(/<HelpTip[^>]*\bid="([A-Za-z0-9]+)"/g)) ids.add(m[1])
    for (const m of s.matchAll(/\bhelp:\s*'([A-Za-z0-9]+)'/g))          ids.add(m[1])
  }
  return ids
}

// 한 항목의 본문만 잘라 온다. 항목은 한 줄짜리(음량 7개)와 여러 줄짜리가 섞여 있어서
// 닫는 괄호로 찾으면 한쪽을 놓친다 — 다음 항목이 시작되기 전까지를 본다.
function entryOf(id) {
  // 음량 7줄은 보기 좋으라고 이름과 여는 괄호 사이를 띄워 맞춰 놨다 — 정규식으로 찾는다
  const start = helpSrc.search(new RegExp(`\\n\\s{2}${id}:\\s*\\{`))
  assert.notEqual(start, -1, `${id} 문구가 사전에 없다`)
  const rest = helpSrc.slice(start + 4)
  const next = rest.search(/\n\s{2}[A-Za-z][A-Za-z0-9]*:\s*\{/)
  return next === -1 ? rest : rest.slice(0, next)
}

test('화면이 부르는 도움말 이름이 사전에 전부 있다 — 오타면 말풍선이 조용히 사라진다', () => {
  const missing = [...usedIds()].filter(id => !defined.includes(id))
  assert.deepEqual(missing, [], `helpText.js에 없는 이름을 화면이 부른다: ${missing.join(', ')}`)
})

test('사전에 있는 문구는 전부 화면 어딘가에서 쓰인다 — 죽은 문구를 남기지 않는다', () => {
  const used = usedIds()
  const unused = defined.filter(id => !used.has(id))
  assert.deepEqual(unused, [], `아무도 안 쓰는 도움말 문구가 있다: ${unused.join(', ')}`)
})

test('모든 문구에 제목과 설명이 있다', () => {
  for (const id of defined) {
    const body = entryOf(id)
    assert.ok(/title:\s*'[^']+'/.test(body), `${id}에 title이 없다`)
    assert.ok(/body:\s*'[^']{10,}'/.test(body), `${id}의 설명이 없거나 너무 짧다`)
  }
})

test('누르면 바로 방송이 나가는 카드는 그 사실을 경고로 적는다', () => {
  // 즐겨찾기·차임벨·즉시방송은 확인 창이 없다. 도움말이 "눌러도 되는 것"처럼 읽히면 안 된다.
  for (const id of ['favorites', 'chime', 'instantBroadcast']) {
    const body = entryOf(id)
    assert.ok(/warn:\s*'[^']+'/.test(body),
      `${id} 문구에 경고가 없다 — 이 카드는 누르는 즉시 홀에 소리가 난다`)
  }
})

test('도움말 클릭이 카드 버튼으로 새어 나가지 않는다', () => {
  assert.ok(tipSrc.includes('stopPropagation'),
    '클릭이 카드로 전파되면 도움말을 누르다 실제 방송이 나간다')
  assert.ok(tipSrc.includes('preventDefault'), '기본 동작을 막지 않으면 링크·폼이 함께 반응한다')
  assert.ok(tipSrc.includes('type="button"'),
    'type이 없으면 폼 안에서 submit으로 동작한다')
})

test('터치 화면에서도 열린다 — hover만으로는 손가락으로 못 연다', () => {
  assert.ok(tipSrc.includes('onClick'),  '현장 PC가 터치면 마우스 오버가 일어나지 않는다')
  assert.ok(tipSrc.includes('onMouseEnter'), '마우스에서는 올리기만 해도 떠야 한다')
  assert.ok(tipSrc.includes('Escape'), '키보드로 닫을 수 없다')
})

test('문구 사전은 한 벌이다', () => {
  assert.equal(
    [...tipSrc.matchAll(/from '\.\.\/\.\.\/lib\/helpText'/g)].length, 1,
    'HelpTip이 문구를 사전에서 안 가져온다')
  assert.ok(!/HELP_TEXT\s*=/.test(tipSrc), '말풍선 안에 문구 사본이 생겼다')
})
