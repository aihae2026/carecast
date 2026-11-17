// 기상청 규격과 우리 낱말 사이를 옮기는 규칙 — 코드 변환·발표시각 계산·응답 파서·공식.
//
// `services/weather.js`(1,068줄)에서 **통째로 내려왔다**(2026-09-05, TD-10 기회식).
// **옮기기만 했고 동작은 바꾸지 않았다** — 옮긴 232줄이 원본과 줄 단위로 같다.
//
// 왜 `domain/`인가: 여기 있는 것은 전부 **인자만 받아 값을 돌려주는 순수 함수**다. DB도,
// 캐시도, 네트워크도 만지지 않는다(`domain/text.js`·`domain/broadcastDefaults.js`와 같은 성격).
// `services/`는 바깥과 통신하는 부서 층이라 여기 두면 층이 흐려진다.
//
// **무엇을 일부러 안 옮겼나**: 캐시(`cache`·`lastGood`·`toCache`·`cachedOrLastGood`),
// 설정 읽기(`getSetting`·`getKmaConfig`), 그리고 모든 `fetch*`. 그것들은 상태와 바깥을
// 만지므로 weather.js에 남는다.
//
// ⚠ **이 파일에는 fetch를 들이지 않는다.** `fetch-timeout.test.js`가 감시하는 목록은
// weather.js를 보고 있고 이 파일은 안 본다 — 여기 fetch를 넣으면 그 감시 밖에서 살게 된다.
// I/O가 필요해지면 그 코드는 domain이 아니라 services에 있어야 한다는 뜻이다.
'use strict'

function pad2(n) { return String(n).padStart(2, '0') }

function formatYmd(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
}

// ── 생활기상지수 공통 발표 시각: 06 / 18 ────────────────────────
function getLivingBaseTime(date = new Date()) {
  return `${formatYmd(date)}${date.getHours() >= 18 ? '18' : '06'}`
}

// ── 초단기실황 base_date/base_time 계산 (10분 단위, 약 10분 지연) ────
function getUltraNcstBase(date = new Date()) {
  const d    = new Date(date)
  const mins = d.getMinutes()
  // 10분 단위 내림 후 한 단계 전 (데이터 생성 지연 고려)
  const roundedMins = Math.floor(mins / 10) * 10 - 10
  if (roundedMins < 0) {
    d.setHours(d.getHours() - 1)
    return { base_date: formatYmd(d), base_time: `${pad2(d.getHours())}50` }
  }
  return { base_date: formatYmd(d), base_time: `${pad2(d.getHours())}${pad2(roundedMins)}` }
}

// ── 초단기예보 base_date/base_time 계산 ─────────────────────────
function getUltraSrtBase(date = new Date()) {
  const d = new Date(date)
  if (d.getMinutes() < 45) d.setHours(d.getHours() - 1)
  return {
    base_date: formatYmd(d),
    base_time: `${pad2(d.getHours())}00`,
  }
}

// ── 단기예보 base_date/base_time 계산 ───────────────────────────
function getVilageBase(date = new Date()) {
  const baseTimes = ['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300']
  const d    = new Date(date)
  const hhmm = `${pad2(d.getHours())}${pad2(d.getMinutes())}`

  let chosen = null
  for (let i = baseTimes.length - 1; i >= 0; i--) {
    if (hhmm >= baseTimes[i]) { chosen = baseTimes[i]; break }
  }
  if (!chosen) {
    d.setDate(d.getDate() - 1)
    chosen = '2300'
  }
  return { base_date: formatYmd(d), base_time: chosen }
}

// ── 기상 코드 변환 ───────────────────────────────────────────────
function skyToText(sky) {
  return { '1': '맑음', '3': '구름많음', '4': '흐림' }[String(sky)] ?? null
}
// WMO 날씨 코드 → 한국어 하늘 상태 (Open-Meteo 폴백용)
function wmoToSky(code) {
  const n = Number(code)
  if (n === 0)         return '맑음'
  if (n <= 2)          return '주로 맑음'
  if (n === 3)         return '흐림'
  if (n <= 48)         return '안개'
  if (n <= 55)         return '이슬비'
  if (n <= 67)         return '비'
  if (n <= 77)         return '눈'
  if (n <= 82)         return '소나기'
  if (n <= 99)         return '뇌우'
  return null
}
function ptyToText(pty) {
  return { '0': '없음', '1': '비', '2': '비/눈', '3': '눈', '4': '소나기' }[String(pty)] ?? '없음'
}

// 시각(HHMM) → TTS용 한국어 고유어 읽기 ("오후 두 시" 등)
const NATIVE_HOUR = ['자정', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두']
function timeToKorean(hhmm) {
  const h = parseInt(hhmm.slice(0, 2), 10)
  if (h === 0)  return '자정'
  const n = NATIVE_HOUR[h <= 12 ? h : h - 12]
  if (h < 6)    return `새벽 ${n} 시`
  if (h < 12)   return `오전 ${n} 시`
  if (h === 12) return '낮 열두 시'
  if (h < 18)   return `오후 ${n} 시`
  if (h < 21)   return `저녁 ${n} 시`
  return `밤 ${n} 시`
}

// 한국어 주격 조사 선택: 받침 없으면 '가', 있으면 '이'
// '비'→'비가', '눈'→'눈이', '소나기'→'소나기가', '비/눈'→'비/눈이'
function subjectParticle(word) {
  for (let i = word.length - 1; i >= 0; i--) {
    const code = word.charCodeAt(i)
    if (code >= 0xAC00 && code <= 0xD7A3) {
      return (code - 0xAC00) % 28 === 0 ? '가' : '이'
    }
  }
  return '이'
}

// 단기예보 PTY 슬롯에서 오늘의 비 예보 시간대 추출
function extractRainForecast(items, today) {
  const ptyItems = items
    .filter(it => it.category === 'PTY' && it.fcstDate === today && it.fcstValue !== '0')
    .sort((a, b) => a.fcstTime.localeCompare(b.fcstTime))

  if (!ptyItems.length) return { hasRain: false, description: null, slots: [] }

  const slots  = ptyItems.map(it => ({ time: it.fcstTime, type: ptyToText(it.fcstValue), code: it.fcstValue }))
  const first  = slots[0]
  const last   = slots[slots.length - 1]
  const allDay = slots.length >= 6
  const firstT = timeToKorean(first.time)
  const lastT  = timeToKorean(last.time)
  const p      = subjectParticle(first.type)  // '이' 또는 '가'

  let description
  if (allDay) {
    description = `오늘 하루 내내 ${first.type}${p} 내리겠습니다. 외출 시 우산을 꼭 챙기시기 바랍니다.`
  } else if (slots.length === 1) {
    description = `${firstT}부터 ${first.type}${p} 예상되니 우산을 챙기시기 바랍니다.`
  } else {
    description = `${firstT}부터 ${lastT}까지 ${first.type}${p} 예상되니 우산을 챙기시기 바랍니다.`
  }

  console.log(`[비예보] ${description}`)
  return { hasRain: true, description, firstTime: first.time, lastTime: last.time, slots }
}

function uvLevel(value) {
  const n = Number(value)
  if (isNaN(n)) return '정보없음'
  if (n >= 11) return '위험'
  if (n >= 8)  return '매우높음'
  if (n >= 6)  return '높음'
  if (n >= 3)  return '보통'
  return '낮음'
}
const DUST_GRADE = { '1': '좋음', '2': '보통', '3': '나쁨', '4': '매우나쁨' }

function parseJsonSafe(text, label = 'JSON') {
  try { return JSON.parse(text) }
  catch { throw new Error(`${label} 파싱 실패: ${text.slice(0, 300)}`) }
}

// 공공데이터포털은 "인코딩" 키(이미 URL-Encode된 형태)와 "디코딩" 키(원본) 두 가지를 같이 발급한다.
// 어느 쪽을 붙여넣었는지 사용자가 매번 구분하기 어렵고, 코드 쪽에서도 URLSearchParams(자동 인코딩)와
// 문자열 템플릿(수동 인코딩 필요)이 섞여 있어 "인코딩 키 + 자동 인코딩"이 겹치면 이중 인코딩으로
// 401/403(SERVICE_KEY_IS_NOT_REGISTERED 등)이 난다. 여기서 항상 "디코딩(원본)" 형태로 정규화해두고,
// 이후 사용하는 쪽에서 정확히 한 번만 인코딩하도록 통일한다 — 어느 키를 붙여넣어도 동작해야 한다.
function normalizeServiceKey(raw) {
  if (!raw) return ''
  try { return decodeURIComponent(raw) } catch { return raw } // 이미 디코딩된 키면 그대로(무해한 no-op)
}

/**
 * 로그로 내보낼 URL 에서 인증키를 지운다 (P-14, 2026-09-08).
 *
 * **값이 아니라 파라미터 이름으로 지운다.** 값으로 지우려 하면 조용히 실패한다 —
 * `normalizeServiceKey` 가 만드는 것은 **디코딩된** 키인데 URL 안에는
 * `URLSearchParams` 가 **다시 인코딩한** 값이 들어간다. 키에 `+`·`/`·`=` 가 있으면
 * (base64 계열 키는 대부분 그렇다) 두 문자열이 달라서 `String.replace` 가 아무것도
 * 못 찾는다. **그런데 못 찾아도 오류가 안 난다** — 그래서 2026-09-07 로그에 기상청 키가
 * 평문으로 199회 남아 있었다([FACT] EV-001598·EV-001599).
 *
 * 마스킹 코드가 있다는 것이 마스킹된다는 근거가 아니었다.
 */
function maskApiKeysInUrl(url) {
  if (!url) return ''
  return String(url).replace(/([?&](?:authKey|serviceKey|apiKey)=)[^&#]*/gi, '$1***')
}

// ── KMA apihub 텍스트 응답 파서 ─────────────────────────────────
// apihub.kma.go.kr typ01 API는 고정 텍스트 포맷으로 반환
// # START7777 ~ # 7777END 사이에 데이터 행(CSV)이 위치
function parseKmaText(text, fallbackCols) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let headers = fallbackCols
  const rows = []
  for (const line of lines) {
    if (line.startsWith('# START') || line.startsWith('# 7777') || line === '#') continue
    if (line.startsWith('#')) {
      const candidate = line.slice(1).trim()
      if (candidate.includes(',')) {
        const parts = candidate.split(',').map(p => p.trim())
        if (/^[A-Z_-]+$/.test(parts[0])) headers = parts
      }
      continue
    }
    if (headers) {
      const values = line.split(',').map(v => v.trim())
      const obj = {}
      headers.forEach((h, i) => { obj[h] = values[i] ?? '' })
      rows.push(obj)
    }
  }
  return rows
}

const WRN_NAME = { W:'강풍', R:'호우', C:'한파', D:'건조', O:'해일', N:'지진해일', V:'풍랑', T:'태풍', S:'대설', Y:'황사', H:'폭염', F:'안개' }
const LVL_NAME = { '10':'주의보', '20':'경보' }
const ALERT_COLS = ['REG_UP','REG_ID','TM_FC','TM_EF','WRN','LVL','CMD','REG_UP_KO','REG_KO']
const UV_COLS   = ['TM','STN','UV-B']

// 초단기실황 RN1 값 파싱 (강수없음/1mm미만/수치)
function parseRn1(raw) {
  if (!raw || raw === '강수없음') return 0
  if (raw.includes('미만'))        return 0.5  // "1.0mm 미만" → 감지는 됨
  const n = parseFloat(raw)
  return isNaN(n) ? 0 : n
}

// TMN(최저기온, fcstTime=0600)/TMX(최고기온, fcstTime=1500)는
// 0500 기준시각 발표에 하루치 전체가 포함됨.
// 0800 이후 기준시각을 쓰면 0600 TMN이 응답에서 빠져 못 찾음 → 0500 고정.
// 05:10 이전(0500 발표 전)이면 전날 2300 기준시각 사용.
function getMinMaxBase(date = new Date()) {
  const d = new Date(date)
  if (d.getHours() < 5 || (d.getHours() === 5 && d.getMinutes() < 10)) {
    const prev = new Date(d); prev.setDate(prev.getDate() - 1)
    return { base_date: formatYmd(prev), base_time: '2300' }
  }
  return { base_date: formatYmd(d), base_time: '0500' }
}

// V5 hourly fields: h0,h3,h6,...h72 (3시간 간격, base time 기준 오프셋)
// today = 오늘 주간(h0~h12) 최댓값, tomorrow = 내일 주간(h27~h39) 최댓값
function v5PeakValue(item, slots) {
  const vals = slots
    .map(k => item[k])
    .filter(v => v != null && v !== '')
    .map(Number)
    .filter(n => !isNaN(n))
  return vals.length ? Math.max(...vals) : null
}

// 현재 시각에 가장 가까운 h{n} 슬롯 값 (체감온도용)
function v5CurrentSlotValue(item, basetime) {
  const baseHour    = parseInt(basetime.slice(-2), 10)   // 6 또는 18
  const currentHour = new Date().getHours()
  let   diff        = currentHour - baseHour
  if (diff < 0) diff += 24
  const slotH = Math.min(Math.round(diff / 3) * 3, 24)  // 최대 h24까지
  const val   = item[`h${slotH}`]
  if (val != null && val !== '') return Number(val)
  // 슬롯 없으면 h0~h24 중 가장 가까운 비어있지 않은 값
  for (const k of ['h0','h3','h6','h9','h12','h15','h18','h21','h24']) {
    if (item[k] != null && item[k] !== '') return Number(item[k])
  }
  return null
}

// 기상청 체감온도 공식
function calcApparentTemp(tempC, windKmh, humidPct) {
  const T = tempC, V = windKmh, RH = humidPct
  if (T <= 10 && V > 4.8) {
    return Math.round(13.12 + 0.6215*T - 11.37*Math.pow(V,0.16) + 0.3965*T*Math.pow(V,0.16))
  }
  if (T >= 27 && RH >= 40) {
    const hi = -8.784695 + 1.61139411*T + 2.3385248*RH
              - 0.14611605*T*RH - 0.01230809*T*T
              - 0.01642482*RH*RH + 0.00221173*T*T*RH
              + 0.00072546*T*RH*RH - 0.00000358*T*T*RH*RH
    return Math.round(hi)
  }
  return Math.round(T)
}

module.exports = {
  pad2, formatYmd, getLivingBaseTime, getUltraNcstBase, getUltraSrtBase, getVilageBase, skyToText, wmoToSky, ptyToText, NATIVE_HOUR, timeToKorean, subjectParticle, extractRainForecast, uvLevel, DUST_GRADE, parseJsonSafe, normalizeServiceKey, maskApiKeysInUrl, parseKmaText, WRN_NAME, LVL_NAME, ALERT_COLS, UV_COLS, parseRn1, getMinMaxBase, v5PeakValue, v5CurrentSlotValue, calcApparentTemp,
}
