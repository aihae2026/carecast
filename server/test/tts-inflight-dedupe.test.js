'use strict'
// **같은 문장을 동시에 두 번 합성하지 않는다** (2026-09-18 노트북 로그).
// 「지금 방송」 카드의 음성 미리 만들기가 도는 중에 단추를 누르면 같은 문장 합성이 둘 떴다(47~50초씩).
// 가짜 합성기로 **호출 횟수**를 센다 — 실제 옛 인터넷 합성 엔진·네트워크는 건드리지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { generateTTSWithRetry, cuesPathOf } = require('../services/tts')

function 가짜합성기(지연ms, 실패 = false) {
  const 호출 = { n: 0 }
  const generate = async () => {
    호출.n++
    await new Promise((r) => setTimeout(r, 지연ms))
    if (실패) throw new Error('가짜 실패')
    const f = path.join(os.tmpdir(), `cc-fake-tts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`)
    fs.writeFileSync(f, Buffer.alloc(4096, 1))
    fs.writeFileSync(cuesPathOf(f), '[]')
    return f
  }
  return { generate, 호출 }
}

/** 손으로 끝낼 수 있는 가짜 — 시험이 끝난 뒤 타이머가 남아 러너를 붙들지 않게 한다. */
function 수동합성기() {
  const 호출 = { n: 0 }
  let 끝내기 = () => {}
  const generate = async () => {
    호출.n++
    await new Promise((r) => { 끝내기 = r })
    const f = path.join(os.tmpdir(), `cc-fake-tts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`)
    fs.writeFileSync(f, Buffer.alloc(4096, 1))
    fs.writeFileSync(cuesPathOf(f), '[]')
    return f
  }
  return { generate, 호출, 끝내기: () => 끝내기() }
}

test('겹쳐 들어온 같은 문장은 합성을 **한 번만** 하고 둘 다 소리 파일을 받는다', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-dedupe-'))
  try {
    const { generate, 호출 } = 가짜합성기(150)
    const params = { text: '점심 식사 시간입니다', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }
    const [a, b] = await Promise.all([
      generateTTSWithRetry(params, 1, { generate, cacheDir }),
      generateTTSWithRetry(params, 1, { generate, cacheDir }),
    ])
    assert.equal(호출.n, 1, `같은 문장을 ${호출.n}번 합성했다`)
    assert.ok(fs.existsSync(a) && fs.existsSync(b), '둘 중 하나가 소리 파일을 못 받았다')
    assert.notEqual(a, b, '같은 임시 파일을 나눠 가지면 한쪽이 지울 때 다른 쪽 재생이 깨진다')
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
})

test('다른 문장은 기다리지 않고 따로 합성한다', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-dedupe-'))
  try {
    const { generate, 호출 } = 가짜합성기(50)
    await Promise.all([
      generateTTSWithRetry({ text: '가', voice: 'v', rate: '+0%', pitch: '+0Hz' }, 1, { generate, cacheDir }),
      generateTTSWithRetry({ text: '나', voice: 'v', rate: '+0%', pitch: '+0Hz' }, 1, { generate, cacheDir }),
    ])
    assert.equal(호출.n, 2)
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
})

test('앞선 합성이 실패하면 기다리던 쪽이 **스스로 다시 만든다**', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-dedupe-'))
  try {
    const 실패 = 가짜합성기(80, true)
    const 성공 = 가짜합성기(20)
    const params = { text: '환기 시간입니다', voice: 'v', rate: '+0%', pitch: '+0Hz' }
    const 앞 = generateTTSWithRetry(params, 1, { generate: 실패.generate, cacheDir }).catch((e) => e)
    await new Promise((r) => setTimeout(r, 10))
    const 뒤 = await generateTTSWithRetry(params, 1, { generate: 성공.generate, cacheDir })
    assert.ok(fs.existsSync(뒤), '앞이 실패했는데 뒤가 소리를 못 받았다')
    assert.equal(성공.호출.n, 1)
    assert.ok((await 앞) instanceof Error)
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
})

// ── **기다림이 합성을 잡아먹지 않는다** (적대적 검수 2026-09-18) ──────────────────────────
// 앞 판은 예산이 있으면 **남은 예산 전부**를 기다림에 걸었다. 그래서 기다림이 헛돌고 나면
// `직접합성` 첫 줄에서 곧바로 「예산 초과」로 빠져나가 **한 번도 시도하지 않고** 실패했다.
// 정시 방송의 안내 음성이 조용히 빠지는 자리라, 예산 절반만 기다리게 고쳤다.

test('예산이 있을 때 — 앞 합성이 늦으면 **기다리다 말고 자기가 만든다**(시도 0회로 끝나지 않는다)', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-dedupe-'))
  try {
    const 느림 = 수동합성기()          // 손으로 끝내기 전에는 안 끝난다
    const 내것 = 가짜합성기(30)
    const params = { text: '정시 방송입니다', voice: 'v', rate: '+0%', pitch: '+0Hz' }
    const 앞 = generateTTSWithRetry(params, 1, { generate: 느림.generate, cacheDir }).catch((e) => e)
    await new Promise((r) => setTimeout(r, 10))
    const 뒤 = await generateTTSWithRetry(params, 1, { generate: 내것.generate, cacheDir, deadlineMs: 600 })
    // **판정 근거는 시계가 아니라 「몇 번 불렀나」다.** 예산을 전부 기다림에 쓰면 `직접합성` 첫 줄이
    // 곧바로 「예산 초과」로 빠져나가 **호출 0회**가 된다 — 그것이 이 결함의 모양이었다.
    // 경과 시간으로 보면 합본 실행의 부하에 흔들린다(실제로 668ms 가 나와 빨간불이 났다).
    assert.equal(내것.호출.n, 1, '자기 합성을 한 번도 안 했다 — 기다리기만 하다 무음이 된다')
    assert.ok(fs.existsSync(뒤), '소리 파일을 못 받았다')
    느림.끝내기(); await 앞
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
})

test('예산이 없어도 **무한정 기다리지 않는다** — 사람이 누른 즉시 방송이 멎어 보이면 안 된다', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-dedupe-'))
  const 원래 = require('../services/tts').BROADCAST_BUDGET_MS
  try {
    // 상한이 실제로 걸리는지는 「앞엣것보다 먼저 끝나는가」로 본다.
    const 느림 = 수동합성기()
    const 내것 = 가짜합성기(30)
    const params = { text: '즉시 방송입니다', voice: 'v', rate: '+0%', pitch: '+0Hz' }
    const 앞 = generateTTSWithRetry(params, 1, { generate: 느림.generate, cacheDir }).catch(() => {})
    await new Promise((r) => setTimeout(r, 10))
    const 잰시작 = Date.now()
    const 뒤 = await generateTTSWithRetry(params, 1, { generate: 내것.generate, cacheDir })
    assert.ok(fs.existsSync(뒤))
    assert.ok(Date.now() - 잰시작 <= 원래 + 2000,
      `앞 합성이 끝날 때까지 기다렸다 — ${Date.now() - 잰시작}ms`)
    느림.끝내기(); await 앞
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
})
