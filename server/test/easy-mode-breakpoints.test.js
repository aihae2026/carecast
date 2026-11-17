// 쉬운화면의 중단점 어휘가 한 벌이다 (2026-09-04).
//
// 이 저장소는 Tailwind 기본(sm 640 · md 768 · lg 1024)과 캔버스가 정한 사다리
// (tablet 834 · laptop 1024 · wide 1440)를 **둘 다** 갖고 있다. 둘이 섞이면 어느 폭에서
// 무엇이 바뀌는지 아무도 못 읽는다 — SimpleMode는 처음부터 새 어휘만 쓰게 막아 뒀고
// (simple-mode-responsive.test.js), 쉬운화면은 2026-09-04에 `lg:` 137곳을 `laptop:`으로
// 옮겼다. **1024로 픽셀이 같아서 화면은 한 점도 안 바뀐다**(1024px 블록의 선언 지문이
// 옮기기 전후로 같은 것을 빌드 산출물에서 대조했다).
//
// **`md:`(768)는 남는다. 그리고 남아야 한다.** 그것은 스타일 경계가 아니라 **마운트 경계**다
// (EasyMode.jsx). CSS로만 숨겼더니 YouTubeBGM이 둘 마운트돼 숨은 iframe이 같이 재생되던
// 사고의 처방이라, 중단점 이름을 정리한다는 이유로 여기 손대면 소리가 겹친다.
// 그래서 이 검사는 `lg:`만 막고 `md:`는 건드리지 않는다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const EASY = path.join(ROOT, 'src', 'components', 'easy')
const files = () => [
  ...fs.readdirSync(EASY).filter(f => f.endsWith('.jsx')).map(f => path.join(EASY, f)),
  path.join(ROOT, 'src', 'pages', 'EasyMode.jsx'),
]

test('쉬운화면이 1024 경계를 laptop: 하나로 부른다', () => {
  const hits = []
  for (const p of files()) {
    const src = fs.readFileSync(p, 'utf8')
    // 클래스 접두사만 본다 — 앞이 공백·따옴표·백틱·중괄호인 것
    for (const m of src.matchAll(/(?:^|[\s"'`{])(lg|xl|2xl):/g)) {
      hits.push(`${path.basename(p)}:${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(hits)], [],
    `쉬운화면에 Tailwind 기본 중단점이 남았다(${[...new Set(hits)].join(' ')}) — `
    + '1024는 `laptop:`으로 부른다. 같은 폭을 두 이름으로 부르면 어느 것이 이기는지 '
    + '읽는 사람이 매번 config를 열어야 한다')
})

test('768 마운트 경계는 손대지 않았다', () => {
  const easyMode = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'EasyMode.jsx'), 'utf8')
  assert.match(easyMode, /\bmd:|768/,
    '768 경계가 사라졌다 — 이것은 스타일이 아니라 마운트 경계다. '
    + 'CSS로만 숨기면 YouTubeBGM이 둘 마운트돼 숨은 iframe이 같이 재생된다')
})

test('44px 손가락 표적을 푸는 자리가 폰이 아니라 1024다', () => {
  // `min-w-[44px] ... laptop:min-w-[24px]` 짝이 규칙의 본체다. 44px는 폰에서 손가락이 닿을
  // 크기이고, PC에서는 그것 때문에 배지가 뭉뚝해져서 1024부터 푼다(2026-09-04 e58299b).
  // 푸는 자리를 `tablet:`(834)으로 내리면 태블릿에서 표적이 작아진다.
  //
  // **2026-09-12(UX-42): 푸는 값이 `0` 이 아니라 `[24px]` 다.** 0 으로 풀면 그 자리가
  // 노트북에서 20px 까지 줄어 WCAG 2.2 AA 의 24×24 를 밑돌았다(브라우저 실측).
  // 24 는 "손가락 크기"가 아니라 **바닥**이다 — 44 를 그대로 두면 PC 화면이 헐렁해지고,
  // 0 으로 두면 누를 자리가 사라진다. 이 검사는 그 사이 값을 고정한다.
  let pairs = 0
  for (const p of files()) {
    const src = fs.readFileSync(p, 'utf8')
    pairs += [...src.matchAll(/laptop:min-[wh]-\[24px\]/g)].length
    assert.ok(!/tablet:min-[wh]-(?:0|\[)/.test(src),
      `${path.basename(p)}가 834에서 손가락 표적을 푼다 — 태블릿도 손으로 누른다`)
    assert.ok(!/laptop:min-[wh]-0\b/.test(src),
      `${path.basename(p)}가 노트북에서 표적을 **0으로** 푼다 — 24px 밑으로 내려간다(UX-42)`)
  }
  // 2026-09-21: 외부 동영상 BGM 판(이 지정 61곳을 갖고 있던 파일)을 걷어내 137 → 76 이 됐다.
  // 하한은 「지금 몇 개」가 아니라 **규칙이 통째로 걷히지 않았나**를 본다.
  assert.ok(pairs >= 60,
    `44px를 푸는 지정이 ${pairs}개뿐이다 — 76곳이었다. 규칙이 조용히 걷힌 게 아닌지 볼 것`)
})
