// P-70 · P-82 · P-87 — 업데이트 화면이 사실과 다른 것을 보여 주던 자리 (2026-09-10).
//
//   P-70 `done` 을 받으면 **3초 뒤 무조건** 새로고침했다. 그런데 빌드가 끝난 것과
//        **서버가 재시작한 것은 다르다** — 실제 재시작은 방송이 끝날 때까지 기다린다.
//        마이크·스피커가 켜져 있으면 화면만 "완료"가 되고 프로세스는 옛 코드였다.
//   P-82 마운트 때 `/api/update/status` 를 안 봐서, 새로고침된 화면은 **버튼이 눌리는
//        모양이고 로그창이 비어 있었다.** 누르면 "이미 업데이트 중입니다"가 뜨는데
//        진실은 "업데이트는 끝났고 재시작을 기다리는 중"이다.
//   P-87 폴링이 `done`·`error` 분기에서만 멈춰서, 그 둘에 안 걸리는 상태에서 화면을
//        떠나면 1초 폴링이 계속 돌았다.
//
// 화면 파일이라 소스 대조로 고정한다 — 이 저장소의 관례다(CLAUDE.md "가드는 따라 옮긴다").
// **부정 단언 앞에 긍정 앵커를 세운다.**
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'systemSettingsEtc.jsx'),
  'utf8')

// **주석을 뺀 본문**으로 판정한다. 머리말이 옛 코드를 설명하느라 그 문자열을 그대로
// 인용하는데, 그것까지 세면 검사가 늘 빨간불이다(2026-09-10 실제로 걸렸다).
const LF = String.fromCharCode(10)
const 본문 = SRC.split(LF)
  .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
  .join(LF)

test('앵커: 업데이트 진행 폴링이 이 파일에 있다', () => {
  assert.match(SRC, /pollRef/, '폴링 참조가 사라졌다 — 이 검사들의 앵커가 무너졌다')
  assert.match(SRC, /getUpdateStatus/, '상태 조회가 사라졌다')
})

test('P-70: 시간을 약속하지 않는다 — 3초 뒤 무조건 새로고침하지 않는다', () => {
  assert.doesNotMatch(본문, /setTimeout[\s\S]{0,80}reload/,
    '빌드 완료를 재시작 완료로 읽고 3초 뒤 새로고침한다 — 마이크·스피커가 켜져 있으면 거짓말이 된다')
  assert.doesNotMatch(본문, /3초 후 새로고침/,
    '문구가 시간을 약속한다 — 재시작은 방송이 끝나야 온다')
})

test('P-70: 서버가 실제로 내려갔다 올라오는 것을 보고 새로고침한다', () => {
  assert.match(SRC, /끊긴적/,
    '재시작을 감지하는 장치가 없다 — 한 번 실패한 뒤 다시 성공하는 것이 재시작이 끝난 순간이다')
  assert.match(SRC, /끊긴적[\s\S]{0,120}reload/,
    '끊김을 본 뒤에 새로고침해야 한다')
})

test('P-82: 마운트 때 진행 상태를 확인한다 — 새로 뜬 화면도 "재시작 대기 중"을 안다', () => {
  const i = SRC.indexOf('useEffect(() => {')
  assert.ok(i >= 0, 'useEffect 가 사라졌다')
  const 첫effect = SRC.slice(i, SRC.indexOf('}, [])', i))
  assert.match(첫effect, /getUpdateStatus\(\)/,
    '마운트 때 진행 상태를 안 본다 — 새로고침된 화면이 버튼을 열어 두고 거짓 문구를 만든다')
})

test('P-82: 완료 뒤에도 running 을 안 푼다 — 서버와 같은 규칙이다', () => {
  // 서버는 재시작이 끝날 때까지 state.running 을 안 푼다(P-72). 화면이 먼저 풀면
  // 버튼이 열려 "이미 업데이트 중입니다" 라는 사실과 다른 문구를 만난다.
  const i = 본문.indexOf('if (s.done) {')
  assert.ok(i >= 0, 'done 분기가 사라졌다')
  const 분기 = 본문.slice(i, 본문.indexOf('} else', i) + 1)
  assert.doesNotMatch(분기, /setUpdateRunning\(false\)/,
    'done 을 받자마자 running 을 풀었다 — 서버는 재시작까지 안 푼다(P-72)')
})

test('P-87: 화면을 떠나면 폴링을 걷는다', () => {
  assert.match(SRC, /return \(\) => clearInterval\(pollRef\.current\)/,
    '언마운트 정리가 없다 — done·error 에 안 걸리는 상태에서 1초 폴링이 계속 돈다')
})
