// SSE(Server-Sent Events) 클라이언트 연결 관리
// 연결된 모든 브라우저에 실시간 방송 이벤트를 전송한다
const clients = new Set()

// 그중 **현장 PC**에서 온 연결. 정시 방송 6회의 소리는 전부 현장 PC 브라우저가 낸다
// (스케줄러·시퀀서는 audioQueue를 부르지 않고 broadcastSSE로 쏘기만 한다). 직원 휴대폰이나
// 원격 PC가 이벤트를 받은 것과 요양원 스피커에서 소리가 난 것은 전혀 다른 일이라 따로 센다.
const localClients = new Set()

// 현장 PC 여부는 **요청이 들어온 주소**로 서버가 직접 판정한다. 쿼리 파라미터로 받으면
// 아무나 자기를 현장 PC라고 주장할 수 있다. 시작 bat이 --app=http://localhost:3001 로
// 열기 때문에 현장 PC의 재생 창은 항상 루프백으로 들어온다.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
function isLocalRequest(req) {
  return LOOPBACK.has(req?.socket?.remoteAddress ?? '')
}

// ── **이 창이 「서버와 같은 기계」에서 열렸나** (현장 지적 2026-09-15) ──────────────
//
// `isLocalRequest` 는 **주소가 loopback 인가**를 본다. 그런데 현장 PC 에서 랜 주소
// (`192.168.0.8:3001`)로 열면 연결이 loopback 으로 안 온다 — 그 기계 자신의 랜 주소로
// 온다. 그래서 **같은 PC 인데 원격으로 판정**되고, 그 창은 소리를 못 낸다(설계대로다).
//
// 그날 실제로 그 상태였다. 그런데 「방송 화면이 없다」 띠는 **원격 창에만** 뜨므로,
// 거기 단추를 달면 **직원 폰에서도 보인다** — 폰에서 눌러 봐야 그 폰의 localhost 라
// 아무 데도 안 닿는다. 사용자 지적: *"이건 원격 pc 고려 안 한 거 아니야?"*
//
// 그래서 **그 기계가 서버와 같은 기계인지**를 서버가 알려 준다. 판정은 간단하다 —
// 연결해 온 주소가 **이 서버 자신의 주소 목록**에 있으면 같은 기계다.
// 못 읽으면 `false` 로 둔다: 단추를 **안 보여주는 쪽**으로 실패한다(쓸모없는 단추를
// 보여 주는 것보다 없는 편이 낫다).
//
// **판정은 밖에서 넣는다.** 이 파일은 아무 모듈도 `require` 하지 않는 순수 전송 계층이라
// (배선도 ③, `dryrun-blocks-browser-sound.test.js` 가 고정한다) 여기서 `os` 를 부를 수 없다.
// `setSoundGate` 와 같은 모양이고, 배선은 `routes/events.js` 가 한다.
// 아무도 안 넣으면 늘 `false` — 단추가 안 보일 뿐 아무것도 안 깨진다.
let 같은기계판정 = () => false
function set같은기계판정(fn) { if (typeof fn === 'function') 같은기계판정 = fn }
function 같은기계인가(req) {
  try { return !!같은기계판정(req) } catch { return false }
}

// ── 소리 담당(대표 창) ─────────────────────────────────────────
//
// 왜 서버가 정하나(2026-08-30): 예전에는 화면이 브라우저 저장공간(localStorage)에 대표
// 표시를 남겨 스스로 정했다. 그런데 **그 공간은 접속 주소마다 분리된다.** 현장 PC 판정은
// 호스트 이름만 보므로(localhost / 127.0.0.1 둘 다 현장으로 인정), 같은 PC에서 두 주소로
// 각각 열면 서로를 못 보고 **둘 다 자기가 담당이라 믿어 같이 재생했다** — 겹쳐 들렸다.
// 개발용 포트(5173)를 함께 띄운 경우도 같은 구조다.
//
// 서버는 이미 어느 연결이 루프백인지 알고 있고(isLocalRequest — **요청 주소로** 판정하므로
// 아무나 주장할 수 없다), 그 목록은 주소가 갈려도 하나다. 여기서 정하면 빈틈이 구조적으로
// 사라진다.
//
// 규칙 둘:
//  · **먼저 붙은 창이 계속 담당.** 새 창이 뺏으면 재생이 창을 옮겨 다니며 소리가 끊긴다.
//  · **탭 id를 보낸 창만 담당이 될 수 있다.** 알려줄 수 없는 상대를 담당으로 세우면
//    아무도 자기가 담당인 줄 모르고 **전부 침묵한다.** 후보가 없으면 담당을 비워 두고,
//    화면은 예전 방식(localStorage)으로 떨어진다 — 겹쳐 들리는 것보다 무음이 훨씬 나쁘다.
const tabIds = new WeakMap()   // res → 그 창이 알려준 탭 id
let ownerRes = null

// ── 담당 창이 아직 살아 있는가 (H15, 2026-09-02) ───────────────
//
// **연결이 살아 있다는 것은 창이 살아 있다는 뜻이 아니다.**
// 개발 PC에서 Vite 프록시는 브라우저가 닫혀도 백엔드 쪽 SSE를 안 끊는다. 크롬을 전부
// 닫고도 localClients가 5로 남는 것을 실측했고(2026-09-02), 서버는 그 유령 중 하나를
// 소리 담당으로 지목했다 — 담당이 세상에 없으니 **어느 창에서도 소리가 안 났다.**
// 현장 PC는 Vite를 안 거치지만, 원격 데스크톱이 죽거나 랜선이 빠지면 같은 일이 난다.
// 즉 약점은 프록시가 아니라 **"담당이 살아 있는지 서버가 확인하지 않는다"**는 것이다.
//
// 그래서 창이 스스로 살아 있음을 알리게 한다(POST /api/events/alive). 소식이 끊긴
// 연결은 담당 후보에서 뺀다. res.write()가 성공하는 것은 근거가 못 된다 — 유령한테
// 쓰는 것도 성공한다. **브라우저가 실제로 돌고 있어야만 보낼 수 있는 신호**여야 한다.
//
// 90초인 이유: 브라우저는 **보이지 않는 창의 타이머를 1분에 한 번까지 눌러 버린다**
// (백그라운드 스로틀링). 10초마다 보내도 창이 가려지면 60초에 한 번만 도착한다.
// 30초로 잡으면 멀쩡히 재생 중인 창을 죽었다고 보고 담당이 옮겨 다니며 소리가 끊긴다 —
// 유령이 90초 더 사는 쪽이 훨씬 싸다.
const ALIVE_TIMEOUT_MS = 90_000
const lastSeen = new Map()     // res → 마지막 생존 신호 시각(ms)

// ── **그 창이 소리를 낼 수 있다고 말했나** (현장 사고 2026-09-15) ────────────────
//
// `lastSeen` 은 창이 **살아 있나**를 답한다. 그것과 **소리를 낼 수 있나**는 다른 질문이다.
// 브라우저가 자동재생을 막으면 창은 멀쩡히 붙어 있고 그림도 그린다 — **소리만 안 난다.**
// 서버 쪽에서 그것을 알 방법이 없어서, 그날 07:50 방송이 아무 소리 없이 지나갔는데
// 이력에는 **성공**으로 남았다.
//
// 그래서 화면이 생존 신호에 그 상태를 실어 보낸다(`?sound=on|off`).
// **적히지 않은 창은 「낼 수 있다」로 본다** — 신호를 보낼 줄 모르는 옛 화면을 「못 낸다」로
// 세면 멀쩡한 방송이 전부 실패로 적힌다. `sawAliveSignal` 폴백과 같은 규칙이고,
// 이 저장소가 지키는 방향이다: **자신 없을 때 멀쩡한 방송을 실패로 적는 쪽이 더 나쁘다.**
const 소리상태 = new Map()     // res → 그 창이 마지막으로 알린 소리 가능 여부

// 이 서버가 **한 번이라도** 생존 신호를 받은 적이 있는가.
//
// 신호를 보낼 줄 모르는 옛 화면만 붙어 있는데 "소식이 없으니 다 죽었다"고 판정하면
// 담당이 아무도 없어 **전부 침묵한다.** 그건 이 시스템에서 가장 나쁜 사고다.
// 그래서 신호를 한 번도 못 받은 동안은 예전 규칙(붙은 순서대로)을 그대로 쓴다.
let sawAliveSignal = false

// 시간은 갈아끼울 수 있게 둔다 — 90초를 실제로 기다리는 테스트는 쓸 수 없다.
const _test = {
  now: () => Date.now(),
  // 생존 신호를 한 번이라도 받으면 판정 규칙이 바뀐다(위 sawAliveSignal). 테스트가
  // 옛 화면만 있는 서버를 다시 만들 수 있어야 그 갈래를 고정할 수 있다.
  reset() { sawAliveSignal = false; lastSeen.clear(); 소리상태.clear() },
}

function 살아있나(res) {
  if (!sawAliveSignal) return true          // 옛 화면만 있는 서버 — 예전 규칙 그대로
  const t = lastSeen.get(res)
  return t != null && _test.now() - t < ALIVE_TIMEOUT_MS
}

/** 지금 소리를 낼 창의 탭 id. 없으면 null */
function soundOwner() {
  return ownerRes ? (tabIds.get(ownerRes) ?? null) : null
}

// **현장 창이 0 이 된 것을 본 횟수.** 줄지 않는다(단조 증가) — 방송이 시작할 때와 끝날 때의
// 값을 견주면 「그동안 한 번이라도 창이 없었나」가 나온다. 시각이 아니라 **사건**을 세므로
// 한 단계 안에서 닫혔다 돌아온 경우도 걸린다(V③ R8).
let 무창사건 = 0
function 무창사건수() { return 무창사건 }
// **소리 담당이 바뀐 횟수.** 창이 여럿일 때 재생하던 창만 닫히는 경우를 잡는다 —
// 그때 `무창사건` 은 안 오른다(남은 창이 있으니). 이것도 줄지 않는다.
let 담당바뀜 = 0
function 담당바뀜수() { return 담당바뀜 }
// 마지막으로 알린 현장 화면 수. 담당이 그대로여도 이 숫자가 바뀌면 알려야 한다
// (담당이 없는 상태에서 창이 하나 붙었다 떨어지는 경우 — 그때도 화면 안내가 바뀌어야 한다).
let lastScreens = -1
// 담당을 다시 고르고, 바뀌었으면 모든 화면에 알린다.
// localClients는 Set이라 **붙은 순서**가 유지된다 — 그 순서가 곧 승계 순서다.
function refreshOwner() {
  const before = soundOwner()
  // 지금 담당이 목록에 있고 아직 살아 있으면 손대지 않는다 — 담당이 옮겨 다니면 소리가 끊긴다
  if (!ownerRes || !localClients.has(ownerRes) || !살아있나(ownerRes)) {
    ownerRes = null
    for (const res of localClients) {
      if (tabIds.get(res) && 살아있나(res)) { ownerRes = res; break }
    }
  }
  const after = soundOwner()
  // ── **현장 화면이 몇 개 살아 있나**를 함께 싣는다 (현장 사고 2026-09-14) ────────
  // 0 이면 이 PC 에서 소리를 낼 창이 하나도 없다는 뜻이다 — 예약 TTS·녹음 음원·BGM·영상은
  // 브라우저가 재생하므로 **그 방송들이 통째로 무음**이 된다. 그날 저녁 마무리 방송이 그랬다.
  // `tabId: null` 로도 짐작할 수는 있지만 그건 "담당을 못 골랐다"이지 "창이 없다"가 아니다 —
  // 짐작을 화면에 심으면 언젠가 갈린다. 세어서 보낸다.
  //
  // **새 이벤트를 안 만든다.** 이 소식이 필요한 시점이 담당이 바뀌는 시점과 사실상 같고,
  // 갓 붙은 창에 초기값을 보내는 자리도 이미 아래에 있다.
  const screens = localAliveCount()
  // ── **창이 없던 순간을 센다** (V③ R8 지적, 2026-09-14) ──────────────────────────
  // 방송이 도는 동안 창이 있었는지를 **경계에서 표본으로** 재면, 한 단계 **안에서** 닫혔다
  // 돌아온 경우를 통째로 놓친다(합성 대기 → 송출 → 종료 대기가 한 단계다).
  // 여기는 **연결이 붙고 떨어질 때마다** 도는 자리다(닫힘은 `res.on('close')` 가 즉시
  // 부른다) — 그래서 **사건을 세면** 그 사이에 무슨 일이 있었는지 알 수 있다.
  // 방송 쪽은 시작과 끝의 값을 견줘 「그동안 한 번이라도 0 이었나」를 판정한다.
  if (screens === 0) 무창사건 += 1
  // ── **담당이 바뀐 것도 센다** (V③ R10 지적, 2026-09-14) ──────────────────────────
  // 창이 **둘** 있으면 소리를 내던 창이 닫혀도 수는 1 로 남는다 — 위 `무창사건` 이 안 오른다.
  // 그런데 **재생은 그 창에서 끊겼다.** 담당이 넘어가도 **진행 중인 소리는 안 이어받는다**
  // (`useScheduledBroadcast` 의 담당 변경 처리는 재생을 물려주지 않는다).
  // 그러므로 방송이 도는 동안 담당이 바뀌었다면 **그 방송은 끊겼다고 봐야 한다.**
  if (after !== before) 담당바뀜 += 1
  if (after !== before || screens !== lastScreens) {
    lastScreens = screens
    // 담당이 아닌 창들도 받아야 한다 — "나는 담당이 아니다"를 알아야 재생을 멈춘다
    broadcastSSE('sound_owner', { tabId: after, siteScreens: screens })
  }
}

/**
 * 창이 "나 살아 있다"고 알려 왔다(POST /api/events/alive).
 * 유령이 담당을 쥐고 있었다면 이 자리에서 산 창으로 넘어간다.
 */
function noteAlive(tabId, 소리켜짐) {
  if (!tabId) return false
  const id = String(tabId)
  let found = false
  for (const res of localClients) {
    if (tabIds.get(res) === id) {
      lastSeen.set(res, _test.now())
      // **소리를 낼 수 있다고 말했나**(현장 사고 2026-09-15).
      // `undefined` 는 "안 알려 준 창"이다 — 옛 화면이 그렇다. 그때는 아무것도 안 적는다.
      // 적지 않은 창은 아래 `소리낼수있나()` 가 **낼 수 있는 쪽으로** 본다.
      if (소리켜짐 !== undefined) 소리상태.set(res, !!소리켜짐)
      found = true
    }
  }
  // 신호를 보낼 줄 아는 화면이 붙어 있다는 사실 자체는, 그 창의 SSE를 아직 못 찾았어도 참이다
  sawAliveSignal = true
  refreshOwner()
  return found
}

/**
 * 창이 닫히면서 스스로 알려 왔다(pagehide → sendBeacon). 유령이 90초를 사는 대신
 * 그 자리에서 사라진다 — 개발 PC에서 창을 여닫을 때 쌓이던 것이 이걸로 없어진다.
 */
function forgetClient(tabId) {
  if (!tabId) return false
  const id = String(tabId)
  let dropped = false
  for (const res of [...localClients]) {
    if (tabIds.get(res) !== id) continue
    clients.delete(res)
    localClients.delete(res)
    lastSeen.delete(res)
    // 끊긴 연결의 소리 상태도 같이 지운다 — 안 지우면 죽은 res 가 Map 에 영원히 남는다.
    소리상태.delete(res)
    dropped = true
    // 유령 연결을 실제로 끊는다 — 프록시가 안 끊어 준 것을 이쪽에서 끊는다
    try { res.end() } catch { /* 이미 끊긴 연결 */ }
  }
  if (dropped) refreshOwner()
  return dropped
}

// 소식이 끊긴 담당을 주기적으로 걷어낸다. 창이 조용히 사라지면(전원 차단·원격 끊김)
// 아무 이벤트도 안 오므로, 시간만이 그것을 알려준다.
function recheckOwner() { refreshOwner() }
const 순찰 = setInterval(recheckOwner, 15_000)
// 서버 종료·테스트 프로세스를 이 타이머가 붙잡고 있으면 안 된다
if (typeof 순찰.unref === 'function') 순찰.unref()

// **소리 이벤트를 막을지 정하는 판단 — 밖에서 넣어 준다** (P-15, 2026-09-11).
//
// 이 파일은 **아무 모듈도 require 하지 않는다**(배선도 ③). 그래서 "지금 드라이런인가" 도
// 스스로 못 본다. 아는 쪽(`routes/events.js` — 이미 두 모듈을 다 안다)이 넣어 준다.
// 안 넣으면 `null` 이라 **예전과 똑같이 다 나간다** — 배선을 빠뜨려도 운영이 안 죽는다.
let _소리막기 = null
function setSoundGate(fn) { _소리막기 = typeof fn === 'function' ? fn : null }

// 새 SSE 클라이언트 등록 및 헤더 설정
// req는 현장 PC 판정용(선택) — 안 넘기면 원격으로 본다(있다고 착각하는 쪽이 더 위험하다)
// tabId는 그 창을 가리키는 이름표일 뿐이다. **현장 여부의 근거로 쓰지 않는다** — 그건
// 여전히 요청 주소로만 판정한다(아래 isLocalRequest).
function addClient(res, req = null, tabId = null) {
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache',
    'Connection':                  'keep-alive',
    // `Access-Control-Allow-Origin: *` 를 두지 않는다(전문가 1차 검토 1-2). 이 연결만 모든
    // 출처를 받아서, 직원이 연 외부 페이지가 방송 문안·진행 상태를 읽을 수 있었다.
    // 허용된 출처의 CORS 헤더는 앞단 cors 미들웨어(corsOrigin.js)가 붙이고, 허용되지 않은
    // 출처는 라우트(routes/events.js)가 등록 전에 403 으로 돌려보낸다.
  })
  // 연결 직후 heartbeat — 브라우저가 스트림을 인식하도록 함
  res.write('event: connected\ndata: {}\n\n')
  // 접속 직후의 상태 동기화(방송 중/재생 중 스냅샷)는 여기서 하지 않는다 — 그러려면 이
  // 전송 계층이 상태 모듈(nowPlaying)을 알아야 해서 상호 참조가 된다(배선도 ③).
  // routes/events.js가 addClient 직후에 보낸다(sse-connect-sync.test.js가 고정).

  clients.add(res)
  const id = tabId ?? req?.query?.tab ?? null
  if (id) tabIds.set(res, String(id))
  if (isLocalRequest(req)) localClients.add(res)
  // 갓 붙은 창에는 유예를 준다 — 첫 생존 신호가 오기 전에 죽었다고 보면 아무도 담당이 못 된다
  lastSeen.set(res, _test.now())
  res.on('close', () => {
    clients.delete(res)
    localClients.delete(res)
    lastSeen.delete(res)
    // `forgetClient` 와 **같이** 지운다. 한쪽만 지우면 죽은 연결의 소리 상태가 남는다.
    소리상태.delete(res)
    refreshOwner()   // 담당 창이 닫혔으면 다음 창에 넘긴다
  })
  refreshOwner()

  // 방금 붙은 창에게 현재 담당을 바로 알려준다. refreshOwner는 **바뀔 때만** 전파하므로,
  // 담당이 그대로인 경우(뒤늦게 붙은 창)에는 이 줄이 없으면 아무것도 못 받고 자기가
  // 담당인지 아닌지 영영 모른다.
  // `sameMachine` 은 **이 연결에만** 해당하는 값이라 여기서만 보낸다(전파용
  // `refreshOwner` 는 모두에게 같은 것을 보내므로 거기 실으면 남의 값이 섞인다).
  // 화면은 이 값이 **있을 때만** 갱신한다 — 뒤에 오는 전파 이벤트에는 이 칸이 없다.
  try {
    res.write(`event: sound_owner\ndata: ${JSON.stringify({
      tabId: soundOwner(), siteScreens: localAliveCount(), sameMachine: 같은기계인가(req),
    })}\n\n`)
  }
  catch { /* 이미 끊긴 연결 */ }
}

// 연결된 모든 클라이언트에 SSE 이벤트 전송
function broadcastSSE(event, data) {
  // **드라이런이면 소리 내는 이벤트를 안 내보낸다** (P-15, 2026-09-11).
  //
  // `CARECAST_NO_HARDWARE=1` 은 서버 스피커만 막는데, 예약 6유형 중 **다섯은 브라우저가
  // 낸다.** 그래서 검수 중 예약 시각이 지나가면 검수 PC 스피커에서 진짜 소리가 났다.
  // 쏘는 자리가 여기 하나뿐이라 여기서 한 번 막는다 — 화면마다 막으면 곧 빠뜨린다.
  //
  // **이 파일은 아무 모듈도 require 하지 않는다**(배선도 ③, `route-wiring.test.js` 가 고정).
  // 처음엔 여기서 `hardwareMode` 를 당겼다가 그 가드에 걸렸고, **가드가 옳았다** —
  // 순수 전송 계층이 정책 모듈을 알면 예전의 상호 참조가 되살아난다.
  // 그래서 **판단을 밖에서 넣어 준다**(`setSoundGate`). 안 넣으면 예전처럼 다 나간다.
  // **payload 도 넘긴다.** 한 이벤트에 시작과 정지가 같이 타는 것(`action`·`state`)이
  // 있어서, 이름만으로 가르면 **정지 명령까지 막혀 소리가 안 꺼진다**(Codex 재검수 2026-09-11).
  if (_소리막기 && _소리막기(event, data)) {
    // **조용히 삼키지 않는다.** 안 남기면 "왜 소리가 안 나지" 를 아무도 못 찾는다
    // (`audioQueue` 가 같은 이유로 reject 한다 — CC-008 delivery-truth).
    console.log(`[SSE] 드라이런 — '${event}' 를 안 내보냈습니다(브라우저 소리 방지)`)
    return 0     // 전달 수를 거짓으로 돌려주지 않는다 — 부르는 쪽이 무음을 안다
  }

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  let sent = 0
  for (const res of clients) {
    try { res.write(payload); sent++ }
    catch { clients.delete(res); localClients.delete(res); lastSeen.delete(res) }
  }
  // **실제로 전달한 수를 돌려준다.** 예전엔 아무것도 안 돌려줘서, 듣는 사람이 0명이어도
  // 호출부가 그 사실을 알 방법이 없었다 — 그래서 무음 방송이 이력에 성공으로 남았다.
  return sent
}

// 현재 연결 수 반환
function clientCount() {
  return clients.size
}

// 현장 PC에서 온 연결 수. **0이면 확실히 무음이지만, 1 이상이라고 재생이 보장되지는 않는다** —
// 현장 PC에 탭이 여러 개면 재생은 leader 탭 하나만 한다(App.jsx의 CC_IS_LEADER). 여기서는
// 지배적 실패(창이 통째로 닫힘)를 잡는 데까지만 쓴다.
function localClientCount() {
  return localClients.size
}

// 그중 **생존 신호가 아직 유효한** 연결 수. /api/health에서 유령이 섞여 있는지 사람이
// 보고, 스케줄러의 hasSitePlayer도 이것으로 판정한다(2026-09-02 — 유령을 "재생 창 있음"
// 으로 세면 무음 방송이 성공으로 적힌다). 신호를 한 번도 못 받은 서버(옛 화면만)는
// 살아있나()의 폴백으로 전원 생존 취급이라 예전 판정과 같다.
function localAliveCount() {
  let n = 0
  for (const res of localClients) if (살아있나(res)) n++
  return n
}

/**
 * **살아 있는 현장 창 중 소리를 낼 수 있는 것의 수** (현장 사고 2026-09-15).
 *
 * `localAliveCount()` 는 창이 붙어 있는지만 센다. 이 함수는 거기서 **소리가 잠긴 창을 뺀다.**
 * 안 알려 준 창(옛 화면)은 **낼 수 있는 쪽으로** 센다 — 위 `소리상태` 주석의 이유와 같다.
 */
/**
 * **소리 담당(대표) 창에게만** 보낸다 — 실제로 울릴 창이 그 하나뿐인 소리용(2026-09-26 Codex 교차검수 T36 2회차 High).
 * `broadcastSSE` 의 전달 수는 원격·모니터를 다 합치고 소리 가능 여부도 창 전체로 세서, 대표 창이 못 받거나 소리를 못 내도
 * 「보냈다」가 됐다. 여기서는 대표 창이 ① 있고 ② 살아 있고 ③ 「소리 못 냄」이라 알리지 않았고 ④ 실제로 써졌을 때만 true 다.
 * 드라이런 판단(setSoundGate)은 broadcastSSE 와 똑같이 먼저 적용한다.
 *
 * **쓰기가 끝났다는 확인까지 기다린다**(3회차 High, 사용자 결정 「가」). `write()` 가 예외 없이 돌아와도 소켓 오류(EPIPE)는
 * 나중에 비동기로 온다 — 그래서 **Promise<boolean>** 이고, 쓰기 콜백이 오류 없이 와야 true 다. 이미 끝난 연결은 쓰지 않는다.
 * 콜백이 1.5초 안에 안 오면 false 다 — 흐름 실행기는 약 3초 뒤 결과를 읽으므로 그 전에 닿아야 한다.
 * **한계**: 브라우저가 받은 뒤 실제로 소리를 냈는지는 모른다. broadcastSSE·sitePlayer 로 판정하는 다른 브라우저 소리와 같은 수준이다.
 */
function 담당에게보내기(event, data) {
  const res = ownerRes
  if (!res || !localClients.has(res) || !살아있나(res)) return Promise.resolve(false)
  if (소리상태.get(res) === false) return Promise.resolve(false)
  if (_소리막기 && _소리막기(event, data)) {
    console.log(`[SSE] 드라이런 — '${event}' 를 담당 창에 안 보냈습니다(브라우저 소리 방지)`)
    return Promise.resolve(false)
  }
  if (res.destroyed || res.writableEnded) return Promise.resolve(false)
  return new Promise((resolve) => {
    let 끝남 = false
    const 확정 = (v) => { if (!끝남) { 끝남 = true; clearTimeout(시한); resolve(v) } }
    const 시한 = setTimeout(() => 확정(false), 1500)
    if (typeof 시한.unref === 'function') 시한.unref()
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, (err) => 확정(!err))
    } catch {
      확정(false)
    }
  })
}

function 소리낼수있는창수() {
  let n = 0
  for (const res of localClients) {
    if (!살아있나(res)) continue
    if (소리상태.get(res) === false) continue   // 스스로 「못 낸다」고 말한 창만 뺀다
    n++
  }
  return n
}

module.exports = {
  addClient, broadcastSSE, setSoundGate, clientCount, localClientCount, localAliveCount, soundOwner,
  소리낼수있는창수, 담당에게보내기, set같은기계판정,
  무창사건수, 담당바뀜수,
  noteAlive, forgetClient, recheckOwner, ALIVE_TIMEOUT_MS, _test,
  isLocalRequest,
}
