// 서버를 되살리는 파일이 성한가 — 기동할 때 한 번 보고, 새 판본을 깔아 둔다.
//
// 왜 필요했나(2026-09-04, 현장 도스창 로그):
// `'  ' is not recognized as an internal or external command,`가 **3시간 56분 동안 2932번**
// 찍혔다. 4.83초에 한 번 — 시작 bat 감시 루프의 `timeout /t 5` 주기다. 서버를 되살리는
// 것은 그 루프뿐인데, 도스창은 아무도 안 본다.
//
// **원인은 bat 안의 한글이었다.** cmd는 배치 파일을 **바이트 위치로** 읽어서, UTF-8 한글이
// 있으면 goto로 되돌아올 때 글자 중간에 떨어져 조각을 명령으로 실행한다. 같은 루프를 조건만
// 같게 두고 나란히 돌린 실측:
//     한글 UTF-8 → 333바퀴에 오류 1672건, 시작 배너조차 안 뜸
//     ASCII만    → 78바퀴에 오류 0건, 정상
// (처음엔 캐럿이 공백을 이스케이프한 줄로 의심했는데, 재현해 보니 그게 아니었다.)
//
// 그래서 구조를 바꿨다:
//   carecast-start.bat  = 껍데기. ASCII만. chcp를 하고 알맹이를 call한다. 다시는 안 바뀐다.
//   carecast-loop.bat   = 알맹이. 감시 루프. **저장소가 원본**이고 git이 갱신한다.
// 이 파일은 알맹이가 저장소 판본과 다르면 `carecast-loop.next.bat`을 깔아 두고,
// 껍데기가 **다음 부팅 때** 갈아 끼운다. 도는 파일은 아무도 안 건드린다 —
// 도는 중인 bat을 덮어쓰면 cmd가 바이트 위치를 잃고 바로 이 오류를 낸다(그것도 실측했다).
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')

const HOME = path.join(__dirname, '..', '..')
const TEMPLATE = path.join(HOME, 'scripts', 'carecast-loop.template.bat')
const LOOP_NAME = 'carecast-loop.bat'
const NEXT_NAME = 'carecast-loop.next.bat'

// 찍어낸 bat에 나올 수 있는 명령. 여기 없는 첫 낱말은 "사람이 봐야 할 줄"로 센다.
// (틀려도 로그 한 줄이 늘 뿐이라 넉넉하게 잡는다 — 놓치는 쪽이 훨씬 나쁘다.)
const KNOWN = new Set([
  'echo', 'set', 'if', 'goto', 'title', 'cd', 'chcp', 'start', 'call', 'rem', 'for',
  'netstat', 'findstr', 'timeout', 'ping', 'where', 'curl', 'pause', 'exit', 'cls',
  'del', 'copy', 'move', 'schtasks', 'taskkill', 'node', 'npm', 'git', 'powershell',
  'shutdown', 'setlocal', 'endlocal', 'pushd', 'popd', 'type', 'mkdir', 'attrib',
])

// 눈에 안 보이지만 cmd는 글자로 세는 것들. 붙여넣기로 들어온다.
const INVISIBLE = /[\u00a0\u1680\u2000-\u200f\u202f\u205f\u2060\u3000\ufeff]/

// ASCII 밖의 글자가 하나라도 있나. 정규식(`[^\x00-\x7F]`)이 아니라 코드포인트로 센다 —
// 제어문자 범위를 쓴 정규식은 lint(no-control-regex)가 막고, 이쪽이 읽기도 낫다.
function hasNonAscii(s) {
  for (const ch of String(s)) if (ch.codePointAt(0) > 127) return true
  return false
}
/** 한 줄에서 명령 이름만 뽑는다. 명령이 아닌 줄(주석·라벨·빈 줄·닫는 괄호)이면 null. */
function commandOf(line) {
  let s = String(line).trim()
  if (!s || s.startsWith('::') || s.startsWith(':') || s.startsWith(')')) return null
  if (s.startsWith('@')) s = s.slice(1)
  const first = s.split(/[\s=(,]/)[0].toLowerCase()
  if (!first) return null
  return first.replace(/\.$/, '')   // `echo.`
}

/**
 * bat 한 개를 읽고 판정한다. 파일을 안 만지므로 테스트가 문자열만 준다.
 * @param {string} text bat 전문
 */
function inspectBat(text) {
  const lines = String(text).split(/\r?\n/)
  const carets = [], unknown = [], invisible = [], nonAscii = []

  lines.forEach((line, i) => {
    const no = i + 1
    // 한글 등 여러 바이트 글자 — 이것이 현장에서 5초마다 오류를 내던 진짜 원인이다
    if (hasNonAscii(line)) nonAscii.push({ no, line: line.trim() })
    // 캐럿 — 찍어낸 파일에는 하나도 없어야 한다(설치 bat의 캐럿은 찍는 순간 소비된다)
    if (line.includes('^')) carets.push({ no, line: line.trim() })
    if (INVISIBLE.test(line)) invisible.push({ no, line: line.trim() })
    const cmd = commandOf(line)
    if (cmd && !KNOWN.has(cmd)) unknown.push({ no, line: line.trim(), cmd })
  })

  const body = lines.join('\n')
  // ── **감시 주기는 `:waitstop` 의 것이다** (2026-09-16 정정) ────────────────────
  // 앞 판은 파일에서 **맨 처음 나오는** `timeout` 을 집었다. 그런데 이 값은 아래에서
  // *"N초 주기"* 라고 로그에 찍힌다 — 실제 템플릿의 첫 timeout 은 **포트 열리기를
  // 기다리는 1초**라, **감시 주기가 5초인데 로그는 1초라고 말하고 있었다.**
  // (그 어긋남을 시험 주석이 이미 알고 있었다: *"첫 timeout은 포트 대기(1초)다 — 감시
  // 주기는 5초다"*. 알면서 값은 안 고쳤던 자리다.)
  //
  // 2026-09-16 에 루프 앞머리에 **일찍 빠져나가는 timeout** 이 하나 더 생기면서
  // (숨은 창에서 `pause` 가 영원히 멈추던 것을 바꾼 것), 「첫 번째」라는 기준이 아예
  // 무너졌다. 그래서 **자리로** 집는다 — 감시가 도는 자리는 `:waitstop` 한 곳이다.
  const 감시부 = body.split(/^\s*:waitstop\s*$/mi)[1]
  const m = (감시부 ?? '').match(/^\s*timeout\s+\/t\s+(\d+)\s+\/nobreak/mi)

  return {
    carets, unknown, invisible, nonAscii,
    // 껍데기인가 — 알맹이를 call하는 새 구조인가
    isShell: /call\s+"[^"]*carecast-loop\.bat"/i.test(body),
    // 감시가 "포트가 열려 있나"가 아니라 "돌고 있나"를 보는가 (CC-012)
    hasHealth:  /curl\s[^\n]*-f[^\n]*\/api\/health/.test(body),
    // 죽었을 때 되살리는 길이 남아 있는가
    hasRestart: /goto\s+restart/i.test(body) && /:restart/i.test(body),
    loopSeconds: m ? Number(m[1]) : null,
  }
}

/** 감시 루프로서 성한가. 성하면 빈 배열. */
function problemsOf(r) {
  const 문제 = []
  if (r.nonAscii.length) {
    const f = r.nonAscii[0]
    문제.push(`${f.no}번 줄에 ASCII가 아닌 글자가 있습니다 — cmd가 글자 중간에 떨어져 매 바퀴 실패합니다: "${f.line.slice(0, 50)}"`)
  }
  if (r.carets.length) {
    const f = r.carets[0]
    문제.push(`${f.no}번 줄에 캐럿(^)이 남아 있습니다: "${f.line.slice(0, 50)}"`)
  }
  if (r.invisible.length) {
    const f = r.invisible[0]
    문제.push(`${f.no}번 줄에 보이지 않는 공백이 있습니다: "${f.line.slice(0, 50)}"`)
  }
  if (!r.hasHealth) 문제.push('/api/health 판정이 없습니다 — 포트만 보는 옛 판본이라 스케줄러가 멎어도 재시작하지 않습니다')
  if (!r.hasRestart) 문제.push('되살리는 길(goto restart)이 없습니다 — 서버가 죽으면 아무도 안 살립니다')
  return 문제
}

/** 이 PC에서 껍데기가 있을 만한 자리. 없는 것은 조용히 건너뛴다. */
function candidatePaths(home = HOME) {
  const userHome = os.homedir()
  const out = [
    path.join(home, 'carecast-start.bat'),
    path.join(userHome, 'Desktop', 'CareCast 시작.bat'),
  ]
  // OneDrive가 바탕화면을 가져간 PC가 있다 — 거기 있는 것이 실제로 도는 파일이다.
  if (process.env.OneDrive) out.push(path.join(process.env.OneDrive, 'Desktop', 'CareCast 시작.bat'))
  return out
}

/**
 * 저장소 판본과 다르면 **다음 판본을 옆에 깔아 둔다.** 도는 파일은 건드리지 않는다.
 * 껍데기가 다음 부팅 때 move로 갈아 끼운다. 현장은 매일 껐다 켜므로 하루 안에 반영된다.
 *
 * **성한 것만 깐다** — 깨진 템플릿을 깔면 다음 부팅에 현장이 안 뜬다. 위 판정을 그대로 쓴다.
 * @returns {'staged'|'same'|'no-loop-file'|'template-bad'|'no-template'|'error'}
 */
function stageLoopUpdate({
  home = HOME, templatePath = TEMPLATE,
  read = (p) => fs.readFileSync(p, 'utf8'),
  exists = (p) => fs.existsSync(p),
  write = (p, s) => { fs.writeFileSync(p + '.tmp', s, 'utf8'); fs.renameSync(p + '.tmp', p) },
  log = console.log, warn = console.warn,
} = {}) {
  try {
    if (!exists(templatePath)) return 'no-template'
    const loopPath = path.join(home, LOOP_NAME)
    // 알맹이가 없으면 이 PC는 아직 옛 구조다. 여기서 만들어 주면 껍데기가 그걸 부를 리 없어
    // 아무 효과가 없고, 옛 구조라는 사실만 가린다 — 설치 bat을 다시 돌리라고 말하는 편이 낫다.
    if (!exists(loopPath)) return 'no-loop-file'

    const 새것 = read(templatePath)
    const 지금 = read(loopPath)
    const 깔린것 = exists(path.join(home, NEXT_NAME)) ? read(path.join(home, NEXT_NAME)) : null
    if (새것 === 지금) return 'same'
    if (깔린것 === 새것) return 'same'   // 이미 깔아 뒀다 — 다음 부팅을 기다리는 중

    const 문제 = problemsOf(inspectBat(새것))
    if (문제.length) {
      warn(`[시작파일] ⚠ 저장소의 감시 루프 판본이 성하지 않아 깔지 않았습니다 — ${문제[0]}`)
      return 'template-bad'
    }

    write(path.join(home, NEXT_NAME), 새것)
    log('[시작파일] 새 감시 루프를 깔아 뒀습니다 — 다음에 PC를 껐다 켜면 적용됩니다 (도는 파일은 안 건드립니다)')
    return 'staged'
  } catch (e) {
    warn('[시작파일] 새 판본 준비 실패(기동은 계속):', e.message)
    return 'error'
  }
}

/**
 * 기동 시 1회. 찾은 껍데기마다 한 줄씩 남기고, 문제가 있으면 경보까지 올린다.
 * **절대 던지지 않는다** — 점검하다 서버를 못 띄우면 본말전도다.
 */
function checkStartBats({
  home = HOME,
  paths = candidatePaths(home),
  read  = (p) => fs.readFileSync(p, 'utf8'),
  exists = (p) => fs.existsSync(p),
  log   = console.log,
  warn  = console.warn,
  raise = (kind, msg) => { try { require('./alert').raise(kind, msg) } catch { /* 경보 실패로 기동을 막지 않는다 */ } },
  stage = stageLoopUpdate,
} = {}) {
  const results = []
  try {
    for (const p of paths) {
      if (!exists(p)) continue
      let r
      try { r = inspectBat(read(p)) }
      catch (e) { warn(`[시작파일] ${path.basename(p)}을 못 읽었습니다(기동은 계속):`, e.message); continue }

      const name = path.basename(p)

      // 새 구조: 껍데기는 알맹이를 부르기만 한다. 감시가 성한지는 **알맹이**를 봐야 안다.
      if (r.isShell) {
        const loopPath = path.join(home, LOOP_NAME)
        if (!exists(loopPath)) {
          warn(`[시작파일] ⚠ ${name}이 ${LOOP_NAME}을 부르는데 그 파일이 없습니다 — CareCast-설치.bat을 다시 실행하세요`)
          raise('시작파일', `${LOOP_NAME}이 없습니다. CareCast-설치.bat을 다시 실행해 주세요.`)
          continue
        }
        r = { ...inspectBat(read(loopPath)), viaShell: name }
        results.push({ path: loopPath, ...r })
      } else {
        results.push({ path: p, ...r })
      }

      const 이름 = r.viaShell ? `${LOOP_NAME} (${r.viaShell}이 부름)` : name
      const 문제 = problemsOf(r)

      if (문제.length === 0) {
        log(`[시작파일] ${이름} — 감시 정상 (${r.loopSeconds ?? '?'}초 주기 · /api/health 판정 있음)`)
        for (const u of r.unknown.slice(0, 3)) {
          log(`[시작파일] ${이름} ${u.no}번 줄이 낯섭니다 — 첫 낱말 "${u.cmd}": "${u.line.slice(0, 50)}"`)
        }
        continue
      }

      for (const m of 문제) warn(`[시작파일] ⚠ ${이름} — ${m}`)
      if (!r.viaShell) {
        // 옛 구조다. 새 구조로 가야 자동 갱신을 받는다.
        warn('[시작파일] ⚠ 옛 구조입니다 — CareCast-설치.bat을 다시 실행하면 자동 갱신되는 구조로 바뀝니다.')
      }
      raise('시작파일', `감시 파일이 온전하지 않습니다 — ${문제[0]}. CareCast-설치.bat을 다시 실행해 주세요.`)
    }

    if (results.length === 0) log('[시작파일] 시작 bat을 못 찾았습니다 — 다른 방법으로 띄운 것 같습니다(감시·자동 재시작 없음)')
  } catch (e) {
    warn('[시작파일] 점검 실패(기동은 계속):', e.message)
  }

  // 판정과 별개로, 저장소에 새 판본이 있으면 깔아 둔다.
  try { stage({ home, log, warn }) } catch (e) { warn('[시작파일] 새 판본 준비 실패:', e.message) }
  return results
}

module.exports = { inspectBat, problemsOf, checkStartBats, stageLoopUpdate, candidatePaths, commandOf, TEMPLATE, LOOP_NAME, NEXT_NAME }
