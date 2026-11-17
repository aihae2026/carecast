// server/routes/weather.js
// 날씨 API 라우트 — 기상청 초단기예보 / 자외선지수 / 체감온도 결과 반환

const express = require('express')
const { 바깥호출차단, 차단인가, 실패기록 } = require('../services/networkMode')
// 네트워크 차단 모드 게이트 - 이 파일의 바깥 호출 앞마다 부른다.
// 조용히 빈 결과를 주지 않는다: 부르는 쪽이 그것을 '상대가 답을 안 줬다'로 오독한다.
const 바깥막힘 = () => 바깥호출차단('날씨', '날씨 조회')
const {
  fetchWeather,
  fetchUVIndex,
  fetchApparentTemp,
  clearWeatherCache,
} = require('../services/weather')
const { getDB } = require('../db/schema')
// 설정 읽기는 domain/settingsRead 한 곳을 쓴다 — 같은 조회가 여러 곳에 복사돼 있었다(TD-04).
const { rawSetting } = require('../domain/settingsRead')
// 머리줄 날씨 칩 — 반나절에 한 번만 받는다(사용자 지시 2026-09-15). 규칙은 순수 모듈에 있다.
const { 칩만들기, 아직쓸만한가 } = require('../domain/weatherChip')

const router = express.Router()

// 진단 응답에서 키를 지우는 규칙은 domain/keyMask.js 한 곳 — 기상특보 진단(weatherAlert.js)도 같은 것을 쓴다.
const { 키가리기 } = require('../domain/keyMask')

// GET /api/weather — 현재 날씨 + 최저최고 + 자외선 + 체감온도
router.get('/', async (req, res) => {
  try {
    const data = await fetchWeather()
    if (!data) {
      return res.status(503).json({
        error: '기상청 API 키가 설정되지 않았거나 응답이 없습니다.',
      })
    }
    res.json(data)
  } catch (err) {
    실패기록('[weather/GET]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/weather/chip — 머리줄에 붙는 작은 날씨 (사용자 지시 2026-09-15) ──────
// *"그냥 오전 오후 한번씩만 불러와서 그걸로 쓰면 되잖아"*
//
// 화면은 이것을 자주 물어도 된다. **바깥으로는 반나절에 한 번만 나간다** — 오전 칸에서
// 한 번, 오후 칸에서 한 번. 공공데이터 개발 계정의 하루 1만 건 한도를 지키는 자리다.
//
// **캐시를 지우지 않는다.** 바로 아래 진단용 끝점들(`/uv`·`/apparent`)은 사람이 「지금
// 다시 받아 보려고」 누르는 자리라 `clearWeatherCache()` 를 부르는데, 그것을 여기 복사해
// 오면 부를 때마다 새로 받아서 반나절 규칙이 무의미해진다.
//
// **못 받으면 먼저 받아 둔 것을 준다**(`낡음: true` 를 붙여서). 날씨를 못 받는 것은
// 방송이 안 나가는 일이 아니므로 화면을 비우는 것보다 낡은 값이 낫다 — 다만 낡았다는
// 사실은 숨기지 않는다.
let _받아둔칩 = null

router.get('/chip', async (req, res) => {
  try {
    if (아직쓸만한가(_받아둔칩)) return res.json(_받아둔칩)

    // 네트워크 차단 모드면 fetchWeather(services/weather.js)가 **던진다** — 아래 catch 가 받아 둔 것(낡음)
    // 또는 503 을 준다. 조용히 빈 값을 주지 않는다. (예전 `if (바깥막힘())` 은 던지는 함수라 그 안이 안 돌았고,
    // 실제로는 fetchWeather 의 거절이 catch 에서 error 로 남았다 — 2026-10-17 설치 시험 c12.)
    const 묶음 = await fetchWeather()
    const 칩 = 칩만들기(묶음)
    if (!칩) {
      return _받아둔칩
        ? res.json({ ..._받아둔칩, 낡음: true })
        : res.status(503).json({ error: '날씨를 받지 못했습니다' })
    }
    _받아둔칩 = 칩
    res.json(칩)
  } catch (err) {
    실패기록('[weather/chip]', err)
    if (_받아둔칩) return res.json({ ..._받아둔칩, 낡음: true })
    res.status(차단인가(err) ? 503 : 500).json({ error: err.message })
  }
})

// GET /api/weather/uv — 자외선지수 조회 (생활기상지수 V2)
router.get('/uv', async (req, res) => {
  clearWeatherCache() // 테스트 버튼에서 호출 — 항상 캐시 무시하고 재조회
  try {
    const data = await fetchUVIndex()
    if (!data) {
      return res.status(503).json({
        error: '자외선지수 API 응답 없음 — 인증키 또는 지점코드를 확인하세요.',
      })
    }
    res.json(data)
  } catch (err) {
    실패기록('[weather/uv GET]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/weather/apparent — 체감온도 조회 (생활기상지수 V2)
router.get('/apparent', async (req, res) => {
  clearWeatherCache()
  try {
    const data = await fetchApparentTemp()
    if (!data) {
      return res.status(503).json({
        error: '체감온도 API 응답 없음 — 인증키 또는 지점코드를 확인하세요.',
      })
    }
    res.json(data)
  } catch (err) {
    실패기록('[weather/apparent GET]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/weather/uv-debug — 자외선지수 API 원본 응답 진단 (캐시 무시)
router.get('/uv-debug', async (req, res) => {
  const db = getDB()
  const getSetting = (key, def = '') => rawSetting(db, key) ?? def

  const livingKey   = getSetting('kma_living_api_key')
  const forecastKey = getSetting('kma_api_key')
  const rawKey      = livingKey || forecastKey

  if (!rawKey) {
    return res.json({
      error: '생활기상지수 인증키가 설정되지 않았습니다.',
      keySet: false,
    })
  }

  const apiKey = rawKey
  const areaNo = getSetting('uv_area_no', '1100000000')   // 기본값: 일반 예시(서울특별시)

  // 발표 시각: 18시 이전 → YYYYMMDD06, 18시 이후 → YYYYMMDD18
  const now  = new Date()
  const h    = now.getHours()
  const y    = now.getFullYear()
  const mo   = String(now.getMonth() + 1).padStart(2, '0')
  const d    = String(now.getDate()).padStart(2, '0')
  const time = `${y}${mo}${d}${h >= 18 ? '18' : '06'}`

  const maskedKey = rawKey.slice(0, 6) + '...' + rawKey.slice(-4)

  const params = new URLSearchParams()
  params.set('serviceKey', apiKey)
  params.set('dataType',   'JSON')
  params.set('areaNo',     areaNo)
  params.set('time',       time)

  const url = `https://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5?${params}`

  try {
    바깥막힘()
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const text = await response.text()

    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* 기상청이 오류일 때 XML·HTML을 돌려준다 — parsed=null로 두고 아래에서 원문으로 판정한다 */ }

    const resultCode = parsed?.response?.header?.resultCode
    const resultMsg  = parsed?.response?.header?.resultMsg

    res.json({
      keySet:       true,
      keyMasked:    maskedKey,
      keyIsEncoded: rawKey.includes('%'),
      keySource:    livingKey ? 'kma_living_api_key' : 'kma_api_key(fallback)',
      areaNo,
      time,
      // **인코딩된 모습도 함께 지운다.** `URLSearchParams` 가 직렬화하면서 키의
      // `+`·`/`·`=` 를 `%2B`·`%2F`·`%3D` 로 바꾸므로, 원래 글자만 찾아 바꾸면
      // **하나도 안 걸리고 키가 그대로 나간다**(Codex 재현, 2026-09-11 EV-004651).
      // 이 URL 은 진단 패널이 화면에 그대로 띄우는 값이다.
      url:          키가리기(url, apiKey, '***'),
      httpStatus:   response.status,
      resultCode:   resultCode ?? '(없음)',
      // **URL 만 가리는 것으로는 부족하다.** 기관 서버가 오류 문구나 본문에 키를
      // 되돌려 주는 일이 있다(`invalid serviceKey=…`). 진단 패널은 이 값들을 그대로
      // 화면에 띄우므로 여기서도 지운다(Codex 재현, 2026-09-11 EV-004669).
      resultMsg:    키가리기(resultMsg ?? '(없음)', apiKey, '***'),
      // **가린 뒤에 자른다.** 먼저 자르면 500자 경계에 걸린 키가 반토막으로 남고,
      // 온전한 키를 찾는 가리기는 그 조각을 못 본다(Codex 재현, EV-004679).
      rawBody:      키가리기(text, apiKey, '***').slice(0, 500),
    })
  } catch (err) {
    res.json({
      keySet:    true,
      keyMasked: maskedKey,
      areaNo,
      time,
      // 던진 오류 메시지에도 요청 URL 이 통째로 실려 오는 일이 있다.
      error:     키가리기(err.message, apiKey, '***'),
    })
  }
})

// GET /api/weather/minmax-debug — 최저최고기온 직접 진단 (KMA 단기예보 raw)
router.get('/minmax-debug', async (req, res) => {
  clearWeatherCache()
  const db = getDB()
  const getSetting = (key, def = '') => rawSetting(db, key) ?? def

  const apiKey = getSetting('kma_api_key')
  const nx = getSetting('kma_nx', '60')    // 기본값: 일반 예시(서울)
  const ny = getSetting('kma_ny', '127')

  if (!apiKey) return res.json({ error: 'kma_api_key 미설정' })

  // getMinMaxBase 로직 직접 구현
  const pad2 = n => String(n).padStart(2, '0')
  const now = new Date()
  let base_date, base_time
  if (now.getHours() < 5 || (now.getHours() === 5 && now.getMinutes() < 10)) {
    const prev = new Date(now); prev.setDate(prev.getDate() - 1)
    base_date = `${prev.getFullYear()}${pad2(prev.getMonth()+1)}${pad2(prev.getDate())}`
    base_time = '2300'
  } else {
    base_date = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`
    base_time = '0500'
  }

  const params = new URLSearchParams()
  params.set('serviceKey', apiKey)
  params.set('pageNo', '1')
  params.set('numOfRows', '1000')
  params.set('dataType', 'JSON')
  params.set('base_date', base_date)
  params.set('base_time', base_time)
  params.set('nx', nx)
  params.set('ny', ny)

  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${params}`

  try {
    바깥막힘()
    const r    = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const text = await r.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* 기상청이 오류일 때 XML·HTML을 돌려준다 — parsed=null로 두고 아래에서 원문으로 판정한다 */ }

    const rc    = parsed?.response?.header?.resultCode
    const msg   = parsed?.response?.header?.resultMsg
    const items = parsed?.response?.body?.items?.item ?? []
    const today = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`
    const tmn   = items.find(it => it.category === 'TMN' && it.fcstDate === today)
    const tmx   = items.find(it => it.category === 'TMX' && it.fcstDate === today)

    res.json({
      base_date, base_time, nx, ny,
      httpStatus: r.status,
      resultCode: rc,
      // **자외선 진단과 같은 규칙을 여기에도 쓴다.** 한쪽만 고치면 다른 쪽으로 샌다 —
      // 이 저장소가 여러 번 겪은 모양이다(Codex 재현, 2026-09-11 EV-004679).
      resultMsg: 키가리기(msg ?? '', apiKey, '***'),
      itemCount: items.length,
      today,
      tmnFound: !!tmn, tmnValue: tmn?.fcstValue,
      tmxFound: !!tmx, tmxValue: tmx?.fcstValue,
      // **가린 뒤에 자른다.** 먼저 자르면 경계에 걸린 키가 반토막으로 남아
      // 온전한 키를 찾는 가리기를 빠져나간다(Codex 재현).
      rawBody: 키가리기(text, apiKey, '***').slice(0, 600),
    })
  } catch (err) {
    res.json({ error: 키가리기(err.message, apiKey, '***'), base_date, base_time })
  }
})

module.exports = router
