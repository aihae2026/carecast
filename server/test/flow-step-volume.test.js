// 흐름(FlowBuilder) 단계별 볼륨이 실제 재생 지점(SSE 페이로드)까지 도달하는지 확인한다.
//
// 소리를 내지 않는 방법은 auto-broadcast-volume.test.js와 같다 — sse.js와 chimePlayer.js를
// require.cache에 미리 심어 페이로드만 가로챈다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowvol_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const chimes = []

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    ...realChime,
    playChime: (type, volumePct) => { chimes.push({ type, volumePct }) },   // 스피커를 울리지 않는다
  },
}

const { initDB, getDB } = require('../db/schema')
const { FLOW_STEP_CHANNEL, flowStepChannel, readVolume } = require('../domain/volume')
const { runStep } = require('../services/flowRunner')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('차임벨 단계의 볼륨이 실제 재생 인자와 SSE에 실린다', async () => {
  sent.length = 0; chimes.length = 0
  await runStep(getDB(), { step_type: 'chime', config: { volume: 35 } })

  assert.equal(chimes.length, 1, '차임벨이 울리지 않았다')
  assert.equal(chimes[0].volumePct, 35, '서버 스피커에 볼륨이 안 넘어갔다')

  const ev = sent.find(e => e.type === 'chime_play')
  assert.equal(ev?.payload.volume, 35, 'SSE에 볼륨이 안 실렸다')
})

test('볼륨을 지정하지 않으면 시스템 기본값이 실린다', async () => {
  sent.length = 0; chimes.length = 0
  const sysTts = readVolume(getDB(), 'tts')
  await runStep(getDB(), { step_type: 'chime', config: {} })
  assert.equal(chimes[0].volumePct, sysTts)
})

test('0은 무음이라는 유효한 값이다', async () => {
  sent.length = 0; chimes.length = 0
  await runStep(getDB(), { step_type: 'chime', config: { volume: 0 } })
  assert.equal(chimes[0].volumePct, 0,
    '0을 falsy로 취급해 기본값으로 되돌리면, 꺼둔 단계가 갑자기 소리를 낸다')
})

test('음원 단계의 볼륨이 prayer_play에 실린다', async () => {
  const db = getDB()
  db.prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('bgm', 'x.mp3', '테스트 음원', 1)
  `).run()
  const id = db.prepare("SELECT id FROM audio_files WHERE filename = 'x.mp3'").get().id

  sent.length = 0
  await runStep(db, { step_type: 'audio', config: { playlist: [id], volume: 44 } })
  const ev = sent.find(e => e.type === 'prayer_play')
  assert.ok(ev, 'prayer_play가 나가지 않았다')
  assert.equal(ev.payload.volume, 44)
})

test('대기 단계는 볼륨 채널이 없다 — 소리가 없는 단계에 볼륨을 묻지 않는다', () => {
  assert.equal(flowStepChannel('delay'), null)
})



// ── 드리프트 방어 ─────────────────────────────────────────────
test('화면의 볼륨 필드 목록이 서버의 채널 목록과 같은 집합이다', () => {
  // 화면에만 있으면 값이 저장돼도 방송은 기본값으로 나가고(조용한 무동작),
  // 서버에만 있으면 아무도 값을 넣을 수 없다.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'FlowBuilder.jsx'), 'utf8')
  const open = src.indexOf('const STEP_VOLUME_FIELD = {')
  assert.notEqual(open, -1, 'FlowBuilder에서 STEP_VOLUME_FIELD를 찾지 못했다')
  const block = src.slice(open, src.indexOf('}', open))

  const uiTypes = []
  // **주석 줄을 먼저 걷는다**(2026-09-13 고침). 그전에는 `:` 만 보고 열쇠로 삼았는데,
  // 그 표에 설명 주석이 붙자 «// 쓰임» 같은 것이 단계 이름으로 잡혀 빨간불이 났다 —
  // 코드가 틀린 것이 아니라 이 검사의 읽는 법이 허술했다.
  for (const line of block.split(String.fromCharCode(10)).slice(1)) {
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    const colon = t.indexOf(':')
    if (colon === -1) continue
    const key = t.slice(0, colon).trim()
    if (key) uiTypes.push(key)
  }

  assert.deepEqual(uiTypes.sort(), Object.keys(FLOW_STEP_CHANNEL).sort(),
    '화면과 서버의 볼륨 대상 단계 목록이 어긋났다')
})

test('BGM 단계만 다른 필드(bgm_volume)를 쓴다', () => {
  assert.equal(FLOW_STEP_CHANNEL.bgm, 'bgm')
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'FlowBuilder.jsx'), 'utf8')
  assert.ok(src.includes("bgm:        'bgm_volume'"),
    'BGM 단계가 bgm_volume을 쓰지 않는다 — flowRunner는 그 이름으로 읽는다')
})
