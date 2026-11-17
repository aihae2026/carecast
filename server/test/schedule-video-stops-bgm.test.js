// 예약 영상도 BGM을 세운다 (td09 H11).
//
// 자동방송의 소리 있는 영상(stepVideoFile)은 video_play 전에 bgm_stop을 쏘고 페이드를
// 기다린다(§3-B 규칙 4). 예약(scheduler.js)의 video 타입만 그게 빠져 있어서, 예약 영상이
// 나가는 동안 로컬 BGM(MusicPlayer)이 밑에서 계속 났다 — 자동방송과 비대칭.
//
// 고정하는 사실 셋:
//  1. video 예약 발화 시 bgm_stop이 video_play보다 **먼저** 나간다
//  2. 영상 파일이 없으면(발화 실패) bgm_stop도 안 나간다 — 안 나갈 방송이 남의 음악만 끄면 안 된다
//  3. 1.5초 페이드 대기 사이 정지·새 방송이 있었으면 video_play를 쏘지 않는다(레드 검증 F6)
//     — 건너뛴 사실은 이력 실패로 요란하게 남는다
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_schedvideo_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// ── 실제 소리가 나지 않도록 미리 심어 두는 스텁 (broadcast-volume.test.js와 같은 방식) ──
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {},
    clientCount: () => 0,
    // 레드 검증 F4: 이 둘이 빠지면 hasSitePlayer가 TypeError→catch→true 폴백을 조용히
    // 타서 스텁의 의도가 가려진다 — 커밋 18266a0이 스스로 경계한 그 상태
    localClientCount: () => 1, localAliveCount: () => 1,
  },
}
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    playChime: () => {},
    resolveChimeVolume: () => 0.5,
  },
}
// 사실 3이 cancelCurrentBroadcast를 진짜로 부른다 — silenceNow가 스피커를 안 울리게
// audioQueue를 막는다(mic-stop-by-user.test.js와 같은 방식)
const queuePath = require.resolve('../services/audioQueue')
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true, exports: {
    enqueue: () => Promise.resolve(), mciVolume: () => 500,
    stopAll: () => ({ cancelled: 0, killed: false }),
  },
}

const { initDB, getDB } = require('../db/schema')
const { fireSchedule } = require('../services/scheduler')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function makeVideoSchedule(audioFileId) {
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type, audio_file_id)
    VALUES (?, '', '전체', '10:00', 1, '2026-09-02', '[]', 'video', ?)
  `).run(`영상예약${++seq}`, audioFileId ?? null).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

test('영상 예약: bgm_stop이 video_play보다 먼저 나간다 — 소리 있는 영상은 BGM을 끈다', async () => {
  const fileId = getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name)
    VALUES ('exercise-video', '체조.mp4', '국민체조')
  `).run().lastInsertRowid

  sent.length = 0
  await fireSchedule(makeVideoSchedule(fileId), getDB())

  const stopIdx  = sent.findIndex(s => s.type === 'bgm_stop')
  const playIdx  = sent.findIndex(s => s.type === 'video_play')
  assert.ok(playIdx >= 0, 'video_play가 안 나갔다 — 픽스처가 잘못됐다')
  assert.ok(stopIdx >= 0,
    'bgm_stop이 안 나갔다 — 예약 영상이 나가는 동안 로컬 BGM이 밑에서 계속 난다(td09 H11)')
  assert.ok(stopIdx < playIdx,
    'bgm_stop이 video_play 뒤에 나갔다 — 페이드가 끝나기 전에 영상 소리가 겹친다')
})

test('영상 파일이 없으면 bgm_stop도 안 나간다 — 안 나갈 방송이 음악만 끄면 안 된다', async () => {
  sent.length = 0
  await fireSchedule(makeVideoSchedule(null), getDB())
  assert.equal(sent.find(s => s.type === 'video_play'), undefined)
  assert.equal(sent.find(s => s.type === 'bgm_stop'), undefined,
    '발화 실패인데 bgm_stop이 나갔다 — 홀에서 멀쩡히 나던 음악이 이유 없이 꺼진다')
})

// ── 사실 3 (레드 검증 F6) ──────────────────────────────────────────────────
// bgm_stop과 video_play 사이의 1.5초는 자동방송이 시작되거나(밀어냄 = 취소 세대 증가)
// 사람이 정지를 누르기에 충분하다. 예전엔 깨어난 쪽이 아무것도 확인하지 않고 쏴서,
// 새로 시작한 방송 위로 영상이 떨어졌다 — 녹음 음원 3.5초 경로가 sinceGen으로 이미 막은
// 것과 같은 구멍이다. 미뤘다 다시 쏘지는 않는다(세대 증가만으로는 "새 방송"과
// "사람 정지"를 구별할 수 없고, 정지 직후 영상이 저절로 나오면 더 나쁘다) —
// 건너뛰고 이력 실패로 요란하게 남긴다.
test('페이드 대기 중 취소 세대가 바뀌면 video_play를 쏘지 않고 실패로 남긴다', async () => {
  const fileId = getDB().prepare(`
    INSERT INTO audio_files (category, filename, original_name)
    VALUES ('exercise-video', '체조2.mp4', '국민체조2')
  `).run().lastInsertRowid

  sent.length = 0
  const gate = require('../services/broadcastGate')
  const p = fireSchedule(makeVideoSchedule(fileId), getDB())
  await new Promise(r => setTimeout(r, 300))   // bgm_stop은 나갔고 아직 대기 중
  gate.cancelCurrentBroadcast('테스트 — 대기 중 새 방송 시작')
  await p

  assert.ok(sent.find(s => s.type === 'bgm_stop'), '픽스처가 잘못됐다 — bgm_stop조차 안 나갔다')
  assert.equal(sent.find(s => s.type === 'video_play'), undefined,
    '대기 중 정지·새 방송이 있었는데 video_play가 나갔다 — 새 소리 위로 영상이 떨어진다(F6)')
  const row = getDB().prepare('SELECT success FROM broadcasts ORDER BY id DESC LIMIT 1').get()
  assert.equal(row?.success, 0,
    '건너뛴 발화가 이력에 실패로 안 남았다 — 조용히 사라지면 아무도 모른다')
})
