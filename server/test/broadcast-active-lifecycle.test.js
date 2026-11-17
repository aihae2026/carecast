'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const dbPath = path.join(require('node:os').tmpdir(), `carecast_test_active_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = dbPath
process.env.CARECAST_NO_HARDWARE = '1'
function stub(name, exports) {
  const filename = require.resolve(name)
  require.cache[filename] = { filename, id: filename, loaded: true, exports }
}
stub('../services/sse', { broadcastSSE: () => {} })
stub('../services/audioQueue', { stopAll: () => {}, isBusy: () => false })
stub('../services/broadcastSteps', {})
stub('../services/morning', { DEFAULT_SEGMENTS: [], buildSegmentText: () => '' })
stub('../services/tts', {})
stub('../services/sitePlayer', { hasSitePlayer: () => true, 소리낼수있나: () => true, 무창사건수: () => 0, 담당바뀜수: () => 0 })
stub('../services/laneTiming', {
  laneStarted: () => {}, takeTiming: () => ({ scheduledAt: null, playedAt: null, delayMs: null }),
})
stub('../domain/stepHistory', { 이력판정: () => ({ result: '성공' }), record: () => {} })
const gate = require('../services/broadcastGate')
const { initDB, getDB } = require('../db/schema')
const { __test__: { runBroadcastLane } } = require('../services/broadcastSequencer')
let db
test.before(() => { initDB(); db = getDB() })
test.after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})
const lane = (title, prepare) => ({ tab: 'active_test', title, runLog: title, logContent: title, prepare })
const noStep = async () => { assert.fail('빈 구성에서 단계 실행 금지') }

test('성공·오류 이력 저장이 모두 실패해도 실행 종료 시 활성 잠금을 해제한다', async () => {
  db.exec("CREATE TEMP TRIGGER fail_logs BEFORE INSERT ON broadcasts BEGIN SELECT RAISE(ABORT, 'test log failure'); END")
  try {
    await assert.rejects(runBroadcastLane(db, lane('더미 실패'), { manual: true }, noStep), /test log failure/)
    assert.equal(gate.isBroadcastActive(), false)
    assert.equal(require('../services/nowPlaying').get().broadcast, null)
  } finally { db.exec('DROP TRIGGER fail_logs') }
})

test('밀려난 A의 finally가 실행 중인 B의 잠금을 풀지 않는다', async () => {
  let releaseA, releaseB
  const a = runBroadcastLane(db, lane('더미 A', () => new Promise(r => { releaseA = r })), { manual: true }, noStep)
  const b = runBroadcastLane(db, lane('더미 B', () => new Promise(r => { releaseB = r })), { manual: true }, noStep)
  assert.equal(gate.isBroadcastActive(), true)
  releaseA()
  await a
  assert.equal(gate.isBroadcastActive(), true)
  assert.equal(require('../services/nowPlaying').get().broadcast.title, '더미 B')
  releaseB()
  await b
  assert.equal(gate.isBroadcastActive(), false)
  assert.equal(db.prepare("SELECT success FROM broadcasts WHERE content = '더미 B' ORDER BY id DESC LIMIT 1").get()?.success, 1)
})

// ── 밀려난 일과방송의 「방송 중」 표시가 20분 남던 구멍 (2026-09-17 제출 전 점검 A-1) ──────────
// 예약 수동 재생(`routes/schedules.js` trigger)은 `cancelCurrentBroadcast` 로 레인을 밀어낸다. 밀려난 레인의
// finally 는 토큰이 취소돼 `broadcastComplete` 를 건너뛰고, 표시를 지우는 곳이 그것뿐이라
// `nowPlaying.broadcast` 가 남는다. 스케줄러는 그 표시를 20분까지 「방송 중」으로 봐서 그동안 예약을
// 미루고 10분 뒤 버린다 — 09-16 현장 환기방송 2차 누락과 같은 모양이다.
test('일과방송을 밀어내면 「방송 중」 표시도 같이 지운다 — 남으면 예약이 20분 막힌다', () => {
  gate.newBroadcastToken()
  gate.broadcastStart('더미 일과방송')
  gate.cancelCurrentBroadcast('수동 재생이 시작되어 앞 소리를 정리합니다')
  assert.equal(require('../services/nowPlaying').get().broadcast, null)
})

test('레인이 안 돌 때 밀어내기는 남의 표시(브라우저가 알린 재생)를 지우지 않는다', () => {
  const np = require('../services/nowPlaying')
  np.update({ broadcast: { title: '더미 화면 재생' } })
  gate.cancelCurrentBroadcast('새 방송')
  assert.equal(np.get().broadcast?.title, '더미 화면 재생')
  np.update({ broadcast: null })
})

test('취소하면 활성 잠금을 해제한다', () => {
  gate.newBroadcastToken()
  gate.broadcastStart('더미 취소')
  assert.equal(gate.isBroadcastActive(), true)
  gate.cancelCurrentBroadcast()
  assert.equal(gate.isBroadcastActive(), false)
})
