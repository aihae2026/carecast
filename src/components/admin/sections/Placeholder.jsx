import { Wrench, Info } from 'lucide-react'

// 아직 없는 메뉴가 **무엇 때문에 없는지** 말한다 (UX-41, 2026-09-11).
//
// 예전엔 전부 *"현재 준비 중입니다 · 다음 업데이트에서 사용할 수 있습니다"* 였다.
// 그런데 그 말이 **거짓인 자리**가 있다 — 사용자 권한 관리는 기다리면 생기는 것이 아니라
// **일부러 안 만든 것**이다(PROJECT_PROFILE §1-1: 인증이 없는 것이 설계다).
// 거짓 약속은 사람을 기다리게 만들고, 기다리는 동안 그 사람은 다른 방법을 안 찾는다.
//
// `상태` 를 주면 그 문구를 쓴다. 안 주면 예전처럼 "준비 중" 이다 — 진짜 준비 중인 자리는
// 그대로 두라는 뜻이다.
export default function Placeholder({ title = '준비 중', 상태, 설명, 조건 }) {
  const 일부러 = Boolean(상태)
  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-section text-ds-v3-ink">{title}</h1>
      </div>
      <div className="card-base flex flex-col items-center justify-center py-16 gap-5">
        <div className="w-16 h-16 rounded-full bg-ds-v3-bg border border-ds-v3-line
                        flex items-center justify-center">
          {일부러
            ? <Info size={28} className="text-ds-v3-tts/60" />
            : <Wrench size={28} className="text-ds-v3-line-2" />}
        </div>
        <div className="text-center max-w-lg px-4">
          <p className="text-base font-semibold text-ds-v3-ink">{상태 ?? '현재 준비 중입니다'}</p>
          <p className="text-sm text-ds-v3-ink-2 mt-2 leading-relaxed">
            {설명 ?? '이 기능은 다음 업데이트에서 사용할 수 있습니다.'}
          </p>
          {/* 전제가 바뀌는 조건을 함께 적는다 — "영영 안 한다" 와 "지금은 안 한다" 는 다르다. */}
          {조건 && (
            <p className="text-xs text-ds-v3-ink-2 mt-3 leading-relaxed border-t border-ds-v3-line pt-3">
              {조건}
            </p>
          )}
        </div>
        {!일부러 && (
          <span className="px-3 py-1 bg-ds-v3-bg border border-ds-v3-line rounded-full text-xs text-ds-v3-ink-2 font-normal">
            Coming Soon
          </span>
        )}
      </div>
    </div>
  )
}
