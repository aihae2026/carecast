// 방송 일정 편집기의 화면 부품 — 단계 편집 관문, 탭별 콘텐츠, 커스텀 자동순서 패널.
//
// MorningEditor.jsx(1,308줄)에서 옮겨 왔다(2026-09-05, TD-10 기회식).
// **옮기기만 했고 동작은 바꾸지 않았다** — 전부 모듈 최상위 컴포넌트라 부모 상태를 문법적으로
// 볼 수 없고, 그래서 props 배선이 생기지 않는다(받는 값은 예전부터 props였다).
//
// morningEditorParts.jsx에 합치지 않은 이유: 그 파일은 **StepList의 부품**을 들고 있다.
// 여기에 편집기 탭 패널을 섞으면 두 화면의 부품이 한 파일에 살게 되는데, 그게 지금 없애려는
// 상태다.
//
// ⚠ 이 파일은 server/test/helpers/editorSource.js의 FILES에 들어 있다. 편집기 소스를 이어
// 붙여 검사하는 가드 여럿이 그 목록을 본다 — 파일 이름을 바꾸면 그 목록도 같이 고쳐야 한다.
import { useState, useEffect } from 'react'
import { Clock, Save, Radio, Trash2, FileText, Sparkles, Copy, Workflow, Square } from 'lucide-react'
import Toggle from '../../shared/Toggle'

import { BgmRail, FlowEditorModal } from '../../shared/FlowBuilder'
import { flowBgmCoverage } from '../../../lib/bgmLane'
import { getFlow } from '../../../lib/api'
import StepList from './StepList'
import { KIND_STYLE, FLOW_STEP_LABEL, flowStepSummary } from './morningEditorConst'

// ── 단계 편집 관문 ───────────────────────────────────────────
// 내장 자동방송의 「방송 구성 순서」는 지금까지 늘 만질 수 있었다. 드래그(그리고 새로 생긴
// 위/아래 버튼)로 순서가 **모르는 새 바뀐 채** 「설정 저장」을 누르면 그대로 저장된다 —
// 방송 순서가 바뀌었다는 것은 그날 방송이 나가고 나서야 안다.
// 커스텀 자동순서는 이미 이 관문이 있다(미리보기는 읽기 전용, 고치려면 「단계 편집」).
//
// **버튼 자리도 커스텀과 같다** — 카드 머리의 오른쪽 끝, 같은 아이콘·같은 알약 모양
// (OrphanFlowPanel·CustomSequencePanel 참고). 같은 일을 두 화면이 다른 자리에서 시키면
// 사람이 매번 어디 있는지 찾아야 한다.
//
// 잠그는 방법은 **inert 하나**다. 컨트롤마다 disabled를 뿌리면 StepList가 1500줄이 넘어
// 빠뜨리는 곳이 반드시 생긴다(드래그·＋·미리듣기·볼륨·배속·TTS 입력…). inert는 그 안의
// 클릭·드래그·키보드 포커스를 통째로 죽인다.
function StepsCard({ gate, children }) {
  const { editing, dirty, saving, onEdit, onCancel, onSave } = gate
  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ds-v3-ink mb-1">방송 구성 순서</h3>
          <p className="t-sub text-ds-v3-ink-2">
            {editing
              ? <>드래그 또는 <b className="font-semibold">▲▼</b>로 순서 변경 · 체크박스로 잠시 끄기 · <b className="font-semibold">수정</b>으로 내용 고치기 · <b className="font-semibold">삭제</b>는 두 번 눌러 지우기
                  {dirty && <b className="text-ds-v3-tts"> · 고친 내용이 있습니다</b>}</>
              : <>잠겨 있습니다 — 고치려면 <b className="text-ds-v3-ink">「단계 편집」</b>을 누르세요</>}
          </p>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3.5 py-2 t-sub font-semibold rounded-full
                         bg-ds-v3-ink hover:bg-black text-white transition-all cursor-pointer
                         hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              <Save size={12} /> {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={onCancel}
              className="px-3.5 py-2 t-sub font-semibold rounded-full border border-ds-v3-line
                         bg-white hover:bg-ds-v3-bg text-ds-v3-ink transition-all cursor-pointer"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3.5 py-2 t-sub font-semibold rounded-full
                       bg-ds-v3-tts-bg text-ds-v3-tts transition-all cursor-pointer hover:scale-105 active:scale-95 flex-shrink-0"
          >
            <FileText size={12} /> 단계 편집
          </button>
        )}
      </div>

      {/* React 19는 inert를 boolean으로 받는다(false면 속성 자체가 안 붙는다).
          빈 문자열로 넘기면 개발 콘솔에 boolean 속성 경고가 뜬다. */}
      <div inert={!editing} className={editing ? '' : 'opacity-75'}>
        {children}
      </div>
    </div>
  )
}

// ── 탭별 콘텐츠 ──────────────────────────────────────────────

function MorningTabContent({ gate, data, onChange, estimateSteps, breakfastPrayerTts, onBreakfastPrayerChange }) {
  if (!data) return null
  return (
    <div className="space-y-4">
      <StepsCard gate={gate}>
        <StepList
          tab="morning"
          steps={data.steps}
          estimateSteps={estimateSteps}
          onChange={steps => onChange({ ...data, steps })}
          ttsContents={{
            morning_prayer_intro: data.morningPrayerIntroTts,
            breakfast_prayer_tts: breakfastPrayerTts,
          }}
          onTtsChange={(stepId, value) => {
            if      (stepId === 'morning_prayer_intro') onChange({ ...data, morningPrayerIntroTts: value })
            else if (stepId === 'breakfast_prayer_tts') onBreakfastPrayerChange(value)
          }}
        />
      </StepsCard>
    </div>
  )
}

function ExerciseTabContent({ gate, data, onChange, estimateSteps }) {
  if (!data) return null
  return (
    <StepsCard gate={gate}>
      <StepList
        tab="exercise"
        steps={data.steps}
        estimateSteps={estimateSteps}
        onChange={steps => onChange({ ...data, steps })}
        ttsContents={{ exercise_tts: data.tts }}
        onTtsChange={(stepId, value) => {
          if (stepId === 'exercise_tts') onChange({ ...data, tts: value })
        }}
      />
    </StepsCard>
  )
}

function LunchTabContent({ gate, data, onChange, estimateSteps }) {
  if (!data) return null
  return (
    <div className="space-y-4">
      <StepsCard gate={gate}>
        <StepList
          tab="lunch"
          steps={data.steps}
          estimateSteps={estimateSteps}
          onChange={steps => onChange({ ...data, steps })}
          ttsContents={{
            lunch_tts:          data.tts,
            lunch_prayer_intro: data.lunchPrayerIntroTts,
            lunch_prayer_tts:   data.prayerTts,
          }}
          onTtsChange={(stepId, value) => {
            if      (stepId === 'lunch_tts')          onChange({ ...data, tts: value })
            else if (stepId === 'lunch_prayer_intro') onChange({ ...data, lunchPrayerIntroTts: value })
            else if (stepId === 'lunch_prayer_tts')   onChange({ ...data, prayerTts: value })
          }}
        />
      </StepsCard>
    </div>
  )
}

function DinnerTabContent({ gate, data, onChange, estimateSteps }) {
  if (!data) return null
  return (
    <div className="space-y-4">
      <StepsCard gate={gate}>
        <StepList
          tab="dinner"
          steps={data.steps}
          estimateSteps={estimateSteps}
          onChange={steps => onChange({ ...data, steps })}
          ttsContents={{
            dinner_tts:        data.tts,
            dinner_prayer_tts: data.prayerTts,
          }}
          onTtsChange={(stepId, value) => {
            if      (stepId === 'dinner_tts')        onChange({ ...data, tts: value })
            else if (stepId === 'dinner_prayer_tts') onChange({ ...data, prayerTts: value })
          }}
        />
      </StepsCard>
    </div>
  )
}

function EveningPrayerTabContent({ gate, data, onChange, estimateSteps }) {
  if (!data) return null
  return (
    <StepsCard gate={gate}>
      <StepList
        tab="evening_prayer"
        steps={data.steps}
        estimateSteps={estimateSteps}
        onChange={steps => onChange({ ...data, steps })}
        ttsContents={{
          evening_prayer_tts:  data.tts,
          evening_prayer_tts2: data.tts2,
          evening_closing_tts: data.closingTts,
        }}
        onTtsChange={(stepId, value) => {
          if      (stepId === 'evening_prayer_tts')  onChange({ ...data, tts: value })
          else if (stepId === 'evening_prayer_tts2') onChange({ ...data, tts2: value })
          else if (stepId === 'evening_closing_tts') onChange({ ...data, closingTts: value })
        }}
      />
    </StepsCard>
  )
}

// 커스텀 자동순서 단계 미리보기 — 5개 고정 탭(StepList)처럼 세로 타임라인으로 실제 구성된
// 단계를 바로 그려준다. "방송 흐름 만들기"(FlowBuilder.jsx)와 같은 STEP_TYPES/stepSummary를
// 재사용해서 아이콘·색·요약 문구가 동일하게 보이도록 함. 읽기 전용(수정은 "단계 편집" 모달에서).
function FlowStepsPreview({ flowId }) {
  const [steps, setSteps] = useState(null)  // null=로딩중, []=빈 흐름/오류

  // setSteps는 항상 getFlow의 then/catch 콜백 안에서만 호출 — 이펙트 본문에서 동기 호출하지
  // 않는다(react-hooks/set-state-in-effect). 부모가 flowId 기준 key로 이 컴포넌트를 통째로
  // remount시키므로 flowId 변경 시 로딩 상태(null)부터 다시 시작하는 건 이미 보장된다.
  useEffect(() => {
    if (!flowId) return
    let cancelled = false
    getFlow(flowId)
      .then(d => { if (!cancelled) setSteps(d.steps || []) })
      .catch(() => { if (!cancelled) setSteps([]) })
    return () => { cancelled = true }
  }, [flowId])

  if (!flowId) return <div className="t-sub text-ds-v3-ink-2 text-center py-4">아직 구성된 단계가 없습니다. "단계 편집"에서 추가해주세요.</div>
  if (steps === null) return <div className="t-sub text-ds-v3-ink-2 text-center py-4">불러오는 중...</div>
  if (steps.length === 0) return <div className="t-sub text-ds-v3-ink-2 text-center py-4">아직 구성된 단계가 없습니다. "단계 편집"에서 추가해주세요.</div>

  // 이 단계에 BGM이 깔려 있는가 — 편집 화면(FlowBuilder)과 같은 계산·같은 근거.
  // 읽기 전용이라 더 필요하다: 여기서 "음악이 깔린 줄" 알고 안내를 짜 넣는 것이 이 화면의 용도다.
  const bgmCover = flowBgmCoverage(steps)

  return (
    <div className="max-w-2xl">
      {bgmCover.some(Boolean) && (
        <div className="flex items-center gap-1.5 pb-1.5 t-sub text-ds-v3-ink-2">
          <span className="w-[3px] h-3.5 rounded-full bg-ds-v3-bgm-line flex-shrink-0" />
          <span>왼쪽 선이 이어진 구간에는 <b className="font-semibold">배경음악이 함께 나옵니다</b> — 그 위로 안내 음성이 나갑니다.
            음원·영상 단계에서 BGM은 꺼지고, 소리 없는 배경 영상 밑에서는 BGM이 계속 흐릅니다.</span>
        </div>
      )}
      <div className="relative">
      <div className="absolute left-[27px] top-6 bottom-6 w-0.5 bg-ds-v3-line-2" />
      {(() => {
      let stepNo = 0
      return steps.map((step, i) => {
        // 묶음 머리글(FlowBuilder의 폴더)은 소리를 내지 않는 라벨이라 단계 번호를 주지 않고
        // 구분선처럼 그린다. 예전엔 유형표에 없어서 "group"이라는 이름의 단계로 보였다.
        if (step.step_type === 'group') {
          return (
            <div key={step.id ?? i} className="relative mb-2.5 flex items-center gap-2.5 pl-[18px]">
              <BgmRail cov={bgmCover[i]} />
              <span className="w-5 h-5 rounded-full bg-white border-2 border-ds-v3-line flex-shrink-0" />
              <span className="t-sub font-semibold text-ds-v3-ink truncate">{step.label || '묶음'}</span>
              <span className="flex-1 h-px bg-ds-v3-line-2" />
            </div>
          )
        }
        stepNo++
        const style = KIND_STYLE[step.step_type] ?? KIND_STYLE.plain
        const Icon = style.icon
        return (
          <div key={step.id ?? i} className={`relative mb-2.5 flex items-center gap-2.5 px-3.5 py-3 rounded-[20px] ${style.bg}`}>
            <BgmRail cov={bgmCover[i]} />
            <span className={`w-6 h-6 flex items-center justify-center rounded-full ${style.solid} text-white t-sub font-semibold flex-shrink-0 shadow-sm`}>
              {stepNo}
            </span>
            {Icon && (
              <span className={`w-7 h-7 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0 ${style.text}`}>
                <Icon size={13} />
              </span>
            )}
            <span className={`t-sub font-semibold flex-shrink-0 ${style.text}`}>{FLOW_STEP_LABEL[step.step_type] || step.step_type}</span>
            <span className="t-sub text-ds-v3-ink-2 truncate flex-1 min-w-0">{flowStepSummary(step)}</span>
          </div>
        )
      })
      })()}
      </div>
    </div>
  )
}

// ── 커스텀 자동순서 우측 패널 — 5개 고정 탭과 달리 이름/활성/시간만 있고, 단계는
// FlowEditorModal(방송 흐름 만들기)로 편집한다 ──
// 예약이 안 붙은 흐름의 패널 — 고정 5종·커스텀 자동순서와 **같은 자리에 같은 모양으로**
// 구성 순서를 펼쳐 준다. 예전에는 누르면 편집 모달이 바로 떠서, 무엇이 들었는지 보려면
// 편집 화면을 열어야 했다.
//
// 시각·활성 토글은 없다 — 짝이 되는 예약이 아직 없기 때문이다. 그 자리에 「자동순서로
// 만들기」를 둔다. 이름 고치기는 「단계 편집」 안에 이미 있어서 여기 또 두지 않는다.
function OrphanFlowPanel({ flow, flowRefreshTick, onEditSteps, onAdopt, onDuplicate, onDelete }) {
  if (!flow) return null
  return (
    <>
      <div className="card-base">
        <div className="flex items-center gap-2 mb-3">
          <Workflow size={15} className="text-ds-v3-flow flex-shrink-0" />
          <span className="text-sm font-semibold text-ds-v3-ink truncate">{flow.name}</span>
          <span className="t-sub text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-2 py-0.5 rounded-full flex-shrink-0">
            예약 없음
          </span>
        </div>
        <p className="t-sub text-ds-v3-ink-2 leading-relaxed bg-ds-v3-bg rounded-2xl px-3.5 py-2.5">
          이 흐름은 <b>시각이 없어서 저절로 나가지 않습니다.</b> 매일 정해진 시각에 나가게 하려면
          「자동순서로 만들기」를 누르세요 — <b>정지 상태</b>로 만들어지니, 시각을 정하고 켜야 나갑니다.
        </p>
        <button
          onClick={onAdopt}
          className="mt-3 flex items-center gap-1.5 px-4 py-2.5 bg-ds-v3-ink hover:bg-black
                     text-white text-sm font-semibold rounded-full btn-press transition-all shadow-sm"
        >
          <Clock size={14} /> 자동순서로 만들기
        </button>
      </div>

      {/* ── 단계를 **그 자리에서** 고친다 (사용자 지시 2026-09-13) ─────────────────────
          *"커스텀 자동순서는 단계 편집이 왜 아침 방송이나 국민체조랑 달라, 똑같이 만들어야지"*
          자동방송 5종은 단계가 펼쳐진 채로 바로 고쳐지는데(`StepList`) 여기만 **읽기 전용
          미리보기 + 창 열기** 였다. 같은 일을 하는데 한쪽만 창을 거치면, 사람은 두 화면을
          다른 기능으로 배운다.
          **편집기를 새로 만들지 않았다** — 그 창의 속을 그대로 펴 놓은 것이라(`인라인`),
          창으로 열든 펼쳐 두든 같은 코드가 돈다. */}
      <div className="card-base">
        <p className="text-sm text-ds-v3-ink-2 mb-3">방송 구성 순서</p>
        <FlowEditorModal 인라인 key={flow.id + '_' + flowRefreshTick}
          flowId={flow.id} onClose={() => {}} onSaved={onEditSteps ? () => onEditSteps('saved') : () => {}} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onDuplicate}
          className="flex items-center gap-1.5 px-4 py-2.5 text-ds-v3-flow hover:bg-ds-v3-flow-bg
                     text-sm font-semibold rounded-full btn-press transition-all"
        >
          <Copy size={14} /> 복제
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-4 py-2.5 text-ds-v3-warn hover:bg-ds-v3-warn-bg
                     text-sm font-semibold rounded-full btn-press transition-all"
        >
          <Trash2 size={14} /> 삭제
        </button>
      </div>
    </>
  )
}

function CustomSequencePanel({ schedule, onSaveFields, onTrigger, onStop, onDelete, onEditSteps, flowRefreshTick, status }) {
  const [title, setTitle] = useState(schedule.title)

  return (
    <>
      <div className="card-base">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={15} className="text-ds-v3-tts flex-shrink-0" />
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== schedule.title) onSaveFields({ title: title.trim() }) }}
            className="flex-1 text-sm font-semibold text-ds-v3-ink bg-transparent border-b border-transparent
                       hover:border-ds-v3-line focus:outline-none focus:border-ds-v3-tts px-1"
          />
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm text-ds-v3-ink">자동 방송</span>
            <Toggle
              key={schedule.id}
              defaultChecked={!!schedule.active}
              onChange={v => onSaveFields({ active: v ? 1 : 0 })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ds-v3-ink-2">방송 시간</span>
            <input
              type="time"
              defaultValue={schedule.scheduled_time}
              key={schedule.id + '_' + schedule.scheduled_time}
              onBlur={e => { if (e.target.value && e.target.value !== schedule.scheduled_time) onSaveFields({ scheduled_time: e.target.value }) }}
              className="border border-ds-v3-line rounded-btn px-3 py-1.5 text-sm text-ds-v3-ink
                         focus:outline-none focus:border-ds-v3-tts"
            />
          </div>
        </div>
        {/* 새 자동순서는 일부러 꺼진 채 만들어진다(시각을 정하고 켜야 나간다) — 그 사실이
            화면에 없으면 꺼진 토글이 고장으로 보인다(2026-09-03 실기 신고). */}
        {!schedule.active && (
          <p className="mt-3 t-sub text-ds-v3-ink-2 leading-relaxed bg-ds-v3-bg rounded-2xl px-3.5 py-2.5">
            자동 방송이 <b className="text-ds-v3-ink">꺼져 있어</b> 시각이 되어도 저절로 나가지 않습니다.
            새 자동순서는 <b className="text-ds-v3-ink">꺼진 채</b> 만들어집니다 — 시간을 확인하고 위 토글을 켜면 매일 나갑니다.
            「지금 방송」은 토글과 상관없이 바로 나갑니다.
          </p>
        )}
      </div>

      {/* ── 단계를 **그 자리에서** 고친다 (사용자 지시 2026-09-13) ─────────────────────
          *"커스텀 자동순서는 단계 편집이 왜 아침 방송이나 국민체조랑 달라, 똑같이 만들어야지"*
          자동방송 5종은 단계가 펼쳐진 채로 바로 고쳐지는데(`StepList`) 여기만 **읽기 전용
          미리보기 + 창 열기** 였다. 같은 일을 하는데 한쪽만 창을 거치면, 사람은 두 화면을
          다른 기능으로 배운다.
          **편집기를 새로 만들지 않았다** — 그 창의 속을 그대로 펴 놓은 것이라(`인라인`),
          창으로 열든 펼쳐 두든 같은 코드가 돈다. */}
      <div className="card-base">
        <p className="text-sm text-ds-v3-ink-2 mb-3">방송 구성 순서</p>
        <FlowEditorModal 인라인 key={schedule.flow_sequence_id + '_' + flowRefreshTick}
          flowId={schedule.flow_sequence_id} onClose={() => {}}
          onSaved={onEditSteps ? () => onEditSteps('saved') : () => {}} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onTrigger}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-ds-v3-ink hover:bg-black
                     text-white text-sm font-semibold rounded-full btn-press transition-all shadow-sm"
        >
          <Radio size={14} /> 지금 방송
        </button>
        {/* 발사한 것을 그 자리에서 끈다 — 기존 전체 정지 길 그대로(정지는 하나의 길). */}
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-ds-v3-line text-ds-v3-ink
                     hover:border-ds-v3-warn hover:text-ds-v3-warn text-sm font-semibold rounded-full btn-press transition-all"
        >
          <Square size={13} /> 정지
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-4 py-2.5 text-ds-v3-warn hover:bg-ds-v3-warn-bg
                     text-sm font-semibold rounded-full btn-press transition-all"
        >
          <Trash2 size={14} /> 삭제
        </button>
        {status && (
          <span className={`t-sub font-normal ${status.startsWith('오류') ? 'text-ds-v3-warn' : 'text-ds-v3-ink-3'}`}>
            {status}
          </span>
        )}
      </div>
    </>
  )
}

export { StepsCard, FlowStepsPreview, OrphanFlowPanel, CustomSequencePanel, MorningTabContent, ExerciseTabContent, LunchTabContent, DinnerTabContent, EveningPrayerTabContent }
