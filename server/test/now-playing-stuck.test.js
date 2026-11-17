'use strict'
// **「방송 중」 표시가 굳으면 그 뒤 예약이 통째로 사라진다** (현장 신고 2026-09-16).
//
// *"환기방송 2차가 뭐랑 겹쳐서 안나갔다는데, 난 겹쳐서 한게 없거든?"*
// *"저 밑에 재생버튼도 재생되는게 없는데 계속 떠 있네?"*
//
// ── 무엇이 일어났나 — 칸 하나가 빠져서 방송이 사라졌다 ─────────────────────
// 2026-09-15 에 재생바가 「이 소리를 누가 내는가」를 `서버소리` 로 실어 보내기 시작했다.
// 그런데 `nowPlaying.js` 의 **허용 칸 목록에 안 넣어서 서버가 조용히 버렸다.**
//
//   ① 재생바: `{title:'즉시 방송', 서버소리:true}` 를 올린다 → 서버는 `{title}` 만 저장
//   ② 3초 폴링이 그 값으로 화면 상태를 덮는다 → 화면에서도 `서버소리` 가 사라진다
//   ③ 방송이 끝나 `onImmediateEnd` 가 와도 조건(`서버소리`)이 거짓이라 **안 지운다**
//   ④ `state.broadcast` 가 영원히 남는다 → `broadcastInProgress()` 항상 true
//   ⑤ **그 뒤 예약이 전부 미뤄지다가 10분 뒤 「겹쳐서 … 건너뛰었습니다」로 버려진다**
//
// 겹친 것은 없었다. 시스템이 그렇게 **믿었을** 뿐이다.
//
// ── 이 시험이 지키는 것 — 세 겹 전부 ───────────────────────────────────────
// 한 겹만 고치면 다음에 다른 칸이 빠지는 날 같은 고장이 되풀이된다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// SSE 전파는 이 시험과 상관없다 — 모듈이 그것 때문에 못 뜨지 않게 미리 비워 둔다.
const nowPlaying = require('../services/nowPlaying')

test('**칸이 왕복에서 살아남는다** — 재생바가 보낸 것을 서버가 그대로 돌려준다', () => {
  nowPlaying.update({ broadcast: null })
  nowPlaying.update({ broadcast: { title: '즉시 방송', 서버소리: true } })
  const 나온것 = nowPlaying.get().broadcast
  assert.equal(나온것.title, '즉시 방송')
  assert.equal(나온것.서버소리, true,
    '서버가 「서버소리」 칸을 버린다 — 재생바가 방송을 못 지우고, 그 뒤 예약이 사라진다')
  nowPlaying.update({ broadcast: null })
})

test('**참·거짓 칸을 글자로 씻지 않는다** — 목록만 고치고 씻기를 안 고치면 또 버려진다', () => {
  nowPlaying.update({ broadcast: null })
  nowPlaying.update({ broadcast: { title: 'x', 서버소리: false } })
  assert.equal(nowPlaying.get().broadcast.서버소리, false, 'false 가 사라졌다')
  nowPlaying.update({ broadcast: null })
})

test('**아무거나 꽂아도 「방송 중」이 되지 않는다** — 옛 가드가 살아 있다', () => {
  // P-46: 이 상태는 표시용이 아니라 **예약을 내보낼지 정하는 근거**다.
  nowPlaying.update({ broadcast: null })
  for (const 나쁜것 of ['아무말', 123, ['a'], true]) {
    nowPlaying.update({ broadcast: 나쁜것 })
    assert.equal(nowPlaying.get().broadcast, null,
      `${JSON.stringify(나쁜것)} 가 「방송 중」으로 읽힌다`)
  }
})

test('**언제 켜졌는지 잰다** — 낡음을 가리려면 시각이 있어야 한다', () => {
  nowPlaying.update({ broadcast: null })
  assert.equal(nowPlaying.getBroadcastSince(), 0, '꺼져 있는데 시각이 남아 있다')

  const 전 = Date.now()
  nowPlaying.update({ broadcast: { title: 'a' } })
  const 켜진때 = nowPlaying.getBroadcastSince()
  assert.ok(켜진때 >= 전, '켜질 때 시각을 안 잡는다')

  // **제목만 바뀌어도 시계를 다시 잡으면 안 된다** — 긴 방송이 영영 「새것」이 되어
  // 낡음 판정을 빠져나간다.
  nowPlaying.update({ broadcast: { title: 'b' } })
  assert.equal(nowPlaying.getBroadcastSince(), 켜진때,
    '켜져 있는 채로 제목만 바뀌었는데 시계를 다시 잡았다')

  nowPlaying.update({ broadcast: null })
  assert.equal(nowPlaying.getBroadcastSince(), 0, '꺼졌는데 시각이 남는다')
})

test('**낡은 「방송 중」은 무시한다** — 안 그러면 그 뒤 예약이 전부 사라진다', () => {
  const src = 읽기('server/services/scheduler.js')
  // 상한이 있고, 그 상한을 `getBroadcastSince` 로 잰다.
  assert.match(src, /방송표시상한ms/, '낡음 상한이 없다 — 한 번 굳으면 영원히 예약을 막는다')
  assert.match(src, /getBroadcastSince/, '언제 켜졌는지를 안 본다')
  // **조용히 지나가지 않는다** — 이 상한에 걸리는 것 자체가 정상이 아니다.
  assert.match(src, /console\.warn\([\s\S]{0,200}방송 중/,
    '낡은 표시를 무시하면서 아무 말도 안 한다 — 원인이 묻힌다')
})

test('**재생바의 끝 처리가 칸 하나에 걸려 있지 않다**', () => {
  const src = 읽기('src/components/easy/NowPlayingBar.jsx')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // 앞 판: `if (!stRef.current.broadcast?.서버소리) return` — 칸이 빠지면 영영 안 지운다.
  assert.ok(!/if \(!stRef\.current\.broadcast\?\.서버소리\) return/.test(코드만),
    '끝 처리가 아직 「서버소리」 한 칸에만 걸려 있다')
  // 예비 근거(제목)가 있어야 한다.
  assert.match(코드만, /b\.title !== 즉시방송제목/, '칸이 빠졌을 때의 예비 근거가 없다')
  // 제목은 **한 곳**에서 온다 — 세우는 쪽과 지우는 쪽이 같은 글자를 봐야 한다.
  assert.match(코드만, /const 즉시방송제목 = /, '제목이 상수가 아니다')
  assert.equal((코드만.match(/title: '즉시 방송'/g) || []).length, 0,
    '제목을 글자로 또 적었다 — 한쪽을 다듬는 날 지우는 조건이 안 맞는다')
})

// ── **BGM 을 트는 길 셋이 모두 재생바에 알린다** (사용자 신고 2026-09-16) ────────────
//
// *"배경음악 메인에, 일시정지 스페이스바로 안되는 버그"*
//
// 재생바는 `갈래`(broadcast/bgm/video)가 없으면 **키 처리기를 아예 안 건다**
// (`if (!갈래) return undefined`). 그래서 「알리지 않는 길」이 하나라도 있으면
// 그 길로 튼 소리에서는 **스페이스바가 죽은 것처럼 보인다** — 실제로는 처음부터
// 듣고 있지 않은 것이다.
//
// 길은 셋이고, 2026-09-16 까지 **수동 유튜브만 빠져 있었다**:
//   · 예약·자동방송 BGM → `carecast:broadcast-bgm-start`
//   · 음원 파일(MusicPlayer) → `postNowPlaying({ bgm })`
//   · **사람이 직접 튼 유튜브** → `carecast:manual-bgm-src` (재생바가 안 듣고 있었다)
// 2026-09-21: 사람이 트는 BGM 도 이 PC 음원이라 **재생기 하나(MusicPlayer)** 가 낸다. 예전의 「수동 외부
// 동영상 BGM」 전용 신호(manual-bgm-src)는 걷었다. 그 대신 재생기가 **시작(제목)과 멎음을 늘 알린다.**
test('**배경음악 재생기가 재생바에 시작·멎음을 알린다** — 안 알리면 스페이스바가 안 걸리고 바가 안 사라진다', () => {
  const mp = 읽기('src/components/easy/MusicPlayer.jsx')
  assert.match(mp, /carecast:broadcast-bgm-start[\s\S]{0,120}title:/,
    'BGM 시작 신호에 제목이 없다 — 재생바가 무엇이 나가는지 모른다')
  assert.match(mp, /carecast:broadcast-bgm-stopped/,
    'BGM 이 멎었다는 통지를 안 낸다 — 재생바의 파란 바가 서버 폴링(3초)까지 남는다')
  const bar = 읽기('src/components/easy/NowPlayingBar.jsx')
  assert.match(bar, /addEventListener\('carecast:broadcast-bgm-start'/, '재생바가 BGM 시작을 안 듣는다')
  assert.match(bar, /addEventListener\('carecast:broadcast-bgm-stopped'/, '재생바가 BGM 멎음을 안 듣는다')
})


// ── **시작·끝이 몇 ms 차이로 와도 안 굳는다** (2026-09-17 브라우저 전수 시험) ─────────────────
// 재생이 곧바로 거절되면 `tts_speak` 시작·끝이 거의 동시에 온다. 끝 처리가 `setSt` 반영 전의 참조를 읽어
// 「방송 없음」으로 돌아갔고, 뒤늦게 닿은 시작 보고가 서버에 「즉시 방송」을 3분 넘게 남겼다(실측).
test('**재생바 보고는 참조를 그 자리에서 고치고, 서버에는 보낸 순서대로 닿는다**', () => {
  const 바 = 읽기('src/components/easy/NowPlayingBar.jsx').replace(/^\s*\/\/.*$/gm, '')
  const i = 바.indexOf('const report = (patch) => {')
  assert.ok(i >= 0, 'report 가 없다')
  const 몸 = 바.slice(i, 바.indexOf('\n    }', i))
  assert.match(몸, /stRef\.current = \{ \.\.\.stRef\.current, \.\.\.patch \}/, '참조를 그 자리에서 안 고친다 — 바로 뒤 끝 신호가 옛 값을 본다')
  assert.ok(몸.indexOf('stRef.current =') < 몸.indexOf('postNowPlaying'), '보고보다 참조 갱신이 먼저여야 한다')
  assert.match(몸, /보고줄\.current = 보고줄\.current\.then\(\(\) => postNowPlaying\(patch\)\)/, '서버 보고를 줄 세우지 않는다 — 시작 보고가 끝 보고보다 늦게 닿을 수 있다')
  assert.doesNotMatch(몸, /^\s*postNowPlaying\(patch\)/m, '줄 밖에서 따로 보고한다')
})
