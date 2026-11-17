// 「정지」 버튼은 이 PC에서 나는 방송 소리를 **예외 없이 전부** 멎게 한다.
// (사용자 결정 2026-09-02 — docs/td09-audiobus.md §6, TD-09 3단계 둘째 갈래)
//
// 왜 이 가드가 있나: 이 저장소에서 **반복되는 실패 유형**이 "소리를 내는 놈이 정지 신호를
// 안 듣고 있다"다. 재생 주체가 20곳인데 각자 자기 손잡이만 들고 있어서, 하나를 빠뜨려도
// 화면과 서버는 멀쩡해 보이고 **홀에서만 소리가 계속 난다.** 사람은 그것을 "정지가 가끔
// 안 먹는다"로 신고하고, 새로고침하면 멎으니(재생기가 통째로 사라져서) 원인이 더 숨는다.
// 2026-09-02 e049d7c에서 방송 유튜브 BGM이 정확히 그 상태였고, 이번 갈래가 남은 둘을 닫는다:
//   H1 — TV 송출(당시 외부 동영상 판)이 정지 신호를 어느 것도 안 들었다(2026-09-21 걷어냄)
//   H2 — 로컬 BGM 단독(MusicPlayer.jsx)이 녹음 음원·직원멘트일 때만 멎었다
// 둘 다 "조건 한 줄"이라 되살아나기 쉽다 — 그래서 그 조건 자체를 여기에 못 박는다.
//
// 고정하는 사실 셋:
//  1. (TV 송출 재생기는 2026-09-21 걷어냈다 — 방송 뒤 배경 영상의 정지는 bgm-lane-truth.test.js 가 본다)
//  2. MusicPlayer의 정지 처리기가 **녹음 음원·직원멘트 조건으로 일찍 return하지 않는다**
//  3. 음원 복귀 상태기계(savedBGM)는 그대로다 — 정지가 그것을 우회하지도, 복귀 예약을
//     남기지도 않는다(문서 §3-B 규칙 2는 지켜야 하는 명세다)
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

function stopHandlerBody() {
  const src  = read('src/components/easy/MusicPlayer.jsx')
  const from = src.indexOf('const stopBroadcastHandler = ')
  assert.ok(from > 0, 'MusicPlayer에 정지 처리기(stopBroadcastHandler)가 없다')
  const to = src.indexOf('\n    }', from)
  assert.ok(to > from, '정지 처리기의 끝을 못 찾았다 — 들여쓰기 관례가 바뀌었으면 이 가드를 고칠 것')
  return src.slice(from, to)
}

// ── 사실 2: 로컬 BGM 단독도 정지 버튼에 멎는다 (H2) ─────────────────────────────
test('정지 처리기가 녹음 음원·직원멘트 조건으로 일찍 빠져나가지 않는다 — 배경음악만 흘러도 멎어야 한다', () => {
  const body = stopHandlerBody()

  // 되살아나면 안 되는 그 한 줄. 이 조건으로 return하면 로컬 BGM 단독은 정지를 무시한다.
  assert.doesNotMatch(body, /if\s*\(\s*!isPrayer\s*&&\s*!isStaff\s*\)\s*return/,
    '정지 처리기가 "녹음 음원·직원멘트가 아니면 아무것도 안 함"으로 되돌아갔다 — 배경음악만 '
    + '흐를 때 사람이 정지를 눌러도 계속 난다(docs/td09-audiobus.md H2, 사용자 결정 §6).')

  // 그 자리에 **실제로 멎게 하는 가지**가 있어야 한다.
  assert.match(body, /if \(!isPrayer && !isStaff\) \{/, '로컬 BGM 단독을 따로 다루는 가지가 없다')
  assert.match(body, /a\.pause\(\)/, '정지 처리기가 오디오를 세우지 않는다')
  // 350ms 뒤에 시작하기로 예약된 BGM을 안 거두면 **정지를 누른 다음에 음악이 켜진다.**
  assert.match(body, /bgmStartDelayRef\.current\)\s*\{\s*clearTimeout/,
    '예약된 BGM 시작(350ms 딜레이)을 안 거둔다 — 정지 뒤에 음악이 켜진다')
})

// ── 사실 3: 녹음 음원 중 정지도 전부 멎는다 (2026-09-02 사용자 결정 — §6이 §3-B 규칙 2를 이긴다) ──
// 원래 이 가드는 반대를 얼려 두었다("녹음 음원 중 정지는 BGM으로 돌아간다"). §6("정지는 예외
// 없이 전부")과 부딪히던 마지막 미결 자리를 사용자가 §6으로 정리해 가드도 뒤집었다.
// 복귀 상태기계 자체는 산다 — 녹음 음원이 **스스로 끝날 때**(ended)의 복귀는 명세 그대로다.
test('녹음 음원 중 정지는 BGM을 되살리지 않는다 — 정지는 예외 없이 전부다', () => {
  const src  = read('src/components/easy/MusicPlayer.jsx')
  const body = stopHandlerBody()

  assert.doesNotMatch(body, /playURL\(/,
    '정지 처리기가 BGM을 되살린다 — "정지를 눌렀는데 음악이 나온다"(사용자 결정 2026-09-02 위반)')
  assert.match(body, /savedBGM: null/,
    '정지가 savedBGM을 안 비운다 — 다른 경로가 나중에 그 값으로 BGM을 되살린다')

  // 자연 종료(ended)의 복귀는 살아 있어야 한다 — 정지를 고치다 복귀 명세까지 죽이면
  // 녹음 음원이 끝날 때마다 홀이 조용해진다(§3-B 규칙 2).
  assert.match(src, /const bgmState = savedBGM \?\?/,
    '자연 종료의 savedBGM 복귀 경로까지 사라졌다 — 녹음 음원이 스스로 끝나도 BGM이 안 돌아온다')
  // 복귀를 "언제 하지 않는가"의 명세(점심·저녁 이중재생 방지)도 이 파일에 남아 있어야 한다.
  assert.match(src, /bgmWasStopping/,
    'bgm_stop 페이드 중에 녹음 음원이 오면 복귀를 접는 분기가 사라졌다 — 음원 뒤 BGM이 두 번 난다')

  // 반대쪽: **로컬 BGM 단독의 정지는 복귀 예약을 남기면 안 된다.** 정지는 "지금 다 꺼라"이지
  // "잠시 멈췄다 돌아와라"가 아니다 — 남기면 나중에 저 혼자 되살아난다.
  const bFrom = body.indexOf('if (!isPrayer && !isStaff) {')
  const bTo   = body.indexOf('\n      }', bFrom)
  assert.ok(bFrom > 0 && bTo > bFrom, '로컬 BGM 가지를 못 찾았다')
  const branch = body.slice(bFrom, bTo)
  assert.match(branch, /savedBGM: null/,
    '로컬 BGM 정지가 savedBGM을 안 비운다 — 복귀 예약이 남는다')
  assert.doesNotMatch(branch, /playURL\(/,
    '로컬 BGM 정지가 곡을 다시 튼다 — 정지는 복귀가 아니다')
})

// ── 사실 4: 아래 바의 정지는 상태와 무관하게 한 길이다 (2026-09-02 실기 신고) ─────
// 파란 바(BGM만 재생 중)의 정지가 BGM 정지 명령만 쐈다. 그 신호는 (1) 로컬 BGM 을 못 세우고
// (2) (당시) 수동 곡 복원을 깨워 **정지를 눌렀는데 음악이 되살아나는** 구멍이었다. 사용자 결정: 정지는 아래 바 하나로
// 통일하고, 어느 색 바든 같은 전체 정지(stop-broadcast) 길을 탄다(§6과 같은 뜻).
test('아래 바의 BGM 정지도 전체 정지 길을 탄다 — 반쪽 신호만 쏘면 로컬 BGM 이 안 멎는다', () => {
  const src  = read('src/components/easy/NowPlayingBar.jsx')
  const from = src.indexOf('const handleBGMStop')
  assert.ok(from > 0, 'NowPlayingBar에 BGM 정지 처리기(handleBGMStop)가 없다')
  const to   = src.indexOf('\n  }', from)
  const body = src.slice(from, to)

  assert.match(body, /stopBroadcastAPI\(\)/,
    'BGM 정지가 서버 정지(stopBroadcastAPI)를 안 부른다 — 다른 창·다른 PC는 멎은 줄 모른다')
  assert.match(body, /carecast:stop-broadcast/,
    'BGM 정지가 stop-broadcast를 안 쏜다 — 로컬 BGM·수동 유튜브가 안 멎는다(§6: 정지는 전부)')
  assert.doesNotMatch(body, /dispatchEvent\(new CustomEvent\('carecast:broadcast-bgm-stop'\)\)/,
    'BGM 정지가 여전히 broadcast-bgm-stop을 직접 쏜다 — prevManualRef 복원이 깨어나 '
    + '정지를 눌렀는데 수동 유튜브가 되살아난다(H1에서 배운 그 경로)')
})

// ── 사실 5~7: 정지가 낸 "끄는 페이드"를 아무도 취소하지 못한다 (레드 검증, 2026-09-02 심야) ──
// 방송 유튜브 재생기의 fadeTo는 진입 즉시 이전 페이드를 지운다(onDone 미호출). 정지의
// fadeTo(0,300,()=>setSrc(null))이 취소되면 iframe이 영영 안 내려간다 — 마이크 방송을
// 정지하는 순간 cleanup이 쏘는 broadcast-tts-end의 복구(fadeTo 원래 볼륨)가 정확히 그
// 자리를 때렸다: 화면은 전부 "멎었다"인데 소리만 계속 나는 최악의 조합.


test('로컬 재생기(MusicPlayer): 정지·정지 예약 중에는 덕킹 복구가 볼륨을 되올리지 않는다', () => {
  const src = read('src/components/easy/MusicPlayer.jsx')
  const rFrom = src.indexOf('const restoreHandler')
  assert.match(src.slice(rFrom, rFrom + 260), /bgmStopRef\.current\) return/,
    '복구가 정지 창(300ms)에서 볼륨을 되올리고 오버레이 곡명을 되살린다')
  const dFrom = src.indexOf('const duckHandler')
  assert.match(src.slice(dFrom, dFrom + 260), /bgmStopRef\.current\) return/,
    '덕킹이 정지 페이드를 지운다')
})

test('정지 버튼들은 화면 이벤트를 서버 응답보다 먼저 쏜다 — 서버가 느려도 소리는 즉시 멎어야 한다', () => {
  // FavoritesBar가 진작 지키던 순서(이벤트 먼저, API 뒤)를 정지 버튼 셋도 지킨다.
  const spots = [
    ['src/components/easy/NowPlayingBar.jsx',       'const handleStop'],
    ['src/components/easy/NowPlayingBar.jsx',       'const handleBGMStop'],
    ['src/components/easy/BroadcastBGMStatus.jsx',  'const handleStop'],
  ]
  for (const [rel, marker] of spots) {
    const src  = read(rel)
    const from = src.indexOf(marker)
    const body = src.slice(from, from + 700)
    const evIdx  = body.indexOf("carecast:stop-broadcast")
    const apiIdx = body.indexOf('stopBroadcastAPI()')
    assert.ok(evIdx > 0 && apiIdx > 0, `${rel} ${marker}: 이벤트나 API 호출이 없다`)
    assert.ok(evIdx < apiIdx,
      `${rel} ${marker}: stop-broadcast가 서버 응답 뒤에 있다 — 서버가 행이면 그동안 소리가 계속 난다`)
  }
})

// ── 사실 8: 음원 예약도 낡은 BGM 타이머를 거둔다 (레드 검증의 기존 결함, 2026-09-03) ──
// prayer_play는 녹음 음원을 시작하며 타이머 3종(시작지연·정지페이드·자동정지)을 전부 걷는다.
// 같은 일을 하는 prayer_schedule_play(음원 예약)는 **하나도 안 걷었다.** 재생시간 제한이
// 걸린 BGM이 흐르는 중 음원 예약이 발동하면, 남아 있던 자동정지 타이머가 음원 한복판에
// stopBGM()을 쏴 녹음 음원을 4초 페이드로 죽인다. 350ms 뒤 시작 예약(bgmStartDelayRef)이
// 남아 있으면 음원 위에 음악이 겹쳐 켜진다.
test('음원 예약(prayer_schedule_play)이 앞서 걸린 BGM 타이머를 전부 거둔다', () => {
  const src  = read('src/components/easy/MusicPlayer.jsx')
  const from = src.indexOf("addEventListener('prayer_schedule_play'")
  assert.ok(from > 0, 'prayer_schedule_play 핸들러가 없다')
  const head = src.slice(from, from + 1200)

  assert.match(head, /bgmDurationRef\.current\)\s*\{\s*clearTimeout/,
    'BGM 자동정지 타이머를 안 걷는다 — 음원 한복판에 stopBGM이 돌아 녹음 음원이 페이드로 죽는다')
  assert.match(head, /bgmStartDelayRef\.current\)\s*\{\s*clearTimeout/,
    '350ms 뒤 BGM 시작 예약을 안 걷는다 — 음원 위에 음악이 켜진다')
  assert.match(head, /bgmStopRef\.current\)\s*\{\s*clearTimeout/,
    'BGM 정지 페이드 타이머를 안 걷는다 — 녹음 음원 중에 옛 페이드가 끝나며 상태를 비운다')
})
