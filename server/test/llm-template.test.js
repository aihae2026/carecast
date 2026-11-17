// 3차 폴백 — LLM 이 하나도 안 될 때 내놓는 규칙 템플릿.
//
// 왜 이 테스트가 있나: 이 경로는 **가장 나쁜 날에만** 돈다(인터넷도 끊기고 로컬 모델도
// 없는 날). 그런 날에 처음 돌면서 처음 깨지면 안 된다. 평소에 안 도는 코드일수록
// 테스트로 붙들어야 한다.
//
// 지키는 것 셋:
//   ① **지어내지 않는다** — 입력에 없는 사실을 만들지 않는다. 틀은 고정, 내용은 입력에서
//   ② **현장 말투를 따른다** — 낯선 말투가 튀면 그 방송만 이상하게 들린다
//   ③ **빈 입력에도 문장이 나온다** — 사람이 고칠 수 있는 초안이어야 한다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { buildAnnouncement, TEMPLATE_MARK } = require('../domain/llmTemplate')

test('상황을 그대로 넣고 앞뒤에 현장 인사를 붙인다 — 지어내지 않는다', () => {
  const r = buildAnnouncement('점심 배식 안내')
  assert.match(r, /^어르신 여러분/, '현장 문안과 같은 시작이어야 한다')
  assert.ok(r.includes('점심 배식'), `입력이 결과에 안 들어갔다: ${r}`)
  assert.match(r, /감사합니다\.$/, '현장 문안과 같은 끝맺음이어야 한다')
})

test('입력에 없는 사실을 만들지 않는다', () => {
  const r = buildAnnouncement('3층 물 잠금')
  // 시각·날짜·이유 같은 것을 지어내면 안 된다 — 사람이 안 쓴 정보다
  assert.doesNotMatch(r, /\d{1,2}시|\d{1,2}월|\d{1,2}일/, `없는 시각·날짜를 지어냈다: ${r}`)
  assert.ok(r.includes('3층 물 잠금'))
})

test('빈 입력에도 고칠 수 있는 초안이 나온다 — 빈 문자열을 돌려주지 않는다', () => {
  for (const 입력 of ['', '   ', null, undefined]) {
    const r = buildAnnouncement(입력)
    assert.ok(r && r.trim().length > 0, `빈 결과가 나왔다: ${JSON.stringify(입력)}`)
    assert.match(r, /입력해 주세요|안내 말씀/, '사람이 무엇을 채워야 하는지 안 보인다')
  }
})

test('같은 입력은 늘 같은 결과 — 규칙이지 생성이 아니다', () => {
  const 답 = new Set()
  for (let i = 0; i < 20; i++) 답.add(buildAnnouncement('저녁 프로그램 안내'))
  assert.equal(답.size, 1)
})

test('아주 긴 입력도 방송으로 쓸 수 있게 자른다', () => {
  const 긴것 = '가'.repeat(1000)
  const r = buildAnnouncement(긴것)
  assert.ok(r.length < 400, `너무 길다(${r.length}자) — TTS 가 몇 분을 읽는다`)
})

test('줄바꿈·연속 공백을 정리한다 — TTS 가 이상하게 끊어 읽는다', () => {
  const r = buildAnnouncement('점심   배식\n\n안내')
  assert.doesNotMatch(r, /\n/, '줄바꿈이 남았다')
  assert.doesNotMatch(r, / {2}/, '연속 공백이 남았다')
})

test('템플릿이 만든 것임을 표시할 근거가 있다 — 배지에 쓴다', () => {
  assert.equal(typeof TEMPLATE_MARK, 'string')
  assert.ok(TEMPLATE_MARK.length > 0)
})
