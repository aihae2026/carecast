'use strict'
// 다른 곳에 깔린 CareCast 가 3001 을 되찾아 가지 못하게 한다 (사용자 지시 2026-09-22 「재발방지책 마련해」).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 새 설치판(압축판)을 깔고 켜도 화면이 계속 **옛 판**이었다. 이 PC 에는 9/18 EXE 설치본
// (AppData\Local\Programs\CareCast)이 있었고, 그 설치본은 로그인 때 시작 폴더의 「CareCast AI」 바로가기로
// **창 없이**(CareCast-Start.vbs, 창 모양 0) 재시작 창(carecast-start.bat → carecast-loop.bat)을 띄운다.
// 새 설치판은 3001 을 잡은 node 와 **제목이 「CareCast AI」인 창**만 껐다 — 창이 없는 재시작 창은 못 찾았다.
// 그래서 옛 node 를 끄면 6초 뒤 옛 재시작 창이 옛 node 를 되살렸고(실측 21:27:06 → 21:27:12), 새 판의 감시 루프는
// 「3001 이 이미 떠 있다 = 이미 실행 중」으로 읽어 **옛 서버 화면을 열었다.**
//
// ── 이 스크립트가 하는 일 ───────────────────────────────────────────────────
// 1) 다른 폴더에 깔린 CareCast 의 **재시작 창·숨은 실행기·서버**를 찾아 끈다(재시작 창 먼저 — 안 그러면 되살린다).
// 2) 그 설치본을 로그인 때 켜는 **시작 폴더 바로가기**를 「.끔」으로 이름을 바꿔 멈춘다(지우지 않는다 — 되돌릴 수 있게).
// 3) 무엇을 했는지 화면에 적는다. 이 폴더(자기 자신)의 것은 **절대** 건드리지 않는다.
// 부르는 곳: CareCast-설치.bat [1/5], 설치판이 만드는 시작 bat 두 개, EXE 설치본의 scripts/installer/carecast-start.bat.
//
// 윈도우 전용. 다른 OS 거나 프로세스 목록을 못 읽으면 **아무것도 안 하고** 0 으로 끝난다 — 이 장치가 고장 나서
// 시작을 막으면 안 된다(방송이 안 나가는 것이 옛 화면보다 나쁘다).
const path = require('path')
const { execFileSync } = require('child_process')

const 정규 = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase()

/**
 * 프로세스 하나가 **어느 설치 폴더의** CareCast 것인지. 모르면 null(→ 건드리지 않는다).
 * @param {{name:string, cmd:string, exe:string}} p
 */
function 집찾기(p) {
  const cmd = String(p.cmd || '')
  const name = String(p.name || '').toLowerCase()
  // 재시작 창 — cmd.exe 가 폴더\carecast-start.bat · carecast-loop.bat · carecast-loop.next.bat 를 돌린다
  const bat = /"?([A-Za-z]:[^"]*?)[\\/](carecast-start|carecast-loop(?:\.next)?)\.bat"?/i.exec(cmd)
  if (name === 'cmd.exe' && bat) return bat[1]
  // 숨은 실행기 — wscript.exe 폴더\CareCast-Start.vbs
  const vbs = /"?([A-Za-z]:[^"]*?)[\\/]CareCast-Start\.vbs"?/i.exec(cmd)
  if ((name === 'wscript.exe' || name === 'cscript.exe') && vbs) return vbs[1]
  // 서버 — 설치본에 함께 담긴 실행기(폴더\runtime\node\node.exe)로 server\index.js 를 돌린다
  if (name === 'node.exe' && /server[\\/]index\.js/i.test(cmd)) {
    const m = /^(.*)[\\/]runtime[\\/]node[\\/]node\.exe$/i.exec(String(p.exe || ''))
    if (m) return m[1]
  }
  return null
}

/**
 * 끌 것을 고른다(순수 함수 — 시험이 본다). 재시작 창·실행기를 서버보다 **먼저** 끈다.
 * @param {{pid:number, name:string, cmd:string, exe:string}[]} 목록
 * @param {string} 내집 이 스크립트가 든 설치 폴더
 * @returns {{pid:number, 종류:string, 집:string}[]}
 */
function 고를것(목록, 내집) {
  const 나 = 정규(내집)
  const 순서 = { '재시작 창': 0, '숨은 실행기': 1, '서버': 2 }
  const 종류 = (n) => (n === 'node.exe' ? '서버' : n === 'cmd.exe' ? '재시작 창' : '숨은 실행기')
  return (목록 || [])
    .map((p) => ({ p, 집: 집찾기(p) }))
    .filter(({ 집 }) => 집 && 정규(집) !== 나)
    .map(({ p, 집 }) => ({ pid: Number(p.pid), 종류: 종류(String(p.name || '').toLowerCase()), 집 }))
    .filter((x) => Number.isInteger(x.pid) && x.pid > 0 && x.pid !== process.pid)
    .sort((a, b) => 순서[a.종류] - 순서[b.종류])
}

function 프로세스목록() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe' OR Name='node.exe' OR Name='wscript.exe' OR Name='cscript.exe'\" | "
    + 'Select-Object @{n="pid";e={$_.ProcessId}},@{n="name";e={$_.Name}},@{n="cmd";e={$_.CommandLine}},@{n="exe";e={$_.ExecutablePath}} | ConvertTo-Json -Compress'
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true })
  const j = JSON.parse(out.trim() || '[]')
  return Array.isArray(j) ? j : [j]
}

// 다른 설치본의 **시작 폴더 바로가기**를 찾아 이름을 바꾼다(.끔). 바로가기 대상에 그 설치 폴더가 들어 있으면 그 설치본의 것이다.
function 시작바로가기멈추기(내집, 보기만 = false) {
  const ps = [
    '$d = [Environment]::GetFolderPath("Startup")',
    '$w = New-Object -ComObject WScript.Shell',
    'Get-ChildItem -LiteralPath $d -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $s = $w.CreateShortcut($_.FullName)',
    '  [pscustomobject]@{ path = $_.FullName; target = ($s.TargetPath + " " + $s.Arguments); dir = $s.WorkingDirectory }',
    '} | ConvertTo-Json -Compress',
  ].join('\n')
  let 목록
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim()
    const j = out ? JSON.parse(out) : []
    목록 = Array.isArray(j) ? j : [j]
  } catch { return [] }
  const 나 = 정규(내집)
  const 멈춘것 = []
  for (const l of 목록) {
    const vbs = /"?([A-Za-z]:[^"]*?)[\\/]CareCast-Start\.vbs"?/i.exec(String(l.target || ''))
    const 집 = vbs ? vbs[1] : null
    if (!집 || 정규(집) === 나) continue
    if (보기만) { 멈춘것.push({ 바로가기: l.path, 집, 보기만: true }); continue }
    try {
      require('fs').renameSync(l.path, l.path + '.끔')
      멈춘것.push({ 바로가기: l.path, 집 })
    } catch { /* 못 바꾸면 알리기만 */ 멈춘것.push({ 바로가기: l.path, 집, 실패: true }) }
  }
  return 멈춘것
}

function 실행(내집, { 보기만 = false } = {}) {
  if (process.platform !== 'win32') return 0
  let 목록
  try { 목록 = 프로세스목록() } catch (e) {
    console.log(`  [다른 설치본 확인] 프로세스 목록을 못 읽어 건너뜁니다: ${e.message}`)
    return 0
  }
  const 끌것 = 고를것(목록, 내집)
  if (보기만) {
    for (const x of 끌것) console.log(`  [보기만] 끌 것: ${x.종류}(pid ${x.pid}) — ${x.집}`)
    if (!끌것.length) console.log('  [보기만] 끌 것 없음')
    const 바로가기 = 시작바로가기멈추기(내집, true)
    for (const b of 바로가기) console.log(`  [보기만] 멈출 로그인 바로가기: ${b.바로가기} (그 설치본: ${b.집})`)
    if (!바로가기.length) console.log('  [보기만] 멈출 로그인 바로가기 없음')
    return 0
  }
  for (const x of 끌것) {
    try {
      execFileSync('taskkill.exe', ['/f', '/t', '/pid', String(x.pid)], { stdio: 'ignore', windowsHide: true })
      console.log(`  [다른 설치본] ${x.종류}(pid ${x.pid})를 껐습니다 — ${x.집}`)
    } catch { console.log(`  [다른 설치본] ${x.종류}(pid ${x.pid})를 끄지 못했습니다 — ${x.집}`) }
  }
  for (const s of 시작바로가기멈추기(내집)) {
    console.log(s.실패
      ? `  [다른 설치본] 로그인 자동 시작 바로가기를 멈추지 못했습니다 — ${s.바로가기} (그 설치본: ${s.집}). 직접 지워 주세요.`
      : `  [다른 설치본] 로그인 때 옛 설치본(${s.집})을 켜던 바로가기를 멈췄습니다 — 이름을 「.끔」으로 바꿈: ${s.바로가기}`)
  }
  if (끌것.length) console.log('  [다른 설치본] 다른 곳에 깔린 CareCast 가 3001 을 되찾아 가지 않게 했습니다. 옛 설치본은 설정 → 앱에서 제거하면 깔끔합니다.')
  return 0
}

if (require.main === module) {
  // 인자가 있으면 그 폴더, 없으면 이 스크립트의 윗 폴더(= 설치 폴더)
  // --보기만(--dry): 끄지 않고 무엇을 끌지만 적는다(점검용)
  const 보기만 = process.argv.includes('--dry') || process.argv.includes('--보기만')
  const 인자 = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const 내집 = 인자[0] ? 인자[0] : path.resolve(__dirname, '..')
  try { process.exitCode = 실행(내집, { 보기만 }) } catch (e) {
    console.log(`  [다른 설치본 확인] 건너뜁니다: ${e.message}`)
    process.exitCode = 0
  }
}

module.exports = { 집찾기, 고를것 }
