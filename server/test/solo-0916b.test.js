'use strict'
// **Codex 통합 검수 SOLO-0916B 의 Medium 셋** (2026-09-26) — 셋 다 「일시적 실패 뒤에 화면·설치가 제자리로
// 안 돌아온다」는 같은 모양이다. 소스를 읽어 고정한다(이 저장소의 화면 시험 방식).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('준비 안내는 그만 물을 때 띠도 내린다 — 5분 뒤 「지금 설정 중」이 새로고침까지 남지 않는다', () => {
  const src = 코드만(읽기('src/components/shared/WarmupNotice.jsx'))
  assert.match(src, /그만묻기ms/, '그만 묻는 상한이 없다 — 대상 앵커')
  // 계속 물을지와 띠를 띄울지를 **같은 조건**으로 정한다. 따로 두면 묻기는 멈추고 띠만 남는다.
  assert.match(src, /const 계속 = w\?\.running && Date\.now\(\) - 시작 < 그만묻기ms/, '계속 조건을 한 번만 정하지 않는다')
  assert.match(src, /set준비\(계속 \? w : null\)/, '그만 물을 때 띠를 안 내린다')
  assert.match(src, /if \(계속\) \{?\s*타이머 = setTimeout\(묻기/, '다시 묻는 조건이 띠 조건과 다르다')
})

test('방송 글자 크기는 첫 조회가 실패하면 다시 묻는다 — 기본 크기에 머물지 않는다', () => {
  const src = 코드만(읽기('src/hooks/useBroadcastTextScale.js'))
  assert.match(src, /getOrgInfo\(\)/, '설정을 읽지 않는다 — 대상 앵커')
  const 잡기 = src.slice(src.indexOf('.catch('), src.indexOf('.catch(') + 200)
  assert.match(잡기, /setTimeout\(/, '첫 조회 실패 뒤 다시 묻지 않는다 — 연결이 돌아와도 자막이 기본 크기에 머문다')
  assert.match(src, /clearTimeout\(/, '다시 묻는 타이머를 화면이 사라질 때 안 걷는다')
})

test('방화벽 bat 은 자기 경로를 PowerShell 문자열에 끼우지 않는다 — 경로에 작은따옴표가 있어도 관리자 실행이 된다', () => {
  const bat = 읽기('scripts/installer/CareCast-방화벽-열기.bat')
  assert.match(bat, /Start-Process/, '관리자 권한으로 다시 띄우는 줄이 없다 — 대상 앵커')
  assert.doesNotMatch(bat, /'%~f0'/, "경로를 '…' 안에 끼운다 — 폴더 이름에 ' 가 있으면 명령이 깨진다")
  assert.match(bat, /set "CC_SELF=%~f0"/, '경로를 환경 변수로 넘기지 않는다')
  assert.match(bat, /Start-Process -FilePath \$env:CC_SELF -Verb RunAs/, '환경 변수로 받은 경로로 띄우지 않는다')
})
