'use strict'
// UX-44 — **한 칸이 터져도 옆 칸으로 방송은 나간다** (2026-09-11).
//
// 이 저장소에는 오류 경계가 **한 개도 없었다**(2026-09-11 확인). React 는 렌더 중 예외가
// 나면 트리 전체를 언마운트한다 — 유튜브 BGM 카드 하나가 `undefined.map` 으로 터지면
// **쉬운 화면이 통째로 흰 화면**이 되고, 그 순간 현장 선생님은 차임벨도 즉시방송도 못 누른다.
// 요양원에서 흰 화면은 "방송을 못 내보내는 상태"다.
//
// 네트워크 실패 자체는 대개 `catch` 로 잡혀 있다. 위험한 것은 그 **다음** — 실패로 상태가
// 빈 채 렌더가 도는 순간이다. 그래서 방어선을 렌더 쪽에 둔다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const EB = 읽기('src/components/shared/ErrorBoundary.jsx')
const EASY = 읽기('src/pages/EasyMode.jsx')
const ADMIN = 읽기('src/pages/AdminMode.jsx')

test('경계는 클래스 컴포넌트다 — 훅으로는 렌더 예외를 못 잡는다', () => {
  assert.match(EB, /class ErrorBoundary extends Component/, '클래스가 아니다')
  assert.match(EB, /getDerivedStateFromError/, '렌더 예외를 안 잡는다')
})

test('조용히 삼키지 않는다 — 사람에게 다음 행동, 콘솔에 원문', () => {
  assert.match(EB, /componentDidCatch/, '개발자가 원인을 못 본다')
  // 콘솔 기록은 `errorBoundaryState.기록하기` 로 내려갔다 — 거기서 **실행해** 검증한다.
  // 여기서는 그 길이 실제로 존재하는지만 본다(긍정 앵커).
  const LIB = 읽기('src/lib/errorBoundaryState.js')
  assert.match(LIB, /콘솔\.error/, '기록 경로에 콘솔이 없다')
  assert.match(EB, /다시 시도/, '사람이 할 수 있는 다음 행동이 없다')
})

// ── 판단을 **실제로 실행한다** ────────────────────────────────────────────
// 소스 문자열만 보는 가드는 `getDerivedStateFromProps` 가 늘 null 을 돌려줘도 통과한다 —
// Codex 독립 검수가 정확히 그 점을 짚었다(2026-09-11, EV-004516). 그래서 판단을
// `src/lib/errorBoundaryState.js` 로 내리고 여기서 돌린다.
// (`.jsx` 는 node 가 못 읽는다. `.js` 순수 모듈이라 그대로 돌아간다.)
const { 터진상태, 초기화할까, 그릴것, 기록하기 } = require('../../src/lib/errorBoundaryState.js')

test('평소에는 자식을 그리고, 터지면 안내를 띄운다', () => {
  assert.equal(그릴것({ err: null }, {}), 'children')
  assert.equal(그릴것({ err: new Error('x') }, {}), '안내')
})

test('조용히 층은 화면에 아무것도 안 띄운다 — 방송 화면을 덮으면 안 된다', () => {
  assert.equal(그릴것({ err: new Error('x') }, { 조용히: true }), null)
  // 터지지 않았으면 조용히여도 자식을 그린다 — 이게 뒤집히면 그 층이 통째로 사라진다.
  assert.equal(그릴것({ err: null }, { 조용히: true }), 'children')
})

test('조용히여도 콘솔에는 남는다 — 자리를 옮기는 것이지 삼키는 것이 아니다', () => {
  // 소스에 `console.error` 가 **쓰여 있다**는 것과 그것이 **불린다**는 것은 다르다.
  // Codex 가 componentDidCatch 첫 줄을 막아도 가드가 다 통과하는 것을 보였다(EV-004535).
  const 찍힌것 = []
  const 가짜 = { error: (...a) => 찍힌것.push(a) }
  const e = new Error('가짜 렌더 오류')
  기록하기('유튜브 BGM', e, '스택', 가짜)
  assert.equal(찍힌것.length, 1, '콘솔에 아무것도 안 남았다')
  assert.match(찍힌것[0][0], /유튜브 BGM/, '어느 칸이 터졌는지 안 적는다')
  assert.equal(찍힌것[0][1], e, '오류 원문을 안 넘긴다')
  assert.equal(찍힌것[0][2], '스택', 'componentStack 을 안 넘긴다')
})

test('터지면 그 오류를 실제로 담는다', () => {
  const e = new Error('가짜 렌더 오류')
  assert.equal(터진상태(e).err, e, '오류를 안 담는다 — fallback 이 안 뜬다')
})

test('resetKey 가 그대로면 **아무것도 안 한다** — 무한 재시도를 막는 자리', () => {
  // 여기서 매번 객체를 돌려주면 fallback 이 뜬 프레임에 바로 다시 그리려 들고,
  // 같은 오류가 또 나서 무한 루프가 된다. null 이어야 한다.
  assert.equal(초기화할까({ resetKey: 'dashboard' }, { err: new Error('x'), resetKey: 'dashboard' }), null)
  assert.equal(초기화할까({ resetKey: undefined }, { err: new Error('x'), resetKey: undefined }), null)
})

test('resetKey 가 바뀌면 경계를 푼다 — 사람이 버튼을 또 누르게 하지 않는다', () => {
  const r = 초기화할까({ resetKey: 'soundSettings' }, { err: new Error('x'), resetKey: 'dashboard' })
  assert.deepEqual(r, { err: null, resetKey: 'soundSettings' }, '섹션을 옮겨도 오류 화면이 남는다')
})

test('경계는 그 판단 함수를 실제로 쓴다 — 따로 베껴 두지 않았나', () => {
  assert.match(EB, /from '\.\.\/\.\.\/lib\/errorBoundaryState'/, '판단 모듈을 안 쓴다')
  assert.match(EB, /return 터진상태\(err\)/, 'getDerivedStateFromError 가 제 판단을 안 쓴다')
  assert.match(EB, /return 초기화할까\(props, state\)/, 'getDerivedStateFromProps 가 제 판단을 안 쓴다')
  assert.match(ADMIN, /<ErrorBoundary[^>]*resetKey=\{activeSection\}/,
    '관리자 화면이 섹션 전환으로 경계를 못 푼다')
})

test('관리자 화면: 한 섹션이 터져도 사이드바는 산다', () => {
  // 긍정 앵커 — 감쌀 대상이 실제로 이 파일에 있다.
  assert.match(ADMIN, /<SectionComponent \/>/, '섹션 렌더 자리를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(ADMIN, /<ErrorBoundary[\s\S]{0,400}<SectionComponent \/>/,
    '섹션이 경계 밖에 있다 — 한 화면이 터지면 관리자 화면 전체가 죽는다')
  assert.match(ADMIN, /import ErrorBoundary/, '경계를 안 들여온다')
})

// 쉬운 화면이 현장에서 실제로 쓰는 화면이다. **칸 단위**로 감싼다 —
// 화면 하나를 통째로 감싸면 한 칸이 터졌을 때 나머지 칸도 같이 사라진다.
const 반드시감싼칸 = [
  'InstantBroadcast', 'ChimeCard', 'TTSBroadcast',
  'ScheduledBroadcastMini', 'YouTubeBGM', 'VolumePanel',
]

// **레이아웃마다 따로 본다.** 파일 전체로 세면 PC 쪽만 감싸도 통과해 버리고,
// 그러면 현장에서 쓰는 태블릿에서만 화면이 죽는다 — 제일 늦게 발견되는 모양이다.
function 레이아웃(이름) {
  const 시작 = EASY.indexOf(`function ${이름}`)
  assert.ok(시작 > -1, `${이름} 을 못 찾았다 — 이 가드를 옮길 것`)
  const 다음 = EASY.indexOf('\nfunction ', 시작 + 1)
  return EASY.slice(시작, 다음 === -1 ? EASY.length : 다음)
}

// `<ErrorBoundary …><Card …` — 사이에 공백·줄바꿈만 허용한다. 다른 태그가 끼면 안 잡는다.
const 감쌌나 = (본문, 칸) =>
  new RegExp(`<ErrorBoundary[^>]*>\\s*<${칸}[\\s/>]`).test(본문)

test('쉬운 화면: 소리를 내는 칸은 **두 레이아웃 모두에서** 제 경계를 갖는다', () => {
  assert.match(EASY, /import ErrorBoundary/, '경계를 안 들여온다')
  for (const 이름 of ['MobileLayout', 'DesktopLayout']) {
    const 본문 = 레이아웃(이름)
    for (const 칸 of 반드시감싼칸) {
      // 긍정 앵커 — 그 칸이 이 레이아웃에 실제로 있다. 없으면 아래 단언이 조용히 통과한다.
      if (!new RegExp(`<${칸}[\\s/>]`).test(본문)) continue
      assert.ok(감쌌나(본문, 칸), `${이름} 의 ${칸} 이 경계 밖이다 — 이 칸이 터지면 화면 전체가 죽는다`)
    }
    assert.match(본문, /<ErrorBoundary/, `${이름} 에 경계가 하나도 없다`)
  }
})

// Codex 독립 검수가 잡은 자리다(2026-09-11, EV-004516). 이것들은 `Routes` 와 **형제**라
// 하나가 터지면 화면 전체가 사라진다 — 방송 중에 자막 하나 때문에 정지 버튼까지 없어진다.
// 처음 수정에서 통째로 빠져 있었고, 소스 가드가 없었으면 다음에도 또 빠진다.
test('앱 층·화면 머리도 경계 안에 있다 — Routes 와 형제라 터지면 전부 사라진다', () => {
  const APP = 읽기('src/App.jsx')
  assert.match(APP, /import ErrorBoundary/, 'App 이 경계를 안 들여온다')
  // 2026-09-15: `BroadcastNowPlaying`(맨 위 빨간 알약)이 **아래 바로 바뀌었다.**
  // 그 알약은 휴대폰에서 머리줄 탭을 덮어 「간편」을 못 누르게 했다(사용자 사진).
  // `NowPlayingBar` 가 그 자리를 이어받았고 — 제목·**단계**·정지를 다 가진 상위집합이다 —
  // 동시에 `EasyMode` 에서 이 층으로 **올라왔다**(통합 홈에는 아래 바가 없었다).
  // 그래서 이 목록에서 알약이 빠지고 바가 들어온다. 경계는 그대로 따라갔다.
  for (const 층 of ['BroadcastCaption', 'NowPlayingBar', 'BroadcastOverlay',
    'VideoPlayer', 'MusicPlayer', 'SystemAlertBanner']) {
    assert.ok(APP.includes(`<${층}`), `${층} 이 App 에 없다 — 이 가드를 옮길 것`)
    assert.match(APP, new RegExp(`<ErrorBoundary[^>]*>\\s*(\\{[^}]*&&\\s*)?<${층}[\\s/>]`),
      `App 의 ${층} 이 경계 밖이다 — 이것이 터지면 화면 전체가 사라진다`)
  }
  // `NowPlayingBar` 는 위 목록으로 갔다(앱 층). 여기는 **이 화면 고유의** 것들만 본다.
  for (const 층 of ['MobileHeader', 'TopBar', 'NotificationBar']) {
    assert.ok(EASY.includes(`<${층}`), `${층} 이 EasyMode 에 없다 — 이 가드를 옮길 것`)
    assert.match(EASY, new RegExp(`<ErrorBoundary[^>]*>\\s*<${층}[\\s/>]`),
      `쉬운 화면의 ${층} 이 경계 밖이다`)
  }
})

test('경계가 그 판단·기록 함수를 실제로 쓴다 — 따로 베껴 두지 않았나', () => {
  // 실행 검증은 위에서 했다. 여기는 **배선**만 본다 — 컴포넌트가 그 함수를 안 쓰고
  // 제 안에 다시 적어 두면 위 테스트가 아무것도 지키지 못한다.
  assert.match(EB, /const 뭘 = 그릴것\(this\.state, this\.props\)/, '그릴것을 안 쓴다')
  assert.match(EB, /기록하기\(this\.props\.이름, err/, '기록하기를 안 쓴다')
  assert.doesNotMatch(EB, /console\.error/, '경계가 콘솔을 직접 부른다 — 주입 검증을 빠져나간다')
})

// 페이지·레이아웃 층 — 카드 **바깥**에서 터지면 카드 경계로는 못 잡는다(Codex R2).
test('페이지와 레이아웃도 경계 안이다 — 카드 바깥에서 터지는 경우', () => {
  const APP = 읽기('src/App.jsx')
  assert.match(APP, /<ErrorBoundary[^>]*>\s*<Routes>/,
    'Routes 가 경계 밖이다 — 레이아웃·헤더에서 터지면 앱 전체가 사라진다')
  assert.match(EASY, /<ErrorBoundary[^>]*resetKey=\{isDesktop[^}]*\}>/,
    '쉬운 화면의 레이아웃 전환이 경계 밖이다')
})

test('두 레이아웃 다 실제로 칸을 갖고 있다 — 목록이 조용히 비지 않았나', () => {
  for (const 이름 of ['MobileLayout', 'DesktopLayout']) {
    const 본문 = 레이아웃(이름)
    const 있는칸 = 반드시감싼칸.filter(c => new RegExp(`<${c}[\\s/>]`).test(본문))
    assert.ok(있는칸.length >= 4, `${이름} 에서 찾은 칸이 ${있는칸.length}개뿐이다 — 위 목록이 낡았다`)
  }
})
