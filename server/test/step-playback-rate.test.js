// 단계별 재생 배속 — 자동방송 순서편집기에서 음원·영상 단계마다 정해 둔다.
//
// 왜: 노래방 방송처럼 어르신이 따라 부르는 것은 원래 속도가 빠르다. 예약 하나하나에 걸 수는
// 있었지만(schedules.playback_rate) **자동방송 5종의 단계에는 걸 자리가 없어서**, 매번 사람이
// 손으로 맞춰야 했다. 기본값은 정속(1.0)이고, 정해 둔 단계만 그 속도로 나간다.
//
// 배속을 실을 때 **대기 상한도 같이 나눠야 한다.** 0.5배로 틀면 60초짜리가 120초 걸리는데
// 상한이 62초면 노래가 한창일 때 다음 단계로 넘어간다(flowRunner.audioWaitCapMs와 같은 이유).
'use strict'

const path = require('path')
const { editorSource } = require('./helpers/editorSource')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_steprate_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const { initDB, getDB } = require('../db/schema')
const sequencer = require('../services/broadcastSequencer')
const { stepOpts } = sequencer.__test__
const { notifyAudioEnded } = require('../services/broadcastGate')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('stepOpts가 단계의 배속을 실행부로 넘긴다', () => {
  assert.equal(stepOpts({ rate: 0.75 }).rate, 0.75)
  assert.equal(stepOpts({}).rate, undefined, '안 정한 단계는 그대로 비운다 — 정속이 기본이다')
})

test('배속을 정하지 않은 단계는 예전 그대로다 (회귀)', () => {
  const o = stepOpts({ volume: 50, ttsVoice: 'female' })
  assert.equal(o.volume, 50)
  assert.equal(o.ttsVoice, 'female')
})

test('말이 안 되는 배속은 버린다 — 0·음수·글자·범위 밖', () => {
  const { normalizePlaybackRate } = require('../services/scheduleStore')
  assert.equal(normalizePlaybackRate(0), null, '0배는 정지지 배속이 아니다')
  assert.equal(normalizePlaybackRate(-1), null)
  assert.equal(normalizePlaybackRate('빠르게'), null)
  assert.equal(normalizePlaybackRate(9), 1.5, '범위 밖은 상한으로 접는다')
  assert.equal(normalizePlaybackRate(0.1), 0.5, '범위 밖은 하한으로 접는다')
})

test('음원 단계가 배속을 화면으로 실어 보낸다', async () => {
  const db = getDB()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration)
              VALUES ('prayer', 'r1.mp3', '노래방', 60)`).run()
  sent.length = 0
  const tok = sequencer.__test__.newBroadcastToken()
  const p = sequencer.__test__.stepAudioFile(db, 'prayer', 0, 180, tok, { rate: 0.5 })
  await new Promise(r => setTimeout(r, 30))
  const ev = [...sent].reverse().find(e => e.type === 'prayer_play')
  assert.ok(ev, 'prayer_play가 안 나갔다')
  assert.equal(ev.payload.rate, 0.5, '배속이 안 실리면 화면은 늘 정속으로 튼다')
  notifyAudioEnded(ev.payload.token)
  await p
})

test('배속을 낮추면 대기 상한도 늘어난다 — 노래 도중에 안 끊긴다', () => {
  const { audioWaitCapMs } = require('../services/flowRunner')
  const normal = audioWaitCapMs({ duration: 60 }, 1)
  const slow   = audioWaitCapMs({ duration: 60 }, 0.5)
  assert.ok(slow > normal * 1.8, `0.5배면 상한도 두 배여야 한다 (${normal} → ${slow})`)
})

test('흐름 단계에 적은 배속이 예약 배속보다 우선한다', () => {
  // 예약(playback_rate)은 그 방송 전체의 기본값이고, 단계에 적은 값은 그 단계만의 값이다.
  // 단계 값이 무시되면 순서편집기에서 정해도 아무 일이 안 일어난다(죽은 설정).
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  assert.match(src, /normalizePlaybackRate\(config\.rate\)\s*\?\?\s*opts\.rate/,
    'runStep이 단계 배속을 먼저 보지 않는다')
})

test('순서편집기 화면에 배속 입력이 실제로 있다', () => {
  const src = editorSource()
  assert.ok(src.includes('updateStepRate'), '화면에 입력이 없으면 서버 배선은 죽은 코드다')
  assert.ok(src.includes('재생 배속'), '사람이 무엇인지 알아볼 이름표가 있어야 한다')
})

test('재생 화면(영상 오버레이)에서 배속을 바꿀 수 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'broadcast', 'VideoPlayer.jsx'), 'utf8')
  assert.ok(src.includes('applyRate'), '재생 중 배속을 바꿀 방법이 없다')
  // (외부 동영상 항목의 postMessage 배속은 2026-09-21 연동째 걷어냈다 — 이제 <video> 하나다)
  assert.ok(!src.includes('sendYT('), '걷어낸 외부 동영상 명령이 남아 있다')
  assert.ok(src.includes('preservesPitch'),
    '음정을 안 지키면 느리게 틀 때 목소리가 굵어진다')
})
