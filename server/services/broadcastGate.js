// 방송 수명주기 게이트 — 취소 토큰·취소 세대·음원/영상 종료 대기 배관.
//
// 왜 별도 파일인가(배선도 ①, 2026-08-30): 원래 broadcastSequencer.js 안에 있었는데,
// flowRunner도 같은 배관(waitFor*·cancelGeneration)을 써야 해서 시퀀서를 lazy require로
// 역참조했고, 시퀀서는 flowRunner.runStep을 부르므로 상호 참조였다. 배관을 아래층으로
// 내리면 둘 다 여기만 보면 된다. 시퀀서가 기존 이름으로 재수출하므로 라우트·테스트의
// 기존 사용처는 그대로다. 상태(_cancelGen, resolver 맵)는 예전과 같은 단일 모듈 상태다.
'use strict'

const nowPlaying = require('./nowPlaying')
const { broadcastSSE } = require('./sse')

// ── 방송 취소 토큰 ─────────────────────────────────────────
let _broadcastToken = null
// 브라우저의 nowPlaying POST가 덮어써도 실행 중인 자동방송의 잠금은 유지한다.
let _broadcastActive = false
function isBroadcastActive() { return _broadcastActive }

function newBroadcastToken() {
  // 새 방송(아침·체조·점심·저녁·저녁 마무리)이 시작되면 이전 방송·흐름의 대기를 전부
  // 'cancelled'로 깨우고 시작한다. 예전엔 수동 트리거(routes/morning.js)만
  // cancelCurrentBroadcast를 거쳐서, 매일 도는 스케줄 경로는 앞에 돌던 흐름(동요 등)을
  // 못 끊었다 — 점심·저녁 자동방송이 정시에 시작해도 흐름이 그 위로 계속 다음 곡을 쏘는
  // 구멍. 자동방송 시작 = 이전 소리 정리. 시각이 왕이다.
  cancelCurrentBroadcast()
  const tok = Symbol()
  _broadcastToken = tok
  return tok
}
function isCancelled(tok) { return _broadcastToken !== tok }

// 새 방송 시작 전 이전 방송 취소 — SSE 미전송 (새 broadcast_started 가 대체)
// 취소가 몇 번 있었는지. "재생을 지시한 뒤 대기를 등록하기 전"이라는 아주 짧은 틈에 취소가
// 들어오면, 그 순간 resolver가 아직 등록 전이라 아무것도 안 끊긴다 — 흐름은 그 뒤에 등록하고
// 상한(180초)까지 기다리다가 새 방송 위로 다음 곡을 쏜다. 등록 시점에 이 숫자를 대조하면
// "내가 시작한 뒤로 취소가 있었나"를 알 수 있어서 그 틈이 사라진다.
let _cancelGen = 0
function cancelGeneration() { return _cancelGen }

// ── 취소의 성격 — 사람이 껐나, 새 방송이 밀어냈나 ──────────
// 둘 다 같은 cancelCurrentBroadcast를 지나지만 **다른 사건**이다. 밀림만 이력에 실패로
// 남긴다(ISSUE-010, 사용자 결정 2026-09-07 안 (나) — 이력에는 남기고 배너는 안 띄운다).
// 그전에는 둘 다 흔적 없이 사라져서, 이미 스피커로 소리가 나가던 방송조차 "그날 나갔나"에
// 답할 근거가 없었다.
const CANCEL_HUMAN   = 'human_stop'
const CANCEL_PREEMPT = 'preempt'

// 세대 번호 → 그 취소의 성격.
// **한 칸짜리 변수로는 부족하다.** 밀려난 쪽은 곧바로 깨어나지 못한다 — 재생 중인 파일이
// 끝나거나 tokenDelay가 200ms 단위로 돌아올 때까지 잔다. 그 사이에 취소가 또 들어오면
// 마지막 것만 남아, 밀려난 방송이 제 사연을 잃고 다시 조용해진다.
// 최근 것만 필요하므로 32개를 넘으면 오래된 것부터 버린다(무한히 자라지 않게).
const _cancelKinds = new Map()
function noteCancelKind(kind) {
  _cancelKinds.set(_cancelGen, kind)
  if (_cancelKinds.size > 32) _cancelKinds.delete(_cancelKinds.keys().next().value)
}
// 세대 gen 시점에 시작한 쪽을 끊은 것은 **그 다음 세대**의 취소다(그 순간 isCancelled가 참이 된다).
// 그 뒤에 취소가 더 있었어도 죽인 것은 첫 번째다.
function cancelKindSince(gen) { return _cancelKinds.get(gen + 1) ?? null }

// "이 방송을 끊은 것이 사람이었나?" — **모르면 아니라고 답한다.**
// 32칸을 넘겨 기록이 밀려나면 위가 null 을 낸다([FACT] EV-001229 — 검수자가 그 경로를 찾았다).
// 그때 "사람이 껐다"로 넘겨짚으면 밀려난 방송이 **또 조용히 사라진다** — 이 저장소에서
// 가장 비싼 실패다. 반대로 틀리면 이력에 줄 하나가 더 남을 뿐이고 사람이 보고 판단할 수 있다.
// 그래서 확실히 사람일 때만 참이다. 부르는 쪽은 이미 취소된 뒤라서 "안 끊겼다"는 경우가 없다.
function wasHumanStopSince(gen) { return cancelKindSince(gen) === CANCEL_HUMAN }

// **소리를 실제로 끊는다.** 취소 토큰은 "다음 단계로 가지 마라"일 뿐이라, 이미 스피커로
// 나가고 있는 파일은 끝까지 재생된다 — 정지를 눌러도 안내가 계속 나오던 원인이 이것이었다
// (2026-08-31 사용자 신고). 끊는 함수는 이미 있었는데 서버 종료 때만 불리고 있었다.
// 지연 require: audioQueue가 require 시점에 하드웨어를 건드리지 않게 하는 이 저장소의 관례.
function silenceNow(reason) {
  try { require('./audioQueue').stopAll(reason) }
  catch (e) { console.error('[방송정지] 재생 중단 실패:', e.message) }
}

// kind 기본값이 '밀림'인 이유: 이 함수를 맨몸으로 부르는 곳(newBroadcastToken,
// routes/morning.js의 수동재생 5개)이 전부 "새 소리가 앞 소리를 밀어낸다"이기 때문이다.
// 사람이 정지를 누른 경로는 아래 stopCurrentBroadcast 하나뿐이라 거기서만 갈아 끼운다.
function cancelCurrentBroadcast(reason = '새 방송이 시작되어 앞 소리를 정리합니다', kind = CANCEL_PREEMPT) {
  _cancelGen++
  noteCancelKind(kind)
  _broadcastToken = null
  // 레인이 돌던 중이면 그 「방송 중」 표시도 여기서 지운다(2026-09-17 점검 A-1). 밀려난 레인의 finally 는
  // 토큰이 취소돼 `broadcastComplete` 를 건너뛰므로, 안 지우면 표시가 남아 스케줄러가 최대 20분 예약을
  // 미루고 버린다. 레인이 안 돌 때는 건드리지 않는다 — 브라우저가 알린 재생 표시일 수 있다.
  // 뒤이어 새 레인이 시작하면 `broadcastStart` 가 곧바로 새 표시를 세운다.
  if (_broadcastActive) nowPlaying.update({ broadcast: null })
  _broadcastActive = false
  silenceNow(reason)
  // 'cancelled'로 깨운다 — 기다리던 쪽이 "곡이 끝났다"와 구별할 수 있어야 한다.
  // 흐름(flowRunner)은 이 이유를 보고 아예 멈춘다. 구별하지 않으면 정지 버튼을 눌러도
  // 흐름이 다음 곡을 새 방송 위에 덮어쓴다.
  videoEnd.cancelAll()
  audioEnd.cancelAll()
}

// 수동 정지 버튼용 — broadcast_stopped SSE 전송
function stopCurrentBroadcast() {
  // 사유를 갈라 남긴다 — 로그에서 "사람이 껐다"와 "새 방송이 밀어냈다"는 다른 사건이다.
  cancelCurrentBroadcast('사람이 정지 버튼을 눌렀습니다', CANCEL_HUMAN)
  // 마이크 생방송도 끊는다(td09 H10, 사용자 결정 2026-09-02: 정지는 남의 생방송 말도
  // 그 자리에서 끊는다). 실소리는 서버 스피커의 별도 경로(audioPlayer — audioQueue 밖)라
  // 위 silenceNow가 못 잡는다. **사람 정지에만 건다** — 자동방송의 밀어냄
  // (cancelCurrentBroadcast·newBroadcastToken)이 직원의 생방송 말을 끊으면 안 된다.
  // 방송자 화면의 정리·안내는 아래 broadcast_stopped SSE를 InstantBroadcast가 듣고 한다.
  try { require('./audioPlayer').stopIfStreaming('사람이 정지 버튼을 눌렀습니다') }
  catch (e) { console.error('[방송정지] 마이크 재생 중단 실패:', e.message) }
  // bgm은 클라이언트 타이머가 별도 관리하므로 초기화하지 않음
  nowPlaying.update({ broadcast: null, video: null })
  broadcastSSE('broadcast_stopped', {})
}

// nowPlaying 동기화 포함 방송 시작/완료 헬퍼
//
// tab: 자동방송 5종의 식별자(morning · exercise · lunch · dinner · evening_prayer).
// **화면이 방송 이름 글자로 판단하지 않게 하려고 싣는다.** 예전에는 화면 둘이 5종의 제목을
// 글자 그대로 복사해 두고(OVERLAY_TITLES · TITLE_LABEL) 그것과 맞춰 봤는데, 여기 LANES의
// 제목을 한 자만 고쳐도 그쪽이 조용히 안 맞게 된다(실제로 띄어쓰기 한 칸 차이로 두 화면의
// 제목이 이미 갈려 있었다). 식별자로 보내면 이름은 표시에만 쓰이고 판단에는 안 쓰인다.
function broadcastStart(title, tab = null) {
  _broadcastActive = true
  // bgm은 서버가 직접 추적하므로 방송 시작 시 초기화하지 않음
  nowPlaying.update({ broadcast: { title, tab }, video: null })
  broadcastSSE('broadcast_started', { title, tab })
}
function broadcastComplete(title) {
  _broadcastActive = false
  nowPlaying.update({ broadcast: null })
  broadcastSSE('broadcast_completed', { title })
}

// ── 재생 종료 대기 시스템 (동영상 · 음원) ────────────────
//
// 둘은 기다리는 대상만 다르고 규칙이 같아서 한 벌로 만든다. 예전엔 15줄짜리 같은 코드가
// 두 벌이었고, 실제로 한쪽에만 고친 적이 있다(상한 타이머 정리를 영상에만 넣어, 음원 쪽은
// 방송이 끝난 뒤에도 타이머가 프로세스에 남아 있었다).
//
// 규칙:
//  · sinceGen — 재생을 지시하기 **직전**에 읽어 둔 cancelGeneration(). 그 뒤로 취소가 있었다면
//    등록하지 않고 곧바로 'cancelled'로 답한다(등록 전 틈에 들어온 취소를 놓치지 않는다).
//  · 종료 신호를 먼저 받으면 상한 타이머를 걷어낸다 — 안 그러면 15분짜리 타이머가 방송이
//    다 끝난 뒤까지 남는다.
//  · 돌려주는 값은 **왜 깨어났는지**다: 'ended'(화면이 알림) | 'timeout'(상한) | 'cancelled'.
//    이유를 구분하지 않으면 정지 버튼을 눌러도 흐름이 다음 단계를 새 방송 위에 덮어쓴다.
function makeEndWaiter(defaultTimeoutMs) {
  const resolvers = new Map()

  async function wait(token, timeoutMs = defaultTimeoutMs, sinceGen) {
    if (sinceGen !== undefined && sinceGen !== _cancelGen) return 'cancelled'
    return new Promise(resolve => {
      let resolved = false
      let timer = null
      const done = (reason = 'ended') => {
        if (resolved) return
        resolved = true
        if (timer) clearTimeout(timer)
        // **자기 자리일 때만 지운다.** 같은 토큰으로 뒤이어 등록된 대기가 있으면
        // 무조건 지우다가 **그 대기를 Map 에서 뽑아 버린다** — 그러면 종료 신호가
        // 와도 아무도 못 깨우고 상한까지 잔다(Codex 지적, 2026-09-11 EV-004582).
        if (resolvers.get(token) === done) resolvers.delete(token)
        resolve(reason)
      }
      // 같은 토큰이 이미 기다리고 있으면 **그것부터 거둔다.** 그냥 덮어쓰면 앞의 `done`
      // 은 Map 에서 사라지는데 **타이머는 살아남아** 상한(음원 3분 · 영상 15분)을 다 채운다.
      // 토큰은 매번 새로 만드는 것이 원칙이지만, 원칙에 기대는 대신 여기서 막는다.
      const 앞사람 = resolvers.get(token)
      if (앞사람) 앞사람('released')
      resolvers.set(token, done)
      timer = setTimeout(() => done('timeout'), timeoutMs)
    })
  }

  function notify(token) {
    const fn = resolvers.get(token)
    if (fn) fn('ended')
  }

  // 기다리던 쪽이 **먼저 자리를 뜰 때** 부른다(UX-18, 2026-09-11).
  //
  // 흐름에는 세 번째 길이 있다 — 뒤 단계의 예약 시각(앵커)이 지나면 `flowRunner` 가
  // 이 대기를 버리고 다음 단계로 간다. 그때 아무도 안 깨우면 **상한까지 타이머와
  // Map 항목이 남는다**(음원 3분 · 영상 15분). 현장 PC 는 수 개월 무중단으로 돌고
  // 흐름은 하루에 여러 번 도니, 그것이 쌓인다(PROJECT_PROFILE §3 J "타이머 중복").
  //
  // 게다가 같은 토큰이 다시 쓰이면 앞의 `done` 이 **타이머를 안 걷은 채** 덮어써져
  // 그 타이머는 상한을 다 채운다.
  //
  // 'cancelled' 가 아니라 'released' 로 답한다 — 취소는 "방송을 멈춰라"는 뜻이고
  // 이건 "이 대기만 그만둔다"는 뜻이다. 둘을 같은 낱말로 적으면 판정이 섞인다.
  function release(token) {
    const fn = resolvers.get(token)
    if (fn) fn('released')
  }

  // 기다리던 것 전부를 'cancelled'로 깨운다(정지 버튼·새 방송 시작)
  function cancelAll() {
    for (const fn of resolvers.values()) fn('cancelled')
    resolvers.clear()
  }

  return { wait, notify, cancelAll, release }
}

const videoEnd = makeEndWaiter(15 * 60 * 1000)
const audioEnd = makeEndWaiter(3 * 60 * 1000)

// 이름은 그대로 둔다 — 호출부가 25곳쯤 되고, 이름이 무엇을 기다리는지 말해 준다.
const waitForVideoEnd  = (token, timeoutMs, sinceGen) => videoEnd.wait(token, timeoutMs, sinceGen)
const notifyVideoEnded = (token) => videoEnd.notify(token)
const waitForAudioEnd  = (token, timeoutMs, sinceGen) => audioEnd.wait(token, timeoutMs, sinceGen)
const notifyAudioEnded = (token) => audioEnd.notify(token)
// 기다리던 쪽이 먼저 자리를 뜰 때 — **둘 다 만든다.** 한쪽만 두면 다른 쪽에서 상한을
// 다 채우는 타이머가 남는다. 이 파일 머리말이 적어 둔 그 실수를 반대 방향으로 하지 않는다.
const releaseVideoWait = (token) => videoEnd.release(token)
const releaseAudioWait = (token) => audioEnd.release(token)

// 취소 가능한 딜레이 (200ms 단위로 토큰 확인).
// **취소 토큰의 집이 여기다.** 2026-09-01에 시퀀서를 쪼개면서 잠깐 broadcastTokens.js라는
// 별도 경유지에 뒀었는데, isCancelled가 여기 있으니 이 함수의 제자리도 여기다(2026-09-02).
// flowRunner의 cancellableSleep이 같은 일을 한 벌 더 하고 있다 — 합칠 자리가 이제 생겼다.
async function tokenDelay(ms, tok) {
  const CHUNK = 200
  let elapsed = 0
  while (elapsed < ms) {
    if (isCancelled(tok)) return
    await new Promise(r => setTimeout(r, Math.min(CHUNK, ms - elapsed)))
    elapsed += CHUNK
  }
}

module.exports = {
  isBroadcastActive,
  newBroadcastToken, isCancelled, tokenDelay,
  cancelGeneration, cancelCurrentBroadcast, stopCurrentBroadcast,
  cancelKindSince, wasHumanStopSince, CANCEL_HUMAN, CANCEL_PREEMPT,
  broadcastStart, broadcastComplete,
  waitForVideoEnd, notifyVideoEnded, releaseVideoWait,
  waitForAudioEnd, notifyAudioEnded, releaseAudioWait,
}
