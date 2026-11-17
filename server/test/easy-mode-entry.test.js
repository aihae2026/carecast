'use strict'
// UX-14 — **가장 쉬운 자동방송 설정 경로가 우선 노출된다** (2026-09-11).
//
// 쉬운 화면에는 차임벨·즉시방송·TTS·일정·BGM·음량이 이미 있다. 없던 것은 **자동방송
// 설정으로 바로 가는 길**이었다 — "상세 설정" 한 칸뿐이라 거기 들어가서 8개 메뉴 중에
// 찾아야 했다. 현장 선생님이 제일 자주 바꾸는 것이 방송 순서·시각이다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const EASY = fs.readFileSync(path.join(ROOT, 'src/pages/EasyMode.jsx'), 'utf8')

test('쉬운 화면에 자동방송 설정으로 가는 길이 있다', () => {
  assert.match(EASY, /section=morningEditor/,
    '자동방송 편집으로 바로 가는 길이 없다 — 상세 설정에 들어가 8개 중에 찾아야 한다')
  assert.match(EASY, /자동방송 설정/, '버튼에 무엇인지 안 적혀 있다')
})

test('**경로가 실제로 전달된다** — 인자를 버리면 어디를 눌러도 첫 화면이다', () => {
  // 여기가 진짜 함정이었다. `MobileLayout` 은 `() => navigate('/admin')` 을 받고 있어서
  // **인자를 통째로 버렸다.** 링크를 아무리 잘 적어도 관리자 첫 화면으로만 갔다.
  assert.doesNotMatch(EASY, /MobileLayout onNavigate=\{\(\) =>/,
    '모바일 쪽이 경로 인자를 버린다 — 구체적인 목적지를 못 보낸다')
  assert.match(EASY, /MobileLayout onNavigate=\{\(to\) =>/,
    '모바일 쪽이 경로를 안 받는다')
  // 인자가 없을 때의 기본값도 살아 있어야 한다 — 인자 없이 부르는 곳이 실제로 있다.
  //
  // 2026-09-13: 그 기본값이 `/admin` → **`/calendar`** 로 바뀌었다(사용자 지시).
  // 인자 없이 부르는 곳은 「전체 예약 관리」 하나이고, 그 이름이 가리키는 곳은
  // 관리자 첫 화면이 아니라 **달력**이다. 사용자 원문: *"왜 사진 이미지가 와
  // 캘린더 화면으로 와야지"*. 여기서 보는 사실은 그대로다 — **기본값이 있는가.**
  assert.match(EASY, /navigate\(to \|\| '\/calendar'\)/, '인자 없이 부르던 기존 호출이 깨진다')
})

test('받는 쪽이 그 파라미터를 읽는다 — 배선의 반대편', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'src/pages/AdminMode.jsx'), 'utf8')
  assert.match(admin, /searchParams\.get\('section'\)/,
    '관리자 화면이 ?section= 을 안 읽는다 — 링크가 아무 데도 안 간다')
  // 2026-09-13: 주소를 **한 번만** 읽던 것을 고쳤다. 예전엔 `sectionParam` 을 뽑아
  // 그것으로 `useState` 초기값을 정했는데, 그 값은 **마운트 때 한 번만** 읽힌다 —
  // 탭·메뉴를 눌러 주소가 바뀌어도 화면이 그대로였다(주소는 52ms 만에 바뀌고 있었다).
  // 이제 주소가 단일 출처라 매 렌더에서 다시 해석한다.
  //
  // 지키는 것은 그대로다 — *"`?section=` 을 화면으로 옮기는가"*. 중간 변수 이름이 아니라
  // **해석 함수에 주소가 그대로 들어가는가**를 본다(변수 이름에 묶이면 또 낡는다).
  assert.match(admin, /resolveSection\(searchParams\.get\('section'\)\)/,
    '섹션 이름을 화면으로 못 옮긴다 — 주소를 해석에 안 넘긴다')
})

test('기존 항목이 사라지지 않았다 — 있던 것을 잃으면 안 된다', () => {
  // 「유튜브 BGM」은 2026-09-21 「배경음악」(이 PC 음원)으로 바뀌었다 — 자리는 그대로다.
  for (const 이름 of ['차임벨 · 즉시방송', 'TTS 방송', '오늘 방송 일정', '배경음악', '음량 제어']) {
    assert.ok(EASY.includes(이름), `쉬운 화면에서 "${이름}" 이 사라졌다`)
  }
  assert.match(EASY, /상세 설정/, '기존 상세 설정 버튼이 사라졌다')
})

// ── 2026-09-13 — 「전체 예약 관리」와 왼쪽 위 이름표 ─────────────────────────
//
// 사용자 지적: *"쉬운화면에서 전체예약관리하면 왜 사진 이미지가 와 캘린더 화면으로
// 와야지"*. 그 단추는 `/admin?section=scheduledBroadcast` 로 갔다 — 관리자 껍데기 안의
// 달력이라, 왼쪽 사이드바에 밀려 좁고 「방송일정 및 예약」 제목이 두 번 나온다.
// 이름이 가리키는 곳은 **달력 화면**(`/calendar`)이다.

test('「전체 예약 관리」는 달력으로 간다 — 관리자 껍데기 안이 아니라', () => {
  const 본곳 = []
  for (const p of ['src/pages/EasyMode.jsx', 'src/components/home/HomeToday.jsx']) {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8')
    본곳.push(p)
    assert.ok(!/onNavigate\(['"]\/admin\?section=scheduledBroadcast['"]\)/.test(s),
      `${p} 의 「전체 예약 관리」가 아직 관리자 껍데기로 간다`)
  }
  assert.equal(본곳.length, 2, '볼 파일이 줄었다 — 목록이 조용히 헐거워졌다')
  // 긍정 앵커 — 달력으로 가는 길이 실제로 있는가
  const home = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeToday.jsx'), 'utf8')
  assert.match(home, /onNavigate\('\/calendar'\)/, '달력으로 가는 길이 없다')
})

// ── **이름표는 이제 메뉴를 연다** (사용자 지시 2026-09-15) ─────────────────────
// 앞 판(2026-09-13)은 이름표가 「간편 화면」 한 곳으로만 갔고, 이 시험이 그것을 고정했다.
// 그런데 이 자리는 **"여기서 어디로 갈 수 있나"를 묻는 자리**이기도 하다 — 그 답이
// 탭 줄·서랍·관리자 사이드바 셋으로 흩어져 있었고, 간편·캘린더 화면에서는
// 대시보드·방송 로그·비상 방송 관리로 갈 길이 **아예 없었다.**
//
// **시험을 지우지 않고 뒤집는다.** 지키려던 뜻(이름표에서 간편으로 갈 수 있어야 한다)은
// 그대로 살아 있다 — 메뉴 **맨 위**가 「간편」이다. 그 보장은
// `server/test/brand-menu.test.js` 가 맡고, 여기서는 **이름표가 메뉴라는 것**만 본다.
test('왼쪽 위 이름표가 전체 메뉴를 연다', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeShell.jsx'), 'utf8')
  const i = shell.indexOf('<header')
  const j = shell.indexOf('</header>')
  assert.ok(i >= 0 && j > i, '머리줄을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 머리 = shell.slice(i, j)
  assert.match(머리, /<HomeBrandMenu\s/, '머리줄에 이름표 메뉴가 없다')

  const 메뉴 = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeBrandMenu.jsx'), 'utf8')
  assert.match(메뉴, /CareCast/, '이름표 글자가 사라졌다')
  assert.match(메뉴, /aria-haspopup="menu"/, '메뉴라는 것을 보조기술이 못 읽는다')
})
