'use strict'
// **잠긴 기록 파일이 시작을 막지 않는다** (Windows Sandbox 설치 시험 2026-09-17)
//
// 설치본으로 한 번 실행 → 「CareCast 종료」 → 아이콘으로 다시 실행하면 **서버가 안 떴다**(5분 대기 실패).
// 지웠다 다시 설치해도 같았다. 원인(개발 PC 에서 재현):
//   ① 방송 화면(Edge)은 감시 루프 안에서 `start` 로 띄워져 **launcher.log 리다이렉트 손잡이를 물려받는다.**
//   ② 「CareCast 종료」는 node 와 루프만 끄고 그 창은 남긴다 → 창이 launcher.log 를 계속 쥔다.
//   ③ 다음 실행의 `>> launcher.log` 가 「다른 프로세스가 사용 중」으로 실패하고, cmd 는 **리다이렉트가 실패한
//      명령을 아예 건너뛴다** — 그 줄의 `call "carecast-loop.bat"` 까지. 아이콘을 눌러도 아무 일이 없다.
// 그래서 시작 껍데기는 기록 파일을 먼저 시험하고, 잠겨 있으면 여분 이름으로, 전부 잠기면 기록 없이 시작한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const 껍데기 = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'installer', 'carecast-start.bat'), 'utf8')
const 줄들 = 껍데기.split(/\r?\n/).filter((l) => !/^\s*::/.test(l))
const 몇째 = (re) => 줄들.findIndex((l) => re.test(l))

test('기록 파일을 먼저 시험하고, 잠겼으면 여분 이름 → 마지막은 기록 없이(nul)', () => {
  const 시험1 = 몇째(/^\(>> "%CC_LOG%" echo\.\) 2>nul \|\| set "CC_LOG=server\\logs\\launcher-2\.log"$/)
  const 시험2 = 몇째(/^\(>> "%CC_LOG%" echo\.\) 2>nul \|\| set "CC_LOG=server\\logs\\launcher-3\.log"$/)
  const 시험3 = 몇째(/^\(>> "%CC_LOG%" echo\.\) 2>nul \|\| set "CC_LOG=nul"$/)
  assert.ok(시험1 >= 0 && 시험2 > 시험1 && 시험3 > 시험2, '잠긴 기록 파일을 피해 가는 세 줄이 순서대로 없다')
  const 루프호출 = 몇째(/^call "carecast-loop\.bat" >> "%CC_LOG%" 2>&1$/)
  assert.ok(루프호출 > 시험3, '루프를 부르기 전에 기록 파일을 시험해야 한다 — 잠긴 채로 부르면 cmd 가 호출을 건너뛴다')
  const 처음기록 = 몇째(/^set "CC_LOG=server\\logs\\launcher\.log"$/)
  assert.ok(처음기록 >= 0 && 처음기록 < 시험1, '기본 기록 파일 이름이 시험보다 먼저 정해져야 한다')
})
