// Phase 5: "고도화 제안" 페이지를 코칭 브리프 전체 내용으로 확장 — 실행기록/체크리스트+점수/
// 코치진 질문/유사사례/참고문헌/로드맵. improvementProposals.js(루프 설정·제안 리스트)는 그대로 두고
// 이 파일은 확장된 섹션들만 담당한다.
const router = require('express').Router()
const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const { getDB } = require('../db/schema')
const { summarizeVerifyResult } = require('../services/verifyRunner')
const { findBrokenField, brokenTextMessage } = require('../domain/text')

const execAsync = promisify(exec)
const PROJECT_DIR = path.join(__dirname, '../..')

// npm run verify는 이 4단계를 순서대로 돈다(루트 package.json의 verify 스크립트와 동일) —
// 한 번에 exec 하나로 돌리면 진행률을 알 수 없어서, "지금 점검" 버튼용으로 단계별로 나눠서 돈다.
const VERIFY_STAGES = [
  { name: 'lint',  cmd: 'npm run lint:check',  pct: 15 },
  { name: 'build', cmd: 'npm run build',       pct: 40 },
  { name: 'test',  cmd: 'npm run test:server', pct: 90 },
  { name: 'db',    cmd: 'npm run verify:db',   pct: 100 },
]

// 단일 실행만 허용(동시에 두 번 누르면 프로세스가 겹쳐 돌아 결과가 꼬일 수 있음)
let verifyRun = { running: false, stage: null, pct: 0, result: null }

async function runVerifyStages() {
  verifyRun = { running: true, stage: VERIFY_STAGES[0].name, pct: 0, result: null }
  let combinedOutput = ''
  let failed = false
  for (const stage of VERIFY_STAGES) {
    verifyRun.stage = stage.name
    try {
      const { stdout, stderr } = await execAsync(stage.cmd, { cwd: PROJECT_DIR, timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
      combinedOutput += stdout + stderr
    } catch (e) {
      combinedOutput += (e.stdout || '') + (e.stderr || '')
      failed = true
      verifyRun.pct = stage.pct
      break
    }
    verifyRun.pct = stage.pct
  }

  const { result, note } = summarizeVerifyResult(failed ? new Error('verify failed') : null, combinedOutput, '')
  try {
    const db = getDB()
    db.prepare(`
      INSERT INTO checkin_runs (item_name, result, note, checked_at) VALUES (?, ?, ?, ?)
    `).run('수동 점검 (npm run verify)', result, note, new Date().toISOString())
  } catch { /* 기록 실패해도 점검 결과 자체는 status로 이미 확인 가능 */ }

  verifyRun = { running: false, stage: null, pct: 100, result }
}

// 문항 7개 상한은 없어졌다(0019). 검증은 "그 주차에 **실제로 있는 문항인가**"로 바뀌었다 —
// 예전엔 '0'~'6' 고정이라 여덟 번째 문항은 저장이 거부됐고, 화면에서 문항을 넣을 수가 없었다.
const checklistItems = require('../domain/checklistItems')
const SCORE_KEYS = ['importance', 'ai_need', 'feasibility', 'tech_ready', 'impact']

// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting } = require('../domain/settingsRead')

// 이전 주차를 과거 기록으로 남기고 새 주차를 시작한다(테스트에서 직접 검증하기 위해 분리)
function startNewWeek(weekLabel) {
  const db = getDB()
  db.prepare('UPDATE checklist_weeks SET is_current = 0 WHERE is_current = 1').run()
  const r = db.prepare(`
    INSERT INTO checklist_weeks (week_label, started_at, is_current) VALUES (?, ?, 1)
  `).run(weekLabel, new Date().toISOString())
  return r.lastInsertRowid
}

// 체크리스트/점수 항목 upsert(테스트에서 직접 검증하기 위해 분리)
function upsertChecklistEntry({ week_id, kind, item_key, value, note }) {
  if (kind === 'checklist' && !checklistItems.hasItem(getDB(), week_id, item_key)) {
    throw new Error('그 주차에 없는 체크리스트 문항입니다.')
  }
  if (kind === 'score' && !SCORE_KEYS.includes(item_key)) throw new Error('유효하지 않은 score item_key입니다.')

  const db = getDB()
  const now = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM checklist_entries WHERE week_id = ? AND kind = ? AND item_key = ?')
    .get(week_id, kind, String(item_key))
  if (existing) {
    db.prepare('UPDATE checklist_entries SET value = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(value ?? 0, note ?? '', now, existing.id)
  } else {
    db.prepare(`
      INSERT INTO checklist_entries (week_id, kind, item_key, value, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(week_id, kind, String(item_key), value ?? 0, note ?? '', now)
  }
}

// ── 실행 기록 — 기능 점검 ────────────────────────────────────────
// GET /api/dev/brief/checkins — 항목별 최신 기록만 모아서 반환(과거 기록은 DB에 그대로 남음)
router.get('/checkins', (req, res) => {
  try {
    const db = getDB()
    const rows = db.prepare('SELECT * FROM checkin_runs ORDER BY checked_at DESC, id DESC').all()
    const latestByItem = {}
    rows.forEach(r => { if (!latestByItem[r.item_name]) latestByItem[r.item_name] = r })
    res.json({ latest: Object.values(latestByItem), all: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/dev/brief/checkins/run-verify — npm run verify를 단계별로 실행해 실행기록에 자동으로 남긴다.
// "지금 점검" 버튼용 — 사람이 로컬 /loop 주기를 기다리지 않고도 verify 파이프라인 상태를 바로 확인할 수 있게 한다.
// 즉시 응답하고, 진행 상황은 GET .../run-verify/status를 폴링해서 확인한다(진행률 표시용).
router.post('/checkins/run-verify', (req, res) => {
  // **설치판에서는 돌리지 않는다**(2026-11-10 추가 점검). 설치 파일로 깐 PC 에는 `.git` 이 없다(update.js 와
  // 같은 판정). 그 PC 는 방송 PC 라 npm build·테스트가 운영 화면 파일을 다시 만들고 CPU 를 붙잡는다.
  if (!require('fs').existsSync(path.join(PROJECT_DIR, '.git'))) {
    return res.status(409).json({ error: '설치판에서는 개발 점검을 돌리지 않습니다. 소스로 깐 개발 PC 에서 실행해 주세요.' })
  }
  if (verifyRun.running) return res.status(409).json({ error: '이미 점검이 진행 중입니다.' })
  runVerifyStages()
  res.json({ started: true })
})

// GET /api/dev/brief/checkins/run-verify/status
router.get('/checkins/run-verify/status', (req, res) => {
  res.json(verifyRun)
})

// POST /api/dev/brief/checkins
router.post('/checkins', (req, res) => {
  try {
    const { item_name, result, note } = req.body
    if (!item_name || !result) return res.status(400).json({ error: 'item_name, result는 필수입니다.' })
    const broken = findBrokenField({ 항목: item_name, 메모: note })
    if (broken) return res.status(400).json({ error: brokenTextMessage(broken) })
    const db = getDB()
    const r = db.prepare(`
      INSERT INTO checkin_runs (item_name, result, note, checked_at) VALUES (?, ?, ?, ?)
    `).run(item_name, result, note ?? '', new Date().toISOString())
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 체크리스트(7항목) + 평가·점수(5항목) — 주차 단위 ──────────────
// GET /api/dev/brief/checklist — 현재 주차 항목 + 과거 주차 목록(라벨만)
router.get('/checklist', (req, res) => {
  try {
    const db = getDB()
    const current = db.prepare('SELECT * FROM checklist_weeks WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get()
    if (!current) return res.json({ current: null, entries: [], pastWeeks: [] })
    const entries = db.prepare('SELECT * FROM checklist_entries WHERE week_id = ?').all(current.id)
    const pastWeeks = db.prepare('SELECT * FROM checklist_weeks WHERE is_current = 0 ORDER BY id DESC').all()
    // 문항은 이제 DB가 단일 출처다(0019). 화면 상수는 시딩에만 쓰인다.
    res.json({ current, entries, pastWeeks, items: checklistItems.itemsFor(db, current.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/dev/brief/checklist/:weekId — 과거 주차 하나 상세(읽기전용 조회용)
router.get('/checklist/:weekId', (req, res) => {
  try {
    const db = getDB()
    const week = db.prepare('SELECT * FROM checklist_weeks WHERE id = ?').get(req.params.weekId)
    if (!week) return res.status(404).json({ error: '해당 주차를 찾을 수 없습니다.' })
    const entries = db.prepare('SELECT * FROM checklist_entries WHERE week_id = ?').all(week.id)
    res.json({ week, entries, items: checklistItems.itemsFor(db, week.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/dev/brief/checklist/new-week — 이전 주차를 과거 기록으로 남기고 새 주차 시작
router.post('/checklist/new-week', (req, res) => {
  try {
    const { week_label } = req.body
    if (!week_label) return res.status(400).json({ error: 'week_label은 필수입니다.' })
    const id = startNewWeek(week_label)
    res.json({ ok: true, id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/dev/brief/checklist/entries — 항목 하나 upsert(체크/점수 값 변경 시 즉시 저장)
router.put('/checklist/entries', (req, res) => {
  try {
    const { week_id, kind, item_key, value, note } = req.body
    if (!week_id || !kind || item_key === undefined) return res.status(400).json({ error: 'week_id, kind, item_key는 필수입니다.' })
    upsertChecklistEntry({ week_id, kind, item_key, value, note })
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ── 체크리스트 문항 (CRUD) ────────────────────────────────────────
// 문항을 화면에서 넣고 고친다(고도화 제안 #23). **열쇠(item_key)는 바꾸지 않는다** —
// 값이 그 열쇠로 붙어 있어서, 다시 매기면 지난 체크·메모가 엉뚱한 문항으로 옮겨간다.

router.get('/checklist/:weekId/items', (req, res) => {
  try {
    res.json({ items: checklistItems.itemsFor(getDB(), Number(req.params.weekId)) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/checklist/:weekId/items', (req, res) => {
  try {
    const key = checklistItems.addItem(getDB(), Number(req.params.weekId), req.body?.label)
    res.status(201).json({ ok: true, item_key: key })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// 문구만 고친다
router.put('/checklist/:weekId/items/:itemKey', (req, res) => {
  try {
    checklistItems.updateLabel(getDB(), Number(req.params.weekId), req.params.itemKey, req.body?.label)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// 순서만 바꾼다(위에서 아래 순서로 열쇠 목록을 받는다)
router.put('/checklist/:weekId/items-order', (req, res) => {
  try {
    const keys = req.body?.keys
    if (!Array.isArray(keys)) return res.status(400).json({ error: 'keys 배열이 필요합니다.' })
    checklistItems.reorder(getDB(), Number(req.params.weekId), keys)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// 문항과 **그 문항의 체크·메모를 함께** 지운다(사용자 결정 2026-09-03). 되돌릴 수 없다.
router.delete('/checklist/:weekId/items/:itemKey', (req, res) => {
  try {
    checklistItems.removeItem(getDB(), Number(req.params.weekId), req.params.itemKey)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 코치진 질문 (CRUD) ────────────────────────────────────────────
router.get('/questions', (req, res) => {
  try {
    const db = getDB()
    res.json({ items: db.prepare('SELECT * FROM coach_questions ORDER BY sort_order ASC, id ASC').all() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/questions', (req, res) => {
  try {
    const { question, context, sort_order } = req.body
    if (!question) return res.status(400).json({ error: 'question은 필수입니다.' })
    const db = getDB()
    const r = db.prepare(`
      INSERT INTO coach_questions (question, context, sort_order, created_at) VALUES (?, ?, ?, ?)
    `).run(question, context ?? '', sort_order ?? 0, new Date().toISOString())
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/questions/:id', (req, res) => {
  try {
    const { question, context, sort_order } = req.body
    const db = getDB()
    db.prepare('UPDATE coach_questions SET question = ?, context = ?, sort_order = ? WHERE id = ?')
      .run(question, context ?? '', sort_order ?? 0, req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/questions/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM coach_questions WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 유사사례 (CRUD) ───────────────────────────────────────────────
router.get('/cases', (req, res) => {
  try {
    const db = getDB()
    res.json({ items: db.prepare('SELECT * FROM similar_cases ORDER BY sort_order ASC, id ASC').all() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/cases', (req, res) => {
  try {
    const { title, description, source_label, source_url, sort_order } = req.body
    if (!title || !description) return res.status(400).json({ error: 'title, description은 필수입니다.' })
    const db = getDB()
    const r = db.prepare(`
      INSERT INTO similar_cases (title, description, source_label, source_url, sort_order) VALUES (?, ?, ?, ?, ?)
    `).run(title, description, source_label ?? '', source_url ?? '', sort_order ?? 0)
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/cases/:id', (req, res) => {
  try {
    const { title, description, source_label, source_url, sort_order } = req.body
    const db = getDB()
    db.prepare('UPDATE similar_cases SET title = ?, description = ?, source_label = ?, source_url = ?, sort_order = ? WHERE id = ?')
      .run(title, description, source_label ?? '', source_url ?? '', sort_order ?? 0, req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/cases/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM similar_cases WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 참고문헌 (CRUD) ───────────────────────────────────────────────
router.get('/references', (req, res) => {
  try {
    const db = getDB()
    res.json({ items: db.prepare('SELECT * FROM brief_references ORDER BY sort_order ASC, id ASC').all() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/references', (req, res) => {
  try {
    const { label, detail, url, sort_order } = req.body
    if (!label) return res.status(400).json({ error: 'label은 필수입니다.' })
    const db = getDB()
    const r = db.prepare(`
      INSERT INTO brief_references (label, detail, url, sort_order) VALUES (?, ?, ?, ?)
    `).run(label, detail ?? '', url ?? '', sort_order ?? 0)
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/references/:id', (req, res) => {
  try {
    const { label, detail, url, sort_order } = req.body
    const db = getDB()
    db.prepare('UPDATE brief_references SET label = ?, detail = ?, url = ?, sort_order = ? WHERE id = ?')
      .run(label, detail ?? '', url ?? '', sort_order ?? 0, req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/references/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM brief_references WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 로드맵(맨 위 4주 간트) — settings 키 재사용, 클릭으로 상태 순환 ──
router.get('/roadmap', (req, res) => {
  try {
    const db = getDB()
    const v = rawSetting(db, 'roadmap_weeks')
    res.json({ weeks: v ? JSON.parse(v) : [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/roadmap', (req, res) => {
  try {
    const { weeks } = req.body
    if (!Array.isArray(weeks)) return res.status(400).json({ error: 'weeks는 배열이어야 합니다.' })
    setSetting(getDB(), 'roadmap_weeks', JSON.stringify(weeks))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
module.exports.startNewWeek = startNewWeek
module.exports.upsertChecklistEntry = upsertChecklistEntry
module.exports.checklistItems = checklistItems
module.exports.SCORE_KEYS = SCORE_KEYS
