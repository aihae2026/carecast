// 오픈소스 공개 전 전문가 2차 검토(2026-11-10 반영)를 고정한다.
//
// 항목 번호는 검토 문서(「AI챌린지해_오픈소스_2차 검토 요청서_해뜨는마을」)의 번호다.
// 동작으로 볼 수 있는 것은 함수를 직접 불러 본다(expert-review-1.test.js 와 같은 방식).
'use strict'

const path = require('path')
const os   = require('os')

process.env.CARECAST_DB_PATH = path.join(os.tmpdir(), `carecast_test_expert2_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')

const { detectSensitive } = require('../services/sensitiveInfo')
const { 글가리기, 번호같은덩어리가있나 } = require('../services/promptPrivacy')

// ── 4-1 번호 앞뒤에 다른 숫자가 붙은 경우 ─────────────────────────────────────────
// 숫자 사이 구분자를 통째로 지우면 「010-1234-5678 201호」가 「01012345678201」로 붙어
// 번호 모양이 깨졌다 — 방송 검사·Gemini 가림·잔여 검사가 모두 놓쳤다(전문가 2차 검토 4-1).
const 번호가든글 = [
  '연락처 010-1234-5678 201호',
  '연락처 0 1 0 1 2 3 4 5 6 7 8 201호',
  '201호 010 1234 5678',
  '10시 30분 010-1234-5678 연락',
  '3, 010-1234-5678, 201호',
  '보호자 ０１０－１２３４－５６７８ ２０１호',
  '보호자 ０ １ ０ １ ２ ３ ４ ５ ６ ７ ８ ２０１호',
  '주민번호 900101-1234567 201호',
  '9 0 0 1 0 1 1 2 3 4 5 6 7 201호',
  '201호 ９００１０１ １２３４５６７',
]

for (const 글 of 번호가든글) {
  test(`4-1 방송 검사가 막는다: ${글}`, () => {
    assert.ok(detectSensitive(글).blocked.length > 0, '번호가 방송 검사를 통과했다')
  })
  test(`4-1 Gemini 로 가기 전에 가리거나 보류한다: ${글}`, () => {
    const 가린 = 글가리기(글, new Map()).글
    // 가렸으면 숫자 번호가 남지 않고, 못 가렸으면 보류 그물에 걸려야 한다.
    const 가렸나 = /\[(전화번호|주민등록번호)\]/.test(가린)
    assert.ok(가렸나 || 번호같은덩어리가있나(가린), `원문 번호가 그대로 나간다: ${가린}`)
    if (가렸나 && /호|층/.test(글)) {
      assert.match(가린, /(201|２０１)호|2층/, '번호 옆의 호실·층 숫자까지 지웠다 — 문장이 망가진다')
    }
  })
}

// 「3 010 1234 5678 2」는 앞뒤 숫자까지 이으면 주민번호 모양(30-10-12-3…)이 된다. 덜 가리느니
// 더 가리는 쪽을 고른다 — 문장이 조금 어색해질 뿐 번호는 하나도 안 나간다.
test('4-1 겹치는 번호 후보는 더 넓게 가린다', () => {
  const 가린 = 글가리기('오후 3 010 1234 5678 2층', new Map()).글
  assert.doesNotMatch(가린, /1234|5678/, '번호 일부가 남았다')
})

test('4-1 잔여 검사는 긴 숫자 덩어리의 일부도 본다', () => {
  // 가리기 규칙을 거치지 않은 글이 들어와도(모델 응답 재전송 등) 보류 그물은 따로 잡아야 한다.
  assert.equal(번호같은덩어리가있나('연락처 010-1234-5678 201호'), true)
  assert.equal(번호같은덩어리가있나('0 1 0 1 2 3 4 5 6 7 8 201'), true)
  assert.equal(번호같은덩어리가있나('900101-1234567 201호'), true)
})

// 고치다가 헛경보를 늘리면 일과방송 저장·AI 문구 짓기가 매번 막힌다 — 번호 아닌 숫자는 그대로 둔다.
const 번호없는글 = [
  '2층 201, 202, 203, 204호 어르신',
  '2026-11-10 10:30 점심 식사',
  '2026년 11월 10일 오전 10시 30분',
  '201호 202호 203호 204호',
  '오늘 기온 12도, 습도 45%',
  '1 2 3 4 5 체조 시작',
  '3층 301호 302호 ３０３호',
]
for (const 글 of 번호없는글) {
  test(`4-1 헛경보가 없다: ${글}`, () => {
    assert.equal(detectSensitive(글).blocked.length, 0, '번호가 아닌 숫자를 막았다')
    assert.equal(글가리기(글, new Map()).글.includes('['), false, '번호가 아닌 숫자를 가렸다')
    assert.equal(번호같은덩어리가있나(글), false, '번호가 아닌 숫자로 전송을 보류했다')
  })
}

// ── 5-1 받아쓰기 도중 사람이 고치고 확정한 자막을 덮어쓰지 않는다 ─────────────────────────
// 대기열은 받아쓰기 **시작 전에만** 상태를 보고, 끝나면 다시 보지 않고 STT 초안으로 덮어썼다.
// 그 사이(받아쓰기는 음원 길이의 1/3쯤 걸린다) 사람이 고쳐 「방송에 쓰기」를 누르면 그 수정과
// ready 상태가 사라져 다음 방송에 자막이 안 나왔다(전문가 2차 검토 5-1).
test('5-1 받아쓰기 중에 사람이 저장·확정하면 끝난 받아쓰기는 덮어쓰지 않는다', async () => {
  const { initDB, getDB } = require('../db/schema')
  initDB()
  const db = getDB()
  const captionDraft = require('../services/captionDraft')
  const 이번 = (id) => db.prepare('SELECT * FROM audio_subtitles WHERE audio_file_id = ?').get(id)
  const 사람자막 = { v: 1, src: 'manual', lines: [{ s: 0, e: 2, text: '고친 자막' }] }
  const 받아쓴자막 = { v: 1, src: 'stt', lines: [{ s: 0, e: 2, text: '오타 자막' }] }

  // 사람의 저장은 편집기가 실제로 부르는 PUT 라우트로 한다. 편집기는 정본 초안을 열어 저장할 때 출처를
  // `prefill` 그대로 보내기도 한다 — 그래도 덮어쓰면 안 된다(그래서 출처가 아니라 수정 시각으로 본다).
  const PUT = require('../routes/audio').stack
    .find(l => l.route?.path === '/files/:id/subtitle' && l.route.methods.put).route.stack[0].handle
  const 저장 = (id, body) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, set() { return this },
      json(b) { resolve({ status: this.statusCode, body: b }) } }
    PUT({ params: { id: String(id) }, body, query: {} }, res)
  })

  const 경우들 = []
  for (const 처음 of ['없음', 'prefill 초안']) {
    for (const 사람 of [
      { 이름: '확정(방송에 쓰기)', source: 'manual',  status: 'ready' },
      { 이름: '초안 저장',         source: 'manual',  status: 'draft' },
      { 이름: '정본 초안을 그대로 초안 저장', source: 'prefill', status: 'draft' },
    ]) 경우들.push({ 처음, 사람 })
  }
  for (const { 처음, 사람 } of 경우들) {
    db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
                VALUES ('lunch-prayer', ?, '기도.mp3', 20, ?)`).run(`r2-${처음}-${사람.이름}.mp3`, new Date().toISOString())
    const id = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
    if (처음 === 'prefill 초안') {
      db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
                  VALUES (?, ?, 'prefill', 'draft', ?)`).run(id, JSON.stringify(받아쓴자막), '2026-11-10T00:00:00.000Z')
    }
    captionDraft.__setTranscriberForTests(async () => {
      // 받아쓰는 동안 사람이 편집기에서 고쳐 저장한다
      const r = await 저장(id, { cues: 사람자막, source: 사람.source, status: 사람.status })
      assert.equal(r.status, 200, '시험 준비: 사람의 저장이 실패했다')
      return { cues: 받아쓴자막, sttSec: 1 }
    })
    try {
      await captionDraft.__drainDraftQueueForTests(id)
    } finally { captionDraft.__setTranscriberForTests(null) }
    const 남은 = 이번(id)
    const 이름 = `${처음} → 받아쓰는 중 ${사람.이름}`
    assert.equal(남은.source, 사람.source, `${이름}: 사람이 저장한 자막을 받아쓰기가 덮어썼다`)
    assert.equal(남은.status, 사람.status, `${이름}: 사람이 정한 상태가 바뀌었다`)
    assert.match(남은.cues, /고친 자막/, `${이름}: 고친 글자가 사라졌다`)
  }
})

test('5-1 아무도 안 건드렸으면 받아쓰기 초안은 그대로 들어간다', async () => {
  const { getDB } = require('../db/schema')
  const db = getDB()
  const captionDraft = require('../services/captionDraft')
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('lunch-prayer', 'r2-quiet.mp3', '기도.mp3', 20, ?)`).run(new Date().toISOString())
  const id = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
  captionDraft.__setTranscriberForTests(async () => ({ cues: { v: 1, src: 'stt', lines: [{ s: 0, e: 2, text: '받아쓴 줄' }] }, sttSec: 1 }))
  try { await captionDraft.__drainDraftQueueForTests(id) } finally { captionDraft.__setTranscriberForTests(null) }
  const 남은 = db.prepare('SELECT * FROM audio_subtitles WHERE audio_file_id = ?').get(id)
  assert.equal(남은.source, 'stt')
  assert.equal(남은.status, 'draft', '받아쓰기 결과는 언제나 초안이다')
})

test('5-1 아무도 안 건드린 prefill 초안은 받아쓰기가 시각을 바로잡아 덮어쓴다', async () => {
  const { getDB } = require('../db/schema')
  const db = getDB()
  const captionDraft = require('../services/captionDraft')
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('lunch-prayer', 'r2-prefill.mp3', '기도.mp3', 20, ?)`).run(new Date().toISOString())
  const id = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
  db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
              VALUES (?, ?, 'prefill', 'draft', '2026-11-10T00:00:00.000Z')`)
    .run(id, JSON.stringify({ v: 1, src: 'manual', lines: [{ s: 0, e: 2, text: '정본 어림 타이밍' }] }))
  captionDraft.__setTranscriberForTests(async () => ({ cues: { v: 1, src: 'stt', lines: [{ s: 0.4, e: 2, text: '정본 실제 시각' }] }, sttSec: 1 }))
  try { await captionDraft.__drainDraftQueueForTests(id) } finally { captionDraft.__setTranscriberForTests(null) }
  const 남은 = db.prepare('SELECT * FROM audio_subtitles WHERE audio_file_id = ?').get(id)
  assert.equal(남은.source, 'stt', 'prefill 초안이 어림 타이밍인 채로 굳었다')
  assert.equal(남은.status, 'draft')
})
