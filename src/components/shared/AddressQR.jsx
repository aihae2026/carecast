// **접속 주소 QR** (사용자 지시 2026-09-17 *"주소를 QR로 만들어주면 어떨까? 핸드폰에 직접 입력하기 좀 그렇잖아"*).
//
// 휴대폰 카메라로 비추면 바로 열린다. 그림은 `qrcode-generator`(MIT, 의존 없음)로 칸을 계산하고
// **SVG 사각형으로 직접 그린다** — 라이브러리가 만든 HTML 문자열을 끼워 넣지 않는다(innerHTML 없음).
// 오류 정정 M: 화면에 띄워 찍는 용도라 가볍게, 조금 가려져도 읽히게.
import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

export default function AddressQR({ url, size = 168, label }) {
  const 칸들 = useMemo(() => {
    if (!url) return null
    try {
      const qr = qrcode(0, 'M')
      qr.addData(String(url))
      qr.make()
      const n = qr.getModuleCount()
      const 검정 = []
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) 검정.push([x, y])
      return { n, 검정 }
    } catch { return null }
  }, [url])

  if (!칸들) return null
  const 여백 = 2, 전체 = 칸들.n + 여백 * 2
  return (
    <figure className="m-0 inline-flex flex-col items-center gap-1.5">
      <svg role="img" aria-label={`${label || '접속 주소'} QR 코드: ${url}`} width={size} height={size}
        viewBox={`0 0 ${전체} ${전체}`} shapeRendering="crispEdges"
        className="rounded-[10px] border border-ds-v3-line bg-white">
        <rect width={전체} height={전체} fill="#ffffff" />
        {칸들.검정.map(([x, y]) => <rect key={`${x}-${y}`} x={x + 여백} y={y + 여백} width="1" height="1" fill="#111827" />)}
      </svg>
      {label && <figcaption className="text-[13px] font-semibold text-ds-v3-ink-2">{label}</figcaption>}
    </figure>
  )
}
