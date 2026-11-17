import { useState, useEffect } from 'react'
import RateInput from './RateInput'
import { rateToPercent, percentToRate } from '../../lib/scheduleUtils'
import { Save, Music2, Pencil } from 'lucide-react'
import { createSchedule, updateSchedule, getAudioFiles, getFlows, getFlow, getVolume, getSchedules, getBroadcastSchedule, getBroadcastEstimate } from '../../lib/api'
import { parseWeekdays, todayLocalStr, BROADCAST_TYPES, 고를수있는유형, BGM물음이있나, emptySchedule, MAIN_VOLUME_CHANNEL, VOLUME_CHANNEL_LABEL, filesForBroadcastType, RATE_TYPES, findScheduleOverlaps, autoBroadcastSiblings } from '../../lib/scheduleUtils'
import RepeatPicker from './RepeatPicker'
import { FlowEditorModal } from './FlowBuilder'
// 껍데기·덮개·닫기 단추·접근성은 **한 곳에서 온다**(G-53).
import ModalShell from './ModalShell'
import ConfirmDialog from './ConfirmDialog'
import BgmSourcePicker from './BgmSourcePicker'
import { useTourStage } from '../../lib/tourStage'
import { bgmSourceOf, bgmOrderOf, bgmTypeLabel, bgmFolderName } from '../../lib/bgmTypes'
import { useBgmFolders } from '../../lib/bgmFolders'

/**
 * 흐름 고르기 + **고른 것의 단계 미리보기** (사용자 지시 2026-09-15).
 *
 * *"사용할 흐름 넣어놓고 선택하면 밑에 방송 플로우가 보였으면 좋겠는데."*
 *
 * 그전에는 고르고 나서 **무엇이 나가는지 보려면 자동순서 화면까지 다녀와야** 했다.
 * 이름과 단계 수(「아침 준비 (4단계)」)만으로는 차임인지 음악인지 모른다.
 *
 * **단계는 고른 뒤에 따로 받아 온다** — 목록(`/api/flows`)에는 이름과 개수만 있다.
 * 못 받아도 고르기는 그대로 된다(미리보기만 빈다) — 곁가지가 본 일을 막으면 안 된다.
 */
// **이름이 영문인 이유**: React 훅 규칙(rules-of-hooks)이 컴포넌트를 **대문자로
// 시작하는 이름**으로만 알아본다. 한글 이름이면 훅을 쓸 수 없다고 막는다.
function FlowPicker({ flows, value, onChange, onNew, onEdit, 새로고침 }) {
  // **받은 것을 「어느 흐름의 것인지」와 함께 들고 있는다.** 효과 본문에서 곧바로
  // 비우면(`set단계(null)`) 연쇄 렌더가 되어 `react-hooks/set-state-in-effect` 가 막는다.
  // 대신 **받은 id 가 지금 고른 것과 같을 때만** 쓴다 — 흐름을 바꾸는 순간 앞 것이
  // 저절로 안 맞게 되므로, 비우는 일 자체가 필요 없어진다.
  const [받은, set받은] = useState({ id: null, steps: null })
  useEffect(() => {
    if (!value) return
    let 죽음 = false
    getFlow(value)
      .then(d => { if (!죽음) set받은({ id: String(value), steps: Array.isArray(d?.steps) ? d.steps : [] }) })
      .catch(() => { if (!죽음) set받은({ id: String(value), steps: [] }) })
    return () => { 죽음 = true }
    // `새로고침` 이 바뀌면 단계를 다시 받는다 — 미니 편집으로 고친 결과가
    // **이 미리보기에 곧바로 보여야** 한다. 안 그러면 고쳤는데 안 고쳐진 줄 안다.
  }, [value, 새로고침])
  const 단계 = 받은.id === String(value) ? 받은.steps : null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block t-sub font-semibold text-ds-v3-ink-2">사용할 흐름</label>
        {/* ── **새로 만들기가 눈에 띄어야 한다** (사용자 지적 2026-09-15) ────────────
            *"여기서 새 순서 만들기가 너무 눈에 안 보여, 좀 더 눈에 띄게 해줘."*
            앞 판은 밑줄 없는 작은 글씨였다 — 흐름이 하나도 없을 때 **여기 말고는 갈 데가
            없는데** 그것이 가장 안 보이는 글씨였다. 테두리를 주고 44px 을 채운다(G-15). */}
        <button type="button" onClick={onNew}
          className="flex min-h-[36px] items-center gap-1 rounded-full border border-ds-v3-tts-line
                     bg-ds-v3-tts-bg px-3 t-sub font-semibold text-ds-v3-tts
                     transition-colors hover:bg-ds-v3-tts-bg btn-press">
          + 새 순서 만들기
        </button>
      </div>

      {flows.length === 0 ? (
        <p className="t-sub text-ds-v3-ink-2 py-2">
          아직 만든 순서가 없습니다. 위 <b className="text-ds-v3-ink">「+ 새 순서 만들기」</b>를 눌러 만드세요.
        </p>
      ) : (
        <select value={value || ''} onChange={e => onChange(e.target.value)}
          className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink
                     focus:outline-none focus:border-ds-v3-tts bg-white">
          <option value="">선택하세요</option>
          {flows.map(fl => (
            <option key={fl.id} value={String(fl.id)}>{fl.name} ({fl.step_count}단계)</option>
          ))}
        </select>
      )}

      {/* ── **고른 순서를 여기서 바로 고친다** (사용자 지시 2026-09-15) ──────────────
          *"사용할흐름 거기서 수정할 수 있게 하라니까, 미니 편집처럼 새흐름만들기를
            미니버전으로 만들면 되잖아."*
          맞다. **새 편집기를 만들지 않는다** — 「새 순서 만들기」가 여는 그 편집기를
          `flowId` 만 바꿔서 연다. 두 편집기를 두면 한쪽만 고쳐지는 날이 온다. */}
      {value && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => onEdit?.(value)}
            className="flex min-h-[36px] items-center gap-1 rounded-full border border-ds-v3-line
                       bg-white px-3 t-sub font-semibold text-ds-v3-ink
                       transition-colors hover:bg-ds-v3-bg btn-press">
            <Pencil size={13} /> 이 순서 고치기
          </button>
        </div>
      )}

      {/* 고른 흐름의 단계 — **차례가 곧 방송 순서**라 번호를 매긴다 */}
      {value && Array.isArray(단계) && 단계.length > 0 && (
        <ol className="mt-3 space-y-1.5 rounded-[10px] border border-ds-v3-line bg-ds-v3-bg p-3 m-0 list-none">
          {단계.map((s, i) => (
            <li key={s.id ?? i} className="flex items-baseline gap-2.5 t-sub">
              {/* **11px 로 뒀다가 가드에 걸렸다**(`modal-shell.test.js` — 창 안쪽은 14px 이
                  하한이다). 이 창을 보는 사람은 요양보호사·사회복지사라 작은 글씨를 두면
                  안 읽힌다. 숫자라고 예외를 두지 않는다 — 대신 동그라미를 키웠다. */}
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full
                               bg-white border border-ds-v3-line t-sub font-semibold text-ds-v3-ink-2 tabular-nums">
                {i + 1}
              </span>
              <span className="font-semibold text-ds-v3-ink">{단계라벨(s.step_type)}</span>
              {s.label && <span className="text-ds-v3-ink-2 truncate">{s.label}</span>}
            </li>
          ))}
        </ol>
      )}
      {value && Array.isArray(단계) && 단계.length === 0 && (
        <p className="mt-2 t-sub text-ds-v3-ink-2">이 순서에는 아직 단계가 없습니다.</p>
      )}
    </div>
  )
}

/** 단계 종류를 사람 말로. 모르는 것은 **그 이름 그대로** 보인다(지어내지 않는다). */
const 단계이름 = {
  tts: '안내 음성', chime: '차임벨', audio: '음원', video: '영상',
  bgm: '배경음악',
  wait: '기다리기', group: '묶음',
}
const 단계라벨 = (t) => 단계이름[t] || t || '단계'

// 방송 유형에 따른 라벨 칩
export function BroadcastTypeBadge({ type }) {
  const t = BROADCAST_TYPES.find(b => b.value === type)
  if (!t || type === 'text') return null
  const Icon = t.icon
  return (
    <span className={`inline-flex items-center gap-1 t-sub font-semibold px-1.5 py-0.5 rounded-full bg-ds-v3-surface-2 ${t.color}`}>
      <Icon size={10} /> {t.label}
    </span>
  )
}

// BGM 갈래는 `src/lib/bgmTypes.js` 가 단일 출처다(2026-09-13). 여기 있던 사본은 뺐다 —
// 세 화면에 같은 목록이 복사돼 있어 한 곳만 고치면 화면마다 다른 것을 고르게 됐다.

// 예약 추가/수정 모달 — 관리자(WeeklySchedule.jsx/ScheduledBroadcast.jsx)와 쉬운화면
// (ScheduledBroadcastMini.jsx) 둘 다 이 모달을 그대로 재사용한다.
// 두 곳에서 각자 다른 모달을 유지하면 기능이 갈라지기 쉽다(예: BGM 섹션이 한쪽에만 있던 문제,
// 방송유형이 한쪽에만 새로 추가되던 문제) — 그래서 shared/로 옮겨 하나만 유지한다.
// notes: 자연어로 채워 열었을 때 "이 부분은 확인해 달라"는 안내 문구 목록(선택).
// 볼륨 한 줄 — 비워두면(null) 시스템 기본값을 그대로 쓴다.
// 0은 "무음"이라는 유효한 값이라 falsy로 다루면 안 되고, null과 반드시 구분해야 한다.
function VolumeRow({ label, hint, value, fallback, onChange }) {
  const useDefault = value === null || value === undefined
  return (
    <div className="border border-ds-v3-line rounded-btn px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <label className="t-sub font-semibold text-ds-v3-ink-2">{label}</label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDefault}
            onChange={e => onChange(e.target.checked ? null : fallback)}
            className="w-3.5 h-3.5 accent-ds-v3-tts"
          />
          <span className="t-sub text-ds-v3-ink-2">시스템 기본값 사용</span>
        </label>
      </div>
      {useDefault
        ? <p className="t-sub text-ds-v3-ink-2">현재 시스템 설정({fallback}%)을 따릅니다. {hint}</p>
        : (
          <div className="flex items-center gap-2">
            <input
              type="range" min="0" max="100" step="5"
              value={value}
              onChange={e => onChange(Number(e.target.value))}
              className="flex-1 accent-ds-v3-tts"
            />
            <span className="text-sm font-semibold text-ds-v3-ink nums w-12 text-right">{value}%</span>
          </div>
        )}
    </div>
  )
}

// 재생 배속 한 줄 — 비워두면(null) 원래 속도(1.0배)로 튼다.
// 노래방 방송처럼 어르신들이 따라 부르는 음원은 원래 속도가 빠르다. 느린 쪽을 먼저 놓은 건
// 실제로 쓰는 방향이 "느리게"이기 때문이다. 음정은 브라우저가 지켜준다(preservesPitch).
// 배수 목록은 없앴다 — 화면은 퍼센트로 다룬다(shared/RateInput.jsx). 저장은 배수 그대로.

function RateRow({ value, onChange }) {
  const useDefault = value === null || value === undefined
  return (
    <div className="border border-ds-v3-line rounded-btn px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <label className="t-sub font-semibold text-ds-v3-ink-2">재생 배속 (이 방송만)</label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDefault}
            onChange={e => onChange(e.target.checked ? null : 1)}
            className="w-3.5 h-3.5 accent-ds-v3-tts"
          />
          <span className="t-sub text-ds-v3-ink-2">원래 속도로</span>
        </label>
      </div>
      {useDefault
        ? <p className="t-sub text-ds-v3-ink-2">파일 그대로의 속도로 재생합니다. 어르신들이 따라 부르기 어려우면 체크를 풀고 맞추세요.</p>
        : (
          <div className="space-y-1.5">
            <RateInput
              percent={rateToPercent(value)}
              onChange={pct => onChange(percentToRate(pct))}
              withSlider
            />
            <p className="t-sub text-ds-v3-ink-2">
              정속이 <b>100%</b>입니다. 느리게 틀면 그만큼 오래 걸립니다 — 음정은 그대로 유지됩니다.
            </p>
          </div>
        )}
    </div>
  )
}

export function ScheduleModal({ schedule, onClose, onSave, notes = [], onImmediate = null }) {
  // BGM 폴더 목록을 구독한다 — 되읽어 주는 문장(「이 PC 의 〈폴더〉 에서」)이 지금 이름을 쓴다.
  useBgmFolders()
  // 기본값은 emptySchedule() 한 곳에서만 정의한다 — 자연어 파싱으로 채워 여는 경로도
  // 같은 기본값 위에 얹어야 target/has_second 같은 값이 빠지지 않는다.
  const [form,    setForm]    = useState(schedule
    ? {
        ...emptySchedule(), ...schedule, broadcast_type: schedule.broadcast_type || 'text',
        repeat_weekdays: parseWeekdays(schedule.repeat_weekdays),
        repeat_start_date: schedule.repeat_start_date || todayLocalStr(),
      }
    : emptySchedule()
  )
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  // 처음 안내(N18) 「자세히 수정」 장 — 방송 전 BGM 칸을 실제로 켜 보인다. 저장은 부르지 않는다.
  // 같은 장에서 시각·반복시작일·요일도 **입력칸만** 바꿔 보인다(사용자 지시 2026-09-17). 저장 함수는 안 부른다.
  useTourStage({
    'modal.bgm': (on) => setForm(f => ({ ...f, bgm_enabled: on ? 1 : 0 })),
    'modal.time': (v) => setForm(f => ({ ...f, scheduled_time: v })),
    'modal.start': (v) => setForm(f => ({ ...f, repeat_start_date: v })),
    // 요일을 비우고 **종료일도 비운다** — 「매주 월·수·금 반복」 시연인데 종료일이 시작일과 같으면 하루짜리로 보인다.
    'modal.days': (list) => setForm(f => ({ ...f, repeat_weekdays: Array.isArray(list) ? list : f.repeat_weekdays, repeat_end_date: null })),
    'modal.day': (dow) => setForm(f => ({ ...f, repeat_weekdays: f.repeat_weekdays.includes(dow) ? f.repeat_weekdays : [...f.repeat_weekdays, dow].sort((a, b) => a - b) })),
  })
  // 저장 안 한 입력을 실수로 날리지 않는다(G-57). **22곳의 `setForm` 을 고치지 않고**
  // 처음 값과 비교한다 — 어느 칸이 바뀌었는지는 알 필요가 없고 "바뀌었나"만 알면 된다.
  const [처음값] = useState(() => JSON.stringify(form))
  const [닫기물음, set닫기물음] = useState(false)

  // 시스템 기본 볼륨 — "기본값 사용"을 껐을 때 슬라이더가 엉뚱한 값에서 시작하지 않도록 받아온다
  const [sysVolumes, setSysVolumes] = useState({ tts: 80, audio: 100, media: 70, bgm: 70 })
  const [audioFiles, setAudioFiles] = useState([])
  const [flows,      setFlows]      = useState([])
  // 처음 모습은 **상태로 한 번만** 잡는다(`useState` 의 게으른 초기화).
  // ref 로 두면 렌더 중에 `.current` 를 읽게 되고, 그건 React 가 경고하는 자리다
  // (`react-hooks/refs`) — 값이 바뀌어도 다시 그릴 의무가 없기 때문이다.
  const 고쳤나 = 처음값 !== JSON.stringify(form)

  // **고친 게 있으면 한 번 묻고 닫는다**(G-57). 여기 적은 것은 방송 시각·문구라,
  // 잘못 닫으면 다시 처음부터 채워야 한다. 안 고쳤으면 묻지 않는다 — 아무것도 안 했는데
  // 물으면 그것대로 성가시고, 다음번에 사람이 그 물음을 안 읽게 된다.
  const 닫기 = () => { if (고쳤나) set닫기물음(true); else onClose() }

  const set       = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const setBtype  = (v)     => setForm(f => ({ ...f, broadcast_type: v }))
  const isBGM        = form.broadcast_type === 'bgm'
  const isAudio       = form.broadcast_type === 'audio'
  const isVideo       = form.broadcast_type === 'video'
  const isFlow        = form.broadcast_type === 'flow'
  const isTextReq     = form.broadcast_type === 'text'
  const needsFilePick = isAudio || isVideo
  // 이 방송의 주 소리가 어느 채널인지(유형에 따라 다르다). null이면 볼륨을 따로 못 정한다.
  const mainChannel   = MAIN_VOLUME_CHANNEL[form.broadcast_type] ?? null

  useEffect(() => {
    getVolume().then(v => setSysVolumes(v)).catch(() => { /* 실패하면 위 기본값을 쓴다 */ })
  }, [])

  // 같은 시각에 이미 있는 방송 — 저장 전에 알려주기 위한 목록. 열 때 한 번만 받아온다.
  // **막지 않는다.** 겹침을 대기·건너뛰기·끊기로 처리하는 안은 전부 지금보다 나빴다
  // (줄서기가 길어지거나, 방송 하나가 그날 안 나가거나, 긴 흐름이 잘린다).
  // 사용자 결정(2026-08-31): 그대로 두고 경고만 강하게.
  //
  // **2026-09-03: 자동방송 5종도 본다.** 예전엔 예약끼리만 봤는데 가장 흔한 겹침이
  // 자동방송이고, 실행 시점에 사고가 난다(레드 검증 F6 — 같은 분이면 예약이 먼저 나가고
  // 1.5초 뒤 자동방송이 밀어낸다). 사용자 결정: 넣을 때 알린다.
  const [siblings, setSiblings] = useState([])
  const [autoRows, setAutoRows] = useState([])
  useEffect(() => {
    getSchedules()
      .then(rows => setSiblings(Array.isArray(rows) ? rows : []))
      .catch(err => console.error('[예약] 겹침 확인용 목록 조회 실패:', err.message))
    // 자동방송의 시각(설정)과 예상 소요시간(계산)은 출처가 달라 둘 다 받는다 —
    // 소요시간을 알아야 "도는 도중"을 잡는다. 실패해도 예약끼리의 경고는 그대로 산다.
    Promise.all([getBroadcastSchedule().catch(() => ({})), getBroadcastEstimate().catch(() => ({}))])
      .then(([settings, estimate]) => setAutoRows(autoBroadcastSiblings(settings, estimate)))
      .catch(err => console.error('[예약] 자동방송 겹침 확인 실패:', err.message))
  }, [])
  const overlaps = findScheduleOverlaps(form, [...siblings, ...autoRows])

  useEffect(() => {
    if (needsFilePick) {
      getAudioFiles().then(rows => setAudioFiles(rows)).catch(() => {})
    }
  }, [needsFilePick])

  // 규칙은 scheduleUtils에 한 벌만 둔다 — AI 승인 화면(TTSBroadcast)도 같은 함수를 쓴다
  const filePickerOptions = filesForBroadcastType(audioFiles, form.broadcast_type)

  // `null` 이면 안 열려 있고, `'new'` 면 새로 만들기, 숫자 문자열이면 **그 순서를 고친다.**
  // 세 가지를 한 값으로 들고 있는 이유는, 열린 편집기가 하나뿐임을 값 자체가 말하기 때문이다.
  const [showFlowEditor, setShowFlowEditor] = useState(null)
  // 고친 뒤 단계 미리보기를 다시 받게 하는 표. 숫자가 바뀌면 다시 받는다.
  const [흐름갱신, set흐름갱신] = useState(0)
  const loadFlows = () => getFlows().then(d => setFlows(d.items || [])).catch(() => {})

  useEffect(() => {
    if (isFlow) loadFlows()
  }, [isFlow])

  const handleFlowCreated = (newFlowId) => {
    setShowFlowEditor(null)
    loadFlows()
    // 고친 경우에는 고른 흐름을 **안 바꾼다** — 이미 그것이 골라져 있다.
    // 새로 만든 경우에만 골라 준다(만들자마자 고르는 것이 사람이 기대하는 일이다).
    if (newFlowId) setForm(f => ({ ...f, flow_sequence_id: String(newFlowId) }))
    // 단계 미리보기를 다시 받게 한다 — 고쳤는데 옛 단계가 그대로 보이면 안 고쳐진 줄 안다.
    set흐름갱신(n => n + 1)
  }

  // ── **즉시 방송이면 화면이 그렇게 말한다** (탐색적 시험에서 발견, 2026-09-14) ──────
  // B-3 로 이 모달의 「저장」이 **곧바로 전관 스피커로 방송을 내보내게** 됐다. 그런데 화면은
  // 여전히 「예약 추가」·「저장」이라고 적고 반복 요일·2차 방송 칸까지 보여 줬다 —
  // **사람은 예약을 저장하는 줄 알고 누르는데 소리가 나간다.** 되돌릴 수 없는 일에
  // 그런 말을 붙이면 안 된다(G-42).
  //
  // 판정은 `handleSave` 의 갈림과 **글자 그대로 같다.** 다르면 말과 행동이 갈린다.
  const 즉시모드 = !!(onImmediate && !form.id && form.immediate)

  const handleSave = async () => {
    if (!form.title.trim() || !form.scheduled_time) {
      setError('제목과 시간을 입력해주세요.')
      return
    }
    if (isTextReq && !form.content.trim()) {
      setError('TTS 방송 내용을 입력해주세요.')
      return
    }
    if (needsFilePick && !form.audio_file_id) {
      setError(isVideo ? '재생할 영상을 선택해주세요.' : '재생할 음원을 선택해주세요.')
      return
    }
    if (isFlow && !form.flow_sequence_id) {
      setError('사용할 흐름을 선택해주세요.')
      return
    }
    if (!form.id && form.has_second) {
      if (!form.second_scheduled_time) { setError('2차 방송 시간을 선택해주세요.'); return }
      if (isTextReq && !form.second_content.trim()) { setError('2차 방송 내용을 입력해주세요.'); return }
    }
    setLoading(true); setError('')
    try {
      // ── **저장하기 전에 갈라진다** (B-3, V③ R9 지적 2026-09-14) ──────────────────
      // 「지금 방송」의 안내 음성은 **예약 행을 안 만든다.** 확정 단추 경로는 그렇게 고쳤는데
      // **이 모달만 빠져 있었다** — 여기서 저장하면 그 행이 남아 다시 나가는 길이 열리고,
      // 차임·음량·반복·BGM 도 안 붙는다(스케줄러 payload 에 그 칸이 없다).
      //
      // 부르는 쪽이 `onImmediate` 를 주면 **그쪽이 실행을 맡는다.** 안 주면 예전 그대로다
      // (관리자 화면 등 다른 호출부에 회귀가 없다).
      if (onImmediate && !form.id && form.immediate) {
        await onImmediate(form)
        setLoading(false)
        return
      }
      // 만들어진 예약을 onSave로 되돌려준다. 호출부가 방금 만든 것을 이어서 다뤄야 하는
      // 경우가 있다 — "지금 당장" 요청을 여기서 저장하면 그 자리에서 발사까지 해야 한다
      // (QuickSchedulePhrase). 인자를 안 쓰는 기존 호출부는 그대로 동작한다.
      let created = null
      if (form.id) {
        await updateSchedule(form.id, form)
      } else if (form.has_second) {
        const group_id = crypto.randomUUID()
        created = await createSchedule({ ...form, group_id })
        await createSchedule({
          ...form,
          scheduled_time: form.second_scheduled_time,
          content: form.second_content,
          group_id,
        })
      } else {
        created = await createSchedule(form)
      }
      onSave(created)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <>
    <ModalShell
      open
      onClose={닫기}
      title={즉시모드 ? '지금 방송 — 자세히' : (form.id ? '예약 수정' : '예약 추가')}
      // **두 칸이 되면서 넓힌다**(사용자 결정 2026-09-13). 512px 에 두 칸을 넣으면
      // 한 칸이 240px 이라 「방송 유형」 칩 넷이 두 줄로 접힌다.
      // 좁은 화면에서는 격자가 한 칸으로 떨어지므로 이 폭이 문제가 되지 않는다.
      width="max-w-4xl"
      // **바깥을 눌러도 안 닫힌다**(G-57). 여기 적은 것은 방송 시각·문구라, 스치듯
      // 지나간 클릭 한 번에 날아가면 안 된다. 닫는 길은 Escape·✕·「취소」 셋이고
      // 그 셋은 고친 게 있으면 한 번 묻는다.
      바깥클릭={false}
      footer={
        <>
          <button onClick={닫기}
            className="min-h-[44px] rounded-full border border-ds-v3-line-2 px-5 t-sub font-semibold
                       text-ds-v3-ink-2 transition-colors hover:bg-ds-v3-surface-2">
            취소
          </button>
          <button onClick={handleSave} disabled={loading} data-tour="modal-save"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-ds-v3-ink px-5
                       t-sub font-semibold text-white btn-press transition-colors
                       hover:bg-black disabled:opacity-60">
            {/* **단추가 하는 일을 그대로 적는다.** 즉시 방송은 저장이 아니라 발사다. */}
            <Save size={16} /> {loading
              ? (즉시모드 ? '방송 중...' : '저장 중...')
              : (즉시모드 ? '지금 방송' : '저장')}
          </button>
        </>
      }>
        <div className="space-y-4">
          {error && (
            <p className="t-sub text-ds-v3-warn bg-ds-v3-warn-bg border border-ds-v3-warn-bg rounded-btn px-3 py-2">{error}</p>
          )}

          {/* 같은 시각에 다른 방송이 있으면 알려준다 — 소리가 겹친다. 저장은 막지 않는다.
              범위는 예약 + 자동방송 5종(2026-09-03) — 가장 흔한 겹침이 자동방송이다. */}
          {overlaps.length > 0 && (
            <div className="t-sub bg-ds-v3-surface-2 border border-ds-v3-line-2 rounded-btn px-3 py-2 space-y-1">
              {overlaps.some(o => o.exact) ? (
                <p className="font-semibold text-ds-v3-ink-2">
                  🔊 이미 있는 시간입니다 — 두 방송이 동시에 나가 소리가 겹칩니다.
                </p>
              ) : overlaps.some(o => o.running) ? (
                <p className="font-semibold text-ds-v3-ink-2">
                  🔊 이미 다른 방송이 나가는 중입니다 — 그 위에 얹혀 소리가 겹칩니다.
                </p>
              ) : (
                <p className="font-semibold text-ds-v3-ink-2">
                  🔊 비슷한 시각에 다른 방송이 있습니다 — 앞 방송이 아직 나가는 중이면 소리가 겹칩니다.
                </p>
              )}
              <ul className="text-ds-v3-ink-2 space-y-0.5">
                {overlaps.slice(0, 4).map(o => (
                  <li key={o.id}>
                    · {o.time}{o.running && o.endTime ? `~${o.endTime}` : ''} {o.title}
                    {o.isAuto ? ' (자동방송)' : ''}
                    {o.exact ? ' — 같은 분' : o.running ? ' — 이 시각에 아직 나가는 중' : ''}
                  </li>
                ))}
                {overlaps.length > 4 && <li>· 외 {overlaps.length - 4}건</li>}
              </ul>
              <p className="text-ds-v3-ink-2">그래도 저장할 수 있습니다. 시각을 옮기면 겹치지 않습니다.</p>
            </div>
          )}

          {/* 자연어로 채워 열었을 때, 파서가 확신하지 못한 부분을 짚어준다 */}
          {notes.length > 0 && (
            <div className="t-sub text-ds-v3-ink-2 bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn px-3 py-2 space-y-0.5">
              {notes.map((n, i) => <p key={i}>⚠️ {n}</p>)}
            </div>
          )}

          {/* ── 두 칸으로 편다 (사용자 결정 2026-09-13) ────────────────────────────────
              *"예약추가는 좀 넓혀서 아래 있는 내용을 옆에서 설정하게 할까? 그게 흐름도도
              그렇고 한눈에 보기 좋을 것 같긴한데"*

              그전에는 한 칸에 세로로 길게 쌓여서 **BGM 설정이 화면 밖에 있었다** — 무엇을
              방송할지 정하고 나서 스크롤을 내려야 반주·시각이 보였다. 예약 하나가 내는 소리는
              대개 둘(주 소리 + BGM)인데 그 둘을 한 화면에서 못 봤다.

              가르는 축은 **「무엇을」 / 「언제·어떻게」** 다:
                왼쪽 — 유형 · 제목 · 내용 · 파일/흐름 · 볼륨 · 배속 · 반복·2차
                오른쪽 — 시각 · 대상 · 반복 요일 · 활성화 · BGM
              경고와 되묻기는 **두 칸 위에 통째로** 둔다 — 어느 한쪽 것이 아니다.

              좁은 화면에서는 한 칸으로 떨어진다(`grid-cols-1`). 여기는 화면 폭으로 갈라도
              된다 — 이 모달은 껍데기가 아니라 **창 한가운데**에 뜨므로, 남는 폭이 곧 화면 폭이다
              (업로드 화면과 다른 점이다. 거기는 관리자 사이드바가 먼저 가져간다). */}
          <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">

          <div className="bg-ds-v3-bg/60 rounded-[14px] p-3.5 space-y-3.5">
            {/* 방송 유형 선택 */}
            <div>
              <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">방송 유형</label>
              <div className="grid grid-cols-2 gap-2">
                {/* 숨긴 유형(차임벨)은 안 내놓는다 — 다만 **이미 그 값이면 남긴다**,
                    아니면 고칠 때 유형이 조용히 바뀐다(`고를수있는유형` 머리말). */}
                {고를수있는유형(form.broadcast_type).map(bt => {
                  const Icon = bt.icon
                  const sel  = form.broadcast_type === bt.value
                  return (
                    <button key={bt.value} onClick={() => setBtype(bt.value)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-btn border text-left t-sub transition-colors btn-press bg-white
                        ${sel ? `border-current bg-ds-v3-surface-2 ${bt.color} font-semibold` : 'border-ds-v3-line text-ds-v3-ink-2 hover:border-ds-v3-line-2'}`}>
                      <Icon size={14} className={sel ? bt.color : ''} />
                      <span className="leading-snug">{bt.label}</span>
                      {sel && <span className="ml-auto w-3 h-3 rounded-full bg-current flex-shrink-0 opacity-70" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 제목 */}
            <div>
              <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">제목</label>
              <input type="text" value={form.title} onChange={set('title')}
                placeholder="예: 아침 안내 방송"
                className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink bg-white
                           focus:outline-none focus:border-ds-v3-tts" />
            </div>

            {/* TTS 내용 */}
            {isTextReq && (
              <div>
                <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">방송 내용 (TTS)</label>
                <textarea rows={4} value={form.content} onChange={set('content')}
                  placeholder="방송할 내용을 입력하세요."
                  className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink bg-white
                             focus:outline-none focus:border-ds-v3-tts resize-none" />
              </div>
            )}

            {/* 음원선택 / 업로드영상 — 전부 audio_files에서 카테고리로 골라 고른다 */}
            {needsFilePick && (
              <div>
                <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">
                  {isVideo ? '영상 선택' : '음원 선택'}
                </label>
                {filePickerOptions.length === 0
                  ? <p className="t-sub text-ds-v3-ink-2 py-2">
                      {isVideo && '업로드된 영상이 없습니다. 음원 및 동영상 관리에서 먼저 업로드하세요.'}
                      {isAudio && '업로드된 음원이 없습니다. 음원 및 동영상 관리에서 먼저 업로드하세요.'}
                    </p>
                  : <select value={form.audio_file_id || ''}
                      onChange={e => setForm(f => ({ ...f, audio_file_id: e.target.value }))}
                      className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink
                                 focus:outline-none focus:border-ds-v3-tts bg-white">
                      <option value="">선택하세요</option>
                      {filePickerOptions.map(af => (
                        <option key={af.id} value={String(af.id)}>
                          [{af.category}] {af.original_name}
                        </option>
                      ))}
                    </select>
                }
              </div>
            )}

            {/* 방송 흐름 선택 */}
            {/* 흐름 고르기는 **오른쪽 칸으로 옮겼다**(2026-09-15) — 「대상」이 비운 자리다.
                여기 두면 왼쪽이 길어지고, 고른 뒤 단계를 펼 자리가 없었다. */}
          </div>

          {/* ── BGM / BGM 재생 ── */}
          <div className="border border-ds-v3-line rounded-[12px] overflow-hidden">
            {/* **순서(flow)에서도 안 묻는다** (사용자 결정 2026-09-15). 서버가 흐름
                갈래에서 `bgm_enabled` 를 안 읽어서, 체크해도 아무 음악이 안 나갔다 —
                오류도 안 나는 조용한 오독이었다. 규칙은 `scheduleUtils` 한 곳이다. */}
            {BGM물음이있나(form.broadcast_type) && (
              <label data-tour="modal-bgm" className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-ds-v3-bg">
                <input type="checkbox" checked={!!form.bgm_enabled}
                  onChange={e => setForm(f => ({ ...f, bgm_enabled: e.target.checked ? 1 : 0 }))}
                  className="w-4 h-4 accent-ds-v3-warn" />
                <Music2 size={15} className="text-ds-v3-warn flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ds-v3-ink">방송 전 BGM</p>
                  <p className="t-sub text-ds-v3-ink-2">BGM이 먼저 재생되고, 설정한 시간 후 방송이 나옵니다</p>
                </div>
              </label>
            )}
            {isBGM && (
              <div className="flex items-center gap-3 px-4 py-3 bg-ds-v3-warn-bg">
                <Music2 size={15} className="text-ds-v3-warn flex-shrink-0" />
                <p className="text-sm font-semibold text-ds-v3-warn">BGM 재생 설정</p>
              </div>
            )}

            {/* 세부 칸도 같이 감춘다 — 물음만 감추고 세부가 남으면 더 헷갈린다. */}
            {(isBGM || (!!form.bgm_enabled && BGM물음이있나(form.broadcast_type))) && (
              <div className="px-4 py-4 space-y-3 border-t border-ds-v3-line">
                {/* BGM 유형 */}
                <div>
                  {/* 「BGM 폴더」 제목은 고르개가 목록과 함께 단다(2026-09-22) — 여기 또 달면 두 번 보인다 */}
                  <BgmSourcePicker
                    value={form.bgm_type}
                    onChange={(t) => setForm(f => ({ ...f, bgm_type: t }))}
                    rowClass="flex gap-1.5 flex-wrap"
                    chipClass={(고름) => `py-2 px-3 rounded-btn t-sub font-semibold border transition-colors btn-press
                      ${고름 ? 'bg-ds-v3-warn text-white border-ds-v3-warn'
                             : 'bg-white text-ds-v3-ink-2 border-ds-v3-line hover:border-ds-v3-warn'}`}
                  />
                </div>

                {/* 이 PC 음원(방송용·식사용) — 어느 폴더를 어떤 차례로 트는지 한 문장으로 되읽어 준다 */}
                {bgmSourceOf(form.bgm_type) && (
                  <div className="bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn px-3 py-2">
                    <p className="t-sub font-semibold text-ds-v3-ink-2 mb-0.5">{bgmTypeLabel(form.bgm_type)}</p>
                    <p className="t-sub text-ds-v3-ink-2">
                      이 PC 의 「{bgmFolderName(bgmSourceOf(form.bgm_type))}」 폴더에서
                      {bgmOrderOf(form.bgm_type) === 'seq'
                        ? ' 순서 편집에서 정한 순서대로 틀고, 다음 방송은 다음 곡부터 시작합니다.'
                        : ' 틀 때마다 곡 순서를 섞어 재생합니다.'}
                    </p>
                  </div>
                )}

                {/* BGM 볼륨 (이 방송만) */}
                <VolumeRow
                  label="BGM 볼륨 (이 방송만)"
                  hint="이 예약에만 적용되며 다른 방송의 BGM은 그대로입니다."
                  value={form.bgm_volume ?? null}
                  fallback={sysVolumes.bgm ?? 70}
                  onChange={v => setForm(f => ({ ...f, bgm_volume: v }))}
                />

                {/* BGM 타이밍 — 앞뒤 두 칸을 **나란히** 둔다 (UX-17).
                    예전엔 앞(선재생)만 있었다. 뒤(TTS 끝난 뒤 지속)는 화면에도 없었고
                    DB 칸도 없어서, 안내가 끝나는 순간 BGM 이 뚝 끊겼다. */}
                {!isBGM && (
                  <div>
                    <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-1.5">
                      BGM 타이밍
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-ds-v3-ink-2">방송 시작</span>
                      <input type="number" min={0} max={60} value={form.bgm_delay}
                        aria-label="방송 시작 전 BGM 선재생 시간(초)"
                        onChange={e => setForm(f => ({ ...f, bgm_delay: Number(e.target.value) }))}
                        className="w-16 border border-ds-v3-line rounded-btn px-2 py-2 text-sm text-ds-v3-ink
                                   focus:outline-none focus:border-ds-v3-warn nums text-center" />
                      <span className="text-sm text-ds-v3-ink-2">초 전부터,  안내가 끝나고</span>
                      <input type="number" min={0} max={120} value={form.bgm_end_delay ?? 0}
                        aria-label="안내가 끝난 뒤 BGM 지속 시간(초)"
                        onChange={e => setForm(f => ({ ...f, bgm_end_delay: Number(e.target.value) }))}
                        className="w-16 border border-ds-v3-line rounded-btn px-2 py-2 text-sm text-ds-v3-ink
                                   focus:outline-none focus:border-ds-v3-warn nums text-center" />
                      <span className="text-sm text-ds-v3-ink-2">초 더</span>
                    </div>
                    {/* 실제로 무슨 일이 일어나는지 적는다 — 덕킹과 페이드는 이미 동작하는데
                        화면 어디에도 그 말이 없어서, 사람은 BGM 이 안내를 덮는 줄 안다. */}
                    <p className="t-sub text-ds-v3-ink-2 mt-2 leading-relaxed">
                      BGM이 먼저 흐르다가 <span className="font-semibold text-ds-v3-ink">안내가 나오는 동안
                      저절로 작아지고</span>, 안내가 끝나면 위에서 정한 시간만큼 더 흐르다 꺼집니다.
                      켜지고 꺼지는 것은 부드럽게 이어지며 <span className="font-semibold text-ds-v3-ink">그 시간 안에 포함</span>됩니다.
                      {(form.bgm_end_delay ?? 0) === 0 && (
                        <span className="text-ds-v3-ink-2"> 지금은 뒤가 0초라 안내가 끝나는 순간 BGM도 함께 멈춥니다.</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 재생 배속 — 볼륨과 같은 원칙으로 이 예약에만 실린다(전역 설정을 안 건드린다).
              노래방·동요처럼 어르신들이 따라 부르는 방송을 느리게 트는 용도. */}
          {RATE_TYPES.includes(form.broadcast_type) && (
            <RateRow
              value={form.playback_rate ?? null}
              onChange={v => setForm(f => ({ ...f, playback_rate: v }))}
            />
          )}

          </div>{/* ── 왼쪽 칸 끝 ── */}

          <div className="space-y-4">{/* ── 오른쪽 칸: 언제·어떻게 ── */}

          {/* ── **「대상」을 걷었다** (사용자 지시 2026-09-15) ─────────────────────────
              *"대상이 나오는데 대상은 없어, 필요없는 기능이야."* — 맞다. 재 보니 그렇다.

              `['전체','1층','2층','3층']` 은 **이 파일에만** 있던 목록이고, 재생 경로
              어디도 그 값을 안 읽는다(SSE·오디오 큐·오디오 백엔드·화면 재생 훅 전부
              0건). **소리는 층별로 안 갈린다** — 고르든 말든 같은 스피커로 나간다.
              고를 수 있는데 아무 일도 안 일어나는 칸은, 사람이 「골랐으니 거기로 나가겠지」
              라고 믿게 만든다. 그게 이 저장소가 가장 경계하는 조용한 오독이다.

              **값 자체는 안 없앤다** — `form.target` 은 기본값 「전체」로 그대로 흐르고,
              이력(`broadcasts.target`)과 겹침 판정 열쇠는 예전 그대로다. 지운 것은
              **고르는 칸**이지 칸에 들어가던 값이 아니다.

              **시간은 즉시 방송에 없다**(탐색적 시험 2026-09-14) — 「지금 방송」인데 시각
              칸이 보이면 사람은 그 시각에 나간다고 믿는데, 이 길은 그 값을 안 쓴다. */}
          {!즉시모드 && (
            <div>
              <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">시간</label>
              <input type="time" value={form.scheduled_time} onChange={set('scheduled_time')} data-tour="modal-time"
                className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts" />
            </div>
          )}

          {/* ── 순서는 **오른쪽에서 고르고 그 자리에서 보인다** (사용자 지시 2026-09-15) ──
              *"차라리 저기다가 사용할 흐름 넣어놓고, 선택하면 밑에 방송 플로우가
                보였으면 좋겠는데."*

              「대상」이 비운 자리다. 왼쪽에 있던 흐름 고르개를 여기로 옮기고, 고른 흐름의
              **단계를 그 자리에 편다** — 고르고 나서 「무엇이 나가는지」를 보려고 자동순서
              화면까지 다녀와야 했던 것이 없어진다. */}
          {isFlow && <FlowPicker
            flows={flows} value={form.flow_sequence_id}
            onChange={(v) => setForm(f => ({ ...f, flow_sequence_id: v }))}
            onNew={() => setShowFlowEditor('new')}
            onEdit={(id) => setShowFlowEditor(String(id))}
            새로고침={흐름갱신} />}

          {/* ── 즉시 방송에는 **반복이 없다** (탐색적 시험 2026-09-14) ─────────────────
              「지금 방송」인데 반복시작일·종료일·요일 일곱이 보이면, 사람은 **그 값이 쓰인다고
              믿는다.** 안 쓰인다 — 이 길은 예약 행을 아예 안 만든다(B-3).
              *"지원되지 않는 옵션을 조용히 무시하거나 UI 에만 남기지 마라"* 가 지시였다.
              **값은 안 건드린다. 묻지 않을 뿐이다**(볼륨에서 세운 원칙과 같다). */}
          {!즉시모드 && (
            <RepeatPicker
              value={{ repeat_start_date: form.repeat_start_date, repeat_end_date: form.repeat_end_date, repeat_weekdays: form.repeat_weekdays }}
              onChange={patch => setForm(f => ({ ...f, ...patch }))}
            />
          )}

          {/* 이 방송에만 적용할 볼륨 — 시스템 설정은 건드리지 않는다.
              자연어("볼륨은 잔잔하게")로도 채워지는 값이라, 여기서 보이고 고칠 수 있어야
              "왜 이 방송만 작지?"를 화면에서 확인할 수 있다. */}
          {mainChannel && (
            <VolumeRow
              label={`${VOLUME_CHANNEL_LABEL[mainChannel]} 볼륨 (이 방송만)`}
              hint="이 예약에만 적용되며 다른 방송은 그대로입니다."
              value={form.main_volume ?? null}
              fallback={sysVolumes[mainChannel] ?? 80}
              onChange={v => setForm(f => ({ ...f, main_volume: v }))}
            />
          )}

          {/* 반복 방송 */}
          {isTextReq && (
            <label className="flex items-center gap-2.5 cursor-pointer bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2.5">
              <input type="checkbox" checked={!!form.repeat_broadcast}
                onChange={e => setForm(f => ({ ...f, repeat_broadcast: e.target.checked ? 1 : 0 }))}
                className="w-4 h-4 accent-ds-v3-tts" />
              <div>
                <p className="text-sm text-ds-v3-ink font-normal">방송 2회 반복</p>
                <p className="t-sub text-ds-v3-ink-2">방송 후 "다시 한번 알려드립니다" 멘트와 함께 한 번 더 재생</p>
              </div>
            </label>
          )}

          {/* 2차 방송 — 새 예약을 만들 때만(쉬운화면 QuickAddBtn과 동일하게 group_id로 묶어 생성).
              **즉시 방송에는 없다** — 2차는 예약 행 둘을 묶는 것인데 이 길은 행을 안 만든다. */}
          {!form.id && !즉시모드 && (
            <>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={!!form.has_second}
                  onChange={e => setForm(f => ({ ...f, has_second: e.target.checked }))}
                  className="w-4 h-4 accent-ds-v3-tts cursor-pointer" />
                <span className={`text-sm font-normal ${form.has_second ? 'text-ds-v3-tts' : 'text-ds-v3-ink'}`}>
                  2차 방송 추가
                </span>
                {form.has_second && <span className="t-sub text-ds-v3-ink-2">(오늘 일정에서 1차·2차 묶음으로 표시)</span>}
              </label>

              {form.has_second && (
                <div className="bg-ds-v3-tts-bg border border-ds-v3-tts/20 rounded-btn px-4 py-3 space-y-3">
                  <div className="t-sub font-semibold text-ds-v3-tts">2차 방송</div>
                  <div>
                    <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-1.5">2차 방송 시간</label>
                    <input type="time" value={form.second_scheduled_time}
                      onChange={e => setForm(f => ({ ...f, second_scheduled_time: e.target.value }))}
                      className="w-full border border-ds-v3-line bg-white rounded-btn px-3 py-2 text-sm text-ds-v3-ink
                                 focus:outline-none focus:border-ds-v3-tts" />
                  </div>
                  {isTextReq && (
                    <div>
                      <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-1.5">2차 방송 내용</label>
                      <textarea rows={2} value={form.second_content}
                        onChange={e => setForm(f => ({ ...f, second_content: e.target.value }))}
                        placeholder="2차 방송할 텍스트를 입력하세요"
                        className="w-full border border-ds-v3-line bg-white rounded-btn px-3 py-2 text-sm text-ds-v3-ink
                                   focus:outline-none focus:border-ds-v3-tts resize-none" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          </div>{/* ── 오른쪽 칸 끝 ── */}
          </div>{/* ── 두 칸 격자 끝 ── */}
        </div>

    </ModalShell>

    {/* 고친 것을 버리기 전에 한 번 묻는다 — 되돌릴 수 없는 것은 방송만이 아니다. */}
    <ConfirmDialog
      open={닫기물음}
      title="저장하지 않고 닫을까요?"
      body="고친 내용이 사라집니다."
      confirmLabel="저장 안 하고 닫기"
      onConfirm={() => { set닫기물음(false); onClose() }}
      onClose={() => set닫기물음(false)}
    />

    {showFlowEditor && (
      <FlowEditorModal flowId={showFlowEditor === 'new' ? null : showFlowEditor}
        onClose={() => setShowFlowEditor(null)}
        onSaved={handleFlowCreated} />
    )}
    </>
  )
}
