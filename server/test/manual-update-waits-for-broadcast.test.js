// 수동 업데이트도 방송이 끝난 뒤에 재시작하는가 (P-2 / CA-008, 2026-09-08)
//
// 왜 이 파일이 있나:
//   같은 재시작인데 안전장치가 **한쪽에만** 있었다.
//     · 자동 업데이트(`autoUpdate.js:191`) — `restartWhenIdle()` 을 태워 방송 중이면 미룬다
//     · 수동 업데이트(`routes/update.js`) — `setTimeout(() => process.exit(100), 1500)` 무조건
//   관리자가 방송 시간대에 "지금 업데이트"를 누르면 재생 중인 TTS·BGM·영상이 **그대로 끊기고**
//   서버가 재시작됐다. 죽은 코드도 아니다 — `api.js:581` → `systemSettingsEtc.jsx:58` 로
//   화면 버튼에 연결돼 있다(CA-008).
//
//   자동종료(`autoShutdown.js`)와는 다르다. 거기엔 "진행 중 검사를 **의도적으로 넣지 않았다**"는
//   결정이 머리말에 적혀 있다(종료를 미루면 PC 가 밤새 켜져 있게 되므로). 수동 업데이트에는
//   그런 기록이 없고, 재시작은 **미뤄도 손해가 없다** — 그것이 autoUpdate 가 미루기로 한 이유다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// 주석 안의 코드 예시가 검사에 섞이지 않게 줄 주석을 걷어낸다.
// (`fetch-timeout.test.js` 가 같은 이유로 쓰는 방식이다 — "주석 안의 'fetch(' 언급이
//  개수에 섞이지 않게". 실제로 이 가드도 update.js 의 **주석에 적어 둔 옛 코드 예시**를
//  살아 있는 코드로 오인해 한 번 걸렸다.)
const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes/update.js'), 'utf8')
  .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

test('수동 업데이트는 restartWhenIdle 을 태운다 — 무조건 종료하지 않는다', () => {
  // 긍정 앵커 — 이 파일이 정말 재시작을 거는 자리인가
  assert.ok(/router\.post\(\s*'\/start'/.test(SRC), 'update.js 에 /start 라우트가 없다 — 이 가드를 옮길 것')
  assert.ok(SRC.includes('restartWhenIdle'), 'update.js 가 restartWhenIdle 을 안 부른다')

  // 부정 단언 — 옛 방식(무조건 종료)이 남아 있지 않은가
  assert.doesNotMatch(SRC, /setTimeout\(\s*\(\)\s*=>\s*process\.exit\(/,
    'update.js 에 무조건 종료가 남아 있다 — 방송 중이어도 그대로 끊긴다(P-2)')
})

test('restartWhenIdle 은 방송 중이면 미루고, 끝나면 종료한다 — 주입으로 확인', () => {
  const { restartWhenIdle } = require('../services/autoUpdate')

  // ① 방송 중: exit 이 불리면 안 되고, 다시 볼 약속만 잡혀야 한다
  let exited = null
  let scheduled = 0
  restartWhenIdle({
    reasonOf: () => '방송 중(테스트)',
    exit: (c) => { exited = c },
    schedule: () => { scheduled += 1 },
  })
  assert.equal(exited, null, '방송 중인데 종료했다 — 재생 중인 소리가 끊긴다')
  assert.equal(scheduled, 1, '다시 보기로 한 약속이 없다 — 그러면 재시작이 영영 안 온다')

  // ② 방송이 끝났으면: 그 자리에서 종료한다
  exited = null; scheduled = 0
  restartWhenIdle({
    reasonOf: () => null,
    exit: (c) => { exited = c },
    schedule: () => { scheduled += 1 },
  })
  assert.equal(exited, 100, '방송이 없는데도 재시작을 안 했다')
  assert.equal(scheduled, 0, '종료했는데 다시 볼 약속까지 잡았다')
})

// ── P-71·P-72·P-73 — 수동 업데이트에 자동 경로의 안전장치가 없다 ─────────
//
// [FACT] EV-002701 — `routes/update.js` 전체에 blockedReason·currentBlockedReason·busy
// 참조가 **0건**이었다. `if (state.running)` 하나만 통과하면 곧바로 파일을 갈아엎는다.
// **이 저장소가 그 위험을 이미 적어 뒀다** — autoUpdate.js 머리말:
//   "exit 만 문제가 아니었다 — git checkout -- . 로 파일이 갈리고 npm install·build 가
//    CPU 를 몇 분 잡아먹는 것도 방송 중엔 위험하다. 그래서 파괴적 단계 **전에** 막는다."
// 자동 경로는 그렇게 고쳐졌고(5e64816) 수동 경로는 exit 호출 하나만 고쳐졌다.
//
// 셋을 한 자물쇠에서 보는 이유: 전부 같은 함수(`/start` 의 async 본문) 안이고,
// 테스트 이음새(run 주입)가 셋 모두에 필요하다. 따로 하면 같은 40줄을 세 번 검수하게 된다.
const { runUpdate } = require('../routes/update')

function 가짜(opts = {}) {
  const 실행된 = []
  const 로그 = []
  return {
    실행된, 로그,
    deps: {
      run: async (cmd) => {
        실행된.push(cmd)
        if (opts.실패명령 && cmd.includes(opts.실패명령)) throw new Error('일부러 실패')
        // rev-parse 는 되돌릴 지점이다 — 빈 문자열을 주면 되돌리기가 조용히 꺼진다.
        // **40자리 hex 다.** 짧은 가짜를 주면 P-86 가드(형식 검증)에 걸려 되돌리기가 안 돈다 —
        // 그건 결함이 아니라 표본이 현실과 달랐던 것이다(2026-09-10).
        if (/rev-parse/.test(cmd)) return '0123456789abcdef0123456789abcdef01234567' + String.fromCharCode(10)
        return ''
      },
      blocked: () => opts.막힘 || null,
      restart: () => 로그.push('RESTART'),
      schedule: (fn) => fn(),   // 1.5초를 실제로 기다리지 않는다
      log: (s) => 로그.push(s),
      saveLastUpdate: () => {},
      setLastUpdate: () => {},
    },
  }
}

test('P-71: 방송 중이면 파일을 건드리기 전에 멈춘다', async () => {
  const g = 가짜({ 막힘: '방송 중("저녁 마무리")' })
  const r = await runUpdate(g.deps)
  assert.deepEqual(g.실행된, [],
    `방송 중인데 명령이 돌았다: ${g.실행된.join(' / ')} — git checkout 이 첫 줄이라 파일이 이미 갈렸다`)
  assert.match(g.로그.join('\n'), /저녁 마무리/, '왜 안 했는지 사람이 알아야 한다')
  assert.equal(r.deferred, true)
})

test('P-71: 조용하면 평소대로 다 돈다 — 대조군', async () => {
  const g = 가짜()
  await runUpdate(g.deps)
  // 개수가 아니라 **순서와 내용**을 본다. 되돌릴 지점을 잡는 rev-parse 가 checkout 뒤에 들어가
  // 개수는 구현에 따라 변한다 — 개수 단언은 그때마다 깨지면서 아무것도 안 지킨다.
  const 순서 = g.실행된.join(' / ')
  assert.match(g.실행된[0], /checkout/, `첫 명령이 checkout 이 아니다: ${순서}`)
  assert.match(g.실행된[g.실행된.length - 1], /build/, `마지막이 build 가 아니다: ${순서}`)
  assert.ok(/pull origin main/.test(순서) && /npm install/.test(순서), `단계가 빠졌다: ${순서}`)
  assert.ok(g.실행된.findIndex((c) => /rev-parse/.test(c)) < g.실행된.findIndex((c) => /pull/.test(c)),
    '되돌릴 지점을 pull **뒤에** 잡았다 — 그러면 새 커밋으로 되돌리게 된다')
  assert.ok(g.로그.includes('RESTART'), '재시작을 안 걸었다')
})

test('P-72: 재시작을 기다리는 동안 중복 실행이 막힌다', async () => {
  // state.running 이 실제 재시작보다 먼저 풀리면 그 창에서 또 누를 수 있다.
  // 화면은 P-70 의 3초 자동 새로고침으로 정확히 그 창을 만든다.
  const { updateState } = require('../routes/update')
  const g = 가짜()
  await runUpdate(g.deps)
  const s = updateState()
  assert.equal(s.done, true, '완료 표시는 나야 한다')
  assert.equal(s.running, true,
    '재시작 전에 running 이 풀렸다 — 그 창에서 두 번째 사이클이 첫 번째 위에 겹친다')
})

test('P-73: 중간에 실패하면 되돌린다', async () => {
  const g = 가짜({ 실패명령: 'npm install' })
  await runUpdate(g.deps)
  const 합 = g.실행된.join(' / ')
  assert.match(합, /reset/, `되돌리지 않았다: ${합} — 트리가 반쯤 갱신된 채 남는다`)
  assert.ok(!g.로그.includes('RESTART'), '실패했는데 재시작을 걸었다')
})

test('P-73: pull 이 실패하면 되돌릴 것이 없다 — 헛 reset 안 한다', async () => {
  // **`checkout` 으로 실패시키면 안 된다** — 그 줄은 `.catch(() => {})` 로 삼켜져
  // catch 에 들어가지도 않고 업데이트가 끝까지 성공한다(독립 검수 실측).
  // 즉 예전 이 테스트는 **이름이 주장하는 것을 검사하지 않았다.** 실패 지점은 pull 이어야 한다.
  const g = 가짜({ 실패명령: 'pull' })
  await runUpdate(g.deps)
  assert.ok(g.실행된.some((c) => /pull/.test(c)), '전제 확인 — pull 까지는 가야 한다')
  assert.ok(!g.실행된.some((c) => /reset/.test(c)),
    `당겨온 것이 없는데 되돌렸다 — 사람이 손으로 둔 변경을 날릴 수 있다: ${g.실행된.join(' / ')}`)
})

test('P-71: 미뤘으면 running 을 푼다 — 버튼이 영구히 잠기면 안 된다', async () => {
  const { updateState } = require('../routes/update')
  const g = 가짜({ 막힘: '방송 중("저녁 마무리")' })
  await runUpdate(g.deps)
  assert.equal(updateState().running, false,
    '미뤘는데 running 이 남았다 — 서버 재시작 전까지 버튼이 안 열린다')
})

test('운영 배선이 살아 있다 — blocked 기본값이 진짜 판정을 부른다', async () => {
  // 재현 테스트가 전부 blocked 를 주입하므로, 기본 배선을 끊어도 전부 초록이었다(독립 검수 실측).
  //
  // **소스에 문자열이 있는지만 보면 안 된다** — `return null; // currentBlockedReason` 처럼
  // 이름을 남긴 채 안 부르는 변이가 그 단언을 그대로 통과한다(직접 확인, EV-002856 M12).
  // 그래서 **기본값을 실제로 태워** 확인한다.
  const upPath = require.resolve('../services/autoUpdate')
  const 원래 = require.cache[upPath]
  const 진짜 = require('../services/autoUpdate')
  require.cache[upPath] = {
    id: upPath, filename: upPath, loaded: true,
    exports: { ...진짜, currentBlockedReason: () => '배선 확인용 사유' },
  }
  delete require.cache[require.resolve('../routes/update')]
  try {
    const { runUpdate: 새로 } = require('../routes/update')
    const 실행된 = []
    // blocked 를 **주입하지 않는다** — 기본값이 무엇을 부르는지가 이 테스트의 전부다.
    const r = await 새로({ run: async (c) => { 실행된.push(c); return '' }, restart: () => {}, schedule: (f) => f() })
    assert.equal(r.deferred, true,
      '기본 blocked 가 currentBlockedReason 을 안 부른다 — 테스트만 통과하고 운영에서는 안 막는다')
    assert.match(String(r.reason), /배선 확인용/)
    assert.deepEqual(실행된, [], `막혔는데 명령이 돌았다: ${실행된.join(' / ')}`)
  } finally {
    if (원래) require.cache[upPath] = 원래; else delete require.cache[upPath]
    delete require.cache[require.resolve('../routes/update')]
  }
})

test('P-73: 실패해도 running 은 풀린다 — 버튼이 영영 잠기면 안 된다', async () => {
  const { updateState } = require('../routes/update')
  const g = 가짜({ 실패명령: 'npm install' })
  await runUpdate(g.deps)
  assert.equal(updateState().running, false, '실패 뒤 버튼이 잠긴 채 남았다')
})
