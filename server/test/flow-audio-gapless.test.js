// 흐름(FlowBuilder)의 음원·영상 단계가 **실제 재생 종료**를 기다리는지 확인한다.
//
// 이 테스트가 고정하는 사고: 예전에는 파일 재생시간을 모르면(=업로드 시 duration을 0으로만
// 넣어서 사실상 항상) 곡 하나당 180초를 무조건 기다렸다. 4곡짜리 식사 전 흐름이 12분간
// 묶여서, 뒤에 있던 BGM + 저녁식사 안내가 아예 안 나갔다.
// 배관은 이미 있었다 — broadcastSequencer의 waitForAudioEnd/notifyAudioEnded와
// 화면(MusicPlayer)의 /api/morning/audio-ended 보고. flowRunner만 토큰을 등록하지 않아
// 그 보고가 버려지고 있었다.
//
// 소리를 내지 않는 방법은 flow-step-volume.test.js와 같다 — sse.js를 require.cache에 미리
// 심어 페이로드만 가로챈다. 다만 여기서는 **가로챈 배열을 비우지 않는다.** 이 파일의 테스트는
// 재생이 끝날 때까지 기다리는 비동기 테스트라, 공유 배열을 중간에 비우면 아직 기다리고 있는
// 다른 테스트의 관측값까지 지워진다(실제로 그것 때문에 한 번 헛다리를 짚었다).
// 대신 각 테스트가 자기가 만든 음원 id로만 걸러 본다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowgap_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const sent = []

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

const { initDB, getDB } = require('../db/schema')
const { runStep, audioWaitCapMs } = require('../services/flowRunner')
const { notifyAudioEnded, notifyVideoEnded } = require('../services/broadcastSequencer')
const { recordMeasuredDuration } = require('../routes/morning')

// 조건이 참이 될 때까지 짧게 폴링 — 타임아웃이 나면 "다음 곡이 안 나갔다"는 뜻이다.
// 여유를 넉넉히 둔 이유: tts.js가 로드되며 Python·옛 인터넷 합성 엔진를 확인하는 동안 이벤트 루프가
// 한 번 2초 가까이 멈춘다(그 자체는 이 기능과 무관한 기존 동작). 짧게 잡으면 그 멈춤에
// 걸려 이 테스트가 엉뚱하게 빨간불이 된다. 고치려는 버그는 곡당 180초라 이 여유로도 충분히 잡힌다.
async function waitFor(fn, label, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`${timeoutMs}ms 안에 조건을 만족하지 못했다: ${label}`)
}

// 이 테스트가 만든 파일에 대한 재생 지시만 골라 본다(다른 테스트와 섞이지 않게)
const playsOf  = (ids) => sent.filter(e => e.type === 'prayer_play' && ids.includes(e.payload.audioFileId))
const videosOf = (ids) => sent.filter(e => e.type === 'video_play'  && ids.includes(e.payload.audioFileId))

let seq = 0
function makeAudioFile(duration = 0) {
  seq++
  return getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('prayer', ?, ?, ?)
  `).run(`gap${seq}.mp3`, `음원${seq}`, duration).lastInsertRowid
}

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('음원 2곡: 첫 곡 종료 알림이 오면 180초를 기다리지 않고 곧바로 다음 곡으로 넘어간다', async () => {
  const ids = [makeAudioFile(0), makeAudioFile(0)]
  const plays = () => playsOf(ids)

  const started = Date.now()
  const running = runStep(getDB(), { step_type: 'audio', config: { playlist: ids } })

  await waitFor(() => plays().length === 1, '첫 곡 재생 지시')
  notifyAudioEnded(plays()[0].payload.token)

  await waitFor(() => plays().length === 2, '두 번째 곡 재생 지시(첫 곡 종료 직후)')
  notifyAudioEnded(plays()[1].payload.token)

  await running
  assert.ok(Date.now() - started < 20000, '종료 알림을 받고도 고정 대기를 하고 있다(버그는 곡당 180초였다)')
})

test('연속 재생: 두 번째 곡부터 gapless가 실려서 화면이 페이드·딜레이를 건너뛴다', async () => {
  const ids = [makeAudioFile(0), makeAudioFile(0)]
  const plays = () => playsOf(ids)

  const running = runStep(getDB(), { step_type: 'audio', config: { playlist: ids } })
  await waitFor(() => plays().length === 1, '첫 곡')
  assert.ok(!plays()[0].payload.gapless, '첫 곡은 평소처럼 페이드하며 시작해야 한다')

  notifyAudioEnded(plays()[0].payload.token)
  await waitFor(() => plays().length === 2, '두 번째 곡')
  assert.equal(plays()[1].payload.gapless, true, '이어지는 곡은 텀 없이 붙어야 한다')

  notifyAudioEnded(plays()[1].payload.token)
  await running
})

test('음원 재생 지시에 audio_file_id가 실린다 — 화면이 잰 재생시간을 돌려보낼 수 있게', async () => {
  const id = makeAudioFile(0)
  const plays = () => playsOf([id])

  const running = runStep(getDB(), { step_type: 'audio', config: { playlist: [id] } })
  await waitFor(() => plays().length === 1, '재생 지시')
  assert.equal(plays()[0].payload.audioFileId, id)
  notifyAudioEnded(plays()[0].payload.token)
  await running
})

test('대기 상한: 재생시간을 아는 파일은 그만큼만, 모르는 파일만 180초 상한을 쓴다', () => {
  assert.equal(audioWaitCapMs({ duration: 12 }), 14000, '아는 길이는 +2초 여유만')
  assert.equal(audioWaitCapMs({ duration: 0 }),  180000, '모르면 상한 180초')
  assert.equal(audioWaitCapMs({}),               180000)
})

test('대기 상한은 배속을 따라간다 — 느리게 틀면 그만큼 더 걸린다', () => {
  // 0.5배로 틀면 60초짜리가 실제로는 120초 걸린다. 상한을 62초로 두면 노래가 한창일 때
  // 다음 곡으로 넘어가버린다(고치려던 "곡이 잘린다"가 반대 방향으로 되살아난다).
  assert.equal(audioWaitCapMs({ duration: 60 }, 0.5), 122000)
  assert.equal(audioWaitCapMs({ duration: 60 }, 1),    62000)
  assert.equal(audioWaitCapMs({ duration: 60 }, 1.25), 50000)
  assert.equal(audioWaitCapMs({ duration: 60 }, null), 62000, '배속이 없으면 원래 속도')
  assert.equal(audioWaitCapMs({ duration: 0 },  0.5), 180000, '길이를 모르면 상한은 그대로')
})

test('영상 단계도 재생 종료 알림을 받으면 곧바로 다음으로 넘어간다', async () => {
  const ids = [makeAudioFile(0), makeAudioFile(0)]
  const videos = () => videosOf(ids)

  const started = Date.now()
  const running = runStep(getDB(), { step_type: 'video_file', config: { playlist: ids } })

  await waitFor(() => videos().length === 1, '첫 영상')
  notifyVideoEnded(videos()[0].payload.token)
  await waitFor(() => videos().length === 2, '두 번째 영상')
  notifyVideoEnded(videos()[1].payload.token)

  await running
  assert.ok(Date.now() - started < 20000, '영상도 고정 대기를 하고 있다')
})

test('화면이 잰 재생시간을 돌려보내면 audio_files.duration이 채워진다', () => {
  const db = getDB()
  const id = makeAudioFile(0)

  recordMeasuredDuration(db, id, 137.4)
  assert.equal(db.prepare('SELECT duration FROM audio_files WHERE id = ?').get(id).duration, 137,
    '재생시간이 기록되지 않으면 다음 방송도 또 상한까지 기다린다')
})

test('이미 재생시간을 아는 파일은 덮어쓰지 않는다 — 잘린 재생이 값을 망치지 않게', () => {
  const db = getDB()
  const id = makeAudioFile(200)

  recordMeasuredDuration(db, id, 3)
  assert.equal(db.prepare('SELECT duration FROM audio_files WHERE id = ?').get(id).duration, 200)
})

test('말이 안 되는 재생시간은 기록하지 않는다', () => {
  const db = getDB()
  const id = makeAudioFile(0)

  recordMeasuredDuration(db, id, 0)
  recordMeasuredDuration(db, id, -5)
  recordMeasuredDuration(db, id, Infinity)
  recordMeasuredDuration(db, id, NaN)
  assert.equal(db.prepare('SELECT duration FROM audio_files WHERE id = ?').get(id).duration, 0)
})
