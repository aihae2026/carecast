// 캘린더 제한시간의 **값**과 무응답 때 사람이 보는 **말** (P-20, 2026-09-08)
//
// 왜 이 파일이 있나 — 둘이다.
//
// ① 값을 아무도 안 지킨다.
//    ISSUE-004 수정이 `AbortSignal.timeout(TOKEN_TIMEOUT_MS)` 을 넣었고 기존 테스트는
//    "signal 이 실려 나간다"까지만 본다. **10초를 600초로 바꿔도 전부 초록이다.**
//    그런데 이 값은 아침 종합 방송(07:50)이 얼마나 오래 멈춰 있을 수 있는지를 정한다 —
//    너무 길면 ISSUE-004 가 고치려던 그 상태로 돌아간다.
//
// ② 상수 이름이 실제 범위보다 좁다.
//    이름은 `TOKEN_TIMEOUT_MS`("토큰")인데 **일정 조회(`:128`)까지 지배한다.**
//    이름만 읽고 "토큰만 걸려 있구나" 하면 일정 조회는 무방비라고 오해한다.
//
// ③ 무응답 경보가 영어 원문으로 나간다.
//    `morning.js:209` 가 `err.message` 를 그대로 실어 경보를 낸다. `AbortSignal.timeout` 이
//    던지는 것은 `The operation was aborted due to timeout` 이라, 현장 직원이 보는 배너에
//    그 문장이 그대로 뜬다. `geminiClient.js:47` 은 같은 상황을 한국어로 바꿔 준다 —
//    그 선례를 따른다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'services/calendar.js'), 'utf8')
  .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

test('제한시간은 10초다 — 아침 방송이 멈춰 있을 수 있는 시간이라 값 자체를 고정한다', () => {
  const m = SRC.match(/const\s+(\w*TIMEOUT_MS)\s*=\s*(\d+)/)
  assert.ok(m, '제한시간 상수를 못 찾았다 — 이 가드를 옮길 것')
  assert.equal(Number(m[2]), 10000,
    `제한시간이 ${m[2]}ms 로 바뀌었다. 이 값은 아침 종합 방송(07:50)이 구글 무응답에 `
    + '얼마나 멈춰 있을 수 있는지를 정한다 — 늘리려면 그 영향을 먼저 보고 이 줄을 함께 고칠 것')
})

test('상수 이름이 실제 범위를 말한다 — 토큰만이 아니라 일정 조회에도 걸린다', () => {
  const m = SRC.match(/const\s+(\w*TIMEOUT_MS)\s*=/)
  const name = m[1]
  assert.doesNotMatch(name, /^TOKEN_/,
    `상수 이름이 '${name}' 인데 토큰 갱신·교환뿐 아니라 **일정 조회**에도 걸려 있다. `
    + '이름만 읽고 "일정 조회는 무방비"라고 오해한다(P-20)')
})

test('구글로 나가는 세 호출이 모두 같은 문(門)을 지난다 — 하나라도 새면 그것만 무방비다', () => {
  // 토큰 교환·토큰 갱신·일정 조회 셋이다. 예전엔 각자 signal 을 달았고, 그래서
  // 한 곳만 빠뜨려도 티가 안 났다(ISSUE-004 가 정확히 그 사고였다).
  const wrapped = (SRC.match(/await fetchGoogle\(/g) || []).length
  assert.equal(wrapped, 3,
    `fetchGoogle 을 지나는 호출이 ${wrapped}곳이다 — 셋이어야 한다(토큰 교환·갱신·일정 조회). `
    + '빠진 것이 있으면 그 호출만 제한시간도 한국어 문구도 없다')

  // 래퍼를 우회해 직접 fetch 하는 곳이 없어야 한다(래퍼 자신의 한 번은 뺀다)
  const raw = (SRC.match(/\bfetch\(/g) || []).length
  assert.equal(raw, 1, `fetchGoogle 을 우회한 직접 fetch 가 ${raw - 1}곳 있다`)
})

test('무응답 경보가 한국어로 나간다 — 현장 직원이 보는 배너다', () => {
  assert.ok(/timeout|무응답|응답이 없/.test(SRC), '제한시간을 다루는 자리가 없다 — 이 가드를 옮길 것')
  assert.match(SRC, /초 안에 응답이 없/,
    '무응답을 한국어로 바꿔 주는 자리가 없다 — AbortSignal 이 던지는 '
    + '"The operation was aborted due to timeout" 이 morning.js:209 를 거쳐 배너에 그대로 뜬다. '
    + 'geminiClient.js:47 이 같은 상황을 한국어로 바꾸는 선례다(P-20)')
})
