'use strict'
// UX-06 — **확장자가 아니라 내용으로 가른다** (2026-09-11).
//
// 확장자는 사람이 붙이는 이름표라 틀릴 수 있고, 틀리면 조용히 지나간다.
// `노래.mp3` 라는 이름의 영상 파일이 음원 칸에 들어앉으면 **방송 시각에 소리가 안 난다** —
// 업로드할 때는 아무 말이 없고, 어르신 앞에서 조용한 3분이 지나야 안다.
const test = require('node:test')
const assert = require('node:assert/strict')
const { 파일종류, 받아도되나, 머리크기 } = require('../domain/fileKind')

// 앞머리만 있으면 된다 — 실제 파일을 만들지 않는다(디스크도 외부 도구도 안 쓴다).
const 머리 = (...조각) => {
  const b = Buffer.alloc(머리크기, 0)
  let i = 0
  for (const 조각하나 of 조각) {
    const buf = typeof 조각하나 === 'string' ? Buffer.from(조각하나, 'latin1') : Buffer.from(조각하나)
    buf.copy(b, i); i += buf.length
  }
  return b
}

test('오디오를 알아본다 — MP3(ID3·프레임동기)·WAV', () => {
  assert.equal(파일종류(머리('ID3')), 'audio', 'ID3 태그가 붙은 MP3')
  assert.equal(파일종류(머리([0xFF, 0xFB, 0x90, 0x00])), 'audio', '태그 없는 MP3(프레임 동기)')
  assert.equal(파일종류(머리([0xFF, 0xF1, 0x00, 0x00])), 'audio', 'ADTS 계열도 동기 비트로 잡힌다')
  assert.equal(파일종류(머리('RIFF', [0, 0, 0, 0], 'WAVE')), 'audio', 'WAV')
})

test('영상을 알아본다 — MP4/MOV·WebM·AVI', () => {
  assert.equal(파일종류(머리([0, 0, 0, 0x18], 'ftypmp42')), 'video', 'MP4')
  assert.equal(파일종류(머리([0, 0, 0, 0x14], 'ftypqt  ')), 'video', 'MOV(QuickTime)')
  assert.equal(파일종류(머리([0x1A, 0x45, 0xDF, 0xA3])), 'video', 'WebM/Matroska')
  assert.equal(파일종류(머리('RIFF', [0, 0, 0, 0], 'AVI ')), 'video', 'AVI')
})

test('**RIFF 는 WAV 와 AVI 가 앞 4바이트가 같다** — 8번째부터 봐야 갈린다', () => {
  // 앞 4바이트만 보면 AVI 를 음원으로 받는다. 그 파일은 방송에서 소리가 안 난다.
  assert.notEqual(파일종류(머리('RIFF', [0, 0, 0, 0], 'AVI ')), 'audio',
    'AVI 를 오디오로 봤다 — 음원 칸에 들어앉으면 방송이 조용하다')
})

test('모르면 null 이다 — "아마 오디오겠지" 로 통과시키지 않는다', () => {
  assert.equal(파일종류(머리('%PDF-1.7')), null, 'PDF')
  assert.equal(파일종류(머리([0x50, 0x4B, 0x03, 0x04])), null, 'ZIP')
  assert.equal(파일종류(머리('그냥 글자입니다')), null, '텍스트')
  assert.equal(파일종류(Buffer.alloc(4)), null, '너무 짧으면 판단하지 않는다')
  assert.equal(파일종류(null), null)
  assert.equal(파일종류(undefined), null)
})

test('카테고리와 내용이 어긋나면 받지 않는다 — 이유를 사람 말로 준다', () => {
  const 영상내용 = 머리([0, 0, 0, 0x18], 'ftypmp42')
  const r = 받아도되나('audio', 영상내용)
  assert.equal(r.ok, false, '음원 칸에 영상이 들어갔다')
  assert.match(r.이유, /영상/, '무엇이 들어왔는지 안 알려준다')
  assert.match(r.이유, /내용/, '왜 막혔는지(이름이 아니라 내용) 안 알려준다')

  const r2 = 받아도되나('video', 머리('ID3'))
  assert.equal(r2.ok, false, '영상 칸에 음원이 들어갔다')
  assert.match(r2.이유, /음원/)
})

test('맞으면 받는다 — 멀쩡한 업로드를 막으면 그게 더 나쁘다', () => {
  assert.deepEqual(받아도되나('audio', 머리('ID3')), { ok: true })
  assert.deepEqual(받아도되나('audio', 머리('RIFF', [0, 0, 0, 0], 'WAVE')), { ok: true })
  assert.deepEqual(받아도되나('video', 머리([0, 0, 0, 0x18], 'ftypisom')), { ok: true })
  assert.deepEqual(받아도되나('video', 머리([0x1A, 0x45, 0xDF, 0xA3])), { ok: true })
})

test('모르는 내용도 안 받는다 — 여기서 통과시키면 확장자만 보던 때로 되돌아간다', () => {
  const r = 받아도되나('audio', 머리('%PDF-1.7'))
  assert.equal(r.ok, false)
  assert.match(r.이유, /알아볼 수 없습니다/)
  // 무엇을 올릴 수 있는지 알려준다 — 막기만 하면 사람은 같은 파일을 또 올린다.
  assert.match(r.이유, /MP3/)
  assert.match(r.이유, /MP4/)
})

// ── 배선 — 모듈만 있고 아무도 안 쓰면 아무것도 안 고친 것이다 ──────────────
test('업로드 경로가 이 판정을 실제로 쓴다', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'audio.js'), 'utf8')

  // 긍정 앵커 — 업로드 라우트가 이 파일에 있다(없으면 아래 검사가 헛돈다)
  assert.match(src, /router\.post\('\/upload'/, '업로드 라우트를 못 찾았다 — 이 가드를 옮길 것')

  assert.match(src, /받아도되나\(/, '내용 판정을 안 부른다 — 확장자만 보던 때와 같다')
  assert.match(src, /VIDEO_CATS\.has\(cat\) \? 'video' : 'audio'/,
    '카테고리를 종류로 안 옮긴다 — 영상 칸에 음원이 들어가도 모른다')
  // 안 맞으면 **지운다.** 안 지우면 DB 에 없는 파일이 폴더에 쌓인다.
  assert.match(src, /unlinkSync\(req\.file\.path\)/, '거절한 파일을 안 지운다 — 고아 파일이 쌓인다')
})

// ── 화면이 진행·성공·실패·재시도를 다 보여준다 (UX-06 ②, 2026-09-11) ────────
test('업로드 화면이 진행률·성공·재시도를 보여준다', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const ROOT = path.join(__dirname, '..', '..')
  const mm = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/MusicManagement.jsx'), 'utf8')
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')

  // 진행률 — `fetch` 는 업로드 진행을 안 준다. XHR 로 바꿨는지 본다.
  assert.match(api, /new XMLHttpRequest\(\)/,
    'fetch 로는 업로드 진행률을 못 준다 — 500MB 영상에서 화면이 멈춘 것처럼 보이고, 사람이 다시 눌러 중복 업로드가 난다')
  assert.match(api, /xhr\.upload\.onprogress/, '진행 이벤트를 안 듣는다')
  assert.match(api, /e\.lengthComputable/, '전체 크기를 모를 때도 숫자를 지어낸다')
  // 뒤에 출처·이용 조건 인자가 더 붙을 수 있다(2026-09-21) — 보는 것은 진행률을 넘기느냐다.
  assert.match(mm, /uploadAudioFile\(activeTab, file, currentFolderId, setUploadPct[,)]/,
    '화면이 진행률을 안 받는다')

  // 성공·재시도
  assert.match(mm, /setUploadOk\(/, '성공을 안 알린다 — 올라갔는지 목록을 눈으로 뒤져야 한다')
  assert.match(mm, /setFailedFile\(file\)/, '실패한 파일을 안 들고 있다 — 재시도를 누를 수가 없다')
  assert.match(mm, /다시 시도/, '재시도 버튼이 없다')

  // **내용이 안 맞아 막힌 것은 다시 눌러도 같은 결과** — 그때는 재시도를 안 보여준다.
  assert.match(mm, /!\/내용\/\.test\(uploadError\)/,
    '내용 불일치에도 재시도를 보여준다 — 눌러도 똑같이 막히고, 고쳐야 할 것은 파일이다')

  // 끊김을 조용히 성공으로 두지 않는다
  assert.match(api, /xhr\.onerror/, '연결이 끊겨도 아무 말이 없다')
})
