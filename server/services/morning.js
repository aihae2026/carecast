// 아침 종합 방송 텍스트 빌더
const { fetchWeather, fetchAirQuality, fetchWeatherAlert, fetchMinMaxTemp, fetchUVIndex, fetchApparentTemp } = require('./weather')
const { getTodayEvents, isConnected } = require('./calendar')
const { getDB }                       = require('../db/schema')

const DEFAULT_SEGMENTS = [
  { id: 'greeting', label: '인사',          enabled: true,  order: 0 },
  { id: 'date',     label: '날짜/요일',     enabled: true,  order: 1 },
  { id: 'weather',  label: '날씨',          enabled: true,  order: 2 },
  { id: 'dust',     label: '미세먼지',      enabled: true,  order: 3 },
  { id: 'alert',    label: '특보',          enabled: true,  order: 4 },
  { id: 'schedule', label: '주요 일정',     enabled: true,  order: 5 },
  { id: 'quote',    label: '오늘의 한마디', enabled: true,  order: 6 },
  { id: 'closing',  label: '마무리 인사',   enabled: true,  order: 7 },
]

const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

const QUOTES = [
  '웃음은 최고의 보약입니다.',
  '긍정적인 마음이 건강한 몸을 만듭니다.',
  '오늘도 건강하고 행복하게 보내세요.',
  '소소한 일상이 가장 큰 행복입니다.',
  '건강이 최고의 재산입니다.',
  '오늘도 좋은 하루 되세요.',
  '함께라서 더 즐거운 하루입니다.',
  '좋아하는 노래 한 소절이 하루를 즐겁게 합니다.',
  '오늘 하루도 웃음 가득한 하루가 되길 바랍니다.',
  '작은 것에 감사하는 마음이 행복의 시작입니다.',
  '따뜻한 마음 하나가 하루를 밝혀 줍니다.',
  '오늘도 어르신들의 건강을 응원합니다.',
  '밝은 미소가 주변을 환하게 만듭니다.',
  '좋은 사람들과 함께하는 오늘이 소중합니다.',
  '천천히, 하지만 꾸준히가 최고의 방법입니다.',
  '매일 아침은 새로운 선물입니다.',
  '오늘 하루도 평안하고 따뜻하게 보내세요.',
  '나이는 숫자일 뿐, 마음은 언제나 청춘입니다.',
  '한 걸음씩 나아가다 보면 어느새 먼 길을 걸어와 있습니다.',
  '웃는 얼굴에 침 못 뱉는다는 말처럼, 오늘도 환하게 웃어요.',
  '오늘도 사랑받고 사랑하는 하루 되세요.',
  '건강한 몸에 건강한 마음이 깃듭니다.',
  '감사한 마음을 가지면 세상이 더 아름다워 보입니다.',
  '오늘 하루도 어르신들과 함께여서 행복합니다.',
  '좋은 생각이 좋은 하루를 만들어 갑니다.',
  '꽃이 피듯 어르신들의 하루도 활짝 피어나길 바랍니다.',
  '오늘 하루, 소중한 추억을 하나씩 쌓아가세요.',
  '행복은 멀리 있지 않고 바로 지금 이 순간에 있습니다.',
  '함께 나누는 웃음이 가장 큰 보약입니다.',
  '건강하게 오늘 하루를 시작하는 것이 최고의 선물입니다.',
  '매 순간 최선을 다하는 삶이 가장 아름다운 삶입니다.',
  '좋은 인연이 좋은 하루를 만들어 줍니다.',
  '오늘도 서로 배려하며 따뜻한 하루 보내세요.',
  '몸이 건강해야 마음도 즐겁습니다. 오늘도 건강 챙기세요.',
  '작은 친절 하나가 누군가의 하루를 바꿀 수 있습니다.',
  '오늘 하루도 평온하고 행복한 시간 되시길 바랍니다.',
  '함께라는 것이 얼마나 큰 힘이 되는지 오늘도 느껴보세요.',
]

// 덕담 선택 — 연중 일자 기준 37일 주기.
// 예전엔 QUOTES[날짜(日) % 37]이라 인덱스가 1~31에서만 나왔고, 0번과 32~36번 여섯 개는
// 한 번도 방송되지 않았다. 연중 일자로 바꿔 37개를 모두 쓴다.
// 같은 날이면 항상 같은 덕담이라는 성질(랜덤 아님)은 그대로다.
function dayOfYear(d) {
  const start = Date.UTC(d.getFullYear(), 0, 0)
  const cur   = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((cur - start) / 86400000)
}

function pickQuote(date = new Date()) {
  return QUOTES[dayOfYear(date) % QUOTES.length]
}

// 아라비아 숫자 → 한자식(십, 백, 천) 읽기
function toSinoKorean(n) {
  n = parseInt(n)
  if (isNaN(n) || n < 0) return String(n)
  if (n === 0) return '영'
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const th = Math.floor(n / 1000); const h = Math.floor((n % 1000) / 100)
  const te = Math.floor((n % 100) / 10); const o = n % 10
  let r = ''
  if (th > 0) r += (th === 1 ? '' : digits[th]) + '천'
  if (h  > 0) r += (h  === 1 ? '' : digits[h])  + '백'
  if (te > 0) r += (te === 1 ? '' : digits[te])  + '십'
  if (o  > 0) r += digits[o]
  return r || '영'
}

// 기온용: 음수 지원 ("영하 삼도" 형식)
function toSinoKoreanTemp(val) {
  const n = Math.floor(parseFloat(val))
  if (isNaN(n)) return String(val)
  if (n < 0) return `영하 ${toSinoKorean(-n)}`
  return toSinoKorean(n)
}

// 날씨·미세먼지·체감온도·자외선·습도 종합 야외활동 추천
function getActivityText({ air, weather, uv, apparent, minMax }) {
  const precip   = weather?.precipitationType
  const uvLevel  = uv?.todayLevel
  const appTemp  = apparent?.value ?? null
  const maxTemp  = minMax?.maxTemp != null ? Math.floor(parseFloat(minMax.maxTemp)) : null
  const humid    = weather?.humidity != null ? Math.round(weather.humidity) : null

  // 강수 — 최우선
  if (precip === '비' || precip === '소나기')
    return '비가 오고 있으니 우산을 꼭 챙기세요. 오늘은 실내 활동을 권장합니다.'
  if (precip === '눈')
    return '눈이 내리고 있으니 미끄럼에 주의하세요. 외출 시 각별히 조심하시기 바랍니다.'
  if (precip === '비/눈')
    return '비와 눈이 내리고 있으니 외출을 자제하시고 안전에 유의하세요.'

  // 미세먼지 매우나쁨
  if (air?.pm10Grade === '매우나쁨')
    return '미세먼지가 매우 나쁩니다. 오늘은 실내 활동을 권장드리며, 외출 시 마스크를 꼭 착용하세요.'

  // 체감온도 우선, 없으면 낮 최고기온으로 판단
  const heat      = appTemp ?? maxTemp
  const isVeryHot = heat != null && heat >= 35
  const isHot     = heat != null && heat >= 30
  const isHighUV  = uvLevel && ['높음', '매우높음', '위험'].includes(uvLevel)

  if (isVeryHot)
    return '폭염이 예상됩니다. 야외활동을 자제하시고 시원한 실내에서 충분히 쉬세요.'
  if (isHot && isHighUV)
    return '야외활동보다는 되도록 시원한 실내에서 휴식하시기 바랍니다.'
  if (isHot && humid != null && humid >= 80)
    return '기온과 습도가 모두 높아 불쾌지수가 높겠습니다. 무더위에 실내에서 충분히 쉬세요.'
  if (isHot)
    return '더운 날씨이니 야외활동 시 그늘진 곳에서 충분한 수분 섭취와 휴식을 취하세요.'

  // 자외선 높음 (더위 없을 때)
  if (isHighUV)
    return '자외선이 강한 날입니다. 가벼운 야외활동은 괜찮으나 한낮에는 그늘을 이용하시기 바랍니다.'

  // 미세먼지 나쁨
  if (air?.pm10Grade === '나쁨')
    return '미세먼지가 나쁘니 마스크를 착용하시고 야외활동을 삼가 주세요.'

  // 추위
  if (heat != null && heat <= -10)
    return '강추위가 예상됩니다. 따뜻한 실내에서 머무르시길 권장합니다.'
  if (heat != null && heat <= 0)
    return '날씨가 매우 차갑습니다. 외출 시 따뜻하게 입으시고 낙상에 주의하세요.'

  // 고습도 (다른 조건 없을 때)
  if (humid != null && humid >= 85)
    return '습도가 높아 다소 불쾌할 수 있습니다. 시원하고 가벼운 복장을 갖추세요.'

  return '오늘은 가볍게 산책하기 좋은 날씨입니다.'
}

// UV 등급별 상세 안내 멘트 (숫자 제거 — 한자 읽기 + 조사 오류 방지)
function getUVDetailText(uvIndex, grade) {
  if (!grade || grade === '낮음' || grade === '보통') return null
  switch (grade) {
    case '위험':
      return `오늘 자외선 지수가 '위험' 수준입니다. 가급적 외출을 자제하시고, 외출하실 경우 자외선 차단제와 긴 소매 옷을 반드시 착용하시기 바랍니다.`
    case '매우높음':
      return `오늘 자외선 지수가 '매우높음' 수준입니다. 외출 시 모자와 양산을 준비하시고, 오후 시간대 장시간 야외활동은 자제하시기 바랍니다.`
    case '높음':
      return `오늘 자외선 지수가 '높음' 수준입니다. 외출 시 자외선 차단제를 꼭 챙기시기 바랍니다.`
    default:
      return null
  }
}

// 체감온도 기반 안내 멘트
function getApparentTempText(value) {
  if (value == null || isNaN(value)) return null
  const t = toSinoKoreanTemp(value)
  if (value >= 33) return `체감온도는 ${t}도로 매우 높게 나타나고 있습니다. 수분을 충분히 섭취하시고 무더위에 건강 유의하세요.`
  if (value >= 28) return `체감온도는 ${t}도로 높게 나타나고 있습니다. 수분을 충분히 섭취하시고 더위에 주의하세요.`
  if (value <= 0)  return `체감온도는 ${t}도로 매우 낮게 나타나고 있습니다. 따뜻한 옷차림을 꼭 갖추시기 바랍니다.`
  if (value <= 5)  return `체감온도는 ${t}도로 낮게 나타나고 있습니다. 외출 시 따뜻하게 입으시기 바랍니다.`
  return null
}

// ─────────────────────────────────────────────────────
// 모든 외부 데이터를 병렬 조회 (실패해도 계속 진행)
// ─────────────────────────────────────────────────────
async function getMorningData() {
  const [weatherRes, airRes, alertRes, minMaxRes, uvRes, apparentRes] = await Promise.allSettled([
    fetchWeather(),
    fetchAirQuality(),
    fetchWeatherAlert(),
    fetchMinMaxTemp(),
    fetchUVIndex(),
    fetchApparentTemp(),
  ])

  const weather  = weatherRes.status  === 'fulfilled' ? weatherRes.value  : null
  const air      = airRes.status      === 'fulfilled' ? airRes.value      : null
  const alertBundle = alertRes.status  === 'fulfilled' ? alertRes.value    : null
  const alerts      = alertBundle?.alerts ?? alertBundle ?? []
  const minMax   = minMaxRes.status   === 'fulfilled' ? minMaxRes.value   : null
  const uv       = uvRes.status       === 'fulfilled' ? uvRes.value       : null
  const apparent = apparentRes.status === 'fulfilled' ? apparentRes.value : null

  let events = null
  try {
    const db = getDB()
    if (isConnected(db)) events = await getTodayEvents(db)
  } catch (err) {
    // 캘린더 실패를 조용히 삼키면 "오늘은 일정이 없나 보다"가 된다(CC-043).
    // 방송은 계속 나가되(일정 안내만 빠짐), 실패는 반드시 사람에게 전달한다.
    console.error('[아침방송] 캘린더 일정 조회 실패:', err.message)
    try {
      require('./alert').raise('아침방송', `캘린더 일정 조회 실패 — 오늘 일정 안내가 방송에서 빠집니다: ${err.message}`)
    } catch { /* 경보 실패가 방송을 막으면 본말전도 */ }
  }

  // ── 가린 것이 있으면 **사람에게 알린다** (사용자 결정 2026-09-15) ────────────────
  // 조용히 가리면 직원은 「왜 내가 적은 일정이 안 나갔지」를 영영 모른다. 그리고 다음에도
  // 같은 식으로 적는다 — 고쳐지지 않는다. 방송은 그대로 나가고 **알림만** 올린다.
  //
  // **경보 문구에 실명을 싣지 않는다.** 경보는 화면에 뜨고 DB 에 남는다 — 스피커를 막으면서
  // 경보로 새어 나가면 막은 것이 아니다. `방송용가리기` 가 이미 `mask()` 한 것만 쓴다.
  try {
    const { 방송용가리기 } = require('./sensitiveInfo')
    const 뺀사유 = []
    const 가린이름 = []
    for (const e of (events || []).slice(0, 3)) {
      const r = 방송용가리기(e?.title)
      if (r.뺌) 뺀사유.push(...r.사유)
      else 가린이름.push(...r.가린이름)
    }
    const 말 = []
    if (뺀사유.length) 말.push(`개인정보(${[...new Set(뺀사유)].join('·')})가 있어 일정 ${뺀사유.length}건을 방송에서 뺐습니다`)
    if (가린이름.length) 말.push(`이름 ${가린이름.length}건은 성만 남겨 방송했습니다`)
    if (말.length) {
      require('./alert').raise('아침방송',
        `오늘 캘린더 일정에 개인정보가 있었습니다 — ${말.join('. ')}. 캘린더 제목에서 빼 주세요.`)
    }
  } catch (err) {
    console.error('[아침방송] 일정 개인정보 점검 실패:', err.message)
  }

  const now     = new Date()
  const month   = now.getMonth() + 1
  const day     = now.getDate()
  const weekday = DAYS[now.getDay()]

  const activity = getActivityText({ air, weather, uv, apparent, minMax })

  const tempRange = (minMax?.minTemp != null && minMax?.maxTemp != null)
    ? `최저 ${Math.floor(parseFloat(minMax.minTemp))}° / 최고 ${Math.floor(parseFloat(minMax.maxTemp))}°`
    : null

  const precipType = weather?.precipitationType
  const skyDesc    = weather?.sky   // null 가능 (초단기예보 실패 시)
  const weatherDesc = (precipType && precipType !== '없음')
    ? precipType
    : (skyDesc || null)

  // 하늘 상태만 (현재 기온 제외) — 카드에는 tempRange(최고/최저)로 표시
  const weatherSkyStr = weatherDesc || null
  const currentTempStr = weather?.temperature != null ? `${Math.floor(weather.temperature)}°C` : null

  const info = {
    date:          `${month}월 ${day}일 ${weekday}`,
    weather:       weatherSkyStr || currentTempStr || '날씨 정보 없음',
    currentTemp:   currentTempStr,
    tempRange,
    dust:          air ? (air.pm10Grade ? `미세먼지 ${air.pm10Grade}` : '미세먼지 정보 없음') : '미세먼지 정보 없음',
    uvGrade:       uv?.todayLevel ?? null,
    uvIndex:       uv?.today      ?? null,
    apparentTemp:  apparent?.value ?? null,
    humidity:      weather?.humidity != null ? Math.round(weather.humidity) : null,
    activity,
    schedule:      events?.length ? events.slice(0, 2).map(e => e.title).join(' / ') : '일정 없음',
    quote:         pickQuote(now),
    alerts,
  }

  return { weather, air, alerts, events, minMax, uv, apparent, activity, info }
}

// ─────────────────────────────────────────────────────
// 세그먼트 ID별 방송 텍스트 생성
// ─────────────────────────────────────────────────────
function buildSegmentText(id, data = {}) {
  const { weather, air, alerts, events, minMax, uv, apparent, activity } = data
  const now     = new Date()
  const month   = now.getMonth() + 1
  const day     = now.getDate()
  const weekday = DAYS[now.getDay()]

  switch (id) {
    case 'greeting':
      return '좋은 아침입니다, 어르신 여러분. 오늘 하루도 활기차게 시작하겠습니다.'

    case 'date':
      return `오늘은 ${month}월 ${day}일 ${weekday}입니다.`

    case 'weather': {
      if (!weather) return ''

      const precip = weather.precipitationType  // '없음', '비', '이슬비', '눈', '소나기', '비/눈'
      const sky    = weather.sky                // '맑음', '구름많음', '흐림' (강수 중이면 강수명과 같음)
      const rainFcst = weather?.rainForecast
      const isCurrentlyPrecip = precip && precip !== '없음'

      // 현재 날씨 묘사: 강수 중이면 강수 유형, 아니면 하늘 상태
      const currentDesc = isCurrentlyPrecip ? precip : (sky || null)

      const hasMinMax = minMax?.minTemp != null && minMax?.maxTemp != null
      const tmn = hasMinMax ? toSinoKoreanTemp(minMax.minTemp) : null
      const tmx = hasMinMax ? toSinoKoreanTemp(minMax.maxTemp) : null
      const curTempStr = weather.temperature != null ? toSinoKoreanTemp(weather.temperature) : null

      // 기온 문구
      const tempText = hasMinMax
        ? `낮 최고 기온은 ${tmx}도, 아침 최저 기온은 ${tmn}도가 예상됩니다.`
        : curTempStr ? `현재 기온은 ${curTempStr}도입니다.` : ''

      // 비 예보 문구 — 현재 강수 여부와 무관하게 오후 예보가 있으면 포함
      // (이슬비 중에도 오후 더 강한 비가 예보되면 함께 안내)
      const rainText = rainFcst?.hasRain ? rainFcst.description : ''

      // 날씨 문장 조립 — 캐스터 스타일
      let weatherSentence = ''
      if (currentDesc && rainText && !isCurrentlyPrecip) {
        // 현재 맑음/흐림인데 나중에 비 예보: "오늘 흐리겠으며, 오후에는 비가 내리겠습니다"
        weatherSentence = `오늘 날씨는 ${currentDesc}이겠으며, ${rainText}`
      } else if (currentDesc && rainText && isCurrentlyPrecip) {
        // 현재도 비/이슬비 + 오후도 비 예보: "오늘 이슬비가 내리겠으며, 오후에도 비가 이어지겠습니다"
        weatherSentence = `오늘 ${currentDesc}가 내리겠으며, ${rainText}`
      } else if (rainText && !currentDesc) {
        weatherSentence = rainText
      } else if (currentDesc) {
        weatherSentence = `오늘 날씨는 ${currentDesc}입니다.`
      }

      // 전체 문장 조립 (아래 갈래가 전부 채우거나 일찍 돌아간다 — 초기값이 쓰이는 길이 없다)
      let text
      if (weatherSentence && tempText) {
        text = `${weatherSentence} ${tempText}`
      } else if (weatherSentence) {
        text = weatherSentence
      } else if (tempText) {
        text = tempText
      } else {
        return ''
      }

      const uvDetail = uv ? getUVDetailText(uv.today, uv.todayLevel) : null
      if (uvDetail) text += ` ${uvDetail}`
      const appText = getApparentTempText(apparent?.value)
      if (appText) text += ` ${appText}`
      if (activity) text += ` ${activity}`
      return text
    }

    case 'dust': {
      if (!air) return ''
      // 에어코리아가 값을 안 주면 weather.js가 pm10에 '-'를 넣고 등급은 null이 된다.
      // 예전엔 그걸 그대로 템플릿에 끼워서 **"미세먼지 농도는 NaN 마이크로그램으로 null
      // 수준입니다."가 실제로 방송됐다**(CC-017). toSinoKorean은 NaN에 던지지 않고 문자열
      // "NaN"을 돌려주기 때문에, 터지지도 않고 조용히 이상한 말이 어르신께 나갔다.
      //
      // 전부 아니면 전무로 만들지 않는 이유: 등급만 아는 날에도 아무 말을 안 하게 된다.
      // 마스크를 쓸지 말지는 등급만 알아도 판단할 수 있다.
      const 농도 = Number(air.pm10)
      const 값있음 = Number.isFinite(농도) && 농도 >= 0
      const 등급 = typeof air.pm10Grade === 'string' && air.pm10Grade.trim() ? air.pm10Grade.trim() : null

      if (값있음 && 등급) return `미세먼지 농도는 ${toSinoKorean(농도)} 마이크로그램으로 ${등급} 수준입니다.`
      if (등급)          return `미세먼지는 ${등급} 수준입니다.`
      if (값있음)        return `미세먼지 농도는 ${toSinoKorean(농도)} 마이크로그램입니다.`
      return ''   // 아무것도 모르면 말하지 않는다 — 침묵이 헛소리보다 낫다
    }

    case 'alert':
      if (!alerts || alerts.length === 0) return ''
      return `기상 특보 안내입니다. ${alerts.join('. ')}`

    // ── 캘린더 제목은 **가려서 읽는다** (사용자 결정 2026-09-15) ──────────────────
    //
    // 이 줄은 구글 캘린더에 직원이 자유롭게 적은 글자를 **무인으로** 음성 합성에 넘기고
    // 전관 스피커로 내보낸다. 여태 검사가 하나도 없었다 — 「김영희 어르신 생신」이라고
    // 적어 두면 그대로 방송되고 이력에도 남았다.
    //
    // 되묻는 장치(`checkSensitive` 의 409)는 여기서 못 쓴다. **07:50 에 물어볼 사람이
    // 없다.** 그래서 무인용 규칙을 쓴다(`sensitiveInfo.방송용가리기`) —
    // 주민번호·전화·생년월일이 든 일정은 **통째로 빼고**, 이름은 **성만 남긴다.**
    //
    // **가리는 자리를 여기 둔 이유**: 이 함수가 방송 문장을 만드는 **유일한 자리**다.
    // 불러오는 쪽에서 가리게 하면, 나중에 다른 경로가 생길 때 그 경로만 새어 나간다
    // (CC-037 에서 초안 승인 경로가 정확히 그렇게 검사를 건너뛰었다).
    // **화면 카드(`info.schedule`)는 원본 그대로다** — 직원은 누구인지 알아야 한다.
    case 'schedule': {
      if (!events || events.length === 0) return '오늘 등록된 일정이 없습니다.'
      const { 방송용가리기 } = require('./sensitiveInfo')
      const 읽을것 = []
      for (const e of events.slice(0, 3)) {
        const r = 방송용가리기(e?.title)
        if (r.뺌 || !r.텍스트?.trim()) continue
        읽을것.push(r.텍스트.trim())
      }
      // **전부 빠졌으면 아무 말도 안 한다.** 「오늘 등록된 일정이 없습니다」로 넘어가면
      // 그건 거짓이다 — 일정은 있고 못 읽는 것이다. 침묵이 헛소리보다 낫다(위 미세먼지와 같은 규칙).
      if (!읽을것.length) return ''
      return `오늘의 주요 일정을 안내해 드립니다. ${읽을것.join(', ')} 순서로 진행됩니다.`
    }

    case 'quote':
      return pickQuote(now)

    case 'closing': {
      const appVal = apparent?.value ?? null
      const prec2  = weather?.precipitationType
      const isRain2 = prec2 === '비' || prec2 === '소나기'
      if (isRain2) return '비 오는 날이지만 따뜻하고 편안한 하루 되시기 바랍니다. 감사합니다.'
      if (appVal != null && appVal >= 35) return '폭염 속에서도 건강하고 소중한 하루 보내세요. 감사합니다.'
      if (appVal != null && appVal >= 30) return '무더운 날씨에도 건강하고 즐거운 하루 보내시기 바랍니다. 감사합니다.'
      if (appVal != null && appVal <= 0) return '추운 날씨에도 따뜻하고 건강한 하루 되시길 바랍니다. 감사합니다.'
      return '즐겁고 건강한 하루 보내시기 바랍니다. 감사합니다.'
    }

    default:
      return ''
  }
}

// ─────────────────────────────────────────────────────
// 최종 방송 텍스트 조합 (async — API 호출 포함)
// ─────────────────────────────────────────────────────
async function buildMorningText(segments) {
  const data = await getMorningData()
  return [...segments]
    .sort((a, b) => a.order - b.order)
    .filter(s => s.enabled)
    .map(s => buildSegmentText(s.id, data))
    .filter(Boolean)
    .join(' ')
}

module.exports = { DEFAULT_SEGMENTS, QUOTES, pickQuote, buildMorningText, buildSegmentText, getMorningData }
