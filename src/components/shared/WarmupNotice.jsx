import { useEffect, useState } from 'react'
import { apiGet } from '../../lib/api'

// ── **준비 중이면 준비 중이라고 말한다** (사용자 지시 2026-09-16) ────────────────
//
// *"차라리 그러면 합성중이면 지금 설정중입니다. 잠시만 기다려주세요 이렇게 띄우던가"*
//
// 사용자가 원인을 정확히 짚었다: *"좀 뒤에 되니까 속도가 붙는것 같은데, 이거 뒤에서
// 백그라운드 뭐 설치하고 적용해야해서 늦는거 아니야? 그러면 사용자경험이 떨어지잖아"*
//
// 맞다. 갓 설치한 PC 의 첫 기동은 방송 문안을 **여덟 번 합성한다**(실측 2.1~2.6초씩,
// 합쳐서 18초 안팎). 그동안 파이썬이 계속 뜨고 지므로 화면도 같이 굼뜨다.
//
// **그 일을 없앨 수는 없다.** 미리 만들어 두지 않으면 정시 방송이 그만큼 늦어지고 그쪽이
// 훨씬 비싸다. 없앨 수 없으면 **말이라도 해야 한다** — 말 없이 굼뜬 것은 고장으로 읽힌다.
//
// ── 스스로 멈추는 폴링 ──────────────────────────────────────────────────────
// 한 번 물어보고 **준비 중일 때만** 이어서 묻는다. 끝나면 더 안 묻는다. 평소(두 번째
// 기동부터)는 캐시가 차 있어 첫 물음 한 번으로 끝난다 — 늘 도는 타이머를 만들지 않는다.
const 물음간격ms = 2000
// 아무리 오래 걸려도 이만큼 지나면 그만 묻는다. 음성 합성이 매달리면 준비가 안 끝나는데,
// 그때 화면이 영원히 묻고 영원히 띠를 띄우고 있으면 그건 다른 고장이다.
const 그만묻기ms = 5 * 60 * 1000

export default function WarmupNotice() {
  const [준비, set준비] = useState(null)

  useEffect(() => {
    let 살아있음 = true
    let 타이머 = null
    const 시작 = Date.now()

    const 묻기 = async () => {
      if (!살아있음) return
      let w
      try {
        const h = await apiGet('/api/health')
        w = h?.warmup ?? null
      } catch {
        // 서버가 아직 안 떴거나 끊겼다. **띠를 띄우지 않는다** — 연결 문제는 다른 장치가
        // 알린다(useConnectionWatch). 여기서 겹쳐 말하면 화면에 경고가 두 줄이 된다.
        w = null
      }
      if (!살아있음) return
      // 계속 물을지와 띠를 띄울지를 **같은 조건**으로 정한다(2026-09-26 Codex 검수 Medium). 예전엔 5분이 지나
      // 묻기만 멈추고 마지막 「준비 중」이 남아, 준비가 끝난 뒤에도 새로고침 전까지 띠가 떠 있었다.
      const 계속 = w?.running && Date.now() - 시작 < 그만묻기ms
      set준비(계속 ? w : null)
      if (계속) 타이머 = setTimeout(묻기, 물음간격ms)
    }
    묻기()
    return () => { 살아있음 = false; if (타이머) clearTimeout(타이머) }
  }, [])

  if (!준비) return null

  const 남음 = Number(준비.remaining) || 0
  return (
    <div role="status" aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-ds-v3-line
                 bg-ds-v3-tts-bg px-4 py-2 text-center text-[13px] text-ds-v3-ink">
      {/* 도는 동그라미 — 「멈춘 것이 아니라 하는 중」을 색이 아니라 움직임으로 말한다.
          움직임을 꺼 둔 사람에게는 안 돈다(`motion-safe`). */}
      <span aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-ds-v3-tts
                   border-t-transparent motion-safe:animate-spin" />
      <span className="font-semibold">지금 설정 중입니다. 잠시만 기다려 주세요.</span>
      <span className="text-ds-v3-ink-3">
        {/* **무엇을 하는지 적는다.** 「잠시」가 얼마인지 모르면 사람은 고장으로 읽는다. */}
        {준비.단계 ? `${준비.단계}` : '준비 중'}
        {남음 > 0 ? ` · ${남음}건 남음` : ''}
      </span>
    </div>
  )
}
