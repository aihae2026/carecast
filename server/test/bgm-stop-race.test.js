// **정지 신호가 시작보다 먼저 와도 반주가 안 남는다** (V③ R10 지적, 2026-09-14).
//
// ── 무엇이 남아 있었나 ──────────────────────────────────────────────────────
// 즉시 방송이 반주를 깔고 **안내 재생이 곧바로 실패**하면 서버가 바로 `bgm_stop` 을 쏜다.
// 그런데 화면은 반주를 **350ms 뒤에** 켠다(2026-09-21 부터는 `MusicPlayer.jsx` 의 시작 타이머 —
// 반주가 이 PC 음원이 되면서 재생기가 바뀌었다. 예전엔 훅이 외부 동영상 반주를 350ms 뒤에 켰다).
// 정지가 그 사이에 도착하면 **정지한 뒤에 반주가 켜지고 영영 안 꺼진다** —
// 길이를 0 으로 보내서 자동 종료 타이머도 안 선다.
//
// **서버만 고쳐서는 못 닫히는 자리였다.** R9 에서 서버 콜백은 고쳤는데 수신부가 남아 있었다.
//
// ── 이 파일이 보는 것 ────────────────────────────────────────────────────────
// 걷는 함수(`clearBgmTimers`)는 **이미 있었다.** 그 머리말이 같은 사고를 적어 두기까지 했다
// (EV-004783). 빠진 것은 **부르는 자리**였다 — `bgm_stop` 이 그 함수에 안 닿았다.
// 그러므로 여기서 보는 것은 「걷는 함수가 있나」가 아니라 **「정지가 그 함수를 부르나」**다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 벗김 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const 재생기 = 벗김(fs.readFileSync(path.join(ROOT, 'src/components/easy/MusicPlayer.jsx'), 'utf8'))
const 코드 = 벗김(fs.readFileSync(path.join(ROOT, 'src/hooks/useScheduledBroadcast.js'), 'utf8'))

test('긍정 앵커 — 시작은 **350ms 뒤**로 미뤄져 있다(그래서 경쟁이 생긴다)', () => {
  assert.match(재생기, /bgmStartDelayRef\.current = setTimeout\(/, 'BGM 시작 타이머가 없다')
  assert.match(재생기, /\}, 350\)/, '350ms 지연이 없다 — 이 시험의 전제가 바뀌었다')
})

test('정지 함수가 **걸린 시작 타이머를 걷는다** — 안 걷으면 정지 뒤에 반주가 켜진다', () => {
  const i = 재생기.indexOf('const stopBGM = () => {')
  assert.ok(i > 0, '긍정 앵커 — 재생기의 정지 함수를 못 찾았다')
  const 본문 = 재생기.slice(i, 재생기.indexOf('\n    }', i))
  assert.match(본문, /clearTimeout\(bgmStartDelayRef\.current\)/, '정지 함수가 시작 타이머를 안 걷는다')
})

test('**`bgm_stop` 이 그 정지 함수를 부른다** — 빠진 것은 부르는 자리였다', () => {
  assert.match(재생기, /es\.addEventListener\('bgm_stop', \(\) => \{\s*stopBGM\(\)/,
    "`bgm_stop` 을 받고도 걸린 시작 타이머를 안 걷는다 — 정지 뒤에 반주가 켜져 영영 안 꺼진다")
})

test('정지는 **리더가 아닌 창에서도** 걷힌다 — 타이머는 창마다 걸린다', () => {
  // 시작은 리더 창에서만 걸리지만 리더 판정은 **바뀔 수 있다**(담당 교체). 정지 처리에 리더 게이트가
  // 끼어 있으면 안 걷히는 창이 생긴다.
  const i = 재생기.indexOf("es.addEventListener('bgm_stop'")
  const 처리 = 재생기.slice(i, 재생기.indexOf('})', i))
  assert.ok(!/CC_IS_LEADER/.test(처리), '정지 처리가 리더 게이트 안에 있다 — 한쪽만 도는 창이 생겨 반주가 남는다')
})

test('예약 안내의 반주를 쥔 훅도 `bgm_stop` 에서 제 타이머를 걷는다 — 걷는 자리는 하나', () => {
  const 걷기 = [...코드.matchAll(/const clearBgmTimers = \(\) => \{/g)]
  assert.equal(걷기.length, 1, `걷는 함수가 ${걷기.length}개다 — 둘이면 한쪽만 걷는다`)
  assert.match(코드, /const stopBGM = \(\) => \{\s*clearBgmTimers\(\)/, '정지 함수가 타이머를 안 걷는다')
  assert.match(코드, /if \(type === 'bgm_stop'\) \{ stopBGM\(\); return \}/, '훅이 bgm_stop 을 안 받는다')
})

// ── **구독하지 않으면 분기는 한 번도 안 돈다** (V③ R11 지적, 2026-09-14) ─────────────
// 위 시험들은 훅에 `bgm_stop` 분기가 **있는지**를 봤다. 그런데 `initSSE` 의 구독 목록에
// 그 이름이 없으면 **그 분기는 한 번도 안 돈다.** 실제로 그랬다 — 분기를 넣어 놓고
// 구독 한 줄을 빠뜨렸고, **이 파일의 시험 넷이 전부 통과했다.**
//
// 이것이 이 검수에서 되풀이된 모양 그대로다: **글자로 비교했다.**
// 그래서 여기서는 **배달되는지**를 본다 — 구독 목록에 그 이름이 실제로 있는가.
test('**`bgm_stop` 이 구독 목록에 있다** — 없으면 분기가 한 번도 안 돈다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  const i = api.indexOf('export function initSSE')
  assert.ok(i > 0, '긍정 앵커 — initSSE 를 못 찾았다')
  const 목록 = api.slice(i, i + 3000)
  // 긍정 앵커: 예약 안내(반주를 실어 오는 신호)는 구독하고 있다
  assert.match(목록, /addEventListener\('scheduled_broadcast'/,
    '예약 안내조차 구독 안 한다 — 이 시험의 전제가 깨졌다')
  assert.match(목록, /addEventListener\('bgm_stop'/,
    '정지를 구독하지 않는다 — 훅의 분기가 한 번도 안 돌아 반주가 영영 안 꺼진다')
})

test('켜는 것과 끄는 것이 **같은 통로**로 온다 — 한쪽만 다른 길이면 짝이 안 맞는다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  const i = api.indexOf('export function initSSE')
  const 목록 = api.slice(i, i + 3000)
  const 시작 = 목록.indexOf("addEventListener('scheduled_broadcast'")
  const 정지 = 목록.indexOf("addEventListener('bgm_stop'")
  assert.ok(시작 > 0 && 정지 > 0, '둘 중 하나가 없다')
  // 같은 `handle()` 통로를 쓰는가 — 한쪽만 다른 처리로 가면 훅이 못 받는다
  const 정지줄 = 목록.slice(정지, 목록.indexOf(')', 정지) + 60)
  assert.match(정지줄, /handle\('bgm_stop'\)/, '정지가 다른 통로로 간다 — 훅이 못 받는다')
})

test('**띠가 사라질 때 구독을 놓는다** — 없는 함수를 부르면 정리가 통째로 안 돈다', () => {
  const 띠 = fs.readFileSync(path.join(ROOT, 'src/components/shared/SiteScreenWarning.jsx'), 'utf8')
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  // 공용 통로가 무엇을 주는지부터 본다 — 시험이 화면만 보면 계약이 바뀐 것을 못 본다
  const j = api.indexOf('export function openSSEBus')
  const 통로 = api.slice(j, j + 400)
  assert.doesNotMatch(통로, /removeEventListener/,
    'openSSEBus 가 removeEventListener 를 주기 시작했다 — 화면 쪽 정리도 다시 볼 것')
  assert.doesNotMatch(띠.replace(/\/\*[\s\S]*?\*\//g, ''), /es\.removeEventListener/,
    '없는 함수를 부른다 — 정리 함수가 던지고 구독이 그대로 남는다')
  assert.match(띠, /return \(\) => es\.close\(\)/, '구독을 놓는 자리가 없다')
})

// ── **끄는 중에 곡이 끝나도 다음 곡으로 넘기지 않는다** (브라우저 시험 2026-09-22) ──────────
// 정지는 4초 페이드 뒤에 멈추고 「멈췄다」는 처음에 알린다. 그 사이 곡이 끝나면 `ended` 가 다음 곡을
// 틀어 2초쯤 소리가 나다 끊겼고, 마지막 알림이 「재생 시작」으로 남아 **소리 없이 카드·재생바·서버가
// 「재생 중」**이었다(곡 끝 0.6초 전 정지로 세 번 다 재현). 멈춤 예약(bgmStopRef)이 끄는 중 표시다.
test('끄는 중(bgmStopRef)에 곡이 끝나면 다음 곡을 틀지 않는다 — 소리 없는 「재생 중」이 남는다', () => {
  const i = 재생기.indexOf("audio.addEventListener('ended'")
  assert.ok(i > 0, '긍정 앵커 — 곡 종료 처리기를 못 찾았다')
  const 끝 = 재생기.indexOf('const next = (idx + 1) % playlist.length', i)
  assert.ok(끝 > i, '긍정 앵커 — 다음 곡으로 넘기는 자리를 못 찾았다')
  const 앞 = 재생기.slice(재생기.lastIndexOf('if (playlist.length > 1)', 끝) - 200, 재생기.lastIndexOf('if (playlist.length > 1)', 끝))
  assert.match(앞, /if \(bgmStopRef\.current\) return/,
    '다음 곡으로 넘기기 전에 끄는 중인지 안 본다 — 정지 페이드 중에 곡이 끝나면 다음 곡이 켜진다')
})
