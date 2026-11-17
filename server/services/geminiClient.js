// Gemini 2.5 Flash 계열이 실제로 간헐적 503 UNAVAILABLE("high demand")을 내뿜는 것을 실측
// 확인함(2026-08-27) — 짧은 backoff로 몇 번만 재시도해도 대부분 복구된다. 429(쿼터 초과)는
// 재시도해도 소용없으므로(같은 이유로 계속 실패) 재시도 대상에서 제외한다.
const { networkDisabled, noticeOnce: netNotice, blockedError } = require('./networkMode')
// 어르신 실명·번호는 바깥 모델로 안 내보낸다(2026-09-15). 가리는 자리를 **여기 하나**로
// 두는 이유는 아래 자격증명 가드와 똑같다 — 호출부는 다섯인데, 거기마다 걸면 여섯 번째가
// 생기는 날 그것만 샌다(FP-0005).
const { 가리기, 응답되돌리기 } = require('./promptPrivacy')
const RETRYABLE_STATUS = new Set([503])
const RETRY_DELAYS_MS = [800, 1600]

// 2026-08-31 CC-036. Node의 fetch에는 기본 타임아웃이 없다 — 상대가 연결만 열어두고 응답을
// 안 주면 이 함수는 영원히 안 끝나고, 그 위의 라우트(방송문 생성·자연어 예약 파싱)도 같이
// 멈춘다. 사람이 화면 앞에서 기다리는 경로라 20초로 끊는다.
const GEMINI_TIMEOUT_MS = 20000

// 재시도가 겹치면 세 번이 같은 순간에 몰린다(과부하 중인 서버에 정확히 같은 간격으로 재차
// 두드리는 꼴). 기본 간격 위로만 최대 절반을 더한다 — 아래로 내리면 더 빨리 두드리게 된다.
const JITTER_RATIO = 0.5

// rand는 테스트가 값을 넣을 수 있게 인자로 받는다(Math.random 기본).
function retryDelayMs(attempt, rand = Math.random()) {
  const base = RETRY_DELAYS_MS[attempt]
  return Math.round(base + base * JITTER_RATIO * rand)
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// ── 자격증명은 헤더로만 나간다 (UX-09, 2026-09-11) ────────────────────────
// 네 호출부(ai.js 세 곳·geminiSchedule.js·audio.js)가 전부 `x-goog-api-key` **헤더**에
// 키를 싣는다. 그러니 같은 값이 **본문**에도 있으면 그건 프롬프트로 새는 것이다 —
// 설정값을 통째로 프롬프트에 실었거나, 사람이 문안에 키를 붙여 넣었거나.
// 한번 나가면 외부 모델의 입력이 되고 로그·오류 리포트에 남는다. 되돌릴 수 없다.
//
// **키가 이미 인자로 와 있으므로 DB 도 비밀 목록도 필요 없다** — 헤더와 본문을 대조하면
// 끝이다. 그래서 가드를 여기 한 곳에만 둔다(호출부마다 두면 곧 하나를 빠뜨린다, FP-0005).
const 자격증명헤더 = /(^|-)(key|token|authorization|auth|secret|password)$/i
// 이보다 짧으면 평범한 문장과 우연히 겹친다. **8 에서 4 로 내렸다** — `Bearer abc1234`
// 처럼 토큰이 짧으면 검사에서 빠졌다(Codex R5, EV-004556). 진짜 키는 다 20자가 넘지만,
// 시험용·잘못 넣은 짧은 값도 나가면 안 되는 것은 같다.
// 헤더 값 **전체**는 길이를 안 따진다 — `Bearer abc1234` 가 통째로 방송문에 우연히
// 들어갈 일은 없다. 길이를 보는 것은 잘라낸 토큰 쪽뿐이다.
const 짧은값 = 4

// **모양을 하나씩 열거하지 않는다.** fetch 가 헤더로 받는 것은 객체·Headers·쌍의 배열
// ·그 밖의 iterable 까지 여러 가지인데, 손으로 세다가 세 판 연속 빠뜨렸다 —
// 배열(EV-004492) → iterable·Set(EV-004547). **fetch 가 쓰는 바로 그 변환기**에
// 맡기면 그 목록을 내가 관리하지 않아도 된다.
//
// 변환이 안 되면 `못읽음` 이다. 못 본 것을 통과시키지 않는다.
const 못읽음 = Symbol('검사 불가')

function 헤더쌍(headers) {
  if (headers === undefined || headers === null) return []
  try { return [...new Headers(headers).entries()] } catch { return 못읽음 }
}

// 검사할 자격증명 값들을 뽑는다. `Headers` 는 **같은 이름을 `, ` 로 합치므로**
// 조각을 하나씩 본다 — 합친 문자열만 보면 앞쪽 키가 안 걸린다(EV-004547).
function 자격증명값들(headers) {
  const 쌍 = 헤더쌍(headers)
  if (쌍 === 못읽음) return 못읽음
  const 값들 = []
  // `짧은값` 미만은 **부분 일치로는** 안 본다 — `abc` 를 문장 어디서나 잡으면 멀쩡한
  // 방송문이 막힌다. 대신 `정확히만` 으로 담아서 **본문 값이 그것 자체일 때**는 잡는다.
  // `{"text":"abc"}` 는 막고, "abc 방송 안내" 는 안 막는다(Codex R6, EV-004567).
  const 담기 = (이름, t) => {
    if (!t) return
    값들.push({ 이름, 값: t, 정확히만: t.length < 짧은값 })
  }
  for (const [이름, 값] of 쌍) {
    if (!자격증명헤더.test(String(이름))) continue
    const v = String(값 ?? '').trim()
    // 헤더 값 전체에도 **같은 길이 규칙**을 쓴다. 예전엔 여기만 길이를 안 따져서,
    // `authorization: 'abc'`(접두사 없는 짧은 값)는 부분 일치로 잡히고
    // `'Bearer abc'` 는 안 잡히는 **엇갈림**이 났다 — 앞의 것은 "abc 프로그램 안내"
    // 같은 멀쩡한 문장을 막는다(Codex R7, EV-004582).
    if (v) 담기(이름, v)
    for (const 조각 of v.split(',')) {
      const t = 조각.trim()
      담기(이름, t)
      // `Bearer ya29...` 처럼 방식이 앞에 붙는 경우 토큰만 따로 본다.
      const 뒤 = t.split(/\s+/).pop()
      if (뒤 && 뒤 !== t) 담기(이름, 뒤)
    }
  }
  return 값들
}

// 본문도 모양이 여럿이다 — 문자열 · Buffer · TypedArray · ArrayBuffer.
// **문자열만 보면 Buffer 로 감싼 같은 JSON 이 그대로 나간다.** Codex 독립 검수가
// 더미 키로 재현했다(2026-09-11, EV-004516). 지금 제품 호출부는 전부 문자열이지만,
// 모양에 따라 있다 없다 하는 가드는 가드가 아니다 — 배열 헤더 때와 같은 실수다.
//
// 못 읽는 모양(스트림·FormData·Blob·URLSearchParams)은 **못 읽었다고 말한다.**
// 처음엔 빈 문자열을 돌려줬는데, 그러면 "본문이 없다"와 구분이 안 돼 검사를 통과시켰다 —
// 주석에는 "호출부에서 걸러진다"고 적어 뒀지만 **그런 필터는 없었다.** Codex 독립 검수가
// 네 모양 모두 재현했다(2026-09-11, EV-004535). 주석은 가드 노릇을 하지 않는다.
// 바이트 본문을 **내용까지** 베낀다. 참조만 들고 있으면 검사한 뒤 호출부가 같은
// 메모리를 덮어써서 검사 안 한 내용이 나간다. `Buffer.from(buf)` 는 베끼지만
// `Buffer.from(arrayBuffer, off, len)` 은 **같은 메모리를 본다** — 그 차이가 함정이었다.
function 베껴두기(body) {
  if (typeof Buffer === 'undefined') return body
  if (Buffer.isBuffer(body)) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
  }
  if (body instanceof ArrayBuffer) return Buffer.from(Buffer.from(body))
  return body
}

function 본문글자(body) {
  if (typeof body === 'string') return body
  if (body === undefined || body === null || body === '') return ''
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body.toString('utf8')
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8')
  return 못읽음
}

// JSON 안의 글자값도 따로 본다. `A` 같은 이스케이프로 적으면 원문 대조를 빠져나가는데,
// 받는 쪽이 JSON 을 풀면 **원래 키 그대로**가 된다 — 즉 나가는 것은 같다.
// Codex 가 키의 첫 글자만 이스케이프해 통과시키는 것을 재현했다(EV-004535).
// **속성 이름도 본다.** 값만 보면 `{"AIza…": 1}` 처럼 이름 쪽에 넣어 빠져나간다.
// **끝까지 못 훑으면 `못읽음`** 이다 — 처음엔 상한에 닿으면 조용히 멈췄는데, 그러면
// 앞에 정상 글을 잔뜩 깔고 뒤에 키를 두는 것으로 통과했다(Codex 재현, EV-004547).
// 덜 본 채 "없다"고 말하는 것이 못 본 것보다 나쁘다.
function 속글자들(body) {
  let 뿌리
  try { 뿌리 = JSON.parse(body) } catch { return [] }  // JSON 이 아니면 원문만 본다
  const 모음 = []
  let 다봤다 = true
  const 훑기 = (v, 깊이) => {
    if (깊이 > 20 || 모음.length > 20000) { 다봤다 = false; return }
    if (typeof v === 'string') { 모음.push(v); return }
    if (Array.isArray(v)) { for (const x of v) 훑기(x, 깊이 + 1); return }
    if (v && typeof v === 'object') {
      for (const [이름, x] of Object.entries(v)) { 모음.push(이름); 훑기(x, 깊이 + 1) }
    }
  }
  훑기(뿌리, 0)
  return 다봤다 ? 모음 : 못읽음
}

// 샌 헤더 이름을 돌려준다. 안 샜으면 null. 검사를 못 했으면 `못읽음`.
function 자격증명이본문에있나(headers, 원본) {
  const body = 본문글자(원본)
  if (body === 못읽음) return 못읽음
  const 값들 = 자격증명값들(headers)
  if (값들 === 못읽음) return 못읽음
  if (!body || 값들.length === 0) return null

  const 속 = 속글자들(body)
  if (속 === 못읽음) return 못읽음

  for (const { 이름, 값, 정확히만 } of 값들) {
    if (정확히만) {
      // 짧은 값 — 본문 안의 글자값이 **그것 자체**일 때만 잡는다.
      for (const 글 of 속) if (글 === 값) return 이름
      continue
    }
    if (body.includes(값)) return 이름
    for (const 글 of 속) if (글.includes(값)) return 이름
  }
  return null
}

// ai.js(callGemini)·scheduleDrafts.js(parseWithGemini)가 쓰는 fetch 래퍼. 503이면 backoff 후
// 재시도하고, 그 외 실패거나 재시도를 다 썼으면 마지막 Response를 그대로 반환한다(호출부에서
// 기존과 동일하게 res.ok / res.status를 확인해서 에러 메시지를 만들면 됨).
//
// 타임아웃만 예외적으로 **던진다** — 응답이 없으니 돌려줄 Response가 없다. 두 호출부 모두
// try/catch 안에서 부르므로 사용자에게는 안내 문구로 나간다. 그리고 타임아웃은 재시도하지
// 않는다: 20초를 세 번 기다리면 사람이 1분을 그대로 앉아 있게 된다.
async function fetchGeminiWithRetry(url, options, { timeoutMs = GEMINI_TIMEOUT_MS } = {}) {
  // **검사한 것과 보내는 것이 같아야 한다**(Codex R5, 2026-09-11, EV-004556).
  // 전에는 검사한 뒤 `options` 를 다시 읽어서 fetch 에 넘겼다. 두 번 읽으면 두 값이
  // 다를 수 있다 — 본문이 getter 면 첫 읽기엔 평범한 문안, 둘째 읽기엔 키를 내놓는
  // 식으로 검사를 통과했다. 헤더도 같은 문제가 있었다: 한 번 쓰면 없어지는 iterator 를
  // 검사에서 다 써 버리고 원본을 넘겨, **정상 요청의 인증 헤더가 사라졌다.**
  //
  // 그래서 **여기서 한 번만 읽어 고정하고, 그 고정한 값을 검사하고 그대로 보낸다.**
  // **한 번만 읽는다.** 나머지 칸도 여기서 한 번에 베껴 둔다 — 나중에 `{...options}` 로
  // 다시 펼치면 getter 가 또 돌아서, 두 번째 읽기에서 값이 바뀌거나 예외가 나면
  // 멀쩡한 요청이 깨진다(Codex R6, EV-004567).
  const 원래 = options || {}
  const 보낼것 = {}
  for (const 칸 of Object.keys(원래)) {
    if (칸 === 'body' || 칸 === 'headers' || 칸 === 'signal') continue
    보낼것[칸] = 원래[칸]
  }
  // **Buffer 는 참조가 아니라 내용을 고정한다.** 참조만 들고 있으면 검사한 뒤 호출부가
  // 같은 Buffer 를 덮어써서 검사 안 한 내용이 나갈 수 있다(재시도 때 특히 — Codex 재현).
  // `Buffer.from(arrayBuffer, off, len)` 은 **베끼지 않고 같은 메모리를 본다.** 그래서
  // TypedArray·ArrayBuffer·DataView 는 위 사본이 사본이 아니었고, 호출부가 원본을
  // 덮어쓰면 재시도 요청에 검사 안 한 내용이 실렸다(Codex R7, EV-004582).
  // 한 번 베껴 두면 그 뒤에 원본이 어떻게 바뀌든 우리가 검사한 그것이 나간다.
  const 날본문 = 원래.body
  // **가리기가 자격증명 검사보다 먼저다.** 검사한 것과 보내는 것이 같아야 한다는 규칙
  // (Codex R5)을 지키려면, 나중에 바꿀 것을 먼저 바꿔 놓고 **그 결과를 검사해야** 한다.
  // 순서가 반대면 검사를 통과한 뒤에 본문이 달라진다.
  const { 본문: 가린본문, 표: 이름표, 보류 } = 가리기(날본문)
  if (보류) {
    // 번호를 가렸는데도 번호 모양이 남았다 — 외부로 보내지 않는다(전문가 1차 검토 4-2).
    // 부르는 쪽은 전부 try/catch 안이라 사람에게는 「AI 를 못 썼다」로 나가고 원문·규칙 결과가 쓰인다.
    throw new Error('문안에 전화번호·주민등록번호로 보이는 숫자가 남아 있어 AI 로 보내지 않았습니다.')
  }
  const 본문 = 베껴두기(가린본문)

  let 정규헤더
  try { 정규헤더 = new Headers(원래.headers ?? undefined) } catch { 정규헤더 = 못읽음 }
  if (정규헤더 === 못읽음) {
    throw new Error('요청 헤더를 읽을 수 없어 자격증명 검사를 못 했습니다. 보내지 않았습니다.')
  }

  // 자격증명 유출은 네트워크 차단보다 먼저 본다 — 나간 뒤에는 되돌릴 수 없다.
  const 샌헤더 = 자격증명이본문에있나(정규헤더, 본문)
  if (샌헤더 === 못읽음) {
    // **못 본 것을 통과시키지 않는다.** 지금 제품 호출부는 전부 문자열 JSON 이라
    // 여기 걸릴 일이 없다 — 걸린다면 새 호출부가 검사 못 하는 모양을 쓴 것이고,
    // 그때 조용히 나가는 것보다 여기서 멈추는 편이 낫다.
    throw new Error('이 모양의 요청 본문은 자격증명 검사를 할 수 없어 보내지 않았습니다. 문자열 JSON 으로 보내세요.')
  }
  if (샌헤더) {
    throw new Error(`자격증명(${샌헤더})이 프롬프트 본문에 섞여 있어 보내지 않았습니다. 키는 헤더로만 보냅니다.`)
  }
  // 네트워크 차단 모드 — **유료 호출**이라 특히 막을 값어치가 있다.
  // 조용히 빈 응답을 주지 않는다: 부르는 쪽이 그것을 "AI 가 답을 안 줬다"로 오독한다.
  if (networkDisabled()) { netNotice('Gemini'); throw blockedError('Gemini 호출') }
  for (let attempt = 0; ; attempt++) {
    // AbortSignal.timeout()을 쓰지 않는다 — 그 타이머는 unref라 이벤트 루프를 붙잡지 않는다.
    // 실서비스에서는 열린 소켓이 붙잡아 주지만, 상대를 흉내낸 테스트에서는 루프가 비어 버려
    // 판정 전에 프로세스가 끝난다. 직접 만든 타이머는 끝나면 반드시 지운다.
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    // 호출부가 자기 signal을 줬으면 조용히 버리지 않는다(지금은 아무도 안 주지만, 주는 쪽이
    // 생겼을 때 취소가 먹지 않는 것이 가장 찾기 어려운 실패다).
    const signal = 원래.signal ? AbortSignal.any([원래.signal, controller.signal]) : controller.signal
    let res
    try {
      // **검사한 그 값들을 보낸다.** 펼치기(`...원래`)가 getter 를 다시 부르더라도
      // 뒤에서 `headers`·`body` 를 고정한 값으로 덮으므로 나가는 것은 검사한 것과 같다.
      // (재시도할 때도 같은 값이라 두 번째 호출이 첫 번째와 달라지지 않는다.)
      res = await fetch(url, { ...보낼것, headers: 정규헤더, body: 본문, signal })
    } catch (err) {
      if (timedOut) {
        throw new Error(`AI 서버에서 ${Math.round(timeoutMs / 1000)}초 안에 응답이 없습니다. 잠시 후 다시 시도해주세요.`, { cause: err })
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
    // 자리표를 원래 이름으로 되돌려 돌려준다. 되돌릴 수 없게 망가져 왔으면 **던진다** —
    // 부르는 쪽 다섯이 전부 try/catch 안이라 사람에게는 안내 문구로 나가고,
    // AI 를 안 쓴 원문·규칙 결과가 대신 쓰인다.
    if (res.ok) return await 응답되돌리기(res, 이름표)
    // 실패 응답은 그대로 준다 — 오류 문구에는 자리표가 들어갈 일이 없고,
    // 부르는 쪽이 `res.json()` 으로 구글의 오류 메시지를 읽는다.
    // 모델이 없어졌다(404)는 **알리기만** 한다 — 다른 모델로 몰래 다시 보내면 화면에 찍힌 모델과
    // 실제로 부른 모델이 갈린다(domain/geminiModel.js 머리말의 그 결함). 이번 요청은 호출부의 폴백이 받는다.
    if (res.status === 404) 모델없음신고(url)
    if (!RETRYABLE_STATUS.has(res.status) || attempt >= RETRY_DELAYS_MS.length) return res
    await wait(retryDelayMs(attempt))
  }
}

// ── 모델 없음(404) 신고 이음새 (2026-10-23) ─────────────────────────────
// 기본은 아무것도 안 한다. 부팅 때 index.js 가 services/geminiModelAuto 의 onModelMissing 을 단다 —
// 여기서 그쪽을 부르면 순환이 된다(그쪽이 시험 호출로 이 래퍼를 쓴다). 신고는 비동기로, 실패해도 삼킨다.
let 모델없음처리 = null
function setModelMissingHandler(fn) { 모델없음처리 = typeof fn === 'function' ? fn : null }
function 모델없음신고(url) {
  if (!모델없음처리) return
  const m = /\/models\/([^/:?]+):generateContent/.exec(String(url))
  if (!m) return
  let 이름
  try { 이름 = decodeURIComponent(m[1]) } catch { 이름 = m[1] }
  const fn = 모델없음처리
  setImmediate(() => { try { fn(이름) } catch { /* 신고 실패로 요청을 망치지 않는다 */ } })
}

module.exports = { fetchGeminiWithRetry, retryDelayMs, GEMINI_TIMEOUT_MS, setModelMissingHandler }
