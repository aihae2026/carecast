// 옛 인터넷 합성 엔진가 실패했을 때 기댈 것이 있는가.
//
// 왜 필요했나(2026-08-29 리뷰 CC-016): generateTTSWithRetry는 3번 실패하면 그냥 throw했다.
// 대체 음원 경로도, 사전 생성 캐시도 없었다. audioStore는 30분 TTL 인메모리 1회 소비
// 저장소라 캐시가 아니다(consumeAudio가 꺼내면서 지운다).
//
// 그런데 이 시스템이 매일 읽는 문장은 대부분 **고정 문구**다 — 식사 전 안내문, 투약 안내,
// 체조 안내. 어제 성공한 그 mp3를 남겨 두면 인터넷이 끊긴 날에도 같은 소리가 나간다.
// 캐시 적중률이 사실상 100%인 문장들이다.
//
// 지키는 선: **없는 소리를 지어내지 않는다.** 캐시도 없고 생성도 실패하면 지금처럼 throw해서
// 단계 격리(CC-007)가 그 단계만 건너뛰게 한다. 엉뚱한 문장을 대신 읽으면 그게 더 나쁘다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttscache_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const tts = require('../services/tts')

const CACHE_DIR = path.join(os.tmpdir(), `carecast_test_ttscachedir_${process.pid}_${Date.now()}`)

const PARAMS = { text: '식사 안내 드리겠습니다.', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }

// 진짜 옛 인터넷 합성 엔진를 부르지 않도록 생성 함수를 주입한다
// 가짜 음원. **크기를 실제 mp3에 가깝게 준다** — 2026-09-03부터 잘린 결과(512바이트 미만)는
// 캐시에 넣지 않는다(0바이트로 죽은 옛 인터넷 합성 엔진 결과가 캐시에 앉으면 매일 그 무음이 나간다).
// 3바이트짜리 'MP3'는 그 규칙에 걸리는 쓰레기라, 머리말은 그대로 두고 뒤를 채운다.
function fakeGenerator({ fail = false, body = 'MP3' + 'x'.repeat(4096) } = {}) {
  return async () => {
    if (fail) throw new Error('TTS 생성 타임아웃 (60초 초과)')
    const f = path.join(os.tmpdir(), `carecast_fake_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
    fs.writeFileSync(f, body)
    return f
  }
}

test.after(() => {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }) } catch { /* 무시 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 캐시 키 ────────────────────────────────────────────────────

test('같은 문장·목소리·속도면 같은 캐시 키다', () => {
  assert.equal(tts.cacheKeyFor(PARAMS), tts.cacheKeyFor({ ...PARAMS }))
})

test('문장이나 목소리·속도가 다르면 다른 캐시 키다 — 엉뚱한 음성이 나가면 안 된다', () => {
  const base = tts.cacheKeyFor(PARAMS)
  assert.notEqual(base, tts.cacheKeyFor({ ...PARAMS, text: '다른 문장입니다.' }))
  assert.notEqual(base, tts.cacheKeyFor({ ...PARAMS, voice: 'ko-KR-InJoonNeural' }))
  assert.notEqual(base, tts.cacheKeyFor({ ...PARAMS, rate: '-20%' }))
  assert.notEqual(base, tts.cacheKeyFor({ ...PARAMS, pitch: '+5Hz' }))
})

// ── 성공분 보관 ────────────────────────────────────────────────

test('생성에 성공하면 그 음원을 캐시에 남긴다', async () => {
  const out = await tts.generateTTSWithRetry(PARAMS, 3, {
    generate: fakeGenerator(), cacheDir: CACHE_DIR,
  })
  assert.ok(fs.existsSync(out), '이번 재생에 쓸 파일은 그대로 돌아와야 한다')
  const cached = path.join(CACHE_DIR, `${tts.cacheKeyFor(PARAMS)}.mp3`)
  assert.ok(fs.existsSync(cached), '다음에 실패했을 때 기댈 것이 있어야 한다')
})

// ── 실패 시 폴백 ───────────────────────────────────────────────

test('생성이 실패하면 지난번 성공본으로 대체한다 — 인터넷이 끊겨도 같은 소리가 나간다', async () => {
  // 앞 테스트에서 캐시가 만들어져 있다
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    generate: fakeGenerator({ fail: true }), cacheDir: CACHE_DIR,
  })
  assert.ok(fs.existsSync(out))
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('MP3'), '캐시된 그 음원이어야 한다')
})

test('폴백으로 준 파일을 지워도 캐시 원본은 남는다 — 다음 방송에도 쓸 수 있어야 한다', async () => {
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    generate: fakeGenerator({ fail: true }), cacheDir: CACHE_DIR,
  })
  tts.deleteTmpFile(out)   // 시퀀서가 재생 후 하는 일
  const cached = path.join(CACHE_DIR, `${tts.cacheKeyFor(PARAMS)}.mp3`)
  assert.ok(fs.existsSync(cached), '임시 사본을 지웠다고 캐시 원본이 사라지면 다음날 또 무음이다')
})

test('캐시도 없고 생성도 실패하면 그대로 던진다 — 없는 소리를 지어내지 않는다', async () => {
  await assert.rejects(
    () => tts.generateTTSWithRetry(
      { ...PARAMS, text: '한 번도 만든 적 없는 문장입니다.' }, 1,
      { generate: fakeGenerator({ fail: true }), cacheDir: CACHE_DIR },
    ),
    /타임아웃|실패/,
    '엉뚱한 문장을 대신 읽는 것보다 그 단계를 건너뛰는 편이 낫다(CC-007이 받는다)',
  )
})

test('캐시 디렉터리를 못 써도 생성 자체는 성공한다', async () => {
  // 파일을 디렉터리 경로로 줘서 mkdir이 실패하는 상황
  const blocker = path.join(os.tmpdir(), `carecast_block_${process.pid}_${Date.now()}`)
  fs.writeFileSync(blocker, 'x')
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    generate: fakeGenerator(), cacheDir: blocker,
  })
  assert.ok(fs.existsSync(out), '캐시를 못 남긴다고 이번 방송까지 실패시키면 안 된다')
  try { fs.unlinkSync(blocker) } catch { /* 무시 */ }
})

// 이 캐시는 로그보다 위험하다 — 아침 종합 방송 문구에는 날씨와 날짜가 들어가서 **매일 새
// 키**가 생긴다. 지우는 주체가 없으면 무인 6개월 운영 동안 계속 쌓이기만 하고, 디스크가
// 차면 SQLite 쓰기가 막혀 방송 기록 자체가 끊긴다. 같은 커밋에서 만든 fileLog.js는 30일
// prune을 넣으며 그 근거까지 적어놨는데 이 캐시만 빠져 있었다(2026-08-30 재점검 CC-051).
test('pruneCache: 보관 기간이 지난 캐시 mp3만 지운다', () => {
  const dir = path.join(os.tmpdir(), `carecast_prune_${process.pid}_${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })

  const sha = (c) => c.repeat(40)
  const old = path.join(dir, `${sha('a')}.mp3`)
  const now = path.join(dir, `${sha('b')}.mp3`)
  const etc = path.join(dir, 'readme.txt')          // 우리가 만든 파일이 아니면 손대지 않는다
  const odd = path.join(dir, 'not-a-sha.mp3')       // 이름 규칙에 안 맞는 mp3도 마찬가지
  for (const f of [old, now, etc, odd]) fs.writeFileSync(f, 'x')

  const days = (n) => Date.now() - n * 24 * 3600 * 1000
  fs.utimesSync(old, new Date(days(40)), new Date(days(40)))
  fs.utimesSync(etc, new Date(days(40)), new Date(days(40)))
  fs.utimesSync(odd, new Date(days(40)), new Date(days(40)))

  const removed = tts.pruneCache(dir, 30)

  assert.equal(removed, 1, '오래된 캐시 1개만 지워야 한다')
  assert.ok(!fs.existsSync(old), '40일 된 캐시가 남았다')
  assert.ok(fs.existsSync(now), '최근 캐시를 지우면 폴백이 무의미해진다')
  assert.ok(fs.existsSync(etc), '우리가 만들지 않은 파일을 지우면 안 된다')
  assert.ok(fs.existsSync(odd), '이름 규칙에 안 맞는 mp3는 남의 것일 수 있다')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('pruneCache: 디렉터리가 없어도 던지지 않는다 — 청소가 기동을 막으면 안 된다', () => {
  const missing = path.join(os.tmpdir(), `carecast_prune_none_${process.pid}_${Date.now()}`)
  assert.equal(tts.pruneCache(missing, 30), 0)
})

test('보관 기간이 fileLog와 같다 — 같은 이유(디스크 풀)로 넣은 장치다', () => {
  assert.equal(tts.CACHE_KEEP_DAYS, require('../services/fileLog').DEFAULT_KEEP_DAYS)
})

// ── 자막 사이드카 ──────────────────────────────────────────────
//
// 자막은 mp3 옆에 같은 이름(`<파일>.cues.json`)으로 붙어 다닌다. 여기서 어긋나면 조용히
// 망가진다 — 소리는 그대로 나가고 자막만 안 나온다. 로그에도 아무것도 안 남는다.

const CUES = JSON.stringify([[0.1, 0.6, '식사'], [0.7, 1.4, '전'], [1.5, 2.4, '안내']])

// 파이썬이 mp3 옆에 자막을 남긴 상황을 흉내낸다.
function fakeGeneratorWithCues(cues = CUES) {
  return async () => {
    const f = path.join(os.tmpdir(), `carecast_fake_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
    fs.writeFileSync(f, 'MP3' + 'x'.repeat(4096))
    if (cues !== null) fs.writeFileSync(tts.cuesPathOf(f), cues)
    return f
  }
}

test('자막을 mp3와 같은 키로 캐시에 짝지어 둔다', async () => {
  const dir = path.join(os.tmpdir(), `carecast_cues_save_${process.pid}_${Date.now()}`)
  const out = await tts.generateTTSWithRetry(PARAMS, 1, { generate: fakeGeneratorWithCues(), cacheDir: dir })

  assert.ok(fs.existsSync(tts.cuesPathOf(tts.cachePathFor(PARAMS, dir))),
    '자막이 캐시에 안 들어갔다 — 다음부터 소리만 나고 자막이 없다')
  tts.deleteTmpFile(out)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('캐시로 재생해도 자막이 함께 나온다', async () => {
  const dir = path.join(os.tmpdir(), `carecast_cues_hit_${process.pid}_${Date.now()}`)
  tts.deleteTmpFile(await tts.generateTTSWithRetry(PARAMS, 1, { generate: fakeGeneratorWithCues(), cacheDir: dir }))

  // 두 번째 호출은 합성 없이 캐시로 나가야 한다
  let synthesized = 0
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    cacheDir: dir,
    generate: async () => { synthesized++; throw new Error('여기 오면 안 된다') },
  })
  assert.equal(synthesized, 0, '자막 있는 캐시인데 다시 합성했다 — 정시 방송이 늦어진다')
  assert.ok(fs.existsSync(tts.cuesPathOf(out)), '캐시본에 자막이 안 딸려 왔다')

  tts.deleteTmpFile(out)
  fs.rmSync(dir, { recursive: true, force: true })
})

// 매일 나가는 고정 문구는 copyFromCache가 mtime을 되돌려 30일 청소에도 안 걸린다. 자막이
// 없는 옛 캐시를 그냥 쓰면 그 문장은 **영원히** 자막이 없다.
test('자막 없는 옛 캐시는 한 번 다시 만들어 자막을 채운다', async () => {
  const dir = path.join(os.tmpdir(), `carecast_cues_old_${process.pid}_${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tts.cachePathFor(PARAMS, dir), 'MP3' + 'x'.repeat(4096))   // 자막 없는 옛 캐시

  let synthesized = 0
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    cacheDir: dir,
    generate: async (...a) => { synthesized++; return fakeGeneratorWithCues()(...a) },
  })
  assert.equal(synthesized, 1, '자막 없는 캐시를 그대로 써버렸다 — 그 문장은 영영 자막이 없다')
  assert.ok(fs.existsSync(tts.cuesPathOf(tts.cachePathFor(PARAMS, dir))), '다시 만든 자막이 캐시에 안 남았다')

  tts.deleteTmpFile(out)
  fs.rmSync(dir, { recursive: true, force: true })
})

// 어절이 하나도 안 나오는 문장이 있으면(엔진이 경계를 안 주는 경우) 사이드카가 안 생긴다.
// 그러면 위 규칙 때문에 그 문장만 매번 다시 합성한다 — 캐시를 영영 못 타는 문장이 생긴다.
test('어절이 안 나와도 빈 자막을 남겨 매번 다시 합성하지 않는다', async () => {
  const dir = path.join(os.tmpdir(), `carecast_cues_empty_${process.pid}_${Date.now()}`)
  tts.deleteTmpFile(await tts.generateTTSWithRetry(PARAMS, 1, {
    generate: fakeGeneratorWithCues(null), cacheDir: dir,     // 파이썬이 자막을 못 남긴 상황
  }))

  let synthesized = 0
  const out = await tts.generateTTSWithRetry(PARAMS, 1, {
    cacheDir: dir,
    generate: async (...a) => { synthesized++; return fakeGeneratorWithCues(null)(...a) },
  })
  assert.equal(synthesized, 0, '자막이 없는 문장을 매번 다시 합성하고 있다')

  tts.deleteTmpFile(out)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('readCues: 자막이 없으면 null — 소리만 나가면 된다', () => {
  assert.equal(tts.readCues(path.join(os.tmpdir(), 'carecast_no_such.mp3'), '아무 말'), null)
})

test('pruneCache: 짝 mp3가 사라진 자막은 나이와 무관하게 지운다', () => {
  const dir = path.join(os.tmpdir(), `carecast_prune_cues_${process.pid}_${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })

  const sha = (c) => c.repeat(40)
  const keep    = path.join(dir, `${sha('a')}.mp3`)            // 짝이 있는 자막
  const orphan  = path.join(dir, `${sha('b')}.mp3.cues.json`)  // 소리가 없는 자막
  fs.writeFileSync(keep, 'x')
  fs.writeFileSync(tts.cuesPathOf(keep), CUES)
  fs.writeFileSync(orphan, CUES)

  const removed = tts.pruneCache(dir, 30)

  assert.equal(removed, 1, '고아 자막 1개만 지워야 한다')
  assert.ok(!fs.existsSync(orphan), '소리 없는 자막이 남았다 — 다음 청소에도 계속 살아남는다')
  assert.ok(fs.existsSync(tts.cuesPathOf(keep)), '짝이 있는 자막을 지우면 안 된다')

  fs.rmSync(dir, { recursive: true, force: true })
})
