// 설정 읽기가 **실패했을 때** 무엇을 하는가 — 사용자가 2026-09-01에 정한 규칙.
//
// 그전에는 경로마다 달랐다. `domain/settingsRead`는 실패를 삼키고 null을 줬고,
// routes·services에 흩어진 사설 사본 12벌은 그대로 예외를 던졌다(= 화면 500, 방송 중단).
// 설정 하나를 못 읽었을 뿐인데 어떤 경로는 방송이 멈추고 어떤 경로는 안 멈췄다.
//
// 정한 것: **조용히 기본값으로 가되, 흔적은 남긴다.**
//   - 요양원에서 "설정 하나 때문에 방송이 안 나가는" 것이 더 위험하다.
//   - 다만 삼키기만 하면 잘못된 시각·문구로 나가는 것을 아무도 모른다. 그래서 로그를 남긴다.
//   - 발동부가 매분 돌므로 같은 키는 1분에 한 줄만 적는다(로그가 하루 1440줄이 되면 안 읽는다).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_setfail_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { rawSetting, rawSettings } = require('../domain/settingsRead')

// 조회가 반드시 실패하는 가짜 DB. WeakMap 키로 쓰이므로 매번 새 객체를 준다.
function brokenDb(message = 'database is locked') {
  return { prepare() { throw new Error(message) } }
}

function captureErrors(fn) {
  const orig = console.error
  const lines = []
  console.error = (...args) => { lines.push(args.join(' ')) }
  try { fn() } finally { console.error = orig }
  return lines
}

test('읽기가 실패해도 던지지 않는다 — 설정 하나 때문에 방송이 멈추면 안 된다', () => {
  const db = brokenDb()
  let got
  captureErrors(() => { got = rawSetting(db, '실패테스트_단건') })
  assert.equal(got, null, '실패는 "값이 없음"과 같게 다룬다')
})

test('여러 키를 한 번에 읽다 실패해도 던지지 않고, 요청한 키를 전부 null로 채워 준다', () => {
  const db = brokenDb()
  let got
  captureErrors(() => { got = rawSettings(db, ['실패테스트_A', '실패테스트_B']) })
  assert.equal(got.get('실패테스트_A'), null)
  assert.equal(got.get('실패테스트_B'), null)
  assert.ok(got.has('실패테스트_B'), '빠진 키가 있으면 호출부에서 undefined가 샌다')
})

test('실패는 조용히 넘어가되 로그에 남는다 — 삼키기만 하면 아무도 모른다', () => {
  const lines = captureErrors(() => rawSetting(brokenDb('디스크 오류'), '실패테스트_로그'))
  assert.equal(lines.length, 1, `로그가 ${lines.length}줄 — 실패가 흔적 없이 사라지면 안 된다`)
  assert.match(lines[0], /실패테스트_로그/, '어느 설정이 실패했는지 적혀야 고칠 수 있다')
  assert.match(lines[0], /디스크 오류/, '원인이 적혀야 한다')
})

test('같은 키가 계속 실패해도 1분에 한 줄만 — 매분 도는 발동부가 로그를 덮지 않게', () => {
  const lines = captureErrors(() => {
    for (let i = 0; i < 5; i++) rawSetting(brokenDb(), '실패테스트_반복')
  })
  assert.equal(lines.length, 1, `다섯 번 실패에 로그가 ${lines.length}줄 났다`)
})

test('[구조] settings 단건 조회를 스스로 만드는 getSetting 사본이 없다 — 실패 규칙이 다시 갈라지지 않게', () => {
  const FILES = [
    'routes/ai.js', 'routes/scheduleDrafts.js', 'routes/settings.js',
    // 2026-09-05에 settings.js에서 갈라져 나온 조각 — 목록에 안 넣으면 감시 밖으로 나간다
    'domain/broadcastScheduleRead.js',
    'routes/weather.js',
    'services/audioDeviceWatcher.js', 'services/bgmScheduler.js',
    // 2026-09-02: 방송 실행부 셋은 getSetting을 스스로 만들지 않고 domain/settingsRead에서
    // 가져다 쓴다(그 전에는 broadcastTokens.js라는 경유지를 거쳤다). 정의가 옮겨갔다고
    // 감시를 좁히면, getSetting을 스무 곳 넘게 쓰는 파일이 감시 밖으로 나간다 — 셋 다 본다.
    'services/broadcastSequencer.js', 'services/broadcastSteps.js',
    'services/calendar.js',
    'services/watchdog.js', 'services/weather.js',
  ]
  const offenders = []
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    // getSetting 정의부(함수 또는 화살표)에 db.prepare가 그대로 남아 있으면 사설 사본이다
    for (const m of src.matchAll(/getSetting\s*=?\s*(?:\([^)]*\)|function[^{]*)[^\n]*\n?[^\n]*/g)) {
      if (/prepare\(\s*['"]SELECT value FROM settings/.test(m[0])) offenders.push(rel)
    }
    // 다른 모듈에서 getSetting을 받아 쓰는 것은 사본이 아니다 — 위임은 통과시킨다.
    // 이 예외가 없으면 정의를 아래층으로 내린 파일이 전부 걸려서, 규칙을 가르치는 대신
    // 목록에서 빼고 싶어진다. 2026-09-01에 실제로 그렇게 뺐다가 되돌렸다.
    const 위임받음 = /\{[^}]*\bgetSetting\b[^}]*\}\s*=\s*require\(/.test(src)
    if (!위임받음 && /getSetting/.test(src) && !/rawSetting/.test(src)) offenders.push(`${rel}(rawSetting 미사용)`)
  }
  assert.deepEqual(offenders, [], `사설 사본이 남아 있다: ${offenders.join(', ')}`)
})
