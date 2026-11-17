'use strict'
// **자동순서 목록은 「자동 방송」 스위치를 끈 방송도 「안 나감」으로 보인다** (2026-09-17 브라우저 전수 시험)
//
// 목록은 시각을 비운 경우만 꺼짐으로 봤다. 그래서 스위치를 끄고 저장한 국민체조가 「09:00 국민체조」로
// 멀쩡히 보였다 — 간편 화면 오늘 목록에서는 빠졌는데. 이 화면 스스로 「가장 비싼 오독」이라 적어 둔 모양이다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const 원문 = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'MorningEditor.jsx'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')

test('목록의 꺼짐 판정이 시각 비움과 스위치 끔을 둘 다 본다', () => {
  const 줄 = 원문.match(/const 꺼짐 = ([^\n]+)/)
  assert.ok(줄, '목록의 꺼짐 판정이 없다')
  assert.match(줄[1], /time === '꺼짐'/, '시각을 비운 경우를 안 본다')
  assert.match(줄[1], /settings\?\.\[t\.id\]\?\.enabled === false/, '스위치를 끈 경우를 안 본다 — 끈 방송이 나가는 것처럼 보인다')
  // 스위치가 저장하는 칸과 목록이 읽는 칸이 같은 이름이어야 한다
  assert.match(원문, /updateTab\(activeTab, \{ enabled: v \}\)/, '스위치가 enabled 칸에 저장하지 않는다')
})
