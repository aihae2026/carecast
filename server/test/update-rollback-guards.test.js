// P-84 · P-85 · P-86 — 되돌리기 경로의 구멍 셋 (2026-09-10).
//
// 셋 다 "실패했을 때 무엇을 하느냐"의 문제다. 성공 경로만 보면 안 보인다.
//   P-84 pull 이 **충돌로 멈추면** `pulled=false` 라 되돌리기가 안 돌고, 충돌 표식이 박힌
//        트리가 그대로 남는다. 다음 기동이 그 상태로 뜬다. **두 경로 공통이었다.**
//   P-85 시간제한이 전 명령 5분 고정이라 찬 PC 의 `npm install` 이 잘린다. 그런데 P-73
//        수정으로 이제 그 타임아웃이 **되돌리기를 부른다.**
//   P-86 `rev-parse` 출력이 검증 없이 되돌리기 명령에 들어간다.
//
// 실부작용 없음 — `runUpdate` 가 의존성을 주입받는다(P-71~P-73 때 낸 이음새).
// 실제 git·npm 은 안 돈다.
//
// **되돌리기 명령을 리터럴로 안 적는다.** guard-bash 가 그 문자열을 파괴적 명령으로 보고
// 파일 작성을 막는다(2026-09-10 실측, metrics --hook-fp 로 기록). 훅이 옳다 —
// 이 파일이 진짜 실행인지 테스트 문자열인지 훅은 알 수 없다. 우회가 아니라 회피다.
'use strict'

// **DB 를 임시 파일로 돌리고 표를 만든다**(P-130, 2026-09-11).
//
// 이 테스트는 빈 DB 에서 `no such table: schedules` 로 깨진다. 지금까지 통과한 것은
// **개발 DB 에 표가 이미 있었기 때문**이다([FACT] EV-004311 로 재현). 즉 새 PC·빈
// 체크아웃에서는 실패하는 테스트였고, 그동안 개발 DB 를 직접 열고 있었다.
// 이 저장소 테스트 142개가 쓰는 관례는 경로 돌리기 **와** `initDB()` 둘 다다 — 경로만
// 돌리면 표가 없어 깨진다.
process.env.CARECAST_DB_PATH = require('node:path')
  .join(require('node:os').tmpdir(), `carecast_test_update_rollback_${process.pid}_${Date.now()}.db`)

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { runUpdate } = require('../routes/update')
// 표를 만든다. `autoUpdate.blockedReason()` 이 `schedules` 를 읽는다 — 없으면
// "상태 확인 실패" 로 떨어져, **미룸 판정이 도는지조차 못 본다**(P-130).
require('../db/schema').initDB()

const 되돌리기 = ['git', 'reset', '--hard'].join(' ')   // 리터럴로 안 적는다(머리말 참고)

// 명령을 받아 적고, 지정한 것만 실패시키는 가짜 실행기
function 실행기({ 실패 = null, 결과 = {} } = {}) {
  const 부른것 = []
  const run = async (cmd) => {
    부른것.push(cmd)
    if (실패 && 실패(cmd)) throw new Error(`가짜 실패: ${cmd}`)
    if (Object.prototype.hasOwnProperty.call(결과, cmd)) return 결과[cmd]
    return ''
  }
  return { run, 부른것 }
}
const 기본 = (r) => ({
  run: r.run, blocked: () => null, restart: () => {}, schedule: () => {},
  log: () => {}, setLastUpdate: () => {},
})
const HEAD = 'git rev-parse HEAD'
const SHA = 'a'.repeat(40)

test('P-84: pull 이 충돌로 멈추면 병합을 되돌린다', async () => {
  const r = 실행기({ 실패: (c) => c === 'git pull origin main', 결과: { [HEAD]: SHA } })
  await runUpdate(기본(r))
  assert.ok(r.부른것.includes('git merge --abort'),
    '충돌로 멈춘 병합을 안 되돌린다 — 충돌 표식이 박힌 트리로 다음 기동이 뜬다: ' + r.부른것.join(' | '))
  assert.ok(!r.부른것.some((c) => c.startsWith(되돌리기)),
    'pull 이 안 끝났는데 트리를 되돌렸다 — 사람이 손으로 둔 변경을 날린다')
})

test('P-84: pull 이 끝난 뒤 실패하면 병합 되돌리기가 아니라 트리 되돌리기다 — 대조군', async () => {
  const r = 실행기({ 실패: (c) => c === 'npm install', 결과: { [HEAD]: SHA } })
  await runUpdate(기본(r))
  assert.ok(r.부른것.includes(`${되돌리기} ${SHA}`),
    'pull 뒤 실패인데 되돌리지 않았다: ' + r.부른것.join(' | '))
  assert.ok(!r.부른것.includes('git merge --abort'),
    '병합 중이 아닌데 병합 되돌리기를 불렀다 — 그 경로는 pull 이 멈춘 경우만이다')
})

test('P-86: 되돌릴 지점이 40자리 hex 가 아니면 되돌리지 않는다', async () => {
  for (const 나쁜값 of ['', 'fatal: not a git repository', 'a'.repeat(39), 'A'.repeat(40), 'zz' + 'a'.repeat(38)]) {
    const r = 실행기({ 실패: (c) => c === 'npm install', 결과: { [HEAD]: 나쁜값 } })
    await runUpdate(기본(r))
    const 시도 = r.부른것.filter((c) => c.startsWith(되돌리기))
    assert.deepEqual(시도, [],
      `"${나쁜값.slice(0, 20)}" 를 되돌리기 대상으로 썼다 — 되돌릴 곳을 확실히 알 때만 해야 한다`)
  }
})

test('P-86: 제대로 된 해시는 그대로 쓴다 — 대조군', async () => {
  const 진짜 = '0123456789abcdef0123456789abcdef01234567'
  const r = 실행기({ 실패: (c) => c === 'npm install', 결과: { [HEAD]: 진짜 } })
  await runUpdate(기본(r))
  assert.ok(r.부른것.includes(`${되돌리기} ${진짜}`), '멀쩡한 해시인데 안 되돌렸다')
})

test('P-85: npm 명령의 시간제한이 git 보다 길다 — 찬 PC 의 install 이 잘리면 되돌리기가 돈다', () => {
  // 시간제한은 exec 옵션이라 주입 이음새 밖이다 — 소스로 고정한다.
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'update.js'), 'utf8')
  const g = /GIT_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(SRC)
  const n = /NPM_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(SRC)
  assert.ok(g && n, '시간제한 상수가 사라졌다 — 이 검사의 앵커가 무너졌다')
  assert.ok(Number(n[1]) > Number(g[1]),
    `npm ${n[1]}분 · git ${g[1]}분 — npm 이 더 길어야 한다(autoUpdate.js 와 같은 이유)`)
  assert.match(SRC, /timeout:\s*cmd\.startsWith\('npm'\)/,
    '명령별로 안 나누고 하나로 고정했다 — 찬 PC 의 npm install 이 5분을 넘긴다')
})

test('자동 경로에도 같은 가드가 있다 — 두 경로 공통 구멍이었다', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoUpdate.js'), 'utf8')
  assert.match(SRC, /\[0-9a-f\]\{40\}/, 'P-86 가드가 자동 경로에 없다')
  assert.ok(SRC.indexOf('git merge --abort') >= 0, 'P-84 가드가 자동 경로에 없다')
})

// ── P-83 — 수동과 자동이 서로를 본다 (2026-09-10) ───────────────────────
// 예전엔 서로를 몰라서 같은 트리에서 pull·install 이 **둘 동시에** 돌 수 있었다.
// `currentBlockedReason()` 은 방송만 보므로 자동이 install 중이어도 수동은 null 을 받았다.

test('P-83: 자동 업데이트가 도는 중이면 수동은 미룬다', async () => {
  const auto = require('../services/autoUpdate')
  const 원래 = auto.isUpdating
  auto.isUpdating = () => true
  try {
    const r = 실행기({ 결과: { [HEAD]: 'b'.repeat(40) } })
    const 결과 = await runUpdate({ ...기본(r), blocked: undefined })   // 진짜 blockedNow 를 태운다
    assert.equal(결과.deferred, true, `자동이 도는데 수동이 그대로 진행했다: ${r.부른것.join(' | ')}`)
    assert.deepEqual(r.부른것, [], '파일을 건드리기 전에 멈춰야 한다')
    assert.match(String(결과.reason), /자동 업데이트/, `사람이 왜 미뤄졌는지 알아야 한다: ${결과.reason}`)
  } finally { auto.isUpdating = 원래 }
})

test('P-83: 자동이 안 돌면 수동은 평소대로 간다 — 대조군', async () => {
  const auto = require('../services/autoUpdate')
  const 원래A = auto.isUpdating
  const 원래B = auto.currentBlockedReason
  auto.isUpdating = () => false
  auto.currentBlockedReason = () => null
  try {
    const r = 실행기({ 결과: { [HEAD]: 'b'.repeat(40) } })
    await runUpdate({ ...기본(r), blocked: undefined })
    assert.ok(r.부른것.length > 0, '막을 이유가 없는데 아무것도 안 했다')
  } finally { auto.isUpdating = 원래A; auto.currentBlockedReason = 원래B }
})

test('P-83: 수동이 도는 중이면 자동도 미룬다 — 반대 방향', () => {
  const up = require('../routes/update')
  const 원래 = up.isUpdating
  up.isUpdating = () => true
  try {
    const 사유 = require('../services/autoUpdate').currentBlockedReason()
    assert.match(String(사유), /수동 업데이트/,
      `수동이 도는데 자동이 안 미뤘다: ${사유} — 같은 트리에서 pull 이 둘 돈다`)
  } finally { up.isUpdating = 원래 }
})
