// 마이크 즉시 방송 — 브라우저에서 녹음한 WAV를 받아 서버 스피커로 재생
const express  = require('express')
const multer   = require('multer')
const os       = require('os')
const fs       = require('fs')
const { enqueue }      = require('../services/audioQueue')
const { getDB }        = require('../db/schema')
const { rawSetting }   = require('../domain/settingsRead')
const { resolveDeviceIndex } = require('../services/audioDevices')
const { playChunk }    = require('../services/audioPlayer')
const { playChime, CHIME_TIMEOUT_MS, CHIME_MAX_STAGES } = require('../services/chimePlayer')
const { 차임시작표지 } = require('../services/chimeTiming')
const { broadcastSSE } = require('../services/sse')
const { 시작기록, 실패로정정, 실패기록 } = require('../domain/broadcastRecord')

const router = express.Router()

// WAV 파일을 고유 이름으로 임시 디렉터리에 저장
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => { cb(null, `mic_${Date.now()}.wav`) },
})
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })

// POST /api/mic/broadcast — 마이크 녹음(WAV) 수신 → 서버 스피커 재생
router.post('/broadcast', upload.single('audio'), async (req, res) => {
  if (require('../services/features').blockIfDisabled(res, 'mic', '실시간 마이크')) return
  if (!req.file) return res.status(400).json({ error: '오디오 파일이 없습니다.' })

  const tmpFile = req.file.path

  // **설정된 출력 장치로 낸다** — TTS 방송(routes/tts.js)과 같은 규칙이다. 예전엔 이 한
  // 인자를 안 넘겨서 마이크 방송만 기본 장치로 나갔다. 안내 음성은 스피커, 사람 목소리는
  // 딴 데로 갈라지는데 어느 쪽에서도 오류가 안 나 아무도 모른다.
  const deviceName = rawSetting(getDB(), 'audio_device') || ''
  const { index: deviceIndex } = await resolveDeviceIndex(deviceName)

  // ── P-62: 마이크 방송도 이력에 남긴다 ────────────────────────────────
  // 예전엔 이 라우트 전체에 `INSERT INTO broadcasts` 가 **0건**이었다. 그래서 사람 목소리가
  // 나갔는지 안 나갔는지 **알 방법이 없었다** — 앞 재생이 매달려 10분 대기하다 거절돼도
  // 로그 한 줄뿐이고, 응답은 재생 전에 이미 `{ok:true}` 로 나간 뒤다.
  // 규칙은 `domain/broadcastRecord.js` 한 곳에 있다 — 즉시 TTS 와 **같은 것**을 쓴다.
  // 내용은 고정 문구다. 음성이라 글이 없고, 어르신 이야기가 섞일 수 있는 자리다.
  const db = getDB()
  const 이력id = 시작기록(db, { type: '마이크', content: '마이크 방송(녹음)' })

  // 대기열에 추가 (비동기 재생), 완료 후 임시 파일 삭제
  enqueue(tmpFile, false, deviceIndex)
    .catch(err => 실패로정정(db, 이력id, err.message))
    .finally(() => { try { fs.unlinkSync(tmpFile) } catch { /* 재생이 끝난 임시 파일 청소 — 이미 없거나 잠겨 있어도 방송 결과는 바뀌지 않는다 */ } })

  res.json({ ok: true })
})

// POST /api/mic/chime — 차임벨 재생 (서버 스피커 + 브라우저 Web Audio)
// ── **차임은 한 번에 하나만, 결과를 알려 준다** (V③ UI-0915-R1 지적, 2026-09-15) ────
//
// 앞 판은 `playChime` 을 쏘고 **곧바로 `{ok:true}`** 를 돌려줬다. 그래서:
//   · 화면이 그 응답으로 잠금을 풀었다 — **연타 방지 창이 HTTP 왕복 시간(수 ms)** 뿐이었다.
//     검수관이 실제로 완료 전 요청 둘을 통과시켜 보였다.
//   · 재생이 **실패해도 화면은 성공으로 본다.** 콜백은 이력에만 적고 응답은 이미 나갔다.
//     조용한 실패 — 이 저장소에서 가장 비싼 부류다.
//
// ── **기다림은 고르는 것이고, 잠금은 재생에 매인다** (V③ UI-0915-R2 정정) ─────────
//
// 앞 판(R1 수정)은 **모든 호출자를 기다리게** 만들었다. 그게 두 가지를 깼다:
//
//  ① **「누르고 말하기」의 첫 마디가 잘린다.** `InstantBroadcast` 는 차임을 쏘고
//     **2.6초를 더 기다린 뒤** 목소리를 보내기 시작한다 — 접수 응답이 바로 온다는 전제로
//     맞춰 둔 값이다. 응답이 재생 끝까지 늦어지면 그 2.6초가 **차임 뒤에** 붙어서,
//     차임을 듣고 말하기 시작한 직원의 첫 음성이 안 나간다. 검수관이 짚었다.
//  ② **상한이 지나면 잠금만 풀고 재생은 그대로 뒀다.** 재생기의 제 상한은 30초라
//     (`chimePlayer.CHIME_TIMEOUT_MS`), 10초에 잠금을 풀면 다음 차임과 겹친다.
//
// 그래서 **둘을 갈랐다.**
//   · **잠금**은 `재생끝` 약속에 매인다 — 재생이 끝나야 풀린다. 응답과 무관하다.
//   · **기다림**은 `?wait=1` 로 **고른다.** 결과를 알고 싶은 쪽(차임 발사 단추)만 기다리고,
//     빨리 돌아와야 하는 쪽(마이크·즐겨찾기)은 예전 그대로 접수만 받는다.
//     **계약을 바꾸지 않고 하나 더 준다** — 부르던 쪽을 조용히 느리게 만들지 않는다.
const 차임기다림상한ms = 12_000
// ── 잠금 상한은 **재생기에서 계산한다** (V③ UI-0915-R3 정정) ─────────────────────
// 앞 판은 `40_000` 을 손으로 적고 *"재생기 상한(30초)보다 길다"* 고 적었다.
// **한 단계만 세고 있었다** — `watchChild` 는 **프로세스마다** 상한을 걸고, 윈도우가
// 아닌 곳에서는 합성과 재생이 **둘로 나뉜다**(최악 60초). 합성이 25초 걸린 날
// 40초에 잠금이 먼저 풀려 다음 차임이 앞 재생과 겹친다. 검수관이 실행으로 보였다.
//
// 그래서 **숫자를 베끼지 않고 가져다 곱한다.** 재생기가 상한을 바꾸면 여기가 따라간다.
// 여유 10초는 프로세스 정리·콜백 전달에 드는 시간이다.
const 차임잠금상한ms = CHIME_TIMEOUT_MS * CHIME_MAX_STAGES + 10_000

/** 지금 울리고 있는 차임의 완료 약속. 끝나면 `null`. **겹쳐 울리는 것을 서버에서 막는다.** */
let 차임재생끝 = null

router.post('/chime', async (req, res) => {
  const type = req.query.type || 'general'
  const 기다릴까 = req.query.wait === '1'
  // 화면 잠금만으로는 모자라다 — **다른 PC·다른 창**에서도 누를 수 있다(페르소나 P3).
  if (차임재생끝) return res.status(409).json({ error: '차임벨이 이미 울리고 있습니다.' })

  broadcastSSE('chime_play', { type })   // 브라우저 Web Audio API 트리거

  const 표지 = 차임시작표지()
  let 신호옴 = false
  const 재생끝 = new Promise((resolve) => {
    let 끝났나 = false
    const 끝 = (ok) => { if (!끝났나) { 끝났나 = true; resolve(ok) } }
    // 콜백이 아예 안 와도 **잠금은 반드시 풀린다.** 막으려던 것(겹침)보다 나쁜 결과
    // (영영 안 울림)를 만들지 않는다 — `duplicateBroadcast` 의 「열쇠가 끼는 것」과 같다.
    const 빗장 = setTimeout(() => 끝(null), 차임잠금상한ms)
    // P-8 — 차임이 안 울리면 남긴다. 이 라우트는 차임 하나만 내므로 덮어 줄 행이 없다.
    신호옴 = playChime(type, null, (ok) => {      // 서버 스피커 (Python sounddevice)
      clearTimeout(빗장)
      if (!ok) 실패기록(getDB(), { type: '차임벨', content: `수동 차임벨(${type}) 재생 실패` })
      끝(!!ok)
    }, 표지.onStart)
  })
  // **잠금은 재생이 끝날 때 풀린다** — 응답이 언제 나가든 상관없다.
  차임재생끝 = 재생끝
  재생끝.finally(() => { if (차임재생끝 === 재생끝) 차임재생끝 = null })

  // 안 기다리는 쪽은 **예전 그대로** 접수만 받는다(마이크·즐겨찾기의 타이밍을 안 건드린다).
  // **소리가 실제로 나기 시작한 뒤에** 답한다(2026-09-17 겹침 신고). 화면은 답을 받고 2.6초 뒤 말을 시작하는데,
  // 느린 PC 에서 차임이 늦게 울리면 그 사이가 겹쳤다. 신호를 못 주는 경로는 예전처럼 곧바로 답한다(상한 5초).
  if (!기다릴까) {
    if (신호옴) await Promise.race([표지.약속, 재생끝, new Promise((r) => setTimeout(r, 5000))])
    // 실제로 울리기 시작했는지 알린다 — 화면은 이미 울리고 있으면 여유만큼만(1.8초) 더 기다린다.
    // 예전엔 시작을 기다린 뒤에도 2.6초를 통째로 더 기다려 말이 늦게 나갔다(2026-09-17 느림 신고).
    return res.json({ ok: true, 발사됨: true, 울리는중: 표지.시각() != null })
  }

  // 기다리는 쪽에도 상한이 있다 — 응답이 영영 안 나가면 화면이 멎은 것처럼 보인다.
  // **이 상한은 잠금과 별개다**(잠금은 위에서 따로 풀린다).
  const 결과 = await Promise.race([
    재생끝,
    new Promise((r) => setTimeout(() => r('모름'), 차임기다림상한ms)),
  ])

  if (결과 === true) return res.json({ ok: true })
  if (결과 === false) return res.status(500).json({ error: '차임벨을 재생하지 못했습니다.' })
  // 시간 안에 답이 안 왔다 — 났는지 안 났는지 **모른다.** 성공으로 꾸미지 않는다.
  return res.status(504).json({ error: '차임벨이 났는지 확인하지 못했습니다. 소리를 들어 보세요.' })
})

// POST /api/mic/stream — 실시간 오디오 청크 수신 → 서버 스피커 즉시 재생
router.post('/stream', express.raw({ type: 'application/octet-stream', limit: '2mb' }), (req, res) => {
  if (require('../services/features').blockIfDisabled(res, 'mic', '실시간 마이크')) return
  if (!req.body?.length) return res.status(400).json({ error: '데이터 없음' })
  // 신호등은 **실제로 재생 경로에 들어간 청크만** 켠다(레드 검증 발견2) — 플레이어가
  // 안 떠 있는데 켜면 "표시는 나는데 소리는 없는" 상태가 되고, 배지가 있으니 아무도
  // 확인하러 안 간다. 이 기능이 고치려던 신고의 정반대 실패다.
  // **누가 보냈는지 실어 보낸다**(P-63). 화면이 이미 붙여 보내는 탭 이름표를 그대로 쓴다 —
  // 소리 담당을 정할 때 쓰는 것과 **같은 이름표**라 두 벌로 만들지 않는다.
  // 없으면 `undefined` 가 가고, 그때는 예전처럼 지나간다(하위 호환).
  const 보낸이 = req.get('x-carecast-tab') || undefined
  const played = playChunk(req.body, 보낸이)
  if (played) require('../services/micLive').chunkArrived()
  // **남이 쓰고 있으면 그 사실을 알려 준다.** 200 으로 조용히 삼키면 보낸 쪽은
  // 자기 목소리가 나가는 줄 안다 — 이 결함이 고치려던 것과 같은 종류의 침묵이다.
  if (!played && 보낸이 && require('../services/micOwner').지금주인() &&
      !require('../services/micOwner').주인인가(보낸이)) {
    return res.status(409).json({ error: '다른 기기가 마이크 방송 중입니다.' })
  }
  res.json({ ok: true })
})

module.exports = router
