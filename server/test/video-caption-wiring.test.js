'use strict'
// 영상 자막의 **배선**을 본다 — 보내는 쪽과 받는 쪽을 한 자리에서 잇는다 (2026-09-12).
//
// 왜 따로 필요했나: `video-caption-sync.test.js` 6건이 **전부 초록인 채로** 순서 오류가
// 지나갔다. 그 시험들은 보내는 쪽 소스만 봤다 — "attach 를 쏘는가", "offsetMs 를 싣는가".
// 그런데 받는 쪽(`BroadcastCaption` 의 `onCue`)은 cue 를 받으면 `audioRef` 를 **초기화한다**
// (새 방송이 오면 앞 방송의 요소를 놓는 것이 맞다). 그래서 attach 를 먼저 쏘면 그 다음 cue 가
// 그것을 지워 **실측 시계를 버리고 추정으로 떨어진다** — 영상은 추정이 필요 없는데도.
//
// 증상: 탐색·배속을 바꾸면 자막이 따로 간다. 화면에는 자막이 나오므로 **고장으로 안 보인다.**
//
// 그래서 이 파일은 **두 쪽을 실제로 잇는다.** 한쪽만 보는 검사로는 이 종류를 못 잡는다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

// 받는 쪽의 `onCue`·`onAttach` 본문을 **소스에서** 떼어 온다 — 베껴 쓰면 진짜가 무엇을
// 하든 통과한다(이 저장소가 두 번 겪은 함정).
function 받는쪽() {
  const src = 읽기('src', 'components', 'broadcast', 'BroadcastCaption.jsx')
  const 꺼내기 = (이름) => {
    const i = src.indexOf(`const ${이름} = (e) => {`)
    assert.notEqual(i, -1, `${이름} 를 못 찾았다 — 이 가드를 옮길 것`)
    // 같은 들여쓰기의 닫는 줄까지.
    const 끝 = src.indexOf('\n    }', i)
    assert.notEqual(끝, -1, `${이름} 의 끝을 못 찾았다`)
    return src.slice(i, 끝 + 6)
  }
  const 상태 = { audioRef: { current: null }, clockRef: { current: null }, cue: null, 알림: [] }
  const sandbox = {
    console, Date, Math, Number, Array, String, JSON,
    performance: { now: () => 1000 },
    embedded: false,
    // ── **창구를 하나 더 놓는다** (2026-09-16) ──────────────────────────────────
    // `onCue` 는 자막 한 판이 시작·끝났음을 `window` 로 알린다(어두운 바탕이 그것을
    // 듣는다). 이 상자에는 `window` 가 없어서 **진짜 코드가 그 줄에서 죽었다.**
    //
    // 알림을 **버리지 않고 모아 둔다** — 「무엇을 알렸나」도 이 시험이 볼 수 있는
    // 사실이 된다. 비워 두면 다음에 그 줄이 사라져도 아무도 모른다.
    window: {
      dispatchEvent: (e) => { 상태.알림.push(e); return true },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
    audioRef: 상태.audioRef,
    clockRef: 상태.clockRef,
    offsetRef: { current: 0 },
    setCue: (c) => { 상태.cue = c },
    setIdx: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(`${꺼내기('onCue')}\n${꺼내기('onAttach')}\n;globalThis.__ = { onCue, onAttach };`, sandbox)
  return { 상태, ...sandbox.__ }
}

// 보내는 쪽이 **어느 순서로** 쏘는지 소스에서 읽는다.
function 보내는순서() {
  const src = 읽기('src', 'components', 'broadcast', 'VideoPlayer.jsx')
  const i = src.indexOf('const 자막붙이기 = async')
  assert.notEqual(i, -1, '자막붙이기 를 못 찾았다 — 이 가드를 옮길 것')
  const 본문 = src.slice(i, src.indexOf('\n  }', i))
  const cue = 본문.indexOf('carecast:caption-cue')
  const attach = 본문.indexOf('carecast:caption-attach')
  assert.ok(cue > 0 && attach > 0, 'cue·attach 중 하나를 안 쏜다')
  return { cue, attach, 본문 }
}

test('영상 자막은 cue 를 **먼저**, attach 를 나중에 쏜다 — 거꾸로면 실측 시계를 버린다', () => {
  const { cue, attach } = 보내는순서()
  assert.ok(cue < attach,
    'attach 를 먼저 쏜다 — 그 다음 cue 가 audioRef 를 초기화해 추정 시계로 떨어진다.\n'
    + '  증상: 탐색·배속을 바꾸면 자막이 따로 가는데, 화면에는 자막이 나오므로 고장으로 안 보인다.')
})

test('두 쪽을 실제로 이어 보면 영상 요소가 붙어 있다 (배선 시험)', () => {
  const { 상태, onCue, onAttach } = 받는쪽()
  const 영상 = { currentTime: 50, paused: false }
  const cues = { lines: [{ s: 0, e: 10, t: '가' }] }

  // 지금 코드가 쏘는 순서 그대로.
  onCue({ detail: { kind: 'video', cues, leadMs: 0 } })
  onAttach({ detail: { audio: 영상, offsetMs: 450 } })

  assert.equal(상태.audioRef.current, 영상,
    '영상 요소가 안 붙었다 — 자막이 추정 시계로 돈다(탐색·배속과 어긋난다)')
  assert.ok(상태.cue, 'cue 가 안 세워졌다')
})

test('[변이] 순서를 거꾸로 하면 요소가 떨어진다 — 이 시험이 그 순서를 실제로 본다', () => {
  const { 상태, onCue, onAttach } = 받는쪽()
  const 영상 = { currentTime: 50, paused: false }
  const cues = { lines: [{ s: 0, e: 10, t: '가' }] }

  onAttach({ detail: { audio: 영상, offsetMs: 450 } })
  onCue({ detail: { kind: 'video', cues, leadMs: 0 } })

  assert.equal(상태.audioRef.current, null,
    '거꾸로 쏴도 요소가 남아 있다 — 받는 쪽이 바뀌었다면 위 시험의 뜻도 다시 볼 것')
})

// 두 번째 지적: 조회가 비동기라 그 사이에 정지·교체가 있으면 늦게 온 응답이 자막을 되살린다.
// UX-17 이 열네 판 끈 그 모양(취소 토큰 없는 비동기)을 자막에서 또 만들었다.
test('자막 조회가 끝날 때 영상이 그대로인지 본다 — 늦게 온 응답이 되살리지 못한다', () => {
  const { 본문 } = 보내는순서()
  assert.match(본문, /const 세대 = \(자막세대Ref\.current \+= 1\)/,
    '조회 전에 세대를 찍지 않는다 — 정지 뒤에 온 응답을 가릴 방법이 없다')
  assert.match(본문, /if \(세대 !== 자막세대Ref\.current \|\| videoRef\.current !== videoEl\) return/,
    '조회 뒤에 세대·요소를 안 견준다 — 지워진 자막이 되살아난다')
  // 요소까지 견뎌야 한다 — 세대만 보면 같은 번호로 다른 요소가 들어온 경우를 놓친다.
  assert.match(본문, /videoRef\.current !== videoEl/, '요소를 안 견준다')
})

test('자막을 걷는 자리가 곧 세대를 올리는 자리다 — 한쪽만 하면 사고가 돌아온다', () => {
  const src = 읽기('src', 'components', 'broadcast', 'VideoPlayer.jsx')
  // `caption-end` 를 쏘는 자리마다 그 근처에서 번호를 올려야 한다.
  const 줄 = src.split(/\r?\n/)
  const 걷는줄 = []
  줄.forEach((l, i) => { if (l.includes('carecast:caption-end')) 걷는줄.push(i) })
  assert.ok(걷는줄.length >= 2,
    `자막을 걷는 자리가 ${걷는줄.length}곳이다 — 정지·종료 둘 다 있어야 한다`)
  // **앞뒤를 같이 본다.** 올리고 걷는 순서도 있고(새 영상), 걷고 올리는 순서도 있다(정지).
  // 어느 쪽이든 한 묶음이면 된다 — 순서를 강제하면 뜻 없는 규칙이 하나 늘 뿐이다.
  for (const i of 걷는줄) {
    const 근처 = 줄.slice(Math.max(0, i - 5), i + 5).join(' ')
    assert.match(근처, /자막세대Ref\.current \+= 1/,
      `${i + 1}번째 줄에서 자막을 걷는데 세대를 안 올린다 — 그 전에 나간 조회가 되살린다`)
  }
  // 언마운트에서도 올린다 — 그 자리는 caption-end 를 안 쏘지만(그릴 화면이 없다)
  // 돌아온 조회가 전역 이벤트를 쏘면 다음 화면의 자막을 흔든다.
  const 정리 = 줄.findIndex(l => l.includes("window.removeEventListener('carecast:video-play'"))
  assert.ok(정리 > 0, '언마운트 정리를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(줄.slice(정리 - 4, 정리 + 1).join(' '), /자막세대Ref\.current \+= 1/,
    '언마운트가 세대를 안 올린다')
})

// ── 2026-09-12 (Codex UX-09-R11) ──────────────────────────────────────────
//
// ① **새 영상이 오는 것도 교체다.** 앞 영상의 자막 조회가 오는 중일 수 있는데, `<video>`
//    요소는 같은 노드가 다시 쓰이므로 **요소 비교만으로는 못 가른다** — 세대를 `onPlay`
//    에서 올려야 비로소 갈린다. 안 올리면 앞 영상의 자막이 새 영상 위에 뜬다.
test('새 영상이 오면 세대를 올리고 앞 자막을 걷는다', () => {
  const src = 읽기('src', 'components', 'broadcast', 'VideoPlayer.jsx')
  const i = src.indexOf('const onPlay = (e) => {')
  assert.notEqual(i, -1, 'onPlay 를 못 찾았다 — 이 가드를 옮길 것')
  const 본문 = src.slice(i, src.indexOf('\n    }', i))
  assert.match(본문, /자막세대Ref\.current \+= 1/,
    'onPlay 가 세대를 안 올린다 — 앞 영상의 자막 조회가 돌아와 새 영상 위에 뜬다')
  assert.match(본문, /carecast:caption-end/,
    'onPlay 가 앞 자막을 안 걷는다 — 새 자막이 준비되기 전까지 앞 글자가 남는다')
})

// ② **일시정지하면 자막도 멈춘다.** 예전에는 `!audio.paused` 를 같이 봐서, 멈추면 자막이
//    실제 위치를 버리고 추정 시계로 갈아타 혼자 흘러갔다 — 멈춘 화면 위로 글자가 지나간다.
//    영상에는 사람이 누르는 일시정지 단추가 있어 이 길이 늘 열려 있다.
test('요소가 붙어 있으면 멈춰 있어도 그 위치를 본다 — 추정으로 갈아타지 않는다', () => {
  const src = 읽기('src', 'components', 'broadcast', 'BroadcastCaption.jsx')
  const i = src.indexOf('const tick = () => {')
  assert.notEqual(i, -1, 'tick 을 못 찾았다 — 이 가드를 옮길 것')
  const 본문 = src.slice(i, i + 900)
  assert.match(본문, /if \(audio\) \{/,
    '요소가 있어도 다른 조건을 더 본다 — 멈추면 자막이 혼자 흘러간다')
  assert.ok(!/if \(audio && !audio\.paused\) \{/.test(본문),
    'paused 를 아직 본다 — 일시정지하면 자막이 추정 시계로 갈아탄다')
  // 긍정 앵커 — 추정 시계는 **요소가 없을 때**의 것으로 남아 있어야 한다.
  assert.match(본문, /\} else if \(clockRef\.current\) \{/,
    '추정 시계 갈래가 사라졌다 — 원격 PC·직원 폰은 그것으로 돈다')
})

test('계기판이 멈춘 상태를 "추정"이라고 하지 않는다 — 재는 사람이 오해한다', () => {
  const src = 읽기('src', 'components', 'broadcast', 'BroadcastCaption.jsx')
  assert.match(src, /audio \? \(audio\.paused \? '실측\(멈춤\)' : '실측'\) : '추정'/,
    '멈춘 실측을 "추정"으로 찍는다 — 싱크를 재는 도구가 거짓을 말한다')
})
