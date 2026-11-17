'use strict'
// **어르신 실명이 Gemini 로 나가지 않는다** (사용자 승인 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 제출 문서 §4.5 가 이 구멍을 적고 있었다. 민감정보 검사(`checkSensitive`)가 도는 자리는
// **셋**인데(예약 저장·초안 승인·즉시 TTS 발사) 전부 *"스피커로 나가기 전 · 예약으로
// 저장되기 전"* 이고, **Gemini 로 보내기 전에는 하나도 안 돈다.**
//
// 그래서 *"오늘은 김○○ 어르신 생신입니다"* 같은 문안이 **그대로 구글로 갔다.**
// 현장은 **무료 티어**라 약관상 그 입력이 모델 개선에 쓰이고 사람이 읽을 수 있다
// (SUBMISSION §4.5 1번). 그리고 **실제로 그런 문안이 이력에 있다**(생신 안내).
//
// ── 어떻게 푸는가 ──────────────────────────────────────────────────────────
// **막지 않고 바꿔서 보낸다.** 「이름 있으면 AI 안 쓴다」로 막으면 생신 안내처럼 이름이
// 꼭 들어가는 방송은 AI 를 영영 못 쓴다.
//
//   보낼 때 : 「김철수 어르신」 → 「사람1 어르신」
//   돌아올 때: 「사람1 어르신의」 → 「김철수 어르신의」
//
// 직원·어르신이 보는 것은 하나도 안 바뀐다. **바깥으로 안 나갈 뿐이다.**
//
// **번호는 되돌리지 않는다.** 주민등록번호·휴대폰번호는 이 저장소가 이미 「차단」으로
// 정한 값이라(`sensitiveInfo.js` 머리말) 방송문·자막에 남을 이유가 없다. 그래서
// 자리표도 안 주고 그 자리에서 뺀다.
//
// ── 자리는 한 곳이다 ───────────────────────────────────────────────────────
// 호출부는 다섯인데(ai.js×3 · geminiSchedule.js · audio.js) 전부 `fetchGeminiWithRetry`
// 를 지난다. 호출부마다 걸면 **여섯 번째가 생기는 날 그것만 샌다** — 이 저장소가 이미
// 두 번 겪은 모양이다(소리 이벤트는 `broadcastSSE`, 자격증명은 이 함수 한 곳).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { fetchGeminiWithRetry } = require('../services/geminiClient')

const 키 = 'AIzaSyTESTKEY_0000000000000000000000000'
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent'

// fetch 를 가로채 **실제로 나간 본문**을 본다. 던지기만 하고 이미 나간 뒤면 소용없다.
// 돌려주는 응답 글은 시험이 정한다 — 되돌리기를 보려면 그쪽도 흉내내야 한다.
function fetch가로채기(답글 = '') {
  const 원래 = global.fetch
  const 나간것 = []
  global.fetch = async (u, o) => {
    나간것.push({ u, o, 본문: typeof o?.body === 'string' ? o.body : String(o?.body ?? '') })
    const 몸통 = JSON.stringify({ candidates: [{ content: { parts: [{ text: 답글 }] } }] })
    return new Response(몸통, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { 나간것, 되돌리기: () => { global.fetch = 원래 } }
}

const 보내기 = (글, opts) => fetchGeminiWithRetry(URL_, {
  method:  'POST',
  headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
  body:    JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 글 }] }] }),
}, opts)

// ── 1. 긍정 앵커 — 아래 부정 단언들이 볼 대상이 실제로 있다 ─────────────────
test('긍정 앵커 — 이 길로 보내면 본문이 실제로 나간다', async () => {
  const G = fetch가로채기('안녕하세요')
  try {
    await 보내기('오늘 점심은 된장찌개입니다')
    assert.equal(G.나간것.length, 1, '아무것도 안 나갔다 — 아래 시험들의 전제가 무너졌다')
    assert.match(G.나간것[0].본문, /된장찌개/, '멀쩡한 글이 안 실렸다')
  } finally { G.되돌리기() }
})

// ── 2. 실명이 바깥으로 안 나간다 ───────────────────────────────────────────
test('**어르신 실명이 나가는 본문에 없다** — 자리표로 바뀐다', async () => {
  const G = fetch가로채기('오늘은 사람1 어르신의 생신입니다.')
  try {
    await 보내기('오늘은 김철수 어르신 생신입니다. 축하해 주세요.')
    const 본문 = G.나간것[0].본문
    assert.ok(!본문.includes('김철수'), '실명이 그대로 구글로 나갔다')
    assert.match(본문, /사람\d/, '자리표로 바뀌지 않았다 — 이름이 그냥 사라지면 문장이 망가진다')
    // 이름 말고는 그대로여야 한다. 문장을 통째로 갈아엎으면 AI 가 딴 소리를 한다.
    assert.match(본문, /생신입니다/, '이름 말고 다른 글까지 건드렸다')
  } finally { G.되돌리기() }
})

// ── 3. 돌아오면 되돌린다 ───────────────────────────────────────────────────
test('**돌아온 자리표가 원래 이름으로 되돌아온다** — 직원이 보는 것은 안 바뀐다', async () => {
  const G = fetch가로채기('오늘은 사람1 어르신의 생신입니다. 다 함께 축하드립시다.')
  try {
    const res = await 보내기('오늘은 김철수 어르신 생신입니다.')
    const data = await res.json()
    const 답 = data.candidates[0].content.parts[0].text
    assert.match(답, /김철수/, '되돌리지 않았다 — 방송에 「사람1」이 나간다')
    assert.ok(!/사람\d/.test(답), '자리표가 남아 있다')
  } finally { G.되돌리기() }
})

test('이름이 둘이면 각각 제 이름으로 돌아온다 — 섞이면 안 된다', async () => {
  // 섞이면 **남의 이름으로 방송이 나간다.** 조용한 오독 중에서도 나쁜 쪽이다.
  const G = fetch가로채기('사람2 어르신과 사람1 어르신께 안내드립니다.')
  try {
    const res = await 보내기('김철수 어르신과 박영희 어르신께 안내드립니다.')
    const 답 = (await res.json()).candidates[0].content.parts[0].text
    // 「사람1」 은 먼저 나온 이름(김철수), 「사람2」 는 그다음(박영희)이어야 한다.
    assert.match(답, /박영희 어르신과 김철수 어르신께/, '자리표와 이름이 어긋났다')
  } finally { G.되돌리기() }
})

// ── 4. 되돌리기가 실패하면 그 결과를 버린다 ────────────────────────────────
test('**자리표가 망가져 돌아오면 그 결과를 안 쓴다** — 「사람1」이 방송되면 안 된다', async () => {
  // AI 가 자리표를 제멋대로 바꿔 놓을 수 있다(띄어쓰기·번호 변경). 그대로 쓰면
  // 「사람 1 어르신 생신입니다」가 스피커로 나간다. 그럴 바엔 AI 를 안 쓴 원문이 낫다.
  const G = fetch가로채기('오늘은 사람 7 어르신의 생신입니다.')
  try {
    await assert.rejects(
      () => 보내기('오늘은 김철수 어르신 생신입니다.'),
      /자리표|되돌/,
      '망가진 자리표가 든 결과를 그대로 돌려줬다',
    )
  } finally { G.되돌리기() }
})

test('자리표가 아예 안 돌아오는 것은 실패가 아니다 — 방송문 생성은 새로 짓는다', async () => {
  // `/api/ai` 의 방송문 생성은 **키워드를 받아 새 문장을 짓는다.** 자리표를 그대로
  // 되받을 이유가 없다. 여기서 실패로 치면 이름이 든 키워드는 AI 를 영영 못 쓴다.
  const G = fetch가로채기('환절기 감기 조심하시기 바랍니다.')
  try {
    const res = await 보내기('김철수 어르신 생신')
    const 답 = (await res.json()).candidates[0].content.parts[0].text
    assert.match(답, /환절기/, '멀쩡한 답을 버렸다')
  } finally { G.되돌리기() }
})

// ── 5. 번호는 자리표 없이 뺀다 ─────────────────────────────────────────────
test('**주민등록번호·휴대폰번호는 나가지도, 돌아오지도 않는다**', async () => {
  const G = fetch가로채기('연락처 안내드립니다.')
  try {
    const res = await 보내기('보호자 연락처는 010-1234-5678이고 주민번호는 900101-1234567입니다')
    const 본문 = G.나간것[0].본문
    assert.ok(!본문.includes('010-1234-5678'), '휴대폰번호가 구글로 나갔다')
    assert.ok(!본문.includes('900101-1234567'), '주민등록번호가 구글로 나갔다')
    // **되돌리지 않는다** — 방송문·자막에 남을 이유가 없는 값이다.
    const 답 = (await res.json()).candidates[0].content.parts[0].text
    assert.ok(!답.includes('010-1234-5678'), '번호를 되돌려 놨다')
  } finally { G.되돌리기() }
})

test('같은 이름이 여러 번 나오면 **같은 자리표**를 쓴다 — 갈라 주면 두 사람이 된다', async () => {
  // 한 사람을 「사람1」·「사람2」로 갈라 보내면 모델이 두 사람으로 읽고, 되돌릴 때
  // 같은 이름이 두 번 박힌 엉뚱한 문장이 나온다.
  const H = fetch가로채기('사람1 어르신께 안내드립니다.')
  try {
    await fetchGeminiWithRetry(URL_, {
      method:  'POST',
      headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
      body:    JSON.stringify({ contents: [
        { role: 'user', parts: [{ text: '김철수 어르신께 안내드립니다.' }] },
        { role: 'user', parts: [{ text: '김철수 어르신 가족분도 오셨습니다.' }] },
      ] }),
    })
    const 본문 = H.나간것[0].본문
    assert.ok(!본문.includes('김철수'), '실명이 나갔다')
    assert.ok(!본문.includes('사람2'), '같은 사람에게 자리표를 둘 줬다 — 모델이 두 사람으로 읽는다')
    assert.equal((본문.match(/사람1/g) || []).length, 2, '두 자리 모두 같은 자리표로 안 바뀌었다')
  } finally { H.되돌리기() }
})

test('자리표가 열을 넘어도 안 섞인다 — `사람1` 이 `사람10` 의 앞을 먹으면 안 된다', () => {
  // 되돌릴 때 짧은 자리표부터 바꾸면 「사람10」이 「김철수0」이 된다. 열 명이 넘는
  // 방송은 드물지만, 나면 **남의 이름으로 나간다.** 규칙 자체를 직접 본다.
  const { 글되돌리기 } = require('../services/promptPrivacy')
  const 표 = new Map()
  for (let i = 1; i <= 12; i++) 표.set(`사람${i}`, `이름${String.fromCharCode(0x40 + i)}`)
  const { 글, 실패 } = 글되돌리기('사람10 어르신과 사람1 어르신', 표)
  assert.equal(실패, false, '멀쩡한 글을 실패로 봤다')
  assert.equal(글, '이름J 어르신과 이름A 어르신', '자리표 번호가 섞였다')
})

// ── 6. 멀쩡한 요청은 한 글자도 안 건드린다 ─────────────────────────────────
test('가릴 것이 없으면 본문이 **한 글자도** 안 바뀐다', async () => {
  const G = fetch가로채기('네')
  // **일부러 `JSON.stringify` 와 다른 모양으로 적는다.** 같은 모양으로 적으면 본문을
  // 다시 만들어도 결과가 같아서, 「안 건드렸다」와 「건드렸는데 티가 안 난다」가 갈리지
  // 않는다(변이로 확인했다 — 이 시험이 그것을 못 보고 통과했다).
  const 원문 = '{"contents": [ {"role": "user", "parts": [ {"text": "오늘 점심은 된장찌개입니다"} ]} ]}'
  try {
    await fetchGeminiWithRetry(URL_, {
      method:  'POST',
      headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
      body:    원문,
    })
    assert.equal(G.나간것[0].본문, 원문,
      '가릴 것이 없는데 본문을 다시 만들었다 — 멀쩡한 요청의 모양이 바뀐다')
  } finally { G.되돌리기() }
})

test('JSON 이 아닌 본문·본문 없는 요청도 그냥 지나간다', async () => {
  // `/api/ai/models` 는 **GET 이고 본문이 없다.** 여기서 죽으면 모델 목록이 안 뜬다.
  const G = fetch가로채기('{}')
  try {
    await fetchGeminiWithRetry('https://generativelanguage.googleapis.com/v1beta/models',
      { method: 'GET', headers: { 'x-goog-api-key': 키 } })
    assert.equal(G.나간것.length, 1, '본문 없는 요청이 막혔다 — 모델 목록이 안 뜬다')
  } finally { G.되돌리기() }
})

// ── 7. 자리가 한 곳인지 소스로 고정한다 ────────────────────────────────────
test('**Gemini 주소를 직접 부르는 곳이 없다** — 다섯 자리가 전부 이 래퍼를 지난다', () => {
  const 볼곳 = ['routes', 'services', 'domain']
  const 샌곳 = []
  for (const 칸 of 볼곳) {
    const 뿌리 = path.join(ROOT, 'server', 칸)
    if (!fs.existsSync(뿌리)) continue
    for (const 이름 of fs.readdirSync(뿌리)) {
      if (!이름.endsWith('.js') || 이름 === 'geminiClient.js') continue
      const src = fs.readFileSync(path.join(뿌리, 이름), 'utf8')
      const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      // `fetch(` 로 generativelanguage 를 직접 부르는 모양
      if (/\bfetch\s*\(\s*[`'"][^`'"]*generativelanguage/.test(코드만)) 샌곳.push(`${칸}/${이름}`)
    }
  }
  assert.deepEqual(샌곳, [], `이 파일들이 래퍼를 안 지난다 — 거기서만 실명이 샌다: ${샌곳.join(', ')}`)
})

test('가리기가 `fetchGeminiWithRetry` 안에서 돈다 — 호출부에 흩어 놓지 않았다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/services/geminiClient.js'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /require\(['"]\.\/promptPrivacy['"]\)/,
    'geminiClient 가 가리기를 안 부른다')
  const i = 코드만.indexOf('async function fetchGeminiWithRetry')
  assert.ok(i > 0, 'fetchGeminiWithRetry 를 못 찾았다')
  assert.match(코드만.slice(i), /가리기|되돌리기/,
    '가리기가 이 함수 밖에 있다 — 새 호출부가 생기면 그것만 샌다')
})

// ── 8. 가리기 규칙이 방송 필터와 **같은 출처**를 쓴다 ──────────────────────
test('이름 찾는 규칙이 `sensitiveInfo` 한 곳에서 온다 — 두 벌이 되면 한쪽만 고쳐진다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/services/promptPrivacy.js'), 'utf8')
  assert.match(src, /require\(['"]\.\/sensitiveInfo['"]\)/,
    '가리기가 이름 찾는 규칙을 따로 들고 있다')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/SURNAMES|const\s+TITLES/.test(코드만),
    '성씨·호칭 목록을 여기 복사했다 — 방송 필터와 갈린다')
})
