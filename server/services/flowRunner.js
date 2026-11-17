// 방송 흐름(flow_sequences) 실행기 — TTS/BGM/음원/차임벨/대기 블록을 sort_order 순서대로
// 하나씩 실행한다. 대략적 지연(approximate delay) 기반 — 이 앱이 이미 BGM 선재생(bgm_delay)에
// 쓰고 있는 것과 같은 수준의 타이밍이며, 실제 재생 종료를 기다리는 콜백은 쓰지 않는다(설계
// 단계에서 사용자에게 확인받은 결정 — Option A).
const crypto = require('crypto')
const { generateTTSWithRetry, BROADCAST_BUDGET_MS, deleteTmpFile, readCues, rateToStr, pitchToStr } = require('./tts')
const { normalizePlaybackRate } = require('./scheduleStore')
const { storeAudio } = require('./audioStore')
const { broadcastSSE } = require('./sse')
const { playChime } = require('./chimePlayer')
const { 차임시작표지, 차임뒤대기 } = require('./chimeTiming')
// 회차 열쇠 — 단계 이력이 쓰는 것과 **같은 열쇠**를 봐야 차임 연속 실패를 회차로 셀 수 있다.
const { currentRunId } = require('./runContext')
// 단계 결과 어휘의 정본(P-57). 흐름과 자동방송이 같은 값을 나른다.
const { 단계사유, 사유문구 } = require('../domain/stepHistory')
// 이 단계의 소리를 누가 내나 — 흐름은 서버 스피커 단계와 브라우저 단계가 섞여 있다(P-51).
const { 화면이필요한가 } = require('../domain/stepPlayer')
// "살아 있는 로컬 창이 있나"는 예약 5경로가 이미 쓰는 판정이다. **사본을 만들지 않는다** —
// 두 벌이 되면 예약과 흐름의 성공 판정이 갈린다(FP-0005).
const { hasSitePlayer } = require('./sitePlayer')
// 설정 해석은 broadcastConfig, 취소·종료 대기 배관은 broadcastGate — 예전엔 scheduler와
// broadcastSequencer에서 꺼내 써서 삼각 순환이었다(배선도 ①, route-wiring.test.js가 고정).
const { resolveBGM, loadTTSConfig } = require('./broadcastConfig')
const { normalizePlaylistItems, resolvePlaylistItem } = require('../domain/playlistItems')
const gate = require('./broadcastGate')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// 취소 가능한 대기 — opts.isCancelled(선택적 () => boolean)가 있으면 200ms마다 확인해서
// 즉시 중단한다. broadcastSequencer.js의 tokenDelay와 같은 방식. opts.isCancelled가 없으면
// (예: 예약이 broadcast_type='flow'로 발동될 때처럼 취소 개념이 없는 호출 경로) 기존과
// 동일하게 그냥 끝까지 기다린다 — 순수 추가라 기존 동작에 회귀 없음.
async function cancellableSleep(ms, isCancelled) {
  if (!isCancelled) return sleep(ms)
  const CHUNK = 200
  let elapsed = 0
  while (elapsed < ms) {
    if (isCancelled()) return
    await sleep(Math.min(CHUNK, ms - elapsed))
    elapsed += CHUNK
  }
}

// 글자 수 기반 TTS 재생시간 추정치 — 실제 duration 측정 콜백이 없어 대략치로 다음 단계까지 대기
function estimateTtsDurationMs(text) {
  return Math.max(1500, (text || '').length * 180) + 1500
}

// 재생시간을 모르는 파일의 대기 상한. 이건 "기다릴 시간"이 아니라 **최대 기다릴 시간**이다 —
// 화면이 종료를 알려주면 그 즉시 다음으로 넘어간다. 화면이 안 켜져 있어 알림이 영영 안 오는
// 경우에만 이 값까지 간다.
const AUDIO_WAIT_CAP_MS = 180 * 1000

// 파일 하나를 기다릴 상한(ms). duration을 아는 파일은 그 길이 + 여유 2초까지만 기다린다.
// **배속을 반드시 함께 본다.** 0.5배로 틀면 60초짜리가 실제로는 120초 걸리는데 상한을 62초로
// 두면 노래가 한창일 때 다음 곡으로 넘어가버린다 — 고치려던 "곡이 잘린다"가 반대 방향으로
// 되살아난다. duration은 파일 고유 길이(배속과 무관)라 나눠주기만 하면 된다.
function audioWaitCapMs(file, rate) {
  const sec = Number(file?.duration) || 0
  if (sec <= 0) return AUDIO_WAIT_CAP_MS
  const speed = (typeof rate === 'number' && rate > 0) ? rate : 1
  return Math.round(sec / speed) * 1000 + 2000
}

// 실제 재생 종료를 기다린다(취소 가능). broadcastSequencer가 이미 쓰고 있는 토큰 배관을
// 그대로 쓴다 — 화면(MusicPlayer/VideoPlayer)이 곡이 끝나면 /api/morning/audio-ended로
// 알려주고, 그 신호가 notifyAudioEnded를 거쳐 여기 도착한다.
// 예전에는 이 흐름만 종료 알림을 등록하지 않아서, 화면이 보내준 신호가 그대로 버려지고
// 무조건 상한까지 기다렸다(4곡 = 12분). 대기 방식이 둘로 갈라지지 않게 여기서도 같은 걸 쓴다.
// 돌려주는 값은 **왜 깨어났는지**다: 'ended'(화면이 끝났다고 알림) / 'timeout'(상한) /
// 'cancelled'(정지 버튼·다른 방송 시작) / 'preempted'(뒤 단계의 예약 시각).
// 이유를 구분하지 않으면 정지 버튼을 눌러도 흐름이 다음 곡을 새 방송 위에 덮어쓴다.
async function waitForMediaEnd(kind, token, capMs, isCancelled, sinceGen) {
  const ended = kind === 'video'
    ? gate.waitForVideoEnd(token, capMs, sinceGen)
    : gate.waitForAudioEnd(token, capMs, sinceGen)
  if (!isCancelled) return ended

  let stop = false
  const preempted = (async () => {
    while (!stop) {
      if (isCancelled()) return 'preempted'
      await sleep(200)
    }
  })()
  const reason = await Promise.race([ended, preempted])
  stop = true
  // **자리를 뜨면 대기를 거둔다**(UX-18, 2026-09-11). 선점으로 이겼을 때 게이트 대기자는
  // 아무도 안 깨운다 — 상한(음원 3분 · 영상 15분)까지 타이머와 Map 항목이 남고,
  // 같은 토큰이 다시 쓰이면 앞의 것이 타이머를 안 걷은 채 덮어써진다.
  // 흐름은 하루에 여러 번 돌고 현장 PC 는 수 개월 무중단이라 그것이 쌓인다.
  // 이미 끝난 대기에 불러도 아무 일이 없다(Map 에 없다).
  if (reason === 'preempted') {
    if (kind === 'video') gate.releaseVideoWait(token)
    else gate.releaseAudioWait(token)
  }
  return reason
}

// 예약 시각(앵커)으로 건너뛸 때 **앞 소리를 끊어야 하는가**. (CC-047)
//
// 예전에는 `cutShort` 하나만 봤다. 그런데 그 값은 **단계가 isCancelled를 불러 줄 때만**
// 세워지고, cancellableSleep은 각 조각 **시작**에만 확인한다 — 마지막 조각 도중에 앵커가
// 지나면 다시 안 물어보고 그냥 끝난다. 그러면 cutShort가 false로 남아 정지 신호가 안 나가고,
// **앞 음원이 계속 흐르는 위로 다음 방송이 시작된다**(현장에서 "겹쳐 들린다"고 신고된 그것).
//
// 그래서 시각으로 직접 판정한다: 단계가 앵커 시각을 **넘겨서까지** 돌고 있었으면 그 소리는
// 아직 남아 있을 수 있다. 제 시간에 끝난 단계는 예전처럼 건드리지 않는다 — 계속 흐르라고
// 만든 BGM까지 같이 꺼지기 때문이다.
//
// 애매한 경계(정확히 같은 순간)에서는 끊는 쪽으로 간다. 겹쳐 들리는 것과 BGM이 한 곡 일찍
// 끊기는 것 중에서는 후자가 훨씬 가벼운 사고다.
//
// 순수 함수로 뺀 이유: 실제 시계로 시험하려면 "마지막 조각에 앵커가 걸리도록" 타이밍을
// 맞춰야 하는데 그런 테스트는 병렬 부하에서 흔들린다(CC-048에서 이미 겪었다).
function shouldStopBeforeAnchor({ cutShort = false, stepEndedAtMs = 0, anchorAtMs = null } = {}) {
  if (anchorAtMs == null) return false
  return !!cutShort || stepEndedAtMs >= anchorAtMs
}

// 동시에 같은 흐름이 두 번 실행되는 것을 막는 인메모리 가드(스케줄러 매분 실행 + 수동 "지금
// 방송"이 겹치는 경우 등). broadcastSequencer.js의 취소 토큰과는 별개로 이 파일 안에서만 관리.
const runningFlows = new Set()

// runStep이 "정지됐다"고 알리는 값. runFlow는 이걸 받으면 남은 단계를 진행하지 않는다.
// (정지 버튼·다른 방송 시작으로 대기가 풀린 경우 — 남은 곡을 새 방송 위에 얹으면 안 된다)
// 값 자체는 domain/stepHistory 의 `단계사유` 가 정본이다 — 자동방송 경로(broadcastSteps)도
// 같은 값을 나르고, 이력에 무엇을 적을지 정하는 곳도 거기다. 리터럴을 여기 다시 적으면
// 대소문자 하나 어긋나는 것으로 판정이 통째로 죽는다(P-22 에서 실제로 겪었다).
const CANCELLED = 단계사유.취소
// 차임 단계가 "울리지 못했다"고 알려온 결과(ISSUE-009). 흐름은 멈추지 않고 계속 간다 —
// 뒤에 오는 안내 방송이 차임보다 중요하다.
//
// **차임은 보조 신호다**(사용자 결정 2026-09-07). 한 번 실패했다고 흐름 이력을 실패로 적지
// 않는다 — 안내는 정상으로 나갔는데 이력만 실패로 보이면 사람이 이력을 안 믿게 된다.
// 실패는 단계 이력(broadcast_steps)에만 남고, **연속 3회**가 되면 그때 고장 신호로 보고
// 흐름 이력까지 실패로 올린다.
const CHIME_FAILED = 단계사유.차임고장
const CHIME_FAIL_PROMOTE = 3

// 같은 흐름의 차임이 최근 몇 **회차** 연속 고장 났나. 실제로 울린 회차가 나오면 거기서 끊는다.
//
// 별도 카운터 컬럼을 새로 만들지 않는다(사용자 결정) — 단계 이력이 이미 답을 갖고 있다.
// 세는 단위 주의: 지시는 "같은 예약(schedule_id)" 기준이었으나 broadcasts·broadcast_steps
// 어디에도 schedule_id 가 없다(마이그레이션 A 보류, [FACT] EV-001003). broadcast_steps.title 이
// `흐름#<flow_sequence_id>` 라 **흐름 단위**로 센다 — 같은 흐름을 쓰는 예약이 둘이면 합산된다.
// 차임 고장은 예약이 아니라 그 흐름·장치의 문제라 이 단위가 오히려 맞다.
// 세다가 실패해도 방송은 계속되어야 하므로 어떤 경우에도 던지지 않는다.
//
// **2026-09-10 (P-49) 에 세는 방법을 고쳤다. 셋이 틀려 있었다:**
//  ① **줄을 셌다.** 한 흐름에 라벨 없는 차임이 셋이면 이력에 `'chime'` 한 칸으로 셋이 남는다
//     (`routes/flows.js:59` 가 라벨 없으면 빈 문자열, `FlowBuilder.jsx:68` 의 기본값이 무라벨).
//     그래서 **한 회차가 통째로 실패하면 그 자리에서 '연속 3회'** 가 됐다 — 연속이 아니다.
//     지금은 `run_key` 로 회차를 접어 **회차를 센다**.
//  ② **정지가 끊었다.** 사람이 흐름을 정지하면 차임을 시도조차 안 하는데 그 회차가 연속을
//     끊어, 차임 장치가 계속 죽어 있어도 승격이 영영 안 왔다. 지금은 **모르는 회차는 건너뛴다** —
//     세지도 않고 끊지도 않는다. 끊는 것은 **실제로 울린 회차**뿐이다.
//  ③ **'실패'면 다 차임 고장으로 읽었다.** 지금은 `stepHistory.차임고장인가()` 로 가른다.
//     그 판정 문구의 정본은 `domain/stepHistory.js` 하나다(양쪽에 따로 적으면 어긋난다).
//
// 훑는 줄 수: 회차 하나가 여러 줄을 남길 수 있으므로 승격 기준의 몇 배를 넉넉히 본다.
const CHIME_FAIL_SCAN_ROWS = 60

function chimeFailStreak(db, title, label, 이번회차 = null) {
  try {
    const { 차임고장인가, 차임정상인가 } = require('../domain/stepHistory')
    const rows = db.prepare(
      'SELECT run_key, result, detail FROM broadcast_steps WHERE title = ? AND label = ? ORDER BY id DESC LIMIT ?'
    ).all(title, label, CHIME_FAIL_SCAN_ROWS)

    // 최근 회차부터 차례로 접는다. 한 회차의 줄들은 id 가 붙어 있어 이어서 나온다.
    const 회차 = []
    for (const r of rows) {
      const key = String(r.run_key || '')
      let 칸 = 회차[회차.length - 1]
      if (!칸 || 칸.key !== key) { 칸 = { key, 고장: false, 정상: false }; 회차.push(칸) }
      if (차임고장인가(r)) 칸.고장 = true
      if (차임정상인가(r)) 칸.정상 = true
    }

    // 이번 실패는 아직 기록 전이다(부르는 쪽이 record() 앞에서 센다). 같은 회차의 줄이 이미
    // 있으면 그 회차를 고장으로 칠하고, 없으면 맨 앞에 회차를 하나 세운다.
    if (회차[0]?.key === String(이번회차 || '')) 회차[0].고장 = true
    else 회차.unshift({ key: String(이번회차 || ''), 고장: true, 정상: false })

    let n = 0
    for (const c of 회차) {
      if (c.고장) { n++; continue }
      if (c.정상) break        // 실제로 울렸다 — 연속은 여기서 끝난다
      // 그 밖(정지 등)은 **모른다**. 세지도 않고 끊지도 않는다.
    }
    return n
  } catch { return 0 }
}

// opts.isCancelled: 선택적 () => boolean — broadcastSequencer.js가 자기 방송 취소 토큰을
// 넘길 때만 쓰이고, runFlow(예약 발동 경로)는 안 넘기므로 그 경로는 기존과 동일하게 동작한다.
async function runStep(db, step, opts = {}) {
  const config = typeof step.config === 'string' ? JSON.parse(step.config || '{}') : (step.config || {})
  const isCancelled = opts.isCancelled
  // 재생 배속(0.5~1.5). **단계에 적은 값이 예약 값보다 우선한다** — 예약의 playback_rate는
  // 그 방송 전체의 기본값이고, 단계 값은 그 단계만의 값이다. 순서가 반대면 순서편집기에서
  // 정한 배속이 예약 배속에 덮여 아무 일도 안 일어난다(죽은 설정이 된다).
  const rate = normalizePlaybackRate(config.rate) ?? opts.rate ?? null

  // 이 단계에만 쓸 주 소리 볼륨(0~100). config.volume이 없으면 시스템 기본값이 그대로 들어온다.
  // 자동방송 단계(broadcastSequencer)와 같은 규칙 — 전역 설정을 임시로 바꿨다 되돌리지 않는다.
  const { resolveStepVolume, flowStepChannel } = require('../domain/volume')
  const channel = flowStepChannel(step.step_type)
  const stepVolume = channel ? resolveStepVolume(db, config, channel) : null

  // 묶음 머리글 — 목록을 폴더처럼 나눠 보기 위한 라벨일 뿐이라 실행할 것이 없다.
  // (예약 시각은 runFlow가 step_type과 무관하게 처리하므로 머리글에 걸어도 그대로 동작한다.)
  if (step.step_type === 'group') return

  if (step.step_type === 'delay') {
    const waitSec = Number(config.wait_sec) || 0
    if (waitSec > 0) await cancellableSleep(waitSec * 1000, isCancelled)
    return
  }

  if (step.step_type === 'chime') {
    // 재생 결과를 받는다 — 예약 차임(scheduler.js chime 분기)과 같은 규약(ISSUE-009, EV-000504).
    // 예전엔 콜백이 없어 차임이 안 울려도 흐름 이력이 성공으로 남았다.
    // 콜백을 **기다리지는 않는다** — 아래 3초 창(차임 길이) 안에 온 결과만 본다. 실패(spawn 오류)는
    // 수 ms, 정상 완료는 1~2초 안에 오므로 실제 경우는 다 잡히고, 콜백을 안 부르는 재생기·스텁이
    // 흐름을 영영 멈추게 하지 않는다. 3초 안에 결과가 없으면 "모른다"이고, 모르는 것은 실패가 아니다
    // (하드웨어 비활성이 onDone(true)인 것과 같은 대우). server/test/flow-chime-outcome.test.js 가 고정한다.
    let played = null
    // 두 번째 인자는 **"일부러 안 냈다"** 다(하드웨어 꺼짐). `ok` 는 그때도 `true` 인데,
    // 그 뜻은 "실패가 아니다" 이지 "울렸다" 가 아니다 — 구별 안 하면 드라이런 회차가
    // 차임 연속 실패를 끊는다(RB-01-R2). 판단을 여기서 추측하지 않고 **재생기가 알려 준다.**
    let 안울렸다 = false
    // 3초는 **최소**다 — 차임이 늦게 울리기 시작하면 시작 신호 + 여유까지 더 기다린다(2026-09-17 겹침 신고).
    const 표지 = 차임시작표지(), t0 = Date.now()
    const 신호옴 = playChime('general', stepVolume, (ok, 안울림) => { played = ok; 안울렸다 = !!안울림; 표지.끝남() }, 표지.onStart)
    broadcastSSE('chime_play', { type: 'general', volume: stepVolume })
    await 차임뒤대기({ 신호옴, 표지, t0, 기본ms: 3000, 잠자기: (ms) => cancellableSleep(ms, isCancelled), 취소됨: isCancelled })
    if (played === false) {
      console.error('[방송흐름] 차임벨 재생 실패 — 남은 단계는 그대로 진행합니다')
      return CHIME_FAILED
    }
    // 3초 창 안에 흐름이 **정지**됐으면 이 차임은 울렸다고 말할 수 없다(P-49 ②).
    // 예전엔 이 자리에서 그냥 돌아가 이력에 **'성공'** 으로 적혔고, 그 가짜 성공이
    // 진짜 차임 고장의 연속 카운트를 지웠다. 앵커 건너뜀은 여기 해당하지 않는다 —
    // 그건 흐름이 스스로 다음 단계로 넘어가는 것이고 차임은 이미 나갔다(CC-047).
    if (opts.isStopped?.()) return CANCELLED
    // **모름을 `undefined` 로 흘려보내지 않는다**(RB-01, Codex 소급 검수 2026-09-11).
    // 부르는 쪽은 `undefined` 를 **성공**으로 적는다 — 그러면 결과를 모르는 회차가
    // 연속 실패를 끊어서, 차임이 계속 죽어 있어도 승격이 영영 안 온다.
    // *"모르는 것은 실패가 아니다"* 는 그대로다(위 주석) — 실패로 적지 않고, **사유를 붙인다.**
    if (played === null) return 단계사유.모름
    // **일부러 안 낸 것은 "울렸다" 가 아니다**(RB-01-R2, Codex 소급 검수).
    // 처음엔 여기서 `hardwareDisabled()` 를 직접 읽어 **추측**했는데, 재생기를 스텁으로
    // 갈아끼운 테스트에서 그 추측이 빗나갔다(스텁은 진짜로 울렸다고 답하는데 환경변수는
    // 여전히 꺼짐이다). **판단은 재생기가 알려 주는 값을 쓴다.**
    if (안울렸다) return 단계사유.안울림
    return
  }

  if (step.step_type === 'tts') {
    const content = (config.content || '').trim()
    if (!content) return
    const text = require('../domain/broadcastDefaults').반복문안(content, config.repeat_broadcast)
    // **합성 전에 개인정보 검사를 거친다**(전문가 1차 검토 4-1). 직접 만든 방송 순서의 문안은 저장 때
    // 검사(routes/flows.js)를 받지만, 그 검사 전에 저장된 흐름·DB 를 손으로 고친 흐름은 그대로 나간다.
    // 무인 발사라 되물을 사람이 없다 — 차단 항목(주민번호·휴대폰번호·생년월일)이면 **합성·방송하지
    // 않고 흐름을 멈춘다.** 던지면 예약 이력이 실패로 정산되고 경보가 뜬다(scheduler.js runFlow 의 catch).
    // Azure 엔진이면 합성 자체가 외부 전송이라, 방송 직전이 아니라 **합성 직전**에 막아야 한다.
    {
      const { detectSensitive, describe } = require('./sensitiveInfo')
      const { blocked } = detectSensitive(text)
      if (blocked.length) {
        throw new Error(`「${step.label || '안내 음성'}」 문구에 개인정보(${describe(blocked)})가 있어 합성·방송하지 않았습니다. 순서편집기에서 문구를 고쳐 주세요.`)
      }
    }
    const tts = loadTTSConfig(db)
    let tmpFile = null
    // 화면이 재생을 끝내면 이 열쇠로 알려준다(POST /api/morning/audio-ended).
    // try 밖에 두는 이유: 아래 대기가 이 값들을 봐야 한다. 합성이 던지면 아래까지 못 오므로
    // 초기값을 주지 않는다(주면 no-useless-assignment 다 — 읽히기 전에 반드시 덮인다).
    let audioToken, sinceGen
    // **합성 전 세대를 먼저 읽어 둔다**(UX-18, 2026-09-11). 합성은 음성 엔진을 부르는
    // 네트워크 일이라 초 단위로 걸린다. 그 사이에 정지를 눌러도 예전에는 아무도 안 봤고,
    // 합성이 끝나면 **재생 지시가 그대로 나갔다** — 정지를 눌렀는데 방송이 시작됐다.
    // 합성 **뒤**에 세대를 읽는 것만으로는 못 잡는다. 그때는 이미 취소가 지나간 뒤라
    // 새 세대가 읽히고 대기 등록은 멀쩡해 보인다. **한 번 나간 SSE 는 회수할 수 없다.**
    const 합성전세대 = gate.cancelGeneration()
    try {
      // 흐름도 방송 경로다(단계가 밀리면 뒤 단계의 예약 시각까지 어긋난다)
      tmpFile = await generateTTSWithRetry({ text, voice: tts.voice, rate: rateToStr(tts.rate), pitch: pitchToStr(tts.pitch) },
        3, { deadlineMs: BROADCAST_BUDGET_MS })
      const cues = readCues?.(tmpFile, text) ?? null
      const audioId = storeAudio(tmpFile)
      tmpFile = null

      // 합성하는 동안 취소가 있었나. **성격까지 가른다.**
      //  · 사람이 눌렀으면 → 흐름 전체를 멈춘다(남은 단계도 안 나간다).
      //  · 뒤 단계의 예약 시각(앵커)에 밀린 것이면 → 이 단계만 건너뛴다. 여기서 흐름을
      //    통째로 중단하면 남은 단계가 사라진다(아래 대기 쪽 주석과 같은 이유).
      if (gate.cancelGeneration() !== 합성전세대) {
        return gate.wasHumanStopSince(합성전세대) ? CANCELLED : undefined
      }
      // **앵커는 게이트 세대를 안 올린다.** runFlow 의 `isCancelled` 가 뒤 단계의 예약
      // 시각을 보고 true 를 낼 뿐이라, 위 세대 비교만으로는 못 잡는다 — 그래서 합성 중에
      // 앵커가 지나가면 재생 지시가 그대로 나갔다(Codex 재현, 2026-09-11 EV-004591).
      // 이 경우는 **이 단계만 건너뛴다**(흐름은 이어간다).
      if (isCancelled && isCancelled()) return undefined

      // 재생 지시 **직전**에 취소 세대를 읽는다 — 그 뒤로 취소가 있었다면 대기가 등록되지
      // 않고 곧바로 'cancelled' 로 답한다(broadcastGate.js:130-140 의 계약, P-54 와 같다).
      audioToken = crypto.randomBytes(8).toString('hex')
      sinceGen = gate.cancelGeneration()
      broadcastSSE('scheduled_broadcast', {
        title: step.label || 'TTS', content: text, target: '전체', audioId, bgm: null,
        ttsVolume: stepVolume,
        token: audioToken,   // 실제 종료를 알려 달라는 표시(P-50)
        cues,
      })
    } finally {
      if (tmpFile) deleteTmpFile(tmpFile)
    }
    // **실제 종료 신호를 먼저 본다**(P-50). 예전엔 이 자리에서 글자수 추정만큼 그냥 잤고,
    // 화면이 보내 준 종료 신호는 등록한 사람이 없어 그대로 버려졌다 — 음원·영상 단계가
    // 2026-08-31에 이미 고친 것과 **같은 문제를 흐름 TTS 만 안 고친 상태**였다.
    //
    // 추정은 이제 **대기 시간이 아니라 상한**이다. 화면이 없거나 자동재생이 막히면 아무도
    // 안 알려주는데, 그때 영영 멈추면 그 방송이 통째로 죽는다. 어느 쪽으로도 나빠지지 않는다:
    //   · 화면이 알려주면 → 추정보다 일찍 끝나 빈 시간이 사라진다
    //   · 아무도 안 알려주면 → 예전과 똑같이 추정만큼 기다린다
    // 'preempted'(뒤 단계의 예약 시각)는 여기서 안 가른다 — 음원·영상과 같은 모양으로,
    // 앵커 처리는 runFlow 의 루프가 한다. 여기서 CANCELLED 로 올리면 앵커 건너뜀이
    // 흐름 전체 중단이 되어 남은 단계가 통째로 사라진다.
    const reason = await waitForMediaEnd('audio', audioToken, estimateTtsDurationMs(text), isCancelled, sinceGen)
    if (reason === 'cancelled') return CANCELLED
    if (reason === 'timeout') {
      console.warn(`[방송흐름] "${step.label || 'TTS'}" 종료 신호를 못 받아 추정 상한까지 기다렸습니다.`)
    }
    return
  }

  // BGM 재생목록 — config.playlist(배열)가 있으면 순서대로 곡을 전환, 없으면(구버전 저장분)
  // 기존처럼 config 자체를 단일 곡 설정으로 취급한다(하위호환). 재생목록의 마지막 곡은
  // 기존 단일 BGM 스텝과 동일하게 대기 없이 계속 재생되게 두고(백그라운드에서 계속 흐름),
  // 마지막이 아닌 곡만 duration_sec만큼 대기한 뒤 다음 곡으로 넘어간다.
  if (step.step_type === 'bgm') {
    const items = Array.isArray(config.playlist) && config.playlist.length
      ? config.playlist
      : [{ bgm_type: config.bgm_type, bgm_value: config.bgm_value, bgm_title: config.bgm_title, bgm_delay: config.bgm_delay }]

    for (let i = 0; i < items.length; i++) {
      if (isCancelled?.()) return
      const item = items[i]
      // 흐름 스텝도 config.bgm_volume으로 이 재생만의 볼륨을 가질 수 있다(없으면 시스템 기본값)
      const resolved = await resolveBGM(db, { ...item, bgm_enabled: 1, bgm_volume: item.bgm_volume ?? config.bgm_volume })
      if (!resolved) continue
      // 신호는 bgmEmit 하나가 낸다(이 PC 의 방송용·식사용 폴더 곡).
      require('./bgmEmit').emitBGM(resolved)
      await cancellableSleep((Number(item.bgm_delay) || 5) * 1000, isCancelled)
      const isLast = i === items.length - 1
      if (!isLast) {
        const playMs = Math.max(0, Number(item.duration_sec) || 0) * 1000
        if (playMs > 0) await cancellableSleep(playMs, isCancelled)
      }
    }
    return
  }

  // 음원 재생목록 — config.playlist(audio_files id 배열)를 순서대로 **끝까지 재생한 뒤** 다음 곡.
  // 곡이 실제로 끝나는 시점에 다음 곡을 쏘므로 사이에 빈 시간이 생기지 않는다. 두 번째 곡부터는
  // gapless를 실어서 화면이 페이드아웃 1.2초 + 시작 지연 1.3초를 건너뛰게 한다(한 단계 안에서
  // 이어 붙이는 재생이라 이미 앞 곡이 끝나 있어서 페이드할 대상 자체가 없다).
  if (step.step_type === 'audio') {
    const ids = Array.isArray(config.playlist) && config.playlist.length
      ? config.playlist
      : (config.audio_file_id ? [config.audio_file_id] : [])
    let played = 0
    for (const id of ids) {
      if (isCancelled?.()) return
      const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
      if (!file) continue
      const token = crypto.randomBytes(8).toString('hex')
      // 재생을 지시하기 **직전** 세대를 읽어 둔다 — 지시와 대기 등록 사이의 틈에 취소가
      // 들어와도 놓치지 않는다(그 틈에서 취소를 놓치면 새 방송 위로 다음 곡이 나간다).
      const sinceGen = gate.cancelGeneration()
      broadcastSSE('prayer_play', {
        url: `/audio/${file.category}/${file.filename}`,
        name: file.original_name,
        token,
        restoreBGM: false,
        volume: stepVolume,
        gapless: played > 0,
        audioFileId: file.id,   // 화면이 잰 재생시간을 돌려보낼 수 있게(audio-ended)
        rate,
      })
      played++
      const capMs = audioWaitCapMs(file, rate)
      const reason = await waitForMediaEnd('audio', token, capMs, isCancelled, sinceGen)
      // 정지 버튼을 눌렀거나 다른 방송이 시작된 것이다 — 남은 곡을 그 위에 얹으면 안 된다.
      if (reason === 'cancelled') return CANCELLED
      // 상한까지 갔다는 건 종료 신호를 못 받았다는 뜻이다(현장 PC 화면이 안 떠 있는 등).
      // 조용히 넘어가면 뒤 단계가 통째로 밀려도 아무도 모른다 — 로그로 남긴다.
      if (reason === 'timeout') {
        console.warn(`[방송흐름] "${file.original_name}" 종료 신호를 못 받아 상한 ${Math.round(capMs / 1000)}초까지 기다렸습니다.`)
      }
    }
    return
  }

  // (예전 step_type 'video' = 외부 동영상 TV 송출 단계는 2026-09-21 걷어냈다 — 저장된 것은 첫 부팅 보정이 지운다.)

  // 업로드 영상 재생목록 — scheduler.js의 broadcast_type==='video'와 같은 video_play SSE 경로.
  // 파일 자체 재생시간으로 자동 전환(음원과 동일한 방식).
  if (step.step_type === 'video_file') {
    // 항목마다 배속·소리를 따로 둘 수 있다(2026-09-01). 값이 없는 항목은 단계 설정을 따르고,
    // 옛 저장분(파일 id 배열)은 전부 값이 없는 항목으로 읽히므로 동작이 그대로다.
    const items = normalizePlaylistItems(config.playlist).length
      ? normalizePlaylistItems(config.playlist)
      : normalizePlaylistItems(config.audio_file_id ? [config.audio_file_id] : [])
    for (const entry of items) {
      if (isCancelled?.()) return
      const { id, volume: itemVolume, rate: itemRate } = resolvePlaylistItem(entry, { volume: stepVolume, rate })
      const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
      if (!file) continue
      const token = crypto.randomBytes(8).toString('hex')
      // 음원 단계와 같은 이유(재생 지시와 대기 등록 사이의 틈) — 지시 직전 세대를 읽어 둔다.
      // 이 가드가 음원에만 있고 여기엔 빠져 있어서, 영상 단계에서만 그 레이스가 남아 있었다.
      const sinceGen = gate.cancelGeneration()
      broadcastSSE('video_play', {
        url:      `/audio/${file.category}/${file.filename}`,
        source:   'file',
        videoId:  null,
        name:     file.original_name,
        token,
        category: file.category,
        volume:   itemVolume,
        audioFileId: file.id,
        rate:     itemRate,
      })
      // 음원과 같은 이유로 실제 종료를 기다린다 — 화면이 video-ended로 알려준다.
      // 상한도 **그 항목의 배속**으로 잰다 — 0.5배로 트는 영상은 두 배로 걸린다.
      const capMs = audioWaitCapMs(file, itemRate)
      const reason = await waitForMediaEnd('video', token, capMs, isCancelled, sinceGen)
      if (reason === 'cancelled') return CANCELLED   // 음원과 같은 이유
      if (reason === 'timeout') {
        console.warn(`[방송흐름] "${file.original_name}" 영상 종료 신호를 못 받아 상한 ${Math.round(capMs / 1000)}초까지 기다렸습니다.`)
      }
    }
    return
  }
}

// ── 단계별 "예약 시각"(config.at_time) ────────────────────────
// 시각이 중요한 방송(저녁식사 안내 등)은 앞 단계가 늘어져도 제 시각에 나가야 한다.
// 규칙은 둘뿐이다.
//   이르면 기다린다 — 그 시각 전에 도착하면 시각이 될 때까지 대기한다.
//   늦으면 끊는다   — 그 시각이 됐는데 앞 단계가 아직이면 끊고 이 단계부터 시작한다(사이 단계는 건너뜀).

function stepConfig(step) {
  return typeof step?.config === 'string' ? JSON.parse(step.config || '{}') : (step?.config || {})
}

// 'HH:MM' → 기준 시각(nowMs)과 같은 날의 그 시각. 형식이 아니면 null.
// 잘못 적은 값이 방송을 끊으면 안 되므로 엄격하게 본다("25:00", "오후 다섯시" 등은 전부 null).
function anchorTimeMs(step, nowMs) {
  const raw = String(stepConfig(step).at_time || '').trim()
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw)
  if (!m) return null
  const d = new Date(nowMs)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}

// fromIndex 이후 단계 중 **아직 오지 않은** 첫 예약 시각. 이미 지난 시각은 무시한다 —
// 흐름이 늦게 시작됐다는 이유로 앞 단계를 전부 건너뛰어버리면 그게 더 큰 사고다.
function nextAnchor(steps, fromIndex, nowMs) {
  for (let i = Math.max(0, fromIndex); i < steps.length; i++) {
    const at = anchorTimeMs(steps[i], nowMs)
    if (at !== null && at > nowMs) return { index: i, atMs: at }
  }
  return null
}

async function sleepUntil(atMs, nowMs, shouldAbort) {
  while (nowMs() < atMs) {
    if (shouldAbort?.()) return
    await sleep(Math.min(1000, Math.max(50, atMs - nowMs())))
  }
}

// 흐름 1건 실행 — 예약이 broadcast_type='flow'로 발동될 때 scheduler.js의 fireSchedule에서 호출
// opts.nowMs: 시계 주입(기본 Date.now). 예약 시각은 분 단위라 테스트가 실제로 몇 분을 기다리지
// 않도록 열어둔 구멍이며, 운영 경로는 기본값을 그대로 쓴다.
async function runFlow(db, flowSequenceId, opts = {}) {
  const nowMs = opts.nowMs || Date.now
  const rate = opts.rate ?? null
  // 흐름 시작 시점의 취소 세대 — 이후 정지 버튼·새 방송 시작(cancelCurrentBroadcast)이
  // 있었는지를 모든 단계가 이 하나로 관측한다. 예전엔 음원·영상 단계만 (resolver 배관으로)
  // 취소를 봐서, 차임·딜레이·TTS·BGM 대기와 자기 앵커(at_time) 대기 중에는 정지를 눌러도
  // 대기를 끝까지 채우고 남은 단계를 새 방송 위로 진행했다.
  const flowGen = gate.cancelGeneration()
  const cancelledSinceFlowStart = () => gate.cancelGeneration() !== flowGen
  if (runningFlows.has(flowSequenceId)) {
    console.log(`[방송흐름] flow_sequence_id=${flowSequenceId} 이미 실행 중 — 중복 실행 스킵`)
    return 'skipped'
  }
  runningFlows.add(flowSequenceId)
  try {
    const steps = db.prepare('SELECT * FROM flow_sequence_steps WHERE flow_sequence_id = ? ORDER BY sort_order ASC')
      .all(flowSequenceId)

    let failedSteps = 0   // 흐름 이력까지 올릴 실패 수. 차임은 연속 3회째부터만 여기 들어온다
    // ── P-51: **브라우저가 내야 할 소리가 있었는데 낼 창이 없었나** (사용자 승인 2026-09-10)
    // 예약 5경로는 `hasSitePlayer()` 를 보는데 흐름만 안 봤다 — 재생 창이 하나도 없어도
    // `completed` → `SUCCEEDED` 였다. 아무도 못 들은 방송이 이력에 성공으로 남는다.
    // 그대로 얹으면 안 된다: 흐름은 서버 스피커 단계와 브라우저 단계가 섞인 컨테이너라,
    // **차임만 있는 흐름은 창이 없어도 멀쩡히 울린다.** 그래서 단계별로 가른다
    // (`domain/stepPlayer` 가 그 표의 단일 출처다).
    // **판정 시점은 그 단계를 내보내는 순간**이다 — 흐름은 수십 분 걸릴 수 있어, 끝난 뒤에
    // 물으면 중간에 창이 닫혔다 열린 경우를 놓친다.
    let 화면없이나간단계 = 0
    let i = 0
    while (i < steps.length) {
      const step = steps[i]

      // 지금 몇 번째 단계인지 화면에 알린다 — 자동방송 5종(broadcastSequencer)과 같은 이벤트다.
      // 흐름만 조용하면 사람은 커스텀 자동순서가 고장 난 줄 안다. 알리려다 흐름을 멈추면
      // 본말전도라 던지지 않는다.
      //
      // **예약 시각 대기보다 먼저 알린다.** 자동방송이 "실행 전에 알린다"를 불변식으로 잡고
      // 있는데 흐름만 대기 뒤에 알리면, 예약 시각까지 몇 시간을 기다리는 동안 모니터링
      // 화면이 이미 끝난 단계를 계속 가리킨다.
      try {
        broadcastSSE('broadcast_step', {
          title:  opts.title || '방송 흐름',
          stepId: step.id ?? null,
          label:  step.label || step.step_type || '',
          index:  i + 1,
          total:  steps.length,
        })
      } catch (e) {
        console.error('[방송흐름] 단계 알림 실패:', e.message)
      }

      // 이 단계에 예약 시각이 있고 아직 안 됐으면 그때까지 기다린다
      const own = anchorTimeMs(step, nowMs())
      if (own !== null && own > nowMs()) {
        console.log(`[방송흐름] "${step.label || step.step_type}" — ${stepConfig(step).at_time}까지 대기`)
        await sleepUntil(own, nowMs, cancelledSinceFlowStart)
        if (cancelledSinceFlowStart()) {
          console.log('[방송흐름] 정지 요청 또는 다른 방송 시작 — 남은 단계를 진행하지 않습니다')
          return 'cancelled'
        }
      }

      // 뒤에 예약 시각이 있으면 그 시각이 이 단계의 마감이 된다.
      // 취소 세대도 함께 본다 — 앵커 도달은 "다음 앵커 단계로 건너뜀"(cutShort), 취소는
      // "흐름 전체 중단"으로 아래에서 갈라 처리한다.
      const upcoming = nextAnchor(steps, i + 1, nowMs())
      let cutShort = false   // 마감에 걸려 **실제로 잘렸는지**(제 시간에 끝났으면 false)
      const isCancelled = () => {
        if (cancelledSinceFlowStart()) return true
        if (upcoming && nowMs() >= upcoming.atMs) { cutShort = true; return true }
        return false
      }

      // 단계별 실행 기록(0021) — 흐름도 자동방송과 같은 표에 남는다. 어느 단계에서 멎었는지
      // 흐름에서도 물을 수 있어야 한다(흐름은 단계가 더 길어질 수 있어 오히려 더 필요하다).
      const stepStartedAt = Date.now()
      // isStopped 는 isCancelled 와 다르다 — isCancelled 는 **앵커 도달**(다음 예약 시각)까지
      // 포함하고, isStopped 는 사람의 정지·다른 방송의 끼어들기만 본다. 차임이 울렸는지를
      // 가를 때는 뒤엣것만 봐야 한다(앵커는 차임이 이미 나간 뒤 넘어가는 것이다).
      // 내보내기 **직전**에 묻는다(P-51). 이 단계가 화면이 있어야 소리가 나는 종류인데
      // 지금 살아 있는 로컬 창이 하나도 없으면, 그 소리는 아무 데서도 안 난다.
      if (화면이필요한가(step.step_type) && !hasSitePlayer()) {
        화면없이나간단계 += 1
        console.warn(`[방송흐름] "${step.label || step.step_type}" — 재생할 창이 없습니다. 이 단계는 소리가 안 납니다`)
      }
      const stepResult = await runStep(db, step, { isCancelled, isStopped: cancelledSinceFlowStart, rate })
      const stepEndedAtMs = nowMs()   // 앵커를 넘겨서까지 돌았는지 판정하는 근거(CC-047)
      // 차임 실패는 단계 이력에만 남긴다. **연속 3회차**째부터 흐름 이력까지 올린다(사용자 결정 2026-09-07).
      // 이번 실패는 아래 record() 로 들어가므로 아직 표에 없다 — 회차 열쇠를 넘겨 함께 세게 한다.
      if (stepResult === CHIME_FAILED) {
        const streak = chimeFailStreak(
          db, `흐름#${flowSequenceId}`, step.label || step.step_type, currentRunId())
        if (streak >= CHIME_FAIL_PROMOTE) {
          failedSteps += 1
          console.error(`[방송흐름] 차임벨이 연속 ${streak}회차 실패했습니다 — 이 흐름 이력을 실패로 올립니다`)
        }
      }
      require('../domain/stepHistory').record(db, {
        // 흐름 이름은 이 함수가 안 들고 있다 — 이름을 새로 조회하느니 id로 남긴다.
        // 화면이 펼칠 때 이름은 flow_sequences에서 붙이면 된다(2단계 갈래).
        title: `흐름#${flowSequenceId}`, step: { label: step.label || step.step_type },
        // **흐름은 취소도 이력에 남긴다** — `이력판정` 은 취소에 `null`(적지 않는다)을 주므로
        // 그 함수를 통째로 태우면 정지 기록이 사라진다(ISSUE-010 이 만든 규칙). 그래서 여기서는
        // 흐름의 규칙을 그대로 두고, **빠져 있던 `모름` 만 더한다**(RB-01).
        result: (stepResult === CANCELLED || stepResult === CHIME_FAILED) ? '실패' : '성공',
        ms: Date.now() - stepStartedAt,
        // 문구는 `domain/stepHistory` 의 `사유문구` 정본을 쓴다 — 여기 베껴 적으면
        // 세는 쪽(chimeFailStreak)과 어긋나 없는 장치 고장을 신고한다(P-57).
        // **`모름` 은 `성공` 으로 적히되 사유가 붙는다** — 그래야 `차임정상인가` 가 이것을
        // "실제로 울렸다" 로 안 읽고, 연속 실패가 안 끊긴다.
        detail: stepResult === CANCELLED ? 사유문구.정지
          : stepResult === CHIME_FAILED ? 사유문구.차임고장
            : stepResult === 단계사유.모름 ? 사유문구.결과모름
              : stepResult === 단계사유.안울림 ? 사유문구.안울림 : null,
      })
      if (stepResult === CANCELLED || cancelledSinceFlowStart()) {
        console.log('[방송흐름] 정지 요청 또는 다른 방송 시작 — 남은 단계를 진행하지 않습니다')
        return 'cancelled'
      }

      if (upcoming && nowMs() >= upcoming.atMs) {
        const target = steps[upcoming.index]
        const skipped = upcoming.index - i - 1
        console.log(`[방송흐름] ${stepConfig(target).at_time} 예약 시각 — ` +
          `${cutShort ? '진행 중이던 단계를 끊고 ' : ''}${skipped > 0 ? `${skipped}개 단계를 건너뛰고 ` : ''}` +
          `"${target.label || target.step_type}"부터 시작합니다`)
        // 끊긴 경우에만 소리를 정리한다. 제 시간에 끝난 단계까지 정지 신호를 쏘면
        // 계속 흐르라고 만든 BGM(마지막 곡은 일부러 안 끊는다)까지 같이 꺼진다.
        // 판정은 shouldStopBeforeAnchor가 한다 — cutShort만 보면 마지막 조각의 틈을 놓친다.
        if (shouldStopBeforeAnchor({ cutShort, stepEndedAtMs, anchorAtMs: upcoming.atMs })) {
          // auto: true — 이건 사람이 누른 정지가 아니라 흐름이 스스로 단계를 끊는 것이다.
          // 화면은 이 표로 "자동은 마이크 생방송을 안 끊는다"(td09 H10, 사용자 결정)를 지킨다.
          // 표가 없으면 마이크가 끊기고 "현장에서 정지 버튼을 눌러…"라는 거짓 문구까지 뜬다.
          // 나머지 소리(BGM·TV 송출·영상)는 지금까지처럼 정리된다 — 그게 이 신호의 목적이다.
          broadcastSSE('broadcast_stopped', { auto: true })
        }
        i = upcoming.index
        continue
      }
      i++
    }
    // 끝까지 왔다. 이 값이 이력 행을 "성공"으로 정정한다(scheduler → flowOutcome, CC-003).
    // 중간에 나간 경로는 전부 'cancelled'이고, 던진 경우는 호출부의 catch가 받는다.
    // 끝까지 갔어도 울리지 못한 단계가 있으면 다른 값이다 — outcomeOfFlow 가 'completed' 만 성공으로
    // 보므로 이력 행은 실패로 정산되고, scheduler 가 사유를 붙인다(ISSUE-009).
    //
    // **재생 창이 없던 쪽을 먼저 본다**(P-51). 차임 연속 실패보다 "아무도 못 들었다"가
    // 사람이 먼저 알아야 하는 사실이다. 어느 단계였는지는 단계 이력과 위 경고 로그에 있다.
    // 차임만 있는 흐름은 여기 안 걸린다 — `화면이필요한가` 가 서버 스피커 단계를 세지 않는다.
    if (화면없이나간단계 > 0) return 'completed_no_player'
    return failedSteps > 0 ? 'completed_with_failures' : 'completed'
  } finally {
    runningFlows.delete(flowSequenceId)
  }
}

module.exports = {
  runFlow, runStep, estimateTtsDurationMs, audioWaitCapMs, anchorTimeMs, nextAnchor, shouldStopBeforeAnchor,
  // 차임 연속 실패 세기는 **테스트가 진짜 함수를 부르라고** 내보낸다 — 질의를 테스트에
  // 옮겨 적었더니 원본이 바뀌어도 재현이 옛 코드를 흉내 내고 있었다(P-49 재현 파일의 3번 검사).
  chimeFailStreak, CHIME_FAIL_PROMOTE,
  CANCELLED, CHIME_FAILED }
