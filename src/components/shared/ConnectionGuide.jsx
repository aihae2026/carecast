import { useEffect, useState } from 'react'
import { apiGet } from '../../lib/api'
import AddressQR from './AddressQR'

export default function ConnectionGuide() {
  const [state, setState] = useState({ loading: true })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    apiGet('/api/server-info').then(info => {
      if (!Array.isArray(info.addresses) || !Number.isInteger(info.port)) throw new Error('주소 정보가 없습니다.')
      if (active) setState({ info })
    }).catch(() => { if (active) setState({ error: true }) })
    return () => { active = false }
  }, [attempt])

  return (
    <section className="card-base space-y-3" aria-label="접속 주소 안내">
      <h2 className="text-base font-semibold text-ds-v3-ink">다른 PC·휴대폰에서 접속하기</h2>
      <p className="text-sm text-ds-v3-ink-2">설치는 방송용 PC 한 대에만 합니다. 다른 PC·휴대폰은 같은 시설 네트워크에 연결하고 아래 주소를 브라우저에 입력하세요.</p>
      {state.loading && <p role="status">접속 주소를 확인하고 있습니다…</p>}
      {state.error && <div role="alert" className="text-sm">주소를 불러오지 못했습니다. 서버 연결을 확인해 주세요.
        <button type="button" className="ml-2 min-h-[44px] underline" onClick={() => { setState({ loading: true }); setAttempt(n => n + 1) }}>다시 확인</button>
      </div>}
      {state.info && <>
        <p className="text-sm">방송용 PC에서 여는 주소: <code className="break-all">http://localhost:{state.info.port}</code></p>
        {state.info.addresses.length === 0 && <p className="text-sm text-ds-v3-warn">다른 기기에서 접속할 주소를 찾지 못했습니다. 방송용 PC의 유선·Wi-Fi 연결을 확인하세요.</p>}
        {state.info.addresses.map(row => <div key={`${row.name}-${row.address}`} className="rounded-lg border border-ds-v3-line p-3 space-y-1">
          <p className="text-sm font-semibold">{row.name}{row.recommended ? ' · 추천 후보' : row.virtual ? ' · 가상·VPN 어댑터 확인 필요' : ' · 연결 확인 필요'}</p>
          <div className="flex flex-wrap items-center gap-4">
            <p className="min-w-0 flex-1 text-lg font-semibold break-all select-all">http://{row.address}:{state.info.port}</p>
            {/* 휴대폰 카메라로 찍어 바로 연다(2026-09-17). 추천 주소에만 — 여러 개면 잘못된 것을 찍게 된다. */}
            {row.recommended && <AddressQR url={`http://${row.address}:${state.info.port}`} size={112} label="휴대폰으로 열기" />}
            {row.recommended && state.info.httpsEnabled && state.info.httpsPort &&
              <AddressQR url={`https://${row.address}:${state.info.httpsPort}`} size={112} label="마이크용(보안)" />}
          </div>
          {row.network && <p className="text-sm">서버 대역: <strong>{row.network}</strong></p>}
          {row.prefix && <p className="text-sm text-ds-v3-ink-2">휴대폰 Wi-Fi 설정에서 IP가 <strong>{row.prefix}</strong>으로 시작하는지 보세요. 다르면 다른 네트워크일 수 있습니다.</p>}
        </div>)}
        <p className="text-xs text-ds-v3-ink-2">추천은 어댑터 정보로 추정한 주소입니다. 같은 대역이어도 공유기 격리·방화벽 설정에 따라 접속이 막힐 수 있습니다.</p>
      </>}
      <p className="text-sm text-ds-v3-warn">이 주소는 시설 안에서만 사용하세요. 인터넷에 공개하면 아무나 방송할 수 있습니다.</p>
      <p className="text-sm text-ds-v3-ink-2">다시 보기: 설정 → 초기 설정 → 마지막 단계, 또는 시스템 설정 → 접속 주소 안내</p>
    </section>
  )
}
