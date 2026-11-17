// **소리를 끈 설정(CARECAST_NO_HARDWARE=1)에서는 출력 장치 캐시를 데우지 않는다** (2026-10-17, 설치 시험 c12).
//
// 시험자가 소리를 끈 서버를 켰는데도 로그에 `[AudioDevices] DLL 컴파일 완료` 가 찍혔다.
// 모듈을 불러올 때의 미리 컴파일은 이미 막혀 있었다(CC-050). 남은 길은 마법사가 스피커를 저장할 때
// 부르는 warmDeviceCache 다. 이 함수는 PowerShell 로 장치 목록을 캐서 C# DLL 을 만든다.
// 그 캐시는 **서버가 스피커로 소리를 낼 때만** 쓰인다(cachedDeviceIndex → waveOutEnv).
// 소리를 끈 설정에서는 쓰는 곳이 없으니 건너뛰어도 동작이 달라지지 않는다.
// 장치 목록 화면(/api/audio/devices)은 사람이 보려고 부르는 것이라 그대로 둔다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_nohw_warm_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')
const cp     = require('child_process')

// audioDevices 는 spawn 을 구조 분해로 받는다 — 불러오기 **전에** 엿보기를 끼운다.
const 띄운것 = []
const 원래spawn = cp.spawn
cp.spawn = (...a) => { 띄운것.push(a); return 원래spawn(...a) }

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const audioDevices = require('../services/audioDevices')

test.before(() => { initDB() })
test.after(() => {
  cp.spawn = 원래spawn
  try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ }
})

test('소리를 끈 설정에서는 장치가 저장돼 있어도 데우기가 PowerShell 을 띄우지 않는다', async () => {
  const 옛값 = process.env.CARECAST_NO_HARDWARE
  process.env.CARECAST_NO_HARDWARE = '1'
  try {
    writeSetting(getDB(), 'audio_device', '스피커 (시험 장치)')
    띄운것.length = 0
    await audioDevices.warmDeviceCache()
    assert.deepEqual(띄운것.map((a) => a[0]), [], '소리를 끈 설정인데 외부 프로세스를 띄웠다')
  } finally {
    if (옛값 === undefined) delete process.env.CARECAST_NO_HARDWARE
    else process.env.CARECAST_NO_HARDWARE = 옛값
  }
})
