// 서버와의 연결이 살아 있는지 스스로 재는 감시기 — 끊기면 배너, 복구되면 새로고침.
//
// App.jsx에서 갈라져 나왔다. 이 파일만 lib/api를 안 쓰고 raw fetch를 부른다(TD-08 예외).
// 그 예외 사유는 아래 check() 안의 주석에 적혀 있고, frontend-api-single-source.test.js가
// **이 파일 경로로** 예외를 등록해 두고 사유 주석이 남아 있는지 확인한다.
import { useEffect, useRef, useState } from 'react'

// WiFi 변경 시 서버 연결 감시 — 끊기면 배너 표시, 복구되면 페이지 새로고침
export default function useConnectionWatch() {
  const [offline, setOffline] = useState(false)
  const wasOffline = useRef(false)
  const failCount  = useRef(0)

  useEffect(() => {
    let timer = null

    async function check() {
      try {
        // 타임아웃을 3초로 잡았더니 **서버가 멀쩡한데도** 오버레이가 떴다. HTTPS가 꺼져 있어
        // HTTP/1.1이고, 브라우저는 주소 하나당 소켓 6개뿐인데 SSE가 창마다 하나씩 영구
        // 점유한다(로그 실측: 동시 3명). 거기에 자동방송순서편집기처럼 진입하자마자 대여섯
        // 개를 한꺼번에 쏘는 화면이 겹치면 이 체크가 큐에서 3초를 그냥 넘긴다.
        // 넉넉히 주고, 3연속 실패해야 끊긴 것으로 본다 — 진짜 끊김은 어차피 계속 실패한다.
        const sig = typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(8000)
          : undefined
        // 여기만 lib/api를 안 쓴다(TD-08 예외). 연결 감시는 **자기 시계로** 판정해야 하는데
        // apiGet은 10초 고정이고 signal을 받지 않는다. 이 경로가 필요한 것은 "얼마나 기다릴지"를
        // 스스로 정하는 것이다 — 실제로 3초는 짧아서 8초로 늘렸고(deea22b), 한 번 늦었다고
        // 끊긴 것으로 보지 않으려고 3연속 실패를 조건으로 뒀다. apiGet에 매였으면 둘 다 못 한다.
        const res = await fetch('/api/status', { cache: 'no-store', signal: sig })
        failCount.current = 0

        // ── **업데이트 뒤 새로고침은 「서버가 새로 뜬 뒤」다** (현장 지적 2026-09-15) ──────
        //
        // 앞 판은 업데이트 표식이 있으면 **다음 성공 응답에서 바로** 새로고침했다.
        // 그런데 서버는 그 신호를 보내고 **1.5초 뒤에** 죽는다(`autoUpdate.restart`).
        // 그 사이에 새로고침이 걸리면 화면 파일을 받아오는 도중에 서버가 내려가
        // **흰 화면**이 된다. 사용자가 두 번 겪었다 — *"업데이트되면 공백상태에서
        // 멈춰있다, F5 눌러야 돌아온다"*.
        //
        // 그래서 **프로세스가 실제로 새로 떴는지**를 보고 새로고침한다.
        // `procUptime` 이 줄어들면 새 프로세스다. 늘어나는 동안은 아직 옛 서버다.
        // `uptime`(PC 부팅 기준)으로는 이것을 못 본다 — 재시작해도 안 줄어든다.
        //
        // **끊김을 본 경우(`wasOffline`)는 예전 그대로** 바로 새로고침한다. 그때는
        // 이미 서버가 죽었다 살아난 것이라 기다릴 이유가 없다.
        let procUp = null
        try { procUp = (await res.clone().json())?.procUptime ?? null } catch { /* 옛 서버는 이 칸이 없다 */ }

        const 업데이트대기 = sessionStorage.getItem('cc_server_update_pending') === '1'
        if (업데이트대기 && !wasOffline.current) {
          // 옛 서버(이 칸이 없다)에서는 **예전 규칙 그대로** 간다 — 새 규칙을 못 지키는
          // 서버에서 영영 새로고침을 안 하면, 고치려던 것보다 나쁘다.
          if (procUp == null) {
            sessionStorage.removeItem('cc_server_update_pending')
            window.location.reload()
            return
          }
          const 기준 = Number(sessionStorage.getItem('cc_update_proc_uptime'))
          if (!Number.isFinite(기준)) {
            // 이 표식을 처음 본 순간의 가동 시간. 이것보다 작아지면 새 프로세스다.
            sessionStorage.setItem('cc_update_proc_uptime', String(procUp))
          } else if (procUp < 기준) {
            sessionStorage.removeItem('cc_server_update_pending')
            sessionStorage.removeItem('cc_update_proc_uptime')
            window.location.reload()
            return
          }
          setOffline(false)
          timer = setTimeout(check, 4000)
          return
        }

        if (wasOffline.current) {
          sessionStorage.removeItem('cc_server_update_pending')
          sessionStorage.removeItem('cc_update_proc_uptime')
          window.location.reload()
          return
        }
        setOffline(false)
      } catch {
        failCount.current += 1
        // 3회 연속 실패해야 오프라인으로 간주 (순간적 타임아웃 오탐 방지)
        if (failCount.current >= 3) {
          wasOffline.current = true
          setOffline(true)
        }
      }
      timer = setTimeout(check, 4000)
    }

    timer = setTimeout(check, 5000)  // 5초 후 첫 체크 시작

    // ── **브라우저가 주는 신호에도 곧바로 확인한다** (현장 지적 2026-09-15) ────────────
    //
    // *"모바일에서 접속했는데 밖에 나가면서 와이파이가 끊겼다가, 다시 접속하면 검은 화면에
    //   머물러 있어."* — 그 검은 화면이 「서버 재연결 중」 덮개다.
    //
    // 원인은 **타이머만 믿은 것**이다. 휴대폰은 화면을 끄거나 다른 앱으로 가면 그 탭의
    // 타이머를 **늦추거나 아예 멈춘다**(iOS 는 페이지를 통째로 얼린다). 그러면 4초마다
    // 돌던 확인이 안 돌고, 와이파이가 돌아와도 **아무도 그 사실을 모른다.**
    // 사람은 창을 껐다 켜야 했다 — 그건 고쳐야 하는 쪽이다.
    //
    // 그래서 **브라우저가 알려 주는 세 순간**에 그 자리에서 다시 확인한다:
    //   · `online`         — 네트워크가 붙었다
    //   · `visibilitychange` — 화면이 다시 보인다(잠금 해제·앱 전환 복귀)
    //   · `pageshow`       — 얼려 뒀던 페이지가 되살아났다(iOS 뒤로가기 캐시)
    //
    // **재는 일은 그대로 `check()` 하나가 한다** — 판정이 두 벌이 되면 언젠가 갈린다.
    // 앞서 걸린 타이머는 지우고 다시 건다(같은 순간에 둘이 돌지 않게).
    const 지금확인 = () => {
      if (document.hidden) return          // 아직 안 보이면 굳이 지금 안 묻는다
      clearTimeout(timer)
      timer = setTimeout(check, 0)
    }
    const onShow = (e) => { if (e?.persisted || !document.hidden) 지금확인() }
    window.addEventListener('online', 지금확인)
    window.addEventListener('pageshow', onShow)
    document.addEventListener('visibilitychange', 지금확인)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', 지금확인)
      window.removeEventListener('pageshow', onShow)
      document.removeEventListener('visibilitychange', 지금확인)
    }
  }, [])

  return offline
}
