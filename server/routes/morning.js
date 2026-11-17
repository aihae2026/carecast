// 아침 방송 텍스트 조회 및 수동 실행 API
const { rawSetting } = require('../domain/settingsRead')
const { recordMeasuredDuration } = require('../domain/mediaDuration')
const express  = require('express')
const fs       = require('fs')
const { getDB }                                              = require('../db/schema')
const { broadcastSSE }                                       = require('../services/sse')
const { DEFAULT_SEGMENTS, buildMorningText, getMorningData } = require('../services/morning')
const { generateTTSWithRetry, deleteTmpFile, rateToStr, mimeOf } = require('../services/tts')
const {
  fireMorningBroadcast,
  fireExerciseBroadcast,
  fireLunchBroadcast,
  fireDinnerBroadcast,
  fireEveningPrayerBroadcast,
  cancelCurrentBroadcast,
  stopCurrentBroadcast,
  notifyVideoEnded,
  notifyAudioEnded,
  getSteps,
  validateStartIndex,
} = require('../services/broadcastSequencer')

const router = express.Router()

router.get('/steps/:tab', (req, res) => {
  if (!require('../domain/autoBroadcasts').AUTO_BROADCASTS.some(item => item.id === req.params.tab)) {
    return res.status(400).json({ error: '알 수 없는 일과방송입니다.' })
  }
  try {
    const steps = getSteps(getDB(), req.params.tab)
    // `customType` — 사람이 추가한 단계의 종류. 간편 화면이 자동순서 편집기와 **같은 색·그림**으로 그리는 데
    // 쓴다(`lib/bgmLane.stepKindOf`). 내장 단계는 id 로 가르므로 null 이다. 칸을 **더하기만** 했다.
    // 지운 단계(`deleted`)는 간편 화면에 안 보낸다. `index` 는 **거르기 전** 배열 번호 그대로다 —
    // 「이 단계부터 방송」(startIndex)이 이 번호로 getSteps 배열을 집는다.
    res.json({ steps: steps
      .map((step, index) => ({ id: step.id, label: step.label || step.id, enabled: !!step.enabled, index, customType: step.customType || null }))
      .filter(s => !steps[s.index].deleted) })
  } catch { res.status(500).json({ error: '방송 단계를 불러오지 못했습니다.' }) }
})

function manualOptions(req, res, db, tab) {
  const opts = { manual: true }
  if (req.body && Object.hasOwn(req.body, 'startIndex')) opts.startIndex = req.body.startIndex
  if (req.body && Object.hasOwn(req.body, 'startStepId')) opts.startStepId = req.body.startStepId
  try { validateStartIndex(getSteps(db, tab), opts); return opts }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); return null }
}

// GET /api/morning/text — 현재 세그먼트 설정으로 방송 텍스트 + 표시용 정보 반환
router.get('/text', async (req, res) => {
  try {
    const db       = getDB()
    const raw      = rawSetting(db, 'morning_segments')
    const segments = raw ? JSON.parse(raw) : DEFAULT_SEGMENTS

    // 실제 API 데이터 병렬 조회
    const morningData = await getMorningData()
    const text        = [...segments]
      .sort((a, b) => a.order - b.order)
      .filter(s => s.enabled)
      .map(s => {
        const { buildSegmentText } = require('../services/morning')
        return buildSegmentText(s.id, morningData)
      })
      .filter(Boolean)
      .join(' ')

    res.json({ text, segments, info: morningData.info })
  } catch (err) {
    console.error('[morning/text]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/morning/trigger — 아침 종합 방송 수동 실행 (새 시퀀스)
// ?preview=1 쿼리 시: 날씨+일정 텍스트만 미리 듣기 (TTS 스트리밍)
router.post('/trigger', async (req, res) => {
  const db       = getDB()

  // 미리 듣기 모드 — 날씨+일정 TTS만 스트리밍
  if (req.query.preview === '1') {
    const raw      = rawSetting(db, 'morning_segments')
    const segments = raw ? JSON.parse(raw) : DEFAULT_SEGMENTS
    const text     = await buildMorningText(segments)
    const voice    = rawSetting(db, 'tts_voice_morning') ?? 'ko-KR-SunHiNeural'
    let tmpFile = null
    try {
      tmpFile = await generateTTSWithRetry({ text, voice, rate: rateToStr(0.9), pitch: '+0Hz' })
      res.setHeader('Content-Type', mimeOf(tmpFile))
      const stream = fs.createReadStream(tmpFile)
      stream.pipe(res)
      stream.on('end',   () => deleteTmpFile(tmpFile))
      stream.on('error', () => deleteTmpFile(tmpFile))
    } catch (err) {
      if (tmpFile) deleteTmpFile(tmpFile)
      res.status(500).json({ error: err.message })
    }
    return
  }

  // 방송 모드 — 이전 방송 취소 후 새 시퀀스 비동기 실행
  const opts = manualOptions(req, res, db, 'morning')
  if (!opts) return
  cancelCurrentBroadcast()
  fireMorningBroadcast(db, opts).catch(e => console.error('[morning/trigger]', e.message))
  res.json({ ok: true, message: '아침 종합 방송 시퀀스를 시작합니다.' })
})

// POST /api/morning/trigger/exercise — 국민체조 방송 수동 실행
router.post('/trigger/exercise', (req, res) => {
  const db = getDB()
  const opts = manualOptions(req, res, db, 'exercise')
  if (!opts) return
  cancelCurrentBroadcast()
  fireExerciseBroadcast(db, opts).catch(e => console.error('[morning/trigger/exercise]', e.message))
  res.json({ ok: true, message: '국민체조 방송을 시작합니다.' })
})

// POST /api/morning/trigger/lunch — 점심 방송 수동 실행
router.post('/trigger/lunch', (req, res) => {
  const db = getDB()
  const opts = manualOptions(req, res, db, 'lunch')
  if (!opts) return
  cancelCurrentBroadcast()
  fireLunchBroadcast(db, opts).catch(e => console.error('[morning/trigger/lunch]', e.message))
  res.json({ ok: true, message: '점심 방송을 시작합니다.' })
})

// POST /api/morning/trigger/dinner — 저녁 방송 수동 실행
router.post('/trigger/dinner', (req, res) => {
  const db = getDB()
  const opts = manualOptions(req, res, db, 'dinner')
  if (!opts) return
  cancelCurrentBroadcast()
  fireDinnerBroadcast(db, opts).catch(e => console.error('[morning/trigger/dinner]', e.message))
  res.json({ ok: true, message: '저녁 방송을 시작합니다.' })
})

// POST /api/morning/trigger/evening-prayer — 저녁 마무리 방송 수동 실행
router.post('/trigger/evening-prayer', (req, res) => {
  const db = getDB()
  const opts = manualOptions(req, res, db, 'evening_prayer')
  if (!opts) return
  cancelCurrentBroadcast()
  fireEveningPrayerBroadcast(db, opts).catch(e => console.error('[morning/trigger/evening-prayer]', e.message))
  res.json({ ok: true, message: '저녁 마무리 방송을 시작합니다.' })
})

// POST /api/morning/stop — 현재 방송 즉시 정지
router.post('/stop', (req, res) => {
  stopCurrentBroadcast()
  res.json({ ok: true })
})

// POST /api/morning/video-ended — 동영상 재생 완료 신호
// audioFileId·duration은 선택 — audio-ended와 같은 이유로 화면이 잰 길이를 받아 적는다.
router.post('/video-ended', (req, res) => {
  const { token, audioFileId, duration } = req.body
  if (token) notifyVideoEnded(token)
  if (audioFileId) {
    try { recordMeasuredDuration(getDB(), audioFileId, duration) }
    catch (e) { console.error('[영상] 재생시간 기록 실패:', e.message) }
  }
  res.json({ ok: true })
})

// 화면이 실제로 잰 재생시간을 audio_files.duration에 남긴다.
// 업로드 라우트는 duration을 늘 0으로 넣고 아무도 갱신하지 않았다. 그래서 흐름·시퀀서가
// "재생시간을 모르는 파일"의 상한(180초)까지 매번 기다렸고, 4곡짜리 흐름이 12분간 묶여
// 뒤에 있던 방송이 통째로 밀렸다. 브라우저는 이미 길이를 알고 있으니 한 번만 받아 적어두면
// 그다음부터는 상한에 기대지 않는다.
//
// **규칙 본문은 `domain/mediaDuration.js` 한 곳에 있다**(2026-09-12). 여기 있던 것을
// 내렸다 — 음원 관리 화면도 길이를 채워야 하는데, 그러자고 "방송이 끝났다" 라우트를
// 부르게 하면 방송 종료 신호까지 같이 나간다. 규칙이 두 벌이 되면 한쪽만 고쳐진다.

// POST /api/morning/play-started — **화면이 실제로 소리를 시작했다**는 보고 (2026-09-03)
//
// 왜 필요했나: "12:00 예약인데 12:01에 들린다"를 로그로 좁힐 수가 없었다. 서버는 12:00:01에
// 재생 지시를 보낸 것까지만 알고, 그 뒤 브라우저에서 무슨 일이 있었는지는 **아무 흔적도
// 남지 않는다**(실제로 현장 로그에 지시 이후 45초간 아무 줄도 없다).
// 화면이 play()를 성공시킨 순간을 한 줄 남기면, 지연이 서버 쪽인지 화면 쪽인지 바로 갈린다.
//
// 방송을 막지 않는다 — 무엇이 오든 200으로 받고 기록만 한다.
router.post('/play-started', (req, res) => {
  const { label, sinceEventMs, kind, audioId } = req.body || {}
  const ms = Number(sinceEventMs)
  if (Number.isFinite(ms)) {
    console.log(`[재생] ${kind || '방송'} "${String(label || '').slice(0, 40)}" 화면 재생 시작`
      + ` — 지시 후 ${(ms / 1000).toFixed(1)}초`)
    // ── 자막 시계 보정 ───────────────────────────────────────
    //
    // 소리를 안 내는 창(원격 PC·직원 휴대폰)은 재생 위치를 알 방법이 없어 "신호 받은 시각 +
    // 어림값"으로 도는 추정 시계를 쓴다. 그 어림값이 틀린 만큼 자막이 통째로 밀린다 —
    // 2026-09-05에 재 보니 0.36초였다.
    //
    // 그런데 **여기 오는 값이 바로 그 실측값이다.** 지금까지는 도스창에 한 줄 찍고 버렸다.
    // 그대로 되쏘면 원격 창들이 어림값을 버리고 실측으로 시계를 다시 맞춘다.
    //
    // audioId가 있을 때만 보낸다 — 어느 방송의 보고인지 못 가리면, 방송이 잇달아 나갈 때
    // 옛 신호가 새 자막 시계를 흔들어 오히려 나빠진다.
    if (audioId) broadcastSSE('caption_sync', { audioId, sinceEventMs: ms })
  }
  res.json({ ok: true })
})

// POST /api/morning/audio-ended — 음원(녹음 안내) 재생 완료 신호
// audioFileId·duration은 선택 — 화면이 잰 재생시간을 함께 보내면 받아 적는다(위 설명 참고).
router.post('/audio-ended', (req, res) => {
  const { token, audioFileId, duration } = req.body
  if (token) notifyAudioEnded(token)
  if (audioFileId) {
    try { recordMeasuredDuration(getDB(), audioFileId, duration) }
    catch (e) { console.error('[음원] 재생시간 기록 실패:', e.message) }  // 방송 흐름을 막지 않는다
  }
  res.json({ ok: true })
})

module.exports = router
module.exports.recordMeasuredDuration = recordMeasuredDuration
