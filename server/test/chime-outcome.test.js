// ISSUE-002: 차임벨 예약이 재생 결과와 무관하게 이력에 성공(success=1)으로 기록되던 문제.
//
// playChime()은 재생 결과를 몰랐다(반환값도 콜백도 없었다) — scheduler는 playChime을 부른
// 직후 곧바로 finishScheduleFire(delivered 기본값 true)를 호출해 success=1을 무조건 적었다.
// 재현: tests/audit/repro-issue-002.cjs(EV-000113, 고치기 전 success=1 확인).
//
// 1회차(2026-09-06 이전)는 "SUCCEEDED로 먼저 적고 실패만 내리는" 낙관적 정정이었다. 독립
// 검수가 지적한 결함: **콜백이 영영 안 오는 경로(서버 강제종료·정전·autoUpdate 재시작)에서
// 그 행이 성공으로 굳는다** — 기동 회수(flowOutcome.recoverInterrupted)는 RUNNING
// 상태만 대상으로 보기 때문이다. 이 형태는 domain/broadcastOutcome.js:8-10이 "그래서 세 번째
// 상태를 만든다"고 명시해 없앤 바로 그 문제(CC-003)의 재발이다.
//
// 2회차(B안, 지금): 차임도 흐름과 같은 규약을 쓴다 — playChime에 선택적 onDone(ok) 콜백을
// 넘기는 계약은 그대로 두고(기존 호출자 넷은 안 넘기므로 그대로 동작), scheduler의 chime
// 분기는 finishScheduleFire(..., RUNNING)으로 먼저 적은 뒤 flowOutcome.settleLog로
// RUNNING → SUCCEEDED/FAILED를 확정한다. 콜백이 안 오면 RUNNING으로 남고, 기동 시
// recoverInterrupted()가 FAILED로 회수한다. UPDATE 문은 flowOutcome.js 한 곳뿐이다
// (settleFlowLog도 같은 함수를 쓴다).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')

// ── A. chimePlayer.playChime의 onDone 계약 ──────────────────────────────────

const CHIME_PATH = require.resolve('../services/chimePlayer')
const HW_PATH     = require.resolve('../services/hardwareMode')
const TTS_PATH    = require.resolve('../services/tts')

// 상주 플레이어는 「준비 안 됨」으로 막는다(2026-09-22) — 임시 폴더에 차임 파형 캐시가 남아 있으면 playChime 이
// 상주 플레이어 길로 가서, 가짜 spawn 과 부딪혀 시험이 끝난 뒤 오류가 났다(캐시가 없던 날엔 통과). 이 시험이 보는
// 것은 예전 길(재생 프로세스 종료코드 → onDone)이다 — 캐시가 있든 없든 같은 길을 타게 한다.
const PLAYER_PATH = require.resolve('../services/audioPlayer')
function freshChimePlayer({ hardwareDisabled, getPythonPath }) {
  delete require.cache[CHIME_PATH]
  require.cache[PLAYER_PATH] = { id: PLAYER_PATH, filename: PLAYER_PATH, loaded: true, exports: { playPcm16: () => false } }
  require.cache[HW_PATH] = {
    id: HW_PATH, filename: HW_PATH, loaded: true,
    exports: { hardwareDisabled: () => hardwareDisabled, noticeOnce: () => {} },
  }
  require.cache[TTS_PATH] = {
    id: TTS_PATH, filename: TTS_PATH, loaded: true,
    // ensurePythonPath 도 같이 준다 — chimePlayer 가 2026-09-07(ISSUE-003)부터 이쪽을 쓴다.
    // 캐시만 읽던 것을 "없으면 찾는다"로 바꿨기 때문이다. 이 테스트의 관심사는 onDone 계약이라
    // 두 함수가 같은 값을 주면 된다.
    exports: { getPythonPath, ensurePythonPath: getPythonPath },
  }
  return require('../services/chimePlayer')
}

function cleanupStubs() {
  delete require.cache[PLAYER_PATH]
  delete require.cache[HW_PATH]
  delete require.cache[TTS_PATH]
  delete require.cache[CHIME_PATH]
}

test('하드웨어 접근 없음 모드에서는 onDone(true) — 안 낸 것은 실패가 아니다', () => {
  const { playChime } = freshChimePlayer({ hardwareDisabled: true, getPythonPath: () => '/usr/bin/python3' })
  try {
    let got
    playChime('general', 50, (ok) => { got = ok })
    assert.equal(got, true, 'hardwareDisabled에서 onDone이 안 불렸거나 false로 불렸다')
  } finally {
    cleanupStubs()
  }
})

test('python을 못 찾으면 onDone(false)', () => {
  const { playChime } = freshChimePlayer({ hardwareDisabled: false, getPythonPath: () => null })
  try {
    let got
    playChime('general', 50, (ok) => { got = ok })
    assert.equal(got, false, 'python 미탐지인데 onDone이 실패로 안 왔다')
  } finally {
    cleanupStubs()
  }
})

test('onDone을 안 넘기는 기존 호출자는 그대로 동작한다(하위 호환) — hardwareDisabled', () => {
  const { playChime } = freshChimePlayer({ hardwareDisabled: true, getPythonPath: () => '/usr/bin/python3' })
  try {
    assert.doesNotThrow(() => playChime('general', 50), '콜백 없이 불러도 던지면 안 된다(기존 호출자 다섯)')
  } finally {
    cleanupStubs()
  }
})

test('onDone을 안 넘기는 기존 호출자는 그대로 동작한다(하위 호환) — python 미탐지', () => {
  const { playChime } = freshChimePlayer({ hardwareDisabled: false, getPythonPath: () => null })
  try {
    assert.doesNotThrow(() => playChime('general', 50))
  } finally {
    cleanupStubs()
  }
})

// spawn을 흉내 내 재생 프로세스의 종료코드를 직접 통제한다 — 실제 python/오디오 장치가
// 없어도, 플랫폼(win32/그 외)과 무관하게 성공·실패 두 경로를 결정적으로 재현한다.
//
// chimePlayer.js는 파일 맨 위에서 `const { spawn } = require('child_process')`로
// **require 시점에** 참조를 떼어 간다(chimePlayer.js:1). 그래서 spawn을 먼저 바꿔치기한
// 뒤에 chimePlayer를 (다시) require해야 그 바꿔치기가 실제로 먹는다 — 순서가 바뀌면
// chimePlayer는 여전히 진짜 spawn을 들고 있어 존재하지 않는 'fake-python'을 실행하려다
// ENOENT로 죽고, 그 우연한 실패가 "종료코드 1" 기대와 겹쳐 조용히 통과해 버린다.
function withFakeSpawn(exitCode, fn) {
  const cp = require('child_process')
  const { EventEmitter } = require('events')
  const origSpawn = cp.spawn
  cp.spawn = () => {
    const fake = new EventEmitter()
    fake.kill = () => {}
    process.nextTick(() => fake.emit('close', exitCode))
    return fake
  }
  return fn().finally(() => { cp.spawn = origSpawn })
}

test('재생 프로세스가 종료코드 0이면 onDone(true)', async () => {
  await withFakeSpawn(0, async () => {
    const { playChime } = freshChimePlayer({ hardwareDisabled: false, getPythonPath: () => 'fake-python' })
    try {
      const ok = await new Promise((resolve) => { playChime('general', 50, resolve) })
      assert.equal(ok, true, '종료코드 0인데 onDone(false)가 왔다')
    } finally {
      cleanupStubs()
    }
  })
})

test('재생 프로세스가 종료코드 1이면 onDone(false) — ISSUE-001의 실패가 이제 값으로도 드러난다', async () => {
  await withFakeSpawn(1, async () => {
    const { playChime } = freshChimePlayer({ hardwareDisabled: false, getPythonPath: () => 'fake-python' })
    try {
      const ok = await new Promise((resolve) => { playChime('general', 50, resolve) })
      assert.equal(ok, false, '종료코드 1인데 onDone(true)가 왔다')
    } finally {
      cleanupStubs()
    }
  })
})

// ── B. scheduler의 chime 분기 — 이력 정정 ────────────────────────────────────

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_chime_outcome_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

let chimeOnDone = null   // 이번 호출에서 scheduler가 넘긴 콜백을 잡아 둔다
const chimeCalls = []
require.cache[CHIME_PATH] = {
  id: CHIME_PATH, filename: CHIME_PATH, loaded: true,
  exports: {
    playChime: (type, volumePct, onDone) => { chimeCalls.push({ type, volumePct }); chimeOnDone = onDone },
    resolveChimeVolume: () => 0.8,
  },
}

const { initDB, getDB } = require('../db/schema')
const { fireSchedule }  = require('../services/scheduler')
const { RUNNING, SUCCEEDED, FAILED } = require('../domain/broadcastOutcome')
const { recoverInterrupted } = require('../services/flowOutcome')

test.before(() => { initDB() })

test.after(() => {
  delete require.cache[CHIME_PATH]
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

let seq = 0
function makeChimeSchedule() {
  const title = `차임정산테스트${++seq}`
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', '[]', 'chime')
  `).run(title).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

function lastLogFor(title) {
  return getDB().prepare('SELECT * FROM broadcasts WHERE content LIKE ? ORDER BY id DESC LIMIT 1').get(`${title}%`)
}

// 이 테스트는 흐름과 같은 규약을 확인한다 — 발사 즉시는 RUNNING(2)이고, playChime의 콜백이
// 오면 SUCCEEDED/FAILED로 확정된다. 콜백을 안 부르는 옛 스텁을 쓰는 다른 파일
// (delivery-truth.test.js)은 스텁이 onDone(true)를 부르도록 이번 수정과 같은 커밋에서
// 함께 고쳤다 — 그러지 않으면 그 파일의 차임 행이 RUNNING에 멈춰 그 테스트들이 깨진다.
test('차임벨 발사 즉시는 RUNNING(진행 중)으로 남는다(재생 결과는 비동기 콜백으로 온다)', async () => {
  chimeOnDone = null
  const s = makeChimeSchedule()
  await fireSchedule(s, getDB())

  const row = lastLogFor(s.title)
  assert.ok(row, '이력 행이 없다')
  assert.equal(row.success, RUNNING, '발사 직후 이력이 RUNNING(2)이 아니다 — ISSUE-002(2회차)')
  assert.ok(chimeOnDone, 'scheduler가 playChime에 onDone 콜백을 안 넘겼다 — ISSUE-002 수정이 빠졌다')
})

test('재생이 나중에 실패로 확인되면(onDone(false)) 이력이 실패로 정정된다', async () => {
  chimeOnDone = null
  const s = makeChimeSchedule()
  await fireSchedule(s, getDB())
  assert.equal(lastLogFor(s.title).success, RUNNING, '정정 전에는 아직 RUNNING이어야 한다')

  assert.ok(chimeOnDone, 'onDone 콜백을 못 받았다')
  chimeOnDone(false)   // 재생 프로세스가 실제로 실패했다고 지금 알려온다

  const row = lastLogFor(s.title)
  assert.equal(row.success, FAILED, '차임벨이 실제로 실패했는데 이력이 진행 중/성공이다 — ISSUE-002')
  assert.match(row.content, /실패/, '실패 사유가 이력 내용에 안 남았다')
})

test('재생이 성공으로 확인되면(onDone(true)) 이력이 SUCCEEDED로 정정된다', async () => {
  chimeOnDone = null
  const s = makeChimeSchedule()
  await fireSchedule(s, getDB())
  assert.equal(lastLogFor(s.title).success, RUNNING, '정정 전에는 아직 RUNNING이어야 한다')

  chimeOnDone(true)

  assert.equal(lastLogFor(s.title).success, SUCCEEDED, '성공 확인인데 SUCCEEDED로 안 바뀌었다')
})

// 검수가 지적한 결함(1회차)의 재발 방지: 콜백이 영영 안 오면(서버 강제종료·정전·autoUpdate
// 재시작) 이 행은 RUNNING으로 남아야 하고, 기동 시 recoverInterrupted()가 그
// 행을 FAILED로 회수해야 한다. 1회차(SUCCEEDED로 먼저 적음)는 이 회수 대상에서 빠져 성공
// 으로 굳었다.
test('콜백이 영영 안 오면 RUNNING으로 남고, recoverInterrupted가 FAILED로 회수한다', async () => {
  chimeOnDone = null
  const s = makeChimeSchedule()
  await fireSchedule(s, getDB())

  const before = lastLogFor(s.title)
  assert.equal(before.success, RUNNING, '콜백이 오기 전이라 RUNNING이어야 한다')

  // chimeOnDone을 고의로 호출하지 않는다 — 콜백이 영영 안 오는 상황(서버 강제종료 등)을 흉내낸다
  // recoverInterrupted()의 반환 건수는 단언하지 않는다 — 파일 전체 실행에서는 앞 테스트가
  // 남긴 RUNNING 행까지 함께 회수되므로 건수만으로는 이 행의 회수 여부를 증명하지 못한다
  // (자기 행 검증은 아래 lastLogFor 두 줄).
  recoverInterrupted(getDB())

  const after = lastLogFor(s.title)
  assert.equal(after.success, FAILED, '기동 회수 뒤에도 RUNNING으로 남아 있다 — ISSUE-002(2회차)')
  assert.match(after.content, /서버가 꺼져 중단됨/, '회수 사유가 이력에 안 남았다')
})

// ── C. 소스 대조: 콜백 배선이 조용히 사라지지 않았는지(긍정 앵커 포함) ──────────

test('scheduler.js의 chime 분기가 RUNNING으로 먼저 적고 콜백으로 정산한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  const start = src.indexOf(`if (broadcastType === 'chime')`)
  assert.ok(start >= 0, `broadcastType === 'chime' 분기를 못 찾았다 — 이름이 바뀌었거나 옮겨졌다`)
  const nextBranch = src.indexOf(`if (broadcastType === 'audio')`, start)
  assert.ok(nextBranch > start, '다음 분기(audio)를 못 찾아 chime 분기 범위를 못 잘랐다')
  const body = src.slice(start, nextBranch)

  // 긍정 앵커: playChime 호출이 실제로 이 안에 있다
  assert.match(body, /playChime\(/, 'chime 분기에서 playChime 호출을 못 찾았다')
  assert.match(body, /playChime\([^)]*,\s*\([^)]*\)\s*=>/, 'playChime에 콜백(3번째 인자)을 안 넘긴다')
  assert.match(body, /finishScheduleFire\([^)]*RUNNING\)/,
    'chime 분기가 RUNNING으로 먼저 적지 않는다 — 흐름과 다른 규약이다(ISSUE-002 2회차)')
  assert.match(body, /settleLog\(/, 'chime 분기가 flowOutcome.settleLog를 안 쓴다 — 실패가 이력에 안 남는다')
})
