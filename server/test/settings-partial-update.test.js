'use strict'
// **안 보낸 필드는 손대지 않는다** (P-115, 2026-09-11).
//
// [FACT] EV-003983 — 샌드박스에 실제 요청을 보내 재니:
//   `POST /org {"slogan":"X"}`        -> `org_name` 이 `"TEST-ORG-A1"` → `""`
//   `POST /auto-shutdown {}`          -> `auto_shutdown_time` 이 `"19:45"` → `""`
//   `POST /tts {"voiceNormal":null}`  -> `tts_voice_normal` 이 `"ko-KR-InJoonNeural"` → `""`
//
// **현장 자동종료 18:21 이 `POST {}` 한 번에 지워진다.** 그게 이 결함의 무게다.
//
// 계약은 임의로 정한 것이 아니다 — 이 저장소에 **키 누락 = 기존 값 유지** 관행이 이미 둘 있다
// ([FACT] `settings.js` 의 `if (x !== undefined)` · `schedules.js` 의 `bodyOrExisting`).
// `/org` 와 `/auto-shutdown` 만 그 관행을 벗어나 있었다.
//
// `null` 은 "안 보낸 것" 으로 본다: 뜻이 확립돼 있지 않고 지우는 쪽이 되돌리기 어렵다.
// **명시적 해제에는 이미 `""` 라는 표기가 있다**(빈 시각 = 끄기 AP-0012, 빈 장치 = 기본 장치).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'server/routes/settings.js'), 'utf8')

test('보냈나() 가 키 누락과 null 을 모두 "안 보낸 것" 으로 본다', () => {
  const m = /function 보냈나\(body, field\) \{([\s\S]*?)\n\}/.exec(SRC)
  assert.ok(m, '보냈나() 를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /hasOwnProperty\.call\(body, field\)/, '키 존재를 hasOwnProperty 로 안 본다')
  assert.match(m[1], /!== null && body\[field\] !== undefined/, 'null 을 "보낸 것" 으로 본다')
})

test('세 라우트가 모두 같은 규칙을 쓴다 — 사본이 없다', () => {
  // `/org` — name·slogan 이 `?? ''` 로 지워지면 안 된다
  assert.ok(!/String\(req\.body\?\.name\s*\?\?\s*''\)/.test(SRC),
    '/org 에 옛 `?? \'\'` 가 남아 있다 — 한 필드만 보내면 나머지가 지워진다')
  assert.match(SRC, /보냈나\(req\.body, 'name'\)/,   '/org 의 name 이 보냈나() 를 안 쓴다')
  assert.match(SRC, /보냈나\(req\.body, 'slogan'\)/, '/org 의 slogan 이 보냈나() 를 안 쓴다')

  // `/auto-shutdown` — 안 보내면 지금 값을 그대로 쓴다
  assert.match(SRC, /보냈나\(req\.body, 'time'\)/, '/auto-shutdown 이 보냈나() 를 안 쓴다')
  assert.ok(!/setSetting\(getDB\(\), 'auto_shutdown_time', time \?\? ''\)/.test(SRC),
    '/auto-shutdown 에 옛 `time ?? \'\'` 가 남아 있다 — 현장 18:21 이 POST {} 에 지워진다')

  // `/tts` — `!== undefined` 는 null 을 통과시킨다
  for (const f of ['voiceNormal', 'voiceMorning', 'voiceEmergency', 'rate', 'pitch', 'volume', 'audioDevice']) {
    assert.match(SRC, new RegExp(`보냈나\\(req\\.body, '${f}'\\)`), `/tts 의 ${f} 가 보냈나() 를 안 쓴다`)
  }
  assert.ok(!/if \(\w+\s+!== undefined\) setSetting\(db, 'tts_/.test(SRC),
    '/tts 에 옛 `!== undefined` 가 남아 있다 — null 이 기존 값을 지운다')
})

test('명시적 빈 값은 여전히 통한다 — 해제를 막지 않는다', () => {
  // 빈 시각 = 자동종료 안 함. `유효시각('')` 이 true 여야 그 길이 열린다.
  const { 유효시각 } = require(path.join(ROOT, 'server/domain/autoBroadcasts'))
  assert.equal(유효시각(''), true, '빈 시각을 막으면 자동종료를 끌 수가 없다')
  // 라우트가 빈 문자열을 "안 보낸 것" 으로 오해하지 않는가 — `보냈나` 는 `''` 를 보낸 것으로 본다
  const m = /function 보냈나\(body, field\) \{([\s\S]*?)\n\}/.exec(SRC)
  assert.ok(!/=== ''/.test(m[1]), '보냈나() 가 빈 문자열을 "안 보낸 것" 으로 본다 — 해제가 막힌다')
})
