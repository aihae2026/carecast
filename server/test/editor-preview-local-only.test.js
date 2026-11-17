// 자동방송 순서편집기의 단계 미리듣기는 **누른 그 PC에서만** 소리가 나야 한다.
//
// 사용자 지시(2026-08-31): "미리듣기는 절대 절대 현장 PC에 신호를 보내면 안 돼, 방송 되니까."
// 원격 PC에서 순서를 다듬으면서 확인하는 기능인데, 여기서 SSE를 타는 API를 하나라도 부르면
// **홀에 실제 방송이 나간다.** 되돌릴 수 없는 사고이고, 화면만 봐서는 눌러보기 전엔 모른다.
//
// 그래서 소스 대조로 고정한다. 안전한 길은 셋뿐이다:
//   · GET /audio/...        정적 파일 — 이 브라우저가 받아서 이 브라우저가 튼다
//   · POST /api/tts/preview mp3 바이트를 요청한 쪽에만 돌려준다(broadcastSSE 없음)
//   · 브라우저 WebAudio 차임 — 서버 차임(carecast_chime.py)은 현장 스피커로 나간다
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { editorSource } = require('./helpers/editorSource')

const ROOT = path.join(__dirname, '..', '..')
const editorSrc = editorSource()

// 부르면 현장 PC가 소리를 내는 것들.
//
// 이 파일에는 **의도된** 실제 방송 버튼("지금 방송")도 있다 — 그건 사람이 그렇게 하라고
// 누르는 것이라 정당하다. 그래서 파일 전체가 아니라 **미리듣기 구역만** 본다.
const FORBIDDEN = [
  ['/api/mic/chime',      '서버 차임 — 현장 PC 스피커로 나간다'],
  ['/api/tts/broadcast',  '즉시 방송 — 그대로 홀에 나간다'],
  ['ttsBroadcast',        '즉시 방송 래퍼'],
  ['triggerSchedule',     '예약 수동 실행 — 진짜 방송이 나간다'],
  ['triggerMorning',      '아침방송 실행'],
  ['broadcastSSE',        '현장 화면에 재생을 지시한다'],
]

// 미리듣기 함수들이 모여 있는 구역. 표시가 사라졌으면 테스트가 먼저 실패해서 알려준다.
function previewRegion() {
  const start = editorSrc.indexOf('── 단계 미리듣기')
  const end   = editorSrc.indexOf('// TTS 내용을 인라인에서 보여줄 단계 판별', start)
  assert.ok(start !== -1 && end > start,
    '미리듣기 구역 표시를 못 찾았다 — 구역이 옮겨졌으면 이 가드도 따라가야 한다')
  return editorSrc.slice(start, end)
}

test('미리듣기 구역에 현장으로 소리를 내보내는 호출이 없다', () => {
  const region = previewRegion()
  for (const [needle, why] of FORBIDDEN) {
    assert.ok(!region.includes(needle),
      `미리듣기가 ${needle}를 부른다 — ${why}. 미리듣기가 곧 실제 방송이 된다.`)
  }
})

test('미리듣기는 정적 파일·tts preview·브라우저 차임만 쓴다', () => {
  assert.ok(editorSrc.includes('playBrowserChime'),
    '차임 미리듣기가 브라우저 합성이 아니면 현장 스피커가 울린다')
  assert.ok(editorSrc.includes('ttsPreview'), 'TTS 미리듣기 경로가 없다')
  assert.ok(editorSrc.includes('/audio/'), '음원·영상 미리듣기가 정적 파일을 안 쓴다')
})

test('TTS 미리듣기 라우트는 아무에게도 방송하지 않는다', () => {
  const ttsSrc = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'tts.js'), 'utf8')
  const start = ttsSrc.indexOf("router.post('/preview'")
  const end   = ttsSrc.indexOf('router.', start + 10)
  const body  = ttsSrc.slice(start, end)
  assert.ok(start !== -1, '/api/tts/preview가 없다')
  assert.ok(!body.includes('broadcastSSE'), '미리듣기가 SSE를 쏘면 현장 화면이 재생을 시작한다')
  assert.ok(!body.includes('playChime') && !body.includes('enqueue'),
    '미리듣기가 서버 스피커 경로를 타면 홀에 소리가 난다')
})

test('브라우저 차임은 한 벌만 있다 — 화면마다 다른 소리가 나면 안 된다', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'browserChime.js'), 'utf8')
  assert.ok(lib.includes('export function playBrowserChime'))
  const mini = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'easy', 'ScheduledBroadcastMini.jsx'), 'utf8')
  assert.ok(mini.includes("from '../../lib/browserChime'"), '사본이 남아 있다')
  assert.ok(!/function playBrowserChime/.test(mini), '사본이 남아 있다')
})
