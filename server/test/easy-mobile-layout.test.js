// 폰에서 여는 화면 (고도화 제안 #27, 2026-09-03).
//
// 선생님이 실제로 폰으로 연다. 쉬운 화면에는 전용 모바일 레이아웃이 이미 있지만
// (EasyMode의 isDesktop 분기), **그 안의 부품들에는 좁은 화면 대비가 거의 없었다** —
// 컴포넌트 15개 중 줄바꿈이 걸린 것이 2개뿐이었고, 그 둘도 오늘 #25에서 넣은 것이다.
// 특히 (당시의) 외부 동영상 BGM 판은 가로 배치 25곳에 줄바꿈 0이었다(2026-09-21 걷어냄).
// 오늘 버튼을 44px로 키운 것(#24)이 이 줄들을 더 밀었다.
//
// 고친 방식은 **줄바꿈**이다. 줄바꿈은 넘침을 만들지 않고 줄만 늘린다 —
// 폰은 세로 스크롤이 정상이고, 가로 스크롤은 사용자가 못 쓴다고 못 박은 것이다.
//
// 고정하는 사실 넷:
//  1. 폰 전용 레이아웃이 있다(데스크톱 3열이 그대로 폰에 나오지 않는다)
//  2. 화면 크기 메타(viewport)가 있다 — 없으면 폰이 980px 가상 화면으로 그린다
//  3. 버튼이 여럿 든 가로 배치는 줄을 바꾼다
//  4. **작은 배지(span)에는 줄바꿈을 걸지 않는다** — 시각 칩이 두 줄로 깨진다
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

const EASY_DIR = path.join(ROOT, 'src', 'components', 'easy')
const easyFiles = () => fs.readdirSync(EASY_DIR).filter(f => f.endsWith('.jsx'))

test('사실1 — 폰 전용 레이아웃이 있다', () => {
  const src = read('src', 'pages', 'EasyMode.jsx')
  assert.match(src, /function MobileLayout/, '폰에서도 데스크톱 3열이 그대로 나온다')
  assert.match(src, /isDesktop[\s\S]{0,80}MobileLayout/, '레이아웃을 고르는 분기가 없다')
  // 데스크톱 3열은 좁으면 1열로 접힌다.
  // 2026-09-04에 이 자리의 이름이 `lg:`에서 `laptop:`으로 바뀌었다 — **접히는 폭은 1024로
  // 그대로다**(둘 다 1024라 빌드된 CSS의 선언이 한 글자도 안 달라졌고, 1024px 블록의
  // 지문을 옮기기 전후로 대조했다). 지키는 사실은 "접힌다"이지 철자가 아니므로 둘 다 받는다.
  // 접기 자체가 사라지면 여전히 여기서 걸린다.
  assert.match(src, /grid-cols-1 (?:lg|laptop):grid-cols-/,
    '넓은 화면 레이아웃이 좁은 폭에서 안 접힌다')
})

test('사실2 — 화면 크기 메타가 있다', () => {
  assert.match(read('index.html'), /name="viewport"[^>]*width=device-width/,
    'viewport가 없으면 폰이 980px 가상 화면으로 그려서 글자가 깨알만 해진다')
})

test('사실3 — 버튼이 여럿 든 가로 배치는 줄을 바꾼다', () => {
  // ── 세는 방법을 바꿨다 (2026-09-13) ──────────────────────────────────────────
  //
  // 여기 있던 검사는 `flex items-center flex-wrap` 이라는 **글자 순서 그대로**를 세어
  // "7곳 이상"을 요구했다. 디자인 적용에서 한 자리가 `flex flex-wrap items-center` 로
  // 다시 쓰이자 6이 되어 빨간불이 됐다 — **줄바꿈은 그대로 있는데** 세는 방법이 틀린 것이다.
  // (전체 `flex-wrap` 은 12곳으로 오히려 늘었다.)
  //
  // 숫자 하한도 "지금 몇 개인가"를 고정하는 것이라 같은 함정을 다시 만든다. 그래서
  // **어느 화면에 있어야 하는가**로 바꾼다 — 버튼이 여럿 든 빽빽한 화면들이다.
  // 이름을 대면 그 화면을 다시 짤 때 이 줄이 눈에 띄고, 클래스 순서를 바꿔도 안 깨진다.
  const 빽빽한화면 = [
    'ScheduledBroadcastMini.jsx',
    'TTSBroadcast.jsx',
    'MusicPlayer.jsx',
    'InstantBroadcast.jsx',
    'FavoritesBar.jsx',
    'VolumePanel.jsx',
  ]
  for (const f of 빽빽한화면) {
    assert.ok(easyFiles().includes(f), `${f} 가 없다 — 옮겼으면 이 목록도 같이 옮긴다`)
    assert.match(read('src', 'components', 'easy', f), /flex-wrap/,
      `${f} 에 줄바꿈이 없다 — 폰에서 버튼이 통째로 옆으로 밀린다`)
  }
})

test('사실4 — 작은 배지에는 줄바꿈을 걸지 않는다', () => {
  // <span> 배지에 flex-wrap이 붙으면 "12:00" 같은 칩이 두 줄로 깨진다.
  const offenders = []
  for (const f of easyFiles()) {
    const src = read('src', 'components', 'easy', f)
    for (const line of src.split('\n')) {
      if (line.includes('flex items-center flex-wrap') && !line.includes('<div')) {
        offenders.push(`${f}: ${line.trim().slice(0, 60)}`)
      }
    }
  }
  assert.deepEqual(offenders, [], '컨테이너가 아닌 곳에 줄바꿈이 붙었다')
})
