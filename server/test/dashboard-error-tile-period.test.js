// 대시보드 타일들이 같은 기간을 세는가 (P-17, 2026-09-08)
//
// 왜 이 파일이 있나:
//   한 줄에 나란히 선 다섯 타일 중 **"오류"만 전체 기간을 셌다.**
//     · 이번달·TTS·즉시·예약/자동 → `WHERE date LIKE '2026-09-%'`
//     · 오류                      → `WHERE success = 0`  ← 날짜 조건 없음
//   [FACT] EV-000421 · EV-001652 — `routes/status.js:89` 에 날짜 조건이 없다.
//
//   화면 라벨은 그냥 **"오류"** 다(`Dashboard.jsx:386`). 옆 칸이 전부 이번 달이므로
//   사람은 그것도 이번 달로 읽는다. 실제로는 **개설 이래 누적**이라, 몇 달 지나면
//   이번 달에 아무 문제가 없어도 그 숫자가 계속 커져 있다.
//
//   숫자가 틀린 게 아니라 **옆 숫자와 다른 것을 세면서 같은 것처럼 보인다.**
//   ISSUE-010 이후 밀린 방송도 여기 들어오므로(P-31) 더 자주 오른다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes/status.js'), 'utf8')
  .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

/**
 * `errorCount` 를 만드는 구문 전체를 뽑는다.
 *
 * 한 줄만 보면 안 된다 — SQL 이 여러 줄로 나뉘면 조건절이 다음 줄에 있어 못 본다
 * (실제로 이 가드의 1차 버전이 자기 수정을 그렇게 놓쳤다). `const errorCount` 부터
 * 그 구문이 끝나는 `.cnt` 까지를 통째로 본다.
 */
function errorCountStatement() {
  const i = SRC.indexOf('const errorCount')
  assert.ok(i >= 0, 'errorCount 를 만드는 자리를 못 찾았다 — 이 가드를 옮길 것')
  const end = SRC.indexOf('.cnt', i)
  assert.ok(end > i, 'errorCount 구문의 끝(.cnt)을 못 찾았다 — 표기가 바뀌었는지 볼 것')
  return SRC.slice(i, end)
}

test('오류 집계도 이번 달만 센다 — 옆 타일과 같은 기간이어야 한다', () => {
  // 긍정 앵커 — 이 파일이 정말 대시보드 집계를 만드는 자리인가
  assert.ok(/errorCount/.test(SRC), 'status.js 에 errorCount 가 없다 — 이 가드를 옮길 것')
  assert.ok(/monthCount/.test(SRC), 'status.js 에 monthCount 가 없다 — 비교 대상이 사라졌다')

  assert.match(errorCountStatement(), /date LIKE/,
    '오류 집계에 날짜 조건이 없다 — 옆 타일은 이번 달인데 이것만 누적이라 '
    + '사람이 "이번 달 오류"로 읽는다(P-17)')
})

test('오류 집계는 진행 중(RUNNING=2)을 세지 않는다 — success = 0 을 명시한다', () => {
  // 2026-09-10(P-97): 질의가 `domain/broadcastRecord.오류수` 로 올라갔다(두 라우트에
  // 복사돼 있었고 한쪽만 고치는 사고가 실제로 났다). **가드의 뜻은 그대로다** —
  // 진행 중(RUNNING=2)을 오류로 세지 않는지 본다. 보는 자리만 따라 옮긴다.
  const 정본 = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'domain', 'broadcastRecord.js'), 'utf8')
  const i = 정본.indexOf('function 오류수(')
  assert.ok(i >= 0, '오류 집계 정본이 사라졌다 — 이 가드를 옮길 것')
  const 본문 = 정본.slice(i, 정본.indexOf('}', 정본.indexOf('.cnt', i)))
  assert.match(본문, /success = 0/,
    '오류를 진리값으로 세면 진행 중까지 오류가 된다(broadcastOutcome.js 머리말과 같은 이유)')
  assert.match(본문, /date LIKE/, '날짜 조건이 사라졌다 — 이번 달만 세야 한다(P-17)')
})
