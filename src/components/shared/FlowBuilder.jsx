// 방송 흐름(순서) 만들기 — 애플 단축어처럼 TTS/BGM/음원/차임벨/대기 블록을 추가·삭제·드래그로
// 순서를 바꿔가며 만드는 재사용 가능한 시퀀스. 예약방송관리(ScheduledBroadcast.jsx) 안에
// TemplateEditor와 같은 모양의 접이식 패널로 들어간다. 드래그 재정렬은 MorningEditor.jsx의
// StepList가 쓰는 것과 동일한 네이티브 HTML5 DnD 패턴을 그대로 옮겨왔다.
// (디자인 노트: 로직/상태/이벤트 핸들러는 그대로 두고 클래스만 부드러운 톤으로 바꿨다 —
// 타입별 파스텔 색, 큰 라운드, 원형 아이콘 배지, 알약 모양 버튼.)
import { useState, useEffect } from 'react'
import NumBox from './NumBox'
import ModalShell from './ModalShell'
import {
  Plus, Trash2, GripVertical, X, Save, ChevronRight,
  FileText, Music2, Volume2, Bell, Clock, Sparkles, Layers, Film,
} from 'lucide-react'
import { getFlow, getFlowEstimate, createFlow, updateFlow, getAudioFiles } from '../../lib/api'
import { VIDEO_CATEGORIES } from '../../lib/scheduleUtils'
import { GROUP_COLORS, GROUP_COLOR_KEYS, groupColor, blockLength, ownerGroupIndexes, moveBlock } from '../../lib/flowGroups'
// 왼쪽 분홍 선(BGM이 깔려 있는 구간)의 규칙 — 순서편집기(StepList.jsx)와 **같은 파일**에서
// 가져온다. 흐름 어휘(step_type)의 갈래와 그 근거는 그 파일 머리말에 적혀 있다.
import { flowBgmCoverage } from '../../lib/bgmLane'
import { useTourStage } from '../../lib/tourStage'
import BgmSourcePicker from './BgmSourcePicker'
import { BGM_DEFAULT_TYPE, bgmTypeLabel } from '../../lib/bgmTypes'

const STEP_TYPES = [
  { value: 'tts',   label: 'TTS',         icon: FileText,
    text: 'text-ds-v3-tts',    bg: 'bg-ds-v3-tts-bg',    ring: 'ring-ds-v3-tts-line',    border: 'border-ds-v3-tts-line',    solid: 'bg-ds-v3-tts'    },
  { value: 'bgm',   label: 'BGM',         icon: Music2,
    text: 'text-ds-v3-bgm',   bg: 'bg-ds-v3-bgm-bg',   ring: 'ring-ds-v3-bgm-line',   border: 'border-ds-v3-bgm-line',   solid: 'bg-ds-v3-bgm'   },
  { value: 'audio', label: '업로드 음원',   icon: Volume2,
    text: 'text-ds-v3-ink-2', bg: 'bg-ds-v3-surface-2', ring: 'ring-ds-v3-line', border: 'border-ds-v3-line', solid: 'bg-ds-v3-ink-2' },
  { value: 'chime', label: '차임벨',       icon: Bell,
    text: 'text-ds-v3-ink-2',  bg: 'bg-ds-v3-surface-2',  ring: 'ring-ds-v3-line',  border: 'border-ds-v3-line',  solid: 'bg-ds-v3-ink-2'  },
  { value: 'delay', label: '대기',         icon: Clock,
    text: 'text-ds-v3-flow', bg: 'bg-ds-v3-flow-bg', ring: 'ring-ds-v3-flow-line', border: 'border-ds-v3-flow-line', solid: 'bg-ds-v3-flow' },
  // 업로드 영상 — 실행은 flowRunner의 video_file 가지. (예전의 'video' 는 외부 TV 송출이었다 —
  // 2026-09-21 걷어냈다, 사용자 결정.)
  // (video_play SSE, 재생시간만큼 대기). 순서편집기 CUSTOM_STEP_TYPES의 '영상 추가'와 같은 배색.
  { value: 'video_file', label: '업로드 영상', icon: Film,
    text: 'text-ds-v3-ink-2',  bg: 'bg-ds-v3-surface-2',  ring: 'ring-ds-v3-line',  border: 'border-ds-v3-line',  solid: 'bg-ds-v3-ink-2'  },
]

// 갈래·옛 이름 호환은 `src/lib/bgmTypes.js` 가 혼자 안다 — 예전엔 이 목록이 세 파일에
// 그대로 복사돼 있어서, 한 곳만 고치면 화면마다 다른 것을 고르게 됐다(2026-09-13).

function defaultConfigFor(type) {
  if (type === 'tts')   return { content: '', repeat_broadcast: 0 }
  if (type === 'bgm')   return { bgm_type: BGM_DEFAULT_TYPE, bgm_value: '', bgm_title: '', bgm_delay: 5 }
  if (type === 'audio') return { audio_file_id: '' }
  if (type === 'delay') return { wait_sec: 5 }
  if (type === 'video_file') return { audio_file_id: '' }
  return {}
}

// 묶음(폴더)의 규칙·색은 src/lib/flowGroups.js에 있다 — 순서를 바꾸는 계산이라 테스트로
// 고정해 둬야 해서(잘못되면 저장해 둔 방송 순서가 조용히 뒤바뀐다) 순수 모듈로 뺐다.
function newStep(step_type) {
  if (step_type === 'group') {
    return {
      _cid: `${Date.now()}_${Math.random()}`, step_type: 'group', label: '새 묶음',
      config: { collapsed: false, color: GROUP_COLOR_KEYS[0] },
    }
  }
  return { _cid: `${Date.now()}_${Math.random()}`, step_type, label: '', config: defaultConfigFor(step_type) }
}

function stepSummary(step) {
  const c = step.config || {}
  if (step.step_type === 'tts')   return c.content?.trim() ? c.content.slice(0, 30) : '(내용 없음)'
  if (step.step_type === 'bgm')   return bgmTypeLabel(c.bgm_type)
  if (step.step_type === 'audio') return c.audio_file_id ? `음원 #${c.audio_file_id}` : '(음원 미선택)'
  if (step.step_type === 'delay') return `${c.wait_sec || 0}초 대기`
  if (step.step_type === 'chime') return '차임벨 재생'
  if (step.step_type === 'video_file') return c.audio_file_id ? `업로드 영상 #${c.audio_file_id}` : '(영상 미선택)'
  return ''
}

// 단계 유형 → 볼륨을 담는 config 필드. 서버 domain/volume.js의 FLOW_STEP_CHANNEL과 같은
// 집합이어야 한다(flow-step-volume.test.js가 대조한다).
// 'delay'는 소리가 없어서 빠졌다.
const STEP_VOLUME_FIELD = {
  tts:        'volume',
  chime:      'volume',
  audio:      'volume',
  video_file: 'volume',
  bgm:        'bgm_volume',
}

const STEP_VOLUME_LABEL = { bgm_volume: 'BGM 볼륨', volume: '이 단계 소리' }

// 예약 시각 뱃지 — 단계와 묶음 머리글이 같은 것을 쓴다(둘 다 같은 규칙으로 동작한다).
// 모든 줄에 시각 칸을 늘어놓으면 목록이 지저분해져서, 쓰는 줄만 뱃지로 남고 나머지는
// 마우스를 올렸을 때만 "예약 시간 추가"가 뜬다.
function AtTimeControl({ config, setConfig }) {
  // 예약 시각 칸을 펼쳤는지. 값이 있으면 항상 펼친 상태로 시작한다.
  const [showTime, setShowTime] = useState(!!config.at_time)

  if (!showTime && !config.at_time) {
    return (
      <button onClick={() => setShowTime(true)} onDragStart={e => e.stopPropagation()}
        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full t-sub font-semibold
                   text-ds-v3-ink-2 bg-white/70 opacity-0 group-hover:opacity-100 transition-opacity
                   hover:text-ds-v3-tts hover:bg-white">
        <Clock size={10} /> 예약 시간 추가
      </button>
    )
  }
  return (
    <span onDragStart={e => e.stopPropagation()}
      className="flex items-center gap-0.5 flex-shrink-0 bg-white/85 rounded-full pl-2 pr-0.5 py-0.5 shadow-sm">
      <Clock size={11} className="text-ds-v3-tts flex-shrink-0" />
      <input type="time" draggable={false} value={config.at_time || ''}
        onChange={e => setConfig({ at_time: e.target.value })}
        className="w-[78px] bg-transparent t-sub font-semibold text-ds-v3-ink nums focus:outline-none" />
      <button onClick={() => { setConfig({ at_time: '' }); setShowTime(false) }}
        title="예약 시각 지우기"
        className="p-1 rounded-full text-black/25 hover:text-ds-v3-warn hover:bg-white transition-colors">
        <X size={10} />
      </button>
    </span>
  )
}

// 묶음 머리글 한 줄 — 이름·색·접기. 끌면 안의 단계까지 통째로 따라간다.
function GroupHeaderRow({ step, index, memberCount, cov, dragIdx, onDragStart, onDragOver, onDragEnd, onUpdate, onDelete }) {
  const config = step.config || {}
  const setConfig = (patch) => onUpdate({ ...step, config: { ...config, ...patch } })
  const c = groupColor(config.color)
  const collapsed = !!config.collapsed
  const isDragging = dragIdx === index

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-[20px] border transition-all duration-150 ${c.head} ${
        isDragging ? 'border-black/10 shadow-md scale-[1.01]' : 'border-transparent hover:shadow-sm'
      }`}
    >
      {/* 묶음 머리글도 BGM 구간 안에 있으면 선을 잇는다 — 여기서 끊으면 "묶음에서 음악이
          멎는다"는 없는 사실을 그리게 된다(머리글은 소리를 안 낸다). */}
      <BgmRail cov={cov} />
      <div className="flex items-center gap-2 px-3.5 py-2.5 cursor-grab select-none">
        <GripVertical size={14} className="text-black/25 flex-shrink-0" />
        <button onClick={() => setConfig({ collapsed: !collapsed })} onDragStart={e => e.stopPropagation()}
          title={collapsed ? '펼치기' : '접기'}
          className="p-0.5 rounded-full text-black/40 hover:bg-white/70 transition-colors flex-shrink-0">
          <ChevronRight size={14} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        </button>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.dot}`} />
        <input value={step.label || ''} draggable={false}
          onChange={e => onUpdate({ ...step, label: e.target.value })}
          onDragStart={e => e.stopPropagation()}
          placeholder="묶음 이름 (예: 동요 전 안내)"
          className={`bg-transparent text-sm font-semibold min-w-0 flex-1 focus:outline-none ${c.text}
                      placeholder:text-black/25 placeholder:font-normal`} />
        <span className="t-sub text-black/40 flex-shrink-0 nums">{memberCount}단계</span>

        {/* 묶음끼리 눈으로 구분되게 하는 색. 평소엔 감춰두고 마우스를 올렸을 때만 보인다. */}
        <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0" onDragStart={e => e.stopPropagation()}>
          {GROUP_COLOR_KEYS.map(k => (
            <button key={k} onClick={() => setConfig({ color: k })} title="묶음 색"
              className={`w-3 h-3 rounded-full ${GROUP_COLORS[k].dot} transition-transform hover:scale-125 ${
                (config.color ?? GROUP_COLOR_KEYS[0]) === k ? 'ring-2 ring-offset-1 ring-black/20' : ''
              }`} />
          ))}
        </span>

        <AtTimeControl config={config} setConfig={setConfig} />

        <button onClick={() => onDelete(index)} onDragStart={e => e.stopPropagation()}
          title="묶음만 지웁니다 (안의 단계는 남습니다)"
          className="p-1.5 rounded-full text-black/30 hover:text-ds-v3-warn hover:bg-white/70 transition-colors flex-shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// BGM이 깔려 있는 구간 — 카드 왼쪽 분홍 레일. **순서편집기(StepList.jsx)와 같은 모양·같은
// 뜻이어야 한다** — 같은 것을 두 화면이 다르게 그리면 사람이 헷갈린다. 그래서 클래스도 그쪽에서
// 그대로 옮겨왔다. 흐름·커스텀 자동순서 미리보기가 이 하나를 함께 쓴다.
// **선은 카드 안에서 시작하고 끝난다**(top-0/bottom-0, 끝은 top-3/bottom-3) — 음수 오프셋을
// 쓰면 카드 밖 허공에 토막이 남는다(2026-09-02 신고받아 고친 그것).
export function BgmRail({ cov }) {
  if (!cov) return null
  const isStart = cov.startsWith('start')
  const isEnd   = cov.includes('end')
  const paused  = cov.startsWith('paused')
  return (
    <span
      aria-hidden
      title={paused
        ? '이 단계에서는 BGM이 잠시 멈췄다 돌아옵니다'
        : '이 단계에는 배경음악이 함께 나옵니다'}
      className={`absolute left-1 w-[3px] bg-ds-v3-bgm pointer-events-none
        ${isStart ? 'top-3 rounded-t-full' : 'top-0'}
        ${isEnd ? 'bottom-3 rounded-b-full' : 'bottom-0'}
        ${paused ? 'opacity-30' : 'opacity-80'}`}
    />
  )
}

function StepRow({ step, index, stepNo, cov, dragIdx, onDragStart, onDragOver, onDragEnd, onUpdate, onDelete, audioFiles }) {
  const meta = STEP_TYPES.find(t => t.value === step.step_type) ?? STEP_TYPES[0]
  const Icon = meta.icon
  const config = step.config || {}
  const setConfig = (patch) => onUpdate({ ...step, config: { ...config, ...patch } })
  const isDragging = dragIdx === index

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-[20px] border transition-all duration-150 ${meta.bg} ${
        isDragging ? `${meta.border} shadow-md scale-[1.01]` : 'border-transparent hover:shadow-sm'
      }`}
    >
      <BgmRail cov={cov} />
      <div className="flex items-center gap-2.5 px-3.5 py-3 cursor-grab select-none">
        <GripVertical size={14} className="text-black/25 flex-shrink-0" />
        <span className={`w-6 h-6 flex items-center justify-center rounded-full ${meta.solid} text-white t-sub font-semibold flex-shrink-0 shadow-sm`}>
          {stepNo}
        </span>
        <span className={`w-7 h-7 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0 ${meta.text}`}>
          <Icon size={13} />
        </span>
        <span className={`t-sub font-semibold flex-shrink-0 ${meta.text}`}>{meta.label}</span>
        <span className="t-sub text-ds-v3-ink-2 truncate flex-1 min-w-0">{stepSummary(step)}</span>

        <AtTimeControl config={config} setConfig={setConfig} />

        <button onClick={() => onDelete(index)} onDragStart={e => e.stopPropagation()}
          className="p-1.5 rounded-full text-black/30 hover:text-ds-v3-warn hover:bg-white/70 transition-colors flex-shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="px-3.5 pb-3.5 pt-0.5 space-y-2.5" onDragStart={e => e.stopPropagation()}>
        {/* 이 단계에만 적용할 볼륨. 시스템 기본값은 그대로 두고 이 재생에만 쓴다.
            "기본값 사용"과 "직접 지정"을 구분해야 0(무음)을 저장할 수 있다. */}
        {STEP_VOLUME_FIELD[step.step_type] && (() => {
          const field = STEP_VOLUME_FIELD[step.step_type]
          const value = config[field]
          const useDefault = value === null || value === undefined || value === ''
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <Volume2 size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
              <span className="t-sub text-ds-v3-ink-2">{STEP_VOLUME_LABEL[field]}</span>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={useDefault}
                  onChange={e => setConfig({ [field]: e.target.checked ? null : 70 })}
                  className="accent-ds-v3-tts" />
                <span className="t-sub text-ds-v3-ink-2">시스템 기본값 사용</span>
              </label>
              {!useDefault && (
                <>
                  <input type="range" min="0" max="100" value={Number(value)}
                    onChange={e => setConfig({ [field]: Number(e.target.value) })}
                    onDragStart={e => e.stopPropagation()}
                    className="flex-1 min-w-[100px] accent-ds-v3-tts" />
                  <span className="t-sub font-semibold text-ds-v3-ink w-9 text-right">{Number(value)}%</span>
                </>
              )}
            </div>
          )
        })()}

        {step.step_type === 'tts' && (
          <textarea rows={2} value={config.content || ''} onChange={e => setConfig({ content: e.target.value })}
            placeholder="방송할 텍스트를 입력하세요"
            className="w-full border-0 rounded-2xl px-3.5 py-2.5 text-sm text-ds-v3-ink bg-white/80 shadow-inner
                       focus:outline-none focus:ring-2 focus:ring-ds-v3-tts-line resize-none placeholder:text-ds-v3-ink-2" />
        )}

        {step.step_type === 'bgm' && (
          <div className="space-y-2.5">
            <BgmSourcePicker
              value={config.bgm_type}
              onChange={(t) => setConfig({ bgm_type: t })}
              chipClass={(고름) => `px-3 py-1.5 rounded-full t-sub font-semibold transition-colors ${
                고름 ? 'bg-ds-v3-bgm text-white shadow-sm' : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'
              }`}
            />
            <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 w-fit">
              <label className="t-sub text-ds-v3-ink-2 flex-shrink-0">선재생</label>
              <NumBox min={0} max={60} value={config.bgm_delay ?? 5}
                onChange={v => setConfig({ bgm_delay: v })}
                className="w-12 border-0 bg-transparent text-sm text-ds-v3-ink text-center nums focus:outline-none" />
              <span className="t-sub text-ds-v3-ink-2">초</span>
            </div>
          </div>
        )}

        {step.step_type === 'audio' && (
          audioFiles.length === 0
            ? <p className="t-sub text-ds-v3-ink-2 py-1">업로드된 음원이 없습니다.</p>
            : <select value={config.audio_file_id || ''} onChange={e => setConfig({ audio_file_id: e.target.value })}
                className="w-full border-0 rounded-2xl px-3.5 py-2.5 text-sm text-ds-v3-ink bg-white/80 shadow-inner focus:outline-none focus:ring-2 focus:ring-ds-v3-line-2">
                <option value="">선택하세요</option>
                {audioFiles.map(af => <option key={af.id} value={String(af.id)}>[{af.category}] {af.original_name}</option>)}
              </select>
        )}

        {step.step_type === 'delay' && (
          <div className="flex items-center gap-2 bg-white/60 rounded-full px-3.5 py-2 w-fit">
            <NumBox min={1} max={600} value={config.wait_sec ?? 5}
              onChange={v => setConfig({ wait_sec: v })}
              className="w-12 border-0 bg-transparent text-sm text-ds-v3-ink text-center nums focus:outline-none" />
            <span className="t-sub text-ds-v3-ink-2">초 대기 후 다음 단계</span>
          </div>
        )}

        {/* 업로드 영상 — 이 PC 에 파일이 있는 영상만(파일 이름이 빈 옛 링크 행은 틀 수 없다).
            2026-09-21: 예전 조건 `source_type === 'upload'` 은 **맞는 행이 없었다**(저장값은 'file') —
            그래서 이 목록이 늘 비어 보였다. 파일 이름으로 가른다. */}
        {step.step_type === 'video_file' && (() => {
          const options = audioFiles.filter(af => VIDEO_CATEGORIES.includes(af.category) && af.filename)
          return options.length === 0
            ? <p className="t-sub text-ds-v3-ink-2 py-1">업로드된 영상이 없습니다. 음원 및 동영상 관리에서 먼저 영상 파일을 업로드하세요.</p>
            : <select value={config.audio_file_id || ''} onChange={e => setConfig({ audio_file_id: e.target.value })}
                className="w-full border-0 rounded-2xl px-3.5 py-2.5 text-sm text-ds-v3-ink bg-white/80 shadow-inner focus:outline-none focus:ring-2 focus:ring-ds-v3-line-2">
                <option value="">선택하세요</option>
                {options.map(af => <option key={af.id} value={String(af.id)}>[{af.category}] {af.original_name}</option>)}
              </select>
        })()}
      </div>
    </div>
  )
}

// `인라인` 이면 **창을 안 띄우고 그 자리에 편다** (사용자 지시 2026-09-13).
//
// *"커스텀 자동순서는 단계 편집이 왜 아침 방송이나 국민체조랑 달라, 똑같이 만들어야지"* — 맞다.
// 자동방송 5종은 단계가 **화면에 펼쳐진 채로** 바로 고쳐지는데(`StepList`), 커스텀만
// 「읽기 전용 미리보기 + 「단계 편집」 을 눌러 창 열기」 였다. 같은 자리에서 같은 일을
// 하는데 한쪽만 창을 거친다.
//
// **편집기를 새로 만들지 않는다.** 이 창의 속이 이미 그 편집기다 — 껍데기만 벗긴다.
// 그래야 두 길이 갈리지 않는다(창으로 열든 펼쳐 두든 같은 코드가 돈다).
export function FlowEditorModal({ flowId, onClose, onSaved, 인라인 = false }) {
  const [name,       setName]       = useState('')
  const [steps,      setSteps]      = useState([])
  const [dragIdx,    setDragIdx]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [audioFiles, setAudioFiles] = useState([])
  // 점검 — "이 흐름을 틀면 뭐가 빠지나". **저장된 구성 기준**이다(서버가 표에서 읽는다).
  // 지금 화면에서 고친 것은 저장해야 반영된다 — 그래서 아래 문구에 그렇게 적어 둔다.
  const [check, setCheck] = useState(null)

  useEffect(() => {
    getAudioFiles().then(rows => setAudioFiles(rows)).catch(() => {})
  }, [])

  useEffect(() => {
    if (flowId) {
      getFlow(flowId).then(d => {
        setName(d.name)
        setSteps(d.steps.map(s => ({ ...s, _cid: `saved_${s.id}` })))
      }).catch(() => setError('불러오기 실패'))
      getFlowEstimate(flowId).then(setCheck).catch(() => setCheck(null))
    }
  }, [flowId])

  // 묶음 머리글을 끌면 그 안의 단계까지 통째로 따라간다(Ableton 트랙 그룹과 같은 감각).
  // 일반 단계는 길이가 1이라 예전과 완전히 같은 동작이 된다.
  const onDragOver = (e, i) => {
    e.preventDefault()
    const moved = moveBlock(steps, dragIdx, i)
    if (!moved) return   // 제자리이거나, 묶음을 자기 자신 안으로 떨어뜨리려는 경우
    setSteps(moved.steps)
    setDragIdx(moved.index)
  }

  // 이 단계에 BGM이 깔려 있는가 — 왼쪽 분홍 선이 그리는 것. 규칙과 근거(흐름 어휘 갈래)는
  // src/lib/bgmLane.js 한 곳에 있다. 순서편집기(StepList.jsx)와 같은 계산이다.
  const bgmCover = flowBgmCoverage(steps)

  const addStep    = (type) => setSteps(s => [...s, newStep(type)])

  // 처음 안내(N18)가 **펼쳐 둔 편집기**를 실제로 움직인다 — 이름 적기·단계 넣기·안내 말 적기.
  // 저장은 부르지 않는다(「단계 저장」은 눌리는 모습만). 창으로 뜬 편집기는 안내 대상이 아니다.
  useTourStage(인라인 ? {
    'flow.name': (v) => setName(v ?? ''),
    'flow.add': (type) => addStep(type),
    'flow.text': (v) => setSteps(s => {
      const i = s.map(x => x.step_type).lastIndexOf('tts')
      if (i < 0) return s
      return s.map((x, j) => (j === i ? { ...x, config: { ...x.config, content: v } } : x))
    }),
    'flow.music': (v) => setSteps(s => {
      const i = s.map(x => x.step_type).lastIndexOf('bgm')
      if (i < 0) return s
      return s.map((x, j) => (j === i ? { ...x, config: { ...x.config, bgm_value: v } } : x))
    }),
  } : {})
  const updateStep = (i, updated) => setSteps(s => s.map((st, idx) => idx === i ? updated : st))
  // 묶음 머리글을 지워도 안의 단계는 남는다(묶음만 풀린다) — 실수로 방송을 통째로 날리지 않게.
  const deleteStep  = (i) => setSteps(s => s.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    if (!name.trim()) { setError('흐름 이름을 입력해주세요.'); return }
    if (steps.length === 0) { setError('최소 한 단계 이상 추가해주세요.'); return }
    // 묶음은 목록을 나누는 라벨일 뿐이라 소리를 내지 않는다. 묶음만 있는 흐름은 저장은 되는데
    // 방송 시각에 아무 일도 안 일어난다 — 가장 알아채기 어려운 실패라 여기서 막는다.
    if (!steps.some(s => s.step_type !== 'group')) {
      setError('묶음 말고 실제로 방송할 단계를 최소 하나 넣어주세요.')
      return
    }
    if (steps.some(s => s.step_type === 'audio' && !s.config?.audio_file_id)) {
      setError('음원 단계에 재생할 파일을 선택해주세요.')
      return
    }
    // 업로드 영상도 같은 규칙 — 새로 연 유형만 이 규칙에서 빠져 있었다(2026-09-03 레드 검증).
    // 파일을 안 고르면 방송 시각에 아무 일도 안 일어나고 예상 소요시간도 0초라, 화면이
    // 이상하다고 말해 주지 않는다. 이 화면이 스스로 "가장 알아채기 어려운 실패"라 적은 그 모양이다.
    if (steps.some(s => s.step_type === 'video_file' && !s.config?.audio_file_id)) {
      setError('업로드 영상 단계에 재생할 영상을 선택해주세요.')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        name: name.trim(),
        steps: steps.map(s => ({ step_type: s.step_type, label: s.label || '', config: s.config || {} })),
      }
      let savedId = flowId
      if (flowId) await updateFlow(flowId, payload)
      else        savedId = (await createFlow(payload)).id
      onSaved(savedId)
    } catch (e) {
      // 개인정보 확인창에서 사람이 「취소」를 고른 것은 오류가 아니다 — 저장만 안 하고 조용히 둔다.
      if (!e.cancelled) setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const 본문 = (
        <div className="space-y-4">
          {error && <p className="t-sub rounded-2xl bg-ds-v3-warn-bg px-3.5 py-2.5 text-ds-v3-warn">{error}</p>}

          <div>
            <label className="mb-2 ml-1 block t-sub font-semibold text-ds-v3-ink-2">흐름 이름</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="예: 생일 축하 방송"
              className="w-full border-0 rounded-2xl px-4 py-3 text-sm text-ds-v3-ink bg-ds-v3-bg shadow-inner
                         focus:outline-none focus:ring-2 focus:ring-ds-v3-flow-line placeholder:text-ds-v3-ink-2" />
          </div>

          {/* 점검 — 이 흐름을 틀면 얼마나 걸리고 무엇이 빠지나.
              자동방송 순서편집기와 **같은 계산**을 쓴다(domain/broadcastEstimate).
              저장된 구성 기준이라, 지금 화면에서 고친 것은 저장해야 반영된다. */}
          {check && (
            <div className="rounded-2xl bg-ds-v3-bg px-3.5 py-2.5 space-y-1">
              <p className="t-sub text-ds-v3-ink-2">
                <b className="text-ds-v3-ink">
                  {check.hasUpperBound ? '최대' : '대략'} {Math.max(1, Math.ceil(check.totalMs / 60000))}분
                </b>
                {check.skippedStepIds?.length
                  ? <span className="text-ds-v3-ink-2 font-semibold"> · ⚠ {check.skippedStepIds.length}개 단계가 빠집니다</span>
                  : <span> · ✓ 빠지는 단계 없음</span>}
                <span className="text-ds-v3-ink-2"> (저장된 구성 기준)</span>
              </p>
              {(check.steps || []).filter(st => st.skip).map(st => (
                <p key={st.id} className="t-sub text-ds-v3-ink-2">
                  <span className="text-ds-v3-ink-2">·</span> <b className="text-ds-v3-ink">{st.label || st.id}</b> — {st.skip}
                </p>
              ))}
            </div>
          )}

          {/* 왼쪽 분홍 선이 무엇인지 한 줄로 — 안 적으면 사람이 색인 줄 안다.
              **문구가 순서편집기와 다른 이유가 있다**: 흐름에서는 음원 단계가 BGM을 끄고
              (되돌리는 길이 없다). 근거는 src/lib/bgmLane.js. */}
          {bgmCover.some(Boolean) && (
            <div className="flex items-center gap-1.5 t-sub text-ds-v3-ink-2">
              <span className="w-[3px] h-3.5 rounded-full bg-ds-v3-bgm flex-shrink-0" />
              <span>왼쪽 선이 이어진 구간에는 <b className="font-semibold">배경음악이 함께 나옵니다</b> — 그 위로 안내 음성이 나갑니다.
                음원·영상 단계에서 BGM은 꺼집니다(다시 켜려면 BGM 단계를 넣으세요).</span>
            </div>
          )}

          <div className="space-y-2.5">
            {(() => {
              // 묶음은 "머리글 단계 + 그 뒤에 이어지는 단계들"이다. 평평한 배열을 그대로 두고
              // 그리는 쪽에서만 계층을 만든다 — 저장 구조도, 실행 순서도 손대지 않는다.
              const owners = ownerGroupIndexes(steps)
              let stepNo = 0
              return steps.map((step, i) => {
                if (step.step_type === 'group') {
                  return (
                    <GroupHeaderRow key={step._cid} step={step} index={i}
                      memberCount={blockLength(steps, i) - 1}
                      cov={bgmCover[i]}
                      dragIdx={dragIdx}
                      onDragStart={setDragIdx} onDragOver={onDragOver} onDragEnd={() => setDragIdx(null)}
                      onUpdate={(updated) => updateStep(i, updated)} onDelete={deleteStep} />
                  )
                }
                stepNo++
                const owner = owners[i]
                const head  = owner >= 0 ? steps[owner] : null
                if (head?.config?.collapsed) return null   // 접힌 묶음의 속살은 감춘다
                const row = (
                  <StepRow key={step._cid} step={step} index={i} stepNo={stepNo} cov={bgmCover[i]} dragIdx={dragIdx}
                    onDragStart={setDragIdx} onDragOver={onDragOver} onDragEnd={() => setDragIdx(null)}
                    onUpdate={(updated) => updateStep(i, updated)} onDelete={deleteStep}
                    audioFiles={audioFiles} />
                )
                if (!head) return row
                // 묶음에 속한 단계는 들여쓰고 왼쪽에 묶음 색 세로선을 둔다(애플 단축어의 컨테이너)
                return (
                  <div key={step._cid} className="flex gap-2 pl-1">
                    <span className={`w-1 rounded-full flex-shrink-0 ${groupColor(head.config?.color).rail}`} />
                    <div className="flex-1 min-w-0">{row}</div>
                  </div>
                )
              })
            })()}
          </div>

          <div className="flex gap-1.5 flex-wrap pb-2">
            {/* 묶음은 방송 단계가 아니라 목록을 나누는 칸막이라, 방송 단계 버튼들과 떼어 놓는다 */}
            <button type="button" onClick={() => addStep('group')}
              className="flex items-center gap-1.5 pl-2.5 pr-3.5 py-2 t-sub font-semibold rounded-full
                         transition-all cursor-pointer hover:scale-105 active:scale-95
                         bg-ds-v3-bg text-ds-v3-ink border border-dashed border-ds-v3-line">
              <span className="w-4 h-4 rounded-full bg-white flex items-center justify-center">
                <Plus size={10} />
              </span>
              <Layers size={12} />묶음
            </button>
            <span className="w-px bg-ds-v3-line my-1.5" />
            {STEP_TYPES.map(t => {
              const TIcon = t.icon
              return (
                <button key={t.value} type="button" onClick={() => addStep(t.value)} data-tour={'flow-add-' + t.value}
                  className={`flex items-center gap-1.5 pl-2.5 pr-3.5 py-2 t-sub font-semibold rounded-full
                             transition-all cursor-pointer hover:scale-105 active:scale-95 ${t.bg} ${t.text}`}>
                  <span className="w-4 h-4 rounded-full bg-white/70 flex items-center justify-center">
                    <Plus size={10} />
                  </span>
                  <TIcon size={12} />{t.label}
                </button>
              )
            })}
          </div>
        </div>
  )

  // 펼쳐 두는 쪽 — 껍데기도 덮개도 없다. 저장 단추만 본문 아래에 둔다.
  // 「취소」는 없다: 창이 아니라서 닫을 것이 없고, 안 고쳤으면 그냥 두면 된다.
  if (인라인) {
    return (
      <div className="space-y-4" data-tour="flow-builder">
        {본문}
        <div className="flex items-center justify-end gap-2">
          <button onClick={handleSave} disabled={saving} data-tour="flow-save"
            className="btn-press flex min-h-[44px] items-center gap-1.5 rounded-full bg-ds-v3-tts px-5
                       t-label text-white shadow-sm transition-all hover:bg-ds-v3-tts hover:shadow-md
                       disabled:opacity-60">
            <Save size={14} /> {saving ? '저장 중...' : '단계 저장'}
          </button>
        </div>
      </div>
    )
  }

  return (
    // 공용 껍데기로 갈아끼웠다(6단계 3/3b, 2026-09-13). 이 창이 마지막까지 따로 놀던 자리다.
    // 걷어낸 것 셋: **28px 모서리**(제품 기준은 14px) · **반투명 머리줄** · **제 손으로 그린
    // 덮개**. ESC·첫 초점·초점 복귀·스크롤 잠금은 껍데기가 맡는다.
    <ModalShell
      open
      onClose={onClose}
      title={flowId ? '흐름 수정' : '새 흐름 만들기'}
      icon={<Sparkles size={16} />}
      width="max-w-lg"
      footer={
        <>
          <button onClick={onClose}
            className="min-h-[44px] rounded-full px-4 t-body text-ds-v3-ink-2 transition-colors hover:bg-ds-v3-surface-2">
            취소
          </button>
          <button onClick={handleSave} disabled={saving}
            className="btn-press flex min-h-[44px] items-center gap-1.5 rounded-full bg-ds-v3-tts px-5
                       t-label text-white shadow-sm transition-all hover:bg-ds-v3-tts hover:shadow-md
                       disabled:opacity-60">
            <Save size={14} /> {saving ? '저장 중...' : '저장'}
          </button>
        </>
      }
    >
      {본문}
    </ModalShell>
  )
}
