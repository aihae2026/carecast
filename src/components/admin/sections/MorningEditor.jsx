// 방송 일정 편집기 — 07:50 아침 방송 / 09:00 국민체조 / 11:15 식사전체조 / 16:15 식사전체조 / 18:00 저녁 마무리
import { useState, useEffect, useRef } from 'react'
import { Clock, Save, RotateCcw, Radio, Plus, Trash2, Sparkles, Copy, Workflow } from 'lucide-react'
import Toggle from '../../shared/Toggle'
import { localToday } from '../../../lib/localDate'
import { parseWeekdays } from '../../../lib/scheduleUtils'
import { findScheduleOverlap } from '../../../lib/scheduleOverlap'
import { autoName } from '../../../lib/autoBroadcastNames'
import { audioBus } from '../../../lib/audioBus'
import { FlowEditorModal } from '../../shared/FlowBuilder'
// 커스텀 자동순서 미리보기의 왼쪽 분홍 선 — 편집 화면(FlowBuilder)과 **같은 규칙·같은 그림**을
// 쓴다. 규칙과 근거는 src/lib/bgmLane.js 머리말.

import {
  // 자동방송 5종의 발사 API 는 여기서 부르지 않는다 — `lib/broadcastTrigger.js` 의
  // `AUTO_TRIGGER` 한 곳이 그 표를 갖는다(같은 표를 두 벌 두면 하나만 고쳤을 때
  // 그 방송만 조용히 안 나간다).
  getBroadcastSchedule, saveBroadcastSchedule, getBroadcastEstimate, morningPreview, getSchedules, createSchedule, updateSchedule, deleteSchedule, triggerSchedule, getFlow, deleteFlow, getFlows, duplicateFlow, stopBroadcast,
} from '../../../lib/api'

import ConfirmDialog from '../../shared/ConfirmDialog'
import { AUTO_TRIGGER } from '../../../lib/broadcastTrigger'
import { TABS, DEFAULT_STEPS } from './morningEditorConst'
import {
  OrphanFlowPanel, CustomSequencePanel, MorningTabContent, ExerciseTabContent, LunchTabContent, DinnerTabContent, EveningPrayerTabContent,
} from './morningEditorPanels'

/**
 * 화면에 보여줄 시각 문구 (P-40, 2026-09-08).
 *
 * **빈 시각은 "사람이 껐다"이지 "설정이 없다"가 아니다**(사용자 결정 AP-0016).
 * 서버는 그 방송을 안 내보내는데(`domain/autoBroadcasts.js` 의 `autoTime`) 화면만 기본 시각을
 * 보여주면, **관리자가 껐다고 생각한 방송이 07:50 에 걸려 있는 것처럼 보인다.**
 * P-35 수정이 서버 여섯 곳을 고쳤는데 이 화면이 남아 있었다.
 *
 * - 저장된 값이 있으면 그대로
 * - **빈 문자열이면 "꺼짐"** — 기본 시각으로 되살리지 않는다
 * - 키 자체가 없으면(설정을 만든 적 없음) 정의표의 기본 시각
 */
function timeLabel(saved, defaultTime) {
  // 공백만 있는 값도 '꺼짐'이다 — 서버 발동부(`autoTime`)가 그것을 버려 방송을 안 내보내므로,
  // 화면만 공백을 그대로 보여주면 또 갈린다(2026-09-08 독립 검수 지적).
  if (saved === null || (typeof saved === 'string' && saved.trim() === '')) return '꺼짐'
  return saved || defaultTime
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function BroadcastScheduleEditor() {
  const [activeTab, setActiveTab] = useState('morning')
  // 단계 편집 관문 — 잠금이 기본이다. 스냅샷은 「취소」가 되돌릴 자리(서버는 안 건드린다).
  const [editingSteps,  setEditingSteps]  = useState(false)
  const [stepsSnapshot, setStepsSnapshot] = useState(null)
  const [settings,  setSettings]  = useState(null)
  // 설정 불러오기가 실패했다는 사실. 예전엔 .catch(() => {})로 삼켜서, 요청이 한 번만
  // 삐끗해도 "설정을 불러오는 중..." 문구에 **영구히** 갇혔다(재시도도 안내도 없음).
  // 다른 화면(주간표·예약방송·개발일지·음원관리)은 전부 finally로 로딩을 풀어 빈 목록으로라도
  // 뜨는데 여기만 예외였다.
  const [loadError, setLoadError] = useState(null)
  const [loadTick,  setLoadTick]  = useState(0)   // "다시 시도" 버튼이 올린다
  const [saving,    setSaving]     = useState(false)
  // 방송별 예상 소요시간. **서버가 계산해서 준다** — 단계마다 얼마나 기다리는지 아는 것은
  // 실행하는 쪽이라, 화면이 따로 세면 두 숫자가 갈린다.
  const [estimate,  setEstimate]   = useState(null)
  // 화면에서 고친 뒤 아직 저장 안 한 상태 — 그때는 숫자가 옛 구성 기준이다
  const [estimateStale, setEstimateStale] = useState(false)
  const [estimateError, setEstimateError] = useState(false)
  const [showSkipped, setShowSkipped]     = useState(false)   // 점검 목록 펼침
  // 「지금 방송」 확인창. **되돌릴 수 없는 동작을 한 번 눌러서 발사하지 않는다**(G-42) —
  // 여기는 편집 화면이라 사람이 저장하려다 옆 단추를 누르기 쉽다.
  const [ask, setAsk] = useState(false)
  const [status,    setStatus]     = useState('')
  const [playing,   setPlaying]    = useState(false)
  const audioRef = useRef(null)
  const previewBusRef = useRef(null)   // [audioBus] 미리듣기 장부 등록 손잡이

  // 커스텀 자동순서 — schedules 테이블(broadcast_type='flow', managed_by='morning_editor')을
  // 5개 고정 탭과 같은 사이드바에 이어서 보여준다. 실행은 이미 있는 scheduler.js의 일반
  // schedules 폴링이 그대로 처리하므로 여기선 목록 관리 UI만 있으면 된다.
  const [customSequences,   setCustomSequences]   = useState([])
  const [showNewFlowEditor, setShowNewFlowEditor] = useState(false)
  const [showEditFlowId,    setShowEditFlowId]    = useState(null)
  const [flowRefreshTick,   setFlowRefreshTick]   = useState(0)  // "단계 편집" 저장 후 인라인 미리보기 새로고침용

  // 저장된 흐름 전부. 예약이 안 붙은 흐름(예전에 예약방송관리에서 만든 것)도 여기 보여준다 —
  // 만들었는데 화면에 따라 보였다 안 보였다 하는 것이 가장 헷갈린다.
  const [flows, setFlows] = useState([])
  const [copyingFlowId, setCopyingFlowId] = useState(null)
  const [copyName, setCopyName] = useState('')
  const [copying, setCopying] = useState(false)

  const loadCustomSequences = () =>
    Promise.all([getSchedules(), getFlows().catch(() => ({ items: [] }))])
      .then(([rows, f]) => {
        setCustomSequences(rows.filter(s => s.managed_by === 'morning_editor'))
        setFlows(f.items || [])
      })
      .catch(() => {})

  useEffect(() => { loadCustomSequences() }, [])

  // 예약이 안 붙은 흐름 — 시각이 없어서 저절로는 안 나간다
  const orphanFlows = flows.filter(fl => !customSequences.some(cs => cs.flow_sequence_id === fl.id))

  const [copyTime, setCopyTime] = useState('')
  const startCopy = (name, flowId, time = '') => {
    setCopyingFlowId(flowId)
    setCopyName(`${name} (복사본)`)
    setCopyTime(time)
  }
  const cancelCopy = () => { setCopyingFlowId(null); setCopyName(''); setCopyTime('') }

  // 흐름을 복사한다. 짝이 되는 예약은 **정지 상태로** 만든다 —
  // 복사하자마자 매일 저절로 나가기 시작하면 요양원에서는 사고다.
  // (「새 자동순서」도 같은 이유로 active: 0으로 만든다.)
  const handleDuplicateFlow = async (flowId, time) => {
    if (copying) return
    setCopying(true)
    try {
      const { id: newFlowId } = await duplicateFlow(flowId, copyName)
      const flow = await getFlow(newFlowId)
      const created = await createSchedule({
        title: flow.name, target: '전체', scheduled_time: time || '07:00', active: 0,
        broadcast_type: 'flow', flow_sequence_id: newFlowId, managed_by: 'morning_editor',
        repeat_start_date: localToday(), repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      cancelCopy()
      await loadCustomSequences()
      setActiveTab(created.id)
    } catch (err) {
      alert('복제 실패: ' + err.message)
    } finally {
      setCopying(false)
    }
  }

  // 예약 없는 흐름 삭제 — 짝이 되는 예약이 없으니 흐름만 지운다.
  const handleDeleteOrphanFlow = async (flowId) => {
    const fl = flows.find(x => x.id === flowId)
    if (!confirm(`"${fl?.name ?? "이 흐름"}"을(를) 삭제하시겠습니까?`)) return
    try {
      await deleteFlow(flowId)
      setActiveTab('morning')
      await loadCustomSequences()
    } catch (err) {
      alert('삭제 실패: ' + err.message)
    }
  }

  // 예약 없는 흐름에 시각을 붙여 자동순서로 만든다(정지 상태로 시작).
  const handleAdoptFlow = async (fl) => {
    try {
      const created = await createSchedule({
        title: fl.name, target: '전체', scheduled_time: '07:00', active: 0,
        broadcast_type: 'flow', flow_sequence_id: fl.id, managed_by: 'morning_editor',
        repeat_start_date: localToday(), repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      await loadCustomSequences()
      setActiveTab(created.id)
    } catch (err) {
      alert('자동순서로 만들기 실패: ' + err.message)
    }
  }

  const activeCustom = customSequences.find(s => s.id === activeTab)

  // 예약 없는 흐름을 고르면 activeTab이 'flow_<id>'가 된다 — 예약 id(숫자)와 안 겹치게 접두를 붙인다
  const activeOrphanId = typeof activeTab === 'string' && activeTab.startsWith('flow_')
    ? Number(activeTab.slice(5)) : null

  // 새 자동순서 만들기 — 먼저 흐름(이름+단계)을 채우게 하고, 저장되면 짝이 되는 schedules row를 만든다
  const handleNewFlowSaved = async (newFlowId) => {
    setShowNewFlowEditor(false)
    if (!newFlowId) return
    try {
      const flow = await getFlow(newFlowId)
      const created = await createSchedule({
        title: flow.name, target: '전체', scheduled_time: '07:00', active: 0,
        broadcast_type: 'flow', flow_sequence_id: newFlowId, managed_by: 'morning_editor',
        // 서버의 shouldRunToday가 로컬 날짜로 비교한다 — UTC로 넣으면 09시 이전에 하루 일찍 시작한다
        repeat_start_date: localToday(), repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      await loadCustomSequences()
      setActiveTab(created.id)
    } catch (err) {
      alert('자동순서 생성 실패: ' + err.message)
    }
  }

  const handleDeleteCustomSequence = async (cs) => {
    if (!confirm(`"${cs.title}" 자동순서를 삭제하시겠습니까?`)) return
    try {
      await deleteSchedule(cs.id)
      if (cs.flow_sequence_id) await deleteFlow(cs.flow_sequence_id).catch(() => {})
      if (activeTab === cs.id) setActiveTab('morning')
      await loadCustomSequences()
    } catch (err) {
      alert('삭제 실패: ' + err.message)
    }
  }

  // 커스텀 자동순서의 이름/활성/시간 저장 — PUT은 전체 필드를 덮어쓰므로 기존 값 위에 patch만 얹는다
  // (managed_by를 매번 같이 안 보내면 다음 저장 때 사이드바 목록에서 사라짐)
  const saveCustomFields = async (patch) => {
    if (!activeCustom) return
    try {
      await updateSchedule(activeCustom.id, {
        ...activeCustom, ...patch, managed_by: 'morning_editor',
        repeat_weekdays: parseWeekdays(activeCustom.repeat_weekdays),
      })
      await loadCustomSequences()
    } catch (err) {
      alert('저장 실패: ' + err.message)
    }
  }

  const handleCustomTrigger = async () => {
    if (!activeCustom) return
    try {
      await triggerSchedule(activeCustom.id)
      setStatus('✓ 방송 시작됨')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      alert(err.message)
    }
  }

  // 「지금 방송」으로 발사한 것을 그 자리에서 끈다 (2026-09-03 실기 신고 — 정지는 쉬운
  // 화면 아래 바에만 있어서 관리자 화면에서 쏜 사람은 끌 방법이 없었다). 새 정지 경로가
  // 아니라 기존 전체 정지 길(POST /api/morning/stop → stopCurrentBroadcast) 그대로다.
  const handleCustomStop = async () => {
    try {
      await stopBroadcast()
      setStatus('■ 정지했습니다')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      alert(err.message)
    }
  }

  // 예상 소요시간 새로 받기 — 처음 한 번과 **저장 뒤**. 저장 전에는 서버가 아직 옛 구성을
  // 보고 있으므로 다시 물어봐야 화면 숫자와 실제가 맞는다.
  // 늦게 도착한 옛 응답이 새 응답을 덮지 않게 요청에 번호를 매긴다. 저장을 연달아 누르거나
  // 응답을 기다리는 동안 구성을 더 만지면, 옛 응답이 도착하면서 **"저장 전 값입니다" 표시까지
  // 지워** 화면이 옛 숫자를 현재 값인 척 보여줬다.
  const estimateReqRef = useRef(0)
  const loadEstimate = () => {
    const seq = ++estimateReqRef.current
    getBroadcastEstimate()
      .then(d => {
        if (seq !== estimateReqRef.current) return   // 그 사이 새 요청이 나갔다 — 이 답은 이미 낡았다
        setEstimate(d); setEstimateStale(false); setEstimateError(false)
      })
      .catch((err) => {
        if (seq !== estimateReqRef.current) return
        // 조용히 지우면 "이 방송엔 원래 표시가 없나 보다"와 구별할 수 없다 — 줄은 남기고 사유를 적는다.
        console.warn('[예상 소요시간] 계산을 받지 못했습니다:', err?.message || err)
        setEstimate(null); setEstimateError(true)
      })
  }
  useEffect(() => { loadEstimate() }, [])

  // 서버에서 설정 로드
  // 실패를 삼키지 않는다 — 삼키면 화면이 "불러오는 중"에서 영원히 안 넘어간다. 서버가 잠깐
  // 느렸을 뿐인 경우가 대부분이라 한 번은 자동으로 다시 걸어보고, 그래도 안 되면 사유와
  // "다시 시도" 버튼을 보여준다.
  useEffect(() => {
    let cancelled = false
    let retryTimer = null

    const load = (isRetry) => getBroadcastSchedule()
      .then(data => {
        if (cancelled) return
        if (!data.evening_prayer?.steps) {
          data.evening_prayer = {
            enabled: true,
            time: '18:00',
            steps: DEFAULT_STEPS.evening_prayer,
            tts: '',
            ...data.evening_prayer,
          }
        }
        setSettings(data)
        setLoadError(null)
      })
      .catch(err => {
        if (cancelled) return
        if (!isRetry) { retryTimer = setTimeout(() => load(true), 1500); return }
        setLoadError(err?.message || '서버에서 설정을 받지 못했습니다.')
      })

    // setState는 콜백 안에서만 부른다(react-hooks/set-state-in-effect) — 사유 초기화는
    // "다시 시도" 버튼 쪽에서 loadTick을 올릴 때 같이 한다.
    load(false)
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [loadTick])

  // 단계 편집 관문 — 열 때 스냅샷을 뜬다. 「취소」는 이 스냅샷으로 되돌릴 뿐 서버를 안 부른다.
  const stepsDirty = editingSteps && stepsSnapshot !== null
    && JSON.stringify(settings) !== stepsSnapshot

  const startEditSteps = () => {
    setStepsSnapshot(JSON.stringify(settings))
    setEditingSteps(true)
  }
  const cancelEditSteps = () => {
    if (stepsDirty && !confirm('고친 내용을 버리고 편집을 끝낼까요?')) return
    if (stepsSnapshot) setSettings(JSON.parse(stepsSnapshot))
    setStepsSnapshot(null)
    setEditingSteps(false)
  }
  // 탭을 옮기면 편집은 풀린다 — 잠금이 걸린 탭과 안 걸린 탭이 섞이면 무엇이 잠겼는지 알 수 없다.
  const switchTab = (id) => {
    if (id === activeTab) return
    if (stepsDirty && !confirm('저장하지 않은 단계 변경이 있습니다. 버리고 이동할까요?')) return
    if (editingSteps && stepsSnapshot) setSettings(JSON.parse(stepsSnapshot))
    setStepsSnapshot(null)
    setEditingSteps(false)
    setActiveTab(id)
  }

  // 저장
  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setStatus('')
    try {
      await saveBroadcastSchedule(settings)
      loadEstimate()   // 바뀐 구성으로 다시 계산해 온다
      // **저장 뒤에는 다시 불러온다**(2026-09-13). 연결 고르개가 읽는 `sourceResolved` 는
      // 서버가 짓는 파생값이라, 저장만 하고 화면에 남은 것을 계속 쓰면 **방금 저장한 연결이
      // 서버 판정과 갈린다** — 특히 기본값으로 되돌렸을 때(그 값은 서버만 안다)와
      // 연결한 대상이 사이에 사라졌을 때 화면이 옛 말을 계속 한다.
      setLoadTick(t => t + 1)
      // 저장했으면 다시 잠근다 — 열어 둔 채로 두면 관문이 있으나 마나다
      setStepsSnapshot(null)
      setEditingSteps(false)
      setStatus('✓ 저장 완료')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      // 개인정보 확인창에서 「취소」를 고른 것은 오류가 아니다 — 저장 안 된 채로 둔다.
      if (!err.cancelled) setStatus(`오류: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // 다섯 탭이 같은 관문을 쓴다 — 탭마다 따로 만들면 한 곳만 고쳐도 나머지가 안 따라온다
  const stepsGate = {
    editing: editingSteps, dirty: stepsDirty, saving,
    onEdit: startEditSteps, onCancel: cancelEditSteps, onSave: handleSave,
  }

  // 기본값 복원
  const handleReset = () => {
    const t = TABS.find(x => x.id === activeTab)
    const label = `${timeLabel(settings?.[activeTab]?.time, t?.defaultTime)} ${autoName(settings, activeTab)}`
    if (!confirm(`${label} 단계를 기본값으로 복원하시겠습니까?`)) return
    setSettings(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        steps: DEFAULT_STEPS[activeTab].map((s, i) => ({ ...s, order: i })),
      },
    }))
    // updateTab을 안 거치는 유일한 구성 변경이다 — 여기서 안 세우면 단계를 통째로 갈아엎고도
    // 화면이 옛 숫자를 "저장 전" 표시 없이 현재 값으로 보여준다.
    setEstimateStale(true)
  }

  // 지금 방송 버튼
  // **어느 API 가 이 줄을 쏘는가는 `lib/broadcastTrigger.js` 한 곳에서만 정한다.**
  // 여기 같은 표(morning→triggerMorningBroadcast …)가 한 벌 더 있었다 — 자동방송이
  // 하나 늘면 두 곳을 고쳐야 하고, 한 곳만 고치면 그 방송만 조용히 안 나간다.
  const handleTrigger = async () => {
    setAsk(false)
    try {
      await AUTO_TRIGGER[activeTab]()
      setStatus('✓ 방송 시작됨')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      alert(err.message)
    }
  }

  // 이 화면의 미리듣기만 끈다 — 전역 정지 신호는 쏘지 않는다(실제 방송은 우리 것이 아니다)
  const stopPreview = () => {
    if (audioRef.current) {
      try { audioRef.current.pause() } catch { /* 이미 끝났으면 그만 */ }
      audioRef.current = null
    }
    previewBusRef.current?.done(); previewBusRef.current = null
    setPlaying(false)
  }

  // 아침 방송 날씨 미리 듣기
  const handlePreview = async () => {
    if (playing) return
    setPlaying(true)
    try {
      const blob = await morningPreview()
      const url  = URL.createObjectURL(blob)
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      // [audioBus] 아침방송 날씨 미리듣기 등록 — 자연 종료 때 해제.
      // stop을 함께 넘긴다 — 실제 방송이 시작되면 장부가 이 손잡이로 비키게 한다(td09 H9)
      previewBusRef.current?.done()
      previewBusRef.current = audioBus.register({
        kind: 'preview-tts', label: '아침방송 미리듣기', stop: () => stopPreview(),
      })
      audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
      audio.play()
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url) }
    } catch (err) {
      alert(err.message)
      setPlaying(false)
    }
  }

  // **화면을 떠나면 이 화면의 미리듣기를 끊는다(2026-09-02, td09 H4).**
  // 자기 것만 끈다 — 전역 정지 신호도 stopKinds도 부르지 않는다(다른 화면 미리듣기까지 죽는다).
  useEffect(() => () => { stopPreview() }, [])

  // 탭 데이터 변경 헬퍼
  const updateTab = (tab, patch) => {
    // 예상 시간은 **저장된 구성**으로 서버가 계산한 값이다. 지금 화면에서 고친 것은 아직
    // 안 들어가 있으므로, 고치는 순간 "옛 숫자"임을 화면에 알린다 — 이 기능이 필요한
    // 바로 그 순간(시작 시각을 정할 때) 거짓말을 하면 안 된다.
    setEstimateStale(true)
    setSettings(prev => ({ ...prev, [tab]: { ...prev[tab], ...patch } }))
  }

  const tab     = TABS.find(t => t.id === activeTab)

  return (
    <>
    <div className="space-y-5">
      {/* 헤더 */}
      <div>
        <h1 className="t-section text-ds-v3-ink">자동순서</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          매일 저절로 나가는 방송의 시각과 순서를 정합니다. 끄면 그 방송은 안 나갑니다.
        </p>
      </div>

      {/* 좌측 사이드바(5개 시간대) + 우측 편집 영역 — 음원 및 동영상 관리와 같은 레이아웃 언어 */}
      {/* **폰에서는 위아래로 쌓는다** (2026-09-17 브라우저 전수 시험, 390px). 늘 가로였어서 목록(288px)이 폭을 다
          먹고 편집기가 54px 로 눌려 글자가 한 자씩 세로로 쌓였다. 태블릿 이상은 그대로 가로다. */}
      <div className="flex flex-col tablet:flex-row gap-4 tablet:items-start">
        {/* 레인 목록. **글자를 줄여서 넓히지 않는다**(T-1) — 이름이 넘치면 먼저 여백을 본다.
            여기는 카드가 `p-3` 으로 한 번, 줄마다 `px-3` 으로 또 한 번 안쪽을 밀어서 256px 중
            48px 이 이중 여백이었다. 카드 여백을 줄이고 폭을 288 로 올린다 — 오른쪽 편집기가
            쓰고 남는 자리가 넉넉해서 여기서 아낄 이유가 없었다(2026-09-13 1440 실측:
            「식사전 체조(점심)」이 10px 넘쳐 잘리고 있었다). */}
        <div className="w-full tablet:w-72 flex-shrink-0 card-base p-2 space-y-1 tablet:sticky tablet:top-4">
          {TABS.map(t => {
            const Icon     = t.icon
            const isActive = activeTab === t.id
            const time     = timeLabel(settings?.[t.id]?.time, t.defaultTime)
            // **시각을 이름에 섞지 않는다** (2026-09-13 재편성). 예전엔 "07:50 아침 방송"이
            // 한 덩어리 글자였다. 그러면 시각 칸을 훑어 내려갈 수가 없고 — 더 나쁘게 —
            // 「꺼짐」이 이름 앞에 슬쩍 끼어 있어서 **안 나가는 방송을 나가는 줄 안다.**
            // 이 화면에서 가장 비싼 오독이라(§4-3) 줄 전체로 말하게 한다: 시각 칸을 고정
            // 폭 `nums` 로 세우고, 꺼진 줄은 흐리게 + 「안 나감」.
            // **「자동 방송」 스위치를 끈 것도 꺼짐이다** (2026-09-17 브라우저 전수 시험). 시각을 비운 경우만 봐서,
            // 스위치를 끄고 저장한 국민체조가 목록에 「09:00 국민체조」로 멀쩡히 보였다(간편 화면 오늘 목록에선 빠졌는데).
            const 꺼짐 = time === '꺼짐' || settings?.[t.id]?.enabled === false
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`t-label flex w-full items-center gap-2 rounded-btn px-3 py-2.5 text-left transition-colors
                  ${isActive
                    ? 'bg-ds-v3-flow-bg text-ds-v3-flow'
                    : 'text-ds-v3-ink-2 hover:bg-ds-v3-bg hover:text-ds-v3-ink'}`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className={`nums w-[3.5rem] flex-shrink-0 tracking-tight ${꺼짐 ? 'opacity-45' : ''}`}>
                  {꺼짐 ? '--:--' : time}
                </span>
                <span className={`min-w-0 flex-1 truncate ${꺼짐 ? 'opacity-45' : ''}`}>
                  {autoName(settings, t.id)}
                </span>
                {꺼짐 && (
                  <span className="t-sub flex-shrink-0 font-semibold text-ds-v3-ink-2">안 나감</span>
                )}
              </button>
            )
          })}

          <div className="pt-2 mt-2 border-t border-ds-v3-line space-y-1">
            <p className="px-3 pb-1 t-sub font-semibold text-ds-v3-ink-2">커스텀 자동순서</p>
            {customSequences.map(cs => {
              const isActive = activeTab === cs.id
              return (
                <div key={cs.id} className={`group flex items-center rounded-btn ${isActive ? 'bg-ds-v3-flow-bg' : 'hover:bg-ds-v3-bg'}`}>
                  <button
                    onClick={() => switchTab(cs.id)}
                    className={`t-label flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-2.5 text-left
                      ${isActive ? 'text-ds-v3-flow' : 'text-ds-v3-ink-2 group-hover:text-ds-v3-ink'}`}
                  >
                    <Sparkles size={16} className="flex-shrink-0" />
                    <span className="truncate">{cs.title}</span>
                  </button>
                  <button
                    onClick={() => startCopy(cs.title, cs.flow_sequence_id, cs.scheduled_time)}
                    className="p-1.5 rounded-full text-ds-v3-ink-3 hover:text-ds-v3-flow hover:bg-white transition-colors flex-shrink-0"
                    title="복제"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    onClick={() => handleDeleteCustomSequence(cs)}
                    className="p-1.5 mr-1.5 rounded-full text-ds-v3-ink-3 hover:text-ds-v3-warn hover:bg-white transition-colors flex-shrink-0"
                    title="삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}

            {/* 복제할 이름 — 사이드바가 좁아서 아래로 쌓는다. 복사본은 **정지 상태**로 만들어진다. */}
            {copyingFlowId !== null && (
              <div className="px-2 py-2 space-y-2 bg-ds-v3-flow-bg rounded-btn">
                <input autoFocus value={copyName}
                  onChange={e => setCopyName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleDuplicateFlow(copyingFlowId, copyTime)
                    if (e.key === 'Escape') cancelCopy()
                  }}
                  className="w-full text-sm px-3 py-1.5 rounded-full border border-ds-v3-flow-line bg-white
                             focus:outline-none focus:ring-2 focus:ring-ds-v3-flow-line" />
                <div className="flex items-center gap-1.5">
                  <button onClick={cancelCopy}
                    className="flex-1 py-1.5 t-sub font-semibold text-ds-v3-ink-2 rounded-full hover:bg-white transition-colors">
                    취소
                  </button>
                  <button onClick={() => handleDuplicateFlow(copyingFlowId, copyTime)} disabled={copying}
                    className="flex-1 py-1.5 t-sub font-semibold text-white bg-ds-v3-flow rounded-full
                               hover:bg-ds-v3-flow disabled:opacity-50 transition-colors">
                    {copying ? '만드는 중...' : '만들기'}
                  </button>
                </div>
                <p className="t-sub text-ds-v3-flow leading-snug px-1">
                  복사본은 <b>정지 상태</b>로 만들어집니다. 시각을 정하고 켜야 나갑니다.
                </p>
              </div>
            )}

            {/* 예약이 안 붙은 흐름 — 예전에 예약방송관리에서 만든 것들. 시각이 없어 저절로는 안 나간다. */}
            {orphanFlows.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 t-sub font-semibold text-ds-v3-ink-2">예약 없는 흐름</p>
                {orphanFlows.map(fl => (
                  <div key={`flow_${fl.id}`}
                    className={`group flex items-center rounded-btn ${activeOrphanId === fl.id ? 'bg-ds-v3-flow-bg' : 'hover:bg-ds-v3-bg'}`}>
                    <button
                      onClick={() => switchTab(`flow_${fl.id}`)}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm font-normal text-left truncate
                        ${activeOrphanId === fl.id ? 'text-ds-v3-flow' : 'text-ds-v3-ink-2 group-hover:text-ds-v3-ink'}`}
                    >
                      <Workflow size={14} className="flex-shrink-0 text-ds-v3-flow" />
                      <span className="truncate">{fl.name}</span>
                    </button>
                    <button onClick={() => handleAdoptFlow(fl)} title="시각을 붙여 자동순서로 만들기"
                      className="p-1.5 rounded-full text-ds-v3-ink-3 hover:text-ds-v3-tts hover:bg-white transition-colors flex-shrink-0">
                      <Clock size={13} />
                    </button>
                    <button onClick={() => startCopy(fl.name, fl.id)} title="복제"
                      className="p-1.5 rounded-full text-ds-v3-ink-3 hover:text-ds-v3-flow hover:bg-white transition-colors flex-shrink-0">
                      <Copy size={13} />
                    </button>
                    {/* ── **지울 길이 없었다** (사용자 지적 2026-09-15) ──────────────────
                        *"새 순서 만들면 예약 없는 흐름 이렇게 뜨는데 … 저것도 삭제 버튼이
                          있어야 하잖아."*

                        **지우는 함수는 진작 있었다**(`handleDeleteOrphanFlow`) — 단추만
                        안 붙어 있었다. 그래서 잘못 만든 흐름이 목록에 영영 남고, 지우려면
                        시각을 붙여 자동순서로 만든 **뒤에** 지워야 했다.

                        위 「커스텀 자동순서」 줄에는 이미 휴지통이 있다 — 같은 성격의
                        목록에서 한쪽만 못 지우는 것이 어긋남이었다. */}
                    <button onClick={() => handleDeleteOrphanFlow(fl.id)} title="삭제"
                      className="p-1.5 mr-1.5 rounded-full text-ds-v3-ink-3 hover:text-ds-v3-warn hover:bg-white transition-colors flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </>
            )}

            <button
              onClick={() => setShowNewFlowEditor(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-normal rounded-btn text-ds-v3-tts hover:bg-ds-v3-flow-bg transition-colors text-left"
            >
              <Plus size={14} className="flex-shrink-0" />
              새 자동순서
            </button>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-5">
      {activeCustom ? (
        <CustomSequencePanel
          key={activeCustom.id}
          schedule={activeCustom}
          onSaveFields={saveCustomFields}
          onTrigger={handleCustomTrigger}
          onStop={handleCustomStop}
          onDelete={() => handleDeleteCustomSequence(activeCustom)}
          onEditSteps={() => setShowEditFlowId(activeCustom.flow_sequence_id)}
          flowRefreshTick={flowRefreshTick}
          status={status}
        />
      ) : activeOrphanId !== null ? (
        <OrphanFlowPanel
          key={activeOrphanId}
          flow={flows.find(fl => fl.id === activeOrphanId)}
          flowRefreshTick={flowRefreshTick}
          onEditSteps={() => setShowEditFlowId(activeOrphanId)}
          onAdopt={() => handleAdoptFlow(flows.find(fl => fl.id === activeOrphanId))}
          onDuplicate={() => startCopy(flows.find(fl => fl.id === activeOrphanId)?.name || "", activeOrphanId)}
          onDelete={() => handleDeleteOrphanFlow(activeOrphanId)}
        />
      ) : settings ? (
        <>
          {/* 공통 — 활성화 + 시간 설정 */}
          <div className="card-base">
            <h2 className="text-sm font-semibold text-ds-v3-ink mb-4 flex items-center gap-2">
              <Clock size={15} className="text-ds-v3-tts" />
              {timeLabel(settings?.[activeTab]?.time, tab?.defaultTime)} {autoName(settings, activeTab)} 자동 실행 설정
            </h2>
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-sm text-ds-v3-ink">자동 방송</span>
                <Toggle
                  key={activeTab}
                  defaultChecked={settings[activeTab]?.enabled ?? true}
                  onChange={v => updateTab(activeTab, { enabled: v })}
                />
              </div>
              {/* 방송 이름 — 사이드바·주간표·예약목록·쉬운화면이 모두 이 이름을 쓴다.
                  비워서 저장하면 기본 이름으로 돌아간다(따로 '되돌리기' 버튼을 두지 않은 이유). */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-ds-v3-ink-2">방송 이름</span>
                <input
                  type="text"
                  value={settings[activeTab]?.name ?? ''}
                  placeholder={autoName(null, activeTab)}
                  onChange={e => updateTab(activeTab, { name: e.target.value })}
                  className="w-44 px-3 py-2 text-sm border border-ds-v3-line rounded-btn
                             focus:outline-none focus:ring-2 focus:ring-ds-v3-tts/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ds-v3-ink-2">방송 시간</span>
                <input
                  type="time"
                  value={settings[activeTab]?.time ?? ''}
                  onChange={e => updateTab(activeTab, { time: e.target.value })}
                  className="border border-ds-v3-line rounded-btn px-3 py-1.5 text-sm text-ds-v3-ink
                             focus:outline-none focus:border-ds-v3-tts"
                />
              </div>
            </div>

            {/* 예상 소요시간 — 저장된 구성 기준. 시작 시각을 정할 때 필요한 정보다.
                "대략"과 "최대"를 구별해서 쓴다: 음원 길이를 모르는 단계가 있으면 상한만
                알 수 있고 실제로는 대개 훨씬 짧다. 단정해서 적으면 사람이 그 숫자로
                다음 방송을 잡는다. */}
            {(() => {
              const est = estimate?.[activeTab]
              // 계산을 못 받았으면 **줄을 지우지 않고 사유를 적는다.** 조용히 사라지면
              // "이 방송엔 원래 표시가 없나 보다"와 구별할 수 없다.
              if (!est) {
                if (!estimateError) return null
                return (
                  <div className="mt-3 pt-3 border-t border-ds-v3-line/60">
                    <span className="t-sub text-ds-v3-ink-2">
                      예상 소요시간을 계산하지 못했습니다 — 저장하거나 새로고침하면 다시 시도합니다
                    </span>
                  </div>
                )
              }
              // 분 표시도 **올림**한다 — 종료 시각이 올림이라, 반올림하면 한 줄 안에서
              // "27분인데 07:50 → 08:18(=28분)"처럼 어긋난다.
              const mins = Math.ceil(est.totalMs / 60000)
              const dur  = mins >= 60 ? `${Math.floor(mins / 60)}시간 ${mins % 60}분` : `${mins}분`
              const upper = est.hasUpperBound

              // 다음 방송과 겹치는가 — 규칙은 src/lib/scheduleOverlap.js에 있다(테스트가 붙어 있다).
              // 저장 전 값으로는 경고하지 않는다: 아직 서버가 옛 구성을 보고 있어 거짓 경고가 된다.
              const overlap = estimateStale ? null : findScheduleOverlap(activeTab, estimate, settings)

              // 안 나가는 단계와 그 사유. 서버가 이미 붙여서 준다(domain/broadcastEstimate).
              // 저장 전 값으로는 안 보여준다 — 아직 서버가 옛 구성을 보고 있어 거짓말이 된다.
              const skipped = estimateStale ? [] : (est.steps || []).filter(st => st.skip)

              return (
                <div className={`mt-3 pt-3 border-t border-ds-v3-line/60 flex flex-wrap items-center gap-x-3 gap-y-1
                                 ${estimateStale ? 'opacity-60' : ''}`}>
                  <span className="text-sm text-ds-v3-ink">
                    <b className="font-semibold">{upper ? '최대' : '대략'} {dur}</b>
                    {/* 시각을 비운 방송은 시작·종료를 지어내지 않는다 (P-53).
                        서버는 빈 문자열을 그대로 싣고 estimateEndTime 이 00:00 기준으로 계산하므로
                        (EV-001632), 그대로 찍으면 한 줄 위 '꺼짐' 과 아래 '00:00 → 00:05' 가 갈린다.
                        소요시간(dur)은 단계 구성의 길이라 꺼져 있어도 뜻이 있어 그대로 둔다. */}
                    {est.startTime
                      ? <>
                          <span className="text-ds-v3-ink-2"> · {est.startTime} → {est.end.time}</span>
                          {est.end.dayOffset > 0 && <span className="text-ds-v3-ink-2"> (다음 날)</span>}
                        </>
                      : <span className="text-ds-v3-ink-2"> · 시각 미설정 — 이 방송은 발동하지 않습니다</span>}
                  </span>
                  <span className="t-sub text-ds-v3-ink-2">
                    {estimateStale
                      ? '저장 전 값입니다 — 「설정 저장」을 누르면 바뀐 구성으로 다시 계산합니다'
                      : upper
                        ? '음원 길이를 몰라 최대치로 잡았습니다 — 실제로는 대개 더 짧게 끝납니다'
                        : '글자 수·재생 시간으로 어림한 값입니다'}
                  </span>
                  {overlap && (
                    <span className="t-sub font-semibold text-ds-v3-warn">
                      {overlap.tab
                        ? <>⚠ {autoName(settings, overlap.tab)}({overlap.startTime})
                            {overlap.sameStart ? ' 과 시작 시각이 같습니다' : ' 시작 시각을 넘깁니다'}</>
                        : '⚠ 자정을 넘겨 끝납니다'}
                    </span>
                  )}

                  {/* 점검 — "이 방송을 틀면 뭐가 빠지나".
                      단계는 조용히 빠진다(파일 없음·문구 빔). 매일 저절로 나가는 방송이라
                      한 번 빠지면 아무도 모른 채 계속 빠진다. 그래서 켜자마자 보이게 두되,
                      **한 줄로만** 둔다 — 목록을 늘 펼쳐 두면 잔소리가 되어 안 읽는다. */}
                  {skipped.length > 0 && (
                    <button type="button" onClick={() => setShowSkipped(v => !v)}
                      className="t-sub font-semibold text-ds-v3-ink-2 underline underline-offset-2
                                 inline-flex items-center min-h-[24px]">
                      ⚠ {skipped.length}개 단계가 빠집니다 {showSkipped ? '· 접기' : '· 보기'}
                    </button>
                  )}
                  {skipped.length === 0 && !estimateStale && (
                    <span className="t-sub text-ds-v3-ink-2">✓ 빠지는 단계 없음</span>
                  )}

                  {showSkipped && skipped.length > 0 && (
                    <ul className="w-full mt-1 space-y-0.5">
                      {skipped.map(st => (
                        <li key={st.id} className="t-sub text-ds-v3-ink-2">
                          <span className="text-ds-v3-ink-2">·</span> <b className="text-ds-v3-ink">{st.label || st.id}</b>
                          {' — '}{st.skip}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })()}
          </div>

          {/* 탭별 콘텐츠 — 단계 카드는 잠금 관문(StepsCard)이 그린다 */}
          {activeTab === 'morning' && (
            <MorningTabContent
              gate={stepsGate}
              estimateSteps={estimateStale ? [] : (estimate?.[activeTab]?.steps || [])}
              data={settings.morning}
              onChange={d => updateTab('morning', d)}
              breakfastPrayerTts={settings.breakfastPrayerTts}
              onBreakfastPrayerChange={v => setSettings(p => ({ ...p, breakfastPrayerTts: v }))}
            />
          )}
          {activeTab === 'exercise' && (
            <ExerciseTabContent
              gate={stepsGate}
              estimateSteps={estimateStale ? [] : (estimate?.[activeTab]?.steps || [])}
              data={settings.exercise}
              onChange={d => updateTab('exercise', d)}
            />
          )}
          {activeTab === 'lunch' && (
            <LunchTabContent
              gate={stepsGate}
              estimateSteps={estimateStale ? [] : (estimate?.[activeTab]?.steps || [])}
              data={settings.lunch}
              onChange={d => updateTab('lunch', d)}
            />
          )}
          {activeTab === 'dinner' && (
            <DinnerTabContent
              gate={stepsGate}
              estimateSteps={estimateStale ? [] : (estimate?.[activeTab]?.steps || [])}
              data={settings.dinner}
              onChange={d => updateTab('dinner', d)}
            />
          )}
          {activeTab === 'evening_prayer' && (
            <EveningPrayerTabContent
              gate={stepsGate}
              estimateSteps={estimateStale ? [] : (estimate?.[activeTab]?.steps || [])}
              data={settings.evening_prayer}
              onChange={d => updateTab('evening_prayer', d)}
            />
          )}

          {/* 버튼 행 */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-ds-v3-ink hover:bg-black
                         text-white rounded-btn text-sm font-semibold btn-press transition-colors disabled:opacity-60"
            >
              <Save size={15} />
              {saving ? '저장 중...' : '설정 저장'}
            </button>
            {/* 단계를 통째로 갈아엎는 버튼이라 잠겨 있을 때는 내놓지 않는다.
                「설정 저장」은 그대로 둔다 — 시각·활성화(위 카드, 잠금 밖)를 저장하는 길이 여기뿐이다. */}
            {editingSteps && (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 border border-ds-v3-line bg-white
                           hover:bg-ds-v3-bg text-ds-v3-ink rounded-btn text-sm font-normal btn-press transition-colors"
              >
                <RotateCcw size={15} /> 단계 기본값 복원
              </button>
            )}
            {activeTab === 'morning' && (
              <button
                onClick={handlePreview}
                disabled={playing}
                className="flex items-center gap-2 px-4 py-2.5 border border-ds-v3-line bg-white
                           hover:bg-ds-v3-bg text-ds-v3-ink rounded-btn text-sm font-normal btn-press transition-colors disabled:opacity-60"
              >
                {playing ? '재생 중...' : '날씨 미리 듣기'}
              </button>
            )}
            {/* ── 「지금 방송」은 **채우지 않는다** (2026-09-13 재편성) ────────────────────
                예전엔 주황으로 채워져 있어서 파란 「설정 저장」과 **채운 단추 둘이 경쟁**했다.
                무엇이 이 화면의 주 행동인지 눈이 못 고른다.
                여기는 **편집 화면**이고 가장 자주 하는 일은 단계를 고쳐 저장하는 것이다
                (§4-3). 방송은 가끔 하는 일이라 테두리 단추로 내린다 — 그리고 되돌릴 수 없는
                동작이므로 한 번 더 묻는다(G-42). 비중은 색이 아니라 **확인창**이 진다. */}
            <button
              onClick={() => setAsk(true)}
              className="t-label flex items-center gap-2 rounded-btn border border-ds-v3-line
                         bg-white px-4 py-2.5 font-semibold text-ds-v3-ink btn-press
                         transition-colors hover:bg-ds-v3-bg"
            >
              <Radio size={15} /> 지금 방송
            </button>
            {status && (
              <span className={`t-sub font-normal ${status.startsWith('오류') ? 'text-ds-v3-warn' : 'text-ds-v3-ink-3'}`}>
                {status}
              </span>
            )}
          </div>

          {/* ── 「음원·영상 파일 이름표」는 **지웠다** (2026-09-13, 설계 §7-8) ──────────────
              여기 있던 접이식 표는 `morning-prayer`·`exercise-video` 같은 **코드가 쓰는 슬러그**를
              사람에게 보여 주고 "그 이름의 카테고리에 올리라"고 시켰다. 그 안내가 필요했던 이유는
              **단계가 어디를 보는지 화면에 없었기 때문**이다 — 이제 각 단계에 연결 고르개가 있어
              폴더·파일을 이름으로 고르고, 무엇이 나가는지 그 자리에서 보인다.

              슬러그를 다시 노출하지 않는다: 새 시설은 그 이름을 쓸 이유가 없고(카테고리를 강요하지
              않는다), 이름을 보여 주면 그것이 곧 "이 열두 칸을 채워야 한다"는 지시로 읽힌다. */}
        </>
      ) : (
        loadError ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-sm text-ds-v3-warn font-normal">설정을 불러오지 못했습니다.</p>
            <p className="t-sub text-ds-v3-ink-2">{loadError}</p>
            <button
              onClick={() => { setLoadError(null); setLoadTick(t => t + 1) }}
              className="px-4 py-2 bg-ds-v3-ink hover:bg-black text-white rounded-btn
                         text-sm font-semibold btn-press transition-colors"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div className="text-sm text-ds-v3-ink-2 text-center py-10">설정을 불러오는 중...</div>
        )
      )}
        </div>
      </div>
    </div>

    {showNewFlowEditor && (
      <FlowEditorModal flowId={null}
        onClose={() => setShowNewFlowEditor(false)}
        onSaved={handleNewFlowSaved} />
    )}
    {showEditFlowId != null && (
      <FlowEditorModal flowId={showEditFlowId}
        onClose={() => setShowEditFlowId(null)}
        onSaved={() => { setShowEditFlowId(null); setFlowRefreshTick(t => t + 1) }} />
    )}

    {/* 되돌릴 수 없는 동작 앞의 문(G-42). 기본 초점은 「취소」에 간다 —
        엔터를 누르던 손이 그대로 방송을 내보내지 않게. */}
    <ConfirmDialog
      open={ask}
      title="지금 방송하시겠습니까?"
      body={`「${TABS.find(t => t.id === activeTab)?.name ?? '이 방송'}」을 지금 전관 스피커로 내보냅니다.`}
      경고="한 번 나간 방송은 되돌릴 수 없습니다."
      confirmLabel="지금 방송"
      onConfirm={handleTrigger}
      onClose={() => setAsk(false)}
    />
    </>
  )
}

