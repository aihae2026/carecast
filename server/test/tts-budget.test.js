// 방송 경로의 시간 예산 (2026-09-03 저녁).
//
// 왜 필요했나: 같은 날 오전에 모든 TTS 경로를 재시도 래퍼로 돌렸다(9438777). 그 전에는
// 예약이 맨 generateTTS를 불러 60초 뒤 그냥 실패했는데, 재시도가 붙으면서 **캐시가 없고
// 회선이 막히면 60초×3회 + 대기로 3분 넘게 기다릴 수 있게 됐다.** 그동안 같은 분의 다른
// 예약도 뒤에서 밀린다 — 발사가 순차이기 때문이다. 그건 바꾸기 전보다 나쁜 상태다.
//
// 방송은 **정시에 나가거나, 못 나가면 그것을 알리는 것**이 맞다. 그래서 방송 경로에는
// 15초 예산을 준다(현장 실측 1.4~4.2초의 서너 배라 정상 경로는 안 걸린다).
// 미리듣기·미리만들기는 급하지 않으므로 예전 그대로 넉넉히 둔다.
//
// 고정하는 사실 여섯:
//  1. 예산을 넘기면 **더 기다리지 않는다** — 남은 시도를 버린다
//  2. 예산은 **한 번의 시도에도 걸린다** — 첫 시도가 60초를 다 쓰고 나서 알면 늦다
//  3. 예산이 끝나도 **캐시가 있으면 그 소리로 나간다**(무음보다 어제 소리가 낫다)
//  4. 캐시도 없으면 던진다 — 없는 소리를 지어내지 않는다
//  5. 예산을 안 주면 예전과 똑같다(미리듣기 경로가 안 바뀌었다는 뜻)
//  6. 방송 경로 네 곳이 실제로 예산을 넘긴다 — 한 곳이라도 빠지면 거기만 3분 기다린다
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../services/tts')

const PARAMS = { text: '예산 시험 문구', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }

function tempDir() {
  const d = path.join(os.tmpdir(), `carecast_budget_${process.pid}_${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 절대 안 끝나는 합성기 — 넘겨받은 timeoutMs만큼 기다렸다 실패한다(진짜 옛 인터넷 합성 엔진 흉내). */
function hangingGenerator() {
  const seen = []
  return {
    seen,
    generate: (params, opts = {}) => new Promise((_, reject) => {
      const ms = opts.timeoutMs ?? 60000
      seen.push(ms)
      setTimeout(() => reject(new Error(`TTS 생성 타임아웃 (${Math.round(ms / 1000)}초 초과)`)), ms)
    }),
  }
}

// 시간 상한을 둔다 — 예산이 시도에 안 걸리는 회귀가 나면 이 테스트가 60초씩 매달리는 대신
// 곧바로 빨간불이 된다(2026-09-03 뮤테이션에서 실제로 2분을 날렸다).
test('사실1·2 — 예산을 넘기면 더 기다리지 않고, 한 번의 시도에도 걸린다', { timeout: 15000 }, async () => {
  const dir = tempDir()
  const g = hangingGenerator()
  const t0 = Date.now()

  await assert.rejects(
    () => T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir, deadlineMs: 600 }))

  // **벽시계는 느슨하게 본다.** 합본 실행에서는 워커 여럿이 붙어 타이머가 밀린다
  // (2026-09-03: 0.6초 예산인데 2.46초가 걸려 이 줄이 헛되이 빨간불이 됐다).
  // 여기서 잡으려는 회귀는 "분 단위로 기다린다"(60초×3회)이지 수백 밀리초의 흔들림이 아니다.
  // 정확한 판정은 아래 두 줄(시도 상한·호출 횟수)이 하고, 이 줄은 최후 방어선이다.
  const spent = Date.now() - t0
  assert.ok(spent < 10000, `예산 0.6초인데 ${spent}ms를 기다렸다 — 분 단위로 매달리고 있다`)
  // 첫 시도에 넘긴 상한이 예산 이하여야 한다 — 60초를 넘겼다면 예산이 시도에 안 걸린 것이다
  assert.ok(g.seen[0] <= 600, `첫 시도 상한이 ${g.seen[0]}ms다 — 예산이 시도에 안 걸렸다`)
  // **예산이 끝나면 다시 부르지 않는다.** 남은 시간이 0인데 또 부르면, 그 호출이 곧바로
  // 실패하더라도 "예산을 다 썼다"는 사실이 로그에 안 남고 재시도 횟수만 헛돈다.
  assert.equal(g.seen.length, 1, `예산을 다 쓰고도 ${g.seen.length}번 불렀다`)
})

// ── 예산 끝 **몇 ms 전**에 실패하면 (2026-10-07) ─────────────────────────────────────────
// 위 시험이 전체 verify 에서만 가끔 「2번 불렀다」로 빨갰다. 타이머가 1~2ms 일찍 울리면 남은 예산이 「1ms」로
// 계산돼, 될 리 없는 시도를 한 번 더 부르고 「예산 초과」 기록도 안 남겼다. 그 경계를 **일부러** 만든다:
// 시도가 받은 상한보다 30ms 일찍 실패한다(3ms 로는 실패 처리 중에 그만큼 흘러 경계가 안 생겼다 — 처음부터
// 초록이라 30 으로 올렸다). 합성은 1초 남짓 걸리므로 수십 ms 로는 시도할 이유가 없다.
test('예산 끝 몇 ms 전에 실패해도 다시 부르지 않는다 — 남은 몇 ms 로는 시도하지 않는다', { timeout: 15000 }, async () => {
  const dir = tempDir()
  const seen = []
  const generate = (params, opts = {}) => new Promise((_, reject) => {
    seen.push(opts.timeoutMs)
    setTimeout(() => reject(new Error('일찍 실패')), Math.max(0, (opts.timeoutMs ?? 60000) - 30))
  })
  await assert.rejects(() => T.generateTTSWithRetry(PARAMS, 3, { generate, cacheDir: dir, deadlineMs: 400 }))
  assert.equal(seen.length, 1, `남은 몇 ms 로 다시 불렀다(상한 ${seen.join('·')}ms)`)
})

test('사실3 — 예산이 끝나도 캐시가 있으면 그 소리로 나간다', async () => {
  const dir = tempDir()
  // 어제 성공본을 심어 둔다
  fs.writeFileSync(T.cachePathFor(PARAMS, dir), Buffer.alloc(50000))

  const g = hangingGenerator()
  const f = await T.generateTTSWithRetry(PARAMS, 3,
    { generate: g.generate, cacheDir: dir, deadlineMs: 500, noCache: true })
  assert.ok(fs.existsSync(f), '캐시가 있는데도 무음으로 끝났다')
  fs.unlinkSync(f)
})

test('사실4 — 캐시도 없으면 던진다', async () => {
  const dir = tempDir()
  const g = hangingGenerator()
  await assert.rejects(
    () => T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir, deadlineMs: 400 }),
    /타임아웃|예산/)
})

test('사실5 — 예산을 안 주면 예전과 같다(시도 상한을 안 건드린다)', async () => {
  const dir = tempDir()
  const g = hangingGenerator()
  // 예산 없이 부르면 시도에 상한을 안 넘긴다 = generateTTS 기본값(60초)을 쓴다
  const p = T.generateTTSWithRetry({ ...PARAMS, text: '예산 없음' }, 1,
    { generate: (params, opts) => { g.seen.push(opts?.timeoutMs); return Promise.reject(new Error('실패')) },
      cacheDir: dir })
  await assert.rejects(() => p)
  assert.equal(g.seen[0], undefined, '예산이 없는데 시도 상한을 넘겼다')
  assert.equal(T.DEFAULT_TIMEOUT_MS, 60000, '기본 상한이 바뀌었다')
})

test('사실6 — 방송 경로 네 곳이 예산을 넘긴다', () => {
  const readSrc = (f) => fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8')
  const budgeted = (src) => (src.match(/generateTTSWithRetry\([\s\S]{0,200}?deadlineMs: BROADCAST_BUDGET_MS/g) || []).length

  assert.equal(budgeted(readSrc('scheduler.js')), 2, '예약·특보 중 하나가 예산 없이 부른다')
  assert.equal(budgeted(readSrc('flowRunner.js')), 1, '흐름 TTS 단계가 예산 없이 부른다')

  // ── broadcastSteps 는 이제 **아예 안 부른다** (3단계, 2026-09-06) ──────────
  //
  // 예전에는 여기서 예산 15초를 걸고 합성했다. 그런데 그 15초가 곧 방송 지연이었다 —
  // 12:00 방송이 12:01에 나가던 원인이 이 자리다. 그래서 합성을 발사 경로에서 걷어내고
  // renderOnDemand(캐시가 먼저, 합성은 예외)로 옮겼다.
  //
  // 상한도 15초 고정이 아니라 방송 성격이 정한다(domain/broadcastGrace.js):
  //   긴급 → 없음 · {{시각}} 포함 → 30초 · 그 외 → 5분.
  // **누락이 지연보다 나쁘다**는 판단(사용자 결정)이 그 값에 들어 있다.
  //
  // 이 단언을 되돌리려면 먼저 왜 걷어냈는지부터 다시 보라.
  const steps = readSrc('broadcastSteps.js')
  const 코드줄 = steps.split('\n').filter((l) => !l.trim().startsWith('//'))
  assert.equal(코드줄.filter((l) => /generateTTS\w*\s*\(/.test(l)).length, 0,
    '발사 경로가 다시 합성을 부르고 있다 — 그 시간이 곧 방송 지연이 된다')
  assert.match(steps, /obtainAudio\(/, '소리 확보가 renderOnDemand 를 안 지난다')

  // 미리 만들기는 급하지 않다 — 예산을 걸면 오히려 미리 만들 기회를 잃는다
  const sch = readSrc('scheduler.js')
  const i = sch.indexOf('async function prewarmUpcomingSchedules')
  assert.doesNotMatch(sch.slice(i, i + 1600), /deadlineMs/,
    '미리 만들기에까지 예산을 걸면, 느린 날 미리 만들지 못해 정작 발사 때 기다리게 된다')

  assert.equal(T.BROADCAST_BUDGET_MS, 15000, '예산이 바뀌었다 — 현장 실측 1.4~4.2초 기준이다')
})
