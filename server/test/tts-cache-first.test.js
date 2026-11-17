// TTS는 **캐시를 먼저 본다** — "12:00 예약인데 12:01에 나온다"의 원인 (2026-09-03 사용자 신고).
//
// 무엇이 문제였나:
//  · 예약 발사는 정시인데 **소리는 합성이 끝나야** 난다. 실측 2.25초(이 PC), 현장은 회선이
//    느려 더 걸리고 실패하면 재시도·타임아웃(60초)까지 붙는다.
//  · 그런데 이 시스템이 읽는 문장은 대부분 매일 같다(환기·투약·식사 안내·체조).
//  · 더 나쁜 것: **재시도·폴백·캐시를 담은 generateTTSWithRetry를 아무도 안 부르고 있었다.**
//    실제 경로 8곳이 전부 맨 generateTTS를 써서, CC-016으로 만든 폴백이 한 번도 동작할 수
//    없었고 캐시에 저장되는 일 자체가 없었다.
//
// 고정하는 사실 여섯:
//  1. 캐시가 있으면 **합성을 아예 안 부른다**(정시 재생의 근거)
//  2. 캐시를 쓸 때마다 나이를 되돌린다 — 안 그러면 매일 쓰는 고정 문구가 30일째에 지워진다
//  3. 잘린 캐시(작은 파일)는 없는 셈 친다 — 그 무음이 매일 나가면 안 된다
//  4. 잘린 결과는 캐시에 저장하지도 않는다
//  5. 합성 실패는 재시도하고, 그래도 안 되면 지난 성공본으로 낸다
//  6. **실제 방송 경로가 맨 generateTTS를 쓰지 않는다** — 오늘 발견한 구멍을 못 박는다
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../services/tts')

const PARAMS = { text: '점심 식사 시간입니다', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }

function tempCacheDir() {
  const dir = path.join(os.tmpdir(), `carecast_ttscache_${process.pid}_${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 합성기 흉내 — 부른 횟수를 센다. 진짜 옛 인터넷 합성 엔진는 부르지 않는다(네트워크·수 초). */
function fakeGenerator(bytes = 50000) {
  const calls = []
  return {
    calls,
    generate: async (params) => {
      calls.push(params)
      const f = path.join(os.tmpdir(), `carecast_fake_${Date.now()}_${calls.length}.mp3`)
      fs.writeFileSync(f, Buffer.alloc(bytes))
      return f
    },
  }
}

test('사실1 — 캐시가 있으면 합성을 아예 안 부른다', async () => {
  const dir = tempCacheDir()
  const g = fakeGenerator()

  const first = await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir })
  assert.equal(g.calls.length, 1, '처음에는 합성해야 한다')
  fs.unlinkSync(first)

  const second = await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir })
  assert.equal(g.calls.length, 1, '캐시가 있는데도 또 합성했다 — 그만큼 방송이 늦는다')
  assert.ok(fs.existsSync(second))
  fs.unlinkSync(second)

  // 문장이 한 글자만 달라도 다른 소리다 — 그때는 합성해야 한다
  await T.generateTTSWithRetry({ ...PARAMS, text: '저녁 식사 시간입니다' }, 3,
    { generate: g.generate, cacheDir: dir }).then(f => fs.unlinkSync(f))
  assert.equal(g.calls.length, 2)
})

test('사실2 — 캐시를 쓸 때마다 나이를 되돌린다', async () => {
  const dir = tempCacheDir()
  const g = fakeGenerator()
  await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir }).then(f => fs.unlinkSync(f))

  // 40일 전으로 돌려 둔다 — 30일 청소 대상이 되는 나이
  const cached = T.cachePathFor(PARAMS, dir)
  const old = new Date(Date.now() - 40 * 86400000)
  fs.utimesSync(cached, old, old)

  await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir }).then(f => fs.unlinkSync(f))

  const age = Date.now() - fs.statSync(cached).mtimeMs
  assert.ok(age < 60000, '캐시로만 재생하면 파일이 안 젊어져 매일 쓰는 문구가 30일째 사라진다')
  assert.equal(T.pruneCache(dir, 30), 0, '방금 쓴 캐시가 청소 대상이 됐다')
})

test('사실3 — 잘린 캐시는 없는 셈 친다', async () => {
  const dir = tempCacheDir()
  const g = fakeGenerator()
  // 0바이트짜리 캐시를 심어 둔다(옛 인터넷 합성 엔진가 죽으면서 남긴 것을 흉내)
  fs.writeFileSync(T.cachePathFor(PARAMS, dir), Buffer.alloc(10))

  const f = await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir })
  assert.equal(g.calls.length, 1, '잘린 캐시를 그대로 내보냈다 — 그 무음이 매일 나간다')
  fs.unlinkSync(f)
})

test('사실4 — 잘린 결과는 캐시에 저장하지 않는다', async () => {
  const dir = tempCacheDir()
  const g = fakeGenerator(100)   // 100바이트짜리 결과
  const f = await T.generateTTSWithRetry(PARAMS, 3, { generate: g.generate, cacheDir: dir })
  fs.unlinkSync(f)
  assert.equal(fs.existsSync(T.cachePathFor(PARAMS, dir)), false,
    '잘린 결과가 캐시에 들어갔다 — 내일부터 그 소리가 나간다')
})

test('사실5 — 실패는 재시도하고, 그래도 안 되면 지난 성공본으로 낸다', async () => {
  const dir = tempCacheDir()
  const good = fakeGenerator()
  await T.generateTTSWithRetry(PARAMS, 3, { generate: good.generate, cacheDir: dir }).then(f => fs.unlinkSync(f))

  // 캐시를 지우고(합성을 강제) 계속 실패시키면 → 폴백이 받아야 한다.
  // 캐시 파일은 남겨 두되 noCache로 캐시 우선을 끈다.
  let tries = 0
  const failing = async () => { tries++; throw new Error('네트워크 없음') }
  const f = await T.generateTTSWithRetry(PARAMS, 2, { generate: failing, cacheDir: dir, noCache: true })
  assert.equal(tries, 2, '재시도를 안 했다')
  assert.ok(fs.existsSync(f), '폴백이 없으면 그 단계는 무음이다')
  fs.unlinkSync(f)
})

test('사실6 — 실제 방송 경로가 맨 generateTTS를 쓰지 않는다', () => {
  // 오늘 발견한 구멍: 재시도·폴백·캐시를 담은 입구가 있는데 아무도 안 불렀다.
  const roots = ['routes', 'services']
  const offenders = []
  for (const root of roots) {
    const dir = path.join(__dirname, '..', root)
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js') || name === 'tts.js') continue
      const src = fs.readFileSync(path.join(dir, name), 'utf8')
      // 'generateTTS(' 중 'generateTTSWithRetry('가 아닌 것
      if (/(?<!WithRetry)\bgenerateTTS\(/.test(src)) offenders.push(`${root}/${name}`)
    }
  }
  assert.deepEqual(offenders, [],
    '맨 generateTTS를 부르면 재시도·폴백·캐시가 통째로 빠진다 — generateTTSWithRetry를 쓸 것')
})
