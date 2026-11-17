// 음원 자막 저장·조회 (배리어프리 2단계, 2026-09-04).
//
// 자막은 틀려도 소리는 그대로 나간다 — 그래서 조용히 망가진다. 여기서 잠그는 것 다섯:
//  1. 없는 자막은 오류가 아니다(200에 null). 자막 없는 음원이 대부분이다.
//  2. **기본은 초안이다.** 받아쓰기·AI가 만든 것을 사람 확인 없이 방송에 내보내지 않는다
//     (CLAUDE.md 검토 게이트). 잘못 들은 자막이 홀에 그대로 뜨는 것이 가장 나쁜 결과다.
//  3. 시간이 거꾸로 가거나 빈 자막은 400으로 막는다 — 화면에서 조용히 튀기 전에.
//  4. 다시 저장하면 덮어쓴다(음원 하나에 자막 하나).
//  5. 음원을 지우면 자막도 같이 지워진다. node:sqlite는 외래키가 꺼져 있어 cascade가 안 걸리는데,
//     남겨 두면 나중에 같은 id를 받은 새 파일에 **엉뚱한 자막이 딸려 나온다.**
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_subtitle_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')

// 라우터를 통째로 띄우지 않고 핸들러만 부른다 — 이 저장소에는 supertest가 없고,
// 새 테스트 하네스를 들이지 않는 것이 회귀 규칙이다(tests/regression/README.md).
const router = require('../routes/audio')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

function call(handler, { params = {}, body = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      set(k, v) { this.headers[k] = v; return this },
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }) },
    }
    handler({ params, body, query }, res)
  })
}

const GET    = findRoute('get',    '/files/:id/subtitle')
const PUT    = findRoute('put',    '/files/:id/subtitle')
const DELSUB = findRoute('delete', '/files/:id/subtitle')
const DELFILE = findRoute('delete', '/:id')

// 사람이 손으로 찍었을 법한 자막 두 줄.
const CUES = {
  v: 1, src: 'manual',
  lines: [
    { s: 0.2, e: 2.4, text: '식사 안내 드리겠습니다.' },
    { s: 2.9, e: 5.1, text: '오늘도 정성껏 마련된' },
  ],
}

let audioId
test.before(() => {
  initDB()
  const db = getDB()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('lunch-prayer', '1-abc.mp3', '낮 안내.mp3', 31, ?)`).run(new Date().toISOString())
  audioId = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('자막이 없으면 오류가 아니라 null이다 — 자막 없는 음원이 대부분이다', async () => {
  const r = await call(GET, { params: { id: String(audioId) } })
  assert.equal(r.status, 200)
  assert.equal(r.body.subtitle, null)
  // 고친 자막이 다음 방송에 바로 나가야 한다 — 옛 응답을 어디서도 다시 쓰지 않게(2026-11-01 현장 보고)
  assert.equal(r.headers['Cache-Control'], 'no-store')
})

test('저장하면 초안으로 들어간다 — status를 안 주면 방송에 나가지 않는다', async () => {
  const r = await call(PUT, { params: { id: String(audioId) }, body: { cues: CUES, source: 'stt' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'draft', '받아쓰기 결과가 사람 확인 없이 방송에 나갈 뻔했다')
  assert.equal(r.body.lines, 2)

  const got = await call(GET, { params: { id: String(audioId) } })
  assert.equal(got.body.subtitle.status, 'draft')
  assert.equal(got.body.subtitle.source, 'stt')
  assert.equal(got.body.subtitle.cues.lines[0].text, '식사 안내 드리겠습니다.')
})

test('사람이 확인하면 ready로 올라간다', async () => {
  const r = await call(PUT, { params: { id: String(audioId) }, body: { cues: CUES, status: 'ready' } })
  assert.equal(r.body.status, 'ready')
  const got = await call(GET, { params: { id: String(audioId) } })
  assert.equal(got.body.subtitle.status, 'ready')
  assert.equal(got.body.subtitle.source, 'manual', 'source를 안 주면 사람이 만든 것으로 본다')
})

test('다시 저장하면 덮어쓴다 — 음원 하나에 자막 하나다', async () => {
  const 한줄 = { v: 1, src: 'manual', lines: [{ s: 0, e: 1, text: '감사합니다.' }] }
  await call(PUT, { params: { id: String(audioId) }, body: { cues: 한줄, status: 'ready' } })
  const got = await call(GET, { params: { id: String(audioId) } })
  assert.equal(got.body.subtitle.cues.lines.length, 1)
  assert.equal(got.body.subtitle.cues.lines[0].text, '감사합니다.')
})

test('망가진 자막은 400으로 막는다 — 화면에서 조용히 튀기 전에', async () => {
  for (const [무엇, cues] of [
    ['빈 것',       null],
    ['줄이 없음',   { v: 1, lines: [] }],
    ['글자가 없음', { v: 1, lines: [{ s: 0, e: 1, text: '   ' }] }],
    ['lines가 배열이 아님', { v: 1, lines: '아님' }],
  ]) {
    const r = await call(PUT, { params: { id: String(audioId) }, body: { cues } })
    assert.equal(r.status, 400, `${무엇}이 통과했다`)
    assert.match(r.body.error, /자막을 저장할 수 없습니다/)
  }
  // 막혔어도 이미 저장된 것은 그대로 있어야 한다
  const got = await call(GET, { params: { id: String(audioId) } })
  assert.equal(got.body.subtitle.cues.lines[0].text, '감사합니다.')
})

test('없는 음원에는 자막을 못 붙인다', async () => {
  const r = await call(PUT, { params: { id: '999999' }, body: { cues: CUES } })
  assert.equal(r.status, 404)
})

test('자막만 지울 수 있다 — 음원은 남는다', async () => {
  await call(DELSUB, { params: { id: String(audioId) } })
  const got = await call(GET, { params: { id: String(audioId) } })
  assert.equal(got.body.subtitle, null)
  assert.ok(getDB().prepare('SELECT id FROM audio_files WHERE id = ?').get(audioId), '음원까지 지워졌다')
})

// 외래키가 꺼져 있어 ON DELETE CASCADE가 안 걸린다. 남겨 두면 나중에 같은 id를 받은 새 파일에
// 엉뚱한 자막이 딸려 나온다 — 소리와 글자가 다른 방송이 되는 것이 여기서 가장 나쁜 결과다.
test('음원을 지우면 자막도 같이 지워진다', async () => {
  await call(PUT, { params: { id: String(audioId) }, body: { cues: CUES, status: 'ready' } })
  assert.ok(getDB().prepare('SELECT 1 FROM audio_subtitles WHERE audio_file_id = ?').get(audioId))

  await call(DELFILE, { params: { id: String(audioId) } })

  const 남은것 = getDB().prepare('SELECT 1 FROM audio_subtitles WHERE audio_file_id = ?').get(audioId)
  assert.equal(남은것, undefined, '음원은 지웠는데 자막이 남았다')
})

// ── 받아쓰기 라우트 ────────────────────────────────────────────
//
// 편집기의 "받아쓰기로 채우기" 버튼이 부르는 길. 여기서 잠그는 것은 **언제 거절하느냐**다 —
// 실제 전사는 파이썬과 모델이 있어야 돌아서 이 테스트가 확인할 수 있는 것이 아니다.

const TRANSCRIBE = findRoute('post', '/files/:id/subtitle/transcribe')
const DEFTEXT    = findRoute('get',  '/files/:id/subtitle/default-text')
const nowPlaying = require('../services/nowPlaying')

test('없는 음원은 404 — 받아쓸 것이 없다', async () => {
  const r = await call(TRANSCRIBE, { params: { id: '999999' } })
  assert.equal(r.status, 404)
})

// 전사는 CPU를 십수 초 문다. 방송이 나가는 중에 돌리면 정시 예산(15초)을 침범한다.
test('방송 중에는 받아쓰기를 거절한다 — 정시 방송이 먼저다', async () => {
  const db = getDB()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('lunch-grace', 'x.mp3', '식사 안내.mp3', 30, ?)`).run(new Date().toISOString())
  const id = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id

  const 원래 = nowPlaying.get()
  try {
    nowPlaying.update({ broadcast: { title: '점심 식사 전 방송' } })
    const r = await call(TRANSCRIBE, { params: { id: String(id) } })
    assert.equal(r.status, 409)
    assert.match(r.body.error, /방송/)
  } finally {
    nowPlaying.update({ broadcast: 원래.broadcast })
  }
})

// 식사 안내 녹음은 그 TTS 문구를 대신하는 것이라 무슨 말이 들어 있는지 안다.
// 편집기가 이 값으로 "기본 문구 불러오기" 버튼을 띄운다.
test('식사 안내 카테고리는 정해진 문구를 돌려준다', async () => {
  const id = getDB().prepare("SELECT id FROM audio_files WHERE category = 'lunch-grace' ORDER BY id DESC LIMIT 1").get().id
  const r = await call(DEFTEXT, { params: { id: String(id) } })
  assert.equal(r.status, 200)
  assert.ok(r.body.text && r.body.text.length > 10, `문구가 비었다: ${JSON.stringify(r.body)}`)
})

test('정본이 없는 카테고리는 null — 버튼을 안 띄운다', async () => {
  const db = getDB()
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('bgm', 'b.mp3', '음악.mp3', 100, ?)`).run(new Date().toISOString())
  const id = db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
  const r = await call(DEFTEXT, { params: { id: String(id) } })
  assert.equal(r.body.text, null)
})

// ── AI 오탈자 고치기 ───────────────────────────────────────────
//
// 받아쓰기는 시각을 잘 잡고 글자를 종종 틀린다(실측: "정성스레"→"정성스래"). 그 글자만
// AI로 고친다. **시각은 손대지 않는다** — 줄 수가 하나라도 달라지면 타이밍이 통째로
// 어긋나므로, 같은 줄 수로 안 돌아오면 거절한다. 실제 호출은 네트워크가 필요해서 여기서는
// 거절 조건만 잠근다.

const POLISH = findRoute('post', '/files/:id/subtitle/polish')

test('다듬을 문구가 없으면 400', async () => {
  for (const body of [{}, { lines: [] }, { lines: ['  ', ''] }, { lines: '아님' }]) {
    const r = await call(POLISH, { params: { id: '1' }, body })
    assert.equal(r.status, 400, `${JSON.stringify(body)}이 통과했다`)
  }
})

test('줄이 너무 많으면 400 — 한 번에 다 보내면 AI가 줄 수를 못 지킨다', async () => {
  const r = await call(POLISH, { params: { id: '1' }, body: { lines: Array(201).fill('가나다') } })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /줄이 너무 많/)
})

// 2026-09-06 규약이 바뀌었다. **키가 없어도 400 이 아니다.**
// 예전에는 400 으로 끝나서 사람이 편집기에서 할 수 있는 일이 없었다. 이제는 원문을 그대로
// 돌려주고 어느 단계가 썼는지 밝힌다(3단 폴백). "조용히 실패하지 않는다"는 그대로다 —
// 조용하지 않게 만드는 것이 상태 코드에서 **via** 로 옮겨 갔을 뿐이다.
test('Gemini 키가 없으면 원문을 그대로 돌려주되 그 사실을 밝힌다 — 조용히 성공으로 위장하지 않는다', async () => {
  const 원본 = ['안녕하세요', '두 번째 줄']
  const r = await call(POLISH, { params: { id: '1' }, body: { lines: 원본 } })
  assert.equal(r.status, 200, '키가 없다고 막다른 길이 되면 안 된다')
  assert.deepEqual(r.body.lines, 원본, '고칠 방법이 없는데 무언가를 바꿨다')
  assert.equal(r.body.changed, 0)
  assert.equal(r.body.via, 'template', 'AI 가 한 것처럼 보인다 — 사람이 다듬어진 줄 알고 넘어간다')
  assert.match(r.body.via_reason, /API/, '왜 못 썼는지가 없다')
})

test('자막 다듬기: 줄 수는 어느 단계에서도 안 바뀐다', async () => {
  const 원본 = ['한 줄', '두 줄', '세 줄']
  const r = await call(POLISH, { params: { id: '1' }, body: { lines: 원본 } })
  assert.equal(r.body.lines.length, 원본.length,
    '줄 수가 달라졌다 — 그 뒤 자막이 통째로 밀린다')
})
