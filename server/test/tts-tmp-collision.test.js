// TTS 임시 파일 이름이 겹치면 **엉뚱한 문장이 방송된다** (2026-09-03 발견).
//
// 어떻게 찾았나: 합본 verify에서 tts-cache의 폴백 테스트가 한 번 빨간불이 났다
// ("캐시된 그 음원이어야 한다"인데 내용이 달랐다). 단독으로는 10/10 통과 — 부하 flake로
// 넘길 수 있었지만 실패 메시지가 "남의 파일을 읽었다"는 모양이라 소스를 봤고, 진짜였다.
//
// 원인: 임시 파일 이름이 `carecast_cached_${Date.now()}.mp3`처럼 **밀리초만** 담았다.
// os.tmpdir()는 온 프로세스가 함께 쓰는 곳이라, 같은 밀리초에 둘이 폴백하면 같은 경로를
// 만들어 서로 덮어쓴다. 그러면 A의 방송에 B의 음원이 실린다 — services/tts.js 머리말이
// "없는 소리를 지어내지 않는다 · 엉뚱한 문장을 대신 읽으면 그게 더 나쁘다"고 적어 둔
// 바로 그 사고다. 요양원에서 조용한 오작동이 가장 찾기 어렵다.
//
// 고정하는 사실:
//  1. 잇달아 만든 캐시 사본 경로는 서로 다르다(같은 밀리초여도)
//  2. 이름에 프로세스 구분이 들어간다 — 여러 프로세스가 같은 tmpdir을 쓴다
//  3. 생성 경로(mp3·파이썬 스크립트)도 같은 규칙이다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttstmp_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const tts = require('../services/tts')

const CACHE_DIR = path.join(os.tmpdir(), `carecast_ttstmp_${process.pid}_${Date.now()}`)
const PARAMS = { text: '겹침 확인용 문장입니다.', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' }

test.before(() => {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  // 캐시본 하나를 심어 둔다(하한 512바이트를 넘겨야 캐시로 인정된다)
  fs.writeFileSync(path.join(CACHE_DIR, `${tts.cacheKeyFor(PARAMS)}.mp3`), 'MP3' + 'x'.repeat(4096))
})
test.after(() => {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }) } catch { /* 무시 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('잇달아 만든 캐시 사본은 서로 다른 파일이다 — 같은 밀리초여도', async () => {
  const made = []
  for (let i = 0; i < 12; i++) {
    // 실패하는 생성기를 줘서 폴백(copyFromCache)만 타게 한다
    made.push(await tts.generateTTSWithRetry(PARAMS, 1, {
      cacheDir: CACHE_DIR,
      generate: async () => { throw new Error('TTS 생성 타임아웃 (60초 초과)') },
    }))
  }
  const unique = new Set(made)
  assert.equal(unique.size, made.length,
    `임시 파일 경로가 겹쳤다(${made.length}개 중 ${unique.size}개만 고유) — `
    + '같은 밀리초에 두 방송이 폴백하면 한쪽이 다른 쪽의 음원을 덮어쓴다. 엉뚱한 문장이 방송된다')
  for (const f of made) {
    assert.ok(fs.readFileSync(f, 'utf8').startsWith('MP3'), '내가 만든 사본이 아닌 것을 받았다')
    tts.deleteTmpFile(f)
  }
})

test('임시 이름에 프로세스 구분이 들어간다 — tmpdir은 온 프로세스가 함께 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'tts.js'), 'utf8')
  // 규칙 자체를 검사한다: **밀리초만으로 이름을 짓지 않는다.**
  // 이름 조각을 어떤 변수에 담아 쓰는지까지 못박으면 다음 사람이 이름만 바꿔도 빨간불이 난다.
  // 주석 줄은 뺀다 — 이 규칙을 설명하는 문장에 'os.tmpdir()'이 들어가 스스로 걸린다.
  assert.match(src, /function tmpName\(\)/,
    '고유 이름을 만드는 자리가 사라졌다 — 규칙이 흩어지면 한 곳이 다시 밀리초만 쓰게 된다')
  assert.match(src, /process\.pid/, 'tmpName이 프로세스를 구분하지 않는다')

  // 2026-09-21: 엔진별 임시 경로가 ttsEngines/ 로 갈라졌다 — **따라 옮긴다**(CLAUDE.md 「파일을 가를 때」).
  const 엔진들 = ['supertonic.js', 'azure.js', 'sapi.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'services', 'ttsEngines', f), 'utf8')).join('\n')
  const lines = (src + '\n' + 엔진들).split('\n')
    .filter(l => l.includes('os.tmpdir()') && !l.trim().startsWith('//'))
  assert.ok(lines.length >= 3, 'tmpdir을 쓰는 자리를 못 찾았다 — 검사가 헐거워졌다')
  for (const l of lines) {
    assert.ok(!/Date\.now\(\)/.test(l),
      `임시 경로를 밀리초만으로 짓는다 — 같은 밀리초에 겹친다: ${l.trim()}`)
  }
})
