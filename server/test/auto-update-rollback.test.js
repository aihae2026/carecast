// 자동 업데이트가 반쯤 적용된 채 영영 굳는 것을 막는다. (전수검수 CC-024)
//
// 무엇이 문제였나 — 코드 경로로 확인한 것:
//   await run('git pull origin main')   // 성공. HEAD가 origin/main과 같아진다
//   await run('npm install')            // 여기서 터지면
//   ...
//   } catch (e) { autoStatus.lastError = msg }   // 로그만. 롤백이 없다
// 그리고 10분 뒤 다음 주기:
//   if (local === remote) { autoStatus.lastError = null; return }
//
// 결과: **디스크는 새 코드, 돌고 있는 프로세스는 옛 코드, 재시작은 영영 안 온다.**
// install/build를 다시 시도하지도 않는다(HEAD가 이미 같으니까). 게다가 10분 뒤엔
// 실패했다는 사실조차 지워진다. 무인 6개월 기준에서 제일 나쁜 종류다 — 아무도 모른다.
//
// finding의 처방 둘은 따르지 않았다:
//   · "타임아웃 15분" — 전제가 틀렸다. run()에 이미 5분 타임아웃이 있다.
//   · "npm ci 사용"  — **따르면 더 나빠진다.** npm ci는 node_modules를 통째로 지우고
//     다시 받는다. 중간에 실패하면 서버가 재시작조차 못 한다. 무인 현장 PC에서 할 짓이 아니다.
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_auto_update_rollback_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')

const autoUpdate = require('../services/autoUpdate')

// 실행된 명령을 기록하고, 정해진 명령에서만 실패하는 가짜 run
// 기본 해시는 **40자리 hex** 다. 짧은 가짜를 주면 P-86 가드(형식 검증)에 걸려 되돌리기가
// 안 돈다 — 결함이 아니라 표본이 현실과 달랐던 것이다(2026-09-10).
const HEX_A = 'a'.repeat(40), HEX_B = 'b'.repeat(40), HEX_C = 'c'.repeat(40)
function fakeRun({ failOn = null, head = HEX_A, remote = HEX_B } = {}) {
  const calls = []
  const run = async (cmd) => {
    calls.push(cmd)
    if (failOn && cmd.includes(failOn)) throw new Error(`${failOn} 실패함`)
    if (cmd.includes('rev-parse HEAD'))        return head
    if (cmd.includes('rev-parse origin/main')) return remote
    return ''
  }
  run.calls = calls
  return run
}

function harness(opts = {}) {
  const raised = []
  return {
    raised,
    deps: {
      run: opts.run,
      raise: (kind, message) => raised.push({ kind, message }),
      blockedReason: () => null,       // 방송 중이 아니라고 본다
      restart: () => {},               // 테스트에서 재시작하지 않는다
      ...opts.deps,
    },
  }
}

test.beforeEach(() => { autoUpdate._resetFailureStateForTest() })

// ── 1) 롤백 ──────────────────────────────────────────────────

test('pull 후 npm install이 실패하면 디스크를 돌고 있는 코드로 되돌린다', async () => {
  const run = fakeRun({ failOn: 'npm install' })
  const h = harness({ run })
  await autoUpdate.checkAndUpdate(h.deps)

  const reset = run.calls.find(c => c.includes('reset --hard'))
  assert.ok(reset, '되돌리지 않으면 디스크(새 코드)와 프로세스(옛 코드)가 어긋난 채 굳는다')
  assert.match(reset, /aaaaaaa/, 'pull 이전 커밋으로 정확히 되돌려야 한다')
})

test('되돌린 뒤에는 다음 주기에 다시 시도한다 — 영구 고착이 없어진다', async () => {
  // 되돌렸으니 HEAD != origin/main 이고, 그래서 다음 검사가 다시 업데이트를 시작한다.
  // (이 성질은 "reset --hard가 불렸는가"로 대변한다 — 진짜 git 없이 확인할 수 있는 지점이다)
  const run = fakeRun({ failOn: 'npm run build' })
  const h = harness({ run })
  await autoUpdate.checkAndUpdate(h.deps)
  assert.ok(run.calls.some(c => c.includes('reset --hard')))
})

test('build까지 갔다 실패하면 옛 코드로 한 번 다시 빌드한다 — dist는 되돌려지지 않는다', async () => {
  // dist/는 gitignore라 git reset으로 안 돌아온다. 실패한 빌드가 dist를 깨뜨렸으면
  // 되돌린 뒤에도 화면이 깨진 채로 남는다.
  const run = fakeRun({ failOn: 'npm run build' })
  const h = harness({ run })
  await autoUpdate.checkAndUpdate(h.deps)

  const builds = run.calls.filter(c => c.includes('npm run build'))
  assert.equal(builds.length, 2, '되돌린 뒤 복구 빌드를 한 번 더 해야 화면이 산다')
})

test('install 단계에서 실패했으면 복구 빌드를 하지 않는다 — dist를 건드린 적이 없다', async () => {
  const run = fakeRun({ failOn: 'npm install' })
  const h = harness({ run })
  await autoUpdate.checkAndUpdate(h.deps)
  assert.equal(run.calls.filter(c => c.includes('npm run build')).length, 0,
    '건드리지도 않은 dist를 다시 빌드하는 건 현장 PC CPU 낭비다')
})

// ── 2) 사람이 알게 된다 ──────────────────────────────────────

test('실패는 화면·이력·로그에 남는다 — 로그 한 줄로 끝내면 아무도 모른다', async () => {
  const h = harness({ run: fakeRun({ failOn: 'npm install' }) })
  await autoUpdate.checkAndUpdate(h.deps)

  assert.equal(h.raised.length, 1)
  assert.match(h.raised[0].message, /업데이트/, '무슨 일인지 읽고 알 수 있어야 한다')
})

test('실패 뒤 "이미 최신"이라고 실패 기록을 지우지 않는다', async () => {
  const h = harness({ run: fakeRun({ failOn: 'npm install' }) })
  await autoUpdate.checkAndUpdate(h.deps)
  assert.ok(autoUpdate.getAutoStatus().lastError, '실패했으면 기록이 남아야 한다')

  // 이제 최신인 상태(local === remote)로 한 주기 더 — 예전엔 여기서 lastError를 지웠다
  const same = fakeRun({ head: HEX_C, remote: HEX_C })
  await autoUpdate.checkAndUpdate({ ...harness({ run: same }).deps })
  assert.ok(autoUpdate.getAutoStatus().lastError,
    '10분 뒤에 실패 흔적이 사라지면 사람이 영영 모른다')
})

// ── 3) 무한 재시도를 하지 않는다 ─────────────────────────────

test('같은 커밋으로 3회 실패하면 그 뒤로는 1시간에 한 번만 시도한다', async () => {
  const mk = () => fakeRun({ failOn: 'npm install' })

  for (let i = 0; i < 3; i++) {
    const r = mk()
    await autoUpdate.checkAndUpdate({ ...harness({ run: r }).deps })
    assert.ok(r.calls.some(c => c.includes('git pull')), `${i + 1}회차는 시도해야 한다`)
  }

  // 4회차 — 아직 1시간이 안 지났으므로 건드리지 않는다
  const fourth = mk()
  await autoUpdate.checkAndUpdate({ ...harness({ run: fourth }).deps })
  assert.ok(!fourth.calls.some(c => c.includes('git pull')),
    '10분마다 npm install+build를 무한 반복하면 현장 PC를 갉아먹는다')

  // 1시간이 지나면 다시 시도한다 — 네트워크가 잠깐 끊긴 것뿐일 수도 있다
  const later = mk()
  await autoUpdate.checkAndUpdate({ ...harness({ run: later }).deps, now: () => Date.now() + 61 * 60 * 1000 })
  assert.ok(later.calls.some(c => c.includes('git pull')), '영구 중단이 되면 새 버전이 영영 안 들어간다')
})

test('3회째에는 사람을 부르는 경보가 뜬다', async () => {
  let last = null
  for (let i = 0; i < 3; i++) {
    const h = harness({ run: fakeRun({ failOn: 'npm install' }) })
    await autoUpdate.checkAndUpdate(h.deps)
    last = h.raised
  }
  assert.ok(last.length >= 1)
  assert.match(last[last.length - 1].message, /3|사람|확인/,
    '반복 실패는 "이건 저절로 안 낫는다"는 뜻이라 문구가 달라야 한다')
})

test('다른 커밋이 오면 실패 횟수가 초기화된다 — 새 버전은 즉시 시도한다', async () => {
  for (let i = 0; i < 3; i++) {
    await autoUpdate.checkAndUpdate({ ...harness({ run: fakeRun({ failOn: 'npm install' }) }).deps })
  }
  const 새커밋 = fakeRun({ failOn: 'npm install', remote: 'zzzzzzz' })
  await autoUpdate.checkAndUpdate({ ...harness({ run: 새커밋 }).deps })
  assert.ok(새커밋.calls.some(c => c.includes('git pull')),
    '앞 커밋이 망가졌다고 새로 올린 수정본까지 막으면 고칠 방법이 없어진다')
})

// ── 4) 성공 경로는 그대로 ────────────────────────────────────

test('정상 업데이트는 되돌리지 않고 재시작으로 간다', async () => {
  const run = fakeRun()
  let restarted = false
  await autoUpdate.checkAndUpdate({ ...harness({ run }).deps, restart: () => { restarted = true } })

  assert.ok(!run.calls.some(c => c.includes('reset --hard')), '성공했는데 되돌리면 안 된다')
  assert.ok(restarted, '업데이트가 끝나면 재시작해야 새 코드가 실제로 돈다')
  assert.equal(autoUpdate.getAutoStatus().lastError, null)
})

test('방송 중이면 파괴적 단계를 시작조차 하지 않는다 (기존 성질 보존)', async () => {
  const run = fakeRun()
  await autoUpdate.checkAndUpdate({
    ...harness({ run }).deps,
    blockedReason: () => '방송 중("점심 안내")',
  })
  assert.ok(!run.calls.some(c => c.includes('git pull')), 'build가 CPU를 잡는 것만으로 방송이 끊긴다')
  assert.ok(!run.calls.some(c => c.includes('checkout -- .')))
})

test('npm ci로 바꾸지 않는다 — node_modules를 지우면 재시작조차 못 한다', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoUpdate.js'), 'utf8')
  assert.ok(!/npm ci/.test(src),
    'finding이 권했지만 따르면 더 나빠진다 — 중간에 실패하면 node_modules가 사라진다')
})
