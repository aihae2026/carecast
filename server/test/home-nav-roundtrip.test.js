// 탭 넷이 실제로 닿고, **돌아올 수 있다** (2026-09-13, §5-4).
//
// 통합 홈의 머리줄은 간편 · 캘린더 · 자동순서 · 설정 넷이다. 그런데 설정·자동순서는
// **관리자 화면으로 나간다** — 사용자 지시가 *"PC 는 dev 설정 화면 그대로, 토시 하나
// 틀리지 말고"* 라서 그 화면에는 탭 줄이 없다. 그러면 **한 방향 문**이 된다:
// 들어갈 수는 있는데 나올 길이 없다. 이 시험이 두 가지를 고정한다.
//
//   ① 탭 넷의 목적지가 **실제로 있는 화면**이다 — 오타 하나로 대시보드로 떨어지지 않는다.
//      (`AdminMode.resolveSection` 은 모르는 이름을 조용히 `dashboard` 로 보낸다.
//       그래서 "빈 화면"이 아니라 **엉뚱한 화면**이 뜨고, 아무도 고장으로 안 읽는다.)
//   ② 관리자 화면에 **통합 홈으로 돌아가는 길**이 있다.
//
// 그리고 글자 크기 — 사용자 지시(2026-09-13): *"사이드바 그러면 13으로 올려"*.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT    = path.join(__dirname, '..', '..')
const SHELL   = path.join(ROOT, 'src', 'components', 'home', 'HomeShell.jsx')
const APP     = path.join(ROOT, 'src', 'App.jsx')
const ADMIN   = path.join(ROOT, 'src', 'pages', 'AdminMode.jsx')
const SIDEBAR = path.join(ROOT, 'src', 'components', 'admin', 'Sidebar.jsx')

const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n')

/** HomeShell 의 TABS 에서 `to` 를 뽑는다 */
function 탭목적지() {
  const src = read(SHELL)
  const i = src.indexOf('const TABS = [')
  assert.ok(i >= 0, 'HomeShell 에 TABS 가 없다 — 옮겼으면 이 시험도 같이 옮긴다')
  const 블록 = src.slice(i, src.indexOf('\n]', i))
  return [...블록.matchAll(/\{\s*id:\s*'([\w-]+)'[^}]*to:\s*'([^']+)'/g)]
    .map(m => ({ id: m[1], to: m[2] }))
}

test('탭은 **다섯**이고, 좁은 화면에서만 둘로 줄어든다', () => {
  const tabs = 탭목적지()
  // ── 같은 자리가 네 번 바뀌었다. 무엇이 왜 바뀌었는지 안 적으면 다음 사람이 되돌린다 ──
  //   · 2026-09-13(오전) 넷 — 간편·캘린더·자동순서·설정
  //   · 2026-09-13(오후) 다섯 — 「업로드」가 사이드바 안쪽에서 머리줄로 올라왔다
  //   · 2026-09-15(오전) **둘** — *"위에 간편화면이랑 캘린더만 띄워주는건 어때 토글로"*
  //   · 2026-09-15(오후) **다섯으로 되돌리되 좁은 화면에서만 둘** — 사용자 정정:
  //     ***"누가 토글창 웹에서도 저렇게 해놓으래. 저건 모바일에서만 적용하라고."***
  //
  // **줄이는 이유는 좁은 화면에만 있었다.** 다섯 칸은 423px 인데 390 화면의 탭줄이 쓸 수
  // 있는 폭은 358px 이라 안 들어간다(실측). 넓은 화면에서는 그 이유가 없다.
  // 그래서 목록은 다섯 그대로 두고 **CSS 로** 셋을 감춘다 — 감추는 판단이 한 곳이다.
  //
  // 좁은 화면에서 감춘 셋은 서랍의 「관리」 줄에서 들어간다(`home-layering` 이 다섯을 다 센다).
  assert.deepEqual(tabs.map(t => t.id), ['home', 'calendar', 'flow', 'media', 'settings'],
    '탭 구성이 바뀌었다(사용자 정정 2026-09-15: 다섯 유지, 좁은 화면에서만 둘). '
    + '뺄 거면 어디로 갔는지 적을 것')

  // **좁은 화면에서 감춘다는 사실**이 코드에 남아 있어야 한다. 이게 빠지면 다섯이
  // 휴대폰 머리줄을 통째로 차지해 2026-09-14 의 문제로 되돌아간다.
  const 껍데기 = read(SHELL)
  assert.match(껍데기, /hidden tablet:inline-flex/,
    '좁은 화면에서 감추는 규칙이 없다 — 다섯 칸이 휴대폰 머리줄을 넘긴다')
  // 휴대폰에 남기는 것은 **둘뿐**이다. 늘리면 390px 머리줄에 다시 안 들어간다.
  const 폰개수 = (껍데기.match(/폰에도: true/g) || []).length
  assert.equal(폰개수, 2,
    `휴대폰에 남긴 탭이 ${폰개수}개다 — 둘을 넘으면 좁은 화면 머리줄이 두 줄이 된다`)
})

/**
 * **본 앱의 Routes 만** 뽑는다.
 *
 * App.jsx 에는 `<Routes>` 가 넷이다 — `/monitor`·`/dev-console`·`/guide` 는 주소를 보고
 * **통째로 갈아 끼우는 별도 껍데기**이고(재생 코드를 아예 안 태운다), 본 앱은 맨 뒤 하나다.
 * 넷을 다 합쳐서 보면 「캘린더」 탭을 `/guide` 로 바꿔도 초록불이 난다 — 실제로 그랬다
 * (V③ 검수 2026-09-13 지적). 탭은 본 앱 안에서 움직이는 것이라 **맨 뒤 블록만** 본다.
 */
function 본앱라우트() {
  const app = read(APP)
  const 시작 = app.lastIndexOf('<Routes>')
  const 끝   = app.indexOf('</Routes>', 시작)
  assert.ok(시작 >= 0 && 끝 > 시작, 'App.jsx 에서 본 앱 Routes 를 못 찾았다')
  const 블록 = app.slice(시작, 끝)
  return new Set([...블록.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]))
}

/** AdminMode 가 아는 섹션 이름 — sectionMap 의 열쇠들 */
function 관리자섹션() {
  const admin = read(ADMIN)
  const i = admin.indexOf('const sectionMap = {')
  assert.ok(i >= 0, 'AdminMode 에 sectionMap 이 없다 — 옮겼으면 이 시험도 같이 옮긴다')
  const 블록 = admin.slice(i, admin.indexOf('\nconst LEGACY_REDIRECTS', i))
  // 최상위 열쇠만 — 두 칸 들여쓰기. 안쪽 `{ Component: … }` 에 걸리지 않게.
  return new Set([...블록.matchAll(/^ {2}'?([A-Za-z][\w-]*)'?:\s*\{/gm)].map(m => m[1]))
}

test('탭이 가리키는 주소가 실제로 있는 화면이다', () => {
  const 라우트 = 본앱라우트()
  const 섹션   = 관리자섹션()
  assert.ok(섹션.size >= 8, `관리자 섹션을 ${섹션.size}개밖에 못 찾았다 — 뽑는 방법을 다시 본다`)

  for (const { id, to } of 탭목적지()) {
    const [pathname, query] = to.split('?')
    assert.ok(라우트.has(pathname),
      `「${id}」 탭이 ${pathname} 로 가는데 본 앱 Routes 에 그 길이 없다 — 빈 화면이거나 딴 앱이다`)
    // **`/admin` 만 주면 대시보드가 뜬다.** 탭 이름이 「설정」인데 대시보드가 뜨면
    // 이름과 도착지가 다르다 — 빈 화면이 아니라 엉뚱한 화면이라 아무도 고장으로 안 읽는다.
    // 이 가지가 없어서 실제로 그 상태였다(V② 적대 검수 2026-09-13 지적).
    assert.ok(!(pathname === '/admin' && !query),
      `「${id}」 탭이 /admin 만 가리킨다 — 대시보드가 뜬다. ?section= 을 붙인다`)
    if (!query) continue

    // `?section=` 은 AdminMode 가 읽는다. **모르는 이름이면 조용히 대시보드로 떨어진다** —
    // 빈 화면이 아니라 엉뚱한 화면이라 아무도 고장으로 안 읽는다.
    // **글자 그대로 대조한다.** 예전엔 이름으로 정규식을 만들었는데, 그러면 `.` 같은 글자가
    // 와일드카드가 되어 `morningEdito.` 가 통과했다(V③ 검수 2026-09-13 지적).
    const section = new URLSearchParams(query).get('section')
    if (!section) continue
    assert.ok(섹션.has(section),
      `「${id}」 탭의 section="${section}" 을 AdminMode 가 모른다 — 조용히 대시보드가 뜬다`)
  }
})

test('모르는 section 이 조용히 대시보드로 떨어진다는 전제가 아직 맞다', () => {
  // 위 시험이 **왜** 이름을 글자 그대로 대조하는지의 근거다. 이 폴백이 시끄러워지면
  // (없는 화면이라고 말해 주면) 위 시험의 무게가 달라지므로, 전제가 바뀌면 알아야 한다.
  const admin = read(ADMIN)
  const i = admin.indexOf('function resolveSection(')
  assert.ok(i >= 0, 'resolveSection 이 없다 — 이름이 바뀌었으면 이 시험도 같이 옮긴다')
  const 본문 = admin.slice(i, admin.indexOf('\n}', i))
  assert.match(본문, /return \{ section: 'dashboard'/,
    '모르는 이름의 폴백이 바뀌었다 — 위 시험의 전제를 다시 본다')
  assert.doesNotMatch(본문, /throw|console\.(warn|error)/,
    '폴백이 시끄러워졌다면 좋은 일이다 — 위 시험의 문구를 그에 맞게 고친다')
})

test('옛 주소를 안 끊었다 — /admin?section=scheduledBroadcast 가 아직 산다', () => {
  // 캘린더를 탭으로 뺐다고 해서 저장해 둔 링크·문서·바로가기가 죽으면 안 된다(사용자 지시).
  const admin = read(ADMIN)
  assert.match(admin, /scheduledBroadcast:\s*\{\s*section:\s*'weeklySchedule'/,
    '옛 주소가 방송일정 화면으로 안 간다 — 저장해 둔 링크가 대시보드로 떨어진다')
})

test('관리자 화면에도 탭 줄이 있다 — 한 방향 문을 만들지 않는다 (G-26)', () => {
  // 사용자 신고: *"자동순서랑 설정은 한번들어가면 간편이랑 캘린더로 돌아오기 힘들잖아"*.
  // 그때는 `/admin` 이 `HomeShell` 밖이라 **들어가는 순간 탭 줄이 통째로 사라졌다.**
  // 목업의 머리줄은 모든 화면 **바깥**에 있어 네 화면 다 보인다 — 이제 제품도 같다.
  const admin = read(ADMIN)
  assert.match(admin, /import HomeShell\s+from '\.\.\/components\/home\/HomeShell'/,
    '관리자 화면이 공통 틀을 안 쓴다 — 탭 줄이 사라진다')
  assert.match(admin, /<HomeShell tab=\{tab\}/, '관리자 화면이 틀 안에 안 들어가 있다')
  // 어느 탭을 켜 둘지 — **제 탭을 가진 둘**(자동순서·업로드)만 따로 빼고 나머지는 「설정」이다.
  // 2026-09-13 에 「업로드」 탭이 늘면서 `musicManagement` 가 여기 들어왔는데 이 줄이
  // 안 따라왔다 — 업로드 탭을 눌러 도착해도 불은 설정에 들어와 "내가 어디 있나"가 안 보인다.
  assert.match(admin, /activeSection === 'morningEditor'\s*\?\s*'flow'/,
    '자동방송 편집에서 「자동순서」 탭에 불이 안 들어온다')
  assert.match(admin, /activeSection === 'musicManagement'\s*\?\s*'media'/,
    '음원 관리에서 「업로드」 탭에 불이 안 들어온다')
  // **화면 안쪽은 안 옮긴다**(사용자: "설정만큼은 형태에 유지하고").
  // 사이드바와 섹션 배치가 그대로인지는 아래 항목이 본다.
  assert.match(admin, /<Sidebar activeSection=\{activeSection\}/, '사이드바가 사라졌다')
})

test('사이드바에 화면을 오가는 길을 두지 않는다 — 그건 탭 줄의 일이다', () => {
  const sb = read(SIDEBAR)
  // 긍정 앵커 — 이 파일이 사이드바 메뉴를 든다(감시할 대상이 있다).
  assert.match(sb, /const menuItems = \[/, '사이드바 메뉴 목록이 없다 — 옮겼으면 이 시험도 옮긴다')

  // ── 「쉬운 화면으로 전환」을 **걷었다** (사용자 지시 2026-09-13) ────────────────
  // *"쉬운화면도 없애 이제, 자꾸 전으로 돌아가잖아"* — 이 단추가 옛 화면(`/`)으로 가는
  // 유일한 눈에 띄는 입구였고, 새 화면을 보다가 누르면 옛 디자인으로 떨어졌다.
  // 두 디자인을 오가면 어느 쪽이 지금 것인지 사람이 못 정한다.
  //
  // 이 시험은 그 전까지 **반대**를 고정하고 있었다("쉬운 화면으로 전환이 사라졌다"를
  // 실패 문구로 들고). 지시가 뒤집혔으면 가드도 같은 커밋에서 뒤집어야 하는데 안 그랬다 —
  // 그래서 사용자 결정을 되돌리라고 말하는 빨간불이 남아 있었다.
  //
  // **`/` 주소 자체는 안 건드렸다** — 사라진 것은 입구이지 화면이 아니다.
  assert.doesNotMatch(sb, /navigate\('\/'\)/,
    '사이드바에 옛 화면(/)으로 가는 길이 되살아났다')
  assert.doesNotMatch(sb, /navigate\('\/simple'\)/,
    '사이드바에 탭과 겹치는 길이 남아 있다')
})

test('사이드바 글자가 13px 아래로 내려가지 않는다', () => {
  // 사용자 지시(2026-09-13): "사이드바 그러면 13으로 올려".
  // `text-xs`(12px)·`text-[11px]`·`text-[10px]` 이 다시 들어오면 잡는다.
  const sb = read(SIDEBAR)
  const 작은것 = []
  for (const m of sb.matchAll(/text-\[(\d+)px\]/g)) {
    if (Number(m[1]) < 13) 작은것.push(m[0])
  }
  if (/\btext-xs\b/.test(sb)) 작은것.push('text-xs (12px)')
  assert.deepEqual(작은것, [],
    `사이드바에 13px 아래 글자가 있다: ${작은것.join(', ')}`)
})
