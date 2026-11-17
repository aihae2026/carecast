// "지금 당장" 즉시 방송(백로그 3번).
//
// 즉시 실행은 예약을 만들지 않고 쏘는 경로가 아니다 — **예약을 만들어 검증·기록을 전부
// 태운 뒤 그 자리에서 발사**한다(POST /api/schedules → POST /:id/trigger). 1회성이라 발사
// 후 자동 비활성화되므로 스케줄러가 같은 분에 다시 쏘지 않는다.
// 검토 게이트: 파싱이 자동으로 쏘는 일은 없다. immediate 플래그는 화면 버튼을
// "예약 확정"에서 "지금 방송"으로 바꿀 뿐, 누르는 것은 사람이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_immediate_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { isImmediateRequest } = require('../domain/ontology')
const { parseSchedulePhrase } = require('../services/schedulePhrase')
const { analyzeAiDraft } = require('../routes/scheduleDrafts')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const NOW = new Date('2026-08-28T21:40:00')
const OPTS = { flows: [], autoTimes: [], volumeLevels: { quiet: 30, loud: 85 } }

// ── 판정 규칙 (ontology.isImmediateRequest — 한 곳) ───────────
test('시각·반복 표현이 읽혔으면 즉시가 아니다 — "지금부터 매일"의 지금은 시작 시점이다', () => {
  assert.equal(isImmediateRequest('지금 안내방송 해줘'), true)
  assert.equal(isImmediateRequest('지금 말고 오후 3시에', { hasTime: true }), false)
  assert.equal(isImmediateRequest('지금부터 매일 안내', { hasRepeat: true }), false)
})

test("'바로'만으로는 즉시가 아니다 — 예약 문장을 즉시 방송으로 오독하는 쪽이 더 위험하다", () => {
  assert.equal(isImmediateRequest('바로 안내드립니다'), false)
})

// ── 규칙 파서 ────────────────────────────────────────────────
test('"지금 당장" 문장은 즉시 1회 방송으로 읽힌다', () => {
  const r = parseSchedulePhrase('지금 당장 저녁 안내 방송 해줘', NOW, OPTS)
  assert.equal(r.immediate, true)
  assert.equal(r.scheduled_time, '21:40', '시각은 지금이다')
  assert.deepEqual(r.repeat_weekdays, [], '즉시 방송은 1회성이다 — 매일 기본값이 남으면 매일 나간다')
  assert.deepEqual(r.ambiguous, [],
    'time_missing(기본값 안내)·repeat_assumed·time_past_moved를 되물을 이유가 없다')
})

test('시각을 말한 문장은 즉시가 아니라 예약이다', () => {
  const r = parseSchedulePhrase('지금부터 매일 오후 3시에 산책 안내', NOW, OPTS)
  assert.ok(!r.immediate)
  assert.equal(r.scheduled_time, '15:00')
  assert.deepEqual(r.repeat_weekdays, [0, 1, 2, 3, 4, 5, 6])
})

test('즉시 방송도 유형·볼륨은 평소대로 읽는다', () => {
  const r = parseSchedulePhrase('지금 차임벨 울려줘', NOW, OPTS)
  assert.equal(r.immediate, true)
  assert.equal(r.broadcast_type, 'chime')
})

// ── AI 초안 경로 ─────────────────────────────────────────────
test('즉시 방송은 지난시각 보정을 건너뛴다 — 지금 == 지금이 내일로 옮겨지면 안 된다', () => {
  const db = getDB()
  const args = {
    rawInput: '지금 안내 방송 해줘', date: '2026-08-28', time: '21:40',
    broadcastType: 'text', hasVolume: false, now: NOW,
  }
  const moved = analyzeAiDraft(db, args)
  assert.ok(moved.ambiguous.includes('time_past_moved'), '전제: 즉시가 아니면 <=에 걸려 옮겨진다')

  const kept = analyzeAiDraft(db, { ...args, immediate: true })
  assert.ok(!kept.ambiguous.includes('time_past_moved'))
  assert.equal(kept.date, '2026-08-28', '날짜가 오늘로 남아야 지금 발사할 수 있다')
})

// ── 드리프트 방어 ────────────────────────────────────────────
test('두 파서 모두 판정을 ontology 한 곳에서 가져온다', () => {
  // 각자 판정하면 같은 문장이 화면에 따라 즉시가 되기도, 예약이 되기도 한다.
  for (const [name, rel] of [
    ['규칙 파서', ['services', 'schedulePhrase.js']],
    ['AI 초안 경로', ['routes', 'scheduleDrafts.js']],
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf8')
    assert.ok(src.includes('isImmediateRequest'), `${name}가 공용 판정을 쓰지 않는다`)
    assert.ok(!src.includes('/지금|당장/'), `${name}에 즉시 낱말 사전이 복사돼 있다`)
  }
})

test('화면이 즉시 방송을 실제로 발사한다 — 만들기만 하고 안 쏘면 조용한 무동작이다', () => {
  const SRC = path.join(__dirname, '..', '..', 'src')
  for (const [name, rel, flag] of [
    ['QuickSchedulePhrase', ['components', 'shared', 'QuickSchedulePhrase.jsx'], 'draft.immediate'],
    ['TTSBroadcast', ['components', 'easy', 'TTSBroadcast.jsx'], 'draftImmediate'],
  ]) {
    const src = fs.readFileSync(path.join(SRC, ...rel), 'utf8')
    assert.ok(src.includes(flag), `${name}가 immediate 플래그를 모른다`)
    assert.ok(src.includes('triggerSchedule('), `${name}가 발사(trigger)를 부르지 않는다`)
    assert.ok(src.includes('지금 방송'), `${name}에 "지금 방송" 버튼이 없다`)
  }
})
