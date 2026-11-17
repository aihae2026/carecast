// 제미나이 모델 이름의 **단일 출처**를 고정한다.
//
// 왜 생겼나(2026-09-06 사용자 지적에서 출발): 기본 모델명이 일곱 곳에 박혀 있었고
// **값이 둘로 갈려 있었다** — 실제 호출은 `gemini-3.5-flash`, 관리자 화면과 저장
// 기본값은 `gemini-3.6-flash`. 설정이 비어 있으면 **화면은 3.6 이라 하는데 소리는 3.5**
// 로 나갔다. 볼륨에서 겪은 것과 같은 결함이다(CLAUDE.md 볼륨 규칙).
//
// 여기서 잠그는 것 셋:
//  1. 서버 코드에 모델 이름을 다시 박지 않는다(안내문 예시는 예외).
//  2. 화면도 자기 기본값을 갖지 않는다 — 서버가 준 값을 쓴다.
//  3. 모델 목록은 **구글에게 물어본다.** 목록을 코드에 박으면 구글이 모델을 갈아치운 날
//     아무도 안 고쳐서 같은 일이 반복된다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('기본 모델 이름은 domain/geminiModel.js 한 곳에만 있다', () => {
  const 단일출처 = read('server/domain/geminiModel.js')
  assert.match(단일출처, /DEFAULT_GEMINI_MODEL = 'gemini-[\d.]+-flash'/, '단일 출처에 값이 없다')

  // 서버에서 모델 이름을 값으로 쓰는 곳이 또 있으면 곧 갈린다.
  // 사람에게 보여 주는 안내문 안의 예시는 값이 아니므로 센다: 그 줄은 throw/placeholder 다.
  const 검사대상 = ['server/routes/ai.js', 'server/routes/audio.js',
    'server/routes/schedules.js', 'server/routes/scheduleDrafts.js', 'server/routes/settings.js']
  for (const f of 검사대상) {
    const src = read(f)
    const 박힌줄 = src.split('\n').filter(l =>
      /['"`]gemini-[\d.]+-(flash|pro)/.test(l) &&
      !/현재 모델|예:|placeholder/.test(l))          // 안내문 예시는 값이 아니다
    assert.deepEqual(박힌줄, [],
      `${f} 에 모델 이름이 박혀 있다 — domain/geminiModel.js 를 쓸 것:\n  ${박힌줄.join('\n  ')}`)
  }
})

test('화면은 자기 기본값을 갖지 않는다 — 서버가 준 defaultModel 을 쓴다', () => {
  const ui = read('src/components/admin/sections/apiSettingsAI.jsx')
  // 긍정 앵커 — 서버 값을 받는 자리가 실제로 있다
  assert.match(ui, /defaultModel/, '서버가 준 기본값을 안 받는다')
  // 예전에 박혀 있던 상수가 되살아나면 다시 갈린다
  assert.doesNotMatch(ui, /const DEFAULT_GEMINI_MODEL\s*=/,
    '화면이 기본 모델명을 다시 박았다 — 서버와 갈린다')

  const s = read('server/routes/settings.js')
  assert.match(s, /defaultModel: DEFAULT_GEMINI_MODEL/, '서버가 기본값을 안 내려보낸다')
})

test('모델 목록은 구글에게 물어본다 — 코드에 박지 않는다', () => {
  const ai = read('server/routes/ai.js')
  assert.match(ai, /router\.get\('\/models'/, '목록 조회 창구가 없다')
  assert.match(ai, /v1beta\/models/, '구글에게 안 물어본다')
  // 문구를 만들 수 있는 모델만 남겨야 한다 — 임베딩 전용을 고르면 그 시각에 조용히 실패한다
  assert.match(ai, /generateContent/, '쓸 수 없는 모델까지 목록에 넣는다')
  // 직접 fetch 금지(CLAUDE.md) — 재시도·타임아웃이 래퍼에만 있다
  assert.doesNotMatch(ai, /await fetch\(\s*'https:\/\/generativelanguage/,
    '재시도 래퍼를 건너뛰고 직접 부른다')
})

test('목록을 못 받아도 오류가 아니다 — 손입력 경로가 살아 있어야 한다', () => {
  const ai = read('server/routes/ai.js')
  const at = ai.indexOf("router.get('/models'")
  const body = ai.slice(at, at + 1600)
  assert.doesNotMatch(body, /res\.status\(5\d\d\)/,
    '목록 실패를 5xx 로 낸다 — 화면이 오류로 보여 사람이 모델을 못 고친다')
  assert.match(body, /reason/, '왜 못 받았는지 안 알려 준다')

  const ui = read('src/components/admin/sections/apiSettingsAI.jsx')
  assert.match(ui, /<input type="text" list="gemini-model-list"/,
    '입력칸을 없애고 목록만 남겼다 — 목록에 없는 모델을 못 쓰게 된다')
})
