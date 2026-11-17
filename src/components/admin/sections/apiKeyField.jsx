// API 키 입력 칸 — 카드 넷이 함께 쓰는 잎 부품.
//
// APISettings.jsx(1,113줄)에서 옮겨 왔다(2026-09-05, TD-10 기회식). **옮기기만 했고 동작은
// 바꾸지 않았다.** 부모(APISettings)에 두지 않은 이유: 카드 파일 넷이 전부 이것을 쓰는데,
// 부모에 두면 부모→자식·자식→부모 **순환 import**가 된다(broadcastSequencer 분할에서 실제로
// 걸렸던 유일한 함정).
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// ── 공통 API 키 입력 필드 컴포넌트 ──────────────────────────
function ApiKeyField({ value, masked, isSet, onChange, onClear, placeholder }) {
  const [show, setShow] = useState(false)
  if (isSet && !value) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-ds-v3-ink-2 font-mono bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 flex-1">{masked}</span>
        <button onClick={onClear} className="text-xs text-ds-v3-ink-2 hover:underline whitespace-nowrap inline-flex items-center min-h-[24px] px-1 -mx-1">변경</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className="input-base pr-10 font-mono" />
      <button onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-[24px] min-h-[24px] -mr-[5px] text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

export { ApiKeyField }
