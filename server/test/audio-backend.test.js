// 서버 스피커 재생의 **플랫폼 분기**를 고정한다.
//
// 왜 필요했나(2026-08-30 맥북): audioQueue가 재생 명령을 직접 만들면서 Windows MCI 스크립트를
// 하드코딩하고 있었다. 맥에서는 파이썬이 `ctypes.windll`에서 터지는데, 큐는 그걸 "종료코드 1"로만
// 받아 로그 한 줄 남기고 끝났다 — 화면에는 방송이 나간 것처럼 보이는데 스피커는 조용하다.
// 그때 만든 규칙: **플랫폼 분기는 audioBackend.js 한 곳에서만 한다.**
//
// 이 테스트는 소리를 내지 않는다. buildPlayCommand는 명령을 "만들기만" 하고 spawn은 큐가 한다.
// CARECAST_AUDIO_BACKEND로 백엔드를 강제할 수 있어서, 윈도우에서도 맥 분기를(그 반대도) 검사한다.
'use strict'

const fs   = require('fs')
const path = require('path')

const test   = require('node:test')
const assert = require('node:assert/strict')

const backend = require('../services/audioBackend')

const ENV = backend.ENV_KEY
const origEnv = process.env[ENV]

function withBackend(name, fn) {
  if (name == null) delete process.env[ENV]
  else process.env[ENV] = name
  try { return fn() } finally {
    if (origEnv == null) delete process.env[ENV]
    else process.env[ENV] = origEnv
  }
}

const tmpFiles = []
test.after(() => {
  for (const f of tmpFiles) { try { fs.unlinkSync(f) } catch { /* 없으면 무시 */ } }
})

// ── 1) 플랫폼 기본값 ──────────────────────────────────────────

test('플랫폼마다 기본 백엔드가 정해져 있다 — 맥에서 "없음"이면 그게 무음의 원인이다', () => {
  withBackend(null, () => {
    const picked = backend.pickBackend()
    if (process.platform === 'win32') {
      assert.equal(picked, 'mci', 'Windows는 기존 경로(MCI) 그대로여야 한다')
    } else if (process.platform === 'darwin') {
      assert.equal(picked, 'afplay', `macOS 기본 내장 ${backend.AFPLAY_PATH}로 재생한다`)
      assert.ok(fs.existsSync(backend.AFPLAY_PATH), 'afplay가 없으면 이 판정이 거짓말이 된다')
    } else {
      assert.equal(picked, null)
      assert.match(backend.unsupportedReason(), /지원하지 않습니다/, '왜 안 되는지 문장으로 남아야 한다')
    }
  })
})

// ── 2) Windows 경로는 그대로다 (맥 지원이 윈도우를 건드리지 않았는지) ──

test('mci: 고정 스크립트에 값만 넘긴다 — 임시 .py 를 안 쓴다(2026-09-17 백신 검사 지연)', () => {
  withBackend('mci', () => {
    const plan = backend.buildPlayCommand({
      mp3Path: 'C:\\temp\\a.mp3', volumePct: 70, deviceIndex: null, pythonPath: 'C:\\py\\python.exe',
    })
    assert.equal(plan.backend, 'mci')
    assert.equal(plan.cmd, 'C:\\py\\python.exe')
    assert.equal(plan.tempFile, null, '재생마다 임시 스크립트를 쓰면 백신이 매번 검사한다')
    assert.match(plan.args[0], /carecast_mci_play\.py$/)
    assert.ok(fs.existsSync(plan.args[0]), '고정 스크립트가 저장소에 있어야 한다')
    assert.deepEqual(plan.args.slice(1), ['C:\\temp\\a.mp3', '700'], '볼륨 70%는 MCI 눈금으로 700이다 · 장치 미지정이면 번호를 안 넘긴다')

    const script = fs.readFileSync(plan.args[0], 'utf8')
    assert.match(script, /ctypes\.windll\.winmm\.mciSendStringW/)
    assert.match(script, /play cc wait/, 'wait이 빠지면 재생이 끝나기 전에 종료음이 겹친다')
    assert.match(script, /if dev >= 0:\s*\n\s*mcis\(f'setaudio cc to device \{dev\}'/, '장치 미지정이면 그 줄을 건너뛰어야 한다')
  })
})

test('mci: 출력 장치를 지정하면 번호를 넘긴다', () => {
  withBackend('mci', () => {
    const plan = backend.buildPlayCommand({
      mp3Path: 'C:\\temp\\a.mp3', volumePct: 80, deviceIndex: 3, pythonPath: 'C:\\py\\python.exe',
    })
    assert.deepEqual(plan.args.slice(1), ['C:\\temp\\a.mp3', '800', '3'])
  })
})

test('mci: 파이썬이 없으면 기존 문구 그대로 거절한다 — 현장 로그가 이 문장으로 검색된다', () => {
  withBackend('mci', () => {
    assert.throws(
      () => backend.buildPlayCommand({ mp3Path: 'C:\\a.mp3', volumePct: 80, pythonPath: null }),
      /Python을 찾을 수 없어 서버 재생 불가/,
    )
  })
})

// ── 3) macOS 경로 ────────────────────────────────────────────

test('afplay: 임시 스크립트 없이 파일을 바로 넘긴다', () => {
  withBackend('afplay', () => {
    const plan = backend.buildPlayCommand({ mp3Path: '/tmp/a.mp3', volumePct: 70 })
    assert.equal(plan.backend, 'afplay')
    assert.equal(plan.cmd, backend.AFPLAY_PATH)
    assert.deepEqual(plan.args, ['-v', '0.7', '/tmp/a.mp3'])
    assert.equal(plan.tempFile, null, '지울 임시 파일이 없어야 한다')
  })
})

test('afplay: 파이썬이 없어도 재생할 수 있다 — 맥에는 MCI가 없다', () => {
  withBackend('afplay', () => {
    assert.doesNotThrow(() => backend.buildPlayCommand({ mp3Path: '/tmp/a.mp3', volumePct: 50, pythonPath: null }))
  })
})

// ── 4) 볼륨 눈금 (백엔드마다 다르다 — 소리 없이 확인할 수 있는 마지막 지점) ──

test('볼륨이 백엔드별 눈금으로 옮겨진다', () => {
  assert.equal(backend.mciVolume(0), 0)
  assert.equal(backend.mciVolume(80), 800)
  assert.equal(backend.mciVolume(100), 1000)

  assert.equal(backend.afplayVolume(0), '0')
  assert.equal(backend.afplayVolume(80), '0.8')
  assert.equal(backend.afplayVolume(100), '1')
})

test('afplay 볼륨은 0~1 밖으로 안 나간다 — 음수나 2.0을 넘기면 afplay가 거절하거나 귀를 때린다', () => {
  assert.equal(backend.afplayVolume(-20), '0')
  assert.equal(backend.afplayVolume(300), '1')
})

// ── 5) 사람이 켜는 스위치 ────────────────────────────────────

test('none으로 끄면 이유를 담아 거절한다 — 조용히 성공하면 "나갔다"는 거짓이 된다', () => {
  withBackend('none', () => {
    assert.equal(backend.pickBackend(), null)
    assert.throws(() => backend.buildPlayCommand({ mp3Path: '/tmp/a.mp3', volumePct: 80 }), /none/)
  })
})

test('모르는 값은 플랫폼 기본값으로 되돌아간다 — 오타 때문에 방송이 멈추면 안 된다', () => {
  withBackend('오타', () => {
    assert.equal(backend.pickBackend(), withBackend(null, () => backend.pickBackend()))
  })
})

// ── 6) 규칙 자체를 고정한다 ──────────────────────────────────

test('재생 대기열은 플랫폼을 모른다 — 분기가 두 곳이 되면 한쪽만 고치는 사고가 다시 난다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'audioQueue.js'), 'utf8')
  for (const forbidden of ['windll', 'afplay', 'process.platform']) {
    assert.ok(
      !src.includes(forbidden),
      `audioQueue.js에 "${forbidden}"가 있으면 안 된다 — 플랫폼 분기는 audioBackend.js 한 곳에서만 한다`,
    )
  }
})
