// 방송 일정 편집기의 표시 전용 부품 — 상태를 갖지 않고 받은 것만 그린다.
//
// 단계 목록(StepList)과 편집기 본체가 함께 쓴다. 상수는 morningEditorConst.js에서 가져온다.

import { useState, useEffect } from 'react'
import NumBox from '../../shared/NumBox'
import RateInput from '../../shared/RateInput'
import {
  GripVertical, Plus, X, Volume2, Gauge,
} from 'lucide-react'
import {
  getAudioFiles,
} from '../../../lib/api'
import { rateToPercent, percentToRate, RATE_PCT_DEFAULT } from '../../../lib/scheduleUtils'
import {
  GRACE_LABEL, VIDEO_STEP_IDS, volumeFieldFor, VOLUME_FIELD_LABEL,
} from './morningEditorConst'
import BgmSourcePicker from '../../shared/BgmSourcePicker'
import { BGM_DEFAULT_TYPE } from '../../../lib/bgmTypes'

function GraceFilePanel({ category, useGraceAudio, onToggle }) {
  const [files, setFiles] = useState(null)
  useEffect(() => {
    getAudioFiles(category).then(setFiles).catch(() => setFiles([]))
  }, [category])

  const label   = GRACE_LABEL[category] || category
  const checked = useGraceAudio !== false  // 기본값 true

  return (
    <div className="mt-2 mb-2 rounded-2xl overflow-hidden t-sub bg-white/60">
      {/* 재생 방식 선택 */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="text-ds-v3-ink-2 font-normal flex-1">재생 방식</span>
        <button
          onClick={e => { e.stopPropagation(); onToggle(true) }}
          onDragStart={e => e.stopPropagation()}
          className={`px-2.5 py-1 rounded-full font-semibold transition-colors cursor-pointer
            ${checked ? 'bg-ds-v3-ink-3 text-white shadow-sm' : 'bg-white/80 text-ds-v3-ink-2 hover:bg-white'}`}
        >
          🎙 녹음 파일
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggle(false) }}
          onDragStart={e => e.stopPropagation()}
          className={`px-2.5 py-1 rounded-full font-semibold transition-colors cursor-pointer
            ${!checked ? 'bg-ds-v3-ink-3 text-white shadow-sm' : 'bg-white/80 text-ds-v3-ink-2 hover:bg-white'}`}
        >
          🔊 TTS만
        </button>
      </div>
      {/* 파일 상태 */}
      {checked && (
        files === null ? (
          <div className="px-2.5 pb-2 text-ds-v3-ink-2">확인 중...</div>
        ) : files.length > 0 ? (
          <div className="px-2.5 pb-2 flex items-center gap-1.5">
            <span className="text-ds-v3-ink-3 font-normal">✅ {label} {files.length}개 등록됨</span>
            <span className="text-ds-v3-ink-3">→ 녹음 재생</span>
          </div>
        ) : (
          <div className="px-2.5 pb-2">
            <span className="text-ds-v3-ink-2 font-normal">📂 파일 없음</span>
            <span className="text-ds-v3-ink-2"> → TTS로 폴백 (음원 관리에서 업로드)</span>
          </div>
        )
      )}
    </div>
  )
}

function PlaylistChips({ options, selectedIds, onChange, accent, emptyText }) {
  const [dragIdx, setDragIdx] = useState(null)

  if (options.length === 0) return <p className="t-sub text-ds-v3-ink-2 py-1">{emptyText}</p>

  const toggle = (id) => {
    const sid = String(id)
    onChange(selectedIds.includes(sid) ? selectedIds.filter(x => x !== sid) : [...selectedIds, sid])
  }
  const onDragOver = (e, i) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    const next = [...selectedIds]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(i, 0, moved)
    onChange(next)
    setDragIdx(i)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map(af => {
          const picked = selectedIds.includes(String(af.id))
          return (
            <button key={af.id} type="button"
              onClick={e => { e.stopPropagation(); toggle(af.id) }}
              onDragStart={e => e.stopPropagation()}
              className={`px-2.5 py-1.5 rounded-full t-sub font-normal transition-colors cursor-pointer
                ${picked ? `${accent} text-white shadow-sm` : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`}>
              {af.original_name}
            </button>
          )
        })}
      </div>
      {selectedIds.length > 0 && (
        <div>
          <p className="t-sub text-ds-v3-ink-2 mb-1">재생목록 (드래그로 순서 변경, 담긴 순서대로 순차 재생)</p>
          <div className="flex flex-col gap-1">
            {selectedIds.map((sid, i) => {
              const af = options.find(o => String(o.id) === sid)
              return (
                <div key={sid} draggable
                  onDragStart={e => { e.stopPropagation(); setDragIdx(i) }}
                  onDragOver={e => onDragOver(e, i)}
                  onDragEnd={e => { e.stopPropagation(); setDragIdx(null) }}
                  className={`flex items-center gap-2 bg-white/80 rounded-full px-3 py-1.5 t-sub cursor-grab
                    ${dragIdx === i ? 'ring-2 ring-ds-v3-tts/40' : ''}`}>
                  <GripVertical size={11} className="text-ds-v3-ink-3 flex-shrink-0" />
                  <span className="w-4 text-center t-sub text-ds-v3-ink-2 nums flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 truncate text-ds-v3-ink">{af ? af.original_name : '(삭제된 파일)'}</span>
                  <button type="button"
                    onClick={e => { e.stopPropagation(); onChange(selectedIds.filter((_, idx) => idx !== i)) }}
                    onDragStart={e => e.stopPropagation()}
                    className="text-ds-v3-ink-2 hover:text-ds-v3-warn cursor-pointer flex-shrink-0">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// BGM 재생목록 편집기 — 곡마다 폴더(방송용·식사용)와 차례를 따로 정하고, 드래그로 순서 변경.
// 마지막 곡만 "재생시간" 입력이 없음 — 마지막 곡은 기존처럼 대기 없이 계속 재생됨(server/services/flowRunner.js와 동일 규칙).

function BgmPlaylistEditor({ items, onUpdateItem, onAdd, onRemove, onReorder }) {
  const [dragIdx, setDragIdx] = useState(null)
  const onDragOver = (e, i) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    onReorder(dragIdx, i)
    setDragIdx(i)
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} draggable
          onDragStart={e => { e.stopPropagation(); setDragIdx(i) }}
          onDragOver={e => onDragOver(e, i)}
          onDragEnd={e => { e.stopPropagation(); setDragIdx(null) }}
          className={`rounded-2xl bg-white/70 p-2.5 space-y-2 cursor-grab
            ${dragIdx === i ? 'ring-2 ring-ds-v3-bgm-line' : ''}`}>
          <div className="flex items-center gap-1.5">
            <GripVertical size={12} className="text-ds-v3-ink-3 flex-shrink-0" />
            <span className="t-sub text-ds-v3-ink-2 w-4 text-center nums flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <BgmSourcePicker
                value={item.bgm_type || BGM_DEFAULT_TYPE}
                onChange={(t) => onUpdateItem(i, { bgm_type: t })}
                rowClass="flex gap-1 flex-wrap"
                labelClass="t-sub text-ds-v3-ink-2"
                chipClass={(고름) => `px-2 py-1 rounded-full t-sub font-semibold transition-colors cursor-pointer
                  ${고름 ? 'bg-ds-v3-bgm text-white shadow-sm' : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`}
              />
            </div>
            {items.length > 1 && (
              <button type="button" onClick={e => { e.stopPropagation(); onRemove(i) }}
                onDragStart={e => e.stopPropagation()}
                className="text-ds-v3-ink-2 hover:text-ds-v3-warn cursor-pointer flex-shrink-0">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-2.5 py-1">
              <span className="t-sub text-ds-v3-ink-2">선재생</span>
              <NumBox min={0} max={60} value={item.bgm_delay ?? 5} onClick={e => e.stopPropagation()}
                onChange={v => onUpdateItem(i, { bgm_delay: v })}
                className="w-10 border-0 bg-transparent t-sub text-ds-v3-ink text-center nums focus:outline-none cursor-text" />
              <span className="t-sub text-ds-v3-ink-2">초</span>
            </div>
            {i < items.length - 1 && (
              <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-2.5 py-1">
                <span className="t-sub text-ds-v3-ink-2">이 곡 재생시간</span>
                <NumBox min={0} max={3600} value={item.duration_sec ?? 60} onClick={e => e.stopPropagation()}
                  onChange={v => onUpdateItem(i, { duration_sec: v })}
                  className="w-12 border-0 bg-transparent t-sub text-ds-v3-ink text-center nums focus:outline-none cursor-text" />
                <span className="t-sub text-ds-v3-ink-2">초 후 다음 곡</span>
              </div>
            )}
          </div>
        </div>
      ))}
      <button type="button" onClick={e => { e.stopPropagation(); onAdd() }}
        onDragStart={e => e.stopPropagation()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-full t-sub font-semibold bg-ds-v3-bgm-bg text-ds-v3-bgm hover:bg-ds-v3-bgm-bg cursor-pointer">
        <Plus size={11} /> 곡 추가
      </button>
    </div>
  )
}


// 이 단계에만 적용할 볼륨 — 시스템 기본값은 그대로 두고 이 재생에만 쓴다.
// 켜고 끄는 게 아니라 "기본값 사용"과 "직접 지정"을 구분해야 0(무음)을 저장할 수 있다.
// StepList.jsx에서 옮김(2026-09-03, big-file-split-design §2) — onChange(field, value)로 돌려준다.
function StepVolumePanel({ step, onChange }) {
  // 방송 뒤 배경 영상 단계(morning_video / lunch_video_after / dinner_video_after)는
  // **소리 없이** 나간다 — 재생 오버레이가 muted 고정이다. 식사 중에는 BGM이 소리를 내고 영상은 그림만 트는 의도된 설계다.
  // 그런데도 슬라이더가 떠서, 값을 올려도 아무 일이 없었다(2026-08-29 리뷰).
  // 배선하는 대신 없앤다 — 소리를 내게 하면 밑에 깔린 BGM과 싸운다.
  if (VIDEO_STEP_IDS.has(step.id)) {
    return (
      <div className="px-3.5 py-2.5 border-t border-white/60">
        <div className="flex items-center gap-2">
          <Volume2 size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
          <span className="t-sub text-ds-v3-ink-2">
            이 영상은 소리 없이 나갑니다. 소리는 함께 트는 BGM이 냅니다.
          </span>
        </div>
      </div>
    )
  }
  const field = volumeFieldFor(step)
  const value = step[field]
  const useDefault = value === null || value === undefined || value === ''
  // 「기본값 사용」을 끌 때 처음 놓는 값
  const 처음값 = 70
  return (
    <div className="px-3.5 py-2.5 border-t border-white/60">
      <div className="flex items-center gap-2 flex-wrap">
        <Volume2 size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
        <span className="t-sub text-ds-v3-ink-2">{VOLUME_FIELD_LABEL[field]}</span>
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDefault}
            onClick={e => e.stopPropagation()}
            onChange={e => onChange(field, e.target.checked ? null : 처음값)}
            className="accent-ds-v3-tts"
          />
          <span className="t-sub text-ds-v3-ink-2">시스템 기본값 사용</span>
        </label>
        {!useDefault && (
          <>
            <input
              type="range"
              min="0" max="100"
              value={Number(value)}
              onClick={e => e.stopPropagation()}
              onDragStart={e => e.stopPropagation()}
              onChange={e => onChange(field, Number(e.target.value))}
              className="flex-1 min-w-[100px] accent-ds-v3-tts"
            />
            <span className="t-sub font-semibold text-ds-v3-ink w-9 text-right">{Number(value)}%</span>
          </>
        )}
      </div>
    </div>
  )
}

// 재생 배속 — 노래방처럼 따라 부르는 방송을 느리게 튼다. 기본은 정속(1.0배).
// 볼륨과 같은 원칙으로 전역 설정을 안 건드리고 이 단계에만 실린다.
// 어느 단계에 보여줄지는 호출부가 canSetRate로 판단한다(서버가 배속을 안 싣는 단계에
// 보여주면 죽은 설정이 된다). StepList.jsx에서 옮김(2026-09-03) — onChange(rate|null).
function StepRatePanel({ step, onChange }) {
  const cur = step.rate ?? null
  return (
    <div className="px-3.5 py-2.5 border-t border-white/60">
      <div className="flex items-center gap-2 flex-wrap">
        <Gauge size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
        <span className="t-sub text-ds-v3-ink-2">재생 배속</span>
        <div onClick={e => e.stopPropagation()}>
          <RateInput
            percent={rateToPercent(cur ?? 1)}
            onChange={pct => onChange(pct === RATE_PCT_DEFAULT ? null : percentToRate(pct))}
          />
        </div>
        {cur !== null && (
          <span className="t-sub text-ds-v3-ink-2">
            느리게 틀면 그만큼 오래 걸립니다 — 다음 단계도 그만큼 밀립니다.
          </span>
        )}
      </div>
    </div>
  )
}

export { GraceFilePanel, PlaylistChips, BgmPlaylistEditor, StepVolumePanel, StepRatePanel }
