// 간편모음 서랍의 **「관리」 줄** — 탭에서 내려온 화면들로 가는 입구.
//
// ── 왜 생겼나 (사용자 결정 2026-09-15) ───────────────────────────────────────
// *"애초에 간편화면에서 전체예약 관리 들어가게끔할수 있게하면 위에 간편화면이랑
//   캘린더만 띄워주는건 어때 토글로."*
//
// 탭을 다섯에서 둘로 줄이면서 자동순서·업로드·설정이 갈 곳을 잃었다.
// **탭에서 빠진다고 화면이 없어지면 그건 줄인 것이 아니라 잃은 것이다.**
// 그래서 서랍에 줄 하나를 만들고 거기로 내려보낸다.
//
// ── 오히려 넓어진 길 ────────────────────────────────────────────────────────
// 탭 줄은 **휴대폰에서 안 그려지고 있었다**(탭 다섯이 좁은 화면에 안 들어가서).
// 서랍은 휴대폰에도 있으므로, 이 세 화면은 이제 **휴대폰에서 처음으로** 입구가 생겼다.
//
// ── 「전체 예약 관리」가 맨 위인 이유 ────────────────────────────────────────
// 사용자가 이름을 대서 요청한 것이고, 나머지 셋보다 자주 쓴다. 자주 쓰는 것이 위다.
// 도착지는 **캘린더의 목록 보기**다 — 예약을 한눈에 보고 고치는 자리가 거기다.
import { ListOrdered, Upload, Settings, CalendarRange, LayoutDashboard, FileText } from 'lucide-react'

/** 서랍에 내려온 화면들. `HomeShell` 의 `관리메뉴` 와 **같은 목록**을 쓰지 않는다 — */
// 그쪽은 「탭에서 뺀 것」이고 여기는 「서랍에 넣을 것」이라, 언젠가 갈릴 수 있는 두 판단이다.
// 지금은 내용이 같지만 한쪽을 고칠 때 다른 쪽이 딸려 가면 안 된다.
const 줄 = [
  { label: '전체 예약 관리', to: '/calendar?view=list', Icon: CalendarRange, 주 : true },
  { label: '자동 순서',      to: '/flow',               Icon: ListOrdered },
  { label: '업로드',         to: '/upload',             Icon: Upload },
  { label: '설정',           to: '/admin?section=systemSettings', Icon: Settings },
  // ── **메뉴에서 내려온 둘** (2026-09-16) ────────────────────────────────────
  // 휴대폰에서 머리줄의 「메뉴」를 안 그리게 되면서(`HomeBrandMenu`), 거기 있던
  // 「보기」 두 줄이 갈 곳을 잃었다. **탭에서 빠진다고 화면이 없어지면 그건 줄인 것이
  // 아니라 잃은 것이다**(이 파일 머리말과 같은 규칙) — 그래서 여기로 받는다.
  { label: '대시보드',       to: '/admin?section=dashboard',      Icon: LayoutDashboard },
  { label: '방송 로그',      to: '/admin?section=broadcastLog',   Icon: FileText },
]

export default function HomeAdminLinks({ onNavigate }) {
  return (
    <nav aria-label="관리" className="flex flex-col gap-1">
      {줄.map(({ label, to, Icon, 주 }) => (
        // G-15 — 손으로 누르는 것은 44px 이상이다.
        <button key={to} type="button" onClick={() => onNavigate(to)}
          className={'flex w-full items-center gap-2 btn-press min-h-[44px] rounded-[10px] '
            + 'border px-3 py-2.5 text-[13px] font-semibold transition-colors '
            + (주
              // 사용자가 이름을 대서 요청한 자리라 한 눈에 보이게 둔다.
              ? 'border-ds-v3-line-2 bg-white text-ds-v3-ink hover:bg-ds-v3-surface-2'
              : 'border-transparent bg-transparent text-ds-v3-ink-2 hover:bg-white/70 hover:text-ds-v3-ink')}>
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" className="flex-none" />
          {label}
        </button>
      ))}
    </nav>
  )
}
