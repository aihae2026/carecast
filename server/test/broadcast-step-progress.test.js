// "지금 몇 번째 단계인가" — 방송이 도는 동안 화면이 그걸 알 수 있어야 한다.
//
// 왜 필요했나: 방송이 시작되면 화면에는 "방송 중" 넉 자뿐이다. 5분째 아무 소리가 안 날 때
// 그게 **원래 조용한 단계(6분 대기 중인 투약 안내)인지, 멈춘 것인지** 알 방법이 없다.
// 서버는 이미 단계를 하나씩 돌고 있으니 그 자리에서 한 줄만 쏘면 된다(n8n이 실행 중인
// 노드를 밝혀 주는 것과 같은 것).
//
// 여기서 고정하는 것:
//   1) 자동방송 5종은 **한 곳**(runStepGuarded)을 지난다 — 다섯 군데에 각각 쏘면 한 곳을
//      빠뜨리는 순간 그 방송만 조용해진다
//   2) 번호는 **켜진 단계 기준**이다. 꺼 둔 단계를 세면 화면이 "3/8"인데 실제로는 6단계뿐인
//      일이 생긴다
//   3) 단계 알림이 실패해도 **방송은 계속된다** — 알리려다 방송을 멈추면 본말전도다
//   4) 화면 쪽 처리기가 이 이벤트를 **앞에서 가로채야 한다**. App.jsx의 SSE 처리기는 끝단에서
//      "그 밖의 이벤트 = 예약 TTS 재생"으로 떨어지기 때문에, 새 이벤트를 그냥 목록에만
//      추가하면 현장 PC가 이 알림을 받고 오디오를 재생하려 든다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_progress_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH     = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

// SSE는 실제로 쏘지 않고 잡아 둔다 — 시퀀서가 require하기 전에 심는다
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (event, payload) => { sent.push({ event, payload }); return 1 },
    localClientCount: () => 1, localAliveCount: () => 1, clientCount: () => 1, addClient: () => {}, soundOwner: () => null,
  },
}

const seq = require('../services/broadcastSequencer')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

test('단계를 실행하면 몇 번째인지 알린다', async () => {
  sent.length = 0
  assert.equal(typeof seq.runStepGuarded, 'function',
    'runStepGuarded를 내보내야 이 알림이 한 곳에서만 나간다')

  await seq.runStepGuarded(null, null, '아침 종합 방송',
    { id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)' }, async () => {}, { index: 3, total: 8 })

  const ev = sent.find(s => s.event === 'broadcast_step')
  assert.ok(ev, 'broadcast_step 이벤트가 안 나갔다')
  assert.equal(ev.payload.title, '아침 종합 방송')
  assert.equal(ev.payload.index, 3)
  assert.equal(ev.payload.total, 8)
  assert.equal(ev.payload.stepId, 'morning_prayer')
  assert.equal(ev.payload.label, '기도·묵상 시간 음원 (선택)')
})

test('단계 시작을 먼저 알리고 그다음에 실행한다 — 6분 대기 단계도 시작 즉시 보여야 한다', async () => {
  sent.length = 0
  const order = []
  await seq.runStepGuarded(null, null, '아침 종합 방송',
    { id: 'medication_tts', label: '투약 안내' },
    async () => { order.push('실행') },
    { index: 7, total: 8 })
  const idx = sent.findIndex(s => s.event === 'broadcast_step')
  assert.ok(idx >= 0, '알림이 없다')
  assert.deepEqual(order, ['실행'])
  // 실행 전에 알림이 나갔는지 — 알림이 끝난 뒤에 나가면 6분 동안 화면이 이전 단계를 가리킨다
  assert.equal(sent[0].event, 'broadcast_step')
})

test('진행 정보를 안 주면 알리지 않는다 — 기존 호출부가 그대로 돌아간다', async () => {
  sent.length = 0
  await seq.runStepGuarded(null, null, '아침 종합 방송', { id: 'bgm' }, async () => {})
  assert.equal(sent.filter(s => s.event === 'broadcast_step').length, 0)
})

test('알림이 실패해도 방송은 계속된다', async () => {
  sent.length = 0
  const orig = require('../services/sse').broadcastSSE
  require.cache[ssePath].exports.broadcastSSE = () => { throw new Error('SSE 통로 막힘') }
  let ran = false
  try {
    await seq.runStepGuarded(null, null, '아침 종합 방송', { id: 'bgm' },
      async () => { ran = true }, { index: 1, total: 3 })
  } finally {
    require.cache[ssePath].exports.broadcastSSE = orig
  }
  assert.equal(ran, true, '알리려다 방송을 멈췄다 — 본말전도다')
})

test('단계 실행이 실패해도 알림은 이미 나가 있다 — 어디서 실패했는지가 보인다', async () => {
  sent.length = 0
  await seq.runStepGuarded(null, null, '저녁 마무리', { id: 'evening_prayer_audio', label: '기도·묵상 시간 음원 (선택)' },
    async () => { throw new Error('음원 없음') }, { index: 3, total: 8 })
  const ev = sent.find(s => s.event === 'broadcast_step')
  assert.ok(ev, '실패한 단계의 알림이 없으면 어느 단계에서 멈췄는지 모른다')
  assert.equal(ev.payload.index, 3)
})

test('자동방송 5종이 전부 진행 정보를 넘긴다 — 한 곳이라도 빠지면 그 방송만 조용하다', () => {
  // 2026-08-31 리팩터링(TD-01) 전에는 5종이 실행 골격을 각자 복사해 갖고 있어서, 이 테스트가
  // "runStepGuarded 호출이 5개인가 · 5개 전부 진행 정보를 넘기는가"를 셌다. 지금은 골격이
  // runBroadcastLane 하나뿐이라 그 셈이 성립하지 않는다. **지키려는 것은 그대로다** —
  // 한 방송만 조용해지면 안 된다. 확인 방법만 "합친 한 곳이 넘기는가 + 5종이 전부 그 한 곳을
  // 쓰는가"로 바꾼다. 이제는 한 곳만 고치면 5종에 다 걸려서 빠뜨리는 일 자체가 구조상 불가능하다.
  // (5종이 실제로 같은 순서·문구로 도는지는 fire-broadcast-skeleton.test.js가 실행으로 대조한다.)
  const src = read('server', 'services', 'broadcastSequencer.js')

  // 합친 한 곳이 단계를 부를 때 진행 정보(몇/몇)를 함께 넘기는가
  const CALL = 'runStepGuarded(db, tok, lane.title, step, () => runStep(step, tok, prep),'
  const PROGRESS = '{ index: stepNo, total: totalSteps })'
  assert.ok(src.includes(CALL),
    '공통 실행기가 단계 처리기를 부르는 모양이 바뀌었다 — 진행 정보 전달을 다시 확인할 것')
  assert.ok(src.includes(PROGRESS),
    '진행 정보(index/total)를 안 넘긴다 — 화면이 몇 번째 단계인지 못 보여준다')

  // 그리고 5종이 전부 그 한 곳을 쓰는가
  const LANES_EXPECTED = {
    fireMorningBroadcast:       'LANES.morning',
    fireExerciseBroadcast:      'LANES.exercise',
    fireLunchBroadcast:         'LANES.lunch',
    fireDinnerBroadcast:        'LANES.dinner',
    fireEveningPrayerBroadcast: 'LANES.evening_prayer',
  }
  for (const [fn, lane] of Object.entries(LANES_EXPECTED)) {
    // 시그니처에 인자가 붙어도(2026-09-01 opts) 앵커가 안 깨지게 여는 괄호까지만 본다
    const at = src.indexOf(`async function ${fn}(db`)
    assert.ok(at > 0, `${fn} 정의가 없다`)
    const head = src.slice(at, at + 200)
    assert.ok(head.includes(`return runBroadcastLane(db, ${lane},`),
      `${fn}이 공통 실행기(runBroadcastLane)를 쓰지 않는다 — 그 방송만 조용해질 수 있다`)
  }
})

test('번호는 켜진 단계만 센다', () => {
  const src = read('server', 'services', 'broadcastSequencer.js')
  // 총 개수는 enabled인 것만 세야 한다. steps.length를 그대로 쓰면 꺼 둔 단계까지 세어
  // "3/8"인데 실제로는 6단계만 도는 일이 생긴다.
  assert.ok(/filter\(s => s\.enabled\)\.length/.test(src) || /enabledSteps/.test(src),
    '켜진 단계만 세는 코드가 없다')
  assert.ok(!/total: steps\.length/.test(src), '꺼 둔 단계까지 세고 있다')
})

test('흐름(커스텀 자동순서)도 같은 알림을 낸다', () => {
  const src = read('server', 'services', 'flowRunner.js')
  assert.ok(/broadcast_step/.test(src),
    '커스텀 자동순서에서만 화면이 조용하면 사람은 그게 고장인 줄 안다')
})

test('화면 처리기가 이 이벤트를 앞에서 가로챈다 — 끝단으로 흘러가면 TTS를 재생하려 든다', () => {
  const app = read('src', 'hooks', 'useScheduledBroadcast.js')
  const i = app.indexOf("type === 'broadcast_step'")
  assert.ok(i > 0, 'useScheduledBroadcast가 broadcast_step을 처리하지 않는다')
  // 처리기 끝단(예약 TTS 재생)보다 앞에 있어야 한다
  const tail = app.indexOf('예약 방송 / 아침 방송 TTS 재생')
  assert.ok(tail > 0, 'useScheduledBroadcast의 TTS 끝단 표시를 못 찾았다 — 이 가드도 따라가야 한다')
  assert.ok(i < tail,
    'broadcast_step 처리가 끝단보다 뒤에 있다 — 현장 PC가 이 알림으로 오디오를 재생하려 든다')
  // lib/api.js의 구독 목록에도 있어야 화면이 받는다
  assert.ok(/addEventListener\('broadcast_step'/.test(read('src', 'lib', 'api.js')),
    'SSE 구독 목록에 없으면 이벤트가 화면까지 오지 않는다')
})

test('재생바가 지금 단계를 보여준다', () => {
  const bar = read('src', 'components', 'easy', 'NowPlayingBar.jsx')
  assert.ok(/carecast:broadcast-step/.test(bar), '재생바가 단계 알림을 안 듣는다')
})

test('모니터링 창도 지금 단계를 보여준다', () => {
  const mon = read('src', 'pages', 'MonitorPage.jsx')
  assert.ok(/broadcast_step/.test(mon), '모니터 창이 단계 알림을 안 듣는다')
})

// 취소로 끝난 방송은 broadcast_completed가 안 나간다(시퀀서가 취소 시 완료를 안 알린다).
// 그래서 "새 방송이 시작하면 앞 방송의 단계 표시를 지운다"가 유일한 청소 지점이다 —
// 이게 없으면 새 방송 제목 옆에 앞 방송의 "7/8 저녁 문안인사"가 그대로 붙어 있는다.
test('새 방송이 시작하면 앞 방송의 단계 표시를 지운다 — 재생바', () => {
  const bar = read('src', 'components', 'easy', 'NowPlayingBar.jsx')
  const handler = bar.slice(bar.indexOf('const onBroadcastStart'), bar.indexOf('const onBroadcastEnd'))
  assert.ok(/clearStep\(\)/.test(handler),
    '방송 시작 처리기가 단계 표시를 안 지운다 — 취소로 끝난 앞 방송의 번호가 남는다')
})

test('새 방송이 시작하면 앞 방송의 단계 표시를 지운다 — 모니터링 창', () => {
  const mon = read('src', 'pages', 'MonitorPage.jsx')
  const handler = mon.slice(mon.indexOf("on('broadcast_started'"), mon.indexOf("on('prayer_play'"))
  assert.ok(/setStep\(null\)/.test(handler),
    '모니터 창이 방송이 바뀌어도 앞 방송의 단계를 계속 가리킨다')
})
