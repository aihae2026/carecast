// 흐름 TTS 도 실제 종료를 기다린다 (P-50, 2026-09-10).
//
// **무엇이 문제였나**: 이 저장소는 2026-08-31 에 "글자수 추정 대기 → 실제 종료 감지"를 이미
// 풀었다(CC-033, `test/tts-real-end.test.js`). 자동방송 TTS·흐름의 음원·영상이 전부 그 길을
// 쓰는데 **흐름 TTS 한 곳만** 토큰을 안 실어 보냈다. 화면이 보내 준 종료 신호는 등록한 사람이
// 없어 그대로 버려졌고, 흐름은 무조건 추정만큼 잤다.
//
// 추정식이 둘이라 더 나빴다 — 흐름은 `len*180+1500`, 자동방송은 `len/4.5초+3000`(하한 6초).
// 20자면 5,100ms 대 8,000ms 라 **흐름이 먼저 다음 단계로 넘어간다.** 실제 종료를 보게 되면
// 그 차이가 대부분 사라진다(추정은 상한으로만 남는다).
//
// **이 검사는 흐름의 진짜 실행 경로(`runStep`)를 부른다.** 소스에 문자열이 있는지만 보면
// 그 줄을 무력화하는 변이가 살아남는다 — 오늘만 그 실패를 세 번 했다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_flow_ttsend_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// SSE 는 가로챈다 — 흐름이 화면에 무엇을 실어 보내는지가 이 검사의 관찰 지점이다.
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

// 진짜 합성은 타지 않는다 — 보는 것은 대기 방식이지 음성이 아니다.
const fakeTTS = async () => {
  const f = path.join(os.tmpdir(), `carecast_flowtts_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`)
  fs.writeFileSync(f, 'x')
  return f
}
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts, generateTTS: fakeTTS, generateTTSWithRetry: fakeTTS,
  },
}

const { initDB, getDB } = require('../db/schema')
const flow = require('../services/flowRunner')
const { notifyAudioEnded, cancelCurrentBroadcast } = require('../services/broadcastGate')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const 마지막TTS = () => [...sent].reverse().find((e) => e.type === 'scheduled_broadcast')
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms))
const TTS단계 = (content, label = '흐름 안내') =>
  ({ step_type: 'tts', label, config: { content } })

test('흐름 TTS 신호에 재생 토큰이 실린다 — 화면이 끝을 알려줄 주소', async () => {
  sent.length = 0
  const p = flow.runStep(getDB(), TTS단계('안녕하세요.'))
  await 잠깐(80)
  const ev = 마지막TTS()
  assert.ok(ev, 'scheduled_broadcast 신호가 안 나갔다')
  assert.ok(ev.payload.token, '토큰이 없으면 화면이 끝을 알려줄 방법이 없다 — 신호가 버려진다')
  notifyAudioEnded(ev.payload.token)
  await p
})

test('화면이 끝을 알리면 추정을 안 기다리고 바로 다음 단계로 간다', async () => {
  sent.length = 0
  const text = '가'.repeat(300)   // 흐름 추정식으로 54초가 넘는 문장
  const 시작 = Date.now()
  const p = flow.runStep(getDB(), TTS단계(text))
  await 잠깐(80)
  notifyAudioEnded(마지막TTS().payload.token)
  await p
  const 걸린 = Date.now() - 시작
  assert.ok(걸린 < 3000,
    `실제 종료를 안 기다렸다 — ${걸린}ms 걸렸다(추정이었으면 54초+). 화면 신호가 버려진다`)
})

test('[안전망] 아무도 끝을 안 알리면 추정 상한에 스스로 넘어간다', async () => {
  // 현장 PC 화면이 안 떠 있거나 자동재생이 막힌 경우. 영영 멈추면 그 방송이 통째로 죽는다.
  sent.length = 0
  const 시작 = Date.now()
  await flow.runStep(getDB(), TTS단계('짧게.'))
  const 걸린 = Date.now() - 시작
  const 상한 = flow.estimateTtsDurationMs('짧게.')
  assert.ok(걸린 >= 상한 - 500, `상한보다 빨리 끝났다 (${걸린}ms < ${상한}ms) — 안전망이 사라졌다`)
  assert.ok(걸린 < 상한 * 2, `상한을 넘겼다 (${걸린}ms) — 상한은 추정 그대로여야 한다`)
})

test('정지되면 CANCELLED 를 돌려준다 — 남은 단계를 새 방송 위에 얹지 않는다', async () => {
  sent.length = 0
  const p = flow.runStep(getDB(), TTS단계('가'.repeat(300)))
  await 잠깐(80)
  assert.ok(마지막TTS()?.payload?.token, '토큰이 안 실렸다 — 이 검사의 앵커가 무너졌다')
  cancelCurrentBroadcast()
  const 결과 = await p
  assert.equal(결과, flow.CANCELLED,
    '정지했는데 흐름이 계속 간다 — 남은 단계가 새 방송 위에 얹힌다')
})

test('앵커 도달은 흐름을 통째로 멈추지 않는다 — 건너뜀은 runFlow 의 일이다', async () => {
  // isCancelled 는 **앵커 도달까지** 포함한다(runFlow 의 클로저가 cutShort 를 세운다).
  // 그것을 CANCELLED 로 올리면 다음 예약 시각으로 건너뛰어야 할 흐름이 통째로 죽는다.
  sent.length = 0
  let 앵커도달 = false
  // 짧은 문장을 쓴다. 앵커로 깨어나면 `waitForMediaEnd` 의 진 쪽(상한 타이머)이 안 걷혀
  // 그 시간만큼 프로세스가 남는다 — 긴 문장을 쓰면 이 파일 하나가 55초를 끈다.
  // 그 정리 누락 자체는 이번 자물쇠 밖이라 ISSUES.md 의 P-50 절에 적어 두었다.
  const p = flow.runStep(getDB(), TTS단계('가'.repeat(20)), { isCancelled: () => 앵커도달 })
  await 잠깐(80)
  앵커도달 = true
  const 결과 = await p
  assert.notEqual(결과, flow.CANCELLED,
    '앵커 건너뜀이 흐름 전체 중단이 됐다 — 남은 단계가 사라진다(CC-047 반대편)')
})

test('추정식은 그대로다 — 상한을 건드리지 않는 것이 이 변경의 전제다', () => {
  // 손으로 적는다. 구현에서 가져오면 식을 바꾸는 변이가 기대값까지 데려간다.
  assert.equal(flow.estimateTtsDurationMs('가'.repeat(20)), 20 * 180 + 1500)
  assert.equal(flow.estimateTtsDurationMs(''), 1500 + 1500, '빈 문자열도 하한이 있다')
})
