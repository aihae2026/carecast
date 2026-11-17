// **이용 조건에 아직 동의하지 않은 현장 — 관리 화면 위 알림 띠** (사용자 결정 2026-10-07).
//
// 사용자 결정: 「처음 설정에서 받고, 이미 쓰는 현장은 알림 띠만 — 방송은 막지 않는다」.
// 그래서 이 띠는 **알리기만** 한다: 화면을 덮지 않고, 사람을 옮기지 않고, 누르면 「라이선스 · 고지」로 간다.
// **조회에 실패하면 띄우지 않는다** — 서버가 잠깐 멎었다고 「동의 안 함」으로 겁주지 않는다.
import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { getLicenseConsent } from '../../lib/api'
import { 동의필요 } from '../../lib/licenseNotice'

export default function LicenseConsentBanner({ onNavigate }) {
  const [보임, set보임] = useState(false)

  useEffect(() => {
    let 끝남 = false
    const 읽기 = () => getLicenseConsent()
      .then((r) => { if (!끝남) set보임(동의필요(r?.consent ?? null)) })
      .catch(() => { if (!끝남) set보임(false) })
    읽기()
    // 「라이선스 · 고지」 화면에서 동의하면 같은 창의 띠가 곧바로 내려간다.
    window.addEventListener('cc-license-consent', 읽기)
    return () => { 끝남 = true; window.removeEventListener('cc-license-consent', 읽기) }
  }, [])

  if (!보임) return null
  return (
    <div role="status" className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-ds-v3-line bg-ds-v3-surface-2 px-4 py-3 text-sm text-ds-v3-ink-2">
      <ShieldAlert size={16} aria-hidden="true" className="text-ds-v3-warn" />
      <span>안내 음성(합성 음성) 이용 조건에 아직 동의하지 않았습니다. 방송은 그대로 나갑니다.</span>
      <button type="button" onClick={() => onNavigate?.('licenseNotice')}
        className="ml-auto min-h-11 rounded-full px-4 font-semibold text-ds-v3-tts hover:underline">
        확인하고 동의하기
      </button>
    </div>
  )
}
