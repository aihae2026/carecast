// 시간대별 자동 방송 시퀀서 — 아침/체조/점심/저녁 방송을 단계적으로 실행
const { broadcastSSE }                           = require('./sse')
const { getMorningData, buildSegmentText }        = require('./morning')
const { todayStr, nowHHMM }                      = require('./repeatSchedule')
const { AUTO_BROADCASTS, autoTime }              = require('../domain/autoBroadcasts')

// 단계 실행기·영상 고르기의 본문은 broadcastSteps.js / broadcastVideoPicker.js에 있다 —
// 이 파일에는 방송 5종의 골격과 공통 실행기만 남긴다(2026-09-01). 아래 module.exports에서
// 기존 이름 그대로 재수출하므로 라우트·테스트의 기존 사용처는 그대로다.
const {
  stepOpts, ttsWaitMs, stepTTS, stepPrayerTTS, stepAudioFile, stepVideoFile,
  stepBGMStart, stepMealPrayer, stepVideoAfter, runCustomExtraStep,
} = require('./broadcastSteps')
// 단계가 무엇에 연결돼 있는지는 `domain/stepSource` 한 곳에서만 정한다(설계 §2-C).
// 예전엔 이 파일의 switch 에 카테고리 문자열이 박혀 있었고, 그래서 **사람이 고를 자리가
// 없었다.** 기본값은 그 문자열 그대로 옮겨 갔다 — `auto-broadcast-regression.test.js` 가
// 고치기 전에 떠 둔 기준선과 대조해서 그 사실을 지킨다.
const { resolveStepSource } = require('../domain/stepSource')

// 영상 단계의 실행 옵션 — 재생 옵션에 **TV 싱크 보정 갈래**를 얹는다(설계 §5).
// 음원 단계는 보정이 없으므로 `stepOpts(step)` 그대로다.
// TV 싱크 보정이 하나로 합쳐져(2026-09-16) 단계마다 고를 것이 없어졌다.
// 영상 단계도 다른 단계와 같은 옵션을 쓴다.
const 영상옵션 = (step) => stepOpts(step)

// ── 방송 취소·종료 대기 배관 ─────────────────────────────
// 본문은 broadcastGate.js에 있다 — flowRunner와 공유하는 배관이라, 시퀀서를 역참조하지
// 않고 둘 다 볼 수 있게 아래층으로 내렸다(배선도 ①). 라우트·테스트의 기존 사용처를 위해
// 아래 module.exports에서 이름 그대로 재수출한다. 상태(취소 세대·resolver 맵)는 게이트
// 모듈의 단일 상태라 의미가 예전과 같다.
const {
  newBroadcastToken, isCancelled,
  cancelGeneration, cancelCurrentBroadcast, stopCurrentBroadcast,
  wasHumanStopSince,
  broadcastStart, broadcastComplete,
  waitForVideoEnd, notifyVideoEnded,
  waitForAudioEnd, notifyAudioEnded,
} = require('./broadcastGate')

// ── 기본 TTS 문구 ──────────────────────────────────────────
// 본문은 domain/broadcastDefaults.js에 있다 — db/schema.js·index.js가 settings 시딩에
// 같은 문구를 쓰는데, 그러려고 이 엔진(순환 고리의 한가운데)을 require하지 않게 하기
// 위해서다(배선도 ②). 기존 사용처를 위해 아래 module.exports에서 이름 그대로 재수출한다.
const {
  BREAKFAST_PRAYER_DEFAULT, LUNCH_PRAYER_DEFAULT, DINNER_PRAYER_DEFAULT,
  EXERCISE_TTS_DEFAULT, LUNCH_TTS_DEFAULT, DINNER_TTS_DEFAULT,
  EVENING_PRAYER_TTS_DEFAULT, EVENING_PRAYER_TTS2_DEFAULT, EVENING_CLOSING_TTS_DEFAULT,
  MORNING_PRAYER_INTRO_DEFAULT, LUNCH_PRAYER_INTRO_DEFAULT, DINNER_PRAYER_INTRO_DEFAULT,
  DEFAULT_MEDICATION_TTS,
} = require('../domain/broadcastDefaults')

// ── 기본 방송 단계 정의 ────────────────────────────────────
// 네 방송의 첫 BGM 은 **기본 15분(durationSec 900)** — 사용자 지시 2026-09-24 *"0은 끝까지, 디폴트는 15분"*.
// 그전에는 칸이 0/없으면 숨은 설정 `<방송>_bgm_duration`(분, 화면에 칸 없음)이 먹었다. 이제 재생은 단계 칸만 본다.
// 저장된 칸이 0 이면 병합(...user)이 900 을 덮지 않고 0(끝까지)이 남는다. 옛 값은 dataFixes 가 한 번 옮겨 적었다.
// 「기도·묵상 시간(선택)」 단계(…_prayer_intro · …_prayer_audio · evening_prayer_tts2 ·
// evening_closing_audio)는 **기본으로 꺼져 있다**(사용자 결정 2026-10-17, 기본값 종교 중립).
// 단계 수·순서·id 는 그대로다 — 종교 시설은 순서 편집기에서 켜고 자기 문안·음원을 넣는다.
// 저장된 단계(…_steps)가 있는 PC 는 저장된 enabled 를 그대로 쓴다(mergeStepsWithDefaults).
const DEFAULT_STEPS = {
  morning: [
    { id: 'bgm',                   label: 'BGM 시작',               enabled: true,  order: 0, bgmSource: 'local', durationSec: 900 },
    { id: 'date_weather_schedule', label: '날짜/요일/날씨/일정 안내', enabled: true,  order: 1 },
    { id: 'morning_prayer_intro',  label: '기도·묵상 시간 안내 (선택)',  enabled: false,  order: 2 },
    { id: 'morning_prayer',        label: '기도·묵상 시간 음원 (선택)',  enabled: false,  order: 3 },
    { id: 'breakfast_prayer_tts',  label: '아침 식사 안내 (TTS)',     enabled: true,  order: 4 },
    // BGM 단계는 모두 이 PC 음원이다(2026-09-21). 폴더는 단계의 bgmRole, 없으면 방송 종류로 정한다
    // (domain/bgmRoles.js 기본역할 — 점심·저녁=식사용, 나머지=방송용). 한 방송의 두 BGM 단계가 같은
    // 폴더를 보므로 분위기가 갈리지 않는다.
    { id: 'bgm_after',             label: 'BGM 재시작 (식사 안내 후)', enabled: true,  order: 5, bgmSource: 'local' },
    { id: 'medication_tts',        label: '투약 안내 (TTS)',          enabled: true,  order: 6, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TTS, ttsVoice: 'female' },
    { id: 'morning_video',         label: '아침 후 배경 영상',       enabled: true,  order: 7, durationMin: 15 },
  ],
  exercise: [
    { id: 'bgm',            label: 'BGM 시작',           enabled: true, order: 0, bgmSource: 'local', durationSec: 900 },
    { id: 'exercise_tts',   label: '국민체조 안내 (TTS)', enabled: true, order: 1 },
    { id: 'exercise_video', label: '국민체조 영상',        enabled: true, order: 2 },
  ],
  lunch: [
    { id: 'bgm_start',          label: 'BGM 시작 (체조 준비)',    enabled: true, order: 0, bgmSource: 'local' },
    { id: 'lunch_tts',          label: '점심 체조 안내 (TTS)',    enabled: true, order: 1, ttsVoice: 'female' },
    { id: 'lunch_video',        label: '식사전 체조 영상',         enabled: true, order: 2 },
    { id: 'lunch_prayer_intro', label: '기도·묵상 시간 안내 (선택)', enabled: false, order: 3, ttsVoice: 'female' },
    { id: 'lunch_prayer_audio', label: '기도·묵상 시간 음원 (선택)', enabled: false, order: 4 },
    { id: 'lunch_prayer_tts',   label: '점심 식사 안내 (TTS)',     enabled: true, order: 5, ttsVoice: 'female' },
    { id: 'bgm',                label: 'BGM 시작 (식사 중)',      enabled: true, order: 6, bgmSource: 'local', durationSec: 900 },
    { id: 'medication_tts',     label: '투약 안내 (TTS)',          enabled: true, order: 7, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TTS, ttsVoice: 'female' },
    { id: 'lunch_video_after',  label: '식사 중 배경 영상',       enabled: true, order: 8, durationMin: 15 },
  ],
  dinner: [
    { id: 'bgm_start',          label: 'BGM 시작 (체조 준비)',    enabled: true, order: 0, bgmSource: 'local' },
    { id: 'dinner_tts',         label: '저녁 체조 안내 (TTS)',    enabled: true, order: 1, ttsVoice: 'male' },
    { id: 'dinner_video',       label: '식사전 체조 영상',         enabled: true, order: 2 },
    { id: 'dinner_prayer_tts',  label: '저녁 식사 안내 (TTS)',     enabled: true, order: 3, ttsVoice: 'male' },
    { id: 'bgm',                label: 'BGM 시작 (식사 중)',      enabled: true, order: 4, bgmSource: 'local', durationSec: 900 },
    { id: 'medication_tts',     label: '투약 안내 (TTS)',          enabled: true, order: 5, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TTS, ttsVoice: 'female' },
    { id: 'dinner_video_after', label: '식사 중 배경 영상',       enabled: true, order: 6, durationMin: 15 },
  ],
  evening_prayer: [
    { id: 'bgm',                   label: 'BGM 시작',                enabled: true, order: 0, bgmSource: 'local', durationSec: 0 },
    { id: 'evening_prayer_tts',    label: '마음 안정 시간 안내 (TTS)',    enabled: true, order: 1, ttsVoice: 'male' },
    { id: 'evening_prayer_audio',  label: '기도·묵상 시간 음원 (선택)',   enabled: false, order: 2 },
    { id: 'bgm_closing',           label: 'BGM 재시작 (안내 사이)',  enabled: true, order: 3, bgmSource: 'local', durationSec: 0 },
    { id: 'evening_prayer_tts2',   label: '기도·묵상 시간 안내 (선택)', enabled: false, order: 4, ttsVoice: 'male' },
    { id: 'evening_closing_audio', label: '기도·묵상 시간 음원 2 (선택)', enabled: false, order: 5 },
    { id: 'bgm_final',             label: 'BGM 재시작 (문안인사 전)', enabled: true, order: 6, bgmSource: 'local', durationSec: 10 },
    { id: 'evening_closing_tts',   label: '저녁 문안인사 (TTS)',      enabled: true, order: 7, ttsVoice: 'male' },
  ],
}

// ── 유틸 ───────────────────────────────────────────────────


// 날짜는 repeatSchedule의 로컬(KST) 구현 하나만 쓴다 — date-timezone.test.js 참고

// 취소 가능한 대기(tokenDelay)는 취소 토큰의 집인 broadcastGate에, 설정 읽기(getSetting)는
// domain/settingsRead에 있다. 2026-09-01에 잠깐 broadcastTokens.js라는 경유지를 뒀다가
// 2026-09-02에 각자 제자리로 돌려보냈다 — 둘을 옮기고 나니 그 파일에 남는 게 없었다.
const { getSetting, writeSetting: setSetting }   = require('../domain/settingsRead')
const { tokenDelay }                             = require('./broadcastGate')

// 활성화된 단계 목록 반환 (DB 설정 우선, 없으면 기본값)
// 병합 방식: DEFAULT_STEPS 기준으로 사용자 설정(enabled/order/ttsVoice) 보존
// - 기본값에 없는 스텝 ID 중 customType이 있는 것(사용자가 추가한 커스텀 스텝) → 저장된 순서
//   그대로 보존 (과거엔 여기서 조용히 drop되던 버그가 있었음 — settings.js의
//   parseSteps도 이 함수를 그대로 써서 두 곳이 같이 고쳐지게 함)
// - 기본값에만 있는 신규 스텝 ID → 기본값 순서(order:i)로 추가 (신규 배포로 생긴 스텝이라
//   저장된 순서 정보가 아예 없는 경우의 fallback)
// - 양쪽에 모두 있는 고정 스텝 → 사용자가 저장한 order를 그대로 존중 (드래그 재정렬 반영)
// - 고정 스텝과 커스텀 스텝을 합친 뒤 order로 한 번에 정렬 → 커스텀 스텝을 고정 스텝
//   사이로 옮겨서 저장해도(순서 편집기 드래그) 그 위치 그대로 유지됨(과거엔 커스텀 스텝이
//   항상 고정 스텝들 뒤로 밀려나던 버그가 있었음)
function mergeStepsWithDefaults(defaults, saved) {
  const savedMap = new Map(saved.map(s => [s.id, s]))
  const merged = defaults.map((def, i) => {
    const user = savedMap.get(def.id)
    if (!user) return { ...def, order: i }
    return {
      ...def,
      ...user,
      label:    def.label,           // 레이블은 항상 최신 기본값 사용
      order:    user.order ?? def.order,  // 사용자가 재정렬한 순서를 존중
      ttsVoice: user.ttsVoice ?? def.ttsVoice,
      // bgm_final의 durationSec만 항상 기본값(10) 고정 — TTS 도중 BGM이 꺼져 재생창이
      // 비활성화되는 버그 방지용 안전장치(2026-06-30 ec5689c). 다른 BGM 스텝(bgm_closing 등)의
      // "재생 시간" 슬라이더는 사용자가 저장한 값을 그대로 써야 한다.
      ...(def.id === 'bgm_final' ? { durationSec: def.durationSec } : {}),
      // medication_tts: 저장된 내용이 없으면 기본 텍스트 사용
      ...(def.id === 'medication_tts' && !user.content?.trim() ? { content: def.content } : {}),
      // 식사 중 영상 재생 시간: 구버전 기본값(10분) 저장된 경우 새 기본값으로 업그레이드
      ...(['lunch_video_after', 'dinner_video_after'].includes(def.id) && (user.durationMin ?? 0) <= 10 ? { durationMin: def.durationMin } : {}),
    }
  })

  const defaultIds = new Set(defaults.map(d => d.id))
  const customSteps = saved.filter(s => !defaultIds.has(s.id))
  // **지운 단계(`deleted: true`)는 언제나 꺼진 단계로 둔다**(2026-10-23, 단계 삭제).
  // 기본 단계는 저장본에서 빼면 위에서 기본값으로 되살아나므로, 화면은 빼는 대신 이 표시를
  // 남긴다. enabled 를 여기서 false 로 못박아 두면 방송·예상 시간·미리 합성처럼 `enabled` 만
  // 보는 곳이 따로 고치지 않아도 전부 건너뛴다. 화면이 enabled:true 로 보내도 마찬가지다.
  return [...merged, ...customSteps]
    .map(s => (s && s.deleted ? { ...s, deleted: true, enabled: false } : s))
    .sort((a, b) => a.order - b.order)
}

function getSteps(db, tab) {
  const defaults = DEFAULT_STEPS[tab] ?? []
  const raw = getSetting(db, `${tab}_steps`, '')
  if (!raw) return [...defaults].sort((a, b) => a.order - b.order)
  try {
    return mergeStepsWithDefaults(defaults, JSON.parse(raw))
  } catch {
    return [...defaults].sort((a, b) => a.order - b.order)
  }
}

// ── 아침 안내문 세그먼트 텍스트 만들기 ────────────────────────
// morning_segments에서 꺼둔 항목은 건너뛴다. 예전엔 여기서 weather/dust/alert를 무조건
// 넣어버려서, 대시보드에서 "날씨 안내"·"미세먼지"를 꺼도 안내문에 그대로 나갔다.
function segmentTexts(db, ids, data) {
  let disabled = new Set()
  try {
    const raw = getSetting(db, 'morning_segments', '')
    if (raw) {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        disabled = new Set(saved.filter(s => s.enabled === false).map(s => s.id))
      }
    }
  } catch { /* 설정이 깨져 있으면 전부 켜진 것으로 간주 — 안내가 빠지는 것보다 안전 */ }

  return ids
    .filter(id => !disabled.has(id))
    .map(id => buildSegmentText(id, data))
    .filter(Boolean)
}

/**
 * 아침 안내 조각을 **둘로 나눠** 내보낸다 — 네트워크 없이 만들 수 있는 것과 아닌 것.
 *
 * 왜 나누나(2026-09-06): 현장은 07:49 부팅 → 07:50 방송이다. 예전에는 조각을 하나로
 * 이어 붙여 한 번에 합성했는데(`parts.join(' ')`), 그러면 그 60초 안에 **전부**를
 * 만들어야 한다. 날짜·인사는 시계만 보므로 부팅 직후 네트워크 없이 미리 만들 수 있고,
 * 그러면 임계 구간에 남는 것은 **날씨 문장 하나**다.
 *
 * ── 되돌리는 법 (현장에서 간격이 어색하다고 하면) ──────────────────────
 * **캐시 구조는 그대로 두고 이어 붙이기만 복원하면 된다.** 아래 두 번의 stepTTS 를
 * 예전처럼 한 번으로 합치면 끝이다(`await stepTTS(db, [...앞, ...뒤].join(' '), title, ...)`).
 * 선제 렌더(prerenderAuto)는 조각 단위로 캐시를 만들 뿐이라, 합쳐도 깨지지 않는다 —
 * 그때는 그 캐시가 안 쓰일 뿐이고 동작은 예전과 같다.
 * 간격이 거슬리는 정도라면 먼저 `morning_segment_gap_ms` 를 0 으로 낮춰 본다.
 */
async function 아침안내(db, ids, title, tok, data, step) {
  const { splitSegments, gapMs } = require('../domain/morningSegments')
  const { early, external } = splitSegments(ids)

  const 앞 = segmentTexts(db, early, data)
  const 뒤 = segmentTexts(db, external, data)

  if (앞.length) await stepTTS(db, 앞.join(' '), title, tok, stepOpts(step))
  if (앞.length && 뒤.length) {
    const ms = gapMs((k, d) => getSetting(db, k, d))
    if (ms > 0) await tokenDelay(ms, tok)
  }
  if (뒤.length && !isCancelled(tok)) await stepTTS(db, 뒤.join(' '), title, tok, stepOpts(step))
}

// ── 방송 로그 기록 ──────────────────────────────────────────
function logBroadcast(db, type, content, success, laneId = null, failReason = null) {
  // 지연 계측을 꺼내 함께 남긴다(0024 컬럼). 못 잰 경우는 NULL 이다 — "0"으로 적으면
  // "지연이 없었다"와 "안 쟀다"가 구별되지 않는다.
  let t = { scheduledAt: null, playedAt: null, delayMs: null }
  const runId = require('./runContext').currentRunId()
  try { t = require('./laneTiming').takeTiming(runId) } catch { /* 계측 실패는 방송 실패가 아니다 */ }
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())
  const source = laneId && LANES[laneId] ? LANES[laneId].contentSource : null

  db.prepare(
    // run_key(0022)를 함께 남긴다 — 이게 없으면 화면이 이 이력 줄의 단계를 못 찾는다.
    // 제목·시각으로 맞추는 방법은 같은 방송이 하루 두 번 나가면 곧바로 어긋난다.
    'INSERT INTO broadcasts (date, time, type, content, user, target, success, run_key, '
    // 0026 — 왜 실패했나를 코드로 남긴다(P-95). 성공 행에서는 NULL 이다.
    + 'content_source, scheduled_at, played_at, delay_ms, fail_reason) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(todayStr(), nowHHMM(), '자동', content, '자동', '전체', success ? 1 : 0, runId,
    source, iso(t.scheduledAt), iso(t.playedAt), t.delayMs,
    require('../domain/broadcastRecord').사유코드(failReason))
}

// 단계 하나의 실패가 시퀀스 전체를 죽이지 않게 감싼다.
//
// 예전엔 for 루프 안에서 단계가 throw하면 그대로 루프를 뚫고 나가 방송이 통째로 끝났다.
// (그때) TTS는 인터넷 합성을 타고 실패까지 186초가 걸렸는데, 첫 단계가 대개 TTS라서
// **인터넷이 끊긴 날엔 로컬 mp3만으로 나갈 수 있었던 녹음 음원까지 같이 죽었다.**
// 코드 경로로 세어 보면 6회 중 생존 0회였다.
//
// 취소는 실패가 아니다. 사람이 정지를 눌렀거나 새 방송이 시작된 것이라 조용히 빠진다 —
// 정지할 때마다 경보가 뜨면 사람이 경보를 무시하기 시작한다.
// 지금 몇 번째 단계인지 화면에 알린다(n8n이 실행 중인 노드를 밝혀 주는 것과 같은 것).
//
// 왜 필요했나: 방송 중 화면에는 "방송 중" 넉 자뿐이라, 5분째 조용할 때 그게 **원래 조용한
// 단계**(6분 대기 중인 투약 안내)인지 멈춘 것인지 알 방법이 없었다.
// **알리려다 방송을 멈추면 본말전도**라 절대 던지지 않는다.
function announceStep(title, step, progress) {
  if (!progress) return
  try {
    broadcastSSE('broadcast_step', {
      title,
      stepId: step?.id ?? null,
      label:  step?.label || step?.id || '',
      index:  progress.index,
      total:  progress.total,
    })
  } catch (e) {
    console.error('[시퀀서] 단계 알림 실패:', e.message)
  }
}

async function runStepGuarded(db, tok, title, step, body, progress) {
  // **실행 전에** 알린다 — 끝나고 알리면 6분짜리 대기 단계 동안 화면이 이전 단계를 가리킨다.
  // 실패한 단계도 이미 알림이 나가 있어야 "어디서 멈췄나"가 보인다.
  announceStep(title, step, progress)
  // 단계별 실행 기록(0021) — 모든 단계가 이 함수를 지나므로 여기 한 곳에서 남긴다.
  // 이력은 방송 1건에 한 줄이라 "어느 단계에서 멎었나"가 남지 않았다.
  const stepStartedAt = Date.now()
  try {
    // body 가 **사유를 내면** 그 사유대로 적는다(P-22 나머지 절반 AP-0043 → P-57 로 확장).
    // 아무것도 안 돌려주는 단계가 대부분이고, 그것은 성공이다 — 모르는 값을 실패로 보면
    // 멀쩡한 방송이 전부 실패로 찍힌다.
    //
    // **배너 경보는 안 띄운다.** 차임은 보조 신호라(사용자 결정 2026-09-07) 단계 이력에만
    // 남긴다 — 안내는 정상으로 나갔는데 이력만 실패로 보이면 사람이 이력을 안 믿는다.
    // 흐름(flowRunner) 쪽과 같은 정책이다(flow-chime-outcome.test.js:118).
    const outcome = await body()
    // **사유를 그대로 읽는다**(P-57). 예전엔 `outcome === false` 하나만 보고, 취소인지는
    // `isCancelled(tok)` 로 **다시 추측**했다. 되짚기라서 틈이 생겼다 — 진짜 차임 고장 직후에
    // 다른 방송이 밀어내면 그 순간 `isCancelled` 가 참이 되어 **그 실패가 기록 없이 사라진다.**
    // 판정은 `domain/stepHistory.이력판정()` 한 곳에 있다(흐름과 같은 어휘를 본다).
    const 판정 = require('../domain/stepHistory').이력판정(outcome)
    if (판정 === null) return   // 취소 — 적지 않는다. 정지 버튼을 누른 사람에게 실패를 보이지 않는다
    require('../domain/stepHistory').record(db, {
      title, step, result: 판정.result, ms: Date.now() - stepStartedAt, detail: 판정.detail,
    })
    if (판정.result === '실패') {
      // **배너 경보는 안 띄운다**(위 주석). 단계 이력에만 남긴다.
      const lbl = step?.id || step?.label || '알 수 없는 단계'
      console.warn(`[시퀀서] "${title}" 단계 "${lbl}": ${판정.detail} — 방송은 계속합니다`)
    }
  } catch (err) {
    if (isCancelled(tok)) return
    require('../domain/stepHistory').record(db, {
      title, step, result: '실패', ms: Date.now() - stepStartedAt, detail: err.message,
    })
    const label = step?.id || step?.label || '알 수 없는 단계'
    console.error(`[시퀀서] "${title}" 단계 "${label}" 실패 — 건너뜁니다:`, err.message)
    // alert.raise가 broadcasts(success=0) + 화면 배너 + 로그를 한 번에 처리한다.
    // logBroadcast를 따로 부르면 같은 실패가 이력에 두 줄로 남는다.
    try {
      require('./alert').raise('방송단계', `${title}의 "${label}" 단계가 실패했습니다: ${err.message}`)
    } catch (e) {
      // 경보 통로까지 막힌 상황 — 최소한 로그는 위에서 남겼다
      console.error('[시퀀서] 단계 실패 경보 전달 실패:', e.message)
    }
  }
}

// ── 일과방송 5종의 공통 실행기 ─────────────────────────────
// 원래 아래 fire*Broadcast 5개가 이 골격 25줄을 **각자 복사해서** 갖고 있었다. 한 곳에만
// 안전장치를 달면 나머지 넷이 조용히 그 보호를 잃는 구조라, 실제로 두 번 사고가 났다
// (CC-052 커스텀 단계 stepOpts 누락 3곳, CC-046 아침방송 구현이 두 벌).
//
// **5종이 서로 다른 지점만** 아래 LANES 표의 열로 남긴다. 이 표는
// server/test/fire-broadcast-skeleton.test.js의 CASES 표와 같은 축이고, 그 테스트가
// 여기 적힌 제목·문구·키·SSE 순서를 실제로 실행해 대조한다 — 표를 잘못 고치면 거기서 걸린다.
// ── contentSource: 이 방송의 문안이 매번 달라지는가 (2026-09-06) ────────────
//
// 자동 5종은 `schedules` 에 행이 없다(이 파일은 그 표를 읽지 않는다). 그래서 예약처럼
// DB 컬럼에 성격을 적을 자리가 없다 — **새 표를 만들거나 가짜 행을 넣는 대신 여기 적는다.**
// 이 표는 원래 "5종이 서로 다른 지점"을 모아 두는 곳이라 성격도 여기가 제 자리다.
//
//   system_template : 발사 때마다 내용이 달라진다(외부 데이터 참조 — 날씨·미세먼지)
//   system_static   : settings 의 고정 문안. 그 값이 바뀔 때만 다시 만든다
//
// 이름이 비슷해 헷갈리기 쉽다. 가르는 기준은 하나다 — **문안이 외부 데이터를 보는가.**
// 아침만 그렇다(morning.js 가 날씨·미세먼지를 받아 문장을 짓는다).
// 나머지 넷은 `dinner_tts` 처럼 사람이 화면에서 써 둔 고정 문구라, 매일 다시 만들 이유가 없다.
const LANES = {
  morning: {
    tab: 'morning',        title: '아침 종합 방송',
    runLog: '아침 방송',    logContent: '아침 방송',
    errorLog: '아침 방송 오류', errorPrefix: '아침 방송 오류: ',
    lastFiredKey: 'morning_last_fired',
    contentSource: 'system_template',   // 날씨·미세먼지가 들어간다 → 가변
    // 5종 중 아침만 루프 전에 날씨·일정을 받아 온다(실패하면 catch로 떨어지는 것도 그대로다)
    prepare: () => getMorningData(),
  },
  exercise: {
    tab: 'exercise',       title: '국민체조',
    runLog: '국민체조 방송', logContent: '국민체조 방송',
    errorLog: '국민체조 방송 오류', errorPrefix: '국민체조 오류: ',
    lastFiredKey: 'exercise_last_fired',
    contentSource: 'system_static',
  },
  lunch: {
    tab: 'lunch',          title: '점심 식사 전 방송',
    runLog: '점심 방송',    logContent: '점심 방송',
    errorLog: '점심 방송 오류', errorPrefix: '점심 방송 오류: ',
    lastFiredKey: 'lunch_last_fired',
    contentSource: 'system_static',
  },
  dinner: {
    tab: 'dinner',         title: '저녁 식사 전 방송',
    runLog: '저녁 방송',    logContent: '저녁 방송',
    errorLog: '저녁 방송 오류', errorPrefix: '저녁 방송 오류: ',
    lastFiredKey: 'dinner_last_fired',
    contentSource: 'system_static',
  },
  evening_prayer: {
    tab: 'evening_prayer', title: '저녁 마무리',
    runLog: '저녁 마무리 방송', logContent: '저녁 마무리 방송',
    errorLog: '저녁 마무리 방송 오류', errorPrefix: '저녁 마무리 오류: ',
    lastFiredKey: 'evening_prayer_last_fired',
    contentSource: 'system_static',
    // 저녁 마무리만 완료 직후 BGM에 15초 타이머를 걸어 자연스럽게 페이드아웃시킨다
    closingBgmTimerSec: 15,
  },
}

/**
 * 일과방송 한 편을 실행한다. 단계 하나를 어떻게 처리할지는 runStep이 정한다.
 * @param {object} lane  LANES의 한 줄
 * @param {(step, tok, prep) => Promise<void>} runStep  단계 처리기(각 방송의 switch 본문)
 */
// opts.manual: 사람이 「수동재생」으로 낸 것. 발사 표시(lastFiredKey)를 찍지 않는다 —
// 07:00에 확인차 들어봤다고 07:50 정시 방송이 사라지면 안 된다(사용자 결정 2026-09-01).
// 누락 감시(watchdog)도 이 키를 보므로, 안 찍는 쪽이 감시에도 맞다.
function validateStartIndex(steps, opts = {}) {
  if (opts.startIndex === undefined) return 0
  const index = opts.startIndex
  if (!Number.isInteger(index) || index < 0 || index >= steps.length || !steps[index].enabled) {
    const error = new Error('재생할 단계가 올바르지 않습니다. 목록을 다시 열어 선택해 주세요.')
    error.status = 400
    throw error
  }
  if ((!opts.manual && index !== 0) || (opts.startStepId !== undefined && opts.startStepId !== steps[index].id)) {
    const error = new Error('방송 단계가 변경되었거나 수동 재생 요청이 아닙니다. 다시 선택해 주세요.')
    error.status = 400
    throw error
  }
  return index
}

async function runBroadcastLane(db, lane, opts, runStep) {
  // 잘못된 선택이 현재 방송의 토큰을 취소하기 전에 거절한다.
  const steps = getSteps(db, lane.tab)
  const startIndex = validateStartIndex(steps, opts)
  const tok   = newBroadcastToken()
  // 이 방송이 시작한 시점의 취소 세대. 나중에 "나를 끊은 것이 사람이었나 다른 방송이었나"를
  // 이 번호로 되묻는다(ISSUE-010). newBroadcastToken이 앞 방송을 끊으며 세대를 이미 한 번
  // 올렸으므로, 나를 끊을 취소는 이 다음 세대다.
  const startGen = cancelGeneration()
  const today = todayStr()
  console.log(`[시퀀서] ${lane.runLog} 시작 (${nowHHMM()})`)

  // **시작 표시** — 누락 감시(watchdog.js)가 "나가는 중"과 "안 나갔다"를 가르는 근거다.
  // 완료 표시(lastFiredKey)만으로는 5분을 넘기는 방송이 매일 누락으로 찍힌다(2026-09-01).
  // 키는 domain/autoBroadcasts 한 곳에서 꺼낸다 — 감시와 같은 표를 봐야 어긋나지 않는다.
  // 수동재생은 완료 표시와 같은 규칙으로 안 찍는다.
  // try로 감싸는 이유: 이 표시가 실패해도 **방송은 나가야 한다.** 감시용 기록 하나 때문에
  // 시퀀스가 catch로 떨어지면, 고치려던 것보다 훨씬 큰 것을 잃는다.
  //
  // 끝까지 못 간 방송(사람이 정지·바깥 catch)에서는 이 표시를 **거둔다**. 표시의 뜻이
  // "지금 정상적으로 나가는 중"이라서, 끝나지 않은 채 빠져나온 방송이 그 뜻을 갖고 있으면
  // 감시가 60분을 헛기다린다. 서버가 통째로 죽었을 때만 표시가 남는다 — 그게 알릴 값어치다.
  const markStarted = (value) => {
    if (opts.manual) return
    try {
      const spec = AUTO_BROADCASTS.find(x => x.id === lane.tab)
      if (spec) setSetting(db, spec.startedKey, value)
    } catch (e) {
      console.warn(`[시퀀서] 시작 표시 실패(방송은 계속한다): ${e.message}`)
    }
  }
  markStarted(today)

  // 이력 문구 — 「여기부터 재생」으로 중간부터 틀었으면 시작 단계를 붙인다(2026-09-26 검수 Medium).
  // 이력은 「홀에서 무엇이 나갔나」의 기록이라(P-32), 앞 단계가 안 나갔다는 흔적이 있어야 한다.
  // 번호는 아래 진행 표시와 같이 **켜진 단계 기준**이다.
  // 밀림 줄에는 안 붙인다 — 누락 감시(watchdog.js 밀림 조회)가 그 문구를 글자 그대로 맞춘다.
  const 이력문구 = startIndex > 0
    ? `${lane.logContent} (${steps.slice(0, startIndex).filter(s => s.enabled).length + 1}단계 「${steps[startIndex].label}」부터)`
    : lane.logContent

  // 밀려서 끝난 방송만 이력에 실패로 남긴다(ISSUE-010, 사용자 결정 안 (나)).
  // **배너는 띄우지 않는다** — alert.raise를 부르지 않고 logBroadcast만 부른다. 정시 방송을
  // 수동재생으로 앞당기는 것은 현장에서 흔한 조작이라, 그때마다 경보가 뜨면 사람이 경보를
  // 무시하기 시작한다. 사람이 정지 버튼을 누른 것은 실패가 아니므로 여기 안 걸린다.
  // ── P-32: **수동재생도 남긴다. 일부러 그렇다** ──────────────────────
  // `opts.manual` 을 안 가린다. 성공 경로(`logBroadcast(..., true, ...)`)도 안 가리므로
  // 두 쪽이 일관된다 — 확인차 튼 미리듣기도 이력에 남는다.
  // **왜 그대로 두나**: 이력은 "무슨 소리가 언제 나갔나"의 기록이고, 미리듣기도 스피커로
  // 진짜 나간 소리다. 빼면 홀에서 들린 것이 기록에 없는 상태가 된다 —
  // 이 저장소가 가장 비싸게 데인 유형(무음인데 기록은 멀쩡, 또는 그 반대)이다.
  // **아프던 것은 따로 있었다**: 밀린 미리듣기가 대시보드 "오류" 숫자를 올리던 것(P-31).
  // 그쪽을 고쳐서 해악이 사라졌다 — 이력에는 남고, 오류로는 안 센다.
  // 미리듣기를 이력에서 빼고 싶다면 여기 한 줄(`if (opts.manual) return`)이지만,
  // 그건 "홀에서 들린 소리를 기록에서 지운다"는 뜻이라 사람이 정할 일이다.
  const logPreempted = () => {
    try {
      if (wasHumanStopSince(startGen)) return
      const BR = require('../domain/broadcastRecord')
      logBroadcast(db, '자동', BR.밀림문구(lane.logContent), false, lane.tab, BR.사유.밀림)
      console.log(`[시퀀서] ${lane.runLog} 중단 — 다른 방송에 밀렸다 (${nowHHMM()})`)
    } catch (e) {
      console.warn(`[시퀀서] 밀림 이력 기록 실패: ${e.message}`)
    }
  }

  // 지연 계측을 연다 — 예정 시각(설정값)에서 첫 소리까지가 사람이 느끼는 지연이다.
  // 실패해도 방송은 그대로 간다(계측이 방송을 막으면 안 된다).
  try {
    const timing = require('./laneTiming')
    const spec = AUTO_BROADCASTS.find((s) => s.id === lane.tab)
    // 빈 시각이면 예정 시각이 없다 — 지연을 0 분으로 재는 것보다 안 재는 편이 정직하다(P-35).
    const 예정t = spec ? autoTime(getSetting(db, spec.timeKey), spec) : null
    const 예정 = 예정t ? timing.scheduledMsToday(예정t) : null
    timing.laneStarted(require('./runContext').currentRunId(), 예정)
  } catch { /* 계측 실패는 방송 실패가 아니다 */ }

  // 이 방송이 **한 번이라도 받을 창 없이** 송출됐나. 한 번이면 족하다 — 그 단계는
  // 아무도 못 들었고, 뒤에 창이 돌아왔다고 들린 것이 되지 않는다.
  //
  // **언제 재나**: 레인 시작 · 단계마다 앞뒤. 송출은 `runStep` 안에서 일어나므로 그 순간을
  // 직접 집지는 못한다 — 단계 앞뒤로 집으면 **그 사이에 닫힌 창**도 잡힌다.
  // 단계 앞에만 재면 놓친다: 단계 사이에 `tokenDelay(800)` 이 있어서, 그 800ms 동안
  // 창이 돌아오면 **재는 시점이 이미 늦다**(이 시험을 처음 쓸 때 그렇게 헛돌았다).
  let 놓친송출 = false
  const 창표본 = () => { if (!require('./sitePlayer').hasSitePlayer()) 놓친송출 = true }
  창표본()
  // ── **단계 *안*에서 닫힌 것도 잡는다** (V③ R8 지적) ─────────────────────────────
  // 경계 표본은 `runStepGuarded` 앞뒤만 본다. 그런데 TTS 단계는 **합성 대기 → 송출 →
  // 종료 대기**가 한 덩이라, 그 안에서 닫혔다 돌아오면 표본 넷이 모두 「있음」이다.
  // 그래서 **연결이 끊긴 사건 수**를 시작과 끝에서 견준다 — 그 수는 창이 떨어질 때마다
  // 오르고 줄지 않으므로, 값이 달라졌다면 **그동안 한 번은 없었다**는 뜻이다.
  const 무창시작 = require('./sitePlayer').무창사건수()
  // 창이 둘일 때 **재생하던 창만** 닫히는 경우 — 위 수는 안 오른다. 담당 교체를 따로 센다.
  const 담당시작 = require('./sitePlayer').담당바뀜수()

  try {
    broadcastStart(lane.title, lane.tab)
    const prep  = lane.prepare ? await lane.prepare() : undefined

    // 번호는 **켜진 단계 기준**이다 — 꺼 둔 것까지 세면 화면이 "3/8"인데 실제로는 6단계만 돈다
    const totalSteps = steps.filter(s => s.enabled).length
    let stepNo = steps.slice(0, startIndex).filter(s => s.enabled).length

    for (const step of steps.slice(startIndex)) {
      if (!step.enabled) continue
      if (isCancelled(tok)) break
      stepNo++
      창표본()                    // 지연 **앞**에서도 한 번 — 그 800ms 사이에 창이 돌아와도 안 속는다
      await tokenDelay(800, tok)
      if (isCancelled(tok)) break

      // ── **송출 순간마다 창이 있었는지 본다** (V③ R7 지적, 2026-09-14) ──────────
      // 처음에는 단계 루프가 **끝난 뒤에만** 창을 봤다. 그러면 송출할 때는 창이 없었는데
      // 끝날 무렵 돌아온 경우 **전체가 성공으로 기록된다** — 그 방송은 아무도 못 들었다.
      // 하필 이번에 넣은 **자동 재개 루프**(창이 없으면 15초 뒤 다시 연다)가 방송 도중에
      // 창을 살릴 수 있어서, 내 수정이 거짓 성공을 만들 참이었다.
      // 그러니 **놓친 송출이 한 번이라도 있었으면** 마지막에 창이 돌아와도 성공이 아니다.
      창표본()
      await runStepGuarded(db, tok, lane.title, step, () => runStep(step, tok, prep),
        { index: stepNo, total: totalSteps })
      창표본()
    }

    if (!isCancelled(tok)) {
      if (!opts.manual) setSetting(db, lane.lastFiredKey, today)
      // ── **소리 낼 창이 없으면 성공이 아니다** (현장 사고 2026-09-14) ──────────
      // 이 레인의 소리는 거의 전부 **브라우저**가 낸다(예약 5경로와 같다 —
      // `PROJECT_PROFILE` §1-3). 예약 쪽은 진작부터 `hasSitePlayer()` 를 보는데
      // **자동방송 5종만 안 봤다.** 그래서 그날 18:00 저녁 마무리 방송이 아무 소리 없이
      // 지나갔는데 이력에는 **성공**으로 남았다 — 무음인데 기록은 멀쩡한, 이 저장소가
      // 가장 비싸게 데인 모양이다. 판정은 예약과 **같은 모듈**을 쓴다(사본을 두면
      // 예약과 자동의 성공 판정이 조용히 갈린다, FP-0005).
      // 끝에서 한 번 더 본다 — 도중에 닫힌 경우를 잡는다. **둘 다 참이어야** 성공이다.
      // 셋을 **모두** 본다: 경계 표본 · 도중에 끊긴 사건 · 끝난 순간.
      if (require('./sitePlayer').무창사건수() !== 무창시작) 놓친송출 = true
      if (require('./sitePlayer').담당바뀜수() !== 담당시작) 놓친송출 = true
      // ── **창이 있는 것과 소리를 낼 수 있는 것은 다르다** (현장 사고 2026-09-15) ────
      // 위 셋은 전부 *"창이 있었나"* 를 묻는다. 그런데 2026-09-15 아침에는 **창이
      // 내내 붙어 있었는데도** 07:50 방송이 아무 소리 없이 지나갔다 — 브라우저가
      // 자동재생을 막아 **소리만 잠겨** 있었고, 그래서 위 검사를 전부 통과해
      // **성공으로 적혔다.** 사람은 다음 날에야 알았다.
      // 이제 화면이 자기 소리 상태를 알려 주므로 그것도 함께 본다.
      const 소리낼수있나 = require('./sitePlayer').소리낼수있나()
      const 들렸나 = !놓친송출 && require('./sitePlayer').hasSitePlayer() && 소리낼수있나
      logBroadcast(db, '자동', 이력문구, 들렸나, lane.tab,
        들렸나 ? null : require('../domain/broadcastRecord').사유.화면없음)
      if (!들렸나) {
        // **여기서는 배너를 띄운다.** 단계 하나가 실패한 것과 달리 이건 **방송 전체가
        // 무음**이고, 사람이 할 일도 분명하다 — 현장 PC 에서 localhost 화면을 열면 된다.
        // 경보가 실패해도 방송 흐름은 계속한다(경보 때문에 방송이 멎으면 본말전도다).
        // **`이미기록됨` 을 주는 이유**: 바로 위에서 이 방송의 실패 행을 **직접 적었다.**
        // 안 주면 같은 사건이 이력에 두 줄(`자동` + `경보`)로 남는다 — 이 파일이 단계 실패
        // 자리에 적어 둔 규칙과 같다. 추측이 아니라 **방금 쓴 것을 아는 경우**라 허용된다(P-28).
        try {
          // **사람이 할 일이 두 경우에 다르다.** 창이 없으면 열어야 하고, 창은 있는데
          // 소리가 잠겼으면 **여는 것으로 안 낫는다** — 새로고침하거나 띠를 눌러야 한다.
          // 한 문구로 뭉뚱그리면 선생님이 localhost 를 또 열어 보고 "그대로인데?" 가 된다
          // (2026-09-15 아침에 실제로 F5 로 풀렸다).
          const 창은있다 = require('./sitePlayer').hasSitePlayer()
          require('./alert').raise('현장화면없음',
            창은있다 && !소리낼수있나
              ? `「${lane.title}」 방송이 소리 없이 지나갔습니다 — 방송 화면은 열려 있는데 `
                + '**소리가 잠겨** 있습니다. 그 화면에서 F5(새로고침)를 누르거나, '
                + '화면 위의 「눌러서 소리 켜기」 띠를 한 번 눌러 주세요.'
              : `「${lane.title}」 방송이 소리 없이 지나갔습니다 — 현장 PC에 방송 화면이 열려 있지 않습니다. `
                + '현장 PC에서 http://localhost:3001 을 열어 주세요.',
            {}, db, { 이미기록됨: true })
        } catch (e) {
          console.error('[시퀀서] 무음 경보 전달 실패:', e.message)
        }
      }
      if (lane.closingBgmTimerSec) {
        broadcastSSE('bgm_set_timer', { durationSec: lane.closingBgmTimerSec })
      }
      console.log(`[시퀀서] ${lane.runLog} 완료 (${nowHHMM()})`)
    } else {
      markStarted('')          // 끝까지 못 갔다 — 감시가 "멈춘 방송"으로 오해하지 않게
      logPreempted()
    }
  } catch (err) {
    markStarted('')
    if (!isCancelled(tok)) {
      console.error(`[시퀀서] ${lane.errorLog}:`, err.message)
      logBroadcast(db, '자동', `${lane.errorPrefix}${err.message}`, false, lane.tab)
    } else {
      // 단계가 throw하는 사이에 밀린 경우도 같은 사건이다 — 여기서도 남긴다.
      logPreempted()
    }
  } finally {
    // 오류 이력 저장까지 실패해도 실행 잠금을 남기지 않는다. 밀려난 실행이
    // 뒤이어 시작한 방송의 잠금을 풀지 않도록 현재 토큰 소유자만 정리한다.
    if (!isCancelled(tok)) broadcastComplete(lane.title)
  }
}

// ── 07:50 아침 종합 방송 ────────────────────────────────────
async function fireMorningBroadcast(db, opts = {}) {
  return runBroadcastLane(db, LANES.morning, opts, async (step, tok, data) => {
      switch (step.id) {
        case 'bgm': {
          stepBGMStart(db, 'morning', 0, step, tok)   // 길이는 단계 칸(durationSec)만 — 숨은 분 설정을 걷었다(2026-09-24)
          await tokenDelay(1500, tok)
          break
        }
        case 'bgm_after': {
          stepBGMStart(db, 'morning', 0, step, tok)
          await tokenDelay(1000, tok)
          break
        }
        case 'medication_tts': {
          if (step.end_date && todayStr() > step.end_date) {
            console.log(`[시퀀서] 투약 안내 스킵 — 종료일 초과 (${step.end_date})`)
            break
          }
          const medText = (step.content?.trim()) || DEFAULT_MEDICATION_TTS
          const delayMin = Number(step.delay_min) || 6
          console.log(`[시퀀서] 투약 안내 — ${delayMin}분 대기 후 방송`)
          await tokenDelay(delayMin * 60 * 1000, tok)
          if (!isCancelled(tok)) await stepTTS(db, medText, '투약 안내', tok, stepOpts(step))
          break
        }
        case 'morning_video': {
          // BGM은 bgm_after에서 이미 시작됨 — 여기서 재시작 않음
          // durationMin 후 클라이언트(MorningVideoDisplay)가 BGM도 같이 정지
          await stepVideoAfter(db, step, null, tok)
          break
        }
        case 'date_weather_schedule': {
          await 아침안내(db, ['date', 'weather', 'dust', 'alert', 'schedule'], '날씨/일정 안내', tok, data, step)
          break
        }
        case 'date_weather': {
          await 아침안내(db, ['date', 'weather', 'dust', 'alert'], '아침 날씨 안내', tok, data, step)
          break
        }
        case 'morning_prayer_intro': {
          const text = getSetting(db, 'morning_prayer_intro_tts', MORNING_PRAYER_INTRO_DEFAULT)
          await stepTTS(db, text, '기도·묵상 시간 안내', tok, stepOpts(step))
          break
        }
        case 'morning_prayer':
          // 연결은 `resolveStepSource` 가 정한다. 저장된 것이 없으면 기본표대로
          // 'morning-prayer' 라 **지금과 같다**. `return await` 인 것은 연결 오류 사유를
          // 이력까지 나르기 위함이다(P-57 과 같은 규약) — `break` 로 두면 조용히 사라진다.
          return await stepAudioFile(db, resolveStepSource(db, step), 0, 300, tok, stepOpts(step))
        case 'breakfast_prayer_tts': {
          const text = getSetting(db, 'breakfast_prayer_tts', BREAKFAST_PRAYER_DEFAULT)
          return await stepMealPrayer(db, resolveStepSource(db, step), text, '아침 식사 안내', tok, stepOpts(step))
        }
        case 'schedule': {
          const text = buildSegmentText('schedule', data)
          if (text) await stepTTS(db, text, '오늘의 일정', tok, stepOpts(step))
          break
        }
        default: {
          if ((step.customType === 'tts' || step.customType === 'message') && step.content?.trim()) {
            await stepTTS(db, step.content.trim(), step.label || '커스텀 방송', tok, stepOpts(step))
          } else {
            return await runCustomExtraStep(db, step, tok)
          }
        }
      }
  })
}

// ── 08:40 국민체조 ──────────────────────────────────────────
async function fireExerciseBroadcast(db, opts = {}) {
  return runBroadcastLane(db, LANES.exercise, opts, async (step, tok) => {
      switch (step.id) {
        case 'bgm': {
          stepBGMStart(db, 'exercise', 0, step, tok)   // 길이는 단계 칸만(2026-09-24)
          await tokenDelay(1500, tok)
          break
        }
        case 'exercise_tts': {
          const text = getSetting(db, 'exercise_tts', EXERCISE_TTS_DEFAULT)
          await stepTTS(db, text, '국민체조 안내', tok, stepOpts(step))
          break
        }
        case 'exercise_video':
          // 영상은 **보정 갈래도 함께** 넘긴다(설계 §5). 기본이 'A' 라 지금 화면이
          // `category === 'exercise-video'` 로 고르던 값과 같은 것을 쓴다.
          return await stepVideoFile(db, resolveStepSource(db, step), 480, tok, 영상옵션(step))
        default: {
          // 편집기에서 추가한 커스텀 TTS / 메시지 단계
          // stepOpts(step)을 반드시 함께 넘긴다 — 빠지면 이 단계만 볼륨·목소리가 조용히
          // 무시된다(CC-052: 체조·점심·저녁 세 곳이 빠져 있었다). 실제로 소리가 달라지는
          // 조건은 좁다 — resolveStepVolume은 null/undefined/''를 "시스템 기본값"으로 보고
          // 0만 명시적 무음으로 취급하므로, 순서편집기에서 "시스템 기본값 사용" 체크를 풀어
          // 숫자를 저장한 단계에만 영향이 간다.
          if ((step.customType === 'tts' || step.customType === 'message') && step.content?.trim()) {
            await stepTTS(db, step.content.trim(), step.label || '커스텀 방송', tok, stepOpts(step))
          } else {
            return await runCustomExtraStep(db, step, tok)
          }
        }
      }
  })
}

// ── 11:15 점심 식사 전 ──────────────────────────────────────
async function fireLunchBroadcast(db, opts = {}) {
  return runBroadcastLane(db, LANES.lunch, opts, async (step, tok) => {
      switch (step.id) {
        case 'bgm_start': {
          stepBGMStart(db, 'lunch', 0, step, tok)
          await tokenDelay(1500, tok)
          break
        }
        case 'lunch_tts': {
          const text = getSetting(db, 'lunch_tts', LUNCH_TTS_DEFAULT)
          await stepTTS(db, text, '점심 식사 전 안내', tok, stepOpts(step))
          break
        }
        case 'lunch_video':
          return await stepVideoFile(db, resolveStepSource(db, step), 480, tok, 영상옵션(step))
        case 'lunch_prayer_intro': {
          const text = getSetting(db, 'lunch_prayer_intro_tts', LUNCH_PRAYER_INTRO_DEFAULT)
          await stepTTS(db, text, '기도·묵상 시간 안내', tok, stepOpts(step))
          break
        }
        case 'lunch_prayer_audio':
          return await stepAudioFile(db, resolveStepSource(db, step), 0, 300, tok, stepOpts(step))
        case 'lunch_prayer_tts': {
          const text = getSetting(db, 'lunch_prayer_tts', LUNCH_PRAYER_DEFAULT)
          return await stepMealPrayer(db, resolveStepSource(db, step), text, '점심 식사 안내', tok, stepOpts(step))
        }
        case 'lunch_video_after': {
          await stepVideoAfter(db, step, null, tok)
          break
        }
        case 'bgm': {
          stepBGMStart(db, 'lunch', 0, step, tok)   // 길이는 단계 칸만(2026-09-24)
          break
        }
        case 'medication_tts': {
          if (step.end_date && todayStr() > step.end_date) {
            console.log(`[시퀀서] 투약 안내 스킵 — 종료일 초과 (${step.end_date})`)
            break
          }
          const medText = (step.content?.trim()) || DEFAULT_MEDICATION_TTS
          const delayMin = Number(step.delay_min) || 6
          console.log(`[시퀀서] 투약 안내 — ${delayMin}분 대기 후 방송`)
          await tokenDelay(delayMin * 60 * 1000, tok)
          if (!isCancelled(tok)) await stepTTS(db, medText, '투약 안내', tok, stepOpts(step))
          break
        }
        default: {
          // 편집기에서 추가한 커스텀 TTS / 메시지 단계
          // stepOpts(step) 필수 — 이유는 fireExerciseBroadcast의 같은 분기 주석 참고(CC-052)
          if ((step.customType === 'tts' || step.customType === 'message') && step.content?.trim()) {
            await stepTTS(db, step.content.trim(), step.label || '커스텀 방송', tok, stepOpts(step))
          } else {
            return await runCustomExtraStep(db, step, tok)
          }
        }
      }
  })
}

// ── 16:15 저녁 식사 전 ──────────────────────────────────────
async function fireDinnerBroadcast(db, opts = {}) {
  return runBroadcastLane(db, LANES.dinner, opts, async (step, tok) => {
      switch (step.id) {
        case 'bgm_start': {
          stepBGMStart(db, 'dinner', 0, step, tok)
          await tokenDelay(1500, tok)
          break
        }
        case 'dinner_tts': {
          const text = getSetting(db, 'dinner_tts', DINNER_TTS_DEFAULT)
          await stepTTS(db, text, '저녁 식사 전 안내', tok, stepOpts(step))
          break
        }
        case 'dinner_video':
          return await stepVideoFile(db, resolveStepSource(db, step), 480, tok, 영상옵션(step))
        case 'dinner_prayer_tts': {
          const text = getSetting(db, 'dinner_prayer_tts', DINNER_PRAYER_DEFAULT)
          return await stepMealPrayer(db, resolveStepSource(db, step), text, '저녁 식사 안내', tok, stepOpts(step))
        }
        case 'dinner_video_after': {
          await stepVideoAfter(db, step, null, tok)
          break
        }
        case 'bgm': {
          stepBGMStart(db, 'dinner', 0, step, tok)   // 길이는 단계 칸만(2026-09-24)
          break
        }
        case 'medication_tts': {
          if (step.end_date && todayStr() > step.end_date) {
            console.log(`[시퀀서] 투약 안내 스킵 — 종료일 초과 (${step.end_date})`)
            break
          }
          const medText = (step.content?.trim()) || DEFAULT_MEDICATION_TTS
          const delayMin = Number(step.delay_min) || 6
          console.log(`[시퀀서] 투약 안내 — ${delayMin}분 대기 후 방송`)
          await tokenDelay(delayMin * 60 * 1000, tok)
          if (!isCancelled(tok)) await stepTTS(db, medText, '투약 안내', tok, stepOpts(step))
          break
        }
        default: {
          // 편집기에서 추가한 커스텀 TTS / 메시지 단계
          // stepOpts(step) 필수 — 이유는 fireExerciseBroadcast의 같은 분기 주석 참고(CC-052)
          if ((step.customType === 'tts' || step.customType === 'message') && step.content?.trim()) {
            await stepTTS(db, step.content.trim(), step.label || '커스텀 방송', tok, stepOpts(step))
          } else {
            return await runCustomExtraStep(db, step, tok)
          }
        }
      }
  })
}

// ── 18:00 저녁 마무리 방송 ─────────────────────────────────────
async function fireEveningPrayerBroadcast(db, opts = {}) {
  return runBroadcastLane(db, LANES.evening_prayer, opts, async (step, tok) => {
      switch (step.id) {
        case 'bgm': {
          stepBGMStart(db, 'evening_prayer', 0, { ...step }, tok)
          // BGM 페이드인(2초) 완료 후 TTS 시작 — 1500ms는 페이드가 끊겨 보임
          await tokenDelay(3500, tok)
          break
        }
        case 'evening_prayer_tts': {
          // 빈 값이면 기본 안내 문구 사용
          const text = getSetting(db, 'evening_prayer_tts', EVENING_PRAYER_TTS_DEFAULT) || EVENING_PRAYER_TTS_DEFAULT
          await stepTTS(db, text, '마음 안정 시간 안내', tok, stepOpts(step))
          break
        }
        case 'evening_prayer_audio':
          return await stepAudioFile(db, resolveStepSource(db, step), 0, 300, tok, stepOpts(step))
        case 'bgm_closing': {
          stepBGMStart(db, 'evening_prayer', 0, { ...step }, tok)
          await tokenDelay(2000, tok)
          break
        }
        case 'bgm_final': {
          // durationSec은 UI 표시용(기본 10초) — 실제 재생은 무제한으로 전달
          // 방송 완료 후 bgm_set_timer(15)가 재생중인 BGM에 타이머를 걸어 페이드아웃
          // (durationSec:10이면 TTS 도중 BGM이 꺼져 재생창이 비활성화되는 버그 방지)
          stepBGMStart(db, 'evening_prayer', 0, { ...step, durationSec: 0 }, tok)
          await tokenDelay(2000, tok)
          break
        }
        case 'evening_prayer_tts2': {
          const text = getSetting(db, 'evening_prayer_tts2', EVENING_PRAYER_TTS2_DEFAULT) || EVENING_PRAYER_TTS2_DEFAULT
          await stepTTS(db, text, '기도·묵상 시간 안내', tok, stepOpts(step))
          break
        }
        case 'evening_closing_audio':
          // **조건부 폴백은 그대로 산다** — evening-prayer 에 파일이 없으면 dinner-prayer
          // (첫 음원 재사용). 그 규칙은 `domain/stepSource.저녁마침카테고리()` 로
          // 옮겨 갔고 **글자 그대로 같다.** 여기서 사라진 것은 규칙이 아니라 사본이다.
          // 사람이 이 단계에 폴더·파일을 직접 연결하면 그쪽이 이긴다(폴백은 기본값일 때만).
          return await stepAudioFile(db, resolveStepSource(db, step), 0, 300, tok, stepOpts(step))
        case 'evening_closing_tts': {
          // 빈 값이면 기본 문안인사 사용
          const text = getSetting(db, 'evening_closing_tts', EVENING_CLOSING_TTS_DEFAULT) || EVENING_CLOSING_TTS_DEFAULT
          await stepTTS(db, text, '저녁 문안인사', tok, stepOpts(step))
          break
        }
        default: {
          if ((step.customType === 'tts' || step.customType === 'message') && step.content?.trim()) {
            await stepTTS(db, step.content.trim(), step.label || '커스텀 방송', tok, stepOpts(step))
          } else {
            return await runCustomExtraStep(db, step, tok)
          }
        }
      }
  })
}

module.exports = {
  // 렌더 시점을 정하는 쪽(선제 렌더·관찰 스크립트)이 이 표를 읽는다.
  // 성격을 여기 한 곳에만 두기 위해 내보낸다 — 복사하면 또 갈린다.
  LANES,
  // 선제 렌더가 아침 조각 문안을 **실행부와 같은 방법으로** 만들어야 캐시 키가 맞는다.
  // 따로 만들면 꺼 둔 조각을 못 보거나 띄어쓰기가 달라져 캐시가 빗나간다.
  segmentTexts,
  // 선제 렌더가 "이 방송이 어떤 단계로 이뤄지는가"를 실행부와 **같은 방식으로** 읽어야 한다.
  // 따로 파싱하면 사용자가 편집기에서 단계를 끈 것을 못 보고 엉뚱한 문안을 미리 만든다.
  getSteps,
  // 소리를 내지 않고 스텝 하나의 SSE 페이로드만 확인하기 위해 연다
  // (auto-broadcast-volume.test.js, custom-step-volume.test.js). 실행부는 이 export를 쓰지 않는다.
  __test__: { stepTTS, stepPrayerTTS, stepAudioFile, stepVideoFile, stepOpts, newBroadcastToken, stepBGMStart, runCustomExtraStep, runBroadcastLane },
  validateStartIndex,
  ttsWaitMs,
  // 단계 알림을 한 곳에서만 내보내기 위해 연다(broadcast-step-progress.test.js)
  runStepGuarded,
  fireMorningBroadcast,
  fireExerciseBroadcast,
  fireLunchBroadcast,
  fireDinnerBroadcast,
  fireEveningPrayerBroadcast,
  cancelCurrentBroadcast,
  stopCurrentBroadcast,
  notifyVideoEnded,
  notifyAudioEnded,
  // 흐름(flowRunner)도 같은 종료 대기 배관을 쓴다 — 대기 방식이 둘로 갈라지지 않게.
  waitForVideoEnd,
  waitForAudioEnd,
  cancelGeneration,
  DEFAULT_STEPS,
  mergeStepsWithDefaults,
  BREAKFAST_PRAYER_DEFAULT,
  LUNCH_PRAYER_DEFAULT,
  DINNER_PRAYER_DEFAULT,
  EXERCISE_TTS_DEFAULT,
  LUNCH_TTS_DEFAULT,
  DINNER_TTS_DEFAULT,
  EVENING_PRAYER_TTS_DEFAULT,
  EVENING_PRAYER_TTS2_DEFAULT,
  EVENING_CLOSING_TTS_DEFAULT,
  MORNING_PRAYER_INTRO_DEFAULT,
  LUNCH_PRAYER_INTRO_DEFAULT,
  DINNER_PRAYER_INTRO_DEFAULT,
}
