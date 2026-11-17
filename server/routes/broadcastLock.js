// 방송 중복재생 방지 — 다른 PC 간 경쟁 조정
// 같은 audioId에 대해 먼저 요청한 클라이언트(PC)만 ok:true 반환
const express = require('express')
const router = express.Router()

const locks = new Map() // audioId → timestamp
const TTL_MS = 5 * 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [id, ts] of locks) {
    if (now - ts > TTL_MS) locks.delete(id)
  }
}, 60_000)

router.post('/', (req, res) => {
  const { audioId } = req.body
  if (!audioId) return res.status(400).json({ ok: false })

  const now = Date.now()
  const existing = locks.get(audioId)
  if (existing && now - existing < TTL_MS) {
    return res.json({ ok: false })
  }

  locks.set(audioId, now)
  res.json({ ok: true })
})

module.exports = router
