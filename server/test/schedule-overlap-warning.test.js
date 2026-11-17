// 같은 분에 예약을 두 개 넣으면 소리가 겹친다 — 그걸 저장 전에 알려준다.
//
// 사용자 결정(2026-08-31): **겹침 자체는 막지 않는다.** 대기시키면 줄서기가 길어지고,
// 건너뛰면 방송 하나가 그날 안 나가고, 끊으면 긴 흐름이 잘린다. 셋 다 지금보다 나쁘다.
// 대신 **같은 분에 예약을 넣을 때 화면 경고를 강하게** 하고, 범위는 예약끼리만으로 한다
// (자동방송 5종과 즉시방송은 건드리지 않는다 — 매일 돌아가는 곳이다).
//
// 판정은 순수 함수 한 곳에 둔다. 실제로 겹치는지는 "같은 분 + 같은 날 도는가"이지,
// 시각만 같은 게 아니다 — 월요일 예약과 화요일 예약은 같은 10:00라도 안 겹친다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')

// 화면 코드(ESM)를 노드에서 부르기 위해 소스에서 함수만 떼어 평가한다 —
// scheduleUtils는 순수 함수 모음이라 이 방식으로 검증해 왔다(ontology.test.js와 같은 결).
const utilsSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'scheduleUtils.js'), 'utf8')

test('scheduleUtils가 예약끼리 겹침 판정을 갖는다', () => {
  assert.ok(utilsSrc.includes('export function findScheduleOverlaps'),
    '판정이 화면 안에 박히면 다른 화면에서 또 다르게 구현된다')
})

test('겹침 판정 규칙이 소스에 그대로 있다 — 같은 분, 같은 날', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'scheduleUtils.js')).href)
  const { findScheduleOverlaps } = mod

  const all = [
    { id: 1, title: '아침 안내',  scheduled_time: '10:00', repeat_weekdays: '[1,3]', repeat_start_date: '2026-01-01', active: 1 },
    { id: 2, title: '점심 안내',  scheduled_time: '10:00', repeat_weekdays: '[2]',   repeat_start_date: '2026-01-01', active: 1 },
    { id: 3, title: '가까운 방송', scheduled_time: '10:03', repeat_weekdays: '[1]',   repeat_start_date: '2026-01-01', active: 1 },
    { id: 4, title: '꺼진 방송',  scheduled_time: '10:00', repeat_weekdays: '[1]',   repeat_start_date: '2026-01-01', active: 0 },
  ]
  const draft = { scheduled_time: '10:00', repeat_weekdays: [1], repeat_start_date: '2026-01-01' }

  const hits = findScheduleOverlaps(draft, all)
  const ids = hits.map(h => h.id)
  assert.ok(ids.includes(1), '같은 분·같은 요일은 겹친다')
  assert.ok(!ids.includes(2), '요일이 다르면 안 겹친다 — 월요일 방송과 화요일 방송')
  assert.ok(!ids.includes(4), '꺼진 예약은 소리를 안 낸다')
  assert.equal(hits.find(h => h.id === 1).exact, true)

  const near = hits.find(h => h.id === 3)
  assert.ok(near, '앞뒤 몇 분 이내도 알려준다 — 방송은 순간이 아니라 몇 분을 쓴다')
  assert.equal(near.exact, false, '같은 분과 가까운 분은 구별해서 보여줘야 한다')
})

test('자기 자신은 겹침이 아니다 — 기존 예약을 고칠 때', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'scheduleUtils.js')).href)
  const all = [{ id: 7, title: '나', scheduled_time: '10:00', repeat_weekdays: '[1]', repeat_start_date: '2026-01-01', active: 1 }]
  const draft = { id: 7, scheduled_time: '10:00', repeat_weekdays: [1], repeat_start_date: '2026-01-01' }
  assert.deepEqual(mod.findScheduleOverlaps(draft, all), [],
    '자기 자신이 걸리면 예약을 고칠 때마다 헛경고가 뜬다')
})

test('1회성 예약은 그 날짜가 같을 때만 겹친다', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'scheduleUtils.js')).href)
  const all = [{ id: 1, title: '내일 것', scheduled_time: '10:00', repeat_weekdays: '[]', repeat_start_date: '2026-09-02', active: 1 }]
  assert.equal(
    mod.findScheduleOverlaps({ scheduled_time: '10:00', repeat_weekdays: [], repeat_start_date: '2026-09-01' }, all).length, 0)
  assert.equal(
    mod.findScheduleOverlaps({ scheduled_time: '10:00', repeat_weekdays: [], repeat_start_date: '2026-09-02' }, all).length, 1)
})

test('예약 모달이 그 경고를 실제로 보여준다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'shared', 'ScheduleModal.jsx'), 'utf8')
  assert.ok(src.includes('findScheduleOverlaps'), '판정만 있고 화면에 안 뜨면 아무도 못 본다')
  assert.ok(src.includes('소리가 겹칩니다'), '무엇이 문제인지 말해 주는 문구가 있어야 한다')
})

test('겹쳐도 저장은 막지 않는다 — 사용자 결정', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'shared', 'ScheduleModal.jsx'), 'utf8')
  const start = src.indexOf('findScheduleOverlaps')
  const region = src.slice(start, start + 3000)
  assert.ok(!/disabled=\{[^}]*overlap/i.test(region),
    '경고가 저장을 막으면 "그래도 하겠다"는 사람의 판단을 뺏는다 — 겹침은 허용하기로 했다')
})

// ── 2026-09-12: 경고가 **사람이 실제로 쓰는 길**에는 없었다 ────────────────────
//
// 브라우저로 돌려 보니 이 경고는 「자세히 설정」 전체 모달에만 떴다. 그런데 달력에서
// 빈 날짜를 누르면 뜨는 것은 **빠른 등록**이고, 제목·시각·내용 세 칸만 적고 저장하는
// 그 길이 기본값이다. 같은 분에 이미 방송이 있어도 아무 말이 없었다 —
// 두 소리가 홀에서 겹쳐 나간 뒤에야 안다.
//
// 규칙을 두 벌로 만들지 않는 것이 핵심이다. 빠른 등록도 같은 `findScheduleOverlaps` 를
// 부르고, 자동방송 5종을 그 함수가 아는 모양으로 바꾸는 것도 이미 있는
// `autoBroadcastSiblings` 가 한다. 여기서는 **그 둘을 실제로 부르는지**를 고정한다.
const 빠른등록 = () => fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'admin', 'sections', 'scheduleCalendarPopups.jsx'), 'utf8')
const 주간표 = () => fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'admin', 'sections', 'WeeklySchedule.jsx'), 'utf8')

test('빠른 등록이 같은 판정 함수를 쓴다 — 제 규칙을 또 만들지 않는다', () => {
  const src = 빠른등록()
  // 긍정 앵커 — 빠른 등록이 이 파일에 있다
  assert.match(src, /export function QuickCreatePopup/, 'QuickCreatePopup 이 사라졌다 — 가드를 옮길 것')

  assert.match(src, /findScheduleOverlaps\(draft\(\)/,
    '빠른 등록이 겹침을 안 본다 — 같은 분에 방송을 겹쳐 만들어도 아무 말이 없다')
  assert.match(src, /autoBroadcastSiblings\(/,
    '자동방송 5종을 비교 대상에 안 넣는다 — 아침 방송과 같은 시각에 넣어도 조용하다')
  // 규칙을 베껴 쓰지 않았는가 — 시각 비교를 이 파일에서 다시 구현하면 전체 모달과 갈린다
  assert.ok(!/hhmmToMinutes|OVERLAP_NEAR_MIN/.test(src),
    '겹침 판정을 이 파일에서 다시 구현했다 — 규칙이 두 벌이 되면 반드시 갈린다')
})

test('주간표가 빠른 등록에 비교 대상을 넘긴다 — 안 넘기면 늘 "겹침 없음"이 된다', () => {
  const src = 주간표()
  const m = /<QuickCreatePopup([\s\S]*?)\/>/.exec(src)
  assert.ok(m, 'QuickCreatePopup 렌더를 못 찾았다 — 가드를 옮길 것')
  assert.match(m[1], /이미있는것=\{schedules\}/,
    '예약 목록을 안 넘긴다 — 빈 배열과 비교하니 경고가 영영 안 뜬다')
  assert.match(m[1], /자동방송=\{autoSchedule\}/,
    '자동방송 설정을 안 넘긴다 — 자동방송과의 겹침을 못 본다')
})

test('경고가 뜨면 팝업을 키운다 — 「저장」이 잘리면 아무것도 못 한다', () => {
  const src = 빠른등록()
  assert.match(src, /height=\{겹침\.length > 0 \? \d+ : \d+\}/,
    '고정 높이에 경고를 끼워 넣었다 — 저장 단추가 팝업 밖으로 밀린다')
})

test('겹침을 막지 않는다 — 사용자 결정(2026-08-31)은 말하되 막지 않는 것이다', () => {
  const src = 빠른등록()
  const m = /const save = async \(\) => \{([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(m, 'save 를 못 찾았다 — 가드를 옮길 것')
  assert.ok(!/겹침/.test(m[1]),
    '저장을 겹침으로 막는다 — 1·2차로 나눈 환기방송처럼 일부러 겹쳐야 할 때가 있고, '
    + '막으면 사람이 우회로를 찾는다')
})
