// ISSUE-011 — 주간표가 모르는 방송 유형을 만나면 화면이 통째로 죽는다
//
// 실제로 겪었다(2026-09-07 운영자 신고): 관리자 → 주간방송일정및예약이 **빈 화면**이 됐고,
// 콘솔에 `Uncaught TypeError: Cannot read properties of undefined (reading 'Icon')`.
//
// 원인: `WeeklySchedule.jsx` 의 `TYPE_STYLE` 에 text·bgm·audio·chime·auto 다섯만 있는데
// DB 에 `broadcast_type='flow'` 인 예약이 있었다. `TYPE_STYLE['flow']` 가 undefined 이고,
// 바로 다음 줄이 `style.Icon` 을 옵셔널 체이닝 없이 읽는다 → 렌더 전체가 무너진다.
// (같은 파일 아래쪽 `TYPE_STYLE[t]?.dot` 에는 `?.` 가 있다 — 한 곳만 빠져 있었다.)
//
// **데이터가 아니라 코드의 문제다.** 흐름(flow) 예약은 예약방송관리에서 정상으로 만들 수 있고,
// 서버도 7종을 인정한다(`domain/ontology.js:209` KNOWN_BROADCAST_TYPES). 화면만 4종을 알았다.
//
// 이 테스트는 프런트 렌더 러너가 없는 이 저장소에서 **소스 대조**로 두 가지를 고정한다:
//   ① 서버가 인정하는 유형이 전부 TYPE_STYLE 에 있다 (목록이 갈리면 빨간불)
//   ② 그래도 모르는 유형이 오면 화면이 죽지 않는다 (옵셔널 체이닝 + 기본값)
// ①만 있으면 새 유형이 생길 때 또 터진다. ②만 있으면 아이콘이 조용히 기본값으로 뭉개진다.
'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const WEEKLY = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx')
const ONTOLOGY = path.join(__dirname, '..', 'domain', 'ontology.js')

function 서버가아는유형() {
  const src = fs.readFileSync(ONTOLOGY, 'utf8')
  const m = /const KNOWN_BROADCAST_TYPES = \[([^\]]+)\]/.exec(src)
  assert.ok(m, '전제: ontology.js 에 KNOWN_BROADCAST_TYPES 가 있어야 한다')
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

function 화면이아는유형() {
  const src = fs.readFileSync(WEEKLY, 'utf8')
  const i = src.indexOf('const TYPE_STYLE = {')
  assert.ok(i >= 0, '전제: WeeklySchedule.jsx 에 TYPE_STYLE 이 있어야 한다')
  const block = src.slice(i, src.indexOf('\n}', i))
  return [...block.matchAll(/^\s*'?([\w-]+)'?:\s*\{/gm)].map((m) => m[1])
}

test('ISSUE-011: 서버가 인정하는 방송 유형이 전부 주간표 TYPE_STYLE 에 있다', () => {
  const 서버 = 서버가아는유형()
  const 화면 = 화면이아는유형()
  const 빠진것 = 서버.filter((t) => !화면.includes(t))
  assert.deepEqual(빠진것, [],
    `주간표가 모르는 유형이 있다: ${빠진것.join(', ')} — 그 예약이 하나만 있어도 화면이 빈 화면이 된다`)
})

// **2026-09-13 — 가드가 코드를 따라 옮겨 왔다.** 유형 조회가 칩 안에 있던 것을
// `chipStyle(item, v3)` 한 함수로 뺐다(통합 홈 캘린더가 색 셋으로 접기 위해서).
// 옮기는 순간 옛 가드("`const style =` 줄에 기본값이 있나")는 **대상을 잃는다** —
// 실제로 그 자리에서 빨간불이 났고, 이 커밋에서 같이 옮긴다(CLAUDE.md "가드는 따라 옮긴다").
// 옮기면서 **넓혔다**: 색을 덮어쓰는 v3 쪽이 아이콘·이름을 지우지 않는지도 본다.
test('ISSUE-011: 모르는 유형이 와도 화면이 죽지 않는다 — style.Icon 을 무방비로 읽지 않는다', () => {
  const src = fs.readFileSync(WEEKLY, 'utf8')
  const 줄 = src.split('\n').filter((l) => /TYPE_STYLE\[/.test(l))
  assert.ok(줄.length >= 1, '전제: TYPE_STYLE 을 인덱싱하는 줄이 있어야 한다')

  // ── 유형 조회는 한 곳에서만 한다. 그 한 곳이 기본값을 갖는다 ──────────────
  const i = src.indexOf('function chipStyle(')
  assert.ok(i >= 0,
    '칩 색을 정하는 chipStyle 이 없다 — 이름이 바뀌었으면 이 가드도 같이 옮긴다')
  const 본문 = src.slice(i, src.indexOf('\n}', i))

  // **TYPE_STYLE 조회 결과 자체**에 기본값을 둬야 한다.
  // 주의: `item.broadcast_type || 'text'` 의 `||` 는 **인덱스**의 기본값이라 여기 해당하지 않는다.
  // 처음 이 테스트를 쓸 때 그 `||` 에 정규식이 걸려 **거짓 통과**했다(2026-09-07) — 닫는 대괄호
  // 뒤에 기본값이 오는지를 본다.
  const 조회줄 = 본문.split('\n').filter((l) => /TYPE_STYLE\[/.test(l))
  assert.equal(조회줄.length, 1, `chipStyle 안에서 유형을 조회하는 줄이 하나여야 한다. 실제 ${조회줄.length}`)
  assert.match(조회줄[0], /\]\s*(\?\?|\|\|)/,
    `TYPE_STYLE[...] 결과에 기본값이 없다 — 모르는 유형이면 undefined 가 되고 .Icon 에서 화면이 죽는다: ${조회줄[0].trim()}`)

  // chipStyle 밖에도 조회가 있을 수 있다(범례는 제 열쇠로 돈다). 다만 **거기도 기본값을
  // 챙겨야 한다** — "이 조회는 안전하다"는 예외를 하나 허락하면 다음 조회가 그 예외로
  // 들어오고, 그것이 ISSUE-011 이 났던 경로다(한 곳만 `?.` 가 빠져 있었다).
  const 무방비조회 = src.split('\n')
    .filter((l) => /TYPE_STYLE\[/.test(l) && !본문.includes(l))
    .filter((l) => !/TYPE_STYLE\[[^\]]*\]\s*(\?\.|\?\?|\|\|)/.test(l))
  assert.deepEqual(무방비조회.map((l) => l.trim()), [],
    'chipStyle 밖에서 TYPE_STYLE 을 기본값 없이 조회한다 — `?.` 나 `??` 를 붙인다')

  // ── 색을 덮어써도 아이콘·이름은 남는다 ─────────────────────────────────
  // v3 는 색 셋으로 접으려고 base 위에 덮어쓴다. 그 덮개가 `Icon`·`label` 을 들고 있으면
  // 모르는 유형에서 아이콘이 `undefined` 가 되어 **같은 방식으로 화면이 죽는다.**
  const j = src.indexOf('const V3_KIND_STYLE = {')
  if (j >= 0) {
    const 덮개 = src.slice(j, src.indexOf('\n}', j))
    assert.ok(!/\bIcon\s*:/.test(덮개), 'V3_KIND_STYLE 이 Icon 을 덮어쓴다 — 색만 갈라야 한다')
    assert.ok(!/\blabel\s*:/.test(덮개), 'V3_KIND_STYLE 이 label 을 덮어쓴다 — 색만 갈라야 한다')
    assert.match(본문, /\{\s*\.\.\.base\s*,/,
      'v3 가 base 를 펼쳐 얹지 않는다 — 아이콘·이름을 통째로 잃는다')
  }

  // `style.Icon` 을 물음표 없이 읽는 곳이 하나도 없어야 한다.
  const 무방비 = src.split('\n').filter((l) => /(?<!\?)\bstyle\.Icon/.test(l))
  assert.deepEqual(무방비, [],
    `style.Icon 을 무방비로 읽는다 — TYPE_STYLE 에 없는 유형에서 렌더가 무너진다: ${무방비.map((l) => l.trim()).join(' / ')}`)
})
