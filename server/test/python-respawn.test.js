// ISSUE-003 — 파이썬이 `0xC0000142` 로 죽으면 그 경로를 버리고 다시 찾는다
//
// 무엇이 문제였나: 차임이 `0xC0000142`(STATUS_DLL_INIT_FAILED — 프로세스 **생성** 실패)로
// 계속 실패하는데 **서버를 재시작하면 낫는다**. 처음엔 "오래 돌면 자원을 잃는다"로 읽었으나
// 102분·336분 서버에서 반증됐다([FACT] EV-000479·EV-001074).
//
// 진짜 이유는 캐시다. `tts.js` 는 파이썬을 **한 번 찾아 `PYTHON_PATH` 에 넣고 프로세스가 죽을
// 때까지 그것만 쓴다**(`resolvePython:59` — `if (PYTHON_PATH) return PYTHON_PATH`). 그래서 그
// 경로가 못 쓰게 되면(래퍼·스텁·이동·권한 변화) **재시작 전까지 영영 실패**한다. "재시작하면
// 낫는다"는 증상이 정확히 이 구조에서 나온다.
//
// 같은 파일 `:14` 주석이 이미 이 오류 코드를 Windows Store 파이썬 스텁과 잇는다. 그런데 필터는
// 경로에 `WindowsApps` 가 들어 있는지만 본다(`:17`) — 실패한 PC 의 파이썬은
// `AppData\Local\Python\bin\python.exe` 라 **필터를 통과했다**(`ISSUES.md:255`).
//
// 그래서 필터를 넓히는 대신 **회복 경로**를 만든다: 그 종료코드로 죽으면 캐시를 버린다.
// 다음 호출이 다시 찾으므로 재시작이 필요 없다. **실패했을 때만 도는 코드**라 정상 경로를
// 건드리지 않는다 — 재현이 안 되는 상태에서 고르기에 가장 안전한 형태다.
'use strict'

const path = require('path')
const fs   = require('fs')

const test   = require('node:test')
const assert = require('node:assert/strict')

const os = require('os')
const TTS_PATH = require.resolve('../services/tts')

// findPython 은 후보 경로가 **실제로 있는지** 검사한다(tts.js:17 `fs.existsSync`). 그래서 가짜
// 경로로는 시험이 안 된다 — 존재하는 빈 파일 둘을 만들어 "첫 번째"와 "두 번째"로 쓴다.
const 첫경로 = path.join(os.tmpdir(), `carecast_test_py_first_${process.pid}.exe`)
const 둘째경로 = path.join(os.tmpdir(), `carecast_test_py_second_${process.pid}.exe`)
for (const p of [첫경로, 둘째경로]) { try { fs.writeFileSync(p, '') } catch { /* 있으면 그대로 */ } }

// tts.js 는 최상단에서 execSync 를 구조분해로 잡는다. 그래서 **require 하기 전에** 갈아끼우면
// 그 모듈은 이후에도 스텁을 쓴다 — 실제 파이썬 탐색이 한 번도 돌지 않는다.
let 탐색결과 = 첫경로
function 스텁execSync(cmd) {
  if (/^where |^which /.test(String(cmd))) {
    if (!탐색결과) throw new Error('not found')   // where 가 못 찾으면 0이 아닌 종료 → throw
    return Buffer.from(탐색결과 + '\n')
  }
  return Buffer.from('')            // --version, import 옛 합성 모듈 등은 성공한 셈 친다
}

function freshTTS({ found = 첫경로 } = {}) {
  탐색결과 = found
  delete require.cache[TTS_PATH]
  const cp = require('child_process')
  cp.execSync = 스텁execSync         // 되돌리지 않는다 — tts.js 가 로드 시 잡은 참조를 계속 써야 한다
  return require('../services/tts')
}

const 진짜execSync = require('child_process').execSync
test.after(() => {
  require('child_process').execSync = 진짜execSync
  delete require.cache[TTS_PATH]
  for (const p of [첫경로, 둘째경로]) { try { fs.unlinkSync(p) } catch { /* 없으면 무시 */ } }
})

test('ISSUE-003: 0xC0000142 를 두 표현 모두로 알아본다 — Node 가 부호를 다르게 준다', () => {
  const tts = freshTTS()
  assert.equal(typeof tts.isDllInitFailure, 'function',
    'isDllInitFailure 가 없다 — 종료코드를 알아보는 자리가 있어야 회복을 걸 수 있다')
  assert.equal(tts.isDllInitFailure(3221225794), true, '부호 없는 표현(3221225794)을 못 알아본다')
  assert.equal(tts.isDllInitFailure(-1073741502), true, '부호 있는 표현(-1073741502)을 못 알아본다')
  assert.equal(tts.isDllInitFailure(0), false, '정상 종료(0)를 실패로 본다')
  assert.equal(tts.isDllInitFailure(1), false, '평범한 실패(1)까지 이 회복을 태우면 안 된다')
  assert.equal(tts.isDllInitFailure(null), false, 'null 을 실패로 본다')
})

test('ISSUE-003: 경로를 버리면 다음 호출이 다시 찾는다 — 재시작 없이 회복한다', () => {
  const tts = freshTTS({ found: 첫경로 })
  assert.equal(tts.ensurePythonPath(), 첫경로, '전제: 처음 찾은 경로가 잡혀야 한다')

  assert.equal(typeof tts.invalidatePythonPath, 'function', 'invalidatePythonPath 가 없다')
  assert.equal(tts.invalidatePythonPath('시험'), true, '캐시가 있는데 버렸다고 알리지 않는다')

  // 이제 다른 경로가 잡혀야 한다. 안 바뀌면 캐시가 안 비워진 것이다.
  탐색결과 = 둘째경로
  assert.equal(tts.ensurePythonPath(), 둘째경로,
    '캐시를 버렸는데도 옛 경로가 나온다 — 재시작해야만 낫는 그 상태 그대로다')
})

test('ISSUE-003: 버릴 캐시가 없으면 조용히 아무 일도 안 한다', () => {
  const tts = freshTTS({ found: '' })      // 아무것도 못 찾은 상태
  assert.equal(tts.invalidatePythonPath('시험'), false, '없는 캐시를 버렸다고 말하면 로그가 거짓이 된다')
})

test('ISSUE-003: 재탐색 유예도 함께 푼다 — 5분을 기다리면 그 방송은 이미 끝났다', () => {
  // 못 찾은 결과를 5분 기억하는 유예가 있다(tts.js:55 PYTHON_RETRY_MS). 그 유예가 살아 있으면
  // 캐시를 버려도 다음 호출이 null 을 돌려준다 — 회복이 5분 늦는다.
  const tts = freshTTS({ found: '' })
  assert.equal(tts.ensurePythonPath(), null, '전제: 못 찾으면 null 이고 유예가 걸린다')

  탐색결과 = 둘째경로
  assert.equal(tts.ensurePythonPath(), null, '전제: 유예 안에서는 다시 안 찾는다')

  // 여기서 버릴 캐시는 없다(null 이었다). 그래도 **유예는 풀려야** 한다 —
  // 안 그러면 파이썬이 살아 돌아와도 5분간 못 찾는다.
  tts.invalidatePythonPath('시험')
  assert.equal(tts.ensurePythonPath(), 둘째경로,
    '캐시를 버렸는데 유예 때문에 못 찾는다 — 그 사이 방송이 나가야 하는데 5분을 기다린다')
})

test('ISSUE-003: 파이썬을 쓰는 경로는 캐시가 비면 **다시 찾는다** — 안 그러면 버린 뒤 아무도 못 쓴다', () => {
  // 독립 검수(EV-001097)가 잡은 결함이다. 캐시를 버리는 것까지는 됐는데, 차임은 캐시만 읽는
  // getPythonPath() 를 써서 **버린 다음 차임이 재탐색 없이 그냥 실패**했다(spawn 0회, where 0회).
  // 회복이 "다른 기능이 우연히 TTS 를 부를 때까지" 미뤄졌고, 그 사이 즉시방송·마이크까지 같이 죽는다.
  //
  // 그래서 파이썬을 spawn 하는 소비자 셋은 전부 ensurePythonPath()(= 없으면 찾는다) 를 써야 한다.
  // getPythonPath() 는 순수 조회용으로 남는다.
  for (const f of ['chimePlayer.js', 'audioQueue.js', 'audioPlayer.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8')
    const 줄 = src.split('\n').filter((l) => /require\('\.\/tts'\)\.(get|ensure)PythonPath\(\)/.test(l))
    assert.equal(줄.length, 1, `${f}: 파이썬 경로를 얻는 줄이 하나여야 한다. 실제 ${줄.length}`)
    assert.match(줄[0], /ensurePythonPath\(\)/,
      `${f}: 캐시만 읽는다(getPythonPath) — 경로를 버린 뒤 스스로 회복하지 못한다(ISSUE-003 검수 EV-001097)`)
  }
})

test('ISSUE-003 배선: 차임 재생이 그 종료코드로 죽으면 경로를 버린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'chimePlayer.js'), 'utf8')
  const i = src.indexOf('function playViaWaveOut')
  assert.ok(i >= 0, '전제: playViaWaveOut 이 있어야 한다')
  const 본문 = src.slice(i, i + 700)
  assert.match(본문, /isDllInitFailure/,
    '차임이 0xC0000142 로 죽어도 파이썬 경로를 안 버린다 — 재시작 전까지 계속 실패한다(ISSUE-003)')
  assert.match(본문, /invalidatePythonPath/, '알아보기만 하고 버리지 않는다')
})
