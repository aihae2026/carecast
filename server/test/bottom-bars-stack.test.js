// **아래 떠 있는 바 둘이 딱 붙어 있어야 한다** (사용자 지적 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 화면 아래에는 바가 둘 쌓인다.
//   · 맨 아래 — BGM 바(`MusicPlayer`). **높이가 둘이다**: 쉴 때 40px, 나올 때 64px
//   · 그 위  — 재생 표시줄(`NowPlayingBar`). 방송 중에만 뜨는 빨간 줄
//
// 빨간 줄이 `bottom: '4rem'`(64px)을 **하드코딩**하고 있었다. 그래서 BGM 이 쉬는 동안
// **24px 이 떴다** — 현장 사진에서 빨간 줄과 「BGM 대기 중」 사이가 벌어져 보인 것이 그것이다.
// 사용자 물음: *"저 빨간 줄은 밑에랑 일부러 띄워놓는 거야?"* 아니다. 버그였다.
//
// ── 왜 시험으로 묶나 ────────────────────────────────────────────────────────
// **같은 실수를 관리자 사이드바가 먼저 겪었다.** 그때도 바닥을 40px 로 적어 두었는데
// 바가 64px 로 자라며 24px 이 덮였고, 하필 맨 아래 「시스템 안내도」가 가려졌다.
// 그 교훈으로 `--cc-nowplaying-h` 가 생겼다. **세 번째가 없게** 여기서 고정한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const 재생줄 = 읽기('src/components/easy/NowPlayingBar.jsx')
const BGM바  = 읽기('src/components/easy/MusicPlayer.jsx')
const 사이드바 = 읽기('src/components/admin/Sidebar.jsx')

test('긍정 앵커 — 아래 두 바가 이 자리에 있다', () => {
  assert.match(재생줄, /fixed left-0 right-0/, '재생 표시줄이 바닥 고정이 아니다')
  assert.match(BGM바, /--cc-nowplaying-h/, 'BGM 바가 제 높이를 안 내보낸다 — 이 시험의 전제다')
})

test('**BGM 바가 높이 둘을 실제로 갖는다** — 그래서 고정값을 쓰면 어긋난다', () => {
  // 이 시험의 근거다. 높이가 하나뿐이라면 하드코딩해도 안 어긋난다.
  const m = /const 키 = ui\.active \? (\d+) : (\d+)/.exec(BGM바)
  assert.ok(m, 'BGM 바 높이를 정하는 곳을 못 찾았다 — 이름이 바뀌었으면 이 시험도 옮길 것')
  assert.notEqual(m[1], m[2], `높이가 ${m[1]}/${m[2]} 로 같다 — 이 시험의 전제가 사라졌다`)
})

test('**재생 표시줄이 BGM 바 높이를 읽는다** — 숫자를 다시 적지 않는다', () => {
  assert.match(재생줄, /var\(--cc-nowplaying-h/,
    '재생 표시줄이 BGM 바 높이를 안 읽는다 — BGM 이 쉬는 동안 24px 이 뜬다')
  // **바닥을 정하는 자리가 셋이다**(TTS 방송·BGM·영상). 셋 다 같은 값을 써야 한다 —
  // 하나만 고치는 날 그 갈래만 어긋나고, 그 갈래가 뜰 때만 보이니 늦게 발견된다.
  // **주석을 걷고 본다.** 이 파일의 머리말이 *"예전엔 `bottom: '4rem'` 이었다"* 라고
  // 적고 있어서, 그냥 훑으면 **설명하려고 적어 둔 옛 값**에 걸린다(`guide-tips` 도
  // 같은 함정에 한 번 걸렸다 — 고친 사실을 적어 두는 저장소일수록 자주 난다).
  const 코드만 = 재생줄.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const 쓴곳 = [...코드만.matchAll(/bottom:\s*([^\s,}]+)/g)].map(m => m[1])
  assert.ok(쓴곳.length >= 1, '바닥을 정하는 자리를 못 찾았다')
  // **한 곳으로 합쳐졌다**(2026-09-15). 앞 판은 갈래 셋(방송·BGM·영상)이 각자 적어서
  // 이 시험이 「셋이어야 한다」로 고정했는데, 색을 제품 토큰으로 바꾸면서 **셋이 같은
  // 틀 하나**를 쓰게 됐다. 자리가 줄어든 것은 이 시험이 막으려던 것과 **같은 방향**이라
  // 개수를 풀고, 대신 아래에서 **모든 자리가 고정 숫자가 아님**을 본다.
  for (const v of 쓴곳) {
    assert.ok(!/\d/.test(v),
      `바닥에 고정 숫자를 적었다: ${v} — BGM 바 높이가 바뀌면 어긋난다`)
  }
})

test('**사이드바도 같은 변수를 쓴다** — 이 어긋남을 먼저 겪은 자리다', () => {
  assert.match(사이드바, /var\(--cc-nowplaying-h/,
    '사이드바가 바닥 높이를 다시 적고 있다 — 2026-09-11 에 「시스템 안내도」가 가려진 그 버그다')
})
