// 뜨는 창의 껍데기 — **13벌을 한 규격으로** (G-53~G-57, 2026-09-13).
//
// ── 왜 필요했나 ─────────────────────────────────────────────────────────────
// 전수로 세 보니 덮개 색이 6종, 카드 반경이 6종(10·12·14·16·18·20·28), 그림자가 5종이었다.
// 13개 중 테두리가 있는 것은 둘, `role`+`aria-modal` 을 가진 것은 둘, **초점이 돌아오는
// 것은 하나**뿐이었다. 창마다 닫는 법도 달라서, 여덟은 Escape 로 안 닫혔다.
//
// **기준을 새로 만들지 않았다.** 그 하나(`ConfirmDialog`, G-42 로 세운 것)를 규격으로 삼아
// 여기로 옮겼다 — 덮개 색이 토큰이고, 테두리가 있고, 그림자가 토큰이고, 접근성 넷을
// 갖춘 유일한 창이었다.
//
// ── 덮개는 하나다 (G-54) ────────────────────────────────────────────────────
// `bg-ds-v3-veil`(잉크 30%). **알파가 붙은 채로 토큰이다** — `bg-ds-v3-ink/30` 으로 썼다가
// 브라우저에서 `rgba(0,0,0,0)` 으로 잡혔다. Tailwind v3 는 `var()` 색에 투명도 수식어가
// 안 먹어 **조용히 투명해진다**(tokens.css 머리말이 경고하는 그 함정).
// **검정이 아니라 잉크**인 이유: 잉크 30% 는 물감이 도는 바탕 위에서
// "화면이 어두워졌다"로 읽히고, `bg-black/40~60` 은 "회색 막이 하나 더 얹혔다"로 읽혀
// 색이 탁해진다. **blur 는 안 건다** — 뒤가 흐려지면 무엇 위에 떠 있는지를 잃고,
// 전체 화면 blur 는 현장 PC(내장 그래픽)에서 창이 열릴 때마다 프레임을 떨어뜨린다.
//
// ── 모양은 둘뿐이다 (G-56) ──────────────────────────────────────────────────
//   · 짧은 창  — 머리줄 없음. 제목이 본문 첫 줄, 단추는 오른쪽 아래.
//   · 긴 창    — `sticky` 머리줄·바닥줄에 실선 하나씩. 스크롤돼도 제목이 안 사라진다.
// 구분은 `title` 을 줬는지로 한다.
import { createPortal } from 'react-dom'
import useDialogA11y from './useDialogA11y'
import CloseButton from './CloseButton'

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {string}   [title]        주면 머리줄이 생긴다(긴 창)
 * @param {ReactNode}[icon]         머리줄 제목 왼쪽 아이콘
 * @param {ReactNode}[footer]       주면 바닥줄이 생긴다
 * @param {ReactNode} children
 * @param {string}   [width='max-w-[520px]']
 * @param {'dialog'|'alertdialog'} [role='dialog']
 *        되돌릴 수 없는 확인은 `alertdialog` — 화면 낭독기가 하던 말을 멈추고 읽는다.
 * @param {React.RefObject} [첫초점]
 * @param {boolean}  [바깥클릭=true]
 *        **저장 안 한 입력이 있는 창은 `false`** (G-57). 자막 편집이 그렇다 —
 *        받아쓰기 결과를 사람이 고친 것이라 닫으면 통째로 사라진다.
 * @param {string}   [labelledBy]   제목이 본문 안에 있을 때 그 id
 */
export default function ModalShell({
  open, onClose, title, icon, footer, children,
  width = 'max-w-[520px]', role = 'dialog', 첫초점, 바깥클릭 = true, labelledBy,
}) {
  const 상자 = useDialogA11y(open, onClose, { 첫초점 })
  if (!open) return null

  const 제목id = title ? 'modal-title' : labelledBy

  // **`body` 로 포털한다.** 창은 제 부모의 `overflow`·`transform`·`z-index` 에 갇히면
  // 안 된다 — 서랍(`inert`)이나 `overflow-hidden` 안에서 열리면 반쯤 잘리거나
  // 아예 못 누른다(예전 TV 송출 오버레이에서 이미 겪었다).
  return createPortal(
    // ── **창이 이리저리 움직이지 않게** (사용자 신고 2026-09-15) ────────────────────
    // `inset-0` 은 세로로 `100vh` 와 같은데, **아이폰에서 `vh` 는 주소창을 포함한 가장 큰
    // 높이**다. 그래서 덮개가 실제로 보이는 영역보다 아래로 더 뻗고, 가운데 정렬이
    // **보이는 화면의 가운데가 아닌 곳**에 온다. 게다가 주소창이 접히고 펴질 때마다,
    // 글자칸을 눌러 자판이 올라올 때마다 그 기준이 바뀌어 **창이 움직인다.**
    //
    // `dvh`(동적 뷰포트 높이)는 **지금 실제로 보이는 높이**다 — 주소창·자판에 따라
    // 브라우저가 알아서 맞춘다. `h-[100dvh]` 로 덮개를 그 높이에 묶는다.
    // 모르는 브라우저를 위해 `inset-0` 도 남긴다(그쪽에서는 지금까지와 같다).
    <div
      className="fixed inset-0 h-[calc(100dvh/var(--cc-zoom,1))] z-[9000] flex items-center justify-center bg-ds-v3-veil p-4"
      onClick={바깥클릭 ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
    >
      <div
        ref={상자}
        data-tour="modal"
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={제목id}
        // 높이도 같은 이유로 `dvh` 다 — `90vh` 는 아이폰에서 **보이는 화면보다 커서**
        // 창 아래쪽(저장·취소 단추)이 주소창 뒤로 숨는다.
        className={'flex max-h-[calc(90dvh/var(--cc-zoom,1))] w-full flex-col overflow-hidden rounded-[14px] '
          + 'border border-ds-v3-line-2 bg-ds-v3-surface text-left shadow-v3-compose '
          + 'outline-none ' + width}
      >
        {title && (
          // 머리줄은 **불투명**하다. 반투명이면 스크롤할 때 본문 글자가 제목 밑으로 비쳐 지나간다
          // (`FlowBuilder` 가 `bg-white/90 backdrop-blur` 라 실제로 그랬다).
          <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-ds-v3-line
                          bg-ds-v3-surface px-5 py-3">
            {/* 아이콘은 **따로 받는다.** 제목 안에 넣으면 `truncate` 가 아이콘까지 잘라 먹는다. */}
            {icon && <span className="flex-shrink-0 text-ds-v3-ink-2" aria-hidden="true">{icon}</span>}
            <h2 id="modal-title" className="t-group m-0 min-w-0 flex-1 truncate text-ds-v3-ink">
              {title}
            </h2>
            <CloseButton onClose={onClose} label={`${title} 닫기`} />
          </div>
        )}

        <div className={'min-h-0 flex-1 overflow-y-auto ' + (title ? 'px-5 py-4' : 'p-5')}>
          {children}
        </div>

        {footer && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-ds-v3-line
                          bg-ds-v3-surface px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
