// PC 자동종료 안전장치 — **모를 때는 끄지 않는다**.
//
// ── 무슨 일이 있었나 (2026-09-13) ────────────────────────────────────────────
//
// `npm test` 가 209번째 시험에서 영영 멎었다. 쫓아가 보니 시험 하나가 `POST /auto-shutdown`
// 을 부르면서 **진짜 22.8시간짜리 종료 타이머**를 걸고 있었다. 그 타이머가 이벤트 루프를
// 붙들어 파일이 안 끝났고, 프로세스가 그때까지 살아 있으면 PC 가 실제로 꺼진다.
//
// 가드는 있었다(`role !== SITE` 면 예약 안 함). 그런데 **git worktree 에서 뚫려 있었다** —
// `.git` 이 폴더가 아니라 파일이라 브랜치를 못 읽었고, 빈 값이 "모르면 현장" 규칙에 걸려
// `site` 가 됐다. 즉 **읽기 실패가 곧 종료 허용**이었다.
//
// ⚠ 이 사고를 **과거 PC 종료의 원인으로 확정하지 않는다.** 그 시각의 로그가 없다.
//   "그렇게 될 수 있는 구조였다"까지가 확인된 것이고, 그것만으로 고칠 이유는 충분하다.
//
// ── 이 파일이 고정하는 것 ────────────────────────────────────────────────────
//
//   ① 판정 출처가 갈린다: 사람이 정함 / 브랜치를 읽음 / **못 읽음**
//   ② 못 읽었으면 예약하지 않는다 — 저장소 정보 없음·읽기 실패 둘 다
//   ③ **명시한 현장 설정은 그대로 산다** (`pc_role='site'`)
//   ④ **지금 현장 PC 의 조건이 그대로 통과한다** (`pc_role` 없음 + `main` 브랜치)
//   ⑤ 시험 환경에서는 `pc_role` 이 무엇이든 진짜 `shutdown` 이 안 나간다
//
// **실제 종료 예약을 걸지 않는다.** 종료 명령은 모의 실행기로 받아 세기만 한다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_shutdown_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const role = require('../services/pcRole')
const shutdown = require('../services/autoShutdown')

test.before(() => { initDB() })
test.after(() => {
  // 혹시라도 타이머가 남았으면 걷는다. 모의 실행기를 넘겨 진짜 명령이 안 나가게 한다.
  try { shutdown.cancelAutoShutdown({ 실행기: () => {} }) } catch { /* 없으면 무시 */ }
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 저장소 모양 넷을 임시 폴더로 만든다 (실제 저장소를 안 건드린다) ─────────────
const 치울것 = []
function 임시(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  치울것.push(d)
  return d
}
test.after(() => {
  for (const d of 치울것.reverse()) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 무시 */ }
  }
})

/** 평범한 체크아웃 — `.git` 이 폴더다 */
function 평범한저장소(head) {
  const d = 임시('cc-sd-repo-')
  fs.mkdirSync(path.join(d, '.git'), { recursive: true })
  if (head !== null) fs.writeFileSync(path.join(d, '.git', 'HEAD'), head, 'utf8')
  return d
}
/** worktree — `.git` 이 `gitdir:` 한 줄이 든 **파일**이다 */
function 워크트리(head, { 깨진포인터 = false } = {}) {
  const 진짜 = 임시('cc-sd-git-')
  const wt   = 임시('cc-sd-wt-')
  if (head !== null) fs.writeFileSync(path.join(진짜, 'HEAD'), head, 'utf8')
  const 가리킬곳 = 깨진포인터 ? path.join(진짜, '없는하위폴더') : 진짜
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ' + 가리킬곳.split(path.sep).join('/') + '\n', 'utf8')
  return wt
}
/** git 정보가 아예 없는 폴더 */
function 저장소아님() { return 임시('cc-sd-plain-') }

const 설정 = (키, 값) => getDB().prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(키, 값)

// ── ① 판정 출처가 갈린다 ─────────────────────────────────────────────────────
test('판정 출처 — 사람이 정함 · 브랜치를 읽음 · 못 읽음', () => {
  const 평범main = 평범한저장소('ref: refs/heads/main\n')
  const 평범dev  = 평범한저장소('ref: refs/heads/dev\n')
  const wt       = 워크트리('ref: refs/heads/design-c\n')
  const 없는곳   = 저장소아님()
  const 깨진것   = 워크트리('ref: refs/heads/main\n', { 깨진포인터: true })

  const 본다 = (repo) => role.roleWithSource(null, { branch: role.detectBranch(repo) })

  assert.deepEqual(본다(평범main), { role: role.SITE, source: role.출처.브랜치, branch: 'main' },
    '평범한 저장소의 main 이 현장으로 안 읽힌다')
  assert.deepEqual(본다(평범dev),  { role: role.DEV,  source: role.출처.브랜치, branch: 'dev' })
  assert.deepEqual(본다(wt),       { role: role.DEV,  source: role.출처.브랜치, branch: 'design-c' },
    'worktree 의 브랜치를 못 읽는다 — 이것이 사고의 모양이었다')

  for (const [이름, repo] of [['git 정보 없음', 없는곳], ['읽기 실패(포인터 깨짐)', 깨진것]]) {
    const r = 본다(repo)
    assert.equal(r.source, role.출처.모름, `${이름}: 출처가 '모름' 이 아니다`)
    assert.equal(r.role, role.SITE,
      `${이름}: 역할 자체는 여전히 site 다 — "모르면 현장" 규칙은 안 바꿨다`)
  }

  // 사람이 명시하면 브랜치를 안 본다
  assert.deepEqual(role.roleWithSource(null, { override: 'site', branch: 'dev' }),
    { role: role.SITE, source: role.출처.사람, branch: '' })
  assert.deepEqual(role.roleWithSource(null, { override: 'dev', branch: 'main' }),
    { role: role.DEV, source: role.출처.사람, branch: '' })
})

test('getRole 의 동작은 한 글자도 안 바뀌었다 — 모르면 여전히 현장', () => {
  // 다른 소비자(출력장치 강제 복원·로컬 AI 화면)는 이 규칙에 기대고 있다.
  // 그쪽은 **안전장치를 더 거는** 방향이라 모를 때 거는 것이 맞다.
  assert.equal(role.getRole(null, { branch: '' }), role.SITE)
  assert.equal(role.getRole(null, { branch: 'main' }), role.SITE)
  assert.equal(role.getRole(null, { branch: 'dev' }), role.DEV)
  assert.equal(role.getRole(null, { override: 'dev', branch: 'main' }), role.DEV)
})

// ── ⑤ 시험 환경 공통 차단 ───────────────────────────────────────────────────
test('시험 환경이면 pc_role 과 무관하게 진짜 shutdown 이 안 나간다', () => {
  assert.equal(shutdown.테스트중(), true, '이 프로세스를 시험으로 못 알아본다')

  for (const pc역할 of ['site', 'dev', 'auto', '']) {
    설정('pc_role', pc역할)
    const 나간것 = []
    const 실행됨 = shutdown.종료명령('shutdown /s /t 30', `pc_role=${pc역할}`, (c) => 나간것.push(c))
    assert.equal(실행됨, false, `pc_role='${pc역할}' 에서 종료 명령이 나갔다`)
    assert.deepEqual(나간것, [], `pc_role='${pc역할}' 에서 실행기가 불렸다`)
  }
  설정('pc_role', '')
})

test('종료 명령이 나가는 문이 하나다 — 예약 발동도 취소도 같은 문을 지난다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoShutdown.js'), 'utf8')
  // 긍정 앵커 — 감시할 대상이 이 파일에 있다
  assert.match(src, /function 종료명령\(/, '종료명령 창구가 없다 — 옮겼으면 이 시험도 옮긴다')
  assert.match(src, /종료명령\('shutdown \/s \/t 30'/, '예약 발동이 그 문을 안 지난다')
  assert.match(src, /종료명령\('shutdown \/a'/, '취소가 그 문을 안 지난다')
  // 코드 줄에서 직접 부르는 자리가 없어야 한다(주석은 걷는다 — 설명에 걸리면 안 된다)
  const 코드 = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const 직접 = [...코드.matchAll(/\bexec\((['"`])shutdown/g)]
  assert.equal(직접.length, 0,
    `종료 명령을 창구 밖에서 직접 부르는 자리가 ${직접.length}곳 있다 — 막는 자리가 둘이 된다`)
})

// ── ②③④ 예약 결정 — 다섯 환경 ──────────────────────────────────────────────
//
// **실제 예약은 안 걸린다.** 이 프로세스는 시험이라 위 ⑤의 공통 차단이 먼저 걸리고,
// 그래서 아래는 `scheduleAutoShutdown` 이 그 자리에서 멈추는지를 본다.
// 판정 자체(역할·출처)는 위 ①이 환경 다섯으로 이미 고정했다.
test('시험 환경에서는 시각이 설정돼 있어도 예약하지 않는다 — 타이머가 안 걸린다', () => {
  설정('auto_shutdown_time', '18:21')
  설정('pc_role', 'site')            // 현장이라고 **명시**해도
  const r = shutdown.scheduleAutoShutdown({ 실행기: () => {
    throw new Error('시험 환경에서 종료 명령이 나갔다')
  } })
  assert.equal(r.예약함, false)
  assert.equal(r.사유, '시험 환경')
  설정('pc_role', '')
})

// ── 소스 대조 — 운영 경로의 판단이 실제로 출처를 보는가 ───────────────────────
//
// 위 시험은 "시험 환경이라 안 건다"까지만 본다. **현장에서 무엇을 보는지**는 이 프로세스에서
// 밟을 수 없으므로(밟으면 진짜 타이머가 걸린다) 소스로 고정한다.
test('예약 결정이 역할뿐 아니라 **출처**까지 본다 — 못 읽었으면 안 건다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoShutdown.js'), 'utf8')
  assert.match(src, /roleWithSource\(db, opts\)/, '출처를 안 묻는다 — getRole 만 보면 모를 때도 켜진다')
  // **예약 시점의 가드**를 콕 집어 본다.
  //
  // 처음엔 `/source === 출처\.모름/` 로 느슨하게 봤는데, 그 무늬가 **발동부의 재확인**
  // (`지금.source === 출처.모름`)에도 걸려서 예약 시점 가드를 통째로 지워도 초록이었다.
  // 변이로 확인하다 드러났다 — 가드가 "어딘가에 그 글자가 있다"를 본 셈이다.
  assert.match(src, /^\s*if \(source === 출처\.모름\) \{/m,
    "예약 시점에 출처가 '모름' 인 경우를 안 가른다")
  assert.match(src, /사유: '역할 판단 불가'/, '판단 불가일 때 예약을 건너뛰지 않는다')
})

test('끄기 **직전에** 한 번 더 확인한다 — 예약과 발동 사이가 최대 24시간이다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoShutdown.js'), 'utf8')
  const i = src.indexOf('shutdownTimer = setTimeout(() => {')
  assert.ok(i >= 0, '긍정 앵커 — 예약 타이머가 이 파일에 있다')
  const 발동부 = src.slice(i, src.indexOf('}, ms)', i))
  // 핸들은 **예약할 때 얻은 것을 그대로 쓴다** — `getDB` 는 memoize 라 같은 것이고,
  // 여기서 다시 부르면 "한 번만 얻는다"(P-77)가 깨진다.
  assert.match(발동부, /roleWithSource\(db, opts\)/, '발동 직전에 역할을 다시 안 본다')
  assert.match(발동부, /지금\.source === 출처\.모름/, '발동 직전 재확인이 출처를 안 본다')
  assert.match(발동부, /PC 를 끄지 않습니다/, '재확인에 걸렸을 때 끄지 않는다고 안 적혀 있다')
})

test('현장 PC 의 지금 조건이 그대로 통과한다 — pc_role 없이 main 브랜치', () => {
  // 현장 기초값(`site-baseline.json`)에는 `pc_role` 이 **일부러 없다**(기계마다 달라서).
  // 그래서 현장은 브랜치로 판정된다 — 그 경로가 살아 있어야 한다.
  const 현장 = role.roleWithSource(null, { override: '', branch: 'main' })
  assert.equal(현장.role, role.SITE)
  assert.notEqual(현장.source, role.출처.모름,
    '현장 조건이 판단 불가로 떨어진다 — 현장 PC 가 안 꺼지게 된다')

  // 명시 설정도 살아 있어야 한다(저장소 정보가 없는 PC 를 현장으로 쓰는 경우의 탈출구)
  const 명시 = role.roleWithSource(null, { override: 'site', branch: '' })
  assert.equal(명시.role, role.SITE)
  assert.equal(명시.source, role.출처.사람,
    '명시한 현장 설정이 판단 불가로 떨어진다 — 안내대로 해도 안 꺼진다')
})
