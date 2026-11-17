'use strict'
// **Python 이 없으면 모델을 받기 전에 멈춘다** (2026-10-17, Windows Sandbox 설치 시험 c12).
//
// 새 윈도우에서 README 대로 `npm run setup:tts` 를 돌리면 129MB 를 다 받은 **뒤에야**
// 「파이썬을 못 찾았다」로 실패했다. 압축은 파이썬 tarfile 로 푸는데(내장 tar 는 PC 마다 결과가
// 달라 버렸다 — setup-tts.cjs 주석), 그 확인이 다운로드 뒤에 있었기 때문이다.
// 그래서 받기 전에 파이썬부터 찾고, 없으면 설치 안내(「Add python.exe to PATH」)와 함께 바로 멈춘다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const setup = require('../../scripts/setup-tts.cjs')

function 빈폴더() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-setup-tts-test-'))
}

test('파이썬이 없으면 받기 전에 멈추고, 설치 안내를 준다', async () => {
  const 대상 = 빈폴더()
  let 받았나 = false
  try {
    await assert.rejects(
      setup.실행({ argv: [], 대상, 파이썬찾기: () => null, 받기: async () => { 받았나 = true } }),
      (e) => {
        assert.match(e.message, /Python/)
        assert.match(e.message, /Add python\.exe to PATH/)
        return true
      },
    )
    assert.equal(받았나, false, '파이썬이 없는데 모델부터 받았다')
  } finally {
    fs.rmSync(대상, { recursive: true, force: true })
  }
})

test('압축 파일(--from x.tar.bz2)로 깔 때도 파이썬부터 본다', async () => {
  const 대상 = 빈폴더()
  const 압축 = path.join(대상, '모델.tar.bz2')
  fs.writeFileSync(압축, 'x')
  try {
    await assert.rejects(
      setup.실행({ argv: ['--from', 압축], 대상: path.join(대상, 'out'), 파이썬찾기: () => null }),
      /Add python\.exe to PATH/,
    )
  } finally {
    fs.rmSync(대상, { recursive: true, force: true })
  }
})

test('풀린 폴더(--from 폴더)는 파이썬 없이도 깔린다', async () => {
  const 원본 = 빈폴더()
  const 대상 = path.join(빈폴더(), 'out')
  for (const f of setup.필요) fs.writeFileSync(path.join(원본, f), 'x')
  try {
    await setup.실행({ argv: ['--from', 원본], 대상, 파이썬찾기: () => null })
    assert.ok(setup.필요.every((f) => fs.existsSync(path.join(대상, f))))
  } finally {
    fs.rmSync(원본, { recursive: true, force: true })
    fs.rmSync(path.dirname(대상), { recursive: true, force: true })
  }
})

test('파이썬이 있으면 받기로 넘어간다', async () => {
  const 대상 = 빈폴더()
  let 받았나 = false
  try {
    await assert.rejects(
      setup.실행({ argv: [], 대상, 파이썬찾기: () => 'python', 받기: async () => { 받았나 = true } }),
      /모자란다/,   // 가짜 받기라 파일이 없다 — 받기를 불렀는지만 본다
    )
    assert.equal(받았나, true)
  } finally {
    fs.rmSync(대상, { recursive: true, force: true })
  }
})
