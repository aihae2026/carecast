// 흐름(runFlow)이 정지·새 방송 취소를 모든 단계에서 관측하는지.
//
// 취소 세대(sinceGen) 가드가 음원 단계에만 있고 영상 단계 호출부에는 빠져 있었고,
// runFlow의 isCancelled는 예약 시각(앵커)만 봐서 차임/딜레이/TTS/BGM 대기와 자기
// 앵커(sleepUntil) 대기는 정지 버튼·새 방송 시작을 아예 관측하지 못했다 — 정지를 눌러도
// 대기를 끝까지 채우고 남은 단계를 새 방송 위로 진행했다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowcancel_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 실제 소리가 나지 않게 SSE를 스텁 — 이벤트를 기록하고, 주입된 훅을 불러 "재생 지시 직후
// 취소가 끼어드는" 틈을 재현한다 (cancel-race.test.js와 같은 기법)
const events = []
let onEvent = null
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, data) => { events.push(type); onEvent?.(type, data) },
    addClient: () => {}, clientCount: () => 0,
  },
}

// 차임 단계는 runStep 안에서 playChime(파이썬 차임)을 직접 불러 서버 스피커로 실제 소리를
// 낸다 — 테스트가 이 PC에서 차임을 울리지 않게 스텁한다(flow-integration.test.js와 같은 기법)
const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: { ...realChime, playChime: () => {} },
}

const { initDB, getDB } = require('../db/schema')
const seq = require('../services/broadcastSequencer')
const { runFlow } = require('../services/flowRunner')

let db
test.before(() => { initDB(); db = getDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function makeFlow(steps) {
  const { lastInsertRowid: flowId } =
    db.prepare("INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))").run(`테스트흐름-${Date.now()}-${Math.random()}`)
  steps.forEach((s, i) => {
    db.prepare('INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config) VALUES (?,?,?,?,?)')
      .run(flowId, i, s.step_type, s.label || s.step_type, JSON.stringify(s.config || {}))
  })
  return Number(flowId)
}

test.beforeEach(() => { events.length = 0; onEvent = null })

test('영상 단계: 재생 지시와 대기 등록 사이의 취소를 놓치지 않는다', async () => {
  const { lastInsertRowid: fileId } =
    db.prepare("INSERT INTO audio_files (category, filename, original_name, duration) VALUES ('영상','t.mp4','테스트영상',3)").run()
  const flowId = makeFlow([
    { step_type: 'video_file', config: { audio_file_id: Number(fileId) } },
    { step_type: 'chime' },
  ])
  // video_play가 나가는 바로 그 순간(등록 전) 다른 방송이 시작된다
  onEvent = (type) => { if (type === 'video_play') seq.cancelCurrentBroadcast() }

  const started = Date.now()
  await runFlow(db, flowId)
  const elapsed = Date.now() - started

  assert.ok(elapsed < 2000, `즉시 중단돼야 한다 — 상한(5초)까지 기다렸다: ${elapsed}ms`)
  assert.ok(!events.includes('chime_play'), '취소된 흐름이 다음 단계(차임)를 새 방송 위에 얹었다')
})

// 벽시계 타이머로 취소를 걸면 병렬 부하에서 레이스가 난다(6685880에서 배운 것) — 대신
// 첫 단계가 내는 SSE를 훅으로 잡아 그 자리에서 동기적으로 취소를 주입한다.
test('비미디어 단계(차임 대기·딜레이): 정지가 들어오면 남은 단계를 진행하지 않는다', async () => {
  const flowId = makeFlow([
    { step_type: 'chime' },                       // 재생 직후 3초 대기 — 이 대기 중에 정지가 온다
    { step_type: 'delay', config: { wait_sec: 5 } },
    { step_type: 'chime' },                       // 여기까지 오면 실패
  ])
  onEvent = (type) => { if (type === 'chime_play') seq.cancelCurrentBroadcast() }

  const started = Date.now()
  await runFlow(db, flowId)
  const elapsed = Date.now() - started

  // 전체 경로는 3+5+3=11초 — 첫 차임 대기(3초)를 다 못 채우고 끊겨야 한다
  assert.ok(elapsed < 2500, `정지 후 곧 끝나야 한다 — 대기를 끝까지 채웠다: ${elapsed}ms`)
  assert.equal(events.filter(t => t === 'chime_play').length, 1,
    '정지된 흐름이 딜레이를 지나 마지막 차임까지 진행했다')
})

test('자기 앵커(at_time) 대기 중에도 정지가 먹힌다', async () => {
  // 60배속 가상 시계 — 앵커를 가상 10분(실제 10초) 뒤에 둬서, 부하로 늦게 발화한
  // 취소 타이머도 반드시 앵커 대기 "도중"에 떨어지게 여유를 크게 잡는다
  //
  // **기준 시각을 낮 12시로 고정한다(2026-09-02).** 예전에는 `Date.now()`를 그대로 썼는데,
  // 앵커는 `at_time`에 **"시:분"만** 저장되고 실행부(flowRunner의 anchorTimeMs)는 그것을
  // **기준 시각과 같은 날**의 시:분으로 읽는다. 그래서 밤 23:50 이후에 돌리면 10분 뒤가
  // 다음 날이 되고, 실행부는 그것을 "오늘 00:0x"(이미 지난 시각)로 봐서 앵커를 기다리지
  // 않고 차임을 즉시 쏜다 — 이 테스트가 매일 밤 10분 동안 결정적으로 실패했다.
  // (2026-09-01 23:58에 3회 연속 재현. review/findings.csv의 CC-048이 이것을 "부하 때만"
  //  으로 적고 있었는데 틀린 진단이었다.) 가상 시계라 기준을 옮겨도 측정에는 영향이 없다 —
  // 벽시계로 재는 아래 예산은 실제 Date.now()를 쓴다.
  // 경과는 **실제 시작점**에서 잰다 — base를 그대로 빼면 낮 12시와 지금의 차이가
  // 60배로 부풀려져 가상 시계가 엉뚱한 날로 날아간다.
  const realStart = Date.now()
  const base = new Date().setHours(12, 0, 0, 0)
  const nowMs = () => base + (Date.now() - realStart) * 60
  const at = new Date(base + 600_000)
  const pad = n => String(n).padStart(2, '0')
  const flowId = makeFlow([
    { step_type: 'chime', config: { at_time: `${pad(at.getHours())}:${pad(at.getMinutes())}` } },
  ])
  setTimeout(() => seq.cancelCurrentBroadcast(), 100)

  const started = Date.now()
  const result = await runFlow(db, flowId, { nowMs })

  // **판정은 의미로 한다.** 예전엔 벽시계 8초 예산 하나로만 봤는데, 전체 스위트를 병렬로
  // 돌릴 때 그 예산을 넘겨 간헐 실패했다(CC-048). 제품에는 문제가 없는데 빨간불이 뜨면
  // 사람이 verify를 안 믿게 된다 — 그게 더 비싼 사고다.
  // runFlow가 결과를 돌려주게 된 뒤로(CC-003) 시계 없이 확인할 수 있다.
  assert.equal(result, 'cancelled', '정지가 먹혔으면 흐름은 취소로 끝나야 한다')
  assert.ok(!events.includes('chime_play'), '앵커 대기 중 정지됐는데 차임이 나갔다')

  // 벽시계는 "앵커까지 통째로 기다렸다"는 최악만 잡는 느슨한 그물로 남긴다.
  // 앵커는 실제 10초 뒤다(가상 10분 ÷ 60배속) — 9.5초를 넘겼다면 정지가 아예 안 먹은 것이다.
  assert.ok(Date.now() - started < 9500, '정지 후에도 앵커 시각까지 계속 기다렸다')
})
