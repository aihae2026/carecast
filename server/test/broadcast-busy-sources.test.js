'use strict'
// **"지금 방송 중인가" 는 소리를 내는 모든 주체를 본다** (P-42 · P-55, 2026-09-11).
//
// 두 건은 같은 뿌리다 — **소리를 내는 주체마다 자기만 아는 상태를 쓴다.**
//
// [FACT] EV-004047 재현:
//   · `broadcastInProgress()` 는 `nowPlaying.broadcast` 와 `micLive` **둘만** 본다
//   · 즉시 TTS(`routes/tts.js`)는 `audioQueue.enqueue` 로 **같은 서버 스피커**를 쓰면서
//     `nowPlaying` 에 아무것도 안 남긴다(참조 0건) → 예약 발동부가 **볼 수 없다** (P-55)
//   · 그래서 즉시 방송 중에 정시가 오면 **두 소리가 한 스피커로 겹친다**
//
// **고칠 것은 새 상태가 아니다.** `audioQueue.isBusy()` 가 **이미 있고**
// ([FACT] `audioQueue.js:226` · `module.exports` 에 포함), `autoUpdate.js:140` 은
// 이미 그것을 본다. **스케줄러만 안 본다** — 그 비대칭이 결함이다.
process.env.CARECAST_NO_HARDWARE = '1'
// **DB 를 임시 파일로 돌린다**(P-120) — `scheduler` 를 require 하는 것만으로 DB 가 열리고,
// 없으면 만들어진다. 안 돌리면 이 테스트가 개발 DB 를 직접 건드린다. 사유는
// `same-minute-real-fire.test.js` 머리말 참고([FACT] EV-004201).
process.env.CARECAST_DB_PATH = require('node:path')
  .join(require('node:os').tmpdir(), `carecast_test_busy_${process.pid}_${Date.now()}.db`)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SCHED = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')

test('broadcastInProgress() 가 서버 스피커 대기열도 본다', () => {
  const m = /function broadcastInProgress\(\)[\s\S]*?\n\}/.exec(SCHED)
  assert.ok(m, 'broadcastInProgress() 를 못 찾았다 — 이 가드를 옮길 것')
  // 기존 둘은 그대로 있어야 한다(넓히는 것이지 바꾸는 것이 아니다)
  assert.match(m[0], /nowPlaying/,  'nowPlaying 을 안 본다')
  assert.match(m[0], /micLive/,     'micLive 를 안 본다')
  // 빠져 있던 셋째
  assert.match(m[0], /audioQueue/,
    '서버 스피커 대기열을 안 본다 — 즉시 TTS 가 나가는 중인데 예약이 그 위에 겹친다(P-55)')
})

test('세 출처를 **읽어 본다** — 소스 문자열만이 아니라 실제로', () => {
  // 소스에 이름이 있는 것과 그 값을 실제로 쓰는 것은 다르다. 모듈을 갈아 끼워 확인한다.
  const qPath = require.resolve(path.join(ROOT, 'server/services/audioQueue'))
  const mPath = require.resolve(path.join(ROOT, 'server/services/micLive'))
  const nPath = require.resolve(path.join(ROOT, 'server/services/nowPlaying'))
  const 원본 = { q: require.cache[qPath], m: require.cache[mPath], n: require.cache[nPath] }

  const 가짜 = (exports) => ({ exports, loaded: true, id: 'stub', filename: 'stub', children: [], paths: [] })
  const 스케줄러 = require(path.join(ROOT, 'server/services/scheduler'))
  const inProgress = 스케줄러._defer.broadcastInProgress

  try {
    // 셋 다 조용하면 false
    require.cache[nPath] = 가짜({ get: () => ({ broadcast: null }), update() {}, getYtBGM: () => null, updateYtBGM() {} })
    require.cache[mPath] = 가짜({ isLive: () => false, chunkArrived() {}, HOLD_MS: 0 })
    require.cache[qPath] = 가짜({ isBusy: () => false, enqueue() {}, stopAll() {}, mciVolume() {} })
    assert.equal(inProgress(), false, '아무도 안 내는데 방송 중이라고 한다')

    // **서버 스피커만 바쁘면 true** — 이것이 P-55 의 핵심이다
    require.cache[qPath] = 가짜({ isBusy: () => true, enqueue() {}, stopAll() {}, mciVolume() {} })
    assert.equal(inProgress(), true,
      '즉시 TTS 가 서버 스피커로 나가는 중인데 예약이 그 위에 겹친다(P-55)')

    // 마이크만 켜져도 true (기존 동작 유지)
    require.cache[qPath] = 가짜({ isBusy: () => false, enqueue() {}, stopAll() {}, mciVolume() {} })
    require.cache[mPath] = 가짜({ isLive: () => true, chunkArrived() {}, HOLD_MS: 0 })
    assert.equal(inProgress(), true, '마이크 생방송 중인데 안 막는다')

    // nowPlaying 만 있어도 true (기존 동작 유지)
    require.cache[mPath] = 가짜({ isLive: () => false, chunkArrived() {}, HOLD_MS: 0 })
    require.cache[nPath] = 가짜({ get: () => ({ broadcast: { title: 'x' } }), update() {}, getYtBGM: () => null, updateYtBGM() {} })
    assert.equal(inProgress(), true, '방송 시퀀스 중인데 안 막는다')
  } finally {
    for (const [k, v] of [[qPath, 원본.q], [mPath, 원본.m], [nPath, 원본.n]]) {
      if (v) require.cache[k] = v; else delete require.cache[k]
    }
  }
})

test('한 출처를 못 읽어도 나머지는 본다 — 조회 실패가 게이트를 통째로 열지 않는다', () => {
  const qPath = require.resolve(path.join(ROOT, 'server/services/audioQueue'))
  const mPath = require.resolve(path.join(ROOT, 'server/services/micLive'))
  const 원본 = { q: require.cache[qPath], m: require.cache[mPath] }
  const 스케줄러 = require(path.join(ROOT, 'server/services/scheduler'))
  try {
    require.cache[qPath] = { exports: { get isBusy() { throw new Error('못 읽음') } }, loaded: true, id: 's', filename: 's', children: [], paths: [] }
    require.cache[mPath] = { exports: { isLive: () => true }, loaded: true, id: 's', filename: 's', children: [], paths: [] }
    assert.equal(스케줄러._defer.broadcastInProgress(), true,
      '대기열 조회가 터지자 마이크가 켜진 것까지 무시했다 — 그 위로 방송이 나간다')
  } finally {
    for (const [k, v] of [[qPath, 원본.q], [mPath, 원본.m]]) {
      if (v) require.cache[k] = v; else delete require.cache[k]
    }
  }
})

// ── **굳은 「방송 중」이 그 뒤 예약을 통째로 삼키지 않는다** (현장 신고 2026-09-16) ──────
//
// *"환기방송 2차가 뭐랑 겹쳐서 안나갔다는데, 난 겹쳐서 한게 없거든?"*
//
// `nowPlaying.broadcast` 는 **브라우저가 켜고 브라우저가 끈다.** 그 사이에 창이 닫히거나
// 새로고침되거나 SSE 가 끊기면 끄는 쪽이 영영 안 온다. 그러면 이 게이트가 계속 닫히고,
// 뒤따르는 예약이 미뤄지다가 `deferMaxMin` 뒤에 「겹쳐서 건너뛰었습니다」로 **버려진다.**
//
// 같은 고장이 `duplicateBroadcast` 의 열쇠 끼임이고, 거기 적어 둔 판단이 여기도 맞는다 —
// *막으려던 것(겹침)보다 나쁜 결과다. 무음이 가장 비싼 실패다.*
//
// **소스에 상한이 적혀 있는지가 아니라, 실제로 무시되는지를 본다.**
test('굳은 「방송 중」은 상한을 지나면 무시된다 — 실제로 값을 갈아 끼워 본다', () => {
  const nPath = require.resolve(path.join(ROOT, 'server/services/nowPlaying'))
  const 원본n = require.cache[nPath]
  const 가짜 = (exports) => ({ exports, loaded: true, id: 'stub', filename: 'stub', children: [], paths: [] })
  const 스케줄러 = require(path.join(ROOT, 'server/services/scheduler'))
  const inProgress = 스케줄러._defer.broadcastInProgress

  const 세우기 = (켜진때) => 가짜({
    get: () => ({ broadcast: { title: '즉시 방송' } }),
    getBroadcastSince: () => 켜진때,
    update() {}, getYtBGM: () => null, updateYtBGM() {},
  })

  try {
    // 방금 켜졌으면 **막는다** — 진짜 방송 위에 겹치면 안 된다.
    require.cache[nPath] = 세우기(Date.now())
    assert.equal(inProgress(), true, '방금 시작한 방송인데 안 막는다')

    // 5분 전이면 아직 막는다(아침 종합 방송은 실제로 이만큼 간다).
    require.cache[nPath] = 세우기(Date.now() - 5 * 60 * 1000)
    assert.equal(inProgress(), true, '5분짜리 방송을 낡은 것으로 본다 — 겹쳐 나간다')

    // **30분째 안 꺼졌으면 굳은 것이다.** 무시하고 예약을 내보낸다.
    require.cache[nPath] = 세우기(Date.now() - 30 * 60 * 1000)
    assert.equal(inProgress(), false,
      '30분째 안 꺼진 표시를 그대로 믿는다 — 그 뒤 예약이 전부 사라진다(2026-09-16 현장)')

    // **켜진 시각을 모르면 막는다.** 판단할 근거가 없을 때 문을 열면 진짜 방송에 겹친다.
    require.cache[nPath] = 가짜({
      get: () => ({ broadcast: { title: 'x' } }),
      update() {}, getYtBGM: () => null, updateYtBGM() {},
    })
    assert.equal(inProgress(), true, '켜진 시각을 모르는데 문을 연다 — 진짜 방송에 겹친다')
  } finally {
    if (원본n) require.cache[nPath] = 원본n; else delete require.cache[nPath]
  }
})
