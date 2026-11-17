// 자동방송 스텝별 볼륨이 **실제 재생 지점(SSE 페이로드)까지** 도달하는지 확인한다.
//
// 스피커를 울리지 않는 방법은 broadcast-volume.test.js와 같다 — sse.js를 require.cache에
// 미리 심어 페이로드만 가로챈다. TTS 생성(파이썬 spawn)도 스텁해야 실제로 음성이 만들어지지 않는다.
//
// 왜 이 테스트가 필요한가: 스텝 실행부는 다섯 갈래(아침/체조/점심/저녁/저녁 마무리)로 나뉘고
// 호출부가 20곳이 넘는다. 한 곳이라도 옵션 전달을 빠뜨리면 그 스텝만 조용히 시스템 기본값으로
// 나가는데, 소리는 나므로 아무도 눈치채지 못한다.
'use strict'

const path = require('path')
const { editorSource } = require('./helpers/editorSource')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_autovol_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

// ── 소리가 나지 않도록 미리 심는 스텁 (broadcastSequencer require 전) ──
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

// TTS는 파이썬을 띄운다 — 실제로 음성을 만들지 않도록 막는다
const ttsPath = require.resolve('../services/tts')
const realTts = require('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    generateTTSWithRetry: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    generateTTS: async () => path.join(os.tmpdir(), 'fake-tts.mp3'),
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {},
  },
}

const audioStorePath = require.resolve('../services/audioStore')
const realStore = require('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    ...realStore,
    storeAudio: () => 'fake-audio-id',
  },
}

const { initDB, getDB } = require('../db/schema')
const { resolveStepVolume } = require('../domain/volume')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 해석 규칙 ────────────────────────────────────────────────
test('스텝에 볼륨이 있으면 그 값을, 없으면 시스템 기본값을 쓴다', () => {
  const db = getDB()
  const sysTts = resolveStepVolume(db, {}, 'tts')
  assert.ok(sysTts > 0, '시스템 기본값을 못 읽었다')

  assert.equal(resolveStepVolume(db, { volume: 42 }, 'tts'), 42)
  assert.equal(resolveStepVolume(db, { volume: null }, 'tts'), sysTts, 'null은 "기본값 사용"이다')
  assert.equal(resolveStepVolume(db, { volume: '' }, 'tts'), sysTts, '빈 값도 "기본값 사용"이다')
})

test('0은 무음이라는 유효한 값이다 — 기본값으로 되돌리면 안 된다', () => {
  const db = getDB()
  assert.equal(resolveStepVolume(db, { volume: 0 }, 'tts'), 0,
    '0을 falsy로 취급해 기본값으로 바꾸면, 꺼둔 스텝이 갑자기 소리를 낸다')
})

test('범위를 벗어난 값은 잘라낸다 — 재생 쪽에서 조용히 이상해지지 않게', () => {
  const db = getDB()
  assert.equal(resolveStepVolume(db, { volume: 500 }, 'tts'), 100)
  assert.equal(resolveStepVolume(db, { volume: -20 }, 'tts'), 0)
})

test('반주 볼륨은 주 소리와 다른 필드에서 읽는다', () => {
  const db = getDB()
  const step = { volume: 30, bgmVolume: 80 }
  assert.equal(resolveStepVolume(db, step, 'tts'), 30)
  assert.equal(resolveStepVolume(db, step, 'bgm', 'bgmVolume'), 80,
    '한 스텝이 주 소리와 반주를 각각 가질 수 있어야 한다(안내 음성은 크게, 반주는 작게)')
})

// ── 배관: 실제 SSE 페이로드까지 ─────────────────────────────
test('TTS 스텝의 볼륨이 scheduled_broadcast 페이로드에 실린다', async () => {
  sent.length = 0
  const seq = require('../services/broadcastSequencer')
  assert.ok(typeof seq.__test__?.stepTTS === 'function',
    'stepTTS를 테스트에서 부를 수 없다 — __test__ export가 필요하다')

  await seq.__test__.stepTTS(getDB(), '안내드립니다', '테스트', null, { volume: 33 })
  const ev = sent.find(e => e.type === 'scheduled_broadcast')
  assert.ok(ev, 'scheduled_broadcast가 나가지 않았다')
  assert.equal(ev.payload.ttsVolume, 33,
    '볼륨이 안 실리면 화면은 자기 슬라이더 값으로 재생한다 — 스텝 설정이 무시된다')
})

test('볼륨을 지정하지 않은 TTS 스텝은 시스템 기본값이 실린다', async () => {
  sent.length = 0
  const seq = require('../services/broadcastSequencer')
  const sysTts = resolveStepVolume(getDB(), {}, 'tts')

  await seq.__test__.stepTTS(getDB(), '안내드립니다', '테스트', null, {})
  const ev = sent.find(e => e.type === 'scheduled_broadcast')
  assert.equal(ev.payload.ttsVolume, sysTts)
})

// ── 드리프트 방어 ─────────────────────────────────────────────
test('스텝 옵션은 한 함수(stepOpts)로만 만든다', () => {
  // 예전엔 호출부 19곳이 { ttsVoice: step.ttsVoice }를 각자 적고 있었다. 새 스텝 설정을
  // 더할 때 한 곳만 빠뜨려도 그 스텝만 조용히 기본값으로 나가고, 소리는 나므로 안 들킨다.
  // 2026-09-01: stepOpts 정의는 broadcastSteps.js로, 호출부(fire* 5종)는 시퀀서에 남았다 —
  // 둘 다 봐야 "정의가 있는가"와 "호출부가 다시 직접 만드는가"를 같이 지킬 수 있다.
  const src = ['broadcastSequencer.js', 'broadcastSteps.js']
    .map(f => fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8')).join('\n')
  assert.ok(src.includes('function stepOpts('), 'stepOpts가 없다')
  assert.ok(!src.includes('{ ttsVoice: step.ttsVoice'),
    '호출부가 다시 옵션을 직접 만들고 있다 — stepOpts(step)을 쓸 것')
  assert.ok(src.includes("volume:        step.volume"),
    'stepOpts가 볼륨을 안 넘긴다 — 스텝별 볼륨이 실행부에 도달하지 못한다')
})

test('병합 함수가 사용자 필드를 통째로 이어받는다 — 아는 필드만 골라 담지 않는다', () => {
  // 소스에서 확인한다: `...user` 스프레드가 사라지고 필드를 하나씩 나열하는 방식으로 바뀌면,
  // 그 순간부터 새 스텝 설정(볼륨 등)은 저장돼도 읽을 때 조용히 버려진다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  const open = src.indexOf('function mergeStepsWithDefaults(')
  assert.notEqual(open, -1, 'mergeStepsWithDefaults를 찾지 못했다')
  const body = src.slice(open, open + 1400)
  assert.ok(body.includes('...user'),
    '병합이 사용자 스텝을 통째로 이어받지 않는다 — 새 스텝 설정이 조용히 버려진다')
})

test('화면의 BGM 단계 판정이 서버가 실제로 BGM을 트는 단계와 일치한다', () => {
  // 화면(MorningEditor.volumeFieldFor)은 id가 bgm으로 시작하면 반주 볼륨(bgmVolume)을,
  // 아니면 주 소리(volume)를 편집하게 한다. 서버가 다른 단계에서도 BGM을 틀기 시작하면
  // 그 단계의 반주 볼륨은 화면에서 조절할 수 없게 되는데, 소리는 나므로 눈치채기 어렵다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')

  // case 경계를 지켜 잘라낸다 — 통짜 검색은 다음 case의 본문까지 삼킨다
  const MARK = "case '"
  const parts = src.split(MARK).slice(1)
  const bgmCases = []
  for (const part of parts) {
    const id = part.slice(0, part.indexOf("'"))
    const nextCase = part.indexOf(MARK)
    const body = nextCase === -1 ? part : part.slice(0, nextCase)
    if (body.includes('stepBGMStart(')) bgmCases.push(id)
  }

  assert.ok(bgmCases.length > 0, 'stepBGMStart를 부르는 case를 못 찾았다 — 파싱이 깨졌다')
  for (const id of bgmCases) {
    assert.ok(id.startsWith('bgm'),
      `'${id}' 단계가 BGM을 트는데 id가 bgm으로 시작하지 않는다 — ` +
      '화면이 이 단계를 주 소리로 분류해서 반주 볼륨을 조절할 수 없다')
  }
})

test('화면에 단계별 볼륨 입력이 실제로 있다', () => {
  // 서버 배관만 있고 화면이 없으면 아무도 값을 넣을 수 없어 기능이 없는 것과 같다.
  const src = editorSource()
  assert.ok(src.includes('function volumeFieldFor('), 'MorningEditor에 볼륨 판정이 없다')
  assert.ok(src.includes('updateStepVolume('), 'MorningEditor에 볼륨 수정 경로가 없다')
  assert.ok(src.includes("bgmVolume") && src.includes("VOLUME_FIELD_LABEL"),
    '주 소리/반주 두 필드를 다루지 않는다')
})
