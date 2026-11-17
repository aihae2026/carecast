import { todayLocalStr } from '../../lib/scheduleUtils'

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// repeat_start_date / repeat_end_date / repeat_weekdays 세 필드를 다루는 공용 반복설정 UI.
// 요일을 하나도 선택하지 않으면 반복 없이 반복시작일 당일에만 실행되는 1회성 예약이 된다.
export default function RepeatPicker({ value, onChange }) {
  const { repeat_start_date, repeat_end_date, repeat_weekdays } = value

  const toggleDay = (dow) => {
    const set = new Set(repeat_weekdays)
    if (set.has(dow)) set.delete(dow)
    else set.add(dow)
    onChange({ ...value, repeat_weekdays: [...set].sort((a, b) => a - b) })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">반복시작일</label>
          <input type="date" value={repeat_start_date || todayLocalStr()} data-tour="modal-start"
            onChange={e => onChange({ ...value, repeat_start_date: e.target.value })}
            className="w-full border border-ds-v3-line rounded-btn px-3 py-2.5 text-sm text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts" />
        </div>
        <div>
          <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">
            반복종료일 <span className="font-normal text-ds-v3-ink-2">(선택)</span>
          </label>
          <input type="date" value={repeat_end_date || ''} min={repeat_start_date || undefined}
            onChange={e => onChange({ ...value, repeat_end_date: e.target.value || null })}
            className="w-full border border-ds-v3-line rounded-btn px-3 py-2.5 text-sm text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts" />
        </div>
      </div>
      <div>
        <label className="block t-sub font-semibold text-ds-v3-ink-2 mb-2">반복 요일</label>
        <div className="flex gap-1.5">
          {WEEKDAY_LABELS.map((label, dow) => {
            const active = repeat_weekdays.includes(dow)
            return (
              <button key={dow} type="button" onClick={() => toggleDay(dow)} data-tour={`modal-day-${dow}`}
                className={`w-9 h-9 rounded-full text-sm font-semibold transition-colors ${
                  active ? 'bg-ds-v3-tts text-white' : 'bg-ds-v3-bg text-ds-v3-ink-2 hover:bg-ds-v3-surface-2'
                }`}>
                {label}
              </button>
            )
          })}
        </div>
        <p className="t-sub text-ds-v3-ink-2 mt-1.5">
          {repeat_weekdays.length === 0
            ? '요일 미선택 — 반복시작일 하루만 실행 (1회성)'
            : '선택한 요일마다 반복 실행'}
        </p>
      </div>
    </div>
  )
}
