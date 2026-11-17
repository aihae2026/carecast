// 위경도 ↔ 기상청 격자(nx·ny) — 순수 계산만 한다 (UX-08, 2026-09-11).
//
// **왜 만드나.** 설정 화면이 격자 X·Y 를 숫자로 직접 받으면서 초기값에 처음 운영한 시설의
// 격자를 박아 두고 있었다. 다른 지역 시설이 설치하면 화면에는 숫자가 차 있고, 그대로 저장하면
// **남의 동네 날씨를 방송한다.** 빈칸이면 사람이 "뭘 넣어야 하지" 하고 멈추지만, 남의 좌표가
// 차 있으면 멈추지 않는다 — 조용한 오독이 이 저장소에서 가장 비싼 실패다.
//
// 기상청 단기예보는 5km 람베르트 정각 원뿔 도법 격자를 쓴다. 아래 상수는 기상청이
// 배포한 변환 예제(`LamcProjParameter`)의 값 그대로다 — **여기서 고치면 안 된다.**
const RE = 6371.00877   // 지구 반경(km)
const GRID = 5.0        // 격자 간격(km)
const SLAT1 = 30.0      // 표준 위도 1
const SLAT2 = 60.0      // 표준 위도 2
const OLON = 126.0      // 기준점 경도
const OLAT = 38.0       // 기준점 위도
const XO = 43           // 기준점 X 격자
const YO = 136          // 기준점 Y 격자

const DEG = Math.PI / 180

// 도법 상수는 입력과 무관하므로 한 번만 센다.
const 도법 = (() => {
  const re = RE / GRID
  const slat1 = SLAT1 * DEG
  const slat2 = SLAT2 * DEG
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn
  let ro = Math.tan(Math.PI * 0.25 + OLAT * DEG * 0.5)
  ro = re * sf / Math.pow(ro, sn)
  return { re, sn, sf, ro, olon: OLON * DEG }
})()

// 위경도 → 격자. 우리나라 밖 좌표도 숫자는 나오므로 **범위 판정은 따로 한다**(격자범위밖).
export function 격자로(위도, 경도) {
  const { re, sn, sf, ro, olon } = 도법
  let ra = Math.tan(Math.PI * 0.25 + Number(위도) * DEG * 0.5)
  ra = re * sf / Math.pow(ra, sn)
  let theta = Number(경도) * DEG - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  }
}

// 격자 → 위경도(격자 중심). 사람이 "이 숫자가 어디인지" 되짚어 볼 때 쓴다 —
// 넣은 숫자가 맞는지 확인할 길이 없으면 결국 아무 숫자나 넣고 저장한다.
export function 위경도로(nx, ny) {
  const { re, sn, sf, ro, olon } = 도법
  const xn = Number(nx) - XO
  const yn = ro - Number(ny) + YO
  let ra = Math.sqrt(xn * xn + yn * yn)
  if (sn < 0) ra = -ra
  let alat = Math.pow((re * sf) / ra, 1 / sn)
  alat = 2 * Math.atan(alat) - Math.PI * 0.5

  let theta = 0
  if (Math.abs(xn) > 0) {
    if (Math.abs(yn) <= 0) {
      theta = Math.PI * 0.5
      if (xn < 0) theta = -theta
    } else {
      theta = Math.atan2(xn, yn)
    }
  }
  return { 위도: alat / DEG, 경도: (theta / sn + olon) / DEG }
}

// 단기예보 격자는 대략 1~149 × 1~253 이다. 밖이면 사람이 좌표를 잘못 넣은 것이다.
export function 격자범위밖(nx, ny) {
  // 빈 칸은 **"안 넣었다"** 고 말한다. `Number('')` 이 0 이라 그냥 두면 "범위를 벗어났다"가
  // 되는데, 아직 아무것도 안 넣은 사람에게 그 말은 무슨 뜻인지 모를 소리다.
  const 빔= (v) => v === null || v === undefined || String(v).trim() === ''
  if (빔(nx) || 빔(ny)) return '아직 안 넣었습니다'
  const x = Number(nx), y = Number(ny)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '숫자가 아닙니다'
  if (x < 1 || x > 149 || y < 1 || y > 253) return '우리나라 격자 범위를 벗어났습니다'
  return null
}

// 자외선 관측 지점 — **화면이 이미 안내하던 넷 그대로다**(수원·서울·강릉·부산).
// 더 넣지 않는 이유: 확인하지 않은 지점 번호를 넣으면 조용히 틀린 곳을 보게 된다.
// 그래서 **가장 가까운 곳이 멀면 그 사실을 말한다**(아래 `멀다`).
export const 자외선관측소 = [
  { stn: '108', 이름: '서울', 위도: 37.5714, 경도: 126.9658 },
  { stn: '119', 이름: '수원', 위도: 37.2723, 경도: 126.9853 },
  { stn: '105', 이름: '강릉', 위도: 37.7515, 경도: 128.8910 },
  { stn: '159', 이름: '부산', 위도: 35.1047, 경도: 129.0320 },
]

// 두 점 사이 거리(km). 대권거리 — 이 규모에서는 충분하다.
export function 거리km(위도1, 경도1, 위도2, 경도2) {
  const dLat = (위도2 - 위도1) * DEG
  const dLon = (경도2 - 경도1) * DEG
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(위도1 * DEG) * Math.cos(위도2 * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(a)))
}

// 가장 가까운 자외선 관측소. **멀면 멀다고 말한다** — 목록이 넷뿐이라 광주·제주는
// 반드시 멀리 걸린다. 그 사실을 숨기면 사람이 엉뚱한 지역의 자외선을 방송한다.
export function 가까운자외선관측소(위도, 경도) {
  let 최선 = null
  for (const s of 자외선관측소) {
    const d = 거리km(Number(위도), Number(경도), s.위도, s.경도)
    if (!최선 || d < 최선.거리) 최선 = { ...s, 거리: d }
  }
  return { ...최선, 멀다: 최선.거리 > 100 }
}
