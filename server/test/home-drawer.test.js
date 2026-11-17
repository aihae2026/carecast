// 통합 홈의 서랍(조작판) — 조용히 되돌아가면 안 되는 것 넷 (2026-09-13).
//
// 넷 다 **V③ 독립검수와 브라우저 실측이 잡아 준 자리**다. 화면(JSX)은 여기서 못 돌리므로
// 소스를 글자로 읽어 고정한다. 부정 단언 앞에는 긍정 앵커를 세운다(CLAUDE.md).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT   = path.join(__dirname, '..', '..')
const DRAWER = path.join(ROOT, 'src', 'components', 'home', 'HomeDrawer.jsx')
const HOME   = path.join(ROOT, 'src', 'pages', 'HomeMode.jsx')
const VOL    = path.join(ROOT, 'src', 'components', 'easy', 'VolumePanel.jsx')

const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n')
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

test('감시할 대상이 있다 — 서랍이 그 자리에 있다', () => {
  assert.ok(fs.existsSync(DRAWER), 'HomeDrawer.jsx 가 없다 — 옮겼으면 이 시험도 같이 옮긴다')
  const code = codeOnly(read(DRAWER))
  assert.match(code, /id="home-drawer"/, '서랍에 id 가 없다 — 손잡이의 aria-controls 가 가리킬 것이 없다')
  assert.match(codeOnly(read(HOME)), /<HomeDrawer/, '통합 홈이 서랍을 안 쓴다')
})

test('닫힌 서랍은 inert — 안 보이는 단추에 초점이 가지 않는다', () => {
  // **방향까지 본다.** 처음엔 두 메서드가 **있기만** 하면 통과했는데, 그러면 조건을
  // `if (!open)` 으로 **뒤집어도 초록불**이었다(V③ 검수 2026-09-13 지적).
  // 뒤집히면 열린 서랍이 inert 가 되어 **열어도 아무것도 못 누른다.**
  const code = codeOnly(read(DRAWER))
  assert.match(code, /if \(open\)\s*el\.removeAttribute\('inert'\)/,
    '열릴 때 inert 를 걷는 가지가 아니다 — 조건이 뒤집히면 열어도 못 누른다')
  assert.match(code, /else\s*el\.setAttribute\('inert', ''\)/,
    '닫힐 때 inert 를 세우는 가지가 아니다 — 화면 밖 단추 스물몇 개가 탭 순서에 남는다')
  assert.doesNotMatch(code, /if \(!open\)\s*el\.removeAttribute/,
    'inert 판정이 뒤집혔다')
})

test('서랍은 transform 으로 움직이지 않는다 — position:fixed 후손이 재기준화된다', () => {
  // **CSS 함정**: 조상에 `transform` 이 걸리면 그 안의 `position:fixed` 가 화면이 아니라
  // 그 조상을 기준으로 잡힌다. 서랍 안에는 도움말 풍선(fixed)이 있고, 유튜브 전체화면도
  // 이 규칙에 걸린다. 그래서 `right` 를 움직인다(V③ 검수 2026-09-13).
  const code = codeOnly(read(DRAWER))
  assert.match(code, /transition-\[right\]/, '서랍이 right 로 움직이지 않는다')
  assert.doesNotMatch(code, /translate-x|transition-transform|transform:/,
    '서랍이 transform 으로 움직인다 — 안의 fixed 요소가 화면이 아니라 서랍을 기준으로 잡힌다')
})

test('배경음악 카드는 서랍 안이되, 소리 내는 재생기는 서랍 밖(Routes 바깥)에 있다', () => {
  // **전제가 바뀐 자리다.** 예전 규칙은 "BGM 을 서랍 밖에 둔다" 였다 — 닫힌 서랍은 `inert`
  // 라 원격 PC 가 보낸 tv-start 뒤의 전체화면·종료 단추가 죽기 때문이다
  // (V③ 검수 2026-09-13, high).
  //
  // 지금은 사용자 지시로 BGM 이 **조작판 안**으로 들어갔다
  // (*"조작판 옛날 모듈에다가 안박아넣으래? 밑에 지저분하게 있지마"*).
  // 그래서 **막던 이유를 먼저 없앴다**: 보이는 조각(TV 전체화면·폴더 모달)을 `body` 로
  // 포털한다. 소리를 내는 iframe 은 원래부터 Routes 바깥에 있다.
  //
  // 즉 이 시험이 지키는 것은 *"어디에 그리나"* 가 아니라 **"`inert` 에 갇히는 것이 없나"** 다.
  // 소리를 내는 것은 카드가 아니라 **재생기(MusicPlayer)** 이고, 그것은 App 의 Routes 바깥이다.
  const code = codeOnly(read(HOME))
  const i = code.indexOf('<HomeDrawer')
  assert.ok(i >= 0, '서랍을 못 찾았다')
  const 서랍안 = code.slice(i, code.indexOf('</HomeDrawer>', i))
  const app = codeOnly(read(path.join(ROOT, 'src', 'App.jsx')))
  const 마지막라우트 = app.lastIndexOf('</Routes>')
  assert.ok(app.indexOf('<MusicPlayer') > 마지막라우트, '재생기가 Routes 안에 있다 — 화면을 옮기면 음악이 끊긴다')
  const 카드 = read(path.join(ROOT, 'src', 'components', 'easy', 'LocalBGMCard.jsx'))
  assert.ok(!/new Audio|<audio|<iframe/.test(카드), '배경음악 카드가 스스로 소리를 낸다 — 서랍이 닫히면 음악이 끊긴다')
  // 2026-09-21: 외부 동영상 BGM 판 → 이 PC 음원 카드(LocalBGMCard). 카드는 틀기·멈추기 신호만 보낸다.
  assert.match(서랍안, /<LocalBGMCard/, '배경음악 카드가 조작판 안에 없다')

})

test('서랍 안 음량 패널은 좁은 그릇이라고 알려 준다', () => {
  // `tablet:grid-cols-2` 의 판정은 **화면 폭**이지 이 부품이 받은 폭이 아니다.
  // 300px 서랍에 그대로 넣으면 1440 화면에서 두 칸이 되어 **라벨과 숫자가 겹친다**
  // (2026-09-13 브라우저 실측 — 실제로 겹쳤고, 고친 뒤 한 칸(224px)이 되는 것을 확인).
  const vol = codeOnly(read(VOL))
  assert.match(vol, /function VolumePanel\(\{[^}]*narrow = false/,
    'VolumePanel 이 narrow 를 안 받는다 — 기본값은 false 여야 쉬운 화면이 안 바뀐다')

  // **두 가지를 갈라서 본다.** 처음엔 `narrow ? … grid-cols-1` 한 줄만 봤는데, 거짓 가지에도
  // `grid-cols-1` 이 있어서 **참 가지를 `grid-cols-2` 로 바꿔도 초록불**이었다
  // (V③ 검수 2026-09-13 지적). 가지를 하나씩 떼어 본다.
  const t = vol.match(/narrow \? "([^"]*)" : "([^"]*)"/)
  assert.ok(t, '격자 결정이 `narrow ? "…" : "…"` 모양이 아니다 — 바뀌었으면 이 시험도 같이 옮긴다')
  const [, 좁을때, 넓을때] = t
  assert.ok(/\bgrid-cols-1\b/.test(좁을때) && !/grid-cols-2/.test(좁을때),
    `좁은 그릇에서도 두 칸으로 간다 — 서랍에서 글자가 겹친다: "${좁을때}"`)
  assert.ok(/tablet:grid-cols-2/.test(넓을때),
    `넓을 때 두 칸이 아니다 — 쉬운 화면의 지금 모습이 바뀐다: "${넓을때}"`)

  const home = codeOnly(read(HOME))
  const tag = home.match(/<VolumePanel[^>]*>/)
  assert.ok(tag, '통합 홈이 음량 패널을 안 쓴다')
  // **값까지 본다.** `narrow={false}` 도 `narrow` 라는 글자는 들고 있다.
  assert.match(tag[0], /\bnarrow(\s|\/|>|=\{true\})/,
    `서랍 안 음량 패널에 참을 안 준다: ${tag[0]}`)
  assert.doesNotMatch(tag[0], /narrow=\{false\}/, '서랍 안인데 narrow 를 꺼 뒀다')
})
