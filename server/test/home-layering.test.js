// 통합 홈에 **떠 있는 것들**이 본문을 가리지 않는다 (8단계, 2026-09-13).
//
// 이 화면 아래·오른쪽에는 네 가지가 본문 위에 떠 있다:
//
//   서랍 손잡이   `fixed right-0`, 폭 28px, 세로 가운데(54%)
//   재생 바       `fixed bottom-0`, 높이 40px
//   소리 켜기 알약 `fixed bottom-[52px]`, 높이 ~44px  → 52~96px 대역
//   방송 화면 단추 `fixed bottom-[140px]`, 높이 44px  → 140~184px 대역
//
// 넓은 화면에서는 본문이 가운데로 모여 안 닿는다. **좁은 화면에서 닿는다** —
// 그래서 1440 만 보고 지나가면 못 본다. 390·834 에서 실제로 셋이 겹쳤다:
//
//   · 손잡이가 「4건 완료 · 4건 대기 · **1건 안 나감**」의 끝을 12px 가렸다(390).
//   · 소리 켜기 알약이 「12:59 프로그램실 안내」·「안 나감」·「BGM 대기 중」을 덮었다(390).
//   · 「방송 화면」 단추 밑에 「전체 예약 관리」가 깔려 **안 눌렸다**(834, 맨 아래까지 내렸을 때).
//
// 셋 다 "글자가 작다"가 아니라 **"정보가 안 보인다·단추가 안 눌린다"** 라서 더 비싸다.
// 특히 「안 나감」은 이 화면에서 가장 비싼 말이다.
//
// 이 시험은 **숫자끼리의 관계**를 본다 — 아래 여백이 떠 있는 것들의 키보다 큰가.
// 값을 하나 박아 두면 다음 사람이 알약을 옮길 때 이 시험이 막고 선다(이 작업에서
// 그런 시험을 넷이나 고쳤다). 관계로 두면 옮기되 **같이 옮기게** 된다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n')
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const SHELL = 'src/components/home/HomeShell.jsx'
const IND   = 'src/components/broadcast/BroadcastIndicators.jsx'
const TODAY = 'src/components/home/HomeToday.jsx'
const PHRASE = 'src/components/shared/QuickSchedulePhrase.jsx'

test('감시할 대상이 그 자리에 있다', () => {
  for (const p of [SHELL, IND, TODAY, PHRASE])
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} 가 없다 — 옮겼으면 이 시험도 같이 옮긴다`)
})

test('본문 아래 여백이 떠 있는 것들의 키보다 크다', () => {
  const shell = codeOnly(read(SHELL))
  const ind   = codeOnly(read(IND))

  // 떠 있는 것들의 꼭대기를 읽는다(화면 아래에서부터의 거리).
  // **앵커가 옮겨졌다**(2026-09-16): 옛 이름표 `cc-primary` 를 새 이름표 `ds-v3-tts` 로
  // 바꿨다 — **색값은 글자 하나까지 같다**(#2563EB). 이 시험이 재는 것(떠 있는 것의
  // 높이)은 그대로다.
  const 알약 = ind.match(/fixed bottom-\[(\d+)px\][^"']*?rounded-full bg-ds-v3-tts/s)
  assert.ok(알약, '소리 켜기 알약의 자리를 못 찾았다 — 옮겼으면 이 시험도 같이 옮긴다')
  const 알약바닥 = Number(알약[1])

  // ── 2026-09-14: 자리가 **인라인 스타일에서 클래스로** 옮겨졌다 ─────────────────
  // 좁은 화면에서 이 단추가 목록의 「1차·2차」를 덮어서(390px 실측) 폭에 따라 자리를
  // 달리하게 됐다 — 인라인 스타일로는 그렇게 못 한다. **지키려는 사실은 그대로다**:
  // 본문 아래 여백이 이 단추의 꼭대기보다 커야 맨 아래 줄이 안 가린다.
  // 값이 둘이면 **큰 쪽**으로 잰다 — 작은 쪽만 보면 넓은 화면에서 조용히 겹친다.
  const 단추들 = [...ind.matchAll(/bottom-\[(\d+)px\]/g)].map(m => Number(m[1]))
  assert.ok(단추들.length > 0, '「방송 화면」 단추의 자리를 못 찾았다 — 옮겼으면 이 시험도 같이 옮긴다')
  const 단추바닥 = Math.max(...단추들)

  const 여백 = codeOnly(read(SHELL)).match(/pb-\[(\d+)px\]/)
  assert.ok(여백, `${SHELL} 의 본문 아래 여백이 고정값이 아니다 — 관계를 못 잰다`)
  const 아래여백 = Number(여백[1])

  // 각 요소의 **꼭대기**(바닥 거리 + 제 키)보다 여백이 커야 맨 아래까지 내렸을 때 안 겹친다.
  // 알약·단추 모두 최소 타격 44px 이다.
  assert.ok(아래여백 >= 알약바닥 + 44,
    `아래 여백 ${아래여백}px 가 소리 켜기 알약(${알약바닥}~${알약바닥 + 44}px)을 못 비킨다`)
  assert.ok(아래여백 >= 단추바닥 + 44,
    `아래 여백 ${아래여백}px 가 「방송 화면」 단추(${단추바닥}~${단추바닥 + 44}px)를 못 비킨다`
    + ' — 맨 아래까지 내리면 마지막 줄이 그 밑에 깔려 안 눌린다(834px 에서 실제로 그랬다)')

  // 알약은 재생 바(40px) 위에 있어야 한다 — 바에 깔리면 글자가 반만 보인다.
  assert.ok(알약바닥 >= 40, `소리 켜기 알약이 재생 바(40px)에 깔린다(${알약바닥}px)`)
  void shell
})

test('좁은 화면에서 서랍 손잡이 자리를 비워 둔다', () => {
  // 손잡이는 `fixed right-0` 이고 폭이 28px(`w-7`)다. 본문이 가장자리까지 차는 폭에서
  // 오른쪽 끝 글자를 가린다 — 실측에서 「1건 안 나감」이 12px 잘렸다.
  const shell = codeOnly(read(SHELL))
  assert.match(shell, /w-7/, '손잡이 폭이 바뀌었다 — 아래 여백값을 다시 볼 것')
  // ── 2026-09-14 정정: **오른쪽만** 비우면 화면이 왼쪽으로 치우친다 ──────────────
  // 앞 판은 `pr-8` 을 요구했다. 손잡이가 오른쪽에 있으니 맞는 말 같지만, 안쪽 내용이
  // `mx-auto` 로 **가운데 맞춤**이라 남은 폭의 가운데에 선다 — 결과는 전체가 16px 왼쪽으로
  // 쏠린 화면이었다(430px 실측: 제목 left 0 / right 32). 사용자가 사진으로 짚은 그 증상이다.
  // 지키려던 사실(**끝 글자가 손잡이에 안 가린다**)은 그대로고, 푸는 법만 대칭으로 바꿨다.
  assert.match(shell, /px-8 wide:px-0/,
    '좁은 화면에서 손잡이 자리를 안 비운다 — 오른쪽 끝 글자가 가려진다')
  assert.doesNotMatch(shell, /pr-8 wide:pr-0/,
    '한쪽만 비우던 때로 돌아갔다 — 가운데 맞춤과 겹쳐 화면이 왼쪽으로 쏠린다')
  // 넓은 화면에서는 도로 붙인다(본문이 가운데로 모여 안 닿으므로 군더더기 여백이다).
  assert.match(shell, /onToggleDrawer \? 'px-8/,
    '여는 길이 없는 화면에도 여백을 준다 — 손잡이가 없으면 그 자리도 없어야 한다')
})

// ── 2026-09-15: 탭이 **다섯에서 둘로** 줄었다 (사용자 결정) ────────────────────
// *"위에 간편화면이랑 캘린더만 띄워주는건 어때 토글로."*
// 나머지 셋(자동순서·업로드·설정)은 **서랍의 「관리」 줄**로 내려갔다.
//
// **지켜야 할 사실은 그대로다** — 이름표와 도착지가 갈리면 조용히 엉뚱한 화면이 뜬다.
// 그래서 **다섯을 다 본다.** 다만 둘은 탭에서, 셋은 서랍에서 찾는다.
// 어느 하나라도 **아무 데도 없으면** 그건 줄인 것이 아니라 잃은 것이다.
test('다섯 화면 모두 — 이름표와 도착지가 짝을 잃지 않는다(탭 둘 + 서랍 셋)', () => {
  const shell = codeOnly(read(SHELL))
  const admin = codeOnly(read('src/pages/AdminMode.jsx'))
  const 관리 = codeOnly(read('src/components/home/HomeAdminLinks.jsx'))

  for (const [이름, 길, 어디] of [
    ['간편',     '/simple',   shell],
    ['캘린더',   '/calendar', shell],
    // 「자동순서」도 제 화면이 됐다(2026-09-13). 탭으로 도착했는데 관리자 사이드바가
    // 붙어 있어 "설정 안"으로 읽혔다 — 캘린더·업로드와 같은 층으로 올렸다.
    ['자동 순서', '/flow',    관리],
    // 「업로드」는 **제 화면**이다(2026-09-13). 처음엔 `/admin?section=musicManagement` 로
    // 보냈는데, 그러면 도착한 화면에 관리자 사이드바가 그대로 붙어 "설정 안에 들어와 있다"로
    // 읽혔다 — 꺼낸 뜻이 없어진다. 캘린더와 같은 층이어야 층이 실제로 갈린다.
    ['업로드',   '/upload',   관리],
    ['설정',     '/admin\\?section=systemSettings', 관리],
  ]) {
    assert.match(어디, new RegExp(`label: '${이름}',\\s*to: '${길}'`),
      `「${이름}」의 도착지가 바뀌었거나 아무 데도 없다 — 탭에서 빼면서 잃어버린 것이 아닌지 볼 것`)
  }
  // 탭은 **다섯**이고 그림이 다 붙어 있다(하나만 빠지면 그 칸만 글자가 붕 뜬다).
  // 2026-09-15 오후 정정으로 다섯이 됐다 — 좁은 화면에서만 셋이 감춰진다
  // (*"저건 모바일에서만 적용하라고"*). 감추는 것은 CSS 이고 목록은 그대로다.
  assert.equal((shell.match(/Icon: [A-Z]\w+/g) || []).length, 5,
    '머리줄 탭이 다섯이 아니다 — 줄였으면 어디로 갔는지 적고, 좁은 화면 규칙도 같이 볼 것')
  // 서랍 줄에도 **그림이 다 붙어 있다.**
  //
  // **개수로 박지 않는다**(2026-09-16 정정). 앞 판은 `=== 4` 였는데, 지키려던 사실은
  // 「넷이다」가 아니라 **「한 줄이라도 그림이 빠지면 그 칸만 글자가 붕 뜬다」** 이다.
  // 휴대폰에서 머리줄 메뉴를 걷으면서 「대시보드」·「방송 로그」가 이 줄로 내려왔고,
  // **옳은 변경이 개수 때문에 빨간불을 냈다.** 이제 이름과 그림의 **짝**을 센다 —
  // 줄이 몇이든 짝이 맞아야 한다는 조건은 그대로다.
  const 이름수 = (관리.match(/label: '/g) || []).length
  const 그림수 = (관리.match(/Icon: [A-Z]\w+/g) || []).length
  assert.ok(이름수 >= 4, `서랍 「관리」 줄이 ${이름수}개뿐이다 — 내려온 화면을 잃었는지 볼 것`)
  assert.equal(그림수, 이름수,
    `서랍 「관리」 줄의 이름 ${이름수}개 중 그림이 ${그림수}개다 — 빠진 칸만 글자가 붕 뜬다`)
  // **사용자가 이름을 대서 요청한 입구** — 없어지면 안 된다.
  assert.match(관리, /전체 예약 관리/,
    '간편화면에서 전체 예약 관리로 가는 입구가 사라졌다(사용자 지시 2026-09-15)')

  // ── 각 화면은 **제 이름을 계속 댄다** ───────────────────────────────────────
  // 2026-09-15 오전에 탭을 둘로 줄이면서 `media`·`flow`·`settings` 가 **머리줄에 없는
  // 이름**이 됐다가, 오후에 사용자가 정정해 **다섯으로 되돌렸다**
  // (*"저건 모바일에서만 적용하라고"*). 그때 **이름을 지우지 않고 남겨 둔 것이 값을 했다** —
  // 되돌릴 때 고칠 것이 없었다. 지웠다면 세 화면이 조용히 불이 안 들어왔을 것이다.
  assert.match(admin, /activeSection === 'musicManagement' \? 'media'/,
    '옛 주소로 들어온 업로드 화면이 제 이름을 안 댄다')
  assert.match(codeOnly(read('src/pages/UploadMode.jsx')), /tab="media"/,
    '독립 업로드 화면이 제 이름을 안 댄다')
  assert.match(codeOnly(read('src/pages/FlowMode.jsx')), /tab="flow"/,
    '독립 자동순서 화면이 제 이름을 안 댄다')
  // 이제 머리줄이 그 이름을 **안다** — 그래야 그 화면에서 불이 들어온다.
  assert.match(shell, /id: 'media'/,
    '머리줄에 media 탭이 없다 — 업로드 화면에서 아무 탭도 불이 안 들어온다')

  // ── 관리자 화면이 **주소에 반응하나** ──────────────────────────────────────
  // 예전에는 주소를 마운트 때 한 번만 읽어서, `/admin` 안에서 탭을 눌러도 주소만 바뀌고
  // 화면은 그대로였다(실측: 주소 52ms 만에 바뀜 · 화면 안 바뀜). 사용자에게는
  // *"이동이 뭔가 막히는듯한 느낌"* 으로 보였다.
  assert.match(admin, /resolveSection\(searchParams\.get\('section'\)\)/,
    '관리자 화면이 주소에서 직접 안 읽는다 — 주소가 바뀌어도 화면이 안 따라간다')
  assert.doesNotMatch(admin, /useState\(\(\) => \{[\s\S]{0,120}searchParams\.get/,
    '주소를 마운트 때 한 번만 읽는 옛 방식이 돌아왔다')
  assert.doesNotMatch(admin, /setSearchParams\(\{\}\)/,
    '화면을 옮기며 주소를 지운다 — 화면과 주소가 갈리고 새로고침하면 대시보드로 떨어진다')

  // 사이드바에서 뺀 둘이 돌아오지 않았나 — 돌아오면 한 화면이 두 모습으로 보인다.
  const side = codeOnly(read('src/components/admin/Sidebar.jsx'))
  for (const id of ['weeklySchedule', 'musicManagement'])
    assert.doesNotMatch(side, new RegExp(`id: '${id}'`),
      `사이드바에 「${id}」 입구가 돌아왔다 — 탭으로 꺼낸 화면이라 길이 둘이 된다`)
  // 화면 자체는 살아 있어야 한다(옛 주소가 죽으면 저장해 둔 링크가 깨진다).
  for (const id of ['weeklySchedule', 'musicManagement'])
    assert.match(admin, new RegExp(`${id}:\\s*\\{ Component`),
      `「${id}」 화면이 사라졌다 — 입구만 빼기로 했지 화면을 지우기로 한 것이 아니다`)

  // ── 2026-09-15: **세로로 쌓지 않는다** ─────────────────────────────────────
  // 다섯이던 때는 쌓아야 했다(가로로는 423px > 쓸 수 있는 358px). 둘이면 가로로 놓아도
  // 140px 안쪽이라 이름표 옆에 같은 줄로 앉는다 — 쌓으면 오히려 머리줄이 높아진다.
  // **개수와 배치는 한 몸이다.** 탭을 늘리면 `mobile-simple-layout` 이 먼저 걸리고,
  // 거기서 다시 폭을 재게 되어 있다.
  assert.doesNotMatch(shell, /flex-col gap-0\.5[\s\S]{0,60}tablet:flex-row/,
    '탭을 다시 세로로 쌓는다 — 둘이면 가로로 들어가고, 쌓으면 머리줄만 높아진다')
})

test('시계는 한 곳에서만 짓고, 세 머리줄이 초까지 같이 그린다', () => {
  // 머리줄이 셋이다 — 통합 홈 · 간편 · 쉬운 화면. **같은 PC 에서 위아래로 보인다.**
  // 하나는 `09:07`, 하나는 `09:07:42` 면 어느 쪽이 진짜인지 묻게 된다(사용자 지시
  // 2026-09-14: *"시간 초단위 안해놨네?"* — 그때 홈과 간편이 분까지만이었다).
  const clock = read('src/lib/clock.js')
  assert.match(clock, /export function formatDate/, 'clock.js 에 formatDate 가 없다')
  assert.match(clock, /export function formatTime/, 'clock.js 에 formatTime 이 없다')
  // `formatTime` 이 정말 초를 그리나 — 이름만 보고 믿지 않는다.
  assert.match(codeOnly(clock), /getSeconds\(\)/,
    'formatTime 이 초를 안 읽는다 — 이름만 시:분:초다')

  // 세 화면 전부 **공용 모듈의 초 있는 함수**를 쓴다.
  //
  // **「직접 짓는 시계가 없나」는 글자로 못 본다.** 처음에 `getHours()).padStart` 가
  // 없을 것으로 걸었다가 간편 화면에서 빨간불이 났는데, 걸린 것은 시계가 아니라
  // `nextToday` 가 **예약 시각과 비교하려고** 만드는 `hhmm` 키였다 — 화면에 그리는
  // 시계와 비교용 키는 생김새가 한 글자도 다르지 않다. 무엇에 쓰이는지로만 갈린다.
  //
  // 그래서 **긍정 단언에 기댄다.** 어느 화면이 제 시계로 돌아가면 `formatTime(` 이
  // 사라지고, 들여온 채 안 쓰면 eslint(no-unused-vars)가 잡는다. 두 그물이 겹친다.
  const 머리줄들 = [
    ['src/components/easy/TopBar.jsx',      /from '\.\.\/\.\.\/lib\/clock'/],
    ['src/components/home/HomeClock.jsx',   /from '\.\.\/\.\.\/lib\/clock'/],
    ['src/pages/SimpleMode.jsx',            /from '\.\.\/lib\/clock'/],
  ]
  for (const [파일, 들여옴] of 머리줄들) {
    const src = codeOnly(read(파일))
    assert.match(src, 들여옴,           `${파일} 가 공용 시계 모듈을 안 쓴다`)
    assert.match(src, /formatTime\(/,   `${파일} 가 초 없는 시계를 그린다`)
    assert.doesNotMatch(src, /function formatDate/,
      `${파일} 가 날짜 짓는 법을 다시 갖고 있다 — 두 벌이 되면 갈린다`)
  }
})

test('초안이 열리면 오늘 일과가 옆으로 간다 — 화면 밖으로 안 밀린다', () => {
  // 초안 카드는 세로로 400px 넘게 자란다. 스택이면 오늘 일과가 화면 밖으로 밀려서,
  // **방금 만든 예약이 오늘 어디에 끼는지** 보려면 스크롤을 내려야 했다(사용자 지적).
  const home   = codeOnly(read('src/pages/HomeMode.jsx'))
  const phrase = codeOnly(read(PHRASE))

  // 입력창이 초안 상태를 바깥에 알리나 — 이것이 없으면 홈이 언제 벌릴지 모른다.
  assert.match(phrase, /onDraftChange/, '입력창이 초안 열림을 안 알린다')
  assert.match(phrase, /알린초안\.current = 열림/,
    '값이 바뀔 때만 알리는 빗장이 없다 — 매 렌더마다 부르면 부모가 계속 다시 그린다')

  assert.match(home, /onDraftChange=\{set초안열림\}/, '홈이 초안 열림을 안 받는다')

  // **값이 아니라 관계를 본다.** 칸 폭은 앞으로도 조정될 값이라(380 으로 시작했다가
  // 이름이 두 줄로 깨져 480 으로 넓혔다) 숫자를 박으면 다음 조정 때 시험이 막고 선다 —
  // 이 작업에서 그런 시험을 넷이나 고쳤다.
  const 격자 = home.match(/두칸\s*\?\s*'grid-cols-\[minmax\(0,(\d+)px\)_minmax\(0,(\d+)px\)\]/)
  assert.ok(격자, '초안이 열려도 두 칸으로 안 벌어진다')
  const [, 왼쪽, 오른쪽] = 격자.map(Number)

  // ① 두 칸이 1280(본문 최대폭)에 들어가야 한다 — 안 그러면 가로로 넘친다.
  assert.ok(왼쪽 + 오른쪽 + 24 <= 1280,
    `두 칸 합(${왼쪽}+${오른쪽}+여백24)이 본문 최대폭 1280 을 넘는다`)
  // ② 왼쪽 칸이 오늘 일과의 **한 줄이 안 깨질 만큼**은 돼야 한다.
  //    시각칸 140 + 재생 44 를 빼고 나면 이름·꼬리표·상태가 쓸 폭이 남는데,
  //    380 에서는 그것이 196px 이라 꼬리표가 둘째 줄로 내려갔다(사용자 지적 2026-09-13).
  assert.ok(왼쪽 - 140 - 44 >= 280,
    `왼쪽 칸 ${왼쪽}px 에서 이름·꼬리표가 쓸 폭이 ${왼쪽 - 184}px 뿐이다 — 줄이 깨진다`)
  // ③ 격자의 왼쪽 칸과 그 안에 든 상자의 최대폭이 **같아야** 한다. 갈리면 둘 중
  //    좁은 쪽이 이겨서, 격자를 넓혀도 안이 안 넓어진다(조용히 안 먹는 종류).
  const 안쪽 = home.match(/두칸\s*\?\s*'max-w-\[(\d+)px\]/)
  assert.ok(안쪽, '왼쪽 칸 안 상자의 최대폭이 없다')
  assert.equal(Number(안쪽[1]), 왼쪽,
    `격자 왼쪽 칸(${왼쪽}px)과 그 안 상자(${안쪽[1]}px)가 다르다 — 좁은 쪽이 이긴다`)

  assert.match(home, /col-start-1[\s\S]{0,260}HomeToday/,
    '오늘 일과가 왼쪽 칸으로 안 간다')
  // **좁은 화면에서는 벌리지 않는다.** 두 칸이 각각 너무 좁아지면 둘 다 못 읽는다.
  // 2026-09-17: `wide:`(CSS 창 폭) 대신 **보이는 폭**(창 ÷ 배율)으로 가른다 — 크게 보기가 CSS 조건을 속였다.
  const 문턱 = home.match(/const 두칸최소폭 = (\d+)/)
  assert.ok(문턱, '두 칸 문턱이 없다')
  assert.ok(Number(문턱[1]) >= 왼쪽 + 오른쪽 + 24, `문턱 ${문턱[1]} 이 두 칸 합보다 작다 — 가로로 넘친다`)
  assert.match(home, /const 두칸 = 초안열림 && 보이는폭 >= 두칸최소폭/, '두 칸이 보이는 폭과 무관하게 선다')
  for (const m of home.matchAll(/grid-cols-\[minmax\(0,\d+px\)/g)) {
    assert.match(home.slice(Math.max(0, m.index - 20), m.index), /두칸\s*\?\s*'$/,
      '좁은 화면에서도 두 칸으로 벌린다 — 거기서는 쌓는 편이 낫다')
  }
})

test('손으로 누르는 것은 44px 이상이다 (G-15)', () => {
  // 390px 실측에서 셋이 44px 아래였다. 주 사용자가 50~60대이고 손가락에는 hover 가 없다.
  const today  = codeOnly(read(TODAY))
  const phrase = codeOnly(read(PHRASE))

  // ① 「지금 내보내기」 — 좁은 화면 44px, 넓은 화면은 34px 그대로(마우스가 정확하다).
  //    **키워도 안전한 이유**를 같이 고정한다: 누르면 확인 한 단계가 먼저 선다(G-42).
  //    확인이 사라지면 이 단추를 키운 근거도 사라진다.
  assert.match(today, /h-11 w-11[\s\S]{0,80}tablet:h-\[34px\]/,
    '「지금 내보내기」가 좁은 화면에서 44px 이 아니다')
  assert.match(today, /onClick=\{\(\) => setAsk\(r\)\}/,
    '「지금 내보내기」가 확인 없이 바로 발사한다 — 그러면 타격을 키운 것이 위험해진다')

  // ② ── 2026-09-14: **예시 알약이 없어졌다**(사용자 지시) ─────────────────────
  //    「매일 오후 3시에 산책 안내」 같은 단추 셋을 뺐다 — 예시는 입력창 안의 빈 상태
  //    안내가 맡는다. 그래서 그 알약의 타격을 지키던 이 단언은 **볼 대상이 없다.**
  //    지키려던 것(손으로 누르는 것은 44px)은 그대로이므로, **지금 그 자리에 있는 것**을
  //    본다 — 바로 시작 단추 넷·차임벨, 그리고 차임 설정 토글 둘.
  assert.match(phrase, /min-h-\[44px\] rounded-full border px-3\.5/,
    '바로 시작 단추가 44px 이 아니다')
  assert.match(phrase, /min-h-\[44px\] flex-1 rounded-\[10px\] border px-3/,
    '차임 설정 토글이 44px 이 아니다')
  // ③ 보내기 화살표
  assert.match(phrase, /inline-flex h-11 w-11 flex-none[\s\S]{0,140}bg-ds-v3-ink/,
    '보내기 화살표가 44px 이 아니다')

  // 되돌아오지 않았는가 — 이 셋이 이 파일에서 다시 작아지는 것을 막는다.
  assert.doesNotMatch(today,  /h-\[34px\] w-\[34px\] items-center/,
    '「지금 내보내기」가 모든 폭에서 34px 로 돌아갔다')
  assert.doesNotMatch(phrase, /min-h-\[36px\] rounded-full/, '바로 시작 단추가 36px 로 돌아갔다')
  assert.doesNotMatch(phrase, /h-\[42px\] w-\[42px\]/, '보내기 화살표가 42px 로 돌아갔다')
})

test('설정 화면: 제목 밑에 설명이 있고, 위계가 안 뒤집힌다', () => {
  // 사용자 지시 2026-09-13: *"토글제목이랑 각 내용 제목 맞춰 밑에 설명 적어주고"*.
  //
  // ① 갈래 셋에 **안에 무엇이 있는지** 한 줄. 제목만 있으면 「기타」 같은 이름은
  //    아무것도 안 가리킨다. 설정은 가끔 와서 정확히 고치고 나가는 화면이라,
  //    안 열어 보고도 "여기 있겠구나"를 알 수 있어야 한다.
  const s = codeOnly(read('src/components/admin/sections/SystemSettings.jsx'))
  // **정규식을 문자열로 짓지 않는다.** `new RegExp('[\\s\\S]')` 로 쓰려다 한 번 당했다 —
  // 셸 heredoc 을 지나며 역슬래시가 하나 먹혀 `[sS]` 가 됐고, 시험은 **조용히 false** 였다
  // (CLAUDE.md "파일 수정은 Edit 도구로" 가 경고하는 그 층이다).
  // 여기서는 자르고 세는 것으로 충분하다 — 정규식이 필요 없으면 안 쓴다.
  //
  // 갈래가 셋에서 **둘**이 됐다(2026-09-13) — 「AI · API 연동」이 제 화면으로 나갔다.
  for (const id of ['broadcast', 'etc']) {
    const 시작 = s.indexOf(`id: '${id}',`)
    assert.ok(시작 > 0, `설정 갈래 「${id}」를 못 찾았다 — 이름이 바뀌었으면 이 시험도 같이 고친다`)
    const 덩이 = s.slice(시작, 시작 + 260)
    const d = 덩이.indexOf("desc: '")
    assert.ok(d > 0, `설정 갈래 「${id}」에 설명이 없다`)
    const 설명 = 덩이.slice(d + 7, 덩이.indexOf("'", d + 7))
    assert.ok(설명.length >= 16, `「${id}」 설명이 ${설명.length}자뿐이다 — 한 줄은 채워야 뜻이 선다`)
  }
  assert.match(s, /\{desc && <p[^>]*t-sub/, '설명을 안 그린다')
  assert.match(s, /desc=\{g\.desc\}/, '설명을 갈래에서 안 받아 온다')

  // ② **위계가 뒤집히지 않는다.** 갈래 18 > 카드 16 > 설명 14 이고, 본문이 16 이다.
  //    카드 제목이 `text-sm`(14) 이면 **본문보다 작아져** 눈이 제목을 먼저 못 잡는다.
  assert.match(s, /<h2 className="t-group/, '갈래 제목이 18px(t-group)이 아니다')
  const 설정파일 = [
    'SystemSettings.jsx', 'apiSettingsAI.jsx', 'apiSettingsIntegrations.jsx',
    'apiSettingsWeather.jsx', 'systemSettingsAudio.jsx', 'systemSettingsBroadcast.jsx',
    'systemSettingsEtc.jsx', 'LocalAiSetup.jsx', 'AiApiSettings.jsx',
  ].map(f => 'src/components/admin/sections/' + f)
  for (const p of 설정파일) {
    const code = codeOnly(read(p))
    assert.match(code, /className=/, `${p} 에 화면이 없다 — 목록이 낡았다`)
    assert.doesNotMatch(code, /text-sm font-semibold text-ds-v3-ink/,
      `${p} 의 카드 제목이 14px 로 돌아갔다 — 본문(16px)보다 작아 위계가 뒤집힌다`)
  }
})

test('설정에서 꺼낸 화면들 — 입구와 도착지가 맞는다', () => {
  const admin = codeOnly(read('src/pages/AdminMode.jsx'))
  const side  = codeOnly(read('src/components/admin/Sidebar.jsx'))

  // **정규식을 문자열로 짓지 않는다** — 이 세션에서 세 번 당했다. 셸 heredoc 을 지나며
  // `\\s` 의 역슬래시가 하나 먹히고, 템플릿 문자열 안의 `\s` 는 그냥 `s` 가 되어
  // 패턴이 조용히 딴것이 된다(오류 없이 false). 여기서는 **글자 찾기로 충분하다.**
  const 화면등록 = (id) => admin.includes(`${id}:`) && admin.includes('{ Component')
    && /(\w+):\s*\{ Component/.test(admin)
    && admin.split('\n').some(줄 => 줄.trim().startsWith(`${id}:`) && 줄.includes('{ Component'))
  const 사이드바에 = (id) => side.includes(`id: '${id}'`)
  const 갈래가 = (id, g) => side.split('\n').some(줄 => 줄.includes(`id: '${id}'`) && 줄.includes(`group: '${g}'`))

  // 새로 꺼낸 둘이 실제 화면으로 등록돼 있나.
  for (const id of ['apiSettings', 'favorites'])
    assert.ok(화면등록(id), `「${id}」 화면이 없다`)
  // 사이드바에 입구가 있나 — 화면만 있고 길이 없으면 아무도 못 간다.
  for (const id of ['apiSettings', 'favorites', 'soundSettings'])
    assert.ok(사이드바에(id), `사이드바에 「${id}」 입구가 없다`)

  // 소리·즐겨찾기는 **방송설정** 갈래다(모니터링은 보는 것, 이것은 정하는 것).
  for (const id of ['soundSettings', 'favorites'])
    assert.ok(갈래가(id, 'broadcast'), `「${id}」 가 방송설정 갈래에 없다`)

  // **뺀 입구 셋이 안 돌아왔나.** 셋 다 머리줄 탭이 같은 화면으로 간다.
  for (const id of ['weeklySchedule', 'musicManagement', 'morningEditor'])
    assert.ok(!사이드바에(id),
      `사이드바에 「${id}」 입구가 돌아왔다 — 탭과 길이 둘이 되고 도착한 모습이 다르다`)
  // 옛 주소는 살아 있어야 한다.
  for (const id of ['weeklySchedule', 'musicManagement', 'morningEditor'])
    assert.ok(화면등록(id), `「${id}」 화면이 사라졌다`)

  // 옛 딥링크가 새 자리로 간다.
  assert.match(admin, /aiSettings:\s*\{ section: 'apiSettings'/,
    '옛 `?section=aiSettings` 링크가 새 화면으로 안 간다')

  // 쓰지 않는 "준비 중" 카드 셋은 지웠다 — 기다리면 생기는 것이 아니라 **없는 기능**이다.
  for (const [파일, 낱말] of [
    ['systemSettingsBroadcast.jsx', '방송 구역 설정'],
    ['systemSettingsEtc.jsx',       '알림 설정'],
    ['systemSettingsEtc.jsx',       '보안 설정'],
  ]) assert.ok(!codeOnly(read('src/components/admin/sections/' + 파일)).includes(낱말),
    `「${낱말}」 준비 중 카드가 돌아왔다 — 없는 기능을 있을 것처럼 약속하지 않는다`)

  // 옛 화면으로 돌아가는 눈에 띄는 입구를 없앴다.
  assert.doesNotMatch(side, /쉬운 화면으로 전환/,
    '「쉬운 화면으로 전환」이 돌아왔다 — 새 화면을 보다가 옛 디자인으로 떨어진다')

  // 화면을 옮기면 맨 위에서 시작한다.
  assert.match(admin, /window\.scrollTo\(\{ top: 0/,
    '화면을 옮겨도 스크롤이 그대로다 — 새 화면 중간에 떨어진다')
  assert.match(admin, /if \(expandTarget\) return/,
    '딥링크로 펼칠 자리가 있어도 위로 올려 버린다')
})

// ── 물감은 **창에 붙어 있다** — 긴 화면에서도 배경이 통짜가 되지 않게 (2026-09-13) ──
//
// 사용자 지적: *"음량 tts랑 Ai api 연동은 왜 배경이 고정되어 있냐 투명하게 세번쨰 사진처럼
// 안되고"*. 배경색 문제가 아니었다 — 세 화면 다 같은 `--ds-v3-bg` 였다(브라우저 실측).
// 물감 층이 `absolute` + 높이 760px 이라 **본문 맨 위에만** 깔려 있었다. 그래서 화면 길이가
// 갈랐다: 방송 로그는 1016px 이라 거의 전체가 물감 구간이지만, 음량 및 TTS 는 **4192px**,
// AI · API 연동은 **3076px** 라 조금만 내려가면 그 아래가 통째로 민무늬였다.
// 같은 껍데기인데 화면 길이에 따라 다른 제품처럼 보였다.
test('물감 층이 창에 붙어 있다 — 길이가 다른 화면이 다른 제품처럼 보이지 않게', () => {
  const 원문 = read(SHELL)
  const i = 원문.indexOf('{/* ── 물감 두 방울')
  assert.ok(i >= 0, '물감 층을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const j = 원문.indexOf('</div>', 원문.indexOf('right-[2%]', i))
  // **주석을 걷고 센다** — 이 자리의 머리말이 `backdrop === 'drift'` 를 설명하느라
  // 그 글자를 그대로 적고 있어서, 날것으로 세면 셋이 나온다(2026-09-13 실측).
  const 층 = codeOnly(원문.slice(i, j > i ? j : i + 2000))

  assert.match(층, /aria-hidden="true" className="pointer-events-none fixed /,
    '물감 층이 다시 `absolute` 다 — 본문 맨 위에만 깔려 긴 화면은 내려가면 민무늬가 된다')
  // 긍정 앵커 — 물감 두 방울이 실재하는지
  assert.ok((층.match(/radial-gradient/g) || []).length === 2, '물감이 두 방울이 아니다')
  // 움직임은 여전히 홈에서만 — 설정·자동순서는 정지(G-46). 붙였다고 켜지면 안 된다.
  assert.ok((층.match(/backdrop === 'drift'/g) || []).length === 2,
    '움직임 조건이 사라졌다 — 오래 머무는 화면에서 주변시가 계속 흔들린다')
})

// ── 2026-09-15: **「전체 예약 관리」가 진짜로 목록을 연다** ────────────────────────
// 서랍의 그 줄은 `/calendar?view=list` 로 보낸다. 그런데 그 값을 **아무도 안 읽으면**
// 월간 격자가 뜬다 — 이름은 「전체 예약 관리」인데 달력이 나오는 것이고, 이 저장소가
// 가장 경계하는 「조용히 엉뚱한 화면」이다. 머리줄 탭에서 이미 한 번 겪었다(2026-09-13).
// 링크만 만들고 받는 쪽을 안 고치면 **아무도 안 알려 준다** — 그래서 양쪽을 같이 본다.
test('「전체 예약 관리」 링크를 **받는 쪽이 있다** — 주소가 보기를 정한다', () => {
  const 관리 = codeOnly(read('src/components/home/HomeAdminLinks.jsx'))
  const m = 관리.match(/to:\s*'\/calendar\?view=(\w+)'/)
  assert.ok(m, '전체 예약 관리가 보기를 지정해 보내지 않는다')
  const 보기 = m[1]

  // 받는 쪽 ① 화면이 주소에서 읽어 넘긴다
  const cal = codeOnly(read('src/pages/CalendarMode.jsx'))
  assert.match(cal, /searchParams\.get\('view'\)/,
    '캘린더 화면이 주소의 view 를 안 읽는다 — 링크가 월간으로 떨어진다')
  assert.match(cal, /초기보기=\{/, '읽어 놓고 안 넘긴다')

  // 받는 쪽 ② 목록이 그 값을 첫 보기로 쓴다
  const week = codeOnly(read('src/components/admin/sections/WeeklySchedule.jsx'))
  assert.match(week, /초기보기/, '목록이 초기 보기를 안 받는다')
  assert.match(week, /VIEWS\.some\(v => v\.id === 초기보기\)/,
    '모르는 값을 안 거른다 — 오타 하나로 빈 화면이 뜬다')

  // 그리고 그 보기가 **실제로 있는 이름**이어야 한다
  const 있는보기 = [...week.matchAll(/\{ id: '(\w+)',\s*label:/g)].map(x => x[1])
  assert.ok(있는보기.includes(보기),
    `링크가 보내는 보기 「${보기}」가 실제 보기 목록에 없다: ${있는보기.join(', ')}`)
})
