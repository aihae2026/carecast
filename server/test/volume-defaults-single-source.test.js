'use strict'
// UX-39 — **화면마다 기본값이 다르면 안 된다** (2026-09-11).
//
// 요구: *"시스템 설정 · 초기 설정 · 음량 및 TTS 화면이 같은 설정 상태와 검증을 공유한다.
// 화면마다 기본값이 다르거나 **0·빈 값이 기본값으로 되돌아가는 회귀를 만들지 않는다**"*.
//
// 실제로 갈라져 있었다 — 음량 패널은 자기 표(`볼륨기본값`)를 들고, 오디오 설정 화면은
// `?? 70`·`?? 30`·`?? 85` 를 **각자 박고** 있었다. 2026-08-28 볼륨 사고와 같은 모양이다
// (기본값이 8곳에 흩어져 한 곳만 고쳐졌고, 화면에 보이는 값과 나가는 소리가 달랐다).
//
// 화면은 서버 모듈을 못 읽으므로(브라우저) 사본이 **하나** 필요하다. 사본이 갈리는 것은
// 사람 규율로 막지 않는다 — 이 검사가 서버 `CHANNELS[*].fallback` 과 줄 단위로 대조한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const UI = fs.readFileSync(path.join(ROOT, 'src/lib/volumeDefaults.js'), 'utf8')
const { CHANNELS } = (() => {
  // 서버 모듈은 그대로 require 한다 — 여기서 숫자를 옮겨 적으면 이 검사 자체가 사본이 된다.
  const m = require(path.join(ROOT, 'server/domain/volume'))
  return { CHANNELS: m.CHANNELS || m.__test__?.CHANNELS || null }
})()

const 화면값 = (() => {
  const m = /export const 볼륨기본값 = \{([\s\S]*?)\}/.exec(UI)
  assert.ok(m, '화면 기본값 표를 못 찾았다 — 이 가드를 옮길 것')
  const out = {}
  for (const [, k, v] of m[1].matchAll(/(\w+):\s*(\d+)/g)) out[k] = Number(v)
  return out
})()

test('서버가 채널 정의를 내보낸다 — 못 읽으면 이 검사는 아무것도 안 본다', () => {
  assert.ok(CHANNELS, 'server/domain/volume 이 CHANNELS 를 안 내보낸다 — 대조할 수가 없다')
  // (TV 송출 채널을 2026-09-21 걷어내 다섯이다)
  assert.ok(Object.keys(CHANNELS).length >= 5, `채널이 너무 적다: ${Object.keys(CHANNELS)}`)
})

test('화면 기본값이 서버 fallback 과 한 줄도 안 다르다', () => {
  for (const [이름, ch] of Object.entries(CHANNELS)) {
    assert.equal(화면값[이름], ch.fallback,
      `'${이름}' 기본값이 갈렸다 — 화면 ${화면값[이름]} / 서버 ${ch.fallback}. ` +
      '화면에 보이는 값과 실제로 나가는 소리가 다르다(2026-08-28 사고).')
  }
})

test('화면이 서버에 없는 채널을 지어내지 않는다', () => {
  for (const 이름 of Object.keys(화면값)) {
    assert.ok(CHANNELS[이름], `'${이름}' 은 서버에 없는 채널이다 — 아무 데도 안 쓰이는 숫자다`)
  }
})

test('**화면들이 그 한 곳을 본다** — 각자 숫자를 박지 않는다', () => {
  // **목록은 「그 숫자를 쓰는 화면」을 따라간다.** 2026-09-16 에 「말로 쓰는 볼륨 표현」이
  // `systemSettingsAudio` 에서 떨어져 나와 음량 제어 밑으로 갔다(사용자 결정) — 그래서
  // 그 파일은 더 이상 기본값 표를 안 본다. 목록을 안 고치면 **없어진 대상을 지키느라**
  // 빨간불이 나고, 그러면 사람이 이 가드를 안 믿게 된다.
  const 화면들 = [
    'src/components/easy/VolumePanel.jsx',
    'src/components/admin/sections/systemSettingsVolumeWords.jsx',
  ]
  for (const rel of 화면들) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    // 긍정 앵커 — 이 파일이 정말 볼륨을 다루는가(없으면 아래 부정 단언이 헛돈다)
    assert.match(src, /볼륨기본값/, `${rel} 이 기본값 표를 안 쓴다`)
    assert.match(src, /from '.*lib\/volumeDefaults'/, `${rel} 이 단일 출처에서 안 가져온다`)
    // **서버가 준 값을 날숫자로 받치는 자리**만 본다.
    // 처음엔 `?? <숫자>` 를 통째로 잡았는데 `c.max ?? 100`(슬라이더 범위)까지 걸렸다 —
    // 오탐이다. 오탐은 불편이 아니라 **가드를 우회할 유인**이라 그 자리에서 좁힌다(헌장 §M11).
    // 지키려는 것은 그대로다: *서버 값이 없을 때 화면이 자기 숫자를 쓰지 않는가.*
    const 서버값 = '(?:master|tts|broadcast|audio|media|tv|bgm|bgmDefault|quiet|loud)'
    const 날숫자 = [...src.matchAll(new RegExp(`d\\.${서버값}\\s*(?:\\?\\?\\s*d\\.\\w+\\s*)?\\?\\?\\s*(\\d+)`, 'g'))]
      .map(x => x[0])
    assert.deepEqual(날숫자, [],
      `${rel} 에 서버 값의 기본값이 숫자로 박혀 있다: ${날숫자.join(' / ')} — 한 곳만 고치면 갈린다`)
  }
})

test('말로 쓰는 볼륨 기본값도 한 곳이다', () => {
  const m = /export const 말볼륨기본값 = \{([^}]*)\}/.exec(UI)
  assert.ok(m, '말 볼륨 기본값이 없다')
  assert.match(m[1], /quiet:\s*\d+/, '잔잔하게 기본값이 없다')
  assert.match(m[1], /loud:\s*\d+/, '크게 기본값이 없다')
})
