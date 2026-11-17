// 방송 화면의 하늘 — 조용히 되돌아가면 안 되는 것들 (2026-09-13).
//
// 정본은 `src/lib/skyPalette.js`. 순수 모듈이라 **여기서 진짜로 돌린다** —
// 소스를 글자로 읽어 흉내내지 않는다(가짜 오라클을 만들지 않기 위해).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n')

let 하늘모듈
test('하늘 모듈을 불러온다', async () => {
  하늘모듈 = await import(pathToFileURL(path.join(ROOT, 'src/lib/skyPalette.js')).href)
  assert.ok(하늘모듈.SKY && 하늘모듈.skyKeyAt, '내보내는 것이 바뀌었다')
})

// ── 색 계산 ────────────────────────────────────────────────────────────────
const 상대밝기 = (hex) => {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test('흰 글자는 **두 겹**으로 그린다 — 흰 속이 깎일 길이 구조적으로 없다', () => {
  // 시험을 **네 번** 잘못 썼다(2026-09-13). 앞의 셋은 "지금 이렇게 돼 있다"를 박아 둔
  // 것이었고, 그때마다 다음 수정을 막고 섰다:
  //   ① "바탕이 어두워야 한다"    → 그걸 지키려다 하늘이 잿빛이 됐다.
  //   ② "바탕+그늘 대비 3.0"      → 아침을 밝게 못 했다.
  //   ③ "검정 획 테두리가 있는가" → 그 테두리가 문제라고 **오진**했다.
  //   ④ "여덟 방향 그림자여야 한다" → ③ 의 오진 위에 세운 시험이다. 진짜 원인은
  //      획이 아니라 **알파 0.6** 이었다 — 반투명 검정이 흰 글자와 섞여 회색 테가 된다.
  //      여덟 방향은 얇을 때만 통하는 흉내라, 두껍게 하자 방향 사이가 벌어져 더 나빠졌다.
  //
  // 그래서 이번엔 **기법이 아니라 보장**을 고정한다. 글자를 두 번 그린다 —
  // 뒤 겹은 테두리만(속 투명), 앞 겹은 순백. 앞 겹이 뒤 겹을 덮으므로 **어떤 두께를
  // 줘도 흰 속이 한 픽셀도 안 깎인다.** 값이 아니라 구조라서 다음 사람이 두께를
  // 바꿔도 안 깨진다.
  const OT = 'src/components/broadcast/OutlinedText.jsx'
  const 부품 = read(OT)
  assert.ok(부품, `${OT} 가 없다 — 옮겼으면 이 가드도 같이 옮긴다`)

  // 뒤 겹: 획을 그리고 **속은 투명**. 투명이 아니면 두 겹이 섞여 회색이 된다.
  assert.match(부품, /WebkitTextStrokeWidth/, '뒤 겹이 획을 안 그린다')
  assert.match(부품, /color: 'transparent'/, '뒤 겹의 속이 투명이 아니다 — 앞 겹과 섞인다')
  // **불투명 검정이어야 한다.** 이것이 처음 회색으로 보인 진짜 원인이다.
  assert.match(부품, /WebkitTextStrokeColor: '#000'/,
    '테두리가 불투명 검정이 아니다 — 반투명이면 흰 글자와 섞여 회색 테가 된다')
  assert.doesNotMatch(부품, /WebkitTextStrokeColor: 'rgba/,
    '테두리에 알파가 돌아왔다 — 2026-09-13 에 회색으로 보이던 바로 그 값이다')
  // 앞 겹: 아무것도 안 얹은 순백.
  assert.match(부품, /<span className="relative" style=\{\{ color \}\}>/,
    '앞 겹이 없거나 뭔가 덧씌웠다 — 앞 겹은 순백이어야 한다')
  assert.match(부품, /color = '#fff'/, '기본 글자색이 순백이 아니다')

  // 두 화면이 **제 손으로 테두리를 그리지 않는다.** 각자 그리면 또 갈린다 —
  // 실제로 같은 `outline()` 헬퍼가 두 파일에 복사돼 있었고, 한쪽만 고치면 어긋났다.
  for (const [파일, 이름] of [
    ['src/components/broadcast/BroadcastIndicators.jsx', '오버레이'],
    ['src/components/broadcast/BroadcastCaption.jsx',    '자막'],
  ]) {
    const code = read(파일)
    assert.match(code, /import OutlinedText from '\.\/OutlinedText'/,
      `${이름} 이 두 겹 부품을 안 쓴다`)
    assert.match(code, /<OutlinedText/, `${이름} 에 실제 사용처가 없다`)
    assert.doesNotMatch(code, /const outline = /,
      `${이름} 에 제 손으로 그리는 테두리 헬퍼가 돌아왔다 — 두 벌이 되면 갈린다`)
    assert.doesNotMatch(code, /WebkitTextStroke/,
      `${이름} 이 획을 직접 준다 — 한 겹짜리라 흰 속이 깎인다. 테두리는 부품에만 둔다`)
  }

  // 글자색을 시간대마다 뒤집지 않는다(사용자 결정: *"먹색하지말고"*).
  assert.doesNotMatch(read('src/components/broadcast/BroadcastIndicators.jsx'),
    /SKY\[[^\]]*\]\.ink|하늘\.ink/, '하늘에 따라 글자색을 뒤집는 갈래가 돌아왔다')
})

test('하늘은 밝다 — 대비를 핑계로 어둡히지 않는다', () => {
  // 위 시험의 **반대 방향**이다. "글자만 읽히면 된다"만 지키면 전부 검정으로 칠해도
  // 만점이라, 그 길을 막는 시험이 따로 있어야 한다.
  // 기준은 사용자 레퍼런스다 — 아침은 아주 옅은 하늘(*"아침은 이렇게 밝아야지"*).
  const L = (k) => 상대밝기(하늘모듈.SKY[k].base)
  assert.ok(L('dawn') >= 0.60, `아침 바탕이 어둡다(밝기 ${L('dawn').toFixed(3)}) — 레퍼런스는 더 옅다`)
  assert.ok(L('day')  >= 0.55, `낮 바탕이 어둡다(밝기 ${L('day').toFixed(3)})`)
  assert.ok(L('dusk') >= 0.22, `석양 바탕이 어둡다(밝기 ${L('dusk').toFixed(3)})`)
  assert.ok(L('night') < L('dusk'), '밤이 석양보다 밝다')

  // **쉴 때는 그늘이 아예 없다**(사용자 결정 2026-09-13:
  // *"자막 들어오기 전에는 저 밑바탕 검은색 불투명한거 걷어내라고"*).
  // 여섯 판을 그늘로 고치려다 전부 하늘만 탁하게 만들었다 — 대비는 글자가 스스로 낸다.
  assert.equal(하늘모듈.SCRIM, 'none',
    `쉴 때 그늘이 남아 있다(${하늘모듈.SCRIM}) — 하늘이 탁해진다`)
})

// ── 2026-09-14: **그늘을 통째로 걷었다** ─────────────────────────────────────
// 예전 이 시험은 *"자막이 나가는 동안에는 그늘이 깊어진다"* 를 고정했다. 사용자 지시로
// 그 층 자체가 없어졌다 — *"아예 시커먼 거 빼버리고 생 그라디언트 위에다가만 올려."*
// 위 ⑦번 기록이 이미 답이었다: **"그늘은 처음부터 할 일이 없었다. 대비는 글자가 스스로
// 낸다."** 「자막만 예외」로 남긴 한 줄이 같은 덫이었고, 화면 전체 → 글자 자리로 좁혀도
// 여전히 칙칙했다(실측 화면으로 확인). 일곱 번째 판을 만들지 않고 없앴다.
//
// 그래서 이 시험이 고정하는 사실도 뒤집힌다 — **그늘이 없다**, 그리고 **대비는 자막이 낸다.**
test('그늘은 없다 — 생 그라디언트 위에 자막만 올린다', () => {
  assert.equal(하늘모듈.SCRIM, 'none', '쉴 때 그늘이 다시 생겼다')
  assert.equal(하늘모듈.SCRIM_CAPTION, 'none',
    '자막 그늘이 다시 생겼다 — 여섯 판을 겪고 내린 결론을 되돌리는 것이다(위 ①~⑦)')

  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.doesNotMatch(code, /SCRIM_CAPTION|backgroundImage: captioning/,
    '화면이 아직 그늘 층을 그린다')
  // 긍정 앵커 — 그래도 하늘은 그린다(층을 통째로 지운 것이 아니다)
  assert.match(code, /blobLayer\(/, '하늘까지 같이 지웠다')
})

test('대비는 **자막이 제 몫으로** 낸다 — 그늘이 없어도 읽혀야 한다', () => {
  const cap = read('src/components/broadcast/BroadcastCaption.jsx')
  assert.match(cap, /OutlinedText/,
    '자막에 테두리가 없다 — 그늘을 걷었으니 글자가 스스로 대비를 내야 한다')
})

test('ON AIR 배지는 자막이 나가는 동안 **비킨다**', () => {
  // 사용자 신고 2026-09-14: *"가끔씩 ON AIR 이것도 자막이 가리더라"*.
  // 기관명·표어는 진작 자리를 내주고 있었는데 이 배지만 안 비켰다.
  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
  const i = code.indexOf('On Air')
  assert.ok(i > 0, 'ON AIR 배지를 못 찾았다')
  const 앞 = code.slice(Math.max(0, i - 400), i)
  assert.match(앞, /opacity: captioning \? 0 : 1/,
    'ON AIR 가 자막 위에 그대로 남아 글자를 가린다')
})

test('일출과 석양은 갈린다 — 화면이 "지금이 언제인가"를 말해야 한다', () => {
  // 실제 하늘은 일출과 석양이 닮았지만, 이 화면이 하는 일은 **하루의 어디쯤인지 알리는
  // 것**이라 닮으면 그 일을 못 한다. 첫 판이 실제로 그랬다(2026-09-13 눈으로 확인).
  // 그래서 둘을 **색온도와 해의 위치 둘 다**로 갈라 뒀다.
  const { dawn, dusk } = 하늘모듈.SKY
  const 붉기 = (hex) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16)  // R - B

  assert.ok(붉기(dusk.base) > 붉기(dawn.base),
    `석양 바탕(${dusk.base})이 일출 바탕(${dawn.base})보다 따뜻하지 않다 — 둘이 안 갈린다`)

  // 해의 위치: 일출은 오른쪽 위, 석양은 왼쪽 아래. **첫 덩어리가 해다.**
  const 해뜸 = dawn.blobs[0], 해짐 = dusk.blobs[0]
  assert.ok(해뜸.x > 50 && 해뜸.y < 50, `일출의 해가 오른쪽 위가 아니다 (${해뜸.x},${해뜸.y})`)
  assert.ok(해짐.x < 50 && 해짐.y > 50, `석양의 해가 왼쪽 아래가 아니다 (${해짐.x},${해짐.y})`)
})

test('시설 일과가 제 마디에 든다', () => {
  const 때 = (h, m) => new Date(2026, 8, 13, h, m)
  // PROJECT_PROFILE §6 의 현장 실제 시각.
  const 표 = [
    [7, 50, 'dawn',  '아침 방송'],
    [9,  0, 'day',   '국민체조'],
    [11, 10, 'day',  '점심 식사 전'],
    [16, 14, 'day',  '저녁 식사 전'],   // 16:30 경계 **직전**이다 — 아직 낮
    [18, 0, 'dusk',  '저녁 마무리'],
    [23, 0, 'night', '심야'],
    [3,  0, 'night', '새벽 3시 — 아직 밤'],
  ]
  for (const [h, m, 기대, 무엇] of 표) {
    assert.equal(하늘모듈.skyKeyAt(때(h, m)), 기대,
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${무엇} 이 ${기대} 가 아니다`)
  }
})

test('마디 경계가 정확히 그 분에 넘어간다', () => {
  const 때 = (h, m) => new Date(2026, 8, 13, h, m)
  // **앞뒤를 같이 본다.** 한쪽만 보면 경계를 통째로 옮겨도 초록불이다.
  for (const [h, m, 앞, 뒤] of [[5, 0, 'night', 'dawn'], [8, 30, 'dawn', 'day'],
                                [16, 30, 'day', 'dusk'], [19, 30, 'dusk', 'night']]) {
    assert.equal(하늘모듈.skyKeyAt(때(h, m - 1)), 앞,  `${h}:${m} 한 분 전이 ${앞} 이 아니다`)
    assert.equal(하늘모듈.skyKeyAt(때(h, m)),     뒤,  `${h}:${m} 이 ${뒤} 가 아니다`)
  }
})

test('무작위가 돌아오지 않았다 — 색은 시각이 정한다', () => {
  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
  // 긍정 앵커: 시각으로 정하는 길을 실제로 쓴다.
  assert.match(code, /skyKeyAt\(\)/, '시각으로 하늘을 안 고른다 — 옮겼으면 이 가드도 같이 옮긴다')
  assert.match(code, /from '\.\.\/\.\.\/lib\/skyPalette'/, '단일 출처를 안 쓴다')
  // 부정: 같은 시각에 볼 때마다 다른 색이 되면 화면이 아무 말도 못 한다.
  assert.doesNotMatch(code, /Math\.random\(\)/,
    '방송 화면이 다시 무작위로 색을 고른다 — 홀에 하루 종일 켜져 있는 화면이다')
  assert.doesNotMatch(code, /OVERLAY_GRADIENTS/, '옛 사탕색 표가 돌아왔다')
})

test('화면을 덮는 층에 blur 필터를 걸지 않는다 — 현장 PC 는 내장 그래픽이다', () => {
  // **주석을 먼저 걷는다.** 안 걷었더니 이 규칙을 설명하는 주석("`filter: blur()` 를 쓰지
  // 않는다")을 위반으로 읽고 빨간불이 났다(2026-09-13). 오늘 두 번째다 — 규칙을 적은 글이
  // 규칙을 검사하는 코드를 속인다.
  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  // 긍정 앵커: 구름을 radial-gradient 로 그린다(그 자체가 번짐이라 필터가 필요 없다).
  assert.match(code, /blobLayer\(/, '구름을 안 그린다')

  // **보는 범위를 좁힌다.** 처음엔 파일 전체에서 `backdrop-blur` 를 막았는데, 그러면
  // 방송 종류 배지의 작은 알약(`backdrop-blur-sm`, 원래 있던 것)까지 걸린다.
  // 비싼 것은 **화면 전체를 덮는 층**이지 알약 하나가 아니다.
  //
  // 덮는 층은 `inset-0` 으로 알아본다. 따옴표 덩어리로 잡으려 했더니 구름은 템플릿
  // 리터럴(`className={'... ' + ...}`)이라 안 잡혔다 — **줄 단위로 본다.**
  // **`-inset-[22%]` 도 덮는 층이다**(2026-09-14). 하늘 레이어를 화면보다 크게 키우면서
  // `inset-0` 만 세던 기준이 그것을 놓쳤다. 세는 규칙을 넓힌다 — 화면을 덮는 것은
  // `inset-0` 이든 그보다 큰 것이든 마찬가지로 비싸다.
  const 덮는층 = code.split(/\r?\n/).filter(L => /-?\binset-(0\b|\[)/.test(L))
  assert.ok(덮는층.length >= 2, `화면을 덮는 층을 못 찾았다(${덮는층.length}개) — 구조가 바뀌었나`)
  for (const 층 of 덮는층) {
    assert.doesNotMatch(층, /backdrop-blur|blur-\[/,
      `화면을 덮는 층에 blur 가 들어왔다 — 하루 종일 켜지는 전체화면이라 비싸다: ${층.slice(0, 80)}`)
  }
  // 인라인 `filter: blur(...)` 도 같이 막는다(클래스가 아니라 style 로 넣는 길).
  assert.doesNotMatch(code, /filter:\s*['"`]?blur\(/,
    '방송 화면에 인라인 blur 필터가 들어왔다')
})

test('떠 있는 손잡이에 넷째 색을 쓰지 않는다', () => {
  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
  const i = code.indexOf('if (!show) return')
  assert.ok(i > 0, '손잡이를 못 찾았다 — 옮겼으면 이 가드도 같이 옮긴다')
  const 손잡이 = code.slice(i, i + 700)
  assert.match(손잡이, /bg-ds-v3-ink/, '손잡이가 잉크가 아니다')
  assert.doesNotMatch(손잡이, /bg-orange-|bg-cc-orange/,
    '손잡이가 다시 주황이 됐다 — 제품의 색 셋 어디에도 없는 넷째 색이다')
})

test('하단 「방송 중」 줄이 하늘을 가로로 자르지 않는다', () => {
  // 가운데 그늘을 걷은 것과 **같은 종류**다(사용자 지적 2026-09-13).
  // `bg-black/15 + backdrop-blur` 로 된 띠가 밝은 하늘을 가로로 잘라, 회색 막대가
  // 하나 얹힌 것처럼 보였다.
  //
  // **이 시험은 한 번 틀린 것을 지키고 있었다**(2026-09-13 정정). 띠를 걷은 뒤
  // 「아래로 스며드는 그늘」(`linear-gradient(to top, #00000038, …)`)로 바꾸고
  // 그 문자열을 **그대로 박아** 뒀는데, 그늘 자체가 옅은 아침 하늘 위에서 여전히
  // 화면 아래쪽을 잿빛으로 띄웠다. 걷으려 하자 **이 시험이 빨간불을 냈다** —
  // 고쳐야 할 것을 시험이 막고 서 있었다(같은 일이 이 작업에서 세 번째다).
  //
  // 그래서 **값이 아니라 뜻을 고정한다**: 하단 줄은 *제 배경을 그리지 않는다.*
  // 글자는 제목과 같은 두 겹 테두리(`OutlinedText`)로 제 힘에 선다.
  const code = read('src/components/broadcast/BroadcastIndicators.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const i = code.indexOf('absolute bottom-0 left-0 right-0')
  assert.ok(i > 0, '하단 줄을 못 찾았다 — 옮겼으면 이 가드도 같이 옮긴다')
  const 줄 = code.slice(i, i + 400)
  assert.doesNotMatch(줄, /bg-black\/\d/, '하단에 불투명 띠가 돌아왔다 — 하늘이 잘린다')
  assert.doesNotMatch(줄, /backdrop-blur/,
    '하단에 blur 가 돌아왔다 — 화면 가로폭 전체에 하루 종일 걸리는 필터다')
  assert.doesNotMatch(줄, /backgroundImage|linear-gradient|bg-gradient/,
    '하단 줄이 다시 제 배경을 그린다 — 옅은 하늘에서 아래쪽이 잿빛으로 뜬다')

  // 배경을 안 깔았으면 **글자가 스스로 서야 한다.** 이 앵커가 없으면 위 부정 단언들은
  // "하단 줄을 통째로 지워도 통과"한다 — 조용한 초록이 된다.
  assert.match(줄, /<OutlinedText[\s\S]*방송 중/,
    '하단 글자가 두 겹 테두리를 안 쓴다 — 배경도 없고 테두리도 없으면 하늘에 묻힌다')
})
