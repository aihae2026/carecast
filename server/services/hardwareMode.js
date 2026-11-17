// 이 프로세스가 실제 하드웨어를 만져도 되는가.
//
// 왜 필요했나(2026-08-30 재점검 CC-050): 이 저장소에는 **모듈을 require하는 것만으로**
// 외부 프로세스를 띄우는 곳이 셋 있다.
//   audioPlayer.js    setTimeout(startPlayer, 2000)  → 상주형 파이썬(carecast_player.py)
//   audioDevices.js   if (IS_WINDOWS) compileDll()   → PowerShell Add-Type
//   volumeControl.js  if (IS_WINDOWS) compileDll()   → PowerShell Add-Type
// 호출 시점에 소리를 내는 두 곳(chimePlayer.playChime, audioQueue.enqueue)도 같은 가드를
// 본다 — 스텁을 빠뜨린 테스트가 개발 PC 스피커로 진짜 소리를 냈다(2026-08-30,
// no-sound-in-tests.test.js가 가드 존재를 고정).
//
// 그중 audioPlayer가 실제 사고를 냈다. 상주형이라 안 죽고, 이벤트 루프를 붙잡아 그 모듈을
// 당긴 테스트 파일이 영영 안 끝났다(--test-timeout=0이라 무한 대기). 2026-08-29에 소리
// 경계 3곳을 스텁해 같은 행을 고쳤는데 이 경계가 빠져 있었고, 그땐 이 PC에 Python이 없어
// 우연히 통과했다가 합성 모듈이 설치되자 되살아났다.
//
// 테스트마다 require.cache를 선점하는 방식으로도 막을 수 있지만, 그러면 **새 테스트가 생길
// 때마다 같은 함정을 다시 밟는다.** 경계 쪽에서 한 번 막는다.
'use strict'

// node --test가 테스트 자식 프로세스에 자동으로 넣어주는 값(실측: 'child-v8').
// 테스트 스크립트나 package.json을 건드리지 않아도 되고, 플랫폼도 안 탄다.
// CARECAST_NO_HARDWARE=1은 사람이 직접 켜는 스위치다 — 맥에서 개발하거나, 현장 PC에
// 붙지 않은 채 서버만 띄워 화면을 확인할 때 쓴다.
function hardwareDisabled() {
  if (process.env.CARECAST_NO_HARDWARE === '1') return true
  if (process.env.NODE_TEST_CONTEXT) return true
  return false
}

// 같은 안내를 매 호출마다 찍지 않는다 — 방송 로그가 이걸로 덮이면 진짜 정보가 묻힌다.
const _noticed = new Set()
function noticeOnce(tag) {
  if (_noticed.has(tag)) return
  _noticed.add(tag)
  console.log(`[${tag}] 하드웨어 접근 없음 모드 — 외부 프로세스를 띄우지 않습니다`)
}

// ── 브라우저가 소리를 내는 SSE 이벤트 (P-15, 2026-09-11) ────────────────────
//
// **왜 필요했나**: 위 가드는 **서버 스피커만** 막는다. 그런데 예약 6유형 중 **차임 하나만**
// 서버 스피커이고 나머지 다섯은 **브라우저가 낸다**([FACT] EV-000373 — `audioQueue.enqueue`
// 호출처는 `routes/tts.js`·`routes/mic.js` 둘뿐, `scheduler.js` 는 없다).
// 그래서 검수 중 예약 시각이 지나가면 **검수 PC 스피커에서 진짜 소리가 났다.**
// PROJECT_PROFILE §1-2 의 "제외 표" 가 그래서 생겼고, §1-3 이 이 방향을 적어 뒀다.
//
// **화면마다 막지 않는다.** 소리를 내는 화면이 여럿이라 곧 하나를 빠뜨린다(FP-0005).
// 서버가 쏘는 자리는 `sse.broadcastSSE` **하나**이므로 거기서 한 번 막는다.
//
// **소리를 내는 것만 고른다.** 통째로 막으면 화면 갱신·경보·상태 동기화까지 죽어서
// 검수가 아무것도 못 본다 — 그러면 고치려던 것보다 나쁘다.
//
// 새 이벤트를 더할 때: **브라우저가 그것을 받아 소리를 내는가**만 본다.
// 표시·상태·경보는 여기 넣지 않는다.
const 소리이벤트 = new Set([
  'scheduled_broadcast',    // 예약 TTS — `new Audio(objUrl)` 로 재생
  'prayer_play',            // 녹음 안내 음원
  'prayer_schedule_play',   // 예약된 녹음 안내 음원
  'video_play',             // 업로드 영상
  'morning_video_start',    // 방송 뒤 배경 영상 — 화면은 무음이지만 뒤에 BGM 이 이어진다
  'bgm_start',              // 로컬 BGM 시작
  'chime_play',             // 차임(브라우저 Web Audio 쪽)
  'chime_fallback_play',    // 서버 스피커를 못 열었을 때 방송 화면이 대신 울리는 차임 — MusicPlayer 가 playBrowserChime() (2026-09-26)
])
// **여기에 넣기 전에 수신부를 읽는다. 이름으로 넣지 않는다.** (Codex 독립 검수 2026-09-11)
//
// 처음엔 「다른 PC 재생 상태 표시」 이벤트와 `bgm_set_timer` 도 들어 있었다 — 이름에 BGM 이 있어서였다.
// 앞의 것은 표시일 뿐 소리를 안 냈다(2026-09-21 그 연동째 걷어냈다). 뒤의 것은:
//   · `bgm_set_timer` 는 **정지 타이머**다(`useScheduledBroadcast.js:191-199` — 시간이 지나면
//     `broadcast-bgm-stop` 을 쏜다). 막으면 검수 중 **BGM 이 영영 안 꺼진다.**
//     소리를 안 나게 하려다 소리를 못 끄게 만드는 것이 이 목록의 가장 나쁜 실패다.
// `server/test/dryrun-blocks-browser-sound.test.js` 가 두 근거를 소스 대조로 고정한다.

// **한 이벤트에 시작과 정지가 같이 타는 것이 있다.**
// (예전의 원격 재생 명령이 그랬다 — payload 의 `action` 이 `play` 면 틀고 `stop` 이면 껐다.
// 그 이벤트는 2026-09-21 걷어냈지만 **규칙은 남긴다** — 새 이벤트가 같은 모양을 쓸 수 있다.)
// 이름으로 통째로 막으면 **정지 명령까지 막혀 BGM 이 안 꺼진다** — 바로 위에서
// `bgm_set_timer` 로 고친 것과 **같은 실패를 같은 목록 안에서 한 번 더** 하는 것이다.
// **여기 넣었다가 뺀 것이 셋이다.** 셋 다 이름만 보고 넣었고, 수신부를 읽으니 소리가 아니었다:
//   · 남의 PC 재생 상태 **표시** 이벤트(소리를 안 냈다 — 2026-09-21 연동째 제거)
//   · `bgm_set_timer` — **정지 타이머**(시간이 지나면 broadcast-bgm-stop)
//   · `tts_speak`     — **덕킹 알림**(`{state:'start'|'end'}` → BGM 을 줄였다 되돌린다).
//     실소리는 서버 스피커가 내고 그쪽은 `audioQueue` 가 이미 드라이런에서 reject 한다.
//     막으면 `end` 가 안 가서 **BGM 이 작아진 채로 굳는다.**
// 세 번 같은 실패를 했으므로 규칙을 적어 둔다 — **이름이 아니라 수신부를 읽고 넣는다.**
const 정지행동 = new Set(['stop', 'pause'])
// 한 이벤트가 시작과 끝을 **`state` 로** 나르는 계약도 있다(`tts_speak` 가 그랬다).
// 끝났다는 알림까지 막으면 소리를 못 끄게 만든다 — 이 목록의 가장 나쁜 실패다.
const 정지상태 = new Set(['end', 'stop', 'stopped', 'done'])

/**
 * 이 이벤트가 **소리를 시작하나**. 드라이런에서 막을지를 여기 한 곳에서만 정한다 —
 * 부르는 쪽마다 `action` 을 다시 해석하면 곧 갈린다(FP-0005).
 *
 * **모르면 막는 쪽**이다. `action` 이 없거나 아는 정지 행동이 아니면 소리가 날 수 있다고 본다 —
 * 검수 중 진짜 소리가 나는 것이 표시 하나 못 보는 것보다 비싸다.
 */
function 소리내는가(event, data) {
  if (!소리이벤트.has(event)) return false
  const d = data && typeof data === 'object' ? data : {}
  if (typeof d.action === 'string' && 정지행동.has(d.action)) return false
  if (typeof d.state === 'string' && 정지상태.has(d.state)) return false
  return true
}

module.exports = { hardwareDisabled, noticeOnce, 소리이벤트, 정지행동, 정지상태, 소리내는가 }
