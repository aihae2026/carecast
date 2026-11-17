// 2026-09-01. 업로드한 음원·영상의 이름이 "êµ­ë¯¼ì²´ì¡°.mp4"처럼 깨져서 저장되던 것.
//
// 왜 생기나: multipart 헤더의 filename은 브라우저가 UTF-8 바이트로 실어 보내는데,
// multer(busboy)는 기본 defParamCharset이 'latin1'이라 그 바이트를 글자당 하나씩
// Latin-1로 읽어 준다(node_modules/multer/index.js). 그래서 originalname은 언제나
// "UTF-8 바이트를 Latin-1로 읽은 문자열"이고, 서버가 되돌려 읽어야 한다.
//
// 예전 가드는 되돌린 결과에 완성형 한글(가-힣)이 있을 때만 인정했다. 그래서
// 맥·아이폰에서 올린 이름(자모 분리 NFD), 자모만 있는 이름, 일본어, 악센트 라틴은
// 조건에 안 걸려 **깨진 채로 DB에 들어갔고**, 화면·재생목록·방송 로그에 그대로 나온다.
//
// 되돌리기의 판정은 "완성형 한글이 있느냐"가 아니라 **"그 바이트열이 올바른 UTF-8이냐"**다.
// 이 파일이 그 규칙을 고정한다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')
const http = require('http')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_upname_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { repairMojibake } = require('../domain/text')
const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

// 브라우저가 실제로 보내는 모양 — 이름을 UTF-8 바이트로 만들어 Latin-1로 읽은 문자열.
const asMulterGivesIt = (name) => Buffer.from(name, 'utf8').toString('latin1')

let app
const uploaded = []   // 테스트가 실제로 만든 파일 — 끝나고 지운다

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/audio': require('../routes/audio') })
})
test.after(async () => {
  if (app) await app.close()
  for (const p of uploaded) { try { fs.unlinkSync(p) } catch { /* 이미 없으면 목표 달성 */ } }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

// ── 되돌리기 규칙 자체 ────────────────────────────────────────────

test('완성형 한글 이름을 되돌린다', () => {
  assert.equal(repairMojibake(asMulterGivesIt('국민체조.mp4')), '국민체조.mp4')
})

test('맥·아이폰이 보내는 자모 분리(NFD) 이름도 되돌리고 NFC로 모은다', () => {
  // 예전 가드가 놓치던 바로 그 경우 — 되돌린 문자열에 완성형 한글이 하나도 없다.
  const nfd = '동요영상.mp4'.normalize('NFD')
  assert.equal(repairMojibake(asMulterGivesIt(nfd)), '동요영상.mp4')
})

test('자모만 있는 이름도 되돌린다', () => {
  assert.equal(repairMojibake(asMulterGivesIt('ㄱㄴㄷ.mp3')), 'ㄱㄴㄷ.mp3')
})

test('한글이 아니어도 되돌린다 — 일본어·악센트 라틴·이모지', () => {
  assert.equal(repairMojibake(asMulterGivesIt('ラジオ体操.mp4')), 'ラジオ体操.mp4')
  assert.equal(repairMojibake(asMulterGivesIt('café_bgm.mp3')), 'café_bgm.mp3')
  assert.equal(repairMojibake(asMulterGivesIt('🎵신나는노래.mp3')), '🎵신나는노래.mp3')
})

test('두 번 깨진 이름(이미 깨진 이름을 다시 올린 경우)도 되돌린다', () => {
  assert.equal(repairMojibake(asMulterGivesIt(asMulterGivesIt('국민체조.mp4'))), '국민체조.mp4')
})

test('멀쩡한 이름은 건드리지 않는다', () => {
  // Latin-1 범위를 벗어난 글자가 있으면 그건 이미 제대로 읽힌 이름이다.
  assert.equal(repairMojibake('국민체조.mp4'), '국민체조.mp4')
  assert.equal(repairMojibake('[TJ노래방] 과수원길 - 6학년 - TJ Karaoke.mp4'),
                              '[TJ노래방] 과수원길 - 6학년 - TJ Karaoke.mp4')
  assert.equal(repairMojibake('Karaoke.mp4'), 'Karaoke.mp4')
  assert.equal(repairMojibake(''), '')
  assert.equal(repairMojibake(null), null)
})

test('올바른 UTF-8이 아니면 그대로 둔다 — 진짜 Latin-1 이름을 망치지 않는다', () => {
  // 0xE9(é) 뒤에 이어지는 바이트가 UTF-8 규칙에 안 맞는다 → 되돌리면 안 되는 이름이다.
  assert.equal(repairMojibake('caf\u00e9.mp3'), 'caf\u00e9.mp3')
})

// ── 실제 업로드 경로 ─────────────────────────────────────────────

test('업로드한 파일 이름이 DB에 제대로 들어간다 (NFD 포함)', async () => {
  const NAME = '동요영상.mp4'.normalize('NFD')
  const row  = await upload('exercise-video', asMulterGivesIt(NAME))
  uploaded.push(path.join(__dirname, '..', 'public', 'audio', 'exercise-video', row.filename))

  assert.equal(row.original_name, '동요영상.mp4')

  const list = await (await fetch(`${app.baseUrl}/api/audio?category=exercise-video`)).json()
  assert.ok(list.some(f => f.original_name === '동요영상.mp4'),
    `목록에도 제대로 나와야 한다 — 실제: ${JSON.stringify(list.map(f => f.original_name))}`)
})

// multipart 요청을 손으로 만든다 — 브라우저가 하듯 filename을 그대로 헤더에 싣는다.
function upload(category, filename) {
  return new Promise((resolve, reject) => {
    const B = '----carecast-test-boundary'
    const head = Buffer.from(
      `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: video/mp4\r\n\r\n`, 'latin1')
    // **내용이 진짜 그 종류여야 한다**(UX-06, 2026-09-11). 업로드가 이제 확장자가 아니라
    // **내용**으로 종류를 가르므로, `dummy-bytes` 는 "알아볼 수 없는 파일" 로 거절된다.
    // 시험 자료를 진짜 형식으로 맞춘다 — 기준을 낮춘 것이 아니라, **실제 업로드는 유효한
    // 바이트를 갖는다**는 사실에 자료를 맞춘 것이다. 이 검사가 보는 것은 파일 **이름**이다.
    //
    // 카테고리를 보고 고른다. 처음엔 MP3 머리를 넣었다가 *"영상 칸인데 내용이 음원"* 으로
    // 거절됐다 — **새 검사가 제 할 일을 한 것**이고, 그 메시지가 이유를 바로 알려 줬다.
    const 영상칸 = /video/.test(category)
    const 진짜머리 = 영상칸
      ? Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(8)])
      : Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])
    const body = Buffer.concat([head, 진짜머리, Buffer.from(`\r\n--${B}--\r\n`, 'latin1')])
    const url  = new URL(`${app.baseUrl}/api/audio/upload?category=${category}`)
    const req  = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': body.length },
    }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`업로드 실패 ${res.statusCode}: ${d}`))
        resolve(JSON.parse(d))
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
