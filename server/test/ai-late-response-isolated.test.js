// 늦게 온 AI 응답이 **엉뚱한 칸을 덮지 않는다** (사용자 지시 2026-09-14).
//
// ── 무엇이 어긋났나 ──────────────────────────────────────────────────────────
// ① **카드를 바꿨는데** 앞 카드에 보낸 응답이 도착한다. `짓는중`·`지은이`·`이전문구` 가
//    모드와 무관한 **전역 상태**라, 지금 보고 있는 카드에 앞 카드의 결과가 붙는다.
// ② **기다리는 동안 사람이 더 친다.** 도착한 응답이 그 글을 덮는다.
// ③ 사람이 **두 번 눌렀는데** 첫 응답이 늦게 와서 둘째 결과를 덮는다.
//
// ── 고친 방향 ────────────────────────────────────────────────────────────────
// 보낼 때 **표식**을 적어 둔다 — 몇 번째 요청인지 · 어느 모드인지 · 그때의 글이 무엇인지.
// 도착하면 **지금 값**과 견준다. 하나라도 어긋나면 **안 쓴다.**
// **조용히 버리지 않는다** — 왜 안 썼는지 사람에게 말한다(이 저장소의 규칙).
//
// ── 이 시험이 **일부러** 불친절하게 만든 자리 ────────────────────────────────
// 비동기 콜백 안의 `모드`·`draft` 는 리액트에서 **누른 순간의 값으로 굳는다.** 그래서 시험
// 장치도 그렇게 굳혀서 준다. 처음에는 살아 있는 값을 줬는데, 그러면 `보낸모드 !== 모드` 같은
// **굳은 값끼리의 비교가 통과해 버려** 아무것도 못 막는 가드가 초록으로 보였다. 지금 값은
// `지금Ref` 로만 얻을 수 있게 두는 것이 이 시험의 핵심이다.
//
// 소스 대조가 아니다 — **그 핸들러를 떼어 실제로 돌린다.** 응답을 일부러 늦추고, 그 사이에
// 모드를 바꾸거나 글을 고쳐서 무엇이 쓰이는지 본다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')

/** `{` 부터 짝이 맞는 `}` 까지. */
function 블록(글, 여는곳) {
  let 깊이 = 0
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) return 글.slice(여는곳 + 1, k) }
  }
  assert.fail('블록의 끝을 못 찾았다')
}

/** 「AI 도움받기」 단추의 onClick 몸통 — **제품 소스 그대로**. */
function 핸들러몸통() {
  const i = SRC.indexOf('const 씨앗 = (draft.content || draft.title')
  assert.ok(i > 0, '긍정 앵커 — AI 도움받기 핸들러가 있다')
  const j = SRC.lastIndexOf('onClick={async () => {', i)
  assert.ok(j > 0, '그 앞의 onClick 을 못 찾았다')
  return 블록(SRC, SRC.indexOf('{', SRC.indexOf('=>', j)))
}

/** 그 핸들러를 돌릴 수 있는 최소 환경. */
function 환경(처음) {
  const st = {
    모드: 처음.모드,
    초안들: { [처음.모드]: { content: 처음.글 } },
    표식: { current: 0 },
    결과: { 지은이: null, 이전문구: null, 오류: '', 짓는중: false },
  }
  const 내용 = () => st.초안들[처음.모드]?.content
  const env = {
    ai표식Ref: st.표식,
    // **지금 값**을 주는 유일한 통로. 렌더마다 덮어쓰는 제품의 `지금Ref` 와 같은 뜻이다.
    지금Ref: { get current() { return { 모드: st.모드, 초안들: st.초안들 } } },
    setAi오류: (v) => { st.결과.오류 = v },
    set짓는중: (v) => { st.결과.짓는중 = v },
    set지은이: (v) => { st.결과.지은이 = v },
    set이전문구: (v) => { st.결과.이전문구 = v },
    // 제품의 `setDraft` 처럼 **지금 모드의 칸만** 고친다.
    setDraft: (f) => {
      const m = st.모드
      if (!m) return
      st.초안들 = { ...st.초안들, [m]: typeof f === 'function' ? f(st.초안들[m] ?? null) : f }
    },
    지은이문구: (via) => `by:${via}`,
    로컬AI허용: false,
    방송문구짓기: (...a) => env.방송문구짓기_(...a),
    방송문구짓기_: 처음.응답,
  }
  const 창 = {}
  for (const k of Object.keys(env)) Object.defineProperty(창, k, { get: () => env[k] })

  // **누른 순간의 값으로 굳힌다** — 리액트 클로저와 같게. 이 둘로는 「지금」을 알 수 없다.
  const 누르기 = () => {
    창.모드  = st.모드
    창.draft = st.초안들[st.모드]
    return new Function('창', `with (창) { return (async () => {${핸들러몸통()}}) }`)(창)()
  }
  return { st, env, 내용, 누르기 }
}

test('긍정 앵커 — 보통은 AI 결과가 칸에 들어간다', async () => {
  const e = 환경({ 모드: 'tts', 글: '원문', 응답: async () => ({ text: '다듬은 글', via: 'gemini' }) })
  await e.누르기()
  assert.equal(e.내용(), '다듬은 글', 'AI 결과가 안 들어갔다 — 이 시험의 전제가 깨졌다')
  assert.equal(e.st.결과.이전문구, '원문', '되돌릴 원문을 안 남겼다')
})

test('**카드를 바꾸면** 그 응답을 안 쓴다 — 남의 칸을 덮지 않는다', async () => {
  let 놓아주기
  const 늦게 = new Promise(r => { 놓아주기 = r })
  const e = 환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 늦게; return { text: '늦은 글', via: 'gemini' } } })
  const p = e.누르기()
  e.st.모드 = 'bgm'                         // 기다리는 사이에 다른 카드로
  e.st.초안들 = { ...e.st.초안들, bgm: { content: '' } }
  놓아주기(); await p
  assert.equal(e.내용(), '원문', '카드를 바꿨는데 앞 카드의 AI 결과가 들어왔다')
  assert.equal(e.st.초안들.bgm.content, '', '**옮겨 간 카드**에 앞 카드의 AI 결과가 붙었다')
  assert.match(e.st.결과.오류, /\S/, '**조용히 버렸다** — 왜 안 썼는지 말해야 한다')
})

test('**그 사이에 사람이 고쳤으면** 그 글이 우선이다', async () => {
  let 놓아주기
  const 늦게 = new Promise(r => { 놓아주기 = r })
  const e = 환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 늦게; return { text: '늦은 글', via: 'gemini' } } })
  const p = e.누르기()
  e.st.초안들 = { tts: { content: '사람이 새로 쓴 글' } }   // 기다리는 사이에 더 쳤다
  놓아주기(); await p
  assert.equal(e.내용(), '사람이 새로 쓴 글',
    '기다리는 동안 사람이 쓴 글을 AI 결과가 덮었다')
  assert.match(e.st.결과.오류, /\S/, '조용히 버렸다 — 왜 안 썼는지 말해야 한다')
})

test('**두 번 눌렀으면** 헌 응답은 버린다 — 새것을 덮지 않는다', async () => {
  let 첫놓기
  const 첫늦게 = new Promise(r => { 첫놓기 = r })
  const e = 환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 첫늦게; return { text: '첫 결과', via: 'a' } } })
  const p1 = e.누르기()
  e.env.방송문구짓기_ = async () => ({ text: '둘째 결과', via: 'b' })
  await e.누르기()                              // 둘째 요청 — 표식이 올라간다
  assert.equal(e.내용(), '둘째 결과', '둘째 결과가 안 들어갔다')
  첫놓기(); await p1
  assert.equal(e.내용(), '둘째 결과', '늦게 온 **첫** 응답이 둘째 결과를 덮었다')
})

// ── 표식 검사가 **혼자 지키는 자리** ─────────────────────────────────────────
// 변이로 확인했다(2026-09-14): 표식 검사를 통째로 지워도 위 세 시험은 초록이었다 —
// 「그 사이에 글이 달라졌나」가 그 자리를 대신 가리고 있었기 때문이다. 표식이 **혼자**
// 지키는 것은 성공 경로가 아니라 **헌 요청의 실패**와 **물레방아**다.
test('헌 요청이 뒤늦게 **실패해도** 지금 화면에 오류를 띄우지 않는다', async () => {
  let 첫깨기
  const 첫늦게 = new Promise((_, rj) => { 첫깨기 = rj })
  const e = 환경({ 모드: 'tts', 글: '원문', 응답: () => 첫늦게 })
  const p1 = e.누르기().catch(() => {})
  e.env.방송문구짓기_ = () => new Promise(() => {})   // 둘째는 아직 돌고 있다
  e.누르기()
  첫깨기(new Error('헌 요청이 끊겼습니다')); await p1
  assert.equal(e.st.결과.오류, '',
    '이미 지나간 요청의 실패가 **지금 기다리는 화면**에 오류로 뜬다')
  assert.equal(e.st.결과.짓는중, true,
    '헌 요청이 끝났다고 **물레방아를 멈춘다** — 둘째는 아직 돌고 있는데 다 된 것처럼 보인다')
})

test('카드를 바꾸면 **돌던 요청을 무효로** 하고 AI 안내도 걷는다', () => {
  const 코드 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const i = 코드.indexOf('const 모드고르기')
  assert.ok(i > 0, '모드고르기 를 못 찾았다')
  const 몸통 = 블록(코드, 코드.indexOf('{', 코드.indexOf('=>', i)))
  assert.match(몸통, /ai표식Ref\.current\+\+/,
    '카드를 바꿔도 돌던 AI 요청이 그대로 살아 있다')
  assert.match(몸통, /set지은이\(null\)/, '앞 카드의 AI 안내가 새 카드에 남는다')
})

test('「지금 값」은 **렌더마다 갱신**된다 — 한 번 잡아 두면 다시 굳는다', () => {
  assert.match(SRC, /지금Ref\.current = \{ 모드, 초안들 \}/,
    '지금Ref 를 세워만 두고 갱신하지 않는다 — 첫 렌더 값에 그대로 굳는다')
})

// ── **검색창 제출 경로도 같다** (V③ 지적, 2026-09-14) ────────────────────────────
// 처음에는 「AI 도움받기」 한 자리만 막았다. 검수관이 짚었다 — `run()`(검색창 제출)도
// 서버 파싱을 **기다린 뒤** 모드와 초안을 **조건 없이 덮고** 있었다. 규칙이 시각을 못 읽으면
// AI 로 넘어가 10초대가 걸리므로, 그 사이에 사람이 다른 카드를 고를 시간이 충분하다.
//
// **한 자리만 막은 것이 이 결함의 모양이다** — 그래서 여기서도 같은 방식으로 돌려 본다.
function 제출몸통() {
  const i = SRC.indexOf('const run = async () => {')
  assert.ok(i > 0, '긍정 앵커 — 검색창 제출 핸들러가 있다')
  return 블록(SRC, SRC.indexOf('{', SRC.indexOf('=>', i)))
}

/**
 * 제품의 `초안정의` 표를 **그대로** 떼어 온다.
 *
 * 이 표가 「어느 카드가 지금 나가는 카드인가」를 정한다. 시험이 제 사본을 들면 제품이
 * `tts` 를 예약으로 바꿔도 시험은 초록이다 — 지키려던 사실이 아니라 사본을 지키게 된다.
 */
function quickStart읽기() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/quickStart.js'), 'utf8')
  assert.match(src, /export const 초안정의 = \{/, '긍정 앵커 — quickStart.js 에 초안정의 표가 있다')
  // 이 모듈은 아무것도 import 하지 않는 순수 규칙 모음이라 `export ` 만 걷으면 그대로 돈다.
  const 이름 = ['초안정의', '빠른시작', '빠른단추', '즉시실행값', '실행방식맞추기', '빠른초안']
  return new Function(`${src.replace(/^export /gm, '')}\nreturn { ${이름.join(', ')} }`)()
}
const QS = quickStart읽기()

function 제출환경(처음) {
  const st = {
    모드: 처음.모드, 초안들: { [처음.모드]: { content: 처음.글 } },
    // 기본은 **사람이 카드를 골랐다**(모드를 주고 시작하는 시험은 그 상황을 뜻한다).
    // 카드 없이 검색만 잇는 상황은 `손으로고름: false` 로 준다.
    손으로고름: 처음.손으로고름 ?? !!처음.모드,
    표식: { current: 0 },
    검색표식: { current: 0 },
    결과: { 오류: '', 모드: 처음.모드, 초안들: null, loading: false },
  }
  const env = {
    ai표식Ref: st.표식,
    // 검색은 **제 표식**을 쓴다(V③ R6) — AI 도움받기와 자물쇠가 엉키지 않게 갈랐다.
    검색표식Ref: st.검색표식,
    지금Ref: { get current() { return { 모드: st.모드, 초안들: st.초안들 } } },
    text: '내일 세시에 안내',
    loading: false,
    parseSchedulePhrase: (...a) => env.parseSchedulePhrase_(...a),
    parseSchedulePhrase_: 처음.응답,
    emptySchedule: () => ({}),
    즉시실행값: (밑) => 밑,          // 시험이 갈아 끼운다(기본은 아무것도 안 한다)
    // **제품과 같은 표**를 쓴다 — 대역으로 흉내 내면 그 흉내를 시험하게 된다.
    // (`quickStart.js` 에서 떼어 온다. 값을 여기 베껴 두면 제품이 바뀌어도 시험은 초록이다.)
    초안정의: QS.초안정의,
    // **맞추는 규칙도 제품 것**을 쓴다(V③ R17). 대역으로 흉내 내면 「지나간 분으로 저장되는
    // 예약」 같은 일이 시험에서만 안 일어난다.
    실행방식맞추기: QS.실행방식맞추기,
    buildNotes: () => ['확인이 필요한 항목'],
    // **제품이 쓰는 것을 빠뜨리면 시험이 예외를 삼킨다** (V③ R6 지적, 2026-09-14).
    // 이 대역에 `확인들Ref` 가 없어서 제품 `run` 이 `ReferenceError` 를 냈고, 그것이
    // `catch` 로 들어가 **긍정 앵커가 그대로 통과**했다. 예외 전에 세워진 값만 보고 있었다.
    // 그래서 아래 긍정 앵커는 **오류가 없었다는 것까지** 본다.
    확인들Ref: { current: {} },
    setLoading: (v) => { st.결과.loading = v },
    setError: (v) => { if (v) st.결과.오류 = v },
    set모드: (v) => { st.결과.모드 = v; st.모드 = v },
    set초안들: (f) => { st.결과.초안들 = typeof f === 'function' ? f(st.초안들) : f },
    ...Object.fromEntries(['setVia', 'setViaReason', 'setNotes', 'setAcked', 'setSaveError',
      'setAdvanced', 'setJustAdded', 'setCancelError', 'setFiredMsg', 'setSaid'].map(n => [n, () => {}])),
  }
  const 창 = {}
  for (const k of Object.keys(env)) Object.defineProperty(창, k, { get: () => env[k] })
  const 누르기 = () => {
    창.모드  = st.모드                       // 리액트처럼 **누른 순간 값으로 굳는다**
    창.draft = st.초안들[st.모드]
    // **「사람이 단추를 눌렀는가」도 굳는다**(V③ R14). 이것을 `모드` 에서 유도하면
    // 시험이 제품의 버그를 그대로 베낀다 — 검색이 세운 모드와 사람이 고른 모드가 갈린다.
    창.손으로고름 = st.손으로고름
    return new Function('창', `with (창) { return (async () => {${제출몸통()}}) }`)(창)()
  }
  return { st, env, 누르기 }
}

test('긍정 앵커 — 읽은 결과가 들어가고, **조용한 예외가 없다**', async () => {
  const e = 제출환경({ 모드: 'tts', 글: '원문', 응답: async () => ({ title: '안내', immediate: true }) })
  await e.누르기()
  // **오류 칸을 먼저 본다.** 대역이 모자라 제품이 던지면 그 예외가 `catch` 로 들어가
  // 조용히 오류 문구가 되는데, 앞 판은 그것을 안 보고 초안만 봐서 **통과했다**(V③ R6).
  assert.equal(e.st.결과.오류, '',
    `제품이 던진 예외를 시험이 삼켰다: ${e.st.결과.오류} — 대역에 빠진 것이 있다`)
  assert.ok(e.st.결과.초안들, '읽은 결과가 초안으로 안 들어갔다 — 이 시험의 전제가 깨졌다')
  assert.equal(e.st.결과.loading, false, '성공했는데 검색 자물쇠가 안 풀렸다')
  assert.deepEqual(e.env.확인들Ref.current.tts?.notes, ['확인이 필요한 항목'],
    '확인 항목을 그 칸에 안 적어 둔다 — 카드를 바꿨다 오면 확인 게이트가 사라진다')
  assert.equal(e.env.확인들Ref.current.tts?.acked, false, '확인 체크가 기본으로 켜져 있다')
})

test('**검색창 제출**도 카드를 바꾸면 그 결과를 안 쓴다', async () => {
  let 놓기
  const 늦게 = new Promise(r => { 놓기 = r })
  const e = 제출환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 늦게; return { title: '늦은 것' } } })
  const p = e.누르기()
  e.st.모드 = 'bgm'                       // 기다리는 사이에 다른 카드로
  e.st.초안들 = { ...e.st.초안들, bgm: { content: '' } }
  놓기(); await p
  assert.equal(e.st.결과.초안들, null,
    '카드를 바꿨는데 앞서 보낸 해석 결과가 덮어썼다 — 사람이 고른 카드가 조용히 뒤집힌다')
  assert.match(e.st.결과.오류, /\S/, '조용히 버렸다 — 왜 안 썼는지 말해야 한다')
})

test('**검색창 제출**도 그 사이에 고친 문구를 안 덮는다', async () => {
  let 놓기
  const 늦게 = new Promise(r => { 놓기 = r })
  const e = 제출환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 늦게; return { title: '늦은 것' } } })
  const p = e.누르기()
  e.st.초안들 = { tts: { content: '사람이 새로 쓴 글' } }
  놓기(); await p
  assert.equal(e.st.결과.초안들, null, '기다리는 동안 사람이 쓴 글을 해석 결과가 덮었다')
  assert.match(e.st.결과.오류, /\S/, '조용히 버렸다')
})

test('**본문 밖을 고쳐도** 늦은 해석이 안 덮는다 — 제목·시각도 사람 것이다', () => {
  // V③ 지적(2026-09-14): 처음에는 `content` 만 견줬다. 그런데 이 응답은 초안을 **통째로**
  // 갈아 끼운다 — 기다리는 동안 제목이나 시각을 고쳐도 검사를 통과해 그 수정이 사라진다.
  return (async () => {
    let 놓기
    const 늦게 = new Promise(r => { 놓기 = r })
    const e = 제출환경({ 모드: 'schedule', 글: '원문', 응답: async () => { await 늦게; return { title: '늦은 것' } } })
    e.st.초안들 = { schedule: { content: '원문', title: '내가 적은 제목', scheduled_time: '09:30' } }
    const p = e.누르기()
    // **본문은 그대로 두고 시각만** 고친다 — 앞 판은 이것을 못 잡았다
    e.st.초안들 = { schedule: { content: '원문', title: '내가 적은 제목', scheduled_time: '15:00' } }
    놓기(); await p
    assert.equal(e.st.결과.초안들, null,
      '본문만 안 바뀌었으면 통과시킨다 — 기다리는 동안 고친 시각·제목이 통째로 사라진다')
    assert.match(e.st.결과.오류, /\S/, '조용히 버렸다')
  })()
})

// ── **검색과 AI 도움받기는 서로의 자물쇠를 안 건드린다** (V③ R6 지적) ──────────────
// 둘이 표식 하나를 나눠 쓰고 있었다. `finally` 는 각자 **제 자물쇠만** 푸는데, 표식은
// 공유라서 — 검색을 기다리는 중에 AI 도움받기를 한 번 돌리면 표식이 올라가고,
// 돌아온 검색 응답은 표식이 안 맞아 `setLoading(false)` 를 건너뛴다.
// **검색창이 잠긴 채 남는다.** 둘은 서로 무효로 만들 이유가 없는 다른 일이다.
test('**검색을 기다리는 중에 AI 도움받기를 써도** 검색 자물쇠가 풀린다', async () => {
  let 놓기
  const 늦게 = new Promise(r => { 놓기 = r })
  const e = 제출환경({ 모드: 'tts', 글: '원문', 응답: async () => { await 늦게; return { title: '읽은 것' } } })
  const p = e.누르기()
  e.env.ai표식Ref.current++          // ← AI 도움받기가 한 번 돌았다(표식이 올라간다)
  놓기(); await p
  assert.equal(e.st.결과.loading, false,
    'AI 도움받기를 한 번 썼다고 **검색창이 영영 잠긴다** — 표식을 나눠 쓰면 이렇게 된다')
  assert.ok(e.st.결과.초안들, '검색 결과가 멀쩡한데도 안 들어갔다 — 너무 넓게 막았다')
})

test('표식이 **둘로 갈려 있다** — 하나로 합치면 위 증상이 돌아온다', () => {
  const 코드 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /const 검색표식Ref = useRef\(0\)/, '검색 표식이 따로 없다')
  assert.match(코드, /const 표식 = \+\+검색표식Ref\.current/, '검색이 제 표식을 안 쓴다')
  // 카드를 바꾸면 **둘 다** 무효다 — 갈랐다고 한쪽을 빠뜨리면 늦은 응답이 되살아난다
  const i = 코드.indexOf('const 모드고르기')
  assert.ok(i > 0, '긍정 앵커 — 모드고르기 가 있다')
  // **몸통을 괄호로 떼어 본다.** 앞 판은 `slice(i, i + 900)` 이었는데, V③ R15 로 그 함수에
  // 줄이 늘자 **지키려던 사실은 그대로인데** 창 밖으로 밀려나 빨간불이 났다.
  // 글자 수를 세는 시험은 무관한 변경에 걸려 넘어진다(같은 날 `inline-flow-build` 도 같았다).
  const 몸통 = 블록(코드, 코드.indexOf('{', 코드.indexOf('=>', i)))
  assert.match(몸통, /ai표식Ref\.current\+\+/, '카드를 바꿔도 AI 요청이 살아 있다')
  assert.match(몸통, /검색표식Ref\.current\+\+/, '카드를 바꿔도 검색 요청이 살아 있다')
})

// ── **검색이 즉시 초안을 예약으로 만들지 않는다** (V③ R7 지적, 2026-09-14) ────────────
// `즉시실행값` 을 시험으로 고정하는 것만으로는 모자랐다 — **그 규칙을 검색 경로가 실제로
// 지나는가**는 별개다(내 첫 시험이 헬퍼만 보고 배선을 안 봤다). 여기서는 **제품 `run` 본문을
// 그대로 돌려** 나온 초안을 본다.
test('**검색으로 채운 즉시 초안**이 비활성·1회성이다 — 활성 예약으로 저장되면 안 된다', async () => {
  const 밑바탕 = () => ({ scheduled_time: '09:35', active: 1, repeat_weekdays: [0,1,2,3,4,5,6],
                          title: '', content: '', target: '전체', broadcast_type: 'text' })
  const e = 제출환경({ 모드: 'tts', 글: '', 응답: async () => ({ immediate: true, broadcast_type: 'text', title: '즉시 안내방송' }) })
  e.env.emptySchedule = 밑바탕
  // 제품과 **같은 함수**를 쓴다 — 대역으로 흉내 내면 그 흉내를 시험하게 된다.
  e.env.즉시실행값 = (밑, 지금 = new Date()) => {
    const p2 = (n) => String(n).padStart(2, '0')
    return { ...밑, immediate: true,
      scheduled_time: `${p2(지금.getHours())}:${p2(지금.getMinutes())}`,
      repeat_weekdays: [], active: 0,
      repeat_start_date: `${지금.getFullYear()}-${p2(지금.getMonth()+1)}-${p2(지금.getDate())}` }
  }
  await e.누르기()
  assert.equal(e.st.결과.오류, '', `제품이 던졌다: ${e.st.결과.오류}`)
  const 초안 = e.st.결과.초안들?.tts
  assert.ok(초안, '초안이 안 만들어졌다 — 이 시험의 전제가 깨졌다')
  assert.equal(!!초안.active, false,
    '검색으로 채운 즉시 초안이 **활성 예약**으로 남는다 — 몇 분 뒤 한 번 더 나가고 내일도 나간다')
  assert.deepEqual(초안.repeat_weekdays, [], '매일 반복으로 남는다')
})

// ── **고른 카드가 「언제 나갈지」를 정한다** (V③ R12 지적, 2026-09-14) ────────────────
// 모드는 지켰는데 `immediate` 는 파서 값을 그대로 썼다. 그래서 「지금 방송」 카드에서
// "내일 세시에…" 를 검색하면 **그 카드에 예약 초안이 들어앉고**, 확정하면 예약 행이
// 만들어진다 — B-3 으로 막으려던 바로 그 일이다.
test('「지금 방송」 카드에서 **예약 문장**을 검색해도 즉시로 남는다', async () => {
  const e = 제출환경({ 모드: 'tts', 글: '',
    응답: async () => ({ immediate: false, broadcast_type: 'text', title: '안내', scheduled_time: '15:00' }) })
  e.env.emptySchedule = () => ({ active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6] })
  e.env.즉시실행값 = (밑) => ({ ...밑, immediate: true, active: 0, repeat_weekdays: [] })
  await e.누르기()
  assert.equal(e.st.결과.오류, '', `제품이 던졌다: ${e.st.결과.오류}`)
  const 초안 = e.st.결과.초안들?.tts
  assert.ok(초안, '초안이 안 만들어졌다')
  assert.equal(초안.immediate, true,
    '「지금 방송」 카드인데 **예약 초안**이 들어앉았다 — 확정하면 예약 행이 만들어진다')
  assert.equal(!!초안.active, false, '활성 예약으로 남는다')
})

test('「예약 방송」 카드에서 **즉시 문장**을 검색해도 예약으로 남는다', async () => {
  const e = 제출환경({ 모드: 'schedule', 글: '',
    응답: async () => ({ immediate: true, broadcast_type: 'text', title: '즉시 안내' }) })
  e.env.emptySchedule = () => ({ active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6] })
  await e.누르기()
  const 초안 = e.st.결과.초안들?.schedule
  assert.ok(초안, '초안이 안 만들어졌다')
  assert.equal(!!초안.immediate, false,
    '「예약 방송」 카드인데 즉시로 바뀌었다 — 확정하는 순간 전관 스피커로 나간다')
  assert.equal(초안.active, 1, '예약인데 꺼진 채로 만들어진다 — 영영 안 울린다')
})

test('**어긋나면 조용히 넘어가지 않는다** — 확인 항목으로 묻는다', async () => {
  let 놓인 = null
  const e = 제출환경({ 모드: 'tts', 글: '',
    응답: async () => ({ immediate: false, broadcast_type: 'text', title: '안내' }) })
  e.env.emptySchedule = () => ({ active: 1 })
  e.env.즉시실행값 = (밑) => ({ ...밑, immediate: true, active: 0 })
  e.env.setNotes = (v) => { 놓인 = v }
  await e.누르기()
  assert.ok(Array.isArray(놓인) && 놓인.some(t => /지금 바로/.test(t)),
    '시각을 적었는데 지금 나가는 것을 말 안 해 준다 — 사람이 놀란다')
})

// ── **검색이 세운 모드를 「사람이 고른 것」으로 치지 않는다** (V③ R14, 2026-09-14) ───────
// R12 를 고치면서 판정을 `!!모드` 로 뒀다. 그런데 `모드` 는 **검색 자신도 세운다**
// (`set모드(쓸모드)`). 그래서 카드를 **한 번도 안 누르고** "지금 안내" → "내일 세시" 를
// 잇달아 치면, 첫 검색이 세워 둔 `tts` 가 고른 카드로 둔갑해 **둘째 문장이 지금 바로 나갔다.**
// 사람은 고른 적이 없는데 경고까지 「지금 방송」 카드 이름으로 붙었다.
test('**검색 두 번**에 카드는 안 눌렀다 — 둘째 문장은 예약으로 남는다', async () => {
  let 놓인 = []
  const e = 제출환경({ 모드: null, 글: '', 손으로고름: false,
    응답: async () => 응답들.shift() })
  const 응답들 = [
    { immediate: true,  broadcast_type: 'text', title: '지금 안내' },
    { immediate: false, broadcast_type: 'text', title: '내일 안내', scheduled_time: '15:00' },
  ]
  e.env.emptySchedule = () => ({ active: 1 })
  e.env.즉시실행값 = (밑) => ({ ...밑, immediate: true, active: 0 })
  e.env.setNotes = (v) => { 놓인 = v }

  await e.누르기()                                   // 첫 검색 — 파서가 즉시라 했다
  assert.equal(e.st.결과.모드, 'tts', '긍정 앵커 — 첫 검색이 모드를 세운다')
  e.st.초안들 = e.st.결과.초안들 ?? e.st.초안들      // 화면이 그 초안을 들고 있다

  await e.누르기()                                   // 둘째 검색 — 파서가 예약이라 했다
  const 초안 = e.st.결과.초안들?.tts
  assert.ok(초안, '둘째 초안이 안 만들어졌다')
  assert.equal(!!초안.immediate, false,
    '카드를 누른 적이 없는데 **앞 검색이 세운 모드**가 고른 카드 행세를 한다 — 예약 문장이 지금 나간다')
  assert.equal(놓인.some(t => /지금 바로/.test(t)), false,
    '고른 적 없는 카드 이름으로 경고한다 — 사람은 무슨 말인지 모른다')
})

// ── **진짜 파서 응답으로 본다** (V③ R17, 2026-09-14) ───────────────────────────
// 앞 시험들은 `immediate: false` 만 담은 손수 만든 응답을 썼다. 그래서 **즉시 요청의 파싱
// 결과가 「오늘 지금 분 · 반복 없음」이라는 사실**을 못 봤다(`schedulePhrase.js`).
// 「예약 방송」 카드에서 즉시 문장을 치면 `immediate` 만 내려가고 그 시각·반복이 남아서,
// **확인하는 사이에 그 분이 지나가면 저장돼도 영영 안 울리는 예약**이 된다 —
// 현장에서 원인을 찾기 가장 어려운 실패다(그 파일이 같은 자리에 그렇게 적어 뒀다).
test('「예약 방송」 카드 + **진짜 즉시 파싱** — 지나간 분으로 저장되지 않는다', async () => {
  const { parseSchedulePhrase: 진짜파서 } = require('../services/schedulePhrase')
  const 기준 = new Date('2026-09-14T10:00:00+09:00')
  const 파싱 = 진짜파서('지금 바로 안내방송 해줘', 기준)
  // 긍정 앵커 — 파서가 정말 「지금 분 · 반복 없음」을 준다(이 전제가 깨지면 시험이 헛돈다)
  assert.equal(파싱.immediate, true, '긍정 앵커 — 즉시로 읽는다')
  assert.equal(파싱.scheduled_time, '10:00', '긍정 앵커 — 시각이 지금 분이다')
  assert.deepEqual(파싱.repeat_weekdays, [], '긍정 앵커 — 반복이 비어 있다')

  const e = 제출환경({ 모드: 'schedule', 글: '', 응답: async () => 파싱 })
  e.env.emptySchedule = () => ({ active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6] })
  await e.누르기()
  const 초안 = e.st.결과.초안들?.schedule
  assert.ok(초안, '초안이 안 만들어졌다')
  assert.equal(!!초안.immediate, false, '「예약 방송」 카드인데 즉시로 남았다')
  assert.notEqual(초안.scheduled_time, '10:00',
    '즉시 파싱의 **지금 분**이 그대로 예약 시각이 됐다 — 확인하는 사이에 지나가면 영영 안 울린다')
  assert.deepEqual(초안.repeat_weekdays, [0,1,2,3,4,5,6],
    '반복이 빈 채로 남았다 — 1회성인데 시각까지 지나면 되살릴 길이 없다')
  assert.equal(초안.active, 1, '예약인데 꺼진 채로 만들어진다')
})

test('카드를 **안 골랐으면** 파서 제안을 그대로 쓴다 — 되묻지 않는다', async () => {
  let 놓인 = []
  const e = 제출환경({ 모드: null, 글: '',
    응답: async () => ({ immediate: false, broadcast_type: 'text', title: '안내' }) })
  e.env.emptySchedule = () => ({ active: 1 })
  e.env.setNotes = (v) => { 놓인 = v }
  await e.누르기()
  assert.equal(놓인.some(t => /지금 바로|예약으로/.test(t)), false,
    '고른 적도 없는 카드와 어긋났다고 되묻는다 — 잔소리가 된다')
})
