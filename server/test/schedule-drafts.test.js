// AI가 자연어에서 뽑아낸 방송 예약 초안(schedule_drafts)은 사람이 승인하기 전까지
// 실제 방송 스케줄러가 읽는 schedules 테이블에 절대 들어가지 않아야 한다.
// 승인해야만 schedules에 반영되고, 반려하면 상태만 바뀌고 schedules는 그대로여야 한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_scheduledrafts_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { insertDraft, approveDraft, rejectDraft, listDrafts } = require('../routes/scheduleDrafts')
const { todayStr } = require('../services/repeatSchedule')

// 날짜를 고정 문자열로 쓰면 그날이 지나는 순간 전부 "지난 날짜"가 되어 CC-028 가드에 걸린다.
// 오늘·내일을 그때그때 계산한다.
const DAY1 = todayStr()
const DAY2 = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return todayStr(d) })()

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function schedulesCount() {
  return getDB().prepare('SELECT COUNT(*) AS n FROM schedules').get().n
}

test('초안을 만들어도 schedules에는 아무것도 안 생긴다', () => {
  const before = schedulesCount()
  const draft = insertDraft({
    raw_input: '8월 28일 오후 두시에 프로그램 안내 방송 예약해줘',
    title: '프로그램 안내', content: '프로그램 안내 방송입니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
  })
  assert.equal(draft.status, 'pending')
  assert.equal(schedulesCount(), before, 'pending 상태에서는 schedules가 늘어나면 안 된다')
})

test('승인하면 정확히 그 필드로 schedules에 생기고 draft는 approved로 바뀐다', () => {
  const draft = insertDraft({
    raw_input: '8월 28일 오후 두시에 프로그램 안내 방송 예약해줘',
    title: '프로그램 안내', content: '프로그램 안내 방송입니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
  })
  const before = schedulesCount()
  const result = approveDraft(draft.id, {})
  assert.equal(schedulesCount(), before + 1)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(result.scheduleId)
  assert.equal(row.title, '프로그램 안내')
  assert.equal(row.scheduled_time, '14:00')
  assert.equal(row.repeat_start_date, DAY1)
  const updated = getDB().prepare('SELECT status, resolved_at FROM schedule_drafts WHERE id = ?').get(draft.id)
  assert.equal(updated.status, 'approved')
  assert.ok(updated.resolved_at)
})

test('승인 시 필드를 덮어쓸 수 있다(사람이 수정 후 승인)', () => {
  const draft = insertDraft({
    raw_input: '내일 아침 안내방송', title: '안내', content: '내용',
    scheduled_time: '09:00', repeat_start_date: DAY1,
  })
  const result = approveDraft(draft.id, { title: '수정된 제목', scheduled_time: '10:30' })
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(result.scheduleId)
  assert.equal(row.title, '수정된 제목')
  assert.equal(row.scheduled_time, '10:30')
})

test('반려하면 schedules는 그대로고 status만 rejected가 된다', () => {
  const draft = insertDraft({
    raw_input: '테스트', title: '제목', content: '내용',
    scheduled_time: '09:00', repeat_start_date: DAY1,
  })
  const before = schedulesCount()
  rejectDraft(draft.id)
  assert.equal(schedulesCount(), before)
  const row = getDB().prepare('SELECT status FROM schedule_drafts WHERE id = ?').get(draft.id)
  assert.equal(row.status, 'rejected')
})

test('이미 처리된 초안은 다시 승인할 수 없다', () => {
  const draft = insertDraft({
    raw_input: '테스트', title: '제목', content: '내용',
    scheduled_time: '09:00', repeat_start_date: DAY1,
  })
  approveDraft(draft.id, {})
  assert.throws(() => approveDraft(draft.id, {}), /이미 처리/)
})

test('listDrafts(pending)은 대기 중인 것만 돌려준다', () => {
  const a = insertDraft({ raw_input: 'a', title: 'A', content: 'a', scheduled_time: '09:00', repeat_start_date: DAY1 })
  const b = insertDraft({ raw_input: 'b', title: 'B', content: 'b', scheduled_time: '09:00', repeat_start_date: DAY1 })
  rejectDraft(b.id)
  const pending = listDrafts('pending')
  assert.ok(pending.some(d => d.id === a.id))
  assert.ok(!pending.some(d => d.id === b.id))
})

// ── 방송 유형(ontology.js) ────────────────────────────────────
// 예전엔 approveDraft가 broadcast_type을 'text'로 고정해서, AI가 차임벨 요청을 읽어도
// 승인하면 TTS 방송이 됐다. 이제 초안이 읽은 유형을 그대로 넘긴다.
test('초안의 방송 유형이 승인 시 schedules에 그대로 넘어간다', () => {
  const draft = insertDraft({
    raw_input: '내일 저녁 6시에 차임벨 울려줘',
    title: '차임벨', content: '',
    scheduled_time: '18:00', repeat_start_date: DAY2,
    broadcast_type: 'chime',
  })
  assert.equal(draft.broadcast_type, 'chime')
  const { scheduleId } = approveDraft(draft.id, {})
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.broadcast_type, 'chime', '승인해도 TTS로 바뀌면 차임벨이 울리지 않는다')
})

test('유형을 지정하지 않은 초안은 지금까지처럼 TTS(text)다', () => {
  const draft = insertDraft({
    raw_input: '8월 28일 오후 두시에 프로그램 안내',
    title: '프로그램 안내', content: '프로그램 안내 방송입니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
  })
  assert.equal(draft.broadcast_type, 'text')
  const { scheduleId } = approveDraft(draft.id, {})
  assert.equal(getDB().prepare('SELECT broadcast_type FROM schedules WHERE id = ?').get(scheduleId).broadcast_type, 'text')
})

test('파일을 골라야 하는 유형도 초안으로 남는다 — 파일은 승인할 때 고른다', () => {
  // 예전엔 승인 화면에 파일 선택기가 없어서 초안 단계에서 text로 되돌렸다(B3 이전).
  // 이제 선택기가 있으므로 유형을 유지한다 — 되돌리면 사람이 무엇을 요청했는지 사라진다.
  // 파일 없이 승인하려 하면 approveDraft가 막는다(아래 테스트).
  for (const type of ['audio', 'video', 'flow']) {
    const draft = insertDraft({
      raw_input: '테스트', title: '테스트', content: '내용',
      scheduled_time: '10:00', repeat_start_date: DAY1,
      broadcast_type: type,
    })
    assert.equal(draft.broadcast_type, type, `${type}은 그대로 남아야 한다`)
  }
})

test('모델이 지어낸 유형은 여전히 TTS로 되돌린다 — 출력은 믿지 않는다', () => {
  for (const type of ['tts', '아무거나', null, 'AUDIO']) {
    const draft = insertDraft({
      raw_input: '테스트', title: '테스트', content: '내용',
      scheduled_time: '10:00', repeat_start_date: DAY1,
      broadcast_type: type,
    })
    assert.equal(draft.broadcast_type, 'text', `${type}은 목록에 없으므로 text여야 한다`)
  }
})

test('승인 화면에서 사람이 유형을 고치면 그 값이 우선한다', () => {
  const draft = insertDraft({
    raw_input: '내일 저녁 6시에 차임벨', title: '차임벨', content: '',
    scheduled_time: '18:00', repeat_start_date: DAY2,
    broadcast_type: 'chime',
  })
  const { scheduleId } = approveDraft(draft.id, { broadcast_type: 'text', content: '저녁 식사 안내입니다.' })
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.broadcast_type, 'text')
  assert.equal(row.content, '저녁 식사 안내입니다.')
})

test('파일 없이 음원·영상 예약을 확정하려 하면 거부한다', () => {
  // 이 경로는 POST /api/schedules의 검증을 거치지 않고 insertSchedule을 직접 부른다.
  // 여기서 새면 파일 없는 예약이 생겨 그 시각에 아무 소리도 안 난다(조용한 실패).
  const draft = insertDraft({
    raw_input: '테스트', title: '테스트', content: '내용',
    scheduled_time: '10:00', repeat_start_date: DAY1,
  })
  assert.throws(() => approveDraft(draft.id, { broadcast_type: 'audio' }), /재생할 파일/)
  assert.throws(() => approveDraft(draft.id, { broadcast_type: 'flow' }), /흐름/)
  // 거부됐으면 초안은 아직 pending이어야 한다(반쯤 처리된 상태가 남으면 안 된다)
  assert.equal(getDB().prepare('SELECT status FROM schedule_drafts WHERE id = ?').get(draft.id).status, 'pending')
})

test('파일을 고르면 음원 예약이 확정된다 — 선택기가 생긴 이유', () => {
  const db = getDB()
  db.prepare(`
    INSERT INTO audio_files (category, filename, original_name, duration)
    VALUES ('bgm', 'b3.mp3', 'B3 테스트 음원', 5)
  `).run()
  const fileId = db.prepare("SELECT id FROM audio_files WHERE filename = 'b3.mp3'").get().id

  const draft = insertDraft({
    raw_input: '테스트', title: '음원 예약', content: '',
    scheduled_time: '10:30', repeat_start_date: DAY1,
    broadcast_type: 'audio',
  })
  const { scheduleId } = approveDraft(draft.id, { broadcast_type: 'audio', audio_file_id: fileId })
  const row = db.prepare('SELECT broadcast_type, audio_file_id FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.broadcast_type, 'audio')
  assert.equal(row.audio_file_id, fileId, '고른 파일이 예약에 안 실리면 그 시각에 무음이다')
})

test('알 수 없는 유형을 보내면 거부한다', () => {
  const draft = insertDraft({
    raw_input: '테스트', title: '테스트', content: '내용',
    scheduled_time: '10:00', repeat_start_date: DAY1,
  })
  assert.throws(() => approveDraft(draft.id, { broadcast_type: '아무거나' }), /알 수 없는/)
})

// ── 볼륨 (2026-08-28, A3) ─────────────────────────────────────
// 규칙 파서는 볼륨을 읽는데 AI 파서는 담을 자리가 없어서, 같은 문장을 어느 화면에 넣었느냐에
// 따라 결과가 달랐다. 볼륨은 Gemini가 아니라 같은 사전(ontology.detectVolume)으로 읽는다.
test('초안의 볼륨이 승인 시 schedules에 그대로 넘어간다', () => {
  const draft = insertDraft({
    raw_input: '오후 2시 안내, 볼륨은 잔잔하게', title: '안내', content: '안내드립니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
    bgm_volume: 30,
  })
  assert.equal(draft.bgm_volume, 30)
  assert.equal(draft.main_volume, null)
  const { scheduleId } = approveDraft(draft.id, {})
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.bgm_volume, 30)
  assert.equal(row.main_volume, null)
})

test('볼륨을 말하지 않은 초안은 NULL로 남아 시스템 기본값을 따른다', () => {
  const draft = insertDraft({
    raw_input: '오후 2시 안내', title: '안내', content: '안내드립니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
  })
  assert.equal(draft.bgm_volume, null)
  const { scheduleId } = approveDraft(draft.id, {})
  const row = getDB().prepare('SELECT main_volume, bgm_volume FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.main_volume, null)
  assert.equal(row.bgm_volume, null)
})

test('0(무음)은 유효한 값이라 NULL로 지워지지 않는다', () => {
  const draft = insertDraft({
    raw_input: '테스트', title: '테스트', content: '내용',
    scheduled_time: '10:00', repeat_start_date: DAY1,
    main_volume: 0,
  })
  assert.equal(draft.main_volume, 0)
})

test('이상한 볼륨 값은 NULL로 떨어뜨린다', () => {
  for (const bad of [{}, [], 'abc', NaN]) {
    const draft = insertDraft({
      raw_input: '테스트', title: '테스트', content: '내용',
      scheduled_time: '10:00', repeat_start_date: DAY1,
      bgm_volume: bad,
    })
    assert.equal(draft.bgm_volume, null, `${JSON.stringify(bad)}은 NULL이어야 한다`)
  }
})

test('승인 화면에서 사람이 볼륨을 고치면 그 값이 우선한다', () => {
  const draft = insertDraft({
    raw_input: '오후 2시 안내, 볼륨은 잔잔하게', title: '안내', content: '안내드립니다.',
    scheduled_time: '14:00', repeat_start_date: DAY1,
    bgm_volume: 30,
  })
  const { scheduleId } = approveDraft(draft.id, { bgm_volume: 55 })
  assert.equal(getDB().prepare('SELECT bgm_volume FROM schedules WHERE id = ?').get(scheduleId).bgm_volume, 55)
})

test('두 경로가 같은 사전을 쓰므로 같은 문장은 같은 볼륨이 된다', () => {
  // 규칙 파서(QuickSchedulePhrase)와 AI 파서(TTSBroadcast)가 갈리면 안 된다
  const { detectVolume } = require('../domain/ontology')
  const { readVolumeLevels } = require('../domain/volume')
  const { parseSchedulePhrase } = require('../services/schedulePhrase')
  const levels = readVolumeLevels(getDB())
  const text = '오후 2시 안내, 볼륨은 잔잔하게'

  const rule = parseSchedulePhrase(text, new Date(2026, 7, 27), { volumeLevels: levels })
  const ai   = detectVolume(text, levels)
  assert.equal(rule.bgm_volume, ai.value)
})

// ── AI 소유 표시 ──────────────────────────────────────────────
// 승인으로 만들어진 예약도 "아까 등록한 거 취소" 목록에 떠야 한다. 여기서 표시가 빠지면
// 그 예약만 취소 목록에서 조용히 사라져서, 사람이 관리자 화면을 뒤져 직접 지워야 한다.
test('승인으로 만들어진 예약은 AI가 만든 것으로 표시된다', () => {
  const { MANAGED_BY_AI } = require('../services/scheduleStore')
  const draft = insertDraft({
    raw_input: '내일 세시에 산책 안내 방송',
    title: '산책 안내', content: '산책 시간입니다.',
    scheduled_time: '15:00', repeat_start_date: DAY2,
  })
  const { scheduleId } = approveDraft(draft.id, {})
  const row = getDB().prepare('SELECT managed_by FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.managed_by, MANAGED_BY_AI,
    '표시가 없으면 이 예약은 취소 목록에 영원히 안 나온다')
})
