// 다른 곳에 깔린 CareCast 가 3001 을 되찾아 가지 못하게 (사용자 지시 2026-09-22 「재발방지책 마련해」).
//
// 새 설치판을 깔고 켜도 옛 판이 떴다 — 9/18 EXE 설치본이 로그인 때 창 없이 띄운 재시작 창이, 새 설치판이 끈 옛 서버를
// 6초 뒤 되살렸다(실측 21:27:06 → 21:27:12). 새 판의 감시 루프는 「3001 이 떠 있다 = 이미 실행 중」으로 읽어 옛 화면을 열었다.
// scripts/other-install-guard.cjs 가 **다른 폴더의** 재시작 창·숨은 실행기·서버를 골라 끄고, 이 폴더 것은 건드리지 않는다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 고를것, 집찾기 } = require(path.join(ROOT, 'scripts', 'other-install-guard.cjs'))

const 옛집 = 'C:\\Users\\X\\AppData\\Local\\Programs\\CareCast'
const 새집 = 'C:\\Users\\X\\carecast-localmedia-wt\\release\\carecast'
// 2026-09-22 이 PC 에서 실제로 본 모양 그대로(프로세스 명령줄)
const 목록 = [
  { pid: 28640, name: 'cmd.exe', cmd: `"C:\\Windows\\system32\\cmd.exe"  /d /s /c ""${옛집}\\carecast-start.bat""`, exe: 'C:\\Windows\\system32\\cmd.exe' },
  { pid: 45860, name: 'node.exe', cmd: '"runtime\\node\\node.exe"  server\\index.js', exe: `${옛집}\\runtime\\node\\node.exe` },
  { pid: 4, name: 'wscript.exe', cmd: `"C:\\Windows\\System32\\wscript.exe" "${옛집}\\CareCast-Start.vbs"`, exe: 'C:\\Windows\\System32\\wscript.exe' },
  { pid: 25036, name: 'cmd.exe', cmd: `C:\\Windows\\system32\\cmd.exe /c ""${새집}\\CareCast-설치.bat" "`, exe: 'C:\\Windows\\system32\\cmd.exe' },
  { pid: 11, name: 'cmd.exe', cmd: `cmd /c "${새집}\\carecast-start.bat"`, exe: 'C:\\Windows\\system32\\cmd.exe' },
  { pid: 12, name: 'node.exe', cmd: '"runtime\\node\\node.exe" server\\index.js', exe: `${새집}\\runtime\\node\\node.exe` },
  // 개발 PC 의 다른 node(시스템 node 로 돈 서버·다른 프로그램) — 집을 모르면 건드리지 않는다
  { pid: 13, name: 'node.exe', cmd: 'node server/index.js', exe: 'C:\\Program Files\\nodejs\\node.exe' },
  { pid: 14, name: 'node.exe', cmd: 'node chrome-devtools-mcp.js', exe: 'C:\\Program Files\\nodejs\\node.exe' },
]

test('다른 폴더의 재시작 창·숨은 실행기·서버만 고른다 — 재시작 창을 먼저(안 그러면 되살린다)', () => {
  const r = 고를것(목록, 새집)
  assert.deepEqual(r.map((x) => x.pid), [28640, 4, 45860])
  assert.deepEqual(r.map((x) => x.종류), ['재시작 창', '숨은 실행기', '서버'])
  for (const x of r) assert.equal(x.집.toLowerCase(), 옛집.toLowerCase())
})

test('이 폴더의 것은 절대 고르지 않는다 — 대소문자·끝 빗금이 달라도', () => {
  const r = 고를것(목록, 새집.toUpperCase() + '\\')
  assert.ok(!r.some((x) => [25036, 11, 12].includes(x.pid)), '자기 자신의 재시작 창·서버를 끄려 했다')
})

test('집을 모르는 프로세스(시스템 node·다른 프로그램)는 건드리지 않는다', () => {
  assert.equal(집찾기(목록[6]), null)
  assert.equal(집찾기(목록[7]), null)
  assert.ok(!고를것(목록, 새집).some((x) => [13, 14].includes(x.pid)))
})

test('설치 스크립트와 감시 루프가 이 장치를 부른다 — 모든 시작 길(압축판·EXE·작업 스케줄러)이 거친다', () => {
  const 설치 = fs.readFileSync(path.join(ROOT, 'CareCast-설치.bat'), 'utf8')
  assert.ok(/other-install-guard\.cjs/.test(설치), '설치 스크립트가 다른 설치본을 안 본다')
  const 루프 = fs.readFileSync(path.join(ROOT, 'scripts', 'carecast-loop.template.bat'))
  assert.ok(/other-install-guard\.cjs/.test(루프.toString('latin1')), '감시 루프가 다른 설치본을 안 본다')
  // 「이미 떠 있다」 검사보다 **먼저** 돌아야 한다 — 뒤에 두면 옛 서버를 이미 실행 중으로 읽고 옛 화면을 연다
  const s = 루프.toString('latin1')
  assert.ok(s.indexOf('other-install-guard.cjs') < s.indexOf('Already running on port 3001'), '다른 설치본 정리가 「이미 실행 중」 판단보다 늦다')
  assert.equal([...루프].filter((b) => b > 127).length, 0, '감시 루프에 비ASCII 가 들어갔다(installer-health-check 규칙)')
})
