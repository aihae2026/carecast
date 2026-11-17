// 흐름도 "정말 들렸나"를 본다 (P-51, 사용자 승인 2026-09-10).
//
// **무엇이 문제였나**: `finishScheduleFire` 11개 호출부 중 예약 5경로는 `hasSitePlayer()` 를
// 보는데 **흐름만 안 봤다**([FACT] EV-001494). 재생 창이 하나도 없어도 `completed` →
// `SUCCEEDED` 다 — 아무도 못 들은 방송이 이력에 성공으로 남는다.
//
// **그대로 복사하면 안 된다**: 흐름은 **서버 스피커 단계와 브라우저 단계가 섞인 컨테이너**다.
// `hasSitePlayer()` 를 그냥 얹으면 **차임만 있는 흐름이 멀쩡히 울리고도 실패로 적힌다.**
// 그래서 단계별 재생 주체로 가른다 — `domain/stepPlayer` 가 그 표의 단일 출처다.
//
// **판정 시점은 그 단계를 내보내는 순간이다.** 흐름은 수십 분 걸릴 수 있어, 끝난 뒤에
// 물으면 중간에 창이 닫혔다 다시 열린 경우를 놓친다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_flowdeliv_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 살아 있는 로컬 창 수를 이 변수로 조종한다 — 이 검사의 유일한 입력이다.
let 창수 = 0
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: () => 1, addClient: () => {}, clientCount: () => 창수,
    localClientCount: () => 창수, localAliveCount: () => 창수,
  },
}

// 차임은 실제로 안 울린다 — 성공 콜백만 준다(하드웨어 비활성과 같은 대우).
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true,
  exports: { playChime: (_t, _v, onDone) => { if (onDone) onDone(true) } },
}

// TTS 합성도 안 탄다.
const fakeTTS = async () => {
  const f = path.join(os.tmpdir(), `carecast_fd_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`)
  fs.writeFileSync(f, 'x')
  return f
}
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true,
  exports: { ...realTts, generateTTS: fakeTTS, generateTTSWithRetry: fakeTTS },
}

const { initDB, getDB } = require('../db/schema')
const { runFlow } = require('../services/flowRunner')
const { 재생주체, 화면이필요한가, 표 } = require('../domain/stepPlayer')

initDB()
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

let 흐름수 = 0
function 흐름만들기(steps) {
  const db = getDB()
  // 부모 행이 있어야 한다(외래키). 흐름 이름은 이 검사와 무관하다.
  const 지금 = new Date().toISOString()
  const id = Number(db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`배달진실시험${++흐름수}`, 지금, 지금).lastInsertRowid)
  let order = 0
  for (const s of steps) {
    db.prepare(
      'INSERT INTO flow_sequence_steps (flow_sequence_id, step_type, label, config, sort_order) VALUES (?,?,?,?,?)'
    ).run(id, s.step_type, s.label || s.step_type, JSON.stringify(s.config || {}), ++order)
  }
  return id
}

// ── 표 자체 — 기대값을 손으로 적는다(구현에서 가져오지 않는다) ──────────

test('단계별 재생 주체 표 — 승인된 기준을 손으로 적는다', () => {
  assert.equal(재생주체('chime'), '서버', '차임은 서버 스피커다(playChime)')
  assert.equal(재생주체('tts'), '브라우저')
  assert.equal(재생주체('audio'), '브라우저')
  // 'video'(외부 TV 송출)는 2026-09-21 걷어냈다 — 모르는 유형이 되어 「화면이 필요하다」 쪽으로 간다(아래 규칙)
  assert.equal(재생주체('video'), '모름')
  assert.equal(재생주체('video_file'), '브라우저')
  assert.equal(재생주체('bgm'), '브라우저')
  assert.equal(재생주체('delay'), '무음')
  assert.equal(재생주체('group'), '무음')
})

test('모르는 유형은 화면이 필요하다고 본다 — 새 유형이 조용히 빠져나가지 않게', () => {
  assert.equal(재생주체('언젠가생길유형'), '모름')
  assert.equal(화면이필요한가('언젠가생길유형'), true,
    '모르는 유형을 "창 없어도 성공"으로 두면 안 들린 방송이 성공으로 찍힌다')
})

test('차임·대기·묶음은 화면이 없어도 된다', () => {
  assert.equal(화면이필요한가('chime'), false)
  assert.equal(화면이필요한가('delay'), false)
  assert.equal(화면이필요한가('group'), false)
})

test('표가 헐거워지지 않았다 — 유형이 빠지면 모두 "모름"이 되어 전부 실패로 찍힌다', () => {
  for (const t of ['chime', 'tts', 'audio', 'video_file', 'bgm', 'delay', 'group']) {
    assert.ok(표[t], `${t} 이 표에서 빠졌다`)
  }
})

// ── 실제 흐름 실행 ──────────────────────────────────────────────────────

test('P-51: 창이 없으면 브라우저 단계가 있는 흐름은 실패로 정산된다', async () => {
  창수 = 0
  const id = 흐름만들기([{ step_type: 'tts', config: { content: '안내입니다.' } }])
  const r = await runFlow(getDB(), id)
  assert.equal(r, 'completed_no_player',
    `${r} 를 돌려줬다 — 아무도 못 들은 방송이 성공으로 남는다`)
})

test('P-51: 차임만 있는 흐름은 창이 없어도 성공이다 — 서버 스피커로 나갔다', async () => {
  창수 = 0
  const id = 흐름만들기([{ step_type: 'chime', config: {} }])
  const r = await runFlow(getDB(), id)
  assert.equal(r, 'completed',
    `${r} 로 적혔다 — 멀쩡히 울린 차임을 실패로 적으면 사람이 이력을 안 믿는다`)
})

test('P-51: 창이 있으면 브라우저 단계도 예전 그대로 성공이다', async () => {
  창수 = 1
  const id = 흐름만들기([{ step_type: 'tts', config: { content: '안내입니다.' } }])
  assert.equal(await runFlow(getDB(), id), 'completed', '창이 있는데 실패로 적었다')
})

test('P-51: 대기·묶음만 있는 흐름은 창과 무관하다', async () => {
  창수 = 0
  const id = 흐름만들기([
    { step_type: 'group', config: {} },
    { step_type: 'delay', config: { wait_sec: 0 } },
  ])
  assert.equal(await runFlow(getDB(), id), 'completed')
})

test('P-51: 섞인 흐름은 브라우저 단계 하나만 못 나가도 실패다', async () => {
  창수 = 0
  const id = 흐름만들기([
    { step_type: 'chime', config: {} },                              // 이건 나갔다
    { step_type: 'tts', config: { content: '안내입니다.' } },         // 이건 아무도 못 들었다
  ])
  assert.equal(await runFlow(getDB(), id), 'completed_no_player',
    '한 단계라도 아무도 못 들었으면 그 방송은 온전히 나간 것이 아니다')
})

test('실패 사유가 이력에 남는다 — "실패" 두 글자로는 아무도 못 고친다', () => {
  // **문구가 사는 자리가 바뀌었다**(P-34, 2026-09-11). 예전엔 `scheduler.js` 안에 세 갈래를
  // 적고 나머지를 한 줄로 뭉갰는데, 그 뭉갬을 풀면서 문구를 `domain/broadcastOutcome` 의
  // `흐름사유문구()` 한 곳으로 옮겼다. **가드도 같은 커밋에서 따라 옮긴다**(CLAUDE.md
  // "파일을 가를 때 — 가드는 따라 옮긴다"). 지키려는 것은 그대로다:
  // *실패 사유가 사람이 읽을 말로 이력에 남는가.*
  const { 흐름사유문구 } = require('../domain/broadcastOutcome')
  assert.match(흐름사유문구('completed_no_player'), /재생할 창이 없어/, '사유 문구가 없다')
  assert.match(흐름사유문구('completed_no_player'), /서버 스피커 단계는 나갔습니다/,
    '무엇이 나가고 무엇이 안 나갔는지 안 알려준다 — 사람이 차임까지 죽은 줄 안다')

  // **긍정 앵커**: 스케줄러가 그 단일 출처를 실제로 부르는가. 이게 없으면 문구만 살아 있고
  // 아무도 안 쓰는 상태에서도 위 두 줄이 통과한다(조용한 초록).
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  const LF = String.fromCharCode(10)
  const 본문 = src.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  assert.match(본문, /흐름사유문구\(result\)/, '스케줄러가 사유를 안 붙인다 — 이력에 "실패" 두 글자만 남는다')
  assert.match(본문, /settleFlowLog\(db, logId, result,/, '흐름 이력을 정산하는 자리가 없다')
})
