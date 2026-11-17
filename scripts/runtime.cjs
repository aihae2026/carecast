'use strict'
// **함께 담아 보낼 런타임을 받아 둔다** — Node · 파이썬(+numpy).
//
// ── 왜 담나 (사용자 지시 2026-09-16) ───────────────────────────────────────
// *"그냥 깔끔하게 설치 인스톨 파일처럼 하면 안돼?"* · *"파이썬도 묶어"*
//
// 앞 판은 소스 한 벌이었다. 받는 쪽이 Node 를 깔고 `npm install`(5~15분) 과 빌드를
// 직접 해야 했다 — 그건 「설치 파일」이 아니라 「소스 배포」다. 담으면 압축을 풀고
// bat 하나를 누르면 끝난다.
//
// ── **판본을 고정하는 이유** ───────────────────────────────────────────────
// *"연결해서 최신버전으로 다운받을 수 있게 하면 호환성이 문제려나?"* — **문제다.**
//
// 이 저장소가 방금 그 실례를 겪었다: 서버 시작 명령이 `--experimental-sqlite` 를 달고
// 있었는데, 그 스위치는 Node 24 에서 **정식이 되면서 없어질 예정**이다. 없는 스위치를
// 준 Node 는 경고가 아니라 **즉사**한다 — 어느 날 최신판을 받는 순간 방송이 안 켜진다.
// 파이썬도 같다: 갓 나온 판에는 `faster-whisper` 같은 것의 휠이 아직 없는 일이 흔하다.
//
// 그래서 **우리가 시험을 통과시킨 그 판**을 박아 둔다. 올리는 것은 사람이 정한다 —
// 올릴 때는 아래 판본을 바꾸고 **그 실행기로 시험을 다시 돌린다.**
//
// ── 받아 둔 것은 저장소에 넣지 않는다 ──────────────────────────────────────
// 수백 MB 다. `.cache/runtime/` 에 두고 `.gitignore` 가 막는다. 없으면 여기서 받는다 —
// 한 번 받아 두면 다음 포장은 바로 된다.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const 캐시 = path.join(ROOT, '.cache', 'runtime')

// ── 박아 둔 판본 ───────────────────────────────────────────────────────────
// **바꾸면 그 실행기로 시험을 다시 돌린다.** 여기 숫자 하나가 현장에서 도는 실행기다.
const NODE판 = '24.19.0'      // 2026-09-16 에 시험 3367건이 통과한 바로 그 판
const PY판 = '3.12.10'        // numpy 휠이 넉넉히 있는 판

const NODE_URL = `https://nodejs.org/dist/v${NODE판}/node-v${NODE판}-win-x64.zip`
const PY_URL = `https://www.python.org/ftp/python/${PY판}/python-${PY판}-embed-amd64.zip`
const GETPIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

/** 파이썬 꾸러미 — **여기 적힌 것만** 들어간다. */
const 파이썬꾸러미 = [
  'numpy',      // 마이크 생방송 재생기(`carecast_player.py`)가 쓴다
  // faster-whisper 는 **일부러 뺀다** — 의존성 200MB + 모델 460MB 다. 자막은 없어도
  // 방송이 나가는 부가 기능이라, 필요한 사람만 초기 설정에서 받는 편이 낫다.
]

/** **걷어낸** 꾸러미 — 예전 캐시에 남아 있으면 뺀다(2026-09-21 안내 음성 엔진 교체로 쓰지 않게 된 것). */
const 걷은꾸러미 = ['edge-tts']

const 실행 = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })

function 받기(url, 받을곳) {
  if (fs.existsSync(받을곳)) return false
  fs.mkdirSync(path.dirname(받을곳), { recursive: true })
  console.log(`  받는 중: ${url}`)
  // curl 은 Windows 10 부터 기본으로 있다. `-f` 로 404 를 조용히 넘기지 않는다 —
  // 실패한 응답을 파일로 받아 두면 다음 단계가 "깨진 zip" 으로 죽는다.
  실행('curl', ['-fsSL', '--max-time', '900', '-o', 받을곳, url])
  return true
}

function 풀기(zip, 나갈곳, 안쪽 = null) {
  fs.mkdirSync(나갈곳, { recursive: true })
  const args = ['-xf', zip, '-C', 나갈곳]
  if (안쪽) args.push('--strip-components=1', 안쪽)
  실행('tar', args)
}

/**
 * 런타임이 준비돼 있게 한다. 이미 있으면 아무것도 안 받는다.
 * @returns {{node판: string, python판: string}}
 */
function 준비() {
  fs.mkdirSync(캐시, { recursive: true })
  const nodeExe = path.join(캐시, 'node', 'node.exe')
  const pyExe = path.join(캐시, 'python', 'python.exe')

  // ── Node ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(nodeExe)) {
    console.log(`\n[런타임] Node ${NODE판} 준비`)
    const zip = path.join(캐시, `node-${NODE판}.zip`)
    받기(NODE_URL, zip)
    const 임시 = path.join(캐시, '_node')
    fs.rmSync(임시, { recursive: true, force: true })
    풀기(zip, 임시)
    const 안 = path.join(임시, `node-v${NODE판}-win-x64`)
    fs.mkdirSync(path.join(캐시, 'node'), { recursive: true })
    // **실행기와 라이선스만** 옮긴다. npm·문서는 안 쓴다(설치판은 npm install 을 안 한다).
    for (const 이름 of ['node.exe', 'LICENSE']) {
      fs.copyFileSync(path.join(안, 이름), path.join(캐시, 'node', 이름))
    }
    fs.rmSync(임시, { recursive: true, force: true })
  }

  // ── 파이썬 ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(pyExe)) {
    console.log(`\n[런타임] Python ${PY판} 준비`)
    const zip = path.join(캐시, `python-${PY판}.zip`)
    받기(PY_URL, zip)
    풀기(zip, path.join(캐시, 'python'))

    // **`import site` 를 켜야 pip 로 넣은 것이 보인다.** 임베디드 판은 기본으로 꺼져
    // 있어서, 안 켜면 `pip install` 은 되는데 `import numpy` 가 실패한다 —
    // 그 조합이 가장 헷갈린다(설치는 성공했다고 하고 마이크 재생이 안 된다).
    const pth = path.join(캐시, 'python', `python${PY판.split('.').slice(0, 2).join('')}._pth`)
    fs.writeFileSync(pth, ['python312.zip', '.', 'Lib\\site-packages', '', 'import site', ''].join('\n'))

    const getpip = path.join(캐시, 'python', 'get-pip.py')
    받기(GETPIP_URL, getpip)
    실행(pyExe, [getpip, '--no-warn-script-location'])
    fs.rmSync(getpip, { force: true })
  }

  // **걷어낸 꾸러미는 받아 둔 캐시에서도 뺀다** (Codex ④-d 1회차 Medium). 목록에서 지워도 예전에 받아 둔
  // 런타임 캐시에는 남아, 설치판이 그 폴더를 통째로 담으며 다시 딸려 갔다.
  // **있나 확인과 빼기를 가른다** (Codex ④-d 2회차 Medium) — 한 try 로 묶었더니 빼기 실패까지 「없다」로
  // 삼켜, 옛 꾸러미가 남은 채 준비가 성공했다. 빼기가 실패하면 여기서 멈춘다(설치판에 다시 딸려 가지 않게).
  const 있나 = (모듈) => {
    try { execFileSync(pyExe, ['-c', `import ${모듈}`], { stdio: 'pipe', timeout: 30000 }); return true }
    catch { return false }   // import 실패 = 없다 — 원하는 상태
  }
  for (const 꾸러미 of 걷은꾸러미) {
    const 모듈 = 꾸러미.replace(/-/g, '_')
    if (!있나(모듈)) continue
    console.log(`\n[런타임] 걷어낸 꾸러미를 뺀다: ${꾸러미}`)
    실행(pyExe, ['-m', 'pip', 'uninstall', '-y', 꾸러미, '--quiet'])   // 실패하면 던진다 — 삼키지 않는다
    if (있나(모듈)) throw new Error(`걷어낸 꾸러미 ${꾸러미} 가 런타임 캐시에서 빠지지 않았다 — .cache/runtime 을 지우고 다시 준비하세요`)
  }

  // 꾸러미는 **매번 확인**한다 — 목록에 하나 더할 때 캐시를 통째로 지우지 않아도 되게.
  for (const 꾸러미 of 파이썬꾸러미) {
    const 모듈 = 꾸러미.replace(/-/g, '_')
    try {
      execFileSync(pyExe, ['-c', `import ${모듈}`], { stdio: 'pipe', timeout: 30000 })
    } catch {
      console.log(`\n[런타임] 파이썬 꾸러미 설치: ${꾸러미}`)
      실행(pyExe, ['-m', 'pip', 'install', 꾸러미, '--no-warn-script-location', '--quiet'])
    }
  }

  return { node판: NODE판, python판: PY판 }
}

/** 압축에 담을 런타임 폴더. */
function 런타임경로() { return 캐시 }

/** 시험이 쓰는 자리 — 받지 않고 목록만 본다. */
module.exports = { 준비, 런타임경로, NODE판, PY판, 파이썬꾸러미, 캐시, os }
