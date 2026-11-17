// 예약별 볼륨이 **실제 재생 지점까지** 도달하는지 확인한다.
//
// 스피커를 울리지 않고 검증하기 위해 두 가지를 쓴다.
//  1) 재생 직전의 결정 지점을 순수 함수로 뽑아 값만 확인한다
//     (audioQueue.mciVolume / chimePlayer.resolveChimeVolume)
//  2) 브라우저가 재생하는 경로(예약 TTS·음원·영상)는 SSE 페이로드를 가로채 확인한다.
//     sse.js와 chimePlayer.js를 require.cache에 미리 심어 두면 실제 소리는 나지 않는다.
//
// 여기까지 맞으면 남는 것은 "윈도우가 실제로 소리를 내는가"뿐이고, 그건 테스트가 덮을 수 없다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bcastvol_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// ── 실제 소리가 나지 않도록 미리 심어 두는 스텁 ────────────────
// scheduler.js가 require하기 **전에** 캐시를 채워야 한다.
const sent = []
const chimes = []

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {},
    clientCount: () => 0,
  },
}

const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')   // resolveChimeVolume은 진짜를 쓴다
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    playChime: (type, volumePct) => { chimes.push({ type, volumePct }) },   // 스피커를 울리지 않는다
    resolveChimeVolume: realChime.resolveChimeVolume,
  },
}

const { initDB, getDB } = require('../db/schema')
const { writeVolumes } = require('../domain/volume')
const { fireSchedule } = require('../services/scheduler')
const { mciVolume } = require('../services/audioQueue')

test.before(() => {
  initDB()
  // 시스템 기본값을 채널별로 다르게 둬서, 어느 채널을 읽었는지 값만 보고 알 수 있게 한다
  writeVolumes(getDB(), { tts: 61, audio: 62, media: 63, bgm: 64 })
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function makeSchedule(fields) {
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type, main_volume)
    VALUES (?, ?, '전체', '10:00', 1, '2026-08-28', '[]', ?, ?)
  `).run(`볼륨테스트${++seq}`, fields.content ?? '', fields.broadcast_type, fields.main_volume ?? null).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

function makeAudioFile(category, name) {
  const id = getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name)
    VALUES (?, ?, ?)
  `).run(category, `${name}.mp3`, name).lastInsertRowid
  return id
}

function lastOf(type) {
  return [...sent].reverse().find(s => s.type === type)
}

// ── 서버 스피커 경로 (소리 없이 값만 확인) ────────────────────
test('안내 음성: 이 재생에만 쓸 볼륨이 MCI 값까지 내려간다', () => {
  // vol_tts=61 → 610, 지정하면 그 값만
  assert.equal(mciVolume(null), 610, '지정이 없으면 시스템 기본값(안내 음성 채널)을 쓴다')
  assert.equal(mciVolume(25), 250)
  assert.equal(mciVolume(0), 0, '0(무음)도 유효한 값이다')
})

test('차임벨: 이 울림에만 쓸 볼륨이 0~1로 내려간다', () => {
  const { resolveChimeVolume } = realChime
  assert.equal(resolveChimeVolume(null), 0.61)
  assert.equal(resolveChimeVolume(30), 0.3)
  assert.equal(resolveChimeVolume(0), 0)
  assert.equal(resolveChimeVolume(150), 1, '범위를 벗어난 값은 잘라낸다')
})

// ── 브라우저 재생 경로 (SSE 페이로드 확인) ────────────────────
test('차임벨 예약: 서버 스피커에 예약의 볼륨이 넘어간다', async () => {
  chimes.length = 0
  await fireSchedule(makeSchedule({ broadcast_type: 'chime', main_volume: 20 }), getDB())
  assert.equal(chimes.at(-1).volumePct, 20)

  await fireSchedule(makeSchedule({ broadcast_type: 'chime' }), getDB())
  assert.equal(chimes.at(-1).volumePct, 61, '지정이 없으면 안내 음성 채널의 기본값')
})

test('음원 예약: prayer_play에 그 예약의 볼륨이 실린다', async () => {
  const fileId = makeAudioFile('lunch-prayer', '낮 안내')
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?')
  const s = makeSchedule({ broadcast_type: 'audio', main_volume: 35 })
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(fileId, s.id)
  await fireSchedule(getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id), getDB())
  assert.equal(lastOf('prayer_play').payload.volume, 35)

  const s2 = makeSchedule({ broadcast_type: 'audio' })
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(fileId, s2.id)
  await fireSchedule(getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s2.id), getDB())
  assert.equal(lastOf('prayer_play').payload.volume, 62, '음원 채널의 기본값을 쓴다')
})

test('영상 예약: video_play에 영상 채널 볼륨이 실린다', async () => {
  const fileId = makeAudioFile('exercise-video', '국민체조')
  const s = makeSchedule({ broadcast_type: 'video' })
  getDB().prepare('UPDATE schedules SET audio_file_id = ? WHERE id = ?').run(fileId, s.id)
  await fireSchedule(getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id), getDB())
  assert.equal(lastOf('video_play').payload.volume, 63)
})

test('채널별 기본값을 각각 읽는다(한 채널로 뭉뚱그리지 않는다)', () => {
  // 위 테스트들이 61/62/63으로 서로 다른 값을 받았다는 것이 곧 채널 분리가 살아 있다는 뜻이다.
  const volumes = sent.filter(s => ['prayer_play', 'video_play'].includes(s.type)).map(s => s.payload.volume)
  assert.ok(volumes.includes(62) && volumes.includes(63), `채널이 섞였다: ${JSON.stringify(volumes)}`)
})

test('시스템 설정은 그대로다 — 되돌릴 상태를 만들지 않는다', () => {
  const { readVolumes } = require('../domain/volume')
  assert.deepEqual(readVolumes(getDB()), { master: 70, tts: 61, audio: 62, media: 63, bgm: 64 })
})
