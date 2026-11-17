// 서버 스피커로 MP3 한 개를 재생할 때 **무엇으로 소리를 내는가**만 정하는 곳.
//
// 왜 따로 뺐나(2026-08-30): audioQueue는 재생 순서·제한시간·비상방송 끼어들기라는
// "언제 무엇을 트는가"를 맡는다. 거기에 Windows MCI 스크립트 작성까지 섞여 있어서,
// 맥에서는 큐 로직이 멀쩡한데도 재생만 통째로 실패했다 — 파이썬이 `ctypes.windll`에서
// 터지고(AttributeError), 큐는 그걸 "종료코드 1"로만 받아 로그 한 줄 남기고 끝났다.
// 화면에는 방송이 나간 것처럼 보이는데 스피커는 조용하다.
//
// 규칙 — 플랫폼 분기는 **이 파일 안에서만** 한다:
//   1. Windows(win32)  → mci    : 기존 경로 그대로. 파이썬 + winmm MCI. 출력장치 지정 가능.
//   2. macOS(darwin)   → afplay : macOS 기본 내장(/usr/bin/afplay). 설치할 것 없음.
//   3. 그 외           → 없음   : 조용히 넘기지 않고 이유를 담아 거절한다.
//
// Windows 동작은 한 글자도 바꾸지 않는다. mci 분기는 예전 writePlayScript를 그대로 옮긴
// 것이고, 맥은 **새 분기를 더한 것**이지 기존 분기를 고쳐 쓴 것이 아니다.
//
// 두 백엔드의 공통 계약(큐가 여기에 기대는 것):
//   - 자식 프로세스는 **재생이 끝나야** 종료한다. 큐의 close 핸들러가 "재생 완료"의 근거로
//     쓰고, routes/tts.js는 그 시점에 종료음을 잇는다. 비동기로 던지고 바로 끝나는 명령을
//     쓰면 종료음이 방송 위에 겹친다. (afplay는 원래 동기, MCI는 `play cc wait`)
//   - 성공은 종료코드 0, 실패는 0이 아닌 코드 + stderr 사유.
'use strict'

const path = require('path')
const fs   = require('fs')

const AFPLAY_PATH = '/usr/bin/afplay'

// 사람이 직접 켜는 스위치 — 플랫폼 판정을 덮어쓴다.
// 'mci' | 'afplay' | 'none'. hardwareMode의 CARECAST_NO_HARDWARE와는 다른 층이다:
// 저건 "소리를 내지 마라", 이건 "낸다면 무엇으로 내라". 맥에서 MCI 스크립트 생성을
// 눈으로 확인하거나, 반대로 서버 재생만 꺼 두고 화면을 볼 때 쓴다.
const ENV_KEY = 'CARECAST_AUDIO_BACKEND'
const VALID   = ['mci', 'afplay', 'none']

// 이 프로세스에서 쓸 백엔드 이름. 없으면 null.
function pickBackend() {
  const forced = String(process.env[ENV_KEY] ?? '').trim().toLowerCase()
  if (forced) {
    if (!VALID.includes(forced)) {
      // 오타를 조용히 무시하면 "왜 소리가 안 나지"가 또 미궁이 된다.
      console.warn(`[서버재생] ${ENV_KEY}="${forced}"는 모르는 값입니다 (${VALID.join('|')}) — 플랫폼 기본값으로 진행합니다`)
    } else {
      return forced === 'none' ? null : forced
    }
  }
  if (process.platform === 'win32')  return 'mci'
  if (process.platform === 'darwin') return fs.existsSync(AFPLAY_PATH) ? 'afplay' : null
  return null
}

// 왜 재생할 수 없는지 — 사람이 읽고 다음 행동을 정할 수 있는 문장으로.
function unsupportedReason() {
  if (String(process.env[ENV_KEY] ?? '').trim().toLowerCase() === 'none') {
    return `${ENV_KEY}=none — 서버 스피커 재생을 끄도록 설정돼 있습니다`
  }
  if (process.platform === 'darwin') {
    return `macOS인데 ${AFPLAY_PATH}가 없습니다 — 서버 스피커로 재생할 수 없습니다`
  }
  return `${process.platform}에서는 서버 스피커 재생을 지원하지 않습니다 (Windows: MCI / macOS: afplay)`
}

// MCI 볼륨(0-1000). 재생에 실제로 실릴 값이라 소리를 내지 않고 검증할 수 있게 따로 둔다.
function mciVolume(volumePct) {
  return Math.round(volumePct * 10)
}

// afplay -v 값. 1.0이 원본 크기이므로 퍼센트를 그대로 비율로 옮긴다.
// 소수 둘째 자리까지 — 그 아래는 사람 귀에 의미가 없고 인자만 길어진다.
function afplayVolume(volumePct) {
  const v = Math.max(0, Math.min(100, volumePct)) / 100
  return String(Math.round(v * 100) / 100)
}

// Windows MCI 재생 스크립트 — 설치 폴더에 고정(carecast_mci_play.py). 인자: mp3경로 · MCI볼륨 · [장치번호]
const MCI_SCRIPT = path.join(__dirname, 'carecast_mci_play.py')

// 같은 안내를 방송마다 찍지 않는다 — 방송 로그가 이걸로 덮이면 진짜 정보가 묻힌다.
const _noticed = new Set()
function noticeOnce(msg) {
  if (_noticed.has(msg)) return
  _noticed.add(msg)
  console.log(msg)
}

/**
 * 이 재생에 쓸 명령을 만든다.
 * @param   {string}      mp3Path     — 재생할 MP3 경로
 * @param   {number}      volumePct   — 0-100. 호출부가 이미 확정한 값(널 아님)
 * @param   {number|null} deviceIndex — waveOut 출력 장치 인덱스 (mci 전용, 그 외 무시)
 * @param   {string|null} pythonPath  — mci 백엔드에서만 필요
 * @returns {{ backend: string, cmd: string, args: string[], tempFile: string|null }}
 * @throws  재생할 수 없는 경우 — 이유를 담은 Error. 큐가 그대로 사람에게 전한다.
 */
function buildPlayCommand({ mp3Path, volumePct, deviceIndex = null, pythonPath = null }) {
  const backend = pickBackend()
  if (!backend) throw new Error(unsupportedReason())

  // 어느 백엔드로 나가는지 첫 재생 때 한 번 남긴다 — "소리가 안 난다"는 신고를 받았을 때
  // 제일 먼저 봐야 할 줄이다. 부팅이 아니라 첫 재생에 남기는 이유: 부팅 로그는
  // 스크롤로 밀려나고, 실제로 이 경로를 지났다는 증거는 재생 시점에만 생긴다.
  noticeOnce(`[서버재생] 이 PC의 재생 백엔드: ${backend} (${process.platform})`)

  if (backend === 'mci') {
    // 이 문구는 그대로 둔다 — 현장 로그·문서가 이 문장으로 검색된다.
    if (!pythonPath) throw new Error('Python을 찾을 수 없어 서버 재생 불가')
    // 고정 스크립트에 값만 넘긴다 — 임시 폴더에 새 .py 를 쓰면 백신이 재생마다 검사해 늦었다(2026-09-17).
    const args = [MCI_SCRIPT, mp3Path, String(mciVolume(volumePct))]
    if (deviceIndex != null && deviceIndex >= 0) args.push(String(deviceIndex))
    return { backend, cmd: pythonPath, args, tempFile: null }
  }

  // afplay — 출력 장치는 못 고른다. macOS 기본 출력으로만 나간다.
  // 장치가 지정돼 있는데 말없이 무시하면 "왜 저 스피커로 안 나가지"가 미궁이 된다.
  if (deviceIndex != null && deviceIndex >= 0) {
    noticeOnce('[서버재생] macOS(afplay)는 출력 장치를 고를 수 없습니다 — 시스템 기본 출력으로 재생합니다')
  }
  return {
    backend,
    cmd:      AFPLAY_PATH,
    args:     ['-v', afplayVolume(volumePct), mp3Path],
    tempFile: null,
  }
}

module.exports = {
  pickBackend, buildPlayCommand, unsupportedReason,
  mciVolume, afplayVolume,
  ENV_KEY, VALID, AFPLAY_PATH,
}
