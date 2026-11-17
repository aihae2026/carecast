const express = require('express')
const { getDB } = require('../db/schema')
// 날짜는 로컬(KST) 단일 출처를 쓴다. time을 로컬로 뽑으면서 date만 UTC로 뽑으면
// 09시 이전 기록이 전날에 붙고, SystemAlertBanner의 오늘자 복원이 어긋난다(CC-015).
const { todayStr, nowHHMMSS } = require('../services/repeatSchedule')
// 이력 값(0·1·2)의 뜻은 여기 한 곳에서만 정한다 — 진리값으로 보면 진행 중이 성공이 된다(P-6)
const { outcomeLabel } = require('../domain/broadcastOutcome')
const { csvCell } = require('../domain/csvCell')

const router = express.Router()

// 이력 거르기 — 날짜 범위·유형·성공여부. 화면과 CSV가 **같은 조건**을 쓴다.
//
// 왜 서버에서 거르나: 예전엔 최근 500건을 받아 화면에서 걸렀다. 보관 기간이 1년이 되면
// 500건 밖의 것은 아무리 걸러도 안 나온다 — "작년 이맘때 뭘 틀었나"에 답하지 못한다.
// 조건을 서버에 두면 내보내기(CSV)도 화면과 같은 것을 낸다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function buildFilter(q = {}) {
  const where = []
  const args  = []
  if (DATE_RE.test(String(q.from || ''))) { where.push('date >= ?'); args.push(q.from) }
  if (DATE_RE.test(String(q.to   || ''))) { where.push('date <= ?'); args.push(q.to) }
  // ── 종류 거르기는 **통계와 같은 묶음**으로 받는다 (사용자 지적 2026-09-13) ──────
  // 화면 칩이 열셋이었다(TTS·마이크·차임벨·BGM·자동·예약·AI·특보·경보·시스템·즉시·즐겨찾기).
  // 그런데 **바로 위 통계는 다섯 칸**(즉시방송·TTS·BGM·자동방송·오류)이라, 칩으로 거른
  // 결과와 통계 숫자가 서로 다른 축이었다 — 같은 화면에서 두 가지로 세고 있었다.
  // 게다가 그중 셋('즉시'·'즐겨찾기'·'AI')은 **아무도 안 적는 낱말**이라 눌러도 늘 0건이었다.
  //
  // 이제 `instant`·`tts`·`bgm`·`auto` 라는 **묶음 이름**을 받고, 그 묶음이 어떤 낱말을
  // 담는지는 `domain/broadcastRecord.js` 의 `종류칸` 하나가 정한다(통계도 그것을 본다).
  // 낱말 하나를 그대로 주는 옛 방식도 계속 받는다 — 저장해 둔 링크·CSV 주소가 죽지 않는다.
  if (q.type && q.type !== '전체') {
    const 묶음 = 종류칸[String(q.type)]
    if (묶음?.length) {
      where.push(`type IN (${묶음.map(() => '?').join(',')})`)
      args.push(...묶음)
    } else {
      where.push('type = ?'); args.push(String(q.type))
    }
  }
  // '성공만'·'실패만'. 값이 없으면 둘 다 준다 — 실패를 기본으로 감추면 그게 블랙박스다.
  if (q.success === '1' || q.success === '0') { where.push('success = ?'); args.push(Number(q.success)) }
  const sql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  return { sql, args }
}

// GET /api/broadcasts — 방송 로그 목록 (최신순). from·to·type·success로 거른다.
const { 오류수, 종류별집계, 종류칸 } = require('../domain/broadcastRecord')

router.get('/', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 5000)
    const f = buildFilter(req.query)
    const rows = getDB()
      .prepare(`SELECT * FROM broadcasts${f.sql} ORDER BY id DESC LIMIT ?`)
      .all(...f.args, limit)
    res.json(rows)
  } catch (err) {
    console.error('[broadcasts/GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/export.csv — 같은 조건으로 파일 하나. 심사·감사 때 기간을 통째로 낸다.
//
// **BOM을 붙인다.** 없으면 엑셀이 CP949로 읽어 한글이 깨진다 — 받는 사람이 열자마자 만나는 문제다.
router.get('/export.csv', (req, res) => {
  try {
    const f = buildFilter(req.query)
    const rows = getDB()
      .prepare(`SELECT date, time, type, content, user, target, success, prep_ms FROM broadcasts${f.sql} ORDER BY id DESC LIMIT 50000`)
      .all(...f.args)

    // 큰따옴표로 감싸고, `=`·`+`·`-`·`@` 로 시작하는 글자 칸은 엑셀이 수식으로 읽지 않게
    // 막는다 — 규칙은 domain/csvCell.js 한 곳(전문가 1차 검토 1-4).
    const cell = csvCell
    const head = ['날짜', '시각', '유형', '내용', '담당', '대상', '결과', '준비(초)']
    const lines = [head.map(cell).join(',')]
    for (const r of rows) {
      lines.push([r.date, r.time, r.type, r.content, r.user, r.target,
        // 진리값으로 보면 진행 중(RUNNING=2)이 truthy 라 "성공"으로 나간다 — P-6.
        // 상태 뜻은 domain/broadcastOutcome.js 한 곳에서만 정한다.
        outcomeLabel(r.success),
        // 발사에서 소리 지시까지. 안 잰 행(옛 기록·TTS 아닌 유형)은 빈칸으로 둔다
        // 숫자로 넘긴다 — 글자로 넘기면 엑셀에서 더할 수 없다.
        Number.isFinite(r.prep_ms) ? Number((r.prep_ms / 1000).toFixed(1)) : ''].map(cell).join(','))
    }
    // 파일 이름 날짜도 KST 단일 출처를 쓴다 — UTC로 뽑으면 오전 9시 이전에 받은 파일이
    // 전날 이름을 달고 나간다(CC-015와 같은 함정. date-timezone.test.js가 지킨다)
    const stamp = todayStr()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="carecast-broadcasts-${stamp}.csv"`)
    // BOM은 escape로 적는다 — 실제 바이트로 넣으면 눈에도 diff에도 안 보인다(CLAUDE.md)
    res.send('\uFEFF' + lines.join('\r\n'))
  } catch (err) {
    console.error('[broadcasts/export]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/summary?year=YYYY&month=M — 월별 유형별 방송 통계
router.get('/summary', (req, res) => {
  try {
    const now    = new Date()
    const year   = parseInt(req.query.year)  || now.getFullYear()
    const month  = parseInt(req.query.month) || (now.getMonth() + 1)
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const db = getDB()
    // **칸 정의와 질의는 `domain/broadcastRecord.종류별집계` 한 곳에 있다**(UX-34).
    // 예전엔 이 세 줄이 여기 있고 `routes/status.js` 에도 따로 있었는데 **이미 서로 달랐다** —
    // 여기 instant 는 '즉시','차임벨','즐겨찾기','AI' 였고 저기는 '즉시' 하나였다.
    // 같은 달의 같은 이력을 두 화면이 다르게 셌다. FP-0005 그대로다.
    const 칸 = 종류별집계(db, prefix)
    const tts       = 칸.tts
    const instant   = 칸.instant
    const bgm       = 칸.bgm
    const scheduled = 칸.auto
    // ── P-31: **밀림은 오류가 아니다** ────────────────────────────────
    // 밀림(다른 방송이 앞 소리를 밀어냄)은 이력에 `success = 0` 으로 남는다 —
    // ISSUE-010 의 사용자 결정(2026-09-07)이 "이력에는 남기고 배너는 안 띄운다"였다.
    // 그런데 이 카드가 그것까지 세서, **수동재생으로 정시 방송을 앞당길 때마다 오류가 1씩
    // 올랐다.** 배너는 조용한데 숫자만 오르니 "화면은 조용하다"가 절반만 참이었다.
    // 문구는 `domain/broadcastRecord.js` 단일 출처를 쓴다 — 네 자리가 같은 것을 본다.
    // **질의는 `domain/broadcastRecord.오류수` 한 곳에 있다**(P-97). 여기와 status.js 가
    // 같은 질의를 각자 들고 있었고, 사유를 더하면서 한쪽만 고쳤다 — 가드가 잡았다.
    const error    = 오류수(db, `${year}-${String(month).padStart(2, '0')}`)
    // `bgm`·`autoOnly`·`scheduledOnly` 는 새로 더한 칸이다. 옛 이름(tts·instant·scheduled)은
    // 쉬운화면 월간통계가 아직 읽으므로 **그대로 둔다** — 지우면 그 화면이 빈칸이 된다.
    res.json({
      year, month, tts, instant, bgm, scheduled, error,
      autoOnly: 칸.autoOnly, scheduledOnly: 칸.scheduledOnly,
      total: tts + instant + bgm + scheduled,
    })
  } catch (err) {
    console.error('[broadcasts/summary]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/monthly?year=YYYY&month=M — 월별 날짜별 방송 횟수
router.get('/monthly', (req, res) => {
  try {
    const now   = new Date()
    const year  = parseInt(req.query.year)  || now.getFullYear()
    const month = parseInt(req.query.month) || (now.getMonth() + 1)
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const rows = getDB().prepare(
      "SELECT date, COUNT(*) as cnt FROM broadcasts WHERE date LIKE ? AND success = 1 GROUP BY date ORDER BY date"
    ).all(`${prefix}-%`)
    const result = {}
    for (const row of rows) { result[row.date] = row.cnt }
    res.json(result)
  } catch (err) {
    console.error('[broadcasts/monthly]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/broadcasts — 방송 로그 수동 저장 (즉시 방송, 차임벨 등)
router.post('/', (req, res) => {
  const { type, content, user = '방송담당', target = '전체', success = 1 } = req.body
  try {
    const db  = getDB()
    const now  = new Date()
    const date = todayStr(now)
    const time = nowHHMMSS(now)   // 이력은 초까지 — 스케줄러의 nowHHMM 과 다른 함수다
    const result = db.prepare(
      'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(date, time, type, content, user, target, success)
    res.status(201).json({ id: result.lastInsertRowid })
  } catch (err) {
    console.error('[broadcasts/POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/broadcasts?before=YYYY-MM-DD — 그 날짜 **이전** 이력만 지운다.
//
// 예전엔 인자 없이 전체를 지웠다(`DELETE FROM broadcasts`). CCTV로 치면 녹화본 전체 삭제
// 버튼에 흔적이 하나도 없는 것이다 — 지운 뒤에는 그것이 정리인지 사고인지 알 길이 없었다.
// 그래서 기준 날짜를 반드시 받고, 무엇을 몇 건 지웠는지 남긴다(docs/db-retention-design.md).
router.delete('/', (req, res) => {
  const before = String(req.query.before || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return res.status(400).json({
      error: '지울 기준 날짜가 필요합니다 (before=YYYY-MM-DD). 전체 삭제는 없앴습니다.',
    })
  }
  try {
    const db = getDB()
    // 날짜가 비어 있는 행은 건드리지 않는다 — 나이를 모르는 행을 지우면 무엇이 사라졌는지 모른다
    const removed = Number(db.prepare(
      'DELETE FROM broadcasts WHERE date IS NOT NULL AND date < ?'
    ).run(before).changes)

    require('../services/retention').recordManualPurge(db, {
      at: new Date().toISOString(), before, removed, by: '사람',
    })
    console.log(`[보관] 사람이 ${before} 이전 이력 ${removed}건 삭제`)

    res.json({ ok: true, removed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/steps?run=아침-12 — 방송 한 편이 어느 단계까지 갔나(0021).
// run을 안 주면 최근 것들을 준다. 화면이 이력 한 줄을 펼칠 때 읽는다.
router.get('/steps', (req, res) => {
  try {
    const H = require('../domain/stepHistory')
    const db = getDB()
    res.json({ items: req.query.run ? H.stepsOf(db, String(req.query.run)) : H.recent(db, req.query.limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/settings-history — 설정을 누가 언제 무엇에서 무엇으로 바꿨나(0020).
// 방송 이력과 같은 화면에서 보는 것이 맞다 — "그날 무슨 일이 있었나"를 물을 때 방송과 설정
// 변경은 같이 봐야 한다. 비밀키는 값이 '(가려짐)'으로 들어와 있다.
router.get('/settings-history', (req, res) => {
  try {
    res.json({ items: require('../domain/settingsHistory').recent(getDB(), req.query.limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/broadcasts/retention — 마지막 정리·수동 삭제 기록. "지웠다는 사실"을 화면이 읽는 곳.
router.get('/retention', (req, res) => {
  try {
    const db = getDB()
    const r = require('../services/retention')
    res.json({ ...r.lastRun(db), policy: r.policyFor(db), manual: r.manualPurges(db) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
