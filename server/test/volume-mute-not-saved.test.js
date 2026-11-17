// **음소거는 저장되지 않는다** — 다른 채널을 만져도 (V③ DEV-MERGE-R1 지적, HIGH, 2026-09-14).
//
// ── 무엇이 일어났나 ──────────────────────────────────────────────────────────
// `VolumePanel` 의 음소거는 *"이 자리에서 잠깐 소리만 끈다"* 가 규칙이다. 화면 안내문도
// 그렇게 적혀 있고, 함수 이름도 `소리만적용` 이다. 그런데 그 함수가 **일괄 저장이 읽는
// ref 까지** 0 으로 덮고 있었다.
//
//   안내 음성 음소거 → (저장 안 함, 여기까지는 맞다)
//   그 다음 BGM 슬라이더를 조금 움직임 → `scheduleSave()` 가 `tts: tr.current` 를 싣는다
//   → **tts 기본 음량 0 이 서버에 저장된다**
//   → 새로고침해도 0. **안내 방송이 조용히 무음이 된다.**
//
// 오류는 안 난다. 어르신 앞에서 조용한 3분이 지나야 안다 — 이 저장소가 가장 비싸게
// 겪는 실패의 모양이고, 볼륨 규칙이 *"되돌릴 상태를 만들지 않는다"* 로 못 박은 자리다.
//
// ── 이 시험이 소스를 글자로 읽지 않는 이유 ───────────────────────────────────
// 이 판단은 `.jsx` 안에 있어서 React 렌더러 없이는 화면째 못 돌린다(부채 T-27). 그래서
// **소스에서 그 함수들을 그대로 떼어 내 진짜로 실행한다** — 독립 검수관이 이 결함을
// 증명한 방법이 그것이었고, 글자 검사는 같은 결함을 못 잡았다.
// 저장 payload 도 손으로 베끼지 않고 **소스의 그 식을 그대로 꺼내** 돌린다 — 베끼면
// 제품이 바뀌는 날 시험만 초록으로 남는다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SRC_PATH = path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'VolumePanel.jsx')
const SRC = fs.readFileSync(SRC_PATH, 'utf8')

// 기본값은 **화면이 쓰는 그 한 벌**을 그대로 가져온다 — 시험이 숫자를 따로 적으면
// 기본값이 바뀌는 날 시험만 옛 숫자를 들고 초록으로 남는다(`src/lib/volumeDefaults.js` 머리말).
let 볼륨기본값
test.before(async () => {
  const m = await import('file:///' + path.join(__dirname, '..', '..', 'src', 'lib', 'volumeDefaults.js').replace(/\\/g, '/'))
  볼륨기본값 = m.볼륨기본값
})

/** 음소거 관련 함수 네 개가 사는 구간. 붙어 있어서 통째로 뗄 수 있다. */
function 음소거블록() {
  const 시작 = SRC.indexOf('const 저장될값')
  const 끝   = SRC.indexOf('// 방송 종류별 채널')
  assert.ok(시작 >= 0, '긍정 앵커 — `저장될값` 이 이 파일에 있다(저장될 값을 쥔 자리)')
  assert.ok(끝 > 시작, '긍정 앵커 — 음소거 구간의 끝(채널 표)을 찾았다')
  const 블록 = SRC.slice(시작, 끝)
  assert.match(블록, /const 소리만적용 = /, '긍정 앵커 — 뗀 구간에 `소리만적용` 이 들어 있다')
  assert.match(블록, /const 음소거토글 = /, '긍정 앵커 — 뗀 구간에 `음소거토글` 이 들어 있다')
  return 블록
}

/** `scheduleSave` 가 실제로 싣는 객체 식. 소스에서 꺼내 그대로 돌린다. */
function 저장식() {
  const i = SRC.indexOf("trackSave('bulk'")
  assert.ok(i >= 0, "긍정 앵커 — 일괄 저장(`trackSave('bulk')`)이 이 파일에 있다")
  const j = SRC.indexOf('saveVolume({', i)
  assert.ok(j > i, '긍정 앵커 — 일괄 저장이 `saveVolume({…})` 를 부른다')
  const 여는괄호 = SRC.indexOf('{', j)
  let 깊이 = 0, k = 여는괄호
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') 깊이++
    else if (SRC[k] === '}') { 깊이--; if (깊이 === 0) break }
  }
  return SRC.slice(여는괄호, k + 1)
}

// `끈값` 은 부품 밖(모듈 최상위)에 있다 — 수신부와 음소거 토글이 **둘 다** 쓰기 때문이다.
// 그래서 여기서도 바깥에서 넣어 준다. 소스에서 그 값을 그대로 읽어 온다(숫자를 또 적지 않는다).
const 끈값 = Number(/^const 끈값 = (\d+)$/m.exec(SRC)?.[1])

const 인자 = ['setMaster', 'mr', 'trackSave', 'saveVolume', 'setTts', 'tr', 'setBgm', 'gr',
  'setAudio', 'ar', 'setMedia', 'dr', 'setTv', 'vr', 'setMicGain', '음소거', 'set음소거',
  '볼륨기본값', '끈값', 'window']

/**
 * 한 번의 렌더를 흉내 낸다. React 가 하듯 **그때의 `음소거` 값을 닫아 둔 함수**를 돌려준다.
 * 상태가 바뀌면 다시 부른다 — 그래야 실제 화면과 같은 순서가 된다.
 */
function 그리기(상태) {
  const 만들기 = new Function(...인자,
    음소거블록() + '\n; return { 소리만적용, 음소거토글, 꺼졌나, 켤값 }')
  const 보낸이벤트 = []
  const 저장요청 = []
  const 창 = { dispatchEvent: (e) => 보낸이벤트.push(e.type) }
  const fns = 만들기(
    (v) => { 상태.화면.master = v }, 상태.ref.mr,
    (키, 약속) => 약속, (payload) => { 저장요청.push(payload); return Promise.resolve() },
    (v) => { 상태.화면.tts = v },   상태.ref.tr,
    (v) => { 상태.화면.bgm = v },   상태.ref.gr,
    (v) => { 상태.화면.audio = v }, 상태.ref.ar,
    (v) => { 상태.화면.media = v }, 상태.ref.dr,
    (v) => { 상태.화면.tv = v },    상태.ref.vr,
    (v) => { 상태.화면.mic = v },
    상태.음소거,
    (f) => { 상태.음소거 = typeof f === 'function' ? f(상태.음소거) : f },
    볼륨기본값, 끈값, 창,
  )
  return { ...fns, 보낸이벤트, 저장요청 }
}

const 새상태 = () => ({
  화면:   { master: 70, tts: 80, audio: 70, media: 70, bgm: 70, tv: 100 },
  ref:    { mr: { current: 70 }, tr: { current: 80 }, ar: { current: 70 },
            dr: { current: 70 }, gr: { current: 70 }, vr: { current: 100 } },
  음소거: {},
})

/** 다른 채널을 만졌을 때 실제로 서버로 나가는 것. 소스의 그 식을 그대로 돌린다. */
function 일괄저장페이로드(상태) {
  const f = new Function('mr', 'tr', 'ar', 'dr', 'gr', 'vr', 'return (' + 저장식() + ')')
  return f(상태.ref.mr, 상태.ref.tr, 상태.ref.ar, 상태.ref.dr, 상태.ref.gr, 상태.ref.vr)
}

// ── 여기가 결함이다 ──────────────────────────────────────────────────────────

test('안내 음성을 끈 뒤 BGM 을 만져도 tts 0 이 저장되지 않는다', () => {
  const 상태 = 새상태()

  // ① 안내 음성 음소거 — 화면은 0, **저장될 값은 그대로 80**
  그리기(상태).음소거토글('tts', 상태.화면.tts)
  assert.equal(상태.화면.tts, 0, '음소거했는데 화면 값이 안 내려갔다')
  assert.equal(상태.음소거.tts, 80, '끄기 전 값을 안 기억한다 — 다시 못 켠다')

  // ② 그 상태에서 BGM 슬라이더를 움직인다(= `changeBgm` 이 하는 일)
  상태.ref.gr.current = 45
  const 나가는것 = 일괄저장페이로드(상태)

  assert.equal(나가는것.tts, 80,
    '음소거한 안내 음성이 0 으로 저장된다 — 새로고침해도 무음이고 오류도 안 난다')
  assert.equal(나가는것.bgm, 45, 'BGM 조절이 저장되지 않는다')
  assert.equal('tv' in 나가는것, false, '일괄 저장에 tv 가 실렸다 — CC-055 인수 창이 닫힌다')
})

test('음원·영상도 같다 — 끄는 것은 저장이 아니다', () => {
  for (const [key, ref, 원래] of [['audio', 'ar', 70], ['media', 'dr', 70], ['bgm', 'gr', 70]]) {
    const 상태 = 새상태()
    그리기(상태).음소거토글(key, 상태.화면[key])
    assert.equal(상태.ref[ref].current, 원래,
      `${key} 를 껐더니 저장될 값까지 0 이 됐다 — 다음 정시 방송이 무음으로 나간다`)
  }
})

test('다시 켜면 그 값이 저장될 값이 된다 — 켜는 것은 사람이 고른 것이다', () => {
  const 상태 = 새상태()
  그리기(상태).음소거토글('tts', 상태.화면.tts)      // 끔
  그리기(상태).음소거토글('tts', 상태.화면.tts)      // 켬 (기억한 80 으로)
  assert.equal(상태.화면.tts, 80, '다시 켰는데 화면이 안 올라왔다')
  assert.equal(상태.ref.tr.current, 80, '켠 값이 저장될 값과 어긋난다')
  assert.equal(상태.음소거.tts, undefined, '켰는데 기억이 안 지워졌다 — 다음 판정이 어긋난다')
})

test('기억이 없는 채로 0 에서 켜면 기본값이 저장될 값이 된다 — 0 으로 「켜지」 않는다', () => {
  // 새로고침하면 기억 맵이 빈다. 서버 값이 진짜 0 이면 화면도 0 이고 ref 도 0 이다.
  const 상태 = 새상태()
  상태.화면.tts = 0
  상태.ref.tr.current = 0

  그리기(상태).음소거토글('tts', 상태.화면.tts)

  assert.equal(상태.화면.tts, 볼륨기본값.tts, '0 에서 켰는데 여전히 0 이다 — 버튼이 아무 일도 안 한다')
  assert.equal(상태.ref.tr.current, 볼륨기본값.tts,
    '화면은 켜졌는데 저장될 값은 0 이다 — 다른 채널을 만지는 순간 다시 무음이 된다')
})

test('마스터만 예외다 — PC 시스템 음량이라 끄는 것이 곧 저장이다', () => {
  const 상태 = 새상태()
  const r = 그리기(상태)
  r.음소거토글('master', 상태.화면.master)
  assert.equal(상태.화면.master, 0, '마스터 음소거가 화면에 반영되지 않았다')
  assert.equal(상태.ref.mr.current, 0,
    '마스터는 실제로 저장되는데 쥔 값이 옛것이다 — 다음 일괄 저장이 방금 끈 것을 되돌린다')
  assert.deepEqual(r.저장요청, [{ master: 0 }], '마스터 음소거가 OS 음량까지 안 내려갔다')
})

// ── **동기화가 음소거를 도로 켜지 않는다** (V③ DEV-MERGE-R2 지적, HIGH, 2026-09-14) ────────
//
// 위 결함을 고치자 새 길이 열렸다. 이제 일괄 저장이 **끄기 전 값**을 싣고 나가는데,
// 서버가 그것을 `volume_change` 로 되쏘고 → `MusicPlayer` 가 제 볼륨을 올린 뒤
// → `carecast:volume-sync` 를 보낸다. 받는 쪽이 그대로 화면을 올리면 **소리가 되살아나고
// 버튼은 여전히 「켜기」라고 적혀 있다.** 표시와 동작이 갈리는 것은 이 파일 위쪽 주석이
// 이미 한 번 겪은 모양이다.
//
// 검수관이 **실제 수신부를 떼어 실행해** 증명했다. 그래서 이 시험도 같은 것을 돌린다.

/** 동기화 수신부. `useEffect` 안에 있어서 그 한 함수만 떼어 낸다. */
function 동기화수신부() {
  const 끝점 = SRC.indexOf("window.addEventListener('carecast:volume-sync'")
  assert.ok(끝점 > 0, "긍정 앵커 — 'carecast:volume-sync' 수신 등록이 이 파일에 있다")
  const 시작 = SRC.lastIndexOf('const handler = (e) => {', 끝점)
  assert.ok(시작 > 0, '긍정 앵커 — 그 등록 앞에 handler 정의가 있다')
  const 여는괄호 = SRC.indexOf('{', SRC.indexOf('=>', 시작))
  let 깊이 = 0, k = 여는괄호
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') 깊이++
    else if (SRC[k] === '}') { 깊이--; if (깊이 === 0) break }
  }
  const 본문 = SRC.slice(시작, k + 1)
  assert.match(본문, /음소거Ref/, '수신부가 음소거 상태를 아예 안 본다')
  return 본문
}

function 동기화(상태, detail) {
  const 보낸것 = []
  const 창 = { dispatchEvent: (e) => 보낸것.push([e.type, e.detail]) }
  const 만들기 = new Function(
    'setBgm', 'setTts', 'setAudio', 'setMedia', 'setTv', 'setActivePreset',
    'gr', 'tr', 'ar', 'dr', 'vr', '음소거Ref', '끈값', 'window', 'CustomEvent',
    동기화수신부() + '\n; return handler')
  const h = 만들기(
    (v) => { 상태.화면.bgm = v }, (v) => { 상태.화면.tts = v }, (v) => { 상태.화면.audio = v },
    (v) => { 상태.화면.media = v }, (v) => { 상태.화면.tv = v }, () => {},
    상태.ref.gr, 상태.ref.tr, 상태.ref.ar, 상태.ref.dr, 상태.ref.vr,
    { current: 상태.음소거 }, 끈값, 창,
    class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
  )
  h({ detail })
  return 보낸것
}

test('꺼 둔 채널은 동기화가 도로 켜지 않는다 — 화면도, 소리도', () => {
  const 상태 = 새상태()
  그리기(상태).음소거토글('tts', 상태.화면.tts)   // 안내 음성 끔 (화면 0, 저장될 값 80)

  // 다른 채널을 저장한 응답이 돌아온다 — tts 는 끄기 전 값 80 을 싣고 있다.
  const 보낸것 = 동기화(상태, { tts: 80, bgm: 45 })

  assert.equal(상태.화면.tts, 0,
    '동기화가 음소거를 화면에서 풀었다 — 버튼은 「켜기」인데 소리는 나는 상태가 된다')
  assert.equal(상태.ref.tr.current, 80, '저장된 진짜 값은 받아 적어야 한다')
  assert.deepEqual(보낸것.find(([t]) => t === 'carecast:tts-volume'), ['carecast:tts-volume', 0],
    '재생기가 올려 둔 소리를 도로 안 내린다 — MusicPlayer 가 이 SSE 를 먼저 받아 이미 올려놨다')

  // 안 꺼 둔 채널은 예전 그대로 따라간다
  assert.equal(상태.화면.bgm, 45, '안 꺼 둔 채널까지 동기화가 멈췄다')
  assert.deepEqual(보낸것.find(([t]) => t === 'carecast:bgm-volume'), ['carecast:bgm-volume', 45])
})

test('아무것도 안 꺼 뒀으면 동기화는 예전 그대로다', () => {
  const 상태 = 새상태()
  // (TV 송출 채널은 2026-09-21 걷어냈다 — 옛 서버가 tv 를 실어 보내도 받아 적지 않는다)
  const 보낸것 = 동기화(상태, { tts: 55, audio: 60, media: 65, bgm: 45, tv: 90 })
  assert.deepEqual(
    { tts: 상태.화면.tts, audio: 상태.화면.audio, media: 상태.화면.media, bgm: 상태.화면.bgm },
    { tts: 55, audio: 60, media: 65, bgm: 45 })
  assert.equal(상태.화면.tv, 100, '걷어낸 TV 채널을 동기화가 아직 받아 적는다')
  assert.deepEqual(보낸것.map(([t, v]) => [t, v]),
    [['carecast:bgm-volume', 45]],
    'BGM 만 이벤트를 내던 기존 동작이 바뀌었다')
})

// ── **사람이 값을 고르면 꺼 둠은 끝난다** (V③ DEV-MERGE-R3 지적, HIGH, 2026-09-14) ─────────
//
// 위 수정이 또 길을 열었다. 꺼 둔 기록을 **동기화가 소리 차단에 쓰기 시작했는데**,
// 슬라이더·프리셋·유튜브로 값을 골라도 그 기록이 안 지워졌다. 그래서 —
//
//   안내 음성 끔 → 슬라이더로 55 로 올림(화면 55, 소리 55) → 다른 채널 저장의 응답이 옴
//   → 수신부가 「이 채널은 꺼져 있다」고 보고 **소리만 0 으로** 되돌린다. 화면은 55 인 채.
//
// 사람이 방금 올린 소리가 이유 없이 사라지고, 오류는 안 난다.
// 버튼도 그전부터 거짓말하고 있었다 — 55 인데 「켜기」라고 적혀 있다(`꺼졌나` 가 맵을 본다).

/**
 * 이름 있는 화살표 함수 하나를 소스에서 떼어 낸다.
 *
 * 중괄호만 세면 안 된다 — `const 직접골랐다 = (k) => set음소거(p => { … })` 처럼 **괄호가
 * 중괄호 밖을 감싸는** 모양이 있어서, 중괄호가 닫히는 자리에서 끊으면 `)` 가 잘린다(겪었다).
 * 그래서 괄호·중괄호를 함께 세고, **둘 다 0 으로 돌아온 뒤 줄이 끝나는 자리**에서 끊는다.
 */
function 함수떼기(이름) {
  const 시작 = SRC.indexOf('const ' + 이름 + ' = ')
  assert.ok(시작 >= 0, `긍정 앵커 — \`${이름}\` 이 이 파일에 있다`)
  let 중괄호 = 0, 소괄호 = 0, 열렸다 = false
  for (let k = 시작; k < SRC.length; k++) {
    const c = SRC[k]
    if (c === '{') { 중괄호++; 열렸다 = true }
    else if (c === '}') 중괄호--
    else if (c === '(') { 소괄호++; 열렸다 = true }
    else if (c === ')') 소괄호--
    else if (c === '\n' && 열렸다 && 중괄호 === 0 && 소괄호 === 0) return SRC.slice(시작, k)
  }
  assert.fail(`\`${이름}\` 의 끝을 못 찾았다 — 떼는 규칙을 다시 본다`)
}

/** 사람이 그 채널 슬라이더를 끌었다 — 제품의 `change*` 를 그대로 실행한다. */
function 직접조작(상태, key, v) {
  const 이름 = { tts: 'changeTts', bgm: 'changeBgm', audio: 'changeAudio', media: 'changeMedia' }[key]
  assert.ok(이름, `${key} 는 이 시험이 모르는 채널이다`)
  const set = { tts: 'setTts', bgm: 'setBgm', audio: 'setAudio', media: 'setMedia' }[key]
  const ref = { tts: 'tr', bgm: 'gr', audio: 'ar', media: 'dr' }[key]
  const 보낸것 = []
  const 창 = { dispatchEvent: (e) => 보낸것.push([e.type, e.detail]) }
  // `직접골랐다` 도 **제품 소스 그대로** 들여온다 — 여기서 흉내 내면 그 규칙이 바뀌는 날
  // 시험만 옛 규칙을 들고 초록으로 남는다.
  const 만들기 = new Function(
    'set음소거', set, ref, 'setActivePreset', 'scheduleSave', 'trackSave',
    'saveBgmBroadcastDefault', 'window', 'CustomEvent',
    함수떼기('직접골랐다') + '\n' + 함수떼기(이름) + '\n; return ' + 이름)
  const f = 만들기(
    (fn) => { 상태.음소거 = typeof fn === 'function' ? fn(상태.음소거) : fn },
    (x) => { 상태.화면[key] = x }, 상태.ref[ref], () => {},
    () => {}, () => {}, () => Promise.resolve(), 창,
    class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
  )
  f(v)
  return 보낸것
}

test('꺼 둔 뒤 슬라이더로 값을 고르면 꺼 둠이 풀린다 — 동기화가 소리를 도로 내리지 않는다', () => {
  for (const key of ['tts', 'bgm', 'audio', 'media']) {
    const 상태 = 새상태()
    그리기(상태).음소거토글(key, 상태.화면[key])
    assert.equal(상태.화면[key], 0, `${key} 음소거가 화면에 안 먹었다`)

    const 조작이벤트 = 직접조작(상태, key, 55)
    assert.equal(상태.화면[key], 55, `${key} 슬라이더 조작이 화면에 안 먹었다`)
    assert.equal(상태.음소거[key], undefined,
      `${key} 를 55 로 올렸는데 「꺼짐」 기록이 남아 있다 — 버튼이 거짓말하고, 다음 동기화가 소리를 0 으로 내린다`)
    assert.ok(조작이벤트.some(([, v]) => v === 55), `${key} 조작이 재생기에 안 갔다`)

    // 다른 PC 의 저장 응답이 같은 값을 싣고 돌아온다
    const 보낸것 = 동기화(상태, { [key]: 55 })
    assert.equal(상태.화면[key], 55, `${key} 동기화가 화면을 흔들었다`)
    for (const [, v] of 보낸것) {
      assert.notEqual(v, 0, `${key} 동기화가 방금 사람이 올린 소리를 0 으로 되돌렸다`)
    }
  }
})

// ── **이 화면 밖에서 온 값은 「사람의 선택」이 아니다** (V③ DEV-MERGE-R4, 2026-09-14) ────────
//
// 유튜브 쪽 역방향 이벤트(`carecast:bgm-volume-from-yt`·`tv-volume-from-yt`)를 한 번
// 「사람이 저쪽 슬라이더를 끌었다」로 봤다가 두 가지로 틀렸다:
//   · 그 이벤트를 **자동 방송도 쏜다**(`MusicPlayer` 의 `bgm_start`, TV 인수 응답).
//     사람이 아무것도 안 눌렀는데 꺼 둠이 풀렸다.
//   · 그 이벤트는 **로컬 BGM 재생기에 닿지 않는다**(그쪽은 `carecast:bgm-volume` 을 듣는다).
//     꺼 둠만 풀리고 소리는 0 인 채 — 화면은 「켜짐」인데 홀은 조용하다.
//
// 그래서 규칙을 **줄였다**: 사람의 선택은 이 화면의 슬라이더·프리셋뿐이다.

/** 재생기(MusicPlayer) 쪽 슬라이더에서 온 값. 그 수신부를 소스에서 떼어 실제로 돌린다. */
function 역방향(상태, 이벤트이름, v) {
  const 끝점 = SRC.indexOf(`window.addEventListener('${이벤트이름}'`)
  assert.ok(끝점 > 0, `긍정 앵커 — '${이벤트이름}' 수신 등록이 이 파일에 있다`)
  const 시작 = SRC.lastIndexOf('const handler = (e) => {', 끝점)
  assert.ok(시작 > 0, '긍정 앵커 — 그 등록 앞에 handler 정의가 있다')
  let 중괄호 = 0, k = SRC.indexOf('{', SRC.indexOf('=>', 시작))
  const 여는곳 = k
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') 중괄호++
    else if (SRC[k] === '}') { 중괄호--; if (중괄호 === 0) break }
  }
  const 본문 = SRC.slice(시작, k + 1)
  void 여는곳
  assert.match(본문, /음소거Ref/, `${이벤트이름} 수신부가 꺼 둔 채널을 아예 안 본다`)
  const 보낸것 = []
  const 창 = { dispatchEvent: (e) => 보낸것.push([e.type, e.detail]) }
  const 만들기 = new Function('setBgm', 'setTv', 'gr', 'vr', 'setActivePreset', '음소거Ref',
    '끈값', 'window', 'CustomEvent', 본문 + '\n; return handler')
  const h = 만들기(
    (x) => { 상태.화면.bgm = x }, (x) => { 상태.화면.tv = x },
    상태.ref.gr, 상태.ref.vr, () => {}, { current: 상태.음소거 }, 끈값, 창,
    class { constructor(type, init) { this.type = type; this.detail = init?.detail } })
  h({ detail: v })
  return 보낸것
}

test('꺼 둔 채널은 재생기 쪽에서 값이 와도 안 켜진다 — 자동 방송이 쏘는 것과 구별할 수 없다', () => {
  for (const [key, 이벤트, ref] of [
    ['bgm', 'carecast:bgm-volume-from-player', 'gr'],
  ]) {
    const 상태 = 새상태()
    그리기(상태).음소거토글(key, 상태.화면[key])
    assert.equal(상태.화면[key], 0, `${key} 음소거가 화면에 안 먹었다`)

    const 보낸것 = 역방향(상태, 이벤트, 50)

    // **보내는 쪽은 제 재생 음량을 이미 올려 놓고 이 이벤트를 쏜다.** 그냥 돌아서면
    // 패널만 「꺼짐」이고 홀에서는 소리가 난다 — 사람이 분명히 껐는데 소리가 나는 것이다.
    const 되돌림 = 보낸것.find(([, v]) => v === 끈값)
    assert.ok(되돌림,
      `${key}: 밖에서 올라간 소리를 도로 안 내린다 — 화면은 「꺼짐」인데 홀에서는 소리가 난다`)

    assert.equal(상태.화면[key], 0,
      `${key}: 재생기 쪽 값이 꺼 둔 것을 화면에서 풀었다 — 자동 방송이 쏘는 경우까지 사람 조작으로 본 것이다`)
    assert.notEqual(상태.음소거[key], undefined,
      `${key}: 꺼 둠 기록이 지워졌다 — 자동 방송이 쏜 값에도 풀린다`)
    assert.equal(상태.ref[ref].current, 50, `${key}: 저장될 값은 받아 적어야 한다`)
  }
})

test('안 꺼 뒀으면 재생기 쪽 값은 예전처럼 화면에 따라온다', () => {
  const 상태 = 새상태()
  역방향(상태, 'carecast:bgm-volume-from-player', 45)
  assert.equal(상태.화면.bgm, 45, '재생기의 BGM 슬라이더가 이 화면에 안 따라온다')
  // TV 쪽 역방향 수신부는 채널째 걷어냈다(2026-09-21)
  assert.ok(!SRC.includes("addEventListener('carecast:tv-volume-from-yt'"), '걷어낸 TV 역방향 수신부가 남았다')
})

// ── **다시 불러오기도 같은 규칙이다** (V③ DEV-MERGE-R5 가 물은 자리, 2026-09-14) ────────────
//
// 꺼 둔 기록이 서고 지워지는 자리는 셋뿐이다 — 음소거 토글 · 이 화면 슬라이더 · 프리셋.
// 나머지 입구는 전부 **값만 받아 적는다**: 동기화 · 재생기 역방향 · 그리고 여기(로드).
// 처음 뜰 때는 꺼 둔 것이 없어 티가 안 나지만, 사람이 「다시 불러오기」를 누르면 다시 돈다.

/** 서버에서 음량을 받아 적는 자리(`getVolume().then(...)`)의 몸통. */
function 로드본문() {
  const 시작 = SRC.indexOf('const 꺼둔것 = 음소거Ref.current')
  assert.ok(시작 >= 0, '긍정 앵커 — 로드 자리가 꺼 둔 채널을 본다')
  const 끝 = SRC.indexOf('setLoaded(true)', 시작)
  assert.ok(끝 > 시작, '긍정 앵커 — 로드 자리의 끝(setLoaded)을 찾았다')
  return SRC.slice(시작, 끝)
}

function 로드(상태, 서버값) {
  const 보낸것 = []
  const 만들기 = new Function(
    'm', 't', 'a', 'e', 'g', '음소거Ref', '끈값',
    'setMaster', 'setTts', 'setAudio', 'setMedia', 'setBgm',
    'mr', 'tr', 'ar', 'dr', 'gr', 'dispatchAll',
    로드본문())
  만들기(
    서버값.master, 서버값.tts, 서버값.audio, 서버값.media, 서버값.bgm,
    { current: 상태.음소거 }, 끈값,
    (x) => { 상태.화면.master = x }, (x) => { 상태.화면.tts = x }, (x) => { 상태.화면.audio = x },
    (x) => { 상태.화면.media = x }, (x) => { 상태.화면.bgm = x },
    상태.ref.mr, 상태.ref.tr, 상태.ref.ar, 상태.ref.dr, 상태.ref.gr,
    (...보낸) => 보낸것.push(보낸),
  )
  return 보낸것[0]
}

test('꺼 둔 채 「다시 불러오기」를 눌러도 안 켜진다 — 값만 받아 적는다', () => {
  const 상태 = 새상태()
  그리기(상태).음소거토글('bgm', 상태.화면.bgm)

  const 보낸값 = 로드(상태, { master: 70, tts: 80, audio: 100, media: 70, bgm: 65 })

  assert.equal(상태.화면.bgm, 0, '다시 불러오기가 꺼 둔 것을 화면에서 풀었다')
  assert.equal(상태.ref.gr.current, 65, '저장된 진짜 값은 받아 적어야 한다')
  assert.equal(보낸값[4], 끈값, '재생기에 65 를 보냈다 — 꺼 뒀는데 소리가 돌아온다')
  // 안 꺼 둔 채널은 예전 그대로
  assert.equal(상태.화면.tts, 80, '안 꺼 둔 채널까지 로드가 멈췄다')
  assert.equal(보낸값[1], 80, '안 꺼 둔 채널의 값이 재생기에 안 갔다')
})

// ── (TV 는 소리를 먼저 내보내고 알린다 — V③ DEV-MERGE-R6) ──────────────────────────────────
// 그 시험들은 외부 동영상 TV 송출 재생기를 떼어 돌렸다. 채널째 2026-09-21 걷어내 빠졌다.
