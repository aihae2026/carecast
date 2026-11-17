// GET /api/dev/nl-stats — 자연어 예약 학습 통계 (고도화 제안 #10 2단계)
//
// **읽기만 한다.** 쓰는 경로가 없는 라우터다 — 이 단계의 약속이 "세어서 보여주기만 한다"이고
// (docs/nl-learning-design.md), 쓰기 구멍을 하나라도 열면 그 약속이 코드로는 지켜지지 않는다.
'use strict'

const router = require('express').Router()
const { getDB } = require('../db/schema')
// 표본 고르기·설정 읽기·집계는 도메인 한 곳에서 한다(loadNlStats). 예전엔 이 라우터와
// 3단계 제안기(nlSuggest)가 같은 세 줄을 각자 갖고 있었다 — 한쪽만 고치면 화면과 제안이
// 다른 표본을 보게 되고, 그러면 사람이 둘 다 안 믿는다.
const { loadNlStats } = require('../domain/nlStats')

router.get('/', (req, res) => {
  try {
    const stats = loadNlStats(getDB())
    res.json({ ...stats, generatedAt: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
