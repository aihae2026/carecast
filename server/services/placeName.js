'use strict'
// **좌표 → 지역 이름** (사용자 지시 2026-09-18 밤).
//
// *"위도하고 경도만 나오면 어떻게 해 … 위도경도 옆에 ○○도 ○○시 서울시 용산구 뭐 이런식으로"*
// 초기 설정에서 「지금 위치로 넣기」를 누르면 숫자 두 개만 나와서, 그 숫자가 **우리 시설이 맞는지
// 사람이 알 길이 없었다.** 이름으로 보여 주면 틀렸을 때 바로 보인다.
//
// ── 어디에 묻나 — OpenStreetMap Nominatim ──────────────────────────────────
// 키가 필요 없고, 한국 주소가 「서울특별시 용산구 원효로1동」처럼 한국어로 온다(2026-09-18 실측).
// **이용 규칙**(https://operations.osmfoundation.org/policies/nominatim/, 2026-09-18 확인):
//   · 사람이 직접 누른 조회는 된다(자동 완성·대량 조회는 안 된다)
//   · 초당 1건을 넘지 않는다                      → 아래 `마지막` 으로 1.1초 간격을 지킨다
//   · 누가 묻는지 User-Agent 로 밝힌다             → 그래서 **브라우저가 아니라 서버가 묻는다**
//                                                  (브라우저는 User-Agent 를 못 바꾼다)
//   · 결과를 받아 두고 다시 묻지 않는다            → `받아둔것`
//   · 출처를 화면에 밝힌다(ODbL)                   → 응답에 `출처` 를 실어 화면이 그대로 쓴다
//
// **방송과는 상관이 없다.** 초기 설정 화면에서 사람이 누를 때만 부른다 — 무인 경로가 아니다.
// 실패하면 이름만 안 보이고, 좌표 저장·날씨는 그대로 된다.

const 주소 = 'https://nominatim.openstreetmap.org/reverse'
const 누가 = 'CareCast/1.0 (institution PA system; facility location check during setup)'
const 출처 = '지역 이름 © OpenStreetMap 기여자'
const 제한시간ms = 8000

const 받아둔것 = new Map()   // "37.535,126.961" → 이름
const 묻는중 = new Map()     // "37.535,126.961" → 지금 나가 있는 조회(Promise)
let 마지막 = 0               // 마지막으로 **잡힌 차례**의 시각(ms)

/** Nominatim 주소 조각 → 「서울특별시 용산구 원효로1동」. 없는 칸은 건너뛰고, 같은 이름은 한 번만. */
function 이름짓기(a = {}) {
  const 칸 = [a.province, a.city, a.county, a.borough, a.town || a.suburb]
  const 결과 = []
  for (const v of 칸) {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && !결과.includes(s)) 결과.push(s)
  }
  return 결과.join(' ')
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{fetchImpl?: Function, 지금?: () => number, 쉬기?: (ms:number) => Promise<void>}} [주입]
 * @returns {Promise<{ok: true, 이름: string, 출처: string} | {ok: false, msg: string}>}
 */
async function 지역이름(lat, lon, { fetchImpl = globalThis.fetch, 지금 = Date.now, 쉬기 = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  // 빈 칸은 `Number('')` 가 0 이라 (0,0) 으로 새어 나간다 — 숫자로 바꾸기 전에 거른다(코드 검수 2026-09-18).
  if (String(lat ?? '').trim() === '' || String(lon ?? '').trim() === '') return { ok: false, msg: '위도·경도가 비어 있습니다' }
  const la = Number(lat), lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    return { ok: false, msg: '위도·경도가 숫자가 아닙니다' }
  }
  // 소수 셋째 자리(약 100m)로 묶는다 — 같은 시설을 몇 번 눌러도 한 번만 묻는다.
  const 열쇠 = `${la.toFixed(3)},${lo.toFixed(3)}`
  if (받아둔것.has(열쇠)) return { ok: true, 이름: 받아둔것.get(열쇠), 출처 }
  // 같은 곳을 동시에 물으면 먼저 나간 조회 하나를 같이 기다린다.
  if (묻는중.has(열쇠)) return 묻는중.get(열쇠)
  const 약속 = 묻기(la, lo, 열쇠, { fetchImpl, 지금, 쉬기 }).finally(() => 묻는중.delete(열쇠))
  묻는중.set(열쇠, 약속)
  return 약속
}

async function 묻기(la, lo, 열쇠, { fetchImpl, 지금, 쉬기 }) {
  // **차례를 먼저 잡고 나서 기다린다**(코드 검수 2026-09-18). 앞 판은 기다린 **뒤에** `마지막` 을 적어서,
  // 동시에 온 3건 이상이 같은 시각을 보고 같이 깨어나 한꺼번에 나갔다(실측 0·1115·1115·1115ms).
  const 차례 = Math.max(지금(), 마지막 + 1100)
  마지막 = 차례
  const 기다릴 = 차례 - 지금()
  if (기다릴 > 0) await 쉬기(기다릴)

  const url = `${주소}?format=jsonv2&zoom=14&accept-language=ko&lat=${la}&lon=${lo}`
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 누가, 'Accept-Language': 'ko' }, signal: AbortSignal.timeout(제한시간ms) })
    if (!res.ok) return { ok: false, msg: `지역 이름을 못 받았습니다(${res.status})` }
    const j = await res.json()
    const 이름 = 이름짓기(j?.address)
    if (!이름) return { ok: false, msg: '이 좌표의 지역 이름을 찾지 못했습니다' }
    if (받아둔것.size >= 100) 받아둔것.clear()
    받아둔것.set(열쇠, 이름)
    return { ok: true, 이름, 출처 }
  } catch (e) {
    return { ok: false, msg: `지역 이름을 못 받았습니다(${e?.name === 'TimeoutError' ? '응답 없음' : '연결 실패'})` }
  }
}

module.exports = { 지역이름, 이름짓기, _비우기: () => { 받아둔것.clear(); 묻는중.clear(); 마지막 = 0 } }
