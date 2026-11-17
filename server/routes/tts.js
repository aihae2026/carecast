const { rawSetting, 글자설정 } = require('../domain/settingsRead')
const express  = require('express')
const fs       = require('fs')
const { getDB }                                              = require('../db/schema')
const { generateTTSWithRetry, deleteTmpFile, rateToStr, pitchToStr, mimeOf } = require('../services/tts')
const { enqueue }                                            = require('../services/audioQueue')
const { resolveDeviceIndex }                                 = require('../services/audioDevices')
const { playChime, 부수차임막힘 }                              = require('../services/chimePlayer')
const { 차임시작표지, 차임뒤대기 }                           = require('../services/chimeTiming')
const { broadcastSSE }                                       = require('../services/sse')
const { hasBrokenText, brokenTextMessage }                   = require('../domain/text')

// InstantBroadcast.jsx가 차임벨 재생 후 실제 발화를 시작하기까지 기다리는 것과 동일한 여유 시간
const CHIME_LEAD_MS = 2600

// ── 덕킹 신호의 세대 번호 (td09 H6) ──
// 이 라우트의 실소리는 서버 스피커라 브라우저는 시작·끝을 모른다. 예약 TTS(브라우저 재생)는
// 스스로 tts-start/end를 쏘는데 이 경로만 조용해서 홀 BGM이 맨 볼륨으로 안내와 겹쳤다.
// 서버가 재생의 시작(enqueue)과 끝(promise 정착)을 아는 유일한 곳이라 여기서 SSE로 알린다.
// 세대 번호는 비상방송 교체 때를 위한 것이다 — priority가 현재 재생을 죽이면 옛 방송의 '끝'이
// 새 방송의 '시작' **뒤에** 도착해 덕킹이 풀린 채 비상방송이 나간다. 마지막 세대만 '끝'을 쏜다.
let speakGen = 0

const { 시작기록, 실패로정정, 실패기록 } = require('../domain/broadcastRecord')

const router = express.Router()

// DB에서 TTS 기본 설정 불러오기
// priority=true(비상방송)면 tts_voice_normal 대신 tts_voice_emergency를 사용한다.
function loadTTSDefaults(db, { priority = false } = {}) {
  const get = (key, def) => rawSetting(db, key) ?? def
  return {
    // **목소리는 `글자설정` 으로 읽는다**(P-113) — `?? 기본값` 은 빈 문자열을 통과시킨다.
    // 위 `broadcastConfig.loadTTSConfig` 와 **같은 규칙**이다. 한쪽만 고치면 즉시 갈린다.
    voice: 글자설정(rawSetting(db, priority ? 'tts_voice_emergency' : 'tts_voice_normal'), 'ko-KR-SunHiNeural'),
    rate:  parseFloat(get('tts_rate',  '0.9')),
    pitch: parseFloat(get('tts_pitch', '1')),
  }
}

/**
 * POST /api/tts/preview
 * 텍스트를 MP3로 변환해 브라우저에 스트리밍 (미리 듣기)
 * voice/rate/pitch를 요청에서 받아 사용 (TTS 설정 페이지 테스트용)
 */
router.post('/preview', async (req, res) => {
  const { text, voice, rate, pitch, sid, pauseMs } = req.body
  if (!text?.trim()) return res.status(400).json({ error: '텍스트를 입력해주세요.' })
  // 이 PC 음성 화자(0~9) — 설정 화면이 **저장하기 전에** 목소리를 비교해 듣는다(2026-09-22). 없으면 저장된 값.
  // 설정 저장과 **같은 규칙**(QA: 미리듣기만 [] 를 0번으로 받았다)
  const 번호읽기 = require('../domain/bgmRoles').번호읽기
  if (sid != null && sid !== '' && 번호읽기(sid, 0, 9) === null) {
    return res.status(400).json({ error: '이 PC 음성 목소리는 0~9 번 중에서 고릅니다.' })
  }
  // 문장 사이 쉼도 저장 전에 들어 본다(2026-09-22) — 설정 저장과 같은 규칙
  const 쉼읽기엄격 = require('../domain/ttsSentences').쉼읽기엄격
  if (pauseMs != null && pauseMs !== '' && 쉼읽기엄격(pauseMs) === null) {
    return res.status(400).json({ error: '문장 사이 쉼은 0~2000 밀리초(0~2초) 사이 정수로 정합니다.' })
  }
  // 미리듣기에서 먼저 막는다 — 여기서 통과시키면 사람이 "깨진 걸 들었는데 그냥 나갔다"가 된다.
  if (hasBrokenText(text)) return res.status(400).json({ error: brokenTextMessage('문구') })
  // **합성 전에 방송과 같은 민감정보 검사를 한다**(전문가 2차 검토 4-2). 미리듣기만 이 검사 없이
  // 합성해서, Azure 를 골랐거나 이 PC 음성이 실패해 Azure 로 넘어가면 방송에선 막히는 번호가
  // Microsoft 로 나갔다. 차단 항목(주민번호·휴대폰번호·생년월일)만 막는다 — 이름 확인은 저장·방송
  // 때 묻는다(미리듣기마다 확인창을 띄우면 들어 보는 일 자체가 번거로워진다).
  // 판정·문구는 공용 `checkSensitive` 하나 — acknowledged 로 이름 확인(409)만 건너뛴다.
  {
    const v = require('../services/sensitiveInfo').checkSensitive(text, { acknowledged: true, verb: '미리듣기' })
    if (!v.ok) return res.status(v.status).json(v.body)
  }

  // 요청값 우선, 없으면 DB 설정 사용
  const db = getDB()
  const defaults = loadTTSDefaults(db)
  const useVoice = voice ?? defaults.voice
  const useRate  = rate  ?? defaults.rate
  const usePitch = pitch ?? defaults.pitch

  let tmpFile = null
  try {
    tmpFile = await generateTTSWithRetry({
      text:  text.trim(),
      voice: useVoice,
      rate:  rateToStr(useRate),
      pitch: pitchToStr(usePitch),
      ...(sid != null && sid !== '' ? { sid: 번호읽기(sid, 0, 9) } : {}),
      ...(pauseMs != null && pauseMs !== '' ? { 쉼: 쉼읽기엄격(pauseMs) } : {}),
    })

    res.setHeader('Content-Type', mimeOf(tmpFile))
    res.setHeader('Content-Disposition', `inline; filename="preview.${/\.wav$/i.test(tmpFile) ? 'wav' : 'mp3'}"`)

    const stream = fs.createReadStream(tmpFile)
    stream.pipe(res)
    stream.on('end',   () => deleteTmpFile(tmpFile))
    stream.on('error', () => deleteTmpFile(tmpFile))

  } catch (err) {
    console.error('[TTS/preview]', err.message)
    if (tmpFile) deleteTmpFile(tmpFile)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/tts/broadcast
 * TTS 방송: DB 설정으로 MP3 생성 → 로그 저장 → 서버 스피커로 재생 (클라이언트 스트리밍 없음)
 * priority=true면 현재 재생 중단 후 즉시 재생 (비상방송)
 */
/**
 * POST /api/tts/prepare — **방송 전에 음성을 미리 만들어 둔다** (사용자 신고 2026-09-17 「전반적으로 속도감이 너무 느려」).
 *
 * 「지금 방송」 카드가 뜨면 사람이 문구를 확인하는 몇 초가 있다. 그동안 합성해 캐시에 넣어 두면, 단추를 누른 뒤에는
 * 합성(느린 노트북에서 수 초)을 건너뛰고 차임 → 안내로 바로 간다. **소리를 내지 않고 이력도 남기지 않는다.**
 * 문장·목소리·빠르기·높낮이를 `/broadcast` 와 **같은 함수로** 짓는다 — 하나라도 갈리면 캐시 키가 달라 헛일이 된다.
 * 민감정보 경고가 하나라도 걸리는 문구는 만들지 않는다(사람이 확인하기 전에 바깥 합성 서비스로 보내지 않는다).
 */
// GET /api/tts/engines — 안내 음성 엔진 차례와 각 엔진을 쓸 수 있는지(설정 화면 표시용).
router.get('/engines', (req, res) => {
  try {
    const tts = require('../services/tts')
    // primary = 사람이 고른 「먼저 쓸 엔진」(설정). 실제 맨 앞(order 0)은 그 엔진을 못 쓰면 다음 것이다.
    res.json({ engines: tts.엔진상태(), primary: tts.먼저쓸엔진() })
  }
  catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/tts/engines — 먼저 쓸 엔진을 고른다('supertonic' | 'azure'). 나머지는 뒤에서 받친다.
router.post('/engines', (req, res) => {
  const primary = req.body?.primary
  const tts = require('../services/tts')
  if (!tts.엔진선택값.includes(primary)) {
    return res.status(400).json({ error: `먼저 쓸 엔진은 ${tts.엔진선택값.join(' · ')} 중 하나입니다.` })
  }
  try {
    const { writeSetting } = require('../domain/settingsRead')
    writeSetting(getDB(), 'tts_engine_primary', primary)   // 설정 이력에 남는다
    res.json({ ok: true, primary, engines: tts.엔진상태() })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/prepare', async (req, res) => {
  const { text, repeat = false } = req.body || {}
  if (!text?.trim() || text.length > 2000 || hasBrokenText(text)) return res.json({ ok: false })
  if (require('../services/hardwareMode').hardwareDisabled()) return res.json({ ok: false, 건너뜀: '하드웨어 꺼짐' })
  const { checkSensitive } = require('../services/sensitiveInfo')
  if (!checkSensitive(text, { acknowledged: false, verb: '방송' }).ok) return res.json({ ok: false, 건너뜀: '확인 필요 문구' })
  const db = getDB()
  const d = loadTTSDefaults(db)
  // 응답은 바로 한다 — 화면은 기다리지 않는다. 실패해도 방송 때 다시 만든다.
  res.json({ ok: true })
  try {
    const tmp = await generateTTSWithRetry({
      text:  require('../domain/broadcastDefaults').반복문안(text.trim(), !!repeat),
      voice: d.voice, rate: rateToStr(d.rate), pitch: pitchToStr(d.pitch),
    // 미리 만들기 — 합성 줄 맨 뒤. 곧 「지금 방송」을 누르면 그 방송이 합류하며 순위를 올린다(tts.js).
    }, 3, { priority: 0 })
    deleteTmpFile(tmp)
  } catch (e) { console.warn('[음성 미리 만들기] 실패(방송 때 다시 만듭니다):', e.message) }
})

router.post('/broadcast', async (req, res) => {
  // ── 즉시 TTS 가 **예약 경로가 주던 것을 잃지 않게** 한다 (사용자 지시 2026-09-14) ──
  // 「지금 방송」을 예약 경로에서 이리로 옮긴다(차임이 붙는 길이 여기뿐이라). 그런데 차임만
  // 보고 갈아타면 **안내 음량 · 2회 반복**을 잃는다 — 카드에 토글이 남아 있는데 서버가
  // 조용히 무시하면 그게 가장 나쁜 상태다. 둘 다 **선택 인자**라 안 주면 예전 그대로다
  // (「누르고 말하기」에 회귀가 없다).
  const {
    text, voice, target = '전체', user = '방송담당', priority = false,
    chimeStart = false, chimeEnd = false,
    // 이 방송에만 쓸 안내 음량(0~100). 예약의 `main_volume` 에 해당한다.
    // **0 은 명시적 무음이라 유효한 값**이다(볼륨 규칙).
    volume = null,
    // 「방송 2회 반복」 — 문장은 `domain/broadcastDefaults.반복문안` 하나가 짓는다.
    repeat = false,
    // ── **방송 전후 BGM·지연** (사용자 승인 범위, B-2) ───────────────────────────
    // 예약 경로가 주던 것을 즉시 방송이 잃지 않게 한다. 값의 뜻은 예약 행의 칸 이름과
    // **같다** — 화면이 이름을 새로 짓지 않는다(`resolveBGM` 이 그 이름으로 읽는다).
    // 안 주면 `null` 이라 예전 그대로 BGM 없이 나간다(「누르고 말하기」에 회귀가 없다).
    bgm = null,   // { bgm_type, bgm_value, bgm_title, bgm_delay, bgm_end_delay, bgm_volume }
  } = req.body

  // 대시보드 "TTS 방송" 스위치 — 이 라우트는 사람이 직접 누르는 TTS 방송(즉시방송/즐겨찾기)
  // 전용이다. 자동방송(아침 방송 등)은 services/tts를 직접 호출하므로 이 스위치와 무관하며,
  // 여기서 막아도 예약·자동 방송은 정상적으로 나간다.
  //
  // 단 비상방송(화재/실종/응급)은 priority=true로 이 경로를 쓰기 때문에 절대 막지 않는다 —
  // 안전 스위치가 안전을 막아버리는 상황을 만들면 안 된다.
  if (!priority && require('../services/features').blockIfDisabled(res, 'tts', 'TTS 방송')) return

  if (!text?.trim()) return res.status(400).json({ error: '텍스트를 입력해주세요.' })

  // **범위를 벗어난 음량은 조용히 자르지 않는다.** 자르면 사람이 고른 값과 나가는 소리가
  // 갈리고 그 어긋남은 아무 데도 안 남는다(`POST /api/audio/volume` 과 같은 규칙).
  let 볼륨값 = null
  if (volume !== null && volume !== undefined && volume !== '') {
    const v = Number(volume)
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return res.status(400).json({ error: '음량은 0~100 사이의 숫자여야 합니다.' })
    }
    볼륨값 = Math.round(v)
  }

  // 깨진 글자(U+FFFD)를 그대로 읽어 내보내지 않는다(domain/text.js). 이력에는 성공으로 남아서,
  // 나중에 보면 무슨 방송이었는지 아무도 모른다. 비상방송도 예외가 아니다 — 깨진 채로 나가면
  // 안내가 안 되는 건 마찬가지다.
  if (hasBrokenText(text)) return res.status(400).json({ error: brokenTextMessage('방송 문구') })

  // 민감정보 검사 — 한 번 나간 방송은 되돌릴 수 없으므로 스피커로 나가기 전에 막는다.
  // 비상방송도 예외 없이 검사한다(사용자 결정) — 이름은 어차피 경고라 실종자 찾는 방송은 가능하다.
  {
    const { checkSensitive } = require('../services/sensitiveInfo')
    const verdict = checkSensitive(text, { acknowledged: !!req.body.ackWarnings, verb: '방송' })
    if (!verdict.ok) return res.status(verdict.status).json(verdict.body)
  }

  // ── **같은 방송이 두 번 나가지 않게** (사용자 지시 2026-09-14) ──────────────────
  // 화면 단추를 잠가도 서버에 요청이 두 번 닿는 길이 남는다 — 응답이 늦어 브라우저가
  // 재시도하거나, 다른 PC 에서 같은 것을 누르거나, 잠그기 전에 손가락이 두 번 닿는다.
  // 전관 스피커로 나간 소리는 되돌릴 수 없으므로 **마지막 방어선은 여기**다.
  //
  // **검사를 여기 두는 이유**: 위의 되돌리기(400) 검사들보다 **뒤**다 — 거절될 요청이
  // 열쇠를 잡으면 안 된다. 그리고 합성(수 초)보다 **앞**이다 — 뒤에 두면 그 사이에 둘째
  // 요청이 이미 합성을 시작한다. 푸는 자리는 **재생이 끝나는 순간**이다(시간 창이 아니다).
  const 겹침 = require('../services/duplicateBroadcast')
  const 열쇠 = 겹침.방송열쇠({ text, target, voice, priority, volume: 볼륨값, repeat })
  const 자물쇠 = 겹침.겹침잠금(열쇠)
  if (!자물쇠.ok) {
    // **조용히 버리지 않는다** — 안 나간 이유를 화면이 말할 수 있어야 한다.
    return res.status(409).json({
      error: '같은 방송이 지금 나가고 있습니다. 끝난 뒤에 다시 눌러 주세요.',
      duplicate: true,
    })
  }

  const db = getDB()

  // 방송은 항상 DB에 저장된 설정을 기준으로 실행 (비상방송은 비상 음성 사용)
  const defaults = loadTTSDefaults(db, { priority })
  const useVoice = voice ?? defaults.voice  // 즐겨찾기는 자체 voice 사용 가능
  const useRate  = defaults.rate
  const usePitch = defaults.pitch

  let tmpFile = null
  // **`try` 밖에 둔다** — 합성이 실패했을 때 `catch` 에서도 깔아 둔 반주를 걷어야 한다.
  let bgm푼것 = null
  try {
    tmpFile = await generateTTSWithRetry({
      // **반복 문장은 짓는 자리가 하나다** — 예약·순서·예상시간과 같은 함수를 쓴다.
      // 여기서 따로 조립하면 합성 캐시 키가 갈려 미리 만들어 둔 것이 버려진다.
      text:  require('../domain/broadcastDefaults').반복문안(text.trim(), repeat),
      voice: useVoice,
      rate:  rateToStr(useRate),
      pitch: pitchToStr(usePitch),
    // 합성 줄에서 **비상이 맨 앞**이다(Supertonic 은 한 번에 하나만 만든다 — ttsEngines/supertonic.js).
    }, 3, { priority: priority ? 2 : 1 })

    // 방송 로그 저장. **성공은 아직 모른다** — 아래 재생이 끝나야 안다(P-61).
    // 그래도 여기서 먼저 넣는다: 프로세스가 죽어도 "시도했다"는 사실은 남아야 하고,
    // 흐름 쪽도 같은 규칙이다(`flowOutcome.js` 가 나중에 FAILED 로 정정한다).
    // 낙관적으로 1 을 넣고 **재생이 거절되면 0 으로 되돌린다.**
    const 이력id = 시작기록(db, { type: 'TTS', content: text.trim(), user, target })

    // 설정된 오디오 출력 장치로 재생 (미설정 시 기본 장치)
    const deviceName = rawSetting(db, 'audio_device') || ''
    const { index: deviceIndex, warning: deviceWarning } = await resolveDeviceIndex(deviceName)

    // 차임벨/종료음은 별도 재생 경로(chimePlayer)라 audioQueue와 직접 순서를 못 맞춘다.
    // 시작 차임벨은 InstantBroadcast.jsx와 같은 방식(재생 후 일정 시간 대기)으로 겹침을 피하고,
    // 종료음은 enqueue()가 반환하는 Promise가 "실제 재생 완료" 시점에 resolve되는 걸 이용해
    // TTS 재생이 끝난 뒤 정확히 이어서 재생한다.
    // ── **BGM 이 나가는 중이면 차임은 건너뛴다** (사용자 결정 2026-09-13) ────────────
    // *"BGM 이 나가고 있을 때 TTS 넣으면 차임벨 넣으면 안 되겠지?"* — BGM 위에 차임까지
    // 때리면 소리가 셋이 겹친다. 판정은 `chimePlayer.부수차임막힘()` 한 곳에 있고,
    // **사람이 명시한 차임**(예약 유형 `chime`·흐름의 차임 단계·마이크)에는 안 걸린다.
    // 한 번만 묻는다 — 시작음과 종료음 사이에 BGM 이 꺼지면 시작은 건너뛰고 종료만
    // 울리는 반쪽이 된다. 한 방송의 시작·끝은 같은 판정을 따라야 한다.
    // ── **방송 전 BGM 을 먼저 깐다** (B-2, 사용자 승인 범위) ─────────────────────
    // 예약 경로에서는 브라우저가 이 일을 했다(`scheduled_broadcast` 에 `bgm` 을 실어 보냈다).
    // 즉시 경로는 **안내를 서버 스피커가** 내므로 그 순서를 서버가 짠다 — 흐름(`flowRunner`)이
    // 이미 같은 모양으로 한다. **해석은 `resolveBGM` 한 곳**이다(사본을 두면 예약과 갈린다).
    //
    // **차임보다 먼저다.** 차임은 BGM 이 나가고 있으면 스스로 비킨다(`부수차임막힘`) —
    // 그 판정이 옳게 돌려면 BGM 이 이미 시작돼 있어야 한다. 순서를 바꾸면 셋이 겹친다.
    //
    // **BGM 은 브라우저가 낸다.** 현장에 창이 없으면 안내는 나가지만 반주는 안 나간다 —
    // 그 사실을 숨기지 않고 로그로 남긴다(무음을 조용히 성공으로 적지 않는다).
    if (bgm && (bgm.bgm_type || bgm.bgm_value || bgm.bgm_title)) {
      try {
        bgm푼것 = await require('../services/broadcastConfig').resolveBGM(db, { ...bgm, bgm_enabled: 1 })
      } catch (e) { console.warn('[즉시방송] BGM 해석 실패(안내는 계속한다):', e.message) }
      if (bgm푼것) {
        if (!require('../services/sitePlayer').hasSitePlayer()) {
          console.warn('[즉시방송] 현장에 방송 화면이 없어 BGM 은 안 나갑니다 — 안내만 나갑니다')
        }
        // 신호(bgm_start)를 내는 곳은 bgmEmit 하나다.
        require('../services/bgmEmit').emitBGM(bgm푼것)
        // 깔아 두는 시간. 예약의 `bgm_delay` 와 **같은 뜻·같은 기본값**(5초)이다.
        await new Promise(r => setTimeout(r, Math.max(0, Number(bgm.bgm_delay ?? 5)) * 1000))
      } else {
        console.warn('[즉시방송] BGM 을 못 골랐습니다 — 안내만 나갑니다')
      }
    }

    // 이 방송이 방금 **로컬 반주**를 깔았으면 그것도 「BGM 이 흐르는 중」이다(2026-09-21 코드 검수).
    // `부수차임막힘` 은 nowPlaying.bgm 을 보는데, 현장 재생기가 알려 오는 것은 350ms 뒤라 여기서 못 본다
    // — 그러면 반주 위에 차임, 그 위에 안내까지 셋이 겹친다(사용자 결정 2026-09-13 을 로컬에서만 어긴다).
    const 차임막힘 = 부수차임막힘() || (bgm푼것?.kind === 'local' ? 'BGM 반주 중이라 부수 차임은 건너뜁니다' : null)
    if (차임막힘 && (chimeStart || chimeEnd)) console.log(`[차임벨] ${차임막힘}`)

    if (chimeStart && !차임막힘) {
      // ── P-8: 차임이 안 울리면 그 사실을 남긴다 ──────────────────────
      // 수동 차임 세 곳은 이력 행이 **아예 없어서** 실패가 어디에도 안 남았다.
      // **성공은 안 남긴다** — 이 차임은 위 TTS 방송의 일부이고 그 행이 이미 있다.
      // 아무도 못 보는 것은 실패 쪽이다(예약 차임은 ISSUE-002 수정으로 이미 남긴다).
      // **차임이 실제로 울리기 시작한 뒤** 여유를 두고 안내를 낸다(`chimePlayer.차임뒤대기`, 2026-09-17 겹침 신고).
      const 표지 = 차임시작표지(), t0 = Date.now()
      const 신호옴 = playChime('general', null, (ok) => {
        표지.끝남()
        if (!ok) 실패기록(db, { type: '차임벨', content: '즉시 방송 시작 차임벨 재생 실패' })
      }, 표지.onStart)
      broadcastSSE('chime_play', { type: 'general' })
      await 차임뒤대기({ 신호옴, 표지, t0, 기본ms: CHIME_LEAD_MS })
    }

    // 서버 스피커로 비동기 재생 — 재생 완료 후 임시 파일 삭제(+ 종료음)
    // 시작·끝을 SSE로 알린다(위 speakGen 주석) — 화면(useScheduledBroadcast)이 예약 TTS와
    // 같은 덕킹 이벤트(carecast:broadcast-tts-start/end)로 바꿔 쏜다. 누른 PC가 아니라
    // BGM을 틀고 있는 창이 낮춰야 하므로 window 이벤트로는 부족하다.
    const gen = ++speakGen
    broadcastSSE('tts_speak', { state: 'start' })
    // 음량은 **이 재생에만** 쓴다 — 슬라이더나 저장된 기본값을 건드리지 않는다
    // (볼륨 규칙 1순위: "방송 이벤트에 실린 값, 이 방송에만, 저장 안 함").
    enqueue(tmpFile, !!priority, deviceIndex, 볼륨값)
      .then(async () => {
        // ── **끝나면 BGM 을 끈다** — 끄지 않으면 반주만 남아 계속 흐른다 ─────────────
        // `bgm_end_delay` 는 예약의 같은 이름과 **같은 뜻**이다(안내가 끝난 뒤 몇 초 더
        // 깔아 둘지). 기본 0 — 예약 쪽 기본값과 맞춘다.
        // **성공했을 때만 이 지연을 지난다.** 실패는 아래 `finally` 가 곧바로 끈다 —
        // 안 나간 방송의 여운을 기다릴 이유가 없다.
        if (bgm푼것) {
          const 끝지연 = Math.max(0, Number(bgm?.bgm_end_delay ?? 0)) * 1000
          if (끝지연) await new Promise(r => setTimeout(r, 끝지연))
        }
        // 위에서 한 번 판정한 것을 그대로 쓴다 — 시작은 건너뛰고 종료만 울리면 반쪽이다
        if (chimeEnd && !차임막힘) {
          playChime('end', null, (ok) => {
            if (!ok) 실패기록(db, { type: '차임벨', content: '즉시 방송 종료 차임벨 재생 실패' })
          })
          broadcastSSE('chime_play', { type: 'end' })
        }
      })
      .catch(err => {
        // ── P-61: 소리가 안 났으면 이력도 그렇게 적는다 ──────────────────
        // 예전엔 로그 한 줄이 전부였다. 그래서 재생이 거절돼도(하드웨어 없음 · 백엔드 오류 ·
        // 비상방송 교체 · 제한시간) **이력에는 성공으로 남았다** — 이 저장소에서 가장 비싼
        // 실패다(무음인데 기록은 멀쩡하다). 흐름 쪽은 이미 이렇게 정정한다.
        console.error('[TTS/broadcast/play]', err.message)
        실패로정정(db, 이력id, err.message)
        // **화면에도 알린다.** 응답(「내보냈습니다」)은 이미 나갔다 — 재생은 그 뒤에 거절되므로,
        // 이력만 고치면 누른 사람은 소리가 안 난 것을 모른다. 일부러 끊은 것·이미 경보가 난 것·
        // 소리 끔 모드는 빼고 **진짜 실패만** 띄운다(`audioQueue` 의 `거절` 종류).
        if (!err.종류) {
          try {
            const 문구 = String(text || '').trim()
            require('../services/alert').raise('즉시방송',
              `「${문구.slice(0, 20)}${문구.length > 20 ? '…' : ''}」 방송이 스피커로 나가지 못했습니다 — ${err.message}`)
          } catch (e) { console.error('[즉시방송] 경보 전달 실패:', e.message) }
        }
      })
      .finally(() => {
        // ── **반주는 성공·실패 **한 자리**에서 끈다** (V③ R9 지적, 2026-09-14) ────────
        // 처음에는 성공 콜백에서만 껐다. 그런데 재생은 **거절될 수 있다**(장치 없음 ·
        // 백엔드 오류 · 비상방송 교체 · 제한시간 — `audioQueue` 가 그때 reject 한다).
        // 그러면 **안내는 안 나갔는데 반주만 무기한 흐른다.** 화면도 스스로 못 끈다 —
        // 우리가 `durationMin`·`durationSec` 을 0 으로 보내서 자동 종료 타이머가 안 선다
        // (`useScheduledBroadcast.js:303-315`).
        //
        // **알려진 한계**: 이 정지에는 임자 표시가 없다. 우리가 반주를 깐 뒤 다른 방송이
        // 제 반주를 시작했다면 이 정지가 그것도 끈다. 시작(`bgm_start`)이 이미
        // 앞 반주를 갈아 치우므로 창은 좁지만 **0 은 아니다** — 화면 쪽 계약(`bgm_stop` 에
        // 대상이 없다)을 바꿔야 닫히는 자리라 여기 적어 둔다.
        if (bgm푼것) broadcastSSE('bgm_stop', {})
        if (gen === speakGen) broadcastSSE('tts_speak', { state: 'end' })
        deleteTmpFile(tmpFile)
        // **여기가 잠금을 푸는 자리다** — 「아직 나가고 있나」가 규칙이라, 재생이 끝나야
        // 같은 방송을 다시 내보낼 수 있다. 일부러 하는 재방송은 이 순간부터 열린다.
        자물쇠.풀기()
      })

    // MP3 생성 + 대기열 등록 완료 즉시 응답 (장치 미발견 시 경고 포함)
    res.json({ ok: true, ...(deviceWarning ? { deviceWarning } : {}) })

  } catch (err) {
    console.error('[TTS/broadcast]', err.message)
    // 합성이 실패해 재생까지 못 갔다 — **여기서도 풀어 준다.** 안 풀면 그 문구가
    // 상한(60초)까지 막힌다. 두 번 풀어도 안전하다(`duplicateBroadcast.풀기`).
    자물쇠.풀기()
    // **깔아 둔 반주도 걷는다.** 안 걷으면 안내는 안 나갔는데 음악만 계속 흐른다 —
    // 사람이 「방송이 나가는 중」으로 읽는다.
    try { if (bgm푼것) broadcastSSE('bgm_stop', {}) } catch { /* 이미 끊긴 연결 */ }
    if (tmpFile) deleteTmpFile(tmpFile)

    // 방송 실패 로그 저장 — 단일 출처를 지난다(`domain/broadcastRecord.js`).
    // 여기는 **아직 행이 없는** 경우다(TTS 생성이 실패해 재생까지 못 갔다).
    실패기록(db, { type: 'TTS', content: text?.trim() || '', user, target })

    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.loadTTSDefaults = loadTTSDefaults
