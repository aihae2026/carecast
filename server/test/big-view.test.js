'use strict'
// **크게 보기 — 화면 전체를 통째로 키운다** (사용자 지시 2026-09-15).
//
// *"전반적으로 나이대가 높다보니까, 노안이 많아. 그래서 노인들을 위한 큰화면보기도
//   하나 만들어주면 좋겠네(전반적으로 다 글씨체 커지는거, 확대경처럼)."*
//
// 글씨만 키우면 칸은 그대로라 글자가 넘치고 줄이 어긋난다 — 이 저장소가 이미 여러 번
// 겪은 모양이다. 그래서 `zoom` 으로 화면 전체를 확대한다(돋보기와 같다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 다음배율, 정리, 먹이기, 읽기, 저장, 이름, 배율들, 저장키 } = require('../../src/lib/bigView.js')

test('**한 단추로 세 칸을 돈다** — 끝에서 처음으로', () => {
  assert.deepEqual(배율들, [1, 1.25, 1.5])
  assert.equal(다음배율(1), 1.25)
  assert.equal(다음배율(1.25), 1.5)
  assert.equal(다음배율(1.5), 1, '끝에서 처음으로 안 돌아온다 — 되돌릴 길이 없어진다')
})

test('**모르는 값은 원래 크기다**', () => {
  // 저장소가 이상한 값을 들고 있어도(손으로 고쳤거나 옛 판) 화면이 깨지면 안 된다.
  for (const v of [null, undefined, '', 'abc', 0, -1, 99, 1.3, NaN]) {
    assert.equal(정리(v), 1, `${String(v)} 가 배율로 통과했다`)
  }
  assert.equal(정리('1.25'), 1.25, '글자로 저장된 값을 못 읽는다 — localStorage 는 글자만 담는다')
})

test('이름이 셋 다 있다 — 지금 어느 상태인지 **글자로** 말한다', () => {
  // 돋보기 그림만 두면 눌러 보기 전에는 지금이 어느 상태인지 모른다(G-7).
  assert.equal(이름(1), '보통')
  assert.equal(이름(1.25), '크게')
  assert.equal(이름(1.5), '아주 크게')
  assert.equal(이름('모름'), '보통')
})

test('**1 일 때는 흔적을 안 남긴다** — `zoom:1` 만으로도 쌓임 맥락이 생긴다', () => {
  // **CSS 변수도 함께 쓴다**(2026-09-15) — 확대 배율을 CSS 가 읽어야 `vh` 계산을
  // 나눌 수 있다(`zoom-viewport-height.test.js`). 가짜 요소도 그 창구를 갖춘다.
  const 가짜 = { style: {
    zoom: null,
    setProperty() {},
    removeProperty(k) { if (k === 'zoom') this.zoom = null },
  } }
  먹이기(1.5, 가짜)
  assert.equal(가짜.style.zoom, '1.5')
  먹이기(1, 가짜)
  assert.equal(가짜.style.zoom, null,
    'zoom:1 을 남겼다 — 평소에도 fixed 층이 미묘하게 달라진다')
})

test('저장하고 다시 읽는다', () => {
  const 창고 = new Map()
  const 가짜저장소 = {
    getItem: (k) => (창고.has(k) ? 창고.get(k) : null),
    setItem: (k, v) => 창고.set(k, String(v)),
  }
  저장(1.25, 가짜저장소)
  assert.equal(창고.get(저장키), '1.25')
  assert.equal(읽기(가짜저장소), 1.25)
})

test('**저장을 못 해도 안 죽는다** — 사생활 보호 창에서는 막힌다', () => {
  const 터지는저장소 = {
    getItem() { throw new Error('막힘') },
    setItem() { throw new Error('막힘') },
  }
  assert.equal(읽기(터지는저장소), 1, '못 읽으면 원래 크기여야 한다')
  assert.doesNotThrow(() => 저장(1.5, 터지는저장소), '저장 실패가 화면을 깨뜨린다')
})

// ── 화면에 실제로 달려 있는가 ──────────────────────────────────────────────
test('**머리줄에 단추가 있다** — 부품만 만들고 안 달면 소용없다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeShell.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /<BigViewButton\s*\/>/, '크게 보기 단추가 머리줄에 안 달렸다')
})

test('**`transform: scale` 이 아니다** — 그것은 줄바꿈을 다시 안 해서 가로 스크롤이 생긴다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/bigView.js'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /style\.zoom/, 'zoom 을 안 쓴다')
  assert.ok(!/transform\s*=/.test(코드만), 'transform 으로 키운다 — 가로 스크롤이 생긴다')
})

test('**서버에 안 올린다** — 사람마다 눈이 다르고 기기마다 화면이 다르다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/bigView.js'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/fetch\(|apiPost|apiGet/.test(코드만),
    '배율을 서버에 보낸다 — 현장 PC 와 직원 폰이 같은 배율을 쓸 이유가 없다')
})
