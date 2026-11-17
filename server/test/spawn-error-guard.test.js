// 자식 프로세스 실행 실패가 서버 전체를 죽이지 않는지.
//
// 왜 필요했나: ChildProcess의 'error' 이벤트에 리스너가 없으면 EventEmitter 규약에 따라
// 그대로 던져진다. 이 서버에는 uncaughtException 핸들러도 없어서, spawn 한 번이 실패하면
// **서버 프로세스 전체가 종료된다.** 2026-08-29 리뷰에서 Node v24.19.0으로 재현했다:
//
//   $ node -e "const {spawn}=require('child_process'); const p=spawn('없는명령',[]); p.on('close',()=>{})"
//   Emitted 'error' event on ChildProcess instance at:
//     errno: -4058, code: 'ENOENT', syscall: 'spawn 없는명령'
//   Node.js v24.19.0        ← 프로세스 즉시 종료
//
// 현장에서 어떻게 닿는가: Windows 업데이트나 재설치로 Python 경로가 바뀌면 tts.js가 부팅 때
// 캐시해 둔 옛 경로로 spawn한다(PYTHON_PATH는 setImmediate에서 한 번만 잡힌다). 차임벨이
// 울릴 때마다 spawn하므로 그 순간 서버가 죽고, 진행 중이던 방송 시퀀스가 통째로 사라진다.
// last_fired는 이미 찍혀 있어 재발동도 없다 — 그날 그 방송은 끝이다.
//
// 여기서 고정하는 것 둘:
//   1) 모든 spawn 자리에 on('error')가 붙어 있다 (소스 대조 — chime-types.test.js와 같은 방식)
//   2) 실제로 없는 실행파일을 spawn해도 이 프로세스가 살아남는다 (동작 검증, Windows 한정)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_spawnguard_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const SERVICES = path.join(__dirname, '..', 'services')

// spawn을 쓰는 서비스 파일들. spawnSync는 예외 — 동기 호출이라 'error' 이벤트를 내지 않고
// 반환값의 .error로 알려주므로 리스너가 필요 없다.
const SPAWN_FILES = [
  'chimePlayer.js',
  'audioPlayer.js',
  'audioDevices.js',
  'audioDeviceWatcher.js',
  'volumeControl.js',
  'audioQueue.js',   // 이미 되어 있는 곳 — 회귀 방지로 함께 본다
  'tts.js',          // 이미 되어 있는 곳
]

function countOccurrences(src, re) {
  return (src.match(re) || []).length
}

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('spawn을 쓰는 모든 서비스가 on(error) 리스너를 같은 수만큼 갖는다', () => {
  const missing = []
  for (const file of SPAWN_FILES) {
    const src = fs.readFileSync(path.join(SERVICES, file), 'utf8')
    // spawnSync는 제외하고 비동기 spawn만 센다
    const spawns    = countOccurrences(src, /(?<!spawnSync\()\bspawn\(/g)
    const listeners = countOccurrences(src, /\.on\(\s*'error'/g)
    if (listeners < spawns) {
      missing.push(`${file}: spawn ${spawns}개 / on('error') ${listeners}개`)
    }
  }
  assert.deepEqual(
    missing, [],
    'spawn 실패는 리스너가 없으면 프로세스를 죽인다. 아래 파일에 on(error)를 붙일 것:\n  ' + missing.join('\n  ')
  )
})

// PowerShell로 C#을 컴파일하는 compileDll도 반드시 끝나야 한다.
//
// runPS는 2026-08-29에 타임아웃을 받았는데(fc629d9) 같은 파일의 compileDll은 못 받았다.
// **이쪽이 더 나쁘다** — compileDll은 `if (compileP) return compileP`로 메모이즈돼 있어서
// Add-Type이 한 번 매달리면 그 미결 Promise가 캐시된다. 이후 setSystemVolume·
// getSystemVolume·resolveDeviceIndex가 전부 그것을 await하므로 **서버를 재시작할 때까지
// 영구히** 멈춘다. runPS는 매번 새로 만들어 1회 실패로 끝나는 것과 다르다.
test('compileDll도 타임아웃을 갖는다 — 매달리면 메모이즈돼 영구히 멈춘다', () => {
  const missing = []
  for (const file of ['audioDevices.js', 'audioDeviceWatcher.js', 'volumeControl.js']) {
    const src  = fs.readFileSync(path.join(SERVICES, file), 'utf8')
    // compileDll 본문만 잘라낸다 — 같은 파일의 runPS 타임아웃에 속으면 안 된다
    const body = src.slice(src.indexOf('function compileDll'))
    const cut  = body.search(/^\}/m)
    const fn   = cut > 0 ? body.slice(0, cut) : body
    if (!/setTimeout\(/.test(fn)) missing.push(`${file}: compileDll에 타임아웃 없음`)
  }
  assert.deepEqual(
    missing, [],
    'compileDll이 안 끝나면 볼륨 제어·장치 해석이 영구히 멈춘다. 타임아웃을 붙일 곳: ' + missing.join(' / ')
  )
})

test('없는 실행파일을 spawn해도 이 프로세스가 살아남는다 — 가드 패턴 자체의 검증', async () => {
  const { spawn } = require('child_process')
  const errors = []
  const proc = spawn('carecast_no_such_binary_xyz', ['--nope'])
  proc.on('error', e => errors.push(e))
  await new Promise(r => setTimeout(r, 300))
  assert.equal(errors.length, 1, 'error 이벤트가 리스너로 잡혀야 한다')
  assert.equal(errors[0].code, 'ENOENT')
})

test('차임벨 재생 프로세스가 실패해도 서버가 죽지 않는다', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows 전용 — playChime이 비Windows에서는 spawn 자체를 하지 않는다')
    return
  }

  // Python 경로를 없는 값으로 위장한다. 현장에서 Python이 옮겨진 상황과 같다.
  const ttsPath = require.resolve('../services/tts')
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true, exports: {
      getPythonPath: () => 'C:\\carecast_no_such_python_xyz\\python.exe',
      // chimePlayer 는 2026-09-07(ISSUE-003)부터 ensurePythonPath 를 쓴다 — 같은 값을 준다.
      ensurePythonPath: () => 'C:\\carecast_no_such_python_xyz\\python.exe',
    },
  }

  // 소리 가드(hardwareDisabled)도 현장 조건(꺼짐)으로 위장한다 — 이 테스트가 검증하려는 건
  // spawn "실패" 경로라 가드를 지나가야 한다. 실행파일이 존재하지 않으므로 소리는 안 난다.
  const hwPath = require.resolve('../services/hardwareMode')
  delete require.cache[require.resolve('../services/chimePlayer')]
  require.cache[hwPath] = {
    id: hwPath, filename: hwPath, loaded: true, exports: {
      hardwareDisabled: () => false, noticeOnce: () => {},
    },
  }

  const warns = []
  const origErr = console.error
  console.error = (...a) => { warns.push(a.join(' ')) }

  try {
    const { playChime } = require('../services/chimePlayer')
    playChime('general', 50)
    await new Promise(r => setTimeout(r, 500))   // spawn ENOENT가 도착할 시간
  } finally {
    console.error = origErr
    // 뒤 테스트가 진짜 가드를 다시 보게 스텁을 걷는다 (chimePlayer도 같이 — 스텁을 물고 로드됐다)
    delete require.cache[hwPath]
    delete require.cache[require.resolve('../services/chimePlayer')]
  }

  // 여기까지 왔다는 것 자체가 "죽지 않았다"의 증거다.
  assert.ok(
    warns.some(w => w.includes('차임벨')),
    '실행 실패를 조용히 삼키지 말 것 — 무슨 일이 있었는지 로그로 남아야 한다. 실제 로그: ' + JSON.stringify(warns)
  )
})

test('runPS는 응답 없는 PowerShell을 지정 시간 안에 포기한다', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows 전용 — PowerShell이 없는 환경에서는 타임아웃이 아니라 ENOENT가 난다')
    return
  }
  const { runPS } = require('../services/audioDevices')
  assert.equal(typeof runPS, 'function', 'runPS를 테스트 이음새로 export할 것')

  const started = Date.now()
  await assert.rejects(
    () => runPS('Start-Sleep -Seconds 30', 800),
    /응답 없음|timeout/i,
    '무한 대기하면 장치 감시가 조용히 영구 정지한다'
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 5000, `타임아웃이 실제로 걸려야 한다 (걸린 시간 ${elapsed}ms)`)
})

// ── 모듈 로드만으로 외부 프로세스를 띄우던 곳 (CC-050) ──────────────────────
//
// 이 저장소에는 require하는 것만으로 외부 프로세스가 뜨는 곳이 셋 있었다. 그중
// audioPlayer가 실제 사고를 냈다 — 상주형 파이썬이라 안 죽고, 이벤트 루프를 붙잡아
// 그 모듈을 당긴 테스트 파일이 영영 안 끝났다(--test-timeout=0이라 무한 대기).
// 2026-08-29에 소리 경계 3곳을 스텁해 같은 행을 고쳤지만 이 경계가 빠져 있었고,
// 그땐 이 PC에 Python이 없어 우연히 통과했다가 옛 인터넷 합성 엔진 설치 후 되살아났다.
test('모듈 로드 시 프로세스를 띄우는 3곳이 하드웨어 가드를 지난다', () => {
  const cases = [
    ['audioPlayer.js',   /if \(IS_WINDOWS && !hardwareDisabled\(\)\) setTimeout/],
    ['audioDevices.js',  /if \(IS_WINDOWS && !hardwareDisabled\(\)\) compileDll/],
    ['volumeControl.js', /if \(IS_WINDOWS && !hardwareDisabled\(\)\) compileDll/],
  ]
  const missing = []
  for (const [file, re] of cases) {
    const src = fs.readFileSync(path.join(SERVICES, file), 'utf8')
    if (!re.test(src)) missing.push(file)
  }
  assert.deepEqual(
    missing, [],
    'require만 해도 프로세스가 뜬다. 가드를 붙일 곳: ' + missing.join(' / ')
  )
})

test('node --test 안에서는 하드웨어 접근이 꺼져 있다', () => {
  const { hardwareDisabled } = require('../services/hardwareMode')
  // node --test가 자식 프로세스에 넣어주는 값(실측: 'child-v8'). 이게 사라지면 가드가
  // 조용히 무력화되므로 여기서 붙잡는다 — package.json이나 스크립트를 안 건드리는 대가다.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'NODE_TEST_CONTEXT가 없다 — 가드 근거가 사라졌다')
  assert.equal(hardwareDisabled(), true)
})

test('하드웨어가 꺼져 있으면 playChunk가 상주 프로세스를 띄우지 않고 조용히 버린다', () => {
  const { playChunk } = require('../services/audioPlayer')
  // 8바이트 미만이면 일찍 반환하므로, 실제 헤더 크기의 버퍼를 준다
  assert.doesNotThrow(() => playChunk(Buffer.alloc(16)))
})
