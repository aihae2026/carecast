// 실시간 오디오 스트리밍 — Windows WaveOut(ctypes) 사용, pip 설치 불필요
const { spawn, spawnSync } = require('child_process')
const { hardwareDisabled, noticeOnce } = require('./hardwareMode')
const path                 = require('path')

function getPython() {
  // 캐시가 비었으면 다시 찾는다(ISSUE-003) — 위 둘과 같은 이유다.
  try { return require('./tts').ensurePythonPath() } catch { return null }
}

let playerProc = null
let isReady    = false

const PLAYER_SCRIPT = path.join(__dirname, 'carecast_player.py')

function tryInstallNumpy(python) {
  // numpy는 속도 개선용 — 없어도 carecast_player.py가 struct로 동작
  const check = spawnSync(python, ['-c', 'import numpy'], { stdio: 'pipe' })
  if (check.status === 0) return
  console.log('[AudioPlayer] numpy 없음 → pip install 시도...')
  spawnSync(python, ['-m', 'pip', 'install', 'numpy', '--quiet'],
    { stdio: 'pipe', timeout: 60000 })
}

// macOS/리눅스 개발 환경 가드 — carecast_player.py가 Windows WaveOut(ctypes.windll) 전용이다.
const IS_WINDOWS = process.platform === 'win32'
let _nonWinLogged = false
function nonWinNotice() {
  if (_nonWinLogged) return
  _nonWinLogged = true
  console.log('[AudioPlayer] Windows 전용(WaveOut) — 실시간 마이크 재생을 비활성화합니다 (macOS/리눅스 개발 환경)')
}

// 플레이어 사고 수 — 프로세스 종료 + PLAY_ERROR 줄. 줄지 않는다. 상주 차임이 「내가 울리는 동안 사고가
// 있었나」를 앞뒤로 견준다(chimePlayer 상주로울리기, 2026-09-26 Codex 검수 High).
let _사고수 = 0
function 재생사고수() { return _사고수 }

// **지연 기동은 장치 캐시를 데운 뒤에 한다**(2026-09-26 Codex 검수 High). 설정에서 장치를 바꾸면 이 프로세스를
// 내리고 캐시를 비운다. 캐시가 다시 차기 전에 차임·마이크가 와서 바로 띄우면 빈 캐시로 **기본 스피커를 물고**,
// 서버가 사는 내내 그대로였다. 부팅(맨 아래)과 같은 순서를 한 곳에 둔다. 데우는 동안 또 불려도 한 번만 띄운다.
let _기동중 = false
function 데우고기동() {
  if (playerProc || _기동중) return
  _기동중 = true
  Promise.resolve()
    .then(() => require('./audioDevices').warmDeviceCache())
    .catch(() => { /* 못 데워도 기본 장치로라도 뜬다 */ })
    .finally(() => { _기동중 = false; if (!playerProc) startPlayer() })
}

function startPlayer() {
  if (!IS_WINDOWS) { nonWinNotice(); return false }
  // 상주형 파이썬이라 한 번 뜨면 안 죽는다 — 테스트에서 뜨면 그 파일이 영영 안 끝난다.
  // 로드 시 예약뿐 아니라 playChunk()의 지연 기동 경로도 여기로 들어오므로 함수 안이 진짜 경계다.
  if (hardwareDisabled()) { noticeOnce('AudioPlayer'); return false }
  const python = getPython()
  if (!python) { console.error('[AudioPlayer] Python 경로 찾을 수 없음'); return false }

  tryInstallNumpy(python)

  // 설정된 출력 장치로 낸다(차임벨과 같은 이유). **이 프로세스는 상주형이라 뜰 때 장치를
  // 물고 간다** — 그래서 설정에서 장치를 바꾸면 routes/settings.js가 이 프로세스를 내린다.
  // 안 내리면 다음 생방송이 옛 장치로 나가고, 아무 오류도 안 난다.
  playerProc = spawn(python, [PLAYER_SCRIPT], {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: { ...process.env, ...require('./audioDevices').waveOutEnv() },
  })

  // on('error')가 없으면 실행 실패가 던져져 서버 프로세스가 죽는다(chimePlayer.js와 같은 이유).
  // 이 spawn은 부팅 2초 뒤에도 돌기 때문에, Python이 없으면 서버가 아예 못 뜬다.
  playerProc.on('error', e => {
    console.error('[AudioPlayer] 프로세스 실행 실패:', e.message)
    playerProc = null
    isReady    = false
  })

  let stderrBuf = ''
  playerProc.stderr.on('data', d => {
    stderrBuf += d.toString()
    const lines = stderrBuf.split('\n')
    stderrBuf = lines.pop()           // 마지막 미완성 줄은 버퍼에 보관
    for (const line of lines) {
      const text = line.trim()
      if (!text) continue
      if (text === 'READY') {
        isReady = true
        console.log('[AudioPlayer] 준비 완료')
      } else {
        if (text.startsWith('PLAY_ERROR')) _사고수 += 1   // 차임 결과 판정이 본다(재생사고수)
        console.error('[AudioPlayer]', text)
      }
    }
  })
  playerProc.on('close', () => {
    _사고수 += 1
    playerProc = null
    isReady    = false
    console.log('[AudioPlayer] 프로세스 종료')
  })

  console.log('[AudioPlayer] 시작됨')
  return true
}

let _chunkCount   = 0
let _dropLogged   = false

/**
 * Float32 오디오 청크를 서버 스피커로 전송
 * 포맷: [sampleRate float32 4B][samples float32...]
 */
// 돌려주는 값 = **이 청크가 실제로 재생 경로에 들어갔는가**(2026-09-03 레드 검증 발견2).
// 신호등(micLive)이 이 값을 본다 — 무조건 켜면 플레이어가 안 떠 있을 때 "표시는 나는데
// 소리는 없는" 상태가 되고, 배지가 있으니 아무도 확인하러 안 간다. 이 기능이 고치려던
// 신고("소리는 나는데 표시가 없다")의 정반대 실패다.
/**
 * 마이크 청크 하나를 서버 스피커로 보낸다.
 *
 * `보낸이` 는 **누가 보냈는가**(P-63, 2026-09-11). 전에는 인자가 데이터 하나뿐이라
 * **누가 보냈는지 몰랐고**, 단일 방송자 개념은 `index.js` 의 WS 클로저 지역 변수에만
 * 있어 HTTP 폴백(`routes/mic.js` 의 `POST /stream`)은 볼 수조차 없었다
 * ([FACT] EV-004033). 그래서 두 기기가 동시에 보내면 **청크가 섞여 한 스피커로 나갔다** —
 * 요양원에서는 "두 사람 목소리가 겹쳐 나간다" 가 된다.
 *
 * **이름을 안 주면 예전처럼 지나간다**(하위 호환). 이름을 준 호출만 소유권을 본다 —
 * 아직 이름을 안 싣는 자리까지 막으면 기존 방송이 죽는다.
 */
function playChunk(data, 보낸이) {
  if (!IS_WINDOWS) { nonWinNotice(); return false }
  // **주인이 아니면 소리로 내보내지 않는다.** 조용히 버리는 것이 아니라, 보낸 쪽이
  // `false` 를 보고 "내 차례가 아니다" 를 알 수 있다(라우트가 그것을 응답에 싣는다).
  if (!require('./micOwner').주인인가(보낸이)) return false
  // 마지막 청크 시각 — "지금 생방송 중인가"의 근거(아래 stopIfStreaming). 플레이어가 아직
  // 준비 전이라 청크를 버리는 중이어도 스트리밍 중이라는 사실 자체는 참이라 먼저 찍는다.
  _lastChunkAt = Date.now()
  if (!playerProc || !isReady) {
    if (!playerProc) 데우고기동()
    if (!_dropLogged) {
      console.log(`[AudioPlayer] ⚠ 청크 드롭 — playerProc:${!!playerProc} isReady:${isReady}`)
      _dropLogged = true
    }
    return false
  }
  _dropLogged = false

  const buf   = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buf.length < 8) return false

  const srFloat  = buf.readFloatLE(0)
  const sr       = Math.round(srFloat)
  const nSamples = (buf.length - 4) / 4

  if (nSamples <= 0 || sr < 8000 || sr > 96000) return false

  const header = Buffer.alloc(8)
  header.writeUInt32LE(sr,       0)
  header.writeUInt32LE(nSamples, 4)
  const samples = buf.slice(4)

  try {
    playerProc.stdin.write(Buffer.concat([header, samples]))
    if (_chunkCount === 0) console.log(`[AudioPlayer] ✓ 첫 청크 전송 (sr:${sr} samples:${nSamples})`)
    _chunkCount++
    return true
  } catch (e) {
    console.error('[AudioPlayer] 쓰기 실패:', e.message)
    playerProc = null
    isReady    = false
    _chunkCount = 0
    return false
  }
}

// ── **차임을 상주 플레이어로 낸다** (사용자 신고 2026-09-17 「차임벨 너무 느린데 … 왜 설치판에서만」) ──
// 차임은 누를 때마다 파이썬을 새로 띄웠다. 설치판의 파이썬은 새로 깐 폴더에 있어 백신(V3)이 **새 프로세스마다**
// 검사했고, 그 시간이 그대로 차임 지연이 됐다(현장 PC 는 오래 쓴 시스템 파이썬이라 안 걸린다). 이 플레이어는
// 서버가 켜질 때 한 번 떠서 계속 살아 있으므로, 만들어 둔 16비트 파형만 넘기면 새 프로세스가 생기지 않는다.
// 마이크 주인 검사는 하지 않는다 — 차임은 사람의 말이 아니다. 플레이어가 준비 전이면 false(부르는 쪽이 예전 길로 간다).
// 머리말 첫 칸(표본율)의 맨 윗 비트. 표본율은 8000~96000 이라 이 비트를 절대 안 쓴다.
// 파이썬이 이 비트로 「차임 줄」과 「마이크 줄」을 갈라 각각 다른 재생 핸들을 연다.
const 차임줄표시 = 0x80000000

function playPcm16(pcm16, sr = 44100) {
  if (!IS_WINDOWS || hardwareDisabled()) return false
  if (!playerProc || !isReady) { if (!playerProc) 데우고기동(); return false }
  const buf = Buffer.isBuffer(pcm16) ? pcm16 : Buffer.from(pcm16)
  const n = Math.floor(buf.length / 2)
  if (n <= 0) return false
  // 이 플레이어의 입력 규격은 float32 다(마이크 청크와 같은 길). 16비트 → -1~1 로 바꿔 싣는다.
  const f32 = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) f32.writeFloatLE(buf.readInt16LE(i * 2) / 32768, i * 4)
  const header = Buffer.alloc(8)
  // **차임 표시를 실어 보낸다** (적대적 검수 2026-09-18). 표시가 없으면 파이썬이 표본율만 보고
  // 재생 핸들을 고르는데, 그 PC 의 마이크가 44100 이면 **차임과 같은 핸들**이 된다. WaveOut 은 한
  // 핸들에 제출된 버퍼를 **순서대로** 이어 내므로, 차임 3.5초가 먼저 들어간 뒤의 목소리는 그 뒤에
  // 줄을 서서 1.7초쯤 늦게 나간다 — 말하는 사람은 제 목소리가 늦게 들리고 「정지」도 그만큼 늦는다.
  // 48000 인 PC 에서는 안 나서 놓치기 쉬운 자리라, 표본율이 같아도 줄이 갈리게 못 박는다.
  header.writeUInt32LE((sr | 차임줄표시) >>> 0, 0)
  header.writeUInt32LE(n, 4)
  try {
    playerProc.stdin.write(Buffer.concat([header, f32]))
    return true
  } catch (e) {
    console.error('[AudioPlayer] 차임 쓰기 실패:', e.message)
    return false
  }
}

let _lastChunkAt = 0

// 생방송 판정 창 — 마지막 청크가 이 시간 안이면 "지금 말하는 중"이다.
// 판정을 순수 함수로 두는 이유(레드 검증 F8): 경계(<=, 창 안)를 행동 테스트가
// 직접 돌려 확인한다(mic-stream-window.test.js). 인라인으로 되돌리면 그 확인이 죽는다.
const STREAM_WINDOW_MS = 10000
function isLiveAt(lastChunkAt, now) {
  return now - lastChunkAt <= STREAM_WINDOW_MS
}

// 사람이 정지를 눌렀을 때 마이크 생방송 재생을 끊는다 (td09 H10, 사용자 결정 2026-09-02).
// 상주 플레이어를 내리면 파이썬 버퍼에 쌓인 소리까지 그 자리에서 죽는다 — 다음 청크가
// 오면 스스로 다시 뜨므로(playChunk의 지연 기동) 다음 마이크 방송은 정상이다.
// **최근 10초 안에 청크가 온 경우에만** 내린다 — 생방송 중이 아닌데 정지를 눌렀다고
// 상주 플레이어를 껐다 켜는 낭비를 막는다.
// 한계를 적어 둔다: 1차 정지 수단은 방송자 화면이 스스로 내리는 것(broadcast_stopped →
// stop-broadcast를 InstantBroadcast가 듣는다)이고, 이 함수는 서버 쪽 소리를 즉시 끊는
// 보조다. 화면이 신호를 못 받고 계속 청크를 보내면 플레이어가 다시 떠 소리가 이어질 수
// 있다 — 그 화면까지 서버가 강제로 끊는 것은 일부러 안 한다(연결 종료는 WS 경로에만 있고
// HTTP 폴백에는 끊을 연결 자체가 없어, 반쪽짜리 강제가 된다).
function stopIfStreaming(reason = '') {
  if (!playerProc) return false
  if (!isLiveAt(_lastChunkAt, Date.now())) return false
  console.log(`[AudioPlayer] 마이크 재생 중단${reason ? ' — ' + reason : ''}`)
  return stop()
}

// 서버 종료 정리(shutdown.js가 부른다) — 상주형 파이썬을 내린다 (CC-023).
// 이 프로세스는 한 번 뜨면 스스로 죽지 않으므로, 서버가 떠날 때 명시적으로 끊는다.
function stop() {
  if (!playerProc) return false
  try { playerProc.kill() } catch { /* 이미 죽은 프로세스 */ }
  playerProc = null
  isReady    = false
  return true
}

// 하드웨어 접근 없음 모드에서는 예약 자체를 걸지 않는다 — 타이머만으로도 2초간 이벤트
// 루프를 붙잡아 테스트 종료가 그만큼 늦어진다(CC-050).
// **장치 목록을 먼저 데우고 띄운다.** 이 프로세스는 뜰 때 출력 장치를 물고 가는데, 그 값을
// 캐시에서 읽기 때문이다(audioDevices.waveOutEnv). 데우지 않고 띄우면 캐시가 비어 있어
// 기본 장치로 굳고, 서버가 사는 내내 그대로다 — 설정에서 장치를 바꿔야만 다시 뜬다.
if (IS_WINDOWS && !hardwareDisabled()) setTimeout(() => {
  require('./audioDevices').warmDeviceCache().finally(() => startPlayer())
}, 2000)

module.exports = { playChunk, playPcm16, stop, stopIfStreaming, 재생사고수, __test__: { isLiveAt, STREAM_WINDOW_MS } }
