// 소리가 **설정된 출력 장치로** 나가는가 (2026-09-05).
//
// 예전에는 안내 음성(routes/tts.js)만 장치 인덱스를 넘기고, 차임벨·마이크 녹음 방송·마이크
// 생방송은 전부 기본 장치(WAVE_MAPPER)로 나갔다. 현장에서 안 드러난 이유는 감시기
// (audioDeviceWatcher)가 2분마다 Windows 기본 장치를 설정값으로 되돌려 놓기 때문이다 —
// **누가 장치를 바꾼 뒤 다음 점검까지의 2분이 구멍**이고, 감시기가 안 도는 PC(개발·테스트)
// 에서는 늘 열려 있다. 그 구멍에서는 안내 음성만 스피커로 가고 차임과 사람 목소리는 딴 데로
// 갈라지는데, 어느 쪽에서도 오류가 안 나서 아무도 모른다.
//
// 여기서 잠그는 것:
//  1. 마이크 녹음 방송이 장치 인덱스를 대기열에 넘긴다
//  2. 차임벨이 파이썬에게 장치를 알려 준다
//  3. 상주형 마이크 플레이어도 같은 값을 받고, **장치를 바꾸면 내려간다**(뜰 때 물고 가므로)
//  4. 파이썬 둘은 그 값이 없으면 지금까지처럼 기본 장치로 낸다 — 값이 없다고 소리가 사라지면 안 된다
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_output_device_routing_${process.pid}_${Date.now()}.db`)

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SERVER = path.join(__dirname, '..')
const read = (...p) => fs.readFileSync(path.join(SERVER, ...p), 'utf8')

test('마이크 녹음 방송이 장치 인덱스를 대기열에 넘긴다', () => {
  const src = read('routes', 'mic.js')
  assert.match(src, /resolveDeviceIndex\(deviceName\)/,
    '설정된 장치를 찾지 않는다 — routes/tts.js와 같은 규칙이어야 한다')
  assert.match(src, /enqueue\(tmpFile, false, deviceIndex\)/,
    'enqueue에 장치를 안 넘긴다 — 마이크 방송만 기본 장치로 나간다')
})

test('차임벨이 파이썬에게 출력 장치를 알려 준다', () => {
  const src = read('services', 'chimePlayer.js')
  assert.match(src, /waveOutEnv\(\)/, '차임벨이 장치를 안 넘긴다')
  const watch = src.slice(src.indexOf('function watchChild'), src.indexOf('function watchChild') + 400)
  assert.match(watch, /env: \{ \.\.\.process\.env/,
    'spawn에 환경변수를 실어 보내지 않는다 — process.env를 통째로 갈아끼우면 파이썬 경로까지 사라진다')
})

test('상주형 마이크 플레이어도 같은 값을 받는다', () => {
  const src = read('services', 'audioPlayer.js')
  assert.match(src, /waveOutEnv\(\)/, '생방송 플레이어가 기본 장치로만 나간다')
})

test('장치를 바꾸면 상주형 플레이어를 내린다 — 뜰 때 장치를 물고 가기 때문이다', () => {
  const src = read('routes', 'settings.js')
  const at = src.indexOf(`setSetting(db, 'audio_device', deviceValue)`)
  assert.ok(at > 0, '출력장치 저장 자리를 못 찾았다 — 이 검사의 전제가 바뀌었다')
  const block = src.slice(at, at + 700)
  assert.match(block, /audioPlayer'\)\.stop\(\)/,
    '장치를 바꿔도 상주 플레이어는 옛 장치로 계속 나간다')
})

test('파이썬 둘은 값이 없으면 기본 장치로 낸다 — 없다고 소리가 사라지면 안 된다', () => {
  for (const name of ['carecast_chime.py', 'carecast_player.py']) {
    const src = read('services', name)
    assert.match(src, /CARECAST_WAVEOUT_INDEX/, `${name}이 장치 값을 안 읽는다`)
    assert.match(src, /return WAVE_MAPPER/,
      `${name}에 기본 장치로 되돌아가는 길이 없다 — 값이 깨지면 소리가 통째로 사라진다`)
    assert.match(src, /waveOutOpen\(ctypes\.byref\(h\), ctypes\.c_uint\(_out_device\(\)\)/,
      `${name}이 여전히 기본 장치로 열고 있다`)
    assert.match(src, /^import sys, os,/m, `${name}에 os import가 없다 — 실행하면 NameError로 죽는다`)
  }
})

test('캐시가 비어 있으면 기다리지 않고 기본 장치로 물러난다', () => {
  // waveOutEnv는 **조회하지 않는다**(PowerShell 수백 ms). 아직 아무것도 안 캐 온 상태에서는
  // 빈 객체여야 한다 — 그래야 차임이 안내 음성보다 먼저 난다.
  const { waveOutEnv, cachedDeviceIndex } = require('../services/audioDevices')
  assert.deepEqual(waveOutEnv(), {})
  assert.equal(cachedDeviceIndex(''), null)
  assert.equal(cachedDeviceIndex('있을 리 없는 장치'), null)
})
