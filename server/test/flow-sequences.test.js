// 방송 흐름(순서) 만들기: 단계가 순서대로 저장/재정렬되는지, 사용 중인 흐름 삭제가 거부되는지,
// 미사용 흐름은 단계까지 같이 지워지는지, flowRunner가 sort_order 순서대로 실행하는지 검증.
// 운영 DB(server/db/database.db)를 절대 건드리지 않도록 CARECAST_DB_PATH로 임시 DB를 쓴다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flows_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { loadFlowWithSteps, validateSteps, replaceSteps, deleteFlow } = require('../routes/flows')
const { runFlow, runStep } = require('../services/flowRunner')

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function insertFlow(name) {
  const db = getDB()
  const now = new Date().toISOString()
  return db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(name, now, now).lastInsertRowid
}

test('validateSteps: 빈 배열이나 유효하지 않은 step_type은 에러 메시지를 반환한다', () => {
  assert.ok(validateSteps([]))
  assert.ok(validateSteps(null))
  assert.ok(validateSteps([{ step_type: 'unknown' }]))
  assert.equal(validateSteps([{ step_type: 'tts' }, { step_type: 'delay' }]), null)
})

test('replaceSteps: 단계가 sort_order 순서대로 저장된다', () => {
  const flowId = insertFlow('테스트 흐름1')
  replaceSteps(getDB(), flowId, [
    { step_type: 'delay', config: { wait_sec: 3 } },
    { step_type: 'tts', config: { content: '안내' } },
    { step_type: 'chime', config: {} },
  ])
  const loaded = loadFlowWithSteps(getDB(), flowId)
  assert.equal(loaded.steps.length, 3)
  assert.deepEqual(loaded.steps.map(s => s.sort_order), [0, 1, 2])
  assert.deepEqual(loaded.steps.map(s => s.step_type), ['delay', 'tts', 'chime'])
  assert.equal(loaded.steps[1].config.content, '안내')
})

test('replaceSteps: 재정렬 후 다시 저장해도 sort_order가 중복/공백 없이 유지된다', () => {
  const flowId = insertFlow('테스트 흐름2')
  replaceSteps(getDB(), flowId, [
    { step_type: 'tts', label: 'A', config: {} },
    { step_type: 'delay', label: 'B', config: { wait_sec: 1 } },
    { step_type: 'chime', label: 'C', config: {} },
  ])
  // 프론트가 드래그로 순서를 바꾼 뒤 전체 배열을 다시 보내는 것과 동일하게 시뮬레이션(B, C, A 순)
  const reordered = loadFlowWithSteps(getDB(), flowId).steps
  const [a, b, c] = reordered
  replaceSteps(getDB(), flowId, [b, c, a].map(s => ({ step_type: s.step_type, label: s.label, config: s.config })))

  const after = loadFlowWithSteps(getDB(), flowId).steps
  assert.deepEqual(after.map(s => s.sort_order), [0, 1, 2], 'sort_order는 항상 0..n-1 연속이어야 한다')
  assert.deepEqual(after.map(s => s.label), ['B', 'C', 'A'])
})

test('replaceSteps: 중간 단계를 뺀 배열로 다시 저장하면(=삭제) 나머지가 재정렬된다', () => {
  const flowId = insertFlow('테스트 흐름3')
  replaceSteps(getDB(), flowId, [
    { step_type: 'tts', label: 'A', config: {} },
    { step_type: 'delay', label: 'B', config: { wait_sec: 1 } },
    { step_type: 'chime', label: 'C', config: {} },
  ])
  const steps = loadFlowWithSteps(getDB(), flowId).steps
  const withoutB = steps.filter(s => s.label !== 'B').map(s => ({ step_type: s.step_type, label: s.label, config: s.config }))
  replaceSteps(getDB(), flowId, withoutB)

  const after = loadFlowWithSteps(getDB(), flowId).steps
  assert.equal(after.length, 2)
  assert.deepEqual(after.map(s => s.sort_order), [0, 1])
  assert.deepEqual(after.map(s => s.label), ['A', 'C'])
})

test('deleteFlow: 사용 중인 예약이 있으면 거부하고, 흐름·예약 둘 다 그대로 남는다', () => {
  const db = getDB()
  const flowId = insertFlow('사용중인 흐름')
  replaceSteps(db, flowId, [{ step_type: 'chime', config: {} }])

  db.prepare(`
    INSERT INTO schedules (title, target, scheduled_time, active, broadcast_type, flow_sequence_id, repeat_start_date, repeat_weekdays)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('테스트 예약', '전체', '09:00', 1, 'flow', flowId, '2026-08-25', '[]')

  const err = deleteFlow(db, flowId)
  assert.ok(err, '사용 중이면 에러 메시지가 반환되어야 한다')
  assert.match(err, /테스트 예약/)

  assert.ok(loadFlowWithSteps(db, flowId), '거부됐으면 흐름이 그대로 남아있어야 한다')
  const stillThere = db.prepare('SELECT * FROM schedules WHERE flow_sequence_id = ?').get(flowId)
  assert.ok(stillThere, '거부됐으면 예약도 그대로 남아있어야 한다')
})

test('deleteFlow: 사용하는 예약이 없으면 삭제되고 단계도 같이 지워진다', () => {
  const db = getDB()
  const flowId = insertFlow('미사용 흐름')
  replaceSteps(db, flowId, [{ step_type: 'delay', config: { wait_sec: 1 } }])

  const err = deleteFlow(db, flowId)
  assert.equal(err, null)
  assert.equal(loadFlowWithSteps(db, flowId), null)
  const remainingSteps = db.prepare('SELECT COUNT(*) c FROM flow_sequence_steps WHERE flow_sequence_id = ?').get(flowId)
  assert.equal(remainingSteps.c, 0, '단계도 같이 지워져야 한다')
})

// flowRunner 스모크 테스트 — tts/bgm/audio/chime은 외부 의존(파이썬 TTS, 오디오 하드웨어,
// 네트워크)이 있어 여기서는 다루지 않고(회귀 스모크는 수동 검증으로 커버), 외부 의존이 없는
// delay 단계 두 개로 "steps가 sort_order 순서대로 순차 실행되는지"만 확인한다.
test('flowRunner.runFlow: delay 단계들이 sort_order 순서대로 순차 실행된다(동시 실행 아님)', async () => {
  const db = getDB()
  const flowId = insertFlow('타이밍 테스트 흐름')
  replaceSteps(db, flowId, [
    { step_type: 'delay', config: { wait_sec: 0.2 } },
    { step_type: 'delay', config: { wait_sec: 0.2 } },
  ])

  const start = Date.now()
  await runFlow(db, flowId)
  const elapsed = Date.now() - start

  // 두 단계가 순차 실행되면 최소 0.4초 이상 걸려야 한다(동시/병렬이면 0.2초 근처에서 끝남)
  assert.ok(elapsed >= 380, `순차 실행이면 최소 380ms는 걸려야 하는데 ${elapsed}ms 소요됨`)
})

// 옛 'video'(외부 TV 송출) 단계는 2026-09-21 걷어냈다. 저장된 것이 남아 있어도(보정 전) 실행이 죽지 않는다.
test('runStep: 걷어낸 step_type="video" 는 에러 없이 조용히 끝난다', async () => {
  await runStep(getDB(), { step_type: 'video', config: { audio_file_id: 1 } })
})

test('runStep: step_type="video_file"이고 audio_file_id가 없으면 에러 없이 조용히 끝난다', async () => {
  await runStep(getDB(), { step_type: 'video_file', config: {} })
})

test('runStep: step_type="video_file"이고 업로드 영상 파일이면 재생시간만큼 대기한다(video_play SSE 경로)', async () => {
  const db = getDB()
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('misc-video', 'test.mp4', '테스트 업로드 영상', 0.1, now)

  const start = Date.now()
  await runStep(db, { step_type: 'video_file', config: { audio_file_id: result.lastInsertRowid } })
  const elapsed = Date.now() - start
  // durationMs = duration(0.1s)*1000 + 2000 = 2100ms —
  // 업로드 영상은 실제 재생시간만큼 대기해야 다음 단계가 겹치지 않는다
  assert.ok(elapsed >= 2000, `업로드 영상 재생시간만큼 대기해야 하는데 ${elapsed}ms만 소요됨`)
})

test('runStep: step_type="video_file"이고 config.playlist가 2개면 두 파일 재생시간을 모두 합쳐서 대기한다', async () => {
  const db = getDB()
  const now = new Date().toISOString()
  const r1 = db.prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('misc-video', 'a.mp4', '영상A', 0.1, now)
  const r2 = db.prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('misc-video', 'b.mp4', '영상B', 0.1, now)

  const start = Date.now()
  await runStep(db, { step_type: 'video_file', config: { playlist: [r1.lastInsertRowid, r2.lastInsertRowid] } })
  const elapsed = Date.now() - start
  // 파일당 대기시간 2100ms(0.1s*1000+2000) x 2개 = 최소 4200ms
  assert.ok(elapsed >= 4000, `재생목록 2개는 순차적으로 각자 재생시간만큼 대기해야 하는데 ${elapsed}ms만 소요됨`)
})

test('runStep: step_type="bgm"이고 config.playlist가 2곡이면 마지막이 아닌 곡만 duration_sec만큼 추가 대기한다', async () => {
  const db = getDB()
  // 곡이 있어야 BGM 이 풀린다 — 빈 폴더면 아무것도 안 틀고 넘어간다(아무거나 틀지 않는다)
  require('./helpers/localBgmFixture').로컬BGM심기(db)
  const start = Date.now()
  await runStep(db, {
    step_type: 'bgm',
    config: {
      playlist: [
        { bgm_type: 'local_broadcast', bgm_delay: 0.1, duration_sec: 0.3 },
        { bgm_type: 'local_meal', bgm_delay: 0.1, duration_sec: 0.3 },
      ],
    },
  })
  const elapsed = Date.now() - start
  // 1곡: bgm_delay(100ms) + duration_sec(300ms) = 400ms, 2곡(마지막): bgm_delay(100ms)만 = 100ms → 최소 500ms
  assert.ok(elapsed >= 450, `재생목록 첫 곡은 duration_sec만큼 추가 대기해야 하는데 ${elapsed}ms만 소요됨`)
})

test('runStep: opts.isCancelled가 true를 반환하면 delay 단계가 즉시 끝난다(정지 버튼 대응)', async () => {
  const start = Date.now()
  await runStep(getDB(), { step_type: 'delay', config: { wait_sec: 5 } }, { isCancelled: () => true })
  const elapsed = Date.now() - start
  assert.ok(elapsed < 500, `취소되면 5초를 기다리지 않고 즉시 끝나야 하는데 ${elapsed}ms 소요됨`)
})

test('runStep: opts.isCancelled 없이 호출하면(runFlow 경로) 기존처럼 끝까지 기다린다(회귀 없음)', async () => {
  const start = Date.now()
  await runStep(getDB(), { step_type: 'delay', config: { wait_sec: 0.3 } })
  const elapsed = Date.now() - start
  assert.ok(elapsed >= 280, `isCancelled 없으면 그대로 기다려야 하는데 ${elapsed}ms만 소요됨`)
})
