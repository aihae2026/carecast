// macOS(비Windows)에서 서버가 그냥 뜨는지 — Windows 전용 경계의 플랫폼 가드.
//
// 회사 PC / 집 PC(Windows) / 맥북 세 곳에서 같은 dev 브랜치로 개발하기로 하면서 필요해졌다.
// 이 서비스들은 PowerShell(볼륨·출력장치)과 winmm/WaveOut(재생·차임)에 붙어 있어서, 가드가
// 없으면 맥에서 부팅 즉시 spawn ENOENT('powershell 없음')로 죽거나 파이썬 스크립트가
// ctypes.windll에서 터진다. 방침은 "조용히 삼키지 않기" — 기능은 끄되 왜 꺼졌는지
// 로그로 분명히 남긴다.
//
// 검증 기법: node --test는 파일마다 독립 프로세스라, require 전에 process.platform을
// 'darwin'으로 위장하면 모듈들이 맥에서 로드된 것처럼 행동한다.
'use strict'

Object.defineProperty(process, 'platform', { value: 'darwin' })

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_macguard_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// 가드 로그를 모은다 — "Windows 전용" 안내가 실제로 남는지가 침묵 금지의 검증점
const logs = []
const origLog = console.log
console.log = (...a) => { logs.push(a.join(' ')); origLog(...a) }

const { initDB, getDB } = require('../db/schema')
const volumeControl = require('../services/volumeControl')
const audioDevices = require('../services/audioDevices')
const { startWatcher } = require('../services/audioDeviceWatcher')
const { playChime } = require('../services/chimePlayer')
const audioPlayer = require('../services/audioPlayer')
const { scheduleAutoShutdown } = require('../services/autoShutdown')

test.before(() => { initDB() })

test.after(() => {
  console.log = origLog
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const guardLogged = (word) => logs.some(l => l.includes('Windows 전용') && l.includes(word))

test('시스템 볼륨: 죽지 않고 기본값으로 답하며, 꺼진 이유를 로그로 남긴다', async () => {
  await assert.doesNotReject(volumeControl.setSystemVolume(55))
  assert.equal(await volumeControl.getSystemVolume(), 70, '읽기는 기존 실패 폴백과 같은 70이어야 한다')
  assert.ok(guardLogged('볼륨'), '왜 안 되는지 로그가 없으면 조용한 실패다')
})

test('출력장치 목록: 빈 목록을 돌려주고 이유를 로그로 남긴다', async () => {
  assert.deepEqual(await audioDevices.listWaveOutDevices(), [])
  // 반환 형태를 지키는지가 핵심 — null이면 routes/tts.js의 구조분해가 터져 방송이 500이 된다
  assert.deepEqual(
    await audioDevices.resolveDeviceIndex('아무거나'),
    { index: null, found: true, warning: null },
    '기본 장치 사용 형태를 그대로 돌려줘야 한다 — null은 호출부를 깨뜨린다',
  )
  assert.ok(guardLogged('출력장치') || guardLogged('오디오 장치'))
})

test('출력장치 감시: 시작 요청을 안내와 함께 무시한다(PowerShell spawn 없음)', () => {
  assert.doesNotThrow(() => startWatcher(getDB()))
  assert.ok(guardLogged('감시') || guardLogged('AudioDeviceWatcher'))
})

// 차임벨은 2026-08-30에 이 목록에서 빠졌다 — 맥에서도 난다.
// 합성(순수 파이썬)과 재생(플랫폼별)을 갈라, 맥에서는 WAV로 저장한 뒤 audioBackend가
// 정한 명령으로 재생한다. 그래서 여기서 볼 것은 "꺼졌는가"가 아니라 "죽지 않는가"다.
test('서버 차임벨: 맥에서 죽지 않는다 — windll에 닿기 전에 WAV로 빠져나간다', () => {
  // 소리는 안 낸다(hardwareDisabled). 이 호출이 던지지 않는 것 자체가 검증점이다.
  assert.doesNotThrow(() => playChime('general'))

  // 맥에서 차임이 통째로 안 나던 진짜 원인: 스크립트 맨 윗줄의 `ctypes.windll`.
  // import하는 순간 AttributeError로 죽어서, 유형·볼륨이 뭐든 소리가 안 났다.
  // WAV로 저장하는 경로는 그 줄에 **닿기 전에** 끝나야 한다.
  const py = fs.readFileSync(path.join(__dirname, '..', 'services', 'carecast_chime.py'), 'utf8')
  const cut = py.indexOf('out_wav = sys.argv[3]')
  assert.ok(cut > 0, 'carecast_chime.py에서 WAV 분기를 찾지 못했다')
  const imported = py.indexOf('import ctypes')
  assert.ok(imported > 0, 'carecast_chime.py에서 ctypes import를 찾지 못했다')
  assert.ok(
    imported > cut,
    'ctypes import가 WAV 분기보다 앞이면 맥에서는 거기 닿기 전에 죽는다 — 순서가 곧 동작이다',
  )
})

test('실시간 마이크 재생: startPlayer가 false를 돌려주고 이유를 로그로 남긴다', () => {
  assert.equal(audioPlayer.startPlayer?.() ?? false, false)
  assert.doesNotThrow(() => audioPlayer.playChunk(Buffer.from([0, 0])))
  assert.ok(guardLogged('마이크') || guardLogged('AudioPlayer'))
})

test('자동종료: 시각이 저장돼 있어도 Windows가 아니면 예약하지 않는다', () => {
  getDB().prepare("INSERT INTO settings (key, value) VALUES ('auto_shutdown_time','05:30') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  assert.doesNotThrow(() => scheduleAutoShutdown())
  assert.ok(guardLogged('자동종료') || guardLogged('종료'))
})
