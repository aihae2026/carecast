'use strict'
// **같은 분 예약 둘을 실제로 발사시켜 본다** (P-42 후속, 2026-09-11).
//
// `same-minute-overlap.test.js` 는 카운터(`예약나감표시()`)를 **손으로 올렸다 내릴 뿐**이라,
// tick 이 `due` 배열을 도는 진짜 경로를 한 번도 안 지난다. 그래서 "카운터는 잘 센다" 만
// 증명하고 **"그래서 두 번째가 미뤄지나" 는 증명하지 않는다** — 가짜 오라클이다.
// 전부 초록인 채로 결함이 그대로 있었고, Codex 독립 검수가 그것을 지적했다.
//
// [FACT] EV-004133 재현(수정 전): 같은 분 음원 예약 둘이 **둘 다** `prayer_play` 를 냈고,
// 미뤄진 것은 0건이며, 이력에는 **성공이 둘** 남았다. 홀에서는 앞 소리가 끊기는데
// 기록은 둘 다 성공이다 — 거짓 성공(CC-003 계열).
//
// 원인: 브라우저가 내는 유형(예약 6종 중 다섯, PROJECT_PROFILE §1-3)은 SSE 를 쏘고
// **곧바로 반환**한다. `fireScheduleInner` 의 `finally` 가 그 자리에서 카운터를 걷으므로,
// 다음 예약이 볼 때는 이미 0 이다.
//
// **스텁을 파일 맨 위에서 건다** — scheduler 를 require 하는 순간 `broadcastSSE` 를
// 최상위에서 가져가므로, 테스트 안에서 갈아끼우면 늦는다.
process.env.CARECAST_NO_HARDWARE = '1'
// **DB 를 임시 파일로 돌린다** — 이 저장소 테스트 138개가 쓰는 관례다(P-120, 2026-09-11).
// `scheduler` 를 require 하는 것만으로 `server/db/database.db` 가 열리고, 없으면 **만들어진다.**
// 안 돌리면 이 테스트가 **개발 DB 를 직접 건드린다.** 본체에서는 그 파일이 이미 있어서
// 눈에 안 띄었고, 빈 검수 사본에서 처음 드러났다([FACT] EV-004201 — 제어기가
// `WT_IGNORED_CHANGED` 로 잡았다. 가드가 옳았다).
const os = require('node:os')
process.env.CARECAST_DB_PATH = require('node:path')
  .join(os.tmpdir(), `carecast_test_same_minute_real_${process.pid}_${Date.now()}.db`)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 가짜 = (exports) => ({ exports, loaded: true, id: 'stub', filename: 'stub', children: [], paths: [] })

const 쏜것 = []
require.cache[require.resolve(path.join(ROOT, 'server/services/sse'))] =
  가짜({ broadcastSSE: (e, d) => { 쏜것.push({ e, d }); return 1 }, addClient() {}, clientCount: () => 0, setSoundGate() {} })
require.cache[require.resolve(path.join(ROOT, 'server/services/nowPlaying'))] =
  가짜({ get: () => ({ broadcast: null, video: null, bgm: null }), getYtBGM: () => null, update() {}, updateYtBGM() {} })
require.cache[require.resolve(path.join(ROOT, 'server/services/micLive'))] =
  가짜({ isLive: () => false, chunkArrived() {} })
require.cache[require.resolve(path.join(ROOT, 'server/services/audioQueue'))] =
  가짜({ isBusy: () => false, enqueue: async () => {}, stopAll() {}, mciVolume() {} })

const { 이번분예약돌기, processDeferred, deferred, 예약나감표시 } = require(path.join(ROOT, 'server/services/scheduler'))._defer

// 이 경로가 실제로 묻는 것만 답하는 최소 DB
const 적힌이력 = []
const 설정 = new Map()   // autoDueThisMinute 이 읽는 settings 행
const 유형 = new Map()   // 미룬 예약을 다시 읽을 때의 broadcast_type
const db = {
  prepare(sql) {
    if (/INSERT INTO broadcasts/i.test(sql)) {
      return { run: (...a) => { 적힌이력.push({ content: a[3], success: a[6] }); return { lastInsertRowid: 적힌이력.length } } }
    }
    if (/FROM audio_files/i.test(sql)) {
      return { get: (id) => ({ id, category: 'prayer', filename: `f${id}.mp3`, original_name: `음원${id}` }) }
    }
    // `processDeferred` 는 미룬 예약이 **아직 살아 있는지** 다시 읽는다(사람이 지웠을 수
    // 있으므로). 여기서 undefined 를 주면 "지워졌다" 로 조용히 버려져, 미룸 경로가 아예
    // 안 밟힌다 — 스텁이 실제 계약을 안 지키면 검사는 아무것도 안 보는 것과 같다.
    if (/FROM schedules WHERE id/i.test(sql)) {
      return { get: (id) => 예약(id, 유형.get(id) || 'audio') }
    }
    // `autoDueThisMinute` 이 여기를 읽는다. `rawSettings` 는 `.all(...keys)` 로 부르고
    // `{key, value}` 행을 기대한다 — 그 계약을 그대로 지킨다. 테스트가 `설정` 에 넣은 것만 준다.
    if (/FROM settings/i.test(sql)) {
      return {
        get: () => undefined,
        all: (...keys) => keys.filter(k => 설정.has(k)).map(k => ({ key: k, value: 설정.get(k) })),
      }
    }
    return { run: () => ({ changes: 1 }), get: () => undefined, all: () => [] }
  },
}

// `이번분예약돌기` 는 `shouldRunToday` 를 지난다(실제 tick 과 같다) — 매일 반복으로 둔다.
const 예약 = (id, type = 'audio') => ({
  id, title: `예약${id}`, broadcast_type: type, audio_file_id: id,
  target: '전체', scheduled_time: '15:00', active: 1, playback_rate: null,
  main_volume: null, bgm_volume: null,
  repeat_weekdays: '[0,1,2,3,4,5,6]', repeat_start_date: null, repeat_end_date: null,
})

test('같은 분 예약 둘 — 하나만 나가고 하나는 미뤄진다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0

  await 이번분예약돌기(db, [예약(41), 예약(42)])

  const 재생지시 = 쏜것.filter(x => x.e === 'prayer_play')
  assert.equal(재생지시.length, 1,
    `같은 분 예약 둘이 **둘 다** 재생 지시를 냈다(${재생지시.length}건) — 홀에서는 앞 소리가 끊긴다`)
  assert.equal(deferred.size, 1,
    '두 번째가 안 미뤄졌다 — 카운터가 재생 종료 전에 걷혀서 다음 예약이 못 본다')
  assert.equal(적힌이력.filter(r => r.success === 1).length, 1,
    '겹쳤는데 이력에 성공이 둘 적혔다 — 거짓 성공(CC-003 계열)')
})

test('**미룬 것은 버리지 않는다** — 다음 tick 이 다시 본다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  await 이번분예약돌기(db, [예약(41), 예약(42)])
  const [키] = [...deferred.keys()]
  assert.ok(키, '미룬 예약이 대기 목록에 안 들어갔다 — 그대로 사라진다')
  assert.equal(deferred.get(키).schedule.id, 42, '미룬 것이 두 번째 예약이 아니다')
})

// **차임은 양방향으로 본다** — 한쪽만 쓰면 구현이 반대편을 밟는다.
// 실제로 밟았다: 처음엔 `[음원, 차임]` 만 검사했고, 그 사이 `[차임, 음원]` 에서
// **차임이 뒤 예약을 미루는** 회귀가 들어갔다(Codex 재검수 2026-09-11).
// `audit-loop/SKILL.md` 의 "라. 경계값·시간 수정의 RED 는 쌍으로" 가 바로 이것이다.
test('[음원, 차임] — 차임은 앞서 나간 것이 있어도 그대로 울린다', async () => {
  // td09 §3-B 규칙 5. 차임까지 미루면 **안내 앞에 붙는 종소리가 1분 뒤에 난다.**
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  await 이번분예약돌기(db, [예약(41), 예약(43, 'chime')])
  assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1,
    '차임이 미뤄졌다 — 안내 앞의 종소리가 1분 뒤에 난다')
  assert.equal(deferred.size, 0, '차임을 대기 목록에 넣었다')
})

test('[차임, 음원] — **차임이 먼저 울려도 뒤 예약을 막지 않는다**', async () => {
  // 차임은 공존이 명세다. 공존이 명세인 것이 남을 막으면 앞뒤가 안 맞는다 —
  // 차임 하나 때문에 그 분의 안내 방송이 통째로 1분 늦는다.
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  await 이번분예약돌기(db, [예약(43, 'chime'), 예약(41)])
  assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1, '차임이 안 울렸다')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '차임이 먼저 울렸다고 뒤 음원 예약이 미뤄졌다 — 차임은 남을 막지 않는다')
  assert.equal(deferred.size, 0, '차임 뒤의 예약을 대기 목록에 넣었다')
})

test('[차임, 음원, 음원] — 차임은 안 세고, 음원 둘 중 하나만 나간다', async () => {
  // 차임이 셈에서 빠지는 것이 "그 분에 아무거나 다 나간다" 로 새면 안 된다.
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  await 이번분예약돌기(db, [예약(43, 'chime'), 예약(41), 예약(42)])
  assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1, '차임이 안 울렸다')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '차임을 안 세는 것이 음원 겹침까지 풀어 줬다')
  assert.equal(deferred.size, 1, '두 번째 음원이 안 미뤄졌다')
})

// **한 tick 은 하나다 — 미룬 것을 내보낸 tick 도 마찬가지다** (Codex R6 검수 2026-09-11).
//
// `tick` 은 `processDeferred` 를 먼저 돌고 그 다음 `이번분예약돌기` 를 부른다. 그런데
// `앞서나감` 은 `이번분예약돌기` 안에서 **false 로 새로 시작**했다. 그래서 미뤄 둔 음원이
// 방금 나갔는데도 이번 분의 새 예약이 그 위에 겹쳤다 — 어제 고친 것과 **같은 겹침**이
// 경로만 바꿔 그대로 남아 있었다.
test('미뤄 둔 예약을 내보낸 tick 에서는 새 예약이 겹치지 않는다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0

  // 41·42 를 같은 분에 넣어 42 를 미뤄 둔다.
  await 이번분예약돌기(db, [예약(41), 예약(42)])
  assert.equal(deferred.size, 1, '준비 실패 — 두 번째가 안 미뤄졌다')

  // 다음 tick: 미룬 42 가 나가고, 그 tick 에 새 예약 44 도 예정돼 있다.
  쏜것.length = 0
  const 미룬것나감 = await processDeferred(db)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1, '미룬 예약이 안 나갔다')
  assert.equal(미룬것나감, true,
    'processDeferred 가 "내가 발사했다" 를 안 알려 준다 — 뒤따르는 예약이 그것을 못 본다')

  await 이번분예약돌기(db, [예약(44)], 미룬것나감)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '미룬 예약이 방금 나갔는데 새 예약이 그 위에 겹쳤다')
  assert.equal(deferred.size, 1, '새 예약이 안 미뤄졌다')
})

test('미룬 것이 없으면 그 tick 은 평소대로다 — 과하게 막지 않는다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  const 미룬것나감 = await processDeferred(db)
  assert.equal(미룬것나감, false, '아무것도 안 나갔는데 나갔다고 한다 — 모든 예약이 1분씩 늦어진다')
  await 이번분예약돌기(db, [예약(41)], 미룬것나감)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1, '혼자인데 안 나갔다')
})

// ── 미룸 경로가 발사 경로와 같은 규칙을 쓰는가 (Codex R7 검수 2026-09-11) ────
//
// `deferOrFire` 는 **이 분에 자동방송이 예정됐나**(`autoDueThisMinute`)를 보는데
// `processDeferred` 는 `broadcastInProgress` 만 봤다. tick 은 미룬 것을 내보낸 **뒤에**
// 자동방송을 발사하므로, 안 보면 둘이 같은 tick 에 연달아 나간다.
// **같은 규칙이 두 곳에 있고 한쪽만 고쳐진 모양**이다(FP-0005).
test('이 분에 자동방송이 있으면 미룬 예약도 안 내보낸다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42)])
  assert.equal(deferred.size, 1, '준비 실패')

  // 지금 이 분에 아침 방송이 예정돼 있다고 둔다(켜짐 · 시각 일치 · 오늘 미발동).
  const 지금 = new Date()
  const HHMM = String(지금.getHours()).padStart(2, '0') + ':' + String(지금.getMinutes()).padStart(2, '0')
  설정.set('morning_enabled', 'true')
  설정.set('morning_time', HHMM)

  쏜것.length = 0
  const 나감 = await processDeferred(db)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 0,
    '이 분에 자동방송이 예정됐는데 미룬 예약을 내보냈다 — 둘이 같은 tick 에 연달아 나간다')
  assert.equal(나감, false, '안 내보냈는데 내보냈다고 한다')
  assert.equal(deferred.size, 1, '못 내보낸 예약을 대기 목록에서 지웠다 — 그대로 사라진다')
  설정.clear()
})

// `이번분예약돌기` 와 같은 규칙: 차임은 공존이 명세라 **셈에 안 들고, 남의 차례도 안 먹는다.**
test('미룬 차임은 tick 을 소비하지 않는다 — 뒤 음원이 같은 tick 에 나간다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  // 미룬 예약 둘을 만든 뒤, 앞의 것이 차임으로 바뀐 상황(사람이 유형을 고칠 수 있다).
  await 이번분예약돌기(db, [예약(41), 예약(42), 예약(43)])
  assert.equal(deferred.size, 2, '준비 실패')
  유형.set(42, 'chime')

  쏜것.length = 0
  const 나감 = await processDeferred(db)
  assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1, '미룬 차임이 안 울렸다')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '차임이 tick 을 먹어 버려 뒤 음원이 1분 더 기다린다 — 공존이 명세인 것이 남의 차례를 먹으면 안 된다')
  assert.equal(나감, true, '비차임을 내보냈는데 안 내보냈다고 한다')
  assert.equal(deferred.size, 0, '둘 다 나갔는데 대기 목록에 남았다')
  유형.clear()
})

// **미룸 경로의 차임 규칙을 발사 경로와 맞춘다** (Codex R8 검수 2026-09-11).
//
// R7 을 고칠 때 `[차임, 음원]` 한 방향만 검사했다. 반대 순서와 "진행 중일 때의 차임" 은
// 여전히 발사 경로와 규칙이 달랐다 — **또 한쪽만 본 것이다.**
test('[음원, 차임] 미룸 — 비차임을 내보낸 뒤에도 차임은 같은 tick 에 울린다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42), 예약(43)])
  assert.equal(deferred.size, 2, '준비 실패')
  유형.set(43, 'chime')          // 뒤의 것이 차임

  쏜것.length = 0
  const 나감 = await processDeferred(db)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1, '미룬 음원이 안 나갔다')
  assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1,
    '비차임을 내보냈다고 뒤 차임까지 다음 분으로 밀었다 — 발사 경로는 그러지 않는다')
  assert.equal(나감, true)
  assert.equal(deferred.size, 0, '둘 다 나갔는데 대기 목록에 남았다')
  유형.clear()
})

test('미룬 비차임은 한 tick 에 하나뿐이다 — 차임을 허용해도 그 제한은 그대로다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42), 예약(43)])
  assert.equal(deferred.size, 2, '준비 실패')   // 42·43 둘 다 음원

  쏜것.length = 0
  await processDeferred(db)
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '미룬 음원이 한 tick 에 둘 나갔다 — 해제 순간 겹침이 재현된다(레드 검증 F3)')
  assert.equal(deferred.size, 1, '남은 음원이 대기 목록에서 사라졌다')
})

test('방송 진행 중이어도 미룬 차임은 나간다 — 발사 경로와 같은 규칙', async () => {
  // `deferOrFire` 는 차임을 `broadcastInProgress` 검사에서 뺀다. 미룸 경로만 안 뺐다.
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42)])
  assert.equal(deferred.size, 1, '준비 실패')
  유형.set(42, 'chime')

  // 방송이 나가는 중인 상태를 만든다(예약 나감 표시를 세워 둔다).
  const 걷기 = 예약나감표시()
  try {
    쏜것.length = 0
    await processDeferred(db)
    assert.equal(쏜것.filter(x => x.e === 'chime_play').length, 1,
      '방송 중이라고 미룬 차임까지 막았다 — 차임은 공존이 명세다')
  } finally { 걷기() }
  유형.clear()
})

test('방송 진행 중이면 미룬 **음원**은 그대로 기다린다 — 그 제한은 살아 있다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42)])
  assert.equal(deferred.size, 1, '준비 실패')

  const 걷기 = 예약나감표시()
  try {
    쏜것.length = 0
    await processDeferred(db)
    assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 0,
      '방송이 나가는 중인데 미룬 음원을 내보냈다 — 겹친다')
    assert.equal(deferred.size, 1, '못 나간 예약이 대기 목록에서 사라졌다')
  } finally { 걷기() }
})

// **미루기는 "다음 tick 이 다시 본다" 는 약속 위에 선다. 23:59 에는 그 약속이 없다.**
// (Codex R9 검수 2026-09-11) 다음 tick 은 00:00 이고, 거기서 날 넘김 처리(레드 검증 F2)가
// 그 예약을 **발사하지 않고 실패로 적고 버린다.** 그래서 그 분에만 한 건 제한을 안 건다 —
// 내 변경 이전 동작으로 되돌리는 것이다(전에는 23:59 에도 둘 다 나갔다).
test('23:59 — 미룰 수 없는 분에는 겹쳐서라도 내보낸다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42)], false, '23:59')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 2,
    '23:59 에 미뤘다 — 다음 tick(00:00)은 날 넘김으로 버리므로 그 방송은 영영 안 나간다')
  assert.equal(deferred.size, 0, '23:59 예약이 대기 목록에 남았다 — 자정에 버려진다')
})

test('23:59 미룸 경로 — 여기서도 겹쳐서라도 내보낸다', async () => {
  // 23:59 예외를 `이번분예약돌기` 에만 넣었더니 미룸 경로가 그대로 하나만 내보냈다.
  // **같은 규칙이 두 경로에 있는데 한쪽만 고친 것이 이 함수 쌍에서만 네 번째다**(FP-0005).
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42), 예약(43)], false, '23:58')
  assert.equal(deferred.size, 2, '준비 실패')

  쏜것.length = 0
  await processDeferred(db, '23:59')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 2,
    '23:59 미룸 경로가 하나만 내보냈다 — 남은 것은 자정에 폐기된다')
  assert.equal(deferred.size, 0, '23:59 인데 대기 목록에 남겼다 — 자정에 버려진다')
})

test('23:58 미룸 경로 — 평소 분에는 한 건 제한이 그대로다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42), 예약(43)], false, '23:58')
  쏜것.length = 0
  await processDeferred(db, '23:58')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '평소 분인데 미룬 것이 둘 다 나갔다 — 해제 순간 겹침이 재현된다')
  assert.equal(deferred.size, 1, '남은 것이 대기 목록에서 사라졌다')
})

test('23:58 — 평소 분에는 한 건 제한이 그대로다', async () => {
  // 반대편을 같이 쓴다. 한쪽만 쓰면 구현이 "아무 때나 겹쳐도 된다" 로 새어도 안 잡힌다.
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0; 설정.clear(); 유형.clear()
  await 이번분예약돌기(db, [예약(41), 예약(42)], false, '23:58')
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1,
    '평소 분인데 둘 다 나갔다 — 겹침 방지가 통째로 풀렸다')
  assert.equal(deferred.size, 1, '두 번째가 안 미뤄졌다')
})

test('하나뿐이면 그대로 나간다 — 미루기가 과하게 걸리지 않는다', async () => {
  deferred.clear(); 쏜것.length = 0; 적힌이력.length = 0
  await 이번분예약돌기(db, [예약(41)])
  assert.equal(쏜것.filter(x => x.e === 'prayer_play').length, 1, '혼자인데 안 나갔다')
  assert.equal(deferred.size, 0, '혼자인데 미뤄졌다 — 모든 예약이 1분씩 늦어진다')
})
