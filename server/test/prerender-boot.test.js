// 기동 순서 — **스케줄러가 먼저 뜨고, 선제 렌더는 그 뒤에 비동기로 돈다.**
//
// 왜 이 테스트가 있나: 현장은 07:45 전원 · 07:49 부팅 완료 · 07:50 첫 방송이다.
// 부팅과 첫 방송 사이가 **60초**뿐이라, 기동 경로에서 합성을 동기로 기다리면
// 그 60초를 다 쓰고 스케줄러가 늦게 뜬다 — **고치려던 것보다 나쁜 일**이 생긴다.
// 순서가 뒤집히는 것은 코드를 읽어야만 보이므로 소스로 고정한다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_boot_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const INDEX = path.join(__dirname, '..', 'index.js')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('스케줄러가 선제 렌더보다 **먼저** 뜬다', () => {
  const src = fs.readFileSync(INDEX, 'utf8')
  const 스케줄러 = src.indexOf('startScheduler()')
  const 렌더    = src.indexOf('warmupThenPrerender')
  assert.ok(스케줄러 > -1, 'startScheduler() 를 못 찾았다')
  assert.ok(렌더 > -1, '선제 렌더 호출을 못 찾았다')
  assert.ok(스케줄러 < 렌더,
    '선제 렌더가 스케줄러보다 먼저 온다 — 부팅 60초 창에서 방송이 밀린다')
})

test('선제 렌더를 기동 경로에서 **기다리지 않는다**', () => {
  const src = fs.readFileSync(INDEX, 'utf8')
  const 줄 = src.split('\n')
  const i = 줄.findIndex((l) => l.includes('warmupThenPrerender'))
  assert.ok(i > -1)
  const 근처 = 줄.slice(Math.max(0, i - 4), i + 3).join('\n')
  // setImmediate 로 떼어 놓고, 그 자리에서 await 하지 않는다.
  assert.match(근처, /setImmediate\(/, '선제 렌더가 기동 흐름에 붙어 있다')
  assert.doesNotMatch(근처, /await\s+require\('\.\/services\/bootWarmup'\)/,
    '기동 경로에서 선제 렌더를 기다리고 있다 — 스케줄러가 늦게 뜬다')
  // 실패해도 기동이 죽으면 안 된다
  assert.match(근처, /\.catch\(/, '선제 렌더 실패가 기동을 죽일 수 있다')
})

test('기동 준비는 던지지 않는다 — 네트워크가 없어도 계속 간다', async () => {
  const { initDB, getDB } = require('../db/schema')
  initDB()
  const boot = require('../services/bootWarmup')
  const 찍힌 = []
  // 도달 확인을 항상 실패시키고, 기다리지 않게 한다(시험이 30초를 쓰면 안 된다)
  const r = await boot.warmupThenPrerender(getDB(), {
    log: (m) => 찍힌.push(m),
    network: { tries: 2, gapMs: 1, probeTimeoutMs: 10 },
    deps: { fetchFn: async () => { throw new Error('offline') }, sleep: async () => {} },
  })
  assert.equal(r.network, false)
  assert.equal(r.prerender, null, '네트워크가 없는데 합성을 시도했다')
  assert.ok(찍힌.join('\n').includes('네트워크에 못 닿았습니다'), `안내가 없다: ${찍힌.join(' / ')}`)
})

test('네트워크가 되면 예열과 선제 렌더로 넘어간다', async () => {
  const { getDB } = require('../db/schema')
  const boot = require('../services/bootWarmup')
  const 찍힌 = []
  // 예열·렌더는 실제 합성을 안 하도록 tts 를 가로챈다
  const ttsPath = require.resolve('../services/tts')
  const 진짜 = require.cache[ttsPath]
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true,
    exports: { ...진짜.exports, generateTTSWithRetry: async () => 'C:/tmp/fake.mp3', deleteTmpFile: () => {} },
  }
  delete require.cache[require.resolve('../services/bootWarmup')]
  delete require.cache[require.resolve('../services/prerenderAuto')]
  try {
    const b2 = require('../services/bootWarmup')
    const r = await b2.warmupThenPrerender(getDB(), {
      log: (m) => 찍힌.push(m),
      network: { tries: 1, gapMs: 1, probeTimeoutMs: 10 },
      deps: { fetchFn: async () => ({ ok: true, status: 200 }), sleep: async () => {} },
    })
    assert.equal(r.network, true)
    assert.ok(r.prerender, '네트워크가 되는데 선제 렌더를 안 했다')
    assert.ok(찍힌.join('\n').includes('TTS 예열'), '예열을 건너뛰었다')
  } finally {
    require.cache[ttsPath] = 진짜
    delete require.cache[require.resolve('../services/bootWarmup')]
    delete require.cache[require.resolve('../services/prerenderAuto')]
    void boot
  }
})
