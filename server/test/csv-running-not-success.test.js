// 진행 중(RUNNING=2)인 방송이 CSV 에 "성공"으로 나가지 않는가 (P-6, 2026-09-08)
//
// 왜 이 파일이 있나:
//   `broadcastOutcome.js:10-15` 의 머리말은 이렇게 적어 뒀다 —
//     "이 저장소의 집계 SQL 이 전부 `success = 1` / `success = 0` 을 **명시**해서
//      2가 성공에도 오류에도 안 섞인다(착수 전 전수조사로 확인)."
//   그 전수조사가 **CSV 내보내기를 빠뜨렸다.** `routes/broadcasts.js` 의 CSV 는
//   `r.success ? '성공' : '실패'` 라 **진리값**으로 본다 — 2는 truthy 이므로 "성공"이 된다.
//
//   CSV 는 심사·감사 때 기간을 통째로 내는 파일이다(그 라우트 주석이 그렇게 적었다).
//   아직 나갔다는 증거가 없는 방송이 그 파일에서 "성공"으로 읽히면, 그 숫자를 근거로
//   사람이 판단한다. 화면·집계는 옳은데 **내보낸 파일만 틀린** 상태였다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { FAILED, SUCCEEDED, RUNNING, outcomeLabel } = require('../domain/broadcastOutcome')

test('세 상태가 각각 다른 말로 나온다 — 진행 중은 성공이 아니다', () => {
  assert.equal(outcomeLabel(SUCCEEDED), '성공')
  assert.equal(outcomeLabel(FAILED), '실패')
  assert.equal(outcomeLabel(RUNNING), '진행 중',
    '진행 중이 성공·실패 중 하나로 접히면 CSV 를 읽는 사람이 사실과 다른 것을 본다')
})

test('모르는 값은 성공으로 봐주지 않는다', () => {
  // outcomeOfFlow 가 "모르는 결과는 성공으로 봐주지 않는다"고 한 것과 같은 방향이다.
  for (const v of [null, undefined, 3, -1, '1']) {
    assert.notEqual(outcomeLabel(v), '성공', `${JSON.stringify(v)} 를 성공으로 읽었다`)
  }
})

test('CSV 내보내기는 진리값이 아니라 상태 라벨을 쓴다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes/broadcasts.js'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

  // 긍정 앵커 — 이 파일이 정말 CSV 를 내는 자리인가
  assert.ok(/export\.csv/.test(src), 'broadcasts.js 에 CSV 라우트가 없다 — 이 가드를 옮길 것')
  assert.ok(src.includes('outcomeLabel'), 'CSV 가 outcomeLabel 을 안 쓴다')

  assert.doesNotMatch(src, /r\.success\s*\?\s*'성공'/,
    "CSV 에 `r.success ? '성공' : '실패'` 가 남아 있다 — RUNNING(2)은 truthy 라 성공으로 나간다(P-6)")
})
