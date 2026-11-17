// 네 카드 — **상시 표시 · 취소 없이 전환 · 작성 내용 보존** (사용자 지시 2026-09-14).
//
// ── 무엇이 문제였나 ──────────────────────────────────────────────────────────
// 초안이 **하나**였다. 그래서 「지금 방송」에 문안을 적다가 「배경음악」을 누르면 그 문안이
// 사라졌고, 돌아와도 빈 칸이었다. 단추 넷도 카드가 열리면 **숨었다**(`{!draft && …}`) —
// 다른 카드로 가려면 먼저 취소해야 했다.
//
// ── 고친 방향 ────────────────────────────────────────────────────────────────
// 모드마다 칸을 따로 둔다(`초안들[모드]`). **모드 전환은 저장도 발사도 아니다** —
// 칸이 비어 있으면 초안을 하나 만들어 넣고, 이미 있으면 그대로 되살린다.
// 「취소」만 그 칸을 비운다 — *"이 카드는 없던 걸로"* 라는 뜻이라, 남기면 지운 줄 알았던
// 문안이 되살아난다. **다른 칸은 안 건드린다**(보존한 것이 취소 한 번에 날아가면 안 된다).
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// 화면을 렌더하지 않고 **상태 규칙을 실제로 돌린다**(이 저장소는 렌더러를 시험에 안 들인다).
// 소스에서 `모드고르기`·`reset` 을 떼어 내 실행하고, 칸이 어떻게 변하는지 본다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
const 코드 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `{` 부터 짝이 맞는 `}` 까지. */
function 블록(글, 여는곳) {
  let 깊이 = 0
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) return 글.slice(여는곳 + 1, k) }
  }
  assert.fail('블록의 끝을 못 찾았다')
}
const 몸통 = (이름) => {
  const i = 코드.indexOf(`const ${이름} = (`)
  assert.ok(i > 0, `${이름} 을 못 찾았다`)
  return 블록(코드, 코드.indexOf('{', 코드.indexOf('=>', i)))
}

/**
 * `quickStart.js` 를 **그대로** 불러온다(ESM 이라 `require` 가 안 된다).
 *
 * 이 모듈은 아무것도 import 하지 않는 순수 규칙 모음이라 `export ` 만 걷으면 그대로 돈다.
 * **값을 여기 베껴 두지 않는다** — 베끼면 제품이 「지금 방송」을 예약으로 바꿔도 시험은 초록이다.
 */
const { 실행방식맞추기, 초안정의, 빠른초안 } = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/quickStart.js'), 'utf8')
  const 이름 = ['초안정의', '빠른시작', '빠른단추', '즉시실행값', '실행방식맞추기', '빠른초안']
  return new Function(`${src.replace(/^export /gm, '')}\nreturn { ${이름.join(', ')} }`)()
})()

/** 상태 묶음 하나. 제품 함수를 이 위에서 돌린다. */
function 상태만들기(처음 = {}) {
  const st = { 모드: null, 초안들: {}, 손으로고름: false, ...처음 }
  const 무시 = () => {}
  return {
    st,
    set모드: (v) => { st.모드 = v },
    // **「사람이 단추를 눌렀는가」** (V③ R14). 검색도 `모드` 를 세우므로 `모드` 로는 못 가른다.
    // 여기 빠뜨리면 제품이 `ReferenceError` 를 낸다 — 그 예외가 조용히 지나가지 않도록
    // `실행()` 이 그대로 던지게 두었다(V③ R6 과 같은 이유).
    set손으로고름: (v) => { st.손으로고름 = v },
    set초안들: (f) => { st.초안들 = typeof f === 'function' ? f(st.초안들) : f },
    빠른초안: (id) => ({ id표식: id, content: '' }),
    emptySchedule: () => ({ active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6] }),
    // **제품과 같은 것**을 쓴다 — 실행 방식을 맞추는 규칙을 시험이 흉내 내면 그 흉내를 본다.
    실행방식맞추기, 초안정의,
    // `모드고르기` 는 **지금 칸**(클로저의 `초안들`)을 읽어 판단한다. 굳은 사본을 주면
    // 앞 단계가 넣어 둔 초안을 못 본다.
    get 초안들() { return st.초안들 },
    // 카드를 바꿀 때 함께 걷히는 AI 상태 — 늦은 응답을 무효로 만드는 표식도 여기 있다
    // (`ai-late-response-isolated.test.js` 가 그 동작을 본다. 여기서는 **부를 수만 있으면** 된다).
    ai표식Ref: { current: 0 },
    // 검색은 **제 표식**을 쓴다(V③ R6). 빠뜨리면 제품이 `ReferenceError` 를 낸다 —
    // 그 예외가 조용히 지나가지 않도록 `실행()` 이 그대로 던지게 두었다.
    검색표식Ref: { current: 0 },
    확인들Ref: { current: {} },
    setLoading: 무시,
    ...Object.fromEntries(['setNotes','setAcked','setSaveError','setAdvanced','setJustAdded',
      'setCancelError','setFiredMsg','setError','setVia','setViaReason','setText','setSaid','set흐름만들기',
      'set지은이','set이전문구','setAi오류','set짓는중']
      .map(n => [n, 무시])),
  }
}

const 실행 = (이름, env, ...args) => {
  const 이름들 = Object.keys(env).filter(k => k !== 'st')
  const 인자 = 이름들.map(k => env[k])
  // 제품 몸통을 그대로 돌린다 — `모드` 는 그때그때 읽어야 하므로 getter 로 준다.
  const f = new Function(...이름들, '모드', `return (${이름 === 'reset' ? '()' : '(id)'} => {${몸통(이름)}})`)
  return f(...인자, env.st.모드)(...args)
}

test('긍정 앵커 — 모드 전환과 접기가 각자 함수로 있다', () => {
  assert.ok(몸통('모드고르기').length > 20, '모드고르기 가 비었다')
  assert.ok(몸통('reset').length > 20, 'reset 이 비었다')
})

test('카드를 고르면 **그 칸에 초안이 선다** — 저장·발사는 안 한다', () => {
  const env = 상태만들기()
  실행('모드고르기', env, 'tts')
  assert.equal(env.st.모드, 'tts', '모드가 안 바뀐다')
  assert.ok(env.st.초안들.tts, '그 카드의 초안이 안 생겼다')
  // 저장·발사로 이어지는 자리가 없어야 한다
  assert.doesNotMatch(몸통('모드고르기'), /createSchedule|triggerSchedule|handleConfirm/,
    '모드를 바꾸는 것만으로 저장·발사가 일어난다')
})

// ── **「골랐다」는 이 자리에서만 선다** (V③ R14, 2026-09-14) ─────────────────────
// 「고른 카드가 실행 방식을 정한다」(R12)는 **사람이 고른 경우에만** 맞는 규칙이다.
// 그 판정을 `모드` 로 하면 **검색이 세운 모드**까지 「고른 것」이 되어, 카드를 한 번도
// 안 누른 사람의 예약 문장이 지금 바로 나간다. 그래서 근거를 따로 두고, **세우는 자리와
// 걷는 자리**를 여기서 고정한다 — 걷는 것을 빠뜨리면 취소한 뒤 다음 검색이 고른 척한다.
test('카드 단추만 **「골랐다」를 세우고**, 접으면 걷는다', () => {
  const env = 상태만들기()
  assert.equal(env.st.손으로고름, false, '긍정 앵커 — 처음에는 고른 적이 없다')
  실행('모드고르기', env, 'tts')
  assert.equal(env.st.손으로고름, true, '카드를 눌렀는데 「골랐다」가 안 선다 — 규칙이 통째로 안 걸린다')
  실행('reset', env)
  assert.equal(env.st.손으로고름, false,
    '접었는데 「골랐다」가 남는다 — 다음 검색이 고른 적 없는 카드 행세를 한다')
})

// ── **있던 초안도 고른 카드에 맞춘다** (V③ R15, 2026-09-14) ──────────────────────
// R12·R14 는 **검색 경로**만 고쳤다. 카드를 고르는 길은 둘인데 단추 쪽이 비어 있었다.
// 카드 없이 검색만 이으면 `schedule` 칸에 `immediate: true` 초안이 들어앉을 수 있고,
// 그 뒤 「예약 방송」을 눌러도 **그대로 되살아났다** — 예약 카드를 보면서 확정을 누르면
// 전관 스피커로 방송이 나갔다. 검수관이 확정 경로까지 돌려서 `calls=["immediate"]` 를 보였다.
test('「예약 방송」을 누르면 **들어앉아 있던 즉시 초안**이 예약으로 맞춰진다', () => {
  // 검색 둘이 남겨 놓은 상태 — 예약 칸에 즉시 초안이 앉아 있다
  const env = 상태만들기({ 초안들: { schedule: {
    content: '적어 둔 문안입니다', title: '안내', broadcast_type: 'text',
    immediate: true, active: 0, repeat_weekdays: [], scheduled_time: '23:11',
  } } })
  실행('모드고르기', env, 'schedule')
  const d = env.st.초안들.schedule
  assert.equal(!!d.immediate, false,
    '「예약 방송」 카드를 눌렀는데 즉시 초안이 그대로다 — 확정하면 방송이 나간다')
  assert.equal(d.active, 1,
    '예약으로 맞췄는데 꺼진 채다 — 저장돼도 영영 안 울린다')
  assert.deepEqual(d.repeat_weekdays, [0,1,2,3,4,5,6], '반복이 안 되살아났다')
  assert.equal(d.content, '적어 둔 문안입니다',
    '실행 방식을 맞추면서 **사람이 적은 문안**을 지웠다 — 보존해야 하는 것은 그쪽이다')
})

test('「지금 방송」을 누르면 **들어앉아 있던 예약 초안**이 즉시로 맞춰진다', () => {
  const env = 상태만들기({ 초안들: { tts: {
    content: '문안', immediate: false, active: 1, repeat_weekdays: [1,2], scheduled_time: '15:00',
  } } })
  실행('모드고르기', env, 'tts')
  const d = env.st.초안들.tts
  assert.equal(d.immediate, true, '「지금 방송」 카드인데 예약 초안이 그대로다')
  assert.equal(d.active, 0, '즉시인데 활성 예약으로 남는다 — 나중에 한 번 더 나간다')
  assert.deepEqual(d.repeat_weekdays, [], '즉시인데 반복이 남는다 — 내일도 나간다')
})

test('**맞지 않을 때만** 건드린다 — 멀쩡한 초안은 그대로 되살린다', () => {
  // ── **반복 예약으로 본다** (V③ R21 지적, 2026-09-14) ──────────────────────────
  // 앞 판은 `scheduled_time: '15:00'` 에 날짜·반복이 없는 초안이었다. 그러면 **오늘의
  // 1회성**으로 읽히므로, 지나간 예약을 옮기는 규칙이 붙은 뒤로는 **오후 3시가 지나면
  // 제품이 멀쩡해도 빨간불**이 난다 — 검수관이 시계를 16:00 으로 고정해 보였다.
  // 돌리는 시각에 따라 갈리는 시험은 초록일 때도 무엇을 지켰는지 알 수 없다.
  //
  // 이 시험이 지키려는 사실은 **「맞는 초안은 그대로 되살린다」**이지 날짜 규칙이 아니다.
  // 그래서 **시계를 안 타는** 초안을 쓴다 — 반복 예약에는 그 규칙이 아예 해당하지 않는다.
  // 1회성 쪽은 아래 고정 시계 시험들이 따로 본다.
  const 있던 = { content: '그대로', immediate: false, active: 1,
                 scheduled_time: '15:00', repeat_weekdays: [1, 3, 5] }
  const env = 상태만들기({ 초안들: { schedule: 있던 } })
  실행('모드고르기', env, 'schedule')
  assert.equal(env.st.초안들.schedule, 있던,
    '맞는 초안까지 새로 만든다 — 사람이 고친 값이 밑바탕으로 되돌아간다')
})

test('**작성 내용이 보존된다** — 갔다가 돌아와도 그대로', () => {
  const env = 상태만들기()
  실행('모드고르기', env, 'tts')
  env.st.초안들.tts.content = '보존 시험 문장입니다'
  // 취소 없이 바로 다른 카드로
  env.st.모드 = 'tts'
  실행('모드고르기', env, 'bgm')
  assert.equal(env.st.모드, 'bgm', '전환이 안 됐다')
  assert.equal(env.st.초안들.tts.content, '보존 시험 문장입니다',
    '다른 카드로 가자 앞 카드의 문안이 사라졌다')
  // 돌아온다
  env.st.모드 = 'bgm'
  실행('모드고르기', env, 'tts')
  assert.equal(env.st.초안들.tts.content, '보존 시험 문장입니다',
    '돌아왔는데 문안이 비어 있다')
})

test('이미 쓰던 칸은 **덮어쓰지 않는다** — 다시 눌러도 초안이 새로 안 선다', () => {
  const env = 상태만들기()
  실행('모드고르기', env, 'tts')
  env.st.초안들.tts.content = '지우면 안 되는 문장'
  env.st.모드 = 'tts'
  실행('모드고르기', env, 'tts')      // 같은 단추를 한 번 더
  assert.equal(env.st.초안들.tts.content, '지우면 안 되는 문장',
    '같은 단추를 다시 누르면 쓰던 것이 지워진다')
})

test('「취소」는 **그 칸만** 비운다 — 다른 카드는 안 건드린다', () => {
  const env = 상태만들기({ 모드: 'tts', 초안들: { tts: { content: '버릴 것' }, bgm: { content: '남을 것' } } })
  실행('reset', env)
  assert.equal(env.st.모드, null, '취소했는데 카드가 안 접힌다')
  assert.equal(env.st.초안들.tts, undefined, '취소한 카드의 내용이 남아 있다')
  assert.equal(env.st.초안들.bgm?.content, '남을 것',
    '취소 한 번에 **다른 카드**의 내용까지 날아갔다')
})

test('카드가 열려도 단추 넷이 **계속 보인다** — 전환에 취소가 필요 없다', () => {
  assert.doesNotMatch(코드, /\{!draft && \(\s*\n\s*<div className="mt-2\.5/,
    '카드가 열리면 단추 넷이 숨는다 — 다른 카드로 가려면 먼저 취소해야 한다')
  // 단추의 onClick 은 목록을 도는 **안쪽**에 있다 — 뒤를 본다.
  // **앵커가 옮겨졌다**(2026-09-15): 단추를 「지금/나중에」로 묶으면서
  // `빠른시작.map` 이 `묶음.단추.map` 이 됐다. 지키려는 것은 그대로다.
  const i = 코드.indexOf('묶음.단추.map')
  const 블 = 코드.slice(i, i + 1400)
  assert.match(블, /모드고르기\(b\.id\)/, '단추가 모드 전환을 안 부른다')
  assert.doesNotMatch(블, /setDraft\(빠른초안/, '단추가 아직 초안을 직접 덮어쓴다 — 보존이 깨진다')
})

test('고른 카드가 **보조기술에도** 보인다 — 색만으로 말하지 않는다', () => {
  const i = 코드.indexOf('묶음.단추.map')
  const 블 = 코드.slice(i, i + 1400)
  assert.match(블, /aria-pressed=\{모드 === b\.id\}/, '고른 단추를 aria-pressed 로 안 알린다')
})

// ── V③ 지적(2026-09-14) — 카드별 초안 보존이 **두 가지를 무너뜨리고 있었다** ────────
// 앞 시험들은 "초안이 남는가"만 봤다. 검수관이 그 옆을 짚었다.
test('**확인 항목도 그 칸에 딸려 다닌다** — 확인 게이트가 사라지면 안 된다', () => {
  // 애매하게 읽힌 예약(확인 항목 있음)을 만들고, 다른 카드에 갔다 돌아온다.
  // 초안은 남는데 `notes` 가 비면 `handleConfirm` 의 `notes.length > 0` 검사가 통과해
  // **미확인 시각·후보가 그대로 저장된다.** 조용한 오독이 이 저장소에서 가장 비싼 실패다.
  const env = 상태만들기()
  const 표 = { schedule: { notes: ['오전인지 오후인지 확인해 주세요'], acked: false } }
  env.확인들Ref = { current: 표 }
  let 놓인notes = null, 놓인acked = null
  env.setNotes = (v) => { 놓인notes = v }
  env.setAcked = (v) => { 놓인acked = v }
  env.setLoading = () => {}
  env.st.모드 = 'bgm'
  실행('모드고르기', env, 'schedule')
  assert.deepEqual(놓인notes, 표.schedule.notes,
    '카드를 바꿨다 돌아오니 확인 항목이 사라졌다 — 확인 없이 저장할 수 있게 된다')
  assert.equal(놓인acked, false, '확인 체크 상태가 안 되살아난다')
})

test('**돌던 검색의 자물쇠도 같이 푼다** — 검색창이 영영 잠기면 안 된다', () => {
  // `모드고르기` 가 표식만 올리고 `loading` 을 안 풀면, 돌아온 응답이 `finally` 에서
  // 표식이 안 맞아 `setLoading(false)` 를 건너뛴다 → **검색창이 영영 잠긴다.**
  // 검수관이 제품 핸들러로 그 상태를 재현했다.
  const env = 상태만들기()
  env.확인들Ref = { current: {} }
  let loading = true
  env.setLoading = (v) => { loading = v }
  env.setNotes = () => {}; env.setAcked = () => {}
  실행('모드고르기', env, 'tts')
  assert.equal(loading, false,
    '카드를 바꿔도 검색 자물쇠가 안 풀린다 — 무효로 만든 요청이 자물쇠를 들고 가 버린다')
})

// ── **「언제 나갈지」를 정하는 문은 둘뿐이다** (2026-09-14) ───────────────────────
// V③ 가 R12·R14·R15·R17 로 **네 번** 같은 결함을 잡았다. 넷 다 "고른 카드의 실행 방식이
// 지켜지는가" 였고, 나는 그때마다 **그 한 문만** 막았다 — 검색 경로, 단추 경로, 되돌리는 값.
// 그래서 검수가 매번 다음 문을 찾아냈다. 이 저장소가 「하나만 고침」이라 부르는 바로 그 모양이다.
//
// 그러니 문을 세어 **닫힌 집합**으로 만든다. `immediate` 를 **정하는** 자리는
// `빠른초안`(빈 칸에 새 초안) 과 `실행방식맞추기`(있던 초안을 카드에 맞춤) 둘뿐이고,
// 나머지는 전부 **읽기만** 한다. 새 문이 생기면 이 시험이 먼저 빨간불을 낸다.
test('**화면은 `immediate` 를 스스로 정하지 않는다** — 규칙은 quickStart 한 곳이다', () => {
  // 긍정 앵커 — 실제로 그 두 함수를 쓰고 있다(없으면 아래 부정 단언이 빈 파일도 통과시킨다)
  assert.match(코드, /실행방식맞추기\(/, '맞추는 규칙을 아예 안 쓴다')
  assert.match(코드, /빠른초안\(/, '새 초안을 만드는 규칙을 안 쓴다')

  // 초안에 `immediate` 를 **직접 얹는** 자리가 없어야 한다. 있으면 그 자리가 새 문이다.
  const 직접 = [...코드.matchAll(/immediate:\s*[^,}\n]+/g)].map(m => m[0])
  assert.deepEqual(직접, [],
    '화면이 `immediate` 를 직접 정한다 — 규칙이 두 곳이 되면 한쪽만 고친 채 갈린다. 실제: '
    + 직접.join(' / '))

  // `즉시실행값` 도 화면이 직접 부르지 않는다 — 맞추는 일은 `실행방식맞추기` 가 한다.
  assert.doesNotMatch(코드, /즉시실행값\(/,
    '화면이 실행값을 직접 맞춘다 — 카드 경로와 검색 경로가 또 갈린다')
})

// ── **글자가 아니라 결과를 본다** (V③ R19 지적, 2026-09-14) ─────────────────────
// 위 시험은 **문법만** 본다 — `immediate:` 라는 모양을 찾을 뿐이라 `d['imm'+'ediate']=x`
// 나 객체 펼치기로 뒤집으면 못 잡는다. 검수관이 그것을 짚었고 맞는 말이다.
// **그 시험을 지우지는 않는다** — 새 문이 생기는 흔한 모양을 값싸게 잡아 주고, 무엇이
// 문인지 이름을 대 준다. 다만 **보조**로 두고, 사실은 여기서 **돌려서** 지킨다.
//
// 카드 다섯을 **모두** 돈다. 넷만 돌면 다섯째에서 같은 일이 되풀이된다 —
// 그것이 R12·R14·R15·R17 이 네 번 반복된 이유다.
// **기대값을 여기 적어 둔다.** 처음에는 `초안정의[id].즉시` 를 그대로 기대값으로 썼는데,
// 그러면 **제품 표를 뒤집으면 기대값도 같이 뒤집혀** 시험이 언제나 초록이다(자기 참조).
// 변이로 확인했다 — `chime` 만 예약으로 바꿔도 18건이 전부 통과했다. 가짜 오라클이다.
// 그래서 **사람이 아는 사실**을 적는다: 지금 방송·배경음악·순서·차임벨은 누르면 나가고,
// 예약 방송만 나중에 나간다. 이 표를 고치려면 화면의 약속이 바뀌었다는 뜻이다.
const 카드기대 = {
  tts:      { 즉시: true,  유형: 'text'  },
  schedule: { 즉시: false, 유형: 'text'  },
  bgm:      { 즉시: true,  유형: 'bgm'   },
  flow:     { 즉시: true,  유형: 'flow'  },
  chime:    { 즉시: true,  유형: 'chime' },
}
const 카드들 = Object.keys(카드기대)

test('**제품 표가 이 기대와 같다** — 갈리면 어느 쪽이 맞는지 사람이 정한다', () => {
  assert.deepEqual(Object.keys(초안정의).sort(), 카드들.slice().sort(),
    '카드가 늘거나 줄었다 — 아래 시험들이 새 카드를 안 돈다')
  for (const id of 카드들) {
    assert.equal(!!초안정의[id].즉시, 카드기대[id].즉시,
      `${id} 카드의 실행 방식이 바뀌었다 — 「${id === 'schedule' ? '예약' : '지금'}」 이던 것이 반대가 됐다`)
    assert.equal(초안정의[id].유형, 카드기대[id].유형, `${id} 카드의 방송 유형이 바뀌었다`)
  }
})

/** 제품 `handleConfirm` 의 실행 갈래만 떼어 돌린다 — 무엇을 불렀는지 본다. */
function 확정갈래(draft) {
  const 부른것 = []
  const i = 코드.indexOf('const isImmediate = !!draft.immediate')
  assert.ok(i > 0, '긍정 앵커 — 확정 경로에 실행 갈래가 있다')
  const 시작 = 코드.indexOf('if (isImmediate)', i)
  assert.ok(시작 > 0, '긍정 앵커 — 즉시/예약 갈래가 있다')
  const 갈래 = 코드.slice(시작, 코드.indexOf('onAdded?.()', 시작))
  const 창 = {
    draft, title: draft.title, 부른것,
    지금내보내기: async (d) => { 부른것.push(['즉시', d]) },
    createSchedule: async (d) => { 부른것.push(['예약', d]); return { id: 1 } },
    reset: () => {}, setFiredMsg: () => {}, 띠띄우기: () => {},
    isImmediate: !!draft.immediate,
  }
  const 이름 = Object.keys(창)
  new Function(...이름, `return (async () => {${갈래}})`)(...이름.map(k => 창[k]))()
  return 부른것
}

test('**카드 다섯 모두** — 새 초안의 실행 방식이 카드와 맞고, 확정이 그대로 간다', () => {
  const 밑바탕 = { active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6],
                   repeat_start_date: '2026-09-14' }
  for (const id of 카드들) {
    const 초안 = 빠른초안(id, 밑바탕)
    assert.ok(초안, `${id} 카드의 초안을 못 만든다`)
    const 즉시여야 = 카드기대[id].즉시
    assert.equal(!!초안.immediate, 즉시여야, `${id}: 새 초안의 실행 방식이 카드와 다르다`)
    if (즉시여야) {
      assert.equal(초안.active, 0, `${id}: 즉시인데 활성 예약이다 — 나중에 한 번 더 나간다`)
      assert.deepEqual(초안.repeat_weekdays, [], `${id}: 즉시인데 반복이 남는다 — 내일도 나간다`)
    } else {
      assert.equal(초안.active, 1, `${id}: 예약인데 꺼진 채다 — 영영 안 울린다`)
    }
    // **확정까지 그대로 간다.** 초안만 맞고 저장 경로에서 갈리면 뜻이 없다.
    const 부른것 = 확정갈래({ ...초안, title: '제목' })
    assert.equal(부른것.length, 1, `${id}: 확정이 한 번만 가야 한다`)
    assert.equal(부른것[0][0], 즉시여야 ? '즉시' : '예약',
      `${id} 카드의 확정이 반대로 간다 — 예약해야 하는데 방송이 나가거나 그 반대다`)
  }
})

test('**카드 다섯 모두** — 반대 초안이 들어와도 맞춰지고 사람이 적은 것은 남는다', () => {
  const 밑바탕 = { active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6],
                   repeat_start_date: '2026-09-14' }
  for (const id of 카드들) {
    const 즉시여야 = 카드기대[id].즉시
    // 그 카드와 **정반대**인 초안을 일부러 들이민다
    const 반대 = 즉시여야
      ? { immediate: false, active: 1, repeat_weekdays: [1,2], scheduled_time: '15:00' }
      : { immediate: true,  active: 0, repeat_weekdays: [],    scheduled_time: '23:11' }
    const { 초안, 바뀜 } = 실행방식맞추기(id, {
      ...반대, content: '사람이 적은 문안', title: '사람이 적은 제목',
      broadcast_type: 카드기대[id].유형, managed_by: 'ai',
    }, 밑바탕)
    assert.equal(바뀜, true, `${id}: 반대 초안인데 「바뀜」을 안 알린다 — 사람에게 말할 기회를 놓친다`)
    assert.equal(!!초안.immediate, 즉시여야, `${id}: 맞췄다면서 실행 방식이 그대로다`)
    if (즉시여야) {
      assert.equal(초안.active, 0, `${id}: 즉시인데 활성 예약으로 남는다`)
      assert.deepEqual(초안.repeat_weekdays, [], `${id}: 즉시인데 반복이 남는다`)
    } else {
      assert.equal(초안.active, 1, `${id}: 예약인데 꺼진 채로 남는다 — 영영 안 울린다`)
      assert.equal(초안.scheduled_time, '09:35',
        `${id}: 즉시가 남긴 **지금 분**이 예약 시각이 됐다 — 지나가면 안 울린다`)
      assert.deepEqual(초안.repeat_weekdays, [0,1,2,3,4,5,6], `${id}: 반복이 안 되살아났다`)
    }
    // **보존해야 하는 것**은 사람이 적은 쪽이다
    assert.equal(초안.content, '사람이 적은 문안', `${id}: 문안이 지워졌다`)
    assert.equal(초안.title, '사람이 적은 제목', `${id}: 제목이 지워졌다`)
    assert.equal(초안.broadcast_type, 카드기대[id].유형, `${id}: 유형이 바뀌었다`)
    assert.equal(초안.managed_by, 'ai',
      `${id}: AI 표시가 사라졌다 — 취소 목록에서 못 찾는다`)
    // 확정도 맞춰진 쪽으로 간다
    assert.equal(확정갈래({ ...초안, title: '제목' })[0][0], 즉시여야 ? '즉시' : '예약',
      `${id}: 맞췄는데 확정이 반대로 간다`)
  }
})

// ── **지나간 1회성 예약을 되살리지 않는다** (V③ R19 지적, 2026-09-14) ───────────────
// 현장 PC 의 창은 하루 종일 열려 있다(그게 이 시스템의 전제다). 그래서 어제 만든 초안이
// 오늘까지 칸에 남아 있을 수 있다. 1회성 예약은 **시작일 당일에만** 발동하므로
// (`repeatSchedule.js`), 지난 날짜인 채로 확정하면 **등록은 되는데 영영 안 울린다** —
// 이 저장소에서 원인을 찾기 가장 어려운 실패다.
// **고정 시계로 본다.** 「지금」에 기대는 규칙이라 실제 시각으로 돌리면 돌리는 때에 따라
// 통과했다 말았다 한다 — 그런 시험은 초록일 때도 무엇을 지켰는지 알 수 없다.
const 밑바탕오늘 = { active: 1, scheduled_time: '09:35', repeat_weekdays: [],
                     repeat_start_date: '2026-09-15' }
const 예약초안 = (덮을것) => ({
  content: '문안', immediate: false, active: 1, repeat_weekdays: [], ...덮을것 })

test('**어제 날짜의 1회성 초안** — 아직 안 지난 시각이면 오늘로 옮긴다', () => {
  const 지금 = new Date('2026-09-15T10:00:00')
  const { 초안, 바뀜 } = 실행방식맞추기('schedule',
    예약초안({ scheduled_time: '15:00', repeat_start_date: '2026-09-14' }), 밑바탕오늘, 지금)
  assert.equal(바뀜, true, '옮겼으면 사람에게 말해야 한다')
  assert.equal(초안.repeat_start_date, '2026-09-15',
    '어제 날짜의 1회성 예약이 그대로 되살아난다 — 확정해도 영영 안 울린다')
  assert.equal(초안.scheduled_time, '15:00',
    '날짜를 고치면서 사람이 정한 **시각**까지 바꿨다 — 그건 사람의 뜻이다')
})

// ── **날짜만 보면 모자란다** (V③ R20 지적, 2026-09-14) ──────────────────────────
// 앞 판은 날짜만 견줬다. 그래서 **오늘 15:00 짜리를 16:00 에 되살리면** 날짜가 오늘이라
// 그냥 지나갔는데, 그 예약도 이미 못 울린다(`scheduler.js` 는 현재 분과 같은 것만 본다).
test('**오늘인데 시각이 지났으면** 내일로 옮긴다 — 날짜만 보면 못 잡는다', () => {
  const 지금 = new Date('2026-09-15T16:00:00')
  const { 초안, 바뀜 } = 실행방식맞추기('schedule',
    예약초안({ scheduled_time: '15:00', repeat_start_date: '2026-09-15' }), 밑바탕오늘, 지금)
  assert.equal(바뀜, true, '지나간 예약을 그대로 통과시킨다 — 확정해도 영영 안 울린다')
  assert.equal(초안.repeat_start_date, '2026-09-16',
    '오늘 지나간 시각인데 오늘로 둔다 — 등록은 되고 소리는 안 난다')
  assert.equal(초안.scheduled_time, '15:00', '사람이 정한 시각을 바꿨다')
})

test('**어제 것인데 시각도 지났으면** 내일이다 — 오늘로 옮기면 또 지나간 예약이다', () => {
  const 지금 = new Date('2026-09-15T16:00:00')
  const { 초안 } = 실행방식맞추기('schedule',
    예약초안({ scheduled_time: '15:00', repeat_start_date: '2026-09-14' }), 밑바탕오늘, 지금)
  assert.equal(초안.repeat_start_date, '2026-09-16',
    '어제 것을 오늘로 옮겼는데 그 시각도 이미 지났다 — 옮기나 마나다')
})

test('**아직 안 지난 예약은 안 건드린다** — 사람이 정한 날짜다', () => {
  const 지금 = new Date('2026-09-15T10:00:00')
  for (const [날, 시각, 왜] of [
    ['2026-09-15', '15:00', '오늘 앞으로 올 시각'],
    ['2026-09-20', '09:00', '앞날'],
    ['2026-09-20', '08:00', '앞날이라 시각이 지금보다 일러도 상관없다'],
  ]) {
    const 있던 = 예약초안({ scheduled_time: 시각, repeat_start_date: 날 })
    const { 초안, 바뀜 } = 실행방식맞추기('schedule', 있던, 밑바탕오늘, 지금)
    assert.equal(바뀜, false, `${왜}(${날} ${시각})인데 건드렸다`)
    assert.equal(초안, 있던, `${왜}의 날짜를 옮겼다 — 사람이 정한 값이다`)
  }
})

test('**반복 예약은 지난 날짜여도 안 건드린다** — 내일 그 시각에 정상 발동한다', () => {
  const 밑바탕 = { active: 1, scheduled_time: '09:35', repeat_weekdays: [0,1,2,3,4,5,6],
                   repeat_start_date: '2026-09-15' }
  const 있던 = { content: '문안', immediate: false, active: 1,
                 repeat_weekdays: [1,3,5], scheduled_time: '15:00', repeat_start_date: '2026-09-01' }
  const { 초안, 바뀜 } = 실행방식맞추기('schedule', 있던, 밑바탕)
  assert.equal(바뀜, false, '멀쩡한 반복 예약을 건드렸다')
  assert.equal(초안, 있던, '반복 예약의 시작일을 옮겼다 — 사람이 정한 값이다')
})
