// **`POST /api/mic/chime` 이 사실을 돌려준다** (V③ UI-0915-R1·R2 지적, 2026-09-15).
//
// ── 무엇이 틀렸나 ────────────────────────────────────────────────────────────
// 이 라우트는 `playChime` 을 **쏘고 곧바로 `{ok:true}`** 를 돌려줬다. 두 가지가 딸려 왔다:
//
//  ① **연타 방지가 사실상 없었다.** 화면은 이 응답으로 잠금을 푸는데, 응답이 재생 시작
//     전에 나가므로 잠기는 시간이 **HTTP 왕복(수 ms)** 뿐이다. 전관 스피커에서 겹쳐 울린다.
//  ② **재생이 실패해도 화면은 성공으로 본다.** 콜백은 이력에만 적고 응답은 이미 나갔다.
//
// ── 고치다가 한 번 더 깨뜨렸다 (R2) ─────────────────────────────────────────
// 첫 수정은 **모든 호출자를 기다리게** 만들었다. 그래서 「누르고 말하기」가 깨졌다 —
// 그쪽은 차임을 쏘고 **2.6초 뒤** 목소리를 보내기 시작하는데(접수 응답이 바로 온다는
// 전제로 맞춘 값), 응답이 재생 끝까지 늦어지면 그 2.6초가 **차임 뒤에** 붙어
// 직원의 첫 마디가 안 나간다.
//
// 그래서 **기다림은 `?wait=1` 로 고르고, 잠금은 재생에 매인다.**
//
// ── 이 시험은 **돌린다** ─────────────────────────────────────────────────────
// 앞 판은 소스를 글자로 읽었고, 검수관이 **`playChime` 호출을 통째로 지워도 5/5 통과**
// 하는 것을 보였다. 그래서 라우트를 실제로 띄우고 재생기를 대역으로 바꿔 **응답과
// 발사 횟수**를 값으로 본다.
'use strict'

process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_chimeroute_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')
const Module = require('node:module')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

// ── 재생기를 **대역으로 바꾼다** — 실제 스피커를 울리지 않는다 ────────────────────
// `CARECAST_NO_HARDWARE` 로도 소리는 막히지만, 그러면 `playChime` 이 **바로 성공**을
// 돌려줘서 「완료를 기다리는가」를 볼 수 없다. 여기서는 **내가 완료 시점을 쥐고** 있어야 한다.
const 발사 = []
let 끝내기 = null
const 진짜Resolve = Module._resolveFilename
const 차임경로 = require.resolve('../services/chimePlayer')
// **대역이 제품보다 부족하면 안 된다**(V③ R6 에서 이미 한 번 겪은 모양).
// 라우트가 `CHIME_TIMEOUT_MS`·`CHIME_MAX_STAGES` 로 잠금 상한을 계산하므로, 그 둘을
// 빠뜨리면 `NaN` 이 되어 `setTimeout` 이 **즉시** 터진다 — 모든 시험이 이유 없이 깨진다.
// 값은 **진짜 모듈에서 가져온다.** 여기서 숫자를 지어내면 그 숫자를 시험하게 된다.
const 진짜차임 = require('../services/chimePlayer')
require.cache[차임경로] = {
  id: 차임경로, filename: 차임경로, loaded: true, exports: {
    playChime: (type, vol, onDone) => { 발사.push(type); 끝내기 = onDone },
    CHIME_TIMEOUT_MS: 진짜차임.CHIME_TIMEOUT_MS,
    CHIME_MAX_STAGES: 진짜차임.CHIME_MAX_STAGES,
  },
}
Module._resolveFilename = 진짜Resolve

const micRoutes = require('../routes/mic')

let app
test.before(async () => { initDB(); app = await startTestApp({ '/api/mic': micRoutes }) })
test.after(async () => { await app.close() })

const 치기 = (q) => fetch(`${app.baseUrl}/api/mic/chime${q}`, { method: 'POST' })
const 비우기 = () => { 발사.length = 0; 끝내기 = null }

test('긍정 앵커 — 대역이 실제로 끼워졌다', async () => {
  비우기()
  const r = await 치기('?type=general')
  assert.equal(r.status, 200, '접수 응답이 안 온다')
  assert.deepEqual(발사, ['general'], '재생기를 안 불렀다 — 대역이 안 끼워졌거나 발사가 없다')
  끝내기?.(true)
})

test('**안 기다리는 쪽은 바로 돌아온다** — 마이크의 2.6초 타이밍을 안 건드린다', async () => {
  비우기()
  const t = Date.now()
  const r = await 치기('?type=general')          // `wait` 없음 = 예전 계약
  const 걸린 = Date.now() - t
  assert.equal(r.status, 200)
  assert.ok(걸린 < 1000,
    `접수 응답이 ${걸린}ms 걸렸다 — 재생을 기다리면 「누르고 말하기」의 첫 마디가 잘린다`)
  assert.equal(끝내기 === null, false, '재생이 시작도 안 됐다')
  끝내기?.(true)
})

test('**기다리는 쪽은 완료까지 안 돌아온다** — 접수로 성공이라 하지 않는다', async () => {
  비우기()
  let 답했나 = false
  const p = 치기('?type=general&wait=1').then(r => { 답했나 = true; return r })
  await new Promise(r => setTimeout(r, 120))
  assert.equal(답했나, false, '재생이 안 끝났는데 벌써 답했다 — 접수를 성공으로 쓰고 있다')
  끝내기(true)
  const r = await p
  assert.equal(r.status, 200, '재생이 끝났는데 성공이라 안 한다')
})

test('**실패는 실패라고 한다** — 조용히 삼키면 안 난 줄 모른다', async () => {
  비우기()
  const p = 치기('?type=general&wait=1')
  await new Promise(r => setTimeout(r, 50))
  끝내기(false)                                   // 재생기가 실패를 알린다
  const r = await p
  assert.equal(r.status, 500, '재생에 실패했는데 성공이라 답한다')
  const j = await r.json()
  assert.match(j.error || '', /재생하지 못했습니다/, '무엇이 잘못됐는지 안 말한다')
})

test('**도는 중에 들어온 요청은 409** — 다른 PC·다른 창도 막는다', async () => {
  비우기()
  const p = 치기('?type=general&wait=1')
  await new Promise(r => setTimeout(r, 50))
  const 둘째 = await 치기('?type=end')            // 도는 중에 다른 기기가 누른다
  assert.equal(둘째.status, 409, '도는 중인데 또 받는다 — 차임이 겹쳐 울린다(페르소나 P3)')
  assert.deepEqual(발사, ['general'], '둘째 요청이 재생기까지 갔다')
  끝내기(true)
  await p
})

test('**끝나면 다시 울릴 수 있다** — 잠금이 끼면 영영 안 울린다', async () => {
  비우기()
  const p = 치기('?type=general&wait=1')
  await new Promise(r => setTimeout(r, 50))
  끝내기(true)
  await p
  await new Promise(r => setTimeout(r, 30))       // finally 가 도는 틈
  비우기()
  const r = await 치기('?type=end')
  assert.equal(r.status, 200,
    '앞 차임이 끝났는데 아직 잠겨 있다 — 한 번 끼면 그 뒤로 차임이 영영 안 울린다')
  assert.deepEqual(발사, ['end'], '두 번째 차임이 재생기까지 안 갔다')
  끝내기?.(true)
})

// ── 아래 둘은 **돌려서 못 보는 것**이라 소스로 본다 ──────────────────────────────
// 상한은 12초·40초라 시험에서 기다리면 그만큼 멈춘다. 시계를 갈아 끼우는 장치를 새로
// 만드는 것보다, **그 값이 있다는 것과 관계**를 보는 편이 싸다(M2 복잡성 예산).
const 코드 = fs.readFileSync(path.join(__dirname, '..', 'routes', 'mic.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// 두 상한을 **소스에서 계산해 낸다.** `차임잠금상한ms` 는 이제 숫자가 아니라 식이다
// (`CHIME_TIMEOUT_MS * CHIME_MAX_STAGES + 10_000`) — 숫자를 베끼지 말라는 뜻이라 그렇게 뒀다.
const 상한읽기 = () => {
  const 식 = (코드.match(/const 차임잠금상한ms = ([^\n]+)/) || [])[1]
  assert.ok(식, '잠금 상한이 없다 — 콜백이 안 오면 차임이 영영 안 울린다')
  const { CHIME_TIMEOUT_MS, CHIME_MAX_STAGES } = require('../services/chimePlayer')
  const 잠금 = Function('CHIME_TIMEOUT_MS', 'CHIME_MAX_STAGES', `return (${식})`)(
    CHIME_TIMEOUT_MS, CHIME_MAX_STAGES)
  const 기다림 = Number((코드.match(/차임기다림상한ms = ([\d_]+)/) || [])[1]?.replace(/_/g, ''))
  return { 잠금, 기다림, 재생단계: CHIME_TIMEOUT_MS, 단계수: CHIME_MAX_STAGES }
}

test('**단계 수가 재생기의 실제 갈래와 맞는다** — 같은 상수로 자기를 증명하지 않는다', () => {
  // ── 앞 판은 **자기 참조**였다 (V③ UI-0915-R4 지적) ─────────────────────────────
  // `잠금 > CHIME_TIMEOUT_MS * CHIME_MAX_STAGES` 를 봤는데, 잠금도 **같은 식**으로
  // 계산한다. 그러니 `CHIME_MAX_STAGES` 를 1 로 잘못 둬도 `40000 > 30000` 이라 통과한다.
  // **정답을 구현에서 가져오면 구현이 틀려도 초록이다.**
  //
  // 그래서 **재생기 소스에서 단계 수를 따로 센다** — `watchChild` 에 붙은 **이름표가 몇 가지**냐.
  // 이름표 하나가 곧 상한이 걸리는 프로세스 하나다(지금은 「합성」·「재생」 둘).
  //
  // **함수 하나만 보면 안 된다.** 처음에 `playViaFile` 안의 호출만 셌더니 1 이 나왔다 —
  // 둘째 단계(「재생」)는 그 함수가 부르는 **`playWav` 안에** 있다. 그래서 단계 수를 1 로
  // 잘못 둔 변이가 그대로 통과했다. 파일 전체의 이름표를 센다.
  const 재생기 = fs.readFileSync(path.join(__dirname, '..', 'services', 'chimePlayer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(재생기, /function playViaFile/, '긍정 앵커 — 파일 경유 재생(윈도우 외)을 못 찾았다')
  const 이름표 = [...new Set([...재생기.matchAll(/watchChild\('([^']+)'/g)].map(m => m[1]))]
  const 센것 = 이름표.length
  assert.ok(센것 >= 1, '재생기가 자식 프로세스를 안 돌린다 — 이 시험의 전제가 깨졌다')

  const { 단계수 } = 상한읽기()
  assert.ok(단계수 >= 센것,
    `CHIME_MAX_STAGES 가 ${단계수} 인데 파일 경유 재생은 watchChild 를 ${센것} 번 부른다 — `
    + `단계를 덜 세면 잠금이 재생보다 먼저 풀려 다음 차임과 겹친다(V③ R3 에서 실제로 그랬다). 이름표: ${이름표.join('·')}`)
})

// ── **상한이 지나면 잠금을 푼다 — 일부러 그렇게 둔다** (V③ UI-0915-R4 ①에 대한 답) ──
// 검수관이 *"종료를 확인하지 못하면 새 재생을 허용하지 않는 복구 상태로 전환하라"* 고 했다.
// **그렇게 안 한다.** 이 저장소가 같은 자리에서 반대로 정해 뒀다
// (`services/duplicateBroadcast.js` 머리말):
//   *"이 장치의 고장은 열쇠가 끼는 것이다 … 막으려던 것(두 번 나감)보다 나쁜 결과다
//     (무음은 이 저장소에서 가장 비싼 실패다). 그래서 최대잠금ms 상한을 둔다."*
//
// `kill()` 이 실패하고 `close` 도 안 오는 상황은 드물고, 그때 **겹쳐 울리는 것**과
// **그 뒤로 차임이 영영 안 나가는 것** 중에 후자가 이 현장에서 더 비싸다.
// **남은 위험은 그대로 있다** — 없앤 척하지 않고 여기 적어 둔다.
test('**상한이 지나면 잠금을 푼다** — 끼는 쪽이 겹치는 쪽보다 비싸다(의도된 선택)', () => {
  const i = 코드.indexOf("router.post('/chime'")
  const 몸통 = 코드.slice(i, 코드.indexOf("router.post('/stream'", i))
  assert.match(몸통, /setTimeout\(\(\) => 끝\(null\), 차임잠금상한ms\)/,
    '상한이 지나도 잠금을 안 푼다 — 콜백이 안 오는 날 차임이 영영 안 나간다. '
    + '바꾸려면 duplicateBroadcast 머리말의 판단부터 뒤집어야 한다')
  // 같은 판단이 그 파일에 살아 있는지도 본다 — 한쪽만 바뀌면 두 장치가 갈린다.
  const 중복 = fs.readFileSync(path.join(__dirname, '..', 'services', 'duplicateBroadcast.js'), 'utf8')
  assert.match(중복, /상한이 지나면 잠금은 없는 것으로 본다/,
    '중복방지의 판단이 바뀌었다 — 차임 쪽도 같이 다시 정해야 한다')
})

test('**잠금 상한이 재생 최악보다 길다** — 먼저 풀면 다음 차임과 겹친다', () => {
  const { 잠금, 재생단계, 단계수 } = 상한읽기()
  const 최악 = 재생단계 * 단계수
  assert.ok(잠금 > 최악,
    `잠금 상한 ${잠금}ms 가 재생 최악 ${최악}ms(${재생단계}×${단계수}단계)보다 짧다 — `
    + '재생이 아직 도는데 잠금이 풀려 다음 차임과 겹친다')
  // **숫자를 손으로 적지 않았는지**도 본다 — 적으면 재생기가 바뀔 때 안 따라간다.
  assert.match(코드, /차임잠금상한ms = CHIME_TIMEOUT_MS \* CHIME_MAX_STAGES/,
    '잠금 상한을 숫자로 박았다 — 재생기 상한이 바뀌면 조용히 어긋난다')
})

test('**기다림 상한과 잠금 상한은 다른 것이다** — 응답 때문에 잠금을 일찍 풀면 안 된다', () => {
  const { 잠금: b, 기다림: a } = 상한읽기()
  assert.ok(a && b, '두 상한이 다 있어야 한다')
  assert.notEqual(a, b, '기다림과 잠금이 같은 값이다 — 갈라 둔 뜻이 없어진다')
  assert.ok(a < b, `기다림(${a}ms)이 잠금(${b}ms)보다 길다 — 응답이 잠금보다 오래 매달린다`)
  // 화면 쪽 제한시간이 서버의 기다림보다 **길어야** 504 를 받는다.
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'api.js'), 'utf8')
  // **함수 몸통을 떼어 본다.** 글자 수로 창을 자르면 주석 한 줄에 밀린다(이번 작업에서 네 번 겪었다).
  const i = api.indexOf('export async function fireChime')
  assert.ok(i > 0, '긍정 앵커 — fireChime 창구가 있다')
  let 깊이 = 0, 끝 = -1
  const 여는곳 = api.indexOf('{', i)
  for (let k = 여는곳; k < api.length; k++) {
    if (api[k] === '{') 깊이++
    else if (api[k] === '}') { 깊이--; if (깊이 === 0) { 끝 = k; break } }
  }
  const 창구 = api.slice(여는곳, 끝)
  const c = Number((창구.match(/wait=1`, \{\}, ([\d_]+)\)/) || [])[1]?.replace(/_/g, ''))
  assert.ok(c, '차임 요청에 제한시간을 안 준다 — 기본값(10초)이 서버 기다림보다 짧아 504 를 못 받는다')
  assert.ok(c > a,
    `화면 제한시간 ${c}ms 가 서버 기다림 ${a}ms 보다 짧다 — 브라우저가 먼저 끊어 「확인하지 못했습니다」를 영영 못 본다`)

  // ── **약속이 반드시 끝난다** (V③ UI-0915-R4 ③) ─────────────────────────────
  // `fetchT` 는 머리글을 받는 순간 제한시간을 푼다 — 그 뒤 본문이 멈추면 약속이 영영
  // 안 끝나고, 부르는 쪽의 `finally` 가 안 돌아 **차임 빗장이 영영 안 풀린다.**
  const 울타리 = Number((창구.match(/바깥울타리ms = ([\d_]+)/) || [])[1]?.replace(/_/g, ''))
  assert.ok(울타리,
    '본문이 멈추면 약속이 안 끝난다 — 빗장이 영영 안 풀려 차임 단추가 죽는다')
  assert.ok(울타리 > c,
    `바깥 울타리 ${울타리}ms 가 요청 제한시간 ${c}ms 보다 짧다 — 정상 응답까지 끊어 버린다`)
  assert.match(창구, /Promise\.race/, '울타리를 세워 놓고 안 쓴다')
})
