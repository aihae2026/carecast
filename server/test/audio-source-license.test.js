// 음원마다 출처와 이용 조건을 남긴다 (사용자 지시 2026-09-21).
//
// *"출처표기에 저작권한에 대해서도 적어서 분쟁안되게 로컬에서 등록해야한다고 적어주고"*
//
// 유튜브를 걷어내면 배경음악은 기관이 직접 받아 올린 파일이 된다(첫 음원은 Pixabay).
// 나중에 「이 음악 어디서 났냐」는 물음에 **파일 하나로 답할 수 있어야** 한다 — 그래서
// 곡마다 출처·주소·이용 조건을 음원 행에 같이 적는다.
//
// 여기서 고정하는 것:
//   1) 배경음악(bgm)은 출처·이용 조건 없이 못 올린다. 막을 때는 **올라온 파일도 지운다**
//   2) 사람 목소리 녹음(안내 등)은 기관이 직접 만든 것이라 비워도 된다
//   3) 주소는 http(s) 만, 글자 수는 상한이 있다
//   4) 올린 뒤에도 고칠 수 있고, 목록에 그대로 나온다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_audiosrc_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { startTestApp }  = require('./helpers/testApp')
const { audioCategoryDir } = require('../domain/audioPaths')
const { 출처읽기, 최대글자 } = require('../domain/audioSource')

let app
const made = []
const 디스크파일들 = (cat) => { try { return new Set(fs.readdirSync(audioCategoryDir(cat))) } catch { return new Set() } }

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/audio': require('../routes/audio') })
})
test.after(async () => {
  if (app) await app.close()
  for (const p of made) { try { fs.unlinkSync(p) } catch { /* 이미 없으면 목표 달성 */ } }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

// ID3 로 시작하면 서버의 내용 검사가 mp3 로 본다(domain/fileKind.js).
// 이 시험 파일만 가진 표식 — 거절 뒤 「우리가 보낸 것」이 남았는지 가려내는 데 쓴다.
const 표식 = Buffer.from(`carecast-test-audiosrc-${process.pid}-${Date.now()}`)
const 가짜mp3 = () => new Blob([Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64), 표식])], { type: 'audio/mpeg' })

async function 올리기(category, fields = {}, name = 'happy-piano.mp3') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', 가짜mp3(), name)       // 글자 칸이 파일보다 **먼저** 와야 multer 가 읽는다
  const r = await fetch(`${app.baseUrl}/api/audio/upload?category=${category}`, { method: 'POST', body: form })
  const body = await r.json().catch(() => null)
  if (r.ok && body?.filename) made.push(path.join(audioCategoryDir(category), body.filename))
  return { status: r.status, body }
}

// 곡 하나를 가리키는 페이지 주소 — 목록 주소(/music/)는 증빙이 못 된다(약관 조사 c7, 2026-10-17).
const PIXABAY = {
  source_name: 'Pixabay',
  source_url: 'https://pixabay.com/music/beats-happy-piano-12345/',
  license_note: 'Pixabay Content License(2024-11-18 판) · 상업적 이용 가능 · 출처 표시 불필요 · 파일 그대로 재배포 금지',
}

test('「Pixabay 로 채우기」 는 주소 칸을 비워 두고 곡 페이지 주소를 안내한다 — 목록 주소는 증빙이 못 된다', () => {
  const F = require('../../src/lib/audioSourceForm.js')
  assert.equal(F.PIXABAY출처.source_url, '', '목록 주소를 미리 넣으면 곡별 증빙이 안 남는다')
  assert.match(F.PIXABAY주소자리, /곡 페이지 주소/)
  assert.match(F.PIXABAY출처.license_note, /2024-11-18/, '약관 판 날짜가 없다')
  assert.match(F.PIXABAY출처.license_note, /그대로 재배포 금지/, 'Standalone 재배포 금지가 빠졌다')
  assert.equal(F.Pixabay주소인가('https://pixabay.com/music/x-1/'), true)
  assert.equal(F.Pixabay주소인가('https://example.com/x'), false)
  assert.equal(F.Pixabay주소인가('https://pixabay.com/music/'), false, '옛 목록 주소를 곡 주소로 보고 남긴다')
  assert.equal(F.Pixabay주소인가('https://pixabay.com/'), false)
  // 버튼을 눌러도 이용 조건 칸은 서버 필수 규칙을 그대로 통과해야 한다(주소는 비워도 된다)
  assert.equal(출처읽기(F.PIXABAY출처, { 필수: true }).ok, true)
})

test('읽기 규칙 — 다듬고, 주소는 http(s) 만, 길이 상한', () => {
  assert.deepEqual(출처읽기({ source_name: '  Pixabay ', source_url: '', license_note: ' 조건 ' }, { 필수: true }),
    { ok: true, 값: { source_name: 'Pixabay', source_url: null, license_note: '조건' } })
  assert.equal(출처읽기({ source_name: 'a', license_note: 'b', source_url: 'javascript:alert(1)' }).ok, false)
  assert.equal(출처읽기({ source_name: 'a', license_note: 'b', source_url: 'ftp://x' }).ok, false)
  assert.equal(출처읽기({ source_name: 'a'.repeat(최대글자 + 1), license_note: 'b' }).ok, false)
  // 필수가 아니면 셋 다 비워도 된다
  assert.deepEqual(출처읽기({}, { 필수: false }), { ok: true, 값: { source_name: null, source_url: null, license_note: null } })
})

test('배경음악은 출처·이용 조건 없이 못 올리고, 막을 때 파일도 지운다', async () => {
  for (const 빠짐 of [{}, { source_name: 'Pixabay' }, { license_note: 'x' }, { source_name: '  ', license_note: 'x' }]) {
    const 전 = 디스크파일들('bgm')
    const r = await 올리기('bgm', 빠짐)
    assert.equal(r.status, 400, `${JSON.stringify(빠짐)} 로 올라갔다`)
    assert.match(r.body?.error ?? '', /출처|이용 조건/, '무엇이 빠졌는지 안 말한다')
    // **우리가 보낸 파일만** 찾는다 — 폴더 전후를 통째로 비교하면 같이 도는 다른 업로드 시험이
    // 파일을 넣고 빼는 것까지 걸려서 흔들렸다(2026-09-21 코드 검수 재현). 표식이 든 새 파일이 없어야 한다.
    const 새것 = [...디스크파일들('bgm')].filter(n => !전.has(n))
    const 남은것 = 새것.filter(n => {
      try { return fs.readFileSync(path.join(audioCategoryDir('bgm'), n)).includes(표식) } catch { return false }
    })
    assert.deepEqual(남은것, [], '거절했는데 보낸 파일이 폴더에 남았다')
  }
  const 행 = getDB().prepare("SELECT COUNT(*) n FROM audio_files WHERE category='bgm'").get().n
  assert.equal(행, 0, '거절했는데 DB 에 행이 생겼다')
})

test('출처·이용 조건을 적으면 올라가고 그대로 저장된다', async () => {
  const r = await 올리기('bgm', PIXABAY)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.source_name, 'Pixabay')
  assert.equal(r.body.source_url, PIXABAY.source_url)
  assert.equal(r.body.license_note, PIXABAY.license_note)
})

test('사람 목소리 녹음은 기관이 만든 것이라 비워도 올라간다', async () => {
  const r = await 올리기('morning-prayer', {}, 'prayer.mp3')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.source_name, null)
})

test('목록에 출처가 나오고, 나중에 고칠 수 있다', async () => {
  const { body: 파일 } = await 올리기('bgm', PIXABAY, 'classical.mp3')
  const 목록 = await (await fetch(`${app.baseUrl}/api/audio?category=bgm`)).json()
  const 행 = 목록.find(x => x.id === 파일.id)
  assert.equal(행.source_name, 'Pixabay')

  const 고침 = await fetch(`${app.baseUrl}/api/audio/${파일.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_name: '직접 구매', license_note: '기관 구매 음원 — 영수증 보관', source_url: '' }),
  })
  assert.equal(고침.status, 200)
  const 뒤 = getDB().prepare('SELECT * FROM audio_files WHERE id=?').get(파일.id)
  assert.equal(뒤.source_name, '직접 구매')
  assert.equal(뒤.source_url, null)
  assert.equal(뒤.original_name, 파일.original_name, '출처만 고쳤는데 이름이 바뀌었다')

  // 배경음악에서 출처를 지우는 것은 막는다 — 올릴 때 막은 것을 고치기로 우회하면 안 된다
  const 지움 = await fetch(`${app.baseUrl}/api/audio/${파일.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_name: '' }),
  })
  assert.equal(지움.status, 400)
  assert.equal(getDB().prepare('SELECT source_name FROM audio_files WHERE id=?').get(파일.id).source_name, '직접 구매')

  // 이름만 고치는 기존 호출은 그대로 돈다
  const 이름 = await fetch(`${app.baseUrl}/api/audio/${파일.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ original_name: '왈츠' }),
  })
  assert.equal(이름.status, 200)
  assert.equal(getDB().prepare('SELECT original_name FROM audio_files WHERE id=?').get(파일.id).original_name, '왈츠')
})
