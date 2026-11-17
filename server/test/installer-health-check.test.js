// 시작 파일 두 층이 각자 할 일을 하는가 — 껍데기(carecast-start.bat)와 알맹이(감시 루프).
//
// 구조가 왜 둘인가(2026-09-04):
// 예전에는 설치 bat이 **한 파일**을 echo 60줄로 찍어냈고, 그 파일 안에 `chcp 65001`과
// UTF-8 한글이 함께 있었다. cmd는 배치 파일을 **바이트 위치로** 읽어서, 한글이 있으면
// goto로 루프에 돌아올 때 글자 중간에 떨어져 조각을 명령으로 실행한다.
// 현장 도스창에 `'  ' is not recognized ...`가 3시간 56분 동안 2932번(4.83초에 한 번,
// 이 루프의 주기) 찍힌 것이 그것이었다. 같은 루프를 조건만 같게 두고 나란히 돌린 실측:
//     한글 UTF-8 → 333바퀴에 오류 1672건, 시작 배너조차 안 뜸
//     ASCII만    → 78바퀴에 오류 0건, 정상
//
// 그래서:
//   껍데기 carecast-start.bat  — ASCII만. chcp 하고 알맹이를 call한다. **다시는 안 바뀐다.**
//   알맹이 scripts/carecast-loop.template.bat — 감시 루프. 저장소가 원본이라 git이 갱신한다.
// 덕분에 감시 규칙을 고쳐도 현장에서 설치 bat을 다시 돌릴 필요가 없다(그전엔 필요했다).
//
// 이 테스트가 지키는 것:
//  1. 알맹이가 ASCII만이다 — 위 사고의 재발 방지. 제일 중요하다.
//  2. 알맹이에 chcp가 없다 — 코드페이지를 바꾸는 순간 같은 어긋남이 생긴다.
//  3. 감시 판정 규칙 셋(health를 실제로 부른다 / 한 번 실패로 안 죽인다 / curl 없으면 폴백).
//  4. 껍데기가 갈아 끼우고 부른다 — 그리고 껍데기도 ASCII만이다.
//  5. 생성 블록 안 echo 줄에 이스케이프 안 된 괄호가 없다(2026-09-01 설치 실패의 원인).
'use strict'

const fs   = require('fs')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT     = path.join(__dirname, '..', '..')
const BAT      = path.join(ROOT, 'CareCast-설치.bat')
const TEMPLATE = path.join(ROOT, 'scripts', 'carecast-loop.template.bat')

const read = (p) => fs.readFileSync(p, 'utf8')

// ASCII 밖의 글자가 하나라도 있나. 정규식(`[^\x00-\x7F]`)이 아니라 코드포인트로 센다 —
// 제어문자 범위를 쓴 정규식은 lint(no-control-regex)가 막고, 이쪽이 읽기도 낫다.
function hasNonAscii(s) {
  for (const ch of String(s)) if (ch.codePointAt(0) > 127) return true
  return false
}
const loopLines = () => read(TEMPLATE).split(/\r?\n/)

/** 설치 bat이 찍어내는 껍데기 줄들 — echo 접두와 ^ 이스케이프를 벗겨서 본다. */
function shellLines() {
  const lines = read(BAT).split(/\r?\n/)
  const out = []
  let 안쪽 = false
  for (const l of lines) {
    if (/^\(\s*$/.test(l)) { 안쪽 = true; continue }
    if (/^\)\s*>\s*"%(START|SCHED)_BAT%"/.test(l)) { 안쪽 = false; continue }
    if (!안쪽 || !l.startsWith('  echo ')) continue
    out.push(l.slice('  echo '.length).replace(/\^([>|&()])/g, '$1').replace(/%%/g, '%'))
  }
  return out
}

// ── 1·2. 알맹이는 ASCII만, chcp 없음 ─────────────────────────────
test('감시 루프에 ASCII 아닌 글자가 없다 — 있으면 5초마다 오류가 난다', () => {
  const 걸린줄 = loopLines()
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => hasNonAscii(l))
    .map(([n, l]) => `${n}: ${l.trim().slice(0, 60)}`)
  assert.deepEqual(걸린줄, [],
    'cmd는 배치 파일을 바이트 위치로 읽어서, 여러 바이트 글자가 있으면 goto로 돌아올 때\n'
    + '  글자 중간에 떨어져 조각을 명령으로 실행한다. 실측으로 확인했다(한글 1672건 / ASCII 0건).\n'
    + `  한글이 필요하면 주석은 이 테스트나 docs/ADOPT.md에 적을 것:\n  ${걸린줄.join('\n  ')}`)
})

test('감시 루프에 chcp가 없다 — 코드페이지는 껍데기가 미리 바꿔 둔다', () => {
  const 걸린줄 = loopLines().filter(l => /^\s*chcp\b/i.test(l))
  assert.deepEqual(걸린줄, [],
    'chcp를 파일 중간에서 부르면 그 뒤 줄의 바이트 계산이 어긋난다 — 바로 그 사고를 되돌리는 셈이다')
})

// ── 3. 감시 판정 규칙 ────────────────────────────────────────────
test('감시 루프가 /api/health로 생존을 판정한다 (CC-012)', () => {
  const calls = loopLines().map(l => l.trim()).filter(l => l.startsWith('curl ') && l.includes('/api/health'))
  assert.equal(calls.length, 1, '감시 루프에 health 호출이 정확히 한 번 있어야 한다')
  assert.match(calls[0], /^curl .*-f /, '-f 없이는 503도 성공으로 읽힌다')
})

test('한 번 걸렀다고 재시작하지 않는다 — 3연속 실패가 필요하다', () => {
  const lines = loopLines().map(l => l.trim())
  assert.equal(lines.filter(l => /^set \/a HFAIL=HFAIL\+1$/.test(l)).length, 1)
  assert.equal(lines.filter(l => /^if %HFAIL% GEQ 3 goto ccdown$/.test(l)).length, 1)
  // 성공하면 반드시 0으로 되돌린다 — 안 그러면 며칠에 걸쳐 쌓여 언젠가 재시작한다
  assert.ok(lines.filter(l => l === 'set HFAIL=0').length >= 2)
})

// ── **사실을 보고, 줄 모양은 안 본다** (2026-09-16 정정) ───────────────────────
// 앞 판은 `where curl` **바로 다음 줄이 글자 그대로** `if errorlevel 1 goto waitstop`
// 이기를 요구했다. 그런데 이 시험이 지키려는 사실은 *"curl 이 없는 PC 도 포트는 보고
// 감시를 계속한다"* 이지, 그 줄의 생김새가 아니다.
//
// 2026-09-16 에 감시 주기에서 netstat 을 걷어내면서(실측 90ms × 5초마다) 그 분기가
// `goto portonly` 로 바뀌었고 — 거기서 포트를 본 뒤 감시로 돌아온다 — **옳은 변경이
// 빨간불을 냈다.** 이제 「어디로 가든 포트 확인을 거친다」를 본다.
test('curl이 없는 PC도 포트는 보고 감시를 계속한다', () => {
  const lines = loopLines().map(l => l.trim())
  const i = lines.findIndex(l => l.startsWith('where curl'))
  assert.notEqual(i, -1, 'curl 유무 확인이 사라졌다')

  const 분기 = /^if errorlevel 1 goto (\w+)$/.exec(lines[i + 1] || '')
  assert.ok(분기, `curl 이 없을 때 갈 곳이 없다: "${lines[i + 1]}"`)
  const 갈곳 = 분기[1]

  // 곧장 감시로 돌아가든(옛 모양), 포트만 보는 자리로 가든(지금) 둘 다 좋다.
  // **다만 그 자리에서 포트를 실제로 봐야 한다.**
  if (갈곳 === 'waitstop') {
    // 옛 모양: 감시 머리에서 이미 netstat 을 본다.
    const w = lines.indexOf(':waitstop')
    assert.ok(lines.slice(w, w + 6).some(l => l.includes('netstat') && l.includes('LISTEN')),
      'curl 없이 감시로 돌아가는데 그 앞에 포트 확인이 없다')
  } else {
    const 자리 = lines.indexOf(`:${갈곳}`)
    assert.ok(자리 >= 0, `갈 곳 :${갈곳} 이 없다 — 실행 중 "레이블을 찾을 수 없습니다"로 죽는다`)
    const 토막 = lines.slice(자리, 자리 + 5)
    assert.ok(토막.some(l => l.includes('netstat') && l.includes('LISTEN')),
      `:${갈곳} 에서 포트를 안 본다 — curl 없는 PC 는 서버가 죽어도 모른다`)
    // `goto ccdown` 은 대개 `if errorlevel 1 goto ccdown` 안에 들어 있다 —
    // 줄 전체가 그것과 같기를 요구하면 조건부 분기를 놓친다.
    assert.ok(토막.some(l => l.includes('goto ccdown')),
      `:${갈곳} 에서 되살릴 길이 없다`)
  }
})

test('포트가 죽은 경우의 재시작 경로가 그대로 남아 있다', () => {
  const lines = loopLines().map(l => l.trim())
  // **개수로 박지 않는다**(2026-09-16). 앞 판은 netstat 이 정확히 3곳, `goto ccdown`
  // 이 정확히 1곳이기를 요구했다. 지키려는 사실은 *"포트가 죽으면 되살리는 길이 있다"*
  // 이지 「몇 곳이냐」가 아니다 — 감시 주기에서 netstat 을 걷어내며 자리가 바뀌자
  // 옳은 변경이 빨간불을 냈다.
  assert.ok(lines.filter(l => l.includes('netstat') && l.includes('LISTEN')).length >= 3,
    '포트를 보는 자리가 줄었다 — 이미 실행 중 확인 · 포트 대기 · 감시 셋은 있어야 한다')
  assert.ok(lines.filter(l => l.includes('goto ccdown')).length >= 1,
    '포트가 죽었을 때 되살리러 가는 길이 없다')
  assert.equal(lines.filter(l => l === 'goto restart').length, 1)
  assert.ok(lines.includes(':restart'), '되살릴 자리가 있어야 한다')
})

// ── 4. 껍데기 ────────────────────────────────────────────────────
test('껍데기가 다음 판본을 갈아 끼우고 알맹이를 부른다', () => {
  const s = shellLines()
  assert.ok(s.length > 0, '설치 bat에서 껍데기 생성 블록을 못 찾았다')
  // **줄 머리부터** 본다. rem 하나만 붙여도 죽는 줄이라, 어디든 있기만 하면 통과시키면 안 된다
  // (실제로 느슨하게 썼다가 `echo rem if exist ...` 뮤테이션을 놓쳤다).
  const 줄머리 = (re) => s.some(l => re.test(l.trim()))
  assert.ok(줄머리(/^if exist "[^"]*carecast-loop\.next\.bat" move \/y/),
    '깔아 둔 다음 판본을 갈아 끼우는 줄이 없으면 자동 갱신이 끊긴다')
  assert.ok(줄머리(/^if not exist "[^"]*carecast-loop\.bat" copy \/y "[^"]*carecast-loop\.template\.bat"/),
    '알맹이가 없을 때 템플릿에서 스스로 복구해야 한다')
  assert.ok(줄머리(/^call "[^"]*carecast-loop\.bat"/),
    '알맹이를 부르지 않으면 아무것도 안 한다')
  const 붙임 = s.join('\n')
  // call에 파일 이름만 주면 NoDefaultCurrentDirectoryInExePath가 켜진 PC에서 못 찾는다(실측)
  assert.ok(!/call "carecast-loop\.bat"/.test(붙임),
    'call에는 경로를 끝까지 적어야 한다 — 이름만 주면 현재 폴더를 안 뒤지는 PC가 있다')
})

test('껍데기도 ASCII만이다 — 여기서 어긋나면 알맹이를 부르기도 전에 깨진다', () => {
  const 걸린줄 = shellLines().filter(l => hasNonAscii(l))
  assert.deepEqual(걸린줄, [], `껍데기의 한글: ${걸린줄.join(' | ')}`)
})

test('껍데기가 chcp로 코드페이지를 먼저 잡는다', () => {
  assert.ok(shellLines().some(l => /^chcp 65001/.test(l.trim())),
    '알맹이의 출력이 깨진다')
})

// ── 5. 생성 블록의 괄호 ──────────────────────────────────────────
// 2026-09-01 현장에서 실제로 터진 것: 설치 bat을 돌리면 도스창이 켜졌다 바로 꺼지고
// 시작 bat이 만들어지지 않았다. `( ... ) > "%START_BAT%"` 블록 안에서 **따옴표 밖의 `)`는
// 블록을 조기에 닫는다.** 눈으로 못 지키는 규칙이라 기계가 본다.
test('생성 블록 안의 echo 줄에 이스케이프 안 된 괄호가 없다', () => {
  const lines = read(BAT).split(/\r?\n/)
  const offenders = []
  lines.forEach((line, i) => {
    if (!line.startsWith('  echo ')) return
    const outsideQuotes = line.replace(/"[^"]*"/g, '')   // 따옴표 안은 안전하다
    const unescaped = outsideQuotes.replace(/\^[()]/g, '')
    if (/[()]/.test(unescaped)) offenders.push(`${i + 1}: ${line.trim().slice(0, 70)}`)
  })
  assert.deepEqual(offenders, [],
    `괄호가 블록을 조기에 닫는다 — ^( ^) 로 이스케이프하거나 괄호를 쓰지 말 것:\n  ${offenders.join('\n  ')}`)
})

test('설치 bat이 알맹이를 현장에 깔아 준다', () => {
  const 본문 = read(BAT)
  assert.match(본문, /copy \/y "%PROJECT_DIR%\\scripts\\carecast-loop\.template\.bat"/,
    '설치할 때 알맹이 사본을 안 깔면 첫 실행이 껍데기의 자가 복구에만 기댄다')
})
