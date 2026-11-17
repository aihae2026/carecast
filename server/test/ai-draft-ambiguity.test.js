// AI(Gemini) 초안 경로의 되묻기(B4).
//
// 규칙 파서(QuickSchedulePhrase)에는 있는 "애매하면 되묻고 확인받기"가 AI 경로에는 없었다.
// 같은 문장을 어느 화면에 넣었느냐에 따라 한쪽만 경고하는 것은 오독보다 더 헷갈린다.
// 판정은 Gemini에게 다시 묻지 않고, 문장·시각·DB만으로 규칙 경로와 같은 모듈로 계산한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_aidraftamb_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { analyzeAiDraft } = require('../routes/scheduleDrafts')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// 고정 시각 — 2026-08-28(금) 15:00
const NOW = new Date('2026-08-28T15:00:00')
const base = { rawInput: '내일 오후 5시에 산책 안내 방송 예약해줘', date: '2026-08-29', time: '17:00', broadcastType: 'text', hasVolume: false, now: NOW }

test('분명한 문장은 아무것도 되묻지 않는다 — 잔소리가 되면 아무도 안 읽는다', () => {
  const r = analyzeAiDraft(getDB(), base)
  assert.deepEqual(r.ambiguous, [])
  assert.equal(r.date, '2026-08-29', '날짜를 건드릴 이유가 없다')
})

test('오늘 + 이미 지난 시각은 내일로 옮기고 알린다 — 안 옮기면 영원히 안 나간다', () => {
  // 1회성 예약은 repeat_start_date 당일에만 발동한다(scheduler.shouldRunToday)
  const r = analyzeAiDraft(getDB(), { ...base, date: '2026-08-28', time: '14:00' })
  assert.ok(r.ambiguous.includes('time_past_moved'))
  assert.equal(r.date, '2026-08-29', '내일로 옮겨야 한다')
})

test('아직 안 지난 오늘 시각은 옮기지 않는다', () => {
  const r = analyzeAiDraft(getDB(), { ...base, date: '2026-08-28', time: '16:00' })
  assert.ok(!r.ambiguous.includes('time_past_moved'))
  assert.equal(r.date, '2026-08-28')
})

test('일과방송과 겹치면 이름을 대고 알린다 — 막지는 않는다', () => {
  const db = getDB()
  // 저녁 식사전 체조 16:20이 켜져 있다고 가정
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dinner_broadcast_enabled', 'true')").run()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dinner_broadcast_time', '16:20')").run()

  const r = analyzeAiDraft(db, { ...base, date: '2026-08-30', time: '16:22' })
  assert.ok(r.ambiguous.includes('overlaps_auto'), '±5분 이내는 겹침이다')
  assert.ok(r.overlaps.length >= 1, '어느 방송과 겹치는지 이름이 있어야 사람이 판단한다')

  const far = analyzeAiDraft(db, { ...base, date: '2026-08-30', time: '10:00' })
  assert.ok(!far.ambiguous.includes('overlaps_auto'))
})

test('규칙 사전이 다른 유형으로 강하게 읽으면 이름을 대고 묻는다', () => {
  // "차임벨 울려줘"는 사전이 chime으로 강하게 읽는다 — Gemini가 text라고 하면 묻는다
  const r = analyzeAiDraft(getDB(), {
    ...base, rawInput: '저녁 6시에 차임벨 울려줘', broadcastType: 'text',
  })
  assert.ok(r.ambiguous.includes('type_differs'))
  assert.equal(r.ruleType?.broadcastType, 'chime', '어느 유형인지 이름이 있어야 한다')

  // 둘이 같으면 물을 게 없다
  const same = analyzeAiDraft(getDB(), {
    ...base, rawInput: '저녁 6시에 차임벨 울려줘', broadcastType: 'chime',
  })
  assert.ok(!same.ambiguous.includes('type_differs'))
})

test('반복 표현이 있으면 알린다 — 이 경로는 1회 예약만 만든다', () => {
  // approveDraft가 repeat_weekdays: []로 저장한다. "매일 오후 3시 산책"이 내일 한 번만
  // 나가고 끝나는 것은 사람이 알아채기 가장 어려운 실패다.
  const r = analyzeAiDraft(getDB(), { ...base, rawInput: '매일 오후 5시에 산책 안내 예약해줘' })
  assert.ok(r.ambiguous.includes('repeat_unsupported'))
})

// 두 파서가 같은 어휘를 봐야 한다 (2026-08-29 리뷰).
//
// 규칙 파서(schedulePhrase)는 "월수금"·"월요일과 수요일"을 반복으로 읽는다. 그런데 AI 경로는
// 자기 목록(/매일|매주|매달|마다|평일|주말/)만 갖고 있어서 그것들을 반복으로 인식하지 못했다.
// 그러면 **경고 없이 1회성 예약만** 만들어지고 사람은 매주 나갈 거라 믿는다. 같은 문장이
// 어느 화면에서 입력했느냐에 따라 다르게 처리되는 것 자체가 결함이다.
test('요일을 나열해도 반복으로 인식한다 — 규칙 파서와 판정이 갈리면 안 된다', () => {
  const { parseSchedulePhrase } = require('../services/schedulePhrase')
  for (const raw of ['월수금 체조 안내 방송해줘', '월요일과 수요일에 방송해줘', '토요일마다 방송해줘']) {
    const r = analyzeAiDraft(getDB(), { ...base, rawInput: raw })
    assert.ok(r.ambiguous.includes('repeat_unsupported'), `${raw} — AI 경로가 반복을 못 봤다`)
    // 규칙 파서 쪽도 실제로 반복(여러 요일)으로 읽는지 함께 고정한다
    const days = parseSchedulePhrase(raw, new Date()).repeat_weekdays
    assert.ok(Array.isArray(days) && days.length > 0, `${raw} — 규칙 파서가 반복으로 안 읽는다`)
  }
})

test('1회성 표현은 반복으로 오인하지 않는다 — 매번 경고를 띄우면 사람이 경고를 무시한다', () => {
  for (const raw of ['8월 30일 오후 2시에 프로그램 안내 예약해줘', '내일 점심에 안내 방송', '오늘 저녁 공지']) {
    const r = analyzeAiDraft(getDB(), { ...base, rawInput: raw })
    assert.ok(!r.ambiguous.includes('repeat_unsupported'), `${raw} — 1회성인데 반복 경고가 떴다`)
  }
})

test('볼륨을 읽었으면 확인을 요구한다 — 귀로 바로 체감되는 값이다', () => {
  const r = analyzeAiDraft(getDB(), { ...base, hasVolume: true })
  assert.ok(r.ambiguous.includes('volume_set'))
})

// ── 화면 드리프트 방어 ────────────────────────────────────────
test('화면이 모든 되묻기 항목에 문구를 갖고 있고, 체크 전에는 확정을 막는다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'easy', 'TTSBroadcast.jsx'), 'utf8')

  // 서버가 만들 수 있는 모든 키에 화면 문구가 있어야 한다 — 없으면 경고가 조용히 사라진다
  for (const key of ['time_past_moved', 'overlaps_auto', 'type_differs', 'volume_set', 'repeat_unsupported']) {
    assert.ok(src.includes(`'${key}'`), `화면에 '${key}' 문구가 없다 — 이 경고는 그려지지 않는다`)
  }
  // 게이트 — 체크 전에는 확정이 안 된다
  assert.ok(src.includes('draftNotes.length > 0 && !draftAcked'),
    '확인 게이트가 없다 — 애매한 채로 예약이 확정된다')
  assert.ok(src.includes('setDraftAcked(false)'),
    '새 초안에서 체크가 초기화되지 않는다 — 이전 확인이 다음 초안에 이월된다')
})
