// 기상 특보 API 라우트 — 기상청 기상특보 목록 반환
const { rawSetting } = require('../domain/settingsRead')
const { 바깥호출차단, 실패기록 } = require('../services/networkMode')
// 네트워크 차단 모드 게이트 - 이 파일의 바깥 호출 앞마다 부른다.
// 조용히 빈 결과를 주지 않는다: 부르는 쪽이 그것을 '상대가 답을 안 줬다'로 오독한다.
const 바깥막힘 = () => 바깥호출차단('기상특보', '기상특보 조회')
const express                  = require('express')
const { fetchWeatherAlert, clearWeatherCache } = require('../services/weather')
const { getDB }                = require('../db/schema')
const { 키가리기 }              = require('../domain/keyMask')

const router = express.Router()

// GET /api/weather-alert — 오늘 발효 중인 기상특보 목록
router.get('/', async (req, res) => {
  try {
    const result = await fetchWeatherAlert()
    const alerts = result?.alerts ?? result ?? []
    res.json({ alerts, count: alerts.length, source: result?.source })
  } catch (err) {
    실패기록('[weather-alert/GET]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/weather-alert/debug — 기상특보 API 원본 응답 진단 (캐시 무시)
router.get('/debug', async (req, res) => {
  clearWeatherCache()
  const db  = getDB()
  const get = k => rawSetting(db, k) ?? ''
  const key = get('kma_alert_api_key') || get('kma_api_key')

  if (!key) return res.json({ error: 'kma_alert_api_key / kma_api_key 미설정', keySet: false })

  const now  = new Date()
  const pad  = n => String(n).padStart(2, '0')
  const fromDate = new Date(now); fromDate.setDate(fromDate.getDate() - 14)
  const from = `${fromDate.getFullYear()}${pad(fromDate.getMonth()+1)}${pad(fromDate.getDate())}0000`
  const to   = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}2359`
  const url  = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${encodeURIComponent(key)}&numOfRows=100&dataType=JSON&fromTmFc=${from}&toTmFc=${to}`

  try {
    바깥막힘()
    const r    = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const text = await r.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* 기상청이 오류일 때 XML·HTML을 돌려준다 — parsed=null로 두고 아래에서 원문으로 판정한다 */ }
    const rc   = parsed?.response?.header?.resultCode
    const msg  = parsed?.response?.header?.resultMsg
    const raw  = parsed?.response?.body?.items?.item ?? []
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])

    res.json({
      keySet: true,
      keyMasked: key.slice(0,6) + '...',
      from, to,
      httpStatus: r.status,
      resultCode: rc ?? '(없음)',
      // 기관 서버는 오류 본문·메시지에 요청 주소(serviceKey=…)를 되돌려 준다 — 같은 계열의 날씨 진단처럼
      // 응답 원문·메시지·오류 문구를 전부 가린다(추가 점검 2026-11-01). **가린 다음에 자른다** — 먼저 자르면 키 조각이 남는다.
      resultMsg:  키가리기(msg ?? '(없음)', key, '***'),
      totalItems: list.length,
      items: list.slice(0, 20),
      rawBody: 키가리기(text, key, '***').slice(0, 800),
    })
  } catch (err) {
    res.json({ keySet: true, from, to, error: 키가리기(err.message, key, '***') })
  }
})

module.exports = router
