// **즉시 안내 방송으로 가는 길은 하나다** (V③ R9 지적, 2026-09-14).
//
// ── 무엇이 뚫려 있었나 ──────────────────────────────────────────────────────
// B-3 으로 「지금 방송」을 `/api/tts/broadcast` 로 옮겼다. 그런데 **확정 단추만** 옮겼다.
// 「자세히 수정」(`ScheduleModal`)으로 저장하면 **예전 그대로** 예약 행을 만들고 스케줄러로
// 쐈다 — 그 행이 남아 다시 나가는 길이 열리고, 차임·음량·반복·BGM 도 안 붙는다
// (스케줄러 payload 에 그 칸이 없다).
//
// **같은 결함의 나머지 절반이다.** 오늘만 두 번째다(즉시 초안의 실행값도 빠른 단추만
// 고쳐서 검색 경로가 남아 있었다). 규칙이 두 곳에 따로 있으면 **언제나 한쪽만 고쳐진다.**
//
// 그래서 실행을 **한 함수**(`지금내보내기`)로 모으고, 두 길이 그것을 쓴다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT  = path.join(__dirname, '..', '..')
const 카드  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
const 모달  = fs.readFileSync(path.join(ROOT, 'src/components/shared/ScheduleModal.jsx'), 'utf8')

/** `{` 부터 짝이 맞는 `}` 까지. */
function 블록(글, 여는곳) {
  let 깊이 = 0
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) return 글.slice(여는곳 + 1, k) }
  }
  assert.fail('블록의 끝을 못 찾았다')
}

/** 실행 함수 몸통 — **제품 소스 그대로** 떼어 돌린다. */
function 지금내보내기() {
  const i = 카드.indexOf('const 지금내보내기 = async (d) => {')
  assert.ok(i > 0, '긍정 앵커 — 즉시 실행 함수가 한 자리에 있다')
  const body = 블록(카드, 카드.indexOf('{', 카드.indexOf('=>', i)))
  return (env) => {
    const 이름들 = Object.keys(env)
    return new Function(...이름들, `return (async (d) => {${body}})`)(...이름들.map(k => env[k]))
  }
}

function 환경() {
  const 기록 = { 저장: 0, 발사: 0, 보낸것: null, BGM: null, 파일: null }
  const env = {
    createSchedule: async () => { 기록.저장++; return { id: 9 } },
    triggerSchedule: async () => { 기록.발사++ },
    ttsBroadcast: async (o) => { 기록.발사++; 기록.보낸것 = o },
    // **배경음악 전용 길**(2026-09-15) — 예약 행을 안 만들고 신호만 쏜다.
    startBgmNow: async (o) => { 기록.발사++; 기록.BGM = o },
    // **음원·유튜브 TV 전용 길**(2026-09-15, 두 번째 조각) — 역시 예약 행을 안 만든다.
    playFileNow: async (o) => { 기록.발사++; 기록.파일 = o },
    chime: true, endChime: true,
  }
  return { 기록, 실행: 지금내보내기()(env) }
}

const 초안 = (더 = {}) => ({
  broadcast_type: 'text', content: '즉시 안내 문구입니다', title: '즉시 안내방송',
  target: '전체', main_volume: 55, repeat_broadcast: 1,
  bgm_enabled: 1, bgm_type: 'preset', bgm_value: '클래식', bgm_delay: 4, ...더,
})

test('긍정 앵커 — 안내 음성은 **예약 없이** 나간다', async () => {
  const e = 환경()
  await e.실행(초안())
  assert.equal(e.기록.저장, 0, '즉시 안내가 예약 행을 만든다 — 그 행이 남아 다시 나간다')
  assert.equal(e.기록.발사, 1, '방송이 안 나갔다')
})

// ── **BGM 을 붙이면 차임은 안 붙는다** (사용자 결정, 2026-09-16 재지적) ────────────
// *"내가 즉시방송할때 BGM선택하면 차임벨 넣지 말랫지"*. 앞 판은 BGM 을 켠 초안으로
// 「차임이 간다」를 요구해서 **사용자가 두 번 말한 것과 정반대를 고정하고 있었다.**
// 이 시험이 원래 지키려던 사실 — **간편모음의 차임 토글이 헛것이 되면 안 된다** — 은
// 그대로 둔다. 다만 BGM 이 없을 때로 좁히고, BGM 이 있을 때는 따로 잰다.
test('**다섯 가지가 전부 실린다** — 어느 길로 들어와도 같다', async () => {
  const e = 환경()
  await e.실행(초안())                     // 기본 초안은 BGM 을 켠 것이다
  const o = e.기록.보낸것
  assert.ok(o, '즉시 TTS 경로로 안 갔다')
  assert.equal(o.volume, 55, '안내 음량이 안 갔다')
  assert.equal(o.repeat, true, '「2회 반복」이 안 갔다')
  assert.equal(o.bgm?.bgm_delay, 4, 'BGM 지연이 안 갔다')
  // BGM 을 붙였으니 **차임은 둘 다 꺼져서** 가야 한다.
  assert.equal(o.chimeStart, false, 'BGM 을 붙였는데 시작 차임이 갔다 — 사용자가 두 번 막은 것이다')
  assert.equal(o.chimeEnd, false, 'BGM 을 붙였는데 종료음이 갔다')
})

test('**BGM 이 없으면 차임 토글이 그대로 실린다** — 토글이 헛것이 되면 안 된다', async () => {
  const e = 환경()
  await e.실행(초안({ bgm_enabled: 0 }))
  const o = e.기록.보낸것
  assert.ok(o, '즉시 TTS 경로로 안 갔다')
  assert.equal(o.chimeStart, true, '시작 차임이 안 갔다 — 간편모음 토글이 헛것이 된다')
  assert.equal(o.chimeEnd, true, '종료음이 안 갔다')
})

// ── **배경음악이 예약 경로에서 빠져나왔다** (사용자 결정 2026-09-15) ────────────────
// 규칙은 「즉시는 휘발성, 업로드는 영구」다(`docs/journal/decisions.md`).
// 그전에는 배경음악을 지금 내보낼 때도 **예약을 하나 만들고 그것을 실행**했다.
// 그 행은 꺼진 채로 지워지지 않아 **달력에 흐린 줄이 하나씩 쌓였다.**
//
// 이 시험은 원래 `bgm` 을 「예약 경로」의 대표로 썼다. 대표를 **음원**으로 옮기고,
// 배경음악은 **새 계약**으로 따로 잰다.
test('**배경음악은 예약 행을 안 만든다** — 즉시는 휘발성이다', async () => {
  const e = 환경()
  await e.실행(초안({ broadcast_type: 'bgm', content: '', bgm_type: 'preset', bgm_value: '잔잔한 음악' }))
  assert.equal(e.기록.저장, 0,
    '배경음악이 아직 예약 행을 만든다 — 그 행이 달력에 흐린 줄로 남는다')
  assert.ok(e.기록.BGM, '배경음악을 안 내보냈다')
  assert.equal(e.기록.BGM.bgm_value, '잔잔한 음악', '고른 음악이 안 실려 갔다')
  assert.equal(e.기록.보낸것, null, 'TTS 가 아닌데 TTS 로 보냈다')
})

test('**음원도 예약 행을 안 만든다** — 두 번째 조각', async () => {
  // (외부 TV 송출 유형은 2026-09-21 걷어냈다)
  for (const 유형 of ['audio']) {
    const e = 환경()
    await e.실행(초안({ broadcast_type: 유형, content: '', audio_file_id: 7 }))
    assert.equal(e.기록.저장, 0, `${유형} 이 아직 예약 행을 만든다 — 달력에 흐린 줄이 남는다`)
    assert.ok(e.기록.파일, `${유형} 을 안 내보냈다`)
    assert.equal(e.기록.파일.broadcast_type, 유형, '유형이 안 실려 갔다')
    assert.equal(e.기록.파일.audio_file_id, 7, '고른 파일이 안 실려 갔다')
    assert.equal(e.기록.보낸것, null, `${유형} 인데 TTS 로 보냈다`)
  }
})

test('**아직 안 옮긴 것은 예약 경로 그대로다** — 조용히 딴 길로 안 보낸다', async () => {
  // 영상은 쏘기 전에 **BGM 을 끄고 페이드를 기다리는 판단**이 예약 경로에만 있다
  // (`scheduler.js` 의 video 갈래, td09 H11). 그것을 복사하면 두 벌이 되고, 한쪽만
  // 고치는 날 영상이 남의 소리 위로 나간다. 흐름은 실행이 돌아온 뒤에도 그 행을 읽는다.
  for (const 유형 of ['video', 'chime', 'flow']) {
    const e = 환경()
    await e.실행(초안({ broadcast_type: 유형, content: '' }))
    assert.equal(e.기록.저장, 1, `${유형} 을 말없이 딴 길로 보냈다`)
    assert.equal(e.기록.보낸것, null, `${유형} 인데 TTS 로 보냈다`)
    assert.equal(e.기록.BGM, null, `${유형} 인데 배경음악 길로 보냈다`)
    assert.equal(e.기록.파일, null, `${유형} 인데 음원 길로 보냈다`)
  }
})

// ── 배선: **두 길이 같은 함수를 쓴다** ──────────────────────────────────────
// 위 시험은 함수 하나를 본다. 그 함수를 **두 길이 실제로 쓰는지**는 따로 봐야 한다 —
// 안 그러면 함수만 옳고 길은 예전 그대로일 수 있다(그게 R9 에서 잡힌 모양이다).
test('확정 단추와 「자세히 수정」이 **같은 함수**를 쓴다', () => {
  const 코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /await 지금내보내기\(draft\)/, '확정 단추가 공통 함수를 안 쓴다')
  assert.match(코드, /onImmediate=\{async \(form\) => \{[\s\S]{0,200}지금내보내기\(form\)/,
    '「자세히 수정」이 공통 함수를 안 쓴다 — 예약 행을 만드는 옛 길이 남아 있다')
  // 옛 길이 되살아나지 않는가 — 모달이 저장한 뒤 발사하던 자리
  assert.doesNotMatch(코드, /wasImmediate && saved\?\.id/,
    '모달이 저장한 뒤 발사하는 옛 길이 되살아났다')
})

test('모달은 **저장 전에** 갈라진다 — 저장한 뒤 지우는 식이 아니다', () => {
  const i = 모달.indexOf('const handleSave')
  assert.ok(i > 0, '긍정 앵커 — 모달의 저장 함수를 못 찾았다')
  const 몸통 = 모달.slice(i, i + 2600)
  const 갈림 = 몸통.indexOf('onImmediate')
  const 저장 = 몸통.indexOf('createSchedule')
  assert.ok(갈림 > 0, '모달에 즉시 실행으로 가는 갈림이 없다')
  assert.ok(갈림 < 저장, '갈림이 저장보다 뒤에 있다 — 예약 행이 먼저 만들어진다')
  // **안 주면 예전 그대로다** — 다른 호출부(관리자 화면 등)에 회귀가 없어야 한다
  assert.match(몸통, /if \(onImmediate && !form\.id && form\.immediate\)/,
    '즉시가 아닌 저장까지 이 갈림으로 샌다 — 예약이 저장 안 된다')
})

// ── **화면이 하는 말과 단추가 하는 일이 같아야 한다** (탐색적 시험 2026-09-14) ────────
// B-3 으로 이 모달의 「저장」이 **곧바로 전관 스피커로 방송을 내보내게** 됐다. 그런데 화면은
// 여전히 **「예약 추가」·「저장」**이라고 적고, **반복시작일·종료일·반복 요일·2차 방송·시각**
// 칸까지 보여 주고 있었다 — 사람은 **예약을 저장하는 줄 알고** 누르는데 소리가 나간다.
//
// 되돌릴 수 없는 일에 그런 말을 붙이면 안 된다(G-42). 그리고 안 쓰이는 칸을 보여 주는 것은
// *"지원되지 않는 옵션을 UI 에만 남기지 마라"* 에 정면으로 걸린다.
//
// **브라우저에서 눌러 보다 발견했다** — 시험이 아니라 사람의 눈이 잡은 자리다.
test('즉시 방송이면 모달이 **그렇게 말한다** — 제목과 단추가 사실이다', () => {
  const 코드 = 모달.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /const 즉시모드 = !!\(onImmediate && !form\.id && form\.immediate\)/,
    '즉시 모드 판정이 없다')
  // **판정이 `handleSave` 의 갈림과 같아야 한다.** 다르면 말과 행동이 갈린다.
  assert.match(코드, /if \(onImmediate && !form\.id && form\.immediate\)/,
    '저장 갈림의 조건이 달라졌다 — 화면이 말하는 것과 단추가 하는 일이 어긋난다')
  assert.match(코드, /즉시모드 \? '지금 방송 — 자세히'/, '제목이 아직 「예약 추가」다')
  assert.match(코드, /즉시모드 \? '지금 방송' : '저장'/,
    '단추가 아직 「저장」이라고 적혀 있다 — 누르면 방송이 나간다')
})

test('즉시 방송에는 **안 쓰이는 칸을 안 보여 준다** — 반복·2차·시각', () => {
  const 코드 = 모달.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /\{!즉시모드 && \(\s*<RepeatPicker/,
    '즉시 방송에 반복시작일·종료일·요일이 보인다 — 안 쓰이는 값이다')
  assert.match(코드, /\{!form\.id && !즉시모드 && \(/,
    '즉시 방송에 「2차 방송 추가」가 보인다 — 2차는 예약 행 둘을 묶는 것이다')
  assert.match(코드, /\{!즉시모드 && \(\s*<div>\s*<label[^>]*>시간</,
    '즉시 방송에 시각 칸이 보인다 — 그 시각에 나간다고 믿게 된다')
  // **값은 안 건드린다.** 묻지 않을 뿐이다(볼륨·BGM 에서 세운 원칙과 같다).
  assert.doesNotMatch(코드, /즉시모드[^\n]*repeat_weekdays: \[\]/,
    '화면이 안 묻는다고 값을 지운다 — 카드를 열었다 닫은 것만으로 설정이 사라진다')
})
