// BGM이 실제로 깔려 있는 구간 — 순서편집기 왼쪽의 분홍 선이 그리는 것.
//
// 왜 필요했나(2026-08-31): 단계 목록만 봐서는 **이 안내가 음악 위에 얹혀 나가는지, 맨목소리로
// 나가는지 알 수 없다.** 특히 소리 있는 영상 단계는 BGM을 꺼 버려서, 그 뒤에 안내를 넣으면 음악이
// 사라진 채로 나가는데 화면에는 아무 표시가 없다(아침 방송의 'BGM 재시작' 단계가 그래서 있다).
//
// 선은 곧 주장이다 — "여기부터 여기까지 음악이 깔린다"고 그려 놓고 실제로 아니면, 사람이 그
// 그림을 보고 순서를 짠다. 그래서 규칙은 실측한 서버 동작에서 가져왔다:
//
//   · BGM 단계는 음악을 켜고 **다음 단계로 넘어간다** — 그 뒤 단계들 밑에 계속 깔린다
//     (flowRunner.js의 bgm 스텝: 선재생(bgm_delay)만 기다리고 return)
//   · 다음 BGM 단계가 나오면 거기서 새로 시작한다(앞 구간 종료)
//   · **소리 있는** 영상 단계는 BGM을 페이드아웃시킨다 → 구간 종료
//     (broadcastSteps.js의 stepVideoFile이 bgm_stop을 쏘고 1.5초 기다린다.
//      체조·점심·저녁 영상과 커스텀 video_file이 이 길이다)
//   · **마무리 뮤트 영상**(morning_video · lunch_video_after · dinner_video_after)은
//     BGM을 끄지 않는다 → 구간이 이어진다. stepVideoAfter는 bgm_stop을 **안 쏘고**
//     bgm_set_timer로 남은 시간만 영상 길이에 맞춘다(broadcastSequencer.js의 호출 세 곳이
//     전부 bgmMealKey=null이라 stepBGMStart 가지로 안 간다). 소리 없는 영상 밑에서
//     음악이 계속 깔리는 것이 현장의 실제 모습이고, 문서 §3-B 규칙 3이 그것을 명세로 못 박았다.
//     **여기를 'stop'으로 되돌리면 화면이 "여기서 음악이 끊긴다"고 거짓말한다**(td09 H13).
//   · 음원(녹음) 단계는 BGM을 잠시 내렸다가 돌려놓는다 → 구간은 이어지되 그 칸은 '잠시 멈춤'
//     (prayer_play를 받은 MusicPlayer가 BGM을 세우고 restoreBGM으로 되돌린다)
//
// 화면 파일(MorningEditor.jsx)에 있는 단계 id 표들을 인자로 받는다 — 표를 이리로 옮기면
// 화면 쪽 사용처 여러 곳을 함께 건드려야 해서, 규칙만 가져오고 표는 그대로 뒀다.
//
// ── 흐름(flow_sequences) 어휘는 갈래가 다르다 (2026-09-02) ─────────────────────────
// 커스텀 자동순서·방송 흐름의 단계는 `step.step_type`이고, **실행기도 다르다**
// (server/services/flowRunner.js). 자동방송 판정(bgmRole)을 그대로 갖다 붙이면 또 거짓말이
// 된다 — 특히 음원 단계에서. 그래서 규칙을 따로 적되 이 파일 한 곳에 둔다(flowBgmRole).
//
// 흐름의 BGM 은 이 PC 음원이다(2026-09-21 — 그 전엔 외부 동영상 반주였다). flowRunner 의 bgm 단계가
// `bgm_start` 를 쏘고 MusicPlayer 가 튼다. **흐름에서 한 번 꺼지면 되살리는 단계가 없다** — 자동방송의
// `bgm_after` 같은 단계가 흐름에는 없어서, 다음 BGM 단계까지 음악이 없다.
//
//
//   · bgm    → 구간 시작. 선재생(bgm_delay)만 기다리고 다음 단계로 넘어간다
//              (flowRunner.js:168~192. 마지막 곡은 대기 없이 계속 흐른다)
//   · tts    → 구간 이어짐. `scheduled_broadcast`를 **bgm: null**로 쏘고(:153), 화면은
//              "새 방송에 bgm이 있을 때만 교체, 없으면 기존 BGM 유지"다
//              (useScheduledBroadcast.js:224·230). 음량만 잠깐 낮춘다(덕킹) — 안 끊긴다.
//   · chime  → 구간 이어짐. 서버 스피커(chimePlayer)가 내는 소리고, 브라우저의 chime_play
//              재생은 일부러 꺼 놨다(MusicPlayer.jsx:411 주석). BGM을 건드리는 곳이 없다.
//   · delay  → 구간 이어짐. 기다리기만 한다(flowRunner.js:130~134)
//   · group  → 구간 이어짐. 목록을 나누는 라벨이라 실행할 것이 없다(flowRunner.js:128)
//   · audio  → **구간 끝(stop). 자동방송과 여기가 갈린다.** flowRunner는 `prayer_play`를
//              **restoreBGM: false**로 쏘고(:215) token도 함께 싣는다. 받는 쪽 MusicPlayer는
//              `hadActiveBGM = !bgmWasStopping && (restoreBGM || !token) && 로컬재생목록>0`
//              이 **거짓**이라(restoreBGM:false + token) 되돌릴 것을 안 챙긴다. 흐름에는 BGM을 다시 켜 줄
//              `bgm_after` 같은 단계도 없다. 그래서 '잠시 멈춤'이 아니라 진짜 끝이다.
//   · video_file(업로드 영상) → 구간 끝(stop). `video_play`를 쏘고 화면의 VideoPlayer가
//              재생을 시작하면서 로컬 BGM 을 끈다(`carecast:broadcast-local-bgm-stop`,
//              VideoPlayer.jsx 의 handleVideoPlay).
//
// 위 일곱이 flowRunner.runStep의 갈래 전부다. 그 밖의 step_type은 어느 갈래에도 안 걸려
// **아무 일도 안 하고 끝난다**(runStep 끝까지 떨어진다) — 그래서 'other'가 추측이 아니라
// 사실이다. 선을 끊어 "여기서 음악이 끝난다"고 주장할 근거는 없다.

// 이 단계가 BGM에 대해 하는 일. 'bgm' 시작 · 'stop' 끔 · 'pause' 잠시 멈춤 · 'other' 무관.
export function bgmRole(step, { bgmIds, videoIds, audioCategory } = {}) {
  if (!step) return 'other'
  // 커스텀 단계(사람이 추가한 것)는 실행이 흐름과 같은 길이다 — runCustomExtraStep
  // (broadcastSteps.js)이 flowRunner.runStep에 그대로 넘긴다. 그러니 판정도 흐름 어휘(flowBgmRole)로
  // 한다. 내장 단계와 갈리는 곳: audio — 내장 녹음 음원은 '잠시 멈춤'(pause)이지만 커스텀 음원은
  // flowRunner가 prayer_play를 restoreBGM:false로 쏘고 복귀가 없어 '끔'(stop)이다(머리말 audio 항).
  if (step.customType) return flowBgmRole({ step_type: step.customType })
  if (bgmIds?.has?.(step.id)) return 'bgm'
  // videoIds(VIDEO_STEP_IDS)는 **마무리 뮤트 영상 3종뿐**이다 — 서버가 bgm_stop을 안 쏘므로
  // BGM은 그 밑에 계속 깔린다. 'other'로 두어 구간을 이어 그린다(위 머리말 참고).
  // audioCategory보다 먼저 보는 순서를 지킨다 — 표에 이 id가 섞여 들어와도 'stop'이 되면 안 된다.
  if (videoIds?.has?.(step.id)) return 'other'
  // audioCategory는 원래 **미리듣기용 카테고리 표**라 영상 단계까지 들어 있다
  // (exercise_video → 'exercise-video'). 이름이 video로 끝나면 영상이고, 영상은 BGM을 끈다.
  const cat = audioCategory?.[step.id]
  if (cat) return /video$/.test(cat) ? 'stop' : 'pause'
  return 'other'
}

// 흐름(flow_sequences) 단계가 BGM에 대해 하는 일. 어휘는 step.step_type이고 근거는 위 머리말.
// 자동방송(bgmRole)과 갈리는 곳은 **audio**다 — 흐름은 restoreBGM:false로 쏘고 되살리는 단계가
// 없어서 '잠시 멈춤'(pause)이 아니라 '끔'(stop)이다.
export function flowBgmRole(step) {
  switch (step?.step_type) {
    case 'bgm':        return 'bgm'
    case 'audio':      return 'stop'   // prayer_play가 BGM 을 세우고 복귀가 없다(restoreBGM:false)
    case 'video_file': return 'stop'   // VideoPlayer가 재생 시작과 함께 로컬 BGM 을 끈다
    // tts · chime · delay · group 은 BGM을 안 건드린다 → 구간이 이어진다
    default:           return 'other'
  }
}

// 단계 수만큼의 배열. 각 칸은 null | 'start' | 'mid' | 'paused'이고,
// 구간의 마지막 칸에는 '|end'가 붙는다(선의 아래 끝을 둥글게 맺으라는 뜻).
// 꺼 둔(enabled === false) BGM 단계는 구간을 열지 않는다 — 안 나가는 소리를 깔린 것처럼
// 그리면 안 된다.
// tables.role로 판정 함수를 갈아끼울 수 있다(기본은 자동방송의 bgmRole) — 흐름 어휘는
// flowBgmRole을 넘긴다. 구간을 잇는 계산 자체는 두 화면이 **같은 것**을 써야 해서 하나로 둔다.
export function bgmCoverage(steps = [], tables = {}) {
  const roleOf = tables.role || bgmRole
  const lane = steps.map(() => null)
  steps.forEach((s, i) => {
    if (roleOf(s, tables) !== 'bgm' || s.enabled === false) return
    lane[i] = 'start'
    for (let j = i + 1; j < steps.length; j++) {
      // 꺼 둔 단계는 실행기가 건너뛴다 — 음악을 끄거나 멈추지 않으니 선은 그대로 지나간다(2026-09-26 Codex 검수 Medium).
      if (steps[j].enabled === false) { lane[j] = 'mid'; continue }
      const role = roleOf(steps[j], tables)
      if (role === 'bgm' || role === 'stop') break
      lane[j] = (role === 'pause') ? 'paused' : 'mid'
    }
  })
  for (let i = 0; i < lane.length; i++) {
    if (lane[i] && (i === lane.length - 1 || !lane[i + 1] || lane[i + 1] === 'start')) lane[i] += '|end'
  }
  return lane
}

// 흐름·커스텀 자동순서용 — 같은 계산에 흐름 어휘만 끼운다.
// (FlowBuilder.jsx의 편집 화면과 MorningEditor.jsx의 읽기 전용 미리보기가 같은 것을 그리도록)
export function flowBgmCoverage(steps = []) {
  return bgmCoverage(steps, { role: flowBgmRole })
}

// ── 단계의 **종류**(색·그림을 고르는 낱말) — 자동순서 편집기와 간편 화면 오늘 일과가 같이 쓴다 ──
// (사용자 지시 2026-09-17 N19: *"색이라도 세번쨰 자동순서편집처럼 넣어줘야지 구분이 가지 음원인지 TTS인지"*)
// 앞 판은 이 판정이 `StepList.jsx` 안에 한 줄로 박혀 있었다. 오늘 일과가 **다른 판정**을 쓰면 같은
// 단계가 두 화면에서 다른 색이 된다 — 그래서 여기로 뺐다. 표(어느 id 가 영상·BGM·음원인가)는
// 편집기 상수(`morningEditorConst.js`)에 그대로 있고, 부르는 쪽이 넘긴다.
// 순서가 뜻이다: 사람이 추가한 단계(customType)가 먼저, 그다음 내장 표 — 편집기 원래 순서 그대로.
export function stepKindOf(step, { videoIds, bgmIds, ttsKeys, audioMap } = {}) {
  if (!step) return 'plain'
  const c = step.customType
  if (c === 'bgm') return 'bgm'
  if (c === 'audio') return 'audio'
  if (c === 'chime') return 'chime'
  if (c === 'delay') return 'delay'
  if (c === 'video_file') return 'video'
  if (videoIds?.has?.(step.id)) return 'video'
  if (bgmIds?.has?.(step.id)) return 'bgm'
  if (ttsKeys?.has?.(step.id) || c === 'tts' || c === 'message') return 'tts'
  if (audioMap?.[step.id]) return 'audio'
  return 'plain'
}
