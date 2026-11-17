// 오늘 나갈 방송을 예정/완료/누락으로 보여주는가 (2026-08-29 리뷰 CC-026).
//
// 화면이 getSchedules()만 읽어서 일과방송 5종이 아예 안 보였다 — 그것들은 schedules 테이블이
// 아니라 settings의 시각·활성 키로 돌기 때문이다. 게다가 이력에는 "예정" 상태가 없어서 안 나간
// 방송은 화면에서 그냥 사라진다(발동이 없으면 broadcasts에 행조차 안 생긴다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_today_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { buildTodayView, statusOf } = require('../domain/todaySchedule')
const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

const at = (h, m) => new Date(2026, 7, 30, h, m)

// ── 순수 판정 ──────────────────────────────────────────────
test('발동 기록이 있으면 완료', () => {
  assert.equal(statusOf(470, 700, true, 5), 'done')
})

test('시각이 아직 안 지났으면 예정', () => {
  assert.equal(statusOf(700, 690, false, 5), 'pending')
})

test('유예 안쪽이면 아직 예정 — watchdog이 경보를 내기 전이다', () => {
  assert.equal(statusOf(700, 705, false, 5), 'pending', '경계(시각+유예)는 아직 봐준다')
  assert.equal(statusOf(700, 706, false, 5), 'missed',  '유예를 넘기면 누락')
})

test('유예는 watchdog과 같은 값을 받는다 — 화면과 경보가 어긋나면 둘 다 안 믿게 된다', () => {
  assert.equal(statusOf(700, 710, false, 5),  'missed')
  assert.equal(statusOf(700, 710, false, 15), 'pending', '유예를 넓히면 화면도 같이 넓어져야 한다')
})

test('자정 가까운 시각도 그날 안에 판정한다 — 마감이 하루를 넘으면 영영 pending 이다 (P-37)', () => {
  // nowMin 의 최대값은 1439(23:59)인데 마감은 `예정 + 유예`다. 자르지 않으면 23:55 예정 +
  // 유예 5분 = 1440 이 어떤 분에도 닿지 못해 화면이 하루 종일 'pending' 으로 남는다.
  const 밤11시55분 = 23 * 60 + 55
  const 밤11시59분 = 23 * 60 + 59
  assert.equal(statusOf(밤11시55분, 밤11시59분, false, 5), 'missed',
    '23:55 예정분이 하루가 끝나도록 pending 이면 화면이 영영 아무 말도 안 한다')

  // 그러나 **예정 시각 그 분을 빨갛게 칠하지는 않는다.** 아직 나갈 시간인데 화면이 먼저
  // 실패라고 말하면 감시(watchdog)와 갈린다 — 거기서도 같은 이유로 막는다.
  assert.equal(statusOf(밤11시59분, 밤11시59분, false, 5), 'pending',
    '예정 시각과 같은 분에 누락으로 칠했다 — 유예를 한 번도 안 준 것이다')
})

test('시작은 했는데 아직 안 끝난 방송은 누락이 아니다 — 감시(watchdog)와 같은 근거를 본다', () => {
  // 저녁 마무리 18:00, 지금 18:06. 완료 표시는 시퀀스 끝에 찍히므로 아직 없다.
  assert.equal(statusOf(1080, 1086, false, 5, true),  'pending',
    '나가는 중인 방송에 "누락" 뱃지가 붙으면 화면과 경보가 갈린다')
  assert.equal(statusOf(1080, 1086, false, 5, false), 'missed',
    '시작조차 안 했으면 예전 그대로 누락이다')
  assert.equal(statusOf(1080, 1200, true, 5, true),   'done',
    '완료가 시작보다 세다')
})

// ── 목록 구성 ──────────────────────────────────────────────
test('일과방송과 예약을 한 목록으로 시각 순 정렬한다', () => {
  const items = buildTodayView({
    autoTimes: [
      { id: 'dinner',  label: '저녁 식사 전 방송', time: '16:15', firedToday: false },
      { id: 'morning', label: '아침 종합 방송',   time: '07:50', firedToday: true },
    ],
    schedules: [{ id: 9, title: '프로그램 안내', scheduled_time: '11:15', firedToday: false }],
    now: at(12, 0), graceMin: 5,
  })
  assert.deepEqual(items.map(i => i.time), ['07:50', '11:15', '16:15'])
  assert.deepEqual(items.map(i => i.status), ['done', 'missed', 'pending'])
  assert.deepEqual(items.map(i => i.kind), ['auto', 'schedule', 'auto'])
})

test('같은 분이면 일과방송이 먼저 — 이 시스템의 기본 골격이다', () => {
  const items = buildTodayView({
    autoTimes: [{ id: 'lunch', label: '점심 식사 전 방송', time: '11:15', firedToday: false }],
    schedules: [{ id: 9, title: '프로그램 안내', scheduled_time: '11:15', firedToday: false }],
    now: at(9, 0), graceMin: 5,
  })
  assert.deepEqual(items.map(i => i.kind), ['auto', 'schedule'])
})

test('시각 형식이 깨진 항목은 목록에서 빼고 나머지는 살린다', () => {
  const items = buildTodayView({
    autoTimes: [{ id: 'x', label: '깨진 것', time: '25:99', firedToday: false },
                { id: 'lunch', label: '점심', time: '11:15', firedToday: false }],
    schedules: [{ id: 1, title: '빈 시각', scheduled_time: '', firedToday: false }],
    now: at(9, 0), graceMin: 5,
  })
  assert.deepEqual(items.map(i => i.label), ['점심'])
})

// 화면(TodaySchedule.jsx)이 이 API로 갈아타면서 필요해진 필드 (CC-026 화면 통합).
// 없으면 지금 화면에 있는 "1차/2차" 묶음 배지와 대상 표시가 사라진다 — 기능 후퇴다.
test('예약 항목은 묶음(group_id)과 대상(target)을 함께 준다', () => {
  const items = buildTodayView({
    schedules: [{
      id: 9, title: '프로그램 안내', scheduled_time: '11:15',
      group_id: 'g1', target: '2층', firedToday: false,
    }],
    now: at(9, 0), graceMin: 5,
  })
  assert.equal(items[0].group_id, 'g1', '묶음 정보가 없으면 화면의 1차/2차 배지를 만들 수 없다')
  assert.equal(items[0].target, '2층')
})

test('일과방송에는 묶음·대상이 없다 — 화면이 빈 배지를 그리지 않게 null로 준다', () => {
  const items = buildTodayView({
    autoTimes: [{ id: 'morning', label: '아침 종합 방송', time: '07:50', firedToday: false }],
    now: at(9, 0), graceMin: 5,
  })
  assert.equal(items[0].group_id, null)
  assert.equal(items[0].target, null)
})

test('구별 가능한 key를 준다 — 일과방송 id와 예약 id가 겹칠 수 있다', () => {
  const items = buildTodayView({
    autoTimes: [{ id: 'morning', label: '아침', time: '07:50', firedToday: false }],
    schedules: [{ id: 'morning', title: '이름이 같은 예약', scheduled_time: '08:00', firedToday: false }],
    now: at(9, 0), graceMin: 5,
  })
  assert.equal(new Set(items.map(i => i.key)).size, 2)
})

// ── 화면이 실제로 이 API를 쓰는가 ──────────────────────────
// 서버만 고치고 화면이 옛 경로(getSchedules)에 머물면, 일과방송이 안 보이는 원래 증상이
// 그대로다. 되돌아가지 않게 소스에서 고정한다.
test('TodaySchedule 화면이 /today API를 쓰고, 상태를 자기가 다시 계산하지 않는다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'TodaySchedule.jsx'), 'utf8')
  // 주석에는 옛 이름이 사연으로 남아 있으므로 실제 import 줄만 본다.
  const importLine = src.match(/^import .*from '\.\.\/\.\.\/lib\/api'$/m)?.[0] ?? ''
  assert.match(importLine, /getTodaySchedule/, '일과방송을 보려면 이 API를 써야 한다')
  assert.doesNotMatch(importLine, /getSchedules\b/,
    '옛 경로로 돌아가면 일과방송 5종이 다시 사라진다')
  assert.doesNotMatch(src, /last_fired/,
    '완료 판정을 화면이 다시 하면 watchdog 경보와 어긋난다 — 서버 status를 그대로 쓴다')
})

// ── HTTP ───────────────────────────────────────────────────
let app
test.before(async () => {
  initDB()
  const db = getDB()
  const put = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(k, String(v))
  put('morning_enabled', 'true');            put('morning_time', '07:50')
  put('lunch_broadcast_enabled', 'true');    put('lunch_broadcast_time', '11:15')
  put('dinner_broadcast_enabled', 'false')   // 꺼진 방송은 목록에 안 올라야 한다
  put('watchdog_grace_min', '5')
  app = await startTestApp({ '/api/schedules': require('../routes/schedules') })
})
test.after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('HTTP: 켜져 있는 일과방송만 나오고 상태 집계가 함께 온다', async () => {
  const res  = await fetch(`${app.baseUrl}/api/schedules/today`)
  assert.equal(res.status, 200)
  const body = await res.json()

  const labels = body.items.map(i => i.label)
  assert.ok(labels.includes('아침 종합 방송'))
  assert.ok(labels.includes('점심 식사 전 방송'))
  assert.ok(!labels.includes('저녁 식사 전 방송'), '꺼진 방송을 올리면 "안 나갔다"로 오해된다')

  assert.equal(body.graceMin, 5)
  assert.equal(typeof body.date, 'string')
  const sum = body.count.pending + body.count.done + body.count.missed
  assert.equal(sum, body.items.length, '집계와 항목 수가 어긋나면 화면이 틀린 숫자를 띄운다')
})

test('HTTP: 예약 행의 묶음·대상이 응답까지 실려 온다', async () => {
  const db = getDB()
  // 매일 반복(요일 전체)으로 넣는다 — 빈 repeat_weekdays는 1회성이라 시작일이 오늘이어야만
  // 목록에 뜬다(repeatSchedule.shouldRunToday). 날짜에 기대지 않는 편이 안정적이다.
  db.prepare(`INSERT INTO schedules
      (title, content, target, scheduled_time, repeat_type, active, broadcast_type,
       repeat_start_date, repeat_weekdays, group_id)
    VALUES (?, ?, ?, ?, '매일', 1, 'text', ?, '[0,1,2,3,4,5,6]', ?)`)
    .run('묶음 테스트 방송', '내용', '3층', '10:30', '2020-01-01', 'grp-x')

  const res  = await fetch(`${app.baseUrl}/api/schedules/today`)
  const body = await res.json()
  const row  = body.items.find(i => i.label === '묶음 테스트 방송')
  assert.ok(row, '오늘 도는 예약이 목록에 있어야 한다')
  assert.equal(row.group_id, 'grp-x')
  assert.equal(row.target, '3층')
})

test('HTTP: /today가 예약 id로 오인되지 않는다', async () => {
  const res = await fetch(`${app.baseUrl}/api/schedules/today`)
  const body = await res.json()
  assert.ok(Array.isArray(body.items), 'items 배열이 아니면 /:id 라우트에 먹힌 것이다')
})

// ── **시작만 하고 안 끝난 방송이 영원히 「다음」으로 남던 것** (현장 사고 2026-09-15) ──
//
// 그날 09:00 국민체조가 시작 표시만 남기고 끝나지 않았다. 09:26 에 찍은 화면에서
// **그 줄이 아직 「다음」**이었다 — 09:10 환기방송이 이미 완료인데도 그랬다.
//
// 원인: `statusOf` 가 `startedToday` 면 **조건 없이** 'pending' 을 냈다. 상한이 없었다.
// 그래서 한 번 시작 표시가 찍히면 그 방송은 **하루 종일 「다음에 나갈 방송」**이 된다.
//
// 이 파일 머리말과 `todaySchedule.js` 머리말이 **둘 다** "판정은 watchdog 과 같아야 한다"고
// 적고 있었는데, watchdog 은 `started ? runGrace : grace` 로 상한을 두고 60분 뒤
// 「안 끝남」을 알린다. **화면만 상한이 없었다** — 화면은 「대기」, 경보는 「안 끝남」.
// 사람이 둘 다 안 믿게 되는, 그 머리말이 막으려던 바로 그 상태다.
test('시작만 하고 안 끝난 방송도 **긴 유예가 지나면** 누락이다', () => {
  // 09:00 시작 표시 있음, 유예 5분 / 긴 유예 60분.
  // 09:26 — 아직 긴 유예 안이다. 「대기」가 맞다(저녁 마무리 5.6분·아침 투약 6분을 위한 여유).
  assert.equal(statusOf(9 * 60, 9 * 60 + 26, false, 5, true, 60), 'pending',
    '시작한 지 26분은 아직 나가는 중으로 본다')
  // 10:01 — 60분을 넘겼다. watchdog 은 이때 「안 끝남」을 알린다. 화면도 같아야 한다.
  assert.equal(statusOf(9 * 60, 10 * 60 + 1, false, 5, true, 60), 'missed',
    '긴 유예를 넘겼는데도 「대기」면 화면과 경보가 갈린다')
})

test('시작 표시가 없으면 짧은 유예로 판정한다 — 기존 규칙 그대로', () => {
  assert.equal(statusOf(9 * 60, 9 * 60 + 4, false, 5, false, 60), 'pending')
  assert.equal(statusOf(9 * 60, 9 * 60 + 6, false, 5, false, 60), 'missed')
})

test('**「다음」은 시작만 하고 멈춘 방송에 붙지 않는다** — 화면이 고른다', () => {
  // 현장 화면 그대로: 09:00 국민체조가 시작만 됨, 09:10 환기는 완료, 11:15 점심은 대기.
  const items = buildTodayView({
    autoTimes: [
      { id: 'exercise', label: '국민체조', time: '09:00', firedToday: false, startedToday: true },
      { id: 'lunch',    label: '점심 식사 전 방송', time: '11:15', firedToday: false },
    ],
    schedules: [],
    now: new Date(2026, 8, 15, 10, 30),   // 09:00 + 60분 유예를 넘긴 시각
    graceMin: 5,
    runGraceMin: 60,
  })
  const 체조 = items.find(i => i.id === 'exercise')
  assert.equal(체조.status, 'missed',
    '멈춘 방송이 「대기」로 남으면 화면이 그것을 「다음에 나갈 방송」으로 고른다')
})

// ── **라우트가 「긴 유예」 설정을 실제로 넘기는가** (변이 시험에서 놓쳤던 자리) ──────
//
// `buildTodayView` 에 기본값 60 이 있어서, 라우트가 값을 **안 넘겨도** 기본 설정에서는
// 결과가 같다. 그래서 "라우트가 안 넘기게" 바꾸는 변이를 순수 함수 시험이 못 잡았다.
//
// 설정을 **기본값과 다른 값**으로 두면 갈린다 — 그때 화면이 60분을 쓰고 감시가 설정값을
// 쓰면 **둘이 어긋난다.** 이 어긋남이 오늘 사고의 모양 그 자체라 시험으로 묶는다.
test('HTTP: watchdog_run_grace_min 을 바꾸면 화면 판정도 따라간다', async () => {
  const db = getDB()
  const put = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(k, String(v))

  // ── **시각을 「지금보다 5분 전」으로 잡는 것이 핵심이다** ──────────────────
  // 처음엔 00:01 로 뒀는데, 그러면 지금이 두 유예(1분·60분)를 **둘 다** 넘겨서
  // 라우트가 값을 넘기든 말든 'missed' 가 나왔다 — 변이 시험이 그것을 잡아냈다.
  // 5분 전이면 **긴 유예 1분은 넘었고 60분은 안 넘었다.** 그래야 둘이 갈린다.
  const now = new Date()
  const 오분전 = new Date(now.getTime() - 5 * 60 * 1000)
  // 자정 근처면 어제로 넘어가 날짜가 갈린다 — 그때는 이 시험을 건너뛴다(시계에 기대지 않는다).
  if (오분전.getDate() !== now.getDate()) return
  const hhmm = `${String(오분전.getHours()).padStart(2, '0')}:${String(오분전.getMinutes()).padStart(2, '0')}`

  // ── **UTC 로 날짜를 만들면 안 된다** (2026-09-16 자정 넘어 터졌다) ────────────
  // 앞 판은 `new Date().toISOString().slice(0, 10)` 이었다. `toISOString()` 은 **UTC** 라,
  // 한국 시각 00:00~09:00 사이에는 **어제 날짜**가 나온다. 그러면 시작 표시가 「어제
  // 것」으로 저장되고, 라우트는 현지 날짜(`todayStr()`)로 비교하므로 **오늘 시작한 적이
  // 없다**고 읽어 'pending' 으로 남는다.
  //
  // **제품과 같은 규칙을 쓴다** — `services/repeatSchedule.todayStr()` 가 그 규칙이다.
  // 하루 중 아홉 시간 동안만 틀리는 시험이라, 밤에 안 돌렸으면 영영 못 봤을 것이다
  // (`feedback_carecast_fake_oracle` 의 「시계에 기댐」 그대로다).
  const { todayStr } = require('../services/repeatSchedule')
  const today = todayStr()
  put('exercise_broadcast_enabled', 'true')
  put('exercise_broadcast_time', hhmm)
  put('exercise_last_started', today)     // 시작 표시만 있고
  put('exercise_last_fired', '')          // 완료 표시는 없다

  // 긴 유예 1분 → 5분 전에 시작한 방송은 이미 상한을 넘었다.
  // 라우트가 이 값을 안 넘기면 화면은 기본 60분을 써서 아직 '대기'로 본다.
  put('watchdog_run_grace_min', '1')
  const 짧게 = await (await fetch(`${app.baseUrl}/api/schedules/today`)).json()
  const 체조짧게 = 짧게.items.find(i => i.id === 'exercise')
  assert.ok(체조짧게, '국민체조가 목록에 있어야 한다')
  assert.equal(체조짧게.status, 'missed',
    '라우트가 watchdog_run_grace_min 을 안 넘기면 화면은 기본 60분을 써서 「대기」로 남는다')

  // 되돌려 둔다 — 뒤 시험이 이 설정을 물려받지 않게.
  put('watchdog_run_grace_min', '60')
  put('exercise_broadcast_enabled', 'false')
})
