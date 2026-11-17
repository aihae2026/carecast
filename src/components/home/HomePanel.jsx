// 「소리 조절」 서랍 안의 그릇 하나 — 목업 v3 의 `.panel` (가이드라인 G-19).
//
// 머리줄은 **제목(14px 700) + 오른쪽 상태(13px ink-3)** 두 칸이다. 오른쪽 칸은
// "지금 어떤 상태인가"를 한 낱말로 말한다(재생 없음 · 보통 · 실시간 …) — 열어 보지 않아도
// 알 수 있게 하려는 것이다.
//
// **서랍 안에서만 쓴다.** 본문에는 `.panel` 을 두지 않는다 — 본문의 목록은 누끼라
// 배경 물감이 그대로 비쳐야 한다(G-21).
export default function HomePanel({ title, state, accent, children }) {
  return (
    <section className="rounded-[14px] border border-ds-v3-line bg-ds-v3-surface p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className={'m-0 text-sm font-semibold ' + (accent || 'text-ds-v3-ink')}>{title}</h3>
        {state && <span className="text-[13px] text-ds-v3-ink-3">{state}</span>}
      </div>
      {children}
    </section>
  )
}
