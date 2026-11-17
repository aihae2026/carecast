// 출력장치 설정이 조용히 망가지는 것을 막는다.
//
// 실제로 일어난 일(2026-08-30): `settings.audio_device`에 이런 값이 들어앉아 있었다.
//   efbfbd efbfbd efbfbd efbfbd efbfbd 28 efbfbd c5bd efbfbd 20 "Stereo)"
// `efbfbd`는 U+FFFD(글자 깨짐 표시)다. 원래 "헤드폰(거실 Stereo)"였던 이름이 PowerShell
// 쪽 인코딩(CP949)을 거치면서 **되살릴 수 없게** 깨진 채 저장된 것이다.
//
// 그 결과 resolveDeviceIndex()가 어떤 장치와도 매칭되지 않아 매번 Windows 기본 장치로
// 재생됐다. 기본 장치가 모니터 HDMI면 스피커에서는 아무 소리도 안 난다 — 그런데 어디에도
// 에러가 없다. 화면은 저장에 성공했다고 말하고, 서버 로그에는 2분마다 "복원 실패" 한 줄만
// 남는다. 사람이 "오디오가 또 불량"이라고 말해야만 알게 된다.
//
// 막는 법 둘:
//  1) U+FFFD가 섞인 이름은 애초에 저장을 거부한다. 정상적인 장치 이름에는 절대 안 들어간다.
//  2) 저장은 됐는데 이 PC에 없는 이름이면 경고를 돌려준다(거부는 안 한다 — 현장에서
//     장치를 잠깐 빼둔 채 설정할 수 있어야 한다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_audiodev_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB }   = require('../db/schema')
const { startTestApp }    = require('./helpers/testApp')
const { sanitizeDeviceName } = require('../services/audioDevices')
const settingsRoutes      = require('../routes/settings')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function post(p, body) {
  const r = await fetch(app.baseUrl + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

const get = async (p) => (await fetch(app.baseUrl + p)).json()

// ── 순수 검사 ──────────────────────────────────────────────────

test('U+FFFD가 섞인 장치 이름은 거부한다 — 인코딩이 깨진 값이라는 증거다', () => {
  const 깨진값 = '�����(�Ž� Stereo)'
  const r = sanitizeDeviceName(깨진값)
  assert.equal(r.ok, false)
  assert.match(r.error, /글자가 깨/, '사람이 무슨 일인지 알 수 있는 문구여야 한다')
})

test('정상적인 한글 장치 이름은 통과한다', () => {
  const r = sanitizeDeviceName('헤드폰(거실 Stereo)')
  assert.equal(r.ok, true)
  assert.equal(r.value, '헤드폰(거실 Stereo)')
})

test('빈 값은 통과한다 — "기본 장치 사용"이라는 뜻이라 지울 수 있어야 한다', () => {
  assert.equal(sanitizeDeviceName('').ok, true)
  assert.equal(sanitizeDeviceName('   ').value, '', '앞뒤 공백은 다듬는다')
  assert.equal(sanitizeDeviceName(undefined).ok, true)
})

test('제어문자가 섞인 이름도 거부한다 — 줄바꿈은 PowerShell 인자에 그대로 실린다', () => {
  assert.equal(sanitizeDeviceName('헤드폰\n외부명령').ok, false)
})

// ── 라우트 ────────────────────────────────────────────────────

test('POST /api/settings/tts — 깨진 장치 이름은 400으로 막고, 기존 값을 덮지 않는다', async () => {
  await post('/api/settings/tts', { audioDevice: '헤드폰(거실 Stereo)' })
  assert.equal(get_audio_device(), '헤드폰(거실 Stereo)')

  const r = await post('/api/settings/tts', { audioDevice: '���(� Stereo)' })
  assert.equal(r.status, 400, '깨진 값이 조용히 저장되면 소리가 엉뚱한 장치로 나간다')
  assert.equal(get_audio_device(), '헤드폰(거실 Stereo)',
    '거부했으면 멀쩡하던 기존 설정이 그대로 남아 있어야 한다')
})

test('POST /api/settings/tts — 같은 요청의 다른 설정도 함께 거부한다(부분 저장 금지)', async () => {
  await post('/api/settings/tts', { rate: 0.9 })
  const r = await post('/api/settings/tts', { rate: 1.4, audioDevice: '�� Stereo' })
  assert.equal(r.status, 400)
  const after = await get('/api/settings/tts')
  assert.equal(after.rate, 0.9, '한 요청의 일부만 반영되면 화면과 서버가 어긋난다')
})

test('POST /api/settings/tts — 빈 문자열로 지우면 기본 장치로 돌아간다', async () => {
  await post('/api/settings/tts', { audioDevice: '헤드폰(거실 Stereo)' })
  const r = await post('/api/settings/tts', { audioDevice: '' })
  assert.equal(r.status, 200)
  assert.equal(get_audio_device(), '')
})

function get_audio_device() {
  return getDB().prepare('SELECT value FROM settings WHERE key = ?').get('audio_device')?.value ?? ''
}

// ── 이미 깨진 채 저장된 값 자가 복구 ───────────────────────────

test('GET /api/settings/tts — 이미 깨진 값이 들어 있으면 빈 값으로 돌려주고 DB도 치운다', async () => {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('audio_device', '�����(�Ž� Stereo)')

  const r = await get('/api/settings/tts')
  assert.equal(r.audioDevice, '',
    '깨진 값을 그대로 화면에 보여주면 사람이 "설정돼 있네" 하고 넘어간다')
  assert.equal(get_audio_device(), '',
    '읽을 때 치워야 audioDeviceWatcher가 2분마다 헛복원을 시도하지 않는다')
})

// ── 깨진 값이 애초에 어디서 왔나 ───────────────────────────────
//
// 2026-08-30 실측: 장치 이름을 읽어오는 PowerShell이 **CP949로 출력**하는데 Node는
// UTF-8로 읽는다. "헤드폰(거실 Stereo)"의 첫 글자가 실제로 이렇게 나왔다.
//   인코딩 강제 없이: c7 ec b5 e5 c6 f9 ...  (CP949)
//   Node가 UTF-8로 해석 → efbfbd efbfbd ... (U+FFFD 범벅)
// 화면은 그 깨진 이름을 목록에 그대로 띄웠고, 사람이 그걸 골라 저장하면서 DB에 들어앉았다.
// **처음엔 "예전 세션의 curl이 범인"이라고 봤는데 틀렸다.** 범인은 이 경로 자체다.
//
// 눈치채기 어려웠던 이유: PowerShell은 부모 콘솔의 코드페이지를 물려받는다. 서버를
// 어떤 창에서 띄웠느냐에 따라 멀쩡하기도 하고 깨지기도 했다(같은 코드, 같은 PC에서
// 실제로 두 결과를 다 봤다). 그래서 runPS가 **스스로** UTF-8을 강제해야 한다.

const { runPS: runPSDevices }  = require('../services/audioDevices')
const { runPS: runPSWatcher }  = require('../services/audioDeviceWatcher')

const 윈도우 = process.platform === 'win32'

// 아래 두 왕복 검사는 **환경을 탄다** — 비Windows에서는 건너뛰고, Windows에서도 부모 콘솔이
// 이미 UTF-8이면 강제 코드를 지워도 통과한다. 그런데 "창에 따라 멀쩡하기도 깨지기도 했다"는
// 것이 이 사고의 원인이었다. 그래서 **강제 코드가 소스에 있다는 사실**을 따로 못 박는다 —
// 이건 OS·콘솔 설정과 관계없이 돈다(2026-09-05).
test('[구조] 두 파일의 PowerShell 실행이 출력 인코딩을 UTF-8로 강제한다', () => {
  for (const rel of [['services', 'audioDevices.js'], ['services', 'audioDeviceWatcher.js']]) {
    const src = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf8')
    assert.match(src, /OutputEncoding[\s\S]{0,80}UTF8/,
      `${rel[1]}이 출력 인코딩을 강제하지 않는다 — 창에 따라 한글 장치 이름이 깨진다`)
  }
})

test('audioDevices.runPS는 한글을 깨뜨리지 않는다', { skip: !윈도우 && 'Windows 전용' }, async () => {
  const out = await runPSDevices(`Write-Output '헤드폰(거실 Stereo)'`)
  assert.equal(out, '헤드폰(거실 Stereo)')
})

test('audioDeviceWatcher.runPS도 마찬가지다 — 현재 장치 이름을 읽는 곳이다', { skip: !윈도우 && 'Windows 전용' }, async () => {
  // 여기서 깨지면 "설정한 장치와 다르다"고 오판해 2분마다 헛복원을 시도한다
  const out = await runPSWatcher(`Write-Output '헤드폰(거실 Stereo)'`)
  assert.equal(out, '헤드폰(거실 Stereo)')
})
