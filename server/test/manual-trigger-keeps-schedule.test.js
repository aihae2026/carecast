// 「수동재생」을 눌러도 그날 정시 방송이 그대로 나간다 (사용자 결정 2026-09-01).
//
// 그전에는 수동재생이 예약 방송과 **똑같은 흔적**을 남겼다 — `last_fired = 오늘`.
// 매분 tick은 `last_fired != 오늘`인 것만 고르므로, 확인차 한 번 눌러 본 방송은
// **그날 정시에 안 나갔다.** 화면에는 아무 표시가 없고 이력에는 "나갔다"로 남아서
// 사람이 알아챌 방법이 없었다. 자동방송 5종도 같았다(morning_last_fired 등).
//
// 사용자 결정: **둘 다 나가게 한다.** 수동재생은 이력만 남기고 예약 상태는 안 건드린다.
//
// **묶음(1·2차)은 예외다.** 환기방송처럼 묶인 예약은 쉬운 화면의 「수동재생」이
// "아직 안 나간 차수"를 고르는 데 last_fired를 쓴다(ScheduledBroadcastMini의
// handleTriggerGroup). 여기서 안 찍으면 두 번 눌러도 계속 1차만 나간다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_manual_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { fireSchedule } = require('../services/scheduler')
const { fireMorningBroadcast } = require('../services/broadcastSequencer')
const { rawSetting, writeSetting } = require('../domain/settingsRead')

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let db

test.before(() => {
  initDB()
  db = getDB()
  // 아침방송을 빈 구성으로 — 이 파일이 보는 것은 "발사 표시를 찍는가"뿐이다.
  writeSetting(db, 'morning_steps', JSON.stringify(
    ['bgm', 'date_weather_schedule', 'morning_prayer_intro', 'morning_prayer',
     'breakfast_prayer_tts', 'bgm_after', 'medication_tts', 'morning_video']
      .map((id, order) => ({ id, label: id, enabled: false, order }))))
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function makeSchedule({ groupId = null } = {}) {
  return db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, broadcast_type,
                           active, repeat_weekdays, last_fired, group_id)
    VALUES (?, '차임벨', '전체', '14:23', 'chime', 1, '[0,1,2,3,4,5,6]', NULL, ?)
  `).run('수동재생 테스트', groupId).lastInsertRowid
}
const rowOf = (id) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)

test('수동재생한 예약은 "오늘 나갔다" 표시가 안 찍힌다 — 정시에 또 나가야 한다', async () => {
  const id = makeSchedule()
  await fireSchedule({ ...rowOf(id), _manual: true }, db)
  assert.equal(rowOf(id).last_fired, null,
    '수동재생이 발사 표시를 찍었다 — 그날 정시 방송이 조용히 사라진다')
})

test('수동재생도 이력에는 남는다 — 나간 것은 나간 것이다', async () => {
  const id = makeSchedule()
  db.prepare('DELETE FROM broadcasts').run()
  await fireSchedule({ ...rowOf(id), _manual: true }, db)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM broadcasts WHERE type = '예약'").get().n, 1)
})

test('정시 발사(tick)는 예전 그대로 표시를 찍는다 — 중복 발사를 막는 장치다', async () => {
  const id = makeSchedule()
  await fireSchedule(rowOf(id), db)
  assert.equal(rowOf(id).last_fired, todayStr(),
    'tick 경로에서 표시가 안 찍히면 같은 방송이 매분 다시 나간다')
})

test('묶음(1·2차) 예약도 예외가 아니다 — 차수를 사람이 직접 고르므로 표시를 안 찍는다', () => {
  // 잠깐 예외로 뒀던 이유는 쉬운 화면의 「수동재생」이 "아직 안 나간 차수"를 last_fired로
  // 골랐기 때문이다. 1차/2차 뱃지를 각각 버튼으로 바꾸면서 사람이 직접 고르게 됐고
  // (2026-09-01), 고르는 규칙이 없어지니 예외도 없어졌다.
  const id = makeSchedule({ groupId: 'vent-test' })
  return fireSchedule({ ...rowOf(id), _manual: true }, db).then(() => {
    assert.equal(rowOf(id).last_fired, null,
      '묶음이라는 이유로 표시를 찍으면 그 차수가 그날 정시에 안 나간다')
  })
})

test('[화면] 1차·2차를 각각 누를 수 있다 — 다음 차수를 골라 주는 버튼이 아니다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'ScheduledBroadcastMini.jsx'), 'utf8')
  // **2026-09-14에 이 정규식을 한 번 고쳤다.** 누르면 바로 안 나가고 확인을 거치게 되면서
  // (G-42) 묶음 줄도 `handleTriggerManual(item)` 대신 `set물음({ 줄: item, … })` 이 됐다.
  // **이 시험이 고정하는 사실은 그 함수 이름이 아니라 "그 차수(item)를 그대로 겨눈다"** 이다 —
  // 계산해서 고른 다른 줄이 아니라. 그래서 무엇을 넘기는지를 본다.
  assert.match(src, /set물음\(\{\s*줄:\s*item,/,
    '묶음 줄에서 차수를 직접 고를 수 없다')
  assert.doesNotMatch(src, /handleTriggerGroup/,
    '"다음 차수 고르기"가 남아 있다 — 사람이 고르는 것과 규칙이 두 벌이 된다')
  // 고른 것이 **확인을 거쳐 예약 발사로** 간다. 여기까지 안 이으면 위 단언은
  // "아무 데도 안 가는 값을 세운다"까지만 보증한다.
  assert.match(src, /확인뒤발사\(/,
    '고른 차수가 확인 뒤 발사로 안 이어진다')
})

test('자동방송 5종도 수동 실행하면 표시가 안 찍힌다 — 07:00에 들어봤다고 07:50이 사라지면 안 된다', async () => {
  writeSetting(db, 'morning_last_fired', '')
  await fireMorningBroadcast(db, { manual: true })
  assert.notEqual(rawSetting(db, 'morning_last_fired'), todayStr(),
    '수동 실행이 아침방송을 "오늘 나갔다"로 표시했다 — 정시 07:50 방송이 사라진다')
})

test('자동방송 5종의 정시 발사는 예전 그대로 표시를 찍는다', async () => {
  writeSetting(db, 'morning_last_fired', '')
  await fireMorningBroadcast(db)
  assert.equal(rawSetting(db, 'morning_last_fired'), todayStr(),
    '표시가 안 찍히면 매분 tick이 아침방송을 계속 다시 낸다')
})

test('수동 실행은 "나가는 중" 표시(*_last_started)도 안 찍는다 — 정시 방송의 누락 감시가 눈멀면 안 된다', async () => {
  writeSetting(db, 'morning_last_started', '')
  await fireMorningBroadcast(db, { manual: true })
  assert.notEqual(rawSetting(db, 'morning_last_started'), todayStr(),
    '수동재생이 시작 표시를 찍으면, 정시 07:50이 진짜로 안 나가도 감시가 60분을 기다린다')
})

test('정시 발사는 시작 표시를 찍는다 — 5분 넘는 방송이 누락으로 오인되지 않게', async () => {
  writeSetting(db, 'morning_last_started', '')
  await fireMorningBroadcast(db)
  assert.equal(rawSetting(db, 'morning_last_started'), todayStr())
})
