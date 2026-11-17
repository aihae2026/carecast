const { spawn } = require('child_process')
const path      = require('path')
const os        = require('os')
const fs        = require('fs')
const { hardwareDisabled, noticeOnce } = require('./hardwareMode')
const audioBackend = require('./audioBackend')
const { waveOutEnv } = require('./audioDevices')

function getPython() {
  // ensurePythonPath = 캐시가 있으면 그대로, 없으면 **다시 찾는다**(ISSUE-003).
  // getPythonPath(캐시만 읽음)를 쓰면, 0xC0000142로 경로를 버린 뒤 다음 차임이 재탐색 없이
  // 그냥 실패한다 — 회복이 "다른 기능이 우연히 TTS를 부를 때까지" 미뤄진다(검수 EV-001097).
  try { return require('./tts').ensurePythonPath() } catch { return null }
}

// 차임벨은 안내 음성과 같은 채널을 쓴다(지금까지의 동작 유지). 0~1로 넘긴다.
function getBroadcastVolume() {
  try {
    const { getDB } = require('../db/schema')
    const { readVolume } = require('../domain/volume')
    return readVolume(getDB(), 'tts') / 100
  } catch { return 0.8 }
}

// 고정 스크립트 파일 (tmpdir 아님 — V3 백신 차단 방지)
const CHIME_SCRIPT = path.join(__dirname, 'carecast_chime.py')

// 차임 하나가 몇 초를 넘길 이유가 없다. 넘으면 매달린 것이다(CC-019 주석 참고).
const CHIME_TIMEOUT_MS = 30 * 1000

/**
 * **이 상한이 걸리는 단계 수** — 한 번의 `playChime` 이 최악에 몇 배까지 걸릴 수 있나.
 *
 * `watchChild` 는 **프로세스마다** 상한을 건다. 윈도우는 합성과 재생을 한 프로세스에서
 * 하지만(WaveOut), **그 밖의 플랫폼은 둘로 나뉜다** — 캐시가 없으면 합성 프로세스를
 * 돌리고(최대 30초) 그 뒤 재생 프로세스를 돌린다(다시 최대 30초).
 *
 * 그래서 한 번의 차임이 **최악 60초**다. 이 값을 밖으로 내는 이유(V③ UI-0915-R3 지적):
 * `routes/mic.js` 가 겹침 잠금을 **이것보다 길게** 잡아야 하는데, 앞 판은 40초로
 * 손으로 적어 두고 *"재생기 상한(30초)보다 길다"* 고 적었다. **한 단계만 세고 있었다.**
 * 합성이 25초 걸린 날 잠금이 먼저 풀려 다음 차임이 앞 재생과 겹친다.
 * 숫자를 베끼지 말고 **여기서 가져다 곱하라**는 뜻이다.
 */
const CHIME_MAX_STAGES = 2

// 이 시스템이 실제로 낼 수 있는 차임음. carecast_chime.py의 PATTERNS와 같아야 한다
// (chime-types.test.js가 두 목록을 붙여 둔다).
const CHIME_TYPES = ['general', 'end']

// 모르는 유형을 조용히 general로 접으면 오타가 소리로 드러나지 않는다. 실제로 scheduler와
// flowRunner가 오래도록 'meal'을 넘기고 있었는데, 여기서 말없이 general이 되는 바람에
// "소리는 나니까" 아무도 눈치채지 못했다. 재생은 계속하되(방송이 아예 안 나가는 것보다 낫다)
// 로그로 드러낸다.
function normalizeChimeType(type) {
  if (CHIME_TYPES.includes(type)) return type
  console.warn(`[차임벨] 모르는 차임 유형 "${type}" — general로 재생한다. 아는 유형: ${CHIME_TYPES.join(', ')}`)
  return 'general'
}

// volumePct: 이 울림에만 쓸 볼륨(0-100). null이면 시스템 기본값.
//
// 파형을 만드는 것과 소리를 내보내는 것은 다른 일이다. 합성은 어디서나 되고(순수 파이썬),
// 내보내기만 플랫폼을 탄다. 예전에는 둘이 붙어 있어서 **맥에서 차임이 통째로 안 났다** —
// `carecast_chime.py`가 맨 윗줄에서 `ctypes.windll`을 만지다 import부터 죽었다.
//
//   Windows : 파이썬이 합성 → WaveOut으로 그 자리에서 재생 (현장 PC, 기존 그대로 · 한 프로세스)
//   그 외   : 파이썬이 합성 → WAV로 저장 → audioBackend가 만든 명령으로 재생 (두 프로세스)
const IS_WINDOWS = process.platform === 'win32'

// onDone(ok: boolean) — 이 울림이 실제로 재생됐는지(ISSUE-002). scheduler.js는 이 콜백으로
// 이력을 RUNNING → SUCCEEDED/FAILED로 정산한다(flowOutcome.settleLog). 그 외 네 호출자
// (flowRunner.js:137·routes/tts.js:143,157·routes/mic.js:47)는 이 인자를 안 넘기므로
// 그대로 동작한다 — 결과를 원하는 쪽만 세 번째 인자를 넘겨 받아가는 형태다.
// 콜백이 던지면 재생 자체가 끊기면 안 되므로 여기서 감싸 삼킨다.
/**
 * @param {boolean} ok       재생 **실패가 아닌가**
 * @param {boolean} [안울림] **일부러 안 냈나**(하드웨어 꺼짐). `ok` 는 그대로 `true` 다 —
 *   실패가 아니니까. 그런데 부르는 쪽이 `true` 를 **"울렸다"** 로 읽어 차임 연속 실패를
 *   끊었다(RB-01-R2, Codex 소급 검수 2026-09-11). 현장에 `CARECAST_NO_HARDWARE=1` 이
 *   남는 사고(2026-09)가 나면 **차임이 안 울리는데 경보도 안 온다** — 둘이 겹치면 아무도 모른다.
 *   그래서 **여기서 알려 준다.** 부르는 쪽이 환경변수를 스스로 읽어 추측하면, 재생기를
 *   스텁으로 갈아끼운 자리에서 그 추측이 빗나간다(실제로 그렇게 틀렸다).
 *   두 번째 인자를 안 보는 기존 호출부는 그대로 동작한다.
 */
function callDone(onDone, ok, 안울림 = false) {
  if (!onDone) return
  try { onDone(ok, 안울림) } catch (e) { console.error('[차임벨] 결과 콜백 오류:', e.message) }
}

/**
 * **부수 차임**(안내방송에 딸려 나가는 시작음·종료음)을 지금 울려도 되나.
 *
 * 사용자 결정 2026-09-13: *"차임벨은 BGM 없을 경우에만 시행하는 걸로 하지 뭐"* ·
 * *"BGM 이 나가고 있을 때 TTS 넣으면 차임벨 넣으면 안 되겠지?"* — 맞다.
 * BGM 이 깔려 있는데 그 위에 차임까지 때리면 소리가 셋(BGM·차임·안내)이 겹친다.
 * 차임의 쓰임은 *"이제 방송이 나갑니다"* 인데, BGM 이 이미 그 신호를 하고 있다.
 *
 * **명시적으로 부탁한 차임에는 안 건다.** 적용 범위는 «안내방송에 딸려 나가는 차임» 뿐이다:
 *   · 걸린다  — 즉시 TTS 방송의 시작음·종료음(`routes/tts.js`)
 *   · 안 걸린다 — 예약 유형 `chime`(사람이 «차임벨» 이라고 예약한 것, `scheduler.js`)
 *   · 안 걸린다 — 흐름의 「차임벨」 단계(사람이 순서에 끼워 넣은 것, `flowRunner.js`)
 *   · 안 걸린다 — 마이크 방송(`routes/mic.js`)
 * 사람이 «차임벨을 울려라» 라고 적어 둔 것을 조용히 삼키면, 그 예약은 **아무 일도 안 하는
 * 예약**이 된다. 이 저장소가 가장 경계하는 조용한 실패다.
 *
 * @returns {string|null} 막혔으면 **왜 막혔는지 한 문장**, 울려도 되면 `null`.
 *   불리언이 아니라 문장을 주는 이유: 부르는 쪽이 이력·로그에 그대로 적어야 하기 때문이다.
 *   "안 울렸다"만 남기면 고장인지 규칙인지 나중에 아무도 못 가른다.
 */
function 부수차임막힘() {
  let bgm
  // 못 읽어도 방송은 그대로 나가야 한다 — 차임 규칙 하나 때문에 안내를 막지 않는다.
  // 배경음악 상태는 nowPlaying.bgm 하나다 — 자동방송 BGM 은 서버가, 홈 「배경음방송」은 현장 화면의
  // 재생기가 알려 온다(2026-09-21 외부 연동 제거 전에는 수동 BGM 이 따로 저장소를 가졌다).
  try { bgm = require('./nowPlaying').get().bgm } catch { return null }
  if (!bgm) return null
  const 이름 = String(bgm.title || '').trim()
  const 꼬리 = 이름 ? ` (${이름})` : ''

  return `BGM 이 나가는 중이라 차임벨은 건너뜁니다${꼬리}`
}

/**
 * @param {Function} [onStart] 소리가 **실제로 나가기 시작한 순간** 불린다(Windows 재생 경로만).
 * @returns {boolean} `onStart` 를 부를 수 있는 경로면 true — 부르는 쪽이 「시작 신호를 더 기다릴지」 정한다.
 */
function playChime(type = 'general', volumePct = null, onDone = null, onStart = null) {
  // 테스트·하드웨어 접근 없음 모드에서는 실제 스피커를 울리지 않는다 — 스텁을 빠뜨린
  // 테스트 하나가 개발 PC에서 진짜 차임을 울렸다(2026-08-30, no-sound-in-tests.test.js).
  // 하드웨어를 끈 것은 재생 실패가 아니다 — 의도적으로 안 낸 것이라 true로 알린다.
  if (hardwareDisabled()) { noticeOnce('차임벨'); callDone(onDone, true, true); return false }
  const python = getPython()
  if (!python) { callDone(onDone, false); return false }

  const t   = normalizeChimeType(type)
  const vol = resolveChimeVolume(volumePct)

  if (IS_WINDOWS) {
    if (!상주로울리기(t, vol, onDone, onStart)) playViaWaveOut(python, t, vol, onDone, onStart)
    return typeof onStart === 'function'
  }
  playViaFile(python, t, vol, onDone)
  return false
}

// 차임 뒤 대기 규칙은 `chimeTiming.js` 에 있다(시험이 이 모듈을 통째로 가짜로 바꿔 끼우므로 분리).

// 자식 프로세스 하나를 감시하는 공통부 — on('error')와 제한시간을 빠뜨리지 않기 위해 한 곳에 둔다.
//
// on('error')가 없으면 실행 실패(ENOENT 등)가 그대로 던져져 **서버 프로세스가 죽는다.**
// Windows 업데이트로 Python 경로가 바뀌면 부팅 때 캐시해 둔 옛 경로로 spawn하게 되는데,
// 그 순간 진행 중이던 방송 시퀀스까지 통째로 사라진다(last_fired는 이미 찍혀 재발동도 없음).
// 차임벨 하나 못 울리는 것과 서버가 죽는 것은 전혀 다른 사고다.
//
// 제한시간 (CC-019와 같은 실패 모드). 차임은 대기열이 없어 자기는 안 막히지만,
// **매달린 차임이 오디오 장치를 붙잡고 있으면 그다음 재생이 매달린다** —
// 그게 audioQueue를 통째로 굳게 만드는 유력한 원인이다.
// 차임은 길어야 몇 초라 30초면 정상 재생을 절대 안 건드린다.
function watchChild(what, cmd, args, onDone, extraEnv = null, onStart = null) {
  const proc = spawn(cmd, args,
    { stdio: onStart ? ['ignore', 'pipe', 'ignore'] : 'ignore', ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}) })
  proc.on('error', e => console.error(`[차임벨] ${what} 프로세스 실행 실패:`, e.message))
  // 시작 신호 — 줄을 끝까지 읽어 파이프가 차서 멈추는 일이 없게 한다.
  if (onStart && proc.stdout) {
    let 받음 = ''
    proc.stdout.on('data', (b) => {
      if (받음 === null) return
      받음 += String(b)
      if (받음.includes('CHIME_PLAYING')) { 받음 = null; try { onStart() } catch { /* 알림 실패가 재생을 막지 않는다 */ } }
    })
  }

  const timer = setTimeout(() => {
    console.warn(`[차임벨] ${what}이 ${CHIME_TIMEOUT_MS / 1000}초 안에 안 끝나 중단합니다 — 오디오 장치를 붙잡고 있을 수 있습니다`)
    try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
  }, CHIME_TIMEOUT_MS)

  proc.on('close', (code) => { clearTimeout(timer); if (onDone) onDone(code) })
}

// Windows — 합성과 재생이 한 프로세스 안에서 끝난다 (기존 경로 그대로)
//
// **설정된 출력 장치로 낸다.** 이걸 안 넘기면 차임벨만 기본 장치로 나가서, 안내 음성은
// 스피커로 차임은 딴 데로 갈라진다. 현장에서는 감시기(audioDeviceWatcher)가 2분마다
// 기본 장치를 설정값으로 되돌려 놔서 지금껏 안 드러났을 뿐이다 — 누가 장치를 바꾼 뒤
// 다음 점검까지의 2분이 그 구멍이고, 감시기가 안 도는 PC에서는 늘 열려 있다.
// 차임 파형 캐시 — carecast_chime.py 가 남기는 원시 16비트 PCM 과 **같은 이름**이다(임시 폴더 · 유형 · 볼륨 세 자리).
function pcm캐시경로(t, vol) {
  const tag = String(Math.round(vol * 100)).padStart(3, '0')
  return path.join(os.tmpdir(), `carecast_chime_pcm_${t}_${tag}.raw`)
}
const 차임샘플수 = Math.round(44100 * 3.5)   // carecast_chime.py: 마지막 음 1.0초 + 여운 2.5초

// **먼저 상주 플레이어로** — 새 프로세스를 안 띄운다(설치판 백신 검사 지연, 2026-09-17). 울렸으면 true.
// 파형이 없거나 플레이어가 준비 전이면 false — 부르는 쪽이 예전 길(playViaWaveOut: 파이썬을 띄워 합성·재생, 파형도 남긴다)로 간다.
// **성공은 「그 3.7초 동안 플레이어에 사고가 없었다」로 판정한다**(2026-09-26 Codex 검수 High). 상주 플레이어는
// 차임마다 결과를 돌려주지 않는다. 예전엔 무조건 성공을 알려, 도중에 플레이어가 죽거나(장치 변경으로 내려감)
// PLAY_ERROR 가 나도 예약 로그가 성공이었다. 사고 수(종료 + PLAY_ERROR)를 앞뒤로 견줘 늘었으면 실패다.
// **울리는 중이면 두 번째 차임은 울리지 않고 곧바로 실패로 알린다**(사용자 결정 2026-09-26 「가」, Codex 교차검수 1~3회차).
// 파이썬은 같은 핸들에 줄 세워 앞 차임 뒤에 울리는데 — 넘긴 뒤 3.7초에 판정하면 뒤 차임의 사고를 못 보고(1회차),
// 예전 길(playViaWaveOut)로 돌리면 장치 실패도 exit 0 이라 무음이 성공이 되고(2회차, TODO T-36),
// 줄 뒤에 세우면 늦은 실패를 흐름이 못 받고 줄이 길면 안내가 차임보다 먼저 나갔다(3회차).
// 그래서 **true 를 돌려주고(예전 길로 안 감) 다음 틱에 실패를 알린다** — 흐름이 결과를 확정(약 3초)하기 전에 닿는다.
// 시작 신호는 보내지 않는다(안 울린 차임이다). 안내는 기본 대기 뒤 차임 없이 나간다.
let 상주차임끝 = 0   // 상주 플레이어가 지금 울리는 차임이 끝나는 시각
function 상주로울리기(t, vol, onDone = null, onStart = null) {
  if (Date.now() < 상주차임끝) {
    console.warn(`[차임벨] 앞 차임이 울리는 중이라 이번 차임(${t})은 울리지 않았습니다 — 실패로 기록합니다`)
    setImmediate(() => callDone(onDone, false))
    return true
  }
  const ap = require('./audioPlayer')
  const 사고수 = () => (typeof ap.재생사고수 === 'function' ? ap.재생사고수() : 0)
  const 길이ms = Math.round(차임샘플수 / 44.1) + 200
  let 앞
  try {
    const raw = fs.readFileSync(pcm캐시경로(t, vol))
    앞 = 사고수()
    if (raw.length !== 차임샘플수 * 2 || !require('./audioPlayer').playPcm16(raw, 44100)) return false
  } catch { return false }   // 파형이 아직 없다
  상주차임끝 = Date.now() + 길이ms
  if (typeof onStart === 'function') { try { onStart() } catch { /* 알림 실패가 재생을 막지 않는다 */ } }
  setTimeout(() => {
    const 사고났다 = 사고수() !== 앞
    if (사고났다) console.error('[차임벨] 상주 플레이어가 차임 도중 멈추거나 재생 오류를 냈습니다 — 실패로 기록합니다')
    callDone(onDone, !사고났다)
  }, 길이ms)
  return true
}

// ── **서버 스피커를 못 열면 방송 화면이 대신 울린다** (사용자 결정 2026-09-26, TODO T-36 ③) ──────────────
// carecast_chime.py 는 장치를 못 열면 exit 3 이다(예전엔 exit 0 이라 무음이 성공이 됐다). 그때 현장 대표 창에
// `chime_fallback_play` 를 보내 브라우저가 울리게 하고(MusicPlayer), **방송 로그에 한 줄** 남긴다(사용자 지시 「기록 남기고」).
// **성공은 대표(담당) 창 하나로 판정한다**(2026-09-26 Codex 교차검수 T36 1·2회차 High). 실제로 울리는 것은 MusicPlayer 의
// 대표 창뿐이라, 그 창이 ① 있고 ② 살아 있고 ③ 「소리 못 냄」이 아니고 ④ 실제로 받았을 때만 성공이다(sse.담당에게보내기).
// 처음엔 「현장 연결이 있나」, 그다음엔 창 전체의 소리 가능·전체 전달 수를 봐서 /monitor 만 떠 있거나 대표 창만 못 받아도
// 성공으로 적었다. 하나라도 아니면 실패 쪽이다 — 대체 경로의 기록이라 무음을 성공으로 적는 쪽이 더 나쁘다.
const 장치못엶코드 = 3
// 대표 창 쓰기 완료 확인을 기다리므로 **비동기**다(3회차, 사용자 결정 「가」). 결과·기록·시작 신호는 확인 뒤에 나온다.
// 돌려주는 Promise 는 시험이 기다리는 용도다 — 부르는 쪽(playViaWaveOut)은 콜백으로 결과를 받는다.
function 장치못엶처리(t, vol, onDone = null, onStart = null) {
  let 보냄
  try {
    // 2회차: 창 전체가 아니라 **대표 창 하나**를 본다 — 담당에게보내기 가 그 창의 생존·소리 가능·쓰기 완료를 함께 확인한다.
    보냄 = Promise.resolve(require('./sse').담당에게보내기('chime_fallback_play', { type: t, volume: Math.round(vol * 100) }))
  } catch { 보냄 = Promise.resolve(false) }
  return 보냄.then((v) => v === true, () => false).then((울림) => 결과남기기(울림, onDone, onStart))
}
function 결과남기기(울림, onDone, onStart) {
  const BR = require('../domain/broadcastRecord')
  let db = null
  try { db = require('../db/schema').getDB() } catch { /* DB 를 못 열어도 소리 판단은 한다 */ }
  if (울림) {
    console.warn('[차임벨] 서버 스피커를 열지 못해 방송 화면(브라우저)으로 대신 울립니다')
    if (db) BR.시작기록(db, { type: '시스템', content: '차임벨 — 서버 스피커를 열지 못해 방송 화면(브라우저)으로 대신 울림', user: '시스템', target: '-' })
    if (typeof onStart === 'function') { try { onStart() } catch { /* 알림 실패가 결과를 바꾸지 않는다 */ } }
    callDone(onDone, true)
    return
  }
  console.error('[차임벨] 서버 스피커를 열지 못했고 소리 낼 방송 화면도 없어 울리지 못했습니다')
  if (db) {
    const id = BR.시작기록(db, { type: '시스템', content: '차임벨 — 서버 스피커를 열지 못했고 방송 화면도 없어 울리지 못함', user: '시스템', target: '-' })
    BR.실패로정정(db, id, '차임 장치 못 엶 + 방송 화면 없음', BR.사유.화면없음)
  }
  callDone(onDone, false)
}

function playViaWaveOut(python, t, vol, onDone = null, onStart = null) {
  watchChild('재생', python, [CHIME_SCRIPT, t, String(vol)], (code) => {
    if (code === 장치못엶코드) { 장치못엶처리(t, vol, onDone, onStart); return }
    if (code !== 0) console.error(`[차임벨] 재생 실패 (종료코드 ${code})`)
    // 파이썬이 **뜨질 못한** 경우(0xC0000142)는 그 경로가 못 쓰게 된 것이다 — 캐시를 버려
    // 다음 호출이 다시 찾게 한다(ISSUE-003). 이게 없으면 재시작 전까지 계속 실패한다.
    // 스크립트 오류(종료코드 1 등)는 여기 안 걸린다 — 경로는 멀쩡하므로 흔들지 않는다.
    try {
      const { isDllInitFailure, invalidatePythonPath } = require('./tts')
      if (isDllInitFailure(code)) invalidatePythonPath(`차임벨 재생이 종료코드 ${code}로 죽었습니다`)
    } catch { /* 회복 시도가 실패해도 이번 재생 결과는 그대로 알린다 */ }
    callDone(onDone, code === 0)
  }, waveOutEnv(), onStart)
}

// 같은 유형·같은 볼륨이면 파형이 완전히 같다. 합성이 1초 넘게 걸리므로(순수 파이썬 루프)
// 한 번 만든 것을 재사용한다 — 차임은 **뒤이을 안내 음성보다 먼저** 나야 의미가 있는데,
// 매번 1초씩 늦으면 그 신호 역할을 잃는다.
function cachedWavPath(t, vol) {
  const tag = String(Math.round(vol * 100)).padStart(3, '0')
  return path.join(os.tmpdir(), `carecast_chime_${t}_${tag}.wav`)
}

// 그 외(맥·리눅스) — 합성해서 WAV로 남기고, 재생은 audioBackend가 정한 명령에 맡긴다.
function playViaFile(python, t, vol, onDone = null) {
  const wav = cachedWavPath(t, vol)
  if (fs.existsSync(wav)) { playWav(wav, t, onDone); return }

  // 임시 이름으로 만든 뒤 rename — 차임이 연달아 울릴 때 반쯤 쓰인 파일을 재생하지 않는다.
  const partial = `${wav}.${process.pid}.${Date.now()}.part`
  watchChild('합성', python, [CHIME_SCRIPT, t, String(vol), partial], (code) => {
    if (code !== 0) {
      console.error(`[차임벨] 합성 실패 (종료코드 ${code}) — 이번 차임은 건너뜁니다`)
      try { fs.unlinkSync(partial) } catch { /* 없으면 무시 */ }
      callDone(onDone, false)
      return
    }
    try { fs.renameSync(partial, wav) } catch { /* 다른 호출이 먼저 만들었으면 그걸 쓴다 */ }
    playWav(fs.existsSync(wav) ? wav : partial, t, onDone)
  })
}

// 볼륨은 합성 단계에서 이미 파형에 실렸다. 재생에서 또 곱하면 두 번 줄어든다 — 그래서 100.
function playWav(wav, t, onDone = null) {
  let plan
  try {
    plan = audioBackend.buildPlayCommand({ mp3Path: wav, volumePct: 100 })
  } catch (err) {
    // 조용히 넘기면 "왜 차임이 안 울리지"가 미궁이 된다. 방송 자체는 계속 나가야 하므로 막지는 않는다.
    console.warn(`[차임벨] ${t} 재생 불가: ${err.message}`)
    callDone(onDone, false)
    return
  }
  watchChild('재생', plan.cmd, plan.args, (code) => {
    if (code !== 0) console.error(`[차임벨] ${t} 재생 실패 (종료코드 ${code})`)
    callDone(onDone, code === 0)
  })
}

// 이 울림에 실제로 넘어갈 볼륨(0~1). 소리를 내지 않고 검증할 수 있게 따로 뺐다.
function resolveChimeVolume(volumePct) {
  if (volumePct == null) return getBroadcastVolume()
  return require('../domain/volume').clampVolume(volumePct, 80) / 100
}

// ── **차임 파형을 소리 없이 미리 만들어 둔다** (사용자 신고 2026-09-17 「차임벨이 너무 늦게 나가」) ──
// carecast_chime.py 가 CARECAST_CHIME_PREPARE=1 이면 파형만 임시 폴더에 남기고 끝낸다(재생 코드에 닿기 전에 나간다).
// 그러면 첫 클릭부터 numpy 를 불러와 계산하는 시간이 빠진다. 윈도우 재생 경로만 쓰는 캐시다.
function 차임미리만들기() {
  if (!IS_WINDOWS || hardwareDisabled()) return false
  const python = getPython()
  if (!python) return false
  const vol = resolveChimeVolume(null)
  for (const t of CHIME_TYPES) {
    try {
      const p = spawn(python, [CHIME_SCRIPT, t, String(vol)],
        { stdio: 'ignore', windowsHide: true, env: { ...process.env, CARECAST_CHIME_PREPARE: '1' } })
      p.on('error', () => { /* 못 만들면 누를 때 만든다 */ })
    } catch { /* 못 만들면 누를 때 만든다 */ }
  }
  return true
}

module.exports = { playChime, resolveChimeVolume, 차임미리만들기, normalizeChimeType, CHIME_TYPES, 부수차임막힘,
  // 겹침 잠금을 이 값에서 계산하라고 내보낸다 — 숫자를 베끼면 단계 수를 빠뜨린다(V③ R3).
  CHIME_TIMEOUT_MS, CHIME_MAX_STAGES,
  __test__: { 상주로울리기, 장치못엶처리 } }
