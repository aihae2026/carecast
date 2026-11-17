import { useState, useEffect, useRef } from 'react'
import { Type, Volume2, Radio, Bot, Wand2, CalendarClock, ChevronDown, ChevronUp, CheckSquare, Square, X, Pause } from 'lucide-react'
import { ttsPreview, ttsBroadcast, getTTSSettings, getAIProvider,
         parseScheduleDraft, approveScheduleDraft, rejectScheduleDraft,
         getAudioFiles, getFlows, triggerSchedule,
         getLocalAiEnabled } from '../../lib/api'
import { warmupLocal } from '../../lib/localModel'
import { 방송문구짓기 } from '../../lib/aiBroadcastText'
import { 고를수있는유형, filesForBroadcastType, NEEDS_AUDIO_FILE } from '../../lib/scheduleUtils'
import { audioBus } from '../../lib/audioBus'
import HelpTip from '../shared/HelpTip'

// 재생할 파일을 골라야 소리가 나는 유형 — QuickSchedulePhrase·server/domain/ontology와 같은 목록.
// 파일 없이 저장되면 그 시각에 조용히 아무 소리도 안 난다.

// AI 초안 되묻기(B4) — 파서가 확신하지 못한 항목을 사람이 알아볼 수 있게 풀어 쓴다.
// 하나라도 있으면 "확인했습니다"를 체크해야 확정할 수 있다(QuickSchedulePhrase와 같은 게이트).
// 문구를 만드는 함수인 이유: type_differs·overlaps_auto는 이름을 대고 물어야 판단할 수 있다.
function buildDraftNotes(ambiguous = [], { overlaps = [], ruleType = null, draft = {} } = {}) {
  return ambiguous.map(key => {
    if (key === 'time_past_moved') return '말씀하신 시각이 이미 지나서 날짜를 내일로 옮겼습니다 — 맞나요?'
    if (key === 'overlaps_auto') {
      const names = overlaps.map(o => `${o.label}(${o.time})`).join(', ')
      return `${names}과 시각이 겹칩니다 — 두 방송이 같이 나가면 소리가 섞입니다. 그대로 둘까요?`
    }
    if (key === 'type_differs') {
      return `문장을 "${ruleType?.label || '다른 유형'}"으로도 읽을 수 있습니다 — 아래 방송 유형이 맞는지 확인해 주세요.`
    }
    if (key === 'volume_set') {
      const v = draft.main_volume ?? draft.bgm_volume
      return `이 방송의 볼륨만 ${v}%로 둡니다 — 시스템 기본값은 그대로입니다. 맞나요?`
    }
    if (key === 'repeat_unsupported') {
      return '반복 표현이 있지만 이 경로는 1회 예약만 만듭니다 — 매일 반복하려면 예약 화면의 "말하듯이 입력"을 써 주세요.'
    }
    return null
  }).filter(Boolean)
}

const VOICE_LABELS = {
  'ko-KR-SunHiNeural':  '여성 — SunHi',
  'ko-KR-InJoonNeural': '남성 — InJoon',
}

// ── 차임벨·종료음은 **설정에서 정한다** (사용자 결정 2026-09-13) ────────────────
// *"시작음 종료음 이것도 설정으로 둘까? 설정에?"* — 그렇게 했다.
// 그전에는 `localStorage` 라 **PC·브라우저마다 값이 갈렸다**: 현장 PC 에서 끈 것이
// 직원 폰에서는 켜져 있고, 어느 쪽이 맞는지 아무도 모른다. 이 저장소가 볼륨에서
// 똑같이 다쳤다(CLAUDE.md 볼륨 규칙).
// 이제 서버 설정(`tts_chime_start`·`tts_chime_end`)을 읽는다. 기본값은 둘 다 켜짐 —
// 지금까지와 같다. 고치는 자리는 **설정 → 음량 및 TTS** 한 곳이다.

// 카드: TTS 방송 + 내장 AI 도움받기 패널
export default function TTSBroadcast() {
  // TTS 상태
  const [text,         setText]         = useState('')
  const [voiceLabel,   setVoiceLabel]   = useState('불러오는 중...')
  const [previewing,   setPreviewing]   = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [repeat,       setRepeat]       = useState(false)
  const [error,        setError]        = useState('')
  // 서버가 정본이다. 못 읽으면 켜진 것으로 본다 — 차임은 «방송이 나갑니다» 신호라,
  // 모를 때 안 울리는 쪽보다 울리는 쪽이 안전하다(무음이 이 시스템의 가장 비싼 실패다).
  const [chimeStart,   setChimeStart]   = useState(true)
  const [chimeEnd,     setChimeEnd]     = useState(true)

  // AI 패널 상태
  const [aiOpen,     setAiOpen]     = useState(false)
  const [aiInput,    setAiInput]    = useState('')
  const [aiResult,   setAiResult]   = useState('')
  const [aiProvider, setAiProvider] = useState('gemini')   // 외부 AI 는 Gemini 하나 — 불러오기 전에 「Claude」로 보이지 않게
  const [generating, setGenerating] = useState(false)
  const [reviewed,   setReviewed]   = useState(false)
  const [aiError,    setAiError]    = useState('')
  // 어느 단계가 문장을 만들었나. 화면이 따로 짓지 않고 서버·로컬이 준 값을 그대로 쓴다 —
  // 화면이 다시 지으면 같은 사건이 두 가지 말로 보인다(경보에서 겪었다).
  const [aiVia,       setAiVia]       = useState('')
  const [aiViaReason, setAiViaReason] = useState('')
  const [draftVia,       setDraftVia]       = useState('')
  const [draftViaReason, setDraftViaReason] = useState('')
  // 로컬 AI **허용** 스위치(서버 설정). "가능"은 브라우저 진단이 따로 본다 — 둘 다 참이어야 1차가 돈다.
  const [localAiAllowed, setLocalAiAllowed] = useState(false)

  // 예약 초안 상태 — "8월 28일 오후 두시에 ... 예약해줘" 같은 문장을 AI가 날짜/시간/내용으로
  // 뽑아낸 것. 여기서 "예약 확정"을 누르기 전까지는 서버 schedules 테이블에 아무것도 안 생긴다.
  const [draft,        setDraft]        = useState(null)   // { id, title, content, scheduled_time, repeat_start_date }
  const [draftBusy,    setDraftBusy]    = useState(false)
  const [draftError,   setDraftError]   = useState('')
  const [draftMsg,     setDraftMsg]     = useState('')
  const [audioFiles,   setAudioFiles]   = useState([])   // 승인 화면 파일 선택기(B3)
  const [flows,        setFlows]        = useState([])   // 승인 화면 흐름 선택기(B3)
  const [draftNotes,   setDraftNotes]   = useState([])   // 되묻기 목록(B4)
  const [draftAcked,   setDraftAcked]   = useState(false) // 되묻기 확인 여부(B4)
  const [draftImmediate, setDraftImmediate] = useState(false) // "지금 당장" 즉시 방송 요청

  useEffect(() => {
    getTTSSettings()
      .then(d => {
        setVoiceLabel(VOICE_LABELS[d.voiceNormal] || d.voiceNormal)
        if (d.chimeStart !== undefined) setChimeStart(!!d.chimeStart)
        if (d.chimeEnd   !== undefined) setChimeEnd(!!d.chimeEnd)
      })
      .catch(() => setVoiceLabel('여성 — SunHi (기본)'))
    getAIProvider()
      .then(d => setAiProvider(d.provider))
      .catch(() => {})
    // 못 읽으면 꺼진 것으로 본다 — 사람이 승인한 적 없는데 로컬이 도는 쪽이 나쁘다
    getLocalAiEnabled()
      .then(d => setLocalAiAllowed(!!d?.enabled))
      .catch(() => setLocalAiAllowed(false))
  }, [])

  const previewAudioRef = useRef(null)
  const previewBusRef   = useRef(null)   // [audioBus] TTS 미리듣기 장부 등록 손잡이

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
    }
    // [audioBus] 미리듣기 정지 — 장부 해제
    previewBusRef.current?.done(); previewBusRef.current = null
    setPreviewing(false)
  }

  const handlePreview = async () => {
    if (previewing) { stopPreview(); return }
    if (!text.trim()) return
    setPreviewing(true); setError('')
    try {
      const blob  = await ttsPreview({ text })
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      previewAudioRef.current = audio
      // [audioBus] TTS 미리듣기 등록 — 자연 종료는 addEventListener로 해제(onended를 안 건드린다)
      previewBusRef.current?.done()
      // stop을 함께 넘긴다 — 실제 방송이 시작되면 장부가 이 손잡이로 미리듣기를 비키게 한다(td09 H9)
      previewBusRef.current = audioBus.register({
        kind: 'preview-tts', label: 'TTS 미리듣기', stop: () => stopPreview(),
      })
      audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
      audio.play()
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewing(false); previewAudioRef.current = null }
    }
    catch (e) { setError(e.message); setPreviewing(false) }
  }

  // **화면을 떠나면 이 화면의 미리듣기를 끊는다(2026-09-02, td09 H4).**
  // 미리듣기는 누른 창에서만 나는 소리라 아무도 안 꺼주면 탭을 옮겨도 계속 난다 —
  // 사람은 소리가 어디서 나는지 못 찾는다. **자기 것만 끈다**: 전역 정지 신호도,
  // 장부의 stopKinds도 여기서 부르지 않는다(그러면 다른 화면 미리듣기까지 죽는다).
  useEffect(() => () => { stopPreview() }, [])

  const handleBroadcast = async () => {
    if (!text.trim()) return
    setBroadcasting(true); setError('')
    const t = text.trim()
    const finalText = repeat ? `${t} 다시 한번 알려드립니다. ${t}` : t
    try { await ttsBroadcast({ text: finalText, target: '전체', chimeStart, chimeEnd }) }
    catch (e) { setError(e.message) }
    finally { setBroadcasting(false) }
  }

  // AI 패널 — 방송문을 생성해서 보여주기만 한다. 예전엔 여기서 바로 TTS 입력창에 채워넣고
  // 패널을 닫아버려서, 밑에 있는 "검토 완료" 체크 UI가 렌더링될 기회 자체가 없었다(죽은 코드).
  // 이제는 결과만 보여주고 사람이 검토 체크 후 handleApply()를 눌러야 TTS 창에 반영된다.
  // 3단 폴백의 1차는 **브라우저**가 맡는다(2026-09-06). 크롬 내장 모델은 서버에 없다.
  //   1차 로컬(여기) → 안 되면 서버로 → 2차 API → 3차 템플릿(server/services/llmGateway.js)
  // **전환은 조용하다** — 1차가 안 됐다고 사람에게 묻지 않는다. 대신 어느 단계가 썼는지
  // 배지로 밝힌다. "LLM 이 쓴 것처럼 보이는 템플릿 문장"이 제일 나쁘다.
  const handleGenerate = async () => {
    if (!aiInput.trim()) return
    setGenerating(true); setAiError(''); setReviewed(false); setDraft(null); setDraftError('')
    setAiVia(''); setAiViaReason('')
    const t0 = Date.now()
    try {
      // **절차는 `lib/aiBroadcastText.js` 한 곳에 있다**(2026-09-13). 통합 홈의 확인 카드도
      // 같은 것을 부른다 — 여기 다시 적으면 두 화면의 말투·폴백 순서가 갈린다.
      const r = await 방송문구짓기(aiInput.trim(), localAiAllowed)
      setAiResult(r.text)
      setAiVia(r.via)
      if (r.reason) setAiViaReason(r.reason)
      if (r.provider) setAiProvider(r.provider)
      console.log(`[LLM] 문구생성 — ${r.viaLabel || r.via}(${Date.now() - t0}ms)`)
    } catch (e) { setAiError(e.message) }
    finally { setGenerating(false) }
  }

  // AI 결과를 TTS 입력창에 채워넣기 후 패널 닫기 (사람이 "검토 완료" 체크한 뒤에만 호출됨)
  const handleApply = () => {
    if (!aiResult) return
    setText(aiResult)
    setAiOpen(false)
    setAiInput('')
    setAiResult('')
    setReviewed(false)
  }

  // "8월 28일 오후 두시에 ... 예약해줘" → 날짜/시간/내용을 AI가 뽑아 초안만 만든다.
  // 여기서는 schedules에 아무것도 안 생기고, 아래 초안 카드에서 "예약 확정"을 눌러야 생긴다.
  // 승인 화면의 파일·흐름 선택지 — 유형이 그것들을 요구할 때만 불러온다
  const draftType = draft?.broadcast_type || 'text'
  const draftNeedsFile = NEEDS_AUDIO_FILE.includes(draftType)
  const draftNeedsFlow = draftType === 'flow'
  const fileOptions = filesForBroadcastType(audioFiles, draftType)

  useEffect(() => {
    if (draftNeedsFile && audioFiles.length === 0) getAudioFiles().then(setAudioFiles).catch(() => {})
    if (draftNeedsFlow && flows.length === 0) getFlows().then(d => setFlows(d.items || [])).catch(() => {})
  }, [draftNeedsFile, draftNeedsFlow, audioFiles.length, flows.length])

  const handleParseSchedule = async () => {
    if (!aiInput.trim()) return
    setDraftBusy(true); setDraftError(''); setDraftMsg(''); setAiError(''); setAiResult('')
    setDraftVia(''); setDraftViaReason(''); setAiVia('')
    try {
      const data = await parseScheduleDraft(aiInput.trim())
      setDraft(data.draft)
      // 어느 단계가 읽었는지는 **서버가 지은 이름을 그대로** 쓴다. 화면이 다시 지으면 갈린다.
      setDraftVia(data.via || '')
      setDraftViaReason(data.via_reason || '')
      console.log(`[LLM] 자연어파싱 — ${data.via_label || data.via || '?'}`
        + (data.via_reason ? ` (${data.via_reason})` : ''))
      setDraftNotes(buildDraftNotes(data.ambiguous, {
        overlaps: data.overlaps, ruleType: data.rule_type, draft: data.draft,
      }))
      setDraftAcked(false)
      setDraftImmediate(!!data.immediate)
      setAiInput('')
    } catch (e) { setDraftError(e.message) }
    finally { setDraftBusy(false) }
  }

  const handleApproveDraft = async () => {
    if (!draft) return
    // 되묻은 항목이 있으면 사람이 확인했다고 표시해야 확정한다 — 애매한 채로 만들어진
    // 예약은 현장에서 원인을 찾기 가장 어렵다(QuickSchedulePhrase와 같은 규칙).
    if (draftNotes.length > 0 && !draftAcked) {
      setDraftError('확인이 필요한 항목을 보고 "확인했습니다"에 체크해 주세요.')
      return
    }
    setDraftBusy(true); setDraftError('')
    try {
      const result = await approveScheduleDraft(draft.id, {
        title: draft.title, content: draft.content,
        scheduled_time: draft.scheduled_time, repeat_start_date: draft.repeat_start_date,
        broadcast_type: draft.broadcast_type || 'text',
        // 사람이 승인 화면에서 고른 파일·흐름. 서버가 유형과 대조해 없으면 거부한다.
        audio_file_id:    draft.audio_file_id ?? null,
        flow_sequence_id: draft.flow_sequence_id ?? null,
        main_volume: draft.main_volume ?? null,
        bgm_volume:  draft.bgm_volume  ?? null,
      })
      if (draftImmediate && result?.scheduleId) {
        // 즉시 방송 — 승인으로 만들어진 예약을 그 자리에서 발사한다. 1회성이라 발사 후
        // 자동 비활성화되므로 스케줄러가 같은 분에 다시 쏘지 않는다.
        await triggerSchedule(result.scheduleId)
        setDraftMsg('방송을 지금 내보냈습니다.')
      } else {
        setDraftMsg(`예약이 확정됐습니다 — ${draft.repeat_start_date} ${draft.scheduled_time}`)
      }
      setDraft(null)
      setDraftNotes([]); setDraftAcked(false); setDraftImmediate(false)
    } catch (e) { setDraftError(e.message) }
    finally { setDraftBusy(false) }
  }

  const handleRejectDraft = async () => {
    if (!draft) return
    setDraftBusy(true); setDraftError('')
    try { await rejectScheduleDraft(draft.id); setDraft(null); setDraftNotes([]); setDraftAcked(false) }
    catch (e) { setDraftError(e.message) }
    finally { setDraftBusy(false) }
  }

  return (
    <div className="easy-card bg-ds-v3-tts-bg">
      <div className="flex items-center gap-2 mb-3">
        <Type size={15} className="text-ds-v3-tts" />
        <h3 className="text-xs font-semibold text-ds-v3-ink-2 uppercase tracking-widest">TTS 방송</h3>
        <HelpTip id="ttsBroadcast" />
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="방송할 내용을 입력하세요..."
        rows={6}
        className="flex-1 w-full bg-white border border-ds-v3-line rounded-btn px-4 py-3 text-base
                   text-ds-v3-ink placeholder:text-ds-v3-ink-2 resize-none
                   focus:outline-none focus:border-ds-v3-tts transition-colors mb-3"
      />

      {error && <p className="text-xs text-ds-v3-warn mb-2 line-clamp-2">{error}</p>}

      {/* 반복 방송 + 차임벨/종료음 체크 */}
      <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1.5 text-xs text-ds-v3-ink-2 mb-2">
        <label className="flex items-center gap-1.5 cursor-pointer select-none group">
          <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)}
            className="w-3.5 h-3.5 accent-ds-v3-tts cursor-pointer" />
          <span className={`transition-colors ${repeat ? 'text-ds-v3-tts font-semibold' : 'text-ds-v3-ink-2 group-hover:text-ds-v3-ink'}`}>
            반복 방송
          </span>
          {repeat && <span className="text-xs text-ds-v3-ink-2">("다시 한번 알려드립니다." 후 재방송)</span>}
        </label>
        {/* **여기서는 보여 주기만 한다.** 고치는 자리는 설정 한 곳이다 — 방송을 내보내는
            화면에서 매번 바꾸게 두면 «지난번에 껐던가» 를 사람이 기억해야 한다.
            지금 값이 무엇인지는 보여야 한다. 안 보이면 차임이 안 울린 것이 설정인지
            고장인지 모른다(이 저장소가 무음에서 가장 많이 다쳤다). */}
        <div className="flex items-center gap-2 t-sub text-ds-v3-ink-2">
          <span>시작음 {chimeStart ? '켬' : '끔'} · 종료음 {chimeEnd ? '켬' : '끔'}</span>
          <span className="text-ds-v3-ink-2/70">— 설정 → 음량 및 TTS 에서 바꿉니다</span>
        </div>
      </div>

      <div className="flex justify-between items-center text-xs text-ds-v3-ink-2 mb-3">
        <span>음성: {voiceLabel}</span>
        <div className="flex items-center gap-2">
          <span className="nums">{text.length} / 500자</span>
          {/* AI 도움받기 토글 버튼 (주황색) */}
          <button
            onClick={() => {
              const 열림 = !aiOpen
              setAiOpen(열림)
              // 패널을 여는 순간 모델을 메모리에 올려 둔다 — 사람이 상황을 타자하는 동안
              // 끝나므로 첫 호출의 기다림이 사라진다. 실패해도 조용하다(준비일 뿐이다).
              if (열림) warmupLocal(localAiAllowed).then((r) => {
                if (r?.ms) console.log(`[LLM] 로컬 데우기 ${r.ok ? '완료' : '실패'}(${r.ms}ms)` + (r.reason ? ` — ${r.reason}` : ''))
              })
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn text-sm font-semibold btn-press transition-colors
              ${aiOpen
                ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border border-ds-v3-line'
                : 'bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 text-white border border-transparent'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
          >
            <Bot size={11} />
            AI 도움받기
            {aiOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        </div>
      </div>

      {/* AI 도움받기 패널 (토글) */}
      {aiOpen && (
        <div className="bg-white border border-ds-v3-line rounded-[12px] p-3 mb-3 space-y-2.5">
          {/* 패널 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Bot size={13} className="text-ds-v3-ink-2" />
              <span className="text-xs font-semibold text-ds-v3-ink">AI 방송문 생성</span>
              <span className={`text-xs font-semibold ${aiProvider === 'claude' ? 'text-ds-v3-flow' : 'text-ds-v3-tts'}`}>
                · {aiProvider === 'claude' ? 'Claude' : 'Gemini'}
              </span>
            </div>
            <button onClick={() => setAiOpen(false)} className="text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
              <X size={13} />
            </button>
          </div>

          {/* 키워드 입력 */}
          <textarea
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            placeholder="핵심 내용만 입력 (예: 점심 12시 된장찌개) — 날짜·시간까지 말하면 예약도 가능 (예: 8월 28일 오후 2시에 프로그램 안내 방송)"
            rows={2}
            className="w-full bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 text-xs
                       text-ds-v3-ink placeholder:text-ds-v3-ink-2 resize-none
                       focus:outline-none focus:border-ds-v3-ink-2 transition-colors"
          />

          {/* 생성 버튼 — 지금 바로 방송할 문구 vs 날짜·시간 지정해서 예약 초안 */}
          <div className="flex gap-1.5">
            <button
              onClick={handleGenerate}
              disabled={generating || draftBusy || !aiInput.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2
                         disabled:opacity-50 text-white rounded-btn py-2 text-sm font-semibold btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
            >
              {generating ? (
                <><span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />생성 중...</>
              ) : (
                <><Wand2 size={12} />방송문 만들기</>
              )}
            </button>
            <button
              onClick={handleParseSchedule}
              disabled={generating || draftBusy || !aiInput.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-ds-v3-tts hover:bg-ds-v3-tts
                         disabled:opacity-50 text-white rounded-btn py-2 text-sm font-semibold btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
            >
              {draftBusy ? (
                <><span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />분석 중...</>
              ) : (
                <><CalendarClock size={12} />예약 만들기</>
              )}
            </button>
          </div>

          {/* 생성 결과 */}
          {aiResult && (
            <>
              {/* 어느 단계가 만들었나. **템플릿은 눈에 띄어야 한다** — LLM 없이 나온
                  문장임을 사람이 알고 고쳐야 한다. 로컬·API 는 조용한 회색으로 둔다. */}
              {aiVia && (
                <p className={`text-xs ${aiVia === 'template' ? 'text-ds-v3-ink-2 font-semibold' : 'text-ds-v3-ink-2'}`}>
                  {aiVia === 'template'
                    ? 'AI 없이 정해진 틀로 만들었습니다 — 내용을 확인하고 고쳐 주세요.'
                    : `${aiVia === 'local' ? '이 PC 안의 AI' : '외부 AI'}가 만들었습니다.`}
                  {aiViaReason && <span className="ml-1 font-normal text-ds-v3-ink-2">({aiViaReason})</span>}
                </p>
              )}
              <textarea
                value={aiResult}
                onChange={e => { setAiResult(e.target.value); setReviewed(false) }}
                rows={3}
                className="w-full bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 text-xs
                           text-ds-v3-ink resize-none focus:outline-none focus:border-ds-v3-ink-2 transition-colors"
              />
              {/* 검토 체크 + TTS에 채워넣기 */}
              <div className="flex items-center flex-wrap gap-2">
                <button
                  onClick={() => setReviewed(v => !v)}
                  className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
                >
                  {reviewed
                    ? <CheckSquare size={13} className="text-ds-v3-ink-2" />
                    : <Square size={13} />}
                  검토 완료
                </button>
                <button
                  onClick={handleApply}
                  disabled={!reviewed}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-ds-v3-tts hover:bg-ds-v3-tts
                             disabled:opacity-40 text-white rounded-btn text-sm font-semibold btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
                >
                  TTS에 채워넣기
                </button>
              </div>
            </>
          )}

          {aiError && <p className="text-xs text-ds-v3-warn">{aiError}</p>}

          {/* 예약 초안 검토 카드 — "예약 확정"을 누르기 전까지는 서버 어디에도 실제 예약이 생기지 않는다 */}
          {draft && (
            <div className="bg-ds-v3-tts-bg border border-ds-v3-tts-line rounded-[12px] p-3 space-y-2">
              {/* 무엇이 이 문장을 읽었나. **AI 가 아니라 규칙으로 읽은 것을 AI 로 오해하면
                  사람은 실제보다 더 믿는다.** 규칙 파서 결과는 눈에 띄게 밝힌다. */}
              {draftVia && (
                <p className={`text-xs ${draftVia === 'rule' || draftVia === 'template' ? 'text-ds-v3-ink-2 font-semibold' : 'text-ds-v3-ink-2'}`}>
                  {draftVia === 'rule' || draftVia === 'template'
                    ? '정해진 규칙으로 읽었습니다 — 날짜·시각이 맞는지 꼭 확인해 주세요.'
                    : `${draftVia === 'local' ? '이 PC 안의 AI' : '외부 AI'}가 읽었습니다.`}
                  {draftViaReason && <span className="ml-1 font-normal text-ds-v3-ink-2">({draftViaReason})</span>}
                </p>
              )}
              {/* 되묻기(B4) — 체크 전에는 "예약 확정"이 눌리지 않는다 */}
              {draftNotes.length > 0 && (
                <div className="bg-white/70 border border-ds-v3-ink-2/40 rounded-[10px] p-2 space-y-1">
                  {draftNotes.map(n => <p key={n} className="text-xs text-ds-v3-ink-2">⚠ {n}</p>)}
                  <label className="flex items-center gap-1.5 pt-0.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={draftAcked}
                      onChange={e => { setDraftAcked(e.target.checked); setDraftError('') }}
                      className="accent-ds-v3-tts"
                    />
                    <span className="text-xs font-semibold text-ds-v3-ink">확인했습니다</span>
                  </label>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <CalendarClock size={13} className="text-ds-v3-tts" />
                <span className="text-xs font-semibold text-ds-v3-ink">{draftImmediate ? '지금 바로 방송할까요?' : '예약 초안 — 확인 후 확정해주세요'}</span>
              </div>
              {/* 즉시 방송은 날짜·시간을 고칠 게 없다 — 입력을 남기면 "고치면 예약이 되나?"로 읽힌다 */}
              {!draftImmediate && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={draft.repeat_start_date || ''}
                  onChange={e => setDraft(d => ({ ...d, repeat_start_date: e.target.value }))}
                  className="flex-1 bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs text-ds-v3-ink"
                />
                <input
                  type="time"
                  value={draft.scheduled_time || ''}
                  onChange={e => setDraft(d => ({ ...d, scheduled_time: e.target.value }))}
                  className="flex-1 bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs text-ds-v3-ink"
                />
              </div>
              )}
              <input
                type="text"
                value={draft.title || ''}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="제목"
                className="w-full bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs text-ds-v3-ink"
              />
              {/* 방송 유형 — AI가 문장에서 읽은 값이다. 안 보이면 "차임벨만 울리는 예약"이
                  빈 내용으로 보여서 사람이 무엇을 승인하는지 알 수 없다(검토 게이트 무력화).
                  AI 경로는 파일·흐름 선택기가 없어 TTS/차임벨/BGM만 만들어진다. */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-ds-v3-ink-2 flex-shrink-0">방송 유형</span>
                <select
                  value={draft.broadcast_type || 'text'}
                  onChange={e => setDraft(d => ({
                    // 유형을 바꾸면 이전 유형에서 고른 파일·흐름은 버린다 —
                    // 남겨두면 "영상용 파일이 실린 음원 예약" 같은 게 만들어진다
                    ...d, broadcast_type: e.target.value, audio_file_id: null, flow_sequence_id: null,
                  }))}
                  className="flex-1 bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs
                             text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts"
                >
                  {/* 숨긴 유형은 안 내놓는다 — 이미 그 값이면 남긴다. */}
                  {고를수있는유형(draft.broadcast_type).map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* 파일·흐름 선택기 — 예전엔 이게 없어서 AI 경로가 TTS·차임벨·BGM만 만들 수 있었다.
                  파일 없이 저장되면 그 시각에 조용히 아무 소리도 안 난다. */}
              {draftNeedsFile && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ds-v3-ink-2 flex-shrink-0">재생할 파일</span>
                  <select
                    value={draft.audio_file_id || ''}
                    onChange={e => setDraft(d => ({ ...d, audio_file_id: e.target.value ? Number(e.target.value) : null }))}
                    className="flex-1 bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs
                               text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts"
                  >
                    <option value="">선택해 주세요</option>
                    {fileOptions.map(f => (
                      <option key={f.id} value={f.id}>{f.original_name}</option>
                    ))}
                  </select>
                </div>
              )}
              {draftNeedsFile && fileOptions.length === 0 && (
                <p className="text-xs text-ds-v3-ink-2">
                  이 유형으로 쓸 수 있는 파일이 없습니다 — 관리자 화면에서 먼저 올려 주세요.
                </p>
              )}

              {draftNeedsFlow && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ds-v3-ink-2 flex-shrink-0">사용할 흐름</span>
                  <select
                    value={draft.flow_sequence_id || ''}
                    onChange={e => setDraft(d => ({ ...d, flow_sequence_id: e.target.value ? Number(e.target.value) : null }))}
                    className="flex-1 bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs
                               text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts"
                  >
                    <option value="">선택해 주세요</option>
                    {flows.map(fl => (
                      <option key={fl.id} value={fl.id}>{fl.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 문장에서 읽은 볼륨 — 이 방송에만 적용되고 시스템 설정은 그대로다.
                  안 보이면 사람이 무엇을 승인하는지 알 수 없어 검토 게이트가 무의미해진다. */}
              {(draft.main_volume != null || draft.bgm_volume != null) && (
                <div className="bg-white border border-ds-v3-line rounded-btn px-2.5 py-2 space-y-1.5">
                  {draft.main_volume != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ds-v3-ink-2 flex-shrink-0">안내 음성</span>
                      <input type="range" min="0" max="100" value={draft.main_volume}
                        onChange={e => setDraft(d => ({ ...d, main_volume: Number(e.target.value) }))}
                        className="flex-1 accent-ds-v3-tts" />
                      <span className="text-xs font-semibold text-ds-v3-ink nums w-10 text-right">{draft.main_volume}%</span>
                      <button onClick={() => setDraft(d => ({ ...d, main_volume: null }))}
                        className="text-sm text-ds-v3-ink-2 hover:text-ds-v3-tts flex-shrink-0 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">기본값</button>
                    </div>
                  )}
                  {draft.bgm_volume != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ds-v3-ink-2 flex-shrink-0">BGM</span>
                      <input type="range" min="0" max="100" value={draft.bgm_volume}
                        onChange={e => setDraft(d => ({ ...d, bgm_volume: Number(e.target.value) }))}
                        className="flex-1 accent-ds-v3-tts" />
                      <span className="text-xs font-semibold text-ds-v3-ink nums w-10 text-right">{draft.bgm_volume}%</span>
                      <button onClick={() => setDraft(d => ({ ...d, bgm_volume: null }))}
                        className="text-sm text-ds-v3-ink-2 hover:text-ds-v3-tts flex-shrink-0 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">기본값</button>
                    </div>
                  )}
                  <p className="text-xs text-ds-v3-ink-2">이 방송에만 적용됩니다 — 시스템 음량 설정은 그대로입니다.</p>
                </div>
              )}

              {/* 읽을 문구가 있는 TTS 방송에만 내용이 필요하다 */}
              {(draft.broadcast_type || 'text') === 'text' && (
                <textarea
                  value={draft.content || ''}
                  onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                  rows={3}
                  placeholder="방송 내용"
                  className="w-full bg-white border border-ds-v3-line rounded-btn px-2 py-1.5 text-xs
                             text-ds-v3-ink resize-none focus:outline-none focus:border-ds-v3-tts transition-colors"
                />
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleRejectDraft}
                  disabled={draftBusy}
                  className="flex-1 py-1.5 rounded-btn text-sm font-semibold border border-ds-v3-line
                             text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
                >
                  취소
                </button>
                <button
                  onClick={handleApproveDraft}
                  disabled={draftBusy || !draft.title?.trim() || !draft.scheduled_time || !draft.repeat_start_date
                            || (draftNeedsFile && !draft.audio_file_id)
                            || (draftNeedsFlow && !draft.flow_sequence_id)}
                  className="flex-1 py-1.5 rounded-btn text-sm font-semibold bg-ds-v3-tts hover:bg-ds-v3-tts
                             disabled:opacity-40 text-white btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
                >
                  {draftImmediate ? '지금 방송' : '예약 확정'}
                </button>
              </div>
            </div>
          )}

          {draftError && <p className="text-xs text-ds-v3-warn">{draftError}</p>}
          {draftMsg && <p className="text-xs text-ds-v3-ink-3">{draftMsg}</p>}
        </div>
      )}

      {/* TTS 실행 버튼 */}
      <div className="flex gap-2">
        <button
          onClick={handlePreview}
          disabled={broadcasting || !text.trim()}
          className={`flex-1 flex items-center justify-center gap-2 rounded-btn py-4
                     text-base font-semibold btn-press transition-colors disabled:opacity-50
                     ${previewing
                       ? 'bg-ds-v3-tts text-white hover:bg-ds-v3-tts'
                       : 'bg-white border border-ds-v3-tts/30 text-ds-v3-tts hover:bg-ds-v3-tts-bg'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
        >
          {previewing ? <><Pause size={18} /> 일시정지</> : <><Volume2 size={18} /> 미리 듣기</>}
        </button>
        <button
          onClick={handleBroadcast}
          disabled={previewing || broadcasting || !text.trim()}
          className="flex-1 flex items-center justify-center gap-2 bg-ds-v3-tts
                     hover:bg-ds-v3-tts text-white rounded-btn py-4
                     text-base font-semibold btn-press transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
        >
          <Radio size={18} />
          {broadcasting ? '방송 중...' : '방송하기'}
        </button>
      </div>
    </div>
  )
}
