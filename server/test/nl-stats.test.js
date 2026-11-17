// 자연어 학습 2단계 — "세어서 보여주기만 한다"의 셈이 맞는지 (고도화 제안 #10, 2026-09-03).
//
// 1단계가 남긴 재료(schedule_id·approved_json·edited_fields)를 집계하는 쪽이다.
// 설계·경계는 docs/nl-learning-design.md.
//
// 고정하는 사실 일곱:
//  1. 표본이 최소치 미만이면 지표를 **아예 만들지 않는다**(null) — 0은 "고친 적 없다"로 읽힌다
//  2. 거절 건과 옛 NULL 행은 표본에서 빠진다 — NULL은 "안 고쳤음"이 아니라 "모름"이다
//  3. 필드별 수정 건수는 고친 필드만, 분모는 표본 전체다
//  4. 오전/오후 오독은 **분은 같고 시만 정확히 12시간** 어긋난 수정만 센다
//  5. 유형 오독은 어떤 유형을 어떤 유형으로 고쳤는지 짝으로 센다
//  6. 모르는 낱말에 사전 낱말·불용어·숫자 토막은 안 오르고, 한 문장에 두 번 나와도 1건이다
//  7. approveDraft(1단계)가 남긴 행이 표본 질의에 그대로 잡힌다 — 두 단계가 실제로 이어진다
//  8. 서술어로 끝나는 토막은 후보가 아니다 — 사전 후보는 명사다(사용자 결정 (나)안)
//  9. 유형까지 고친 낱말이 위로 온다 — 빈도만으로 줄 세우면 방송 주제가 목록을 덮는다
// 10. 표본 질의는 최근 창(LIMIT)만 읽는다 — 옛 표현이 영영 상위에 남지 않게
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_nlstats_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { computeNlStats, SAMPLE_SQL } = require('../domain/nlStats')

// 표본 한 건. 값은 전부 "AI가 읽은 것"이고, approved가 "사람이 확정한 것"이다.
function sample(fields = {}) {
  const approved = {
    scheduled_time: fields.scheduled_time ?? '14:00',
    broadcast_type: fields.broadcast_type ?? 'text',
    ...(fields.approved ?? {}),
  }
  return {
    status: fields.status ?? 'approved',
    raw_input: fields.raw_input ?? '내일 두시에 프로그램 안내 방송 예약해줘',
    scheduled_time: fields.scheduled_time ?? '14:00',
    broadcast_type: fields.broadcast_type ?? 'text',
    approved_json: JSON.stringify(approved),
    edited_fields: fields.edited_fields === null ? null : JSON.stringify(fields.edited_fields ?? []),
  }
}

const many = (n, f = {}) => Array.from({ length: n }, () => sample(f))

test('사실1 — 표본이 최소치 미만이면 지표를 만들지 않는다', () => {
  const stats = computeNlStats(many(3), { minSamples: 20 })
  assert.equal(stats.enough, false)
  assert.equal(stats.samples, 3)
  assert.equal(stats.minSamples, 20)
  // 0이 아니라 null이어야 한다 — 화면이 "고친 적 없음"으로 그리면 안 된다
  assert.equal(stats.fieldEdits, null)
  assert.equal(stats.ampm, null)
  assert.equal(stats.typeMisreads, null)
  assert.equal(stats.unknownWords, null)
})

test('사실2 — 거절 건과 옛 NULL 행은 표본에서 빠진다', () => {
  const rows = [
    ...many(2),                                   // 승인 + 기록 있음 → 표본
    sample({ status: 'rejected', edited_fields: ['title'] }),  // 거절 → 제외
    sample({ status: 'pending' }),                             // 미처리 → 제외
    sample({ edited_fields: null }),                           // 옛 행(모름) → 제외
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.equal(stats.samples, 2)
})

test('사실3 — 고친 필드만 세고, 분모는 표본 전체다', () => {
  const rows = [
    ...many(2, { edited_fields: ['title', 'scheduled_time'] }),
    ...many(2, { edited_fields: [] }),   // 안 고치고 승인 — 분모에는 들어간다
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.equal(stats.samples, 4)
  const byField = Object.fromEntries(stats.fieldEdits.map(f => [f.field, f]))
  assert.equal(byField.title.count, 2)
  assert.equal(byField.title.rate, 50)          // 2/4
  assert.equal(byField.scheduled_time.count, 2)
  // 안 고친 필드는 목록에 없다(0으로 채우지 않는다)
  assert.equal(byField.content, undefined)
})

test('사실4 — 오전/오후 오독은 12시간 어긋난 수정만 센다', () => {
  const rows = [
    // 09:00 → 21:00 : 오전/오후 오독
    sample({ scheduled_time: '09:00', edited_fields: ['scheduled_time'],
      approved: { scheduled_time: '21:00' } }),
    // 09:00 → 10:00 : 그냥 시각 조정 — 오독이 아니다
    sample({ scheduled_time: '09:00', edited_fields: ['scheduled_time'],
      approved: { scheduled_time: '10:00' } }),
    // 09:30 → 21:00 : 분이 다르므로 12시간 뒤집기가 아니다
    sample({ scheduled_time: '09:30', edited_fields: ['scheduled_time'],
      approved: { scheduled_time: '21:00' } }),
    sample({ edited_fields: [] }),
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.equal(stats.ampm.count, 1)
  assert.equal(stats.ampm.timeEdits, 3)
  assert.equal(stats.ampm.rate, 25)   // 1/4
})

test('사실5 — 유형 오독을 짝으로 센다', () => {
  const rows = [
    ...many(2, { broadcast_type: 'video', edited_fields: ['broadcast_type'],
      approved: { broadcast_type: 'youtube-tv' } }),
    sample({ broadcast_type: 'text', edited_fields: ['broadcast_type'],
      approved: { broadcast_type: 'chime' } }),
    // 유형이 edited에 있지만 값이 같으면 오독이 아니다(방어)
    sample({ broadcast_type: 'text', edited_fields: ['broadcast_type'],
      approved: { broadcast_type: 'text' } }),
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.deepEqual(stats.typeMisreads, [
    { from: 'video', to: 'youtube-tv', count: 2 },
    { from: 'text', to: 'chime', count: 1 },
  ])
})

test('사실6 — 모르는 낱말만 오르고, 한 문장에 두 번 나와도 1건이다', () => {
  const rows = many(2, {
    // '음악'·'틀어줘'는 사전에 있고, '내일'·'예약'은 불용어, '11시'는 숫자 토막이다.
    // '건강강좌'는 두 번 나오지만 문장당 1건으로 센다.
    raw_input: '내일 11시에 건강강좌 음악 틀어줘 건강강좌 예약',
  })
  const stats = computeNlStats(rows, { minSamples: 1 })
  const words = stats.unknownWords.map(w => w.word)
  assert.deepEqual(words, ['건강강좌'])
  assert.equal(stats.unknownWords[0].count, 2)   // 문장 2건 = 2, 6이 아니다
})

test('사실6-b — 한 번만 나온 낱말은 후보로 올리지 않는다', () => {
  const rows = [
    sample({ raw_input: '내일 두시에 바자회 안내 방송' }),
    sample({ raw_input: '내일 세시에 산책 안내 방송' }),
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.deepEqual(stats.unknownWords, [])
})

// ── 1단계 ↔ 2단계 이음새 (L2) ─────────────────────────────────
// 집계가 아무리 맞아도 표본 질의가 1단계가 남긴 행을 못 잡으면 화면은 영원히 비어 있다.
test('사실7 — approveDraft가 남긴 행이 표본 질의에 잡히고 집계된다', () => {
  const { initDB, getDB } = require('../db/schema')
  initDB()
  const drafts = require('../routes/scheduleDrafts')

  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const id = getDB().prepare(`
    INSERT INTO schedule_drafts
      (raw_input, title, content, scheduled_time, repeat_start_date, broadcast_type, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'text', 'pending', 'ai', ?)
  `).run('내일 아홉시에 건강강좌 안내 방송 예약해줘', '건강강좌 안내', '건강강좌를 시작합니다.',
    '09:00', tomorrow, new Date().toISOString()).lastInsertRowid

  // 사람이 시각을 오전→오후로 고쳐 승인한다
  drafts.approveDraft(id, { scheduled_time: '21:00' })

  const rows = getDB().prepare(SAMPLE_SQL).all(50)
  assert.equal(rows.length, 1)
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.equal(stats.samples, 1)
  assert.equal(stats.ampm.count, 1)
  assert.deepEqual(stats.fieldEdits.map(f => f.field), ['scheduled_time'])

  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('사실8 — 서술어로 끝나는 토막은 후보가 아니다', () => {
  const rows = many(2, {
    raw_input: '두시에 건강강좌 방송해줘 알려줘 끝났다고 시작한다고 어르신들 광고 편지',
  })
  const stats = computeNlStats(rows, { minSamples: 1 })
  const words = stats.unknownWords.map(w => w.word)
  for (const bad of ['방송해줘', '알려줘', '끝났다고', '시작한다고', '두시']) {
    assert.ok(!words.includes(bad), `서술어·시각이 후보에 올랐다: ${bad}`)
  }
  // 두 글자 명사는 '고·서·지'로 끝나도 남는다 — 광고·편지·문서까지 버리면 너무 많이 버린다
  assert.ok(words.includes('광고') && words.includes('편지'), '두 글자 명사까지 버렸다')
  // 복수 접미사는 뗀다 — '어르신'과 '어르신들'이 갈리면 둘 다 후보에 못 오른다
  assert.ok(words.includes('어르신'), "'들'을 안 뗐다")
  assert.ok(!words.includes('어르신들'), "'어르신들'이 따로 세어졌다")
})

test('사실9 — 유형까지 고친 낱말이 위로 온다', () => {
  const rows = [
    // 자주 나오지만 유형은 한 번도 안 고친 말(방송 주제)
    ...many(4, { raw_input: '건강강좌 안내 부탁합니다' }),
    // 덜 나오지만 나올 때마다 사람이 유형을 고친 말(동의어 후보)
    ...many(2, {
      raw_input: '화면으로 보여드려',
      broadcast_type: 'video', edited_fields: ['broadcast_type'],
      approved: { broadcast_type: 'youtube-tv' },
    }),
  ]
  const stats = computeNlStats(rows, { minSamples: 1 })
  assert.equal(stats.unknownWords[0].word, '화면',
    '빈도만으로 줄 세우면 방송 주제가 동의어 후보를 덮는다')
  assert.equal(stats.unknownWords[0].withTypeEdit, 2)
})

test('사실10 — 표본 질의가 최근 창만 읽는다', () => {
  assert.match(SAMPLE_SQL, /ORDER BY id DESC/, '최근 것부터 읽지 않으면 창이 옛것을 문다')
  assert.match(SAMPLE_SQL, /LIMIT \?/, '창 크기를 부르는 쪽이 정해야 설정으로 조정할 수 있다')
})
