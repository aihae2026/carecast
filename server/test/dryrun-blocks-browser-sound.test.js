'use strict'
// **드라이런이 브라우저 소리도 막는다** (P-15, 2026-09-11).
//
// [FACT] EV-004066·EV-004068 재현:
//   · `CARECAST_NO_HARDWARE=1` 은 **서버 스피커만** 막는다(`hardwareMode` 가드 6곳)
//   · 그런데 예약 6유형 중 **차임 하나만** 서버 스피커이고 나머지 다섯은 **브라우저가 낸다**
//     (`useScheduledBroadcast.js:336` 의 `new Audio(objUrl)`)
//   · 서버는 "지금은 검수 모드" 를 **화면에 알리지 않고**(라우트·SSE 에 참조 0건),
//     화면도 **그것을 모른다**(`src` 전체에 참조 0건)
//
// 그래서 검수 중 예약 시각이 지나가면 **검수 PC 스피커에서 진짜 소리가 난다.**
// PROJECT_PROFILE §1-2 의 "제외 표" 가 그래서 생겼고, §1-3 이 고치는 방향을 적어 뒀다:
// *"서버가 브라우저에 '지금은 검수 모드' 를 내려보내 재생을 건너뛰게 하는 것"*.
//
// ── 왜 `broadcastSSE` 한 곳인가 ──────────────────────────────────────────
//
// 소리를 내는 화면이 여럿이다(예약 TTS·녹음 음원·영상·유튜브 BGM·차임). **화면마다 막으면
// 곧 하나를 빠뜨린다** — 이 저장소가 여러 번 겪은 모양이다(FP-0005). 서버에서 쏘는 자리는
// `broadcastSSE` **하나**이므로(`sse.js:186`) 거기서 한 번 막는다.
//
// **통째로 막으면 안 된다.** 그러면 화면 갱신·경보·상태 동기화까지 죽어서 검수가 아무것도
// 못 본다. **소리를 내는 이벤트만** 고른다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

test('소리 내는 이벤트 목록이 hardwareMode 한 곳에 있다', () => {
  const { 소리이벤트 } = require(path.join(ROOT, 'server/services/hardwareMode'))
  assert.ok(소리이벤트 instanceof Set, '소리 내는 이벤트 목록이 없다')
  // 예약 6유형이 쓰는 것 — 하나라도 빠지면 그 유형만 검수 중에 소리가 난다
  // **`tts_speak` 는 여기서 뺐다**(Codex 재검수 2026-09-11). 처음엔 "서버 스피커 TTS 의
  // 시작·끝" 이라는 이름만 보고 넣었는데, 수신부를 읽으니 **덕킹 알림**이다 —
  // `useScheduledBroadcast.js` 가 `carecast:broadcast-tts-start/end` 로 바꿔 BGM 음량만
  // 조절한다. 실소리는 서버 스피커가 내고 그쪽은 `audioQueue` 가 이미 reject 한다.
  // 기대를 구현에 맞춘 것이 아니라, **수신부라는 독립 근거로** 처음 기대가 틀렸음을 확인한 것이다.
  // 아래 별도 검사가 그 근거를 소스 대조로 고정한다.
  for (const e of ['scheduled_broadcast', 'prayer_play', 'prayer_schedule_play',
                   'video_play', 'bgm_start', 'chime_play',
                   'morning_video_start']) {
    assert.ok(소리이벤트.has(e), `'${e}' 가 목록에 없다 — 그 유형만 검수 중에 소리가 난다`)
  }
})

test('**소리를 안 내는 이벤트는 막지 않는다** — 검수가 화면을 볼 수 있어야 한다', () => {
  const { 소리이벤트 } = require(path.join(ROOT, 'server/services/hardwareMode'))
  for (const e of ['now_playing', 'broadcast_started', 'broadcast_completed',
                   'system_alert', 'sound_owner', 'volume_change', 'favorites_updated',
                   'schedules_updated', 'server_update', 'broadcast_step', 'caption_sync']) {
    assert.ok(!소리이벤트.has(e),
      `'${e}' 까지 막으면 검수 중 화면이 아무것도 못 본다 — 소리가 아니라 표시다`)
  }
})

// **이름만 보고 목록에 넣지 않는다** — 수신부를 읽고 넣는다 (Codex 독립 검수 2026-09-11).
//
// 처음 목록을 지을 때 `youtube_bgm`·`bgm_set_timer` 를 **이름이 BGM 이라서** 넣었다.
// 수신부를 읽으니 둘 다 소리를 시작하지 않는다 — 하나는 표시, 하나는 **정지 타이머**다.
// 막아 두면 검수 중 화면이 남의 PC 재생 상태를 못 받고, **BGM 이 안 꺼진다.**
// 소리를 안 나게 하려다 **소리를 못 끄게** 만든 것이다.
test('표시용 동기화와 정지 타이머는 소리가 아니다 — 수신부 근거', () => {
  const { 소리이벤트 } = require(path.join(ROOT, 'server/services/hardwareMode'))

  // ① (다른 PC 재생 상태 **표시** 이벤트는 2026-09-21 외부 동영상 연동째 걷어냈다.)
  assert.ok(!소리이벤트.has('youtube_bgm'), '걷어낸 표시 이벤트가 목록에 남았다')

  // ② bgm_set_timer — 재생기(MusicPlayer)가 받아 타이머를 걸고, 시간이 지나면 **정지**한다.
  //    **소리를 시작하는 게 아니라 끝내는 쪽**이다.
  const MP = fs.readFileSync(path.join(ROOT, 'src/components/easy/MusicPlayer.jsx'), 'utf8')
  const m = /es\.addEventListener\('bgm_set_timer',([\s\S]*?)\n {4}\}\)/.exec(MP)
  assert.ok(m, 'bgm_set_timer 처리기를 못 찾았다 — 이 근거를 다시 세울 것')
  assert.match(m[1], /stopBGM\(\)/, 'bgm_set_timer 가 정지를 안 한다 — 판단 근거가 바뀌었다')
  assert.doesNotMatch(m[1], /new Audio|\.play\(/, 'bgm_set_timer 가 재생을 건다 — 다시 막아야 한다')
  assert.ok(!소리이벤트.has('bgm_set_timer'),
    "'bgm_set_timer' 는 정지 타이머다. 막으면 드라이런 중 BGM 이 **영영 안 꺼진다**")
})

// **이벤트 이름만으로는 못 가르는 것이 있다** (Codex 재검수 2026-09-11).
//
// (예전의 원격 재생 명령이 **한 이벤트에 시작과 정지를 같이** 실었다 — payload 의 `action` 이
// `play` 면 틀고 `stop` 이면 껐다. 그 이벤트는 2026-09-21 걷어냈지만 **규칙은 남긴다**.)
// 이름으로 통째로 막으면 **정지 명령까지 막혀서 BGM 이 안 꺼진다** — 방금 `bgm_set_timer`
// 에서 고친 것과 **같은 실패를 같은 목록 안에서 한 번 더** 한 것이다.
// 그래서 판단을 `소리내는가(event, data)` 한 곳으로 모은다.
test('한 이벤트에 시작과 정지가 같이 타면 action 으로 가른다', () => {
  const hm = require(path.join(ROOT, 'server/services/hardwareMode'))
  assert.equal(typeof hm.소리내는가, 'function',
    '판단 창구가 없다 — 부르는 쪽마다 action 을 다시 해석하면 곧 갈린다')

  // 소리 이벤트에 `action` 을 실어 오면 그것으로 가른다(이름이 같아도 정지는 통과).
  assert.equal(hm.소리내는가('bgm_start', { action: 'play' }), true,
    '재생 명령을 안 막는다 — 검수 중 진짜 소리가 난다')
  assert.equal(hm.소리내는가('bgm_start', { action: 'stop' }), false,
    '정지 명령까지 막는다 — 드라이런 중 BGM 이 영영 안 꺼진다')

  // action 이 없으면 예전처럼 이름으로 판단한다(하위 호환) — 다른 소리 이벤트는 그대로.
  assert.equal(hm.소리내는가('scheduled_broadcast', { title: 'x' }), true, '예약 TTS 를 안 막는다')
  assert.equal(hm.소리내는가('system_alert', { message: 'x' }), false, '표시용까지 막는다')
  assert.equal(hm.소리내는가('bgm_start', undefined), true,
    'action 을 모르면 **막는 쪽**이 안전하다 — 모르면 소리가 날 수 있다고 본다')
})

// **세 번째다.** `bgm_set_timer`(정지 타이머) → `yt_bgm_command`(정지 명령) → 이제
// `tts_speak`(덕킹 종료). 셋 다 **이름만 보고 목록에 넣은 뒤 수신부를 읽으니 소리가 아니었다.**
// 같은 실패를 세 번 했으므로 이번엔 규칙을 코드에 남긴다 — `소리내는가` 가 `action` 뿐 아니라
// `state` 도 보고, 아래 검사가 "이 목록에 넣기 전에 수신부를 읽었다" 를 증거로 요구한다.
test('tts_speak 는 소리가 아니라 덕킹 알림이다 — 수신부 근거', () => {
  const hm = require(path.join(ROOT, 'server/services/hardwareMode'))

  // 수신부: `{state}` 를 받아 **덕킹 이벤트로만** 바꾼다. `new Audio` 도 `.play()` 도 없다.
  const HK = fs.readFileSync(path.join(ROOT, 'src/hooks/useScheduledBroadcast.js'), 'utf8')
  const m = /if \(type === 'tts_speak'\)([\s\S]*?)\n {6}\}/.exec(HK)
  assert.ok(m, 'tts_speak 처리기를 못 찾았다 — 이 근거를 다시 세울 것')
  assert.match(m[1], /broadcast-tts-(start|end)/, '덕킹 이벤트를 안 쏜다 — 판단 근거가 바뀌었다')
  assert.doesNotMatch(m[1], /new Audio|\.play\(/, 'tts_speak 가 재생을 건다 — 다시 막아야 한다')

  // **실소리는 서버 스피커가 낸다**(`routes/tts.js` 의 audioQueue). 그쪽은 드라이런에서
  // 이미 reject 된다 — 여기서 또 막을 이유가 없고, 막으면 **덕킹이 안 풀린다.**
  assert.ok(!hm.소리이벤트.has('tts_speak'),
    "'tts_speak' 는 덕킹 상태 알림이다. 막으면 BGM 이 작아진 채로 굳는다")
})

test('시작·종료를 한 이벤트로 나르면 종료는 통과시킨다 — action 과 state 둘 다 본다', () => {
  const hm = require(path.join(ROOT, 'server/services/hardwareMode'))
  // `action` 계약
  assert.equal(hm.소리내는가('prayer_play', { action: 'stop' }), false)
  // `state` 계약 — 이 저장소에는 `{state:'start'|'end'}` 를 쓰는 자리가 있다(tts_speak).
  // 지금 tts_speak 는 목록에서 빠졌지만, **다음에 state 를 쓰는 소리 이벤트가 생겨도**
  // 같은 실패를 되풀이하지 않게 규칙을 남긴다.
  assert.equal(hm.소리내는가('scheduled_broadcast', { state: 'end' }), false,
    "끝났다는 알림까지 막는다 — 소리를 못 끄게 만드는 쪽이 이 목록의 가장 나쁜 실패다")
  assert.equal(hm.소리내는가('scheduled_broadcast', { state: 'start' }), true,
    '시작 알림을 통과시킨다 — 검수 중 진짜 소리가 난다')
})

test('게이트가 payload 까지 받는다 — 실제로 호출해 본다', () => {
  const 이전 = process.env.CARECAST_NO_HARDWARE
  const ssePath = require.resolve(path.join(ROOT, 'server/services/sse'))
  delete require.cache[ssePath]
  process.env.CARECAST_NO_HARDWARE = '1'
  try {
    const sse = require(ssePath)
    const hm = require(path.join(ROOT, 'server/services/hardwareMode'))
    sse.setSoundGate((e, d) => hm.hardwareDisabled() && hm.소리내는가(e, d))
    const 받은 = []
    sse.addClient({ writeHead() {}, write: (s) => { 받은.push(s); return true }, on() {}, end() {} }, null, 'TAB-ACT')
    받은.length = 0

    sse.broadcastSSE('bgm_start', { action: 'play', files: [] })
    assert.equal(받은.length, 0, '드라이런인데 BGM 시작이 나갔다')

    sse.broadcastSSE('bgm_start', { action: 'stop' })
    assert.ok(받은.length > 0, '정지 명령을 막았다 — BGM 이 영영 안 꺼진다')
  } finally {
    if (이전 === undefined) delete process.env.CARECAST_NO_HARDWARE
    else process.env.CARECAST_NO_HARDWARE = 이전
    delete require.cache[ssePath]
  }
})

test('드라이런이면 소리 이벤트가 안 나간다 — 실제로 호출해 본다', () => {
  const 이전 = process.env.CARECAST_NO_HARDWARE
  const ssePath = require.resolve(path.join(ROOT, 'server/services/sse'))
  delete require.cache[ssePath]
  process.env.CARECAST_NO_HARDWARE = '1'
  try {
    const sse = require(ssePath)
    // **배선은 밖에서 한다** — `sse.js` 는 순수 전송 계층이라 스스로 판단하지 못한다
    // (`route-wiring.test.js` 가 그것을 고정한다). 운영에서는 `routes/events.js` 가 넣는다.
    const hm = require(path.join(ROOT, 'server/services/hardwareMode'))
    sse.setSoundGate((e) => hm.hardwareDisabled() && hm.소리이벤트.has(e))
    const 받은 = []
    // `addClient(res, req, tabId)` — 실제 계약이다. `writeHead` 와 `on` 도 부른다.
    const 가짜클라 = { writeHead() {}, write: (s) => { 받은.push(s); return true }, on() {}, end() {} }
    sse.addClient(가짜클라, null, 'TAB-TEST')
    받은.length = 0                      // 접속 직후 heartbeat 는 세지 않는다

    sse.broadcastSSE('scheduled_broadcast', { title: '시험' })
    assert.equal(받은.length, 0, '드라이런인데 소리 이벤트가 나갔다 — 검수 PC 스피커에서 소리가 난다')

    sse.broadcastSSE('system_alert', { message: '시험' })
    assert.ok(받은.length > 0, '소리가 아닌 이벤트까지 막았다 — 검수가 화면을 못 본다')
  } finally {
    if (이전 === undefined) delete process.env.CARECAST_NO_HARDWARE
    else process.env.CARECAST_NO_HARDWARE = 이전
    delete require.cache[ssePath]
  }
})

test('막았다는 사실을 남긴다 — 조용히 삼키지 않는다', () => {
  // **조용히 버리면 "왜 소리가 안 나지" 를 아무도 못 찾는다.** 이 저장소의 원칙이다
  // (`audioQueue` 가 같은 이유로 reject 한다 — CC-008 delivery-truth).
  const SRC = fs.readFileSync(path.join(ROOT, 'server/services/sse.js'), 'utf8')
  const m = /function broadcastSSE\(event, data\)([\s\S]*?)\n\}/.exec(SRC)
  assert.ok(m, 'broadcastSSE 를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /console\.log/, '막은 사실을 로그에 안 남긴다')
  // **이 파일은 아무 모듈도 require 하지 않는다**(배선도 ③) — 판단은 밖에서 넣는다
  assert.match(SRC, /function setSoundGate\(fn\)/, '판단을 밖에서 넣을 자리가 없다')
  assert.ok(!/require\(/.test(SRC), 'sse.js 가 모듈을 require 한다 — 순수 전송 계층이 깨진다')
  const EV = fs.readFileSync(path.join(ROOT, 'server/routes/events.js'), 'utf8')
  assert.match(EV, /setSoundGate\(/, '배선하는 곳이 없다 — 아무도 안 막는다')
  // 돌려주는 값이 0 이어야 부르는 쪽이 "아무도 못 받았다" 를 안다
  assert.match(m[1], /return 0/, '막고서 전달 수를 거짓으로 돌려준다')
})

test('운영에서는 그대로다 — 드라이런이 아니면 다 나간다', () => {
  const 이전 = process.env.CARECAST_NO_HARDWARE
  const 이전T = process.env.NODE_TEST_CONTEXT
  const ssePath = require.resolve(path.join(ROOT, 'server/services/sse'))
  const hmPath  = require.resolve(path.join(ROOT, 'server/services/hardwareMode'))
  delete require.cache[ssePath]; delete require.cache[hmPath]
  delete process.env.CARECAST_NO_HARDWARE
  delete process.env.NODE_TEST_CONTEXT     // 테스트 안이라 자동으로 켜져 있다 — 끄고 본다
  try {
    const sse = require(ssePath)
    const hm2 = require(path.join(ROOT, 'server/services/hardwareMode'))
    sse.setSoundGate((e) => hm2.hardwareDisabled() && hm2.소리이벤트.has(e))
    const 받은 = []
    sse.addClient({ writeHead() {}, write: (s) => { 받은.push(s); return true }, on() {}, end() {} }, null, 'TAB-TEST2')
    받은.length = 0
    sse.broadcastSSE('scheduled_broadcast', { title: '시험' })
    assert.ok(받은.length > 0, '운영인데 소리 이벤트를 막았다 — 방송이 통째로 안 나간다')
  } finally {
    if (이전 === undefined) delete process.env.CARECAST_NO_HARDWARE; else process.env.CARECAST_NO_HARDWARE = 이전
    if (이전T === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = 이전T
    delete require.cache[ssePath]; delete require.cache[hmPath]
  }
})
