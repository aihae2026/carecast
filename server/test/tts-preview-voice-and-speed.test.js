// 목소리 미리듣기와 느린 속도 (사용자 지시 2026-09-22).
//
//   1) 「미리듣기면 토글에 있는 여성·남성 12345 가 나와야」 — 미리듣기 요청에 **지금 고른 화자(sid)** 가 실린다.
//      전에는 api.js 가 sid 를 빼먹어 저장된 목소리만 나왔다
//   2) 「0.6x 로 하니까 끊김」 — 이 PC 음성은 0.8 보다 느리게 만들면 낱말 사이가 1~2초 비었다(실측).
//      합성은 0.8 아래로 내려가지 않는다 · 0.8 이상 값의 캐시 열쇠는 전과 같다
//   3) 0.8 아래로 저장돼 있던 값은 열쇠에 표시가 붙어 **예전 끊기는 녹음을 다시 쓰지 않는다**
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const sup = require('../services/ttsEngines/supertonic')

test('1) 미리듣기 요청에 sid 가 실린다 — 화면이 고른 화자가 그대로 나간다', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/lib/api.js'), 'utf8')
  const m = /export async function ttsPreview\(([^)]*)\)[\s\S]*?body:\s*JSON\.stringify\(([^\n]*)\)/.exec(src)
  assert.ok(m, 'ttsPreview 를 못 찾았다')
  assert.ok(/\bsid\b/.test(m[1]), 'ttsPreview 가 sid 를 받지 않는다')
  assert.ok(/\bsid\b/.test(m[2]), 'ttsPreview 가 sid 를 서버로 보내지 않는다 — 저장된 목소리만 나온다')
})

test('2) 합성 속도는 0.8 아래로 내려가지 않는다', () => {
  assert.equal(sup.가장느린속도, 0.8)
  assert.equal(sup.speedFromRate(0.6), 0.8)
  assert.equal(sup.speedFromRate(0.8), 0.8)
  assert.equal(sup.speedFromRate(1.2), 1.2)
  assert.equal(sup.speedFromRate(5), 2)
})

test('3) 캐시 열쇠 — 0.8 이상은 전과 같고, 0.8 아래는 표시가 붙는다', () => {
  for (const r of [0.8, 0.9, 1, 1.5, 2]) assert.equal(sup.속도소금(r), '', `${r} 의 열쇠가 바뀌었다 — 만들어 둔 음성을 다시 만든다`)
  for (const r of [0.5, 0.6, 0.79]) assert.notEqual(sup.속도소금(r), '', `${r} 가 예전 끊기는 녹음을 다시 쓴다`)
})
