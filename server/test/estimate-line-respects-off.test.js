// 껐다고 표시된 방송의 예상 소요시간 줄이 시각을 지어내지 않는가 (P-53, 2026-09-08)
//
// 왜 이 파일이 있나:
//   P-40 수정으로 자동방송순서편집기의 **탭 라벨과 제목**은 빈 시각을 '꺼짐'으로 보여준다.
//   그런데 **같은 화면의 예상 소요시간 줄은 안 고쳤다.** 서버가 `startTime: sched[tab].time`
//   으로 빈 문자열을 그대로 싣고(`broadcastScheduleRead.js:263`),
//   `estimateEndTime` 이 `String(startHHMM || '00:00')` 으로 받아 **00:00 기준 종료 시각**을 만든다.
//   [FACT] EV-001632 — `estimateEndTime('', 5분)` → `{ time: '00:05' }`.
//
//   결과: 한 줄 위는 '꺼짐', 아래 줄은 " · 00:00 → 00:05". **같은 화면이 두 뜻으로 말한다.**
//   P-40 이 만든 것이 아니라 **남긴 자리**다 — 사람이 보는 자리를 고치는 수정이었는데
//   그 자리 하나가 빠졌다(2026-09-08 독립 검수 지적).
//
//   서버의 `estimateEndTime` 기본값(`|| '00:00'`)은 그대로 둔다. 순수 계산 함수라 기본값이
//   필요하고, **무엇을 보여줄지 정하는 것은 화면의 일**이다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { estimateEndTime } = require('../domain/broadcastEstimate')

test('빈 시각을 주면 계산 함수는 00:00 기준으로 답한다 — 그래서 화면이 걸러야 한다', () => {
  // 이 동작 자체는 바꾸지 않는다. 화면이 왜 걸러야 하는지의 근거로 고정해 둔다.
  assert.equal(estimateEndTime('', 5 * 60 * 1000).time, '00:05',
    '전제가 바뀌었다 — 계산 함수가 빈 시각을 다르게 다루면 이 테스트의 이유가 사라진다')
})

test('편집기의 예상 소요시간 줄은 시각이 비면 그대로 보여주지 않는다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src/components/admin/sections/MorningEditor.jsx'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

  // 긍정 앵커 — 이 파일이 정말 예상 소요시간을 보여주는 자리인가
  assert.ok(src.includes('est.end.time'), 'MorningEditor 가 예상 종료 시각을 안 보여준다 — 이 가드를 옮길 것')
  assert.ok(src.includes('timeLabel'), 'P-40 의 timeLabel 이 사라졌다 — 함께 확인할 것')

  // "조건 없이 찍지 않는다"는 부정 단언으로 표현하기 어렵다 — 조건 **안**의 사용까지 걸린다
  // (실제로 1차 가드가 그렇게 자기 수정을 못 알아봤다). 그래서 긍정으로 확인한다:
  //   ① 시각이 있는지 먼저 묻는 분기가 있고 ② 없을 때 보여줄 말이 있다.
  assert.match(src, /est\.startTime\s*\r?\n?\s*\?/,
    'est.startTime 이 있는지 묻는 분기가 없다 — 조건 없이 찍으면 시각을 비운 방송이 '
    + '" · 00:00 → 00:05" 로 보인다(P-53)')
  assert.match(src, /시각 미설정/,
    '시각이 없을 때 보여줄 말이 없다 — 분기만 있고 대체 문구가 없으면 그 줄이 통째로 빈다')
})
