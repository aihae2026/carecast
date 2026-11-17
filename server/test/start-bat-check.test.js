// 시작 파일 자가 점검 — 무엇을 "깨졌다"고 볼 것인가, 그리고 새 판본을 언제 깔아 두는가.
//
// 왜 필요했나(2026-09-04): 현장 도스창 6629줄에 `'  ' is not recognized ...`가 2932번,
// 4.83초에 한 번 찍혀 있었다. 감시 루프의 `timeout /t 5` 주기다. 그 루프가 서버를 되살리는
// 유일한 길인데 도스창은 아무도 안 본다.
//
// 원인은 **bat 안의 한글**이었다. cmd는 배치 파일을 바이트 위치로 읽어서, UTF-8 여러 바이트
// 글자가 있으면 goto로 돌아올 때 글자 중간에 떨어져 조각을 명령으로 실행한다.
// 조건을 같게 두고 나란히 돌린 실측: 한글 333바퀴에 1672건 / ASCII 78바퀴에 0건.
// 그래서 `nonAscii`가 이 점검의 **1순위 신호**다.
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const {
  inspectBat, problemsOf, checkStartBats, stageLoopUpdate, commandOf, candidatePaths, LOOP_NAME, NEXT_NAME,
} = require('../services/startBatCheck')

const ROOT = path.join(__dirname, '..', '..')

// 지금 저장소가 배포하는 알맹이와 같은 모양(ASCII만)
const GOOD_LOOP = [
  ':: carecast-loop test fixture -- ascii only on purpose',
  'if not exist "dist\\index.html" (',
  '  echo Build output is missing.',
  '  exit /b 1',
  ')',
  ':restart',
  'start /b node server\\index.js',
  'set HFAIL=0',
  ':waitstop',
  'timeout /t 5 /nobreak > nul',
  'netstat -an 2>nul | findstr ":3001" | findstr "LISTEN" > nul',
  'if errorlevel 1 goto ccdown',
  'where curl > nul 2>&1',
  'if errorlevel 1 goto waitstop',
  'curl -s -f -m 5 -o nul http://localhost:3001/api/health',
  'if errorlevel 1 goto ccsick',
  'set HFAIL=0',
  'goto waitstop',
  ':ccsick',
  'set /a HFAIL=HFAIL+1',
  'if %HFAIL% GEQ 3 goto ccdown',
  'goto waitstop',
  ':ccdown',
  'timeout /t 2 /nobreak > nul',
  'goto restart',
].join('\r\n')

const GOOD_SHELL = [
  '@echo off',
  'chcp 65001 > nul',
  'title CareCast AI',
  'set "CC_HOME=C:\\CareCast"',
  'cd /d "%CC_HOME%"',
  'if exist "%CC_HOME%\\carecast-loop.next.bat" move /y "%CC_HOME%\\carecast-loop.next.bat" "%CC_HOME%\\carecast-loop.bat" > nul',
  'if not exist "%CC_HOME%\\carecast-loop.bat" copy /y "%CC_HOME%\\scripts\\carecast-loop.template.bat" "%CC_HOME%\\carecast-loop.bat" > nul',
  'call "%CC_HOME%\\carecast-loop.bat"',
].join('\r\n')

// ── 판정 ─────────────────────────────────────────────────────────
test('성한 알맹이에는 아무 지적도 없다 — 오탐이 나면 사람이 경고를 안 믿는다', () => {
  const r = inspectBat(GOOD_LOOP)
  assert.deepEqual(problemsOf(r), [])
  assert.deepEqual(r.unknown, [], `낯선 줄로 잘못 센 것: ${JSON.stringify(r.unknown)}`)
  assert.equal(r.hasHealth, true)
  assert.equal(r.hasRestart, true)
  assert.equal(r.loopSeconds, 5)
  assert.equal(r.isShell, false)
})

test('ASCII 아닌 글자를 1순위로 짚는다 — 현장에서 실제로 터진 것', () => {
  const broken = GOOD_LOOP.replace('  echo Build output is missing.', '  echo 빌드 파일 없음.')
  const r = inspectBat(broken)
  assert.equal(r.nonAscii.length, 1)
  assert.equal(r.nonAscii[0].no, 3, '몇 번째 줄인지 말해야 사람이 그 줄을 연다')
  assert.match(problemsOf(r)[0], /ASCII가 아닌/, '가장 위험한 것을 맨 앞에 말해야 한다')
})

test('캐럿과 보이지 않는 공백도 잡는다', () => {
  assert.equal(inspectBat(GOOD_LOOP.replace('> nul', '^> nul')).carets.length, 1)
  for (const ch of ['\u00a0', '\u3000', '\ufeff', '\u200b']) {
    assert.ok(inspectBat(GOOD_LOOP.replace('set HFAIL=0', `${ch}${ch}`)).invisible.length >= 1,
      `${JSON.stringify(ch)}를 놓쳤다`)
  }
})

test('옛 판본 — /api/health 판정이 없으면 알아챈다 (CC-012 회귀)', () => {
  const old = GOOD_LOOP.replace('curl -s -f -m 5 -o nul http://localhost:3001/api/health', 'rem 옛 판본은 포트만 봤다')
  assert.equal(inspectBat(old).hasHealth, false)
  // -f가 빠지면 503도 성공으로 읽힌다 — 그것도 "판정 없음"으로 본다
  assert.equal(inspectBat(GOOD_LOOP.replace('curl -s -f -m 5', 'curl -s -m 5')).hasHealth, false)
})

test('되살리는 길이 없으면 알아챈다', () => {
  assert.equal(inspectBat(GOOD_LOOP.replace(/goto restart/g, 'exit /b 0')).hasRestart, false)
})

test('껍데기를 껍데기로 알아본다', () => {
  assert.equal(inspectBat(GOOD_SHELL).isShell, true)
  assert.equal(inspectBat(GOOD_LOOP).isShell, false)
})

test('주석·라벨·닫는 괄호는 명령으로 세지 않는다', () => {
  assert.equal(commandOf(':: 주석'), null)
  assert.equal(commandOf(':waitstop'), null)
  assert.equal(commandOf(')'), null)
  assert.equal(commandOf(') else ('), null)
  assert.equal(commandOf(''), null)
  assert.equal(commandOf('  echo.'), 'echo')
  assert.equal(commandOf('@echo off'), 'echo')
  assert.equal(commandOf('set /a HFAIL=HFAIL+1'), 'set')
})

// ── 껍데기를 통해 알맹이를 본다 ──────────────────────────────────
test('껍데기를 만나면 알맹이를 열어서 판정한다', () => {
  const 남긴말 = [], 경보 = []
  const 파일 = { 'C:\\CareCast\\carecast-start.bat': GOOD_SHELL, [path.join('C:\\CareCast', LOOP_NAME)]: GOOD_LOOP }
  checkStartBats({
    home: 'C:\\CareCast', paths: Object.keys(파일),
    exists: (p) => p in 파일, read: (p) => 파일[p],
    log: (...a) => 남긴말.push(a.join(' ')), warn: (...a) => 남긴말.push(a.join(' ')),
    raise: (k, m) => 경보.push(m), stage: () => {},
  })
  assert.deepEqual(경보, [], '성한 것에 경보를 울리면 아무도 안 믿게 된다')
  assert.ok(남긴말.some(l => l.includes(LOOP_NAME) && l.includes('감시 정상')), 남긴말.join(' / '))
})

test('껍데기는 있는데 알맹이가 없으면 경보를 올린다', () => {
  const 경보 = []
  checkStartBats({
    home: 'C:\\CareCast', paths: ['C:\\CareCast\\carecast-start.bat'],
    exists: (p) => p.endsWith('carecast-start.bat'), read: () => GOOD_SHELL,
    log: () => {}, warn: () => {}, raise: (k, m) => 경보.push(m), stage: () => {},
  })
  assert.equal(경보.length, 1)
  assert.match(경보[0], /carecast-loop\.bat/)
})

test('옛 구조(한 파일)는 한글 때문에 경보가 뜨고, 구조를 바꾸라고 말한다', () => {
  const 옛것 = '@echo off\r\nchcp 65001 > nul\r\n' + GOOD_LOOP.replace('  echo Build output is missing.', '  echo 빌드 파일 없음.')
  const 남긴말 = [], 경보 = []
  checkStartBats({
    home: 'C:\\CareCast', paths: ['C:\\CareCast\\carecast-start.bat'],
    exists: () => true, read: () => 옛것,
    log: (...a) => 남긴말.push(a.join(' ')), warn: (...a) => 남긴말.push(a.join(' ')),
    raise: (k, m) => 경보.push(m), stage: () => {},
  })
  assert.equal(경보.length, 1)
  assert.match(경보[0], /ASCII가 아닌/)
  assert.ok(남긴말.some(l => l.includes('옛 구조')), '무엇을 하면 되는지 말해야 한다')
})

// ── 새 판본 깔아 두기 ────────────────────────────────────────────
function 가짜파일들(초기) {
  const 저장 = { ...초기 }
  return {
    저장,
    exists: (p) => p in 저장,
    read: (p) => { if (!(p in 저장)) throw new Error('ENOENT ' + p); return 저장[p] },
    write: (p, s) => { 저장[p] = s },
  }
}
const HOME = 'C:\\CareCast'
const TPL = path.join(HOME, 'scripts', 'carecast-loop.template.bat')
const LOOP = path.join(HOME, LOOP_NAME)
const NEXT = path.join(HOME, NEXT_NAME)

test('저장소 판본이 다르면 다음 판본을 깔아 둔다 — 도는 파일은 안 건드린다', () => {
  const f = 가짜파일들({ [TPL]: GOOD_LOOP + '\r\n:: newer', [LOOP]: GOOD_LOOP })
  const r = stageLoopUpdate({ home: HOME, templatePath: TPL, ...f, log: () => {}, warn: () => {} })
  assert.equal(r, 'staged')
  assert.equal(f.저장[NEXT], GOOD_LOOP + '\r\n:: newer')
  assert.equal(f.저장[LOOP], GOOD_LOOP, '도는 파일을 덮어쓰면 cmd가 바이트 위치를 잃는다')
})

test('같으면 아무것도 안 한다 — 이미 깔아 둔 것도 다시 안 깐다', () => {
  const 같음 = 가짜파일들({ [TPL]: GOOD_LOOP, [LOOP]: GOOD_LOOP })
  assert.equal(stageLoopUpdate({ home: HOME, templatePath: TPL, ...같음, log: () => {}, warn: () => {} }), 'same')
  assert.ok(!(NEXT in 같음.저장))

  const 이미 = 가짜파일들({ [TPL]: GOOD_LOOP + '\r\n:: newer', [LOOP]: GOOD_LOOP, [NEXT]: GOOD_LOOP + '\r\n:: newer' })
  assert.equal(stageLoopUpdate({ home: HOME, templatePath: TPL, ...이미, log: () => {}, warn: () => {} }), 'same')
})

test('깨진 판본은 깔지 않는다 — 깔면 다음 부팅에 현장이 안 뜬다', () => {
  const 한글섞임 = GOOD_LOOP.replace('  echo Build output is missing.', '  echo 빌드 파일 없음.')
  const f = 가짜파일들({ [TPL]: 한글섞임, [LOOP]: GOOD_LOOP })
  const 남긴말 = []
  assert.equal(stageLoopUpdate({ home: HOME, templatePath: TPL, ...f, log: () => {}, warn: (...a) => 남긴말.push(a.join(' ')) }), 'template-bad')
  assert.ok(!(NEXT in f.저장))
  assert.ok(남긴말.some(l => l.includes('성하지 않아')), 남긴말.join(' / '))
})

test('알맹이가 아직 없는 PC(옛 구조)에는 깔지 않는다', () => {
  const f = 가짜파일들({ [TPL]: GOOD_LOOP })
  assert.equal(stageLoopUpdate({ home: HOME, templatePath: TPL, ...f, log: () => {}, warn: () => {} }), 'no-loop-file')
  assert.ok(!(NEXT in f.저장))
})

// ── 던지지 않는다 ────────────────────────────────────────────────
test('파일을 못 읽어도 던지지 않는다 — 점검이 기동을 막으면 안 된다', () => {
  const 남긴말 = []
  const r = checkStartBats({
    home: HOME, paths: ['C:\\x\\carecast-start.bat'], exists: () => true,
    read: () => { throw new Error('EACCES') },
    log: (...a) => 남긴말.push(a.join(' ')), warn: (...a) => 남긴말.push(a.join(' ')),
    raise: () => {}, stage: () => {},
  })
  assert.deepEqual(r, [])
  assert.ok(남긴말.some(l => l.includes('EACCES')), '왜 못 봤는지는 남겨야 한다')
})

test('시작 bat이 하나도 없으면 "감시 없음"이라고 말한다', () => {
  const 남긴말 = []
  checkStartBats({
    home: HOME, paths: ['C:\\없음.bat'], exists: () => false,
    log: (...a) => 남긴말.push(a.join(' ')), warn: () => {}, raise: () => {}, stage: () => {},
  })
  assert.ok(남긴말.some(l => l.includes('못 찾았습니다')))
})

test('찾아보는 자리에 프로젝트 폴더와 바탕화면이 모두 들어 있다', () => {
  const p = candidatePaths('C:\\CareCast')
  assert.ok(p.some(x => x === path.join('C:\\CareCast', 'carecast-start.bat')))
  assert.ok(p.some(x => x.includes(path.join(os.homedir(), 'Desktop'))))
})

// ── 저장소가 배포하는 알맹이 자체 ────────────────────────────────
test('저장소의 감시 루프 템플릿이 이 점검을 통과한다', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'carecast-loop.template.bat'), 'utf8')
  const r = inspectBat(tpl)
  assert.deepEqual(problemsOf(r), [],
    '통과 못 하는 템플릿은 stageLoopUpdate가 안 깔아 준다 — 자동 갱신이 조용히 멈춘다')
  assert.deepEqual(r.unknown, [], `낯선 줄: ${JSON.stringify(r.unknown)}`)
  // **감시 주기 그 자체**를 본다(2026-09-16). 앞 판은 `1` 을 기대하면서 주석에
  // *"첫 timeout은 포트 대기(1초)다 — 감시 주기는 5초다"* 라고 적어 두었다 —
  // 즉 **틀린 값인 줄 알면서 고정하고 있었다.** 이제 `:waitstop` 의 값을 집으므로
  // 견본(GOOD_LOOP)과 실제 템플릿이 **둘 다 5** 다.
  assert.equal(r.loopSeconds, 5, '감시 주기가 5초가 아니다 — :waitstop 의 timeout 을 본다')
})
