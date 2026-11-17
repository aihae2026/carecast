// **크게 보기 단추** (사용자 지시 2026-09-15).
//
// *"노인들을 위한 큰화면보기도 하나 만들어주면 좋겠네 … 확대경처럼,
//   그 버튼은 적당한데 넣어봐."*
//
// 머리줄 오른쪽 끝, 탭들 옆에 둔다. **한 단추로 세 칸을 돈다**(보통 → 크게 → 아주 크게
// → 보통). 켜고 끄는 두 값이면 「조금만 키우고 싶다」를 못 하고, 슬라이더를 두면
// 어르신 앞에서 만지다가 이상한 값에 걸린다.
//
// **지금 몇인지 글자로 말한다** — 돋보기 아이콘만 두면 눌러 보기 전에는 지금이
// 어느 상태인지 모른다(G-7: 색·모양만으로 말하지 않는다).
import { useEffect, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { 다음배율, 먹이기, 읽기, 저장, 이름, 정리, 되돌릴배율 } from '../../lib/bigView'
import { useTourStage } from '../../lib/tourStage'

export default function BigViewButton() {
  // **첫 값부터 저장해 둔 것으로 시작한다.** 1 로 시작한 뒤 효과에서 고치면
  // `react-hooks/set-state-in-effect` 에 걸리고, 그 규칙이 막으려는 것(한 번 더 그리는 일)도
  // 실제로 일어난다 — 화면이 잠깐 작게 떴다가 커진다.
  const [배율, set배율] = useState(읽기)

  // 저장해 둔 값을 **화면이 뜨자마자** 먹인다. 안 그러면 새로고침할 때마다 작아진다.
  useEffect(() => { 먹이기(읽기()) }, [])

  // 처음 안내(N18)가 글씨를 실제로 키워 보인다 — **저장하지 않고**(다음 배율만 먹인다), 끝나면 저장해 둔 값으로 되돌린다.
  useTourStage({
    'zoom.next': () => set배율((b) => { const 다음 = 다음배율(b); 먹이기(다음); return 다음 }),
    'zoom.restore': () => { const v = 되돌릴배율(); set배율(v); 먹이기(v) },
  })

  const 누름 = () => {
    const 다음 = 다음배율(배율)
    set배율(다음)
    // **저장이 먼저다**(2026-09-26 Codex 검수 Medium) — 먹이기가 배율 알림을 쏘는 순간 useViewWidth 가 저장값을
    // 읽는다. 거꾸로면 옛 배율로 폭을 재서 확대 직후 머리줄·두 칸 배치가 창을 다시 바꿀 때까지 어긋났다.
    저장(다음)
    먹이기(다음)
  }

  const 켜짐 = 정리(배율) !== 1

  // 휴대폰 폭에서는 단추를 숨긴다(`hidden tablet:flex`) — 이유는 bigView.휴대폰폭 주석.
  // 창을 돌리거나 줄여 폭이 바뀌면 다시 먹인다(휴대폰 폭이면 1, 아니면 저장값).
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 833.98px)')
    if (!mq) return
    const 다시 = () => 먹이기(되돌릴배율())
    mq.addEventListener?.('change', 다시)
    return () => mq.removeEventListener?.('change', 다시)
  }, [])

  return (
    <button type="button" onClick={누름} data-tour="zoom"
      // **44px 을 채운다**(G-15). 이 단추를 누르는 사람이야말로 작은 것을 못 누른다.
      className={'hidden tablet:flex min-h-[40px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3 '
        + 't-sub font-semibold transition-colors btn-press '
        + (켜짐
          ? 'border-ds-v3-tts-line bg-ds-v3-tts-bg text-ds-v3-tts'
          : 'border-ds-v3-line-2 bg-white/60 text-ds-v3-ink-2 hover:bg-white')}
      title={`화면 크기 — 지금 ${이름(배율)}. 누르면 다음 크기로 바뀝니다`}
      aria-label={`화면 크게 보기, 지금 ${이름(배율)}`}>
      <ZoomIn size={15} aria-hidden="true" />
      {/* 좁은 화면에서는 아이콘만 — 머리줄이 두 줄이 되면 안 된다.
          그때도 `aria-label` 과 `title` 은 그대로라 뜻이 사라지지 않는다. */}
      <span className="hidden laptop:inline">{이름(배율)}</span>
    </button>
  )
}
