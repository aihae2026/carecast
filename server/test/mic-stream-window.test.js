// 마이크 생방송 판정 창(10초)의 **행동** 확인 (레드 검증 F8, 2026-09-03).
//
// mic-stop-by-user.test.js의 사실 3은 소스에 10000이라는 글자가 있는지만 본다 —
// 경계가 어느 쪽으로 닫히는지, 청크가 한 번도 안 온 상태를 어떻게 판정하는지는
// 아무도 확인하지 않았다. 여기서는 판정 함수를 실제로 돌려 경계를 못박는다.
//
// 왜 창이 필요한가(audioPlayer.js 주석): 생방송 중이 아닌데 정지를 눌렀다고 상주
// 플레이어를 껐다 켜는 낭비를 막는다. 창이 좁아지면 말하는 중의 정지가 안 먹고,
// 넓어지면 몇 분 전에 끝난 스트림 때문에 멀쩡한 플레이어를 내린다.
//
// 이 파일은 audioPlayer를 **스텁 없이 진짜로** require한다 — hardwareMode가
// NODE_TEST_CONTEXT를 보고 외부 프로세스(상주 파이썬)를 안 띄우므로 안전하다
// (no-sound-in-tests가 그 가드를 고정한다). 스피커는 안 울린다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const player = require('../services/audioPlayer')
const { isLiveAt, STREAM_WINDOW_MS } = player.__test__ || {}

test('판정 함수가 테스트로 노출돼 있다', () => {
  assert.equal(typeof isLiveAt, 'function',
    'audioPlayer.__test__.isLiveAt이 없다 — 10초 창이 다시 인라인 계산으로 돌아가면 ' +
    '경계를 행동으로 확인할 방법이 사라진다(F8)')
  assert.equal(STREAM_WINDOW_MS, 10000,
    '창 크기가 10초가 아니다 — 바꿨다면 mic-stop-by-user.test.js 사실 3과 ' +
    'audioPlayer.js 주석의 "10초"도 함께 고칠 것')
})

test('경계: 창 안(마지막 청크 10초 이내)은 생방송, 창 밖은 아니다', () => {
  const now = 1_000_000_000
  assert.equal(isLiveAt(now - 1, now), true, '방금 청크가 왔는데 생방송이 아니라고 한다')
  assert.equal(isLiveAt(now - STREAM_WINDOW_MS, now), true,
    '정확히 10초 전 청크가 창 밖으로 판정된다 — 경계는 창 안이다(<=). ' +
    '바꾸면 10초에 한 번씩 오는 느린 스트림의 정지가 간헐적으로 안 먹는다')
  assert.equal(isLiveAt(now - STREAM_WINDOW_MS - 1, now), false,
    '10초 넘게 조용한데 생방송이라고 한다 — 끝난 스트림 때문에 상주 플레이어를 내린다')
})

test('청크가 한 번도 안 온 상태(0)는 생방송이 아니다', () => {
  assert.equal(isLiveAt(0, Date.now()), false,
    '서버가 켜진 뒤 마이크를 쓴 적이 없는데 정지가 플레이어를 내린다')
})

test('플레이어가 안 떠 있으면 stopIfStreaming은 아무것도 안 한다', () => {
  // 테스트 환경은 hardwareDisabled라 상주 플레이어가 없다 — 이때 정지를 눌러도
  // false(내린 것 없음)여야 한다. 던지거나 true를 돌려주면 정지 처리기가
  // "마이크를 끊었다"고 거짓 기록을 남긴다.
  assert.equal(player.stopIfStreaming('테스트 정지'), false)
})
