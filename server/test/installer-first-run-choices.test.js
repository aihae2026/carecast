'use strict'
// **설치 직후에는 초기 설정이 먼저다** (사용자 신고 2026-09-17, 회사 노트북 실기)
//
// *"초기설정 켜기 체크했는데 바로 열리잖아 초기설정 안보이고"*
// *"기존에 설치되었던 부분이 있으면 재설치하던지 제거하던지 그렇게 해야지"*
// *"윈도우 재시작할때 같이 켜는거 기본 설정해주고"*
// *"초기설정 첫화면부터 음성합성시작해서, 다되면 보여줄 수 있게 해 … 밀리고"*
//
// 제거는 기관 기록(DB)을 **일부러 남긴다**(CareCast.iss [UninstallDelete] 없음). 그래서 한 번 깔았던
// PC 에 다시 깔면 서버는 「쓰던 PC」로 읽고 초기 설정을 안 띄운다 — 그 판정은 맞지만, 사람은
// 그 기록이 남아 있는 줄 모른다. **설치 프로그램이 물어야 한다.** 지우지는 않고 옆 폴더로 옮긴다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const iss = 읽기('scripts/installer/CareCast.iss')

test('로그인 시 자동 시작이 **기본으로 켜져 있다**', () => {
  const 줄 = iss.split(/\r?\n/).find((l) => /^Name: "autostart"/.test(l))
  assert.ok(줄, 'autostart 작업을 못 찾았다')
  assert.ok(!/unchecked/.test(줄), '자동 시작이 기본으로 꺼져 있다 — PC 를 다시 켜면 방송이 안 뜬다')
})

test('남은 기록이 있으면 **묻는다** · 새로 설치를 골라도 **지우지 않고 옮긴다**', () => {
  const m = /function PrepareToInstall[\s\S]*?\nend;/.exec(iss)
  assert.ok(m, 'PrepareToInstall 을 못 찾았다')
  const 본문 = m[0]
  assert.match(본문, /FileExists\([^)]*database\.db/, '남은 기록(database.db)을 안 본다')
  assert.match(본문, /TaskDialogMsgBox\(/, '사람에게 묻지 않는다')
  assert.match(본문, /IDCANCEL/, '그만두는 길이 없다')
  assert.match(본문, /RenameFile\(/, '새로 설치를 골랐을 때 기록 폴더를 옮기지 않는다')
  assert.ok(!/DelTree|DeleteFile/.test(본문), '기관 기록을 지운다 — 되돌릴 수 없다')
  // 앱을 먼저 멈춰야 DB 폴더를 옮길 수 있다(파일이 열려 있으면 이름을 못 바꾼다).
  assert.ok(본문.indexOf('StopInstalledApp()') < 본문.indexOf('RenameFile('), '앱을 멈추기 전에 폴더를 옮기려 한다')
  // 조용한 설치(자동 시험·일괄 배포)는 묻지 못한다 — 기본은 **유지**, /FRESH=1 일 때만 새로.
  assert.match(본문, /WizardSilent\(\)/, '조용한 설치에서도 창을 띄우려 한다')
  assert.match(본문, /\{param:FRESH\|0\}/, '조용한 설치에서 새로 설치를 고를 길이 없다(시험 불가)')
})

test('간편 화면은 **첫 확인이 끝나기 전에 그리지 않는다** — 초기 설정 전에 홈이 번쩍이지 않게', () => {
  const 홈 = 읽기('src/pages/HomeMode.jsx')
  assert.match(홈, /if \(확인중\) return/, '확인 전에 홈을 그린다')
  const 효과 = /useEffect\(\(\) => \{[\s\S]*?carecast:setup-checked[\s\S]*?\}, \[navigate\]\)/.exec(홈)?.[0] || ''
  // 처음이 아니거나 못 물었으면 **반드시 풀어야** 한다 — 안 풀면 빈 화면에 갇힌다.
  assert.ok((효과.match(/set확인중\(false\)/g) || []).length >= 2, '처음이 아닐 때·실패할 때 화면을 안 푼다')
  assert.match(효과, /setTimeout\(\(\) => \{[^}]*set확인중\(false\)/, '서버가 안 답할 때 풀어 주는 시한이 없다')
})

test('초기 설정을 막 끝낸 첫 안내는 **음성 준비가 끝난 뒤** 연다', () => {
  const 안내 = 읽기('src/components/home/HomeTour.jsx')
  const i = 안내.indexOf("localStorage.getItem(안내대기키) === '1'")
  assert.ok(i > 0, '첫 안내 대기 표식을 못 찾았다')
  const 앞뒤 = 안내.slice(i, i + 400)
  assert.match(앞뒤, /준비끝나면열기/, '대기 표식이 있으면 곧바로 연다 — 합성 중이라 안내가 밀린다')
  assert.match(안내, /const 준비끝나면열기 = async[\s\S]*?getWarmup\(\)/, '준비 상태를 안 묻는다')
})
