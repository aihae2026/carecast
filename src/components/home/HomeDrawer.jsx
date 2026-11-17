// 「간편모음」 서랍 — 즉시 방송 옵션 · 즐겨찾기 · BGM · 음량 · 시스템을 담는다. 평소엔 접혀 있다.
//
// **이름이 「소리 조절」이었다**(→ 간편모음, 사용자 지시 2026-09-14). 그 서랍에는 소리만
// 있는 것이 아니라 즐겨찾기·시스템 상태도 산다 — 이름이 좁으면 **거기 있는 줄 모른다.**
// 바꾼 것은 **이 서랍 하나**다. 관리자 화면의 음량 용어(「음량 및 TTS」 등)는 그대로 둔다.
// 이름을 「조작판」에서 바꿨다(사용자 지적 2026-09-13). 기계 앞에 선 느낌인 데다,
// **실제로 담긴 것이 소리뿐**이라 이름이 안쪽을 안 가리키고 있었다.
// **"누르고 말하기"는 여기 없다.** 급한 안내에 한 번 더 누르게 만들지 않으려고
// 서랍 밖(HomeMode 본문)에 상시 둔다(목업 v3 결정).
//
// ── transform 으로 밀지 않는다 (V③ Codex 검수 2026-09-13, high) ──────────────
// **조상에 `transform` 이 걸리면 그 자손의 `position:fixed` 가 화면이 아니라 그 조상을
// 기준으로 잡힌다.** 이 서랍 안에 전체화면 오버레이를 띄우는 부품이 살았고(당시 외부 동영상
// 판, 2026-09-21 제거), 그것이 portal 이 아니라 fixed 면 — `translate-x` 로 여닫을 때
// 홀 TV 로 띄우는 화면이 **서랍 폭 안에 갇힌다.** 그래서 `right` 를 움직인다.
// 느낌은 조금 덜 부드럽지만, 갇히는 것보다 낫다.
//
// ── 닫힌 서랍은 키보드로도 닿으면 안 된다 (같은 검수, medium) ────────────────
// `aria-hidden` + `pointer-events-none` 만으로는 **Tab 으로 들어가진다.** 게다가
// `aria-hidden` 안에 포커스 가능한 요소가 있는 것은 ARIA 위반이다. `inert` 로 막는다 —
// 포커스·클릭·보조기술 접근을 한 번에 끊고, **요소는 그대로 살아 있어 BGM 이 안 끊긴다.**
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function HomeDrawer({ open, onClose, children }) {
  const panelRef = useRef(null)
  const lastFocus = useRef(null)

  // `inert` 는 JSX 속성으로 넘기면 React 판에 따라 무시된다. DOM 에 직접 세운다.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (open) el.removeAttribute('inert')
    else el.setAttribute('inert', '')
  }, [open])

  // **의존성은 `open` 하나뿐이다.** 예전엔 `[open, onClose]` 였는데, 부르는 쪽이
  // `onClose={() => setDrawerOpen(false)}` 로 **매 렌더 새 함수**를 준다. 그래서 홈이
  // 다시 그려질 때마다(예: 예약 하나가 저장돼 목록을 다시 읽을 때) 이 effect 가 통째로
  // 다시 돌아 **초점을 서랍 껍데기로 도로 끌어갔다** — 음량 막대를 키보드로 만지던 중이면
  // 다음 화살표 키가 아무 데도 안 먹는다(V② 적대 검수 2026-09-13).
  // 그래서 최신 `onClose` 는 ref 로 들고 effect 는 열림/닫힘에만 반응한다.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement
    panelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current() } }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // 닫히면 원래 자리로 돌려준다. 안 그러면 포커스가 body 로 떨어져 탭 순서가 처음으로 간다.
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    }
  }, [open])

  // **머리줄 높이는 재서 받는다**(`HomeShell` 이 `--cc-header-h` 를 세운다).
  // 64 로 박아 뒀더니 1440 미만에서 탭 줄이 한 줄을 더 쓰는 만큼(실측 103px) 서랍 위 39px 이
  // 머리줄에 덮였고, **그 자리의 「닫기」 단추가 아예 안 눌렸다** — 머리줄이 z-40 으로 위라
  // 클릭을 먹는다(`elementsFromPoint` 로 확인). 폰에는 Escape 키도 없다.
  // 폴백 64 는 값이 아직 안 섰을 때 한 틱 동안만 쓰인다.
  return (
    <aside id="home-drawer" ref={panelRef} tabIndex={-1} aria-label="간편모음"
      className={'fixed top-[var(--cc-header-h,64px)] bottom-0 z-[35] wide:w-[300px] '
        + 'w-[min(320px,calc(88vw/var(--cc-zoom,1)))] '
        + 'overflow-y-auto border-l border-ds-v3-line bg-ds-v3-surface p-3.5 pb-24 '
        + 'shadow-v3-panel '
        + 'transition-[right] duration-300 motion-reduce:transition-none '
        // `right: -min(…)` 은 유효한 CSS 가 아니다 — calc 로 부호를 준다
        + (open ? 'right-0'
          : 'right-[calc(-1*min(320px,calc(88vw/var(--cc-zoom,1))))] wide:right-[-300px]')}>
      <div className="mb-2 flex items-center gap-2 px-1 pt-1">
        <span className="text-sm font-semibold">간편모음</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose}
          className="inline-flex min-h-[32px] items-center gap-1.5 px-1 text-[13px] font-semibold
                     text-ds-v3-ink-2 hover:text-ds-v3-ink hover:underline">
          닫기 <X size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </aside>
  )
}
