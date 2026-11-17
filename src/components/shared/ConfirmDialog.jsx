// 되돌릴 수 없는 동작 앞에 서는 확인 한 단계 (가이드라인 G-42).
//
// **`window.confirm` 을 쓰지 않는다.** 그것은 브라우저 문구라 무엇이·어디로·지금 나가는지
// 못 적고, 기본 초점이 「확인」이라 엔터 한 번에 방송이 나간다.
//
// 여기서 지키는 것 넷:
//   ① **기본 초점은 「취소」다.** 실수로 엔터를 쳐도 아무 일이 안 일어난다.
//   ② Escape 로 닫힌다. 바깥을 눌러도 닫힌다.
//   ③ 닫히면 **초점이 원래 자리로** 돌아간다 — 안 그러면 탭 순서가 처음으로 간다.
//   ④ 실행 단추 글자는 **하는 일 그대로**다("확인"이 아니다).
//
// ②③ 은 이제 `useDialogA11y`, 껍데기는 `ModalShell` 이 준다(2026-09-13).
// **이 파일이 그 둘의 출처였다** — 제품에 뜨는 창 13벌 중 접근성 넷을 다 갖춘 유일한
// 창이라 규격으로 삼았다. 규격을 떼어 낸 뒤 이 파일이 그것을 안 쓰면 같은 것이 두 벌이 된다.
import { useRef } from 'react'
import ModalShell from './ModalShell'

export default function ConfirmDialog({
  open, title, body, 경고, confirmLabel, onConfirm, onClose, busy = false,
}) {
  const cancelRef = useRef(null)

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      // **`alertdialog` 다.** 화면 낭독기가 하던 말을 멈추고 이것부터 읽는다 —
      // 되돌릴 수 없는 동작 앞이라 그래야 한다.
      role="alertdialog"
      labelledBy="confirm-title"
      width="max-w-[420px]"
      첫초점={cancelRef}
      footer={
        <>
          <button ref={cancelRef} type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] rounded-full border border-ds-v3-line-2 px-5 t-sub font-semibold
                       text-ds-v3-ink-2 transition-colors hover:bg-ds-v3-surface-2 disabled:opacity-50">
            취소
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="min-h-[44px] rounded-full bg-ds-v3-ink px-5 t-sub font-semibold text-white
                       transition-colors hover:bg-black disabled:opacity-50">
            {busy ? '내보내는 중…' : confirmLabel}
          </button>
        </>
      }
    >
      <h2 id="confirm-title" className="t-group m-0 mb-2 text-ds-v3-ink">{title}</h2>
      <p className="t-body m-0 text-ds-v3-ink-2">{body}</p>
      {경고 && <p className="t-sub m-0 mt-1.5 font-semibold text-ds-v3-bgm">{경고}</p>}
    </ModalShell>
  )
}
