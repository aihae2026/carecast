// **이름표 메뉴의 도착지가 실제로 있는 화면이어야 한다** (사용자 지시 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 머리줄 이름표(CareCast)가 여태 「간편 화면」 한 곳으로만 갔다. 그래서 간편·캘린더
// 화면에서는 대시보드·방송 로그·비상 방송 관리로 **갈 길이 아예 없었다** — 주소를
// 외우고 있어야 갔다. 이제 이름표가 전체 메뉴를 연다.
//
// ── 왜 시험으로 묶나 ────────────────────────────────────────────────────────
// 이 메뉴는 **목록을 손으로 적는다**(관리자 사이드바와 묶지 않는다 — 그쪽은 `/admin`
// 안의 차림표이고 이쪽은 어디서든 여는 지도라, 언젠가 갈릴 수 있는 두 판단이다).
// 손으로 적는 목록은 **도착지가 조용히 죽는다** — 사이드바에서 `section` 이름 하나를
// 바꾸면 메뉴의 그 줄만 빈 화면으로 간다. 누르기 전에는 아무도 모른다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT  = path.join(__dirname, '..', '..')
const 읽기  = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 메뉴  = 읽기('src/components/home/HomeBrandMenu.jsx')
const 사이드바 = 읽기('src/components/admin/Sidebar.jsx')
const 앱    = 읽기('src/App.jsx')

/** 메뉴가 가리키는 주소를 그대로 뽑는다. 여기서 다시 적으면 **두 벌이 되어 갈린다.** */
function 도착지들() {
  return [...메뉴.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1])
}

test('긍정 앵커 — 메뉴에 도착지가 넉넉히 있다', () => {
  const t = 도착지들()
  assert.ok(t.length >= 10,
    `도착지가 ${t.length}개다 — 흩어져 있던 셋(탭·서랍·사이드바)을 한 장에 펴는 자리다`)
  assert.equal(new Set(t).size, t.length, `같은 곳이 두 번 들어 있다: ${t.join(' ')}`)
})

test('**옛 동작이 살아 있다** — 이름표로 간편 화면에 갈 수 있다', () => {
  // 2026-09-13 에 이 자리는 「간편 화면으로」였다. 메뉴로 바꾸면서 그 길을 없애면
  // 이름표를 「처음으로」로 쓰던 사람이 갈 곳을 잃는다.
  assert.ok(도착지들().includes('/simple'), '간편 화면으로 가는 줄이 없다')
  assert.equal(도착지들()[0], '/simple', '간편이 맨 위가 아니다 — 가장 자주 가는 곳이 위다')
})

test('**`/admin?section=` 도착지가 사이드바에 실제로 있는 이름이다**', () => {
  const 사이드바id = new Set(
    [...사이드바.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]))
  assert.ok(사이드바id.size >= 5, `사이드바에서 뽑은 id 가 ${사이드바id.size}개다 — 꼴이 바뀌었나`)

  const 섹션 = 도착지들()
    .filter(t => t.startsWith('/admin?section='))
    .map(t => t.slice('/admin?section='.length))
  assert.ok(섹션.length >= 5, `관리 화면 줄이 ${섹션.length}개뿐이다`)
  for (const id of 섹션) {
    assert.ok(사이드바id.has(id),
      `메뉴가 「${id}」 로 보내는데 사이드바에 그 이름이 없다 — 누르면 빈 화면이다`)
  }
})

test('**주소로 시작하는 도착지는 앱에 길이 있다**', () => {
  const 길 = new Set([...앱.matchAll(/path="([^"]+)"/g)].map(m => m[1]))
  assert.ok(길.size >= 4, `App 에서 뽑은 길이 ${길.size}개다 — 꼴이 바뀌었나`)
  for (const t of 도착지들()) {
    if (t.startsWith('/admin')) continue          // 위 시험이 본다
    if (t === '#tour') {                           // 주소가 아니라 이 화면 안 동작(처음 안내 다시 보기, 2026-09-17)
      assert.match(메뉴, /if \(to === '#tour'\) \{/, '「#tour」 를 받는 자리가 없다 — 누르면 아무 일도 안 난다')
      continue
    }
    const 경로 = t.split('?')[0]
    assert.ok(길.has(경로), `메뉴가 「${경로}」 로 보내는데 그런 길이 없다`)
  }
})

// ── **이름표와 메뉴는 다른 단추다** (사용자 정정 2026-09-15) ────────────────────
// *"메뉴 버튼은 좋은데, 배너에다가 하지 말고 다른 메뉴로 옆에다가 넣으면 어떨까."*
//
// 앞 판은 **이름표 자체**를 눌러 메뉴를 열었고, 이 시험이 *"이름표가 다시 간편으로
// 가는 단추가 되지 않았는지"* 를 고정했다. 그런데 그러면 **이름표의 옛 일**(「처음으로」)이
// 없어진다 — 한 자리에 두 가지 일을 시킨 것이 문제였다.
//
// **시험을 지우지 않고 뒤집는다.** 지키려던 것(전체 메뉴로 가는 길이 살아 있다)은 그대로다.
test('**이름표는 처음으로, 옆 단추가 메뉴** — 한 자리에 두 일을 시키지 않는다', () => {
  const 껍데기 = 읽기('src/components/home/HomeShell.jsx')
  const i = 껍데기.indexOf('<header')
  const j = 껍데기.indexOf('</header>')
  assert.ok(i >= 0 && j > i, '머리줄을 못 찾았다')
  const 머리 = 껍데기.slice(i, j)

  // ① 이름표는 간편 화면으로 간다 — 웹에서 왼쪽 위 이름의 자리다.
  assert.match(머리, /onClick=\{\(\) => onNavigate\('\/simple'\)\}/,
    '이름표가 간편 화면으로 안 간다 — 「처음으로」 자리가 죽었다')
  assert.match(머리, /CareCast/, '이름표 글자가 사라졌다')

  // ② 메뉴는 **따로 선다.**
  assert.match(머리, /<HomeBrandMenu\s/, '머리줄에 메뉴 단추가 없다')
  const 메뉴 = 읽기('src/components/home/HomeBrandMenu.jsx')
  // **주석을 걷고 본다.** 이 파일의 머리말이 *"한때 이름표(CareCast)를 눌러 열었다"* 고
  // 적고 있어서, 그냥 훑으면 **설명하려고 적어 둔 옛 이야기**에 걸린다
  // (`bottom-bars-stack` 도 같은 함정에 한 번 걸렸다 — 고친 사실을 적어 두는
  // 저장소일수록 자주 난다).
  const 메뉴코드 = 메뉴.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(메뉴코드, /CareCast/,
    '메뉴 단추가 아직 이름표 노릇을 한다 — 둘은 다른 단추여야 한다')
  assert.match(메뉴, /aria-haspopup="menu"/, '메뉴라는 것을 보조기술이 못 읽는다')
})

test('**폰에서 잘리지 않는다** — 폭·높이를 화면에 맞춘다', () => {
  // 390px 폰에서 고정 폭을 주면 오른쪽이 잘리고, 설정 일곱 줄이 낮은 창에서 넘친다.
  assert.match(메뉴, /w-\[min\(/, '메뉴 폭이 화면에 안 맞춰져 있다')
  assert.match(메뉴, /max-h-\[min\(/, '메뉴 높이가 화면에 안 맞춰져 있다')
  assert.match(메뉴, /overflow-y-auto/, '넘치는 줄을 굴릴 수 없다')
})

test('**닫을 길이 있다** — 폰에는 Escape 가 없다', () => {
  assert.match(메뉴, /pointerdown/, '바깥을 눌러 닫는 길이 없다 — 폰에서는 못 닫는다')
  assert.match(메뉴, /'Escape'/, 'Escape 로 닫는 길이 없다')
})

// ── **별도 껍데기로 가는 곳은 통째로 연다** (사용자 지적 2026-09-15) ────────────────
// 메뉴에서 「시스템 안내도」를 눌렀더니 **빈 화면**이 떴다.
//
// `App.jsx` 는 주소 몇 개를 **주소를 보고 껍데기를 통째로 갈아 끼우는** 방식으로 그린다
// (`_IS_GUIDE` 처럼 모듈 로드 때 한 번 계산한다 — 방송 코드를 안 태우려는 것이다).
// 그 주소는 **주 `Routes` 에 없다.** 그래서 앱 안에서 `navigate` 로 주소만 바꾸면
// 아무 길도 안 맞고 화면이 빈다.
//
// **이 저장소가 이미 겪고 적어 둔 함정이다** — `admin/Sidebar.jsx` 의 「시스템 안내도」가
// 그래서 `navigate()` 가 아니라 `<a href>` 다(*"/dev-console 에서 이미 한 번 겪은 함정"*).
// 이 메뉴가 그것을 그대로 밟았다. 세 번째가 없게 여기서 고정한다.

test('**껍데기가 갈리는 주소는 메뉴가 통째로 연다** — App.jsx 와 대조', () => {
  const 앱 = 읽기('src/App.jsx')
  // `App.jsx` 에서 **별도 껍데기로 그리는 주소**를 그대로 꺼낸다. 여기 다시 적으면
  // 새 껍데기가 생기는 날 이 시험만 낡는다.
  const 껍데기주소 = [...앱.matchAll(/const _IS_[A-Z_]+ = window\.location\.pathname === '([^']+)'/g)]
    .map(m => m[1])
  assert.ok(껍데기주소.length >= 2,
    `별도 껍데기 주소를 ${껍데기주소.length}개만 찾았다 — 꼴이 바뀌었으면 이 시험도 옮길 것`)

  const 메뉴 = 읽기('src/components/home/HomeBrandMenu.jsx')
  // 메뉴의 줄을 통째로 읽어 `통째로` 표시가 붙었는지 본다.
  // 메뉴 줄은 **한 줄에 하나**라, 줄 단위로 읽는다(정규식에 줄바꿈을 넣지 않는다).
  const 줄들 = 메뉴.split(/\r?\n/)
    .filter(l => l.includes("to: '"))
    .map(l => ({ to: /to: '([^']+)'/.exec(l)[1], 통째로: /통째로:\s*true/.test(l) }))
  assert.ok(줄들.length >= 10, `메뉴 줄을 ${줄들.length}개만 읽었다 — 꼴이 바뀌었나`)

  for (const 줄 of 줄들) {
    if (!껍데기주소.includes(줄.to)) continue
    assert.ok(줄.통째로,
      `메뉴가 「${줄.to}」 로 navigate 한다 — 그 주소는 별도 껍데기라 빈 화면이 된다`)
  }
  // 긍정 앵커 — 실제로 그런 줄이 하나는 있어야 이 시험이 뜻이 있다.
  assert.ok(줄들.some(줄 => 껍데기주소.includes(줄.to)),
    '메뉴에 별도 껍데기로 가는 줄이 하나도 없다 — 이 시험이 아무것도 안 잰다')
})

test('**통째로 여는 길이 실제로 구현돼 있다**', () => {
  const 메뉴 = 읽기('src/components/home/HomeBrandMenu.jsx')
  const 코드만 = 메뉴.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  // `location.href = …` 가 아니라 `assign()` 을 본다 — 대입은
  // `react-hooks/immutability` 가 막아서 그 꼴로는 못 쓴다.
  assert.match(코드만, /window\.location\.assign\(/,
    '표시만 있고 통째로 여는 코드가 없다 — 표시는 붙었는데 여전히 navigate 한다')
})
