'use strict'
// **마이크 청크에 주인이 있다** (P-63, 2026-09-11).
//
// [FACT] EV-004033 — 재현:
//   · `playChunk(data)` 는 인자가 데이터 하나뿐이라 **누가 보냈는지 모른다**
//   · 단일 방송자 개념은 `server/index.js` 의 WS 클로저 지역 변수 `broadcaster` 에만 있고
//     **모듈로 안 나간다**
//   · 그래서 HTTP 폴백 `POST /api/mic/stream` 은 그것을 **볼 수조차 없다**
//
// 결과: 두 기기가 동시에 HTTP 폴백으로 보내면 **청크가 섞여 한 스피커로 나간다.**
// 요양원에서는 "두 사람 목소리가 겹쳐 나간다" 가 된다.
//
// 고치는 자리는 `micLive` 옆이다 — 그쪽이 이미 **"지금 생방송 중인가"** 를 안다.
// "누가" 를 같은 층에 두면 WS 경로와 HTTP 폴백이 **같은 것**을 본다.
process.env.CARECAST_NO_HARDWARE = '1'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 잡기, 놓기, 주인인가, 지금주인, __test__ } = require(path.join(ROOT, 'server/services/micOwner'))

test('먼저 잡은 쪽이 주인이 된다', () => {
  __test__.리셋()
  assert.equal(잡기('기기-A'), true, '아무도 없는데 못 잡았다')
  assert.equal(지금주인(), '기기-A')
  assert.equal(주인인가('기기-A'), true)
})

test('주인이 있는 동안 다른 기기는 못 잡는다 — 겹쳐 나가지 않게', () => {
  __test__.리셋()
  잡기('기기-A')
  assert.equal(잡기('기기-B'), false, '두 번째 기기가 마이크를 빼앗았다 — 목소리가 겹친다')
  assert.equal(지금주인(), '기기-A', '주인이 바뀌었다')
  assert.equal(주인인가('기기-B'), false)
})

test('같은 기기가 다시 잡는 것은 막지 않는다 — 재연결이 정상 동작이다', () => {
  __test__.리셋()
  잡기('기기-A')
  assert.equal(잡기('기기-A'), true, '같은 기기의 재연결을 막으면 끊겼다 다시 붙을 수가 없다')
})

test('놓으면 다음 기기가 잡는다', () => {
  __test__.리셋()
  잡기('기기-A')
  놓기('기기-A')
  assert.equal(지금주인(), null)
  assert.equal(잡기('기기-B'), true, '놓았는데도 다음 기기가 못 잡는다')
})

test('남의 것을 놓을 수는 없다 — 실수로 남의 방송을 끊지 않게', () => {
  __test__.리셋()
  잡기('기기-A')
  놓기('기기-B')
  assert.equal(지금주인(), '기기-A', '다른 기기가 남의 소유권을 풀었다')
})

test('**조용히 굳지 않는다** — 마지막 청크 뒤 일정 시간이 지나면 저절로 풀린다', () => {
  // 창을 그냥 닫으면 `놓기` 가 안 온다. 그때 주인이 영영 남으면 **아무도 마이크를 못 쓴다.**
  // 그게 겹쳐 나가는 것보다 나쁠 수 있다 — 급할 때 방송이 아예 안 된다.
  __test__.리셋()
  잡기('기기-A')
  __test__.시계(Date.now() + __test__.만료MS + 1000)
  assert.equal(지금주인(), null, '주인이 영영 굳었다 — 아무도 마이크를 못 쓴다')
  assert.equal(잡기('기기-B'), true, '굳은 주인 때문에 다음 기기가 막혔다')
  __test__.시계(null)
})

test('주인 없이 보낸 청크는 거절된다 — 그러나 이름을 안 주는 옛 호출은 통과시킨다', () => {
  // **하위 호환**: 이름을 안 주고 부르는 자리가 아직 있으면 그것까지 막으면 방송이 죽는다.
  // 이름을 준 호출만 소유권을 본다. 이름 없는 호출은 예전처럼 지나간다.
  __test__.리셋()
  잡기('기기-A')
  assert.equal(주인인가(null), true, '이름 없는 옛 호출을 막았다 — 기존 방송이 죽는다')
  assert.equal(주인인가(undefined), true)
})

// ── 실제 호출부가 이 규칙을 쓰는가 ───────────────────────────────────────
test('playChunk 가 발신자를 받고, 주인이 아니면 재생하지 않는다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/services/audioPlayer.js'), 'utf8')
  const sig = /function playChunk\(([^)]*)\)/.exec(src)
  assert.ok(sig, 'playChunk 를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(sig[1], /보낸이|owner|sender/, 'playChunk 가 여전히 데이터만 받는다')
  assert.match(src, /주인인가/, 'playChunk 가 소유권을 안 본다')
})

test('HTTP 폴백이 발신자를 실어 보낸다 — WS 경로와 같은 것을 본다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/mic.js'), 'utf8')
  const m = /router\.post\('\/stream'[\s\S]*?\n\}\)/.exec(src)
  assert.ok(m, 'POST /stream 을 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(!/playChunk\(req\.body\)\s*$/m.test(m[0]),
    'HTTP 폴백이 여전히 데이터만 넘긴다 — 단일 방송자를 볼 수조차 없다')
  assert.match(m[0], /playChunk\(req\.body,/, '발신자를 안 넘긴다')
})

// ── **보내는 쪽**도 본다 (Codex 독립 검수 2026-09-11) ────────────────────
//
// 위 두 검사는 **서버가 이름표를 읽는가**만 봤다. 전부 초록이었는데도 가드는 한 번도
// 작동한 적이 없었다 — **유일한 화면이 그 이름표를 안 보냈기 때문**이다.
// `주인인가(undefined)` 는 하위 호환으로 무조건 true 라, 안 보내면 **조용히 다 통과한다.**
//
// "가드는 따라 옮긴다"(CLAUDE.md)의 반대편이다 — 가드는 세웠는데 **부르는 쪽이 안 따라왔다.**
// 그래서 이 저장소의 규칙 하나를 여기 더한다: **한쪽만 보는 검사는 조용한 초록을 만든다.**
test('마이크 화면이 두 경로 모두에 같은 이름표를 실어 보낸다', () => {
  const IB = fs.readFileSync(path.join(ROOT, 'src/components/easy/InstantBroadcast.jsx'), 'utf8')

  // ① HTTP 폴백 — `lib/api` 를 안 거치는 유일한 자리라(TD-08 예외) 공통 머리글이 안 붙는다.
  //    그러므로 **여기서 직접** 붙여야 한다.
  // **블록 끝을 `.then` 으로 잘리지 않게 잡는다.** 처음엔 `\n {10}\}\)` 로 끊었는데
  // 그것은 `}).then(` 에서 먼저 걸려서, 아래 ④ 검사가 **응답 처리부를 못 보고 헛돌았다**
  // (Codex 재검수 2026-09-11 지적으로 발견). 바깥 else 블록의 닫는 괄호까지 잡는다.
  const f = /fetch\('\/api\/mic\/stream'[\s\S]*?\n {8}\}/.exec(IB)
  assert.ok(f, 'POST /api/mic/stream 호출부를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(f[0], /\.catch\(/, '응답 처리부까지 못 잡았다 — 아래 검사가 헛돈다(긍정 앵커)')
  assert.match(f[0], /'X-CareCast-Tab'|"X-CareCast-Tab"/i,
    'HTTP 폴백이 탭 이름표를 안 보낸다 — 서버의 주인 검사가 항상 하위호환 경로로 통과한다')

  // ② WS — 서버(`index.js:347`)가 `?tab=` 을 읽는다. 안 보내면 연결마다 새 이름을 지어내고,
  //    같은 탭의 HTTP 폴백과 **다른 사람**이 된다.
  const w = /new WebSocket\(`[^`]*\/ws\/audio[^`]*`\)/.exec(IB)
  assert.ok(w, '마이크 WS 연결부를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(w[0], /tab=/, 'WS 가 탭 이름표를 안 보낸다 — 같은 탭인데 두 경로가 다른 주인이 된다')

  // ③ 이름표는 **한 벌**이다. 여기서 새로 만들면 소리 담당을 정하는 것과 갈린다.
  assert.match(IB, /from '\.\.\/\.\.\/lib\/tabId'/,
    '탭 이름표를 lib/tabId 에서 안 가져온다 — 두 벌이 되면 서버가 다른 사람으로 본다')

  // ④ **409 를 사람에게 보여준다.** 조용히 삼키면 보낸 쪽은 자기 목소리가 나가는 줄 안다 —
  //    이 결함이 고치려던 것과 같은 종류의 침묵이다(routes/mic.js:78-83 과 같은 이유).
  assert.doesNotMatch(f[0], /\}\)\.catch\(\(\) => \{\}\)/,
    '응답을 통째로 버린다 — 409(다른 기기가 방송 중)를 아무도 못 본다')
})

// **소유권을 못 잡았는데 방송자로 받아들이면, 보낸 사람은 무음을 성공으로 안다**
// (Codex 3차 검수 2026-09-11).
//
// WS 연결부는 `잡기()` 의 반환값을 **버리고** 무조건 방송자로 등록한 뒤 `start` 를 쏘았다.
// HTTP 로 다른 기기가 방송 중이면 그 뒤 청크는 `playChunk` 에서 전부 버려지는데,
// WS 경로에는 HTTP 409 같은 알림 길이 없어 **화면은 "방송 중"이고 홀은 조용하다.**
test('WS 방송자는 소유권을 잡은 뒤에만 등록된다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8')
  const m = /if \(role === 'broadcaster'\)([\s\S]*?)\n {8}\} else \{/.exec(src)
  assert.ok(m, 'WS 방송자 분기를 못 찾았다 — 이 가드를 옮길 것')
  const 블록 = m[1]

  // ① 반환값을 본다. 버리면 남의 방송 위에 올라탄다.
  assert.match(블록, /if \(!require\('\.\/services\/micOwner'\)\.잡기\(/,
    '잡기() 반환값을 버린다 — 남이 쓰고 있어도 방송자로 등록된다')

  // ② 거절하면 **닫는다.** 닫으면 화면이 HTTP 폴백으로 내려가 `POST /stream` 이 409 를
  //    돌려주고, 그때 사람에게 보인다(routes/mic.js:78-83 · InstantBroadcast 의 409 분기).
  assert.match(블록, /ws\.close\(4409/,
    '거절하고도 연결을 열어 둔다 — 보낸 쪽은 자기 목소리가 나가는 줄 안다')

  // ③ **앞선 WS 방송자는 넘겨받는 것이 명세다**(마지막 연결이 이긴다). 그 사람의 소유권을
  //    `terminate()` **전에** 놓아야 아래 잡기가 성공한다 — `close` 핸들러는 다음 틱이라 늦다.
  const 인계 = /if \(broadcaster\)[\s\S]*?\n {10}\}/.exec(블록)
  assert.ok(인계, '앞선 방송자 인계 블록을 못 찾았다')
  assert.match(인계[0], /놓기\(broadcaster\.__주인이름\)/,
    '앞선 WS 방송자의 소유권을 안 놓고 죽인다 — 새 연결이 자기 차례인데도 거절된다')
  assert.ok(인계[0].indexOf('놓기') < 인계[0].indexOf('terminate'),
    '놓기보다 terminate 가 먼저다 — close 핸들러는 다음 틱이라 그때는 이미 늦다')

  // ④ 늦게 오는 옛 연결의 close 가 **새 방송자를 지우면 안 된다.**
  const 닫힘 = /ws\.on\('close'[\s\S]*?\n {10}\}\)/.exec(블록)
  assert.ok(닫힘, 'close 핸들러를 못 찾았다')
  // 형태는 `===` 든 `!==` 든 상관없다 — **자기가 지금 방송자인지 견주는가**를 본다.
  // (처음엔 `===` 만 찾도록 써서, 뜻이 같은 `!== → return` 구현에 헛되이 빨간불이 났다.)
  assert.match(닫힘[0], /broadcaster (===|!==) ws/,
    '옛 연결의 close 가 새 방송자까지 지운다 — 방금 시작한 방송이 stop 으로 꺼진다')
})

test('소유권 순서 자체를 돌려 본다 — 인계가 되면 잡힌다', () => {
  // 위 검사는 소스가 그렇게 **쓰여 있다**까지다. 그 순서가 실제로 필요한지는 여기서 본다.
  __test__.리셋()
  assert.equal(잡기('HTTP-A'), true)
  assert.equal(잡기('WS-B'), false, '남이 쓰고 있는데 잡혔다 — 가드가 없는 것과 같다')
  // 앞선 주인을 놓으면 그때 잡힌다 — 이것이 WS 인계가 기대는 성질이다.
  놓기('HTTP-A')
  assert.equal(잡기('WS-B'), true, '앞선 주인을 놓았는데도 안 잡힌다 — 인계가 성립하지 않는다')
  __test__.리셋()
})

// **문구를 세우는 것과 그 문구가 보이는 것은 다르다** (Codex 재검수 2026-09-11).
//
// 처음엔 409 에서 `setErrMsg` 만 했다. 그런데 오류 문구의 렌더 조건은 `state === 'error'`
// 인데 그 시점 상태는 `'broadcasting'` 이다 — **화면은 그대로 "방송 중"이고 사람은 계속
// 말한다.** 거절된 청크를 계속 보내면서. 이 결함이 고치려던 침묵을 화면 층에서 되풀이한 것이다.
// 위 검사는 `.catch(()=>{})` 가 없어진 것만 봤고 **그려지는지는 안 봤다.**
test('409 는 화면에 실제로 보인다 — 끊고, 이유를 남기고, 오류 상태로 바꾼다', () => {
  const IB = fs.readFileSync(path.join(ROOT, 'src/components/easy/InstantBroadcast.jsx'), 'utf8')

  // 오류 문구가 그려지는 조건이 무엇인지 먼저 확인한다(긍정 앵커) — 이 조건이 바뀌면
  // 아래 판단의 전제가 무너지므로 그때 빨간불이 나야 한다.
  assert.match(IB, /state === 'error' && \(/,
    "오류 문구의 렌더 조건이 바뀌었다 — 409 가 그 조건을 만족시키는지 다시 볼 것")

  const f = /fetch\('\/api\/mic\/stream'[\s\S]*?\n {8}\}/.exec(IB)
  assert.ok(f, 'POST /api/mic/stream 호출부를 못 찾았다')
  const 분기 = /r\.status === 409[\s\S]*?\n {12}\}/.exec(f[0])
  assert.ok(분기, '409 분기를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(분기[0], /setState\('error'\)/,
    "409 인데 상태를 안 바꾼다 — 문구는 세워 두고 화면은 '방송 중'이라 아무도 못 본다")
  assert.match(분기[0], /충돌끊기Ref\.current\?\.\(\)/,
    '409 인데 송출을 안 끊는다 — 거절되는 청크를 계속 보낸다')

  // **한 번만 알린다** — 청크마다 409 가 온다. 안 막으면 초당 수십 번 상태를 흔든다.
  assert.match(분기[0], /충돌알림함\.current/, '409 를 청크마다 처리한다 — 화면이 요동친다')

  // **오류 상태는 스스로 풀려야 한다.** 이 화면은 `state === 'error'` 면 시작 버튼을 잠근다.
  // 안 풀면 상대가 방송을 끝내도 **영영 다시 못 켠다**(Codex 재검수 2026-09-11).
  // 다른 오류 경로는 전부 `dismissErrorLater` 를 부른다 — 이 경로만 빠져 있었다.
  assert.match(분기[0], /dismissErrorLater\(/,
    '409 뒤 오류 상태를 안 푼다 — 상대가 끝내도 시작 버튼이 잠긴 채로 남는다')
  // 그리고 **다음 방송에서는 다시 알려야 한다** — 안 지우면 그 장치가 영영 닫힌 채 남는다.
  const st = /const startBroadcast = useCallback\(async \(\) => \{([\s\S]*?)try \{/.exec(IB)
  assert.ok(st, 'startBroadcast 를 못 찾았다')
  assert.match(st[1], /충돌알림함\.current = false/,
    '다음 방송을 시작할 때 충돌 알림 표시를 안 지운다 — 두 번째부터는 409 가 조용하다')
})

// **지난 방송의 늦은 응답이 다음 방송을 끊는다** (Codex 3차 검수 2026-09-11).
//
// `fetch` 는 취소되지 않는다. 정지해도 앞 방송이 이미 보낸 청크의 409 는 뒤늦게 도착하고,
// 그때 `충돌알림함` 은 재시작이 방금 지워 둔 뒤라 **새 방송이 오류로 꺼진다.**
// 정지만 하고 다시 시작하지 않아도 마찬가지다 — 가만히 있던 화면이 빨개진다.
test('앞 방송이 남긴 409 는 버린다 — 회차로 가른다', () => {
  const IB = fs.readFileSync(path.join(ROOT, 'src/components/easy/InstantBroadcast.jsx'), 'utf8')

  // ① 보낼 때의 회차를 적어 둔다
  const f = /fetch\('\/api\/mic\/stream'[\s\S]*?\n {8}\}/.exec(IB)
  assert.ok(f, 'POST /api/mic/stream 호출부를 못 찾았다')
  assert.match(IB, /const 보낸회차 = 방송회차\.current/,
    '보낼 때의 회차를 안 적어 둔다 — 응답이 어느 방송 것인지 가릴 수가 없다')

  // ② 응답에서 다시 견주고, 다르면 **아무것도 안 한다**
  assert.match(f[0], /if \(보낸회차 !== 방송회차\.current\) return/,
    '지난 방송의 응답을 그대로 처리한다 — 막 시작한 다음 방송이 끊긴다')

  // ③ 회차가 **시작과 정지 양쪽에서** 오른다. 한쪽만 올리면 나머지 경로가 그대로 샌다.
  const st = /const startBroadcast = useCallback\(async \(\) => \{([\s\S]*?)try \{/.exec(IB)
  assert.match(st[1], /방송회차\.current \+= 1/, '시작할 때 회차를 안 올린다')
  const sp = /const stopBroadcast = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[/.exec(IB)
  assert.ok(sp, 'stopBroadcast 를 못 찾았다')
  assert.match(sp[1], /방송회차\.current \+= 1/,
    '정지할 때 회차를 안 올린다 — 끝낸 방송의 409 가 가만히 있는 화면을 빨갛게 만든다')
})
