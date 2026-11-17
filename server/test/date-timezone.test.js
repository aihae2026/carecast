// 이 저장소의 "오늘"은 한 가지 뜻이어야 한다.
//
// 왜 필요했나(2026-08-29 리뷰 CC-015, 2026-08-30 게이트 2 검토에서 실제 결함 확인):
// todayStr이 두 벌 있었다 — repeatSchedule.js는 로컬(KST), scheduler.js·broadcastSequencer.js·
// 라우트 3곳은 `toISOString().slice(0,10)`(UTC). KST 09시 이전은 UTC로 전날이라 다음이 났다.
//
//  · 아침 종합 방송(07:50)이 정상적으로 나가도 morning_last_fired가 "어제"로 찍힌다.
//    그런데 watchdog.js는 로컬 날짜로 판정하므로 07:55마다 **거짓 누락 경보**를 띄운다.
//    경보 배너는 사람이 확인을 누르기 전까지 안 사라지는 설계라 매일 아침 쌓인다.
//  · 09시 이전 방송 이력이 전날 날짜로 남아 이력 화면에서 엉뚱한 날에 붙는다.
//  · SystemAlertBanner는 `date === localToday()`로 복원하는데 재생실패 행은 UTC로 저장돼
//    새로고침 후 복원이 안 되고, 라이브 이벤트와 id(`날짜|종류|문구`)가 갈려 중복 표시된다.
//  · broadcastSequencer의 `step.end_date` 만료 비교가 하루 늦게 걸린다.
//
// 그래서 날짜를 만드는 곳은 repeatSchedule.todayStr 하나로 못박는다. 두 벌이 다시 생기면
// 조용히 어긋나므로, 아래 소스 대조 테스트가 그것을 막는다(auto-broadcasts.test.js와 같은 방식).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const { todayStr } = require('../services/repeatSchedule')

const SRC = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

// 날짜를 만들어 DB에 넣는 파일들. 새로 생기면 여기에 추가한다.
// **가드는 코드를 따라 옮긴다**(CLAUDE.md). 2026-09-10 에 즉시 방송·마이크의 이력 기록이
// `domain/broadcastRecord.js` 한 곳으로 모이면서 `routes/tts.js` 는 더 이상 날짜를 안 적는다.
// 목록을 그대로 두면 "없는 대상"을 검사하며 초록이 되거나(조용한 헐거움) 엉뚱하게 빨간불이 난다.
const DATE_WRITING_FILES = [
  ['services', 'scheduler.js'],
  ['services', 'broadcastSequencer.js'],
  ['routes',   'broadcasts.js'],
  ['domain',   'broadcastRecord.js'],   // ← tts.js·mic.js 의 이력 기록이 여기로 모였다
  ['routes',   'switchbot.js'],
]

test('todayStr은 로컬 달력 날짜를 준다 (주입한 시각 기준)', () => {
  // 로컬 구성요소로 만든 Date라 어느 타임존에서 돌려도 같은 답이어야 한다
  assert.equal(todayStr(new Date(2026, 7, 30,  7, 50)), '2026-08-30')
  assert.equal(todayStr(new Date(2026, 7, 30,  0,  1)), '2026-08-30')
  assert.equal(todayStr(new Date(2026, 7, 30, 23, 59)), '2026-08-30')
  assert.equal(todayStr(new Date(2026, 0,  1,  0,  0)), '2026-01-01')
})

test('날짜를 기록하는 서버 소스에 UTC 날짜 추출이 남아 있지 않다', () => {
  for (const parts of DATE_WRITING_FILES) {
    const src = SRC(...parts)
    // 실패 메시지에 파일 전체가 실리지 않게 매치된 문자열만 단언한다
    const hit = src.match(/toISOString\(\)\s*\.\s*(slice\(0,\s*10\)|split\('T'\)\[0\])/)?.[0] ?? null
    assert.equal(hit, null,
      `${parts.join('/')}에 UTC 날짜 추출이 남아 있다(${hit}) — repeatSchedule.todayStr을 쓸 것`)
  }
})

test('날짜를 기록하는 서버 소스는 repeatSchedule의 todayStr을 쓴다', () => {
  for (const parts of DATE_WRITING_FILES) {
    const src = SRC(...parts)
    assert.ok(/require\(['"](\.\.\/services|\.)\/repeatSchedule['"]\)/.test(src),
      `${parts.join('/')}가 repeatSchedule을 require하지 않는다`)
    assert.ok(/\btodayStr\b/.test(src), `${parts.join('/')}가 todayStr을 쓰지 않는다`)
    // 자기 todayStr을 다시 정의하면 두 벌 문제가 그대로 재발한다
    assert.ok(!/function\s+todayStr\s*\(/.test(src),
      `${parts.join('/')}가 todayStr을 자체 정의한다 — 단일 출처(repeatSchedule)만 써야 한다`)
  }
})

test('watchdog의 판정 날짜와 scheduler가 기록하는 날짜가 같은 구현에서 나온다', () => {
  // watchdog.js는 repeatSchedule.todayStr로 판정한다. scheduler.js가 다른 구현으로
  // *_last_fired를 쓰면 감시가 매일 아침 거짓 경보를 낸다(2026-08-30에 실제로 확인).
  assert.ok(/require\('\.\/repeatSchedule'\)/.test(SRC('services', 'watchdog.js')),
    'watchdog.js가 repeatSchedule을 쓰지 않는다')
  assert.ok(/todayStr/.test(SRC('services', 'scheduler.js')),
    'scheduler.js가 todayStr을 쓰지 않는다')
})

test('UTC 표기와 로컬 표기가 갈리는 시각이 실재한다 (이 결함이 이론이 아님을 고정)', (t) => {
  // 로컬 자정 직후와 자정 직전 중 하나는 UTC로 다른 날짜다 — 타임존이 UTC일 때만 둘 다 같다.
  const candidates = [new Date(2026, 7, 30, 0, 30), new Date(2026, 7, 30, 23, 30)]
  const diverging = candidates.filter(d => d.toISOString().slice(0, 10) !== todayStr(d))
  if (diverging.length === 0) {
    t.skip('이 환경의 타임존이 UTC라 UTC/로컬이 갈리지 않는다 (현장 PC는 KST)')
    return
  }
  for (const d of diverging) {
    assert.notEqual(d.toISOString().slice(0, 10), todayStr(d))
    assert.equal(todayStr(d), '2026-08-30')
  }
})
