// 서버가 쏘는 SSE 이벤트를 화면이 실제로 구독하는가 (P-45, 2026-09-08)
//
// 왜 이 파일이 있나:
//   2026-09-08 검수에서 **`mic_live` 가 태어날 때부터 죽어 있던 것**을 찾았다.
//   서버는 쏘고(`micLive.js:22,27` → `events.js:45`) 화면은 기다리는데
//   (`InstantBroadcast.jsx:44-48` 이 `carecast:mic-live` 를 듣는다)
//   **그 사이를 잇는 SSE 구독이 한 줄도 없었다.**
//   그래서 다른 기기가 마이크 방송을 켜도 PC 쉬운 화면에 "다른 기기에서 방송 중"이
//   영영 안 떴다 — **서버는 알고(예약을 미룬다) 사람은 몰랐다.**
//
//   더 나쁜 것은 **아무 빨간불도 안 켜졌다는 점**이다. `useScheduledBroadcast.js` 안에
//   `mic_live` 를 처리하는 분기가 **있었다.** 문자열이 있으니 grep 은 통과하는데
//   그 분기에 이벤트가 도착할 길이 없었다. 도달 불가한 코드가 배선을 대신 증언한 것이다.
//
// 그래서 이 테스트는 **문자열 존재가 아니라 구독 경로**를 본다.
// 구독 경로는 이 저장소에 셋이다:
//   ① `src/lib/api.js` 의 `initSSE` — `es.addEventListener('<이름>', handle('...'))`
//   ② 컴포넌트가 직접 — `MusicPlayer.jsx` 등의 `es.addEventListener('<이름>', ...)`
//   ③ 지역 헬퍼로 감싼 것 — `MonitorPage.jsx:99` 의 `on('<이름>', fn)`
//      (그 `on` 은 `es.addEventListener` 를 JSON 파싱과 함께 감싼 것이다)
// 셋 중 어디에도 없으면 그 이벤트는 **아무도 안 듣는다.**
//
// ③ 을 처음에 빠뜨려 `chime_play` 가 거짓 양성으로 걸렸다(2026-09-08). 가드가 오탐을 내면
// 사람이 그 가드를 무시하기 시작한다(헌장 §M11) — 새 구독 관용구가 생기면 여기 더할 것.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

/** 서버가 실제로 쏘는 이벤트 이름 — `broadcastSSE('이름'` 를 소스에서 긁는다. */
function serverEvents() {
  const names = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') walk(p); continue }
      if (!/\.(js|cjs)$/.test(e.name)) continue
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/broadcastSSE\(\s*'([a-z_]+)'/g)) names.add(m[1])
    }
  }
  walk(path.join(ROOT, 'server'))
  return [...names].sort()
}

/** 화면이 구독하는 이벤트 이름 — 두 경로를 모두 훑는다. */
function clientSubscriptions() {
  const names = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(js|jsx)$/.test(e.name)) continue
      const src = fs.readFileSync(p, 'utf8')
      // 주석 처리된 구독은 세지 않는다 — `// es.addEventListener('chime_play', …)` 같은 것.
      // 살아 있는 구독만 세야 "아무도 안 듣는다"를 정직하게 말할 수 있다.
      for (const line of src.split('\n')) {
        if (/^\s*\/\//.test(line)) continue
        for (const m of line.matchAll(/addEventListener\(\s*'([a-z_]+)'/g)) names.add(m[1])
        // ③ 지역 헬퍼 — `on('이름', fn)`. 정의부(`const on = (name, fn) => es.addEventListener(name, …)`)는
        // 인자가 변수라 위 정규식에 안 걸리므로 호출부를 따로 센다.
        for (const m of line.matchAll(/(?:^|[^\w.])on\(\s*'([a-z_]+)'/g)) names.add(m[1])
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  return names
}

// 서버가 쏘지만 **일부러** 아무도 안 듣는 것. 새로 넣을 때는 왜인지 여기 적는다.
const 구독하지_않기로_한_것 = {
  now_playing: '아무도 안 듣는다 — P-52 로 등록만 했다(2026-09-08). 무엇이 들어야 하는지가 '
             + '설계 결정이고 P-46(표시용 상태와 판정용 상태가 같은 변수)과 얽혀 있다. '
             + '고치기로 하면 이 줄을 지운다.',
}

test('서버가 쏘는 SSE 이벤트는 화면 어딘가가 구독한다 — 아니면 아무 일도 안 일어난다', () => {
  const emitted = serverEvents()
  const subscribed = clientSubscriptions()

  // 긍정 앵커 — 이 테스트가 실제로 무언가를 보고 있는가.
  // 이게 없으면 정규식이 아무것도 못 잡아도 초록이 된다(CLAUDE.md "조용하게 죽는다").
  assert.ok(emitted.length >= 20,
    `서버 이벤트를 ${emitted.length}개밖에 못 찾았다 — broadcastSSE 표기가 바뀌었는지 볼 것`)
  // `subscribed` 개수만 세면 DOM 이벤트(`ended`·`click`·`keydown`…)만으로도 채워져 앵커가
  // 얕아진다(2026-09-08 독립 검수 지적). **SSE 인 것이 확실한 이름 셋**을 직접 짚는다.
  assert.ok(subscribed.size >= 15,
    `구독을 ${subscribed.size}개밖에 못 찾았다 — addEventListener 표기가 바뀌었는지 볼 것`)
  for (const anchor of ['scheduled_broadcast', 'bgm_start', 'broadcast_started']) {
    assert.ok(emitted.includes(anchor) && subscribed.has(anchor),
      `${anchor} 를 양쪽에서 못 찾았다 — 이 테스트의 정규식이 고장 났거나 배선이 통째로 빠졌다`)
  }

  const 안_들리는_것 = emitted.filter((n) => !subscribed.has(n) && !구독하지_않기로_한_것[n])

  assert.deepEqual(안_들리는_것, [],
    `서버가 쏘는데 아무도 안 듣는 이벤트: ${안_들리는_것.join(', ')}\n`
    + '  → 화면에 구독을 더하거나, 일부러 안 듣는 것이면 이 파일의 '
    + '`구독하지_않기로_한_것` 에 이유와 함께 적을 것.\n'
    + '  (mic_live 가 이렇게 태어날 때부터 죽어 있었다 — P-45)')
})

test('일부러 안 듣기로 한 것은 이유가 적혀 있다', () => {
  for (const [name, why] of Object.entries(구독하지_않기로_한_것)) {
    assert.ok(why && why.length > 20, `${name}: 이유가 없거나 너무 짧다`)
  }
})

// `initSSE` 는 `addEventListener('<SSE 이름>', handle('<내부 type>'))` 형태라 **두 이름이 갈릴 수 있다.**
// 갈리면 구독 줄은 멀쩡한데 소비 분기(`useScheduledBroadcast.js` 의 `if (type === …)`)에
// 아무것도 안 온다 — **P-45 와 정확히 같은 종류의 죽음**이고, 위 테스트는 그것을 못 본다
// (구독 줄이 있다는 것만 보므로). 2026-09-08 독립 검수 지적.
const 이름이_갈려도_되는_것 = {
  scheduled_broadcast: 'handle(\'scheduled\') — 소비처가 예약·자동방송 TTS 를 한 분기로 받는다. '
                     + '이 매핑은 useScheduledBroadcast.js 의 `type === \'scheduled\'` 와 짝이다.',
}

test('initSSE 의 SSE 이름과 내부 type 이 갈리지 않는다 — 갈리면 소비 분기에 아무것도 안 온다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  const pairs = [...api.matchAll(/addEventListener\(\s*'([a-z_]+)'\s*,\s*handle\(\s*'([a-z_]+)'\s*\)/g)]

  assert.ok(pairs.length >= 15,
    `initSSE 에서 짝을 ${pairs.length}개밖에 못 찾았다 — 표기가 바뀌었는지 볼 것`)

  const 갈린_것 = pairs
    .filter(([, evt, type]) => evt !== type && !이름이_갈려도_되는_것[evt])
    .map(([, evt, type]) => `${evt} → handle('${type}')`)

  assert.deepEqual(갈린_것, [],
    `SSE 이름과 내부 type 이 다르다: ${갈린_것.join(', ')}\n`
    + '  → 이름을 맞추거나, 일부러 갈라야 하면 이 파일의 `이름이_갈려도_되는_것` 에 '
    + '소비 분기가 어디인지와 함께 적을 것.')
})
