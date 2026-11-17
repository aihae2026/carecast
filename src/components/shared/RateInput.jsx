import { useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { clampRatePercent, RATE_PCT_MIN, RATE_PCT_MAX, RATE_PCT_DEFAULT } from '../../lib/scheduleUtils'

// 재생 배속을 **퍼센트로** 정하는 칸. 정속이 100%, 느리게 80%, 빠르게 120%.
//
// 왜 배수 버튼(0.5x·0.75x)이 아닌가: 현장에서 "너무 성기다"는 말을 들었다. 실제로 필요한 건
// 83%처럼 1% 단위의 미세 조정인데 버튼 다섯 개로는 그 값에 닿을 수가 없었다.
//
// 세 곳(순서편집기 단계 · 예약 모달 · 영상 재생 중 화면)이 같은 칸을 쓴다. 예전에는 각자
// 다른 배수 목록을 들고 있었다 — 순서편집기는 [0.5 0.75 1 1.25 1.5], 예약 모달은
// [0.7 0.8 0.9 1.0 1.25]. 같은 기능이 화면마다 다른 값을 주는 상태였다.
//
// 숫자 칸은 사람이 지우고 다시 적을 수 있어야 해서 입력 중에는 그대로 두고, 칸을 벗어나거나
// Enter를 칠 때 범위 안으로 자른다. 입력 중에 자르면 "8"을 치는 순간 50으로 튄다.
export default function RateInput({
  percent, onChange, step = 1, dark = false, withSlider = false, id,
}) {
  const [text, setText] = useState(String(percent))
  // 바깥에서 값이 바뀌면(±버튼·슬라이더·다른 단계 선택) 입력 칸도 따라간다.
  // useEffect로 setState 하면 렌더가 한 번 더 도는 데다 lint 규칙에도 걸린다 —
  // React가 권하는 "렌더 중 조정" 방식(직전 값과 비교)을 쓴다.
  const [seen, setSeen] = useState(percent)
  if (seen !== percent) { setSeen(percent); setText(String(percent)) }

  const commit = (raw) => {
    const p = clampRatePercent(raw)
    setText(String(p))
    if (p !== percent) onChange(p)
  }
  const nudge = (d) => commit(percent + d)

  const btn = dark
    ? 'bg-white/20 text-white hover:bg-white/40'
    : 'bg-white/80 text-ds-v3-ink-2 hover:bg-white border border-ds-v3-line/60'
  const box = dark
    ? 'bg-white/15 text-white border-white/30 focus:border-white/70'
    : 'bg-white text-ds-v3-ink border-ds-v3-line focus:border-ds-v3-tts'
  const dim = dark ? 'text-white/70' : 'text-ds-v3-ink-2'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button" onClick={() => nudge(-step)} disabled={percent <= RATE_PCT_MIN}
        aria-label={`배속 ${step}% 낮추기`}
        className={`w-7 h-7 rounded-btn flex items-center justify-center transition-colors
                    disabled:opacity-40 btn-press ${btn}`}
      >
        <Minus size={13} />
      </button>

      <div className="relative">
        <input
          id={id}
          type="number" inputMode="numeric"
          min={RATE_PCT_MIN} max={RATE_PCT_MAX} step={step}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value) } }}
          aria-label="재생 배속 (퍼센트)"
          className={`w-[74px] h-7 pl-2 pr-6 rounded-btn border text-sm font-semibold text-right
                      nums outline-none transition-colors ${box}`}
        />
        <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none ${dim}`}>%</span>
      </div>

      <button
        type="button" onClick={() => nudge(step)} disabled={percent >= RATE_PCT_MAX}
        aria-label={`배속 ${step}% 올리기`}
        className={`w-7 h-7 rounded-btn flex items-center justify-center transition-colors
                    disabled:opacity-40 btn-press ${btn}`}
      >
        <Plus size={13} />
      </button>

      {percent !== RATE_PCT_DEFAULT && (
        <button
          type="button" onClick={() => commit(RATE_PCT_DEFAULT)}
          className={`h-7 px-2 rounded-btn flex items-center gap-1 text-[11px] transition-colors ${btn}`}
        >
          <RotateCcw size={11} /> 정속
        </button>
      )}

      {withSlider && (
        <input
          type="range" min={RATE_PCT_MIN} max={RATE_PCT_MAX} step={1}
          value={percent}
          onChange={e => commit(e.target.value)}
          aria-label="재생 배속 슬라이더"
          className="flex-1 min-w-[120px] accent-ds-v3-tts"
        />
      )}
    </div>
  )
}
