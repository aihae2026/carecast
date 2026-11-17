// 서버가 꺼질 때 재생 자식 프로세스가 정리되는가 (CC-023).
//
// 왜 필요했나: 이 서버에는 SIGINT/SIGTERM 핸들러가 하나도 없었다(2026-08-30 grep 실측).
// audioQueue의 MCI 재생 자식은 `play cc wait`로 MP3를 끝까지 재생하므로, 서버가 죽어도
// 몇 분짜리 방송이 스피커에서 계속 나온다. autoUpdate의 process.exit(100) 재시작 경로도
// 마찬가지로 자식을 두고 떠난다. 시작 bat은 포트만 보고 새 서버를 띄우므로, 옛 소리와
// 새 방송이 겹칠 수 있다.
//
// 검증 방식: fatal-and-filelog.test.js와 같은 자식 프로세스(node -e) 방식.
// Windows에서는 process.kill()이 신호를 전달하지 않고 TerminateProcess를 부르므로
// (핸들러가 돌 기회가 없다), 자식 안에서 process.emit('SIGINT')로 핸들러 배선을 검증한다.
// 실제 소리는 내지 않는다 — 정리 함수는 주입(테스트 이음새)하고, 기본 정리 목록의
// 배선은 함수 정체성으로 고정한다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const test   = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')

const TMP = path.join(os.tmpdir(), `carecast_test_shutdown_${process.pid}_${Date.now()}`)

test.before(() => { fs.mkdirSync(TMP, { recursive: true }) })
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 무시 */ } })

const SHUTDOWN = require.resolve('../services/shutdown').replace(/\\/g, '\\\\')

// -e 스크립트 문자열에 넣을 수 있게 역슬래시를 이스케이프한 경로도 함께 만든다.
function markerPair(name) {
  const real = path.join(TMP, name)
  return { real, js: real.replace(/\\/g, '\\\\') }
}

function runChild(script) {
  let code = 0
  try {
    execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 15000 })
  } catch (e) {
    if (e.status == null) throw e   // 타임아웃 등 — 핸들러가 종료를 안 시킨 것
    code = e.status
  }
  return code
}

// ── shutdown.install: 신호 → 정리 → 종료 ──────────────────────────────────

test('SIGINT를 받으면 정리 함수가 돌고 프로세스가 끝난다', () => {
  const m = markerPair('sigint.txt')
  const code = runChild(`
    const fs = require('fs')
    require('${SHUTDOWN}').install({ cleanups: [() => fs.writeFileSync('${m.js}', 'cleaned')] })
    process.emit('SIGINT')
    setTimeout(() => { fs.writeFileSync('${m.js}', 'NOT-EXITED') }, 5000)
  `)
  assert.ok(fs.existsSync(m.real), '정리 함수가 실행돼야 한다')
  assert.equal(fs.readFileSync(m.real, 'utf8'), 'cleaned',
    '핸들러가 종료를 안 시키면 5초 타이머가 살아서 NOT-EXITED로 덮인다')
  assert.equal(code, 0, 'Ctrl+C는 의도된 종료다 — 비정상 코드를 낼 이유가 없다')
})

test('process.exit() 직행 경로에서도 정리가 돈다 — autoUpdate의 exit(100)이 이 경로다', () => {
  const m = markerPair('exit100.txt')
  const code = runChild(`
    const fs = require('fs')
    require('${SHUTDOWN}').install({ cleanups: [() => fs.writeFileSync('${m.js}', 'cleaned')] })
    process.exit(100)
  `)
  assert.equal(code, 100, '업데이트 재시작 코드(100)는 그대로 전달돼야 bat 계약이 안 깨진다')
  assert.ok(fs.existsSync(m.real),
    '신호 없이 process.exit()로 떠나는 경로(자동업데이트 재시작)에서도 자식은 정리돼야 한다')
})

test('정리 함수 하나가 던져도 나머지 정리는 계속된다', () => {
  const m = markerPair('resilient.txt')
  runChild(`
    const fs = require('fs')
    require('${SHUTDOWN}').install({ cleanups: [
      () => { throw new Error('첫 정리 실패') },
      () => fs.writeFileSync('${m.js}', 'second-ran'),
    ] })
    process.exit(0)
  `)
  assert.ok(fs.existsSync(m.real), '앞 정리가 죽었다고 뒤 자식을 산 채로 두면 안 된다')
})

test('신호 뒤의 exit 훅에서 정리가 두 번 돌지 않는다', () => {
  const m = markerPair('once.txt')
  runChild(`
    const fs = require('fs')
    require('${SHUTDOWN}').install({ cleanups: [() => fs.appendFileSync('${m.js}', 'x')] })
    process.emit('SIGINT')
  `)
  // SIGINT 핸들러가 정리 후 process.exit를 부르면 'exit' 훅이 또 발화한다 —
  // 가드가 없으면 여기서 'xx'가 된다(이미 kill한 자식을 다시 kill하려는 상황).
  assert.equal(fs.readFileSync(m.real, 'utf8'), 'x', '정리는 정확히 한 번만')
})

// ── 기본 정리 목록의 배선 ──────────────────────────────────────────────────

test('기본 정리 목록에 audioQueue.stopAll과 audioPlayer.stop이 물려 있다', () => {
  const { defaultCleanups } = require('../services/shutdown')
  const audioQueue  = require('../services/audioQueue')
  const audioPlayer = require('../services/audioPlayer')
  const list = defaultCleanups()
  assert.ok(list.includes(audioQueue.stopAll),
    '대기열의 재생 자식(MCI, 몇 분짜리)이 이 배선의 존재 이유다')
  assert.ok(list.includes(audioPlayer.stop),
    '상주형 파이썬(마이크 스트리밍)도 함께 정리돼야 한다')
})

// ── 각 정리 함수의 계약 ────────────────────────────────────────────────────

test('audioQueue.stopAll — 재생도 대기열도 없으면 조용히 아무것도 안 한다', () => {
  const { stopAll } = require('../services/audioQueue')
  const r = stopAll()
  assert.deepEqual(r, { cancelled: 0, killed: false },
    '종료 정리는 어떤 상태에서 불려도 던지면 안 된다 — 종료 자체를 막게 된다')
})

test('audioPlayer.stop — 재생기가 떠 있지 않으면 조용히 아무것도 안 한다', () => {
  const { stop } = require('../services/audioPlayer')
  assert.equal(stop(), false, '떠 있지 않은 프로세스를 죽이려다 던지면 안 된다')
})
