// 화면이 넓은 모니터에서 가로로 퍼지지 않는가 (2026-09-11 사용자 지적).
//
// 무엇을 막나: 관리자 화면 본문에 **최대 폭이 없었다.** 중단점(390·834·1024·1440)만 있고
// 그 위로는 내용이 그냥 늘어나서, 넓은 모니터에서 카드 한 줄이 너무 길어 읽기 불편했다.
// 쉬운 화면(`SimpleMode`)은 이미 제 폭을 묶고 있었다 — 관리자 화면만 빠져 있었다.
//
// 이 검사는 **최대 폭을 정하는 자리가 하나인지**를 본다. 화면마다 적으면 섹션을 하나
// 추가할 때 또 어긋난다(FP-0005 와 같은 모양).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

const CSS   = 읽기('src', 'index.css')
const ADMIN = 읽기('src', 'pages', 'AdminMode.jsx')
const SIMPLE = 읽기('src', 'pages', 'SimpleMode.jsx')

test('최대 폭 규칙이 CSS 한 곳에 있다', () => {
  assert.match(CSS, /\.page-shell\s*\{/, 'page-shell 유틸리티가 사라졌다 — 이 가드를 옮길 것')
  assert.match(CSS, /max-w-\[1180px\]/, 'page-shell 이 최대 폭을 안 정한다')
  assert.match(CSS, /mx-auto/, '최대 폭만 정하고 가운데 정렬이 없으면 왼쪽에 몰린다')
})

test('관리자 화면 본문이 그 규칙을 쓴다', () => {
  assert.match(ADMIN, /<main/, '긍정 앵커 — 이 파일이 관리자 화면 껍데기가 맞다')
  assert.match(ADMIN, /page-shell/,
    '관리자 본문이 최대 폭을 안 쓴다 — 넓은 모니터에서 카드가 가로로 퍼진다')
})

test('폭을 화면마다 따로 적지 않는다 — 관리자 껍데기에 숫자를 박지 않는다', () => {
  assert.doesNotMatch(ADMIN, /max-w-\[\d+px\]/,
    '관리자 껍데기가 최대 폭 숫자를 직접 들고 있다 — page-shell 과 갈린다')
})

test('쉬운 화면의 제 규칙은 건드리지 않았다 — 두 화면은 판이 다르다', () => {
  assert.match(SIMPLE, /max-w-\[834px\]/,
    '쉬운 화면의 폭 규칙이 사라졌다. 그쪽은 세로로 쌓는 동안 834, wide 에서 1440 이다')
  assert.match(SIMPLE, /wide:max-w-\[1440px\]/)
})
