// 출력 장치 캐시를 **미리 데운다** (2026-09-05, 같은 날 오후 fix의 뒷정리).
//
// 오후에 차임벨·마이크가 설정된 출력 장치로 나가게 고쳤는데, 그 값은 **기다리지 않고**
// 캐시에서만 읽는다(cachedDeviceIndex — 기다리면 차임이 안내 음성보다 늦는다). 그런데 그
// 캐시를 채우는 곳은 resolveDeviceIndex 하나뿐이고, 그건 **안내 음성 방송이 한 번 나가야**
// 불린다. 장치 감시(audioDeviceWatcher)는 자기 C# DLL을 쓰므로 이 캐시를 안 채운다.
//
// 그래서 남아 있던 구멍: 서버를 새로 띄운 뒤 첫 TTS 방송 전까지 차임과 마이크 생방송이 기본
// 장치로 나간다. **상주형 마이크 플레이어는 더 나쁘다** — 뜰 때의 값을 끝까지 쓰므로 서버가
// 사는 내내 그대로다.
//
// 여기서 잠그는 것:
//  1. warmDeviceCache는 **던지지 않는다** — 데우다 실패했다고 서버가 죽거나 소리가 사라지면 안 된다
//  2. 설정된 장치가 없으면 아무것도 안 묻는다 — 기본 장치가 정답인 상황이다
//  3. 상주형 플레이어는 **데운 뒤에** 뜬다
//  4. 장치를 바꾸면 캐시를 비우고 **다시 데운다** — 비우기만 하면 다음 차임이 기본 장치로 간다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_warm_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')
const audioDevices = require('../services/audioDevices')

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

test.before(() => { initDB() })
test.after(() => { try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ } })

test('설정된 장치가 없으면 아무것도 안 묻고 조용히 끝난다', async () => {
  writeSetting(getDB(), 'audio_device', '')
  await audioDevices.warmDeviceCache()   // 던지면 여기서 실패한다
  assert.equal(audioDevices.cachedDeviceIndex(''), null)
})

test('데우다 실패해도 던지지 않는다 — 소리가 사라지는 것보다 낫다', async () => {
  writeSetting(getDB(), 'audio_device', '있을 리 없는 장치 이름')
  await audioDevices.warmDeviceCache()
  // 못 찾았으면 기본 장치로 물러난다(= 지금까지의 동작)
  assert.equal(audioDevices.cachedDeviceIndex('있을 리 없는 장치 이름'), null)
  assert.deepEqual(audioDevices.waveOutEnv(), {})
})

test('상주형 마이크 플레이어는 캐시를 데운 뒤에 뜬다', () => {
  const src = read('server', 'services', 'audioPlayer.js')
  assert.match(src, /warmDeviceCache\(\)\.finally\(\(\) => startPlayer\(\)\)/,
    '데우기 전에 띄우면 기본 장치로 굳고 서버가 사는 내내 그대로다')
})

test('장치를 바꾸면 캐시를 비우고 다시 데운다', () => {
  const src = read('server', 'routes', 'settings.js')
  const at = src.indexOf(`setSetting(db, 'audio_device', deviceValue)`)
  assert.ok(at > 0, '출력장치 저장 자리를 못 찾았다 — 이 검사의 전제가 바뀌었다')
  const block = src.slice(at, at + 1200)
  assert.match(block, /clearDeviceCache\(\)/, '옛 목록을 안 비운다')
  assert.match(block, /warmDeviceCache\(\)/,
    '비우기만 하면 다음 차임벨이 기본 장치로 나간다 — 캐시를 안 기다리는 규칙 때문이다')
})
