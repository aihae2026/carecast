import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { broadcastLogs, openSSEBus, getAckedAlerts, ackAlert } from '../../lib/api'
import {
  fromBroadcastRow, fromSSE, mergeAlerts, unacked, ack, localToday,
} from '../../lib/alertStore'

// 방송이 안 나갔거나 서버에 문제가 생겼다는 것을 **직원이 실제로 보는** 자리.
//
// 왜 필요했나(2026-08-29 리뷰 CC-014): 지금까지 실패는 console.error 한 줄이나 broadcasts
// 행 하나로만 남았다. 콘솔은 cmd 창이 닫히면 사라지고, 이력 테이블은 관리자 화면의
// '방송 이력' 메뉴에 들어가야 보인다 — 요양원 직원이 그 메뉴를 열 이유가 없다.
// 결과적으로 "무언가 잘못됐다"는 사실 자체가 아무에게도 전달되지 않았다.
//
// 설계에서 지킨 것 셋:
//  1) **확인 전에는 안 사라진다.** 기존 BroadcastToast는 5초 뒤 사라지는데, 자리를 비운
//     사이에 지나가면 없는 것과 같다. 경보는 등급이 다르다.
//  2) **새로고침해도 살아 있다.** 자동 업데이트가 페이지를 새로고침하는데, 하필 그때가
//     문제가 생긴 직후일 수 있다. 마운트 시 오늘자 경보 이력을 불러와 복원한다.
//  3) **자기 EventSource를 연다.** App.jsx의 SSE 핸들러는 200줄이고 방송 재생의 심장이라,
//     경보 하나 붙이자고 거기를 건드리면 위험 대비 이득이 나쁘다(MusicPlayer.jsx와 같은 방식).
export default function SystemAlertBanner() {
  const [alerts, setAlerts] = useState([])

  const push = useCallback((incoming) => {
    setAlerts(prev => unacked(mergeAlerts(prev, incoming)))
  }, [])

  // ── 새로고침 복원: 오늘자 경보 이력 ──────────────────────────
  //
  // **서버의 확인 목록을 먼저 받는다**(현장 지적 2026-09-15). 예전에는 확인 기록이
  // 이 브라우저에만 있어서, 주소·프로필·기기가 바뀌면 **확인이 없던 일이 되어 또 떴다.**
  // 서버 목록을 못 받으면 예전처럼 브라우저 기록만 쓴다 — 경보를 **숨기는 쪽**으로
  // 실패하지 않는 것이 이 배너의 규칙이라, 못 받았을 때 더 뜨는 것은 맞는 방향이다.
  useEffect(() => {
    let alive = true
    Promise.all([
      broadcastLogs(),
      getAckedAlerts().catch(() => null),
    ])
      .then(([rows, acked]) => {
        if (!alive) return
        const today = localToday()
        const 서버확인 = new Set(Array.isArray(acked?.ids) ? acked.ids : [])
        const restored = (rows ?? [])
          .map(fromBroadcastRow)
          .filter(a => a && a.date === today && !서버확인.has(a.id))
        if (restored.length) push(restored)
      })
      .catch(() => { /* 이력을 못 불러와도 아래 실시간 구독은 계속 동작한다 */ })
    return () => { alive = false }
  }, [push])

  // ── 실시간 구독 ──────────────────────────────────────────────
  useEffect(() => {
    // 창에 하나뿐인 연결에 붙는다(lib/api의 openSSEBus). 예전에는 여기서 따로 열어서,
    // 창 하나가 SSE 소켓을 셋씩 물고 있었다.
    const es = openSSEBus()

    const connect = () => {
      const onAlert = (e) => {
        try { push([fromSSE(JSON.parse(e.data), localToday())]) } catch { /* 깨진 payload는 무시 */ }
      }
      es.addEventListener('system_alert', onAlert)
      // 누락은 별도 이벤트로도 온다 — 화면이 그 방송 하나를 짚어 다룰 수 있게(watchdog.js)
      // **문구는 서버가 실어 보낸 것을 그대로 쓴다.** 여기서 다시 지으면 "시작은 했는데
      // 안 끝났다"가 "안 나갔다"로 둔갑하고, 경보 id(`날짜|종류|문구`)가 갈려서 같은 사건이
      // system_alert 한 줄 + 이 이벤트 한 줄로 **두 번** 뜬다.
      es.addEventListener('broadcast_missed', (e) => {
        try {
          const d = JSON.parse(e.data)
          if (!d.message) return   // 옛 서버가 보낸 것 — system_alert 쪽에 같은 경보가 이미 온다
          // 종류도 서버가 정한다 — '방송누락'(안 나감, 가림)과 '방송멈춤'(안 끝남, 띄움)이 다르다
          push([fromSSE({ kind: d.kind || '방송누락', message: d.message }, d.date || localToday())])
        } catch { /* 무시 */ }
      })
    }

    connect()
    return () => es.close()
  }, [push])

  // ── 화면 안에서 난 실패 ──────────────────────────────────────
  // 브라우저 재생 실패(App.jsx)는 서버를 거치지 않으므로 SSE로 오지 않는다.
  // api.js의 reportBroadcastFailure가 이 이벤트를 쏘고, 같은 문구로 이력에도 남기므로
  // 새로고침 후 복원될 때 같은 id로 합쳐진다(두 줄로 보이지 않는다).
  useEffect(() => {
    const onLocal = (e) => {
      const d = e?.detail
      if (d?.message) push([fromSSE(d, localToday())])
    }
    window.addEventListener('carecast:alert', onLocal)
    return () => window.removeEventListener('carecast:alert', onLocal)
  }, [push])

  if (!alerts.length) return null

  const dismiss = (id) => {
    ack(id)                                   // 이 창에서는 그 자리에서 사라진다
    // **서버에도 적는다**(현장 지적 2026-09-15). 브라우저에만 적으면 주소·프로필·기기가
    // 바뀔 때마다 확인이 없던 일이 되어 **들어갈 때마다 또 뜬다.**
    // 실패해도 막지 않는다 — 이 창에서 사라지는 것은 위 `ack` 가 이미 했다.
    ackAlert(id).catch(() => { /* 서버에 못 적어도 화면은 그대로 */ })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex flex-col">
      {alerts.map(a => (
        <div
          key={a.id}
          className="flex items-start gap-3 px-5 py-3.5 bg-ds-v3-warn text-white
                     border-b border-ds-v3-warn/40 shadow-lg"
        >
          <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{a.kind}</p>
            <p className="text-sm mt-0.5 leading-snug break-keep">{a.message}</p>
          </div>
          <button
            onClick={() => dismiss(a.id)}
            aria-label="확인"
            className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-sm font-semibold transition-colors"
          >
            <X size={14} />
            확인
          </button>
        </div>
      ))}
    </div>
  )
}
