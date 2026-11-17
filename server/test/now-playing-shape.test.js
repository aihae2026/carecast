'use strict'
// **브라우저가 보낸 것이 서버의 판정 상태가 된다** (P-46, 2026-09-11).
//
// `POST /api/status/now-playing` 은 `req.body` 를 **검증 없이** `nowPlaying.update()` 에
// 넘겼다. 그런데 그 상태는 표시용이 아니다 — `scheduler.broadcastInProgress()` 가
// `nowPlaying.get().broadcast` 를 읽어 **예약을 내보낼지 미룰지**를 정한다.
//
// 이 시스템은 **인증이 없는 것이 설계**다(PROJECT_PROFILE §1-1 — 직원이 각자 기기로 곧바로
// 조작해야 한다). 그러니 "아무나 보낼 수 있다" 는 전제를 바꿀 수 없고, 대신 **무엇을 받을지**
// 를 좁힌다. 화면이 정당하게 보내는 것(`{broadcast:null}` — 정지 버튼)은 그대로 받는다.
//
// **남는 것은 여전히 남는다**: 같은 망의 누구든 정지 신호를 보낼 수 있다. 그건 인증의
// 문제지 모양의 문제가 아니라, 여기서 못 막는다. 전제가 바뀌면(§1-1 의 조건) 다시 본다.
process.env.CARECAST_DB_PATH = require('node:path')
  .join(require('node:os').tmpdir(), `carecast_test_nowplaying_${process.pid}_${Date.now()}.db`)

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
// SSE 는 안 띄운다 — 이 검사는 상태 모양만 본다.
require.cache[require.resolve(path.join(ROOT, 'server/services/sse'))] = {
  exports: { broadcastSSE: () => 0 }, loaded: true, id: 's', filename: 's', children: [], paths: [],
}
const np = require(path.join(ROOT, 'server/services/nowPlaying'))

test('모르는 칸은 안 받는다 — 서버 상태에 아무 키나 꽂히면 안 된다', () => {
  np.update({ broadcast: null, bgm: null, video: null })
  np.update({ 이상한칸: '값', hacked: true, __proto__: { polluted: 1 } })
  const s = np.get()
  assert.deepEqual(Object.keys(s).sort(), ['bgm', 'broadcast', 'video'],
    `모르는 칸이 상태에 들어왔다: ${JSON.stringify(s)}`)
  assert.equal({}.polluted, undefined, '프로토타입이 오염됐다')
})

test('칸의 모양을 맞춘다 — 객체가 아니면 비운다', () => {
  np.update({ broadcast: '문자열' })
  assert.equal(np.get().broadcast, null, '문자열이 broadcast 자리에 들어왔다 — 판정이 truthy 로 읽는다')
  np.update({ broadcast: ['배열'] })
  assert.equal(np.get().broadcast, null, '배열이 broadcast 자리에 들어왔다')
  np.update({ broadcast: 123 })
  assert.equal(np.get().broadcast, null, '숫자가 broadcast 자리에 들어왔다')
})

test('아는 칸의 아는 필드만 남긴다', () => {
  np.update({ broadcast: { title: '아침방송', tab: 'morning', 몰래: '따라온 값' } })
  assert.deepEqual(np.get().broadcast, { title: '아침방송', tab: 'morning' },
    '모르는 필드가 따라 들어왔다')
  np.update({ bgm: { title: '노래', 몰래: 1 } })
  assert.deepEqual(np.get().bgm, { title: '노래' })
  np.update({ video: { name: '영상', 몰래: 1 } })
  assert.deepEqual(np.get().video, { name: '영상' })
})

test('**화면이 정당하게 보내는 것은 그대로 받는다** — 정지 버튼이 죽으면 안 된다', () => {
  np.update({ broadcast: { title: '방송', tab: null } })
  assert.ok(np.get().broadcast, '준비 실패')
  // `NowPlayingBar.jsx` 의 정지 버튼이 실제로 보내는 모양이다.
  np.update({ broadcast: null, bgm: null })
  assert.equal(np.get().broadcast, null, '정지 신호가 안 먹는다 — 화면이 "방송 중" 으로 굳는다')
  assert.equal(np.get().bgm, null)
})

test('내부 호출부의 모양이 그대로 산다 — 회귀 방지', () => {
  // 실제로 서버 안에서 쓰는 모양들(grep 으로 모은 것)
  np.update({ broadcast: { title: '점심 식사 전 방송', tab: 'lunch' } })
  assert.equal(np.get().broadcast.title, '점심 식사 전 방송')
  np.update({ bgm: { title: '유튜브 BGM' } })
  assert.equal(np.get().bgm.title, '유튜브 BGM')
  np.update({ broadcast: null, video: null })
  assert.equal(np.get().broadcast, null)
  assert.equal(np.get().video, null)
})

test('긴 문자열은 자른다 — 상태가 메모리를 먹지 않게', () => {
  np.update({ broadcast: { title: 'ㄱ'.repeat(5000) } })
  assert.ok(np.get().broadcast.title.length <= 200,
    `제목이 안 잘렸다(${np.get().broadcast.title.length}자) — 아무나 큰 값을 밀어 넣을 수 있다`)
})
