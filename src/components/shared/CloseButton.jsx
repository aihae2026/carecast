// 뜨는 창의 닫기 단추 — 한 곳에서 준다 (G-58, 2026-09-13).
//
// 전수 조사에서 닫기 단추의 타격 크기가 **18 · 26 · 27 · 32px 네 가지**였고
// **44px 인 것이 하나도 없었다.** 주 사용자가 50~60대이고 현장 PC 는 터치일 수 있는데,
// 어떤 창(자막 편집)에서는 그 작은 ✕ 가 **유일한 출구**이기도 했다.
//
// 부품을 새로 만들지 않았다 — `scheduleCalendarPopups.jsx` 의 `CloseButton` 을 옮긴 것이다.
// 13개 중 **`aria-label` 을 가진 유일한 닫기 단추**라, 가장 규칙에 가까웠다.
import { X } from 'lucide-react'

/**
 * @param {Function} onClose
 * @param {string}   [label='닫기']  화면 낭독기가 읽을 이름. 무엇을 닫는지 밝히면 더 좋다.
 * @param {boolean}  [글자=false]    좁은 자리가 아니면 「닫기」 글자를 같이 낸다.
 * @param {string}   [className='']
 */
export default function CloseButton({ onClose, label = '닫기', 글자 = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      title={`${label} (ESC)`}
      // **44px 은 `min-h`/`min-w` 로 준다.** 아이콘만 키우면 옆 글자와 높이가 안 맞아
      // 머리줄이 흔들린다 — 보이는 것은 그대로 두고 누를 자리만 넓힌다(HelpTip 과 같은 규칙).
      className={'inline-flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center gap-1.5 '
        + 'rounded-full text-ds-v3-ink-2 transition-colors btn-press '
        + 'hover:bg-ds-v3-bg hover:text-ds-v3-ink '
        + (글자 ? 'px-4 t-sub font-semibold ' : '')
        + className}
    >
      <X size={18} aria-hidden="true" />
      {글자 && <span>{label}</span>}
    </button>
  )
}
