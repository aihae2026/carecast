// 순서편집기에서 **추가한** 커스텀 단계(음원·차임벨·BGM·영상파일)의 볼륨이 실제 재생
// 지시까지 도달하는가. (CC-053)
//
// 왜 별도 파일인가: auto-broadcast-volume.test.js는 **기본 단계**(stepTTS/stepBGMStart)를
// 덮고, flow-step-volume.test.js는 **흐름 만들기**(flowRunner를 직접 호출)를 덮는다.
// 그 사이에 낀 것이 이 경로다 — 화면(MorningEditor)은 카멜(step.volume/step.bgmVolume)로
// 저장하는데 flowRunner는 스네이크 섞임(config.volume/config.bgm_volume)으로 읽으므로,
// broadcastSequencer.runCustomExtraStep이 그 사이를 이어줘야 한다. 그 배선이 통째로
// 빠져 있어서 커스텀 단계는 자동방송 5종 전부에서 조용히 시스템 기본값으로 나갔다.
//
// 소리를 내지 않는 방법은 위 두 파일과 같다 — sse.js/chimePlayer.js를 require.cache에
// 미리 심어 페이로드만 가로챈다. DB는 os.tmpdir에 격리한다(운영 DB 금지).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_customvol_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 스텁 (broadcastSequencer/flowRunner가 require하기 전에) ──
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const chimes = []
const chimePath = require.resolve('../services/chimePlayer')
const realChime = require('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    ...realChime,
    playChime: (type, volumePct) => { chimes.push({ type, volumePct }) },   // 스피커를 울리지 않는다
  },
}

// TTS는 네트워크(옛 인터넷 합성 엔진)를 탄다 — 커스텀 단계 테스트에는 필요 없지만 require 그래프에 있다
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    generateTTS:          async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    generateTTSWithRetry: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {},
  },
}
const audioStorePath = require.resolve('../services/audioStore')
const realStore = require('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    ...realStore, storeAudio: () => 'fake-audio-id',
  },
}

const { initDB, getDB } = require('../db/schema')
const { readVolume } = require('../domain/volume')
const seq = require('../services/broadcastSequencer')

// 브라우저 대역 — 재생 지시가 나가면 곧바로 "다 틀었다"고 답한다(step-isolation.test.js와 같은 패턴).
// 이게 없으면 음원·영상 단계가 상한까지 기다려서 테스트가 몇 분씩 멈춘다.
// 벽시계로 무엇을 판정하지는 않는다 — 대기를 짧게 만들 뿐이다(CC-048).
let responder = null
let tok = null

test.before(() => {
  initDB()
  let seen = 0
  responder = setInterval(() => {
    for (; seen < sent.length; seen++) {
      const e = sent[seen]
      if (e.type === 'prayer_play' && e.payload?.token) seq.notifyAudioEnded(e.payload.token)
      if (e.type === 'video_play'  && e.payload?.token) seq.notifyVideoEnded(e.payload.token)
    }
  }, 20)
  tok = seq.__test__.newBroadcastToken()
  const db = getDB()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration)
              VALUES ('bgm', 'custom.mp3', '커스텀 음원', 1)`).run()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration)
              VALUES ('video', 'custom.mp4', '커스텀 영상', 1)`).run()
  // BGM 단계가 실제로 곡을 받게 한다 — 빈 폴더면 아무것도 안 튼다(2026-09-21 이 PC 음원만)
  require('./helpers/localBgmFixture').로컬BGM심기(db)
})

test.after(() => {
  clearInterval(responder)
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function fileId(filename) {
  return getDB().prepare('SELECT id FROM audio_files WHERE filename = ?').get(filename).id
}

// sent는 비우지 않는다 — 위 responder가 자기 위치(seen)를 들고 있어서, 배열을 비우면
// 그 다음 재생 지시를 영영 못 보고 매 단계가 상한까지 기다린다. 대신 표시(mark)만 옮긴다.
let mark = 0

async function runCustom(step) {
  mark = sent.length
  chimes.length = 0
  assert.equal(typeof seq.__test__?.runCustomExtraStep, 'function',
    'runCustomExtraStep을 테스트에서 부를 수 없다 — __test__ export가 필요하다')
  const ran = await seq.__test__.runCustomExtraStep(getDB(), step, tok)
  // 2026-09-10(P-57): 반환값이 boolean 에서 **사유**로 바뀌었다. 이 단언이 보려던 것은
  // "이 단계가 실제로 실행됐나"이고 그 뜻은 그대로다 — `단계사유.없음` 은 지원 목록 밖이라
  // 아무것도 안 하고 돌아온 경우다. 정상 실행은 아무것도 안 돌려준다(undefined).
  const { 단계사유 } = require('../domain/stepHistory')
  assert.notEqual(ran, 단계사유.없음, `커스텀 단계(${step.customType})가 실행되지 않았다`)
  assert.notEqual(ran, 단계사유.차임고장, `커스텀 단계(${step.customType})가 실패했다`)
}

function payloadOf(type) {
  const ev = sent.slice(mark).find(e => e.type === type)
  assert.ok(ev, `${type} 이벤트가 나가지 않았다`)
  return ev.payload
}

// ── 음원 ────────────────────────────────────────────────────
test('커스텀 음원 단계의 볼륨이 prayer_play에 실린다', async () => {
  await runCustom({ customType: 'audio', playlist: [fileId('custom.mp3')], volume: 44 })
  assert.equal(payloadOf('prayer_play').volume, 44,
    '볼륨이 안 실리면 화면이 자기 슬라이더 값으로 재생한다 — 단계 설정이 무시된다')
})

test('볼륨을 저장하지 않은 커스텀 음원 단계는 시스템 기본값이 실린다', async () => {
  const sysAudio = readVolume(getDB(), 'audio')
  await runCustom({ customType: 'audio', playlist: [fileId('custom.mp3')] })
  assert.equal(payloadOf('prayer_play').volume, sysAudio,
    '저장한 적 없는 단계까지 값이 바뀌면 현장 설정이 통째로 흔들린다')
})

test('커스텀 음원 단계의 0은 무음이라는 유효한 값이다', async () => {
  await runCustom({ customType: 'audio', playlist: [fileId('custom.mp3')], volume: 0 })
  assert.equal(payloadOf('prayer_play').volume, 0,
    '0을 falsy로 취급해 기본값으로 되돌리면, 꺼둔 단계가 갑자기 소리를 낸다')
})

// ── 차임벨 ──────────────────────────────────────────────────
test('커스텀 차임벨 단계의 볼륨이 서버 재생 인자와 SSE에 실린다', async () => {
  await runCustom({ customType: 'chime', volume: 35 })
  assert.equal(chimes.length, 1, '차임벨이 울리지 않았다')
  assert.equal(chimes[0].volumePct, 35, '서버 스피커에 볼륨이 안 넘어갔다')
  assert.equal(payloadOf('chime_play').volume, 35, 'SSE에 볼륨이 안 실렸다')
})

test('볼륨을 저장하지 않은 커스텀 차임벨 단계는 시스템 기본값이 실린다', async () => {
  const sysTts = readVolume(getDB(), 'tts')   // 차임벨은 안내 음성과 같은 채널
  await runCustom({ customType: 'chime' })
  assert.equal(chimes[0].volumePct, sysTts)
})

test('커스텀 차임벨 단계의 0은 무음이라는 유효한 값이다', async () => {
  await runCustom({ customType: 'chime', volume: 0 })
  assert.equal(chimes[0].volumePct, 0, '서버 스피커에 0이 아니라 기본값이 넘어갔다')
  assert.equal(payloadOf('chime_play').volume, 0,
    '0을 falsy로 취급해 기본값으로 되돌리면, 꺼둔 단계가 갑자기 소리를 낸다')
})

// ── BGM ─────────────────────────────────────────────────────
// 화면(MorningEditor.volumeFieldFor)은 BGM 단계만 bgmVolume에 저장한다.
test('커스텀 BGM 단계의 bgmVolume이 bgm_start의 bgmDefault로 나간다', async () => {
  await runCustom({
    customType: 'bgm', bgmVolume: 25,
    playlist: [{ bgm_type: 'local_broadcast', bgm_delay: 1 }],
  })
  assert.equal(payloadOf('bgm_start').bgmDefault, 25)
})

test('볼륨을 저장하지 않은 커스텀 BGM 단계는 시스템 기본값이 실린다', async () => {
  const sysBgm = readVolume(getDB(), 'bgm')
  await runCustom({
    customType: 'bgm',
    playlist: [{ bgm_type: 'local_broadcast', bgm_delay: 1 }],
  })
  assert.equal(payloadOf('bgm_start').bgmDefault, sysBgm)
})

test('커스텀 BGM 단계의 0은 무음이라는 유효한 값이다', async () => {
  await runCustom({
    customType: 'bgm', bgmVolume: 0,
    playlist: [{ bgm_type: 'local_broadcast', bgm_delay: 1 }],
  })
  assert.equal(payloadOf('bgm_start').bgmDefault, 0,
    '0을 falsy로 취급해 기본값으로 되돌리면, 꺼둔 단계가 갑자기 소리를 낸다')
})

// ── 업로드 영상 파일 ─────────────────────────────────────────
test('커스텀 영상파일 단계의 볼륨이 video_play에 실린다', async () => {
  await runCustom({ customType: 'video_file', playlist: [fileId('custom.mp4')], volume: 66 })
  assert.equal(payloadOf('video_play').volume, 66)
})

test('볼륨을 저장하지 않은 커스텀 영상파일 단계는 시스템 기본값이 실린다', async () => {
  const sysMedia = readVolume(getDB(), 'media')
  await runCustom({ customType: 'video_file', playlist: [fileId('custom.mp4')] })
  assert.equal(payloadOf('video_play').volume, sysMedia)
})

test('커스텀 영상파일 단계의 0은 무음이라는 유효한 값이다', async () => {
  await runCustom({ customType: 'video_file', playlist: [fileId('custom.mp4')], volume: 0 })
  assert.equal(payloadOf('video_play').volume, 0,
    '0을 falsy로 취급해 기본값으로 되돌리면, 꺼둔 단계가 갑자기 소리를 낸다')
})

// ── 드리프트 방어 ────────────────────────────────────────────
test('runCustomExtraStep이 화면(카멜)과 flowRunner(주 소리 volume / 반주 bgm_volume)를 잇는다', () => {
  // 2026-09-01: runCustomExtraStep 본문은 broadcastSteps.js로 옮겼다(시퀀서가 재수출한다)
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSteps.js'), 'utf8')
  const open = src.indexOf('async function runCustomExtraStep(')
  assert.notEqual(open, -1, 'runCustomExtraStep을 찾지 못했다')
  const body = src.slice(open, src.indexOf('\n}', open))

  // 가지마다 한 줄인 삼항 사슬이라 **그 가지의 줄 안에서** 판정한다. 예전엔 body 전체에
  // 'volume: step.volume'을 찾았는데, 그 문자열은 'bgm_volume: step.volume'에도 걸린다 —
  // audio·chime·video_file의 볼륨을 전부 지우고 bgm만 틀린 필드로 써놔도 통과했다.
  const branch = (stepType) => {
    const line = body.split('\n').find(l => l.includes(`stepType === '${stepType}'`))
    assert.ok(line, `stepType === '${stepType}' 가지를 찾지 못했다`)
    return line
  }
  // 'bgm_volume:'을 먼저 지운 뒤에 봐야 주 소리 필드인지 반주 필드인지 갈린다
  const hasMainVolume = (line) => line.replace(/bgm_volume:/g, 'BGMFIELD:').includes('volume: step.volume')

  assert.ok(branch('bgm').includes('bgm_volume: step.bgmVolume'),
    'BGM 단계가 bgmVolume → bgm_volume으로 안 넘어간다 — flowRunner는 그 이름으로 읽는다')
  for (const stepType of ['audio', 'chime', 'video_file']) {
    assert.ok(hasMainVolume(branch(stepType)),
      `커스텀 ${stepType} 단계가 step.volume을 config.volume으로 안 넘긴다 — ` +
      'flowRunner가 항상 시스템 기본값으로 재생한다')
  }
  // 2026-09-21: 외부 TV 송출('video') 가지는 걷어냈다 — 되살아나면 실행 경로도 없는 단계가 저장된다.
  assert.ok(!body.split('\n').some(l => l.includes("stepType === 'video'")),
    "걷어낸 TV 송출('video') 가지가 되살아났다")
})
