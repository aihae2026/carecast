import { Sunrise, Activity, Utensils, Moon, Sunset } from 'lucide-react'

// 방송 일정 편집기의 상수표와 순수 함수.
//
// 왜 갈라냈나(TD-10): MorningEditor.jsx가 2848줄이라 무엇을 고치면 어디가 흔들리는지
// 읽을 수 없었다. 상태도 화면도 없는 이것부터 뗐다. **컴포넌트와 같은 파일에 두지 않는다**
// — 한 파일이 컴포넌트와 상수를 함께 내보내면 Fast Refresh가 깨진다(eslint가 잡는다).

import {
  Clock, Volume2, FileText, Music2, Film, Bell,
} from 'lucide-react'
import { bgmTypeLabel, bgmFolderName, sourceOfStep } from '../../../lib/bgmTypes'

// 스텝 ID → 오디오 카테고리 (음원/영상 미리듣기용)
const AUDIO_STEP_MAP = {
  'morning_prayer':       'morning-prayer',
  'exercise_video':       'exercise-video',
  'lunch_video':          'lunch-video',
  'lunch_prayer_audio':   'lunch-prayer',
  'dinner_video':         'dinner-video',
  'dinner_prayer_audio':  'dinner-prayer',
  'evening_prayer_audio':  'dinner-prayer',
  'evening_closing_audio': 'dinner-prayer',
}

// 식사 안내 스텝 ID → 녹음 카테고리
const GRACE_STEP_MAP = {
  'breakfast_prayer_tts': 'breakfast-grace',
  'lunch_prayer_tts':     'lunch-grace',
  'dinner_prayer_tts':    'dinner-grace',
}

// 방송 뒤 배경 영상 스텝 ID 목록 — 소리 없이 띄우고 소리는 BGM 이 낸다(「배경 영상」 폴더, 2026-09-21)
const VIDEO_STEP_IDS = new Set(['morning_video', 'lunch_video_after', 'dinner_video_after'])

// 기본(고정) TTS 단계 ID → 설명 레이블 매핑
// 이 ID를 가진 단계는 인라인 TTS 편집 영역이 자동으로 표시됨
const TTS_STEP_KEYS = new Set([
  'exercise_tts',
  'lunch_tts',
  'dinner_tts',
  'morning_prayer_intro',
  'breakfast_prayer_tts',
  'lunch_prayer_intro',
  'lunch_prayer_tts',
  'dinner_prayer_tts',
  'evening_prayer_tts',
  'evening_prayer_tts2',
  'evening_closing_tts',
  'medication_tts',
])

// 식사 안내 카테고리 → 음원 관리 탭 레이블
const GRACE_LABEL = {
  'breakfast-grace': '아침 식사 안내',
  'lunch-grace':     '점심 식사 안내',
  'dinner-grace':    '저녁 식사 안내',
}

// 식사 안내 녹음 파일 상태 + useGraceAudio 토글

// BGM 단계 ID — 인라인 소스 선택 UI 표시
const BGM_STEP_IDS = new Set(['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final'])

// BGM 단계는 모두 이 PC 음원이다(2026-09-21 외부 연동 제거). 어느 폴더에서 — 서버 domain/bgmRoles.js 와
// 같은 id. 정하지 않으면 서버가 방송 종류로 정한다(점심·저녁=식사용, 나머지=방송용).
const BGM_ROLE_OPTIONS = [
  { id: 'broadcast', label: '방송용 BGM' },
  { id: 'meal',      label: '식사용 BGM' },
]

// 커스텀 BGM 단계용 재생 방식 — 목록은 `src/lib/bgmTypes.js` 가 단일 출처다(2026-09-13).
// 예전엔 이 파일·FlowBuilder.jsx·ScheduleModal.jsx 셋에 같은 배열이 복사돼 있었다.

// 단계 성격별 파스텔 톤 — FlowBuilder.jsx의 STEP_TYPES 배색과 맞춰서 앱 전체가 같은 언어를 쓰게 한다.
// (디자인 노트: 로직은 그대로 두고 클래스만 부드러운 톤으로 바꿨다)
const KIND_STYLE = {
  tts:   { bg: 'bg-ds-v3-tts-bg',     text: 'text-ds-v3-tts',     solid: 'bg-ds-v3-tts',     border: 'border-ds-v3-line',     icon: FileText },
  bgm:   { bg: 'bg-ds-v3-bgm-bg',    text: 'text-ds-v3-bgm',    solid: 'bg-ds-v3-bgm',    border: 'border-ds-v3-bgm',    icon: Music2   },
  // 내장 영상 단계(체조 영상·방송 뒤 배경 영상). 업로드 영상(video_file)과 같은 갈색이다 —
  // 둘 다 이 PC 에 올린 영상이다(예전엔 외부 TV 송출이 장미색으로 따로 있었다, 2026-09-21 제거).
  video: { bg: 'bg-ds-v3-surface-2', text: 'text-ds-v3-ink-2', solid: 'bg-ds-v3-ink-2', border: 'border-ds-v3-line', icon: Film     },
  audio: { bg: 'bg-ds-v3-surface-2', text: 'text-ds-v3-ink-3', solid: 'bg-ds-v3-ink-3', border: 'border-ds-v3-line', icon: Volume2  },
  chime: { bg: 'bg-ds-v3-surface-2',   text: 'text-ds-v3-ink-2',   solid: 'bg-ds-v3-ink-2',   border: 'border-ds-v3-line',   icon: Bell     },
  delay: { bg: 'bg-ds-v3-flow-bg',  text: 'text-ds-v3-flow',  solid: 'bg-ds-v3-bgm',  border: 'border-ds-v3-line',  icon: Clock    },
  plain: { bg: 'bg-ds-v3-bg',   text: 'text-ds-v3-ink-3',   solid: 'bg-ds-v3-ink-3',   border: 'border-ds-v3-line',   icon: null     },
}
// FlowStepsPreview는 KIND_STYLE[step_type]으로 바로 찾는다 — 흐름 어휘의 video_file도
// 배색을 받아야 커스텀 자동순서 미리보기에서 회색(plain)으로 떨어지지 않는다.
KIND_STYLE.video_file = { bg: 'bg-ds-v3-surface-2', text: 'text-ds-v3-ink-2', solid: 'bg-ds-v3-ink-2', border: 'border-ds-v3-line', icon: Film }

// 커스텀 자동순서 인라인 미리보기(FlowStepsPreview)용 — FlowBuilder.jsx의 STEP_TYPES 레이블/
// stepSummary()와 같은 내용을 그대로 복제(둘 다 export하면 react-refresh/only-export-components
// 린트에 걸림 — 이 파일과 FlowBuilder.jsx의 BGM_TYPES처럼 이 프로젝트가 이미 쓰는 "의도적 복제"
// 패턴을 따름). step_type 값은 FlowBuilder.jsx와 동일해서 아이콘/색은 위 KIND_STYLE을 그대로 쓴다.
const FLOW_STEP_LABEL = { tts: 'TTS', bgm: 'BGM', audio: '업로드 음원', chime: '차임벨', delay: '대기', video_file: '업로드 영상' }
function flowStepSummary(step) {
  const c = step.config || {}
  if (step.step_type === 'tts')   return c.content?.trim() ? c.content.slice(0, 30) : '(내용 없음)'
  if (step.step_type === 'bgm')   return bgmTypeLabel((c.playlist?.[0] || c).bgm_type)
  if (step.step_type === 'audio') return c.audio_file_id ? `음원 #${c.audio_file_id}` : '(음원 미선택)'
  if (step.step_type === 'delay') return `${c.wait_sec || 0}초 대기`
  if (step.step_type === 'chime') return '차임벨 재생'
  if (step.step_type === 'video_file') return c.audio_file_id ? `업로드 영상 #${c.audio_file_id}` : '(영상 미선택)'
  return ''
}

// 커스텀 단계 추가 버튼 종류 — FlowBuilder.jsx의 STEP_TYPES와 같은 배색 언어
const CUSTOM_STEP_TYPES = [
  { value: 'tts',        label: 'TTS 추가',       icon: Volume2,       bg: 'bg-ds-v3-tts-bg',     text: 'text-ds-v3-tts'     },
  { value: 'bgm',        label: 'BGM 추가',       icon: Music2,        bg: 'bg-ds-v3-bgm-bg',    text: 'text-ds-v3-bgm'    },
  { value: 'audio',      label: '음원 추가',       icon: Volume2,       bg: 'bg-ds-v3-surface-2', text: 'text-ds-v3-ink-3' },
  { value: 'chime',      label: '차임벨 추가',     icon: Bell,          bg: 'bg-ds-v3-surface-2',   text: 'text-ds-v3-ink-2'   },
  { value: 'video_file', label: '영상 추가',       icon: Film,          bg: 'bg-ds-v3-surface-2',   text: 'text-ds-v3-ink-2'   },
  { value: 'delay',      label: '대기 추가',       icon: Clock,         bg: 'bg-ds-v3-flow-bg',  text: 'text-ds-v3-flow'  },
]

// 음원/영상 재생목록 선택기 — 칩을 토글해서 담고, 담긴 목록은 드래그로 순서 변경.
// selectedIds/onChange는 항상 문자열 id 배열 — 담긴 순서 그대로 순차 재생된다.

// ── 단계 판별·요약 — StepList.jsx에서 옮김(2026-09-03, big-file-split-design §2) ──
// 전부 상태가 없는 순수 함수다. 화면 목록(allAudioFiles)이 필요한 것은 인자로 받는다.

// 이 단계가 조절하는 소리가 반주인지 주 소리인지. BGM 단계의 id는 전부 'bgm'으로 시작한다
// (서버 broadcastSequencer가 stepBGMStart로 보내는 단계들과 같은 집합).
function volumeFieldFor(step) {
  return (step.id?.startsWith('bgm') || step.customType === 'bgm') ? 'bgmVolume' : 'volume'
}

const VOLUME_FIELD_LABEL = { bgmVolume: 'BGM 볼륨', volume: '이 단계 소리' }

// 배속을 정할 수 있는 단계인가.
//
// 서버가 실제로 배속을 실어 보내는 단계만 보여준다 — 안 그러면 저장은 되는데 소리는 그대로인
// 죽은 설정이 된다(볼륨에서 실제로 겪은 일이다. CC-052·053·054).
//   · 음원 단계(stepAudioFile / 흐름 audio) · 업로드 영상 단계(stepVideoFile / 흐름 video_file)
// 빠지는 것:
//   · 방송 뒤 배경 영상 단계(morning_video 등) — 소리 없이 나가고 소리는 BGM이 낸다
// 값 자체는 퍼센트로 다룬다(shared/RateInput.jsx). 여기서는 '이 단계가 배속을 받는가'만 판단한다.
function canSetRate(step) {
  if (step.customType === 'audio' || step.customType === 'video_file') return true
  if (step.customType) return false
  if (VIDEO_STEP_IDS.has(step.id)) return false
  return !!AUDIO_STEP_MAP[step.id]
}

// TTS 내용을 인라인에서 보여줄 단계 판별
const hasTtsInline = (step) =>
  TTS_STEP_KEYS.has(step.id) || step.customType === 'tts' || step.customType === 'message'

// BGM 소스 선택 인라인 표시 단계 판별
const hasBgmInline = (step) => BGM_STEP_IDS.has(step.id)

// 접힌 상태에서 보여줄 한 줄 요약 — FlowBuilder.jsx의 stepSummary()와 같은 역할
// 접힌 단계 줄에 적는 **연결 한 줄**.
//
// 예전엔 여기가 `morning-prayer 음원` 처럼 **코드가 쓰는 슬러그**를 그대로 적었다.
// 사람에게 아무 뜻도 없는 글자이고, 설계가 없애기로 한 바로 그것이다(design-upload-flow §7-8).
// 게다가 줄의 **이름표가 이미 「… 음원」** 이라 같은 말을 두 번 하고 있었다.
//
// **판정을 여기서 다시 하지 않는다.** 서버가 얹어 준 `sourceResolved` 를 말로 옮기기만 한다
// (해석은 `domain/stepSource` 한 곳 — 화면이 따로 풀면 방송이 고르는 것과 갈린다).
// 어느 **파일**이 나가는지는 여기서 말하지 않는다 — 그 판정은 재생목록·올린 순서를 보는
// 서버 규칙이라, 화면이 흉내내면 '이 파일이 나갑니다'가 거짓말이 된다(사용자 조건 4).
function 연결요약(step, 갈래) {
  const r = step.sourceResolved
  if (!r) return ''
  if (r.error) return '연결 오류 — 다시 골라 주세요'
  if (r.kind === 'none') return r.origin === 'saved' ? '연결 안 함 — 건너뜁니다' : ''
  if (r.kind === 'file') return r.origin === 'default' ? `기본 ${갈래}` : `${갈래} 파일 1개`
  if (r.origin === 'default') return `기본 ${갈래}`
  return r.folderId == null ? `${갈래} 갈래 전체` : `연결한 폴더의 ${갈래}`
}

function stepSummaryFor(step, kind, ttsText, allAudioFiles = []) {
  if (kind === 'tts') return ttsText?.trim() ? ttsText.trim().slice(0, 40) : '(내용 없음)'
  if (kind === 'bgm') {
    if (step.customType === 'bgm') {
      if (step.playlist?.length > 1) return `${step.playlist.length}곡 재생목록`
      return bgmTypeLabel((step.playlist?.[0] || step).bgm_type)
    }
    // 폴더 이름은 서버 목록의 지금 이름(2026-09-22) — 안 고른 단계는 방송 종류로 정해지므로 짐작해 적지 않는다.
    { const 갈래 = sourceOfStep(step); return 갈래 ? bgmFolderName(갈래) : '이 PC 음원' }
  }
  if (kind === 'audio') {
    if (step.customType === 'audio') {
      const ids = (step.playlist?.length ? step.playlist : (step.audio_file_id ? [step.audio_file_id] : []))
      if (ids.length > 1) return `${ids.length}개 재생목록`
      const f = allAudioFiles.find(af => String(af.id) === String(ids[0]))
      return f ? f.original_name : '(음원 미선택)'
    }
    return 연결요약(step, '음원')
  }
  if (kind === 'video') {
    if (step.customType === 'video_file') {
      const ids = (step.playlist?.length ? step.playlist : (step.audio_file_id ? [step.audio_file_id] : []))
      if (ids.length > 1) return `${ids.length}개 재생목록`
      const f = allAudioFiles.find(af => String(af.id) === String(ids[0]))
      return f ? f.original_name : '(영상 미선택)'
    }
    return 연결요약(step, '영상')
  }
  if (kind === 'chime') return '차임벨 재생'
  if (kind === 'delay') return `${step.wait_sec ?? 5}초 대기`
  return ''
}

// ── MorningEditor에서 내려온 상수표 (2026-09-05) ─────────────
// 옮기기만 했고 값은 그대로다. 이 파일에 두는 이유는 위 머리말과 같다 — 컴포넌트와 상수를
// 한 파일에서 함께 내보내면 Fast Refresh가 깨진다.
const DEFAULT_MEDICATION_TEXT =
  '선생님들께 안내드립니다. 식사 후 투약 시 반드시 어르신의 성함과 얼굴을 확인하고, 성함을 직접 호명한 후 투약해 주시기 바랍니다. 투약 사고 예방을 위해 한 분 한 분 정확하게 확인해 주시기 바랍니다.'
// ── 탭 정의 ──────────────────────────────────────────────────
// name/defaultTime을 분리해서, 사이드바 라벨을 실제 저장된 방송 시간(settings[id].time)으로
// 조립한다 — "방송 시간"을 바꿔도 사이드바가 예전 시간으로 고정 표시되던 버그 수정.
// defaultTime은 settings 로딩 전(=null) 표시용 fallback.
// **레인마다 색을 주지 않는다**(G-1, 2026-09-13). 예전엔 다섯 줄에 주황·초록·파랑·보라·남색이
// 하나씩 붙어 있었다 — 왜 국민체조가 초록인지 답할 수 있는 사람이 없다. 색이 아무것도
// 가리키지 않으면 색은 아무 말도 못 하고, 정작 뜻이 있는 색(말=파랑·음악=자주·순서=보라)까지
// 같이 안 보이게 만든다. 레인은 **이름·아이콘·시각**으로 충분히 갈린다.
// (그 `color` 값은 읽는 곳이 한 곳도 없었다 — 화면에 쓰이지도 않으면서 규칙만 흐리고 있었다.)
const TABS = [
  { id: 'morning',        name: '아침 방송',   defaultTime: '07:50', icon: Sunrise  },
  { id: 'exercise',       name: '국민체조',    defaultTime: '09:00', icon: Activity },
  { id: 'lunch',          name: '식사전 체조', defaultTime: '11:15', icon: Utensils },
  { id: 'dinner',         name: '식사전 체조', defaultTime: '16:15', icon: Moon     },
  { id: 'evening_prayer', name: '저녁 마무리', defaultTime: '18:00', icon: Sunset   },
]
// ── 기본 단계 구성 ────────────────────────────────────────────
// 「기도·묵상 시간(선택)」 단계는 **기본으로 꺼져 있다**(종교 중립 기본값, 2026-10-17) — 서버
// broadcastSequencer.js DEFAULT_STEPS 와 같다. 종교 시설은 여기서 켜고 문안·음원을 넣는다.
const DEFAULT_STEPS = {
  morning: [
    // 네 방송의 첫 BGM 기본 15분(900초) — 서버 broadcastSequencer.js DEFAULT_STEPS 와 같게(2026-09-24)
    { id: 'bgm',                   label: 'BGM 시작',               enabled: true,  order: 0, durationSec: 900 },
    { id: 'date_weather_schedule', label: '날짜/요일/날씨/일정 안내', enabled: true,  order: 1 },
    { id: 'morning_prayer_intro',  label: '기도·묵상 시간 안내 (선택)',  enabled: false,  order: 2 },
    { id: 'morning_prayer',        label: '기도·묵상 시간 음원 (선택)',  enabled: false,  order: 3 },
    { id: 'breakfast_prayer_tts',  label: '아침 식사 안내 (TTS)',     enabled: true,  order: 4 },
    { id: 'bgm_after',             label: 'BGM 재시작 (식사 안내 후)', enabled: true,  order: 5 },
    { id: 'medication_tts',        label: '투약 안내 (TTS)',          enabled: true,  order: 6, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TEXT, ttsVoice: 'female' },
    { id: 'morning_video',         label: '아침 후 배경 영상',       enabled: true,  order: 7, durationMin: 30 },
  ],
  exercise: [
    { id: 'bgm',            label: 'BGM 시작',           enabled: true, order: 0, durationSec: 900 },
    { id: 'exercise_tts',   label: '국민체조 안내 (TTS)', enabled: true, order: 1 },
    { id: 'exercise_video', label: '국민체조 영상',        enabled: true, order: 2 },
  ],
  lunch: [
    { id: 'bgm_start',          label: 'BGM 시작 (체조 준비)',    enabled: true, order: 0 },
    { id: 'lunch_tts',          label: '점심 체조 안내 (TTS)',    enabled: true, order: 1 },
    { id: 'lunch_video',        label: '식사전 체조 영상',         enabled: true, order: 2 },
    { id: 'lunch_prayer_intro', label: '기도·묵상 시간 안내 (선택)', enabled: false, order: 3 },
    { id: 'lunch_prayer_audio', label: '기도·묵상 시간 음원 (선택)', enabled: false, order: 4 },
    { id: 'lunch_prayer_tts',   label: '점심 식사 안내 (TTS)',     enabled: true, order: 5 },
    { id: 'bgm',                label: 'BGM 시작 (식사 중)',      enabled: true, order: 6, durationSec: 900 },
    { id: 'medication_tts',     label: '투약 안내 (TTS)',          enabled: true, order: 7, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TEXT, ttsVoice: 'female' },
    { id: 'lunch_video_after',  label: '식사 중 배경 영상',       enabled: true, order: 8, durationMin: 15 },
  ],
  dinner: [
    { id: 'bgm_start',          label: 'BGM 시작 (체조 준비)',    enabled: true, order: 0 },
    { id: 'dinner_tts',         label: '저녁 체조 안내 (TTS)',    enabled: true, order: 1 },
    { id: 'dinner_video',       label: '식사전 체조 영상',         enabled: true, order: 2 },
    { id: 'dinner_prayer_tts',  label: '저녁 식사 안내 (TTS)',     enabled: true, order: 3 },
    { id: 'bgm',                label: 'BGM 시작 (식사 중)',      enabled: true, order: 4, durationSec: 900 },
    { id: 'medication_tts',     label: '투약 안내 (TTS)',          enabled: true, order: 5, delay_min: 6, end_date: null, content: DEFAULT_MEDICATION_TEXT, ttsVoice: 'female' },
    { id: 'dinner_video_after', label: '식사 중 배경 영상',       enabled: true, order: 6, durationMin: 15 },
  ],
  evening_prayer: [
    { id: 'bgm',                   label: 'BGM 시작',                enabled: true, order: 0, bgmSource: 'local', durationSec: 0 },
    { id: 'evening_prayer_tts',    label: '마음 안정 시간 안내 (TTS)',    enabled: true, order: 1 },
    { id: 'evening_prayer_audio',  label: '기도·묵상 시간 음원 (선택)',   enabled: false, order: 2 },
    { id: 'bgm_closing',           label: 'BGM 재시작 (안내 사이)',  enabled: true, order: 3, bgmSource: 'local', durationSec: 0 },
    { id: 'evening_prayer_tts2',   label: '기도·묵상 시간 안내 (선택)', enabled: false, order: 4 },
    { id: 'evening_closing_audio', label: '기도·묵상 시간 음원 2 (선택)', enabled: false, order: 5 },
    { id: 'bgm_final',             label: 'BGM 재시작 (문안인사 전)', enabled: true, order: 6, bgmSource: 'local', durationSec: 10 },
    { id: 'evening_closing_tts',   label: '저녁 문안인사 (TTS)',      enabled: true, order: 7 },
  ],
}

export { AUDIO_STEP_MAP, GRACE_STEP_MAP, VIDEO_STEP_IDS, TTS_STEP_KEYS, GRACE_LABEL, BGM_STEP_IDS, BGM_ROLE_OPTIONS, KIND_STYLE, FLOW_STEP_LABEL, flowStepSummary, CUSTOM_STEP_TYPES, volumeFieldFor, VOLUME_FIELD_LABEL, canSetRate, hasTtsInline, hasBgmInline, stepSummaryFor , DEFAULT_MEDICATION_TEXT, TABS, DEFAULT_STEPS }
