'use strict'
// **차임을 빨리 계산해도 소리는 한 바이트도 안 바뀐다** (사용자 신고 2026-09-17 「차임 눌러도 소리 늦게 나가」)
//
// carecast_chime.py 는 numpy 가 있으면 파형을 한 번에 계산하고, 없으면 원래 순수 파이썬 루프로 간다.
// 두 길이 **같은 WAV** 를 내야 한다 — 식이나 반올림이 갈리면 현장 차임 소리가 조용히 달라진다.
// WAV 파일로만 내보내므로(인자 3개) 스피커는 울리지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const 스크립트 = path.join(__dirname, '..', 'services', 'carecast_chime.py')

function 파이썬() {
  for (const p of ['python', 'python3', 'py']) {
    const r = spawnSync(p, ['-c', 'import numpy'], { windowsHide: true })
    if (r.status === 0) return p
  }
  return null
}

test('numpy 길과 순수 파이썬 길이 **같은 WAV** 를 만든다', (t) => {
  const py = 파이썬()
  if (!py) { t.skip('numpy 가 있는 파이썬이 없다 — 이 PC 에서는 순수 파이썬 길만 쓰인다'); return }
  const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'chime-parity-'))
  try {
    for (const [종류, 볼륨] of [['general', '0.8'], ['end', '0.35']]) {
      const 빠름 = path.join(폴더, `f-${종류}.wav`), 느림 = path.join(폴더, `p-${종류}.wav`)
      const a = spawnSync(py, [스크립트, 종류, 볼륨, 빠름], { windowsHide: true })
      const b = spawnSync(py, [스크립트, 종류, 볼륨, 느림], { windowsHide: true, env: { ...process.env, CARECAST_CHIME_PURE: '1' } })
      assert.equal(a.status, 0, String(a.stderr))
      assert.equal(b.status, 0, String(b.stderr))
      const x = fs.readFileSync(빠름), y = fs.readFileSync(느림)
      assert.ok(x.length > 100000, 'WAV 가 비었다')
      assert.ok(x.equals(y), `${종류} ${볼륨}: 두 길의 소리가 다르다`)
    }
  } finally {
    fs.rmSync(폴더, { recursive: true, force: true })
  }
})

test('numpy 가 실패해도 순수 파이썬 길로 넘어간다 — 차임이 안 울리면 안 된다', () => {
  const src = fs.readFileSync(스크립트, 'utf8')
  assert.match(src, /try:\s*\n\s*_pcm_fast = _numpy_pcm\(\)\s*\n\s*except Exception:\s*\n\s*_pcm_fast = None/)
  assert.match(src, /pcm = _pcm_fast if _pcm_fast is not None else bytes\(mix\)/)
})
