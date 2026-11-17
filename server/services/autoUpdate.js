const { rawSetting } = require('../domain/settingsRead')
const { exec } = require('child_process')
const path = require('path')
const { broadcastSSE } = require('./sse')
const { getDB }        = require('../db/schema')

const PROJECT_DIR = path.join(__dirname, '../..')
const CHECK_INTERVAL_MS = 10 * 60 * 1000  // 10분마다 체크

let busy = false

// 자동 업데이트 상태 (외부에서 조회 가능)
const autoStatus = {
  lastCheck:    null,   // ISO 문자열
  lastUpdate:   null,   // ISO 문자열
  lastError:    null,   // 에러 메시지
  log:          [],     // 최근 로그 (최대 20줄)
}

// DB에서 이전 업데이트 시각 복원 (서버 재시작 후에도 "없음" 방지)
function loadLastUpdate() {
  try {
    const db  = getDB()
    const last = rawSetting(db, 'auto_update_last')
    if (last) autoStatus.lastUpdate = last
  } catch { /* 마지막 업데이트 시각은 화면 표시용이다 — 못 읽어도 자동 업데이트는 돌아야 한다 */ }
}

function saveLastUpdate(iso) {
  try {
    const db = getDB()
    db.prepare("INSERT INTO settings (key, value) VALUES ('auto_update_last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(iso)
  } catch { /* 마지막 업데이트 시각 기록 실패로 업데이트 자체를 실패로 만들지 않는다 */ }
}

function addLog(msg) {
  const line = `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`
  autoStatus.log.push(line)
  if (autoStatus.log.length > 20) autoStatus.log.shift()
  console.log('[AutoUpdate]', msg)
}

// TTY 없는 환경(Task Scheduler 등)에서 git credential 프롬프트가 뜨면
// /dev/tty 오류로 실패하므로 GIT_TERMINAL_PROMPT=0 으로 프롬프트 자체를 차단
// wincredman은 서비스 컨텍스트에서 Windows Credential Manager 접근 불가 →
// GIT_CONFIG_* 환경변수로 credential.helper=store 강제 (git 2.32+)
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: 'store',
}

// npm 단계는 git보다 오래 걸린다(찬 PC의 npm install, vite build). 5분은 빠듯해서
// 정상 설치가 잘릴 수 있는데, **install 중간에 잘리면 node_modules가 반쯤 남아** 다음
// 기동이 더 위험해진다. 그렇다고 무한정 두면 busy가 안 풀려 업데이트가 영영 멈춘다.
const GIT_TIMEOUT_MS = 5 * 60 * 1000
const NPM_TIMEOUT_MS = 10 * 60 * 1000

function run(cmd) {
  const timeoutMs = cmd.startsWith('npm') ? NPM_TIMEOUT_MS : GIT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    exec(cmd, {
      cwd:       PROJECT_DIR,
      encoding:  'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout:   timeoutMs,
      env:       GIT_ENV,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().slice(0, 300)))
      else resolve(stdout.trim())
    })
  })
}

// ── 업데이트해도 되는 때인가 ──────────────────────────────────────────
//
// 왜 필요했나(2026-08-29 리뷰 CC-011): 방송 중인지 확인하지 않고 process.exit(100)을
// 불렀다. 시퀀스 한복판에서 서버가 죽으면 그 방송은 통째로 사라지고, *_last_fired가
// 이미 찍혔으면 재발동도 안 된다. 게다가 exit만 문제가 아니다 — git checkout -- . 로
// 파일이 갈리고 npm install·npm run build가 CPU를 몇 분간 잡아먹는 것도 방송 중엔 위험하다.
//
// BGM 재생은 막지 않는다. BGM은 식사 시간 내내 길게 돌아서 이걸로 막으면 업데이트가 영영
// 안 된다. 반면 broadcast·video는 길어야 몇 분이라 기다릴 수 있다.
const UPDATE_LEAD_MIN = 15   // 다음 방송까지 이만큼 안 남았으면 건너뛴다(설치·빌드 시간 감안)

function minutesUntil(nowMin, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h * 60 + m) - nowMin   // 음수면 이미 지난 시각
}

/**
 * 지금 업데이트하면 안 되는 이유. 해도 되면 null.
 * 순수 함수라 git·타이머 없이 테스트한다.
 * @param {Date}   now      지금
 * @param {object} playing  nowPlaying.get() 결과
 * @param {Array}  times    [{ label, time:'HH:MM' }] 오늘 남은 방송 시각
 */
function blockedReason({ now = new Date(), playing = {}, times = [], leadMin = UPDATE_LEAD_MIN } = {}) {
  if (playing.broadcast) return `방송 중("${playing.broadcast.title ?? '제목 없음'}")`
  if (playing.video)     return `영상 재생 중("${playing.video.name ?? '제목 없음'}")`
  // 시퀀서를 안 지나는 소리 둘. nowPlaying 은 broadcastSequencer 를 지나는 것만 담는데,
  // 마이크(routes/mic.js)와 즉시·비상 방송(routes/tts.js)은 audioQueue.enqueue 를 직접 불러
  // nowPlaying 을 안 건드린다 — 그래서 "방송 중" 판정에서 통째로 빠져 있었다(P-66).
  // 같은 사각지대를 scheduler.js:549-558 은 이미 마이크까지 보도록 고쳐 뒀다.
  if (playing.mic)       return '마이크 생방송 중'
  if (playing.speaker)   return '즉시·비상 방송이 서버 스피커로 나가는 중'

  const nowMin = now.getHours() * 60 + now.getMinutes()
  for (const t of times) {
    const left = minutesUntil(nowMin, t.time)
    if (left >= 0 && left <= leadMin) return `${t.label}(${t.time})까지 ${left}분 남음`
  }
  return null
}

// 실제 상태를 모아 위 판정에 넣는다. 조회가 실패하면 **막는 쪽으로** 판단한다 —
// 확신이 없을 때 방송을 끊는 것보다 업데이트를 한 주기 미루는 편이 훨씬 싸다.
/**
 * @param {{수동잠금무시?: boolean}} [옵션]
 *   **수동 경로가 자기 자신을 부를 때 `true`.**(V③ DEV-MERGE-R8, 2026-09-14)
 *
 *   이 판정은 아래에서 「수동 업데이트가 도는가」를 함께 본다 — 그것은 **자동 경로를 위한**
 *   검사다(P-83). 그런데 수동 경로(`routes/update.blockedNow`)가 이 판정을 통째로 재사용해서,
 *   **자기가 켠 잠금을 자기가 읽고** 언제나 "수동 업데이트가 진행 중입니다" 로 스스로를 막았다.
 *   현장에서 「지금 업데이트」 버튼이 아예 안 먹었다.
 *
 *   그래서 **부르는 쪽이 누구인지**를 받는다. 자동은 그대로(기본값 `false`) 수동 잠금을 본다.
 */
function currentBlockedReason({ 수동잠금무시 = false } = {}) {
  try {
    const { getDB } = require('../db/schema')
    const { readEnabledAutoTimes } = require('../domain/autoBroadcasts')
    const nowPlaying = require('./nowPlaying')

    const times = readEnabledAutoTimes(getDB()).map(t => ({ label: t.label, time: t.time }))
    for (const row of getDB().prepare('SELECT title, scheduled_time FROM schedules WHERE active = 1').all()) {
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(row.scheduled_time || '')) {
        times.push({ label: row.title || '예약 방송', time: row.scheduled_time })
      }
    }
    // 시퀀서 밖의 두 신호를 여기서 채운다. 조회가 터져도 업데이트를 막는 쪽으로 둔다 —
    // 확신이 없을 때 방송을 끊는 것보다 한 주기 미루는 편이 훨씬 싸다(이 함수의 catch 와 같은 이유).
    // 못 읽은 것을 "방송 중"으로 접지 않는다. 막는 결과는 같지만 로그가 거짓말을 하면
    // 그 PC 가 왜 새 버전을 안 받는지 아무도 못 찾는다 — 바깥 catch 는 이미 정직하다.
    let mic = false, speaker = false
    const 못읽음 = []
    try { mic = require('./micLive').isLive() } catch { 못읽음.push('마이크 신호') }
    try { speaker = require('./audioQueue').isBusy() } catch { 못읽음.push('서버 스피커 대기열') }
    if (못읽음.length) return `상태 확인 실패(${못읽음.join(' · ')})`
    // **P-83: 사람이 누른 수동 업데이트가 돌고 있으면 미룬다.** 예전엔 서로를 몰라서
    // 같은 트리에서 pull·install 이 둘 동시에 돌 수 있었다. 지연 require 다 —
    // routes/update.js 가 이 파일을 먼저 require 하므로 위에서 부르면 순환이 된다.
    // `수동잠금무시` 면 건너뛴다 — **부르는 쪽이 그 수동 업데이트 자신**이라는 뜻이다.
    if (!수동잠금무시) {
      try {
        if (require('../routes/update').isUpdating()) return '수동 업데이트가 진행 중입니다'
      } catch { /* 라우트가 아직 안 올라왔다 — 그러면 수동도 못 돈다 */ }
    }
    return blockedReason({ playing: { ...nowPlaying.get(), mic, speaker }, times })
  } catch (e) {
    return `상태 확인 실패(${e.message})`
  }
}

/**
 * 방송이 끝나기를 기다렸다가 재시작한다. 시작 bat이 다시 띄운다.
 * 코드는 이미 디스크에 갱신돼 있고 프로세스만 옛 코드로 돌고 있는 상태이므로,
 * **포기하지 않고** 조용해질 때까지 기다린다(상한을 두면 결국 방송을 끊게 된다).
 */
function restartWhenIdle({ reasonOf = currentBlockedReason, exit = (c) => process.exit(c),
                           schedule = (fn, ms) => setTimeout(fn, ms), waitMs = 60 * 1000, _tries = 0 } = {}) {
  const reason = reasonOf()
  if (!reason) {
    addLog('재시작합니다')
    exit(100)
    return
  }
  // 매분 로그를 남기면 이력이 이걸로 덮인다 — 10분에 한 번만 알린다
  if (_tries % 10 === 0) addLog(`재시작 대기 중 — ${reason}`)
  schedule(() => restartWhenIdle({ reasonOf, exit, schedule, waitMs, _tries: _tries + 1 }), waitMs)
}

let pendingRestart = false

// 같은 커밋으로 계속 실패할 때 (CC-024)
//
// 롤백만 넣으면 다음 주기에 자연히 재시도되는데, **진짜로 망가진 커밋이면 10분마다
// npm install + build가 무한 반복되어 현장 PC를 갉아먹는다.** 그렇다고 영구 중단하면
// 네트워크가 잠깐 끊긴 것뿐일 때도 새 버전이 영영 안 들어간다.
// 그래서 3회까지는 10분 주기로 붙어 보고, 그 뒤로는 1시간에 한 번만 조용히 시도한다.
const MAX_FAST_RETRIES = 3
const SLOW_RETRY_MS    = 60 * 60 * 1000

const failure = { sha: null, count: 0, lastAt: 0 }

function resetFailureState() { failure.sha = null; failure.count = 0; failure.lastAt = 0 }

/** 이 커밋을 지금 시도해도 되는가. 안 되면 이유 문자열 */
function retryHeldBack(remote, nowMs) {
  if (failure.sha !== remote) return null                 // 새 커밋은 언제나 즉시 시도한다
  if (failure.count < MAX_FAST_RETRIES) return null
  const left = SLOW_RETRY_MS - (nowMs - failure.lastAt)
  if (left <= 0) return null
  return `${failure.count}회 실패한 버전이라 ${Math.ceil(left / 60000)}분 뒤에 다시 시도합니다`
}

function raiseDefault(kind, message) {
  try { require('./alert').raise(kind, message) }
  catch (e) { console.error('[AutoUpdate] 경보 전달 실패:', e.message) }
}

/**
 * 한 주기.
 *
 * 주입 이음새(run·raise·blockedReason·restart·now)를 둔 이유: 이 함수의 위험한 성질은
 * "실패했을 때 무엇을 되돌리는가"인데 진짜 git으로는 검증할 수 없다(현장 저장소를
 * 되감아야 한다). 운영 경로는 기본값을 그대로 쓴다.
 */
async function checkAndUpdate({
  run: runCmd = run,
  raise = raiseDefault,
  blockedReason: blocked = currentBlockedReason,
  restart = () => { pendingRestart = true; setTimeout(() => restartWhenIdle(), 1500) },
  now = Date.now,
} = {}) {
  if (busy) return
  // 코드는 이미 갱신됐고 재시작만 기다리는 중 — 또 pull하면 상태가 꼬인다
  if (pendingRestart) return
  busy = true
  autoStatus.lastCheck = new Date().toISOString()

  let pulled   = false   // pull이 끝났나 — 되돌릴 것이 있는가
  let built    = false   // build를 시작했나 — dist를 건드렸는가
  let localSha = null

  try {
    addLog('GitHub 확인 중...')
    await runCmd('git fetch origin')
    const local  = await runCmd('git rev-parse HEAD')
    const remote = await runCmd('git rev-parse origin/main')
    // **P-86: 40자리 hex 가 아니면 되돌리기에 안 쓴다.** rev-parse 출력이 그대로
    // `reset --hard` 에 들어가던 자리다. 되돌리기는 되돌릴 곳을 확실히 알 때만 하는 일이라,
    // 엉뚱한 문자열로 reset 하는 것보다 안 하는 편이 낫다. 수동 경로도 같게 맞췄다.
    localSha = /^[0-9a-f]{40}$/.test(local) ? local : null
    if (!localSha) addLog(`되돌릴 지점을 못 읽었습니다(${String(local).slice(0, 40)}) — 되돌리기 없이 진행합니다`)

    if (local === remote) {
      addLog(`이미 최신 버전 (${local.slice(0,7)})`)
      // **실패 기록을 여기서 무조건 지우지 않는다.** 예전엔 지웠는데, 반쯤 적용된 채 굳은
      // 상태가 정확히 local === remote라서 10분 뒤 실패 흔적이 사라졌다 — 아무도 모르게 되는 자리다.
      if (failure.count === 0) autoStatus.lastError = null
      return
    }

    const held = retryHeldBack(remote, now())
    if (held) { addLog(held); return }

    // 파괴적 단계(작업 트리 되돌리기·pull·install·build) 전에 막는다.
    // exit만 막으면 늦다 — build가 CPU를 잡아먹는 것만으로도 방송이 끊긴다.
    const why = blocked()
    if (why) {
      addLog(`새 버전이 있지만 지금은 미룹니다 — ${why}`)
      return   // busy는 finally에서 풀린다. 10분 뒤 주기에 다시 본다
    }

    addLog(`새 버전 감지 (${local.slice(0,7)} → ${remote.slice(0,7)}), 업데이트 시작...`)

    await runCmd('git checkout -- .')
    await runCmd('git pull origin main')
    pulled = true
    addLog('git pull 완료')

    await runCmd('npm install')
    addLog('npm install 완료')

    built = true
    await runCmd('npm run build')
    addLog('빌드 완료, 재시작...')

    autoStatus.lastUpdate = new Date().toISOString()
    autoStatus.lastError  = null
    resetFailureState()
    saveLastUpdate(autoStatus.lastUpdate)
    broadcastSSE('server_update', {})
    // 빌드에 몇 분이 걸리므로 그 사이에 방송이 시작됐을 수 있다. 한 번 더 확인하고,
    // 방송 중이면 끝날 때까지 기다렸다가 재시작한다.
    restart()
  } catch (e) {
    const msg = e.message.slice(0, 300)
    autoStatus.lastError = msg

    // (0) **P-84: pull 이 충돌로 멈춘 경우.** `pulled` 가 false 라 아래 되돌리기가 안 돈다.
    //     그러면 충돌 표식이 박힌 트리가 그대로 남고 다음 기동이 그 상태로 뜬다.
    //     `merge --abort` 는 병합 중일 때만 뜻이 있으므로 실패해도 무시한다.
    if (!pulled) {
      try { await runCmd('git merge --abort'); addLog('충돌로 멈춘 병합을 되돌렸습니다') }
      catch { /* 병합 중이 아니었다 — 정상이다 */ }
    }

    // (1) 되돌린다 — 안 하면 디스크(새 코드)와 프로세스(옛 코드)가 어긋난 채 굳고,
    //     HEAD가 이미 origin/main과 같아서 **다시는 install/build를 시도하지 않는다.**
    if (pulled && localSha) {
      try {
        await runCmd(`git reset --hard ${localSha}`)
        addLog(`되돌렸습니다 (${localSha.slice(0,7)}) — 다음 주기에 다시 시도합니다`)
        // (2) dist/는 gitignore라 reset으로 안 돌아온다. 빌드를 시작했었다면 깨졌을 수 있어
        //     되돌린 옛 코드로 한 번 다시 빌드해 화면을 살린다.
        if (built) {
          await runCmd('npm run build')
          addLog('되돌린 코드로 다시 빌드했습니다')
        }
      } catch (re) {
        addLog(`되돌리기 실패: ${re.message.slice(0, 200)}`)
      }
    }

    // (3) 같은 커밋 반복 실패를 센다
    try {
      const remote = await runCmd('git rev-parse origin/main')
      failure.count = (failure.sha === remote) ? failure.count + 1 : 1
      failure.sha   = remote
    } catch { failure.count += 1 }
    failure.lastAt = now()

    // 인증 오류는 별도 안내 (wincredman / credential store 관련)
    if (msg.includes('credential') || msg.includes('Username') || msg.includes('Authentication')) {
      addLog('GitHub 인증 미설정 — 현장 PC에서 git fetch origin 한 번 실행 필요')
      console.error('[AutoUpdate] GitHub 인증 미설정:', msg)
      raise('자동업데이트', 'GitHub 인증이 안 돼 업데이트가 멈췄습니다. 현장 PC에서 git fetch origin을 한 번 실행해주세요.')
    } else {
      addLog(`실패: ${msg}`)
      console.error('[AutoUpdate] 실패:', msg)
      // (4) 예전엔 로그 한 줄이 전부였다 — cmd 창이 닫히면 사라지고 아무도 모른다.
      raise('자동업데이트', failure.count >= MAX_FAST_RETRIES
        ? `업데이트가 ${failure.count}회 연속 실패했습니다. 저절로 낫지 않는 문제라 사람이 확인해야 합니다: ${msg}`
        : `업데이트에 실패해 이전 버전으로 되돌렸습니다: ${msg}`)
    }
  } finally {
    busy = false
  }
}

function getAutoStatus() { return autoStatus }

// ── **기본은 꺼져 있다** (공개판, 2026-10-17 검수 지적 4) ────────────────────────
// 공개 저장소를 `git clone` 하면 main 가지라, 예전 판은 그 PC 를 현장으로 보고 10분마다
// `git checkout -- .` → `git pull origin main` → 재시작을 했다. 받아 쓰는 사람이 고친 내용이
// 조용히 지워지고, 상류의 새 코드가 동의 없이 받아져 실행된다. 그래서 **켜겠다고 적은 PC 만** 돈다.
//
// 켜는 법(둘 중 하나):
//   · 설정 값 `auto_update_enabled` = '1' — `server/.env` 에 `AUTO_UPDATE_ENABLED=1` 을 적고
//     서버를 한 번 다시 켜면 들어간다. 이 키는 화면에 칸이 없어 **기동할 때마다 `.env` 값이 DB 를 덮는다**
//     (importEnvSettings 의 ENV_WINS). 끄려면 `AUTO_UPDATE_ENABLED=0` — 줄을 지우기만 하면 DB 값이 남는다.
//   · 환경변수 `CARECAST_AUTO_UPDATE=1` — 서비스로 띄울 때.
// 켜도 아래 가지 조건(main)은 그대로다. 「지금 업데이트」 단추(사람이 누르는 것)는 이 스위치와 무관하다.
const 켜는값 = /^(1|true|on|yes|켜기|켬)$/i
function 자동업데이트켜짐({ env = process.env, 설정값 } = {}) {
  if (켜는값.test(String(env.CARECAST_AUTO_UPDATE ?? '').trim())) return true
  let v = 설정값
  if (v === undefined) { try { v = rawSetting(getDB(), 'auto_update_enabled') } catch { v = null } }
  return 켜는값.test(String(v ?? '').trim())
}

// main 브랜치(현장 PC)에서만 자동 업데이트 활성화.
// dev 브랜치(개발 PC)에서 돌면 git checkout -- . 로 미커밋 작업이 지워지고
// git pull origin main 으로 dev 작업 트리에 main이 섞이며, 업데이트 후 process.exit(100)로
// 서버가 죽어버리는데 dev 환경엔 재시작시켜줄 프로세스 매니저가 없어 API가 그냥 끊긴다.
module.exports = function startAutoUpdate() {
  if (!자동업데이트켜짐()) {
    console.log('[AutoUpdate] 꺼져 있음(기본값) — 켜려면 server/.env 에 AUTO_UPDATE_ENABLED=1 (README 「업데이트」)')
    return
  }
  exec('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR }, (err, stdout) => {
    const branch = (stdout || '').trim()
    if (err || branch !== 'main') {
      console.log(`[AutoUpdate] branch="${branch || '?'}" — main이 아니므로 비활성화 (개발 환경 보호)`)
      return
    }
    loadLastUpdate()   // 서버 재시작 후 이전 업데이트 시각 복원
    setTimeout(checkAndUpdate, 60 * 1000)
    setInterval(checkAndUpdate, CHECK_INTERVAL_MS)
    console.log('[AutoUpdate] 자동 업데이트 활성화 — 10분마다 GitHub 체크')
  })
}
module.exports.자동업데이트켜짐 = 자동업데이트켜짐
module.exports.getAutoStatus  = getAutoStatus
module.exports.blockedReason  = blockedReason
// 규칙(blockedReason)만 내보내면 **무엇을 그 규칙에 넣어 주는가**가 검증에서 빠진다.
// P-66 이 정확히 그 자리였다 — 규칙은 멀쩡한데 마이크·대기열을 아무도 안 읽었다.
module.exports.currentBlockedReason = currentBlockedReason
// **P-83: 자기 상태를 밖에서 볼 수 있게 한다.** 수동 경로가 이것을 안 보고 눌러서
// 같은 트리에서 pull·install 이 둘 동시에 돌 수 있었다. `busy` 는 지금 돌고 있는 것이고,
// `pendingRestart` 는 코드는 이미 갱신됐고 재시작만 기다리는 상태다 — 둘 다 손대면 안 된다.
module.exports.isUpdating = () => busy || pendingRestart
module.exports.restartWhenIdle = restartWhenIdle
module.exports.UPDATE_LEAD_MIN = UPDATE_LEAD_MIN
module.exports.saveLastUpdate = saveLastUpdate
module.exports.checkAndUpdate = checkAndUpdate
module.exports.MAX_FAST_RETRIES = MAX_FAST_RETRIES
module.exports._resetFailureStateForTest = resetFailureState
