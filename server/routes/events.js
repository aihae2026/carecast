// SSE 이벤트 스트림 엔드포인트
// 브라우저가 연결을 유지하며 서버 푸시 이벤트를 수신
const express              = require('express')
const { addClient, clientCount, noteAlive, forgetClient, setSoundGate } = require('../services/sse')

const router = express.Router()

// **드라이런이면 소리 내는 이벤트를 안 내보낸다** (P-15, 2026-09-11).
//
// `CARECAST_NO_HARDWARE=1` 은 서버 스피커만 막는데, 예약 6유형 중 **다섯은 브라우저가
// 낸다**([FACT] EV-000373). 그래서 검수 중 예약 시각이 지나가면 **검수 PC 스피커에서
// 진짜 소리가 났다.** PROJECT_PROFILE §1-3 이 이 방향을 적어 뒀다.
//
// **왜 여기서 배선하나**: `sse.js` 는 순수 전송 계층이라 아무 모듈도 require 하지 않는다
// (배선도 ③, `route-wiring.test.js` 가 고정 — 처음에 거기서 당겼다가 걸렸고 **가드가
// 옳았다**). 이 파일은 이미 두 쪽을 다 아는 자리다 — 접속 스냅샷을 여기서 보내는 것과
// 같은 이유다.
// **없으면 그냥 넘어간다.** 테스트 여럿이 `sse` 를 스텁으로 갈아끼우는데, 그 스텁에
// 이 함수가 없다고 이 라우트가 통째로 못 뜨면 **배선 하나 때문에 서버가 안 뜬다.**
// 실제로 `tv-volume-channel.test.js` 가 그렇게 걸렸다 — 배선은 부가 기능이지 전제가 아니다.
if (typeof setSoundGate === 'function') {
  setSoundGate((event, data) => {
    const hm = require('../services/hardwareMode')
    // **판단은 `소리내는가` 한 곳이다.** 여기서 `소리이벤트.has(event)` 로 직접 가르면
    // 한 이벤트에 시작과 정지가 같이 타는 경우(payload 의 `action`·`state`)를 놓친다 —
    // 정지까지 막아 BGM 이 안 꺼졌다(Codex 재검수 2026-09-11).
    return hm.hardwareDisabled() && hm.소리내는가(event, data)
  })
}

// ── **「이 창이 서버와 같은 기계인가」도 여기서 배선한다** (현장 지적 2026-09-15) ────
//
// 현장 PC 에서 랜 주소(`192.168.0.8:3001`)로 열면 연결이 loopback 으로 안 온다 —
// 그 기계 **자신의 랜 주소**로 온다. 그래서 같은 PC 인데 원격으로 판정되고, 그 창은
// 소리를 못 낸다(설계대로다). 그날 실제로 그 상태였다.
//
// 「방송 화면이 없다」 띠는 **원격 창에만** 뜨므로, 거기 「localhost 를 여세요」 단추를
// 늘 달면 **직원 폰에도 보인다** — 폰에서 누르면 그 폰의 localhost 라 아무 데도 안 닿는다.
// 그래서 **같은 기계일 때만** 단추를 낸다. 화면은 이것을 스스로 알 수 없다.
//
// `os` 를 부르는 자리가 여기인 이유는 위 `setSoundGate` 와 같다 — `sse.js` 는 아무 모듈도
// require 하지 않는다. **없으면 그냥 넘어간다**(스텁으로 갈아끼운 시험에서 서버가
// 안 뜨면 안 된다).
if (typeof require('../services/sse').set같은기계판정 === 'function') {
  let 내주소들 = null
  const 주소목록 = () => {
    if (내주소들) return 내주소들
    const s = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
    try {
      const nets = require('os').networkInterfaces()
      for (const 목록 of Object.values(nets ?? {})) {
        for (const n of 목록 ?? []) if (n?.address) s.add(n.address)
      }
    } catch { /* 못 읽으면 loopback 만 안다 — 단추가 안 보일 뿐이다 */ }
    내주소들 = s
    return s
  }
  require('../services/sse').set같은기계판정((req) => {
    const raw = req?.socket?.remoteAddress ?? ''
    if (!raw) return false
    // IPv4-mapped IPv6(`::ffff:192.168.0.8`)로 오는 경우가 있다 — 꼬리를 떼고도 견준다.
    const addr = raw.startsWith('::ffff:') ? raw.slice(7) : raw
    return 주소목록().has(raw) || 주소목록().has(addr)
  })
}

// GET /api/events — SSE 스트림 연결 (브라우저가 앱 로드 시 1회 연결)
router.get('/', (req, res) => {
  // **허용되지 않은 출처는 등록 전에 돌려보낸다**(전문가 1차 검토 1-2). CORS 는 응답을
  // 못 읽게 할 뿐이라, 연결을 받아 두면 이벤트가 그 창으로 계속 흘러간다(방송 문안 포함).
  // 판정은 공통 출처 판정 한 곳(corsOrigin.js) — Origin 없는 같은 출처 탐색·비브라우저는 통과.
  if (!require('../services/corsOrigin').isAllowedOrigin(req.headers?.origin)) {
    return res.status(403).json({ error: '다른 사이트에서 보낸 요청이라 막았습니다.' })
  }
  // 탭 id는 창을 구별하는 이름표일 뿐이다 — 현장 PC 여부는 여전히 요청 주소로만
  // 판정한다(sse.js의 isLocalRequest). 이름표로 현장이라고 주장할 수는 없다.
  addClient(res, req, req.query?.tab ?? null)
  // 연결 직후 현재 방송·재생 상태 + 볼륨 즉시 전송 (크로스-PC 동기화).
  // 방송 상태 동기화는 원래 sse.addClient 안에 있었는데, 전송 계층이 상태 모듈을
  // 역참조하게 만들어서(상호 참조, 배선도 ③) 두 모듈을 다 아는 이 자리로 옮겼다.
  try {
    const np = require('../services/nowPlaying')
    const state = np.get()
    if (state.broadcast) {
      // 방송 진행 중 → broadcast_started로 동기화 (새 탭이 방송 상태를 반영)
      // 이쪽에도 snapshot 표를 단다 — 화면의 broadcast_started 처리기는 "새 방송이 시작됐다"로
      // 읽고 이전 TTS·방송 BGM을 세운다(stopCurrent). 방송 **도중에** 재접속한 현장 창이
      // 그걸 받으면 나가던 문장이 중간에 끊긴다. 아래 broadcast_stopped와 같은 이유다.
      res.write(`event: broadcast_started\ndata: ${JSON.stringify({ title: state.broadcast.title, tab: state.broadcast.tab ?? null, snapshot: true })}\n\n`)
    } else {
      // 방송 없음 → broadcast_stopped으로 초기화 (서버 재시작 후 stale 상태 제거,
      // 재연결한 브라우저가 "방송중"으로 굳는 버그 방지)
      //
      // **snapshot: true를 꼭 실어 보낸다.** 이건 "지금 방송 중이 아니다"라는 표시
      // 동기화지, **사람이 정지를 누른 것이 아니다.** 화면 쪽은 broadcast_stopped를
      // 「정지」 신호(carecast:stop-broadcast)로 바꿔 쏘는데, 그 신호는 흐르던 BGM·
      // TV 송출을 실제로 끈다. 표가 없으면 **재접속할 때마다**(서버 재시작·자동
      // 업데이트·네트워크 끊김) 소리가 죽는다 — 2026-09-04에 현장(main)에서 그렇게
      // 터졌다. dev는 965325f 이후 같은 지뢰를 안고 있었고, 병합 전에 여기서 닫는다.
      res.write(`event: broadcast_stopped\ndata: ${JSON.stringify({ snapshot: true })}\n\n`)
    }
    res.write(`event: now_playing\ndata: ${JSON.stringify(state)}\n\n`)
    // 마이크 생방송 신호등도 접속 순간 한 번 맞춘다(2026-09-03 레드 검증 발견1).
    // 이게 없으면 두 방향이 다 반쪽이다 — 방송 **도중에** 새로 연 화면은 켜짐을 영영
    // 못 받고, 꺼짐 신호가 나가는 사이 잠깐 끊겼던 화면은 "방송 중"이 굳는다.
    // 상태는 서버 메모리 하나(micLive)라, 여기서 물어보면 그게 곧 진실이다.
    res.write(`event: mic_live\ndata: ${JSON.stringify({ on: require('../services/micLive').isLive() })}\n\n`)
  } catch { /* 접속 직후 상태 동기화 — 실패해도 SSE 연결은 열려 있어야 한다(이후 이벤트로 맞춰진다) */ }
  try {
    const { getDB } = require('../db/schema')
    // 기본값을 여기 또 적지 않는다 — 예전엔 bgm 기본값이 여기선 50, 방송 쪽에선 70이라
    // 접속 직후 화면에 뜨는 값과 실제로 나가는 소리가 달랐다(domain/volume.js가 유일한 출처).
    const { readVolumes } = require('../domain/volume')
    res.write(`event: volume_change\ndata: ${JSON.stringify({
      ...readVolumes(getDB()),
    })}\n\n`)
  } catch { /* 접속 직후 볼륨 동기화 — 실패해도 SSE 연결은 열려 있어야 한다 */ }
  console.log(`[SSE] 클라이언트 연결 (현재 ${clientCount()}명)`)
})

// 현장 PC 여부는 여기서도 **요청 주소로만** 본다 — 이름표는 창을 구별할 뿐,
// "나 현장이야"의 근거가 될 수 없다(sse.js의 isLocalRequest와 같은 규칙).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const 현장에서온것 = (req) => LOOPBACK.has(req?.socket?.remoteAddress ?? '')

// POST /api/events/alive?tab=… — "이 창 살아 있다"
//
// 왜 필요한가(H15): SSE 연결이 열려 있는 것은 창이 살아 있다는 뜻이 아니다. Vite 프록시는
// 브라우저가 닫혀도 백엔드 쪽을 안 끊고, 서버는 그 유령을 소리 담당으로 지목해 **어느
// 창에서도 소리가 안 났다.** 이 신호는 **브라우저가 실제로 돌고 있어야만** 보낼 수 있다.
// 몸통 없이 주소만 쓴다 — 창이 닫히는 순간 sendBeacon으로도 같은 모양을 보내야 한다.
router.post('/alive', (req, res) => {
  // `sound=on|off` — 그 창이 **소리를 낼 수 있는지** 스스로 알린 것이다(현장 사고 2026-09-15).
  // 창이 붙어 있는 것과 소리를 낼 수 있는 것은 다르다. 브라우저가 자동재생을 막으면
  // 창은 멀쩡히 그려지고 소리만 안 나는데, 서버는 그것을 알 방법이 없었다.
  // **안 보낸 창은 `undefined` 로 넘긴다** — 옛 화면을 「못 낸다」로 세면 멀쩡한 방송이
  // 전부 실패로 적힌다. 판단은 `sse.소리낼수있는창수()` 가 한다.
  const 소리 = req.query?.sound
  const 소리켜짐 = 소리 === 'on' ? true : 소리 === 'off' ? false : undefined
  if (현장에서온것(req)) noteAlive(req.query?.tab ?? null, 소리켜짐)
  res.status(204).end()
})

// POST /api/events/bye?tab=… — 창이 닫히면서 남기는 인사(pagehide → sendBeacon).
// 이게 오면 90초를 기다릴 것 없이 그 자리에서 담당을 넘긴다.
router.post('/bye', (req, res) => {
  if (현장에서온것(req)) forgetClient(req.query?.tab ?? null)
  res.status(204).end()
})

module.exports = router
