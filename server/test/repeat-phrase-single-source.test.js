// **「2회 반복」 문구를 짓는 자리는 하나다** (2026-09-14).
//
// ── 왜 모으나 ────────────────────────────────────────────────────────────────
// `${base} 다시 한번 알려드립니다. ${base}` 가 **세 곳에 복사**돼 있었다 —
// `scheduler`(예약 발사) · `flowRunner`(순서 단계) · `broadcastEstimate`(예상 시간).
// 즉시 TTS 를 `/api/tts/broadcast` 로 옮기면서 **네 번째 복사**가 생길 참이었다.
//
// 이 저장소에서 문구가 갈리면 비싸다: 합성 캐시 키가 곧 그 문장이라 한 글자만 달라도
// **미리 만들어 둔 것이 통째로 버려지고**(scheduler 의 prewarm), 예상 시간은 실제와
// 어긋난다. 「예상 시간은 편집기와 공유한다(폴백 금지)」가 이미 못 박힌 규칙이다.
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// **문장이 안 바뀌었다는 것**이 요지다. 단일화가 곧 회귀여서는 안 된다 —
// 예약·자동방송·순서·예상시간이 전부 이 문장에 걸려 있다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 반복문안 } = require('../domain/broadcastDefaults')

test('문장이 예전 그대로다 — 단일화가 문안을 바꾸면 안 된다', () => {
  assert.equal(반복문안('안내합니다', true), '안내합니다 다시 한번 알려드립니다. 안내합니다',
    '반복 문장이 바뀌었다 — 합성 캐시 키가 달라져 미리 만든 것이 버려지고 소리가 늦는다')
  assert.equal(반복문안('안내합니다', false), '안내합니다', '반복이 꺼졌는데 문장이 바뀌었다')
})

test('횟수는 **두 번**이다 — 세 번이 되거나 한 번이 되면 안 된다', () => {
  const t = 반복문안('가나다', true)
  assert.equal(t.split('가나다').length - 1, 2, `본문이 ${t.split('가나다').length - 1}번 들어 있다`)
})

test('빈 문구·공백은 그대로 돌려준다 — 부르는 쪽이 빈 값을 스스로 걸러 왔다', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(반복문안(v, true), v ?? '', `${JSON.stringify(v)} 에서 문장을 지어냈다`)
  }
})

test('세 곳이 **제 손으로 짓지 않는다** — 복사본이 남아 있으면 언젠가 갈린다', () => {
  const 자리 = [
    'server/services/scheduler.js',
    'server/services/flowRunner.js',
    'server/domain/broadcastEstimate.js',
  ]
  for (const f of 자리) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8')
    const 코드 = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(코드, /다시 한번 알려드립니다\. \$\{/,
      `${f} 가 아직 제 손으로 반복 문장을 짓는다 — 단일 출처가 둘이 된다`)
    assert.match(코드, /반복문안\(/, `${f} 가 단일 출처를 안 부른다`)
  }
})

test('단일 출처는 **순수 문자열 모듈**에 산다 — 장부가 부서를 부르지 않는다', () => {
  const s = fs.readFileSync(path.join(ROOT, 'server/domain/broadcastDefaults.js'), 'utf8')
  assert.doesNotMatch(s, /require\(['"]\.\.\/services/,
    'domain 이 services 를 부른다 — 순환 고리가 생긴다(배선도 ②)')
})
