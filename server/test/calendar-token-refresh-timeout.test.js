// ISSUE-004 — 구글 캘린더 토큰 fetch 에 제한시간이 있다
//
// 왜 필요한가(2026-09-06 검수, ISSUE-004): 아침 종합 방송(07:50)이 무인으로
//   morning.js → calendar.getTodayEvents → getValidToken → refreshAccessToken → fetch(oauth2 token)
// 를 타는데, 그 fetch 에 AbortSignal 이 없었다. 구글이 **오류가 아니라 무응답**이면 약속이 영영
// 안 끝나고, morning.js 의 try/catch 는 던지는 실패만 잡으므로 방송이 멈춘 채 60분 뒤에야
// 감시 경보가 뜬다. 같은 파일의 일정 조회 fetch 에는 이미 AbortSignal.timeout(10000) 이 있었다 —
// 셋 중 둘(토큰 교환·토큰 갱신)만 빠져 있었다.
//
// 이 테스트는 tests/audit/p-03-calendar-token-refresh-hangs.test.mjs(결함 재현, "멈춘다"가
// 통과 조건)의 기대값을 뒤집어 옮긴 것이다. 원장: EV-000456(재현) → 이 파일이 수정을 고정한다.
//
// 실제 네트워크도 실제 DB 도 건드리지 않는다. fetch 는 스텁이고 DB 는 설정만 돌려주는 가짜다.
// 스텁은 **signal 이 없으면 영영 안 끝난다** — 누가 signal 을 다시 빼면 아래 예산(2초) 경주에서
// STILL_HANGING 으로 잡힌다. 10초를 실제로 기다리는 종단 테스트는 두지 않는다(fetch-timeout.test.js
// 끝의 주석과 같은 이유 — 확인되는 것이 우리 코드가 아니라 Node 의 AbortSignal 이다).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const CALENDAR = path.join(__dirname, '..', 'services', 'calendar.js')

function fakeDB(rows) {
  return {
    prepare() {
      return {
        get(key) {
          const v = rows[key]
          return v === undefined ? undefined : { value: v }
        },
        all: () => [],
        run: () => ({}),
      }
    },
  }
}

const HANG_BUDGET_MS = 2000

// signal 이 실려 있으면 곧바로 body 를 돌려주고, 없으면 영영 안 끝나는 스텁.
function hangingUnlessSignalFetch(seen, body) {
  return (url, opts = {}) => {
    seen.push({ url: String(url), signal: opts.signal })
    if (!opts.signal) return new Promise(() => {})       // 결함 상태 — 영영 안 끝난다
    return Promise.resolve({ json: async () => body })
  }
}

async function withStubFetch(stub, fn) {
  const realFetch = globalThis.fetch
  globalThis.fetch = stub
  try {
    delete require.cache[require.resolve(CALENDAR)]
    return await fn(require(CALENDAR))
  } finally {
    globalThis.fetch = realFetch
    delete require.cache[require.resolve(CALENDAR)]
  }
}

test('ISSUE-004: 토큰 갱신 fetch 에 AbortSignal 이 실려 나가고, 무응답이어도 매달리지 않는다', async () => {
  const seen = []
  const stub = hangingUnlessSignalFetch(seen, { access_token: 'fresh', expires_in: 3600, items: [] })

  const 결과 = await withStubFetch(stub, (calendar) => {
    const db = fakeDB({
      gcal_access_token: 'expired-token',
      gcal_token_expiry: '1',            // 이미 만료 → getValidToken 이 갱신 경로로 간다
      gcal_refresh_token: 'refresh-abc',
      gcal_client_id: 'id',
      gcal_client_secret: 'secret',
    })
    return Promise.race([
      calendar.getTodayEvents(db).then(() => 'SETTLED', () => 'SETTLED'),
      new Promise((r) => setTimeout(() => r('STILL_HANGING'), HANG_BUDGET_MS)),
    ])
  })

  assert.equal(결과, 'SETTLED', `${HANG_BUDGET_MS}ms 안에 끝나지 않았다 — 토큰 갱신 fetch 가 다시 제한시간 없이 매달린다`)
  assert.ok(seen.length >= 1, '전제: fetch 가 한 번은 불려야 한다')
  const refresh = seen.find((c) => c.url.includes('oauth2.googleapis.com/token'))
  assert.ok(refresh, '전제: 토큰 갱신 fetch 가 불려야 한다')
  assert.ok(refresh.signal instanceof AbortSignal, '토큰 갱신 fetch 에 AbortSignal 이 실리지 않았다')
  assert.equal(refresh.signal.aborted, false, '호출 시점에 이미 중단된 signal 이면 안 된다')
})

test('ISSUE-004: 토큰 교환(exchangeCode) fetch 에도 같은 제한시간이 있다', async () => {
  const seen = []
  const stub = hangingUnlessSignalFetch(seen, { access_token: 'a', refresh_token: 'r', expires_in: 3600 })

  const 결과 = await withStubFetch(stub, (calendar) => {
    const db = fakeDB({ gcal_client_id: 'id', gcal_client_secret: 'secret' })
    return Promise.race([
      calendar.exchangeCode('code-1', db).then(() => 'SETTLED', () => 'SETTLED'),
      new Promise((r) => setTimeout(() => r('STILL_HANGING'), HANG_BUDGET_MS)),
    ])
  })

  assert.equal(결과, 'SETTLED', `${HANG_BUDGET_MS}ms 안에 끝나지 않았다 — 토큰 교환 fetch 에 제한시간이 없다`)
  assert.equal(seen.length, 1, 'fetch 가 정확히 한 번 불려야 한다')
  assert.ok(seen[0].signal instanceof AbortSignal, '토큰 교환 fetch 에 AbortSignal 이 실리지 않았다')
  assert.equal(seen[0].signal.aborted, false, '호출 시점에 이미 중단된 signal 이면 안 된다')
})
