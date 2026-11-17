'use strict'
// **예약이 바뀌면 모든 화면이 안다** (P-16, 2026-09-11).
//
// 요양원은 현장 PC·직원 폰·관리자 화면을 **동시에** 본다. 한 곳에서 예약을 지웠는데
// 다른 곳이 옛 목록을 들고 있으면, 사람은 지웠다고 믿고 화면은 있다고 말한다.
//
// [FACT] EV-003993 — 서버가 쏘는 SSE 27종에 **예약 변경이 없었다**
// (`favorites_updated`·`volume_change` 는 있는데 예약만 빠졌다).
// `server/routes/schedules.js` 의 `broadcastSSE` 호출이 **0건**이었다.
//
// **실제 두 탭으로 재현했다**: 샌드박스에 더미 예약을 만들고 탭 B 에서 지웠더니
// 서버에서는 사라졌는데 **탭 A 는 10초 뒤에도 그대로 보여줬다.**
//
// 고치는 방식은 이 저장소에 **이미 있는 것**을 따른다 — `favorites_updated`
// ([FACT] `server/routes/favorites.js:26,40,52` · `src/lib/api.js:530` ·
// `src/hooks/useScheduledBroadcast.js:209`). 새 방식을 만들지 않는다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const ROUTE = fs.readFileSync(path.join(ROOT, 'server/routes/schedules.js'), 'utf8')
const API   = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
const HOOK  = fs.readFileSync(path.join(ROOT, 'src/hooks/useScheduledBroadcast.js'), 'utf8')

// 예약을 **바꾸는** 라우트 전부. 하나라도 빠지면 그 경로만 조용히 안 퍼진다.
const 쓰는라우트 = [
  ["router.post('/'", '새 예약 추가'],
  ["router.put('/:id'", '예약 수정'],
  ["router.patch('/:id/toggle'", '일시정지·재개'],
  ["router.delete('/:id'", '예약 삭제'],
  ["router.delete('/ai/:id'", 'AI 초안 삭제'],
]

test('알림은 헬퍼 한 곳에서만 쏜다 — 라우트마다 사본을 두지 않는다', () => {
  const m = /function 예약바뀜\(req, 무엇, 더 = \{\}\) \{([\s\S]*?)\n\}/.exec(ROUTE)
  assert.ok(m, '예약바뀜() 을 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /broadcastSSE\('schedules_updated'/, '헬퍼가 SSE 를 안 쏜다')
  // 라우트들이 `broadcastSSE` 를 직접 부르면 그 자리마다 이름·형식이 갈릴 수 있다
  const 직접호출 = (ROUTE.match(/broadcastSSE\(/g) || []).length
  assert.equal(직접호출, 1, `broadcastSSE 를 ${직접호출}곳에서 부른다 — 헬퍼 한 곳이어야 한다`)
})

test('예약을 바꾸는 라우트가 전부 알린다 — 하나도 빠지지 않는다', () => {
  for (const [앵커, 이름] of 쓰는라우트) {
    const i = ROUTE.indexOf(앵커)
    assert.ok(i > 0, `${이름} 라우트를 못 찾았다 — 이 가드를 옮길 것`)
    // 그 라우트 본문 안에서 알리는가. 다음 라우트가 시작하기 전까지를 본문으로 본다.
    const 다음 = ROUTE.slice(i + 1).search(/\nrouter\.(get|post|put|patch|delete)\(/)
    const 본문 = 다음 < 0 ? ROUTE.slice(i) : ROUTE.slice(i, i + 1 + 다음)
    assert.ok(/예약바뀜\(req,/.test(본문),
      `${이름} 이 바뀐 것을 아무에게도 안 알린다 — 그 경로만 조용히 안 퍼진다`)
  }
})

test('화면이 그 신호를 듣는다 — 서버만 쏘고 아무도 안 들으면 죽은 배선이다', () => {
  assert.match(API, /es\.addEventListener\('schedules_updated'/,
    'api.js 가 schedules_updated 를 안 듣는다 — 서버가 쏴도 화면에 안 온다')
  assert.match(HOOK, /type === 'schedules_updated'/,
    '훅이 schedules_updated 를 안 다룬다')
  assert.match(HOOK, /carecast:schedules-updated/,
    '화면이 받을 수 있는 이벤트로 안 바꿔 준다')
})

test('예약 화면들이 그 이벤트를 듣고 다시 읽는다', () => {
  // **서버→훅까지만 잇고 화면이 안 들으면 아무 일도 안 일어난다.**
  // 예약을 보여주는 주요 화면 둘이 실제로 듣는지 본다.
  for (const f of ['src/components/admin/sections/WeeklySchedule.jsx',
                   'src/components/admin/sections/ScheduledBroadcast.jsx']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.match(src, /carecast:schedules-updated/, `${f} 가 예약 변경을 안 듣는다`)
    // 듣기만 하고 아무것도 안 하면 소용없다 — 다시 읽는 함수를 불러야 한다
    assert.match(src, /addEventListener\('carecast:schedules-updated'/,
      `${f} 가 리스너를 안 단다`)
    assert.match(src, /removeEventListener\('carecast:schedules-updated'/,
      `${f} 가 리스너를 안 떼어 낸다 — 화면을 오갈수록 쌓여 같은 조회가 여러 번 난다`)
  }
})

test('내가 한 변경으로 내 화면이 두 번 읽지 않는다', () => {
  // 지운 쪽은 이미 자기 상태를 고쳤다. 거기에 SSE 재조회까지 겹치면 깜빡인다.
  // 서버가 **누가 바꿨는지**를 실어 보내고, 화면이 자기 것이면 건너뛸 수 있어야 한다.
  assert.match(ROUTE, /broadcastSSE\('schedules_updated', \{[^}]*by:/,
    '누가 바꿨는지를 안 실어 보낸다 — 받는 쪽이 자기 변경을 못 가린다')
})
