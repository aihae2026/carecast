// 방송 흐름(순서) 만들기 — 재사용 가능한 이름 붙은 TTS/BGM/음원/차임벨/대기 블록 시퀀스.
// 저장은 항상 "이름 + 전체 단계 배열"을 통째로 받아 기존 단계를 지우고 다시 넣는 방식(전체
// 교체) — FlowBuilder.jsx가 배열 전체를 들고 있다가 저장 버튼 한 번에 보내는 구조와 맞춘다.
const router = require('express').Router()
const { getDB } = require('../db/schema')

// 'group'은 소리를 내지 않는 '묶음 머리글'이다 — 목록을 폴더처럼 나눠 보기 위한 라벨이며
// 실행기는 그냥 넘어간다. 묶음을 새 테이블로 만들지 않고 단계 하나로 둔 이유는 flow-groups.test.js 참고.
// 영상은 'video_file'(이 PC 에 올린 영상) 하나다. 예전의 'video'(외부 TV 송출)는 2026-09-21
// 걷어냈다(사용자 결정 — 저장된 단계는 부팅 보정이 보관한 뒤 지운다). 새로 저장하는 것도 막는다.
const VALID_STEP_TYPES = ['tts', 'bgm', 'audio', 'chime', 'delay', 'video_file', 'group']

function loadFlowWithSteps(db, id) {
  const flow = db.prepare('SELECT * FROM flow_sequences WHERE id = ?').get(id)
  if (!flow) return null
  const steps = db.prepare('SELECT * FROM flow_sequence_steps WHERE flow_sequence_id = ? ORDER BY sort_order ASC')
    .all(id)
    .map(s => ({ ...s, config: JSON.parse(s.config || '{}') }))
  return { ...flow, steps }
}

// 단계의 예약 시각(config.at_time)은 'HH:MM'만 받는다. 이 값이 이상하면 flowRunner가
// 조용히 무시하도록 만들어 뒀지만(잘못 적은 값이 방송을 끊으면 안 되므로), 저장하는
// 자리에서는 되묻는 게 낫다 — 사람은 시각을 넣었다고 믿고 있을 테니까.
const AT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '최소 한 단계 이상 필요합니다.'
  for (const s of steps) {
    if (!VALID_STEP_TYPES.includes(s.step_type)) return `유효하지 않은 단계 유형: ${s.step_type}`
    const at = s.config?.at_time
    if (at && !AT_TIME_RE.test(String(at))) return `예약 시각은 시:분 형식이어야 합니다 (입력값: ${at})`
  }
  // 묶음은 목록을 나누는 라벨일 뿐 소리를 내지 않는다. 묶음만 있는 흐름은 저장은 되는데
  // 방송 시각에 아무 일도 안 일어난다 — 가장 알아채기 어려운 실패라 저장 자체를 막는다.
  // (화면도 같은 검사를 하지만, API로 직접 저장하는 경로까지 같은 규칙이어야 한다.)
  if (!steps.some(s => s.step_type !== 'group')) return '묶음 말고 실제로 방송할 단계를 최소 하나 넣어주세요.'
  // 파일을 고르는 유형은 고르지 않으면 그 단계가 통째로 조용히 건너뛰어진다 — 같은 이유로
  // 저장에서 막는다. 예전엔 화면(FlowBuilder)만 검사해서 API로 넣으면 통과했고, 새로 연
  // video_file은 화면에도 없었다(2026-09-03 레드 검증 발견4).
  const NEEDS_FILE = { audio: '음원', video_file: '업로드 영상' }
  for (const s of steps) {
    if (NEEDS_FILE[s.step_type] && !s.config?.audio_file_id
        && !(Array.isArray(s.config?.playlist) && s.config.playlist.length)) {
      return `${NEEDS_FILE[s.step_type]} 단계에 재생할 파일을 선택해주세요.`
    }
  }
  return null
}

// **안내 음성 단계의 문안도 개인정보 검사를 거친다**(전문가 1차 검토 4-1). 예약·즉시 방송은 저장·발송
// 때 `checkSensitive` 를 지나는데, 직접 만든 방송 순서의 TTS 문안만 빠져 있어 전화번호·주민번호가 그대로
// 저장되고 매일 방송될 수 있었다(Azure 엔진이면 외부로도 나간다). 차단 항목은 400, 이름 등 확인 항목은
// 409 로 되묻는다 — 화면은 `putWithConfirm`/`postWithConfirm` 이 확인창을 띄워 한 번 더 보낸다.
// 실행 직전에도 한 번 더 본다(flowRunner) — 이 검사 전에 저장된 흐름이 있다.
function checkFlowText(steps, acknowledged) {
  const 문안 = (Array.isArray(steps) ? steps : [])
    .filter(s => s?.step_type === 'tts')
    .map(s => String(s.config?.content ?? '').trim())
    .filter(Boolean)
  if (!문안.length) return { ok: true }
  const { checkSensitive } = require('../services/sensitiveInfo')
  return checkSensitive(문안.join('\n'), { acknowledged: !!acknowledged, verb: '저장' })
}

function replaceSteps(db, flowId, steps) {
  db.prepare('DELETE FROM flow_sequence_steps WHERE flow_sequence_id = ?').run(flowId)
  const insert = db.prepare(`
    INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config)
    VALUES (?, ?, ?, ?, ?)
  `)
  steps.forEach((s, i) => {
    insert.run(flowId, i, s.step_type, s.label || '', JSON.stringify(s.config || {}))
  })
}

// 목록에서 이름이 겹치면 어느 것을 예약에 걸었는지 고를 수 없다. 표에 UNIQUE 제약은
// 없으므로(기존 스키마를 안 건드린다) 여기서 비켜 간다.
// 이미 "(복사본)"인 이름을 다시 복제할 때 "(복사본) (복사본)"이 되지 않도록 꼬리를 떼고 센다.
const COPY_SUFFIX_RE = / \(복사본(?: \d+)?\)$/

function uniqueFlowName(db, wanted) {
  const taken = (name) => !!db.prepare('SELECT id FROM flow_sequences WHERE name = ?').get(name)
  if (!taken(wanted)) return wanted
  const base = wanted.replace(COPY_SUFFIX_RE, '')
  if (!taken(`${base} (복사본)`)) return `${base} (복사본)`
  let n = 2
  while (taken(`${base} (복사본 ${n})`)) n++
  return `${base} (복사본 ${n})`
}

/**
 * 흐름을 통째로 복사한다. 원본은 **읽기만** 한다.
 *
 * 단계는 참조를 옮기지 않고 **새 행으로 다시 넣는다.** 행을 공유하면 복사본을 고쳤을 때
 * 매일 저절로 나가는 원본 방송이 함께 바뀌고, 사람은 방송이 이상하게 나간 다음에야 안다.
 *
 * @param {string} [newName] 사람이 지정한 이름. 비우면 "원래이름 (복사본)".
 * @returns {number|null} 새 흐름 id. 원본이 없으면 null(아무것도 만들지 않는다).
 */
function duplicateFlow(db, id, newName) {
  const src = loadFlowWithSteps(db, id)
  if (!src) return null

  const wanted = String(newName ?? '').trim() || `${src.name} (복사본)`
  const now = new Date().toISOString()
  const copyId = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(uniqueFlowName(db, wanted), now, now).lastInsertRowid
  replaceSteps(db, copyId, src.steps)
  return copyId
}

// 흐름을 삭제 — 사용 중인 예약이 있으면 삭제하지 않고 사유를 반환한다(성공 시 null).
function deleteFlow(db, flowId) {
  const inUse = db.prepare('SELECT title FROM schedules WHERE flow_sequence_id = ?').all(flowId)
  if (inUse.length > 0) {
    const titles = inUse.map(s => s.title).join(', ')
    return `이 흐름을 사용 중인 예약이 ${inUse.length}건 있습니다 (${titles}). 먼저 예약을 수정하거나 삭제하세요.`
  }
  db.prepare('DELETE FROM flow_sequence_steps WHERE flow_sequence_id = ?').run(flowId)
  db.prepare('DELETE FROM flow_sequences WHERE id = ?').run(flowId)
  return null
}

// GET /api/flows — 목록(이름 + 단계 수)
router.get('/', (req, res) => {
  try {
    const db = getDB()
    const rows = db.prepare(`
      -- 묶음 머리글은 소리를 내지 않으므로 "N단계"에서 뺀다. 안 그러면 실제로 3단계짜리
      -- 흐름이 묶음 2개 때문에 5단계로 보인다.
      SELECT f.*, (SELECT COUNT(*) FROM flow_sequence_steps
                   WHERE flow_sequence_id = f.id AND step_type != 'group') AS step_count
      FROM flow_sequences f ORDER BY f.updated_at DESC
    `).all()
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/flows/:id/estimate — 이 흐름을 틀면 얼마나 걸리고 **무엇이 빠지나**.
// 자동방송은 설정에서 단계를 읽고 흐름은 이 표에서 읽으므로 창구가 따로 필요하다.
// **계산은 자동방송과 같은 함수를 쓴다**(domain/broadcastEstimate) — 규칙을 두 벌 적으면
// 한쪽만 고쳐진 순간 화면 숫자가 갈라진다. 2026-08-31에 실제로 그렇게 어긋났다.
router.get('/:id/estimate', (req, res) => {
  try {
    const db = getDB()
    const flow = loadFlowWithSteps(db, req.params.id)
    if (!flow) return res.status(404).json({ error: '흐름을 찾을 수 없습니다.' })

    const { estimateBroadcastDuration } = require('../domain/broadcastEstimate')

    // 재생목록이 가리키는 파일의 존재·길이를 함께 넘긴다. 이게 없으면 계산은 곡마다
    // 상한(3분)으로만 답한다. 단계마다 조회하지 않고 **한 번에** 읽는다.
    // (BGM 단계의 playlist는 id가 아니라 곡 정보 객체라 Number()에서 걸러진다.)
    const ids = new Set()
    for (const st of flow.steps) {
      const c = st.config || {}
      const list = Array.isArray(c.playlist) && c.playlist.length
        ? c.playlist
        : (c.audio_file_id ? [c.audio_file_id] : [])
      for (const v of list) {
        const n = Number(v)
        if (Number.isInteger(n)) ids.add(n)
      }
    }
    const audioFiles = {}
    if (ids.size) {
      const arr = [...ids]
      const rows = db.prepare(
        `SELECT id, duration FROM audio_files WHERE id IN (${arr.map(() => '?').join(',')})`
      ).all(...arr)
      const found = new Map(rows.map(r => [r.id, r]))
      // 지워진 파일은 **없음**으로 넘겨야 0초가 된다 — 실행부의 `if (!file) continue`와 같다.
      for (const n of arr) {
        const row = found.get(n)
        audioFiles[n] = row ? { exists: true, duration: row.duration } : { exists: false }
      }
    }

    res.json(estimateBroadcastDuration(flow.steps, { lane: 'flow', audioFiles }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/flows/:id — 단계 포함 상세
router.get('/:id', (req, res) => {
  try {
    const flow = loadFlowWithSteps(getDB(), req.params.id)
    if (!flow) return res.status(404).json({ error: '흐름을 찾을 수 없습니다.' })
    res.json(flow)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/flows — 새 흐름 생성
router.post('/', (req, res) => {
  try {
    const { name, steps } = req.body
    if (!name?.trim()) return res.status(400).json({ error: '흐름 이름을 입력해주세요.' })
    const stepsError = validateSteps(steps)
    if (stepsError) return res.status(400).json({ error: stepsError })
    const verdict = checkFlowText(steps, req.body?.ackWarnings)
    if (!verdict.ok) return res.status(verdict.status).json(verdict.body)

    const db = getDB()
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run(name.trim(), now, now)
    replaceSteps(db, result.lastInsertRowid, steps)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/flows/:id/duplicate — 흐름을 통째로 복사(이름은 선택)
router.post('/:id/duplicate', (req, res) => {
  try {
    const copyId = duplicateFlow(getDB(), req.params.id, req.body?.name)
    if (!copyId) return res.status(404).json({ error: '흐름을 찾을 수 없습니다.' })
    res.json({ ok: true, id: copyId })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/flows/:id — 이름 + 전체 단계 교체
router.put('/:id', (req, res) => {
  try {
    const { name, steps } = req.body
    if (!name?.trim()) return res.status(400).json({ error: '흐름 이름을 입력해주세요.' })
    const stepsError = validateSteps(steps)
    if (stepsError) return res.status(400).json({ error: stepsError })
    const verdict = checkFlowText(steps, req.body?.ackWarnings)
    if (!verdict.ok) return res.status(verdict.status).json(verdict.body)

    const db = getDB()
    const existing = db.prepare('SELECT id FROM flow_sequences WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: '흐름을 찾을 수 없습니다.' })

    db.prepare('UPDATE flow_sequences SET name = ?, updated_at = ? WHERE id = ?')
      .run(name.trim(), new Date().toISOString(), req.params.id)
    replaceSteps(db, req.params.id, steps)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/flows/:id — 사용 중인 예약이 있으면 거부
router.delete('/:id', (req, res) => {
  try {
    const inUseError = deleteFlow(getDB(), req.params.id)
    if (inUseError) return res.status(400).json({ error: inUseError })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
module.exports.loadFlowWithSteps = loadFlowWithSteps
module.exports.validateSteps = validateSteps
module.exports.checkFlowText = checkFlowText
module.exports.replaceSteps = replaceSteps
module.exports.duplicateFlow = duplicateFlow
module.exports.deleteFlow = deleteFlow
