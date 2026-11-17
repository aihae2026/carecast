// 자율 점검 루프가 찾아낸 고도화 제안을 일자별로 저장/조회 — 승인/추천/차단/보류 상태로 관리
const router = require('express').Router()
const { getDB } = require('../db/schema')
const { findBrokenField, brokenTextMessage } = require('../domain/text')

const VALID_STATUS = ['승인', '추천', '차단', '보류', '구현됨']
const VALID_CADENCE = ['daily', 'weekly']

// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting } = require('../domain/settingsRead')

// 루프 설정 조회 — settings 테이블 재사용, 값 없으면 기본값(꺼짐·매일)
function getLoopSettings() {
  const db = getDB()
  const get = (k, d) => rawSetting(db, k) ?? d
  return {
    enabled: get('loop_enabled', 'false') === 'true',
    cadence: get('loop_cadence', 'daily'),
    lastRun: get('loop_last_run', null),
  }
}

// 루프가 실제로 한 번 점검을 마쳤을 때 호출 — 다음 주기 계산의 기준점이 된다
function markLoopRun() {
  const db = getDB()
  setSetting(db, 'loop_last_run', new Date().toISOString())
}

// 루프 설정 저장 — 아직 실제 루프를 걸지는 않고 값만 저장한다
function saveLoopSettings({ enabled, cadence }) {
  if (!VALID_CADENCE.includes(cadence)) {
    throw new Error(`cadence는 ${VALID_CADENCE.join('/')} 중 하나여야 합니다.`)
  }
  const db = getDB()
  setSetting(db, 'loop_enabled', enabled ? 'true' : 'false')
  setSetting(db, 'loop_cadence', cadence)
}

// GET /api/dev/proposals/loop-settings
router.get('/loop-settings', (req, res) => {
  try {
    res.json(getLoopSettings())
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/dev/proposals/loop-settings
router.put('/loop-settings', (req, res) => {
  try {
    saveLoopSettings(req.body)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// POST /api/dev/proposals/loop-settings/mark-run — 루프가 실제 점검을 마쳤을 때 자기 자신을 기록
router.post('/loop-settings/mark-run', (req, res) => {
  try {
    markLoopRun()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 코칭 브리프(03 유사사례조사·06 평가·07 질문) 다시 쓰기 요청 — 자동 재작성은 아니고 사람이
// 다음에 직접 다시 쓸 때 참고할 "요청됨" 표시만 남긴다. settings 테이블 재사용, 새 테이블 없음.
function getBriefStatus() {
  const db = getDB()
  const v = rawSetting(db, 'brief_rewrite_requested_at')
  return { requestedAt: v ?? null }
}

function setBriefRewriteRequested(requested) {
  const db = getDB()
  if (requested) {
    setSetting(db, 'brief_rewrite_requested_at', new Date().toISOString())
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('brief_rewrite_requested_at')
  }
}

// GET /api/dev/proposals/brief-status
router.get('/brief-status', (req, res) => {
  try {
    res.json(getBriefStatus())
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/dev/proposals/brief-status
router.put('/brief-status', (req, res) => {
  try {
    setBriefRewriteRequested(!!req.body.requested)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// GET /api/dev/proposals — 날짜별로 그룹핑해서 반환
router.get('/', (req, res) => {
  try {
    const db = getDB()
    const rows = db.prepare('SELECT * FROM improvement_proposals ORDER BY date DESC, id DESC').all()
    const grouped = {}
    rows.forEach(r => {
      if (!grouped[r.date]) grouped[r.date] = []
      grouped[r.date].push(r)
    })
    res.json({ groups: Object.entries(grouped).map(([date, entries]) => ({ date, entries })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/dev/proposals — 새 제안 등록 (기본 상태: 추천)
router.post('/', (req, res) => {
  try {
    const { date, title, description, category, status } = req.body
    if (!date || !title) return res.status(400).json({ error: 'date, title은 필수입니다.' })
    const broken = findBrokenField({ 제목: title, 설명: description })
    if (broken) return res.status(400).json({ error: brokenTextMessage(broken) })
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: `status는 ${VALID_STATUS.join('/')} 중 하나여야 합니다.` })

    const db = getDB()
    const now = new Date().toISOString()
    const result = db.prepare(`
      INSERT INTO improvement_proposals (date, title, description, status, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(date, title, description ?? '', status ?? '추천', category ?? '', now, now)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 상태를 바꾼다. "승인"이 되는 순간 아직 큐에 없었다면 queued_at을 채워 "구현 대기"로 표시하고,
// 승인이 아닌 다른 상태로 바뀌면 큐에서 제거한다(더 이상 승인 상태가 아니므로 대기할 이유가 없음).
// 자동으로 코드를 만들지는 않는다 — 다음 세션 시작 시 사람이/Claude가 먼저 확인하라는 표시일 뿐.
function setProposalStatus(id, status) {
  if (!VALID_STATUS.includes(status)) {
    throw new Error(`status는 ${VALID_STATUS.join('/')} 중 하나여야 합니다.`)
  }
  const db = getDB()
  const now = new Date().toISOString()
  if (status === '승인') {
    const current = db.prepare('SELECT queued_at FROM improvement_proposals WHERE id = ?').get(id)
    const queuedAt = current?.queued_at ?? now
    db.prepare('UPDATE improvement_proposals SET status = ?, queued_at = ?, updated_at = ? WHERE id = ?')
      .run(status, queuedAt, now, id)
  } else {
    db.prepare('UPDATE improvement_proposals SET status = ?, queued_at = NULL, updated_at = ? WHERE id = ?')
      .run(status, now, id)
  }
}

// 구현을 끝냈을 때 호출 — 승인 이력(status)은 그대로 두고 "대기" 표시만 지운다.
function dismissProposalQueue(id) {
  const db = getDB()
  db.prepare('UPDATE improvement_proposals SET queued_at = NULL, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id)
}

// PATCH /api/dev/proposals/:id — 상태 변경 (승인/추천/차단/보류)
router.patch('/:id', (req, res) => {
  try {
    setProposalStatus(req.params.id, req.body.status)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// POST /api/dev/proposals/:id/dismiss-queue — "구현 대기" 표시만 지움(상태는 유지)
router.post('/:id/dismiss-queue', (req, res) => {
  try {
    dismissProposalQueue(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
module.exports.getLoopSettings = getLoopSettings
module.exports.saveLoopSettings = saveLoopSettings
module.exports.markLoopRun = markLoopRun
module.exports.getBriefStatus = getBriefStatus
module.exports.setBriefRewriteRequested = setBriefRewriteRequested
module.exports.setProposalStatus = setProposalStatus
module.exports.dismissProposalQueue = dismissProposalQueue
