// 모니터링 창(/monitor)은 **현장 화면을 그대로 비추되 소리는 내지 않는다.**
//
// 사용자 요청(2026-08-31): "모니터링 창은 지금 재생되고 있는 화면을 보여줘야지 미리보기창처럼."
// 그래서 이 창은 현장 PC와 같은 SSE를 받아 같은 영상·같은 방송문을 그린다. 화면을 비추는
// 순간부터 **소리가 날 수 있는 창**이 되었다는 것이 이 변경의 위험이다 — 이 창에서 소리가
// 나면 현장 방송 위에 두 번째 소리가 겹치고, 사무실에서 켜 둔 팝업 때문에 홀에서 방송이
// 두 번 들리는 것처럼 된다. 되돌리기 전에는 원인을 짐작하기 어려운 종류의 사고다.
//
// 무음은 세 겹이고, 셋 다 여기서 고정한다:
//   1) <video>는 muted (속성 + ref 양쪽 — React가 muted를 DOM에 안 실어 주는 경우가 있다)
//   2) 유튜브 임베드는 mute=1
//   3) 이름표(?tab=)를 안 보낸다 — 이름표 없는 연결은 서버가 소리 담당 후보에서 뺀다.
//      2026-09-01부터 연결은 창당 하나(lib/api의 openSSEBus)이고, 이름표를 실을지는
//      tabId.js의 CAN_OWN_SOUND가 정한다. 그래서 이 파일은 그 제외 규칙을 확인한다.
//      이름표를 붙이면 이 창이 담당으로 뽑혀 **아무도 소리를 안 낸다**(tabId.js의 CAN_OWN_SOUND).
//
// 그리고 이 창은 서버로 아무것도 보내지 않는다 — 상태 보고도, 재생 종료 신호도.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const src = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'MonitorPage.jsx'), 'utf8')

test('영상 미리보기는 muted다 — 속성과 ref 양쪽으로', () => {
  assert.ok(/<video[\s\S]*?\bmuted\b[\s\S]*?\/>/.test(src),
    '<video>에 muted가 없다 — 모니터 창에서 방송 소리가 두 번 난다')
  assert.ok(src.includes('videoRef.current.muted = true'),
    'ref로 muted를 못 박는 코드가 없다 — React가 muted 속성을 DOM에 안 실어 주는 경우가 있다')
})

// (외부 동영상 미리보기 iframe 은 2026-09-21 걷어냈다 — 이 창의 화면은 이제 <video> 하나다)
test('모니터 창은 외부 동영상 iframe 을 안 띄운다 — 영상은 이 PC 파일(<video muted>)뿐이다', () => {
  assert.ok(!/<iframe/.test(src), '걷어낸 외부 동영상 iframe 이 되살아났다')
  assert.match(src, /<video[\s\S]{0,200}muted/, '영상 미리보기가 무음이 아니다 — 현장 방송 위에 소리가 겹친다')
})

test('SSE에 이름표(tab)를 붙이지 않는다 — 붙이면 아무도 소리를 안 낸다', () => {
  // 2026-09-01: 연결을 창당 하나로 합치면서(lib/api의 openSSEBus) 이 창도 자기 EventSource를
  // 열지 않는다. 지켜야 할 것은 그대로다 — **모니터 창은 소리 담당 이름표를 보내면 안 된다.**
  // 그 판정은 이제 tabId.js의 CAN_OWN_SOUND가 하고, lib/api는 그 값이 참일 때만 이름표를 싣는다.
  // 그래서 검사하는 자리가 옮겨졌다(sse-single-connection.test.js가 lib/api 쪽을 고정한다).
  assert.ok(src.includes('openSSEBus'),
    '이 창이 실시간 이벤트에 붙지 않는다 — 화면을 비출 이벤트를 못 받는다')
  assert.ok(!src.includes('new EventSource'),
    '모니터 창이 연결을 따로 연다 — 창당 소켓이 늘어 원격에서 화면이 안 뜬다')

  const tabId = fs.readFileSync(path.join(__dirname, '../../src/lib/tabId.js'), 'utf8')
  assert.ok(tabId.includes("p !== '/monitor'"),
    'tabId.js가 /monitor를 소리 담당 후보에서 빼지 않는다 — 담당으로 뽑히면 현장에서 무음이 된다')
  // 주석에서 "initSSE를 쓰지 않는 이유"를 설명하므로 import 줄만 본다
  assert.ok(!/import[^\n]*\binitSSE\b/.test(src),
    'initSSE를 쓰면 이 창에 필요한 이벤트(prayer_play·chime_play)를 받으려고 공용 목록을 ' +
    '늘리게 되고, 그 이벤트가 App.jsx 처리기 끝단(TTS 재생)까지 흘러든다')
})

test('모니터 창은 서버로 아무것도 보내지 않는다', () => {
  for (const [needle, why] of [
    ['postNowPlaying',  '이 창이 재생 상태를 보고하면 현장 상태를 덮어쓴다'],
    ['audioEnded',      '재생 종료 신호를 보내면 흐름이 다음 단계로 넘어간다'],
    ['videoEnded',      '영상 종료 신호를 보내면 방송이 한 단계 건너뛴다'],
    ['apiPost',         '읽기 전용 창이다'],
  ]) {
    assert.ok(!src.includes(needle), `모니터 창이 ${needle}를 쓴다 — ${why}`)
  }
})

test('영상이 끝나거나 현장에서 닫히면 미리보기도 걷힌다', () => {
  assert.ok(src.includes('onEnded'), '파일 영상이 끝나도 미리보기가 남는다')
  assert.ok(src.includes('sawVideoRef'),
    '현장 보고를 본 적이 있는지 구별하지 않으면, 미리보기가 뜨자마자 걷힌다(보고 전 null과 종료 후 null이 같아 보인다)')
})

test('소리만 나는 방송 표시는 스스로 걷힌다 — 끝 신호가 없기 때문', () => {
  // 예약 TTS는 scheduled_broadcast 하나만 쏘고 끝났다는 신호가 없다(scheduler.js).
  // 상한이 없으면 다음 방송이 올 때까지 몇 시간이고 "지금 나가는 중"처럼 남는다.
  assert.ok(/SPEECH_MAX_MS\s*=/.test(src), '소리만 나는 방송 표시의 상한이 없다')
  const scheduler = fs.readFileSync(path.join(ROOT, 'server', 'services', 'scheduler.js'), 'utf8')
  const hasEnd = /broadcastSSE\('broadcast_completed'/.test(scheduler)
  assert.equal(hasEnd, false,
    '스케줄러가 예약 방송 종료를 알리게 됐다면, 이 창은 상한 대신 그 신호로 걷는 게 맞다')
})

// ── 2026-09-01: "모니터 창에 영상이 안 보인다"를 좇다가 나온 것들 ──
test('자동방송 영상은 이름을 싣고 온다 — 점심·저녁이 "아침 영상"으로 나오면 안 된다', () => {
  // 2026-09-01: stepVideoAfter 본문은 broadcastSteps.js로 옮겼다(시퀀서에서 분리)
  const seq = fs.readFileSync(path.join(ROOT, 'server', 'services', 'broadcastSteps.js'), 'utf8')
  const at = seq.indexOf("broadcastSSE('morning_video_start'")
  assert.ok(at > 0, 'morning_video_start를 보내는 자리를 못 찾았다')
  const 호출 = seq.slice(at, seq.indexOf('})', at))
  assert.ok(/\bname:/.test(호출), '이벤트에 이름이 안 실린다 — 받는 쪽이 무슨 영상인지 모른다')

  assert.ok(!src.includes("name: '아침 영상'"),
    "모니터 창이 영상 이름을 '아침 영상'으로 박아 쓴다 — 저녁 식사 중 영상도 그렇게 나온다")
})

test('실시간 연결이 끊기면 화면에 적힌다', () => {
  // 이 창은 내용을 전부 SSE로 받는다. 연결이 죽으면 멈춘 화면이 그럴듯해 보여서,
  // 표시가 없으면 "영상이 왜 안 보이지"의 원인을 창만 보고는 못 가른다(실제로 그랬다).
  assert.ok(src.includes('subscribeSSEState'), '연결 상태를 구독하지 않는다')
  assert.ok(src.includes('실시간 연결 끊김'), '끊겼을 때 화면에 적히지 않는다')
})
