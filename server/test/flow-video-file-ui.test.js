// 흐름/커스텀 자동순서에 "업로드 영상" 단계를 넣을 수 있다 (2026-09-03 실기 신고).
//
// 실행기(flowRunner)는 step_type='video_file'을 처음부터 지원했다 — 재생목록·배속·볼륨·
// 종료 대기까지(flow-sequences.test.js가 고정). 그런데 **저장 검증(VALID_STEP_TYPES)과
// 편집기(FlowBuilder)에만 빠져 있어서**, 커스텀 자동순서에 음원은 넣을 수 있는데 업로드
// 영상은 넣을 방법이 없었다. "서버는 되는데 화면이 없는" 반쪽 — CC-053이 볼륨에서 겪은
// 것과 반대 방향의 같은 병.
//
// 고정하는 사실:
//  1. 저장 검증이 video_file을 받는다 (모르는 유형은 여전히 거부)
//  2. 편집기(FlowBuilder)에 업로드 영상 단계 버튼이 있고, 업로드 파일(source_type='upload')만 고른다
//  3. 미리보기(FlowStepsPreview)가 쓰는 라벨·요약 표에도 video_file이 있다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

test('저장 검증이 video_file 단계를 받는다 — 실행기가 지원하는 유형을 저장이 막으면 안 된다', () => {
  const { validateSteps } = require('../routes/flows')
  assert.equal(validateSteps([{ step_type: 'video_file', config: { audio_file_id: 1 } }]), null,
    'video_file 단계가 저장에서 거부된다 — 실행기(flowRunner:265)는 지원하는데 넣을 방법이 없다')
  assert.match(String(validateSteps([{ step_type: '없는유형', config: {} }])), /유효하지 않은/,
    '모르는 유형까지 열렸다 — 검증이 통째로 사라진 것이다')
})

test('편집기에 업로드 영상 단계가 있고, 업로드 파일만 고른다', () => {
  const src = read('src/components/shared/FlowBuilder.jsx')
  assert.ok(src.includes("value: 'video_file'"),
    'FlowBuilder STEP_TYPES에 업로드 영상이 없다 — 커스텀 자동순서에 영상을 넣을 방법이 없다')
  // 파일 이름이 있는 영상만 — 파일 없는 옛 링크 행이 섞이면 video_play 가 틀 수 없는 것을 고른다.
  // (2026-09-21 전에는 `source_type === 'upload'` 로 걸렀는데 **맞는 행이 없어** 목록이 늘 비었다.)
  assert.match(src, /video_file[\s\S]{0,700}VIDEO_CATEGORIES\.includes\(af\.category\) && af\.filename/,
    'video_file 단계가 이 PC 에 파일이 있는 영상으로 거르지 않는다 — video_play 가 틀 수 없는 것을 고른다')
})

test('미리보기 라벨·요약 표에도 video_file이 있다 — 편집기에서 넣었는데 미리보기가 이름을 모르면 안 된다', () => {
  const src = read('src/components/admin/sections/morningEditorConst.js')
  assert.match(src, /FLOW_STEP_LABEL\s*=\s*\{[^}]*video_file/,
    'FLOW_STEP_LABEL에 video_file이 없다 — 커스텀 자동순서 미리보기에 "video_file"이라는 날 이름이 뜬다')
  assert.match(src, /step_type === 'video_file'/,
    'flowStepSummary가 video_file을 모른다 — 요약 칸이 빈다')
})
