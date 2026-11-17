// 미세먼지 API 라우트 — 에어코리아 실시간 측정 결과 반환
const express                = require('express')
const { fetchAirQuality }    = require('../services/weather')

const router = express.Router()

// GET /api/air-quality — PM10 / PM2.5 농도 및 등급
router.get('/', async (req, res) => {
  try {
    const data = await fetchAirQuality()
    if (!data) return res.status(503).json({ error: '에어코리아 API 키가 설정되지 않았거나 응답이 없습니다.' })
    res.json(data)
  } catch (err) {
    console.error('[air-quality/GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
