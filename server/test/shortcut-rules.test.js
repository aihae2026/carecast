'use strict'
// **ESC · 스페이스바가 무엇을 뜻하는지** (사용자 지시 2026-09-15).
//
// *"카드 나올 때, 취소버튼 누르는거 단축키 ESC로 해줘, 그리고 방송나갈때도 중간에
//   정지하려면 ESC 넣어주면서 정말 정지하시겠습니까? 이거 지금처럼 띄워주고"*
// *"일시정지 버튼도 만들어주고 이건 스페이스바로 단축키할까?"*
//
// 규칙을 화면마다 따로 두면 카드도 열려 있고 방송도 나가는 중일 때 **둘 다 반응한다.**
// 그래서 뜻을 정하는 일은 `src/lib/shortcutRules.js` 한 곳에서 한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 단축키뜻, 글자입력중, 일시정지할수있나 } = require('../../src/lib/shortcutRules.js')

// ── ESC ────────────────────────────────────────────────────────────────────
test('ESC — 카드만 열려 있으면 **카드를 닫는다**', () => {
  assert.equal(단축키뜻({ key: 'Escape', 카드열림: true }), '카드닫기')
})

test('ESC — 방송 중이면 **방송을 멈춘다**', () => {
  assert.equal(단축키뜻({ key: 'Escape', 방송중: true }), '정지')
})

test('**둘 다면 방송이 이긴다** — 소리는 지금 멈춰야 한다', () => {
  // 카드는 마우스로도 닫을 수 있지만, 전관 스피커로 나가는 소리는 급하다.
  assert.equal(단축키뜻({ key: 'Escape', 방송중: true, 카드열림: true }), '정지')
})

test('아무것도 없으면 ESC 는 아무 일도 안 한다', () => {
  assert.equal(단축키뜻({ key: 'Escape' }), null)
})

test('**확인창이 떠 있으면 뒤엣것은 아무것도 안 듣는다**', () => {
  // 「정말 정지하시겠습니까?」에 ESC 를 눌렀는데 카드까지 닫히면, 사람이 무엇을
  // 취소한 것인지 모른다. 확인창을 닫는 일은 확인창 자신이 한다.
  assert.equal(단축키뜻({ key: 'Escape', 확인창: true, 방송중: true, 카드열림: true }), null)
  assert.equal(단축키뜻({ key: ' ', 확인창: true, 방송중: true }), null)
})

// ── 스페이스바 ─────────────────────────────────────────────────────────────
test('스페이스 — 방송 중이면 **일시정지**, 멈춰 있으면 **다시**', () => {
  assert.equal(단축키뜻({ key: ' ', 방송중: true }), '일시정지')
  assert.equal(단축키뜻({ key: ' ', 방송중: true, 일시정지됨: true }), '다시')
})

test('**글자를 적는 중이면 스페이스를 안 뺏는다**', () => {
  // 이 검사가 없으면 방송 문안을 적다가 띄어쓰기를 누를 때마다 음악이 멎는다.
  assert.equal(단축키뜻({ key: ' ', 방송중: true, 글자입력: true }), null)
  // ESC 는 글자를 적는 중에도 듣는다 — 띄어쓰기와 달리 ESC 는 글자가 아니다.
  assert.equal(단축키뜻({ key: 'Escape', 방송중: true, 글자입력: true }), '정지')
})

test('방송이 없으면 스페이스는 아무 일도 안 한다', () => {
  assert.equal(단축키뜻({ key: ' ', 카드열림: true }), null)
})

test('다른 키는 아무 뜻이 없다', () => {
  for (const k of ['Enter', 'a', 'ArrowLeft', 'Tab', 'p']) {
    assert.equal(단축키뜻({ key: k, 방송중: true, 카드열림: true }), null, `${k} 가 뜻을 가졌다`)
  }
})

// ── 글자 입력 판정 ─────────────────────────────────────────────────────────
test('글자 적는 칸을 알아본다', () => {
  assert.equal(글자입력중({ tagName: 'INPUT' }), true)
  assert.equal(글자입력중({ tagName: 'textarea' }), true)
  assert.equal(글자입력중({ tagName: 'SELECT' }), true)
  assert.equal(글자입력중({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(글자입력중({ tagName: 'DIV' }), false)
  assert.equal(글자입력중({ tagName: 'BUTTON' }), false)
  assert.equal(글자입력중(null), false)
})

// ── 무엇을 일시정지할 수 있나 ──────────────────────────────────────────────
// **판단을 고쳤다**(2026-09-15, 사용자 신고 *"자동방송했을 때도 일시정지 안먹고"*).
//
// 처음엔 *"안내 방송은 서버가 밟는 시퀀스라 일시정지할 수 없다"* 고 적고 갈래로
// 막았다. **가른 기준이 틀렸다** — 자동·예약 방송의 소리는 **이 창이** 낸다
// (`useScheduledBroadcast` 의 `new Audio()`, `PROJECT_PROFILE` §1-3). 서버가 단계를
// 지휘할 뿐, 소리 자체는 창 안에 있어서 멈췄다 이을 수 있다.
//
// **진짜 못 멈추는 것은 「즉시 방송」이다** — 그것만 **서버 스피커**로 나간다
// (`routes/tts.js` 의 `audioQueue`). 갈래가 아니라 **누가 소리를 내느냐**가 기준이다.
test('자동·예약 방송은 **일시정지할 수 있다** — 이 창이 소리를 낸다', () => {
  assert.equal(일시정지할수있나('broadcast'), true)
})

test('**즉시 방송만 못 한다** — 서버 스피커가 낸다', () => {
  // 이 창이 가진 소리가 아니라서 멈출 방법이 없다. 단추를 그려 놓고 눌러도 아무 일이
  // 없으면 사람은 그것을 고장으로 읽는다 — 아예 안 그리는 쪽이 정직하다.
  assert.equal(일시정지할수있나('broadcast', true), false)
})

test('BGM·영상은 일시정지할 수 있다 — 이 창이 내는 소리다', () => {
  assert.equal(일시정지할수있나('bgm'), true)
  assert.equal(일시정지할수있나('video'), true)
})

// ── 화면이 이 규칙을 실제로 쓰는지 ─────────────────────────────────────────
test('**재생바가 이 규칙을 쓴다** — 화면이 제 규칙을 따로 적으면 갈린다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/easy/NowPlayingBar.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(코드만.includes('단축키뜻('), '재생바가 공용 규칙을 안 쓴다')
  assert.match(코드만, /addEventListener\('keydown'/, '재생바가 키를 안 듣는다')
  // **확인창은 그대로 둔다**(사용자 지시: *"정말 정지하시겠습니까? 이거 지금처럼 띄워주고"*).
  assert.match(코드만, /confirm\(/, '정지 확인창이 사라졌다 — 실수로 전관 방송이 끊긴다')
})

// ── **멈추라는 말을 들을 사람이 전부 듣는가** ──────────────────────────────
// 사용자 신고 2026-09-15: *"배경음악은 보이지만 일시정지 안먹고."*
//
// 원인은 **한쪽에만 붙인 것**이었다. (당시의) 외부 동영상 재생기가 **둘**이었다 —
// 사람이 직접 튼 것과 **방송이 깐 것**(2026-09-21 둘 다 걷어냈다).
// 처음엔 앞쪽에만 붙였고, 정작 방송 BGM 을 트는 것은 뒤쪽이라 스페이스바가 아무 일도
// 안 했다. **한쪽에만 붙인 가드는 가드가 아니다.**
test('**소리를 내는 자리가 전부 멈추라는 말을 듣는다**', () => {
  const 봐야할곳 = [
    ['로컬 음원',       'src/components/easy/MusicPlayer.jsx',           1],
    ['예약 안내 음성',   'src/hooks/useScheduledBroadcast.js',            1],
  ]
  for (const [이름, rel, 몇번] of 봐야할곳) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const 센것 = (코드만.match(/addEventListener\('carecast:pause-toggle'/g) || []).length
    assert.equal(센것, 몇번,
      `${이름} — 「일시정지」를 듣는 자리가 ${센것}곳이다(${몇번}곳이어야 한다). ` +
      '한 곳이라도 빠지면 그 소리만 안 멈춘다')
  }
})

test('**재생바가 그 말을 쏜다** — 듣는 쪽만 있고 쏘는 쪽이 없으면 소용없다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/easy/NowPlayingBar.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /CustomEvent\('carecast:pause-toggle'/, '재생바가 일시정지를 안 쏜다')
})

test('**즉시 방송도 재생바에 뜬다** — 서버 스피커로 나가는 길이라 안 보였다', () => {
  // 즉시 방송은 `broadcast_started` 를 안 쏘고 `tts_speak` 만 쏜다. 그래서 바가 그
  // 방송을 몰랐다(사용자 신고: *"즉시방송했을 때는 밑에 보이지도 않고"*).
  const src = fs.readFileSync(path.join(ROOT, 'src/components/easy/NowPlayingBar.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /addEventListener\('carecast:broadcast-tts-start'/,
    '즉시 방송이 시작돼도 바가 모른다')
  assert.match(코드만, /서버소리/, '서버 스피커로 나가는 것을 안 가른다 — 못 멈추는데 단추가 뜬다')
})

test('**BGM 정지에도 물어본다** — 키보드로 끄는 길이 생겼다', () => {
  // 사용자 신고: *"bgm은 ESC누르니까 바로 꺼지더라."* 마우스로만 누를 때는 단추까지
  // 손을 가져가는 것 자체가 확인이었다. ESC 한 번에 음악이 끊기면 안 된다.
  const src = fs.readFileSync(path.join(ROOT, 'src/components/easy/NowPlayingBar.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const i = 코드만.indexOf('const handleBGMStop')
  assert.ok(i > 0, 'BGM 정지 처리를 못 찾았다')
  const 다음 = 코드만.slice(i + 10).search(/\n {2}const /)
  const 블 = 다음 >= 0 ? 코드만.slice(i, i + 10 + 다음) : 코드만.slice(i)
  assert.match(블, /confirm\(/, 'BGM 이 확인 없이 꺼진다 — ESC 한 번에 음악이 끊긴다')
})

test('**초안 카드가 이 규칙을 쓴다**', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(코드만.includes('단축키뜻('), '초안 카드가 공용 규칙을 안 쓴다')
})
