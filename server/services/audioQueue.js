// 서버 오디오 재생 대기열 — 서버 PC 스피커에서 직접 재생
// FIFO 순서로 재생, priority=true면 현재 재생 중단 후 즉시 재생 (비상방송)
//
// "무엇으로 소리를 내는가"(플랫폼별 재생 명령)는 여기 없다 — audioBackend.js가 유일한
// 분기점이고, 이 파일은 순서·제한시간·끼어들기만 본다. 분기가 두 곳이 되면 한쪽만 고치는
// 사고가 난다(audio-backend.test.js가 이 규칙을 고정한다).
const { spawn }  = require('child_process')
const fs         = require('fs')
const { hardwareDisabled, noticeOnce } = require('./hardwareMode')
const audioBackend = require('./audioBackend')

let currentProc  = null   // 현재 재생 중인 자식 프로세스 (백엔드마다 다르다)
let isProcessing = false  // 처리 중 여부
let playTimer    = null   // 현재 재생의 제한시간 타이머
const queue      = []     // { tmpFile, deviceIndex, resolve, reject }

// 재생 자식이 영영 안 끝나는 경우를 끊는 제한시간 (CC-019).
//
// 왜 필요했나: 재생 스크립트는 `mcis('play cc wait', ...)`을 부른다 — **재생이 끝날 때까지
// 블록되는** MCI 호출이다. 여기서는 close/error 두 이벤트만 받고 있었으므로, MCI가 매달리면
// (장치를 다른 프로그램이 점유, 재생 중 장치가 빠짐, 드라이버 행) close가 영영 안 오고
// isProcessing이 true로 굳는다. **그 뒤로 서버 스피커로 나가는 모든 방송이 조용히 사라진다.**
//
// 10분인 이유: 이 큐를 지나는 것은 안내 음성(routes/tts.js)과 마이크 녹음(routes/mic.js)뿐이라
// 길어야 1~2분이다. 음악·영상은 브라우저가 재생하므로 여기 안 온다. 10분이면 정상 재생은
// 절대 안 건드리고 진짜 매달림만 끊는다. **짧게 잡으면 진짜 방송을 중간에 자르는데, 그건
// 매달리는 것보다 나쁜 사고다.**
const DEFAULT_PLAY_TIMEOUT_MS = 10 * 60 * 1000

// 테스트 이음새 — 이 경로는 "프로세스가 영영 안 끝난다"는 병적 상황이라 진짜 재생으로는
// 재현할 수 없고, 재현하려 들면 개발 PC 스피커가 울린다. 운영 코드는 기본값만 쓴다.
// (audio-queue-timeout.test.js가 여기를 갈아끼운다)
const _test = {
  spawn,
  timeoutMs: DEFAULT_PLAY_TIMEOUT_MS,
  // 지금 실제로 소리를 내고 있는 자식 프로세스 수(0 또는 1).
  // 이 큐의 존재 이유가 "한 번에 하나만 난다"이므로, 그걸 밖에서 확인할 수 있어야
  // 회귀 테스트가 그 성질을 지킬 수 있다(tests/regression/broadcast-exclusive).
  // 모듈 안의 currentProc는 밖에서 볼 수 없다 — 그래서 세는 함수만 연다.
  activeCount: () => (currentProc ? 1 : 0),
  queueLength: () => queue.length,
}

// tts.js에서 캐싱된 Python 경로 가져오기
function getPython() {
  // 캐시가 비었으면 다시 찾는다(ISSUE-003). 캐시만 읽으면, 차임이 파이썬 경로를 버린 뒤
  // 이 대기열이 "Python을 찾을 수 없어 서버 재생 불가"로 **시도도 없이** 거절한다(검수 EV-001096).
  try { return require('./tts').ensurePythonPath() } catch { return null }
}

// 방송 볼륨(0-100) — 키·기본값은 domain/volume.js가 유일한 출처다.
// 예전엔 여기서 vol_broadcast를 직접 읽었는데, 음량 패널은 vol_tts에, 관리자 TTS 설정은
// tts_volume에 저장해서 세 값이 따로 놀았다.
function getBroadcastVolume() {
  try {
    const { getDB } = require('../db/schema')
    const { readVolume } = require('../domain/volume')
    return readVolume(getDB(), 'tts')
  } catch { return 80 }
}

// 대기열 맨 앞 항목 재생 시작
function processNext() {
  if (isProcessing || queue.length === 0) return
  isProcessing = true

  const item = queue[0]

  // 재생할 수 없는 조건(백엔드 없음·파이썬 없음)은 **여기서 끝낸다** — 큐에 남겨 두면
  // 뒤 항목까지 같이 멈춘다. 사유는 백엔드가 문장으로 준다.
  let plan
  try {
    plan = audioBackend.buildPlayCommand({
      mp3Path:     item.tmpFile,
      volumePct:   item.volumePct ?? getBroadcastVolume(),
      deviceIndex: item.deviceIndex,
      pythonPath:  getPython(),
    })
  } catch (err) {
    queue.shift()
    item.reject(err)
    isProcessing = false
    processNext()
    return
  }

  const proc  = _test.spawn(plan.cmd, plan.args, { stdio: ['ignore', 'ignore', 'pipe'] })
  currentProc = proc

  let stderr = ''
  proc.stderr.on('data', d => { stderr += d.toString() })

  // 제한시간. 넘으면 그 재생만 끊고 **큐는 계속 돈다** — 여기서 멈추면 그 뒤 모든 방송이
  // 사라진다. kill이 close를 부르므로 뒷정리는 아래 핸들러가 그대로 맡는다.
  clearPlayTimer()
  playTimer = setTimeout(() => {
    if (currentProc !== proc) return          // 이미 끝난 재생의 늦은 타이머 — 무시
    proc._timedOut = true
    try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
    // 조용히 넘기면 "왜 소리가 안 났지"가 또 미궁이 된다. 화면·이력·로그 세 곳에 남긴다.
    try {
      require('./alert').raise('서버재생',
        `소리가 ${Math.round(_test.timeoutMs / 60000)}분 넘게 끝나지 않아 중단했습니다. ` +
        '스피커 장치를 다른 프로그램이 잡고 있는지 확인해주세요.')
    } catch (e) { console.error('[서버재생] 경보 전달 실패:', e.message) }
  }, _test.timeoutMs)

  // ── P-60: 소유권을 **먼저, 한 번** 본다 ──────────────────────────────
  // 예전엔 네 문장 중 둘만 소유권을 봤다. `clearPlayTimer()` 와 `isProcessing=false;
  // processNext()` 는 그냥 돌았다 — 그래서 **늦게 도착한 종료**(이미 끝났거나 교체된
  // 재생의 close)가 ① 지금 재생의 제한시간 타이머를 걷어 매달림을 못 잡게 만들고
  // ② 큐를 이중 기동해 두 소리가 겹칠 수 있었다. 위 제한시간 콜백은 이미
  // `if (currentProc !== proc) return` 으로 같은 것을 지킨다 — 여기만 안 지켰다.
  //
  // 내 차례가 아니면 **이 항목의 약속만 매듭짓고 물러난다.** 임시파일은 어느 쪽이든 지운다.
  // (비상방송 교체 경로는 `currentProc` 를 안 비우고 kill 하므로 여기서 '내 차례'다 —
  //  그 길이 막히면 비상방송이 안 나간다. `stopAll` 은 스스로 큐·isProcessing 을 정리한다.)
  const finish = (settle) => {
    const 내차례 = currentProc === proc
    if (plan.tempFile) { try { fs.unlinkSync(plan.tempFile) } catch { /* 이미 지워졌으면 무시 */ } }
    if (!내차례) { settle(); return }
    clearPlayTimer()
    currentProc = null
    if (queue[0] === item) queue.shift()
    settle()
    isProcessing = false
    processNext()
  }

  proc.on('close', (code) => {
    finish(() => {
      if (proc._timedOut) {
        item.reject(거절('서버 재생이 제한시간 안에 끝나지 않아 중단했습니다', '경보됨'))   // 위 타이머가 이미 경보를 냈다
      } else if (proc._killed || code === 0) {
        // _killed=true면 의도적 중단 (비상방송 교체) → resolve로 처리
        item.resolve()
      } else {
        item.reject(new Error(`서버 재생 실패 (종료코드 ${code}): ${stderr.trim()}`))
      }
    })
  })

  proc.on('error', (err) => {
    finish(() => item.reject(new Error(`프로세스 실행 실패: ${err.message}`)))
  })
}

// 거절에 **왜 안 나갔는지의 종류**를 붙인다 — 부르는 쪽(즉시방송)이 진짜 실패에만 화면 경보를 띄운다.
//   '의도'        사람의 정지·비상방송 교체·새 방송이 밀어냄 — 경보를 띄우면 거짓 경보다
//   '경보됨'      제한시간 — 위 타이머가 이미 경보를 냈다(두 번 뜨지 않게)
//   '하드웨어없음' 시험·하드웨어 접근 없음 모드 — 소리를 안 내는 것이 정상이다
// 종류가 없는 거절(재생기 없음·재생 프로그램 오류)은 **진짜 실패**다.
function 거절(message, 종류) { const e = new Error(message); e.종류 = 종류; return e }

// 타이머는 반드시 한 곳에서만 걷는다 — 남아 있으면 **다음 재생을 엉뚱하게 죽인다.**
function clearPlayTimer() {
  if (playTimer) { clearTimeout(playTimer); playTimer = null }
}

/**
 * MP3 파일을 서버 오디오 장치 대기열에 추가
 * @param {string}      tmpFile     — 재생할 MP3 경로
 * @param {boolean}     priority    — true면 현재 재생 중단 + 대기열 전체 취소 후 즉시 재생 (비상방송)
 * @param {number|null} deviceIndex — waveOut 출력 장치 인덱스 (null이면 기본 장치)
 * @returns {Promise<void>}  재생 완료 또는 대기열 등록 시 resolve
 */
// volumePct: 이 재생에만 쓸 볼륨(0-100). null이면 시스템 기본값(안내 음성 채널).
// writePlayScript는 원래부터 이 인자를 받고 있었는데 enqueue가 넘기지 않아, 방송마다 다른
// 볼륨을 줄 방법이 없었다(2026-08-28 배관 연결).
function enqueue(tmpFile, priority = false, deviceIndex = null, volumePct = null) {
  // 테스트·하드웨어 접근 없음 모드에서는 실제 스피커를 울리지 않는다. 조용히 resolve하면
  // "재생됐다"는 거짓이 되므로(CC-008 delivery-truth의 교훈) 명시적으로 거절한다 —
  // 스텁을 빠뜨린 테스트가 개발 PC에서 진짜 방송 소리를 냈다(2026-08-30).
  if (hardwareDisabled()) {
    noticeOnce('서버재생')
    return Promise.reject(거절('하드웨어 접근 없음 모드 — 서버 스피커 재생을 건너뜁니다', '하드웨어없음'))
  }
  return new Promise((resolve, reject) => {
    if (priority) {
      // 비상 방송: 대기 중인 항목 전체 취소
      while (queue.length > 0) {
        const { reject: r } = queue.pop()
        r(거절('비상 방송으로 인해 중단됨', '의도'))
      }
      // 대기열 맨 앞에 삽입
      queue.unshift({ tmpFile, deviceIndex, volumePct, resolve, reject })
      if (currentProc) {
        // 현재 재생 중인 프로세스 kill → close 이벤트 → processNext → 비상방송 재생
        currentProc._killed = true
        currentProc.kill()
      } else {
        processNext()
      }
    } else {
      queue.push({ tmpFile, deviceIndex, volumePct, resolve, reject })
      processNext()
    }
  })
}

// 이 재생에 실제로 쓰일 MCI 볼륨(0-1000). 소리를 내지 않고도 검증할 수 있게 따로 뺐다 —
// 방송 볼륨이 실제 재생까지 도달하는지 확인할 수 있는 마지막 결정 지점이다.
// 계산 자체는 audioBackend가 갖는다(백엔드마다 눈금이 다르다). 여기서는 기본값만 채운다.
function mciVolume(volumePct) {
  return audioBackend.mciVolume(volumePct ?? getBroadcastVolume())
}

// 서버 종료 정리(shutdown.js가 부른다) — 재생 중이면 끊고, 대기 중이면 거절한다 (CC-023).
// 재생 자식은 `play cc wait`라 그냥 두면 서버가 죽은 뒤에도 MP3를 끝까지 재생한다.
// 중단 방식(_killed 표시 후 kill)은 비상방송의 교체 경로와 동일하다.
function stopAll(reason = '서버 종료로 중단') {
  let cancelled = 0
  while (queue.length > 0) {
    const { reject } = queue.pop()
    cancelled++
    try { reject(거절(reason, '의도')) } catch { /* 이미 정착된 promise */ }
  }
  clearPlayTimer()
  let killed = false
  if (currentProc) {
    currentProc._killed = true
    try { currentProc.kill(); killed = true } catch { /* 이미 죽은 프로세스 */ }
    currentProc = null
  }
  isProcessing = false
  return { cancelled, killed }
}

// "지금 서버 스피커로 뭔가 나가고 있는가". 읽기만 한다.
// 즉시 방송(routes/tts.js)과 마이크(routes/mic.js)는 이 대기열로 직접 들어와
// nowPlaying 을 안 거치므로, 밖에서 그 사실을 알 창구가 여기 말고 없었다(P-66).
// 대기 중인 것도 센다 — 곧 소리가 날 것이 남아 있는데 재시작하면 그것이 사라진다.
function isBusy() { return isProcessing || queue.length > 0 }

module.exports = { enqueue, mciVolume, stopAll, isBusy, DEFAULT_PLAY_TIMEOUT_MS, _test }
