// 이 PC는 "현장 PC"인가 "개발·테스트 PC"인가.
//
// 왜 필요했나(2026-08-30): 같은 코드가 요양원 현장 PC와 개발 PC 양쪽에서 도는데, 어떤
// 동작은 현장에서만 옳다. 실제로 사고를 낸 것이 audioDeviceWatcher다 — 이 감시는 2분마다
// **Windows의 기본 출력장치를 설정값으로 강제로 되돌린다.** 현장에서는 누가 실수로 장치를
// 바꿔도 방송이 스피커로 나가게 해 주는 안전장치지만, 개발 PC에서는 개발자가 고른 사운드
// 장치를 케어캐스트가 2분마다 뺏어가는 짓이 된다.
//
// 판정 기준은 브랜치다(main = 현장). 새 개념을 하나 더 만들지 않으려고 autoUpdate가 이미
// 쓰는 기준을 그대로 빌렸고, 덕분에 "main에 병합하면 현장 모드"가 저절로 맞는다.
//
// 다만 **모르는 상태로 떨어질 때의 방향이 autoUpdate와 반대다.**
//   autoUpdate: 브랜치를 모르면 비활성 — 모르는데 남의 코드를 당겨오면 위험하니까
//   여기:       브랜치를 모르면 현장 — 모르는데 개발 모드로 떨어지면 현장 PC가 조용히
//               안전장치를 잃는다. 어르신 방송이 안 들리는 쪽이 개발자가 불편한 쪽보다 나쁘다.
// 개발 PC가 잘못 판정되는 경우는 눈에 보이고(장치가 되돌아간다) 화면에서 즉시 덮어쓸 수 있다.
//
// 이 판정에 걸린 동작(하나 늘 때마다 여기 한 줄 적고 테스트로 고정한다):
//   1) audioDeviceWatcher — Windows 기본 출력장치 강제 복원
//   2) autoShutdown — PC 자동 종료 예약(2026-09-06 추가). DB 값에만 의존하면 테스트 한 번에
//      개발 PC가 꺼진다. 실제로 그 사고가 날 뻔했다.
//   3) 로컬 AI 진단 화면(2026-09-06 추가) — 현장 PC에는 "로컬 AI 내려받기(약 4GB)" 버튼을
//      띄우지 않는다. 방송용 PC 화면에 그 버튼을 두면 누군가 누른다. 판정은 화면이
//      `GET /api/settings/pc-role`로 물어보고, 못 읽으면 여기와 같은 방향으로 현장으로 본다
//      (src/components/admin/sections/LocalAiSetup.jsx).
//
// git 프로세스를 띄우지 않고 `.git/HEAD`를 직접 읽는다. 이 판정은 서버 기동 중 여러 번
// 불리는데, 그때마다 자식 프로세스를 띄우면 느리고 실패 경로가 하나 더 생긴다.
'use strict'

const { rawSetting } = require('../domain/settingsRead')

const fs   = require('fs')
const path = require('path')

const SITE = 'site'   // 현장 PC — 실제로 어르신께 방송이 나가는 PC
const DEV  = 'dev'    // 개발·테스트 PC

const REPO_ROOT = path.join(__dirname, '..', '..')

/**
 * 이 작업 트리의 **git 디렉터리**를 찾는다.
 *
 * 평범한 체크아웃에서는 `<루트>/.git` 이 **폴더**다. 그런데 **git worktree** 에서는
 * 같은 자리가 `gitdir: <진짜 경로>` 한 줄이 든 **파일**이다.
 *
 * ⚠ 이것 때문에 2026-09-13 에 사고가 났다. 워크트리에서 `.git/HEAD` 를 읽으면 ENOENT 라
 * 브랜치가 빈 값이 되고, 아래 "모르면 현장으로 본다" 규칙이 걸려 **개발 워크트리가
 * 현장 PC 로 판정**됐다. 그래서 이 판정에 걸린 안전장치가 통째로 꺼졌다 —
 * 자동종료가 개발 PC 에 **진짜 종료 타이머(22.8시간)** 를 걸었고, 그 타이머가
 * `npm test` 를 영영 안 끝나게 붙들고 있었다.
 *
 * **"모르면 현장" 규칙은 그대로 둔다.** 여기서 고치는 것은 *알 수 있는데 못 읽던 것*이지
 * 폴백의 방향이 아니다 — 아래 `gitdir` 도 못 읽으면 여전히 빈 값이고 현장으로 본다.
 *
 * @returns {string} git 디렉터리 절대 경로. 못 찾으면 빈 문자열
 */
function detectGitDir(repoRoot = REPO_ROOT) {
  const 자리 = path.join(repoRoot, '.git')
  try {
    if (fs.statSync(자리).isDirectory()) return 자리
  } catch {
    return ''   // `.git` 이 아예 없다 — 저장소 밖이다
  }
  try {
    // 워크트리: `gitdir: C:/…/.git/worktrees/<이름>`
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(자리, 'utf8'))
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * `.git/HEAD`에서 현재 브랜치 이름을 읽는다.
 * @returns {string} 브랜치 이름. 읽기 실패·detached HEAD면 빈 문자열
 */
function detectBranch(repoRoot = REPO_ROOT) {
  const gitDir = detectGitDir(repoRoot)
  if (!gitDir) return ''
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    // detached HEAD는 커밋 해시가 그대로 들어 있다 — 브랜치 이름이 아니므로 빈 값으로 본다
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

function roleFromBranch(branch) {
  // main이 아니라고 개발로 떨어뜨리지 않는다 — 위 주석의 "모르면 현장" 규칙.
  // 개발 브랜치라고 **확인된** 경우에만 개발 PC다.
  if (!branch) return SITE
  return branch === 'main' ? SITE : DEV
}

function readOverride(db) {
  try {
    return (db ? rawSetting(db, 'pc_role') : null) ?? ''
  } catch {
    // DB를 못 읽는다고 판정을 포기하면 부팅이 막힌다 — 브랜치 판정으로 간다
    return ''
  }
}

// 판정의 **출처** — 같은 `site` 라도 뜻이 다르다.
//
//   'override' — 사람이 관리자 화면에서 명시적으로 정했다
//   'branch'   — 브랜치를 **읽어서** 정했다(`main` = 현장)
//   'unknown'  — **못 읽었다.** "모르면 현장" 규칙으로 site 가 됐을 뿐이다
//
// 왜 가르나(2026-09-13): `unknown` 도 `site` 를 내므로, 부르는 쪽은 *"현장이라고 확인됐다"* 와
// *"모르겠어서 현장으로 봤다"* 를 구별할 수 없었다. 대부분의 소비자에게는 그래도 된다 —
// 안전장치를 **더 거는** 쪽이라 모를 때 거는 것이 맞다.
//
// **딱 하나, PC 전원 종료는 반대다.** 모를 때 끄는 것은 안전한 쪽이 아니라 가장 위험한 쪽이다.
// 실제로 worktree 에서 `.git` 을 못 읽어 `unknown` 이 된 개발 PC 에 진짜 종료 타이머가
// 걸렸다. 그래서 그 하나만 `source` 를 보고 `unknown` 이면 안 한다(`autoShutdown.js`).
const 출처 = { 사람: 'override', 브랜치: 'branch', 모름: 'unknown' }

/**
 * 이 PC의 역할과 **그 판정의 출처**.
 * @param {object} db      settings 표를 읽을 DB 연결(없어도 된다)
 * @param {object} [opts]  테스트 이음새 — { override, branch }
 * @returns {{role:'site'|'dev', source:'override'|'branch'|'unknown', branch:string}}
 */
function roleWithSource(db, opts = {}) {
  const override = String(opts.override ?? readOverride(db) ?? '').trim()
  if (override === SITE || override === DEV) {
    return { role: override, source: 출처.사람, branch: '' }
  }
  // 'auto'·빈 값·알 수 없는 값은 전부 자동 판정으로 돌린다
  const branch = opts.branch ?? detectBranch()
  return {
    role: roleFromBranch(branch),
    source: branch ? 출처.브랜치 : 출처.모름,
    branch: branch || '',
  }
}

/**
 * 이 PC의 역할.
 *
 * **동작은 예전과 한 글자도 안 바뀐다** — 모르면 여전히 `site` 다. 출처까지 알아야 하는
 * 곳만 `roleWithSource` 를 쓴다(지금은 `autoShutdown` 하나뿐).
 *
 * @param {object} db      settings 표를 읽을 DB 연결(없어도 된다)
 * @param {object} [opts]  테스트 이음새 — { override, branch }
 * @returns {'site'|'dev'}
 */
function getRole(db, opts = {}) {
  return roleWithSource(db, opts).role
}

const isSite = (db, opts) => getRole(db, opts) === SITE
const isDev  = (db, opts) => getRole(db, opts) === DEV

/** 화면·로그에 쓰는 한국어 이름 */
function roleLabel(role) {
  return role === SITE ? '현장 PC' : '개발·테스트 PC'
}

module.exports = {
  SITE, DEV, 출처, detectBranch, detectGitDir, roleFromBranch,
  getRole, roleWithSource, isSite, isDev, roleLabel,
}
