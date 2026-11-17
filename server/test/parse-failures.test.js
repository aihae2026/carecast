// 자연어 예약 파싱 실패 기록 + 성공률.
//
// 왜: 목표가 "성공률 90%"인데 실패가 아무 데도 남지 않았다. AI 경로는 422/500 응답만 하고
// 끝났고, 규칙 파서 경로는 초안 자체를 안 만든다. 남는 게 없으면 무엇이 얼마나 안 되는지
// 알 수 없고, 실패한 원문이 없으니 파서를 고칠 단서도 없다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_parsefail_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const schedulesRoutes = require('../routes/schedules')
const {
  FAILURE_REASONS, QUALITY_REASONS, SOURCES, recordParseFailure, readParseStats,
} = require('../services/parseFailures')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/schedules': schedulesRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function clearDrafts() {
  getDB().prepare('DELETE FROM schedule_drafts').run()
}

test('실패한 문장이 원문 그대로 남는다 — 고칠 단서가 되어야 한다', () => {
  clearDrafts()
  const id = recordParseFailure({
    raw_input: '내일 오후 세시 산책', reason: FAILURE_REASONS.TIME_MISSING, source: SOURCES.RULE,
  })
  assert.ok(id, '기록이 만들어지지 않았다')

  const row = getDB().prepare('SELECT * FROM schedule_drafts WHERE id = ?').get(id)
  assert.equal(row.status, 'failed')
  assert.equal(row.raw_input, '내일 오후 세시 산책')
  assert.equal(row.failure_reason, FAILURE_REASONS.TIME_MISSING)
  assert.equal(row.source, SOURCES.RULE)
})

test('실패 기록은 승인 대기 목록을 오염시키지 않는다', () => {
  clearDrafts()
  recordParseFailure({
    raw_input: 'x', reason: FAILURE_REASONS.NO_DATETIME, source: SOURCES.AI,
  })
  const pending = getDB().prepare("SELECT * FROM schedule_drafts WHERE status = 'pending'").all()
  assert.equal(pending.length, 0, "failed 행이 pending으로 잡히면 승인 화면에 빈 카드가 뜬다")
})

test('시스템 실패(AI 오류)는 성공률 분모에서 빠진다', () => {
  clearDrafts()
  // 파싱된 것 3건
  const ins = getDB().prepare(`
    INSERT INTO schedule_drafts
      (raw_input, title, content, scheduled_time, repeat_start_date, status, source, created_at)
    VALUES (?, 'T', '', '09:00', '2026-08-28', 'pending', 'ai', '2026-08-28T00:00:00.000Z')
  `)
  for (const t of ['a', 'b', 'c']) ins.run(t)
  // 품질 실패 1건 → 3/4 = 75%
  recordParseFailure({ raw_input: 'd', reason: FAILURE_REASONS.NO_DATETIME, source: SOURCES.AI })

  const before = readParseStats()
  assert.equal(before.successRate, 75, `품질 실패만 셌을 때 75%여야 한다(실제 ${before.successRate})`)

  // AI 서버가 죽어서 실패한 건 파서 탓이 아니다 — 성공률이 흔들리면 안 된다
  recordParseFailure({ raw_input: 'e', reason: FAILURE_REASONS.AI_ERROR, source: SOURCES.AI })
  recordParseFailure({ raw_input: 'f', reason: FAILURE_REASONS.AI_ERROR, source: SOURCES.AI })

  const after = readParseStats()
  assert.equal(after.successRate, 75,
    'AI 장애가 성공률을 끌어내리면 파서를 개선했는지 판단할 수 없다')
  assert.equal(after.systemFailed, 2, '시스템 실패는 따로 보여야 한다')
  assert.equal(after.total, 6)
})

test('시도가 하나도 없으면 성공률은 0%가 아니라 null이다', () => {
  clearDrafts()
  assert.equal(readParseStats().successRate, null,
    '0%로 보이면 "전부 실패했다"로 읽힌다 — 측정 전과 전멸은 다르다')
})

test('경로별로 나눠 볼 수 있다 — 어느 파서가 약한지 알아야 고친다', () => {
  clearDrafts()
  recordParseFailure({ raw_input: 'a', reason: FAILURE_REASONS.TIME_MISSING, source: SOURCES.RULE })
  recordParseFailure({ raw_input: 'b', reason: FAILURE_REASONS.TIME_MISSING, source: SOURCES.RULE })
  recordParseFailure({ raw_input: 'c', reason: FAILURE_REASONS.NO_DATETIME, source: SOURCES.AI })

  const s = readParseStats()
  assert.equal(s.bySource.rule.failed, 2)
  assert.equal(s.bySource.ai.failed, 1)
  assert.equal(s.byReason[FAILURE_REASONS.TIME_MISSING], 2)
})

test('기록이 실패해도 예외를 던지지 않는다 — 로그 때문에 예약 화면이 죽으면 안 된다', () => {
  const brokenDb = {
    prepare() { throw new Error('DB가 죽었다고 가정') },
  }
  let id
  assert.doesNotThrow(() => {
    id = recordParseFailure({ raw_input: 'x', reason: FAILURE_REASONS.AI_ERROR, source: SOURCES.AI }, brokenDb)
  })
  assert.equal(id, null, '실패했으면 null을 돌려줘야 호출부가 구분할 수 있다')
})

test('규칙 파서가 시각을 못 읽으면 응답은 그대로 주면서 기록만 남긴다', async () => {
  clearDrafts()
  // 시각을 아예 말하지 않은 문장 — 파서는 09:00 기본값을 넣고 time_missing으로 알린다.
  // (고유어 숫자 "오후 세시"는 지금은 15:00으로 잘 읽는다 — 예전 빈틈은 메워져 있다.)
  const r = await fetch(app.baseUrl + '/api/schedules/parse-phrase', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '산책 안내 방송' }),
  })
  assert.equal(r.status, 200, '기록 때문에 응답이 달라지면 안 된다 — 사람이 고칠 수 있어야 한다')
  const body = await r.json()
  assert.ok((body.ambiguous || []).includes('time_missing'), '전제가 깨졌다: time_missing이 아니다')

  const failed = getDB().prepare("SELECT * FROM schedule_drafts WHERE status = 'failed'").all()
  assert.equal(failed.length, 1, '규칙 파서 실패가 기록되지 않았다')
  assert.equal(failed[0].source, SOURCES.RULE)
  assert.equal(failed[0].raw_input, '산책 안내 방송')
})

test('제대로 읽힌 문장은 실패로 기록되지 않는다 — 잡음이 섞이면 숫자가 못 쓰게 된다', async () => {
  clearDrafts()
  const r = await fetch(app.baseUrl + '/api/schedules/parse-phrase', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '매일 오후 3시에 산책 안내' }),
  })
  assert.equal(r.status, 200)
  const failed = getDB().prepare("SELECT COUNT(*) AS n FROM schedule_drafts WHERE status = 'failed'").get()
  assert.equal(failed.n, 0, '정상 파싱이 실패로 세어지면 성공률이 실제보다 낮게 나온다')
})

// ── 드리프트 방어 ─────────────────────────────────────────────
test('품질 사유 목록이 실제 사유 목록을 벗어나지 않는다', () => {
  const all = Object.values(FAILURE_REASONS)
  for (const q of QUALITY_REASONS) {
    assert.ok(all.includes(q), `${q}가 FAILURE_REASONS에 없다 — 성공률 계산에서 조용히 빠진다`)
  }
  assert.ok(QUALITY_REASONS.length < all.length, '시스템 실패 사유가 하나는 있어야 구분이 의미가 있다')
})

test('실패한 원문을 최근 것부터 몇 개 돌려준다 — 숫자만으론 고칠 수 없다', () => {
  clearDrafts()
  for (const t of ['첫째', '둘째', '셋째']) {
    recordParseFailure({ raw_input: t, reason: FAILURE_REASONS.TIME_MISSING, source: SOURCES.RULE })
  }
  const s = readParseStats()
  assert.ok(Array.isArray(s.recent), 'recent가 없다 — 화면이 실패 문장을 보여줄 수 없다')
  assert.equal(s.recent[0].raw_input, '셋째', '최근 것이 먼저 와야 한다')
  assert.ok(s.recent.length <= 5, "너무 많이 실으면 화면이 목록으로 변한다")
})

// ── 화면 ↔ 서버 드리프트 방어 ─────────────────────────────────
test('화면의 실패 사유 라벨이 모든 사유를 덮는다', () => {
  // 사유를 새로 추가하고 라벨을 안 만들면, 코칭 브리프에 "no_datetime" 같은 날것이 그대로 뜬다.
  // 에러가 아니라 그냥 못생긴 화면이라 아무도 안 고치고 오래 남는다.
  // 2026-09-05: 이 상수는 파일이 갈리면서 coachingBriefStatus.jsx로 옮겨갔다(순수 이동).
  // 가드도 따라간다 — 옛 파일을 계속 보면 아래 indexOf가 -1이 되어 시끄럽게 죽는다.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'coachingBriefStatus.jsx'), 'utf8')
  const open = src.indexOf('const FAILURE_LABEL = {')
  assert.notEqual(open, -1, 'coachingBriefStatus.jsx에서 FAILURE_LABEL을 찾지 못했다')
  const block = src.slice(open, src.indexOf('}', open))
  for (const reason of Object.values(FAILURE_REASONS)) {
    assert.ok(block.includes(reason + ":"),
      `화면에 '${reason}' 라벨이 없다 — 사유가 날것으로 표시된다`)
  }
})
