// 미리듣기를 **끄는 방법이 화면에 보여야 한다** (2026-09-03 실기 신고: "미리듣기하면 못 끄잖아").
//
// 원인: 단계 행의 버튼은 `previewingId === step.id`일 때만 '재생중'으로 바뀐다. 그런데
// **BGM 단계는 그 경로를 안 탄다** — 구간 묶음 미리듣기라 startPreviewAll이 돌고
// previewAll만 채워진다(previewingId는 null). 그래서 소리는 나는데 버튼은 계속
// '미리듣기'라 사람이 멈추는 방법을 못 찾았다. 누르면 실제로 꺼지긴 했다(handleRowPreview의
// 켜져있음 판정은 previewAll을 본다) — **화면이 거짓말을 한 것이지 기능이 없던 게 아니다.**
//
// 고정하는 사실:
//  1. 행 버튼의 '재생중' 판정이 previewingId와 previewAll 구간을 **둘 다** 본다
//  2. 재생 중일 때 라벨이 멈춤을 뜻하는 말로 바뀐다(사람이 끌 수 있다는 것을 안다)
//  3. 전체 미리듣기 패널의 멈춤 버튼은 그대로 있다(회귀 방지)
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const SRC = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'StepList.jsx')
const src = () => fs.readFileSync(SRC, 'utf8')

test('행 버튼의 재생 판정이 previewingId와 구간 묶음(previewAll)을 둘 다 본다', () => {
  const s = src()
  assert.match(s, /const rowPlaying/,
    '행이 재생 중인지 판정하는 이름이 없다 — previewingId만 보면 BGM 구간 미리듣기가 화면에 안 잡힌다')
  const i = s.indexOf('const rowPlaying')
  const block = s.slice(i, i + 400)
  assert.ok(block.includes('previewingId') && block.includes('previewSpanId'),
    'rowPlaying이 두 갈래(단일 재생·구간 묶음)를 함께 보지 않는다')
})

test('재생 중인 행은 멈춤이라고 말한다 — 누를 수 있다는 것을 사람이 알아야 한다', () => {
  const s = src()
  assert.match(s, /rowPlaying \? '멈춤/,
    "재생 중 라벨이 '멈춤'이 아니다 — 사람이 그 버튼으로 끌 수 있다는 것을 모른다")
})

test('전체 미리듣기 패널의 멈춤 버튼은 그대로다 (회귀)', () => {
  const s = src()
  assert.match(s, /onClick=\{stopPreviewAll\}/, '전체 미리듣기 멈춤 버튼이 사라졌다')
  assert.match(s, /멈춤 ■/, '멈춤 버튼 라벨이 사라졌다')
})
