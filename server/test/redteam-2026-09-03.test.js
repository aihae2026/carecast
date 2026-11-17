// 레드 검증(2026-09-03 심야, 에이전트 A) 발견분의 가드.
//
// 오늘 밤 넣은 기능 셋(마이크 신호등 · video_file 개방 · 자연어 3단계)을 적대적으로
// 훑어 8건이 나왔고, 그중 다섯을 고쳤다. 여기는 **고친 다섯이 되돌아오지 않게** 막는다.
// 나머지 셋(F6 창 폭·원문 낱말 영구·1.5초 tick 점유)은 TASKS.md에 근거와 함께 남겼다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// ── 발견2 (가장 위험) ────────────────────────────────────────────────────
// 신호등을 무조건 켜면 "표시는 나는데 소리는 없는" 상태가 된다 — 이 기능이 고치려던
// 신고("소리는 나는데 표시가 없다")의 정반대. 배지가 있으니 아무도 확인하러 안 간다.
test('신호등은 실제로 재생된 청크만 켠다 — 두 경로 모두', () => {
  const player = read('server/services/audioPlayer.js')
  assert.match(player, /if \(!IS_WINDOWS\) \{ nonWinNotice\(\); return false \}/,
    'playChunk가 재생 여부를 안 돌려준다 — 부르는 쪽이 성공을 알 길이 없다')
  assert.match(player, /_chunkCount\+\+\s*\n\s*return true/,
    '실제로 쓴 뒤 true를 안 돌려준다')

  for (const [rel, 이름] of [['server/routes/mic.js', 'HTTP 폴백'], ['server/index.js', 'WS(1차)']]) {
    const src = read(rel)
    assert.match(src, /playChunk\([^)]*\)[\s\S]{0,80}chunkArrived/,
      `${이름} 경로가 재생 결과와 무관하게 신호등을 켠다 — 플레이어가 안 떠 있으면 거짓 표시가 된다`)
    // **인자 개수를 고정하지 않는다**(2026-09-11, P-63). 이 검사가 지키는 것은
    // *"재생됐을 때만 신호등을 켠다"* 는 **조건의 존재**이지 `playChunk` 의 철자가 아니다.
    // P-63 이 발신자 인자를 더하자 `playChunk(data)` 라는 옛 철자가 안 맞아 빨간불이 났는데,
    // 조건 자체는 그대로 있었다 — 뜻은 안 낮추고 철자만 넓힌다(CLAUDE.md 「가드는 따라 옮긴다」).
    assert.ok(/if \(played\) require/.test(src) || /if \(playChunk\([^)]*\)\) require/.test(src),
      `${이름} 경로에 "재생됐을 때만" 조건이 없다`)
  }
})

// ── 발견1 ────────────────────────────────────────────────────────────────
// 상태가 서버 메모리에만 있고 접속 스냅샷이 없으면 두 방향이 다 반쪽이다.
test('SSE 접속 순간 마이크 신호등 상태를 한 번 맞춘다', () => {
  const src = read('server/routes/events.js')
  assert.match(src, /event: mic_live/,
    '접속 동기화에 mic_live가 없다 — 방송 도중 새로 연 화면은 켜짐을 영영 못 받고, '
    + '꺼짐 신호 사이에 끊겼던 화면은 "방송 중"이 굳는다')
  assert.match(src, /micLive'\)\.isLive\(\)/,
    'isLive()를 안 쓰고 다른 근거를 만들었다 — 상태는 micLive 하나가 진실이어야 한다')
})

// ── 발견4 ────────────────────────────────────────────────────────────────
// 파일을 안 고른 단계는 방송 시각에 조용히 건너뛰어진다. audio·video는 막고 있었는데
// 새로 연 video_file만 화면·서버 양쪽에서 빠져 있었다.
test('파일을 고르는 단계는 미선택이면 저장을 막는다 — video_file 포함', () => {
  const { validateSteps } = require('../routes/flows')
  assert.match(String(validateSteps([{ step_type: 'video_file', config: {} }])), /선택/,
    'video_file을 파일 없이 저장할 수 있다 — 그 단계는 방송 시각에 조용히 사라진다')
  assert.match(String(validateSteps([{ step_type: 'audio', config: {} }])), /선택/,
    '음원 단계의 기존 규칙이 사라졌다')
  assert.equal(validateSteps([{ step_type: 'video_file', config: { audio_file_id: 3 } }]), null,
    '파일을 고른 단계까지 막는다')
  assert.equal(validateSteps([{ step_type: 'video_file', config: { playlist: [1, 2] } }]), null,
    '재생목록으로 고른 단계를 막는다 — 항목이 있으면 audio_file_id가 없어도 정상이다')
  assert.match(read('src/components/shared/FlowBuilder.jsx'), /video_file' && !s\.config\?\.audio_file_id/,
    '화면도 같은 검사를 해야 한다 — 저장 눌러야 알게 되면 늦다')
})

// ── 발견5 ────────────────────────────────────────────────────────────────
// 같은 문장에 든 낱말들은 빈도·수정횟수가 정확히 같아서 임계를 함께 넘는다.
test('제안은 한 번의 승인에 하나만 만든다 — 목록이 무의미한 후보로 덮이지 않게', () => {
  const src = read('server/domain/nlSuggest.js')
  assert.match(src, /if \(created\.length >= 1\) break/,
    '회당 생성 상한이 없다 — "어르신 생신잔치 반짝조명"이면 세 개가 한꺼번에 제안된다')
})

// ── 발견7 ────────────────────────────────────────────────────────────────
test('내 방송이 끝나면 그 화면의 "다른 기기에서 방송 중"은 즉시 사라진다', () => {
  const src = read('src/components/easy/InstantBroadcast.jsx')
  // 지우는 자리는 **정지를 누른 그 처리기**다 — 렌더나 effect에서 지우면 React 규칙에
  // 걸린다(ref-during-render·set-state-in-effect). 실제로 그 두 방식을 시도했다가 lint에 막혔다.
  const i = src.indexOf('const stopBroadcast')
  assert.notEqual(i, -1, 'stopBroadcast를 찾지 못했다')
  assert.match(src.slice(i, i + 700), /setRemoteLive\(false\)/,
    '정지 처리기가 원격 표시를 안 지운다 — 내가 껐는데 최대 3초간 "다른 기기에서 방송 중"이 뜬다')
})
