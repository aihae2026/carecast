// 폴더 삭제와 쓰임 조회 — **서버가 막는다**.
//
// 사용자 결정(2026-09-13, 조건 6):
//   *"폴더 삭제는 서버가 파일 유무와 자동순서 참조를 둘 다 확인하고, 하위 폴더는 기존 트리
//     규칙대로 처리해라."*
//
// 규칙 셋:
//   ① 비어 있을 때만 삭제 — **기존 규칙 그대로**(파일도 하위폴더도 없어야 한다)
//   ② 비어 있어도 **자동순서가 쓰고 있으면 막는다**(409) — 어디서 쓰는지 이름을 대고
//   ③ 화면만 막으면 API 로 우회되므로 **서버가** 판정한다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')
const http = require('http')
// 업로드한 파일이 **실제로 어디 놓이는지**를 제품과 같은 곳에서 읽는다. 시험이 경로를 따로
// 계산하면 그 경로가 바뀌는 날 시험만 초록으로 남는다(`domain/audioPaths.js` 머리말).
const { audioCategoryDir } = require('../domain/audioPaths')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_folderusage_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { DEFAULT_STEPS } = require('../services/broadcastSequencer')
const { seedSite, TABS } = require('./helpers/siteFixtures')
const { startTestApp } = require('./helpers/testApp')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({
    '/api/audio': require('../routes/audio'),
    '/api/settings': require('../routes/settings'),
  })
})
test.after(async () => {
  await app?.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function 시설세우기() {
  const db = getDB()
  db.prepare('DELETE FROM audio_playlist').run()
  db.prepare('DELETE FROM audio_files').run()
  db.prepare('DELETE FROM content_folders').run()
  for (const tab of TABS) db.prepare('DELETE FROM settings WHERE key = ?').run(`${tab}_steps`)
  seedSite(db, 'mixed', { DEFAULT_STEPS })
  return db
}
const 폴더id = (name) =>
  getDB().prepare('SELECT id FROM content_folders WHERE name = ?').get(name).id

const 쓰임조회 = () => fetch(`${app.baseUrl}/api/audio/folders/usage`).then(r => r.json())
const 폴더삭제 = (id) => fetch(`${app.baseUrl}/api/audio/folders/${id}`, { method: 'DELETE' })
const 불러오기 = () => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`).then(r => r.json())
const 저장 = (body) => fetch(`${app.baseUrl}/api/settings/broadcast-schedule`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// 그 폴더를 체조 영상 단계에 연결해 둔다(영상 폴더라 매체가 맞는다).
async function 체조에연결(folderId) {
  const 판 = await 불러오기()
  판.exercise.steps.find(s => s.id === 'exercise_video').source =
    { kind: 'folder', category: 'misc-video', folderId }
  const res = await 저장(판)
  assert.equal(res.status, 200, await res.text())
}

test('쓰임 조회: 아무도 연결 안 한 폴더는 0곳, 연결하면 그 단계가 이름과 함께 나온다', async () => {
  시설세우기()
  const id = 폴더id('체조 영상 모음')

  const 처음 = await 쓰임조회()
  assert.equal(처음.folders[id], undefined, '연결한 적 없는데 쓰임이 잡혔다')
  // 기본 연결(카테고리 전체)은 **카테고리 쓰임**으로 잡힌다 — 폴더 쓰임이 아니다
  assert.ok(처음.categories['exercise-video']?.length > 0,
    '기본 연결이 카테고리 쓰임으로 안 잡힌다 — 업로드 화면의 「N곳에서 씀」이 0이 된다')

  await 체조에연결(id)
  const 나중 = await 쓰임조회()
  assert.equal(나중.folders[id]?.length, 1, '연결했는데 폴더 쓰임이 안 잡힌다')
  const 자리 = 나중.folders[id][0]
  assert.equal(자리.tab, 'exercise')
  assert.equal(자리.stepId, 'exercise_video')
  assert.ok(자리.stepLabel, '단계 이름이 비었다 — 사람이 어디를 고칠지 모른다')
  assert.ok(자리.time, '방송 시각이 비었다')
  assert.equal(자리.origin, 'saved', '사람이 저장한 연결인데 기본값으로 표시됐다')
})

test('빈 폴더라도 자동순서가 쓰고 있으면 409 로 막고, 어디서 쓰는지 알려준다', async () => {
  const db = 시설세우기()
  const id = 폴더id('체조 영상 모음')
  await 체조에연결(id)

  // 비운다 — ①(빈 폴더) 조건은 통과하게 만들어 ②(참조)만 남긴다
  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(id)

  const res = await 폴더삭제(id)
  assert.equal(res.status, 409, '쓰고 있는 폴더가 지워졌다')
  const body = await res.json()
  assert.ok(body.error.includes('자동순서'), '사유가 자동순서 때문임을 안 말한다')
  assert.equal(body.usedBy?.length, 1, '어디서 쓰는지 목록이 안 왔다')
  assert.equal(body.usedBy[0].stepId, 'exercise_video')

  // 진짜로 안 지워졌나 — 응답만 믿지 않는다
  assert.ok(db.prepare('SELECT id FROM content_folders WHERE id = ?').get(id), '409 인데 지워졌다')
})

test('연결을 해제하면 그 폴더는 지워진다', async () => {
  const db = 시설세우기()
  const id = 폴더id('체조 영상 모음')
  await 체조에연결(id)
  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(id)
  assert.equal((await 폴더삭제(id)).status, 409)

  // 사람이 그 단계의 연결을 끊는다
  const 판 = await 불러오기()
  판.exercise.steps.find(s => s.id === 'exercise_video').source = null
  assert.equal((await 저장(판)).status, 200)

  const res = await 폴더삭제(id)
  assert.equal(res.status, 200, await res.text())
  assert.equal(db.prepare('SELECT id FROM content_folders WHERE id = ?').get(id), undefined)
})

test('파일이 남아 있으면 기존 규칙대로 400 — 참조 검사 앞에서 막힌다', async () => {
  시설세우기()
  const id = 폴더id('행사 안내')   // 파일 1개 들어 있다
  const res = await 폴더삭제(id)
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.ok(body.error.includes('비워'), '빈 폴더 규칙의 문구가 바뀌었다')
})

test('하위폴더가 있으면 기존 규칙대로 400 — 트리 규칙은 안 바꿨다', async () => {
  const db = 시설세우기()
  const 부모 = 폴더id('아침 음악')     // 하위폴더 '2026년' 을 갖고 있다
  const 자식 = 폴더id('2026년')
  // 부모 자신에는 파일이 있으니 먼저 치워 **하위폴더 조건만** 남긴다
  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(부모)

  const res = await 폴더삭제(부모)
  assert.equal(res.status, 400, '하위폴더가 있는데 지워졌다')
  assert.ok((await res.json()).error.includes('하위폴더'))
  assert.ok(db.prepare('SELECT id FROM content_folders WHERE id = ?').get(자식),
    '부모가 막혔는데 자식이 사라졌다')
})

test('하위 폴더에 걸린 연결도 막는다 — 잎 폴더를 지울 때', async () => {
  const db = 시설세우기()
  const 자식 = 폴더id('2026년')
  // 자식은 음원 폴더라 음원 단계에 연결한다
  const 판 = await 불러오기()
  판.morning.steps.find(s => s.id === 'morning_prayer').source =
    { kind: 'folder', category: 'misc-audio', folderId: 자식 }
  assert.equal((await 저장(판)).status, 200)

  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(자식)
  const res = await 폴더삭제(자식)
  assert.equal(res.status, 409, '하위 폴더에 걸린 연결은 안 세고 있다')
  assert.equal((await res.json()).usedBy[0].stepId, 'morning_prayer')
})

test('꺼 놓은 단계·방송의 연결도 쓰임으로 센다', async () => {
  const db = 시설세우기()
  const id = 폴더id('체조 영상 모음')
  const 판 = await 불러오기()
  const 대상 = 판.exercise.steps.find(s => s.id === 'exercise_video')
  대상.source = { kind: 'folder', category: 'misc-video', folderId: id }
  대상.enabled = false                 // 단계를 끈다
  판.exercise.enabled = false          // 방송도 끈다
  assert.equal((await 저장(판)).status, 200)

  db.prepare('DELETE FROM audio_files WHERE folder_id = ?').run(id)
  const res = await 폴더삭제(id)
  assert.equal(res.status, 409,
    '꺼 놨다고 지워 버리면 나중에 켰을 때 그 단계가 조용히 비어 있다')
  const 자리 = (await res.json()).usedBy[0]
  assert.equal(자리.stepEnabled, false)
  assert.equal(자리.broadcastEnabled, false)
})

// ── 막힌 이유가 **사람에게 읽히는가** (2026-09-13, 브라우저 검증에서 잡은 회귀) ──────────
//
// 서버가 409 와 사용처를 제대로 내보내도 **화면이 그것을 JSON 원문으로 띄우면** 아무 소용이
// 없다. 실제로 그랬다 — `apiDelete` 만 응답 본문을 통째로 `Error` 에 담아 던지고 있어서
// (`apiPost`·`apiPut` 은 진작 `error` 만 꺼내 쓴다) 폴더 삭제가 막힐 때 화면에
// `{"error":"…","usedBy":[{"tab":"morning",…}]}` 가 그대로 떴다.
//
// 소스 대조로 고정한다 — 이 배선은 브라우저를 열어야만 드러나서, 다음 사람이 같은 자리를
// 되돌려도 아무 시험이 안 울린다.
test('화면이 막힌 이유를 문장으로 보여 준다 — JSON 원문이 아니라', () => {
  const path = require('path')
  const fs = require('fs')
  const SRC = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...p), 'utf8')

  const api = SRC('lib', 'api.js')
  const i = api.indexOf('export async function apiDelete(')
  assert.ok(i >= 0, '긍정 앵커 — apiDelete 가 이 파일에 있다')
  const 본문 = api.slice(i, api.indexOf('\n}', i))
  assert.ok(!/throw new Error\(await res\.text\(\)\)/.test(본문),
    'apiDelete 가 응답 본문을 통째로 던진다 — 화면에 JSON 이 그대로 뜬다')
  assert.match(본문, /status: res\.status, data: err/,
    'apiDelete 가 status·data 를 안 얹는다 — 부르는 쪽이 usedBy 를 못 꺼낸다')

  const mm = SRC('components', 'admin', 'sections', 'MusicManagement.jsx')
  const j = mm.indexOf('const handleDeleteFolder')
  assert.ok(j >= 0, '긍정 앵커 — 폴더 삭제 처리기가 이 파일에 있다')
  // **다음 함수 앞까지만** 잘라 본다 — 넉넉히 자르면 옆 함수(`handleRenameFolder`)의
  // `alert` 가 딸려 들어와 엉뚱한 빨간불이 난다(실제로 그랬다).
  const 끝 = mm.indexOf('const handleRenameFolder', j)
  assert.ok(끝 > j, '다음 함수를 못 찾았다 — 자르는 범위를 다시 본다')
  // **주석은 걷고 본다.** 이 자리는 왜 `alert` 를 그만뒀는지 주석으로 적어 두는 곳이라,
  // 글자만 찾으면 그 설명 자체에 걸려 빨간불이 난다(실제로 그랬다).
  const 처리기 = mm.slice(j, 끝).split(/\r?\n/).filter(l => !/^\s*(\/\/|\*)/.test(l)).join(' ')
  assert.match(처리기, /err\?\.data\?\.usedBy/, '사용처를 안 꺼낸다 — 어디서 쓰는지 말 못 한다')
  assert.match(처리기, /setDeleteError\(/, '막힌 이유를 띠로 안 보여 준다')
  assert.ok(!/alert\(/.test(처리기), 'alert 로 띄운다 — 닫으면 사라져서 다시 못 읽는다')
})

// ── **다른 카테고리 폴더에 넣지 못한다** (V③ R19 지적 5, 2026-09-14) ────────────────────
//
// **이동만 검사하고 있었다.** 업로드(와 당시의 링크 등록)는 받은 `folder_id` 를 그대로 `INSERT` 해서,
// 다른 카테고리의 **실존** 폴더 번호를 주면 그 조합이 그대로 저장됐다. 그 파일은
// 카테고리로 폴더를 훑는 목록 어디에도 안 나온다 — **DB 에는 있는데 화면에서 사라진다.**
// 오류도 안 난다. 여기서는 **이동**을, 아래 시험에서 **업로드**를 실제로 불러 본다.
// (링크 등록 길은 2026-09-21 외부 동영상 연동과 함께 걷어냈다.)
test('다른 카테고리의 폴더로는 이동으로 못 넣는다', async () => {
  const db = 시설세우기()

  const 만들기 = (category, name) => fetch(`${app.baseUrl}/api/audio/folders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, name }),
  }).then(r => r.json())

  const 체조폴더 = await 만들기('exercise-video', '체조 모음')
  const 음원폴더 = await 만들기('misc-audio', '자유 음원')
  assert.ok(체조폴더.id && 음원폴더.id, '폴더가 안 만들어졌다 — 이 시험의 전제가 깨졌다')
  const 만든것 = { id: Number(db.prepare(
    "INSERT INTO audio_files (category, filename, original_name, uploaded_at, folder_id) VALUES ('exercise-video', 'e.mp4', '시험 영상', ?, ?)"
  ).run(new Date().toISOString(), 체조폴더.id).lastInsertRowid) }

  // ④ **이동도 같은 판정** — 방금 만든 체조 영상을 음원 폴더로 못 옮긴다
  const 이동 = await fetch(`${app.baseUrl}/api/audio/files/${만든것.id}/move`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_id: 음원폴더.id }),
  })
  assert.equal(이동.status, 400, '이동이 남의 카테고리 폴더를 받았다')

  // ⑤ **막힌 요청이 DB 에 흔적을 남기지 않았다**
  const 잘못들어간것 = db.prepare(
    'SELECT COUNT(*) c FROM audio_files f JOIN content_folders d ON f.folder_id = d.id WHERE f.category != d.category'
  ).get().c
  assert.equal(잘못들어간것, 0, '카테고리가 어긋난 행이 DB 에 남았다')
})

// ── **업로드도 같은 문을 지난다** (V③ R23 지적, 2026-09-14) ─────────────────────────────
//
// 위 시험은 (당시) **링크 등록과 이동만** 불렀다. 검수관이 짚었다 — *"업로드·파일 정리를 검증하지
// 않습니다."* 맞는 말이다. 업로드는 앞의 둘과 **자리가 다르다**: 판정이 나기 전에 파일이 이미
// **디스크에 있다.** 그래서 막는 것만으로는 모자라고 **지워야** 한다 — 안 지우면 DB 에 없는
// 파일이 폴더에 쌓이고 아무도 그것을 못 본다(오류도 안 난다).
//
// 그래서 셋을 다 본다 — **응답**(400) · **DB**(행이 안 늘었다) · **디스크**(파일이 안 남았다).
test('업로드: 남의 카테고리 폴더면 막고, 올라온 파일을 디스크에서 지운다', async () => {
  const db = 시설세우기()

  const 체조폴더 = await 폴더만들기('exercise-video', '체조 모음')
  assert.ok(체조폴더.id, '폴더가 안 만들어졌다 — 이 시험의 전제가 깨졌다')

  const 음원칸 = audioCategoryDir('misc-audio')
  fs.mkdirSync(음원칸, { recursive: true })
  const 처음있던파일 = new Set(fs.readdirSync(음원칸))
  const 처음행수 = () => db.prepare('SELECT COUNT(*) c FROM audio_files').get().c
  const 행수 = 처음행수()

  // ① **남의 카테고리 폴더 — 400**
  const 나쁨 = await 업로드('misc-audio', 체조폴더.id, '안내음원.mp3')
  assert.equal(나쁨.status, 400, '다른 카테고리 폴더로 업로드가 통과했다')
  assert.match(나쁨.body.error || '', /폴더/, '왜 막혔는지를 안 말한다')

  // ② **DB 에 안 들어갔다**
  assert.equal(처음행수(), 행수, '막은 업로드가 DB 에 행을 남겼다')

  // ③ **디스크에도 안 남았다** — 여기가 업로드만의 자리다
  const 남은것 = fs.readdirSync(음원칸).filter(n => !처음있던파일.has(n))
  assert.deepEqual(남은것, [],
    `막은 업로드의 파일이 폴더에 남았다 — DB 에 없는 파일이 쌓인다: ${남은것.join(', ')}`)

  // ④ **제 카테고리면 된다** — 막기만 하는 문이 아니다. 올라간 파일은 실제로 디스크에 있다.
  const 좋음 = await 업로드('exercise-video', 체조폴더.id, '체조영상.mp4')
  assert.equal(좋음.status, 200, `제 카테고리 폴더인데 막혔다: ${JSON.stringify(좋음.body)}`)
  assert.equal(좋음.body.folder_id, 체조폴더.id, '폴더에 안 들어갔다')
  const 파일자리 = path.join(audioCategoryDir('exercise-video'), 좋음.body.filename)
  assert.ok(fs.existsSync(파일자리), '200 을 받았는데 파일이 디스크에 없다')

  // ⑤ 뒷정리는 **제품 경로로** 한다 — 삭제가 파일까지 지우는지도 같이 본다.
  const 지움 = await fetch(`${app.baseUrl}/api/audio/${좋음.body.id}`, { method: 'DELETE' })
  assert.equal(지움.status, 200, '삭제가 안 됐다 — 시험이 파일을 남긴다')
  assert.ok(!fs.existsSync(파일자리), '행은 지웠는데 파일이 남았다')
})

const 폴더만들기 = (category, name) => fetch(`${app.baseUrl}/api/audio/folders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ category, name }),
}).then(r => r.json())

// multipart 요청을 손으로 만든다 — `upload-filename-encoding.test.js` 와 같은 방식이다.
// **내용이 진짜 그 종류여야 한다**(UX-06) — 업로드는 확장자가 아니라 앞머리 바이트로 가른다.
// 다만 폴더 판정은 그 내용 검사보다 **앞**에 있어서, 여기서 걸리면 내용은 볼 일도 없다.
function 업로드(category, folderId, filename) {
  const B = '----carecast-test-boundary'
  const 영상칸 = /video/.test(category)
  const 머리 = 영상칸
    ? Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(8)])
    : Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])
  // 이름은 **브라우저가 보내는 모양**으로 싣는다 — UTF-8 바이트를 Latin-1 글자로 읽은 것
  // (`upload-filename-encoding.test.js` 머리말). 문자열을 그냥 latin1 로 자르면 한글 한 자가
  // 한 바이트로 잘려 제어문자가 섞이고, busboy 가 `Malformed part header` 로 막는다(겪었다).
  const 이름 = Buffer.from(filename, 'utf8').toString('latin1')
  const 앞 = Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${이름}"\r\n` +
    `Content-Type: ${영상칸 ? 'video/mp4' : 'audio/mpeg'}\r\n\r\n`, 'latin1')
  const body = Buffer.concat([앞, 머리, Buffer.from(`\r\n--${B}--\r\n`, 'latin1')])

  const qs = new URLSearchParams({ category })
  if (folderId != null) qs.set('folder_id', String(folderId))
  const url = new URL(`${app.baseUrl}/api/audio/upload?${qs}`)

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': body.length },
    }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(d) } catch { parsed = { raw: d } }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
