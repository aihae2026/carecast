// 자동방송순서편집기 화면의 소스 전체.
//
// 왜 필요했나(2026-09-01): 이 화면은 원래 MorningEditor.jsx 한 파일(2848줄)이었고, 소스를
// 읽어 규칙을 고정하는 테스트 11개가 그 경로를 직접 적고 있었다. TD-10으로 파일을 넷으로
// 가르자 **동작은 그대로인데 테스트 14건이 빨간불**이 됐다 — 마크업이 StepList.jsx로
// 옮겨갔을 뿐인데 테스트는 옛 파일만 봤기 때문이다.
//
// 그래서 "편집기 화면의 소스"를 한 곳에서 정의한다. 다음에 또 조각내도 여기만 고치면 된다.
'use strict'

const fs   = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', '..', '..', 'src', 'components', 'admin', 'sections')
// 2026-09-05: MorningEditor에서 부품이 morningEditorPanels.jsx로 갈려 나갔다. 목록에 안 넣으면
// 이 연결본을 보는 가드 여럿이 개수 0으로 조용히 헐거워진다.
const FILES = ['MorningEditor.jsx', 'StepList.jsx', 'morningEditorParts.jsx', 'morningEditorConst.js', 'morningEditorPanels.jsx']

/** 네 파일을 이어 붙인 소스. 파일이 하나라도 없으면 던진다 — 조용히 줄어들면 검사가 헐거워진다. */
function editorSource() {
  return FILES.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n')
}

module.exports = { editorSource, EDITOR_FILES: FILES, EDITOR_DIR: DIR }
