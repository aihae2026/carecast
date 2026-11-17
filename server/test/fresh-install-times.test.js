// **새로 설치한 PC 의 일과방송 시각** (2026-09-18, T-33).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 빈 DB 로 서버를 띄웠더니 저녁 식사 전 방송이 **16:20** 으로 서 있었다. README·매뉴얼·
// `PROJECT_PROFILE §6` · `domain/autoBroadcasts.js` 의 기본값은 전부 **16:15** 인데도 그랬다.
// 시각을 정하는 자리가 **두 벌**이었기 때문이다 —
//   · `db/schema.js` 의 「새 방송 시간 기본값 설정(최초 1회)」 이 값을 **심고**,
//   · `domain/autoBroadcasts.js` 의 `defaultTime` 은 **설정 행이 없을 때만** 쓰인다.
// 심어 버리면 두 번째는 영원히 안 쓰인다. 그래서 문서의 16:15 는 아무 데도 안 나타났다.
//
// 게다가 부팅 순서가 `initDB()` → `applyDataFixes()` 라, 심는 값만 고치면 **보정이 도로
// 16:20 으로 돌려놓는다**(`datafix_exercise_time_20260831` 이 「16:15 이면 16:20 으로」였다).
// 그 보정은 2026-08-31 에 현장을 옮기려고 쓴 것인데, 현장은 그 뒤 사람 손으로 16:15 가 됐다
// (동요가 끝나는 자리에 맞춘 값 — `PROJECT_PROFILE §6`). 즉 **지금은 방향이 반대**다.
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
// **소스를 글자로 보지 않는다.** 진짜 부팅 순서(`initDB` → `applyDataFixes`)를 그대로 돌려
// **DB 에 남은 최종 값**을 본다. 한 자리만 고치고 다른 자리가 되돌리는 것을 잡으려면
// 그 방법뿐이다 — 상수 하나를 읽는 시험은 이 결함을 **통과시킨다**.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_freshtime_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB }              = require('../db/schema')
const { applyDataFixes }             = require('../config/dataFixes')
const { AUTO_BROADCASTS, autoTime }  = require('../domain/autoBroadcasts')

// 새 설치가 서야 할 시각. 출처는 `docs/audit/PROJECT_PROFILE.md` §6 이고 README·매뉴얼도 같다.
// **이 표를 고칠 때는 그 문서들도 같이 고친다** — 갈리면 심사위원이 설치해 보고 알아차린다.
const 서야할시각 = [
  ['morning_time',            '07:50', '아침 종합 방송'],
  ['exercise_broadcast_time', '09:00', '국민체조'],
  ['lunch_broadcast_time',    '11:15', '점심 식사 전'],
  ['dinner_broadcast_time',   '16:15', '저녁 식사 전'],
  ['evening_prayer_time',     '18:00', '저녁 마무리'],
]

// **행이 있느냐가 아니라 「실제로 쓰는 값」을 본다.** 저녁 마무리는 새 DB 에 행이 **안 심긴다** —
// 그래도 `autoTime` 이 `defaultTime` 으로 메워서 18:00 에 나간다. 행의 유무로 판정하면
// 멀쩡한 동작을 결함으로 적게 된다(2026-09-18 에 이 시험의 첫 판이 실제로 그랬다).
const 실제쓰는값 = (키) => {
  const spec = AUTO_BROADCASTS.find((b) => b.timeKey === 키)
  assert.ok(spec, `긍정 앵커 — ${키} 를 쓰는 일과방송이 있다`)
  const raw = getDB().prepare('SELECT value FROM settings WHERE key=?').get(키)?.value
  return autoTime(raw, spec)
}

test.before(() => {
  initDB()                    // 새 PC 의 첫 기동
  applyDataFixes(getDB())     // index.js 가 바로 뒤에 부르는 것
})
test.after(() => {
  for (const 꼬리 of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + 꼬리) } catch { /* 없으면 그만 */ }
  }
})

const 읽기 = (키) => getDB().prepare('SELECT value FROM settings WHERE key=?').get(키)?.value ?? null

for (const [키, 기대, 이름] of 서야할시각) {
  test(`새로 설치하면 **${이름}** 이 ${기대} 에 나간다`, () => {
    assert.equal(실제쓰는값(키), 기대,
      `${이름}(${키}) 이 문서와 다르다 — 설치한 사람이 보는 화면과 README 가 갈린다`)
  })
}

test('심는 값과 **없을 때 쓰는 기본값**이 서로 어긋나지 않는다', () => {
  // `autoBroadcasts` 의 `defaultTime` 은 설정 행이 없을 때만 쓰이지만, **두 값이 다르면
  // 둘 중 하나는 반드시 거짓말**이 된다 — 한쪽을 읽고 문서를 쓰면 다른 쪽이 도는 판이 된다.
  // 국민체조만 예외다(08:40 은 옛 값이고 현장·새 설치 모두 09:00, `PROJECT_PROFILE §6`).
  const 아는예외 = new Set(['exercise_broadcast_time'])
  let 본것 = 0
  for (const b of AUTO_BROADCASTS) {
    if (!b.timeKey || 아는예외.has(b.timeKey)) continue
    const 심은값 = 읽기(b.timeKey)
    if (심은값 === null) continue   // 안 심는 것은 기본값이 그대로 쓰이니 어긋날 수가 없다
    본것 += 1
    assert.equal(심은값, b.defaultTime,
      `${b.label}: 새 DB 에 심는 값(${심은값}) 과 기본값(${b.defaultTime}) 이 다르다`)
  }
  assert.ok(본것 >= 3, `긍정 앵커 — 실제로 대조한 방송이 ${본것}개뿐이다(시험이 헐거워졌다)`)
})

// ── 시각만이 아니라 **켜짐**도 본다 (2026-10-23 배포판 점검) ─────────────────────────
// 시각은 맞았는데 아침·저녁 마무리의 켜짐 칸이 안 심겨, 스케줄러가 07:50·18:00 을 방송으로 치지 않았다.
// 설정 화면은 없는 칸을 켜짐으로 읽어서 사람은 알 수가 없었다 — 「오늘 일과」에 셋만 떴다.
test('새로 설치하면 **일과방송 5종이 모두 켜진 채로** 스케줄러에 잡힌다', () => {
  const { readEnabledAutoTimes } = require('../domain/autoBroadcasts')
  const 잡힌것 = readEnabledAutoTimes(getDB()).map((t) => t.id).sort()
  assert.deepEqual(잡힌것, AUTO_BROADCASTS.map((b) => b.id).sort(),
    '설정 화면은 켜짐인데 스케줄러가 안 잡는 방송이 있다 — 그 시각에 방송이 안 나간다')
})
