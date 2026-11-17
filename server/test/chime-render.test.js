// 차임벨 합성이 플랫폼과 무관하게 되는지 — 실제로 파이썬을 돌려 WAV를 만들어 본다.
//
// 왜 필요했나(2026-08-30 맥북): `carecast_chime.py`가 맨 윗줄에서 `ctypes.windll`을 만져서
// 맥에서는 import부터 AttributeError로 죽었다. 차임이 **통째로** 안 났는데, chimePlayer가
// 그걸 로그 한 줄로만 받아 "Windows 전용이라 껐다"로 보였다 — 실제로는 끈 게 아니라
// 못 켠 것이다. 지금은 합성(순수 파이썬)과 재생(플랫폼별)이 갈라져 있다.
//
// 이 테스트는 **소리를 내지 않는다.** WAV 파일로 저장만 시키고 헤더·길이를 본다.
// 재생은 audioBackend가 만든 명령으로 chimePlayer가 따로 하고, 여기서는 부르지 않는다.
'use strict'

const { test } = require('node:test')
const assert   = require('node:assert/strict')
const fs       = require('fs')
const os       = require('os')
const path     = require('path')
const { spawnSync } = require('child_process')

const { CHIME_TYPES } = require('../services/chimePlayer')

const SCRIPT = path.join(__dirname, '..', 'services', 'carecast_chime.py')
const PYTHON = process.platform === 'win32' ? 'python' : 'python3'

const made = []
test.after(() => {
  for (const f of made) { try { fs.unlinkSync(f) } catch { /* 없으면 무시 */ } }
})

// WAV 헤더를 직접 읽는다 — 재생 없이 "무엇이 만들어졌는지" 확인할 수 있는 유일한 방법이다.
function readWavHeader(buf) {
  assert.equal(buf.toString('ascii', 0, 4),  'RIFF', 'RIFF 헤더가 아니다')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE', 'WAVE 헤더가 아니다')
  return {
    channels:   buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bits:       buf.readUInt16LE(34),
  }
}

test('차임 유형마다 WAV가 만들어진다 — 어느 플랫폼에서든', () => {
  for (const type of CHIME_TYPES) {
    const out = path.join(os.tmpdir(), `carecast_chimetest_${type}_${process.pid}.wav`)
    made.push(out)

    const r = spawnSync(PYTHON, [SCRIPT, type, '0.8', out], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${type} 합성 실패: ${r.stderr || r.error?.message}`)
    assert.ok(fs.existsSync(out), `${type} WAV가 안 만들어졌다`)

    const buf = fs.readFileSync(out)
    const h   = readWavHeader(buf)
    assert.deepEqual(h, { channels: 1, sampleRate: 44100, bits: 16 })

    // 차임은 3초 안팎이다. 0바이트짜리 "성공"이 제일 위험한 결과라 길이를 본다.
    const seconds = (buf.length - 44) / (44100 * 2)
    assert.ok(seconds > 2 && seconds < 6, `${type} 길이가 이상하다: ${seconds.toFixed(2)}초`)
  }
})

test('볼륨이 파형에 실린다 — 작게 주문하면 실제로 작아야 한다', () => {
  const paths = ['0.2', '0.9'].map((v) => {
    const out = path.join(os.tmpdir(), `carecast_chimetest_vol${v}_${process.pid}.wav`)
    made.push(out)
    const r = spawnSync(PYTHON, [SCRIPT, 'general', v, out], { encoding: 'utf8' })
    assert.equal(r.status, 0, `볼륨 ${v} 합성 실패: ${r.stderr || r.error?.message}`)
    return out
  })

  const peak = (f) => {
    const buf = fs.readFileSync(f)
    let max = 0
    for (let i = 44; i + 1 < buf.length; i += 2) max = Math.max(max, Math.abs(buf.readInt16LE(i)))
    return max
  }

  const quiet = peak(paths[0])
  const loud  = peak(paths[1])
  assert.ok(quiet > 0, '무음이 나왔다 — 합성은 됐는데 소리가 없으면 재생해도 안 들린다')
  assert.ok(loud > quiet * 2, `볼륨이 파형에 안 실렸다 (0.2 → ${quiet}, 0.9 → ${loud})`)
})
