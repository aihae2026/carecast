// 자동 업데이트가 방송을 끊지 않는가 (2026-08-29 리뷰 CC-011).
//
// 예전엔 방송 중인지 확인하지 않고 process.exit(100)을 불렀다. 시퀀스 한복판에서 서버가
// 죽으면 그 방송은 통째로 사라지고, *_last_fired가 이미 찍혔으면 재발동도 안 된다.
// exit만 문제가 아니었다 — git checkout -- .로 파일이 갈리고 npm install·npm run build가
// CPU를 몇 분 잡아먹는 것도 방송 중엔 위험하다. 그래서 파괴적 단계 **전에** 막는다.
//
// autoUpdate는 main 브랜치에서만 켜지므로(개발 PC 보호) 실제 동작을 여기서 돌릴 수는 없다.
// 판정 로직을 순수 함수로 빼서 git·타이머 없이 검증한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { blockedReason, restartWhenIdle, UPDATE_LEAD_MIN } = require('../services/autoUpdate')

const at = (h, m) => new Date(2026, 7, 30, h, m)

test('방송 중이면 막는다 — 시퀀스 한복판에서 죽으면 그 방송은 사라진다', () => {
  const r = blockedReason({ playing: { broadcast: { title: '아침 종합 방송' } } })
  assert.match(r, /방송 중/)
  assert.match(r, /아침 종합 방송/, '무엇 때문에 미뤘는지 로그로 알 수 있어야 한다')
})

test('영상 재생 중이어도 막는다 — 국민체조 영상이 끊기는 것도 같은 사고다', () => {
  assert.match(blockedReason({ playing: { video: { name: '국민체조' } } }), /영상 재생 중/)
})

test('BGM만 나오는 중이면 막지 않는다 — 식사 내내 길게 돌아서 이걸로 막으면 영영 못 고친다', () => {
  assert.equal(blockedReason({ now: at(9, 30), playing: { bgm: { title: '클래식' } }, times: [] }), null)
})

test('다음 방송이 코앞이면 막는다 — build가 CPU를 잡는 것만으로 방송이 끊긴다', () => {
  const times = [{ label: '아침 종합 방송', time: '07:50' }]
  assert.match(blockedReason({ now: at(7, 45), times }), /07:50.*5분/)
  assert.match(blockedReason({ now: at(7, 36), times }), /14분/, '유예 경계 안쪽')
  assert.equal(blockedReason({ now: at(7, 34), times }), null, '16분 남았으면 지나간다')
})

test('이미 지난 시각은 막지 않는다 — 그날 남은 방송만 본다', () => {
  assert.equal(blockedReason({ now: at(12, 0), times: [{ label: '아침', time: '07:50' }] }), null)
})

test('여러 방송 중 하나라도 코앞이면 막는다', () => {
  const times = [
    { label: '아침', time: '07:50' },
    { label: '점심 식사 전 방송', time: '11:15' },
    { label: '저녁 마무리', time: '18:00' },
  ]
  assert.match(blockedReason({ now: at(11, 5), times }), /점심 식사 전 방송/)
})

test('유예 기본값이 설치·빌드 시간을 감안한 값이다', () => {
  assert.ok(UPDATE_LEAD_MIN >= 10, 'npm install + build가 몇 분씩 걸린다')
})

test('재시작은 조용해질 때까지 기다린다 — 상한을 두면 결국 방송을 끊게 된다', () => {
  // 3번은 방송 중, 그 다음부터 한가함
  let calls = 0
  const reasonOf = () => (++calls <= 3 ? '방송 중("저녁 마무리")' : null)

  const exited = []
  const pending = []
  restartWhenIdle({
    reasonOf,
    exit:     (code) => exited.push(code),
    schedule: (fn) => pending.push(fn),   // 실제 1분을 기다리지 않는다
  })

  assert.deepEqual(exited, [], '방송 중인데 바로 종료하면 안 된다')
  while (pending.length && exited.length === 0) pending.shift()()

  assert.deepEqual(exited, [100], '조용해지면 종료코드 100으로 재시작한다(시작 bat이 다시 띄운다)')
  assert.equal(calls, 4, '매 시도마다 다시 확인해야 한다')
})

test('처음부터 한가하면 곧바로 재시작한다', () => {
  const exited = []
  restartWhenIdle({ reasonOf: () => null, exit: (c) => exited.push(c), schedule: () => {} })
  assert.deepEqual(exited, [100])
})

// ── P-66 — 시퀀서를 안 지나는 소리를 자동 업데이트가 못 봤다 ──────────────
//
// 무엇이 문제였나: blockedReason 이 보는 것은 playing.broadcast / playing.video /
// 다가오는 예약 시각 셋뿐이었고, autoUpdate.js 전체에 micLive·audioQueue 참조가 0건이었다
// ([FACT] EV-002607). 그런데 **마이크 생방송(routes/mic.js:37)과 즉시·비상 방송
// (routes/tts.js:154)은 enqueue 를 직접 불러 nowPlaying 을 안 건드린다.**
// 시퀀서를 안 지나는 길이라 "방송 중" 판정에서 통째로 빠졌다.
//
// 그래서 10분 주기가 비상 안내와 겹치면 git pull·빌드가 진행되고, 재시작 직전 게이트
// (restartWhenIdle)도 **같은 판정 함수를 다시 쓰므로** 못 막은 채 exit(100) 한다.
// 무대는 현장 PC 이고 대상은 화재·실종·응급 안내다.
//
// 정답은 같은 저장소에 이미 있었다 — scheduler.js:549-558 broadcastInProgress() 는
// micLive.isLive() 도 본다. 그 머리말이 이유까지 적어 뒀는데 autoUpdate 에는 안 왔다.

test('마이크 생방송 중이면 업데이트를 미룬다', () => {
  assert.match(blockedReason({ playing: { mic: true } }), /마이크/,
    '직원이 말하는 중에 서버가 재시작되면 안내가 중간에 끊긴다')
})

test('즉시·비상 방송이 서버 스피커로 나가는 중이면 미룬다', () => {
  assert.match(blockedReason({ playing: { speaker: true } }), /방송/,
    '비상방송(priority)은 enqueue 로 직접 나가서 nowPlaying 에 안 잡힌다')
})

test('둘 다 조용하면 지나간다 — 대조군', () => {
  assert.equal(blockedReason({ playing: { mic: false, speaker: false }, times: [] }), null)
  assert.equal(blockedReason({ playing: {}, times: [] }), null, '값이 없는 것을 "방송 중"으로 읽지 않는다')
})

test('시퀀서 방송이 우선이다 — 문구가 바뀌지 않는다', () => {
  assert.match(blockedReason({ playing: { broadcast: { title: '아침 종합 방송' }, mic: true } }),
    /아침 종합 방송/, '기존 메시지가 더 구체적이라 그대로 둔다')
})

test('실제 상태 수집기가 그 둘을 조회한다', () => {
  // currentBlockedReason 은 DB 를 타므로 여기서 실행하지 않는다([NOT_RUN] — 정적 근거).
  // 규칙(blockedReason)은 위에서 실행으로 덮었고, 여기서는 **수집기가 그 값을 채우는지**만 본다.
  const fs = require('node:fs')
  const src = fs.readFileSync(require.resolve('../services/autoUpdate'), 'utf8')
  const i = src.indexOf('function currentBlockedReason')
  assert.ok(i > 0, 'currentBlockedReason 을 찾지 못했다')
  const body = src.slice(i, src.indexOf('\n}', i))
  assert.match(body, /micLive/, '마이크 신호를 안 읽으면 규칙이 있어도 값이 안 들어온다')
  assert.match(body, /audioQueue/, '서버 스피커 대기열을 안 읽으면 비상방송이 그대로 빠진다')
  // 축약 표기(`{ ...get(), mic, speaker }`)도 통과해야 한다 — 형태가 아니라 **전달 여부**를 본다.
  const call = /blockedReason\(\{[\s\S]*?\}\)/.exec(body)
  assert.ok(call, 'blockedReason 호출을 찾지 못했다')
  assert.match(call[0], /\bmic\b/, 'playing 에 mic 을 안 실어 보낸다 — 규칙이 있어도 값이 안 들어온다')
  assert.match(call[0], /\bspeaker\b/, 'playing 에 speaker 를 안 실어 보낸다')
})

test('대기열이 busy 를 밖으로 알려준다', () => {
  const q = require('../services/audioQueue')
  assert.equal(typeof q.isBusy, 'function', 'isBusy 가 없으면 수집기가 물어볼 곳이 없다')
  assert.equal(q.isBusy(), false, '아무것도 안 트는 상태에서는 false 여야 한다')
})

// ── P-66 독립 검수 보완 — 수집기를 **실행**으로 검증한다 ──────────────────
//
// 검수 지적(2026-09-09): "currentBlockedReason 은 DB 를 타서 실행할 수 없다"는 내 말이 틀렸다.
// 그 함수는 export 안 됐지만 **restartWhenIdle 의 기본 reasonOf 가 바로 그것**이라
// (autoUpdate.js:149) require.cache 를 갈아끼우면 돌아간다. 이 저장소가 이미 쓰는 관례다
// (audio-queue-timeout.test.js:24-44).
//
// 실행 검증이 없으면 아래 변이 둘이 살아남는다 — 검수가 실측했다:
//   M1  `.isBusy()` 의 괄호를 뺀다  → 함수 객체가 truthy → **모든 업데이트가 영구히 막히는데**
//                                     소스 대조 테스트는 전부 초록
//   M2  catch 의 fail-closed 를 뒤집는다 → 안전 방향 자체가 아무 데도 안 고정돼 있었다
function 수집기(stubs) {
  const put = (rel, exports) => {
    const p = require.resolve(rel)
    require.cache[p] = { id: p, filename: p, loaded: true, exports }
  }
  put('../db/schema', { getDB: () => ({ prepare: () => ({ all: () => [] }) }) })
  put('../domain/autoBroadcasts', { readEnabledAutoTimes: () => [] })
  put('../services/nowPlaying', { get: () => stubs.playing || {} })
  put('../services/micLive', stubs.micLive || { isLive: () => false })
  put('../services/audioQueue', stubs.audioQueue || { isBusy: () => false })
  const exited = []
  restartWhenIdle({ exit: (c) => exited.push(c), schedule: () => {} })   // reasonOf 는 기본값 = 수집기
  return exited
}

// 같은 스텁으로 **사유 문구**를 직접 본다. 막느냐 마느냐만 보면 "왜 막았는지"가 안 잡힌다 —
// 거짓 사유로 영구히 막히는 것이 이 수정에서 제일 찾기 어려운 실패다.
function 사유(stubs) {
  수집기(stubs)   // 스텁을 같은 방식으로 심는다
  return require('../services/autoUpdate').currentBlockedReason()
}

test('수집기 실행: 조용하면 재시작한다', () => {
  assert.deepEqual(수집기({}), [100],
    'isBusy 의 괄호를 빼면 함수 객체가 truthy 라 여기서 영구히 막힌다(검수 변이 M1)')
})

test('수집기 실행: 마이크가 켜져 있으면 안 죽는다', () => {
  assert.deepEqual(수집기({ micLive: { isLive: () => true } }), [],
    '직원이 말하는 중에 프로세스가 내려가면 안내가 끊긴다')
})

test('수집기 실행: 대기열이 바쁘면 안 죽는다', () => {
  assert.deepEqual(수집기({ audioQueue: { isBusy: () => true } }), [],
    '비상방송은 enqueue 로 직접 나가서 nowPlaying 에 안 잡힌다')
})

test('수집기 실행: 조회가 실패하면 막되 거짓말은 안 한다', () => {
  // 검수 지적: 안쪽 catch 가 "모름"을 "방송 중"으로 접으면, 모듈이 사라진 날
  // 로그가 "즉시·비상 방송이 나가는 중"이라고 **거짓을 적은 채** 업데이트가 영영 안 된다.
  // 막는 결과는 같아도 그 PC 가 왜 새 버전을 안 받는지 아무도 못 찾는다.
  const r = 사유({ micLive: { get isLive() { throw new Error('모듈 없음') } } })
  assert.match(r, /확인 실패/, '못 읽은 것을 "방송 중"으로 접으면 안 된다')
  assert.match(r, /마이크 신호/, '무엇을 못 읽었는지 적어야 사람이 찾는다')
  assert.doesNotMatch(r, /마이크 생방송 중/, '거짓 사유를 적으면 안 된다')
})

test('수집기 실행: 대기열 조회 실패도 같다', () => {
  const r = 사유({ audioQueue: { get isBusy() { throw new Error('모듈 없음') } } })
  assert.match(r, /확인 실패/)
  assert.match(r, /서버 스피커 대기열/)
})

test('수집기 실행: 정상 경로의 문구는 그대로다', () => {
  assert.match(사유({ micLive: { isLive: () => true } }), /마이크 생방송 중/)
  assert.match(사유({ audioQueue: { isBusy: () => true } }), /서버 스피커/)
  assert.equal(사유({}), null)
})
