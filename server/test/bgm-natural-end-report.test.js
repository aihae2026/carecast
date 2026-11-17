// **BGM 이 저절로 끝나거나 곡이 넘어가도 서버 상태가 따라간다** (Codex 3단계 2회차 Medium, 2026-09-21).
//
// 멈추기·시작 경로만 `now-playing` 에 보고했더니, 1곡짜리가 끝까지 돌고 멎어도 서버는 「재생 중」,
// 다음 곡으로 넘어가도 첫 곡 이름이었다. 그 값을 배경음악 카드(원격 PC 의 멈추기 단추)와
// 서버 차임 판단(chimePlayer 부수차임막힘)이 읽는다 — 카드엔 멈추기가 남고, 즉시 안내의 차임이 빠졌다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 벗김 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const 재생기 = 벗김(fs.readFileSync(path.join(ROOT, 'src/components/easy/MusicPlayer.jsx'), 'utf8'))

function 함수본문(src, 머리) {
  const i = src.indexOf(머리)
  assert.ok(i >= 0, `긍정 앵커 — 「${머리}」를 못 찾았다`)
  return src.slice(i, src.indexOf('\n}', i))
}

test('알림 함수 둘이 서버 상태를 직접 고친다', () => {
  assert.match(함수본문(재생기, 'function BGM곡알림('), /postNowPlaying\(\{ bgm: \{ title \} \}\)/)
  const 끝 = 함수본문(재생기, 'function BGM끝알림(')
  assert.match(끝, /postNowPlaying\(\{ bgm: null \}\)/)
  assert.match(끝, /carecast:local-bgm-stopped/, '같은 창의 카드도 알아야 한다')
})

test('곡이 끝났을 때 — 다음 곡이면 곡알림, 한 곡뿐이면 끝알림', () => {
  const i = 재생기.indexOf("audio.addEventListener('ended'")
  assert.ok(i > 0, '긍정 앵커 — 곡 끝 처리기를 못 찾았다')
  const 끝처리 = 재생기.slice(i, 재생기.indexOf("audio.addEventListener('timeupdate'", i))
  const 다음곡 = 끝처리.slice(끝처리.indexOf('if (playlist.length > 1)'))
  assert.match(다음곡, /playURL\(playlist\[next\]\.url, playlist\[next\]\.name\)\s*BGM곡알림\(playlist\[next\]\.name, \{ 화면: !playRef\.current\.owner \}\)/,
    '곡이 넘어갔는데 서버는 앞 곡 이름을 든다')
  assert.match(다음곡, /else \{[\s\S]*?BGM끝알림\(\{ 화면: !playRef\.current\.owner \}\)/, '한 곡이 끝나 멎었는데 서버는 「재생 중」이다')
})

test('다음 곡 단추도 곡알림을 낸다', () => {
  const 본문 = 재생기.slice(재생기.indexOf('const skipNext = () => {'), 재생기.indexOf('\n  }', 재생기.indexOf('const skipNext = () => {')))
  assert.match(본문, /BGM곡알림\(playlist\[next\]\.name, \{ 화면: !playRef\.current\.owner \}\)/)
})

test('방송이 깐 반주(owner)면 화면 제목은 안 건드린다 — 보고는 그대로 (Codex 3단계 3회차 Low)', () => {
  const 곡 = 함수본문(재생기, 'function BGM곡알림(')
  const 끝 = 함수본문(재생기, 'function BGM끝알림(')
  for (const [이름, 본문] of [['곡알림', 곡], ['끝알림', 끝]]) {
    assert.match(본문, /if \(화면\) window\.dispatchEvent\(new CustomEvent\('carecast:overlay-update'/, `${이름}: 화면 제목을 늘 덮는다`)
    assert.match(본문, /postNowPlaying/, `${이름}: 서버 보고가 빠졌다`)
  }
})
