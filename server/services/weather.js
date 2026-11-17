// server/services/weather.js
// CareCast - 날씨/생활기상지수 서비스 통합본
// - 기상청 초단기예보 / 단기예보
// - 자외선지수 (LivingWthrIdxServiceV5/getUVIdxV5)
// - 체감온도 (LivingWthrIdxServiceV2/getSenTaIdxV2) — V5 미지원으로 V2 유지
// - 에어코리아 미세먼지 / 기상청 기상특보

const { getDB } = require('../db/schema')
const { networkDisabled, noticeOnce: netNotice, blockedError, 실패기록 } = require('./networkMode')
// 아래 catch 들은 `실패기록` 으로 남긴다 — fetchText 가 네트워크 차단으로 던진 것은 정보 수준,
// 진짜 실패는 지금처럼 error (2026-10-17 설치 시험 c15: fetchMinMaxFromOpenMeteo·fetchApparentTemp 가 [error] 로 남았다).
// 기상청 규격 ↔ 우리 낱말 변환 규칙은 domain/weatherCodes.js로 내려갔다(2026-09-05).
// 여기 남은 것은 캐시·설정·네트워크를 만지는 것들뿐이다.
const {
  pad2, formatYmd, getLivingBaseTime, getUltraNcstBase, getUltraSrtBase, getVilageBase, skyToText, wmoToSky, ptyToText, extractRainForecast, uvLevel, DUST_GRADE, parseJsonSafe, normalizeServiceKey, maskApiKeysInUrl, parseKmaText, WRN_NAME, LVL_NAME, ALERT_COLS, UV_COLS, parseRn1, getMinMaxBase, v5PeakValue, v5CurrentSlotValue, calcApparentTemp,
} = require('../domain/weatherCodes')

const CACHE_TTL = 1000 * 60 * 10 // 10분 — 성공 응답
// 실패(null)는 짧게만 기억한다(CC-032). 07:44 크론 갱신이 일시 오류로 null을 받으면
// 그 null이 10분을 살아남아, API가 07:45에 회복돼도 07:50 아침방송이 날씨를 뺀 채 나간다.
const FAIL_TTL = 1000 * 60 // 1분
// 새 조회가 실패해도 최근 성공값이 이만큼 안 지났으면 그걸로 방송한다(6시 기온이 8시에 크게 다르지 않다).
const LAST_GOOD_TTL = 1000 * 60 * 60 * 3 // 3시간
const cache = new Map()
const lastGood = new Map() // key → { value, ts } — 마지막 성공값 (실패 시 폴백용)

function fromCache(key) {
  const hit = cache.get(key)
  if (!hit) return undefined
  const ttl = hit.value == null ? FAIL_TTL : CACHE_TTL
  if (Date.now() - hit.ts > ttl) { cache.delete(key); return undefined }
  return hit.value
}
function toCache(key, value) {
  cache.set(key, { value, ts: Date.now() })
  if (value != null) lastGood.set(key, { value, ts: Date.now() })
  return value
}
function lastGoodFor(key) {
  const hit = lastGood.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > LAST_GOOD_TTL) { lastGood.delete(key); return null }
  return hit.value
}
function clearWeatherCache() { cache.clear(); lastGood.clear() }

// 새 조회가 실패(null)하면 최근 성공값으로 대신 방송한다(CC-032).
// 폴백을 거는 기준은 "지난 값을 되풀이해도 해롭지 않은가"다. 기온·최저최고기온·미세먼지·
// 자외선·체감온도는 3시간 전 값이라도 아침방송에서 그 문장이 통째로 빠지는 것보다 낫다.
// **기상특보(alert)와 특보를 안에 싣고 다니는 번들(weatherBundle)은 일부러 제외한다** —
// 이미 해제된 호우경보를 3시간 동안 되풀이 방송하는 쪽이 훨씬 나쁘다.
async function cachedOrLastGood(key, fetchFresh) {
  const cached = fromCache(key)
  // 캐시에 남은 것이 실패(null)라면, 최근(3시간 이내) 성공값이 있는 한 그걸로 방송한다
  if (cached !== undefined) return cached ?? lastGoodFor(key)
  const fresh = await fetchFresh()
  // 어느 실패 경로로 null이 왔든(키 부재·API 오류·네트워크) 최근 성공값이 있으면 폴백
  return fresh ?? lastGoodFor(key)
}

// 설정 읽기는 domain/settingsRead 한 곳을 쓴다 — 같은 조회가 12곳에 복사돼 있었다(TD-04).
const { rawSetting } = require('../domain/settingsRead')

function getSetting(db, key, def = '') { return rawSetting(db, key) ?? def }


// ── 기본값 — 일반 예시(서울특별시) ─────────────────────────────
// 설치한 기관은 관리자 화면(AI · API 연동)에서 자기 위치를 넣는다. 안 넣으면 이 예시 위치의
// 날씨가 나간다 — 특정 기관의 위치를 기본값으로 두지 않는다(공개판 정리 2026-10-17).
const DEFAULT_NX      = 60            // 서울 중구 격자
const DEFAULT_NY      = 127
const DEFAULT_AREA_NO = '1100000000'  // 생활기상지수 지역번호 — 서울특별시
const DEFAULT_LAT     = '37.5665'     // 서울시청
const DEFAULT_LON     = '126.9780'
const DEFAULT_UV_STN  = '108'         // 자외선관측 지점 — 서울
const DEFAULT_AIR_STATION = '중구'    // 에어코리아 측정소 — 서울 중구
const DEFAULT_ALERT_STN_ID = '109'    // 기상특보 구역 — 서울·인천·경기도
const DEFAULT_ALERT_REGION = '서울'   // 특보 통보문에서 고를 지역 이름









// ── 공통 fetch ───────────────────────────────────────────────────
async function fetchText(url) {
  // 이 파일의 바깥 호출은 전부 이 함수를 지난다 — 한 곳에서 막는다.
  if (networkDisabled()) { netNotice('날씨'); throw blockedError('날씨 조회') }
  const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return text
}


// ── DB 설정 한 번에 읽기 ─────────────────────────────────────────
function getKmaConfig() {
  const db = getDB()
  const get = (k) => normalizeServiceKey(getSetting(db, k, ''))
  return {
    apiKey:       get('kma_api_key'),
    apihubKey:    get('kma_apihub_key'),   // apihub.kma.go.kr 통합 인증키
    livingApiKey: get('kma_living_api_key') || get('kma_api_key'),
    nx:    Number(getSetting(db, 'kma_nx', DEFAULT_NX)),
    ny:    Number(getSetting(db, 'kma_ny', DEFAULT_NY)),
    areaNo:       getSetting(db, 'uv_area_no', DEFAULT_AREA_NO),
    uvStn:        getSetting(db, 'kma_uv_stn', DEFAULT_UV_STN),    // 자외선관측 지점 (108 서울·119 수원·105 강릉·159 부산)
  }
}



// =====================================================
// 1) 현재 날씨 — 실황(관측) + 예보 병합
//    실황: PTY(강수형태), RN1(1시간 강수량) — 10분 주기 관측값, 더 정확
//    예보: SKY(하늘상태), T1H(기온), REH(습도)
// =====================================================


async function fetchUltraSrtNcstFrom(url) {
  console.log('[날씨 API] 초단기실황:', maskApiKeysInUrl(url))
  try {
    const json = parseJsonSafe(await fetchText(url), '초단기실황')
    const rc   = json?.response?.header?.resultCode
    if (rc !== '00') { console.error('[실황 API]', rc, json?.response?.header?.resultMsg); return null }
    const items = json?.response?.body?.items?.item || []
    const get   = (cat) => items.find(i => i.category === cat)?.obsrValue ?? null
    const rn1   = parseRn1(get('RN1'))
    const pty   = get('PTY') ?? '0'
    console.log(`[초단기실황] PTY=${pty} RN1=${get('RN1')}(→${rn1}mm) T1H=${get('T1H')} REH=${get('REH')}`)
    return { pty, rn1, t1h: get('T1H'), reh: get('REH') }
  } catch (err) {
    실패기록('[fetchUltraSrtNcst]', err)
    return null
  }
}

// apihub.kma.go.kr(신규 API허브)와 apis.data.go.kr(공공데이터포털)는 별도로 발급받는 서로 다른 키를
// 쓴다 — 같은 키를 apihub 쪽에 넣어도 401이 난다. apihub를 먼저 시도하고 실패하면 반드시
// apiKey(data.go.kr)로 재시도한다(둘 중 하나만 유효해도 동작하도록) — 최종 실패해야 Open-Meteo로 감.
async function fetchUltraSrtNcst(apiKey, apihubKey, nx, ny) {
  const { base_date, base_time } = getUltraNcstBase()
  const common = { pageNo: '1', numOfRows: '100', dataType: 'JSON', base_date, base_time, nx: String(nx), ny: String(ny) }
  if (apihubKey) {
    const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst?${new URLSearchParams({ ...common, authKey: apihubKey })}`
    const result = await fetchUltraSrtNcstFrom(url)
    if (result) return result
  }
  if (apiKey) {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?${new URLSearchParams({ serviceKey: apiKey, ...common })}`
    return fetchUltraSrtNcstFrom(url)
  }
  return null
}

async function fetchUltraSrtFcstFrom(url) {
  console.log('[날씨 API] 초단기예보:', maskApiKeysInUrl(url))
  try {
    const json = parseJsonSafe(await fetchText(url), '초단기예보')
    const rc   = json?.response?.header?.resultCode
    if (rc !== '00') { console.error('[예보 API]', rc, json?.response?.header?.resultMsg); return null }
    const items = json?.response?.body?.items?.item || []
    if (!items.length) return null
    const firstTime  = items[0]?.fcstTime
    const cur        = items.filter(it => it.fcstTime === firstTime)
    const get        = (cat) => cur.find(it => it.category === cat)?.fcstValue ?? null
    return { sky: get('SKY'), t1h: get('T1H'), reh: get('REH'), pty: get('PTY') ?? '0' }
  } catch (err) {
    실패기록('[fetchUltraSrtFcst]', err)
    return null
  }
}

// apihub 먼저 시도, 실패하면 apiKey(data.go.kr)로 재시도 — fetchUltraSrtNcst와 같은 이유.
async function fetchUltraSrtFcst(apiKey, apihubKey, nx, ny) {
  const { base_date, base_time } = getUltraSrtBase()
  const common = { pageNo: '1', numOfRows: '1000', dataType: 'JSON', base_date, base_time, nx: String(nx), ny: String(ny) }
  if (apihubKey) {
    const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtFcst?${new URLSearchParams({ ...common, authKey: apihubKey })}`
    const result = await fetchUltraSrtFcstFrom(url)
    if (result) return result
  }
  if (apiKey) {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?${new URLSearchParams({ serviceKey: apiKey, ...common })}`
    return fetchUltraSrtFcstFrom(url)
  }
  return null
}

// 단기예보(getVilageFcst)에서 현재 시각 슬롯 기상 추출
// apihub 구독이 getVilageFcst만 있을 때 초단기 폴백으로 사용
async function fetchCurrentFromVilageFcstUrl(url, logKey, sourceLabel) {
  console.log('[날씨 API] 단기예보(현재기상 폴백):', maskApiKeysInUrl(url))
  try {
    const json = parseJsonSafe(await fetchText(url), '단기예보(현재기상)')
    const rc   = json?.response?.header?.resultCode
    if (rc !== '00') { console.error('[단기예보 현재기상]', rc, json?.response?.header?.resultMsg); return null }
    const items = json?.response?.body?.items?.item || []
    if (!items.length) return null

    const now      = new Date()
    const today    = formatYmd(now)
    const nowHHMM  = `${pad2(now.getHours())}00`
    const past     = [...new Set(
      items.filter(it => it.fcstDate === today && it.fcstTime <= nowHHMM).map(it => it.fcstTime)
    )].sort().reverse()
    // base_time 전환 직후 과거 슬롯이 없을 수 있음 → 오늘의 가장 가까운 미래 슬롯 사용
    const slot     = past[0] ?? [...new Set(
      items.filter(it => it.fcstDate === today).map(it => it.fcstTime)
    )].sort()[0] ?? null
    if (!slot) return null

    const cur = items.filter(it => it.fcstDate === today && it.fcstTime === slot)
    const get = cat => cur.find(it => it.category === cat)?.fcstValue ?? null
    const tmp = get('TMP'), sky = get('SKY'), pty = get('PTY') ?? '0', reh = get('REH')
    const isRaining = pty !== '0'
    const skyText   = isRaining ? ptyToText(pty) : skyToText(sky)

    console.log(`[단기예보 현재기상] slot=${slot} TMP=${tmp} SKY=${skyText} PTY=${pty}`)
    return toCache('currentWeather', {
      temperature: tmp != null ? Number(tmp) : null,
      sky: skyText, skyCode: sky != null ? String(sky) : null,
      precipitationType: isRaining ? ptyToText(pty) : '없음',
      precipitationCode: pty,
      humidity: reh != null ? Number(reh) : null,
      rn1: 0,
      source: sourceLabel,
    })
  } catch (err) {
    실패기록('[fetchCurrentFromVilageFcst]', err)
    return null
  }
}

// apihub 먼저 시도, 실패하면 apiKey(data.go.kr)로 재시도.
async function fetchCurrentFromVilageFcst(apiKey, apihubKey, nx, ny) {
  const { base_date, base_time } = getVilageBase()
  const common = { pageNo: '1', numOfRows: '1000', dataType: 'JSON', base_date, base_time, nx: String(nx), ny: String(ny) }
  if (apihubKey) {
    const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({ ...common, authKey: apihubKey })}`
    const result = await fetchCurrentFromVilageFcstUrl(url, apihubKey, 'apihub')
    if (result) return result
  }
  if (apiKey) {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({ serviceKey: apiKey, ...common })}`
    return fetchCurrentFromVilageFcstUrl(url, apiKey, 'kma')
  }
  return null
}

async function fetchCurrentWeather() {
  return cachedOrLastGood('currentWeather', fetchCurrentWeatherFresh)
}

async function fetchCurrentWeatherFresh() {
  const { apiKey, apihubKey, nx, ny } = getKmaConfig()
  if (!apiKey && !apihubKey) return toCache('currentWeather', null)

  // 실황(관측) + 예보 병렬 호출
  const [ncst, fcst] = await Promise.all([
    fetchUltraSrtNcst(apiKey, apihubKey, nx, ny),
    fetchUltraSrtFcst(apiKey, apihubKey, nx, ny),
  ])

  // 초단기 둘 다 실패 시 → 단기예보(구독된 엔드포인트)에서 현재 기상 추출
  if (!ncst && !fcst) {
    if (apihubKey || apiKey) return fetchCurrentFromVilageFcst(apiKey, apihubKey, nx, ny)
    return toCache('currentWeather', null)
  }

  const tmp = fcst?.t1h ?? ncst?.t1h ?? null
  const sky = fcst?.sky ?? null
  const reh = fcst?.reh ?? ncst?.reh ?? null

  // 강수 감지: 실황 PTY/RN1 우선 (관측값), 없으면 예보 PTY
  const ptyNcst   = String(ncst?.pty ?? '0')
  const ptyFcst   = String(fcst?.pty ?? '0')
  const rn1       = ncst?.rn1 ?? 0

  // 실황 PTY > 0, 실황 RN1 > 0, 예보 PTY > 0 — 하나라도 감지 시 비
  const isRaining    = ptyNcst !== '0' || rn1 > 0 || ptyFcst !== '0'
  const effectivePty = ptyNcst !== '0' ? ptyNcst : (ptyFcst !== '0' ? ptyFcst : '0')

  let ptyText, skyText
  if (isRaining) {
    if (rn1 > 0 && effectivePty === '0') {
      // RN1만 감지 (PTY는 아직 0) → 강수량으로 판단
      ptyText = rn1 < 1 ? '이슬비' : '비'
    } else {
      ptyText = ptyToText(effectivePty)
    }
    skyText = ptyText
  } else {
    ptyText = '없음'
    skyText = skyToText(sky)
  }

  console.log(`[현재날씨] sky=${skyText} pty=${ptyText} isRaining=${isRaining} (ncstPTY=${ptyNcst} fcstPTY=${ptyFcst} RN1=${rn1})`)

  return toCache('currentWeather', {
    temperature:       tmp != null ? Number(tmp) : null,
    sky:               skyText,
    skyCode:           sky != null ? String(sky) : null,
    precipitationType: ptyText,
    precipitationCode: effectivePty,
    humidity:          reh != null ? Number(reh) : null,
    rn1,
    source: apihubKey ? 'apihub' : 'kma',
  })
}


// =====================================================
// 2) 단기예보 (최저/최고기온)
// =====================================================
async function fetchMinMaxTempFrom(url, logKey, sourceLabel, base_date, base_time) {
  console.log('[날씨 API] 단기예보:', maskApiKeysInUrl(url))
  try {
    const json = parseJsonSafe(await fetchText(url), '단기예보')
    const rc   = json?.response?.header?.resultCode
    if (rc !== '00') throw new Error(`단기예보 오류: ${rc} / ${json?.response?.header?.resultMsg}`)

    const items = json?.response?.body?.items?.item || []
    if (!items.length) return undefined  // 빈 응답 — 다음 후보(다른 포털/Open-Meteo)로 넘어감

    const today = formatYmd()
    const tmnItem = items.find(it => it.category === 'TMN' && it.fcstDate === today)
    const tmxItem = items.find(it => it.category === 'TMX' && it.fcstDate === today)

    const rainForecast = extractRainForecast(items, today)

    const result = {
      minTemp: tmnItem?.fcstValue != null ? Number(tmnItem.fcstValue) : null,
      maxTemp: tmxItem?.fcstValue != null ? Number(tmxItem.fcstValue) : null,
      rainForecast,
      baseDate: base_date,
      baseTime: base_time,
      source: sourceLabel,
    }
    if (result.minTemp != null || result.maxTemp != null) return result
    return undefined // TMN/TMX 없음 — 다음 후보로 넘어감
  } catch (err) {
    실패기록('[fetchMinMaxTemp KMA]', err)
    return undefined
  }
}

// apihub 먼저, 실패하면 apiKey(data.go.kr), 그래도 안 되면 Open-Meteo — 어느 하나만 유효해도 동작.
async function fetchMinMaxTemp() {
  return cachedOrLastGood('minMaxTemp', fetchMinMaxTempFresh)
}

async function fetchMinMaxTempFresh() {
  const { apiKey, apihubKey, nx, ny } = getKmaConfig()
  if (!apiKey && !apihubKey) return fetchMinMaxFromOpenMeteo()

  const { base_date, base_time } = getMinMaxBase()
  const common = { pageNo: '1', numOfRows: '1000', dataType: 'JSON', base_date, base_time, nx: String(nx), ny: String(ny) }

  if (apihubKey) {
    const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({ ...common, authKey: apihubKey })}`
    const result = await fetchMinMaxTempFrom(url, apihubKey, 'apihub', base_date, base_time)
    if (result) return toCache('minMaxTemp', result)
  }
  if (apiKey) {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({ serviceKey: apiKey, ...common })}`
    const result = await fetchMinMaxTempFrom(url, apiKey, 'kma', base_date, base_time)
    if (result) return toCache('minMaxTemp', result)
  }
  // KMA 양쪽 다 실패/미설정 → Open-Meteo fallback
  return fetchMinMaxFromOpenMeteo()
}

// KMA 단기예보 실패 시 Open-Meteo로 최저/최고기온 보조 조회
async function fetchMinMaxFromOpenMeteo() {
  try {
    const db  = getDB()
    const lat = getSetting(db, 'location_lat', DEFAULT_LAT)
    const lon = getSetting(db, 'location_lon', DEFAULT_LON)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1`
    const text = await fetchText(url)
    const json = parseJsonSafe(text, 'Open-Meteo minmax')
    const daily = json?.daily
    const minTemp = daily?.temperature_2m_min?.[0] ?? null
    const maxTemp = daily?.temperature_2m_max?.[0] ?? null
    if (minTemp == null && maxTemp == null) return null
    console.log(`[최저최고 Open-Meteo fallback] 최저=${minTemp} 최고=${maxTemp}`)
    return toCache('minMaxTemp', { minTemp, maxTemp, source: 'open-meteo' })
  } catch (err) {
    실패기록('[fetchMinMaxFromOpenMeteo]', err)
    return null
  }
}


// =====================================================
// 3) 자외선지수
// =====================================================

// kma_sfctm_uv.php (apihub) — 실시간 자외선 관측값
async function fetchUVFromApihub(apihubKey, stn) {
  const now = new Date()
  const tm  = `${formatYmd(now)}${pad2(now.getHours())}${pad2(now.getMinutes())}`
  const url = `https://apihub.kma.go.kr/api/typ01/url/kma_sfctm_uv.php?tm=${tm}&stn=${stn}&help=0&authKey=${encodeURIComponent(apihubKey)}`
  console.log('[자외선 apihub] 요청 stn=' + stn + ' tm=' + tm)

  try {
    const text = await fetchText(url)
    const rows = parseKmaText(text, UV_COLS)
    if (!rows.length) { console.warn('[자외선 apihub] 데이터 없음'); return null }

    const raw = rows[0]['UV-B']
    const val = raw != null && raw !== '' ? Number(raw) : null
    if (val == null || isNaN(val) || val < 0) { console.warn('[자외선 apihub] 유효값 없음:', raw); return null }

    console.log(`[자외선 apihub] UV=${val} (stn=${stn})`)
    return { today: val, todayLevel: uvLevel(val), tomorrow: null, tomorrowLevel: '정보없음', source: 'apihub' }
  } catch (err) {
    실패기록('[자외선 apihub]', err)
    return null
  }
}

async function fetchUVIndex() {
  return cachedOrLastGood('uv', fetchUVIndexFresh)
}

async function fetchUVIndexFresh() {
  const { livingApiKey, apihubKey, areaNo, uvStn } = getKmaConfig()

  // apihub 자외선관측 우선 사용
  if (apihubKey) {
    const result = await fetchUVFromApihub(apihubKey, uvStn).catch(() => null)
    if (result) return toCache('uv', { ...result, areaNo, date: formatYmd(), raw: null })
    if (!livingApiKey) return toCache('uv', null) // apihub 실패 + 대체키 없음
    // apihub 실패, livingApiKey 있으면 구 API로 시도
  }

  if (!livingApiKey) return toCache('uv', null)

  const time = getLivingBaseTime()
  const params = new URLSearchParams()
  params.set('serviceKey', livingApiKey)
  params.set('dataType',   'JSON')
  params.set('areaNo',     areaNo)
  params.set('time',       time)

  const url = `https://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5?${params}`
  console.log('[자외선 API] 요청:', maskApiKeysInUrl(url))

  try {
    const text = await fetchText(url)
    const json = parseJsonSafe(text, '자외선지수')
    const rc   = json?.response?.header?.resultCode
    if (rc && rc !== '00') {
      console.error('[자외선 API] resultCode:', rc, json?.response?.header?.resultMsg, 'areaNo:', areaNo, 'time:', time)
      return toCache('uv', null)
    }

    const items = json?.response?.body?.items?.item
    const item  = Array.isArray(items) ? items[0] : items
    if (!item) { console.warn('[자외선 API] 데이터 없음 — areaNo:', areaNo, 'time:', time); return toCache('uv', null) }

    // V2 구포맷(today/tomorrow) 우선, 없으면 V5 시간별 필드에서 추출
    let todayVal    = (item.today    != null && item.today    !== '') ? Number(item.today)    : null
    let tomorrowVal = (item.tomorrow != null && item.tomorrow !== '') ? Number(item.tomorrow) : null
    if (todayVal    == null) todayVal    = v5PeakValue(item, ['h0','h3','h6','h9','h12'])
    if (tomorrowVal == null) tomorrowVal = v5PeakValue(item, ['h27','h30','h33','h36','h39'])

    console.log('[자외선 API] today:', todayVal, 'tomorrow:', tomorrowVal)

    return toCache('uv', {
      areaNo,
      date:          item.date || time,
      today:         todayVal,
      todayLevel:    todayVal    != null ? uvLevel(todayVal)    : '정보없음',
      tomorrow:      tomorrowVal,
      tomorrowLevel: tomorrowVal != null ? uvLevel(tomorrowVal) : '정보없음',
      source: 'kma',
      raw: item,
    })
  } catch (err) {
    실패기록('[fetchUVIndex]', err)
    return toCache('uv', null)
  }
}

// =====================================================
// 4) 체감온도 — KMA V2(LivingWthrIdxServiceV2/getSenTaIdxV2) 우선,
//    실패 시 Open-Meteo + KMA 공식으로 계산
//    Open-Meteo는 wind/humidity/sky/precip 보조 데이터로도 사용
// =====================================================


// KMA 생활기상지수 V2 체감온도 (getSenTaIdxV2)
async function fetchSenTaFromKMA() {
  const { livingApiKey, areaNo } = getKmaConfig()
  if (!livingApiKey) return null

  const time = getLivingBaseTime()
  const params = new URLSearchParams()
  params.set('serviceKey', livingApiKey)
  params.set('dataType',   'JSON')
  params.set('areaNo',     areaNo)
  params.set('time',       time)

  const url = `https://apis.data.go.kr/1360000/LivingWthrIdxServiceV2/getSenTaIdxV2?${params}`
  console.log('[체감온도 KMA V2]', maskApiKeysInUrl(url))

  try {
    const text = await fetchText(url)
    const json = parseJsonSafe(text, '체감온도V2')
    const rc   = json?.response?.header?.resultCode
    if (rc && rc !== '00') {
      console.error('[체감온도 KMA V2] resultCode:', rc, json?.response?.header?.resultMsg)
      return null
    }
    const items = json?.response?.body?.items?.item
    const item  = Array.isArray(items) ? items[0] : items
    if (!item) { console.warn('[체감온도 KMA V2] 데이터 없음'); return null }

    const val = v5CurrentSlotValue(item, time)
    if (val == null) { console.warn('[체감온도 KMA V2] 슬롯값 없음', item); return null }

    console.log(`[체감온도 KMA V2] ${val}°C (areaNo=${areaNo}, time=${time})`)
    return Math.round(val)
  } catch (err) {
    실패기록('[체감온도 KMA V2]', err)
    return null
  }
}

async function fetchApparentTemp() {
  return cachedOrLastGood('apparent', fetchApparentTempFresh)
}

async function fetchApparentTempFresh() {
  const db  = getDB()
  const lat = getSetting(db, 'location_lat', DEFAULT_LAT)
  const lon = getSetting(db, 'location_lon', DEFAULT_LON)

  // Open-Meteo: wind/humidity/sky/precip 보조 데이터 + fallback 체감온도
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,apparent_temperature,wind_speed_10m,relative_humidity_2m,weather_code,precipitation,rain,snowfall,showers`
    + `&daily=temperature_2m_max,temperature_2m_min`
    + `&timezone=Asia%2FSeoul&forecast_days=1`

  try {
    // KMA V2 체감온도와 Open-Meteo 병렬 호출
    const [omText, kmaApparent] = await Promise.all([
      fetchText(omUrl),
      fetchSenTaFromKMA().catch(() => null),
    ])

    const json = parseJsonSafe(omText, 'Open-Meteo')
    const cur  = json?.current
    if (!cur) throw new Error('Open-Meteo 응답 없음')

    const tempC    = cur.temperature_2m
    const windKmh  = cur.wind_speed_10m
    const humidPct = cur.relative_humidity_2m
    const omValue  = Math.round(cur.apparent_temperature)
    const calcValue = calcApparentTemp(tempC, windKmh, humidPct)

    // 체감온도: KMA V2 공식값 우선, 없으면 Open-Meteo
    const apparentValue = kmaApparent ?? omValue
    const source        = kmaApparent != null ? 'kma-v2' : 'open-meteo'

    const daily   = json?.daily
    const minTemp = daily?.temperature_2m_min?.[0] ?? null
    const maxTemp = daily?.temperature_2m_max?.[0] ?? null

    const totalPrecip = (cur.precipitation ?? 0) + (cur.showers ?? 0)
    const snowfall    = cur.snowfall ?? 0
    const rain        = cur.rain ?? 0
    const wmoCode     = cur.weather_code ?? 0
    let skyFallback    = wmoToSky(wmoCode)
    let precipFallback = '없음'

    const wmoIsRain   = wmoCode >= 51 && wmoCode <= 99
    const wmoIsSnow   = (wmoCode >= 71 && wmoCode <= 77) || (wmoCode >= 85 && wmoCode <= 86)
    const wmoIsShower = wmoCode >= 80 && wmoCode <= 82

    if (totalPrecip > 0 || rain > 0 || snowfall > 0 || wmoIsRain) {
      if ((snowfall > 0 && rain <= 0) || (wmoIsSnow && rain <= 0 && totalPrecip <= 0)) {
        precipFallback = '눈';  skyFallback = '눈'
      } else if ((snowfall > 0 && rain > 0) || (wmoCode >= 66 && wmoCode <= 67)) {
        precipFallback = '비/눈'; skyFallback = '비/눈'
      } else if (wmoIsShower) {
        precipFallback = '소나기'; skyFallback = '소나기'
      } else {
        precipFallback = (totalPrecip > 2 || rain > 2) ? '비' : '이슬비'
        skyFallback    = precipFallback
      }
    }

    console.log(`[체감온도] source=${source} 값=${apparentValue}°C (KMA=${kmaApparent ?? 'N/A'} OM=${omValue}) 기온=${tempC} 풍속=${windKmh} 습도=${humidPct}`)

    return toCache('apparent', {
      value:          apparentValue,
      calcValue,
      temp:           tempC,
      wind:           windKmh,
      humidity:       humidPct,
      minTemp,
      maxTemp,
      isToday:        true,
      source,
      skyFallback,
      precipFallback,
    })
  } catch (err) {
    실패기록('[fetchApparentTemp]', err)
    return toCache('apparent', null)
  }
}

// =====================================================
// 5) 에어코리아 실시간 미세먼지
// =====================================================
async function fetchAirQuality() {
  return cachedOrLastGood('air', fetchAirQualityFresh)
}

async function fetchAirQualityFresh() {
  const db      = getDB()
  const key     = normalizeServiceKey(getSetting(db, 'airkorea_api_key', ''))
  const station = getSetting(db, 'airkorea_station', DEFAULT_AIR_STATION)
  if (!key) return toCache('air', null)

  const qs  = `stationName=${encodeURIComponent(station)}&dataTerm=DAILY&ver=1.3&returnType=json`
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty?serviceKey=${encodeURIComponent(key)}&${qs}`

  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
    require('./netHealth').record(true, '날씨')   // 바깥 통신이 됐다는 증거(CC-025)
    const json = await res.json()
    const item = json?.response?.body?.items?.[0]
    if (!item) return toCache('air', null)

    return toCache('air', {
      pm10:      item.pm10Value  ?? '-',
      pm25:      item.pm25Value  ?? '-',
      pm10Grade: DUST_GRADE[item.pm10Grade1h] || DUST_GRADE[item.pm10Grade] || null,
      pm25Grade: DUST_GRADE[item.pm25Grade1h] || DUST_GRADE[item.pm25Grade] || null,
    })
  } catch (err) {
    실패기록('[미세먼지 API]', err)
    return toCache('air', null)
  }
}

// =====================================================
// 6) 기상청 기상특보
// =====================================================

// apihub wrn_now_data.php — 현재 발효 중인 특보 실시간 조회
async function fetchAlertFromApihub(apihubKey) {
  const now = new Date()
  const tm  = `${formatYmd(now)}${pad2(now.getHours())}${pad2(now.getMinutes())}`
  const url = `https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=e&tm=${tm}&help=0&authKey=${encodeURIComponent(apihubKey)}`
  console.log('[특보 apihub] 요청 tm=' + tm)

  try {
    const text = await fetchText(url)
    const rows = parseKmaText(text, ALERT_COLS)

    const alerts = rows
      .filter(r => r.CMD && r.CMD.includes('발효'))
      .map(r => {
        const wrnName = WRN_NAME[r.WRN?.trim()] ?? r.WRN?.trim() ?? ''
        const lvlName = LVL_NAME[r.LVL?.trim()] ?? ''
        const region  = r.REG_KO?.trim() ?? ''
        const label   = `${wrnName}${lvlName}`
        return region ? `${label}(${region})` : label
      })
      .filter(Boolean)

    // 같은 특보명+지역 중복 제거
    const unique = [...new Set(alerts)]
    console.log(`[특보 apihub] 현재 발효 ${unique.length}건`, unique)
    return { alerts: unique, source: 'apihub' }
  } catch (err) {
    실패기록('[특보 apihub]', err)
    return null // 실패 — 호출자가 apis.data.go.kr 폴백으로 넘어간다(가짜 "0건 성공"으로 감추지 않음)
  }
}

// 특보는 일부러 cachedOrLastGood을 쓰지 않는다(CC-032) — 지난 성공값으로 폴백하면
// 이미 해제된 호우경보·한파경보를 3시간 동안 계속 방송하게 된다. 특보는 "지금 발효 중인가"가
// 전부라, 모를 때는 지난 값을 되풀이하는 것보다 말하지 않는 편이 안전하다.
async function fetchWeatherAlert() {
  const cached = fromCache('alert')
  if (cached !== undefined) return cached

  const { apihubKey } = getKmaConfig()

  // apihub 실시간 특보 조회 우선 사용, 실패하면 아래 공공데이터포털 방식으로 폴백
  if (apihubKey) {
    const result = await fetchAlertFromApihub(apihubKey)
    if (result) return toCache('alert', result)
  }

  // fallback: 공공데이터포털 기간 조회 방식
  const db  = getDB()
  const key = normalizeServiceKey(getSetting(db, 'kma_alert_api_key', '') || getSetting(db, 'kma_api_key', ''))
  if (!key) {
    console.warn('[특보 API] API 키 미설정')
    return toCache('alert', { alerts: [], source: 'kma' })
  }

  try {
    // 공식 가이드(기상청21_기상특보 조회서비스) 예제: fromTmFc/toTmFc는 YYYYMMDD 8자리만 받는다.
    // 실제 resultMsg로 확인한 조회기간 제한: "최대 조회 기간은 오늘 기준으로 6일 전까지". 5일로 여유.
    const now  = new Date()
    const fromDate = new Date(now); fromDate.setDate(fromDate.getDate() - 5)
    const from = `${fromDate.getFullYear()}${pad2(fromDate.getMonth()+1)}${pad2(fromDate.getDate())}`
    const to   = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`

    // stnId는 도(道) 단위 특보구역 코드(문서 부록 "첨부. 지점코드" 표) — 108=전국,
    // 109=서울·인천·경기도 등 10개뿐이라 시/군 단위 세분화는 이 값으로 안 된다.
    // 대신 getWthrWrnMsg(통보문조회)는 t6(현재 발효현황)에 시/군 단위 지역명이 그대로 텍스트로
    // 나와서, 지역 이름이 포함된 줄만 골라내는 방식으로 실제 위치를 특정할 수 있다.
    // (지역은 아직 설정으로 바꿀 수 없다 — README 「알려진 한계」. 기본값은 일반 예시인 서울이다.)
    const STN_ID = DEFAULT_ALERT_STN_ID
    const REGION_KEYWORD = DEFAULT_ALERT_REGION

    const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg?${new URLSearchParams({ serviceKey: key, numOfRows: '5', pageNo: '1', dataType: 'JSON', stnId: STN_ID, fromTmFc: from, toTmFc: to })}`
    console.log('[특보 API 구버전] 요청:', maskApiKeysInUrl(url))

    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
    require('./netHealth').record(true, '날씨')   // 바깥 통신이 됐다는 증거(CC-025)
    const text = await res.text()
    if (!res.ok) { console.error('[특보 API] HTTP 오류:', res.status); return toCache('alert', { alerts: [], source: 'kma' }) }

    let json
    try { json = JSON.parse(text) } catch { console.error('[특보 API] JSON 파싱 실패'); return toCache('alert', { alerts: [], source: 'kma' }) }

    const rc = json?.response?.header?.resultCode
    if (rc && rc !== '00') {
      if (rc === '03') return toCache('alert', { alerts: [], source: 'kma' }) // NODATA — 최근 특보 이력 자체가 없음(정상)
      console.error('[특보 API] resultCode:', rc, json?.response?.header?.resultMsg)
      return toCache('alert', { alerts: [], source: 'kma' })
    }

    const raw  = json?.response?.body?.items?.item ?? []
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    if (!list.length) return toCache('alert', { alerts: [], source: 'kma' })

    // 가장 최근 통보문(tmFc 최댓값)의 t6가 그 시점 기준 전체 발효현황 누적 요약이다.
    const latest = list.reduce((a, b) => (Number(b?.tmFc) > Number(a?.tmFc) ? b : a))
    const t6 = latest?.t6 ?? ''

    const alerts = t6.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('o ') && line.includes(':'))
      .map(line => {
        const [namePart, regionPart] = line.slice(2).split(':').map(s => s.trim())
        return { name: namePart, region: regionPart ?? '' }
      })
      .filter(({ region }) => region.includes(REGION_KEYWORD))
      .map(({ name }) => name)
      .filter(Boolean)

    console.log(`[특보 API] 최신 통보문(${latest?.tmFc}) 중 ${REGION_KEYWORD} 포함 ${alerts.length}건`, alerts)
    return toCache('alert', { alerts, source: 'kma' })
  } catch (err) {
    실패기록('[특보 API] 오류:', err)
    return toCache('alert', { alerts: [], source: 'kma' })
  }
}

// =====================================================
// 7) 메인 날씨 번들 (GET /api/weather 에서 반환)
// =====================================================
// 번들도 폴백 대상이 아니다 — 안에 weatherAlert를 싣고 다니므로 번들을 통째로 되돌리면
// 위 특보 규칙이 무너진다. 대신 구성요소(현재날씨·최저최고·자외선·체감온도·미세먼지)가
// 각자 폴백하므로, 일시 장애에도 번들은 값을 갖춘 채 만들어진다.
async function fetchWeather() {
  const cached = fromCache('weatherBundle')
  if (cached !== undefined) return cached

  const [current, minmax, uv, apparentTemp, air, alertBundle] = await Promise.all([
    fetchCurrentWeather(),
    fetchMinMaxTemp(),
    fetchUVIndex(),
    fetchApparentTemp(),
    fetchAirQuality(),
    fetchWeatherAlert(),
  ])
  const weatherAlert = alertBundle?.alerts ?? alertBundle ?? []

  if (!current && !minmax && !uv && !apparentTemp && !air) return toCache('weatherBundle', null)

  // 기온: KMA 초단기예보 우선, 없으면 Open-Meteo 체감온도 데이터의 기온
  const temperature = current?.temperature ?? apparentTemp?.temp ?? null

  // KMA 강수유형이 없으면 Open-Meteo 강수 데이터로 보완
  const precipType = current?.precipitationType ?? apparentTemp?.precipFallback ?? '없음'
  // KMA 하늘상태가 없으면 Open-Meteo skyFallback 사용 (단, 강수 중이면 강수유형 우선)
  const skyDesc = current?.sky ?? (precipType !== '없음' ? precipType : (apparentTemp?.skyFallback ?? null))

  return toCache('weatherBundle', {
    // 현재 날씨 (KMA 초단기예보 or Open-Meteo fallback)
    temperature,
    sky:               skyDesc,
    skyCode:           current?.skyCode           ?? null,
    precipitationType: precipType,
    precipitationCode: current?.precipitationCode ?? '0',
    humidity:          current?.humidity          ?? apparentTemp?.humidity ?? null,
    // 습도가 어디서 왔나 — 실황(기상청)이 없으면 Open-Meteo 보조 자료로 채운다. 머리줄 칩이 Open-Meteo 값을
    // 보여 줄 때 그 옆에 출처를 달아야 해서(CC BY 4.0, 2026-10-07) 적어 둔다.
    humiditySource:    current?.humidity != null ? (current.source ?? 'kma') : (apparentTemp?.humidity != null ? 'open-meteo' : null),
    windSpeed:         apparentTemp?.wind         ?? null,
    // 최저/최고
    minTemp: minmax?.minTemp ?? null,
    maxTemp: minmax?.maxTemp ?? null,
    // 자외선
    uv: uv ? { value: uv.today, level: uv.todayLevel, date: uv.date } : null,
    // 체감온도 (Open-Meteo + 기상청 공식 검증값 포함)
    apparentTemp: apparentTemp ? {
      value:     apparentTemp.value,
      calcValue: apparentTemp.calcValue,
      isToday:   apparentTemp.isToday,
      source:    apparentTemp.source,
    } : null,
    // 미세먼지 / 특보
    airQuality:   air,
    weatherAlert,
    // 오늘 비 예보 시간대 (단기예보 PTY 기반)
    rainForecast: minmax?.rainForecast ?? { hasRain: false, description: null, slots: [] },
    // 데이터 출처 정보
    dataSources: {
      weather:  current?.source  ?? 'open-meteo',
      minmax:   minmax?.source   ?? 'open-meteo',
      uv:       uv?.source       ?? 'none',
      apparent: apparentTemp?.source ?? 'none',
    },
    fetchedAt: new Date().toISOString(),
  })
}

module.exports = {
  fetchWeather,
  fetchCurrentWeather,
  fetchMinMaxTemp,
  fetchUVIndex,
  fetchApparentTemp,
  fetchAirQuality,
  fetchWeatherAlert,
  clearWeatherCache,
  normalizeServiceKey,
  getKmaConfig,
}
