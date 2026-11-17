'use strict'
// **같은 분 예약 둘이 겹치지 않는다** (P-42, 2026-09-11).
//
// [FACT] `scheduler.js:539-540` 주석이 스스로 말한다 —
//   *"진행 중 판정은 nowPlaying.broadcast — **시퀀서(broadcastStart)만 세우는 값**이라
//     정확히 '자동방송·수동재생 진행 중'이다(**흐름과 예약 자신은 여기 안 잡힌다**)"*
//
// 그래서 같은 분에 예약이 둘 있으면:
//   · `due` 배열을 `await deferOrFire` 로 순차 처리하는데(`scheduler.js:705-707`)
//   · **앞 예약이 자기가 나가는 중이라는 사실을 아무 데도 안 남긴다**
//   · 두 번째가 첫 번째를 못 보고 그대로 나간다
//   · 화면은 `useScheduledBroadcast.js:317` 에서 `audioRef.current.pause()` 로
//     **앞 소리를 끊는다** — 그런데 이력에는 **둘 다 성공**으로 남는다
//
// 현장 예약 6건이 전부 환기방송 시작·종료 쌍이라(PROJECT_PROFILE §6-1) 이 자리가
// 실제로 밟힌다 — 다만 그 쌍은 10분 간격이라 같은 분은 아니다. 사람이 손으로 같은 분에
// 둘을 넣으면 그때 난다.
//
// **고치는 방향**: 예약도 자기가 나가는 중임을 남긴다. 그러면 이미 있는 게이트
// (`broadcastInProgress`)가 그것을 보고 두 번째를 **미룬다**(없애지 않는다 — 미룸은
// 이미 있는 규칙이고, 상한도 있다).
process.env.CARECAST_NO_HARDWARE = '1'
// **DB 를 임시 파일로 돌린다**(P-120) — 아래에서 `scheduler` 를 require 하는데, 그것만으로
// DB 가 열리고 없으면 만들어진다. 사유는 `same-minute-real-fire.test.js` 머리말 참고.
process.env.CARECAST_DB_PATH = require('node:path')
  .join(require('node:os').tmpdir(), `carecast_test_same_minute_${process.pid}_${Date.now()}.db`)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')

test('예약도 자기가 나가는 중임을 남긴다 — 다음 예약이 볼 수 있게', () => {
  const m = /async function fireScheduleInner\(schedule, db\)([\s\S]*?)\n\}/.exec(SRC)
  assert.ok(m, 'fireScheduleInner 를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /예약나감표시|broadcastStart/,
    '예약이 나가는 중이라는 사실을 아무 데도 안 남긴다 — 같은 분 두 번째가 그 위에 겹친다')
})

test('표시는 **반드시** 걷힌다 — 실패해도, 터져도', () => {
  // 안 걷히면 그 뒤 모든 예약이 미뤄지다 상한에 걸려 **건너뛴다.**
  // 겹치는 것보다 나쁠 수 있다 — 방송이 아예 안 나간다.
  const m = /async function fireScheduleInner\(schedule, db\)([\s\S]*?)\n\}/.exec(SRC)
  assert.match(m[1], /finally/,
    '표시를 finally 에서 안 걷는다 — 한 번 터지면 그 뒤 예약이 전부 막힌다')
})

test('실제로 막는다 — 앞 예약이 나가는 중이면 뒤가 미뤄진다', () => {
  const 스케줄러 = require(path.join(ROOT, 'server/services/scheduler'))
  const { broadcastInProgress, 예약나감표시 } = 스케줄러._defer
  assert.equal(typeof 예약나감표시, 'function',
    '_defer 로 안 내보낸다 — 검사가 실제 동작을 못 본다')

  const nPath = require.resolve(path.join(ROOT, 'server/services/nowPlaying'))
  const mPath = require.resolve(path.join(ROOT, 'server/services/micLive'))
  const qPath = require.resolve(path.join(ROOT, 'server/services/audioQueue'))
  const 원본 = { n: require.cache[nPath], m: require.cache[mPath], q: require.cache[qPath] }
  const 가짜 = (exports) => ({ exports, loaded: true, id: 's', filename: 's', children: [], paths: [] })
  try {
    // 다른 출처는 전부 조용하게 둔다 — 예약 표시만으로 막히는지 보려는 것이다
    require.cache[nPath] = 가짜({ get: () => ({ broadcast: null }), update() {}, getYtBGM: () => null, updateYtBGM() {} })
    require.cache[mPath] = 가짜({ isLive: () => false, chunkArrived() {}, HOLD_MS: 0 })
    require.cache[qPath] = 가짜({ isBusy: () => false, enqueue() {}, stopAll() {}, mciVolume() {} })

    assert.equal(broadcastInProgress(), false, '아무도 안 내는데 방송 중이라고 한다')

    const 걷기 = 예약나감표시('시험 예약')
    assert.equal(broadcastInProgress(), true,
      '예약이 나가는 중인데 게이트가 못 본다 — 같은 분 두 번째가 그 위에 겹친다')

    걷기()
    assert.equal(broadcastInProgress(), false, '표시가 안 걷혔다 — 그 뒤 예약이 전부 막힌다')
  } finally {
    for (const [k, v] of [[nPath, 원본.n], [mPath, 원본.m], [qPath, 원본.q]]) {
      if (v) require.cache[k] = v; else delete require.cache[k]
    }
  }
})

test('여러 예약이 겹쳐 표시해도 마지막 하나가 걷힐 때까지 열리지 않는다', () => {
  const { broadcastInProgress, 예약나감표시 } = require(path.join(ROOT, 'server/services/scheduler'))._defer
  const nPath = require.resolve(path.join(ROOT, 'server/services/nowPlaying'))
  const mPath = require.resolve(path.join(ROOT, 'server/services/micLive'))
  const qPath = require.resolve(path.join(ROOT, 'server/services/audioQueue'))
  const 원본 = { n: require.cache[nPath], m: require.cache[mPath], q: require.cache[qPath] }
  const 가짜 = (exports) => ({ exports, loaded: true, id: 's', filename: 's', children: [], paths: [] })
  try {
    require.cache[nPath] = 가짜({ get: () => ({ broadcast: null }), update() {}, getYtBGM: () => null, updateYtBGM() {} })
    require.cache[mPath] = 가짜({ isLive: () => false, chunkArrived() {}, HOLD_MS: 0 })
    require.cache[qPath] = 가짜({ isBusy: () => false, enqueue() {}, stopAll() {}, mciVolume() {} })

    const a = 예약나감표시('A')
    const b = 예약나감표시('B')
    a()
    assert.equal(broadcastInProgress(), true, 'A 가 끝났다고 B 가 나가는 중인 것을 잊었다')
    b()
    assert.equal(broadcastInProgress(), false, '둘 다 끝났는데 안 열린다')
    // 같은 걷기를 두 번 불러도 음수로 내려가면 안 된다
    a()
    assert.equal(broadcastInProgress(), false, '두 번 걷자 셈이 음수가 됐다')
  } finally {
    for (const [k, v] of [[nPath, 원본.n], [mPath, 원본.m], [qPath, 원본.q]]) {
      if (v) require.cache[k] = v; else delete require.cache[k]
    }
  }
})
