// 예약 방송 CRUD API
const { rawSetting } = require('../domain/settingsRead')
const express = require('express')
const { getDB } = require('../db/schema')
const { fireSchedule, queueSchedulePrewarm } = require('../services/scheduler')
const { deriveLegacyRepeatType, todayStr, shouldRunToday } = require('../services/repeatSchedule')
const { AUTO_BROADCASTS, autoTime } = require('../domain/autoBroadcasts')
const { buildTodayView }  = require('../domain/todaySchedule')
const { needsAudioFile, isKnownBroadcastType } = require('../domain/ontology')
const { findBrokenField, brokenTextMessage } = require('../domain/text')
const { broadcastSSE } = require('../services/sse')

/**
 * **예약이 바뀌었다고 모든 화면에 알린다** (P-16, 2026-09-11).
 *
 * 요양원은 현장 PC·직원 폰·관리자 화면을 **동시에** 본다. 전에는 이 파일이 `broadcastSSE` 를
 * **한 번도 안 불렀다** — 한 곳에서 예약을 지워도 다른 곳은 **새로고침해야만** 알았다.
 * 사람은 지웠다고 믿고 화면은 있다고 말한다. 그 사이에 정시가 오면 무엇이 나갈지는
 * 서버가 정하지만(서버는 DB 를 본다), **사람이 보는 것과 나가는 것이 갈린다.**
 *
 * [FACT] EV-003993 — SSE 27종에 예약 변경이 없었다(`favorites_updated` 는 있는데 예약만 빠졌다).
 * 실제 두 탭으로 재현: 탭 B 에서 지웠는데 **탭 A 는 10초 뒤에도 그대로 보여줬다.**
 *
 * 방식은 **이미 있는 것**을 그대로 따른다 — `routes/favorites.js` 의 `favorites_updated`.
 * 새 방식을 만들지 않는다.
 *
 * `by` 는 **누가 바꿨는지**다. 바꾼 화면은 이미 자기 상태를 고쳤으므로, 그 화면까지
 * 다시 읽으면 깜빡인다. 받는 쪽이 자기 것이면 건너뛸 수 있게 실어 보낸다.
 *
 * @param {string} 무엇 'created' | 'updated' | 'toggled' | 'deleted'
 * @param {object} 더  id 등 받는 쪽이 알면 좋은 것
 */
function 예약바뀜(req, 무엇, 더 = {}) {
  try {
    broadcastSSE('schedules_updated', {
      what: 무엇,
      // 화면이 보낸 탭 id. 없으면 null — 그때는 모두가 다시 읽는다(안전한 쪽).
      by: req?.get?.('x-carecast-tab') || null,
      ...더,
    })
  } catch (e) {
    // **알림 실패가 저장을 되돌리지 않는다.** 저장은 이미 끝났고, 못 받은 화면은
    // 예전처럼 새로고침으로 따라온다 — 고치기 전 상태로 돌아갈 뿐이다.
    console.error('[예약 SSE]', e.message)
  }
}
// 저장(INSERT)과 정규화 규칙은 scheduleDrafts.js(AI 예약 승인)와 공유하므로 services/에 있다.
// 구버전 DB의 repeat_broadcast ALTER 가드도 scheduleStore가 로드 시점에 함께 돌린다.
const {
  insertSchedule, MANAGED_BY_AI, MANAGED_BY_VALUES,
  isVolumeLike, normalizeBgmVolume, normalizePlaybackRate, RATE_MIN, RATE_MAX,
} = require('../services/scheduleStore')

const router = express.Router()

function invalidManagedBy(value) {
  if (value === null || value === undefined || value === '') return false
  return !MANAGED_BY_VALUES.includes(value)
}

// 발동 조건 값 검증 — 형식이 어긋난 값이 저장되면 "등록은 됐는데 영원히 발동하지 않는 예약"이
// 만들어진다(스케줄러는 scheduled_time을 현재 HH:MM과 문자열 비교하므로 '99:99'는 절대 일치하지
// 않고, repeat_weekdays가 요일 배열이 아니면 실행 요일 판정에서 걸러진다).
// 직원 입장에선 원인을 알 수 없는 조용한 실패라 저장 단계에서 막는다.
// 문제가 있으면 응답을 보내고 true를 반환 — 호출부는 곧바로 return 한다.
function invalidScheduleFields(body, res) {
  const time = body?.scheduled_time
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    res.status(400).json({ error: '방송 시간이 올바르지 않습니다. (예: 09:30)' })
    return true
  }

  // ── 날짜도 같은 구멍이다 (2026-09-17 브라우저 전수 시험) ──────────────────────────────────
  // 없는 날(2026-13-45·2월 30일)이나 종료일이 시작일보다 앞인 예약은 **저장은 되는데 영원히 안 나간다.**
  // 스케줄러는 날짜를 'YYYY-MM-DD' 글자로 비교하므로 형식도 그 모양이어야 한다. 종료일은 비워도 된다.
  const 진짜날짜 = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  }
  const 시작일 = body?.repeat_start_date
  const 종료일 = body?.repeat_end_date
  if (시작일 !== undefined && 시작일 !== null && 시작일 !== '' && !진짜날짜(시작일)) {
    res.status(400).json({ error: '반복 시작일이 올바른 날짜가 아닙니다. (예: 2026-09-20)' })
    return true
  }
  if (종료일 !== undefined && 종료일 !== null && 종료일 !== '') {
    if (!진짜날짜(종료일)) {
      res.status(400).json({ error: '반복 종료일이 올바른 날짜가 아닙니다. (예: 2026-09-30)' })
      return true
    }
    if (진짜날짜(시작일) && 종료일 < 시작일) {
      res.status(400).json({ error: '반복 종료일이 시작일보다 앞입니다 — 이대로면 방송이 한 번도 안 나갑니다.' })
      return true
    }
  }

  const days = body?.repeat_weekdays
  if (days !== undefined) {
    if (!Array.isArray(days)) {
      res.status(400).json({ error: '반복 요일 형식이 올바르지 않습니다.' })
      return true
    }
    if (!days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      res.status(400).json({ error: '반복 요일은 0(일)~6(토) 사이의 값이어야 합니다.' })
      return true
    }
  }
  return false
}

// 예약 내용 민감정보 검사 — 저장 시점에 막는다(예약은 나중에 자동으로 나가므로,
// 발동 시점엔 아무도 안 보고 있어서 저장 단계에서 걸러야 한다).
// 걸리면 응답을 보내고 true를 반환 — 호출부는 곧바로 return 한다.
function blockedBySensitiveInfo(req, res) {
  const { checkSensitive } = require('../services/sensitiveInfo')
  const verdict = checkSensitive(req.body?.content, {
    acknowledged: !!req.body?.ackWarnings, verb: '저장',
  })
  if (verdict.ok) return false
  res.status(verdict.status).json(verdict.body)
  return true
}

// POST /api/schedules/parse-phrase — 자연어 한 문장을 예약 초안으로 바꿔서 돌려준다.
// 저장은 하지 않는다. 화면이 이 결과로 "예약 추가" 모달을 채운 채 열고, 사람이 확인·수정한
// 뒤에 저장한다(시간·요일을 잘못 읽으면 엉뚱한 시각에 방송이 나가므로 자동 저장은 하지 않음).
//
// 2026-09-06 — **여기도 AI 보강을 받는다.** 예전에는 규칙만 썼고, AI 는 다른 입력창
// (쉬운 화면 TTS 카드의 AI 패널)에만 붙어 있었다. 겉보기에 같은 "문장으로 예약하기"가
// 두 곳인데 **더 눈에 띄는 쪽(여기)이 AI 를 안 쓰는 쪽**이라 사람이 헷갈렸다(실제로 겪었다).
//
// 순서는 **규칙 먼저**다. 규칙은 밀리초, 제미나이는 10.5초([FACT] EV-000755)이고
// 현장 말투는 규칙이 이미 정확히 읽는다. AI 는 **규칙이 시각을 못 읽었을 때만** 부른다.
router.post('/parse-phrase', async (req, res) => {
  try {
    const text = req.body?.text
    // 문자열이 아닌 값(숫자·배열·객체)이 오면 .trim()에서 터져 500이 났다 — 400으로 안내한다
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '문장을 입력해주세요.' })
    }
    // 흐름 이름·일과방송 시각·볼륨 정성어를 넘긴다. 파서 자체는 DB를 모르게 두려고
    // 밖에서 읽어 주입한다 — 읽는 자리는 domain/phraseContext.js 한 곳이다.
    const db = getDB()
    const context = require('../domain/phraseContext').readPhraseContext(db)

    // 규칙 먼저, 못 읽으면 AI. 두 입력창이 **같은 함수**를 쓴다(scheduleDrafts.js 와 동일).
    const { parseWithFallback, viaLabel } = require('../services/llmGateway')
    const { rawSetting } = require('../domain/settingsRead')
    const apiKey = rawSetting(db, 'gemini_api_key')
    const model  = require('../domain/geminiModel').currentGeminiModel(db)

    const t0 = Date.now()
    const r = await parseWithFallback({
      text, context, now: new Date(),
      callApi: apiKey
        ? ((t) => require('../services/geminiSchedule').parseWithGemini(t, apiKey, model))
        : null,
    })
    console.log(`[문장예약] ${viaLabel(r.via)}(${Date.now() - t0}ms)` + (r.reason ? ` — ${r.reason}` : ''))

    // 화면은 지금까지와 **같은 모양**을 받는다 — 규칙 파서의 원본 결과다.
    // AI 가 시각을 읽었으면 그 값만 덮어써져 있고 나머지(반복·볼륨·흐름)는 규칙 것이다.
    const result = { ...r.raw, via: r.via, via_label: viaLabel(r.via), via_reason: r.reason }
    // 시각을 못 읽으면 09:00 기본값이 들어간다 — 사람이 고칠 수 있으니 막지는 않되,
    // 성공률 측정을 위해 남긴다. 응답은 지금까지와 똑같다(기록은 부수효과일 뿐).
    if ((result.ambiguous || []).includes('time_missing')) {
      const { FAILURE_REASONS, SOURCES, recordParseFailure } = require('../services/parseFailures')
      recordParseFailure({
        raw_input: text.trim(), reason: FAILURE_REASONS.TIME_MISSING, source: SOURCES.RULE,
      })
    }
    res.json(result)
  } catch (err) {
    console.error('[schedules/parse-phrase]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/schedules — 전체 예약 목록 (시간순 정렬)
router.get('/', (req, res) => {
  try {
    const rows = getDB().prepare('SELECT * FROM schedules ORDER BY scheduled_time ASC').all()
    res.json(rows)
  } catch (err) {
    console.error('[schedules GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/schedules/ai — 자연어로 만든 예약만, 최근 것부터.
// "아까 등록한 거 취소해줘"가 무엇을 지울지 고르는 자리다. 일과방송(아침 방송·국민체조 등)은
// schedules 행이 아니라 settings 기반이라 애초에 여기 안 나오고, 자동방송 순서 편집기가
// 소유한 행(managed_by='morning_editor')과 사람이 손으로 만든 예약도 여기서 빠진다.
// '/ai'는 '/:id'보다 먼저 등록돼야 id='ai'로 잡히지 않는다.
// GET /api/schedules/today — 오늘 나갈 방송 전부(일과방송 + 예약)를 예정/완료/누락으로.
//
// 화면이 getSchedules()만 읽으면 일과방송 5종이 안 보인다(그것들은 settings로 돈다).
// 그래서 서버가 두 출처를 합쳐서 준다. 판정 유예는 watchdog과 같은 설정키를 쓴다 —
// 화면은 "누락"인데 경보는 안 오면 사람이 둘 다 안 믿게 된다.
//
// `/:id` 형태의 GET 라우트가 없으므로 경로가 겹치지 않는다(있었다면 이 줄이 먼저 와야 한다).
router.get('/today', (req, res) => {
  try {
    const db = getDB()

    const today = todayStr()
    const get = (k) => rawSetting(db, k) ?? null
    // 유예를 읽는 규칙도, 기본값도 **감시와 같은 것**을 쓴다(P-38). 예전엔 `|| 5` 를 여기
    // 따로 적어서 ① 0 을 저장하면 조용히 5 로 바뀌고 ② 감시의 기본값이 바뀌면 화면만 5 로
    // 남는 두 벌 문제가 있었다.
    const { 숫자설정 } = require('../domain/settingsRead')
    const { DEFAULT_GRACE_MIN, DEFAULT_RUN_GRACE_MIN } = require('../services/watchdog')
    const graceMin = 숫자설정(get('watchdog_grace_min'), DEFAULT_GRACE_MIN)
    // 시작만 하고 안 끝난 방송의 유예. **감시와 같은 키·같은 기본값을 받는다** — 이것을
    // 안 넘기던 동안 화면은 그런 방송을 하루 종일 「대기」로 뒀고, 감시는 60분 뒤
    // 「안 끝남」을 알렸다(현장 사고 2026-09-15).
    const runGraceMin = 숫자설정(get('watchdog_run_grace_min'), DEFAULT_RUN_GRACE_MIN)

    // scheduler.js와 같은 엄격 비교 — 꺼진 방송을 목록에 올리면 "안 나갔다"로 오해된다
    const autoTimes = AUTO_BROADCASTS
      .filter(spec => get(spec.enabledKey) === 'true')
      .map(spec => ({
        id:    spec.id,
        label: spec.label,
        time:  autoTime(get(spec.timeKey), spec),
        firedToday: get(spec.firedKey) === today,
        // 시작은 했는데 아직 안 끝난 방송을 "누락"으로 칠하지 않는다(watchdog.js와 같은 근거)
        startedToday: get(spec.startedKey) === today,
      }))
      // 시각을 비운 방송은 **꺼진 것이지 빠뜨린 것이 아니다** — 목록에 올리면 빨간 '누락'으로
      // 칠해진다. 현장 선생님이 매일 보는 화면이라 거짓 경고가 가장 비싸다(P-35).
      .filter(a => a.time)

    const schedules = db.prepare('SELECT * FROM schedules WHERE active = 1').all()
      .filter(schedule => shouldRunToday(schedule))
      .map(s => ({
        ...s, firedToday: s.last_fired === today,
        outcome: s.last_fired === today
          ? require('../domain/scheduleOutcome').readScheduleOutcome(db, s.id, today) : null,
      }))

    const items = buildTodayView({ autoTimes, schedules, graceMin, runGraceMin })
    const count = { pending: 0, done: 0, missed: 0, unknown: 0 }
    for (const it of items) count[it.status]++

    res.json({ date: today, graceMin, count, items })
  } catch (err) {
    console.error('[schedules/today]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/ai', (req, res) => {
  try {
    const rows = getDB()
      .prepare('SELECT * FROM schedules WHERE managed_by = ? ORDER BY id DESC')
      .all(MANAGED_BY_AI)
    res.json(rows)
  } catch (err) {
    console.error('[schedules GET /ai]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/schedules/ai/:id — AI가 만든 예약만 지운다.
// 일반 DELETE /:id는 어떤 행이든 지우므로 취소 경로는 반드시 이 라우트를 쓴다. "매일 아침
// 방송 다 지워줘" 같은 요청이 자동방송 순서 편집기의 행까지 쓸어가는 사고를 구조로 막는다.
router.delete('/ai/:id', (req, res) => {
  try {
    const row = getDB().prepare('SELECT id, managed_by FROM schedules WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '예약을 찾을 수 없습니다.' })
    if (row.managed_by !== MANAGED_BY_AI) {
      return res.status(403).json({ error: 'AI가 만든 예약만 이 경로로 취소할 수 있습니다.' })
    }
    getDB().prepare('DELETE FROM schedules WHERE id = ?').run(row.id)
    예약바뀜(req, 'deleted', { id: Number(req.params.id), draft: true })
    res.json({ ok: true })
  } catch (err) {
    console.error('[schedules DELETE /ai]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// 저장 전 검증 — 잘못된 값이 들어가면 방송 볼륨이 조용히 이상해진다.
// 비어 있는 것(= 시스템 기본값 사용)은 정상이다.
// 정규화 규칙(isVolumeLike 등)은 scheduleStore의 것을 그대로 본다 — 검증과 저장이
// 다른 기준을 들면 "검증은 통과했는데 저장이 지우는" 틈이 생긴다.
// 볼륨 판정은 domain/volume.js 한 곳을 쓴다 — 예약 저장과 볼륨 저장이 같은 답을 내야 한다
const { invalidVolumeValue: invalidBgmVolume } = require('../domain/volume')

// 저장 요청 검증 — 범위 밖 값은 조용히 자르지 않고 되묻는다(사람은 넣은 대로 될 거라 믿는다).
function invalidPlaybackRate(value) {
  if (value === null || value === undefined || value === '') return false
  if (!isVolumeLike(value)) return true
  const n = Number(value)
  return n < RATE_MIN || n > RATE_MAX
}

// 사람이 만든 BGM 폴더(`local_f<번호>`)가 **지금 있는지** — 없으면 저장을 막는다(2026-09-22). 고르개는 있는 폴더만
// 내놓지만, 지워진 폴더를 든 예약을 다시 저장하거나 API 로 직접 보내면 방송 때마다 대신 틀기 경보가 난다.
function BGM폴더확인(bgm_type, bgm_enabled, broadcast_type) {
  // BGM 을 실제로 깔 때만 본다(Codex 2026-09-22 Medium) — BGM 을 끈 예약은 고르개가 숨어 폴더를 바꿀 길이 없는데,
  // 그 폴더가 지워졌다고 제목·시간 수정까지 막혔다. 삭제 막기(readBgmFolderUsage)와 같은 조건이다.
  // 켬 판정은 **저장과 같은 규칙**(`bgm_enabled ? 1 : 0`, 참거짓)으로 한다 — 다르면 '0' 같은 값이 검사는 꺼짐, 저장은 켬이 된다(Codex 2회차).
  if (!bgm_enabled && broadcast_type !== 'bgm') return null
  const 곡 = require('../domain/bgmRoles').곡값(bgm_type)
  if (!곡 && require('../domain/bgmRoles').곡값인척(bgm_type)) return '배경음악 곡 값이 올바르지 않습니다 — 곡을 다시 골라 주세요.'
  if (곡) {
    const 곡있음 = getDB().prepare("SELECT 1 FROM audio_files WHERE id = ? AND category = 'bgm'").get(곡.fileId)
    return 곡있음 ? null : '고른 배경음악 곡이 없습니다 — 다른 곡을 골라 주세요.'
  }
  const p = require('../domain/bgmRoles').폴더값(bgm_type)
  if (!p) return null
  const 있음 = getDB().prepare("SELECT 1 FROM content_folders WHERE id = ? AND category = 'bgm'").get(p.folderId)
  return 있음 ? null : '고른 BGM 폴더가 없습니다 — 다른 폴더를 골라 주세요.'
}

// POST /api/schedules — 예약 추가
router.post('/', (req, res) => {
  const {
    title, content = '', broadcast_type = 'text', audio_file_id = null, flow_sequence_id = null,
    repeat_start_date,
  } = req.body
  if (!title?.trim() || !req.body.scheduled_time) {
    return res.status(400).json({ error: '제목과 시간은 필수입니다.' })
  }
  { const 문제 = BGM폴더확인(req.body.bgm_type, Boolean(req.body.bgm_enabled), broadcast_type); if (문제) return res.status(400).json({ error: 문제 }) }
  if (!repeat_start_date) {
    return res.status(400).json({ error: '반복시작일은 필수입니다.' })
  }
  // 깨진 글자(U+FFFD)는 그대로 두면 TTS가 소리 내어 읽는다. 저장 전에 막는다(domain/text.js).
  const brokenField = findBrokenField({ 제목: title, 내용: content })
  if (brokenField) return res.status(400).json({ error: brokenTextMessage(brokenField) })
  if (broadcast_type === 'text' && !content?.trim()) {
    return res.status(400).json({ error: '일반 TTS 방송의 내용을 입력해주세요.' })
  }
  // audio뿐 아니라 video도 재생할 파일이 있어야 소리·화면이 나간다. 예전엔 audio만
  // 막고 있어서, 파일 없는 영상 예약이 저장은 되고 그 시각엔 조용히 아무 일도 안 일어났다
  // (자연어 예약이 이 유형들을 만들 수 있게 되면서 실제로 닿을 수 있는 경로가 됐다).
  if (needsAudioFile(broadcast_type) && !audio_file_id) {
    return res.status(400).json({ error: '재생할 파일을 선택해주세요.' })
  }
  if (!isKnownBroadcastType(broadcast_type)) {
    return res.status(400).json({ error: '알 수 없는 방송 유형입니다.' })
  }
  if (invalidBgmVolume(req.body.bgm_volume)) {
    return res.status(400).json({ error: 'BGM 볼륨은 0~100 사이 숫자여야 합니다.' })
  }
  if (invalidBgmVolume(req.body.main_volume)) {
    return res.status(400).json({ error: '방송 볼륨은 0~100 사이 숫자여야 합니다.' })
  }
  if (invalidPlaybackRate(req.body.playback_rate)) {
    return res.status(400).json({ error: '재생 배속은 0.5~1.5배 사이여야 합니다.' })
  }
  if (invalidManagedBy(req.body.managed_by)) {
    return res.status(400).json({ error: '알 수 없는 예약 소유자입니다.' })
  }
  if (broadcast_type === 'flow' && !flow_sequence_id) {
    return res.status(400).json({ error: '사용할 흐름을 선택해주세요.' })
  }
  if (invalidScheduleFields(req.body, res)) return
  if (blockedBySensitiveInfo(req, res)) return
  try {
    const id = insertSchedule(req.body)
    queueSchedulePrewarm(getDB(), id)
    예약바뀜(req, 'created', { id })
    res.json({ ok: true, id })
  } catch (err) {
    console.error('[schedules POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/schedules/:id — 예약 수정 (last_fired 초기화 → 당일 재실행 허용)
router.put('/:id', (req, res) => {
  const {
    title, content = '', target, scheduled_time, active, broadcast_type = 'text',
    bgm_enabled = 0, bgm_type = 'local_broadcast', bgm_value = '', bgm_title = '', bgm_delay = 5,
    repeat_broadcast = 0, group_id = null, audio_file_id = null, flow_sequence_id = null,
    repeat_start_date, repeat_end_date = null, repeat_weekdays = [], managed_by = null,
  } = req.body
  if (!title?.trim() || !scheduled_time) {
    return res.status(400).json({ error: '제목과 시간은 필수입니다.' })
  }
  { const 문제 = BGM폴더확인(bgm_type, Boolean(bgm_enabled), broadcast_type); if (문제) return res.status(400).json({ error: 문제 }) }
  if (!repeat_start_date) {
    return res.status(400).json({ error: '반복시작일은 필수입니다.' })
  }
  if (broadcast_type === 'text' && !content?.trim()) {
    return res.status(400).json({ error: '일반 TTS 방송의 내용을 입력해주세요.' })
  }
  // audio뿐 아니라 video도 재생할 파일이 있어야 소리·화면이 나간다. 예전엔 audio만
  // 막고 있어서, 파일 없는 영상 예약이 저장은 되고 그 시각엔 조용히 아무 일도 안 일어났다
  // (자연어 예약이 이 유형들을 만들 수 있게 되면서 실제로 닿을 수 있는 경로가 됐다).
  if (needsAudioFile(broadcast_type) && !audio_file_id) {
    return res.status(400).json({ error: '재생할 파일을 선택해주세요.' })
  }
  if (!isKnownBroadcastType(broadcast_type)) {
    return res.status(400).json({ error: '알 수 없는 방송 유형입니다.' })
  }
  if (invalidBgmVolume(req.body.bgm_volume)) {
    return res.status(400).json({ error: 'BGM 볼륨은 0~100 사이 숫자여야 합니다.' })
  }
  if (invalidBgmVolume(req.body.main_volume)) {
    return res.status(400).json({ error: '방송 볼륨은 0~100 사이 숫자여야 합니다.' })
  }
  if (invalidPlaybackRate(req.body.playback_rate)) {
    return res.status(400).json({ error: '재생 배속은 0.5~1.5배 사이여야 합니다.' })
  }
  if (invalidManagedBy(req.body.managed_by)) {
    return res.status(400).json({ error: '알 수 없는 예약 소유자입니다.' })
  }
  if (broadcast_type === 'flow' && !flow_sequence_id) {
    return res.status(400).json({ error: '사용할 흐름을 선택해주세요.' })
  }
  if (invalidScheduleFields(req.body, res)) return
  if (blockedBySensitiveInfo(req, res)) return
  const repeat_type = deriveLegacyRepeatType(repeat_weekdays)
  try {
    // 예약별 볼륨·배속은 "키가 아예 없으면"(이 컬럼들을 모르는 구버전 화면 — 자동 업데이트
    // 전 번들을 띄워둔 관리자 탭) 기존 값을 보존한다. 키를 명시적으로 null로 보내면 기존대로
    // 지운다(시스템 기본값 복귀). 무조건 덮어쓰면 제목만 고쳐 저장해도 "잔잔하게" 예약의
    // 볼륨이 조용히 지워져 다음 발동에 기본 볼륨으로 크게 나간다.
    // `bgm_end_delay`(TTS 뒤 BGM 지속, 0027)도 같은 규칙으로 보존한다 — **기본값 5를 여기
    // 두면 안 된다.** 이 칸을 모르는 화면이 제목만 고쳐 저장하는 순간 모든 예약의 BGM 이
    // 5초씩 더 나가게 된다. 기존 예약의 소리 길이는 사람이 명시적으로 정할 때만 바뀐다.
    const existing = getDB().prepare(
      'SELECT bgm_volume, main_volume, playback_rate, bgm_end_delay FROM schedules WHERE id = ?'
    ).get(req.params.id)
    const bodyOrExisting = (field, normalize) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? normalize(req.body[field])
        : (existing?.[field] ?? null)
    getDB().prepare(`
      UPDATE schedules
      SET title = ?, content = ?, target = ?, scheduled_time = ?,
          repeat_type = ?, active = ?, broadcast_type = ?, last_fired = NULL,
          bgm_enabled = ?, bgm_type = ?, bgm_value = ?, bgm_title = ?, bgm_delay = ?, bgm_end_delay = ?,
          repeat_broadcast = ?, group_id = ?, audio_file_id = ?, flow_sequence_id = ?,
          repeat_start_date = ?, repeat_end_date = ?, repeat_weekdays = ?, managed_by = ?,
          bgm_volume = ?, main_volume = ?, playback_rate = ?
      WHERE id = ?
    `).run(
      title.trim(), content?.trim() || '', target, scheduled_time,
      repeat_type, active ? 1 : 0, broadcast_type,
      bgm_enabled ? 1 : 0, bgm_type, bgm_value, bgm_title, Number(bgm_delay),
      bodyOrExisting('bgm_end_delay', (v) => Number(v) || 0),
      repeat_broadcast ? 1 : 0, group_id || null, audio_file_id || null, flow_sequence_id || null,
      repeat_start_date, repeat_end_date || null, JSON.stringify(repeat_weekdays), managed_by || null,
      bodyOrExisting('bgm_volume', normalizeBgmVolume), bodyOrExisting('main_volume', normalizeBgmVolume),
      bodyOrExisting('playback_rate', normalizePlaybackRate), req.params.id,
    )
    queueSchedulePrewarm(getDB(), Number(req.params.id))
    예약바뀜(req, 'updated', { id: Number(req.params.id) })
    res.json({ ok: true })
  } catch (err) {
    console.error('[schedules PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/schedules/:id/toggle — 활성·일시정지 전환
router.patch('/:id/toggle', (req, res) => {
  try {
    const db  = getDB()
    const row = db.prepare('SELECT active FROM schedules WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' })
    const newActive = row.active ? 0 : 1
    db.prepare('UPDATE schedules SET active = ? WHERE id = ?').run(newActive, req.params.id)
    if (newActive) queueSchedulePrewarm(db, Number(req.params.id))
    예약바뀜(req, 'toggled', { id: Number(req.params.id), active: newActive })
    res.json({ ok: true, active: newActive })
  } catch (err) {
    console.error('[schedules toggle]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/schedules/:id/trigger — 예약 수동 즉시 실행 (완료된 방송 재방송 등)
router.post('/:id/trigger', async (req, res) => {
  try {
    const db = getDB()
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(parseInt(req.params.id))
    if (!schedule) return res.status(404).json({ error: '예약을 찾을 수 없습니다' })
    // ── **같은 예약을 두 번 누르면 한 번만 나간다** (사용자 지시 2026-09-14) ──────
    // 이 라우트는 아래에서 **앞 소리를 밀어내고** 발사한다. 그래서 두 번 누르면
    // "두 번 들린다"가 아니라 **나가던 방송이 처음으로 되감긴다** — 어르신 쪽에서는
    // 말이 끊겼다가 다시 시작하는 것으로 들린다. 둘 다 안 되는 결과다.
    // 판정은 `/api/tts/broadcast` 와 **같은 모듈**이 한다(규칙이 두 벌이면 곧 갈린다).
    const 겹침 = require('../services/duplicateBroadcast')
    const 자물쇠 = 겹침.겹침잠금(겹침.예약열쇠(schedule.id))
    if (!자물쇠.ok) {
      return res.status(409).json({
        error: '이 방송이 지금 나가고 있습니다. 끝난 뒤에 다시 눌러 주세요.',
        duplicate: true,
      })
    }
    res.json({ ok: true })
    // ── P-43: 발사 **전에** 앞 소리를 밀어낸다 ────────────────────────
    // 예전엔 `fireSchedule` 을 그냥 불렀다. 그런데 fireSchedule 은 **취소 토큰을 안 세운다**
    // (`scheduler.js:228-229`). 그래서 돌던 자동방송 레인은 `isCancelled(tok)` 가 false 인
    // 채로 남아 `logPreempted()`(`broadcastSequencer.js:428-438`)가 안 불렸다 —
    // 소리는 새 재생에 잘리는데(`awaitTTSEnd` 가 상한까지 자다 풀린다) **이력에는 성공**으로
    // 남았다. ISSUE-010 이 자동방송 레인에서 닫은 구멍이 이 경로에만 열려 있었다.
    //
    // 종류는 기본값 CANCEL_PREEMPT('밀림')다 — 사람이 정지 버튼을 누른 것이 아니다.
    // `stopCurrentBroadcast`(CANCEL_HUMAN)를 쓰면 밀려난 방송이 또 조용히 사라진다.
    //
    // **차임은 예외다.** 차임은 공존이 명세라(td09 §3-B 규칙 5) 앞 소리를 죽이면 안 된다.
    // `deferOrFire` 도 같은 이유로 차임을 안 미룬다(`scheduler.js:585-608`).
    if (schedule.broadcast_type !== 'chime') {
      require('../services/broadcastGate').cancelCurrentBroadcast(
        `수동 재생("${schedule.title}")이 시작되어 앞 소리를 정리합니다`)
    }
    fireSchedule({ ...schedule, _manual: true }, db)
      .then(() => {
        // ── **여기서 바로 풀면 안 된다** (V③ 지적, 2026-09-14) ──────────────────
        // `fireSchedule` 은 브라우저에 재생을 **지시하고 바로 돌아온다** — 소리는 그 뒤에
        // 난다. 그 약속이 풀리는 것으로 잠금을 풀면 **몇 밀리초 만에 풀려** 아무것도 못
        // 막는다. 이 서버는 브라우저 재생이 끝나는 순간을 못 본다(그건 즉시 TTS 만 안다).
        // 그러니 **지킬 수 없는 약속 대신 지킬 수 있는 것**을 한다 — 두 번 누름을 막는 창.
        const t = setTimeout(() => 자물쇠.풀기(), 겹침.이중클릭창ms)
        if (typeof t.unref === 'function') t.unref()   // 이 타이머가 서버 종료를 붙잡지 않는다
      })
      .catch(e => {
        // 못 나갔다 — 잡아 둘 이유가 없다. 바로 풀어 다시 시도할 수 있게 한다.
        console.error('[schedules/trigger]', e.message)
        자물쇠.풀기()
      })
  } catch (err) {
    console.error('[schedules trigger]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/schedules/:id — 예약 삭제
router.delete('/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id)
    예약바뀜(req, 'deleted', { id: Number(req.params.id) })
    res.json({ ok: true })
  } catch (err) {
    console.error('[schedules DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.invalidPlaybackRate = invalidPlaybackRate
