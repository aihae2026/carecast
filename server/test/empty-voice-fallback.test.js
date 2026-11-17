'use strict'
// **빈 목소리는 기본 목소리로 떨어져야 한다** (P-113, 2026-09-11).
//
// [FACT] EV-003961 — 실제 함수를 돌려 재니 `tts_voice_normal = ''` 일 때
// 방송이 쓰는 목소리가 `''` 였다. 키가 **아예 없으면** 기본값으로 잘 떨어지는데,
// **빈 문자열이면 안 떨어진다** — 읽는 자리가 전부 `rawSetting(k) ?? 기본값` 이라
// `??` 가 빈 문자열을 통과시키기 때문이다.
//
// 이 저장소는 같은 모양의 사고를 이미 한 번 겪었다 — `숫자설정()` 이 그때 생겼다
// (`||` 가 0 을 삼켜 유예 0분이 5분으로 읽히던 것). 같은 자리에 글자용 짝을 둔다.
//
// **왜 빈 목소리만 막고 빈 장치·빈 시각은 안 막나**: 그 둘은 빈 값에 **뜻이 있다** —
// 빈 장치 = Windows 기본 장치, 빈 시각 = 자동종료 안 함(AP-0012).
// 빈 목소리에는 뜻이 없다. "목소리 없이 읽는 방송" 은 없다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')

// ── 순수 함수부터 ────────────────────────────────────────────────────────
const { 글자설정 } = require(path.join(ROOT, 'server/domain/settingsRead'))

test('빈 값·공백·없음은 기본값으로 떨어진다', () => {
  assert.equal(글자설정('', 'ko-KR-SunHiNeural'), 'ko-KR-SunHiNeural')
  assert.equal(글자설정('   ', 'ko-KR-SunHiNeural'), 'ko-KR-SunHiNeural', '공백만 있는 값도 빈 값이다')
  assert.equal(글자설정(null, 'ko-KR-SunHiNeural'), 'ko-KR-SunHiNeural')
  assert.equal(글자설정(undefined, 'ko-KR-SunHiNeural'), 'ko-KR-SunHiNeural')
})

test('값이 있으면 그대로 준다 — 다듬지 않는다', () => {
  assert.equal(글자설정('ko-KR-InJoonNeural', 'ko-KR-SunHiNeural'), 'ko-KR-InJoonNeural')
  // **앞뒤 공백을 떼지 않는다.** 떼면 저장된 값과 쓰는 값이 갈린다 —
  // `autoTime()` 이 같은 이유로 다듬기를 거부한다.
  assert.equal(글자설정(' ko-KR-InJoonNeural ', 'x'), ' ko-KR-InJoonNeural ')
})

// ── 실제 읽는 자리 ───────────────────────────────────────────────────────
test('빈 목소리가 저장돼 있어도 방송은 기본 목소리로 나간다', () => {
  const 임시 = path.join(os.tmpdir(), `cc-voice-${process.pid}-${Date.now()}.db`)
  process.env.CARECAST_DB_PATH = 임시
  process.env.CARECAST_NO_HARDWARE = '1'
  const { initDB, getDB } = require(path.join(ROOT, 'server/db/schema'))
  initDB()
  const db = getDB()
  const { writeSetting } = require(path.join(ROOT, 'server/domain/settingsRead'))
  const { loadTTSConfig } = require(path.join(ROOT, 'server/services/broadcastConfig'))

  writeSetting(db, 'tts_voice_normal', '')
  assert.equal(loadTTSConfig(db, 'tts_voice_normal').voice, 'ko-KR-SunHiNeural',
    '빈 목소리가 그대로 합성에 내려간다 — 안내 방송이 무너진다')

  writeSetting(db, 'tts_voice_normal', 'ko-KR-InJoonNeural')
  assert.equal(loadTTSConfig(db, 'tts_voice_normal').voice, 'ko-KR-InJoonNeural',
    '정상값까지 기본값으로 덮었다')

  try { fs.rmSync(임시, { force: true }) } catch { /* 임시파일 */ }
})

// ── 읽는 자리가 두 벌이 아닌가 ───────────────────────────────────────────
test('목소리를 읽는 자리가 전부 같은 규칙을 쓴다 — 사본이 없다', () => {
  const 자리 = ['server/services/broadcastConfig.js', 'server/routes/tts.js']
  for (const f of 자리) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.ok(/글자설정/.test(src), `${f} 가 글자설정 을 안 쓴다 — 빈 값이 다시 새어 나간다`)
    // 옛 모양(`?? 기본목소리`)이 남아 있으면 그 자리만 다시 구멍이 된다
    assert.ok(!/\?\?\s*'ko-KR-\w+Neural'/.test(src),
      `${f} 에 옛 '?? 기본목소리' 가 남아 있다`)
  }
})

// ── P-114: `null` 이 문자열 "null" 로 저장되던 것 (2026-09-11) ─────────────
//
// [FACT] EV-003971 — 샌드박스에 `POST /api/settings/tts {"voiceNormal":null}` 을 보내니
// DB 가 `"ko-KR-InJoonNeural"` → **`"null"`** 이 됐다. `writeSetting` 이 `String(value)` 로
// 넣기 때문이다. 그리고 `"null"` 은 **빈 문자열이 아니라서** 위 `글자설정()` 이 안 걸러 낸다 —
// **P-113 수정이 이 모양을 못 막는다.**
//
// [FACT] EV-003973 — 운영·샌드박스 DB 에 아직 `"null"`·`"undefined"` 가 0건이다.
// 들어간 것을 치우는 것이 아니라 **들어가는 길을 막는** 문제다.
test('null·undefined 는 "null" 이라는 글자로 저장되지 않는다', () => {
  const 임시 = path.join(os.tmpdir(), `cc-null-${process.pid}-${Date.now()}.db`)
  process.env.CARECAST_DB_PATH = 임시
  process.env.CARECAST_NO_HARDWARE = '1'
  const { initDB, getDB } = require(path.join(ROOT, 'server/db/schema'))
  initDB()
  const db = getDB()
  const { writeSetting, rawSetting } = require(path.join(ROOT, 'server/domain/settingsRead'))

  writeSetting(db, 'tts_voice_normal', null)
  assert.notEqual(rawSetting(db, 'tts_voice_normal'), 'null',
    'null 이 "null" 이라는 네 글자로 저장됐다 — 글자설정() 이 못 걸러 낸다')
  assert.equal(rawSetting(db, 'tts_voice_normal'), '',
    '값 없음은 빈 문자열로 남아야 한다 — 그래야 글자설정() 이 기본값으로 떨어뜨린다')

  writeSetting(db, 'tts_voice_normal', undefined)
  assert.equal(rawSetting(db, 'tts_voice_normal'), '', 'undefined 도 같다')

  // 그래서 방송이 실제로 기본 목소리를 쓴다 — 이것이 이 검사의 목적이다
  const { loadTTSConfig } = require(path.join(ROOT, 'server/services/broadcastConfig'))
  writeSetting(db, 'tts_voice_normal', null)
  assert.equal(loadTTSConfig(db, 'tts_voice_normal').voice, 'ko-KR-SunHiNeural',
    'null 을 저장한 뒤 방송이 기본 목소리를 안 쓴다')

  // **글자 'null' 을 사람이 일부러 넣은 경우는 건드리지 않는다** — 그건 값이다
  writeSetting(db, 'tts_voice_normal', 'null')
  assert.equal(rawSetting(db, 'tts_voice_normal'), 'null', '문자열 값까지 지웠다')

  try { fs.rmSync(임시, { force: true }) } catch { /* 임시파일 */ }
})
