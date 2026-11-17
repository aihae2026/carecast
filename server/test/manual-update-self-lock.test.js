// 수동 업데이트가 **자기 잠금에 막히지 않는다** — 시작할 때도, **재시작할 때도**.
// (V③ DEV-MERGE-R8[2] → R10[1]·[3], HIGH, 2026-09-14)
//
// ── 무엇이 잘못됐나 ──────────────────────────────────────────────────────────
// P-83 으로 두 업데이트 경로가 서로를 보게 만들었다 — 자동이 돌면 수동이 미루고, 수동이
// 돌면 자동이 미룬다. 옳은 방향이다. 그런데 **수동이 자동용 판정을 통째로 재사용했다.**
//
//   runUpdate → state.running = true          ← 내가 잠근다
//             → blocked() → blockedNow() → currentBlockedReason()
//                         → routes/update.isUpdating()  ← **내 잠금을 읽는다**
//                         → "수동 업데이트가 진행 중입니다"
//
// **이것은 회귀다** — `main`(fd63241) 의 수동 경로에는 이 되돌이 검사가 없었다.
//
// ── 한 번 더 있었다 — 재시작 단계 (R10[1]) ──────────────────────────────────
// 첫 수정은 **시작 문턱만** 열었다. 빌드가 끝나면 `restartWhenIdle()` 이 도는데, 그 기본
// 판정(`reasonOf = currentBlockedReason`)은 **옵션 없이** 불려서 다시 `state.running` 을
// 본다. `state.running` 은 P-72 때문에 재시작까지 켜져 있다 — 그래서 **빌드는 되는데
// 서버가 영영 재시작을 안 한다.** 화면에는 "완료" 가 뜨고 옛 코드가 계속 돈다.
// 더 나쁜 것: 그 뒤로 자동 경로도 계속 막힌다(`running` 이 안 풀린다).
//
// ── 이 시험이 `schedule` 을 무동작으로 두지 않는 이유 (R10[3]) ───────────────
// 앞 판은 `schedule: () => {}` 로 막아서 **재시작 경로를 아예 안 돌렸다.** 그래서 위
// 결함을 못 봤다. 여기서는 예약을 **그 자리에서 실행**하고, 재시작도 제품의
// `restartWhenIdle` 을 그대로 쓴다 — 대역으로 바꾸는 것은 `exit` 하나뿐이다.
'use strict'

// **DB 를 파일로 만들지 않는다 — 메모리다.** 이 시험은 `blocked` 를 대역으로 안 주는 것이
// 요지라 진짜 DB 가 필요한데, 임시 파일을 쓰면 **읽기 전용 검수 환경에서 아예 안 돈다**
// (V③ DEV-MERGE-R11 이 정확히 그것 때문에 INCONCLUSIVE 였다 — `unable to open database file`).
// 검사 내용은 하나도 안 줄었다. 파일을 안 만들 뿐이다.
process.env.CARECAST_DB_PATH = ':memory:'
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')

// **방송 시각은 꺼 둔다** (2026-10-07). 진짜 판정(`currentBlockedReason`)은 **실제 시계**로 「방송 임박」도 본다.
// 새 DB 의 기본 자동방송(국민체조 09:00 등)이 켜진 채라, 그 앞 몇 분 안에 돌리면 수동 업데이트가 빌드 전에
// 「국민체조(09:00)까지 8분 남음」으로 미뤄져 이 시험이 60초 뒤 실패했다(08:52 에 두 번 재현, 밤엔 통과).
// 이 시험이 보는 것은 **잠금 되돌이**이지 방송 시각이 아니다 — 시각 판정은 auto-update 시험들이 따로 본다.
test.before(() => {
  initDB()   // 메모리라 치울 파일이 없다
  const { getDB } = require('../db/schema')
  const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
  const { writeSetting } = require('../domain/settingsRead')
  for (const s of AUTO_BROADCASTS) writeSetting(getDB(), s.enabledKey, 'false', '자동')
  getDB().prepare('UPDATE schedules SET active = 0').run()
  // 긍정 앵커: 이제 시각 때문에 막히지 않는다(아래 시험의 「수동 진행 중」 판정이 시각에 가려지지 않게).
  assert.equal(require('../services/autoUpdate').currentBlockedReason(), null, '방송 시각을 껐는데도 막힌다 — 전제가 무너졌다')
})

/** rev-parse 는 40자리 hex 를 돌려줘야 되돌리기 지점을 잡는다. */
const 명령대역 = (부른명령) => async (cmd) => {
  부른명령.push(cmd)
  if (/rev-parse/.test(cmd)) return 'a'.repeat(40)
  return ''
}

test('자동 경로는 수동이 돌고 있으면 **실제로 판정을 내어** 미룬다 — P-83 을 안 깬다', async () => {
  const U = require('../routes/update')
  const auto = require('../services/autoUpdate')

  assert.equal(typeof U.isUpdating, 'function', '긍정 앵커 — 수동 잠금을 읽는 창구가 있다')
  assert.equal(U.isUpdating(), false, '긍정 앵커 — 시작 전에는 잠겨 있지 않다')

  // 수동을 **진짜로 돌리는 중**에 자동용 판정을 물어본다. 소스 대조가 아니라 실행이다(R10[3]).
  let 빌드도달 = null
  const 빌드중 = new Promise((resolve) => { 빌드도달 = resolve })
  let 빌드놓아주기 = null
  const 멈춤 = new Promise((resolve) => { 빌드놓아주기 = resolve })

  const 돌고있음 = U.runUpdate({
    run: async (cmd) => {
      if (/rev-parse/.test(cmd)) return 'a'.repeat(40)
      if (/npm run build/.test(cmd)) { 빌드도달(); await 멈춤 }
      return ''
    },
    restart: () => {},
    schedule: () => {},
    setLastUpdate: () => {},
  })

  await 빌드중
  assert.equal(U.isUpdating(), true, '긍정 앵커 — 지금 수동이 돌고 있다')

  // **옵션 없이** 부른다 = 자동 경로가 부르는 방식 그대로.
  const 자동사유 = auto.currentBlockedReason()
  assert.equal(자동사유, '수동 업데이트가 진행 중입니다',
    `자동 경로가 수동 잠금을 안 봤다 — 같은 트리에서 pull·install 이 둘 동시에 돈다. 받은 사유: ${자동사유}`)

  // **수동잠금무시** 를 주면 그 검사만 건너뛴다(다른 막는 사유는 그대로 본다).
  const 수동사유 = auto.currentBlockedReason({ 수동잠금무시: true })
  assert.notEqual(수동사유, '수동 업데이트가 진행 중입니다',
    '수동잠금무시 를 줬는데도 자기 잠금을 봤다')

  빌드놓아주기()
  await 돌고있음
})

test('수동 업데이트가 자기 잠금을 보고 스스로를 막지 않는다 — 시작 문턱', async () => {
  const U = require('../routes/update')
  const 부른명령 = []
  const r = await U.runUpdate({
    // **`blocked` 를 대역으로 안 준다** — 기본 판정(`blockedNow`)이 되돌이를 도는지가 요지다.
    run: 명령대역(부른명령),
    restart: () => {},
    schedule: () => {},
    setLastUpdate: () => {},
  })

  assert.notEqual(r && r.reason, '수동 업데이트가 진행 중입니다',
    '수동 업데이트가 **자기 잠금**을 읽고 스스로를 막았다 — 버튼이 아예 안 먹는다')
  assert.ok(!(r && r.deferred), `방송도 안 하는데 미뤄졌다 — 사유: ${r && r.reason}`)
  assert.ok(부른명령.length > 0,
    '업데이트 명령이 하나도 안 나갔다 — 막히지 않았다면 git 부터 불러야 한다')
})

test('빌드가 끝나면 **실제로 재시작까지 간다** — 재시작도 자기 잠금에 막히지 않는다', async () => {
  const U = require('../routes/update')
  const { restartWhenIdle } = require('../services/autoUpdate')

  const 부른명령 = []
  const 나간종료 = []
  const 재시작사유 = []

  const r = await U.runUpdate({
    run: 명령대역(부른명령),
    // **제품의 restartWhenIdle 을 그대로 쓴다.** 판정(`reasonOf`)을 여기서 안 정한다 —
    // 제품이 무엇을 넘기든 그대로 흘려보내는 것이 이 시험의 요지다.
    restart: (opts = {}) => restartWhenIdle({
      ...opts,
      exit: (code) => 나간종료.push(code),
      // 기다리게 되면 그 사유를 잡아 둔다. 실제로 기다리지는 않는다(무한 재귀 방지).
      schedule: (fn, ms) => { 재시작사유.push(`대기 ${ms}ms`); void fn },
    }),
    // 예약을 **그 자리에서 실행**한다 — 무동작으로 두면 재시작 경로를 아예 안 본다(R10[3]).
    schedule: (fn) => { fn() },
    setLastUpdate: () => {},
  })

  assert.equal(r && r.ok, true, `업데이트가 완료로 안 끝났다 — ${JSON.stringify(r)}`)
  assert.ok(부른명령.some(c => /npm run build/.test(c)), '긍정 앵커 — 빌드까지 갔다')
  assert.deepEqual(나간종료, [100],
    '재시작이 안 났다 — 빌드만 하고 옛 코드가 계속 돈다. '
    + `재시작이 미뤄진 사유: [${재시작사유.join(', ')}]`)
})

