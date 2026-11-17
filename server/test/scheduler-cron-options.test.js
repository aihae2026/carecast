// 2026-08-31 CC-031 — **적용하지 않기로 한 제안**을 고정한다(db-pragmas.test.js와 같은 이유:
// 다음 사람이 "리뷰에 있는데 왜 안 했지?" 하고 되돌리지 않도록).
//
// 리뷰 제안: 매분 cron에 `noOverlap: true`를 주어 시계가 뒤로 튈 때의 중복 발사를 막자.
// 실측 결과 이 제안은 이 시스템에서 **더 큰 손해**다:
//   · 매분 tick은 due 예약을 `await fireSchedule()`로 순차 실행하고(scheduler.js),
//     그 안에서 `await generateTTS(...)`를 기다린다. 옛 인터넷 합성 엔진는 재시도·설치 확인까지 하면
//     한 건이 분 단위로 늘어질 수 있다.
//   · 발동 조건은 `scheduled_time = 현재 HH:MM` **정확 일치**뿐이다(CC-002, 유예창 없음).
//   · 그래서 noOverlap이 그 사이의 tick을 건너뛰면, 건너뛴 분에 걸린 예약은 그날 영원히
//     안 나간다. 중복 발사(사람이 두 번 듣는다)보다 **누락(아무도 못 듣는다)이 나쁘다.**
// 중복 발사의 진짜 해법은 발사 직전 원자적 선점(claimDaily)이고, 그건 CC-002 catch-up
// 설계와 한 세트라 사용자가 시점을 정할 때 함께 간다(TASKS.md "보류 — 3-C").
//
// timezone 옵션도 넣지 않았다. 패턴이 `* * * * *`·`*/30 * * * *`라 타임존과 무관하고,
// 실제 시각 판정은 `nowHHMM()`(로컬)이 한다. 여기만 Asia/Seoul로 박으면 두 시계가 갈린다.
'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SRC = fs.readFileSync(path.join(__dirname, '../services/scheduler.js'), 'utf8')

test('매분 cron에 noOverlap을 주지 않는다(누락 > 중복)', () => {
  assert.equal(/noOverlap/.test(SRC), false,
    'noOverlap을 켜면 TTS로 길어진 tick 동안의 분이 통째로 건너뛰어져 그 예약이 그날 안 나간다')
})

test('그 판단의 전제 — 매분 tick이 발사를 await한다', () => {
  assert.ok(/await fireSchedule\(/.test(SRC),
    'tick이 더 이상 발사를 기다리지 않게 바뀌었다면 위 판단을 다시 해야 한다')
})
