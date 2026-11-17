// 자연어 방송 예약 초안(schedule_drafts) — AI(Gemini)가 문장에서 날짜/시간/제목/내용을 뽑아
// 초안만 만들고, 사람이 승인해야만 schedules에 실제로 들어간다(scheduler.js는 schedules만
// 읽으므로 승인 전엔 방송될 방법이 없다). insertSchedule()은 schedules.js(POST 라우트)와
// 같은 services/scheduleStore.js의 것을 재사용해서 컬럼 목록이 두 곳에서 따로 노는
// 드리프트를 막는다(CLAUDE.md 4번 규칙).
//
// QuickSchedulePhrase(/api/schedules/parse-phrase, server/services/schedulePhrase.js)와는
// 별도 경로다 — 그쪽은 규칙 기반이라 AI 키 없이 항상 동작하지만 시간·요일만 뽑고 방송 문구는
// 사용자가 입력한 원문을 그대로 쓴다. 이쪽은 Gemini가 방송 안내 문구까지 새로 생성해주는 대신
// AI 키가 필요하고 간헐적 503(과부하)에 영향을 받는다(geminiClient.js가 재시도로 완화).
const express = require('express')
const { getDB } = require('../db/schema')
const { insertSchedule, MANAGED_BY_AI } = require('../services/scheduleStore')
const { FAILURE_REASONS, SOURCES, recordParseFailure, readParseStats } = require('../services/parseFailures')
const { detectVolume, isKnownBroadcastType, needsAudioFile, detectBroadcastType, isImmediateRequest } = require('../domain/ontology')
const { findAutoOverlaps } = require('../services/schedulePhrase')
const { readEnabledAutoTimes } = require('../domain/autoBroadcasts')
const { readVolumeLevels, clampVolume } = require('../domain/volume')
const { todayStr } = require('../services/repeatSchedule')
const { checkSensitive } = require('../services/sensitiveInfo')

const router = express.Router()

// 설정 읽기는 domain/settingsRead 한 곳을 쓴다 — 같은 조회가 12곳에 복사돼 있었다(TD-04).
const { rawSetting } = require('../domain/settingsRead')

function getSetting(key) { return rawSetting(getDB(), key) || null }

// ─── DB 헬퍼 (테스트에서도 직접 import) ─────────────────────────────────────

// 볼륨은 비었으면 NULL(= 시스템 기본값). 0은 무음이라는 유효한 값이라 falsy로 지우면 안 된다.
function normalizeVolume(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  return Number.isFinite(Number(value)) ? clampVolume(value, 0) : null
}

// 1회성 예약은 repeat_start_date 당일에만 발동한다(repeatSchedule.shouldRunToday) — 지난 날짜로
// 저장되면 승인해도 **영원히 안 울리는 예약**이 되고, 화면에는 정상 등록으로 보여 사람이
// 알아챌 방법이 없다. 그래서 초안을 만들 때와 승인할 때 양쪽에서 막는다(초안이 하루를 넘겨
// 잠들면 만들 때는 오늘이던 날짜가 승인 시점에는 과거다).
// **시각은 보지 않는다** — 즉시 방송("지금 당장")이 오늘 + 방금 지난 시각으로 이 경로를
// 타므로 당일을 막으면 즉시 방송이 통째로 깨진다. 판정 단위는 날짜 하나뿐이다.
function assertNotPastDate(date) {
  if (date && date < todayStr()) {
    throw new Error(`지난 날짜(${date})로는 예약할 수 없습니다. 오늘 이후로 정해주세요.`)
  }
}

function insertDraft({
  raw_input, title, content = '', scheduled_time, repeat_start_date, broadcast_type = 'text',
  main_volume = null, bgm_volume = null,
}) {
  if (!title?.trim()) throw new Error('제목을 알 수 없습니다.')
  if (!scheduled_time) throw new Error('시간을 알 수 없습니다.')
  if (!repeat_start_date) throw new Error('날짜를 알 수 없습니다.')
  assertNotPastDate(repeat_start_date)
  // 승인 화면에는 음원·영상 파일 선택기가 없다 — 파일이 필요한 유형이 초안으로 들어오면
  // 승인해도 그 시각에 아무 소리도 안 나므로, 여기서 TTS로 되돌린다(조용한 실패 방지).
  // 승인 화면에 파일·흐름 선택기가 생겨서(B3) 이제 초안도 모든 유형을 가질 수 있다.
  // 파일이 필요한 유형은 파일 없이 초안으로 남고, 승인할 때 사람이 고른다(approveDraft가 막는다).
  // 모델이 목록에 없는 값을 지어내면 여전히 text로 되돌린다 — 출력은 믿지 않는다.
  const type = isKnownBroadcastType(broadcast_type) ? broadcast_type : 'text'
  const now = new Date().toISOString()
  const result = getDB().prepare(`
    INSERT INTO schedule_drafts
      (raw_input, title, content, scheduled_time, repeat_start_date, broadcast_type, main_volume, bgm_volume, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    raw_input || '', title.trim(), content?.trim() || '', scheduled_time, repeat_start_date, type,
    normalizeVolume(main_volume), normalizeVolume(bgm_volume), SOURCES.AI, now,
  )
  return getDB().prepare('SELECT * FROM schedule_drafts WHERE id = ?').get(result.lastInsertRowid)
}

function getDraftOrThrow(id) {
  const draft = getDB().prepare('SELECT * FROM schedule_drafts WHERE id = ?').get(id)
  if (!draft) throw new Error('초안을 찾을 수 없습니다.')
  return draft
}

// 제미나이 호출과 그 응답의 시각 정규화는 `services/geminiSchedule.js` 로 내려갔다
// (2026-09-06). **두 라우트가 같은 호출을 쓰기 때문**이고, 라우트가 라우트를 부르는 것은
// `route-wiring.test.js` 가 막는다 — "공유물은 services/나 domain/으로 내릴 것".
const { parseWithGemini, normalizeHHMM } = require('../services/geminiSchedule')

// 승인 시 실제로 쓸 방송 유형. 초안 값은 insertDraft가 이미 걸렀지만, overrides는 화면에서
// 그대로 들어오므로 여기서 한 번 더 본다 — 이 경로는 POST /api/schedules의 검증을 거치지 않고
// insertSchedule을 직접 부르기 때문에, 파일이 필요한 유형이 새면 그 시각에 조용히 무음이 된다.
// 사람이 명시적으로 고른 값이므로 조용히 낮추지 않고 오류로 알린다.
function resolveApprovedType(overrides, draft) {
  const requested = overrides.broadcast_type ?? draft.broadcast_type ?? 'text'
  if (!isKnownBroadcastType(requested)) {
    throw new Error('알 수 없는 방송 유형입니다.')
  }
  // 예전엔 문장만으로 실행 가능한 유형(text·chime·bgm)만 허용했다 — 승인 화면에 파일·흐름 선택기가 없어서
  // 파일 없는 audio/video 예약이 만들어지면 그 시각에 조용히 무음이 되기 때문이었다.
  // 이제 선택기가 생겼으므로 "유형을 좁히는" 대신 "고른 것이 실제로 재생 가능한지"를 본다.
  // 이 경로는 POST /api/schedules의 검증을 거치지 않고 insertSchedule을 직접 부르므로
  // 여기서 막지 않으면 무음 예약이 그대로 저장된다.
  if (needsAudioFile(requested) && !overrides.audio_file_id) {
    throw new Error('재생할 파일을 선택해주세요.')
  }
  if (requested === 'flow' && !overrides.flow_sequence_id) {
    throw new Error('사용할 흐름을 선택해주세요.')
  }
  return requested
}

// overrides: 승인 화면에서 사람이 고친 값(제목/시간/내용 등) — 없으면 초안 그대로 쓴다.
function approveDraft(id, overrides = {}) {
  const draft = getDraftOrThrow(id)
  if (draft.status !== 'pending') throw new Error('이미 처리된 초안입니다.')

  const approvedType = resolveApprovedType(overrides, draft)
  const approvedDate = overrides.repeat_start_date ?? draft.repeat_start_date
  assertNotPastDate(approvedDate)
  const approvedContent = overrides.content ?? draft.content

  // 민감정보 검사 — 이 경로는 POST /api/schedules를 타지 않고 insertSchedule을 직접 부르므로
  // 여기서 안 부르면 **AI가 쓴 문구만 검사 없이 스피커로 나간다**(CC-037). 사람이 쓴 문구보다
  // 덜 꼼꼼히 읽히는 쪽이라 오히려 더 위험하다. 판정과 안내문은 sensitiveInfo가 한 벌로 준다.
  // 예전엔 "문서화된 결정"이라며 일부러 비워 뒀는데, 그 결정은 승인 화면이 문구를 못 고치던
  // 시절의 것이다 — 지금은 overrides.content로 사람이 고칠 수 있어 전제가 사라졌다.
  const verdict = checkSensitive(approvedContent, {
    acknowledged: !!overrides.ackWarnings, verb: '저장',
  })
  if (!verdict.ok) {
    // 무엇이 걸렸는지(blocked/warnings)까지 화면이 받아야 사람이 어디를 고칠지 안다
    throw Object.assign(new Error(verdict.body.error), {
      status: verdict.status, payload: verdict.body,
    })
  }
  const scheduleId = insertSchedule({
    title: overrides.title ?? draft.title,
    // bgm 초안은 읽을 문구가 없다 — 이 PC 의 방송용 BGM 폴더에서 튼다(규칙 파서와 같은 값, 2026-09-21).
    ...(approvedType === 'bgm'
      ? { content: '', bgm_enabled: 1, bgm_type: 'local_broadcast', bgm_value: '' }
      : { content: approvedContent }),
    scheduled_time: overrides.scheduled_time ?? draft.scheduled_time,
    repeat_start_date: approvedDate,
    // 초안이 읽어낸 유형을 그대로 쓴다(예전엔 'text' 고정이라 "차임벨 울려줘"도 TTS로 나갔다).
    broadcast_type: approvedType,
    // 승인 화면에서 사람이 고른 파일·흐름. 유형이 이것들을 요구하면 위에서 이미 막았다.
    audio_file_id:    overrides.audio_file_id ?? null,
    flow_sequence_id: overrides.flow_sequence_id ?? null,
    // 사람이 승인 카드에서 고친 값이 있으면 그것을, 없으면 초안이 읽은 값을 쓴다
    main_volume: normalizeVolume(overrides.main_volume ?? draft.main_volume),
    bgm_volume:  normalizeVolume(overrides.bgm_volume  ?? draft.bgm_volume),
    target: '전체',
    repeat_weekdays: [],
    // 자연어로 만들어진 예약이라고 표시한다. "아까 등록한 거 취소해줘"가 이 표시로만 대상을
    // 고르므로, 여기서 빠지면 그 예약은 취소 목록에 영원히 안 나온다.
    managed_by: MANAGED_BY_AI,
  })

  require('../services/scheduler').queueSchedulePrewarm(getDB(), scheduleId)

  // ── 학습 재료를 남긴다 (고도화 제안 #10 1단계, docs/nl-learning-design.md) ──
  // overrides가 곧 "AI가 틀린 것"인데 지금까지는 insertSchedule로 흘러가고 버려졌다.
  // 무엇을 고쳤는지는 **승인 시점에 계산해 굳혀 둔다** — 나중에 세는 쪽이 스키마 변화에
  // 안 흔들리고, 예약이 그 뒤 수정·삭제돼도 그때의 판단이 남는다.
  //
  // 비교는 초안 값 ↔ 최종 값이다. 화면이 안 고친 값을 그대로 되보내는 일이 흔하므로
  // (모달이 필드를 채운 채 열린다) **값이 같으면 수정으로 세지 않는다** — 안 그러면
  // 수정률이 통째로 부풀려져 통계가 거짓말을 한다.
  // 빈 배열([])과 NULL은 뜻이 다르다: []는 "안 고치고 승인함", NULL은 "모름"(옛 행).
  const approved = {
    title:           overrides.title ?? draft.title,
    content:         approvedContent,
    scheduled_time:  overrides.scheduled_time ?? draft.scheduled_time,
    repeat_start_date: approvedDate,
    broadcast_type:  approvedType,
    main_volume:     normalizeVolume(overrides.main_volume ?? draft.main_volume),
    bgm_volume:      normalizeVolume(overrides.bgm_volume  ?? draft.bgm_volume),
  }
  const editedFields = Object.keys(approved).filter(k => {
    const before = k === 'broadcast_type' ? draft.broadcast_type
      : k === 'main_volume' || k === 'bgm_volume' ? normalizeVolume(draft[k])
      : draft[k]
    // null·undefined·''의 차이는 "안 정해짐"으로 같게 본다 — 화면이 빈 값을 어느 모양으로
    // 되보내든 그것만으로 수정이 되면 안 된다.
    const norm = (v) => (v === null || v === undefined || v === '') ? null : v
    return norm(before) !== norm(approved[k])
  })

  getDB().prepare(`
    UPDATE schedule_drafts
       SET status = 'approved', resolved_at = ?,
           schedule_id = ?, approved_json = ?, edited_fields = ?
     WHERE id = ?
  `).run(
    new Date().toISOString(), scheduleId,
    JSON.stringify(approved), JSON.stringify(editedFields), id,
  )

  // ── 3단계 — 임계를 넘은 낱말을 고도화 제안으로 굳힌다 (제안만, 자동 반영 없음) ──
  // 표본이 늘어나는 유일한 순간이 여기라 매분 도는 자리가 필요 없다. 실패해도 승인은
  // 이미 끝났다 — 학습 부가 기능이 예약 승인을 막으면 주객전도라 삼키고 기록만 한다.
  try { require('../domain/nlSuggest').maybeSuggest(getDB()) }
  catch (e) { console.error('[자연어 학습] 제안 검사 실패:', e.message) }

  return { scheduleId }
}

function rejectDraft(id) {
  const draft = getDraftOrThrow(id)
  if (draft.status !== 'pending') throw new Error('이미 처리된 초안입니다.')
  getDB().prepare(`
    UPDATE schedule_drafts SET status = 'rejected', resolved_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id)
}

function listDrafts(status) {
  if (status) {
    return getDB().prepare('SELECT * FROM schedule_drafts WHERE status = ? ORDER BY id DESC').all(status)
  }
  return getDB().prepare('SELECT * FROM schedule_drafts ORDER BY id DESC').all()
}

// ─── AI 초안 되묻기(B4) ─────────────────────────────────────────────────────
// 규칙 파서(QuickSchedulePhrase)에는 있는 "애매하면 되묻기"가 AI 경로에는 없었다 —
// 같은 문장을 어느 화면에 넣었느냐에 따라 한쪽만 경고하는 것은 오독보다 더 헷갈린다.
// Gemini의 출력을 다시 Gemini에게 묻지 않는다. 문장·시각·DB만으로 판정할 수 있는 것들을
// 규칙 경로와 **같은 모듈**(ontology / autoBroadcasts / findAutoOverlaps)로 계산한다.

// AI 경로가 만드는 예약은 전부 1회성이다(approveDraft가 repeat_weekdays: []로 저장).
// 문장에 반복 표현이 있으면 그 기대가 조용히 깨진다 — "매일 오후 3시 산책"이 내일 한 번만
// 나가고 끝나는 것은 사람이 알아채기 가장 어려운 실패라 반드시 알린다.
// 반복 어휘는 규칙 파서와 **같은 것**을 본다(services/schedulePhrase.js의 REPEAT_PHRASE).
// 예전엔 여기 자기 목록이 따로 있어서 "월수금"·"월요일과 수요일"을 반복으로 못 읽었고,
// 그 결과 경고 없이 1회성 예약만 만들어졌다 — 사람은 매주 나갈 거라 믿는다.
const { mentionsRepeat } = require('../services/schedulePhrase')

function analyzeAiDraft(db, { rawInput, date, time, broadcastType, hasVolume, immediate = false, now = new Date() }) {
  const ambiguous = []
  let adjustedDate = date

  const pad = n => String(n).padStart(2, '0')
  const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`

  // 1회성 예약은 시작일 당일에만 발동한다 — "오늘 + 이미 지난 시각"은 영원히 안 나간다.
  // 규칙 파서의 time_past_moved와 같은 보정: 내일로 옮기고 사람에게 알린다.
  // 즉시 방송은 시각이 곧 지금이라 '<='에 걸린다 — 내일로 옮기면 "지금"이 사라진다
  if (!immediate && date === toDateStr(now) && time && time <= nowHHMM) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    adjustedDate = toDateStr(tomorrow)
    ambiguous.push('time_past_moved')
  }

  // 일과방송과 시각이 겹치면 두 방송이 같이 나가 소리가 섞인다 — 막지는 않고 알린다
  let overlaps = []
  try { overlaps = findAutoOverlaps(time, readEnabledAutoTimes(db)) } catch { /* 조회 실패는 판정 생략 */ }
  if (overlaps.length) ambiguous.push('overlaps_auto')

  // 같은 문장을 규칙 사전은 다른 유형으로 강하게 읽는 경우 — 어느 쪽이 맞는지 우리가
  // 정하지 않는다. 이름을 대고 사람에게 묻는다("차임벨 울려줘"를 Gemini가 text로 읽는 등).
  let ruleType = null
  const detected = detectBroadcastType(rawInput)
  if (detected?.confidence === 'strong' && detected.broadcastType !== broadcastType) {
    ruleType = { broadcastType: detected.broadcastType, label: detected.label }
    ambiguous.push('type_differs')
  }

  // 볼륨은 귀로 바로 체감되는 값 — 읽어낸 수치를 사람이 확인해야 한다(규칙 경로와 동일)
  if (hasVolume) ambiguous.push('volume_set')

  if (mentionsRepeat(rawInput)) ambiguous.push('repeat_unsupported')

  return { ambiguous, date: adjustedDate, overlaps, ruleType }
}

// ─── Gemini 파싱 ────────────────────────────────────────────────────────────

const { currentGeminiModel } = require('../domain/geminiModel')

// ─── 라우트 ─────────────────────────────────────────────────────────────────

// POST /api/schedule-drafts/parse — 문장 → 초안(schedule_drafts) 생성. schedules는 안 건드림.
router.post('/parse', async (req, res) => {
  if (require('../services/features').blockIfDisabled(res, 'ai', 'AI 방송 도우미')) return

  const { text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: '예약 문장을 입력해주세요.' })

  const provider = getSetting('ai_provider') || 'gemini'
  if (provider !== 'gemini') {
    return res.status(400).json({ error: '현재 Gemini만 지원합니다.' })
  }
  // ── 3단 폴백의 2·3차 (2026-09-06) ────────────────────────────────────
  //
  // 예전에는 키가 없으면 **400 으로 끝냈다.** 그러면 API 키를 못 넣는 현장에서는
  // 이 기능이 아예 없는 것과 같다. 이제 키가 없거나 API 가 실패하면
  // **기존 규칙 파서**(services/schedulePhrase.js)로 간다 — 인터넷 없이도 돈다.
  //
  // 3차에 새 파서를 만들지 않는다. 같은 일을 두 번 구현하면 두 곳이 갈리고,
  // 갈린 쪽이 조용히 틀린 예약을 만든다.
  //
  // **검토 게이트는 그대로다** — 어느 단계로 읽었든 초안(status: pending)만 만들고,
  // 사람이 "예약 확정"을 눌러야 실제 예약이 된다.
  const apiKey = getSetting('gemini_api_key')
  const model = currentGeminiModel()
  const { parseWithFallback, viaLabel } = require('../services/llmGateway')

  try {
    const t0 = Date.now()
    const r = await parseWithFallback({
      text: text.trim(),
      today: todayStr(),
      callApi: apiKey ? ((t) => parseWithGemini(t, apiKey, model)) : null,
      // **문맥을 반드시 넘긴다** — 안 넘기면 흐름 이름·볼륨 낱말·시각 충돌이 빠져서
      // 같은 문장이 이 길로 왔을 때만 다른 예약이 된다(domain/phraseContext.js).
      context: require('../domain/phraseContext').readPhraseContext(getDB()),
    })
    const parsed = r.parsed
    console.log(`[예약파싱] ${viaLabel(r.via)}(${Date.now() - t0}ms)` + (r.reason ? ` — ${r.reason}` : ''))

    // "지금 당장 안내 방송 해줘" — 시각·반복 표현 없이 즉시 신호만 있으면 예약이 아니라
    // 즉시 방송 요청이다. Gemini가 시각을 못 찾아 422로 떨어지기 전에 먼저 본다.
    // 판정은 규칙 파서와 같은 한 곳(ontology.isImmediateRequest)이다.
    // 자동 발사는 없다 — 화면의 "지금 방송" 버튼이 검토 게이트다.
    const immediate = isImmediateRequest(text, {
      hasTime: !!parsed.time, hasRepeat: mentionsRepeat(text),
    })
    if (immediate) {
      const nowD = new Date()
      const pad = n => String(n).padStart(2, '0')
      parsed.date = `${nowD.getFullYear()}-${pad(nowD.getMonth() + 1)}-${pad(nowD.getDate())}`
      parsed.time = `${pad(nowD.getHours())}:${pad(nowD.getMinutes())}`
    }

    if (!parsed.date || !parsed.time) {
      // 무엇이 안 읽혔는지 남긴다 — 실패한 원문이 있어야 파서를 고칠 단서가 생긴다
      recordParseFailure({
        raw_input: text.trim(), reason: FAILURE_REASONS.NO_DATETIME, source: SOURCES.AI,
      })
      return res.status(422).json({
        error: '문장에서 날짜나 시간을 찾지 못했습니다. "8월 28일 오후 2시"처럼 날짜와 시간을 함께 말씀해주세요.',
        parsed,
        // 못 읽은 것이 AI 였는지 규칙 파서였는지 — 실패 원인을 사람이 구분할 수 있어야 한다
        via: r.via, via_label: viaLabel(r.via), via_reason: r.reason,
      })
    }
    // 볼륨은 Gemini에게 묻지 않는다. 규칙 파서(QuickSchedulePhrase)와 **같은 사전**으로
    // 원문에서 직접 읽는다 — 모델이 숫자를 지어낼 여지가 없고, 관리자 화면에서 조정한
    // 정성어 수치(volume_word_quiet/loud)가 두 경로에 똑같이 적용된다.
    const volume = detectVolume(text.trim(), readVolumeLevels(getDB()))
    const hasVolume = volume && volume.value !== null

    // 저장 전에 되묻을 거리를 계산한다 — 지난 시각이면 여기서 날짜가 내일로 바뀌므로
    // insertDraft보다 먼저여야 한다(승인 카드가 초안 값을 그대로 보여주기 때문).
    const analysis = analyzeAiDraft(getDB(), {
      rawInput: text.trim(), date: parsed.date, time: parsed.time,
      broadcastType: parsed.broadcast_type, hasVolume, immediate,
    })

    // 지난 날짜는 초안으로도 남기지 않는다 — insertDraft가 어차피 막지만, 여기서 잡아야
    // 500(시스템 오류)이 아니라 422(문장을 못 읽음)로 나가고 실패 원문이 파서 개선 재료로 남는다.
    if (analysis.date && analysis.date < todayStr()) {
      recordParseFailure({
        raw_input: text.trim(), reason: FAILURE_REASONS.PAST_DATE, source: SOURCES.AI,
      })
      return res.status(422).json({
        error: `이미 지난 날짜(${analysis.date})로 읽었습니다. 올해 날짜가 맞는지 확인해서 다시 말씀해주세요.`,
        parsed,
      })
    }

    const draft = insertDraft({
      raw_input: text.trim(),
      title: parsed.title || '방송 예약',
      content: parsed.content || '',
      scheduled_time: parsed.time,
      repeat_start_date: analysis.date,
      // 목록에 없는 값을 지어내면 insertDraft가 text로 되돌린다(모델 출력은 믿지 않는다)
      broadcast_type: parsed.broadcast_type,
      main_volume: hasVolume && volume.channel === 'main' ? volume.value : null,
      bgm_volume:  hasVolume && volume.channel === 'bgm'  ? volume.value : null,
    })
    res.json({
      ok: true, draft,
      // 되묻기 재료 — 화면이 "확인했습니다" 체크 전에는 확정을 막는다(규칙 경로와 같은 게이트)
      ambiguous: analysis.ambiguous,
      overlaps: analysis.overlaps,
      rule_type: analysis.ruleType,
      // 화면이 "예약 확정" 대신 "지금 방송" 버튼을 보여준다 — 누르는 건 사람이다
      immediate,
      // 어느 단계가 읽었는지. 이것이 없으면 화면은 규칙 파서가 읽은 것을 AI 가 읽은 것으로
      // 보여주게 된다 — 사람이 무엇을 승인하는지 모르는 상태가 제일 나쁘다.
      via: r.via, via_label: viaLabel(r.via), via_reason: r.reason,
    })
  } catch (err) {
    console.error('[schedule-drafts/parse]', err.message)
    recordParseFailure({
      raw_input: text.trim(), reason: FAILURE_REASONS.AI_ERROR, source: SOURCES.AI,
    })
    res.status(500).json({ error: err.message })
  }
})

// GET /api/schedule-drafts/stats — 자연어 예약 파싱 성공률.
// '/:id'류보다 먼저 등록돼야 id='stats'로 잡히지 않는다.
router.get('/stats', (req, res) => {
  try {
    res.json(readParseStats())
  } catch (err) {
    console.error('[schedule-drafts/stats]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/schedule-drafts?status=pending
router.get('/', (req, res) => {
  try {
    res.json(listDrafts(req.query.status))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/schedule-drafts/:id/approve — schedules에 실제로 생성
router.post('/:id/approve', (req, res) => {
  try {
    const result = approveDraft(Number(req.params.id), req.body || {})
    res.json({ ok: true, ...result })
  } catch (err) {
    // 민감정보 되묻기는 409 + needsConfirm으로 나가야 화면이 확인창을 띄운다(400이면 그냥 실패로 보인다)
    res.status(err.status || 400).json({ error: err.message, ...(err.payload || {}) })
  }
})

// POST /api/schedule-drafts/:id/reject
router.post('/:id/reject', (req, res) => {
  try {
    rejectDraft(Number(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

module.exports = router
module.exports.insertDraft = insertDraft
module.exports.approveDraft = approveDraft
module.exports.rejectDraft = rejectDraft
module.exports.listDrafts = listDrafts
module.exports.analyzeAiDraft = analyzeAiDraft
// 정의는 services/geminiSchedule.js 로 내려갔다. 여기 다시 내보내는 것은 기존 테스트
// (`ai-draft-time-and-bgm.test.js`)가 이 이름으로 부르고 있기 때문이다 — 그 테스트가 보는
// 규칙(0 채우기·범위 밖은 null)은 그대로다.
module.exports.normalizeHHMM = normalizeHHMM
