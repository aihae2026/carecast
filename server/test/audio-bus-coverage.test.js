// audioBus(소리 장부) 등록 문화를 고정한다. (TD-09 1단계, docs/td09-audiobus.md)
//
// 왜 이 가드가 있나: "지금 어떤 소리가 나고 있는지 아는 주체가 없다"가 TD-09의 출발이다.
// 소리를 내는 파일이 장부(src/lib/audioBus.js)에 등록하는 것은 **문화**라서, 새 소리
// 주체가 생길 때 등록을 빼먹으면 장부가 다시 거짓말을 시작한다 — 그리고 그 거짓말은
// 다음 "겹쳐 들려요" 신고 때에야 드러난다. 그래서 소리를 내는 파일 목록을 여기 명시하고,
// 각 파일이 audioBus를 참조하는지 검사한다. **새 소리 주체를 만들면 이 목록에 추가하고
// 그 파일에서 register/done을 배선할 것.**
//
// 고정하는 사실 셋:
//  1. 소리를 내는 파일(td09 §1의 실소리 주체) 전부가 audioBus를 import한다
//  2. audioBus 단위 동작 — 겹치면 overlaps에 남고, done 후 active가 빈다
//  3. audioBus는 어떤 인자를 줘도 던지지 않는다 — 장부 때문에 소리가 죽으면 안 된다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// ── 사실 1: 소리를 내는 파일 목록 (docs/td09-audiobus.md §1의 실소리 주체) ──────────
// 번호는 문서 §1 표의 행 번호다.
const SOUND_SOURCES = [
  'src/hooks/useScheduledBroadcast.js',                 // #1  예약·아침방송 TTS
  'src/components/easy/MusicPlayer.jsx',                // #2  로컬BGM·녹음 음원·직원멘트 (오디오 1개 3역)
  // #3~5(외부 동영상 BGM·TV 송출)는 2026-09-21 연동째 걷어냈다.
  'src/components/broadcast/VideoPlayer.jsx',           // #6·7 영상(파일)
  'src/lib/browserChime.js',                            // #8  브라우저 차임 (자체 감쇠 2.5초)
  'src/components/easy/TTSBroadcast.jsx',               // #11 TTS 미리듣기
  'src/components/easy/FavoritesBar.jsx',               // #12 아침방송 미리듣기
  'src/components/easy/ScheduledBroadcastMini.jsx',     // #14 예약 문구 미리듣기
  'src/components/admin/sections/MorningEditor.jsx',    // #15 아침방송 날씨 미리듣기
  'src/components/admin/sections/MusicManagement.jsx',  // #16 음원 파일 미리듣기
  'src/components/admin/sections/TTSSettings.jsx',      // #17 목소리 시험듣기
  'src/components/admin/sections/StepList.jsx',         // #18~20 단계·TTS·이어듣기 미리듣기
]

// 일부러 목록에 없는 곳(문서 §1·§5) — 여기 다시 넣지 말 것:
//  · src/hooks/useAudioListener.js — 서버가 청크를 릴레이하지 않아 현재 도달 불가(H14).
//    살리는 날에는 등록 배선과 함께 이 목록에 넣는다.
//  · src/components/easy/InstantBroadcast.jsx — 무음 유지 오디오(#10). 실소리는 서버 스피커.
//  · MorningVideoDisplay·MonitorPage — C군, 뮤트 표시 전용이라 소리가 없다.

test('소리를 내는 파일은 전부 audioBus에 등록한다 (td09 §1)', () => {
  for (const rel of SOUND_SOURCES) {
    const src = read(rel)
    assert.ok(/audioBus/.test(src),
      `${rel}에 audioBus 참조가 없다 — 이 파일은 소리를 내는데 장부에 등록하지 않는다. `
      + '겹침 신고가 오면 이 소리만 장부에 안 보인다. src/lib/audioBus.js의 register/done을 '
      + '배선할 것(docs/td09-audiobus.md 1단계).')
  }
})

// ── 사실 2·3: audioBus 단위 동작 ─────────────────────────────────────────────
// audioBus.js는 ESM이고 window 유무를 **호출 시점에** 본다. node 테스트에는 window가
// 없으므로 global.window를 심어 브라우저처럼 만든다. import는 URL 쿼리로 캐시를 갈라
// 각 테스트가 깨끗한 장부에서 시작한다(guide-map.test.js와 같은 동적 import 방식).
const BUS_URL = pathToFileURL(path.join(ROOT, 'src', 'lib', 'audioBus.js')).href
const loadBus = (tag) => import(`${BUS_URL}?${tag}`)

test('window가 없으면 전부 no-op — 서버 코드가 import해도 안전하다', async () => {
  delete global.window
  const bus = await loadBus('nowin')
  const reg = bus.register({ kind: 'tts', label: '안내' })
  reg.done()   // no-op 손잡이도 같은 모양이라 호출부가 구분할 필요 없다
  assert.deepEqual(bus.snapshot(), { active: [], overlaps: [] })
})

test('겹쳐 등록하면 overlaps에 남고, done 후 active가 빈다', async () => {
  global.window = {}
  try {
    const bus = await loadBus('unit')
    const tts = bus.register({ kind: 'tts', label: '점심 안내' })
    const bgm = bus.register({ kind: 'bgm-local', label: '가요무대' })

    const snap = bus.snapshot()
    assert.equal(snap.active.length, 2, '둘 다 활성으로 보여야 한다')
    assert.equal(snap.overlaps.length, 1, '두 번째 등록이 겹침으로 기록돼야 한다')
    assert.equal(snap.overlaps[0].시작한것.kind, 'bgm-local')
    assert.deepEqual(snap.overlaps[0].그때활성목록, [{ kind: 'tts', label: '점심 안내' }])
    assert.ok(snap.overlaps[0].시각, '겹침에는 시각이 남아야 한다 — 신고 시각과 대조하는 값이다')

    tts.done()
    bgm.done()
    bgm.done()   // 두 번 불러도 안전해야 한다 — 정지 경로가 여럿이라 중복 호출이 정상이다
    assert.equal(bus.snapshot().active.length, 0, 'done 후 활성 목록이 비어야 한다')
    assert.equal(bus.snapshot().overlaps.length, 1, '겹침 기록은 done으로 지워지지 않는다')

    // 개발자 도구 조회 창구 — 현장에서 "겹쳐 들려요" 신고를 받으면 이걸 본다
    assert.equal(typeof global.window.CC_AUDIO_BUS.snapshot, 'function')

    // 링버퍼 — 겹침 기록은 최근 50건만 남는다(무한히 쌓이면 며칠 켜둔 현장 PC 메모리를 먹는다)
    const holder = bus.register({ kind: 'tv', label: '버퍼 시험' })
    for (let i = 0; i < 60; i++) bus.register({ kind: 'chime', label: `n${i}` }).done()
    holder.done()
    assert.ok(bus.snapshot().overlaps.length <= 50, '겹침 기록이 50건을 넘게 쌓이면 안 된다')
  } finally {
    delete global.window
  }
})

test('이상한 인자를 줘도 던지지 않는다 — 장부 때문에 소리가 죽으면 안 된다', async () => {
  global.window = {}
  try {
    const bus = await loadBus('weird')
    const weird = [undefined, null, 42, 'tts', [], {}, { kind: 123 }, { kind: null, label: {} }]
    for (const arg of weird) {
      let reg
      assert.doesNotThrow(() => { reg = bus.register(arg) }, `register(${String(arg)})가 던졌다`)
      assert.equal(typeof reg.done, 'function', '어떤 인자든 같은 모양의 손잡이를 돌려줘야 한다')
      assert.doesNotThrow(() => { reg.done(); reg.done() }, 'done이 던졌다')
    }
    assert.doesNotThrow(() => bus.snapshot(), 'snapshot이 던졌다')
    assert.equal(bus.snapshot().active.length, 0)
  } finally {
    delete global.window
  }
})

// ── TD-09 3단계 첫 갈래: 미리듣기 정지 위임 ────────────────────────────────────
// 여기부터는 "장부가 소리를 세울 수 있다"는 3단계의 사실을 고정한다. 위임된 갈래는
// **미리듣기뿐**이다(kind가 'preview-'로 시작하는 것). 실제 방송의 정지는 아직 옮기지
// 않았다 — 갈래마다 사용자 승인과 소리 확인을 거친다.

test('stopKinds — 접두사로 고른 것만 세우고, 나머지는 그대로 둔다', async () => {
  global.window = {}
  try {
    const bus = await loadBus('stopkinds')
    const 세워진것 = []
    bus.register({ kind: 'preview-tts',   label: 'a', stop: () => 세워진것.push('preview-tts') })
    bus.register({ kind: 'preview-audio', label: 'b', stop: () => 세워진것.push('preview-audio') })
    bus.register({ kind: 'bgm-youtube',   label: 'c', stop: () => 세워진것.push('bgm-youtube') })
    // stop을 안 넘긴 등록(1단계 그대로) — 세울 수 없으므로 건드리지 않는다(하위호환)
    bus.register({ kind: 'preview-loop',  label: 'd' })

    const n = bus.stopKinds('preview-')
    assert.equal(n, 2, 'stop을 넘긴 preview-* 둘만 서야 한다')
    assert.deepEqual(세워진것.sort(), ['preview-audio', 'preview-tts'])

    const 남은것 = bus.snapshot().active.map(a => a.kind).sort()
    assert.deepEqual(남은것, ['bgm-youtube', 'preview-loop'],
      '세운 것은 장부에서 빠지고, 실제 방송 소리(bgm-youtube)는 그대로 남아야 한다 — '
      + '미리듣기 갈래만 위임했다')
  } finally {
    delete global.window
  }
})

test('stopKinds — 하나가 던져도 나머지를 계속 세운다', async () => {
  global.window = {}
  try {
    const bus = await loadBus('stopthrow')
    const 세워진것 = []
    bus.register({ kind: 'preview-tts',   label: 'a', stop: () => { throw new Error('고장난 정지') } })
    bus.register({ kind: 'preview-audio', label: 'b', stop: () => 세워진것.push('b') })
    bus.register({ kind: 'preview-loop',  label: 'c', stop: () => 세워진것.push('c') })

    let n
    assert.doesNotThrow(() => { n = bus.stopKinds(['preview-']) },
      'stopKinds가 던지면 실제 방송 시작 경로가 죽는다 — 이 모듈의 절대 규칙')
    assert.deepEqual(세워진것, ['b', 'c'], '던진 하나 때문에 뒤의 소리가 남으면 안 된다')
    assert.equal(n, 2, '던진 것은 세운 개수에 안 들어간다')
    assert.equal(bus.snapshot().active.length, 0, '던졌어도 장부에서는 빠진다')
  } finally {
    delete global.window
  }
})

test('stopKinds — stop이 다시 stopKinds를 불러도 무한루프에 안 빠진다', async () => {
  global.window = {}
  try {
    const bus = await loadBus('reentry')
    let 호출수 = 0
    // 화면의 "미리듣기 끄기" 함수가 다시 장부를 부르는 모양 — 방어가 없으면 무한루프다
    const 되부르는정지 = () => { 호출수++; bus.stopKinds('preview-') }
    bus.register({ kind: 'preview-tts',   label: 'a', stop: 되부르는정지 })
    bus.register({ kind: 'preview-audio', label: 'b', stop: 되부르는정지 })

    assert.doesNotThrow(() => bus.stopKinds('preview-'))
    assert.equal(호출수, 2, '각 소리의 stop은 정확히 한 번씩만 불려야 한다')
    assert.equal(bus.snapshot().active.length, 0)

    // 인자가 이상해도 던지지 않는다
    for (const arg of [undefined, null, 42, [], [null], {}, '']) {
      assert.doesNotThrow(() => bus.stopKinds(arg), `stopKinds(${String(arg)})가 던졌다`)
    }
  } finally {
    delete global.window
  }
})

// ── H3: 미리듣기는 **자기가 켠 것만** 끈다 ─────────────────────────────────────
// 예전엔 미리듣기 BGM과 실제 방송 BGM이 같은 재생기·같은 신호를 썼다. 그래서 미리듣기를 끌 때
// 조건 없이 정지 신호를 쏘면, BGM을 깐 적도 없는 미리듣기가 홀에서 흐르던 실제 방송 음악을
// 죽였다(td09 H3 — 실제로 그랬다). 2026-09-21 부터 미리듣기 BGM 은 **이 화면이 가진 오디오 하나**다
// — 끌 때도 그것만 멈추고 전역 신호는 **아예 안 쏜다.** 되살아나면 H3 가 돌아온다.
test('H3: 순서편집기 미리듣기는 제 오디오만 끈다 — 전역 정지 신호를 안 쏜다', () => {
  const src = read('src/components/admin/sections/StepList.jsx')

  const 시작 = src.match(/const startPreviewBgm = [\s\S]*?\n {2}\}/)
  assert.ok(시작, 'startPreviewBgm을 못 찾았다 — 이름이 바뀌었으면 이 가드도 같이 고칠 것')
  assert.match(시작[0], /previewBgmRef\.current\s*=\s*a/,
    '깐 오디오를 손잡이에 안 쥔다 — 그러면 끌 수가 없다')
  assert.ok(!/dispatchEvent/.test(시작[0]), '미리듣기 BGM 을 전역 신호로 깐다 — 실제 방송 재생기가 받는다')

  const 정지 = src.match(/const stopPreviewBgm = \(\) => \{[\s\S]*?\n {2}\}/)
  assert.ok(정지, 'stopPreviewBgm을 못 찾았다 — 이름이 바뀌었으면 이 가드도 같이 고칠 것')
  const 본문 = 정지[0]
  assert.ok(!/dispatchEvent/.test(본문),
    'stopPreviewBgm이 전역 정지 신호를 쏜다 — 미리듣기 버튼 하나로 실제 방송 BGM이 꺼진다(td09 H3)')
  assert.match(본문, /previewBgmRef\.current/, '제 오디오를 안 멈춘다')
})

// ── H4: 화면을 떠나면 그 화면의 미리듣기가 멎는다 ───────────────────────────────
// 미리듣기는 누른 창에서만 나는 소리다. 아무도 안 꺼주면 탭을 옮겨도 계속 나고, 사람은
// 소리가 어디서 나는지 못 찾는다. **각자 자기 것만 끈다** — 언마운트에서 전역 정지 신호나
// audioBus.stopKinds를 부르면 다른 화면에서 듣고 있던 미리듣기까지 죽는다.
const PREVIEW_SCREENS = [
  'src/components/easy/TTSBroadcast.jsx',
  'src/components/easy/ScheduledBroadcastMini.jsx',
  'src/components/admin/sections/MorningEditor.jsx',
  'src/components/admin/sections/MusicManagement.jsx',
  'src/components/admin/sections/TTSSettings.jsx',
]

test('H4: 미리듣기 화면 다섯은 언마운트에서 자기 미리듣기를 끈다', () => {
  for (const rel of PREVIEW_SCREENS) {
    const src = read(rel)
    assert.match(src, /useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>\s*\{[^}]*stopPreview\(\)/,
      `${rel}에 언마운트 정리가 없다 — 화면을 떠나도 미리듣기가 계속 난다(td09 H4). `
      + 'stopPreview()를 두고 useEffect(() => () => { stopPreview() }, [])로 정리할 것.')
    assert.ok(/const stopPreview = /.test(src),
      `${rel}에 stopPreview 손잡이가 없다 — 끌 것을 쥐고 있지 않으면 무엇도 못 멈춘다`)
    assert.ok(!/stopKinds\s*\(/.test(src),   // 주석에 이름이 나오는 것은 괜찮다 — 부르지만 말 것
      `${rel}이 audioBus.stopKinds를 부른다 — 이 화면은 **자기 것만** 꺼야 한다. `
      + '전역 정지는 다른 화면에서 듣고 있던 미리듣기까지 죽인다.')
  }
})

// ── H9: 실제 방송이 왕이다 ────────────────────────────────────────────────────
// 현장 PC(leader 창)에서 미리듣는 중에 정시 방송이 발화되면, 예전에는 미리듣기가 실제
// 방송 위에서 계속 돌았다 — 순서편집기가 방송 신호를 하나도 안 들었다.
test('H9: 순서편집기는 실제 방송의 시작·정지 신호를 듣고 비킨다', () => {
  const src = read('src/components/admin/sections/StepList.jsx')
  for (const 신호 of ['carecast:broadcast-started', 'carecast:stop-broadcast']) {
    assert.ok(src.includes(`addEventListener('${신호}'`),
      `StepList가 ${신호}를 안 듣는다 — 실제 방송 위에 미리듣기가 계속 돈다(td09 H9)`)
    assert.ok(src.includes(`removeEventListener('${신호}'`),
      `${신호} 구독을 언마운트에서 안 푼다 — 떠난 화면이 계속 깨어난다`)
  }
  assert.match(src, /stopAllPreview\(\)[\s\S]{0,200}audioBus\.stopKinds\(\['preview-'\]\)/,
    '방송이 시작되면 이 화면 미리듣기(stopAllPreview)와 장부에 남은 다른 화면 미리듣기'
    + "(stopKinds(['preview-']))가 모두 비켜야 한다")
})
