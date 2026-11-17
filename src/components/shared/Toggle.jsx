import { useState } from 'react'

// iOS 스타일 토글 스위치 — checked 전달 시 controlled, 미전달 시 defaultChecked 기반 uncontrolled
export default function Toggle({ defaultChecked = false, checked: controlledChecked, onChange }) {
  const isControlled = controlledChecked !== undefined
  const [internal, setInternal] = useState(defaultChecked)
  const on = isControlled ? controlledChecked : internal

  const handleClick = () => {
    const next = !on
    if (!isControlled) setInternal(next)
    onChange?.(next)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full
                  transition-colors duration-300 focus:outline-none ${
                    on ? 'bg-ds-v3-tts' : 'bg-[#D1D5DB]'
                  }`}
      aria-checked={on}
      role="switch"
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white
                    shadow-sm transition-transform duration-300 ${
                      on ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
      />
    </button>
  )
}
