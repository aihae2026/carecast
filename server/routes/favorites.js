const express = require('express')
const { getDB } = require('../db/schema')
const { broadcastSSE } = require('../services/sse')

const router = express.Router()

// GET /api/favorites — 즐겨찾기 목록
router.get('/', (req, res) => {
  try {
    const rows = getDB().prepare('SELECT * FROM favorites ORDER BY id ASC').all()
    res.json(rows)
  } catch (err) {
    console.error('[favorites/GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/favorites — 즐겨찾기 추가
router.post('/', (req, res) => {
  const { label, content, voice = 'ko-KR-SunHiNeural' } = req.body
  if (!label || !content) return res.status(400).json({ error: '라벨과 내용을 입력해주세요.' })
  try {
    const db     = getDB()
    const result = db.prepare('INSERT INTO favorites (label, content, voice) VALUES (?, ?, ?)').run(label, content, voice)
    const row    = db.prepare('SELECT * FROM favorites WHERE id = ?').get(result.lastInsertRowid)
    broadcastSSE('favorites_updated', {})
    res.status(201).json(row)
  } catch (err) {
    console.error('[favorites/POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/favorites/:id — 즐겨찾기 수정
router.put('/:id', (req, res) => {
  const { label, content, voice } = req.body
  try {
    const db = getDB()
    db.prepare('UPDATE favorites SET label = ?, content = ?, voice = ? WHERE id = ?').run(label, content, voice, req.params.id)
    broadcastSSE('favorites_updated', {})
    res.json(db.prepare('SELECT * FROM favorites WHERE id = ?').get(req.params.id))
  } catch (err) {
    console.error('[favorites/PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/favorites/:id — 즐겨찾기 삭제
router.delete('/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM favorites WHERE id = ?').run(req.params.id)
    broadcastSSE('favorites_updated', {})
    res.json({ ok: true })
  } catch (err) {
    console.error('[favorites/DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
