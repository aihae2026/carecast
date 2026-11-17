// 3단계 — 발사 경로에 합성이 없다. 그리고 **캐시가 없어도 소리는 나간다.**
//
// 왜 이 테스트가 있나: 이 변경은 되돌리기 어렵다. 트리거에서 합성을 걷어내는 것이
// 목적인데, 잘못 걷어내면 **캐시가 없을 때 무음**이 된다 — 고치려던 것보다 나쁘다.
// 그래서 두 가지를 함께 못박는다:
//   ① 발사 경로(broadcastSteps.js)에 합성 호출이 없다
//   ② 캐시가 없어도 즉시 렌더로 소리가 나간다(최악이 "몇 초 늦음"이지 무음이 아니다)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_step3_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const STEPS = path.join(__dirname, '..', 'services', 'broadcastSteps.js')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('발사 경로에 합성 호출이 없다 — 주석은 세지 않는다', () => {
  const src = fs.readFileSync(STEPS, 'utf8')
  const 코드줄 = src.split('\n').filter((l) => !l.trim().startsWith('//'))
  const 호출 = 코드줄.filter((l) => /generateTTS\w*\s*\(/.test(l))
  assert.deepEqual(호출, [],
    `발사 경로에서 합성을 부르고 있다. 그 시간이 곧 방송 지연이 된다:\n${호출.join('\n')}`)
})

test('소리 확보는 renderOnDemand 를 지난다 — 캐시 우선 정책이 한 곳에 있다', () => {
  const src = fs.readFileSync(STEPS, 'utf8')
  assert.match(src, /require\('\.\/renderOnDemand'\)/, 'renderOnDemand 를 안 쓰고 있다')
  assert.match(src, /obtainAudio\(/, '소리 확보 창구를 안 지난다')
  assert.match(src, /resolveGrace\(/, '유예 규칙을 안 쓰고 있다')
})

test('캐시가 없어도 소리가 나간다 — 최악이 "늦음"이지 "무음"이 아니다', async () => {
  const rod = require('../services/renderOnDemand')
  rod._resetMisses()

  // 캐시에 없는 문안. 합성은 가짜로 대신한다(네트워크·시간을 안 쓴다).
  const ttsPath = require.resolve('../services/tts')
  const 진짜 = require.cache[ttsPath]
  let 합성횟수 = 0
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true,
    exports: {
      ...진짜.exports,
      generateTTSWithRetry: async () => { 합성횟수 += 1; return 'C:/tmp/fake-audio.mp3' },
      cachePathFor: () => path.join(os.tmpdir(), `없는캐시_${Date.now()}.mp3`),
      cuesPathOf: (p) => `${p}.cues.json`,
    },
  }
  delete require.cache[require.resolve('../services/renderOnDemand')]
  try {
    const rod2 = require('../services/renderOnDemand')
    rod2._resetMisses()
    const got = await rod2.obtainAudio(
      { text: '캐시에 없는 문안입니다', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' },
      { graceMs: 5000, title: '시험 방송', log: () => {} })

    assert.ok(got.file, '소리 파일을 못 받았다 — 무음이 된다')
    assert.equal(got.fromCache, false)
    assert.ok(합성횟수 >= 1, '캐시가 없는데 합성을 안 했다')
    // 미스를 세어 뒀는가 — 이게 없으면 "가끔 느리네"로 넘어가고 원인을 영영 안 본다
    assert.equal(rod2.missStats().total, 1, '캐시 미스를 기록하지 않았다')
    assert.equal(rod2.missStats().byTitle['시험 방송'], 1)
  } finally {
    require.cache[ttsPath] = 진짜
    delete require.cache[require.resolve('../services/renderOnDemand')]
  }
})

test('캐시가 있으면 합성을 안 한다 — 정상 경로는 네트워크를 안 탄다', async () => {
  const ttsPath = require.resolve('../services/tts')
  const 진짜 = require.cache[ttsPath]
  const 가짜mp3 = path.join(os.tmpdir(), `있는캐시_${process.pid}.mp3`)
  const 가짜cues = `${가짜mp3}.cues.json`
  fs.writeFileSync(가짜mp3, 'x'); fs.writeFileSync(가짜cues, '[]')

  let 합성횟수 = 0
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true,
    exports: {
      ...진짜.exports,
      generateTTSWithRetry: async () => { 합성횟수 += 1; return 가짜mp3 },
      cachePathFor: () => 가짜mp3,
      cuesPathOf: () => 가짜cues,
    },
  }
  delete require.cache[require.resolve('../services/renderOnDemand')]
  try {
    const rod2 = require('../services/renderOnDemand')
    rod2._resetMisses()
    const got = await rod2.obtainAudio(
      { text: '이미 있는 문안', voice: 'ko-KR-SunHiNeural', rate: '+0%', pitch: '+0Hz' },
      { graceMs: 5000, title: '시험 방송', log: () => {} })

    assert.equal(got.fromCache, true, '캐시가 있는데 미스로 처리했다')
    assert.equal(rod2.missStats().total, 0, '캐시 히트인데 미스로 셌다')
    // 캐시 히트도 generateTTSWithRetry 를 한 번 지난다 — 그 안에서 copyFromCache 로
    // **네트워크 없이** 돌려주기 때문이다(tts.js:459-462). 재시도 인자를 1로 주는 이유가
    // 그것이다: 캐시가 있는데도 여러 번 시도하면 그건 합성 경로로 샌 것이다.
    assert.equal(합성횟수, 1, `캐시 히트인데 ${합성횟수}번 불렀다 — 합성 경로로 샜을 수 있다`)
  } finally {
    require.cache[ttsPath] = 진짜
    delete require.cache[require.resolve('../services/renderOnDemand')]
    try { fs.unlinkSync(가짜mp3); fs.unlinkSync(가짜cues) } catch { /* 무시 */ }
  }
})

test('유예 우선순위 — 위에서 아래로, 첫 일치에서 확정', () => {
  const { resolveGrace, 기본값 } = require('../domain/broadcastGrace')
  // 1순위: 긴급은 상한이 없다(성공까지 재시도)
  assert.equal(resolveGrace({ urgency: 'emergency', content: '{{시각}} 입니다' }).ms, null,
    '긴급인데 {{시각}} 때문에 30초로 떨어졌다 — 우선순위가 뒤집혔다')
  // 2순위: {{시각}} 토큰
  assert.equal(resolveGrace({ content: '지금 {{시각}} 입니다' }).ms, 기본값.timeTokenMs)
  // 낱말만으로는 안 걸린다
  assert.equal(resolveGrace({ content: '시각을 확인해 주세요' }).ms, 기본값.defaultMs)
  // 3순위: 그 외
  assert.equal(resolveGrace({ content: '점심 식사 시간입니다' }).ms, 기본값.defaultMs)
  assert.equal(resolveGrace({}).ms, 기본값.defaultMs)
})

test('유예는 설정으로 조정된다 — 현장에서 "5분은 너무 길다"가 나올 수 있다', () => {
  const { resolveGrace, 설정키 } = require('../domain/broadcastGrace')
  const 설정 = (k, d) => (k === 설정키.defaultMs ? '60' : d)
  assert.equal(resolveGrace({ content: '점심입니다' }, 설정).ms, 60 * 1000)
  // 이상한 값은 기본값으로 — 방송이 멈추면 안 된다
  assert.equal(resolveGrace({ content: '점심입니다' }, () => 'abc').ms, 5 * 60 * 1000)
  assert.equal(resolveGrace({ content: '점심입니다' }, () => '-5').ms, 5 * 60 * 1000)
})
