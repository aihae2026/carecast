import { useState, useRef, useEffect } from 'react'
import { HelpCircle, AlertTriangle } from 'lucide-react'
import { helpFor } from '../../lib/helpText'
import { 먹은배율 } from '../../lib/bigView'

// 카드 제목 옆 ⓘ — 마우스를 올리면 설명이 뜬다. 문구는 src/lib/helpText.js 한 곳에 있다.
//
// 여기서 조심한 것 셋:
//
// 1) **누르면 방송이 나가는 카드가 있다.** 즐겨찾기·차임벨은 확인 창 없이 바로 홀에 나간다.
//    도움말을 누르려다 그 버튼이 눌리면 실제 방송 사고다. 그래서 클릭·터치를 여기서 전부
//    멈춰 세운다(stopPropagation + preventDefault). type="button"도 같은 이유 —
//    폼 안에 놓이면 기본값 submit이라 엉뚱한 전송이 일어난다.
//
// 2) **현장 PC는 터치 화면일 수 있다.** hover만 달면 손가락으로는 영영 못 연다.
//    그래서 누르면 고정되고(open), 바깥을 누르거나 Esc로 닫힌다.
//
// 3) **말풍선은 position:fixed로 띄운다.** 카드가 좁고(easy-card) 목록은 스크롤되므로
//    카드 안에 absolute로 두면 잘린다. 버튼 위치를 재서 화면 좌표에 직접 놓고,
//    오른쪽·아래로 넘치면 안쪽으로 접어 넣는다.

// 글자를 12px 에서 14px 로 올렸으니(T-3 바닥) 폭도 같이 넓힌다 — 안 넓히면 같은 문장이
// 두 줄 길어진다. 300 은 G-25 의 본문 상한(720) 안이고, 좁은 화면(390)에서도
// 좌우 8px 여백을 남기고 들어간다.
const BUBBLE_W = 300

export default function HelpTip({ id, className = '' }) {
  const help = helpFor(id)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btnRef = useRef(null)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // **크게 보기(zoom)면 배율로 나눠서 넣는다** (2026-09-18) — 잰 자리는 확대된 화면 기준인데
    // style 의 px 에는 확대가 한 번 더 곱해진다. 안 나누면 1.25배에서 말풍선이 오른쪽으로 밀려
    // 화면 밖으로 나갔다. 처음 안내(`HomeTour`)·캘린더 쪽지와 같은 규칙이다.
    const z = 먹은배율()
    const 그려질폭 = BUBBLE_W * z
    const left = Math.min(Math.max(8, r.left - 그려질폭 / 2 + r.width / 2), window.innerWidth - 그려질폭 - 8)
    setPos({ left: Math.max(8, left) / z, top: (r.bottom + 8) / z })
  }

  const show = () => { place(); setOpen(true) }
  const hide = () => setOpen(false)
  const toggle = (e) => {
    // 카드 버튼으로 클릭이 새어 나가면 방송이 나갈 수 있다 — 여기서 끊는다
    e.preventDefault()
    e.stopPropagation()
    if (open) hide(); else show()
  }

  useEffect(() => {
    if (!open) return
    const onKey     = (e) => { if (e.key === 'Escape') hide() }
    const onOutside = (e) => { if (!btnRef.current?.contains(e.target)) hide() }
    // 스크롤·리사이즈로 버튼이 움직이면 말풍선만 제자리에 남는다 — 그냥 닫는다
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('mousedown', onOutside)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [open])

  // 사전에 없는 이름을 부르면 조용히 사라지지 않고 개발 중에 드러나야 한다
  if (!help) {
    console.error(`[도움말] "${id}" 문구가 helpText.js에 없다`)
    return null
  }

  // 아이콘은 14px 그대로 두고 **누를 자리만** 24×24 로 넓힌다(UX-42, WCAG 2.2 AA).
  // 물음표가 커지면 옆 글자와 높이가 안 맞아 줄이 흔들린다 — 보이는 것은 그대로다.
  // 음(-)의 바깥여백으로 넓힌 만큼을 도로 당겨 **글 흐름은 그대로** 둔다.
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${help.title} 설명`}
        onClick={toggle}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex items-center justify-center min-w-[24px] min-h-[24px] -m-[5px]
                    text-ds-v3-ink-2 hover:text-ds-v3-tts
                    transition-colors flex-shrink-0 ${className}`}
      >
        <HelpCircle size={14} />
      </button>

      {/* **어두운 말풍선은 그대로 둔다.** 밝은 카드 위에 뜨므로 색이 뒤집혀야
          "설명이지 내용이 아니다"가 즉시 읽힌다. 다만 인라인 hex 넷(#1f2937·#f3f4f6·
          #d1d5db·#fca5a5)은 걷었다 — 토큰 밖의 사본이라 팔레트가 바뀌어도 안 따라온다.
          글자는 12px → `.t-sub`(14px, T-3 바닥). 그만큼 넓혀야 같은 문장이 안 길어진다. */}
      {open && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[9998] rounded-[10px] bg-ds-v3-ink px-3.5 py-3
                     text-left text-white shadow-lg"
          style={{ left: pos.left, top: pos.top, width: BUBBLE_W }}
        >
          <p className="t-sub mb-1 font-semibold">{help.title}</p>
          <p className="t-sub text-white/80">{help.body}</p>
          {help.warn && (
            <p className="t-sub mt-2 flex items-start gap-1.5 font-semibold text-white">
              <AlertTriangle size={15} className="mt-[3px] flex-shrink-0" aria-hidden="true" />
              <span>{help.warn}</span>
            </p>
          )}
        </div>
      )}
    </>
  )
}
