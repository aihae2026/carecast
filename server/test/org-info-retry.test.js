// 홀 TV 에 기관명·표어가 안 뜨던 버그 (2026-09-10 현장 신고, 재현·수정).
//
// **무엇이 문제였나**: `BroadcastIndicators` 가 기관 이름·표어를 **마운트 때 한 번만** 읽고
// `.catch(() => {})` 로 삼켰다. 그 한 번이 어긋나면 **그 페이지가 살아 있는 내내** 빈 채로
// 남아, 방송 화면에 `ON AIR` 와 배지만 뜨고 기관명·표어가 영영 안 나온다 — 서버는 멀쩡한데도.
//
// 현장 PC 는 자동 업데이트가 끝나면 스스로 새로고침한다(`useConnectionWatch`).
// 그 순간 한 번만 끊겨도 하루 종일 그 상태다. **조용한 실패가 홀 TV 에 그대로 걸리는 자리**다.
//
// 브라우저 실측(2026-09-10): 고치기 전 — 요청 1회 실패 시 자막 전·후 모두 기관명 없음.
// 고친 뒤 — 요청 **2회** 실패에도 기관명·표어가 뜬다.
//
// 화면 파일이라 소스 대조로 고정한다(이 저장소 관례). **부정 단언 앞에 긍정 앵커를 세운다.**
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'broadcast', 'BroadcastIndicators.jsx'), 'utf8')

const ROOT = path.join(__dirname, '..', '..')
const LF = String.fromCharCode(10)
// 주석은 뺀다 — 머리말이 옛 동작을 설명하느라 그 모양을 그대로 인용한다.
const 본문 = SRC.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join(LF)

test('앵커: 방송 화면이 기관 정보를 서버에서 읽는다', () => {
  assert.match(본문, /getOrgInfo/, '기관 정보를 안 읽는다 — 이 검사의 앵커가 무너졌다')
  assert.match(본문, /org\.slogan \|\| org\.name/, '그리는 자리가 사라졌다')
})

test('한 번 실패해도 끝나지 않는다 — 다시 읽는 길이 있다', () => {
  assert.match(본문, /setTimeout\([\s\S]{0,40}지연/,
    '재시도가 없다 — 마운트 때 한 번 실패하면 그 페이지가 살아 있는 내내 빈 채로 남는다')
  assert.match(본문, /const 지연 = \[/, '재시도 간격표가 없다')
})

test('방송 화면이 열릴 때 다시 읽는다 — 글자가 가장 필요한 때다', () => {
  const i = 본문.indexOf('const onShow')
  assert.ok(i >= 0, 'onShow 가 사라졌다')
  const onShow = 본문.slice(i, 본문.indexOf('const onHide', i))
  // 2026-09-13: **캐시를 무시하고** 읽는다(`{ 다시읽기: true }`). 그전에는 `기관읽기()` 였는데
  // 한 번 읽고 나면 `orgReadyRef` 때문에 아무 일도 안 했다 — 그래서 설정에서 기관 이름을
  // 저장해도 홀 TV 가 옛 값을 계속 들고 있었다(사용자 지적: *"기관정보 저장했잖아 왜 안 나와"*).
  // 지키는 사실은 그대로다: **열릴 때 값을 새로 맞춘다.**
  assert.match(onShow, /기관읽기\(\{ 다시읽기: true \}\)/,
    '방송이 시작될 때 다시 안 읽는다 — 그 사이에 설정이 바뀌었을 수 있다')

  const j = 본문.indexOf('const onCaption')
  assert.ok(j >= 0, 'onCaption 이 사라졌다')
  const onCaption = 본문.slice(j, j + 400)
  assert.match(onCaption, /기관읽기\(\)/, '자막 경로로 열릴 때도 같은 규칙이어야 한다')
})

test('이미 읽었으면 다시 안 부른다 — 방송 때마다 두드리지 않는다', () => {
  const i = 본문.indexOf('const 기관읽기')
  assert.ok(i >= 0, '기관읽기 가 사라졌다')
  const fn = 본문.slice(i, 본문.indexOf('}, [])', i))
  // 2026-09-13: 강제 조회(`다시읽기`)가 생기면서 조건에 그것이 붙었다.
  // **재시도 사다리는 그대로 캐시를 존중한다** — 여기서 지키는 것은 그 사실이다.
  // 강제로 부르는 자리는 둘뿐이고(방송 화면 열림 · 설정 저장 SSE) 사람이 행동한 순간이다.
  assert.match(fn, /if \(orgReadyRef\.current && !다시읽기\) return/,
    '읽은 뒤에도 사다리가 계속 부른다 — 방송마다 불필요한 요청이 나간다')
})

test('빈 설정도 성공이다 — 기관명을 안 넣은 곳에서 영원히 재시도하면 안 된다', () => {
  const i = 본문.indexOf('const 기관읽기')
  const fn = 본문.slice(i, 본문.indexOf('}, [])', i))
  // 성공 분기에서 ready 를 세운다. 빈 문자열이어도 "읽었다"이다.
  assert.match(fn, /\.then\([\s\S]{0,200}orgReadyRef\.current = true/,
    '성공했는데 ready 를 안 세운다 — 설정이 빈 기관에서 재시도가 안 멈춘다')
  assert.doesNotMatch(fn, /\.catch\([\s\S]{0,120}orgReadyRef\.current = true/,
    '실패했는데 ready 를 세운다 — 그러면 다시 읽지 않아 옛 버그로 돌아간다')
})

test('재시도는 유한하다 — 무인 PC 에서 영원히 두드리지 않는다', () => {
  const m = /const 지연 = \[([^\]]*)\]/.exec(본문)
  assert.ok(m, '간격표를 못 찾았다')
  const 값 = m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  assert.ok(값.length >= 3 && 값.length <= 8, `재시도 횟수가 ${값.length} 다 — 서넛이면 충분하다`)
  assert.ok(값[0] === 0, '첫 시도는 바로여야 한다')
  for (let i = 1; i < 값.length; i++) {
    assert.ok(값[i] > 값[i - 1], `간격이 안 늘어난다: ${값.join(',')} — 같은 간격으로 두드리면 부하가 몰린다`)
  }
  assert.match(본문, /clearTimeout/, '언마운트 때 타이머를 안 걷는다')
})

// ── 저장하면 **홀 TV 가 바뀐다** (사용자 지적 2026-09-13) ─────────────────────────
//
// *"기관정보 저장했잖아 왜 안 나와 저거 꼭 마무리 안 해도 저장된 거까지는 반영을 해줘야지"*
//
// 무엇이 문제였나: 방송 화면은 이 값을 **한 번 읽고 다시는 안 읽었다**(`orgReadyRef`).
// 그런데 기관 이름을 저장하는 사람과 그 글씨가 뜨는 창은 **서로 다른 창**이다 —
// 대개 다른 PC 다(설정은 사무실, 홀 TV 는 홀). 화면 안의 이벤트로는 닿지 않는다.
// 그래서 서버가 SSE 로 쏜다. 마법사를 끝까지 진행하지 않아도 **저장한 순간** 바뀐다.
test('기관 정보를 저장하면 서버가 SSE 로 알린다', () => {
  const 설정 = fs.readFileSync(path.join(ROOT, 'server/routes/settings.js'), 'utf8')
  const i = 설정.indexOf("router.post('/org'")
  assert.ok(i >= 0, '기관 정보 저장 라우트가 사라졌다')
  const 본문 = 설정.slice(i, 설정.indexOf('})', 설정.indexOf('res.json', i)))
  assert.match(본문, /broadcastSSE\('org_info'/,
    '저장만 하고 아무에게도 안 알린다 — 홀 TV 가 옛 이름을 계속 들고 있는다')
  // **알림이 실패해도 저장은 그대로다.** 알림 때문에 설정 저장을 되돌리면 본말전도다.
  assert.match(본문, /try \{ require\('\.\.\/services\/sse'\)\.broadcastSSE\('org_info'/,
    '알림을 try 로 감싸지 않았다 — SSE 가 죽으면 설정 저장이 통째로 실패한다')
})

test('화면이 그 SSE 를 받아 그 자리에서 갈아 끼운다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  assert.match(api, /es\.addEventListener\('org_info'/, 'SSE 를 구독하지 않는다')

  const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useScheduledBroadcast.js'), 'utf8')
  assert.match(hook, /type === 'org_info'/, '받은 것을 아무 데도 안 넘긴다')
  assert.match(hook, /carecast:org-info/, '창 이벤트로 안 바꾼다 — 방송 화면이 못 듣는다')

  assert.match(본문, /window\.addEventListener\('carecast:org-info'/,
    '방송 화면이 그 이벤트를 안 듣는다')
  // 받은 값을 그대로 쓴다 — 다시 조회하면 왕복만 늘고, 그 사이에 또 바뀌면 옛 값을 덮어쓴다.
  // 2026-09-16 에 같은 알림으로 **글자 크기**(`textSize`)도 온다. 그래서 줄 끝을 고정하지 않고
  // 「받은 name·slogan 을 그대로 넣는다」까지만 본다 — 필드가 늘 때마다 빨간불이 나면 안 된다.
  assert.match(본문, /setOrg\(\{ name: d\.name \|\| '', slogan: d\.slogan \|\| ''/,
    '받은 값을 안 쓴다')
})
