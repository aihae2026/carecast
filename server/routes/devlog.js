const router = require('express').Router()
const { exec } = require('child_process')
const { getDB } = require('../db/schema')
const path = require('path')
const { parseCommit, isAutoHiddenScope, clampInt } = require('../services/devlogFilter')

const PROJECT_DIR = path.join(__dirname, '../..')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function gitLog(limit, offset) {
  return new Promise((resolve) => {
    exec(
      `git log --format="%H|||%ad|||%s" --date=format:"%Y-%m-%d" --skip=${offset} -${limit}`,
      { cwd: PROJECT_DIR, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([])
        const items = stdout.trim().split('\n').map(line => {
          const [hash, date, ...rest] = line.split('|||')
          const subject = rest.join('|||').trim()
          const { category, scope } = parseCommit(subject)
          return { hash: hash?.trim(), date: date?.trim(), subject, category, scope }
        }).filter(i => i.hash && i.date)
        resolve(items)
      }
    )
  })
}

// GET /api/devlog?limit=&offset= — git log + 커스텀 노트 병합
// 최근 커밋이 하루에 수십 개씩 쌓이면 한 번에 가져오는 개수만으로는 며칠치밖에 못 보므로,
// offset을 밀어가며 과거 기록을 이어서 불러올 수 있게 한다.
router.get('/', async (req, res) => {
  try {
    const limit  = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    const commits = await gitLog(limit, offset)
    const db = getDB()
    const notes = db.prepare('SELECT hash, note, hidden FROM devlog_notes').all()
    const noteMap = {}
    notes.forEach(n => { noteMap[n.hash] = n })

    const items = commits
      .filter(c => !noteMap[c.hash]?.hidden && !isAutoHiddenScope(c.scope))
      .map(c => ({
        hash:     c.hash,
        date:     c.date,
        subject:  noteMap[c.hash]?.note ?? c.subject,
        edited:   !!noteMap[c.hash]?.note,
        category: c.category,
      }))

    // 날짜별 그룹핑
    const grouped = {}
    items.forEach(i => {
      if (!grouped[i.date]) grouped[i.date] = []
      grouped[i.date].push(i)
    })

    // hasMore는 필터링 전 원본 커밋 수로 판단한다.
    // (숨김 처리로 이번 페이지가 통째로 비어도 그 뒤에 과거 커밋이 남아있을 수 있다)
    res.json({
      groups: Object.entries(grouped).map(([date, entries]) => ({ date, entries })),
      hasMore: commits.length === limit,
      nextOffset: offset + commits.length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/devlog/:hash — 노트 수정
router.put('/:hash', (req, res) => {
  try {
    const db = getDB()
    db.prepare(`
      INSERT INTO devlog_notes (hash, note) VALUES (?, ?)
      ON CONFLICT(hash) DO UPDATE SET note = excluded.note
    `).run(req.params.hash, req.body.note ?? '')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/devlog/:hash — 항목 숨기기
router.delete('/:hash', (req, res) => {
  try {
    const db = getDB()
    db.prepare(`
      INSERT INTO devlog_notes (hash, hidden) VALUES (?, 1)
      ON CONFLICT(hash) DO UPDATE SET hidden = 1
    `).run(req.params.hash)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
