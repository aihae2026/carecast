const { exec, execFile } = require('child_process')
const path = require('path')
const router = require('express').Router()
const { getAutoStatus, saveLastUpdate, restartWhenIdle } = require('../services/autoUpdate')

const PROJECT_DIR = path.join(__dirname, '../..')

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: 'store',
}

let state = { running: false, log: [], done: false, error: null }

// ── P-85: 시간제한을 명령별로 나눈다 ─────────────────────────────────
// 예전엔 전 명령이 5분 고정이었다. 자동 경로는 이미 npm 만 10분을 준다(autoUpdate.js:59-60) —
// **찬 PC 의 `npm install`·`vite build` 는 5분을 넘긴다.** 그런데 P-73 수정으로 이제
// 그 타임아웃이 **되돌리기를 부른다.** 고치기 전에는 로그만 남았으니, 그 수정이 이 차이의
// 대가를 키운 셈이다. 자동 경로와 같은 값으로 맞춘다.
const GIT_TIMEOUT_MS = 5 * 60 * 1000
const NPM_TIMEOUT_MS = 10 * 60 * 1000

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, {
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      env: GIT_ENV,
      timeout: cmd.startsWith('npm') ? NPM_TIMEOUT_MS : GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const out = (stdout + '\n' + stderr).trim()
      if (out) state.log.push(...out.split('\n').filter(l => l.trim()).slice(0, 30))
      if (err) reject(new Error(out || err.message))
      else resolve(stdout)
    })
  })
}

// ── **설치판은 git 으로 업데이트하지 않는다** (사용자 지적 2026-09-18) ─────────────────────
// *"소프트업데이트 설치판으로 하라고 했는데 왠 소프트웨어 업데이트 왜 들어온가여?"*
// 설치 파일(CareCast-Setup.exe)로 깐 PC 에는 **`.git` 이 없다** — `git archive` 로 만든 판이라서다
// (`scripts/package-release.cjs`). 그런데 설정 화면은 소스로 깐 현장 PC 와 똑같이 「GitHub 에 올리면 버튼 한 번으로
// 업데이트」 칸을 보여 줬고, 누르면 `git pull` 이 실패할 뿐이었다. 설치판의 업데이트는 **새 설치 파일로 다시 까는 것**이다
// (README 「업데이트」). 그래서 화면이 둘을 가를 수 있게 **git 저장소가 있는지**를 알려 준다.
// 워크트리의 `.git` 은 폴더가 아니라 파일이지만 `existsSync` 는 둘 다 참이다 — 개발 워크트리를 설치판으로 오판하지 않는다.
const fs = require('fs')
const git저장소인가 = () => fs.existsSync(path.join(PROJECT_DIR, '.git'))

/** 설치판 안의 `릴리스정보.txt` 에서 판 정보를 읽는다(`package-release.cjs` 가 쓴다). 없으면 null. */
function 설치판정보() {
  try {
    const 글 = fs.readFileSync(path.join(PROJECT_DIR, '릴리스정보.txt'), 'utf8')
    const 커밋 = /대응 커밋:\s*([0-9a-f]{7,40})/i.exec(글)?.[1] || null
    const 날 = /만든 날:\s*([0-9-]{10})/.exec(글)?.[1] || null
    return { commit: 커밋, date: 날 }
  } catch { return null }
}

router.get('/info', (req, res) => {
  if (!git저장소인가()) {
    const 판 = 설치판정보()
    return res.json({ gitRepo: false, commit: 판?.commit || null, date: 판?.date || null, subject: null })
  }
  // **셸을 거치지 않는다**(execFile, 2026-10-17 설치 시험 c12). `exec` 는 Windows 에서 cmd.exe 를 거쳐
  // 따옴표 없는 `|` 를 파이프로 읽었다 — 그래서 소스 설치 PC 에서 commit 이 늘 null 이었다.
  execFile('git', ['log', '-1', '--format=%h|||%s|||%cd', '--date=format:%Y-%m-%d'], { cwd: PROJECT_DIR, encoding: 'utf8', env: GIT_ENV }, (err, stdout) => {
    if (err || !stdout.trim()) return res.json({ gitRepo: true, commit: null })
    const [hash, subject, date] = stdout.trim().split('|||')
    // 마지막 빌드 시간 (dist/index.html 수정 시각)
    let buildAt = null
    try {
      const stat = require('fs').statSync(require('path').join(PROJECT_DIR, 'dist/index.html'))
      buildAt = stat.mtime.toISOString()
    } catch { /* 아직 빌드한 적이 없으면 dist/index.html이 없다 — buildAt은 null로 두고 나머지는 그대로 응답한다 */ }
    res.json({ gitRepo: true, commit: hash?.trim(), subject: subject?.trim(), date: date?.trim(), buildAt })
  })
})

router.get('/auto-status', (req, res) => {
  res.json(getAutoStatus())
})

router.get('/status', (req, res) => {
  res.json(state)
})

// 업데이트 본체. **의존을 주입받는다** — 이 라우트는 git·npm·프로세스 재시작을 부르므로
// 실행 없이 검증할 방법이 이것뿐이다. 같은 저장소의 autoUpdate.checkAndUpdate 가 쓰는 형태다.
// 이음새가 없어서 P-71·P-72·P-73 이 전부 무테스트로 남아 있었다([FACT] EV-002701).
// "지금 막혔나" 의 단일 출처. 라우트와 runUpdate 가 **같은 이것**을 부른다.
function blockedNow() {
  // ── P-83: 자동 업데이트가 돌고 있으면 사람이 눌러도 미룬다 ──────────
  // 예전엔 두 경로가 서로를 몰랐다. `currentBlockedReason()` 은 **방송만** 보므로,
  // 자동이 `npm install` 중이어도 여기서는 `null` 이 나왔다 —
  // 같은 트리에서 pull·install 이 둘 동시에 돌 수 있었다.
  // 방송 판정보다 **먼저** 본다: 이유가 더 구체적이라 사람에게 도움이 된다.
  try {
    if (require('../services/autoUpdate').isUpdating()) return '자동 업데이트가 진행 중입니다'
  } catch { /* 못 읽으면 아래 방송 판정만 본다 */ }
  // **`수동잠금무시` 를 준다**(V③ DEV-MERGE-R8, 2026-09-14). 저 판정은 「수동이 도는가」를
  // 함께 보는데 그것은 **자동 경로를 위한** 검사다(P-83). 그대로 부르면 우리가 방금 켠 잠금을
  // 우리가 읽어 언제나 스스로를 막는다 — 「지금 업데이트」 버튼이 아예 안 먹었다.
  // 자동이 도는지는 바로 위에서 이미 봤다.
  try { return require('../services/autoUpdate').currentBlockedReason({ 수동잠금무시: true }) } catch { return null }
}

// **P-83: 자동 경로가 우리를 볼 창구.** `state.running` 은 runUpdate 가 켜고 끄는 값이다.
// 재시작이 끝날 때까지 안 풀린다(P-72) — 그 창에도 자동이 끼어들면 안 된다.
function isUpdating() { return state.running === true }

async function runUpdate({
  run = runCmd,
  blocked = blockedNow,
  restart = restartWhenIdle,
  // 1.5초를 실제로 기다리면 테스트가 그 사이를 못 본다 — restartWhenIdle 이 쓰는 것과 같은 이음새다.
  schedule = (fn, ms) => setTimeout(fn, ms),
  log = (s) => state.log.push(s),
  setLastUpdate = (iso) => { getAutoStatus().lastUpdate = iso; saveLastUpdate(iso) },
} = {}) {
  // ── P-71: 파일을 건드리기 **전에** 막는다 ───────────────────────────
  // 예전엔 이 검사가 없어 `if (state.running)` 하나만 통과하면 곧바로 `git checkout -- .` 였다.
  // autoUpdate.js 머리말이 그 위험을 이미 적어 뒀다 — "exit 만 문제가 아니었다. git checkout 으로
  // 파일이 갈리고 npm install·build 가 CPU 를 몇 분 잡아먹는 것도 방송 중엔 위험하다."
  // 자동 경로는 그렇게 고쳐졌고(checkAndUpdate 가 blocked() 를 먼저 본다) 여기만 안 왔다.
  // 미루기만 한다 — 사람이 누른 것이라 자동 재시도하지 않는다. 방송이 끝나면 다시 누르면 된다.
  state = { running: true, log: [], done: false, error: null }

  const why = blocked()
  if (why) {
    log(`지금은 업데이트를 미룹니다 — ${why}. 방송이 끝난 뒤 다시 눌러주세요.`)
    state.running = false
    return { deferred: true, reason: why }
  }

  let localSha = null
  let pulled = false
  let built = false
  try {
    log('🔄 로컬 변경사항 초기화 중...')
    await run('git checkout -- .').catch(() => {})

    // 되돌릴 지점을 먼저 잡는다(P-73). 못 얻으면 되돌리기를 포기하되 업데이트는 진행한다 —
    // 되돌리기는 보험이지 전제가 아니다.
    // **P-86: 40자리 hex 가 아니면 안 쓴다.** `rev-parse` 출력이 그대로 `reset --hard` 에
    // 들어가던 자리다. 기계 출력이라 오늘의 위험은 낮지만, 되돌리기는 **되돌릴 곳을 확실히
    // 알 때만** 해야 하는 일이다 — 엉뚱한 문자열로 reset 하는 것보다 안 하는 편이 낫다.
    try {
      const sha = String(await run('git rev-parse HEAD')).trim()
      localSha = /^[0-9a-f]{40}$/.test(sha) ? sha : null
      if (!localSha) log(`되돌릴 지점을 못 읽었습니다(${sha.slice(0, 40)}) — 되돌리기 없이 진행합니다`)
    } catch { localSha = null }

    log('📥 변경 사항 다운로드 중 (git pull)...')
    await run('git pull origin main')
    pulled = true

    log('📦 패키지 확인 중 (npm install)...')
    await run('npm install')

    log('🔨 프론트엔드 빌드 중 (npm run build)...')
    built = true
    await run('npm run build')

    log('✅ 업데이트 완료! 방송이 없을 때 서버를 재시작합니다...')
    state.done = true
    // ── P-72: 재시작이 끝날 때까지 running 을 **풀지 않는다** ─────────
    // 예전엔 여기서 false 로 돌렸는데, 실제 재시작은 아래 restartWhenIdle 이 따로 기다린다.
    // 그 창 내내 중복 가드(`if (state.running)`)가 열려 있었고, 화면의 3초 자동 새로고침(P-70)이
    // 정확히 그 창을 만든다 — 두 번째 사이클이 첫 번째의 재시작 대기 위에 겹친다.
    // state 는 메모리라 재시작하면 초기화된다.

    setLastUpdate(new Date().toISOString())

    // 방송 중이면 끝난 뒤에 재시작한다 (P-2 / CA-008).
    // 1.5초 지연은 그대로 둔다 — 화면이 "완료" 로그를 받을 틈이다.
    // **재시작 판정도 자기 잠금을 보면 안 된다**(V③ DEV-MERGE-R10[1]).
    // `restartWhenIdle` 의 기본 판정은 옵션 없이 `currentBlockedReason` 을 부르고, 그것은
    // `state.running` 을 본다 — P-72 때문에 그 값은 **재시작까지** 켜져 있다. 그래서 첫
    // 수정(시작 문턱만 연 것)만으로는 **빌드는 끝나는데 서버가 영영 재시작을 안 했다.**
    // 화면에는 "완료" 가 뜨고 옛 코드가 계속 돌고, `running` 이 안 풀려 자동 경로까지 막힌다.
    // 시작할 때 쓴 판정(`blocked`)을 그대로 넘긴다 — 두 문턱이 **같은 눈**으로 보게.
    schedule(() => restart({ reasonOf: blocked }), 1500)
    return { ok: true }
  } catch (err) {
    log(`❌ 오류 발생: ${err.message.slice(0, 300)}`)
    state.error = err.message.slice(0, 300)
    state.running = false

    // ── P-73: 되돌린다 ────────────────────────────────────────────────
    // 예전엔 로그만 남기고 끝났다. pull 이나 install 이 중간에 실패하면 트리가 반쯤 갱신되고
    // dist/ 가 깨진 채 남아 다음 기동이 그 상태로 뜬다. 자동 경로는 되돌린 뒤 재빌드한다.
    // **당겨온 것이 없으면 되돌리지 않는다** — 사람이 손으로 둔 변경을 날릴 수 있다.
    // ── P-84: pull 이 **충돌로 멈춘** 경우 ────────────────────────────
    // `pulled` 가 false 라 아래 되돌리기가 안 돈다. 그러면 충돌 표식(<<<<<<<)이 박힌 트리가
    // 그대로 남고, 다음 기동이 그 상태로 뜬다. `merge --abort` 는 병합이 진행 중일 때만
    // 뜻이 있으므로 실패해도 무시한다 — 병합이 아니었다는 뜻일 뿐이다.
    if (!pulled) {
      try {
        await run('git merge --abort')
        log('충돌로 멈춘 병합을 되돌렸습니다')
      } catch { /* 병합 중이 아니었다 — 정상이다 */ }
    }

    if (pulled && localSha) {
      try {
        await run(`git reset --hard ${localSha}`)
        log(`되돌렸습니다 (${localSha.slice(0, 7)}) — 다시 눌러 주세요`)
        // dist/ 는 gitignore 라 되돌리기로 안 돌아온다. 빌드를 시작했었다면 깨졌을 수 있어
        // 되돌린 옛 코드로 한 번 다시 빌드해 화면을 살린다.
        if (built) {
          await run('npm run build')
          log('되돌린 코드로 다시 빌드했습니다')
        }
      } catch (re) {
        log(`되돌리기 실패: ${re.message.slice(0, 200)} — 사람이 확인해주세요`)
      }
    }
    return { ok: false, error: state.error }
  }
}

router.post('/start', (req, res) => {
  if (state.running) return res.json({ ok: false, msg: '이미 업데이트 중입니다.' })
  // 설치판에는 `git pull` 할 저장소가 없다 — 화면이 단추를 감추지만, 옛 화면·직접 호출도 여기서 막는다.
  if (!git저장소인가()) {
    return res.json({ ok: false, msg: '설치판은 새 설치 파일로 업데이트합니다. 새 CareCast-Setup.exe 를 받아 실행하고 「기록을 그대로 두고 설치」를 고르세요.' })
  }

  // 막혔으면 **응답으로 알린다.** runUpdate 안에도 같은 검사가 있지만(그쪽이 진짜 안전장치다)
  // 거기서 막으면 화면이 그 사실을 못 읽는다 — 폴링 분기가 done 과 error 둘뿐이라
  // "업데이트 중" 스피너가 잠긴 채 F5 전엔 안 풀린다(독립 검수 실측).
  // 여기서 {ok:false,msg} 를 내면 화면이 **이미 옳게 처리한다**(systemSettingsEtc.jsx:57-60 —
  // 빨간 문구 + 버튼 복구). 프런트 수정 0줄.
  // 두 곳이 각자 계산하는 것이 아니라 **같은 함수를 두 자리에서 부르는 것**이다.
  const why = blockedNow()
  if (why) {
    state.log = [`지금은 업데이트를 미룹니다 — ${why}. 방송이 끝난 뒤 다시 눌러주세요.`]
    return res.json({ ok: false, msg: `지금은 미룹니다 — ${why}` })
  }

  state.running = true        // 응답 전에 잠근다 — 두 요청이 겹치지 않게
  res.json({ ok: true })

  runUpdate()                 // 상태 초기화는 runUpdate 가 한다(테스트도 같은 자리를 지난다)
})

module.exports = router
module.exports.runUpdate = runUpdate
module.exports.isUpdating = isUpdating
// 상태 사본을 내보낸다 — 테스트가 running/done 전이를 볼 창구가 없었다.
// `{...state}` 는 얕은 복사라 log 배열이 원본과 같은 참조다(독립 검수 지적) — log 도 복사한다.
module.exports.updateState = () => ({ ...state, log: [...state.log] })
