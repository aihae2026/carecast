// 일과방송 5종의 **이름을 사람이 바꿀 수 있게** 한다.
//
// 그전에는 이름이 화면마다 따로 박혀 있었다 — 자동방송순서편집기(TABS), 주간표(AUTO_META),
// 예약방송관리(AUTO_META), 쉬운화면(ScheduledBroadcastMini). 한 곳을 고쳐도 나머지가
// 옛 이름을 보여줬고, 실제로 **같은 방송이 화면마다 다른 이름으로 불리고 있었다**
// (자동방송순서편집기는 '식사전 체조'가 둘, 주간표는 '식사전 체조(점심)'·'(저녁)').
//
// 이름을 바꿀 수 있게 하려면 **먼저 한 곳에서 읽어야 한다.** 시각을 모아 둔
// domain/autoBroadcasts.js가 그 자리다(TD-07에서 같은 이유로 시각을 모았다).
//
// **이력 문구는 이 이름을 따라가지 않는다.** 방송 이력에 남는 "아침 방송"은
// broadcastSequencer의 LANES가 정하는 고정 문구다. 사용자가 확인한 것이 그 문구이고,
// 이름을 바꿨다고 지난 이력의 뜻이 달라지면 안 된다. 그 경계를 아래에서 못박는다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_autoname_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { AUTO_BROADCASTS, readAutoNames } = require('../domain/autoBroadcasts')
const { writeSetting } = require('../domain/settingsRead')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('설정이 없으면 기본 이름을 준다', () => {
  const names = readAutoNames(getDB())
  assert.equal(names.morning, '아침 방송')
  assert.equal(names.exercise, '국민체조')
  assert.equal(names.evening_prayer, '저녁 마무리')
})

test('기본 이름 5개가 서로 다르다 — 같은 이름이 둘이면 사이드바에서 못 고른다', () => {
  const names = Object.values(readAutoNames(getDB()))
  assert.equal(new Set(names).size, names.length,
    `이름이 겹친다: ${names.join(', ')} — 점심·저녁 체조가 구분돼야 한다`)
})

test('이름을 바꾸면 그 이름을 준다', () => {
  const db = getDB()
  writeSetting(db, 'morning_display_name', '새벽 안내')
  assert.equal(readAutoNames(db).morning, '새벽 안내')
})

test('빈 값으로 저장하면 기본 이름으로 돌아간다 — 이름 없는 방송이 목록에 생기면 안 된다', () => {
  const db = getDB()
  writeSetting(db, 'exercise_display_name', '   ')
  assert.equal(readAutoNames(db).exercise, '국민체조')
})

test('5종 전부 이름 설정키를 갖는다', () => {
  for (const spec of AUTO_BROADCASTS) {
    assert.ok(spec.nameKey, `${spec.id}에 nameKey가 없다`)
    assert.ok(spec.displayName, `${spec.id}에 기본 이름이 없다`)
  }
})

// ── 경계 ───────────────────────────────────────────────────
test('[경계] 이름을 바꿔도 방송 이력 문구는 안 바뀐다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  assert.match(src, /runLog: '아침 방송', +logContent: '아침 방송'/,
    '이력 문구는 LANES의 고정 문구여야 한다 — 사용자가 눈으로 확인한 것이 이 문구다')
  assert.doesNotMatch(src, /readAutoNames/,
    '실행부가 표시 이름을 읽으면 이력 문구가 이름 변경을 따라가 버린다')
})

test('[구조] 화면이 들고 있는 기본 이름이 서버 표와 같다', () => {
  // 화면은 서버 응답이 오기 전 잠깐 자기 기본값을 쓴다. 그 값이 서버와 다르면
  // 새로고침할 때마다 이름이 한 번 깜빡이며 바뀐다.
  const { AUTO_DEFAULT_NAMES } = require('../../src/lib/autoBroadcastNames.js')
  const fromServer = Object.fromEntries(AUTO_BROADCASTS.map(s => [s.id, s.displayName]))
  assert.deepEqual(AUTO_DEFAULT_NAMES, fromServer)
})

// ── 구조 ───────────────────────────────────────────────────
test('[구조] 화면 넷이 이름을 각자 갖지 않고 서버에서 받은 것을 쓴다', () => {
  const SCREENS = [
    ['src', 'components', 'admin', 'sections', 'MorningEditor.jsx'],
    ['src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx'],
    ['src', 'components', 'admin', 'sections', 'ScheduledBroadcast.jsx'],
    ['src', 'components', 'easy', 'ScheduledBroadcastMini.jsx'],
  ]
  for (const parts of SCREENS) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
    assert.match(src, /autoName/, `${parts[parts.length - 1]}이 공용 이름을 안 쓴다`)
  }
})
