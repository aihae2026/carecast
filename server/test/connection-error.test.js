'use strict'
// UX-10 — 연동 오류를 **다음에 뭘 하면 되는지**로 옮긴다 (2026-09-11).
//
// 이 저장소가 두 번 겪고 CLAUDE.md 에 적어 둔 두 함정을 화면이 말하게 한다:
// 401 이 "다른 서비스의 키"일 수 있다는 것, 타임아웃은 키 문제가 아니라는 것.
// 문서에만 있으면 다음 사람은 또 헤맨다.
const test = require('node:test')
const assert = require('node:assert/strict')
const { 연동오류읽기, 연동성공읽기 } = require('../../src/lib/connectionError.js')

test('401 은 "그 서비스의 키가 아닐 수도" 를 말하되 **단정하지 않는다**', () => {
  const r = 연동오류읽기('401 유효한 인증키가 아닙니다')
  assert.equal(r.종류, 'auth')
  assert.match(r.다음, /그 서비스의 키가 아닐 수도/, 'CLAUDE.md 가 적어 둔 그 함정을 안 말한다')
  assert.match(r.다음, /확인해 보세요/, '무엇을 해 보라는 말이 없다')
  // 이 함수에는 **키 값도 서비스 이름도 안 온다.** 그런데 예전 문구는 "길이가 똑같다면
  // 한 키를 복사해 넣은 것입니다" 라고 못 박았고, 기상청과 무관한 Gemini 카드에도
  // 그대로 떴다(Codex 지적, EV-004631). 근거 없이 원인을 확정하지 않는다.
  assert.doesNotMatch(r.다음, /것입니다\.|틀림없|확실/, '근거 없이 원인을 단정한다')
})

test('닿지 않는 것을 키 문제로 읽지 않는다 — 멀쩡한 키를 계속 바꾸게 된다', () => {
  for (const 글 of ['UND_ERR_CONNECT_TIMEOUT', 'fetch failed', 'getaddrinfo ENOTFOUND apis.data.go.kr',
    'AI 서버에서 20초 안에 응답이 없습니다.']) {
    const r = 연동오류읽기(글)
    assert.equal(r.종류, 'network', `"${글}" 을 network 로 안 읽는다`)
    assert.match(r.다음, /키를 의심하기 전에/, '키부터 의심하게 둔다')
  }
})

test('네트워크 규칙이 인증 규칙보다 **먼저** 선다', () => {
  // 타임아웃 메시지에 "인증" 같은 낱말이 섞여 들어와도 닿지 않은 것이 먼저다.
  const r = 연동오류읽기('fetch failed (인증키 확인 중)')
  assert.equal(r.종류, 'network', '순서가 뒤집혔다 — 안 닿는데 키를 고치게 된다')
})

test('다시 눌러 봐야 소용없는 것과 소용있는 것을 가른다', () => {
  const 한도 = 연동오류읽기('429 RESOURCE_EXHAUSTED')
  assert.equal(한도.종류, 'quota')
  assert.match(한도.다음, /다시 눌러도 대개 같습니다/, '헛되이 다시 누르게 둔다')

  const 붐빔 = 연동오류읽기('503 UNAVAILABLE: The model is overloaded')
  assert.equal(붐빔.종류, 'busy')
  assert.match(붐빔.다음, /잠시 뒤 풀립니다/, '기다리면 되는 것을 안 알려준다')
  // "키나 설정 문제가 아닙니다" 라는 **단정은 뺐다** — 점검일 수도 있다(Codex R3).
  // 대신 "여러 번 되풀이되면 그때 설정을 봅니다" 로 다음 걸음을 준다.
  assert.match(붐빔.다음, /되풀이되면 그때 설정/, '계속 실패할 때 무엇을 볼지 안 말한다')
})

test('키를 안 넣은 것은 401 보다 먼저 읽는다', () => {
  const r = 연동오류읽기('Gemini API 키가 설정되지 않았습니다.')
  assert.equal(r.종류, 'config')
  assert.match(r.다음, /넣고 저장/, '무엇을 하면 되는지 안 말한다')
})

test('모르면 **지어내지 않는다** — 원문을 그대로 남긴다', () => {
  const 글 = 'ERR_WEIRD_THING_42'
  const r = 연동오류읽기(글)
  assert.equal(r.종류, 'unknown')
  assert.equal(r.원문, 글, '원문을 버렸다 — 사람이 검색조차 못 한다')
  assert.doesNotMatch(r.다음, /키|네트워크|한도/, '모르면서 원인을 짚었다')
})

// Codex R3(EV-004644). 원문을 남기는 것과 **키를 노출하는 것**은 다르다.
test('원문에 섞인 키는 가린다 — 원문 보기가 키를 화면에 띄우면 안 된다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 사례 = [
    ['ETIMEDOUT https://apis.data.go.kr/x?serviceKey=DUMMYSECRET123&nx=60', 'DUMMYSECRET123'],
    ['401 https://x/y?authKey=DUMMYAUTH9999', 'DUMMYAUTH9999'],
    ['403 Authorization: Bearer ya29.DUMMYTOKENVALUE', 'ya29.DUMMYTOKENVALUE'],
    ['API_KEY_INVALID key AIzaSyDUMMYKEY01234567890', 'AIzaSyDUMMYKEY01234567890'],
  ]
  for (const [글, 비밀] of 사례) {
    const 가린것 = 원문가리기(글)
    assert.ok(!가린것.includes(비밀), `키가 그대로 남았다: ${가린것}`)
    assert.match(가린것, /\*\*\*/, '가렸다는 표시가 없다')
    // **원문을 통째로 버리지는 않는다** — 무슨 오류였는지는 남아야 한다.
    assert.match(가린것, /ETIMEDOUT|401|403|API_KEY_INVALID/, '원문을 통째로 지웠다')
  }
  // 연동오류읽기가 내놓는 `원문` 도 이미 가려져 있어야 한다.
  const r = 연동오류읽기('ETIMEDOUT https://x?serviceKey=DUMMYSECRET123')
  assert.ok(!r.원문.includes('DUMMYSECRET123'), '원문 필드로 키가 샌다')
})

// Codex R5(EV-004669). 가리기는 **모양을 손으로 세면 계속 진다** — 세 판째다.
test('JSON·인코딩된 이름·헤더 어느 모양으로도 키가 안 샌다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 사례 = [
    ['{"apiKey":"DUMMYSECRET123"}', 'DUMMYSECRET123'],
    ['{"client_secret": "DUMMYSECRET123"}', 'DUMMYSECRET123'],
    ['401 x-api-key: DUMMYSECRET123', 'DUMMYSECRET123'],
    ['401 Authorization: Basic ZHVtbXk6c2VjcmV0MTIz', 'ZHVtbXk6c2VjcmV0MTIz'],
    ['403 Authorization: Bearer ya29.DUMMYTOKENVALUE', 'ya29.DUMMYTOKENVALUE'],
    // 이름이 인코딩돼 있으면 이름으로는 못 알아본다 — 값의 생김새로 가린다.
    ['GET /uv?service%4Bey=DUMMYSECRETVALUE1234567890&nx=60', 'DUMMYSECRETVALUE1234567890'],
  ]
  for (const [글, 비밀] of 사례) {
    const 가린것 = 원문가리기(글)
    assert.ok(!가린것.includes(비밀), `키가 그대로 남았다: ${가린것}`)
  }
  // **짧고 평범한 질의값은 안 가린다** — 다 가리면 진단이 불가능해진다.
  const 정상 = 원문가리기('GET /uv?base_date=20260911&numOfRows=10&nx=60')
  assert.equal(정상, 'GET /uv?base_date=20260911&numOfRows=10&nx=60', '멀쩡한 값까지 가렸다')
})

// Codex R6(EV-004679).
test('짧아도 이름이 비밀이라고 말하면 가린다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  for (const [글, 비밀] of [['{"password":"abc12"}', 'abc12'], ['Authorization: Bearer abc12', 'abc12']]) {
    assert.ok(!원문가리기(글).includes(비밀), `짧다고 봐줬다: ${원문가리기(글)}`)
  }
})

test('진단에 필요한 값까지 가리지는 않는다 — 다 지우면 원인을 못 찾는다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 그대로 = [
    'GET /x?request_id=12345678-1234-1234-1234-123456789012',  // UUID
    'keySource: kma_living_api_key',                            // 우리 진단 필드 이름
    'GET /uv?base_date=20260911&numOfRows=10',                  // 짧고 평범한 값
    'GET /x?filename=weather_diagnostic_report.json',           // 긴 파일명
  ]
  for (const 글 of 그대로) assert.equal(원문가리기(글), 글, `멀쩡한 값을 가렸다: ${원문가리기(글)}`)
})

// Codex R7(EV-004691). 이름을 풀어 보고, 따옴표 안은 끝까지 본다.
test('이름이 인코딩돼 있어도 · 값에 공백이 있어도 가린다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  for (const [글, 비밀] of [
    ['GET /x?service%4Bey=abc12', 'abc12'],                       // 이름이 %인코딩
    ['{"password":"dummy secret value"}', 'dummy secret value'],  // 값에 공백
    ['{"client_secret":"a b c d"}', 'a b c d'],
  ]) {
    assert.ok(!원문가리기(글).includes(비밀), `샜다: ${원문가리기(글)}`)
  }
})

// Codex R8(EV-004698).
test('JSON 안에서도 진단 필드는 살고 비밀만 가려진다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 글 = JSON.stringify({ keySource: 'kma_living_api_key', keySet: true, keyMasked: 'abc...xyz', apiKey: 'DUMMYSECRET123' })
  const r = 원문가리기(글)
  assert.ok(!r.includes('DUMMYSECRET123'), `비밀이 남았다: ${r}`)
  // 예외를 한쪽 규칙에만 뒀다가 JSON 쪽에서 진단 필드가 통째로 지워졌다.
  assert.match(r, /kma_living_api_key/, 'keySource 를 가렸다 — 어느 키를 쓰는지 못 본다')
  assert.match(r, /abc\.\.\.xyz/, 'keyMasked 를 가렸다 — 사람이 키를 알아볼 수 없다')
})

test('스위치봇 토큰이 오류 문구로 새지 않는다 — 앞에서 막고, 새는 길도 닫는다', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'services/switchbot.js'), 'utf8')
  // 긍정 앵커 — 감시할 자리가 있다.
  assert.match(s, /async function getDeviceStatus/, '조회 함수를 못 찾았다 — 이 가드를 옮길 것')
  // ① 헤더에 못 넣는 글자는 **부르기 전에** 막는다(fetch 가 토큰째 던진다).
  assert.match(s, /function 자격증명확인/, '제어문자 검사가 없다')
  // **개수를 박지 않는다**(2026-09-12). 예전엔 `=== 2` 였는데, 장치 목록 경로가 하나
  // 늘면서(UX-08) 그 숫자가 틀렸다. 숫자를 3으로 고치면 **다음에 넷이 될 때 또 고쳐야** 하고,
  // 더 나쁜 것은 누군가 숫자만 맞추고 새 경로는 안 막는 경우다(CLAUDE.md: 목록형 감시는
  // 개수가 줄면 조용히 헐거워진다).
  //
  // 그래서 **바깥을 부르는 모든 함수**를 찾아, 그 함수 안에서 둘 다 하는지 본다.
  const 바깥부름 = []
  for (const m of s.matchAll(/async function (\w+)\([^)]*\) \{/g)) {
    const 시작 = m.index
    const 끝 = s.indexOf('\n}', 시작)
    const 본문 = s.slice(시작, 끝 < 0 ? s.length : 끝)
    if (/await fetch\(/.test(본문)) 바깥부름.push({ 이름: m[1], 본문 })
  }
  assert.ok(바깥부름.length >= 2,
    `바깥을 부르는 함수를 ${바깥부름.length}개만 찾았다 — 이 가드가 볼 대상을 놓쳤다`)
  for (const { 이름, 본문 } of 바깥부름) {
    // 정의(`function 자격증명확인(token, secret)`)가 아니라 **부르는 자리**만 본다.
    assert.match(본문, /^\s+자격증명확인\(token, secret\)$/m,
      `${이름} 이 제어문자 검사를 안 한다 — fetch 가 토큰째 담은 오류를 던진다`)
    assert.match(본문, /throw 비밀지우기\(err, token, secret\)/,
      `${이름} 이 오류에서 토큰을 안 지운다`)
  }
  // ③ 소스에 **실제 제어문자 바이트**를 넣지 않는다 — git 이 바이너리로 본다.
  const 제어 = [...s].filter(c => { const n = c.charCodeAt(0); return (n < 32 && n !== 10 && n !== 13 && n !== 9) || n === 127 })
  assert.equal(제어.length, 0, '소스에 실제 제어문자가 들어 있다 — escape 표기로 적을 것')
})

test('"유효하지 않은" 만으로 키 문제라 하지 않는다', () => {
  // *"400 유효하지 않은 지점코드"* 는 키가 아니라 지점 설정 문제다.
  assert.notEqual(연동오류읽기('400 유효하지 않은 지점코드').종류, 'auth',
    '지점코드 문제를 키 문제로 읽는다 — 멀쩡한 키를 뒤지게 된다')
  assert.equal(연동오류읽기('401 유효한 인증키가 아닙니다').종류, 'auth', '진짜 인증 오류를 놓쳤다')
})

test('서버 진단이 잘린 키 조각도 안 남긴다 — 자르기보다 가리기가 먼저', () => {
  // `/uv-debug`·`/minmax-debug` 는 응답을 500·600자로 잘라 보낸다. 먼저 자르면
  // 경계에 걸린 키가 반토막으로 남고, 온전한 키를 찾는 가리기가 그 조각을 못 본다.
  const s = fs.readFileSync(path.join(__dirname, '..', 'routes/weather.js'), 'utf8')
  const 자르고가림 = s.match(/키가리기\(\s*text\.slice/g) || []
  assert.deepEqual(자르고가림, [], '자른 뒤에 가린다 — 순서가 뒤집혔다')
  assert.match(s, /키가리기\(text, apiKey[^)]*\)\.slice\(0, 500\)/, '자외선 진단이 가린 뒤 안 자른다')
  assert.match(s, /키가리기\(text, apiKey[^)]*\)\.slice\(0, 600\)/, '최저최고 진단이 가린 뒤 안 자른다')
  // **두 진단 모두** 같은 규칙을 지난다 — 한쪽만 고치면 다른 쪽으로 샌다.
  const 가린곳 = (s.match(/키가리기\(/g) || []).length
  assert.ok(가린곳 >= 7, `가리는 자리가 ${가린곳}곳뿐이다 — 응답 본문·오류 메시지가 빠졌는지 보라`)
})

test('"설정되지 않았거나 응답이 없습니다" 를 미설정으로 확정하지 않는다', () => {
  // weather.js:39 가 실제로 쓰는 문구다. 둘 중 무엇인지 서버도 모른다고 말하고 있다.
  const r = 연동오류읽기('기상청 API 키가 설정되지 않았거나 응답이 없습니다.')
  assert.equal(r.종류, 'ambiguous', '한쪽으로 확정한다 — 멀쩡한 키를 뒤지게 된다')
  assert.match(r.다음, /둘 다 가능/, '두 가능성을 안 말한다')
})

test('503 은 "혼잡" 이라고 단정하지 않는다 — 점검일 수도 있다', () => {
  for (const 글 of ['503', '503 Service Unavailable: maintenance']) {
    const r = 연동오류읽기(글)
    assert.equal(r.종류, 'busy', `"${글}" 분류가 다르다`)
    assert.doesNotMatch(r.다음, /키나 설정 문제가 아닙니다/, '원인을 배제해 단정한다')
  }
})

test('`retry after` 만으로 "너무 자주" 라고 하지 않는다', () => {
  // 503 은 상대 서버 사정이지 우리가 자주 불러서가 아니다.
  const r = 연동오류읽기('503 UNAVAILABLE; retry after 30 seconds')
  assert.equal(r.종류, 'busy', '호출 빈도 문제로 오분류한다')
  assert.doesNotMatch(r.다음, /너무 자주/, '근거 없이 우리 탓을 한다')
  // 진짜 빈도 제한은 그대로 잡는다.
  assert.equal(연동오류읽기('429 Too Many Requests; retry in 30 seconds').종류, 'rate')
})

test('Error 객체·{error} 객체·문자열을 모두 받는다', () => {
  assert.equal(연동오류읽기(new Error('429 quota')).종류, 'quota')
  assert.equal(연동오류읽기({ error: '401 unauthorized' }).종류, 'auth')
  assert.equal(연동오류읽기('503').종류, 'busy')
  // 없는 것도 터지지 않는다 — 화면이 죽으면 오류 안내가 무슨 소용인가.
  assert.equal(연동오류읽기(null).종류, 'unknown')
  assert.equal(연동오류읽기(undefined).원문, '')
})

test('성공도 같은 모양으로 말한다 — 화면마다 낱말이 갈리지 않게', () => {
  const r = 연동성공읽기('오늘 일정 3건')
  assert.equal(r.종류, 'ok')
  assert.equal(r.무엇, '연결됐습니다.')
  assert.equal(r.다음, '오늘 일정 3건')
})

// ── 화면이 실제로 이것을 쓰는가 ──────────────────────────────────────
const fs = require('node:fs')
const path = require('node:path')
const 카드들 = ['apiSettingsWeather', 'apiSettingsAI', 'apiSettingsIntegrations']

// **한 자리만 예외다.** 자외선 진단 패널(`uvDebug`)은 HTTP 상태·resultCode·호출 URL·
// 원본 응답을 나란히 보여주는 **개발자용 블록**이라, 거기서는 원문이 곧 내용이다.
// 사람 말로 옮기면 오히려 진단을 못 한다. 가드를 느슨하게 하는 대신 이 한 줄만 적는다
// — 예외를 늘리려면 여기에 사유를 쓰게 되므로, 늘어나는 것이 눈에 보인다(헌장 §M11).
const 예외 = new Set(['{uvDebug.error}'])

test('연동 카드들이 원문 오류를 날것으로 띄우지 않는다', () => {
  for (const 이름 of 카드들) {
    const s = fs.readFileSync(
      path.join(__dirname, '..', '..', `src/components/admin/sections/${이름}.jsx`), 'utf8')
    // 긍정 앵커 — 이 카드에 오류를 그리는 자리가 실제로 있다.
    assert.match(s, /\.error/, `${이름} 에 오류 표시 자리가 없다 — 이 가드를 옮길 것`)
    assert.match(s, /ConnectionErrorNote/, `${이름} 이 공통 표시를 안 쓴다`)
    // `{something.error}` 를 그대로 본문에 박는 자리가 남아 있으면 안 된다.
    // (`오류={x.error}` 처럼 **넘겨주는** 것은 괜찮다 — 앞 글자로 가른다.)
    const 날것 = (s.match(/(?<!=)\{[A-Za-z_$][\w$?.]*\.error\}/g) || []).filter(x => !예외.has(x))
    assert.deepEqual(날것, [], `${이름} 에 날것 오류가 남았다: ${날것.join(', ')}`)
  }
})

// Codex 가 잡은 셋(EV-004591). 전부 **반대로 안내하던** 것들이다.
test('"응답 없음 (10초 초과)" 을 "오늘 양을 다 썼다" 로 읽지 않는다', () => {
  // `초과` 라는 낱말 하나로 한도 문제가 됐다. 완전히 반대 안내였다.
  const r = 연동오류읽기('서버 응답 없음 (10초 초과)')
  assert.equal(r.종류, 'network', '타임아웃을 한도 문제로 읽는다')
})

test('원인을 못 정한 서버 문구에 키라고 못 박지 않는다', () => {
  // weather.js 가 "인증키 또는 지점코드를 확인하세요" 라고 보낸다 — 확정이 아니다.
  const r = 연동오류읽기('자외선지수 API 응답 없음 — 인증키 또는 지점코드를 확인하세요.')
  assert.equal(r.종류, 'network', '"인증키" 라는 낱말만으로 단정한다')
  assert.match(r.다음, /그다음이 키/, '키 가능성을 아예 지워 버렸다')
})

test('30초만 기다리면 될 일에 "내일" 이라고 하지 않는다', () => {
  const r = 연동오류읽기('429 Too Many Requests; retry in 30 seconds')
  assert.equal(r.종류, 'rate')
  assert.match(r.다음, /잠깐 기다/, '하루를 버리게 만든다')
  assert.doesNotMatch(r.다음, /내일/, '분 단위 제한에 내일을 말한다')
})

test('한도인지 하루치인지 모르면 아는 척하지 않는다', () => {
  const r = 연동오류읽기('RESOURCE_EXHAUSTED')
  assert.equal(r.종류, 'quota')
  assert.match(r.다음, /하루 단위면 내일, 분 단위면/, '단위를 모르면서 단정한다')
})

test('연동 카드가 원문 오류를 토스트로도 안 흘린다', () => {
  // 가드가 `{객체.error}` 만 보던 사이로 `showToast('오류: ' + e.message)` 가 빠져나갔다.
  for (const 이름 of 카드들) {
    const s = fs.readFileSync(
      path.join(__dirname, '..', '..', `src/components/admin/sections/${이름}.jsx`), 'utf8')
    // 덧셈(`'오류: ' + e.message`)과 **템플릿 문자열**(`` `오류: ${e.message}` ``)을 모두 본다.
    // 처음엔 덧셈만 봐서 SwitchBot 의 템플릿 형태를 놓쳤다(Codex 지적, EV-004631).
    // 서버가 넘겨 준 문구를 **상태에 담는** 자리도 본다 — 토스트만 막으면
    // `setModelsReason(e.message)` 같은 길로 새어 나간다(Codex 지적, EV-004644).
    //
    // 다만 **담는 것 자체가 잘못은 아니다.** 그 상태가 `ConnectionErrorNote` 로 가면
    // 거기서 가려서 보여 준다. 잘못은 **화면에 그대로 그리는 것**이다. 그래서
    // "담았는데 카드로 안 넘긴" 것만 잡는다(EV-004672 에서 이 구분을 놓쳤다).
    const 담은것 = [...s.matchAll(/set([A-Z]\w*|연동오류)\(\s*(?:e|err|d)\.(?:message|reason)\s*\)/g)]
    const 샌상태 = []
    for (const m of 담은것) {
      const 이름2 = m[1] === '연동오류' ? '연동오류' : m[1][0].toLowerCase() + m[1].slice(1)
      if (!s.includes(`ConnectionErrorNote 오류={${이름2}}`)) 샌상태.push(m[0])
    }
    assert.deepEqual(샌상태, [], `${이름} 이 원문을 담고 카드로 안 넘긴다: ${샌상태.join(', ')}`)
    const 샌곳 = s.match(/showToast\([^)]*(?:\+\s*|\$\{)e(rr)?\.message[^)]*\)/g) || []
    // 저장 실패는 연동 오류가 아니라 우리 서버 쓰기 실패다 — 그건 그대로 둔다.
    const 연동샘 = 샌곳.filter(x => !/저장 실패/.test(x))
    assert.deepEqual(연동샘, [], `${이름} 이 원문을 토스트로 흘린다: ${연동샘.join(', ')}`)
  }
})

test('공통 표시가 규약 모듈을 실제로 쓴다 — 문구를 제 안에 베껴 두지 않았나', () => {
  const s = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src/components/shared/ConnectionErrorNote.jsx'), 'utf8')
  assert.match(s, /from '\.\.\/\.\.\/lib\/connectionError'/, '규약 모듈을 안 쓴다')
  assert.match(s, /연동오류읽기\(/, '오류를 사람 말로 안 옮긴다')
  // 원문을 접어서라도 남겨야 한다 — 우리가 못 알아본 것을 사람이 검색이라도 해야 한다.
  assert.match(s, /원문/, '원문을 통째로 버렸다')
})

// ── 2026-09-12 (Codex R10): **값 안에 다른 종류의 따옴표가 섞인 경우** ──────────
//
// `password='dummy secret value'` 는 지워졌는데 `password='dummy "secret" value'` 는
// `password=*** "secret" value'` 로 **뒷부분이 남았다.** 값을 `[^"']*` 로 읽어서, 여는
// 따옴표와 **다른** 종류의 따옴표에서 멈춘 것이다. 여는 것과 같은 따옴표까지 읽는다.
//
// 그리고 따옴표 짝도 본다 — 뒤 규칙이 이미 가린 값을 다시 만나 **여는 따옴표를 삼켜**
// `password=***'` 가 됐다. 비밀이 새는 것은 아니지만 읽는 사람이 원문을 다시 찾게 만든다.
test('혼합 따옴표 값도 끝까지 가린다 — 뒷부분이 남지 않는다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  for (const [이름, 글, 새면안되는것] of [
    ['작은따옴표 + 공백', "password='dummy secret value'", 'value'],
    ['혼합 따옴표',       'password=\'dummy "secret" value\'', 'value'],
    ['큰따옴표 안 작은',  'token="abc \'def\' ghi"', 'ghi'],
  ]) {
    const r = 원문가리기(글)
    assert.ok(!r.includes(새면안되는것), `${이름}: 값이 남았다 — ${r}`)
    // 따옴표 짝이 맞는다 — 한쪽만 남으면 "뭔가 잘렸다"로 읽힌다.
    const 작은 = (r.match(/'/g) || []).length
    const 큰 = (r.match(/"/g) || []).length
    assert.equal(작은 % 2, 0, `${이름}: 작은따옴표 짝이 안 맞는다 — ${r}`)
    assert.equal(큰 % 2, 0, `${이름}: 큰따옴표 짝이 안 맞는다 — ${r}`)
  }
})

test('두 번 가려도 *** *** 가 되지 않는다 — 이미 가린 것은 건너뛴다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 한번 = 원문가리기("password='dummy secret value'")
  assert.equal(원문가리기(한번), 한번, `다시 가리면 달라진다 — ${원문가리기(한번)}`)
})

// ── 2026-09-12 (Codex R11): **역슬래시로 escape 된 따옴표** ──────────────────────
//
// `JSON.stringify({password:'dummy "secret" value'})` 는
// `{"password":"dummy \"secret\" value"}` 가 된다. escape 를 모르면 그 `\"` 를 값의 끝으로
// 읽어 `secret`·`value` 가 남았다. **이 글은 화면에 그대로 뜬다**(ConnectionErrorNote.jsx).
//
// 오류 문구는 대개 `JSON.stringify` 를 거쳐 오므로 이 모양이 가장 흔한 실제 경우다.
test('JSON.stringify 가 만든 escape 따옴표에서도 값이 끝까지 가려진다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  // **찾는 낱말은 구별되게 고른다.** 처음엔 `'a'` 같은 한 글자로 썼더니 `"apiKey"` 안의
  // `a` 에 걸려, 제대로 가려진 결과를 "샜다"로 읽었다 — 가드의 오탐이다.
  const 사례 = [
    [{ password: 'dummy "secret" value' }, ['dummy', 'secret', 'value']],
    [{ apiKey: 'zeta "eta" theta \'iota\' kappa' }, ['zeta', 'eta', 'theta', 'iota', 'kappa']],
    [{ client_secret: 'lambda\\"mu' }, ['lambda', 'mu']],
  ]
  for (const [obj, 새면안되는것들] of 사례) {
    const 글 = JSON.stringify(obj)
    const r = 원문가리기(글)
    for (const 말 of 새면안되는것들) {
      assert.ok(!r.includes(말), `"${말}" 이 남았다 — 원문: ${글} → ${r}`)
    }
    assert.match(r, /\*\*\*/, `가렸다는 표시가 없다 — ${r}`)
  }
})

test('escape 따옴표가 섞여도 진단 필드는 살아 있다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 글 = JSON.stringify({
    keySource: 'kma_living_api_key', keyMasked: 'abc...xyz', keySet: true,
    password: 'dummy "secret" value',
  })
  const r = 원문가리기(글)
  assert.ok(!r.includes('secret'), `비밀이 남았다: ${r}`)
  assert.match(r, /kma_living_api_key/, 'keySource 를 가렸다 — 어느 키를 쓰는지 못 본다')
  assert.match(r, /abc\.\.\.xyz/, 'keyMasked 를 가렸다')
})

test('두 번 가려도 결과가 같다 — 멱등이다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  for (const 글 of [
    JSON.stringify({ password: 'dummy "secret" value' }),
    JSON.stringify({ keySource: 'kma_living_api_key', apiKey: 'REALSECRET99' }),
    "password='dummy secret value'",
    'Authorization: Bearer ya29.DUMMY',
    'GET /uv?base_date=20260911&numOfRows=10',
  ]) {
    const 한번 = 원문가리기(글)
    assert.equal(원문가리기(한번), 한번, `두 번 가리면 달라진다 — ${글} → ${한번} → ${원문가리기(한번)}`)
  }
})

// ── 2026-09-12 (Codex R12): **규칙 순서** ─────────────────────────────────────
//
// 비밀 값 **안에** 질의 형태가 들어 있으면, 질의 규칙이 먼저 돌며 `?token=abc\` 의
// **escape 역슬래시까지 지웠다.** 그러면 따옴표 규칙이 그 따옴표를 값의 끝으로 읽어
// 뒷부분이 남았다 — `{"password":"dummy ?token=abc\"secret\" tail"}` 에서 `secret`·`tail`.
//
// 고친 것은 규칙 본문이 아니라 **순서**다. 따옴표로 묶인 값이 더 넓은 덩이라 먼저 가린다.
// 이 시험은 그 순서가 뒤집히면 빨간불이 된다.
test('비밀 값 안에 질의 형태가 있어도 끝까지 가려진다 — 규칙 순서', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  const 글 = JSON.stringify({ password: 'dummy ?token=abc"secret" tail' })
  const r = 원문가리기(글)
  for (const 말 of ['dummy', 'secret', 'tail', 'abc']) {
    assert.ok(!r.includes(말), `"${말}" 이 남았다 — ${글} → ${r}`)
  }
  assert.match(r, /\*\*\*/, '가렸다는 표시가 없다')
  assert.equal(원문가리기(r), r, `두 번 가리면 달라진다 — ${원문가리기(r)}`)
})

test('순서를 바꿔도 질의·진단·평범한 값은 그대로다', () => {
  const { 원문가리기 } = require('../../src/lib/connectionError.js')
  // 질의 가리기가 여전히 돈다
  assert.ok(!원문가리기('https://x/y?serviceKey=DUMMYSECRET123&nx=60').includes('DUMMYSECRET123'))
  // 진단 필드는 산다
  const 진단 = 원문가리기(JSON.stringify({ keySource: 'kma_living_api_key', keyMasked: 'abc...xyz' }))
  assert.match(진단, /kma_living_api_key/)
  assert.match(진단, /abc\.\.\.xyz/)
  // 멀쩡한 값은 안 가린다
  for (const 글 of ['GET /uv?base_date=20260911&numOfRows=10&nx=60',
    'GET /x?filename=weather_diagnostic_report.json',
    'GET /x?request_id=12345678-1234-1234-1234-123456789012']) {
    assert.equal(원문가리기(글), 글, `멀쩡한 값을 가렸다: ${원문가리기(글)}`)
  }
})
