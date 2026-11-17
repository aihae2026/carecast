// 자막 배선을 소스 대조로 고정한다 (배리어프리, 2026-09-04).
//
// 왜 소스를 읽는가: 자막이 끊겨도 **소리는 그대로 나간다.** 방송은 성공으로 기록되고 로그에도
// 아무것도 안 남는다. 사람이 알아채는 건 홀에서 화면을 보고 있을 때뿐이다. 이 저장소는 같은
// 이유로 broadcast-step-progress.test.js가 이미 프론트 소스를 대조하고 있다 — 그 선례를 따른다.
//
// 고정하는 것 다섯:
//  1. 음원 SSE 네 갈래가 전부 audioFileId를 싣는다 — 없으면 화면이 자막을 못 찾는다.
//  2. 음원 자막은 **리더 게이트 앞**에서 띄운다 — 소리는 한 창만 내지만 자막은 모든 창이 본다.
//  3. TTS 자막도 같은 규칙이다.
//  4. 자막 컴포넌트는 오버레이 **밖**에 마운트된다 — 무음 영상이 뜨면 오버레이는 숨는다.
//  5. ready인 자막만 방송에 나간다.
'use strict'

const fs   = require('fs')
const path = require('path')

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── 1) 서버: 음원 SSE는 어느 갈래든 audioFileId를 싣는다 ──────────
//
// 갈래가 넷인 것은 역사적 이유다(자동방송·흐름·예약·옛 BGM 스케줄러). 하나라도 빠지면 그
// 경로로 나간 음원만 조용히 자막이 없다 — 실제로 예약 갈래가 그랬다.
for (const file of [
  'server/services/broadcastSteps.js',
  'server/services/flowRunner.js',
  'server/services/scheduler.js',
  'server/services/bgmScheduler.js',
]) {
  test(`${path.basename(file)}: prayer_play에 audioFileId를 싣는다`, () => {
    const src = read(file)
    const at = src.indexOf("broadcastSSE('prayer_play'")
    assert.ok(at > 0, 'prayer_play를 쏘는 곳이 없다 — 이 테스트의 전제가 바뀌었다')
    const payload = src.slice(at, at + 900)
    assert.match(payload, /audioFileId/,
      '음원 SSE에 audioFileId가 없다 — 이 경로로 나간 음원만 자막이 안 뜬다')
  })
}

// 영상도 같다 — VideoPlayer 가 이 값으로 자막을 찾는다. 예약 갈래만 빠져 있어서
// 자막을 고쳐 저장해도 예약으로 튼 영상에는 자막이 안 나왔다(2026-11-01 현장 보고).
// `video_play` 를 쏘는 곳이 파일 안에 여럿이면 전부 본다.
for (const file of [
  'server/services/broadcastSteps.js',
  'server/services/flowRunner.js',
  'server/services/scheduler.js',
]) {
  test(`${path.basename(file)}: video_play에 audioFileId를 싣는다`, () => {
    const src = read(file)
    let at = src.indexOf("broadcastSSE('video_play'")
    assert.ok(at > 0, 'video_play를 쏘는 곳이 없다 — 이 테스트의 전제가 바뀌었다')
    for (; at > 0; at = src.indexOf("broadcastSSE('video_play'", at + 1)) {
      const payload = src.slice(at, src.indexOf('})', at))
      assert.match(payload, /audioFileId/,
        '영상 SSE에 audioFileId가 없다 — 이 경로로 나간 영상만 자막이 안 뜬다')
    }
  })
}

// ── 2) 서버: TTS 자막(cues)도 마찬가지 ────────────────────────────
test('scheduled_broadcast는 cues를 함께 보낸다 — TTS 자막의 재료다', () => {
  for (const file of ['server/services/broadcastSteps.js', 'server/services/flowRunner.js',
                      'server/services/scheduler.js']) {
    const src = read(file)
    assert.match(src, /readCues\?\.\(/,
      `${file}: 자막 읽기가 없거나 ?. 가 빠졌다 — 자막 때문에 방송이 죽으면 안 된다`)
    assert.match(src, /\bcues,?\s*$/m, `${file}: SSE 페이로드에 cues가 없다`)
  }
})

// ── 3) 프론트: 자막은 리더 게이트 앞에서 띄운다 ───────────────────
//
// 소리는 현장 PC 한 창만 내지만(CC_IS_LEADER), 자막은 연결된 모든 창이 봐야 한다.
// 게이트 뒤로 밀리면 원격 PC·직원 휴대폰에는 자막이 통째로 안 뜬다.
test('음원 자막은 리더 게이트보다 먼저 뜬다 — 소리를 안 내는 창도 봐야 한다', () => {
  const src = read('src/components/easy/MusicPlayer.jsx')
  const at = src.indexOf("es.addEventListener('prayer_play'")
  assert.ok(at > 0, 'prayer_play 수신부가 없다')
  const body = src.slice(at, at + 2000)

  const cue  = body.indexOf('showAudioCaption')
  const gate = body.indexOf('CC_IS_LEADER')
  assert.ok(cue > 0,  '음원 자막을 띄우는 곳이 없다')
  assert.ok(gate > 0, '리더 게이트가 없다 — 원격 PC가 같이 소리를 낸다')
  assert.ok(cue < gate, '자막이 리더 게이트 뒤에 있다 — 소리 안 내는 창에는 자막이 안 뜬다')
})

test('TTS 자막도 리더 게이트보다 먼저 뜬다', () => {
  const src = read('src/hooks/useScheduledBroadcast.js')
  // 이 파일에는 리더 게이트가 여럿이라(영상·BGM) "가장 가까운 것"을 찾아야 한다.
  // TTS 재생 블록의 머리말을 기준점으로 삼는다.
  const 머리말 = src.indexOf('── 예약 방송 / 아침 방송 TTS 재생')
  assert.ok(머리말 > 0, 'TTS 재생 블록의 머리말이 바뀌었다 — 이 테스트의 기준점이다')

  const cue  = src.indexOf('carecast:caption-cue')
  const gate = src.indexOf('if (!window.CC_IS_LEADER || !_IS_LOCAL) return', 머리말)
  assert.ok(cue > 0, 'TTS 자막을 띄우는 곳이 없다')
  assert.ok(gate > 0, 'TTS 재생 블록의 리더 게이트가 없다 — 원격 PC가 같이 소리를 낸다')
  assert.ok(cue < 머리말 && cue < gate,
    'TTS 자막이 리더 게이트 뒤에 있다 — 소리 안 내는 창에는 자막이 안 뜬다')
})

// 소리를 내는 창만 <audio>를 쥐고 있다. 넘겨주지 않으면 그 창까지 추정 시계로 돌아
// 정확도가 통째로 떨어진다.
test('소리를 내는 창은 <audio>를 자막에 넘긴다', () => {
  for (const [file, 설명] of [
    ['src/components/easy/MusicPlayer.jsx',   '음원'],
    ['src/hooks/useScheduledBroadcast.js',    'TTS'],
  ]) {
    assert.match(read(file), /carecast:caption-attach/,
      `${설명} 재생이 오디오를 자막에 안 넘긴다 — 그 창도 추정 시계로 돈다`)
  }
})

// ── 4) 프론트: 자막은 오버레이 밖에 산다 ──────────────────────────
//
// 식사 중 무음 영상이 뜨면 morning_video_start가 오버레이를 숨긴다. 자막이 그 안에 있으면
// 그 순간 통째로 사라지는데, 무음 영상 위로 나가는 안내야말로 자막이 가장 필요하다.
test('자막 컴포넌트는 오버레이 안이 아니라 자기 층에 마운트된다', () => {
  const app = read('src/App.jsx')
  assert.match(app, /<BroadcastCaption \/>/, 'App에 자막이 마운트되어 있지 않다')

  // 주석에서 이름을 언급하는 것은 괜찮다. 막으려는 것은 오버레이가 자막을 **그리는** 것이다.
  const overlay = read('src/components/broadcast/BroadcastIndicators.jsx')
  assert.doesNotMatch(overlay, /<BroadcastCaption/,
    '자막이 오버레이 안으로 들어갔다 — 무음 영상이 뜨면 자막까지 같이 사라진다')

  const caption = read('src/components/broadcast/BroadcastCaption.jsx')
  assert.match(caption, /z-\[10000\]/, '자막이 오버레이(z-9999)보다 위가 아니다')
})

// ── 5) 확인된 자막만 방송에 나간다 ────────────────────────────────
//
// 받아쓰기와 AI가 만든 자막은 틀릴 수 있다. 잘못 들은 글자가 홀 화면에 그대로 뜨는 것이
// 여기서 가장 나쁜 결과라, 사람이 올린 것(ready)만 내보낸다(CLAUDE.md 검토 게이트).
test('ready인 자막만 방송 화면에 나간다', () => {
  assert.match(read('src/components/easy/MusicPlayer.jsx'), /status\s*!==\s*'ready'/,
    '확인 안 된 초안 자막이 방송에 나갈 수 있다')
})

// ── 6) 자막 초안이 쓰는 정본은 방송이 읽는 것과 같아야 한다 ────────
//
// 식사 안내 녹음은 그 TTS 문구를 **대신하는** 것이다(broadcastSteps.js stepMealPrayer).
// 초안이 다른 문구를 깔면 화면에 나가는 글자와 실제 녹음이 어긋난다 — 소리와 자막이 다른
// 방송이 되는 것이 여기서 가장 나쁜 결과다.
//
// 2026-09-05: 표가 **두 곳에 사본으로** 있던 것을 domain/graceText.js 하나로 합쳤다. 그래서
// 이 가드가 보는 곳도 하나다. 사본이 다시 생기면 아래 "사본이 없다" 단언이 잡는다.
test('자막 초안의 정본 표가 방송 시퀀서와 같은 설정 키를 본다', () => {
  const 시퀀서 = read('server/services/broadcastSequencer.js')
  const 짝 = [
    ['breakfast-grace', 'breakfast_prayer_tts', 'BREAKFAST_PRAYER_DEFAULT'],
    ['lunch-grace',     'lunch_prayer_tts',     'LUNCH_PRAYER_DEFAULT'],
    ['dinner-grace',    'dinner_prayer_tts',    'DINNER_PRAYER_DEFAULT'],
  ]
  for (const [, key, def] of 짝) {
    assert.match(시퀀서, new RegExp(`getSetting\\(db, '${key}', ${def}\\)`),
      `시퀀서가 ${key}를 그 기본값으로 읽지 않는다 — 초안 표의 전제가 바뀌었다`)
  }

  const src = read('server/domain/graceText.js')
  for (const [cat, key, def] of 짝) {
    assert.match(src, new RegExp(`'${cat}':\\s*\\['${key}',\\s*${def}\\]`),
      `graceText.js: ${cat}가 시퀀서와 다른 문구를 본다`)
  }

  // 사본이 다시 생기지 않았는지 — 예전에 이 표가 살던 두 곳을 본다.
  for (const file of ['server/routes/audio.js', 'scripts/caption-draft.cjs']) {
    assert.doesNotMatch(read(file), /const GRACE_TEXT = \{/,
      `${file}에 정본 표 사본이 되살아났다 — 갈리면 업로드 초안과 받아쓰기 초안이 달라진다`)
  }
})

// 받아쓰기는 틀린다. 사람이 확인하고 올리기 전까지는 방송에 나가면 안 된다.
test('초안 스크립트는 언제나 draft로만 저장한다', () => {
  const src = read('scripts/caption-draft.cjs')
  assert.match(src, /'draft'/, '초안 스크립트가 상태를 안 정한다')
  assert.doesNotMatch(src, /status\s*=\s*'ready'|,\s*'ready'\s*,/,
    '초안 스크립트가 ready로 저장할 수 있다 — 확인 안 된 자막이 홀 화면에 뜬다')
})

// ── 7) 편집기 미리보기와 실제 방송 자막은 서로 안 섞인다 ──────────
//
// 둘 다 같은 컴포넌트(BroadcastCaption)로 그리고 같은 window 이벤트를 듣는다. 갈라 듣지
// 않으면 편집기에서 재생하는 순간 **관리자 화면 전체가 자막으로 덮인다.**
test('미리보기 신호와 방송 신호를 갈라 듣는다', () => {
  const caption = read('src/components/broadcast/BroadcastCaption.jsx')
  assert.match(caption, /embedded/, '미리보기 모드가 없다')
  assert.match(caption, /!!e\.detail\?\.preview !== embedded/,
    '미리보기 신호를 걸러내지 않는다 — 편집기 재생이 관리자 화면을 덮는다')

  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(editor, /preview: true/, '편집기가 미리보기 표시를 안 붙인다')
  assert.match(editor, /<BroadcastCaption embedded/,
    '미리보기를 다른 렌더러로 그리고 있다 — 여기서 본 모습과 홀 화면이 달라진다')
})

// 빈 칸을 사람이 처음부터 치게 두면 아무도 안 쓴다. 가져올 길이 있어야 한다.
test('편집기에 문구를 채워 넣는 길이 있다', () => {
  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  // 버튼 **글자**가 아니라 **동작**을 잠근다. 문구는 다듬으면 바뀐다(실제로 "받아쓰기로
  // 채우기" → "자동으로 만들기"로 바뀌었고 이 테스트가 그 때문에 깨졌다).
  assert.match(editor, /fillFromStt/, '받아쓰기로 채우는 길이 없다 — 명령줄로만 되면 현장에서 못 쓴다')
  assert.match(editor, /transcribeAudioSubtitle/, '받아쓰기 API를 안 부른다')
  assert.match(editor, /fillFromDefault/, '정해진 문구를 가져오는 길이 없다')
})

// 자막은 이미 자동으로 만들어져 있다. 첫 화면이 "1. 문구 / 2. 타이밍 — 스페이스바"였을 때
// 사용자가 "일일이 하기 불편하다"고 했다 — 기능이 아니라 말과 배치의 문제였다.
test('편집기 기본은 확인 모드다 — 탭싱크는 뒤로 물러나 있다', () => {
  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(editor, /useState\('check'\)/, '기본 모드가 확인이 아니다')
  assert.match(editor, /들으며 확인/, '재생 버튼이 작업을 선언하는 이름이다')
  assert.doesNotMatch(editor, /'싱크 시작'|>싱크 시작</, '"싱크 시작"이 남아 있다')
  assert.match(editor, /타이밍 맞추기/, '탭싱크로 들어가는 문이 없다')
})

// 확인만 하려던 사람이 습관대로 스페이스(일시정지)를 누르면 1번 줄 시각이 조용히
// 덮어써졌다. 말이 아니라 데이터를 망치는 함정이라 모드로 갈랐다.
test('스페이스로 찍는 것은 타이밍 모드에서만이다', () => {
  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(editor, /if \(mode === 'timing'\) mark\(\)/,
    '확인 중에 스페이스를 누르면 시각이 덮어써진다')
})

// 전사는 음원 길이의 1/3쯤 걸린다. 아무 표시가 없으면 사람이 다시 누르거나 창을 닫는다.
test('받아쓰는 동안 진행률을 보여준다', () => {
  assert.match(read('server/routes/audio.js'), /router\.get\('\/subtitle\/progress'/,
    '진행률을 알려주는 길이 없다')
  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(editor, /getSubtitleProgress/, '편집기가 진행률을 안 물어본다')
  assert.match(editor, /prog\.percent/, '퍼센트를 안 보여준다')
})

// ── 시계 계기판은 홀 TV에 뜨면 안 된다 ────────────────────────────
//
// 자막이 소리와 맞는지 재는 도구다(주소에 ?sync=1). 깃발 없이 그리면 **어르신이 보는 화면에
// 검은 상자와 숫자가 뜬다.** 그래서 조건 두 개를 고정한다: 깃발이 있을 때만, 그리고 편집기
// 미리보기(embedded)에는 안 뜬다.
test('시계 계기판은 ?sync=1일 때만, 편집기 미리보기에는 안 뜬다', () => {
  const src = read('src/components/broadcast/BroadcastCaption.jsx')
  assert.match(src, /const SYNC_HUD =[\s\S]{0,120}URLSearchParams[\s\S]{0,40}has\('sync'\)/,
    '계기판이 주소 깃발로 잠겨 있지 않다 — 홀 TV에 그대로 뜬다')
  const 그리는곳 = src.match(/SYNC_HUD && !embedded && <SyncHud/g) || []
  assert.equal(그리는곳.length, 1, '자막이 떠 있을 때 그리는 자리는 하나여야 한다')
  assert.match(src, /return SYNC_HUD && !embedded \? <SyncHud/,
    '자막이 뜨기 전에도 같은 조건이어야 한다 — 한쪽만 잠그면 미리보기에 샌다')
})

// ── 자막을 지우는 길 ──────────────────────────────────────────────
//
// 서버엔 DELETE가 있었는데 화면에 단추가 없었다(2026-09-05에 발견). 잘못 만든 자막을 되돌릴
// 방법이 없어서 통째로 다시 만들어야 했고, **「방송에 쓰기」까지 누른 자막은 지울 때까지
// 홀 화면에 계속 나갔다.**
test('자막을 지우는 길이 서버에도 화면에도 있다', () => {
  assert.match(read('server/routes/audio.js'), /router\.delete\('\/files\/:id\/subtitle'/,
    '서버에 자막을 지우는 길이 없다')
  const editor = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(editor, /deleteAudioSubtitle/, '편집기가 지우기 창구를 안 쓴다 — 서버만 되고 사람은 못 지운다')
  assert.match(editor, /confirm\(/, '되돌릴 수 없는 일인데 확인을 안 묻는다')
})

// 받아쓰기 결과를 서버가 곧바로 저장해 버리면 사람이 고칠 틈이 없다.
test('받아쓰기 라우트는 저장하지 않고 결과만 돌려준다', () => {
  const src = read('server/routes/audio.js')
  const at = src.indexOf("router.post('/files/:id/subtitle/transcribe'")
  assert.ok(at > 0, '받아쓰기 라우트가 없다')
  // **두 번째 마커가 있는지부터 본다.** 없으면 indexOf가 -1이 되고, slice(at, -1)은 파일
  // 끝까지를 창으로 삼는다 — 그래도 통과하므로 **감시가 조용히 헐거워진다**
  // (docs/big-file-split-design.md가 경고하는 모양. 2026-09-05에 이 파일을 가르며 실제 조건이 됐다).
  const end = src.indexOf("router.get('/files/:id/subtitle/default-text'")
  assert.ok(end > at, '창을 닫을 마커가 없다 — 이 검사가 파일 전체를 훑고도 통과하게 된다')
  const body = src.slice(at, end)
  assert.doesNotMatch(body, /INSERT INTO audio_subtitles/,
    '받아쓰기가 곧바로 저장한다 — 사람이 고칠 틈 없이 자막이 자리를 잡는다')
})

// ── 8) AI 교정은 시각을 건드리지 않는다 ───────────────────────────
//
// 줄 수가 하나라도 달라지면 그 뒤 자막이 통째로 밀린다. 소리와 글자가 어긋난 방송은
// 자막이 없는 것보다 나쁘다 — 사람이 "틀린 자막"을 믿게 되기 때문이다.
// 2026-09-06: 줄 수 검사가 **services/llmGateway.js 로 옮겨 갔다**(3단 폴백).
// 코드가 옮겨 가면 가드도 따라 옮긴다 — 안 옮기면 여기 부정 단언만 남아 조용히 통과한다
// (CLAUDE.md "파일을 가를 때"). 그래서 검사 자리와 라우트 양쪽을 함께 본다.
test('AI 교정은 줄 수가 달라지면 그 결과를 안 쓴다', () => {
  const gate = read('server/services/llmGateway.js')
  assert.match(gate, /function 다듬기쓸만한가/, '줄 수를 재는 자리가 없다')
  assert.match(gate, /고침\.length === 원본\.length/,
    '줄 수를 안 맞춰 본다 — AI가 줄을 합치면 그 뒤 자막이 통째로 밀린다')

  const src = read('server/routes/audio.js')
  const at = src.indexOf("router.post('/files/:id/subtitle/polish'")
  assert.ok(at > 0, 'AI 교정 라우트가 없다')
  const body = src.slice(at, at + 3500)
  // 긍정 앵커 — 라우트가 실제로 그 검사를 지나는 창구를 쓰고 있다
  assert.match(body, /polishWithFallback/, '라우트가 줄 수 검사를 거치지 않는다')
  assert.doesNotMatch(body, /INSERT INTO audio_subtitles/,
    'AI 교정이 곧바로 저장한다 — 사람이 확인할 틈이 없다')
})

// 실제로 줄 수를 바꿔 오면 버리는지, 소스가 아니라 **동작으로** 확인한다.
test('AI 가 줄 수를 바꿔 오면 원문을 쓴다 — 소스 대조가 아니라 실제 동작', async () => {
  const { polishWithFallback } = require('../services/llmGateway')
  const 원본 = ['첫 줄', '둘째 줄', '셋째 줄']

  const 합침 = await polishWithFallback({ lines: 원본, callApi: async () => ['첫 줄 둘째 줄 셋째 줄'] })
  assert.deepEqual(합침.lines, 원본, 'AI 가 줄을 합쳤는데 그대로 썼다')
  assert.equal(합침.via, 'template')
  assert.match(합침.reason, /줄 수/)

  const 정상 = await polishWithFallback({ lines: 원본, callApi: async () => ['첫 줄', '둘째 줄', '셋째 줄!'] })
  assert.equal(정상.via, 'api')
  assert.equal(정상.lines[2], '셋째 줄!')

  // 빈 줄로 돌아온 자리는 원문을 남긴다 — 자막에 빈칸이 뜨면 그 구간이 사라진 것처럼 보인다
  const 빈줄 = await polishWithFallback({ lines: 원본, callApi: async () => ['첫 줄', '', '셋째 줄'] })
  assert.equal(빈줄.lines[1], '둘째 줄')

  const 던짐 = await polishWithFallback({ lines: 원본, callApi: async () => { throw new Error('503') } })
  assert.deepEqual(던짐.lines, 원본)
  assert.equal(던짐.via, 'template')
})

// 이 저장소는 Gemini를 직접 fetch하지 않는다(CLAUDE.md). 503 재시도와 타임아웃이
// 그 래퍼에만 있어서, 직접 부르면 혼잡할 때 그냥 실패한다.
test('Gemini는 재시도 래퍼를 거쳐 부른다', () => {
  const src = read('server/routes/audio.js')
  assert.match(src, /fetchGeminiWithRetry/, '재시도 래퍼를 안 쓴다')
  assert.doesNotMatch(src, /await fetch\(\s*`https:\/\/generativelanguage/,
    'Gemini를 직접 fetch한다 — 503 재시도와 타임아웃을 건너뛴다')
})

// ── 9) 받아쓰기가 prefill을 덮어쓴다 ──────────────────────────────
//
// 식사 안내 음원은 업로드 때 정본 문구가 먼저 깔린다(글자는 맞고 타이밍은 글자 수로 나눈
// 어림값이다). 그걸 "이미 자막 있음"으로 보고 건너뛰면 받아쓰기가 잡아 줄 진짜 시각이
// 영영 안 들어온다 — 실측에서 셋째 줄부터 1.8초가 밀렸다(2026-09-04 저녁, 집 PC).
//
// 받아쓰기는 정본이 있으면 글자를 정본에서 가져오므로 덮어써도 글자는 그대로다.
test('업로드 자동 초안: prefill은 받아쓰기가 덮어쓰고, 사람이 손댄 것은 안 건드린다', () => {
  // 2026-09-05: 받아쓰기 엔진과 대기열이 services/captionDraft.js로 내려갔다.
  // 가드도 따라간다 — 옛 파일을 보면 indexOf가 -1이 되어 시끄럽게 죽는다.
  const src = read('server/services/captionDraft.js')
  const at = src.indexOf('async function 대기열돌리기')
  assert.ok(at > 0, '자동 초안 대기열이 없다')
  const body = src.slice(at, at + 2000)

  assert.match(body, /source === 'prefill'/,
    'prefill을 덮어쓰지 않는다 — 정본 문구가 어림 타이밍인 채로 굳는다')
  assert.match(body, /status === 'draft'/,
    'ready인 자막까지 덮어쓸 수 있다 — 사람이 확정한 것을 건드리면 안 된다')
  // prefill 초안은 조건부 UPDATE 로 덮어쓴다(2026-11-10 2차 검토 5-1 — 받아쓰는 사이 사람이 저장했으면
  // 안 쓴다). 동작은 expert-review-2.test.js 의 5-1 시험이 직접 본다.
  assert.match(body, /UPDATE audio_subtitles SET[\s\S]*source = 'prefill' AND status = 'draft' AND updated_at = \?/,
    'prefill 초안을 덮어쓰는 길이 없다 — 정본 문구가 어림 타이밍인 채로 굳는다')
})

// ── 7) 고쳐 저장한 자막이 다음 방송에 반영된다 (2026-11-01 현장 보고) ─────────────────
// 기도 음원 자막의 오타를 고쳐 저장했는데 다음 예약 방송에 옛 자막이 떴다. 고친 파일과 실제로
// 나간 파일이 갈릴 수 있었고(식전 안내가 「지금 나가는 파일」과 다른 규칙으로 골랐다), 같은 파일이라도
// 방송 중 자막을 「초안 저장」하면 조용히 방송에서 빠졌다.
test('식전 안내: 지정 파일이 없으면 「지금 나가는 파일」과 같은 규칙으로 고른다', () => {
  const src = read('server/services/bgmScheduler.js')
  assert.doesNotMatch(src, /ORDER BY id LIMIT 1/,
    '식전 안내가 올린 순 첫 번째를 직접 고른다 — 관리 화면의 「지금 나가는 파일」과 어긋난다')
  assert.match(src, /pickCategoryFile/, '식전 안내가 단일 출처(categoryPick)를 안 쓴다')
})

test('자막 조회 응답은 캐시하지 않는다 — 고친 자막이 바로 나가야 한다', () => {
  const src = read('server/routes/audio.js')
  const at = src.indexOf("router.get('/files/:id/subtitle'")
  assert.ok(at > 0, '자막 조회 라우트가 없다')
  assert.match(src.slice(at, at + 600), /no-store/, '자막 조회에 no-store 가 없다')
})

test('편집기: 방송 중 자막을 초안으로 내리면 확인을 받고, 지금 안 나가는 파일이면 알린다', () => {
  const src = read('src/components/admin/sections/subtitleEditorModal.jsx')
  assert.match(src, /status === 'ready' && !asReady/,
    '방송 중인 자막을 「초안 저장」하면 조용히 방송에서 빠진다')
  assert.match(src, /is_primary/, '지금 방송에 안 나가는 파일을 고치는 중이라는 안내가 없다')
})
