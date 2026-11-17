'use strict'
// **캘린더 쪽지 자리 계산 — 숫자를 넣어 본다** (2026-09-18).
//
// 앞 판의 시험(`evening-fixes-0918.test.js` ①)은 소스 글자만 봐서, 독립 QA 가 계산을 망가뜨리는 변이를
// 넣어도 초록이었다(예: 오른쪽 접기 조건을 `> vw * z` 로 → 통과). 그래서 계산을 순수 함수
// (`src/lib/popupPlace.js`)로 떼어 내고 **그려질 자리를 직접 셈한다.**
//
// 「그려질 자리」 = 돌려준 값 × 배율. `position:fixed` 의 px 은 `<html>` 의 `zoom` 만큼 커져서 그려진다
// (Chrome 실측 — 1.25배에서 style `left:1337px` 가 화면 1671px 에 그려졌다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
// ESM 파일을 그대로 돌린다 — 이 저장소의 다른 시험(setup-wizard-laptop)과 같은 방식.
const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'popupPlace.js'), 'utf8').replace(/^export /gm, '')
const { 쪽지자리 } = new Function(`${src}; return { 쪽지자리 }`)()

// 돌려준 값으로 **화면에 그려질** 사각형을 셈한다.
function 그려진(r, z, height) {
  const 높이 = Math.min(height, r.최대높이)
  const top = r.top !== undefined ? r.top : null
  const bottom = r.bottom !== undefined ? r.bottom : null
  return {
    left: r.left * z, right: (r.left + r.폭) * z,
    top: top !== null ? top * z : null,
    bottomEdge: top !== null ? (top + 높이) * z : null,
    // `bottom` 은 창 아래에서 잰 거리다
    bottomFromEdge: bottom !== null ? bottom * z : null,
    높이,
  }
}

const 창들 = [[1689, 945], [1440, 900], [1366, 768], [1024, 768], [834, 1112]]
const 배율들 = [1, 1.25, 1.5]

test('어느 창·배율에서 어디를 눌러도 **오른쪽·왼쪽으로 안 넘친다**', () => {
  let 본 = 0
  for (const [vw, vh] of 창들) for (const z of 배율들) for (const fx of [0.02, 0.5, 0.98]) {
    const r = 쪽지자리({ anchor: { x: vw * fx, y: vh * 0.3 }, width: 360, height: 390, vw, vh, z })
    const g = 그려진(r, z, 390)
    assert.ok(g.right <= vw + 0.5, `창 ${vw} · ${z}배 · x=${Math.round(vw * fx)}: 오른쪽으로 ${Math.round(g.right - vw)}px 넘친다`)
    assert.ok(g.left >= 0, `창 ${vw} · ${z}배: 왼쪽으로 넘친다`)
    본++
  }
  assert.equal(본, 창들.length * 배율들.length * 3)
})

test('실측 사고 그대로 — 1.25배 · 창 1689 · 오른쪽 끝을 눌러도 화면 안이다(고치기 전 407px 넘침)', () => {
  const r = 쪽지자리({ anchor: { x: 1683, y: 300 }, width: 340, height: 300, vw: 1689, vh: 945, z: 1.25 })
  const g = 그려진(r, 1.25, 300)
  assert.ok(g.right <= 1689, `오른쪽 끝이 ${Math.round(g.right)} — 창 밖이다`)
})

test('**「저장」이 숨지 않는다** — 쪽지 전체 높이가 창 안에 든다(작은 노트북 1366×768, 크게 보기)', () => {
  // 가운데 줄 날짜를 누른 경우. 앞 판은 위로만 펴서 위쪽 공간(쪽지보다 작음)에 갇혀 「저장」이 스크롤 아래로 숨었다(실측).
  for (const z of [1.25, 1.5]) for (const fy of [0.45, 0.55, 0.65, 0.8]) {
    const vh = 768
    const r = 쪽지자리({ anchor: { x: 600, y: vh * fy }, width: 360, height: 390, vw: 1366, vh, z })
    assert.ok(r.최대높이 >= 390, `${z}배 · y=${Math.round(vh * fy)}: 쪽지가 ${Math.round(r.최대높이)}px 에 갇힌다 — 「저장」이 숨는다`)
    const g = 그려진(r, z, 390)
    if (g.top !== null) {
      assert.ok(g.top >= 0 && g.bottomEdge <= vh + 0.5, `${z}배: 쪽지가 창 위아래로 넘친다(${Math.round(g.top)}..${Math.round(g.bottomEdge)})`)
    } else {
      // 위로 편 경우: 아랫변이 창 안이고, 위쪽으로 쪽지 높이만큼 들어갈 자리가 있다
      assert.ok(g.bottomFromEdge >= 0, `${z}배: 아래로 넘친다`)
      assert.ok(vh - g.bottomFromEdge - 390 * z >= -0.5, `${z}배: 위로 편 쪽지가 창 위로 넘친다`)
    }
  }
})

test('창이 넉넉하면 **누른 자리 옆**에 뜬다 — 가운데로 날아가지 않는다', () => {
  const r = 쪽지자리({ anchor: { x: 200, y: 200 }, width: 360, height: 390, vw: 1920, vh: 1080, z: 1 })
  assert.equal(r.left, 208, '누른 자리 오른쪽 8px 에 붙어야 한다')
  assert.equal(r.top, 208, '누른 자리 아래 8px 에 붙어야 한다')
  // 아래 절반을 누르면 위로 편다(2026-09-15 결정) — 공간이 넉넉할 때
  const 아래 = 쪽지자리({ anchor: { x: 200, y: 900 }, width: 360, height: 390, vw: 1920, vh: 1080, z: 1 })
  assert.ok(아래.bottom !== undefined && 아래.top === undefined, '아래쪽을 누르면 위로 펴야 한다')
})

test('좁은 창에서는 쪽지 폭을 창에 맞춰 줄인다 — 어디에 놓아도 잘리는 일이 없게', () => {
  const r = 쪽지자리({ anchor: { x: 300, y: 200 }, width: 360, height: 390, vw: 320, vh: 640, z: 1 })
  assert.ok(r.폭 <= 320 - 24, `폭 ${r.폭} 이 창(320)보다 넓다`)
  assert.ok(r.left + r.폭 <= 320, '오른쪽으로 넘친다')
})

test('배율 1 은 예전 계산과 같다 — 보통 화면을 쓰던 사람에게 달라지는 것이 없다', () => {
  // 예전 판: left = x + 8, 넘치면 vw - width - pad
  const r = 쪽지자리({ anchor: { x: 1677, y: 300 }, width: 360, height: 390, vw: 1689, vh: 945, z: 1 })
  assert.equal(r.left, 1689 - 360 - 12)
  assert.equal(r.폭, 360)
})

// ── 배율을 읽는 쪽 — `먹은배율()` 도 숫자로 본다 ───────────────────────────────
test('먹은배율() 은 <html> 에 **실제로 먹은** zoom 을 읽는다 — 못 읽거나 이상하면 1', () => {
  const bv = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'bigView.js'), 'utf8')
  const i = bv.indexOf('export function 먹은배율()')
  assert.ok(i > 0, '긍정 앵커 — 먹은배율 이 있다')
  // 줄바꿈이 `\r\n` 인 판도 있다(Windows) — 함수 끝을 두 방식 다 받아 찾는다.
  const 끝 = /\r?\n\}\r?\n/.exec(bv.slice(i))
  assert.ok(끝, '긍정 앵커 — 함수 끝을 찾았다')
  const 몸 = bv.slice(i, i + 끝.index + 끝[0].length).replace(/^export /, '')
  const 만들기 = (zoom) => new Function('getComputedStyle', 'document', `${몸}; return 먹은배율()`)(
    () => ({ zoom }), { documentElement: {} })
  assert.equal(만들기('1.25'), 1.25, '1.25배를 못 읽는다 — 쪽지가 다시 화면 밖으로 나간다')
  assert.equal(만들기('1.5'), 1.5)
  assert.equal(만들기('normal'), 1, '「normal」은 1 이어야 한다')
  assert.equal(만들기(undefined), 1, 'zoom 을 모르는 브라우저는 1 이어야 한다')
  assert.equal(만들기('0'), 1, '0 배는 없다')
})
