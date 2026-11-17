// 방송화면 하늘 — **언제나 화면을 빈틈없이 덮는다** (사용자 지적 2026-09-14).
//
// ── 증상 ─────────────────────────────────────────────────────────────────────
// 배경에 **사각형 경계**가 보이고, 그것이 *"커졌다 작아져 시선을 방해한다"*.
//
// ── 원인 ─────────────────────────────────────────────────────────────────────
// 배경 레이어가 `absolute inset-0` — **화면과 정확히 같은 크기의 사각형**인데, 거기에
// `cc-drift-b/r` 를 걸었다. 그 박자는 `translate` 와 **`scale` 을 함께** 준다:
//   · `translate(6%, 4%)` → 밀린 **반대편이 비어** 부모 바탕색이 드러난다 → 사각 경계
//   · `scale(.95)`        → 레이어가 **화면보다 작아져** 네 변에 띠가 생긴다
// 홈에서는 같은 박자를 써도 안 보인다 — 거기 방울은 **원형 + 블러 + 화면보다 큰 그릇**이라
// 가장자리가 애초에 화면 밖이다. 기법이 같아도 **그릇 모양이 달라서** 한쪽만 아팠다.
//
// ── 고친 방향 ────────────────────────────────────────────────────────────────
// 둘을 **같이** 한다:
//   ① 방송화면 전용 박자(`cc-sky-a/b`) — `scale` 없이 **위치만**, 폭도 더 좁게
//   ② 그릇을 화면보다 키운다(`-inset-[22%]`) — 어떤 순간에도 가장자리가 화면 밖
// 하나만 하면 안 된다: 키우기만 하면 크기 변화가 남고, `scale` 만 빼면 이동한 쪽이 빈다.
// 홈의 `cc-drift-*` 는 안 건드린다 — 거기서는 그 결이 맞다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT  = path.join(__dirname, '..', '..')
const 읽기  = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CSS = 읽기('src/styles/tokens.css')
const IND = 코드만(읽기('src/components/broadcast/BroadcastIndicators.jsx'))

/**
 * keyframes 한 덩이의 **전문**.
 *
 * ── 2026-09-14 (V③ R7 지적): 앞 판은 **첫 프레임에서 끊겼다** ────────────────────
 * `indexOf('}')` 로 끝을 찾았는데, keyframes 안에는 `0% { ... }` 처럼 **중괄호가 중첩**된다.
 * 그래서 `cc-sky-a` 의 **0% 프레임까지만** 잘렸고, 그 프레임은 `translate(0, 0)` 이라
 * 퍼센트 정규식에 안 걸려 아래 「최대이동」이 `-Infinity` 가 됐다 —
 * **25~100% 에 아무리 큰 이동이나 `scale` 을 넣어도 이 시험이 못 봤다.**
 * 짝이 맞는 중괄호까지 센다.
 */
function 박자(이름) {
  const i = CSS.indexOf(`@keyframes ${이름} {`)
  assert.ok(i > 0, `${이름} 박자를 못 찾았다`)
  const 여는곳 = CSS.indexOf('{', i)
  let 깊이 = 0
  for (let k = 여는곳; k < CSS.length; k++) {
    if (CSS[k] === '{') 깊이++
    else if (CSS[k] === '}') { 깊이--; if (깊이 === 0) return CSS.slice(i, k + 1) }
  }
  assert.fail(`${이름} 박자의 끝을 못 찾았다`)
}

test('긍정 앵커 — 박자를 **끝까지** 읽는다 (첫 프레임에서 안 끊긴다)', () => {
  for (const n of ['cc-sky-a', 'cc-sky-b']) {
    const 본문 = 박자(n)
    // 프레임이 다섯이다(0·25·50·75·100). 하나만 읽히면 아래 검사들이 통째로 헛돈다.
    const 프레임 = [...본문.matchAll(/(\d+)%\s*\{/g)].map(m => Number(m[1]))
    assert.ok(프레임.length >= 4,
      `${n} 에서 프레임을 ${프레임.length}개만 읽었다 — 중괄호 중첩에서 끊겼다`)
    assert.ok(프레임.includes(100), `${n} 의 마지막 프레임(100%)을 못 읽었다`)
  }
})

test('긍정 앵커 — 방송화면 전용 박자가 있다', () => {
  assert.ok(박자('cc-sky-a').length > 40, 'cc-sky-a 가 비었다')
  assert.ok(박자('cc-sky-b').length > 40, 'cc-sky-b 가 비었다')
})

test('그 박자에 **크기 변화가 없다** — 네모가 커졌다 작아지면 안 된다', () => {
  for (const n of ['cc-sky-a', 'cc-sky-b']) {
    assert.doesNotMatch(박자(n), /scale\(/,
      `${n} 이 scale 을 준다 — 레이어가 화면보다 작아지는 순간이 생긴다`)
    assert.match(박자(n), /translate\(/, `${n} 이 아무 움직임도 없다`)
  }
})

test('움직이는 폭보다 **그릇이 넉넉하다** — 어떤 순간에도 가장자리가 화면 밖', () => {
  const i = IND.indexOf('하늘.blobs.map')
  const 블록 = IND.slice(i, i + 700)
  const m = 블록.match(/-inset-\[(\d+)%\]/)
  assert.ok(m, `배경 레이어가 화면과 같은 크기다(inset-0) — 조금만 움직여도 반대편이 빈다`)
  const 여유 = Number(m[1])
  // 박자가 쓰는 가장 큰 이동폭을 실제로 읽어 비교한다 — 숫자를 시험에 박지 않는다
  const 이동값 = ['cc-sky-a', 'cc-sky-b']
    .flatMap(n => [...박자(n).matchAll(/translate\(\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%/g)]
      .flatMap(x => [Math.abs(Number(x[1])), Math.abs(Number(x[2]))]))
  // **먼저 「잴 것이 있었는가」를 본다**(V③ R7). 빈 배열의 `Math.max` 는 `-Infinity` 라
  // 아래 비교가 **무조건 통과**한다 — 아무것도 안 재고 초록이 되는 자리였다.
  assert.ok(이동값.length > 0, '박자에서 이동값을 하나도 못 읽었다 — 이 검사가 헛돈다')
  const 최대이동 = Math.max(...이동값)
  assert.ok(Number.isFinite(최대이동), `최대 이동폭이 수가 아니다(${최대이동})`)
  assert.ok(최대이동 > 0, '이동폭이 전부 0 이다 — 움직이지 않으면서 통과하고 있다')
  assert.ok(여유 > 최대이동,
    `그릇 여유(${여유}%)가 이동폭(${최대이동}%)보다 작거나 같다 — 가장자리가 화면 안으로 들어온다`)
})

test('방송화면이 **제 박자**를 쓴다 — 홈의 것을 안 빌린다', () => {
  assert.match(IND, /cc-sky-a/, '방송화면이 전용 박자를 안 쓴다')
  assert.doesNotMatch(IND, /cc-drift-[br]/,
    '방송화면이 아직 홈의 박자(scale 포함)를 쓴다')
})

test('홈의 박자는 **안 건드렸다** — 거기서는 그 결이 맞다', () => {
  for (const n of ['cc-drift-b', 'cc-drift-r']) {
    assert.match(박자(n), /scale\(/, `${n} 의 결이 바뀌었다 — 홈 배경이 덩달아 달라진다`)
  }
  assert.match(코드만(읽기('src/components/home/HomeShell.jsx')), /cc-drift-[br]/,
    '홈이 제 박자를 잃었다')
})

test('넘친 그릇이 스크롤을 만들지 않는다', () => {
  const i = IND.indexOf('fixed inset-0 z-[9999]')
  assert.ok(i > 0, '방송화면 뿌리를 못 찾았다')
  assert.match(IND.slice(i, i + 300), /overflow-hidden/,
    '화면보다 큰 레이어가 잘리지 않는다 — 스크롤바가 생긴다')
})

test('움직임 줄이기 설정에서는 서 있다', () => {
  const i = IND.indexOf('하늘.blobs.map')
  assert.match(IND.slice(i, i + 700), /motion-safe:animate-\[cc-sky/,
    '움직임을 줄이도록 설정한 기기에서도 배경이 움직인다')
})

test('무거운 필터를 안 들인다 — 현장 PC 는 내장 그래픽이다', () => {
  const i = IND.indexOf('하늘.blobs.map')
  assert.doesNotMatch(IND.slice(i, i + 700), /blur\(/,
    '배경에 blur 를 걸었다 — 하루 종일 켜 두는 화면이다')
})
