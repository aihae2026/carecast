'use strict'
// UX-09 — Gemini 는 **안내·추천까지만** 한다 (2026-09-11).
//
// 규칙은 CLAUDE.md 에 적혀 있었지만 **고정하는 검사가 없었다.** 규칙만 있는 경계는
// 다음 사람이 모르고 넘는다. 여기서 넘으면 무엇이 나가나 —
//
//   ① **API 키가 프롬프트로 나간다.** 키는 헤더(`x-goog-api-key`)로 가는 것이고
//      본문에 들어가면 그대로 외부 모델의 입력이 된다. 로그·학습·오류 리포트에 남는다.
//   ② **AI 가 지어낸 것이 곧바로 운영 데이터가 된다.** 이 저장소는 "초안 → 사람 승인"
//      2단계가 기본이다(CLAUDE.md AI 자동 생성 결과물 규칙).
//
// ①은 **호출 그 자리에서 헤더와 본문을 대조**하면 DB 없이 정확히 본다 — 키가 이미
// 인자로 와 있기 때문이다. 그래서 가드를 `fetchGeminiWithRetry` 한 곳에만 둔다.
// 네 호출부(ai.js×3 · geminiSchedule.js · audio.js)가 전부 이 함수를 지난다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 서버 = path.join(ROOT, 'server')
const { fetchGeminiWithRetry } = require('../services/geminiClient')

const 키 = 'AIzaSyTESTKEY_0000000000000000000000000'
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent'

// fetch 를 가로채 **실제로 나갔는지**를 본다. 던지기만 하고 이미 나간 뒤면 소용없다.
function fetch가로채기() {
  const 원래 = global.fetch
  const 나간것 = []
  global.fetch = async (u, o) => { 나간것.push({ u, o }); return { ok: true, status: 200 } }
  return { 나간것, 되돌리기: () => { global.fetch = 원래 } }
}

test('키가 본문에 섞이면 호출이 나가기 전에 막는다', async () => {
  const G = fetch가로채기()
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
        // 사람이 실수로 키를 문안에 붙여 넣었거나, 설정값을 통째로 프롬프트에 실은 경우.
        body: JSON.stringify({ contents: [{ parts: [{ text: `내 키는 ${키} 야` }] }] }),
      }),
      /키|자격/,
    )
    assert.equal(G.나간것.length, 0, '막았다면서 이미 나갔다 — 그러면 막은 것이 아니다')
  } finally { G.되돌리기() }
})

test('Authorization 같은 다른 자격증명도 같은 규칙을 받는다', async () => {
  const G = fetch가로채기()
  const 토큰 = 'Bearer ya29.SOMEACCESSTOKEN_LONG_ENOUGH'
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: { authorization: 토큰, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 토큰 }] }] }),
      }),
      /키|자격/,
    )
    assert.equal(G.나간것.length, 0)
  } finally { G.되돌리기() }
})

// fetch 는 헤더를 **세 모양**으로 받는다 — 객체 · Headers · [이름,값] 쌍의 배열.
// 배열은 `Array.prototype.entries()` 가 `[인덱스, 값]` 을 내놓아서, 이름을 `0` 으로 읽고
// 검사를 통째로 건너뛴다. Codex 독립 검수가 실제로 실행해 재현했다(EV-004492).
// 지금 제품 호출부는 전부 객체지만, **가드가 모양에 따라 있다 없다 하면 가드가 아니다.**
test('헤더를 배열로 줘도 막는다 — entries() 가 [인덱스,값] 을 내놓는 함정', async () => {
  const G = fetch가로채기()
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: [['x-goog-api-key', 키], ['content-type', 'application/json']],
        body: JSON.stringify({ contents: [{ parts: [{ text: `내 키는 ${키} 야` }] }] }),
      }),
      /키|자격/,
    )
    assert.equal(G.나간것.length, 0, '배열 헤더로 가드를 우회했다')
  } finally { G.되돌리기() }
})

test('Headers 객체로 줘도 막는다', async () => {
  const G = fetch가로채기()
  try {
    const h = new Headers()
    h.set('x-goog-api-key', 키)
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ contents: [{ parts: [{ text: 키 }] }] }),
      }),
      /키|자격/,
    )
    assert.equal(G.나간것.length, 0)
  } finally { G.되돌리기() }
})

// 본문도 모양이 여럿이다. 문자열만 보면 Buffer 로 감싼 같은 JSON 이 그대로 나간다 —
// Codex 독립 검수가 더미 키로 재현했다(EV-004516). 배열 헤더 때와 같은 모양의 실수다.
for (const [모양, 만들기] of [
  ['Buffer', (s) => Buffer.from(s, 'utf8')],
  ['Uint8Array', (s) => new Uint8Array(Buffer.from(s, 'utf8'))],
]) {
  test(`본문을 ${모양} 로 줘도 막는다`, async () => {
    const G = fetch가로채기()
    try {
      await assert.rejects(
        () => fetchGeminiWithRetry(URL_, {
          method: 'POST',
          headers: { 'x-goog-api-key': 키 },
          body: 만들기(JSON.stringify({ contents: [{ parts: [{ text: 키 }] }] })),
        }),
        /키|자격/,
      )
      assert.equal(G.나간것.length, 0, `${모양} 본문으로 가드를 우회했다`)
    } finally { G.되돌리기() }
  })
}

// 검사할 수 **없는** 본문을 "유출 없음"으로 읽으면 그게 제일 나쁘다 — 못 본 것을
// 봤다고 하는 것이다. Codex 가 네 모양 모두 통과시키는 것을 재현했다(EV-004535).
for (const [모양, 만들기] of [
  ['URLSearchParams', () => new URLSearchParams({ text: 키 })],
  ['FormData', () => { const f = new FormData(); f.append('text', 키); return f }],
  ['Blob', () => new Blob([키])],
  ['ReadableStream', () => new ReadableStream({ start(c) { c.enqueue(키); c.close() } })],
]) {
  test(`${모양} 본문은 "검사 못 했다" 고 막는다 — 통과시키지 않는다`, async () => {
    const G = fetch가로채기()
    try {
      await assert.rejects(
        () => fetchGeminiWithRetry(URL_, {
          method: 'POST',
          headers: { 'x-goog-api-key': 키 },
          body: 만들기(),
        }),
        /검사/,
      )
      assert.equal(G.나간것.length, 0, `${모양} 본문이 검사 없이 나갔다`)
    } finally { G.되돌리기() }
  })
}

test('JSON 이스케이프로 적은 키도 막는다 — 받는 쪽이 풀면 같은 키다', async () => {
  const G = fetch가로채기()
  try {
    // 첫 글자 `A` 를 `A` 로 적었다. 원문 대조만 하면 안 걸리지만,
    // JSON 을 푼 값은 키 그대로다 — 즉 나가는 것은 같다.
    const 숨긴본문 = `{"contents":[{"parts":[{"text":"\\u0041${키.slice(1)}"}]}]}`
    assert.ok(!숨긴본문.includes(키), '이 시험이 성립하려면 원문에는 키가 없어야 한다')
    assert.equal(JSON.parse(숨긴본문).contents[0].parts[0].text, 키, '푼 값이 키와 같아야 한다')
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: { 'x-goog-api-key': 키 },
        body: 숨긴본문,
      }),
      /키|자격/,
    )
    assert.equal(G.나간것.length, 0, '이스케이프로 가드를 우회했다')
  } finally { G.되돌리기() }
})

// Codex R4 가 잡은 셋(EV-004547). 전부 "모양을 손으로 열거하다 빠뜨린" 같은 뿌리다.
test('iterable 로 준 헤더도 막는다 — fetch 가 받는 것은 전부 받아야 한다', async () => {
  const G = fetch가로채기()
  const 쌍들 = { *[Symbol.iterator]() { yield ['x-goog-api-key', 키] } }
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: 쌍들,
        body: JSON.stringify({ text: 키 }),
      }), /키|자격/)
    assert.equal(G.나간것.length, 0, 'iterable 헤더로 우회했다')
  } finally { G.되돌리기() }
})

test('같은 헤더를 두 번 준 경우 **앞쪽** 키도 막는다', async () => {
  // Headers 가 `, ` 로 합치므로, 합친 문자열만 보면 앞쪽 값이 안 걸린다.
  const G = fetch가로채기()
  const 다른키 = 'AIzaSyOTHERKEY_1111111111111111111111111'
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: [['x-goog-api-key', 키], ['x-goog-api-key', 다른키]],
        body: JSON.stringify({ text: 키 }),   // 앞쪽 키가 본문에 있다
      }), /키|자격/)
    assert.equal(G.나간것.length, 0, '앞쪽 키가 안 걸렸다')
  } finally { G.되돌리기() }
})

test('JSON 속성 **이름** 에 숨겨도 막는다', async () => {
  const G = fetch가로채기()
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { 'x-goog-api-key': 키 },
        body: JSON.stringify({ [키]: 1 }),
      }), /키|자격/)
    assert.equal(G.나간것.length, 0, '속성 이름으로 우회했다')
  } finally { G.되돌리기() }
})

test('훑기 상한에 닿으면 "검사 못 했다" 고 막는다 — 앞에 긴 글을 깔아도 소용없다', async () => {
  const G = fetch가로채기()
  // 상한을 넘기는 깊이. 덜 보고 "없다"고 말하면 안 된다.
  let 깊은것 = { text: `A${키.slice(1)}` }
  for (let i = 0; i < 30; i++) 깊은것 = { 안: 깊은것 }
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { 'x-goog-api-key': 키 },
        body: JSON.stringify(깊은것),
      }), /검사|키|자격/)
    assert.equal(G.나간것.length, 0, '덜 훑고 통과시켰다')
  } finally { G.되돌리기() }
})

// Codex R5(EV-004556). 앞의 둘은 같은 뿌리다 — **검사한 것과 보내는 것이 달랐다.**
test('본문을 두 번 읽어도 검사한 그 값이 나간다 — getter 로 바꿔치기 못 한다', async () => {
  const 원래fetch = global.fetch
  const 나간본문 = []
  global.fetch = async (u, o) => { 나간본문.push(o && o.body); return { ok: true, status: 200 } }
  let 몇번째 = 0
  const 옵션 = {
    method: 'POST',
    headers: { 'x-goog-api-key': 키 },
    // 첫 읽기엔 평범한 문안, 다음 읽기엔 키를 내놓는다.
    get body() {
      몇번째 += 1
      return 몇번째 === 1
        ? JSON.stringify({ text: '점심 안내' })
        : JSON.stringify({ text: 키 })
    },
  }
  try {
    await fetchGeminiWithRetry(URL_, 옵션)
    assert.equal(나간본문.length, 1)
    assert.ok(!String(나간본문[0]).includes(키), '검사 안 한 본문이 나갔다')
    assert.match(String(나간본문[0]), /점심 안내/, '검사한 그 본문이 아니다')
  } finally { global.fetch = 원래fetch }
})

test('한 번 쓰면 없어지는 헤더 iterator 를 검사에서 써 버리지 않는다', async () => {
  const 원래fetch = global.fetch
  let 나간헤더 = null
  global.fetch = async (u, o) => { 나간헤더 = new Headers(o.headers); return { ok: true, status: 200 } }
  function* 한번만() { yield ['x-goog-api-key', 키] }
  try {
    await fetchGeminiWithRetry(URL_, {
      method: 'POST',
      headers: 한번만(),
      body: JSON.stringify({ text: '점심 안내' }),
    })
    assert.equal(나간헤더.get('x-goog-api-key'), 키,
      '검사가 iterator 를 다 써 버려 인증 헤더가 사라졌다 — 정상 요청이 401 이 된다')
  } finally { global.fetch = 원래fetch }
})

test('짧은 토큰도 막는다 — 진짜 키는 길지만 시험용 값도 나가면 안 된다', async () => {
  const G = fetch가로채기()
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST',
        headers: { authorization: 'Bearer abc1234' },
        body: JSON.stringify({ text: 'abc1234' }),
      }), /키|자격/)
    assert.equal(G.나간것.length, 0, '짧다는 이유로 통과시켰다')
  } finally { G.되돌리기() }
})

// Codex R6(EV-004567). 셋 다 지금 호출부에는 없는 시나리오지만, 값싸고 옳다.
test('아주 짧은 토큰은 **본문 값이 그것 자체일 때** 막는다', async () => {
  const G = fetch가로채기()
  try {
    await assert.rejects(
      () => fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { authorization: 'Bearer abc' },
        body: JSON.stringify({ text: 'abc' }),
      }), /키|자격/)
    assert.equal(G.나간것.length, 0, '짧은 토큰이 그대로 나갔다')
  } finally { G.되돌리기() }
})

test('짧은 토큰이 문장 **속에** 들어간 것은 안 막는다 — 멀쩡한 방송을 깨면 안 된다', async () => {
  const G = fetch가로채기()
  try {
    const r = await fetchGeminiWithRetry(URL_, {
      method: 'POST', headers: { authorization: 'Bearer abc' },
      body: JSON.stringify({ text: 'abc 프로그램 안내 방송문을 써 줘' }),
    })
    assert.equal(r.ok, true)
    assert.equal(G.나간것.length, 1, '멀쩡한 방송문을 막았다 — 가드가 짐이 된다')
  } finally { G.되돌리기() }
})

test('Buffer 를 검사 뒤에 덮어써도 검사한 내용이 나간다', async () => {
  const 원래fetch = global.fetch
  const 나간것 = []
  const buf = Buffer.from(JSON.stringify({ text: '점심 안내' }))
  global.fetch = async (u, o) => {
    나간것.push(Buffer.from(o.body).toString('utf8'))
    // 호출부가 같은 Buffer 를 덮어쓴다(재시도 사이에 벌어질 수 있는 일).
    Buffer.from(JSON.stringify({ text: 키 })).copy(buf)
    return 나간것.length === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 }
  }
  try {
    await fetchGeminiWithRetry(URL_, {
      method: 'POST', headers: { 'x-goog-api-key': 키 }, body: buf,
    })
    for (const 나간 of 나간것) {
      assert.ok(!나간.includes(키), '덮어쓴 Buffer 의 키가 나갔다')
    }
  } finally { global.fetch = 원래fetch }
})

test('본문 getter 는 한 번만 읽는다 — 두 번째 읽기에서 터져도 요청은 나간다', async () => {
  const G = fetch가로채기()
  let 읽은횟수 = 0
  try {
    const r = await fetchGeminiWithRetry(URL_, {
      method: 'POST',
      headers: { 'x-goog-api-key': 키 },
      get body() {
        읽은횟수 += 1
        if (읽은횟수 > 1) throw new Error('이 본문은 한 번만 읽을 수 있습니다')
        return JSON.stringify({ text: '점심 안내' })
      },
    })
    assert.equal(r.ok, true)
    assert.equal(읽은횟수, 1, `본문을 ${읽은횟수}번 읽었다 — 한 번만 읽어야 한다`)
    assert.equal(G.나간것.length, 1)
  } finally { G.되돌리기() }
})

// Codex R7(EV-004582).
test('TypedArray·ArrayBuffer 본문도 내용까지 베껴 둔다 — 메모리를 공유하면 사본이 아니다', async () => {
  for (const [모양, 만들기] of [
    ['Uint8Array', (s) => new Uint8Array(Buffer.from(s, 'utf8'))],
    ['ArrayBuffer', (s) => { const u = new Uint8Array(Buffer.from(s, 'utf8')); return u.buffer }],
  ]) {
    const 원래fetch = global.fetch
    const 나간것 = []
    const 정상 = JSON.stringify({ text: '점심 안내입니다 여러분' })
    const 몸 = 만들기(정상)
    const 쓸수있는 = 몸 instanceof ArrayBuffer ? new Uint8Array(몸) : 몸
    global.fetch = async (u, o) => {
      나간것.push(Buffer.from(o.body).toString('utf8'))
      // 호출부가 원본 메모리를 덮어쓴다(길이를 맞춰서).
      const 나쁜 = Buffer.from(JSON.stringify({ text: 키 }).padEnd(정상.length, ' '), 'utf8')
      쓸수있는.set(나쁜.subarray(0, 쓸수있는.length))
      return 나간것.length === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 }
    }
    try {
      await fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { 'x-goog-api-key': 키 }, body: 몸,
      })
      for (const 나간 of 나간것) {
        assert.ok(!나간.includes(키), `${모양}: 덮어쓴 내용이 나갔다 — 사본이 아니었다`)
      }
    } finally { global.fetch = 원래fetch }
  }
})

test('접두사가 있든 없든 짧은 자격증명은 **같은 규칙**을 받는다', async () => {
  // 예전엔 `authorization: 'abc'` 만 부분 일치로 잡혀 멀쩡한 문장을 막았다.
  for (const 값 of ['abc', 'Bearer abc']) {
    const G = fetch가로채기()
    try {
      const r = await fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { authorization: 값 },
        body: JSON.stringify({ text: 'abc 프로그램 안내 방송문' }),
      })
      assert.equal(r.ok, true, `"${값}" 일 때 멀쩡한 문장을 막았다`)
      assert.equal(G.나간것.length, 1)
    } finally { G.되돌리기() }
  }
  // 그래도 본문 값이 **그것 자체**면 둘 다 막는다.
  for (const 값 of ['abc', 'Bearer abc']) {
    const G = fetch가로채기()
    try {
      await assert.rejects(() => fetchGeminiWithRetry(URL_, {
        method: 'POST', headers: { authorization: 값 },
        body: JSON.stringify({ text: 'abc' }),
      }), /키|자격/)
      assert.equal(G.나간것.length, 0, `"${값}" 일 때 짧은 자격증명이 나갔다`)
    } finally { G.되돌리기() }
  }
})

test('평범한 방송문은 그대로 나간다 — 가드가 정상 호출을 막지 않는다', async () => {
  const G = fetch가로채기()
  try {
    const r = await fetchGeminiWithRetry(URL_, {
      method: 'POST',
      headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: '점심 식사 안내 방송문을 써 줘' }] }] }),
    })
    assert.equal(r.ok, true)
    assert.equal(G.나간것.length, 1, '정상 호출이 안 나갔다')
  } finally { G.되돌리기() }
})

test('본문 없는 호출(모델 목록 조회 GET)도 통과한다', async () => {
  const G = fetch가로채기()
  try {
    await fetchGeminiWithRetry(URL_, { method: 'GET', headers: { 'x-goog-api-key': 키 } })
    assert.equal(G.나간것.length, 1)
  } finally { G.되돌리기() }
})

// ── 배선: 이 가드를 우회하는 길이 없어야 한다 ────────────────────────────
test('Gemini 를 부르는 곳은 전부 fetchGeminiWithRetry 를 지난다', () => {
  const 뒤진곳 = []
  ;(function 훑기(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') 훑기(p); continue }
      if (e.name.endsWith('.js')) 뒤진곳.push(p)
    }
  })(서버)

  // 긍정 앵커 — 감시할 대상이 실제로 있다. 없으면 아래 부정 단언이 조용히 통과한다.
  const 부르는곳 = 뒤진곳.filter(p => /generativelanguage\.googleapis\.com/.test(fs.readFileSync(p, 'utf8')))
  assert.ok(부르는곳.length >= 3, `Gemini 호출부를 못 찾았다(${부르는곳.length}) — 이 가드를 옮길 것`)

  for (const p of 부르는곳) {
    const s = fs.readFileSync(p, 'utf8')
    if (path.basename(p) === 'geminiClient.js') continue
    assert.match(s, /fetchGeminiWithRetry/, `${path.relative(ROOT, p)} 가 래퍼를 안 쓴다 — 가드를 우회한다`)
  }
})

test('가드는 fetch 보다 **먼저** 선다 — 소스 순서로 고정', () => {
  const s = fs.readFileSync(path.join(서버, 'services/geminiClient.js'), 'utf8')
  const 가드 = s.indexOf('자격증명이본문에있나')
  const 호출 = s.indexOf('await fetch(url')
  assert.ok(가드 > -1, '가드 함수가 사라졌다')
  assert.ok(호출 > -1, 'fetch 호출 자리를 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(가드 < 호출, '가드가 fetch 뒤에 있다 — 이미 나간 뒤에 막는다')
})

// ── AI 가 지어낸 것은 곧바로 운영 데이터가 되지 않는다 ────────────────────
test('자연어 파싱 결과는 초안 표로만 들어간다 — schedules 에 직접 안 쓴다', () => {
  const s = fs.readFileSync(path.join(서버, 'routes/scheduleDrafts.js'), 'utf8')
  assert.match(s, /schedule_drafts/, '초안 표를 안 쓴다 — 이 가드를 옮길 것')
  // 승인 라우트가 insertSchedule 을 부르는 것은 정상이다. 파싱 라우트가 부르면 안 된다.
  const 파싱구간 = s.slice(0, s.search(/router\.(post|put)\([^)]*confirm/i) + 1 || s.length)
  assert.doesNotMatch(
    파싱구간.replace(/\/\/[^\n]*/g, ''),
    /INSERT\s+INTO\s+schedules/i,
    '파싱이 곧바로 예약을 만든다 — 검토 게이트가 없어진다',
  )
})

test('스케줄러는 초안을 읽지 않는다 — 승인 전 초안은 방송될 길이 없다', () => {
  const s = fs.readFileSync(path.join(서버, 'services/scheduler.js'), 'utf8')
  assert.doesNotMatch(s, /schedule_drafts/, '스케줄러가 초안 표를 본다 — 승인 없이 방송된다')
})
