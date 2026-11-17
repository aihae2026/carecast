// 「모니터링 창 열기」 단추 — **한 자리에서 만든다**.
//
// ── 왜 부품으로 빼나 (사용자 지시 2026-09-14) ────────────────────────────────
// *"간편모음 상단 등 찾기 쉬운 위치에 명시적인 이름으로 배치한다."*
// 그전에는 `SystemStatusCompact`(간편모음 **맨 아래** 「시스템」 패널) 안에만 있어서
// 실측 `top: 2411px` — 서랍을 열고 한참 내려야 나왔다. 휴대폰에서는 사실상 못 찾는다.
//
// 그렇다고 같은 단추를 두 곳에 **복사**하면 팝업 차단 안내가 한쪽에만 붙거나 문구가 갈린다.
// 이 저장소가 여러 번 데인 모양이다. 그래서 **부품 하나**로 만들고 두 자리가 그것을 쓴다.
//
// ── 「방송 화면」과 다른 것이다 ──────────────────────────────────────────────
// 「방송 화면」은 **소리를 내는** 화면이고, 모니터링은 **보기만 하는** 창이다.
// 같은 단추로 묶지 않는다 — 창 이름도 `carecast_monitor` 로 따로 쓴다(`lib/monitorWindow`).
// 여는 것만으로 방송 수신·재생이 새로 시작되지 않는다(그 창은 제 스스로 소리를 안 낸다).
import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { 모니터창열기 } from '../../lib/monitorWindow'

/**
 * @param {'panel'|'row'} [variant] `row` 는 간편모음 맨 위의 한 줄, `panel` 은 카드 안.
 */
export default function MonitorOpenButton({ variant = 'panel' }) {
  const [blocked, setBlocked] = useState(false)
  const row = variant === 'row'
  return (
    <div className={row ? 'mb-2.5' : 'mt-2.5'}>
      <button type="button"
        onClick={() => {
          // 팝업이 막히면 **조용히 지나가지 않는다** — 눌렀는데 아무 일이 없으면
          // 사람은 고장으로 읽는다.
          setBlocked(!모니터창열기())
        }}
        className={'flex w-full items-center justify-center gap-1.5 btn-press min-h-[44px] '
          + 'transition-colors '
          + (row
            ? 'rounded-[10px] border border-ds-v3-line bg-white/70 px-3 py-2.5 '
              + 'text-[13px] font-semibold text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-white'
            : 'rounded-btn border border-ds-v3-line bg-ds-v3-bg px-3 py-2.5 text-sm text-ds-v3-ink-2 '
              + 'hover:border-ds-v3-line-2 hover:text-ds-v3-ink')}>
        <MonitorSmartphone size={14} />
        모니터링 창 열기
      </button>
      {blocked && (
        <p role="alert" className={(row ? 'text-ds-v3-bgm' : 'text-ds-v3-warn') + ' mt-1 text-xs'}>
          브라우저가 창을 막았습니다. 주소창 오른쪽의 팝업 차단을 풀고 다시 눌러 주세요.
        </p>
      )}
    </div>
  )
}
