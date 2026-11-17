// 자연어 한 줄로 방송 예약 만들기.
//
//   "매일 오후 3시에 산책 안내 방송 넣어줘" → 파싱 결과를 요약 카드로 보여주고
//   "이렇게 예약할까요?"만 확인하면 바로 저장된다(전체 예약 추가 폼을 다시 채울 필요 없음).
//
// 예전엔 파싱 결과로 일반 "예약 추가" 모달(ScheduleModal)을 그대로 채워 열었는데, 수동으로
// 예약을 만들 때 쓰는 폼과 똑같이 보여서 "AI가 알아서 해준 것" 같은 느낌이 없다는 피드백을
// 받고(2026-08-27) 전용 확인 카드로 바꿨다. BGM·음원·흐름 등 고급 설정이 필요한 드문 경우를
// 위해 "자세히 수정" 버튼으로 기존 모달을 여전히 열 수 있게 남겨뒀다.
//
// ── 옷(`tone`)만 갈아입는다 — 로직은 화면마다 복사하지 않는다 ──────────────────
// 통합 홈(목업 v3)은 이 입력창을 **검색창 한 줄**로 보여주고, 문장이 인식되면 그 **아래에서**
// 초안 카드가 펼쳐진다. 쉬운 화면은 지금 모습 그대로다. 두 화면이 각자 파싱·저장·되돌리기를
// 갖게 하면 한쪽만 고쳐지는 날이 오고, 그때 사람은 어느 화면을 믿을지 모른다.
// 그래서 **상태·저장 경로는 하나**로 두고 `tone` 으로 겉모습만 가른다
// (`InstantBroadcast` 와 같은 방식).
import { useState, useEffect, useRef } from 'react'
import { Wand2, CornerDownLeft, CalendarClock, PenLine, Undo2, Search, ArrowRight, X, Volume2 } from 'lucide-react'
import { parseSchedulePhrase, createSchedule, cancelAiSchedule, triggerSchedule, ttsBroadcast, prepareTTS, startBgmNow, playFileNow, getFlows, getAudioFiles, getLocalAiEnabled, fireChime } from '../../lib/api'
import { 방송문구짓기, 지은이문구 } from '../../lib/aiBroadcastText'
import { emptySchedule, formatRepeatLabel, BROADCAST_TYPES, 고를수있는유형, BGM물음이있나, NEEDS_AUDIO_FILE, filesForBroadcastType } from '../../lib/scheduleUtils'
import { 단축키뜻, 글자입력중 } from '../../lib/shortcutRules'
import { kindOfType, KIND_LABEL, guessKindFromText } from '../../lib/broadcastKind'
// 어느 빠른 단추가 어떤 초안을 여는가 — 판단은 화면 밖 한 곳이다(시험이 진짜로 부른다).
// 「언제 나갈지」를 맞추는 일은 `실행방식맞추기` 한 곳이 한다 — 이 화면은 `즉시실행값` 을
// 직접 부르지 않는다(V③ R17). 두 자리에서 맞추면 한쪽만 고친 채 갈린다.
// 단추 목록을 여기서 직접 안 돈다 — `단추묶음()` 이 「지금/나중에」로 갈라 준다.
import { 단추묶음, 빠른초안, 초안정의, 실행방식맞추기, 빠른단추 } from '../../lib/quickStart'
import { ScheduleModal } from './ScheduleModal'
// 순서 편집기는 **이미 있는 것**을 쓴다 — 만드는 화면을 두 벌로 만들지 않는다.
import { FlowEditorModal } from './FlowBuilder'
import BgmSourcePicker from './BgmSourcePicker'
import { useChimeToggles } from '../../hooks/useChimeToggles'
import useWideScreen from '../../hooks/useWideScreen'
import { useTourStage } from '../../lib/tourStage'
import { BGM_DEFAULT_TYPE } from '../../lib/bgmTypes'

// 입력창 **안**에서 천천히 돌아가는 빈 상태 안내 (사용자 지시 2026-09-14).
//
// 예전에는 검색창 밑에 **알약 단추 셋**이었다. 누르면 그 문장이 입력창에 들어갔지만,
// 한 줄을 통째로 차지해 「오늘 일과방송」을 아래로 밀었고 모바일에서는 두 줄이 됐다.
// 예시를 보여 주는 일 자체는 필요하다 — *"무엇까지 말로 되는가"* 를 아는 유일한 자리다.
// 그래서 **자리를 안 먹는 곳**으로 옮겼다. placeholder 는 글자를 치는 순간 사라진다.
// ── **이 자리가 하는 일은 「이런 것도 되는구나」다** (사용자 지시 2026-09-15) ──────────
// *"검색창에서는 아 이런 정보도 입력해볼 수 있네? 이렇게."*
//
// 앞 판은 셋뿐이었고 **셋 다 같은 모양**이었다(시각 + 안내). 그것만 보면 이 칸이
// 「예약 만드는 칸」으로만 읽힌다 — 차임·배경음악·볼륨까지 말로 된다는 것을 알 길이 없었다.
//
// **되는 것만 적는다.** 여기 적힌 말은 전부 `server/domain/ontology.js` 가 실제로 읽는
// 낱말이다(유형 여섯 · 반복 · 요일 · 볼륨 정성어). **안 되는 것을 예시로 보이면
// 사람이 그대로 쳐 보고 실패한다** — 그건 없는 것보다 나쁘다.
//
// 차례는 **쉬운 것부터**다. 처음 보는 사람이 첫 문장에서 막히면 다음을 안 본다.
const EXAMPLES = [
  // 가장 흔한 것 — 시각 + 안내
  '내일 오후 3시에 산책 안내',
  '매일 오전 10시에 체조 안내',
  '평일 오후 2시에 프로그램 안내',
  // 유형이 다른 것들 — 「말만 나가는 게 아니구나」
  '저녁 6시에 차임벨 울려줘',
  '낮 12시에 배경음악 잔잔하게',
  '내일 오전 8시에 안내 음원 틀어줘',
  '오후 3시에 티비로 영상 틀어줘',
  // 되돌아보는 말 — 「이런 것도 되네」
  '지금 바로 저녁 식사 안내',
  '토요일 오전 10시에 가족 면회 안내',
]
// 한 문장이 서 있는 시간. 짧으면 읽다 말고 바뀌고, 길면 하나만 있는 줄 안다.
// **4.2 → 5초.** 예시가 셋에서 아홉으로 늘었으니 한 바퀴가 38초에서 45초가 된다 —
// 그보다 빨리 돌리면 **읽는 중에 바뀌어** 오히려 아무것도 못 읽는다.
const EXAMPLE_MS = 5000

/**
 * 차임 설정의 토글 한 칸. **켬/끔을 글자로도 말한다** — 색만으로는 색각 차이를 못 넘는다(G-7).
 * `aria-pressed` 가 보조기술에 같은 사실을 전한다.
 * 생김새는 간편모음의 `HomeMicOptions` 와 같은 결이다 — 같은 값을 만지는 자리라 달라 보이면
 * 사람이 **다른 설정인 줄 안다.**
 */
function 차임옵션({ on, onChange, 빠짐 = false, children }) {
  // ── **BGM 이 붙으면 「이번 방송엔 안 붙어요」로 보인다** (사용자 결정 2026-09-17 N12) ──────
  // 보낼 때는 이미 차임을 끈다(아래 `chimeStart: d.bgm_enabled ? false : chime`). 그런데 화면은
  // 「시작 차임 ON」 그대로라 **보이는 것과 나가는 것이 달랐다.**
  // **값(on)은 바꾸지 않는다** — 이 켬/끔은 간편모음 서랍·「누르고 말하기」와 같이 쓰는 한 값이라,
  // 여기서 끄면 마이크 차임까지 꺼진다. 누를 수 없게만 하고, BGM 을 끄면 원래대로 돌아온다.
  if (빠짐) {
    return (
      <span aria-disabled="true"
        className="flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-dashed
                   border-ds-v3-line-2 bg-ds-v3-surface-2 px-3 text-center text-[13px] font-semibold text-ds-v3-ink-3">
        {children} · 이번 방송엔 안 붙어요
      </span>
    )
  }
  return (
    // G-15 — 손으로 누르는 것은 44px 이상이다. 간편모음의 같은 토글은 42px 인데,
    // 그건 서랍 안이라 손가락이 이미 한 번 조준한 뒤다. 이쪽은 검색창 바로 밑이다.
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={'min-h-[44px] flex-1 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors '
        + (on
          ? 'border-ds-v3-tts bg-ds-v3-tts-bg text-ds-v3-tts'
          : 'border-ds-v3-line-2 bg-ds-v3-surface text-ds-v3-ink-3 hover:bg-ds-v3-surface-2')}>
      {children}
    </button>
  )
}

/**
 * **차임을 지금 내보내는 단추** (사용자 결정 2026-09-15).
 *
 * 토글(`차임옵션`)과 **생김새를 일부러 다르게** 한다. 하나는 값을 바꾸고 하나는
 * **전관 스피커로 소리를 낸다** — 같아 보이면 설정인 줄 알고 누른다.
 * 그래서 이쪽은 채운 단추에 스피커 그림을 달았다.
 */
function 차임발사({ 종류, 보내는중, onFire, children }) {
  const 도는중 = 보내는중 === 종류
  return (
    // G-15 — 손으로 누르는 것은 44px 이상이다.
    <button type="button" onClick={() => onFire(종류)} disabled={!!보내는중} data-tour={`chime-${종류}`}
      className={'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[10px] '
        + 'px-3 text-[13px] font-semibold transition-colors '
        + (보내는중
          ? 'cursor-not-allowed bg-ds-v3-surface-2 text-ds-v3-ink-3'
          : 'bg-ds-v3-ink text-white hover:bg-black')}>
      <Volume2 size={15} />
      {도는중 ? '내보내는 중…' : children}
    </button>
  )
}

// 「방금 추가했습니다 · 취소」 띠가 떠 있는 시간. 게이지가 이만큼 걸려 비고, 다 비면 사라진다.
// 손을 올리면 멈추므로(아래 `멈춤`) 짧게 잡아도 손이 닿는 중에 닫히지 않는다.
const UNDO_MS = 5000

// 파서가 확신하지 못한 항목을 사람이 알아볼 수 있게 풀어 쓴다.
// 하나라도 있으면 아래 "확인했습니다"를 체크해야 저장할 수 있다 — 애매한 채로 예약이
// 만들어지면 엉뚱한 시각에 엉뚱한 게 나가고, 현장에서는 원인을 알기 어렵다.
const AMBIGUOUS_LABEL = {
  time_meridiem:   '오전/오후가 분명하지 않아 시간을 확인해 주세요.',
  time_missing:    '시간을 읽지 못해 기본값을 넣었습니다 — 직접 지정해 주세요.',
  repeat_biweekly: '"격주" 반복은 아직 지원하지 않아 매주 반복으로 등록됩니다 — 확인해 주세요.',
  repeat_assumed:  '반복 안내가 없어 "매일"로 두었습니다 — 하루만 나갈 방송이면 날짜를 확인해 주세요.',
  // 방송 유형(ontology.js) 관련 — 유형을 잘못 잡으면 엉뚱한 게 나가거나 아무 소리도 안 나므로
  // 반드시 사람이 보게 한다.
  type_guess:       '방송 유형을 문장에서 추측했습니다 — 아래 유형이 맞는지 확인해 주세요.',
  needs_audio_file: '재생할 파일은 문장만으로 고를 수 없습니다 — 아래에서 골라 주세요.',
  // 「흐름」·「순서」·「자동」 한 낱말만 적은 경우. 그 글자를 읽는 안내방송으로 떨어뜨리지
  // 않고 되묻는다 — 어르신께 "흐름" 이 나가는 것이 가장 나쁜 결과다.
  flow_unnamed:     '어느 흐름인지 문장에서 못 골랐습니다 — 아래에서 골라 주세요. (그 낱말을 그대로 읽지는 않습니다)',
  // 1회성 예약은 시작일 당일에만 발동한다 — 지난 시각으로 저장되면 영원히 안 나간다
  time_past_moved:  '말씀하신 시각이 이미 지나서 날짜를 내일로 옮겼습니다 — 맞나요?',
}

function typeLabel(value) {
  return BROADCAST_TYPES.find(t => t.value === value)?.label || value
}

// 후보가 둘 이상 걸린 경우는 무엇과 무엇 사이에서 헷갈렸는지 이름을 대고 물어봐야
// 사람이 판단할 수 있다 — 그래서 고정 문구가 아니라 파싱 결과로 문장을 만든다.
function buildNotes(ambiguous, parsed) {
  return ambiguous.map(key => {
    if (key === 'type_ambiguous') {
      const alts = (parsed.type_alternatives || []).join(', ')
      return `"${typeLabel(parsed.broadcast_type)}"으로 읽었는데 "${alts}"일 수도 있습니다 — 어느 쪽인가요?`
    }
    if (key === 'volume_set') {
      // 볼륨은 귀로 바로 체감되는 값이라, 정성어를 숫자로 바꾼 결과를 눈으로 보여준다.
      // 시스템 기본값은 그대로 두고 이 예약에만 적용된다는 점도 함께 알린다.
      const label = parsed.volume_label ? `(${parsed.volume_label})` : ''
      const isMain = parsed.volume_channel === 'main'
      const value = isMain ? parsed.main_volume : parsed.bgm_volume
      return `이 방송의 ${isMain ? '안내 음성' : 'BGM'} 볼륨만 ${value}%${label}로 둡니다 — 시스템 기본값은 그대로입니다. 맞나요?`
    }
    if (key === 'overlaps_auto') {
      // 막지는 않는다 — 일부러 겹치게 잡는 경우도 있다. 다만 모르고 지나치면 안 된다.
      const names = (parsed.auto_overlaps || []).map(o => `${o.label}(${o.time})`).join(', ')
      return `${names}과 시각이 겹칩니다 — 두 방송이 같이 나가면 소리가 섞입니다. 그대로 둘까요?`
    }
    if (key === 'volume_channel_guess') {
      return '어느 소리인지 말하지 않아 BGM으로 두었습니다 — 안내 음성을 조절하려면 "안내 음성"이라고 말해 주세요.'
    }
    if (key === 'flow_ambiguous') {
      const alts = (parsed.flow_alternatives || []).join(', ')
      return `"${parsed.title}" 흐름으로 읽었는데 "${alts}" 흐름일 수도 있습니다 — "자세히 수정"에서 골라 주세요.`
    }
    return AMBIGUOUS_LABEL[key]
  }).filter(Boolean)
}

// 재생할 파일을 골라야 소리가 나는 유형 — server/domain/ontology.js의 needs:'audio_file'과
// 같은 목록이다. 서버(POST /api/schedules)도 같은 검증을 하지만, 확인 카드에서 먼저 막아야
// "저장은 됐는데 그 시각에 아무 소리도 안 남"을 피할 수 있다.

// 무엇까지 말로 되는지 몰라서 안 쓰는 게 가장 흔한 실패다 — 예시 아래 한 줄로 알린다

// 인식된 유형이 띠는 색. 규칙은 `lib/broadcastKind.js` 하나뿐이다(오늘 목록도 그것을 본다).
// 검색창을 감싸는 색 — **정색이다. 파스텔(`-line`)이 아니다**(사용자 지적 2026-09-13:
// *"TTS BGM 하면 검색창도 파란색…감싸라고 했지"*).
//
// 규칙 자체는 진작 붙어 있었고 실제로 돌고 있었다(실측: BGM→rgb(242,210,233) 등).
// 그런데 `-line` 은 **연한 테두리용 색**이라 1.5px 선으로는 흰 카드 위에서 거의 안 보였다 —
// "안 했다"로 보이는 것이 당연했다. 규칙이 있는데 안 보이면 없는 것과 같다.
// 그래서 같은 세 색의 **정색**을 쓴다(TTS #2563EB · BGM #B03A7A · 흐름 #6D28D9).
// 색을 늘린 것이 아니라 **원래 그 색의 진한 쪽**으로 옮긴 것이라 팔레트는 그대로 셋이다.
const ASK_TINT  = { tts: 'border-ds-v3-tts', bgm: 'border-ds-v3-bgm', flow: 'border-ds-v3-flow' }
const CARD_TINT = { tts: 'border-ds-v3-tts',      bgm: 'border-ds-v3-bgm',      flow: 'border-ds-v3-flow' }
const PILL_TINT = {
  tts:  'bg-ds-v3-tts-bg text-ds-v3-tts',
  bgm:  'bg-ds-v3-bgm-bg text-ds-v3-bgm',
  flow: 'bg-ds-v3-flow-bg text-ds-v3-flow',
}

// 겉모습만 가른다. 여기 없는 것은 두 화면이 똑같이 쓴다.
//
// **테두리 색을 `field` 안에 같이 넣지 않는다.** 넣어 두고 경고일 때 색 클래스를 덧붙였더니,
// 둘 다 특이도가 같아서 **CSS 안의 순서**가 승자를 정했다. Tailwind 는 그 묶음을 알파벳 순으로
// 내므로 `border-ds-v3-bgm`(경고) 이 `border-ds-v3-line-2`(평소) 보다 **앞**에 나왔고,
// 그래서 **v3 에서만 경고 테두리가 조용히 죽었다**(실측: bgm @21328 < line-2 @21644).
// easy 는 우연히 반대라 멀쩡했다 — 우연에 기대고 있었다는 뜻이다(V② 적대 검수 2026-09-13).
// 이제 색을 따로 들고 **한 번만** 고른다.
const SKINS = {
  easy: {
    card:      'mt-2 bg-ds-v3-tts-bg border border-ds-v3-tts/30 rounded-[12px] p-3',
    field:     'bg-white border rounded-btn px-2 py-1.5 text-xs text-ds-v3-ink focus:border-ds-v3-tts',
    line:      'border-ds-v3-line',
    warn:      'border-ds-v3-ink-2',
    label:     'text-[11px] text-ds-v3-ink-2',
    note:      'text-[11px] text-ds-v3-ink-2',
    noteBox:   'bg-white/70 border border-ds-v3-ink-2/40 rounded-[10px] p-2',
    primary:   'py-1.5 px-3 rounded-btn text-xs font-semibold bg-ds-v3-tts hover:bg-ds-v3-tts text-white',
    secondary: 'py-1.5 px-3 rounded-btn text-xs font-semibold border border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink',
    link:      'text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts',
    accent:    'accent-ds-v3-tts',
    err:       'text-xs text-ds-v3-warn',
  },
  v3: {
    // 검색창 아래에서 펼쳐진다 — 위에서 밀려 내려오는 결(`cc-open-draft`)이라
    // 사람이 "그 문장에서 나온 것"으로 읽는다.
    card:      'mt-3 bg-white/90 backdrop-blur-[10px] border-[1.5px] rounded-[14px] px-[18px] py-4 '
             + 'shadow-v3-compose motion-safe:animate-[cc-open-draft_.42s_cubic-bezier(.22,.61,.36,1)]',
    field:     'bg-ds-v3-surface border rounded-[10px] px-3 py-2 text-sm text-ds-v3-ink focus:border-ds-v3-ink',
    line:      'border-ds-v3-line-2',
    warn:      'border-ds-v3-bgm',
    label:     'text-[13px] text-ds-v3-ink-2',
    note:      'text-[13px] text-ds-v3-bgm',
    noteBox:   'bg-ds-v3-bgm-bg border border-ds-v3-bgm-line rounded-[10px] p-2.5',
    primary:   'min-h-[40px] px-5 rounded-full text-sm font-semibold bg-ds-v3-ink hover:bg-black text-white',
    secondary: 'min-h-[40px] px-5 rounded-full text-sm font-semibold border border-ds-v3-line-2 '
             + 'text-ds-v3-ink-2 hover:bg-ds-v3-surface-2',
    link:      'text-[13px] text-ds-v3-ink-2 hover:text-ds-v3-ink',
    accent:    'accent-[color:var(--ds-v3-ink)]',
    err:       'text-[13px] text-ds-v3-bgm font-semibold',
  },
}

export default function QuickSchedulePhrase({ onAdded, onKindChange, onDraftChange, className = '', tone = 'easy' }) {
  const v3 = tone === 'v3'
  const S = SKINS[v3 ? 'v3' : 'easy']
  const [text,     setText]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  // ── 카드 넷은 **각자 제 초안을 들고 있는다** (사용자 지시 2026-09-14) ──────────
  // *"각 카드의 작성 내용을 보존한다. 취소한 뒤 다른 버튼을 누르는 절차 없이 바로 전환한다."*
  //
  // 그전에는 초안이 **하나**였다. 그래서 「지금 방송」에 문안을 적다가 「배경음악」을 누르면
  // 그 문안이 사라졌고, 돌아와도 빈 칸이었다. 모드마다 칸을 따로 둔다.
  //
  // **모드 전환은 저장도 발사도 아니다** — `모드` 만 바꾼다. 바뀐 모드의 칸이 비어 있으면
  // 그때 초안을 하나 만들어 넣고, 이미 있으면 **그대로 되살린다.**
  const [모드, set모드] = useState(null)          // null | 'tts' | 'schedule' | 'bgm' | 'flow'
  // **사람이 카드 단추를 눌렀는가.** `모드` 로는 이것을 알 수 없다 — 검색 결과도 `모드` 를
  // 세우기 때문이다. 「고른 카드가 실행 방식을 정한다」는 규칙은 **사람이 고른 경우에만**
  // 적용되어야 해서 근거를 따로 둔다(V③ R14). `모드고르기` 만 세우고 `reset` 만 걷는다.
  const [손으로고름, set손으로고름] = useState(false)
  const [초안들, set초안들] = useState({})        // { [모드]: 초안 }
  const draft = 모드 ? (초안들[모드] ?? null) : null

  // ── **카드를 확인하는 동안 음성을 미리 만든다** (사용자 신고 2026-09-17 「전반적으로 속도감이 너무 느려」) ──
  // 「지금 방송」의 기다림 대부분은 합성이다. 문구가 멈추고 0.8초 지나면 서버에 미리 만들어 두라고 한다 —
  // 소리도 이력도 없다(`/api/tts/prepare`). 단추를 누를 때는 캐시에서 바로 꺼내 차임 → 안내로 간다.
  const 미리문구 = draft?.immediate && (draft.broadcast_type || 'text') === 'text' ? (draft.content || '').trim() : ''
  const 미리반복 = !!draft?.repeat_broadcast
  useEffect(() => {
    if (!미리문구) return
    const t = setTimeout(() => { prepareTTS({ text: 미리문구, repeat: 미리반복 }) }, 800)
    return () => clearTimeout(t)
  }, [미리문구, 미리반복])
  /** 지금 모드의 초안만 고친다. 다른 모드의 칸은 안 건드린다. */
  const setDraft = (v) => {
    if (!모드) return
    set초안들(p => ({ ...p, [모드]: typeof v === 'function' ? v(p[모드] ?? null) : v }))
  }
  /**
   * **지금 무엇을 보고 있는지**를 늦게 도착한 응답이 물어볼 자리.
   *
   * 비동기 콜백 안의 `모드`·`draft` 는 **누른 순간의 값으로 굳어 있다**(리액트 클로저).
   * 그래서 `보낸모드 !== 모드` 처럼 굳은 값끼리 비교하면 **언제나 같다** — 감시하는
   * 모양만 남고 아무것도 못 막는다. 렌더마다 여기 덮어써서 「지금 값」을 남긴다.
   */
  // 카드별 **확인 항목**(애매하게 읽힌 것들)과 체크 여부. 초안과 같이 보존해야
  // 카드를 바꿨다 돌아왔을 때 확인 게이트가 그대로 선다(V③ 지적 2026-09-14).
  const 확인들Ref = useRef({})
  const 지금Ref = useRef({ 모드, 초안들 })
  // 렌더 중에 ref 를 고치지 않는다(`react-hooks/refs`). 커밋 뒤에 덮어써도 늦지 않다 —
  // 이 값을 읽는 것은 **사람이 단추를 누른 뒤** 도착하는 응답뿐이다.
  useEffect(() => { 지금Ref.current = { 모드, 초안들 } })
  // (옛 주석) 확인 카드에 채워 넣을 파싱 결과(emptySchedule 기본값 위에 덮어씀)
  const [notes,    setNotes]    = useState([])     // 확인이 필요한 항목 안내
  // 유형이 요구할 때만 불러온다 — 대부분의 문장은 TTS 라 이 둘이 필요 없다
  const [flows,      setFlows]      = useState([])
  const [audioFiles, setAudioFiles] = useState([])
  // 「여기서 새 순서 만들기」가 펼쳐져 있나. 초안이 닫히면 같이 접힌다(`reset`).
  const [흐름만들기, set흐름만들기] = useState(false)

  /**
   * 순서를 방금 만들었다 — **접고, 목록을 다시 읽고, 그것을 곧바로 고른다.**
   *
   * 셋째가 핵심이다. 안 고르면 사람이 방금 만든 것을 목록에서 **다시 찾아야** 한다 —
   * 만든 직후가 가장 헷갈리는 순간이다(이름을 아직 안 외웠다).
   * 같은 규칙이 `ScheduleModal.handleFlowCreated` 에도 있다.
   */
  const handleFlowCreated = (newFlowId) => {
    set흐름만들기(false)
    getFlows().then(d => setFlows(d.items || [])).catch(() => {})
    if (newFlowId) setDraft(d => ({ ...d, flow_sequence_id: Number(newFlowId) }))
  }
  // AI 로 문구 다듬기 — 로컬 AI **허용** 스위치는 서버 설정이고, "쓸 수 있나"는 브라우저가
  // 따로 진단한다(둘 다 참이어야 1차가 돈다). 못 읽으면 꺼진 것으로 본다.
  // ── 빈 상태 안내가 도는 자리 ────────────────────────────────────────────────
  // **글자가 있으면 안 돈다.** placeholder 는 그때 안 보이므로 돌 이유가 없고, 무엇보다
  // 사람이 치는 동안 이 컴포넌트를 4.2초마다 다시 그리게 만들 이유가 없다.
  // placeholder 는 **속성**이라 값·포커스·한글 조합에 닿지 않는다(다시 그려도 그대로다).
  const [예시번호, set예시번호] = useState(0)
  // 좁은 화면에서 돌릴 목록 — **안내 한 장 + 예시들**. 안내가 맨 앞이라 처음 보는 사람이
  // 무엇을 하는 칸인지 먼저 안다. 넓은 화면은 둘을 한 줄에 같이 쓴다(아래 placeholder).
  const 넓은화면 = useWideScreen()
  const 좁은안내 = ['말하듯이 적어 보세요', ...EXAMPLES.map(e => `예: ${e}`)]
  useEffect(() => {
    if (text) return
    const t = setInterval(() => set예시번호(i => (i + 1) % EXAMPLES.length), EXAMPLE_MS)
    return () => clearInterval(t)
  }, [text])

  // 차임 설정 패널이 펼쳐져 있나. **모드가 아니다** — 카드도 문안도 안 건드린다.
  const [차임설정, set차임설정] = useState(false)
  // **차임 발사 상태** (사용자 결정 2026-09-15). 전관 스피커로 나가는 것이라 연타를 막는다 —
  // 페르소나 P3「두 번 누르는 시설장」. 어느 것을 보내는 중인지까지 들고 있어야
  // 그 단추만 「내보내는 중…」으로 바뀐다.
  const [차임보내는중, set차임보내는중] = useState(null)   // null | 'general' | 'end'
  const [차임오류, set차임오류] = useState('')
  // 빗장은 ref, 보여주기는 state — 위  주석 참고(V③ UI-0915-R3).
  const 차임보내는중Ref = useRef(null)
  // 간편모음(서랍)의 같은 토글과 **같은 값**을 본다(`useChimeToggles` 가 단일 출처).
  const { chime, endChime, setChime, setEndChime } = useChimeToggles()

  const [로컬AI허용, set로컬AI허용] = useState(false)
  const [짓는중,   set짓는중]   = useState(false)
  // ── 늦게 온 AI 응답이 **엉뚱한 칸을 덮지 않게** (사용자 지시 2026-09-14) ────────
  // *"늦은 AI/API 응답이 전환한 카드나 사용자가 새로 쓴 내용을 덮어쓰지 않게 한다."*
  //
  // 두 가지로 어긋난다:
  //   ① **카드를 바꿨는데** 앞 카드에 보낸 응답이 도착한다 — `짓는중`·`지은이` 가 모드와
  //      무관한 전역이라 **지금 보고 있는 카드에** 그 결과가 뜬다.
  //   ② **기다리는 동안 사람이 더 친다** — 도착한 응답이 그 글을 덮는다.
  // 그래서 보낼 때 **표식**을 적어 두고, 도착하면 그 표식이 아직 유효한지 본다.
  // 유효하지 않으면 **버리되 조용히 버리지 않는다**(이 저장소의 규칙).
  const ai표식Ref = useRef(0)
  // ── **검색 표식은 따로 센다** (V③ R6 지적, 2026-09-14) ──────────────────────────
  // 처음에는 검색(`run`)과 「AI 도움받기」가 **표식 하나를 나눠 썼다.** 그런데 `finally` 는
  // 각자 **제 자물쇠만** 푼다 — 검색을 기다리는 중에 AI 도움받기를 한 번 돌리면 표식이
  // 올라가고, 돌아온 검색 응답은 표식이 안 맞아 `setLoading(false)` 를 건너뛴다.
  // **검색창이 잠긴 채로 남는다.** 둘은 서로 무효로 만들 이유가 없는 다른 일이다.
  const 검색표식Ref = useRef(0)
  const [지은이,   set지은이]   = useState(null)   // { 강조, 글 }
  const [이전문구, set이전문구] = useState(null)   // AI 가 덮기 전 원문 — 「원래대로」용
  const [ai오류,   setAi오류]   = useState('')
  useEffect(() => { getLocalAiEnabled().then(d => set로컬AI허용(!!d?.enabled)).catch(() => set로컬AI허용(false)) }, [])
  // 무엇이 이 문장을 읽었나. 2026-09-06부터 이 입력창도 AI 보강을 받는다 —
  // 규칙이 시각을 못 읽었을 때만 AI 가 붙으므로, 어느 쪽이었는지 밝혀야 한다.
  const [via,       setVia]       = useState('')
  const [viaReason, setViaReason] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const [advanced, setAdvanced] = useState(false)  // true면 전체 예약 추가 모달(고급 설정용)
  const [acked,    setAcked]    = useState(false)  // 확인이 필요한 항목을 사람이 확인했는지
  const [firedMsg, setFiredMsg] = useState('')  // 즉시 방송을 내보낸 뒤의 안내(취소 대상 아님 — 이미 나갔다)
  // 방금 만든 예약 — 잘못 넣었을 때 관리자 화면까지 안 가고 바로 되돌리기 위한 것.
  // 다음 문장을 읽는 순간 사라진다(언제까지고 남아 있으면 무엇을 취소하는 건지 헷갈린다).
  const [justAdded,  setJustAdded]  = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  // 무엇을 적었길래 이 초안이 나왔는지. 카드 머리에 그대로 되비친다 — 파서가 잘못 읽었을 때
  // 사람이 **자기 문장과 대조**할 수 있어야 한다. 입력칸은 그대로 두므로 이 값은 그 사본이다.
  const [said, setSaid] = useState('')

  const run = async () => {
    const t = text.trim()
    if (!t || loading) return
    // ── **늦게 온 해석도 남의 칸을 덮지 않는다** (V③ 지적, 2026-09-14) ──────────────
    // 처음에는 「AI 도움받기」 한 자리만 막았다. 검수관이 짚었다 — **이 자리도 같다.**
    // 서버 파싱은 규칙이 못 읽으면 AI 로 넘어가 **10초대**가 걸린다. 그 사이에 사람이
    // 다른 카드를 고르거나 문안을 고칠 시간이 충분하다. 아래 `set모드`·`set초안들` 은
    // 조건 없이 덮으므로, 기다리는 동안 한 일이 통째로 사라진다.
    const 표식 = ++검색표식Ref.current
    const 보낸모드 = 모드
    // ── **본문만 보면 모자란다** (V③ 지적, 2026-09-14) ──────────────────────────
    // 처음에는 `content` 만 적어 두고 그것만 비교했다. 그런데 이 응답은 초안을 **통째로**
    // 갈아 끼운다 — 기다리는 동안 제목·시각·요일·음량을 고쳐도 검사를 통과해 **그 수정이
    // 통째로 사라진다.** 그래서 **초안 전체를 지문으로** 떠 둔다.
    const 지문 = (d) => (d ? JSON.stringify(d) : '')
    const 보낸지문 = 모드 ? 지문(draft) : ''
    setLoading(true); setError('')
    try {
      const parsed = await parseSchedulePhrase(t)
      // **지금 값을 본다** — 클로저의 `모드`·`draft` 는 누른 순간 값이라 비교해도 늘 같다.
      const 지금 = 지금Ref.current
      if (보낸모드 !== 지금.모드) {
        setError('다른 카드로 옮기셔서 읽은 결과를 쓰지 않았습니다. 다시 눌러 주세요.')
        return
      }
      if (보낸모드 && 지문(지금.초안들[보낸모드]) !== 보낸지문) {
        setError('그 사이에 카드를 고치셔서 읽은 결과를 덮지 않았습니다. 다시 눌러 주세요.')
        return
      }
      if (표식 !== 검색표식Ref.current) return   // 더 새 검색이 있다. 그쪽이 곧 답한다
      const { ambiguous = [], ...fields } = parsed
      // 후보 목록·정성어 이름은 "어느 쪽인가요?"를 묻는 데만 쓴다 — 예약 본문에는 넣지 않는다
      delete fields.type_alternatives
      delete fields.flow_alternatives
      delete fields.volume_label
      delete fields.volume_channel
      delete fields.auto_overlaps
      // 어느 단계가 읽었는지도 **표시용**이다. 안 지우면 예약 행에 그대로 저장된다.
      delete fields.via; delete fields.via_label; delete fields.via_reason
      setVia(parsed.via || ''); setViaReason(parsed.via_reason || '')
      // **`setNotes` 는 아래에서 한다** — 고른 카드와 문장이 어긋나면 확인 항목이 하나 더
      // 붙기 때문이다(V③ R12). 여기서 먼저 세우면 그 한 줄이 빠진 채로 그려진다.
      let 새확인 = buildNotes(ambiguous, parsed)
      setAcked(false)
      setSaveError(''); setAdvanced(false)
      setJustAdded(null); setCancelError(''); setFiredMsg(''); setSaid(t)
      // managed_by: 자연어로 만들어진 예약이라는 표시. "아까 등록한 거 취소"가 이 표시로만
      // 대상을 고르므로, 빠지면 그 예약은 취소 목록에 영원히 안 나온다. 확인 카드에서 바로
      // 저장하든 "자세히 수정"(ScheduleModal)을 거치든 draft가 통째로 펼쳐지므로 여기 둔다.
      // ── 인식 결과는 **모드를 제안**할 뿐이다 (사용자 지시 2026-09-14) ──────────
      // *"인식 결과는 초안의 종류를 제안하는 데만 사용한다. 사용자가 명시적으로 고른 모드를
      //   조용히 뒤집지 마라."*
      // 그래서 **사람이 이미 모드를 골라 뒀으면 그 모드를 지킨다.** 안 골랐을 때만 제안을 쓴다.
      // 시각이 잡혔으면 예약, 아니면 지금 방송이다 — `immediate` 는 서버 파서가 정한다
      // (`schedulePhrase.js` 의 `isImmediateRequest`). 화면이 제 규칙을 새로 만들지 않는다.
      const 제안 = fields.immediate ? 'tts' : 'schedule'
      const 쓸모드 = 모드 || 제안
      // ── **고른 카드가 「언제 나갈지」를 정한다** (V③ R12 지적, 2026-09-14) ────────────
      // 모드는 지켰는데 `immediate` 는 **파서 값을 그대로** 썼다. 그래서 「지금 방송」 카드에서
      // "내일 세시에…" 를 검색하면 **그 카드에 예약 초안이 들어앉고**, 확정하면 예약 행이
      // 만들어진다 — B-3 으로 막으려던 바로 그 일이다. 반대로 「예약 방송」 카드에서 "지금…"
      // 을 검색하면 **누르는 순간 방송이 나간다.**
      //
      // 카드를 고른다는 것은 **「지금 낼지 예약할지」를 고른 것**이다. 그것을 인식 결과가
      // 뒤집으면 안 된다 — *"사용자가 명시적으로 고른 모드를 조용히 뒤집지 마라"*.
      // **유형(무엇을 틀지)은 파서 것을 그대로 쓴다** — 그건 문장이 말하는 내용이고,
      // 카드가 고른 것은 **실행 방식**이다. 둘은 다른 물음이다.
      // **「골랐다」는 사람이 단추를 눌렀다는 뜻이다** (V③ R14 지적, 2026-09-14).
      // 앞 판은 `!!모드` 로 봤는데, `모드` 는 **앞선 검색도 세운다**(바로 아래 `set모드(쓸모드)`).
      // 그래서 카드를 한 번도 안 누르고 "지금 안내" → "내일 세시" 를 잇달아 치면, 첫 검색이
      // 세워 둔 `tts` 가 **고른 카드로 둔갑해** 둘째 문장을 **지금 바로** 내보냈다.
      // 사람은 아무것도 고른 적이 없는데 경고까지 「지금 방송」 카드 이름으로 붙었다.
      // 그러므로 판정 근거는 `모드` 가 아니라 **`모드고르기` 만 세우는 표식**이다.
      const 고른카드 = 손으로고름 && !!모드
      const 즉시여야 = 고른카드 ? !!초안정의[쓸모드]?.즉시 : !!fields.immediate
      // **조용히 버리지 않는다.** 고른 카드와 문장이 어긋나면 확인 항목으로 묻는다 —
      // 시각을 적었는데 지금 나가면 사람이 놀란다(이 저장소의 「애매한 것은 되묻는다」 규칙).
      if (고른카드 && !!fields.immediate !== 즉시여야) {
        새확인 = [...새확인, 즉시여야
          ? '「지금 방송」 카드라서 **지금 바로** 내보냅니다 — 적어 주신 시각은 쓰지 않습니다.'
            + ' 예약하시려면 「예약 방송」 카드에서 다시 적어 주세요.'
          : '「예약 방송」 카드라서 **예약으로** 만듭니다 — 지금 바로 내보내려면'
            + ' 「지금 방송」 카드에서 다시 적어 주세요.']
      }
      // ── **즉시면 실행값을 맞춘다** (V③ R7 지적, 2026-09-14) ─────────────────────
      // 여기는 `emptySchedule()` 위에 서버 결과를 얹는다. 그 기본값은 **새 예약의 것**이라
      // `active: 1` · 다음 5분 자리 · 매일 반복이 되살아난다. 즉시 카드에서 "지금 안내방송
      // 해줘"를 검색하면 **활성 예약으로 저장**되고, 그러면 몇 분 뒤 한 번 더 나가고
      // 내일도 나간다 — **2026-09-14 현장 신고가 바로 그것이었다.**
      // 빠른 단추만 고쳤더니 이 문이 열려 있었다. **규칙은 `즉시실행값` 한 곳이 정한다.**
      // ── **맞추는 일은 한 곳에서 한다** (V③ R17 지적, 2026-09-14) ─────────────────
      // 앞 판은 여기서 `immediate` 만 뒤집었다. 그런데 **즉시 요청의 파싱 결과는 「오늘 지금
      // 분 · 반복 없음」**이다(`schedulePhrase.js`). 「예약 방송」 카드에서 즉시 문장을 치면
      // 그 값이 그대로 남아 **확인하는 사이에 그 분이 지나가고**, 저장돼도 영영 안 울린다.
      // 「언제 나갈지」를 고치는 규칙은 `실행방식맞추기` 하나다 — 카드 단추 쪽과 같은 것을 쓴다.
      // 카드를 안 골랐으면 **제안**(파서가 말한 쪽)에 맞춘다 — 그래야 파서를 안 뒤집는다.
      const 기본 = emptySchedule()
      const 합친 = { ...기본, ...fields, managed_by: 'ai' }
      const { 초안 } = 실행방식맞추기(고른카드 ? 쓸모드 : 제안, 합친, 기본)
      set모드(쓸모드)
      set초안들(p => ({ ...p, [쓸모드]: 초안 }))
      // **확인 항목을 그 칸에 매어 둔다.** 초안만 보존하고 이것을 안 보존하면, 카드를
      // 바꿨다 돌아왔을 때 **확인 게이트가 사라진다**(V③ 지적).
      setNotes(새확인)
      확인들Ref.current = { ...확인들Ref.current, [쓸모드]: { notes: 새확인, acked: false } }
    } catch (e) {
      // 헌 요청의 실패를 지금 화면에 띄우지 않는다(「AI 도움받기」와 같은 규칙).
      if (표식 !== 검색표식Ref.current) return
      setError(e.message)
    } finally {
      if (표식 === 검색표식Ref.current) setLoading(false)
    }
  }

  /**
   * **카드를 접는다.** 「취소」와 저장·발사 뒤에 부른다.
   *
   * 지금 모드의 칸을 비우고 모드에서 나온다 — 「취소」는 *"이 카드는 없던 걸로"* 라는 뜻이라
   * 그 칸의 내용을 남기면 다음에 열었을 때 지운 줄 알았던 문안이 되살아난다.
   * **다른 모드의 칸은 안 건드린다**(카드 전환으로 보존한 것이 취소 한 번에 날아가면 안 된다).
   */
  const reset = () => {
    set초안들(p => { const n = { ...p }; if (모드) delete n[모드]; return n })
    set모드(null)
    set손으로고름(false)   // 카드를 접으면 「골랐다」도 걷는다(안 걷으면 다음 검색이 고른 척한다)
    setNotes([]); setSaveError(''); setAdvanced(false); setAcked(false); setText(''); setSaid('')
    // 취소는 그 칸을 없던 걸로 만든다 — 확인 항목도 같이 지운다(남기면 다음에 되살아난다)
    if (모드) { const 남 = { ...확인들Ref.current }; delete 남[모드]; 확인들Ref.current = 남 }
    set흐름만들기(false)   // 초안이 닫히면 순서 편집기도 같이 접는다
  }

  // ── **처음 안내가 이 부품을 실제로 움직인다** (사용자 지시 2026-09-17 N18) ─────────────────
  // *"DEV에서 실제 쓰는 구현한 기능을 갖고와서 해야지 실감나지"*. 안내(`HomeTour`)가 보내는 동작을
  // 여기서 받아 **화면 상태만** 바꾼다 — 검색(파서 호출)·저장·발사는 하나도 부르지 않는다.
  // 설령 불러도 `api.js` 가 안내 중 쓰기를 막는다(`tourStage.안내중`).
  // 「말로 예약」 장의 카드는 파서를 부르지 않고 **파서가 내는 모양 그대로** 채운다 —
  // 날짜는 이 PC 시계의 진짜 내일(서버 파서도 설치 PC 시계로 +1일 계산한다, `schedulePhrase.js`).
  useTourStage({
    'ask.type': (v) => setText(v ?? ''),
    'card.sch': ({ said: 말, 날짜, 시각, 제목, 내용 }) => {
      const 초안 = { ...빠른초안('schedule', emptySchedule()), title: 제목, content: 내용, scheduled_time: 시각,
        repeat_start_date: 날짜, repeat_end_date: 날짜, repeat_weekdays: [], managed_by: 'ai' }
      set모드('schedule'); set손으로고름(false)
      set초안들(p => ({ ...p, schedule: 초안 }))
      setSaid(말 || ''); setNotes([]); setAcked(false); setAdvanced(false); setText('')
    },
    // 칩을 누른 것과 같게 — 카드를 열고 머리에 단추 이름을 되비친다(아래 칩 onClick 과 같은 두 줄)
    'card.open': (id) => { if (모드 !== id) { 모드고르기(id); setSaid(빠른단추(id)?.이름 || '') } },
    'card.content': (v) => setDraft(d => (d ? { ...d, content: v } : d)),
    'card.bgm': (on) => setDraft(d => (d ? { ...d, bgm_enabled: on ? 1 : 0, ...(on && !d.bgm_type ? { bgm_type: BGM_DEFAULT_TYPE } : {}) } : d)),
    'card.music': (v) => setDraft(d => (d ? { ...d, bgm_type: v || BGM_DEFAULT_TYPE, bgm_value: '' } : d)),
    'card.minutes': (n) => setDraft(d => (d ? { ...d, duration_sec: Number(n) * 60 } : d)),
    'card.newflow': (on) => set흐름만들기(!!on),
    // 처음 안내 「차임벨」 장 — 패널만 편다. 발사는 부르지 않는다(누르는 모습은 안내가 겉모습으로만 낸다).
    'chime.open': (on) => set차임설정(!!on),
    'card.more': (on) => setAdvanced(!!on),
    'card.reset': () => {
      set초안들({}); set모드(null); set손으로고름(false); setNotes([]); setAdvanced(false); setAcked(false)
      setText(''); setSaid(''); set흐름만들기(false); 확인들Ref.current = {}
    },
  })

  // ── **ESC 로 카드를 닫는다** (사용자 지시 2026-09-15) ────────────────────────
  // *"카드 나올 때, 취소버튼 누르는거 단축키 ESC로 해줘"*
  //
  // **방송이 나가는 중이면 여기까지 안 온다.** 재생바(`NowPlayingBar`)가 같은 키를
  // `capture` 로 먼저 받아 전파를 멈추고 「정지」를 한다 — 소리가 나가는 중에는 그것을
  // 멈추는 일이 급하기 때문이다. 재생바는 **소리가 날 때만 그려지므로** 아무것도
  // 안 나갈 때는 그 듣기 자체가 안 걸린다. 뜻을 정하는 규칙은 `lib/shortcutRules` 한 곳이다.
  //
  // **글자를 적는 중에도 듣는다** — ESC 는 띄어쓰기와 달리 글자가 아니다. 문안을 적다가
  // ESC 를 누르는 것은 「이 카드 없던 걸로」라는 뜻이 맞다.
  useEffect(() => {
    if (!draft) return undefined
    const onKey = (e) => {
      if (단축키뜻({ key: e.key, 카드열림: true, 글자입력: 글자입력중(e.target) }) !== '카드닫기') return
      e.preventDefault()
      reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /**
   * **카드를 갈아 끼운다** — 네 단추가 부른다.
   * 저장도 발사도 하지 않는다. 그 칸이 비어 있으면 초안을 하나 만들어 넣고,
   * 이미 있으면 **그대로 되살린다**(작성 내용 보존).
   */
  /**
   * **차임을 지금 내보낸다** (사용자 결정 2026-09-15).
   *
   * 전관 스피커로 나가고 **되돌릴 수 없다.** 그래서 지키는 것 둘:
   *   ① **연타를 막는다** — 보내는 중에는 두 단추가 다 잠긴다. 화면 잠금만으로는
   *      모자라서 서버에도 겹침 잠금이 있지만(`duplicateBroadcast.js`), 차임은 그
   *      대상이 아니다. 여기가 유일한 빗장이다.
   *   ② **실패를 삼키지 않는다** — 안 나갔으면 그렇게 말한다. 조용한 실패가 이
   *      저장소에서 가장 비싼 실패다.
   */
  const 차임내보내기 = async (종류) => {
    // ── **빗장은 `ref` 다** (V③ UI-0915-R3 지적) ─────────────────────────────────
    // 앞 판은 `if (차임보내는중) return` — **상태(state)** 였다. 그런데 리액트에서 상태는
    // **그 렌더의 값으로 굳는다.** 손가락이 다시 그려지기 전에 두 번 닿으면 **둘 다 `null`
    // 을 읽고 둘 다 나간다** — 전관 스피커에서 차임이 겹친다. 막으려던 바로 그 일이다.
    // (내 시험은 살아 있는 getter 를 줘서 이것을 못 봤다. 검수관이 짚었다.)
    //
    // `ref` 는 렌더와 무관하게 **지금 값**이라 같은 렌더 안의 두 번째 누름도 걸린다.
    // 이 저장소가 확정 경로에서 이미 쓰는 방법이다(`보내는중Ref`).
    // 상태는 **보여주기용**으로 남긴다 — 단추 글자가 「내보내는 중…」으로 바뀌어야 한다.
    if (차임보내는중Ref.current) return
    차임보내는중Ref.current = 종류
    set차임보내는중(종류)
    set차임오류('')
    try {
      await fireChime(종류)
    } catch (e) {
      set차임오류(`차임을 못 내보냈습니다 — ${e.message}`)
    } finally {
      // 빗장을 **먼저** 푼다. 상태는 다음 렌더에 반영되지만 ref 는 그 자리에서 바뀐다 —
      // 둘 사이가 벌어지면 그 틈에 누른 것이 막히거나 새어 나간다.
      차임보내는중Ref.current = null
      set차임보내는중(null)
    }
  }

  const 모드고르기 = (id) => {
    set모드(id)
    set손으로고름(true)   // 이 자리만 세운다 — 검색은 안 세운다(V③ R14)
    // ── **있던 초안도 이 카드의 실행 방식에 맞춘다** (V③ R15 지적, 2026-09-14) ────────
    // 앞 판은 있으면 **그대로 되살렸다.** 그런데 카드 없이 검색만 잇다 보면 `schedule` 칸에
    // `immediate: true` 인 초안이 들어앉을 수 있다(파서 제안을 따르므로). 그 뒤 「예약 방송」을
    // 눌러도 그 초안이 그대로 살아나서, **예약 카드를 보면서 확정을 누르면 방송이 나갔다.**
    // 단추를 누르는 것이 명시적 선택이다 — 그러니 그 순간 맞춘다. 문안은 안 건드린다.
    // **판단은 갱신 함수 밖에서 한다.** 안에서 하면 그 함수는 렌더 때 불리므로 아래 줄들이
    // 이미 지나간 뒤다 — `맞춤바뀜` 이 언제나 `false` 로 읽혀 사람에게 말을 못 한다.
    const 있던 = 초안들[id]
    const { 초안: 맞춘, 바뀜: 맞춤바뀜 } =
      있던 ? 실행방식맞추기(id, 있던, emptySchedule()) : { 초안: null, 바뀜: false }
    set초안들(p => (p[id]
      ? (맞춤바뀜 ? { ...p, [id]: 맞춘 } : p)
      : { ...p, [id]: 빠른초안(id, emptySchedule()) }))
    setSaveError(''); setAdvanced(false)
    setJustAdded(null); setCancelError(''); setFiredMsg(''); setError('')
    setVia(''); setViaReason('')
    // ── **확인 항목은 그 칸에 딸려 다닌다** (V③ 지적, 2026-09-14) ─────────────────
    // 초안은 보존하면서 `notes` 만 비웠다. 그러면 **애매하게 읽힌 예약**을 만들어 두고
    // 다른 카드에 갔다 오면 초안은 남는데 확인 항목이 사라진다 —
    // `handleConfirm` 은 `notes.length > 0` 일 때만 확인을 요구하므로 **미확인 시각·후보가
    // 그대로 저장된다.** 조용한 오독이 이 저장소에서 가장 비싼 실패인데, 카드별 초안 보존이
    // 바로 그 문을 열어 놓고 있었다. 그래서 초안과 **같이** 보관하고 같이 되살린다.
    const 표 = 확인들Ref.current[id]
    // **맞췄으면 말한다.** 조용히 바꾸면 사람은 아까 적은 시각이 살아 있는 줄 안다
    // (이 저장소의 「애매한 것은 되묻는다」 규칙). 확인 항목이 서면 확정도 한 번 막힌다.
    const 맞춤알림 = 맞춤바뀜
      ? [초안정의[id]?.즉시
          ? '「지금 방송」 카드라서 **지금 바로** 내보내는 초안으로 맞췄습니다 — 적어 두신 시각은 쓰지 않습니다.'
          : '「예약 방송」 카드라서 **예약 초안**으로 맞췄습니다 — 지금 바로 내보내려면 「지금 방송」 카드에서 해 주세요.']
      : []
    const 새표 = [...(표?.notes ?? []), ...맞춤알림]
    setNotes(새표); setAcked(맞춤바뀜 ? false : (표?.acked ?? false))
    if (맞춤바뀜) 확인들Ref.current = { ...확인들Ref.current, [id]: { notes: 새표, acked: false } }
    // AI 안내도 **그 카드의 것**이다 — 남겨 두면 새 카드에 앞 카드의 결과가 붙어 보인다.
    set지은이(null); set이전문구(null); setAi오류(''); set짓는중(false)
    // 돌고 있는 요청이 있으면 **여기서 무효로 만든다**(도착해도 안 쓴다).
    // **둘 다** 올린다 — 카드가 바뀌면 검색 결과도 AI 결과도 갈 곳이 없다.
    ai표식Ref.current++
    검색표식Ref.current++
    // ── **검색 자물쇠도 같이 푼다** (V③ 지적, 2026-09-14) ────────────────────────
    // 표식만 올리고 `loading` 을 안 풀었다. 그러면 돌아온 응답이 `finally` 에서 표식이
    // 안 맞아 `setLoading(false)` 를 건너뛰고, **검색창이 영영 잠긴 채로 남는다.**
    // 무효로 만든 요청이 자물쇠까지 들고 가면 안 된다.
    setLoading(false)
  }

  /**
   * **두 번 눌러도 한 번만 나간다** (사용자 지시 2026-09-14).
   *
   * 단추에 `disabled={saving}` 이 걸려 있지만 그것만으로는 못 막는다 — `setSaving(true)` 는
   * **다시 그려진 뒤에야** 단추에 닿는다. 그 사이(한 프레임)에 두 번째 클릭이 들어오면
   * 이 함수가 두 번 돌아 **방송이 두 번 나간다.** 페르소나 P3 「두 번 누르는 시설장」이
   * 정확히 그 자리다. ref 는 그 자리에서 바로 참이 된다.
   *
   * 이것은 **첫 번째 방어선**이다. 다른 PC·브라우저 재시도는 여기 안 걸리므로
   * 서버도 같은 것을 본다(`services/duplicateBroadcast.js`).
   */
  const 보내는중Ref = useRef(false)

  /**
   * **즉시 방송 실행 — 한 자리** (B-3, V③ R9 지적 2026-09-14).
   *
   * 확정 단추와 「자세히 수정」이 **같은 것**을 쓴다. 처음에는 확정 단추만 고쳤는데,
   * 모달 경로가 그대로 예약 행을 만들고 스케줄러로 쏘고 있었다 — **같은 결함의 나머지
   * 절반**이다. 규칙이 두 곳에 따로 있으면 언제나 한쪽만 고쳐진다(오늘만 두 번째다).
   */
  const 지금내보내기 = async (d) => {
    const 유형 = d.broadcast_type || 'text'

    // ── **배경음악은 예약 행을 안 남긴다** (사용자 결정 2026-09-15) ────────────────
    // 규칙은 「즉시는 휘발성, 업로드는 영구」다(`docs/journal/decisions.md`).
    //
    // 그전에는 아래 갈래로 내려가 **예약을 하나 만들고 그것을 실행**했다. 그 행은
    // 꺼진 채로 지워지지 않아서, 즉시 방송을 쓸 때마다 **달력에 흐린 줄이 하나씩
    // 쌓였다**(달력은 일시정지한 예약도 일부러 보여 준다).
    //
    // **배경음악부터 옮긴다** — 현장에서 제일 자주 쓰는 즉시 방송이고, 신호 하나만
    // 쏘면 끝이라 가장 안전하다. 나머지(음원·영상·순서)는 그대로 둔다 —
    // 특히 순서는 실행이 돌아온 뒤에도 그 행을 읽으므로 따로 검수하며 옮긴다.
    if (유형 === 'bgm') {
      await startBgmNow({
        bgm_type:   d.bgm_type || BGM_DEFAULT_TYPE,
        bgm_value:  d.bgm_value || '',
        bgm_title:  d.bgm_title || d.title || '',
        bgm_volume: d.bgm_volume,
        // **얼마나 틀지**(초). 0 이면 무제한 — 사람이 정지를 누를 때까지 흐른다.
        duration_sec: Number(d.duration_sec) || 0,
      })
      return
    }

    // ── **음원도 예약 행을 안 남긴다** (2026-09-15, 두 번째 조각) ────────
    // 트는 것은 휘발성이고 **업로드에 등록된 파일 자체는 그대로 남는다.**
    if (유형 === 'audio') {
      await playFileNow({
        broadcast_type: 유형,
        audio_file_id:  d.audio_file_id,
        main_volume:    d.main_volume,
        playback_rate:  d.playback_rate,
        title:          d.title,
      })
      return
    }

    if (유형 !== 'text') {
      // 영상·차임·흐름 즉시 실행은 아직 이 길이 아니다 — **조용히 딴 길로 보내지 않는다.**
      // 영상은 쏘기 전에 BGM 을 끄고 페이드를 기다리는 판단이 예약 경로에만 있어서,
      // 그 자리를 한 곳으로 뺀 다음에 옮긴다. 흐름은 실행이 돌아온 뒤에도 그 행을 읽는다.
      const saved = await createSchedule(d)
      if (!saved?.id) throw new Error('예약이 만들어졌는지 확인할 수 없어 방송을 못 내보냈습니다.')
      await triggerSchedule(saved.id)
      return
    }
    await ttsBroadcast({
      text: d.content,
      target: d.target || '전체',
      volume: d.main_volume ?? null,            // 이 방송에만 쓸 안내 음량
      repeat: !!d.repeat_broadcast,             // 「방송 2회 반복」
      // ── **BGM 을 붙였으면 차임은 안 붙인다** (사용자 지시, 2026-09-16 재지적) ────────
      // *"내가 즉시방송할때 BGM선택하면 차임벨 넣지 말랫지"*
      //
      // 서버에 이미 같은 규칙이 있다 — `chimePlayer.부수차임막힘()` 이 *"BGM 이 나가는
      // 중이면 차임은 건너뛴다"*(2026-09-13 결정). 그런데 그것은 **이미 나가고 있는 BGM**
      // 을 본다. 이 방송이 **자기 BGM 을 데리고 시작하는** 경우에는, 차임이 먼저 울리는
      // 시점에 그 BGM 이 아직 시작 전이라 판정을 빠져나간다.
      //
      // 그래서 **보내는 쪽에서 끈다.** 붙일 BGM 이 있다는 것은 이 화면만 아는 사실이고,
      // 서버는 그것을 차임 판정 시점에 알 길이 없다.
      chimeStart: d.bgm_enabled ? false : chime,
      chimeEnd:   d.bgm_enabled ? false : endChime,
      // 카드의 「BGM 재생」. 이름은 예약 행의 칸 그대로다 — 서버의
      // `resolveBGM` 이 그 이름으로 읽는다(화면이 이름을 새로 짓지 않는다).
      bgm: d.bgm_enabled ? {
        bgm_type: d.bgm_type || BGM_DEFAULT_TYPE, bgm_value: d.bgm_value || '',
        bgm_title: d.bgm_title || '', bgm_delay: d.bgm_delay,
        bgm_end_delay: d.bgm_end_delay, bgm_volume: d.bgm_volume,
      } : null,
    })
  }

  const handleConfirm = async () => {
    if (보내는중Ref.current) return
    if (!draft.title.trim() || !draft.scheduled_time) {
      setSaveError('제목·시간을 확인해 주세요.')
      return
    }
    // 방송 내용은 TTS 방송에만 필요하다 — 차임벨·BGM·흐름은 읽을 문구가 없다
    if (draft.broadcast_type === 'text' && !draft.content?.trim()) {
      setSaveError('방송 내용을 입력해 주세요.')
      return
    }
    if (NEEDS_AUDIO_FILE.includes(draft.broadcast_type) && !draft.audio_file_id) {
      setSaveError('재생할 파일을 "자세히 수정"에서 선택해 주세요.')
      return
    }
    if (draft.broadcast_type === 'flow' && !draft.flow_sequence_id) {
      setSaveError('사용할 흐름을 "자세히 수정"에서 선택해 주세요.')
      return
    }
    // 애매하게 읽은 항목이 있으면 사람이 확인했다고 표시해야 저장한다
    if (notes.length > 0 && !acked) {
      setSaveError('확인이 필요한 항목을 보고 "확인했습니다"에 체크해 주세요.')
      return
    }
    보내는중Ref.current = true
    setSaving(true); setSaveError('')
    const title = draft.title
    const isImmediate = !!draft.immediate
    try {
      // ── **즉시 방송은 예약 행을 안 만든다** (B-3, 사용자 승인 2026-09-14) ─────────
      // 예전에는 예약을 하나 만들어 수동 트리거로 쐈다. 그 길의 대가가 컸다:
      //   · 그 행이 **예약으로 남아** 몇 분 뒤 다시 나가고 내일도 나갔다(현장 신고).
      //     지금은 실행값을 맞춰 막고 있지만, **애초에 안 만들면 그 위험이 없다.**
      //   · 스케줄러 경로라 **차임·안내 음량·2회 반복이 안 붙었다**(예약 행에 칸이 없다).
      //   · 예약 목록·이력에 사람이 만든 적 없는 행이 쌓였다.
      // 이제 `/api/tts/broadcast` 를 직접 부른다 — 그 길이 차임·음량·반복을 받고,
      // **BGM 전후·지연도 함께** 받는다(B-2, 이 커밋에서 서버에 붙였다).
      //
      // **안내는 서버 스피커로, 반주는 브라우저로** 나간다. 그래서 현장에 창이 없어도
      // 안내는 나간다 — 오늘 저녁 무음 사고의 갈래에서 이쪽은 안전한 편이다.
      if (isImmediate) {
        await 지금내보내기(draft)
        reset()
        setFiredMsg(`"${title}" 방송을 지금 내보냈습니다.`)
      } else {
        const saved = await createSchedule(draft)
        reset()
        // id가 없으면 되돌릴 대상을 특정할 수 없으니 취소 줄을 아예 띄우지 않는다
        if (saved?.id) 띠띄우기({ id: saved.id, title })
      }
      onAdded?.()
    } catch (e) {
      if (!e.cancelled) setSaveError(e.message)
    } finally {
      보내는중Ref.current = false
      setSaving(false)
    }
  }

  // 방금 만든 예약만 되돌린다. AI 전용 경로라 사람이 만든 예약이나 자동방송 순서 편집기의
  // 행에는 닿지 않는다(서버가 소유자를 확인하고 403으로 막는다).
  const handleCancelJustAdded = async () => {
    if (!justAdded || cancelling) return
    setCancelling(true); setCancelError('')
    try {
      await cancelAiSchedule(justAdded.id)
      setJustAdded(null)
      onAdded?.()
    } catch (e) {
      setCancelError(e.message)
    } finally {
      setCancelling(false)
    }
  }

  // 인식된 유형이 띠는 색.
  //
  // **치는 동안에는 짐작, 확정되면 서버 판정.** 목업 v3 의 결이다 — 검색창 테두리와
  // 배경 물감이 글자를 치는 동안 반응한다(`v3.html:1163-1167`).
  //
  // 여기 예전에 *"인식되기 전에는 색이 없다"* 고 적혀 있었고 이유도 옳았다 — 문장만 보고
  // 미리 칠하려면 유형 사전의 **사본**을 브라우저에 둬야 하고, 그 사본이 서버와 갈리는 날
  // 화면은 파란데 실제로는 음악이 나간다. 그래서 일부러 안 켰던 자리다.
  //
  // **그 이유를 없애고 켰다**(2026-09-13). `server/test/kind-hints.test.js` 가 `ontology.js`
  // 를 실제로 읽어 화면 힌트와 대조한다 — 서버에 낱말이 하나 늘면 빨간불이 뜬다.
  // 갈릴 수 있다는 것이 문제였지 짐작 자체가 문제는 아니었다.
  //
  // 서버를 부르지 않는 이유: `/api/schedules/parse-phrase` 는 규칙이 시각을 못 읽으면
  // **Gemini 를 부른다**(유료·10.5초). 글자를 칠 때마다 지날 경로가 아니다.
  const kind = draft ? kindOfType(draft.broadcast_type) : guessKindFromText(text)

  // 바깥(통합 홈)이 이 색을 같이 쓴다 — 배경 물감 두 방울이 그쪽으로 움직인다.
  // 값이 **바뀔 때만** 알린다. 매 렌더마다 부르면 부모가 같은 값으로 다시 그린다.
  const 알린종류 = useRef(null)
  useEffect(() => {
    if (알린종류.current === kind) return
    알린종류.current = kind
    onKindChange?.(kind)
  }, [kind, onKindChange])

  // 초안 카드가 떠 있는지도 알린다 — 통합 홈이 그때 **배치를 바꾼다**(오늘 일과를 옆으로).
  // 카드가 세로로 400px 넘게 자라서, 스택으로 두면 오늘 일과가 화면 밖으로 밀린다
  // (사용자 지적 2026-09-13: *"이렇게 내려오면 오늘 하루일정이 안보이잖아"*).
  // 같은 규칙으로 **바뀔 때만** 알린다.
  const 알린초안 = useRef(null)
  useEffect(() => {
    const 열림 = !!draft
    if (알린초안.current === 열림) return
    알린초안.current = 열림
    onDraftChange?.(열림)
  }, [draft, onDraftChange])

  // ── 되돌리기 띠는 **게이지가 차면 스스로 사라진다** (사용자 결정 2026-09-13) ─────
  //
  // 그전에는 타이머가 없어서 새로고침할 때까지 남았다. 그것만도 군더더기인데,
  // **더 나쁜 것은 그 띠를 치우는 유일한 단추가 「취소」였다는 점**이다 —
  // 알림만 없애려고 누르면 방금 만든 예약이 지워진다. 치우는 길과 지우는 길이
  // 같은 단추면 그것은 안내가 아니라 덫이다.
  //
  // **왜 게이지인가**: 그냥 사라지면 사람은 "어? 방금 뭐가 있었는데"가 된다.
  // 줄어드는 것이 보이면 **언제 사라질지 알고 보내 준다**(사용자 지시).
  //
  // **왜 5초인가**: 3초는 제목을 읽고 "아 잘못 넣었네"까지 가기에 짧다 — 주 사용자가
  // 50~60대이고 읽을 것이 제목·안내문·단추 셋이다. 대신 **손을 올리면 멈춘다**(아래
  // `멈춤`) — 손이 닿는 중에 닫히는 일이 없으니 짧게 둘 수 있다.
  //
  // **게이지와 사라지는 시점은 같은 시계다.** 따로 두면(CSS 애니메이션 + 별도 타이머)
  // 눈에 보이는 것과 실제가 어긋나고, 움직임을 줄인 기기에서는 애니메이션이 죽어
  // `animationend` 가 영영 안 와 **띠가 안 사라진다.** 그래서 JS 로 한 번만 센다.
  const 남은ms = useRef(0)
  const [게이지, set게이지] = useState(1)   // 1 → 0
  const [멈춤, set멈춤]     = useState(false)

  // 띠를 띄우는 **유일한 문**. 시계를 여기서 함께 감는다 — effect 로 되돌리면
  // 렌더가 한 번 더 돌고(`react-hooks/set-state-in-effect`), 무엇보다 "띄우기"와
  // "시계 감기"가 두 곳으로 갈려 한쪽만 고쳐질 자리가 생긴다.
  const 띠띄우기 = (값) => {
    남은ms.current = UNDO_MS
    set게이지(1)
    set멈춤(false)
    setJustAdded(값)
  }

  useEffect(() => {
    if (!justAdded || 멈춤) return
    const 시작 = Date.now()
    const 처음 = 남은ms.current
    const t = setInterval(() => {
      const 남 = Math.max(0, 처음 - (Date.now() - 시작))
      남은ms.current = 남
      set게이지(남 / UNDO_MS)
      if (남 === 0) { clearInterval(t); setJustAdded(null) }
    }, 80)
    return () => clearInterval(t)   // 멈추면 남은 시간이 `남은ms` 에 그대로 남는다
  }, [justAdded, 멈춤])

  // ── 이 유형이 무엇을 더 물어야 하나 ─────────────────────────────────────────
  // 목록은 `lib/scheduleUtils.js` 의 `NEEDS_AUDIO_FILE` 하나다 — 서버의
  // `ontology.NEEDS_AUDIO_FILE_TYPES` 와 대조된다(ai-approval-pickers.test.js).
  const 지금유형 = draft?.broadcast_type || 'text'
  const 유형이흐름 = 지금유형 === 'flow'
  const 유형이파일 = NEEDS_AUDIO_FILE.includes(지금유형)
  const 파일후보  = filesForBroadcastType(audioFiles, 지금유형)

  useEffect(() => {
    if (유형이흐름 && flows.length === 0) getFlows().then(d => setFlows(d.items || [])).catch(() => {})
    if (유형이파일 && audioFiles.length === 0) getAudioFiles().then(setAudioFiles).catch(() => {})
  }, [유형이흐름, 유형이파일, flows.length, audioFiles.length])

  return (
    <>
      <div className={className}>
        {v3 ? (
          <>
          {/* 검색창 한 줄 — 목업 v3 의 `.askbar`. 돋보기·입력·화살표가 한 알약 안에 있다 */}
          <form
            data-tour="ask"
            onSubmit={e => { e.preventDefault(); run() }}
            className={'flex w-full items-center gap-2 rounded-full border bg-ds-v3-surface '
              + 'py-[7px] pl-[18px] pr-2 shadow-v3-ask transition-[border-color,box-shadow] duration-300 '
              + 'focus-within:shadow-v3-ring '
              + (ASK_TINT[kind] || 'border-ds-v3-line-2 focus-within:border-ds-v3-ink')}>
            <Search size={19} strokeWidth={1.8} className="flex-none text-ds-v3-ink-3" aria-hidden="true" />
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              /* ── **좁은 화면에서는 안내와 예시를 번갈아 띄운다** (사용자 지적 2026-09-15) ──
                 한 줄로 붙이면 *"말하듯이 적어 보세요 — 예: 미…"* 에서 잘려
                 **정작 보여 주려던 예시가 안 보인다.** 안내만 남고 예시가 통째로 죽는다.
                 넓은 화면은 둘 다 들어가므로 예전 그대로 둔다.
                 **돌리는 시계는 하나다**(`예시번호`) — 따로 두면 둘이 어긋난다. */
              placeholder={넓은화면
                ? `말하듯이 적어 보세요 — 예: ${EXAMPLES[예시번호 % EXAMPLES.length]}`
                : 좁은안내[예시번호 % 좁은안내.length]}
              aria-label="방송할 내용"
              className="min-h-[44px] min-w-0 flex-1 border-0 bg-transparent text-base text-ds-v3-ink
                         outline-none placeholder:text-ds-v3-ink-3"
            />
            <button
              type="submit"
              disabled={!text.trim() || loading}
              aria-label={loading ? '문장 읽는 중' : '문장 읽고 초안 만들기'}
              data-tour="ask-go"
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full
                         bg-ds-v3-ink text-white transition-colors hover:bg-black disabled:opacity-40">
              <ArrowRight size={18} />
            </button>
          </form>

          {/* ── 빠른 단추 줄 (사용자 결정 2026-09-14) ────────────────────────────────
              *"예전에는 tts 방송이라고 있어서 약간 직관적이었단말이야? … 저 검색창이
                생기면서 뭔가 좀 애매해지긴 했어, 직관적으로 즉시방송하고 싶기도 한데"*

              **카드를 쌓지 않는다**(G-21·G-36·G-39) — 알약 한 줄이라 배경 물감을 안 가리고
              스크롤도 안 늘린다. 옛 화면처럼 큰 TTS 카드를 본문에 되살리지 않는 이유다.

              **건너뛰는 것은 「문장 읽기」뿐이다.** 무엇을 방송할지 이미 골라서 누른 것이라
              서버에게 유형을 물을 이유가 없다. 그러나 **확정은 그대로다** — 초안 카드가 뜨고
              사람이 「지금 방송」을 눌러야 소리가 난다(G-42). 어느 단추가 무엇을 여는지는
              `lib/quickStart.js` 한 곳이고, `quick-start-row.test.js` 가 실제로 불러 본다. */}
          {/* ── 좁은 화면에서는 **2×2 격자** (사용자 지시 2026-09-14) ─────────────
              예전엔 라벨과 단추 넷이 한 `flex-wrap` 줄에 함께 있었다. 라벨이 첫 줄을
              갉아먹어 430px 에서 **셋 + 하나**로 갈라졌다 — 「순서」 하나만 아래 줄에
              덩그러니 남는다(사용자 사진). 줄바꿈 자리가 폭에 따라 들쭉날쭉한 것이 문제다.
              좁은 화면에서는 **격자로 못 박아** 언제나 2+2 로 맞추고, 라벨은 제 줄로 올린다.
              넓은 화면(`tablet:`)에서는 예전처럼 한 줄에 늘어놓는다. */}
          {(
            <div className="mt-2.5 flex flex-col items-center gap-1.5 tablet:flex-row tablet:flex-wrap tablet:justify-center">
              {/* ── **「지금」과 「나중에」를 갈라 놓는다** (사용자 지시 2026-09-15) ────────
                  *"예약이랑 즉시방송이랑 섞여 있어서 헷갈린 거 같아. [지금방송, 배경음악,
                    순서] 이렇게 묶어봐 디자인적으로 구분되게, 그리고 예약방송."*

                  넷이 한 줄에 나란히 서 있었는데 **셋은 누르면 곧 소리가 나고 하나는 안
                  난다.** 그 차이가 이 줄에서 가장 중요한 사실인데 생김새로는 아무 데도
                  안 적혀 있었다 — 「바로 시작」이라는 라벨 하나가 **넷 전부**를 가리키고
                  있어서 오히려 예약도 바로 나가는 것처럼 읽혔다.

                  묶는 근거는 **각 단추가 이미 들고 있는 `즉시`** 다(`lib/quickStart.단추묶음`).
                  화면이 제 목록을 따로 적으면 언젠가 갈린다.

                  **선을 하나 긋는다** — 색을 더 쓰지 않는다. 이 줄은 이미 유형 색 셋
                  (말 파랑·음악 자주·순서 보라)을 쓰고 있어서, 묶음까지 색으로 말하면
                  무엇이 무엇을 뜻하는지 갈린다. */}
              {단추묶음().map((묶음, gi) => (
                /* ── **휴대폰에서는 이름표를 줄 왼쪽에** (사용자 지시 2026-09-17 「모바일 웹환경 사용성」) ──
                   이름표가 제 줄을 따로 쓰고 「순서」가 둘째 줄로 떨어져, 단추 다섯이 세로 330px 을 먹고
                   「오늘 일과방송」이 첫 화면 밖으로 밀렸다(390×844 실측). 이름표를 왼쪽에 붙이고 한 묶음을 한 줄에 둔다. */
                <div key={묶음.키}
                  className={'flex w-full flex-row items-center gap-2 tablet:w-auto tablet:gap-1.5 '
                    + (gi > 0
                      ? 'tablet:ml-1 tablet:border-l tablet:border-ds-v3-line-2 tablet:pl-3 '
                        + 'border-t border-ds-v3-line-2 pt-2 tablet:border-t-0 tablet:pt-0'
                      : '')}>
                  <span className="w-[46px] shrink-0 text-[13px] text-ds-v3-ink-3 whitespace-nowrap tablet:w-auto">{묶음.이름}</span>
                  <div className={'grid min-w-0 flex-1 gap-1.5 tablet:flex tablet:flex-none tablet:w-auto tablet:gap-1.5 '
                    + (묶음.단추.length > 2 ? 'grid-cols-3' : 묶음.단추.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                  {묶음.단추.map(b => {
                const 색 = kindOfType(b.유형)
                // ── **「지금 방송」만 채운다** (사용자 지시 2026-09-15) ────────────────────
                // *"지금 방송 토글이랑 예약 방송 토글이 좀 겹쳐지는 부분이 있는데…
                //   지금 방송이라는 게 눈에 띌 수 있도록."*
                //
                // 둘 다 「말로 나가는 방송」이라 **같은 파랑**을 쓴다(`kindOfType` → tts).
                // 색이 같은데 생김새도 같으면(테두리만 있는 알약) 글자를 읽어야 갈린다 —
                // 급할 때 누르는 단추가 그러면 안 된다.
                //
                // **색을 바꾸지 않고 「채움」으로 가른다.** 파랑 계열은 유지하라는 지시였고,
                // 색을 바꾸면 `kindOfType` 의 갈래(말 파랑 · 음악 자주 · 순서 보라)가 무너진다.
                // 나머지 셋은 테두리만, 이것만 **옅은 파랑 그라디언트로 채운다.**
                // 그라디언트 모양은 「오늘 일과방송」의 다음 줄과 같은 결이다(같은 파랑 토큰,
                // 아주 옅은 알파) — 한 화면에서 두 가지 강조 방식이 따로 놀지 않게.
                //
                // **색만으로 말하지 않는다**(G-7): 그림자와 굵은 테두리가 함께 붙고,
                // 고른 상태는 여전히 `aria-pressed` 가 보조기술에 전한다.
                const 주단추 = b.id === 'tts'
                return (
                  <button key={b.id} type="button"
                    style={주단추 ? { backgroundImage:
                      'linear-gradient(135deg, rgba(37,99,235,.16), rgba(37,99,235,.05) 70%)' } : undefined}
                    onClick={() => {
                      // ── **한 번 더 누르면 닫힌다** (사용자 지시 2026-09-15) ──────────
                      // *"토글 한번 더 누르면 다시 원위치되는 것도 해줘, 차임벨처럼."*
                      // 차임 설정 패널이 이미 그렇게 돈다. 단추가 `aria-pressed` 로
                      // 「눌린 상태」를 말하고 있으니, 다시 누르면 풀리는 것이 맞다.
                      //
                      // **닫는 것은 「취소」와 같다**(`reset`) — 그 칸의 내용을 지운다.
                      // 남기면 다음에 열었을 때 지운 줄 알았던 문안이 되살아난다.
                      if (모드 === b.id) { reset(); return }
                      // 초안만 연다. 여기서 발사·저장하지 않는다.
                      // **이미 쓰던 내용이 있으면 그대로 되살린다**(`모드고르기`).
                      모드고르기(b.id)
                      setSaid(b.이름)
                    }}
                    aria-pressed={모드 === b.id}
                    data-tour={'chip-' + b.id}
                    /* **고른 것이 눈에 보여야 한다**(2026-09-14). 카드가 열려도 단추 넷은
                       계속 떠 있으므로, 지금 어느 카드를 보고 있는지 단추가 말해야 한다.
                       색만으로 말하지 않는다 — `aria-pressed` 가 보조기술에 같은 사실을
                       전하고, 테두리를 굵혀 색각 차이를 넘는다(G-7). */
                    className={'min-h-[44px] rounded-full border px-2 tablet:px-3.5 text-[13px] font-semibold whitespace-nowrap '
                      + 'transition-colors hover:bg-ds-v3-surface-2 '
                      + (모드 === b.id ? 'border-2 bg-ds-v3-surface-2 ' : '')
                      // 채운 단추는 테두리도 굵고 그림자가 옅게 받친다 — 색을 못 가리는
                      // 사람에게도 「이것이 먼저 누르는 것」이 보여야 한다.
                      + (주단추 ? 'border-2 shadow-[0_1px_5px_rgba(37,99,235,0.16)] ' : '')
                      + (색 === 'tts'  ? 'border-ds-v3-tts-line text-ds-v3-tts'
                      :  색 === 'bgm'  ? 'border-ds-v3-bgm-line text-ds-v3-bgm'
                      :  색 === 'flow' ? 'border-ds-v3-flow-line text-ds-v3-flow'
                      :                  'border-ds-v3-line-2 text-ds-v3-ink-2')}>
                    {b.이름}
                  </button>
                )
              })}
                  </div>
                </div>
              ))}

              {/* 차임벨은 **어느 묶음에도 안 넣는다** — 카드를 여는 단추가 아니라 설정을
                  펴는 단추라 성격이 다르다(아래 주석). 묶음 뒤에 따로 서고, **제 선을
                  긋는다** — 안 그으면 바로 앞의 「나중에」에 붙어 보여서 *"차임벨도 예약되는
                  것"* 으로 읽힌다(실측: 「예약 방송」 바로 옆에 붙었다). */}
              <div className="grid w-full grid-cols-1 gap-1.5 border-t border-ds-v3-line-2 pt-2 pl-[54px]
                              tablet:ml-1 tablet:flex tablet:w-auto tablet:border-t-0 tablet:border-l
                              tablet:border-ds-v3-line-2 tablet:pt-0 tablet:pl-3">
              {/* ── 다섯째 자리는 **카드가 아니라 설정**이다 (사용자 지시 2026-09-14) ────
                  *"차임벨을 다섯 번째 방송 카드나 독립 실행 모드로 만들지 마라."*
                  그래서 이 단추는 **모드를 안 바꾼다** — 지금 보고 있는 카드도, 적던 문안도
                  그대로 두고 아래에 작은 패널만 편다. 색도 유형 셋(파랑·자주·보라)을 안 쓴다.
                  그 셋은 **무엇이 나가는가**의 색이고, 이건 **어떻게 나가는가**라서다. */}
              <button type="button" data-tour="chip-chime"
                onClick={() => set차임설정(v => !v)}
                aria-pressed={차임설정}
                aria-expanded={차임설정}
                /* **좁은 화면에서는 제 줄을 통째로 쓴다.** 2×2 격자에 다섯째로 들어가면
                   혼자 왼쪽에 남아 짝을 잃은 것처럼 보인다(390px 실측). 한 줄을 다 쓰면
                   균형도 맞고, **역할이 다르다는 것**도 자리로 말한다 — 위 넷은 카드를 열고
                   이것은 설정을 편다. 넓은 화면에서는 예전처럼 줄 끝에 붙는다. */
                className={'min-h-[44px] rounded-full border px-3.5 text-[13px] font-semibold '
                  + 'transition-colors hover:bg-ds-v3-surface-2 border-ds-v3-line-2 text-ds-v3-ink-2 '
                  + (차임설정 ? 'border-2 bg-ds-v3-surface-2 ' : '')}>
                차임벨
              </button>
              </div>
            </div>
          )}
          {/* ── 차임 **발사** 패널 (사용자 결정 2026-09-15) ────────────────────────
              **09-14 지시를 뒤집은 자리다.** 그때는 *"차임벨을 다섯 번째 방송 카드나 독립
              실행 모드로 만들지 마라 — 설정 패널만"* 이었는데, 09-15 에 사용자가 바꿨다:
              *"진짜 소리나는 시작차임, 종료차임 이걸로 소리나가는걸로 바꿨으면 좋겠고"*.
              켬/끔 설정은 **「지금 방송」 카드와 「누르고 말하기」 쪽으로 옮겼다** — 같은 지시다.

              **누르면 전관 스피커로 나간다. 되돌릴 수 없다.** 그래서 연타를 막는다
              (`차임보내는중`) — 페르소나 P3「두 번 누르는 시설장」이 이 자리의 임자다.
              사용자가 「한 번 더 묻기」가 아니라 **바로 발사**를 골랐으므로 확인 창은 없다. */}
          {차임설정 && (
            <div className="mt-2 flex flex-col items-center gap-1.5" data-tour="chime-panel">
              <div className="flex w-full max-w-[360px] gap-2">
                <차임발사 종류="general" 보내는중={차임보내는중} onFire={차임내보내기}>시작 차임</차임발사>
                <차임발사 종류="end"     보내는중={차임보내는중} onFire={차임내보내기}>종료 차임</차임발사>
              </div>
              {차임오류 && <p className="m-0 text-[12px] font-semibold text-ds-v3-bgm">{차임오류}</p>}
              {/* ── **무슨 일이 일어나는지 먼저 말한다** ────────────────────────────
                  앞 판은 *"지금 소리가 나지는 않습니다"* 였다. **이제 정반대다** —
                  누르면 그 자리에서 나간다. 이 한 줄이 틀리면 사람이 모르고 누른다.
                  켬/끔 설정이 어디로 갔는지도 함께 말한다(찾으러 다니게 두지 않는다). */}
              <p className="m-0 max-w-[360px] text-center text-[12px] leading-[1.5] text-ds-v3-ink-3">
                <b className="font-semibold text-ds-v3-ink-2">누르면 지금 바로 나갑니다.</b>
                <br />
                방송에 차임을 붙일지는 「지금 방송」·「누르고 말하기」에서 켜고 끕니다.
              </p>
            </div>
          )}
          </>
        ) : (

        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Wand2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-v3-tts pointer-events-none" />
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder="말하듯이 입력 — 예: 매일 오후 3시에 산책 안내"
              className="w-full border border-ds-v3-line rounded-btn pl-9 pr-3 py-2 text-sm text-ds-v3-ink
                         focus:outline-none focus:border-ds-v3-tts placeholder:text-ds-v3-ink-2"
            />
          </div>
          <button
            onClick={run}
            disabled={!text.trim() || loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-tts hover:bg-ds-v3-tts text-white
                       text-sm font-semibold rounded-btn btn-press transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <CornerDownLeft size={14} />
            {loading ? '읽는 중...' : '만들기'}
          </button>
        </div>
        )}

        {/* 읽는 중 — 통합 홈에서는 단추에 글자가 없으므로 이 줄이 유일한 표시다.
            아무 표시도 없으면 사람이 단추를 다시 누른다(P3 페르소나). */}
        {v3 && loading && <p className="mt-2 text-center text-[13px] text-ds-v3-ink-2">문장을 읽는 중…</p>}

        {error && <p className={S.err + ' mt-1.5'}>{error}</p>}

        {/* 방금 추가한 예약 되돌리기 — 확인 카드가 떠 있는 동안에는 숨긴다(무엇을 취소하는지 헷갈림) */}
        {justAdded && !draft && (
          // **손이 닿으면 멈춘다.** 마우스를 올리거나 안쪽 단추에 초점이 가면 게이지가
          // 그 자리에 선다 — 「취소」를 누르러 가는 중에 띠가 닫히면 그것이 사고다.
          // 손을 떼면 **남은 시간부터** 이어서 간다(처음부터 다시 세지 않는다).
          <div
            onMouseEnter={() => set멈춤(true)}
            onMouseLeave={() => set멈춤(false)}
            onFocusCapture={() => set멈춤(true)}
            onBlurCapture={() => set멈춤(false)}
            className={'relative mt-2 flex items-center gap-2 overflow-hidden px-3 py-2 '
            + (v3 ? 'rounded-[12px] border border-ds-v3-line-2 bg-white/85 backdrop-blur-[6px]'
                  : 'bg-ds-v3-bg border border-ds-v3-line rounded-btn')}>
            {/* 게이지 — 띠 **아래 모서리**를 따라 줄어든다. 글자를 가리지 않고, 색은
                「취소」와 같은 계열(자주)이라 무엇이 끝나 가는지가 색으로도 이어진다.
                장식이 아니라 남은 시간을 말하므로 화면 낭독기에는 진행률로 알린다.
                **`/70` 같은 투명도 수식어를 쓰지 않는다.** 이 토큰들은 `var()` 색이라
                Tailwind v3 에서 투명도가 안 먹고 **오류 없이 조용히 투명해진다** —
                처음에 `bg-ds-v3-bgm/70` 으로 뒀다가 화면에서 게이지가 안 보였다(2026-09-13,
                `bg-ds-v3-ink/30` 으로 덮개가 사라졌던 것과 같은 함정). 불투명 토큰을 쓴다. */}
            <span
              role="progressbar"
              aria-label="되돌릴 수 있는 시간"
              aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(게이지 * 100)}
              className={'pointer-events-none absolute bottom-0 left-0 h-[3px] '
                + (v3 ? 'bg-ds-v3-bgm' : 'bg-ds-v3-warn')}
              style={{ width: `${게이지 * 100}%` }}
            />
            <CalendarClock size={v3 ? 15 : 13} className={'flex-shrink-0 ' + (v3 ? 'text-ds-v3-ink-3' : 'text-ds-v3-ink-2')} />
            <span className={'truncate ' + (v3 ? 't-sub text-ds-v3-ink' : 'text-xs text-ds-v3-ink')}>
              <strong className="font-semibold">{justAdded.title}</strong> 예약을 추가했습니다.
            </span>
            <button
              onClick={handleCancelJustAdded}
              disabled={cancelling}
              className={'ml-auto flex flex-shrink-0 items-center gap-1 font-semibold transition-colors '
                + 'disabled:opacity-50 btn-press '
                + (v3 ? 'min-h-[34px] rounded-full border border-ds-v3-bgm-line px-3 text-[13px] '
                      + 'text-ds-v3-bgm hover:bg-ds-v3-bgm-bg'
                      : 'px-2 py-1 text-xs text-ds-v3-warn border border-ds-v3-warn/30 rounded-btn hover:bg-ds-v3-warn-bg')}
            >
              <Undo2 size={12} />
              {cancelling ? '취소 중...' : '취소'}
            </button>
            {/* **치우는 길과 지우는 길을 가른다.** 이 ✕ 는 알림만 닫는다 — 예약은 그대로 있다.
                옆의 「취소」와 헷갈리면 안 되므로 글자를 안 쓰고, 색도 안 준다(중성 회색).
                15초면 저절로 사라지지만, 그 전에 눈에 거슬리는 사람이 치울 길이 있어야 한다. */}
            <button
              type="button"
              onClick={() => { setJustAdded(null); setCancelError('') }}
              aria-label="이 알림 닫기 (예약은 그대로 둡니다)"
              title="알림만 닫습니다 — 예약은 그대로 있습니다"
              className={'flex flex-shrink-0 items-center justify-center rounded-full transition-colors '
                + (v3 ? 'min-h-[34px] min-w-[34px] text-ds-v3-ink-3 hover:bg-ds-v3-surface-2 hover:text-ds-v3-ink'
                      : 'min-h-[28px] min-w-[28px] text-ds-v3-ink-2 hover:text-ds-v3-ink')}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {cancelError && <p className={S.err + ' mt-1.5'}>{cancelError}</p>}

        {firedMsg && !draft && (
          <p className={'mt-1.5 ' + (v3 ? 'text-center text-[13px] font-semibold text-ds-v3-tts' : 'text-xs text-ds-v3-tts')}>
            {firedMsg}
          </p>
        )}

        {/* ── 예시 알약 셋을 **뺐다** (사용자 지시 2026-09-14) ────────────────────
            「매일 오후 3시에 산책 안내」 같은 단추 셋이 검색창 바로 밑에 서 있었다. 예시를
            보여 주는 일은 필요하지만 **자리를 차지하는 방식**이 문제였다 — 단추가 한 줄을
            잡아먹어 「오늘 일과방송」이 그만큼 밀려 내려갔고, 모바일에서는 두 줄이 됐다.
            **화면에서만 가리고 빈 자리를 남기지 않는다** — 블록을 통째로 없앤다.
            예시는 이제 **입력창 안 빈 상태 안내**가 혼자 맡는다(placeholder 가 돌아간다).
            그쪽은 글자를 치는 순간 사라지므로 자리를 안 먹는다. */}

        {/* 파싱 결과 확인 카드 — "이렇게 예약할까요?" 하나만 확인하면 바로 저장된다 */}
        {draft && !advanced && (
          <div data-tour="card" className={S.card + ' space-y-2.5 ' + (v3 ? (CARD_TINT[kind] || 'border-ds-v3-line-2') : '')}>
            <div className={v3 ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-1.5'}>
              {v3 && kind ? (
                /* 무슨 갈래인지 색으로 한 번, 글자로 한 번. 색만으로는 색각 차이를 못 넘는다 */
                <span className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold '
                  + PILL_TINT[kind]}>
                  <i className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
                  {KIND_LABEL[kind]}
                </span>
              ) : (
                <CalendarClock size={13} className={v3 ? 'text-ds-v3-ink-2' : 'text-ds-v3-tts'} />
              )}
              <span className={v3 ? 'text-sm font-semibold text-ds-v3-ink' : 'text-xs font-semibold text-ds-v3-ink'}>
                {draft.immediate ? '지금 바로 방송할까요?' : '이렇게 예약할까요?'}
              </span>
              <span className={'ml-auto rounded-full border '
                + (v3 ? 'border-ds-v3-line bg-ds-v3-surface px-2.5 py-1 text-[13px] text-ds-v3-ink-2'
                      : 'text-[10px] text-ds-v3-ink-2 bg-white border-ds-v3-line px-1.5 py-0.5')}>
                {draft.immediate ? '지금 즉시' : formatRepeatLabel(draft)}
              </span>
              {/* **저장 중에는 안 닫힌다** — 아래 "취소"와 같은 규칙이다(V③ 검수 2026-09-13 지적).
                  `reset()` 은 draft 를 지우지만 **날아간 요청은 못 되돌린다.** 저장이 실패하면
                  그 사유(`saveError`)는 draft 안에서만 그려지므로, 먼저 닫아 버리면
                  **예약이 안 만들어졌는데 사람은 아무 말도 못 듣는다.** 이 저장소에서 가장
                  비싼 실패의 모양이다. */}
              {v3 && (
                <button type="button" onClick={reset} disabled={saving}
                  aria-label="초안 닫기"
                  title={saving ? '저장이 끝난 뒤에 닫을 수 있습니다' : '초안 닫기'}
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full
                             text-ds-v3-ink-3 transition-colors hover:bg-ds-v3-surface-2 hover:text-ds-v3-ink
                             disabled:opacity-40 disabled:hover:bg-transparent">
                  <X size={16} />
                </button>
              )}
            </div>

            {/* 적은 문장을 그대로 되비친다 — 파서가 잘못 읽었을 때 대조할 것이 있어야 한다 */}
            {v3 && said && <p className="m-0 text-[13px] text-ds-v3-ink-3">“{said}”</p>}

            {/* 무엇이 읽었나. 규칙이 읽은 것을 AI 가 읽은 것으로 오해하면 사람이 실제보다
                더 믿는다 — 그 반대도 마찬가지다. AI 가 붙는 것은 규칙이 못 읽었을 때뿐이다. */}
            {via === 'api' && (
              <p className={v3 ? 'text-[13px] text-ds-v3-ink-2' : 'text-[11px] text-ds-v3-ink-2'}>
                규칙이 시각을 못 읽어 <span className="font-normal">AI 가 읽었습니다.</span> 날짜·시각을 확인해 주세요.
                {viaReason && <span className="ml-1">({viaReason})</span>}
              </p>
            )}

            {/* 확인이 필요한 항목 — 체크하기 전에는 "예약 확정"이 눌리지 않는다.
                애매한 채로 만들어진 예약은 현장에서 원인을 찾기가 가장 어렵다. */}
            {notes.length > 0 && (
              <div className={S.noteBox + ' space-y-1'}>
                {notes.map(n => <p key={n} className={S.note}>⚠ {n}</p>)}
                <label className="flex cursor-pointer select-none items-center gap-1.5 pt-0.5">
                  <input
                    type="checkbox"
                    checked={acked}
                    onChange={e => {
                      setAcked(e.target.checked); setSaveError('')
                      // 체크한 사실도 **그 칸에** 적는다 — 안 그러면 카드를 바꿨다 오면
                      // 다시 체크해야 한다. 안전한 쪽이긴 하나 사람을 괴롭힌다.
                      if (모드) 확인들Ref.current = { ...확인들Ref.current,
                        [모드]: { notes, acked: e.target.checked } }
                    }}
                    className={S.accent}
                  />
                  <span className={'font-semibold ' + (v3 ? 'text-[13px] text-ds-v3-ink' : 'text-[11px] text-ds-v3-ink')}>
                    확인했습니다
                  </span>
                </label>
              </div>
            )}

            {/* 즉시 방송은 날짜·시간을 고칠 게 없다 — 입력을 남겨두면 "고치면 예약이 되나?"로
                읽혀서 헷갈린다. 시각을 정하고 싶으면 문장에 말하면 되고, 그러면 예약 카드가 뜬다. */}
            {!draft.immediate && (
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="날짜"
                value={draft.repeat_start_date || ''}
                onChange={e => setDraft(d => ({ ...d, repeat_start_date: e.target.value }))}
                className={'flex-1 ' + S.field + ' ' + S.line}
              />
              <input
                type="time"
                aria-label="시각"
                value={draft.scheduled_time || ''}
                onChange={e => setDraft(d => ({ ...d, scheduled_time: e.target.value }))}
                className={'flex-1 ' + S.field + ' ' + S.line}
              />
            </div>
            )}
            {/* ── **즉시 방송에는 제목·유형을 안 보여준다** (사용자 지시 2026-09-15) ────────
                *"즉시방송은 제목이나 토글 붙이지말고 TTS 기준으로 방송내용만 크게 해주면
                  안될까? 제목이나 방송유형은 선택할 필요없잖아."* — 맞다.
                **지금 한 번 나가고 끝나는 방송**이라 제목은 이력에만 남고, 유형은
                이 카드에서 늘 TTS 다(다른 유형은 「배경음악」·「순서」 카드가 따로 있다).
                고를 필요가 없는 것을 보여 주면 **골라야 하는 것처럼 보인다.**

                **지우지는 않는다** — 「자세히 수정」에서 그대로 만질 수 있다(사용자 선택 A).
                거기서 BGM·음원으로 바꾸는 길이 살아 있어야 한다.
                제목은 비워 두면 저장할 때 기본값이 들어간다(아래 `저장` 의 규칙 그대로).

                **예약 카드는 그대로다.** 예약은 나중에 목록에서 다시 찾아야 하므로
                제목이 이름표 노릇을 하고, 유형도 미리 정해 두는 값이다. */}
            {/* **제목이 비어 있으면 즉시 방송이라도 보여 준다.** 확정은 제목을 요구하므로
                (`handleConfirm`), 감춘 채 비어 있으면 **고칠 수 없는 막다른 길**이 된다.
                카드로 연 초안은 늘 이름이 채워지지만, 검색으로 들어온 초안은 아닐 수 있다. */}
            {(!draft.immediate || !draft.title?.trim()) && (
              <input
                type="text"
                aria-label="제목"
                value={draft.title || ''}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="제목"
                className={'w-full ' + S.field + ' ' + S.line}
              />
            )}

            {/* 방송 유형 — 파서(ontology.js)가 문장에서 읽어 채운다. 잘못 읽으면 엉뚱한 게
                나가거나 아무 소리도 안 나므로, 추측을 숨기지 않고 여기서 보이고 고치게 한다.
                **즉시 방송에서는 감춘다**(위 문단) — 다만 파서가 **헷갈렸다고 말한 경우**
                (`notes` 에 유형 관련 안내가 있을 때)는 즉시 방송에서도 보여 준다.
                그때는 고를 필요가 **있는** 것이라, 감추면 조용한 오독이 된다. */}
            {(!draft.immediate || (notes.length > 0 && !acked)) && (
            <div className="flex items-center gap-2">
              <span className={'flex-shrink-0 ' + S.label}>방송 유형</span>
              <select
                value={draft.broadcast_type || 'text'}
                onChange={e => setDraft(d => ({ ...d, broadcast_type: e.target.value }))}
                className={'flex-1 focus:outline-none ' + S.field + ' '
                  + (notes.length > 0 && !acked ? S.warn : S.line)}
              >
                {/* 숨긴 유형은 안 내놓는다 — 이미 그 값이면 남긴다. */}
                {고를수있는유형(draft.broadcast_type).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            )}

            {/* 이 예약에만 적용되는 BGM 볼륨. 값이 없으면(대부분) 시스템 기본값을 쓰므로
                아예 보여주지 않는다 — 문장으로 지시했을 때만 눈에 보이게 한다. */}
            {draft.main_volume != null && (
              <div className="flex items-center gap-2">
                <span className={'flex-shrink-0 ' + S.label}>안내 음성</span>
                <input
                  type="range"
                  aria-label="안내 음성 볼륨"
                  min="0" max="100"
                  value={draft.main_volume}
                  onChange={e => setDraft(d => ({ ...d, main_volume: Number(e.target.value) }))}
                  className={'flex-1 ' + S.accent}
                />
                <span className={'nums w-10 text-right font-semibold '
                  + (v3 ? 'text-sm text-ds-v3-ink' : 'text-xs text-ds-v3-ink')}>{draft.main_volume}%</span>
                <button
                  onClick={() => setDraft(d => ({ ...d, main_volume: null }))}
                  className={'flex-shrink-0 transition-colors ' + S.link}
                  title="시스템 기본값을 그대로 쓴다"
                >
                  기본값
                </button>
              </div>
            )}

            {draft.bgm_volume != null && (
              <div className="flex items-center gap-2">
                <span className={'flex-shrink-0 ' + S.label}>BGM 볼륨</span>
                <input
                  type="range"
                  aria-label="BGM 볼륨"
                  min="0" max="100"
                  value={draft.bgm_volume}
                  onChange={e => setDraft(d => ({ ...d, bgm_volume: Number(e.target.value) }))}
                  className={'flex-1 ' + S.accent}
                />
                <span className={'nums w-10 text-right font-semibold '
                  + (v3 ? 'text-sm text-ds-v3-ink' : 'text-xs text-ds-v3-ink')}>{draft.bgm_volume}%</span>
                <button
                  onClick={() => setDraft(d => ({ ...d, bgm_volume: null }))}
                  className={'flex-shrink-0 transition-colors ' + S.link}
                  title="시스템 기본값을 그대로 쓴다"
                >
                  기본값
                </button>
              </div>
            )}

            {/* ── **유형에 맞는 것이 이 자리에 온다** (사용자 지적 2026-09-13) ─────────────
                *"순서, 흐름, 자동 할 때 왜 저거 안내방송으로 TTS 로 읽히냐 …
                흐름에 맞는게 아래 네모박스로 내려와야지"*

                그전에는 이 자리에 **TTS 내용칸 하나뿐**이었다. 유형을 「흐름」으로 바꾸면
                아래가 통째로 비어서, **어느 흐름인지 고를 방법이 없었다** — 「자세히 수정」을
                눌러 다른 창으로 가야 했다. 음원·영상도 같았다(그래서 저 위의
                `needs_audio_file` 안내가 "자세히 수정에서 선택해 주세요" 라고 말한다).
                AI 승인 화면(`easy/TTSBroadcast.jsx`)에는 이미 있던 것이라 **같은 모양**으로 둔다. */}
            {유형이흐름 && (
              <div className="flex items-center gap-2">
                <span className={'flex-shrink-0 ' + S.label}>사용할 흐름</span>
                <select
                  value={draft.flow_sequence_id || ''}
                  onChange={e => setDraft(d => ({ ...d, flow_sequence_id: e.target.value ? Number(e.target.value) : null }))}
                  className={'flex-1 focus:outline-none ' + S.field + ' '
                    + (draft.flow_sequence_id ? S.line : S.warn)}
                >
                  <option value="">골라 주세요</option>
                  {flows.map(fl => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
                </select>
              </div>
            )}
            {/* ── **여기서 만든다** (사용자 지적 2026-09-14) ────────────────────────────
                *"순서는 순서 흐름만들기가 핵심인데, 지금 나오는거로는 순서하기가 힘들잖아,
                  그래서 사진처럼 아예 입력창에서 순서를 만들 수 있게 해주면 어떨까?"*

                그전에는 이 자리가 *"「자동순서」 화면에서 먼저 만들어 주세요"* 한 줄이었다 —
                **막다른 길**이다. 순서를 쓰려고 여기까지 왔는데 다른 화면으로 보내고,
                거기서 만들고 돌아오면 치던 문장이 사라져 있다.

                `FlowEditorModal` 은 이미 **인라인 모드**를 갖고 있었다(`인라인`) — 창을 안
                띄우고 그 자리에 편다. 새로 만들지 않고 그것을 쓴다. 만드는 화면이 두 벌이
                되면 한쪽만 고쳐지는 날이 온다.

                저장하면 **방금 만든 것이 곧바로 골라진다** — 목록에서 다시 찾게 하지 않는다.
                같은 규칙이 `ScheduleModal.handleFlowCreated` 에도 있다. */}
            {유형이흐름 && (
              <div className="space-y-2">
                {flows.length === 0 && !흐름만들기 && (
                  <p className={S.err}>아직 만들어 둔 순서가 없습니다 — 아래에서 바로 만들 수 있습니다.</p>
                )}
                {!흐름만들기 ? (
                  <button type="button"
                    onClick={() => set흐름만들기(true)}
                    data-tour="card-newflow"
                    className={'flex items-center gap-1 ' + S.link}>
                    <PenLine size={v3 ? 13 : 11} /> 여기서 새 순서 만들기
                  </button>
                ) : (
                  <div className={v3
                    ? 'rounded-[12px] border border-ds-v3-flow-line bg-ds-v3-flow-bg p-3'
                    : 'rounded-btn border border-ds-v3-line bg-white p-2.5'}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={'font-semibold ' + S.label}>새 순서 만들기</span>
                      <button type="button" onClick={() => set흐름만들기(false)}
                        className={S.link}>접기</button>
                    </div>
                    <FlowEditorModal
                      flowId={null}
                      인라인
                      onClose={() => set흐름만들기(false)}
                      onSaved={handleFlowCreated}
                    />
                  </div>
                )}
              </div>
            )}

            {유형이파일 && (
              <div className="flex items-center gap-2">
                <span className={'flex-shrink-0 ' + S.label}>재생할 파일</span>
                <select
                  value={draft.audio_file_id || ''}
                  onChange={e => setDraft(d => ({ ...d, audio_file_id: e.target.value ? Number(e.target.value) : null }))}
                  className={'flex-1 focus:outline-none ' + S.field + ' '
                    + (draft.audio_file_id ? S.line : S.warn)}
                >
                  <option value="">골라 주세요</option>
                  {파일후보.map(f => <option key={f.id} value={f.id}>{f.original_name}</option>)}
                </select>
              </div>
            )}
            {유형이파일 && 파일후보.length === 0 && (
              <p className={S.err}>이 유형으로 쓸 수 있는 파일이 없습니다 — 「업로드」 화면에서 먼저 올려 주세요.</p>
            )}

            {/* 읽을 문구가 있는 TTS 방송에만 내용이 필요하다 (차임벨·BGM 등은 없음) */}
            {(draft.broadcast_type || 'text') === 'text' && (
              <div className="space-y-1.5">
                <textarea
                  aria-label="방송 내용"
                  value={draft.content || ''}
                  onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                  /* **즉시 방송에서는 이 칸이 이 카드의 전부다** (사용자 지시 2026-09-15).
                     제목·유형을 감췄으니 남는 자리를 여기에 준다 — 적는 곳이 크면
                     적기도 쉽고, 무엇을 하는 카드인지도 한눈에 보인다.
                     예약은 위아래로 고칠 칸이 더 있어 예전 높이를 지킨다. */
                  rows={draft.immediate ? 6 : (v3 ? 3 : 2)}
                  placeholder="방송 내용"
                  /* ── **즉시 방송의 글씨를 1.5배로** (사용자 지시 2026-09-15) ──────────
                     *"지금방송에서 입력되는 창에 글씨가 너무 작아 1.5배 정도 더 키워"*
                     16px(`text-base`) → **24px**. 이 칸은 방송으로 나갈 문장을 적는
                     자리이고, 적는 사람이 노안인 경우가 많다(사용자 진술).
                     **줄 간격을 함께 내린다**(1.7 → 1.45) — 글씨만 키우면 줄 사이가
                     그만큼 벌어져 6줄이 카드 밖으로 밀린다. */
                  className={'w-full resize-none transition-colors focus:outline-none '
                    + S.field + ' ' + S.line
                    + (draft.immediate ? ' text-[24px] leading-[1.45]' : (v3 ? ' leading-[1.7]' : ''))}
                />
                {/* ── AI 로 문구 다듬기 (사용자 지적 2026-09-13: *"AI 방송문구 수정 어디갔어"*)
                    이 일은 옛 쉬운 화면의 「AI 도움받기」 카드에만 있었고, 통합 홈으로 옮겨
                    오면서 **따라오지 않았다.** 절차는 `lib/aiBroadcastText.js` 한 벌이라
                    두 화면의 말투·폴백 순서가 갈리지 않는다.
                    **덮어쓰기 전에 보여 주지 않는다** — 이 칸이 곧 결과이고, 마음에 안 들면
                    그 자리에서 고치면 된다(원문은 아래 「되돌리기」로 돌아온다). */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* ── **단추여야 한다** (사용자 지적 2026-09-14: *"AI 도움받기는 왜 없어졌냐?"*)
                      없어진 적이 없다. **작은 글자 링크라 못 찾은 것**이다 — 바로 아래
                      「BGM 재생」 같은 체크박스 줄과 생김새가 같아서, 눈이 그것을
                      체크박스로 읽고 지나쳤다. 옛 쉬운 화면에서는 **주황 채움 단추**였다.
                      이름도 그때 것으로 되돌린다 — 사람이 외운 이름이 「AI 도움받기」다.

                      **주황은 이 화면에서 넷째 색이다.** v3 팔레트는 셋(말 파랑·음악 자주·
                      순서 보라)이고 그 셋은 **방송 유형**의 색이다. 이것은 유형이 아니라
                      **내 글을 고치는 행동**이라 유형 색을 쓰면 오히려 뜻이 섞인다.
                      사용자 결정으로 예외를 두고, `ai-help-button.test.js` 가 **이 한 자리
                      말고 다른 데로 번지지 않는지**를 지킨다(구멍으로 지나가지 않는다). */}
                  <button type="button"
                    onClick={async () => {
                      const 씨앗 = (draft.content || draft.title || '').trim()
                      if (!씨앗) { setAi오류('무엇을 방송할지 먼저 적어 주세요.'); return }
                      // **보낼 때의 자리를 적어 둔다** — 모드 · 그때의 글 · 몇 번째 요청인지.
                      const 표식 = ++ai표식Ref.current
                      const 보낸모드 = 모드
                      const 보낸글 = draft.content || ''
                      set짓는중(true); setAi오류(''); set지은이(null)
                      try {
                        const r = await 방송문구짓기(씨앗, 로컬AI허용)
                        // **지금 값을 본다** — 클로저의 `모드`·`draft` 는 누른 순간 값이라
                        // 그것끼리 비교하면 언제나 같다(아무것도 못 막는다).
                        const 지금 = 지금Ref.current
                        // **카드를 바꿨으면 여기 쓰지 않는다.** 지금 보고 있는 칸은 다른 칸이다.
                        // 표식 검사보다 **앞**에 둔다 — 카드를 바꾸면 표식도 함께 올라가므로,
                        // 뒤에 두면 먼저 걸려서 **왜 안 썼는지 말할 기회가 사라진다.**
                        if (보낸모드 !== 지금.모드) {
                          setAi오류(`다른 카드로 옮기셔서 「${보낸모드 === 'tts' ? '지금 방송' : '앞 카드'}」의 AI 결과는 버렸습니다.`)
                          return
                        }
                        // **더 새 요청이 있으면 이건 헌 것이다.** 조용히 버린다 — 사람은
                        // 더 새 요청의 결과를 기다리고 있고, 그쪽이 곧 답한다.
                        if (표식 !== ai표식Ref.current) return
                        // **기다리는 동안 사람이 더 쳤으면 그 글이 우선이다.** 덮지 않는다.
                        if ((지금.초안들[보낸모드]?.content || '') !== 보낸글) {
                          setAi오류('그 사이에 문구를 고치셔서 AI 결과를 덮지 않았습니다. 다시 누르면 지금 글로 만들어 드립니다.')
                          return
                        }
                        set이전문구(보낸글)
                        setDraft(d => ({ ...d, content: r.text }))
                        set지은이(지은이문구(r.via, r.reason))
                      } catch (e) {
                        if (표식 !== ai표식Ref.current) return
                        setAi오류(e.message || 'AI 가 문구를 못 만들었습니다.')
                      }
                      finally { if (표식 === ai표식Ref.current) set짓는중(false) }
                    }}
                    disabled={짓는중}
                    className={'flex items-center gap-1.5 rounded-full font-semibold text-white '
                      + 'bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 transition-colors disabled:opacity-50 '
                      + (v3 ? 'min-h-[44px] px-4 text-sm' : 'min-h-[44px] px-3 text-xs')}>
                    <Wand2 size={v3 ? 14 : 12} /> {짓는중 ? 'AI 가 쓰는 중…' : 'AI 도움받기'}
                  </button>
                  {이전문구 !== null && (
                    <button type="button"
                      onClick={() => { setDraft(d => ({ ...d, content: 이전문구 })); set이전문구(null); set지은이(null) }}
                      className={'flex items-center gap-1 ' + S.link}>
                      <Undo2 size={v3 ? 13 : 11} /> 원래대로
                    </button>
                  )}
                </div>
                {지은이 && (
                  <p className={지은이.강조 ? S.note : S.label}>{지은이.글}</p>
                )}
                {ai오류 && <p className={S.err}>{ai오류}</p>}
              </div>
            )}

            {/* ── BGM 과 반복 — **여기서 정할 수 있어야 한다** (사용자 결정 2026-09-13) ────
                *"이 간단 입력화면에서는 bgm설정이랑 반복 넣어주면 되고"*
                그전에는 둘 다 「자세히 수정」으로 들어가야 했다. 예약 하나가 내는 소리는
                대개 둘(안내 + 반주)인데, 간편 화면에서 반주를 못 정하니 매번 큰 창으로 갔다.

                **기본은 꺼짐이다.** 켜 두면 말로 만든 모든 예약에 반주가 깔린다 — 안내방송
                하나 넣으려던 사람이 음악까지 내보내게 된다. 켜는 순간 세부값은 「시스템
                기본값 사용」으로 시작하므로, 켜기만 하면 더 정할 것이 없다.
                차임벨은 여기 없다 — **BGM 이 있으면 차임은 서버가 건너뛴다**(사용자 결정).  */}
            <div className="space-y-2">
              {/* ── 배경음악 방송에는 이 물음이 없다 (사용자 지시 2026-09-14) ──────────
                  이 토글은 *"이 방송 **앞에** 반주를 깔까"* 를 묻는다. 그런데 배경음악
                  방송은 **그 자체가 반주**다 — 음악 앞에 음악을 깔지 묻는 꼴이 된다.
                  안내 음성·음원·영상 예약에서는 그대로 묻는다(그 물음이 성립한다).

                  **안 묻는 것이지 지우는 것이 아니다.** 이미 저장된 `bgm_enabled` 는
                  건드리지 않는다 — 화면이 물음을 감춘다고 값을 0 으로 되돌리면, 배경음악
                  카드를 한 번 열었다 닫은 것만으로 남의 설정이 사라진다. 이 저장소가
                  볼륨에서 세운 원칙과 같다(되돌릴 상태를 만들지 않는다). */}
              {/* **순서(flow)에서도 안 묻는다** (사용자 결정 2026-09-15) — 서버가
                  흐름 갈래에서 이 값을 안 읽는다. 규칙은 `scheduleUtils` 한 곳이다. */}
              {BGM물음이있나(draft.broadcast_type) && (
              <label data-tour="card-bgm" className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={!!draft.bgm_enabled}
                  onChange={e => setDraft(d => ({
                    ...d,
                    bgm_enabled: e.target.checked ? 1 : 0,
                    // **갈래만 정하고 검색어는 비워 둔다.** 여기에 장르 낱말을 적으면
                    // 유형 사전이 화면에도 생긴다 — 사전은 `server/domain/ontology.js`
                    // 한 곳이다(`home-ask-tone.test.js` 가 그것을 문다). 비워 두면 서버의
                    // `resolveBGM` 이 제 기본값으로 간다.
                    ...(e.target.checked && !d.bgm_type ? { bgm_type: BGM_DEFAULT_TYPE } : {}),
                  }))}
                  className="w-4 h-4 accent-ds-v3-tts" />
                <span className={S.label}>BGM 재생</span>
              </label>
              )}

              {/* ── **배경음악 카드에도 고를 것이 있어야 한다** (사용자 지적 2026-09-15) ──
                  *"배경음악 토글 눌렀을 때 저렇게 바로 방송되는 게 아니라, 따로 붙임
                    (당시) 외부 음악 카드처럼 저런 게 들어와야 되지 않냐."*

                  앞 판은 **`bgm` 유형일 때 이 고르개를 통째로 숨겼다.** 그래서 「배경음악」
                  카드에는 고를 것이 하나도 없었고, 「지금 방송」을 누르면 **무엇이 나갈지
                  모른 채** 서버 기본값이 나갔다.

                  숨긴 이유 자체는 맞았다 — `bgm` 유형은 **BGM 이 곧 방송**이라 「BGM 재생」
                  체크박스가 뜻이 없다(서버가 `bgm_enabled: 1` 로 강제한다,
                  `scheduler.js` 의 `broadcastType === 'bgm'` 갈래). 그런데 **체크박스와
                  고르개를 같이 숨긴 것**이 지나쳤다. 서버는 `bgm` 유형일 때도 **같은
                  `bgm_type`·`bgm_value`** 를 읽는다(`resolveBGM`).

                  그래서 **체크박스만 숨기고 고르개는 보인다.** 이때는 체크박스에 딸린 것이
                  아니므로 들여쓰기(`pl-6`)도 걷는다. */}
              {((draft.broadcast_type || 'text') === 'bgm'
                || (!!draft.bgm_enabled && BGM물음이있나(draft.broadcast_type))) && (
                <div className={(draft.broadcast_type || 'text') === 'bgm' ? 'space-y-2' : 'pl-6 space-y-2'}>
                  <BgmSourcePicker
                    value={draft.bgm_type || BGM_DEFAULT_TYPE}
                    onChange={(t) => setDraft(d => ({ ...d, bgm_type: t }))}
                    rowClass="flex gap-1.5 flex-wrap"
                    labelClass={S.label}
                    chipClass={(고름) => (v3
                      ? `px-3 py-1.5 rounded-full t-sub font-semibold transition-colors ${
                        고름 ? 'bg-ds-v3-bgm text-white' : 'bg-ds-v3-surface-2 text-ds-v3-ink-2 hover:bg-white'}`
                      : `px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                        고름 ? 'bg-ds-v3-tts text-white' : 'bg-white text-ds-v3-ink-2 border border-ds-v3-line'}`)}
                  />

                  {/* ── **얼마나 틀지 · 언제 먼저 틀지** (사용자 지적 2026-09-15) ────────
                      *"배경음악이나 지금방송에서 bgm 시작 0초 먼저, 재생시간 0초
                        이거 조절할 수 있게 해줘야 하는 거 아니야?"*

                      순서 편집기에는 있던 칸이 여기엔 없었다. **묻는 것이 유형마다 다르다:**

                      · 배경음악만 틀 때(`bgm`)   — 물을 것은 「얼마나」뿐이다.
                        앞에 나올 안내가 없으니 「몇 초 먼저」가 뜻이 없다.
                      · 안내에 반주를 깔 때       — 물을 것은 「몇 초 먼저」다.
                        얼마나 트는지는 **안내가 끝나는 때**가 정한다.

                      **0 의 뜻을 글자로 적는다** — 숫자 칸의 0 은 「없음」인지 「무제한」인지
                      모양이 같아서, 안 적으면 사람이 그것을 빈칸으로 읽는다. */}
                  {(draft.broadcast_type || 'text') === 'bgm' ? (
                    /* ── **배경음악은 분으로 센다** (사용자 지시 2026-09-15) ──────────
                       *"배경음악은 최소 단위를 분으로 해야 하지 않겠냐."* 맞다.
                       반주로 까는 음악을 **초 단위로 정할 일이 없다** — 「30분쯤」이
                       사람이 생각하는 단위다. 초 칸을 두면 자릿수만 늘어난다.
                       서버에는 초로 보낸다(× 60) — 그쪽 계약은 초다. */
                    <label className="flex items-center gap-2 flex-wrap">
                      <span className={S.label}>재생 시간</span>
                      <input type="number" min={0} max={240} step={5}
                        value={Math.round((draft.duration_sec ?? 0) / 60)}
                        onChange={e => setDraft(d => ({
                          ...d, duration_sec: Math.max(0, Number(e.target.value) || 0) * 60,
                        }))}
                        aria-label="배경음악 재생 시간(분)"
                        className={'w-20 text-center nums focus:outline-none ' + S.field + ' ' + S.line} />
                      <span className={S.label}>분 &nbsp;— 0 이면 정지를 누를 때까지 계속</span>
                    </label>
                  ) : (
                    /* ── **시작과 끝을 둘 다 묻는다** (사용자 지적 2026-09-15) ────────
                       *"bgm은 시작 종료 있어야지."* 맞다. 「자세히」 모달에는 두 칸이
                       다 있는데 여기엔 앞 칸만 뒀다 — 그러면 **안내가 끝나는 순간
                       음악이 뚝 끊긴다.** 그 어색함을 없애려고 뒤 칸이 생긴 것이다
                       (UX-17). 같은 물음이 화면마다 다르면 안 된다. */
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 flex-wrap">
                        <span className={S.label}>안내보다</span>
                        <input type="number" min={0} max={60} step={1}
                          value={draft.bgm_delay ?? 5}
                          onChange={e => setDraft(d => ({ ...d, bgm_delay: Math.max(0, Number(e.target.value) || 0) }))}
                          aria-label="안내 전에 배경음악을 먼저 트는 시간(초)"
                          className={'w-20 text-center nums focus:outline-none ' + S.field + ' ' + S.line} />
                        <span className={S.label}>초 먼저 &nbsp;— 0 이면 안내와 동시에</span>
                      </label>
                      <label className="flex items-center gap-2 flex-wrap">
                        <span className={S.label}>안내가 끝나고</span>
                        <input type="number" min={0} max={300} step={5}
                          value={draft.bgm_end_delay ?? 0}
                          onChange={e => setDraft(d => ({ ...d, bgm_end_delay: Math.max(0, Number(e.target.value) || 0) }))}
                          aria-label="안내가 끝난 뒤 배경음악을 더 트는 시간(초)"
                          className={'w-20 text-center nums focus:outline-none ' + S.field + ' ' + S.line} />
                        <span className={S.label}>초 더 &nbsp;— 0 이면 안내와 함께 끝</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* 반복은 **읽을 문구가 있을 때만** 뜻이 있다 — 차임벨·BGM 을 두 번 트는 것이 아니다 */}
              {(draft.broadcast_type || 'text') === 'text' && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={!!draft.repeat_broadcast}
                    onChange={e => setDraft(d => ({ ...d, repeat_broadcast: e.target.checked ? 1 : 0 }))}
                    className="w-4 h-4 accent-ds-v3-tts" />
                  <span className={S.label}>
                    방송 2회 반복 <span className="opacity-70">— 「다시 한번 알려드립니다」 뒤에 한 번 더</span>
                  </span>
                </label>
              )}

              {/* ── 차임 켬/끔은 **이 방송이 나가는 자리**에 둔다 (사용자 결정 2026-09-15) ──
                  *"지금방송/누르고 말하기 에 시작 차임 ON/OFF 종료차임 ON/OFF 로 좀
                  직관적으로 보여줬으면"*. 예전에는 검색창 밑 「차임벨」 패널에 있었는데,
                  그 자리는 이제 **발사 단추**가 됐다.

                  **즉시 방송일 때만 보여준다.** 이 값은 `ttsBroadcast` 에 실려 나가는데,
                  예약 경로(`createSchedule`)에는 **`schedules` 표에 차임 칸이 없어서**
                  붙을 자리가 없다. 안 붙는 자리에 토글을 두면 *"적용되는 것처럼 표시"* 하는
                  것이고, 그건 사용자가 못 하게 한 일이다(2026-09-14 지시).

                  값은 `useChimeToggles` 한 곳에서 온다 — 간편모음 서랍의 같은 토글과
                  자동으로 같은 값을 본다. 각자 들고 있으면 서랍에서 끈 차임이 여기서는
                  켬으로 보이고, 사람이 껐다고 믿는 차임이 그대로 울린다. */}
              {(draft.broadcast_type || 'text') === 'text' && !!draft.immediate && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    {/* 빠짐 판정은 보내는 쪽(`chimeStart: d.bgm_enabled ? false : chime`)과 **같은 조건**이다 */}
                    <차임옵션 on={chime} onChange={setChime} 빠짐={!!draft.bgm_enabled}>{draft.bgm_enabled ? '시작 차임' : `시작 차임 ${chime ? 'ON' : 'OFF'}`}</차임옵션>
                    <차임옵션 on={endChime} onChange={setEndChime} 빠짐={!!draft.bgm_enabled}>{draft.bgm_enabled ? '종료 차임' : `종료 차임 ${endChime ? 'ON' : 'OFF'}`}</차임옵션>
                  </div>
                  <p className={'m-0 ' + S.label + (draft.bgm_enabled ? ' font-semibold text-ds-v3-bgm' : ' opacity-70')}>
                    {draft.bgm_enabled
                      ? '배경음악이 함께 나오는 방송이라 차임은 빠져요. 차임 설정은 그대로예요.'
                      : '이 방송 앞뒤에 차임을 붙입니다. 「누르고 말하기」에도 같이 적용됩니다.'}
                  </p>
                </div>
              )}
            </div>

            {saveError && <p className={S.err}>{saveError}</p>}

            <div className="flex items-center gap-2">
              {/* ── **확인 게이트를 우회하는 길이었다** (V③ R6 지적, 2026-09-14) ────────
                  「예약 확정」은 `notes.length > 0 && !acked` 면 막는다. 그런데 이 단추는
                  **무조건 열렸고**, 모달의 저장은 확인 여부를 **안 본다**
                  (`ScheduleModal.handleSave` → `createSchedule`). 그래서 애매하게 읽힌
                  예약을 **확인 없이** 저장하는 길이 남아 있었다 — 확정 버튼만 잠근 셈이다.
                  *"사람의 명시적 확정 없이 자동 저장하지 않는다"* 가 이 저장소의 규칙이다.
                  **막되 막다른 길로 만들지 않는다** — 왜 못 여는지 같은 자리에 말한다.
                  확인 항목은 「무엇으로 읽었는지」를 묻는 것이라, 먼저 확인한 뒤 세부를
                  고치는 순서가 사람에게도 자연스럽다. */}
              <button
                onClick={() => {
                  if (notes.length > 0 && !acked) {
                    setSaveError('확인이 필요한 항목을 보고 "확인했습니다"에 체크해 주세요.')
                    return
                  }
                  setAdvanced(true)
                }}
                aria-disabled={notes.length > 0 && !acked}
                data-tour="card-more"
                className={'flex items-center gap-1 transition-colors ' + S.link
                  + (notes.length > 0 && !acked ? ' opacity-50' : '')}
              >
                <PenLine size={v3 ? 13 : 11} /> 자세히 수정(BGM·음원 등)
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={reset}
                  disabled={saving}
                  className={S.secondary + ' btn-press transition-colors disabled:opacity-50'}
                >
                  취소
                </button>
                <button
                  onClick={handleConfirm}
                  data-tour="card-go"
                  // **고르지 않은 채로는 못 저장한다.** 흐름 id 나 파일 id 가 비면 그 시각에
                  // 조용히 아무 소리도 안 난다 — 서버도 막지만, 여기서 먼저 막아야 사람이
                  // 무엇이 빠졌는지 그 자리에서 본다(위 고르개가 경고 테두리로 서 있다).
                  disabled={saving || (notes.length > 0 && !acked)
                    || (유형이흐름 && !draft.flow_sequence_id)
                    || (유형이파일 && !draft.audio_file_id)}
                  title={notes.length > 0 && !acked ? '확인이 필요한 항목을 먼저 확인해 주세요' : undefined}
                  className={S.primary + ' btn-press transition-colors disabled:opacity-50'}
                >
                  {saving ? (draft.immediate ? '방송 중...' : '저장 중...') : (draft.immediate ? '지금 방송' : '예약 확정')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {draft && advanced && (
        <ScheduleModal
          schedule={draft}
          notes={notes}
          onClose={() => setAdvanced(false)}
          /* **즉시 안내는 저장 전에 이리로 온다** — 예약 행을 안 만든다(B-3).
             모달이 `createSchedule` 을 부르기 **전에** 갈라진다. */
          onImmediate={async (form) => {
            const title = form?.title
            await 지금내보내기(form)
            setAdvanced(false)
            reset()
            setFiredMsg(`"${title}" 방송을 지금 내보냈습니다.`)
            onAdded?.()
          }}
          /* **여기는 이제 예약만 다룬다.** 「지금 당장」은 위 `onImmediate` 가 저장 **전에**
             가져간다(B-3). 예전에는 이 자리에서 저장된 행을 받아 발사까지 했는데, 그러면
             **예약 행이 남아** 다시 나가는 길이 열리고 차임·음량·반복·BGM 도 안 붙었다. */
          onSave={async () => {
            reset()
            onAdded?.()
          }}
        />
      )}
    </>
  )
}
