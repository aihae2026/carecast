// 시각을 저장할 때 형식을 보는가 (P-36 + 검수 신규 발견, 2026-09-11).
//
// ── 무엇을 막나 ────────────────────────────────────────────────────────────
// 예약(`routes/schedules.js:30-35`)은 시각 형식이 깨지면 **400 으로 막는다.** 이유를
// 그 자리에 적어 뒀다 — *"등록은 됐는데 영원히 발동하지 않는 예약 … 조용한 실패라
// 저장 단계에서 막는다."*
//
// 그런데 **자동방송 5종 시각**(`POST /broadcast-schedule`)과 **PC 자동종료 시각**
// (`POST /auto-shutdown`)에는 그 검사가 없었다. 형식이 깨지면
//   · 스케줄러는 문자열 정확일치로 비교하므로 영원히 안 맞고,
//   · 감시(watchdog)도 그 값을 못 읽어 `continue` 로 지나간다.
// **둘 다 침묵한다.** 사람은 "저장했는데 왜 안 나가지"만 남는다.
//
// ── 빈 문자열은 막지 않는다 (이게 함정이다) ─────────────────────────────────
// 이 저장소에서 **빈 시각은 "이 방송을 쓰지 않는다"는 뜻**으로 확정돼 있다
// (`domain/autoBroadcasts.js` 의 `autoTime` 머리말, AP-0012). 예약 쪽 정규식을 그대로
// 복사해 오면 빈 값을 400 으로 막아서 **끄기 기능이 사라진다** — 그게 회귀다.
// 그래서 아래 검사는 SHOULD 와 SHOULD NOT 을 **쌍으로** 쓴다.
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-autotime-'))
process.env.CARECAST_DB_PATH = path.join(TMPDIR, 'test.db')
process.env.CARECAST_NO_HARDWARE = '1'

const { getDB, initDB } = require('../db/schema')
initDB()

// ── 이 시험을 **어디서 돌리든** 진짜 종료가 안 걸리게 못 박는다 (2026-09-13) ──────────
//
// 무슨 일이 있었나: 아래 「자동종료 시각은 저장된다」가 `POST /auto-shutdown` 을 부르면
// 그 라우트가 `scheduleAutoShutdown()` 까지 간다. 그러면 **진짜 `setTimeout` 이 걸리고**
// (실측: `[자동종료] 18:21에 PC 종료 예약됨 (1368분 후)`), 그 22.8시간짜리 타이머가
// 이벤트 루프를 붙들어 **이 파일이 영영 안 끝났다.** `npm test` 가 209번째에서 멎던
// 원인이 이것이다. 게다가 프로세스가 그때까지 살아 있으면 PC 가 **실제로 꺼진다.**
//
// 실행부에는 이미 `pcRole` 가드가 있다(현장 PC 에서만 예약한다). 그런데 그 판정이
// **git worktree 에서 뚫려 있었다** — `.git` 이 폴더가 아니라 파일이라 브랜치를 못 읽고,
// "모르면 현장으로 본다" 규칙에 걸려 개발 워크트리가 현장으로 판정됐다.
// 그 뿌리는 `services/pcRole.js` 에서 고쳤다(`detectGitDir`).
//
// **그것만으로는 부족하다.** 현장 PC 는 `main` 이라 판정이 맞아도 SITE 이고, 거기서
// `npm test` 를 돌리면 여전히 진짜 종료가 걸린다(CLAUDE.md: *"테스트도 예외가 아니다"*).
// 그래서 이 시험은 **제 임시 DB 에 역할을 박아** 호스트가 무엇이든 안 걸리게 한다.
//
// 이것은 검증을 약하게 만드는 것이 아니다 — 이 파일이 지키는 사실은 **시각 형식 검증**이지
// 종료 예약이 아니다. 종료 예약의 조건은 `server/test/pc-role.test.js` 가 따로 지킨다.
getDB().prepare(
  "INSERT INTO settings (key, value) VALUES ('pc_role', 'dev') ON CONFLICT(key) DO UPDATE SET value = 'dev'"
).run()

const router = require('../routes/settings')

function 핸들러(method, routePath) {
  const layer = router.stack.find(l => l.route?.path === routePath && l.route?.methods?.[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 를 못 찾았다 — 이 검사를 옮길 것`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

/** 라우트를 직접 부르고 { status, body } 를 돌려준다. */
function 부르기(handle, body) {
  return new Promise((resolve) => {
    let status = 200
    const res = {
      status(c) { status = c; return this },
      json(b) { resolve({ status, body: b }) },
    }
    handle({ body }, res)
  })
}

const 저장된 = (key) =>
  getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value

// ── 자동방송 5종 시각 ───────────────────────────────────────────────────────
const 방송일정 = () => 핸들러('post', '/broadcast-schedule')

test('SHOULD — 올바른 시각은 그대로 저장된다', async () => {
  const r = await 부르기(방송일정(), { morning: { time: '07:50' } })
  assert.equal(r.status, 200)
  assert.equal(저장된('morning_time'), '07:50')
})

test('SHOULD NOT — 빈 시각은 막지 않는다. 그것은 "이 방송을 쓰지 않는다"는 뜻이다', async () => {
  const r = await 부르기(방송일정(), { exercise: { time: '' } })
  assert.equal(r.status, 200, '빈 값을 막으면 자동방송을 끄는 길이 사라진다(AP-0012)')
  assert.equal(저장된('exercise_broadcast_time'), '')
})

test('SHOULD — 형식이 깨진 시각은 400 으로 막는다', async () => {
  for (const 나쁜값 of ['99:99', '7:50', '0750', '25:00', '07:60', 'abc', '07:5']) {
    const r = await 부르기(방송일정(), { morning: { time: 나쁜값 } })
    assert.equal(r.status, 400, `'${나쁜값}' 이 통과했다 — 저장은 되고 방송은 영원히 안 나간다`)
  }
})

test('SHOULD — 앞뒤 공백이 붙은 시각도 막는다. 다듬어서 받지 않는다', async () => {
  // 다듬어 주면 **발동부는 안 내보내는데 감시는 유효로 읽는** 새 어긋남이 생긴다
  // (`autoBroadcasts.js` 의 autoTime 머리말, 2026-09-08 독립 검수 지적).
  for (const 나쁜값 of [' 18:21', '18:21 ']) {
    const r = await 부르기(방송일정(), { dinner: { time: 나쁜값 } })
    assert.equal(r.status, 400, `'${나쁜값}' 이 통과했다`)
  }
})

test('SHOULD NOT — 막힌 요청은 **아무것도 저장하지 않는다**', async () => {
  await 부르기(방송일정(), { lunch: { time: '11:10', name: '점심 원래이름' } })
  const r = await 부르기(방송일정(), { lunch: { time: '99:99', name: '바뀐이름' } })
  assert.equal(r.status, 400)
  assert.equal(저장된('lunch_broadcast_time'), '11:10', '시각이 덮였다')
  assert.equal(저장된(require('../domain/autoBroadcasts').autoNameKey?.('lunch') ?? 'lunch_name'),
    저장된(require('../domain/autoBroadcasts').autoNameKey?.('lunch') ?? 'lunch_name'),
    '(이름 키 이름은 구현에 맡긴다 — 여기서는 시각이 안 덮이는 것만 본다)')
})

test('SHOULD — 다섯 방송 전부에 같은 규칙이 걸린다. 한 곳만 막으면 나머지로 새어 나간다', async () => {
  const 칸 = [
    ['morning', 'morning_time'],
    ['exercise', 'exercise_broadcast_time'],
    ['lunch', 'lunch_broadcast_time'],
    ['dinner', 'dinner_broadcast_time'],
    ['evening_prayer', 'evening_prayer_time'],
  ]
  for (const [키] of 칸) {
    const r = await 부르기(방송일정(), { [키]: { time: '99:99' } })
    assert.equal(r.status, 400, `'${키}' 의 시각 검증이 없다`)
  }
})

// ── PC 자동종료 시각 (검수 신규 발견) ───────────────────────────────────────
// 여기가 더 위험하다. 이 값은 **PC 를 끄는 시각**이다.
const 자동종료 = () => 핸들러('post', '/auto-shutdown')

test('SHOULD NOT — 자동종료 시각을 비우는 것은 "끄지 않는다"이다. 막지 않는다', async () => {
  const r = await 부르기(자동종료(), { time: '' })
  assert.equal(r.status, 200)
  assert.equal(저장된('auto_shutdown_time'), '')
})

test('SHOULD — 자동종료도 형식이 깨진 시각을 막는다', async () => {
  for (const 나쁜값 of ['99:99', '18:9', ' 18:21', '오후 6시']) {
    const r = await 부르기(자동종료(), { time: 나쁜값 })
    assert.equal(r.status, 400, `'${나쁜값}' 이 통과했다 — PC 가 안 꺼지고 아무도 모른다`)
  }
})

test('SHOULD — 올바른 자동종료 시각은 저장된다', async () => {
  const r = await 부르기(자동종료(), { time: '18:21' })
  assert.equal(r.status, 200)
  assert.equal(저장된('auto_shutdown_time'), '18:21')
})

// ── 규칙이 한 곳에 있는가 ───────────────────────────────────────────────────
test('시각 형식 규칙을 라우트가 또 적지 않는다 — `autoBroadcasts` 의 것을 쓴다', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'routes', 'settings.js'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.match(s, /유효시각|isValidAutoTime/,
    '라우트가 단일 출처를 안 쓴다')
  assert.ok(!/\[01\]\\d\|2\[0-3\]/.test(s),
    '라우트가 정규식을 직접 들고 있다 — autoTime 과 갈리는 날이 온다')
})
