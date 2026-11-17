import { useEffect, useState } from 'react'
import { MonitorOff } from 'lucide-react'
import { openSSEBus } from '../../lib/api'
import { _IS_LOCAL } from '../../lib/isLocal'

/**
 * **현장 PC에 방송 화면이 안 열려 있습니다.**
 *
 * ── 왜 이 띠가 있나 (현장 사고 2026-09-14) ──────────────────────────────────
 * 18:00 저녁 마무리 방송이 **소리 없이** 지나갔다. 화면에는 재생 표시가 떴고, 환기방송도 같았다.
 * 원인은 현장 PC에 `localhost` 로 열린 창이 **하나도 없었다**는 것이다. 예약 TTS·녹음
 * 음원·BGM·영상은 **브라우저가** 재생하고, 그 판정은 `lib/isLocal.js` 가 한다 —
 * 랜 주소(`192.168.0.8`)로 연 창은 **화면만 그리고 소리는 안 낸다.**
 *
 * 서버는 그 사실을 알고 있었다(`/api/health` 의 `localClients: 0`). **아무도 안 봤을 뿐이다.**
 * 방송 시각을 기다려야 알 수 있는 경보와 달리, 이 띠는 **그 상태가 되는 즉시** 보인다.
 *
 * ── 왜 원격 창에만 띄우나 ───────────────────────────────────────────────────
 * 현장 창(localhost)이 이것을 보고 있다면 그 창 자신이 세어지므로 0 일 수 없다. 0 인데도
 * 현장 창에 띄우면 「네가 없다」는 말이 되어 사람을 헷갈리게 한다. 그래서 원격 창만 띄운다 —
 * **오늘 사고에서 사람이 실제로 보고 있던 창이 그 원격 창이다.**
 *
 * ── 무엇을 근거로 하나 ──────────────────────────────────────────────────────
 * 서버가 `sound_owner` 에 실어 보내는 `siteScreens`(살아 있는 현장 연결 수)다. 화면이 따로
 * 세지 않는다 — 판정이 두 벌이면 언젠가 갈린다. 숫자를 못 받았으면(`null`) **아무 말도
 * 안 한다.** 모르는 것을 경고로 바꾸면 며칠 뒤부터 아무도 안 본다.
 */
export default function SiteScreenWarning() {
  const [screens, setScreens] = useState(null)
  // **이 창이 서버와 같은 기계에서 열렸나** (현장 지적 2026-09-15).
  // 이 띠는 원격 창에만 뜨는데, 「localhost 를 여세요」 단추는 **현장 PC 에서만** 쓸모가
  // 있다. 직원 폰에서 누르면 그 폰의 localhost 라 아무 데도 안 닿는다.
  // 서버가 연결 주소로 판정해 알려 준다 — 화면이 스스로는 알 수 없는 사실이다.
  const [같은기계, set같은기계] = useState(false)

  useEffect(() => {
    // 창에 하나뿐인 연결에 붙는다(SystemAlertBanner 와 같은 규칙 — 창 하나가 소켓을
    // 여러 개 물면 서버의 현장 연결 수가 그만큼 부풀어 이 판정 자체가 흐려진다).
    const es = openSSEBus()
    const on = (e) => {
      try {
        const d = JSON.parse(e.data)
        setScreens(typeof d.siteScreens === 'number' ? d.siteScreens : null)
        // **붙는 순간에만 실려 온다.** 뒤에 오는 전파 이벤트에는 이 칸이 없으므로,
        // 있을 때만 갱신한다 — 없다고 false 로 되돌리면 단추가 깜빡이며 사라진다.
        if (typeof d.sameMachine === 'boolean') set같은기계(d.sameMachine)
      } catch { /* 깨진 payload 는 무시 — 모르는 채로 둔다 */ }
    }
    es.addEventListener('sound_owner', on)
    // **`openSSEBus()` 에는 `removeEventListener` 가 없다**(V③ R11 지적, 2026-09-14).
    // 주는 것은 `addEventListener` 와 `close` 둘뿐이다 — 없는 것을 부르면 **정리 함수가
    // 던지고 구독이 그대로 남는다.** `close()` 는 **이 묶음이 건 구독만** 걷는다
    // (창의 공용 연결을 끊는 것이 아니다 — `offs` 만 되돌린다).
    return () => es.close()
  }, [])

  if (_IS_LOCAL || screens !== 0) return null

  return (
    <div role="status"
         className="mx-auto mb-2 flex w-full max-w-[1280px] items-start gap-2.5 rounded-xl
                    border border-ds-v3-line-2 bg-ds-v3-surface-2 px-3.5 py-2.5 text-ds-v3-ink-2">
      <MonitorOff size={18} className="mt-[2px] shrink-0" />
      <div className="text-[13px] leading-[1.5]">
        <b className="font-semibold">현장 PC에 방송 화면이 안 열려 있습니다.</b>
        {' '}지금 상태로는 <b>예약 방송·음원·배경음악에서 소리가 나지 않습니다.</b>
        <br />
        현장 PC에서 <b>http://localhost:3001</b> 을 열어 두시면 됩니다.
        {' '}이 화면처럼 다른 주소로 연 창은 화면만 보이고 소리를 내지 않습니다.
        {/* ── **단추는 그것이 통하는 창에만 보인다** (현장 지적 2026-09-15) ──────────
            이 띠는 *"localhost 를 여세요"* 라고 **말만** 했다. 현장 PC 에서 랜 주소로
            연 창에서는 그 한 줄이 **주소를 손으로 옮겨 치라는 뜻**이 된다 — 그날 실제로
            그랬다(바탕화면 아이콘이 랜 주소였다).

            그렇다고 단추를 늘 보여 주면 **앞뒤가 안 맞는다**: 이 띠는 원격 창에만 뜨므로
            직원 폰에도 보이는데, 폰에서 누르면 **그 폰의 localhost** 라 아무 데도 안 닿는다.
            사용자 지적 그대로다 — *"이건 원격 pc 고려 안 한 거 아니야?"*

            그래서 **서버가 「이 창이 나와 같은 기계인가」를 알려 주고**, 같을 때만 단추를
            낸다. 화면은 그것을 스스로 알 수 없다(랜 주소로 열면 자기도 원격으로 보인다).
            다른 기기에는 단추 대신 **무엇을 해야 하는지**를 적는다. */}
        {같은기계 ? (
          <div className="mt-2">
            <a href="http://localhost:3001" target="_blank" rel="noreferrer"
               className="inline-flex min-h-[32px] items-center rounded-lg border border-ds-v3-line-2
                          bg-white px-3 text-[12px] font-semibold text-ds-v3-ink-2
                          hover:bg-ds-v3-surface-2 focus:outline-none focus:ring-2 focus:ring-ds-v3-line-2">
              이 PC가 현장 PC입니다 — 눌러서 소리 나는 창 열기
            </a>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-ds-v3-ink-2/80">
            지금 보시는 기기에서는 해결할 수 없습니다 — <b>현장 PC에서</b> 열어 주셔야 합니다.
          </div>
        )}
      </div>
    </div>
  )
}
