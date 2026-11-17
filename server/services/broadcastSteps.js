// 자동방송 단계 하나하나의 실행기 — TTS·음원·영상·BGM·식사 안내·커스텀 단계.
//
// 왜 별도 파일인가(2026-09-01): broadcastSequencer.js가 1178줄이라 방송 5종의 골격과
// 단계 실행이 한 파일에 섞여 있었다. 골격은 시퀀서에 두고 실행기만 여기로 내린다 —
// 취소·종료 대기와 취소 가능한 딜레이는 broadcastGate, 설정 읽기는 domain/settingsRead,
// 영상 고르기는
// broadcastVideoPicker가 아래층이라 시퀀서를 역참조하지 않는다(순환 없음).
'use strict'

const crypto                                     = require('crypto')
// generateTTSWithRetry 와 BROADCAST_BUDGET_MS 를 **일부러 안 가져온다**(3단계, 2026-09-06).
// 이 파일은 발사 경로다 — 여기서 합성을 시작하면 그 시간이 곧 방송 지연이 된다.
// 소리 확보는 renderOnDemand 가 맡는다(캐시가 먼저, 합성은 예외).
// server/test/step3-no-tts-in-trigger.test.js 가 이 파일에 합성 호출이 없는지 지킨다.
const { deleteTmpFile, readCues, rateToStr, pitchToStr } = require('./tts')
const { broadcastSSE }                           = require('./sse')
const { storeAudio }                             = require('./audioStore')
const { pickSourceFile }                         = require('../domain/categoryPick')
const { 단계사유 }                                = require('../domain/stepHistory')
const { normalizePlaybackRate }                  = require('./scheduleStore')
const nowPlaying                                 = require('./nowPlaying')
const { resolveStepVolume }                      = require('../domain/volume')
const { isCancelled, waitForVideoEnd, waitForAudioEnd, tokenDelay, cancelGeneration } = require('./broadcastGate')
const { getSetting }                           = require('../domain/settingsRead')

// ── 일반 TTS (안내 방송용) ─────────────────────────────────
// opts.ttsVoice: 'female'|'male' — 없으면 DB 설정 사용
// 스텝 하나가 실행부로 넘기는 옵션. 새 스텝 설정이 생기면 여기만 고치면 모든 자동방송에
// 똑같이 반영된다 — 예전엔 호출부 19곳이 stepOpts(step)를 각자 적고 있어서,
// 볼륨 같은 걸 더할 때 한 곳만 빠뜨려도 그 스텝만 조용히 기본값으로 나갔다.
function stepOpts(step = {}) {
  return {
    ttsVoice:      step.ttsVoice,
    useGraceAudio: step.useGraceAudio,
    volume:        step.volume,      // 이 스텝의 주 소리 볼륨(0~100). 없으면 시스템 기본값.
    // 이 스텝의 음원·영상 재생 배속(0.5~1.5). 없으면 정속. 노래방처럼 따라 부르는 방송을
    // 느리게 틀기 위한 값 — 볼륨과 같은 원칙으로 전역 설정을 안 건드린다.
    rate:          step.rate,
    // 영상 단계의 차례(2026-09-21): 'random' | 'seq' | 없음(=예전처럼 맨 앞 파일 하나).
    mediaOrder:    step.mediaOrder,
  }
}

// TTS 대기 시간(ms) — 글자 수와 배속(tts_rate)으로 "말이 끝날 무렵"을 어림한다.
// 4.5자/초는 **기본 배속 0.9를 기준으로** 잡아 둔 상수라, 배속이 바뀌면 같이 움직여야 한다.
// 그래서 rate/0.9로 비례 조정한다 — 배속을 낮추면 음성은 길어지는데 대기가 그대로여서
// 다음 단계가 아직 말하고 있는 목소리 위로 겹쳤다(CC-033). 반대로 올리면 빈 시간이 남았다.
// 배속이 0·음수·숫자가 아니면 기본 배속으로 떨어진다 — settings.tts_rate는 사람이 손으로
// 넣는 값이라 무엇이든 들어올 수 있고, 0으로 나눠 Infinity가 되면 타이머가 통째로 깨진다.
// 하한 6000ms(화면이 재생을 시작할 틈)와 여유분 +3000ms는 배속과 무관하므로 그대로 둔다.
//
// 2026-08-31: 이제 이 값은 **대기 시간이 아니라 안전망의 재료**다. 본안(실제 종료 감지)이
// 들어왔다 — 화면이 재생을 끝내면 토큰으로 알려주고 그때 곧바로 다음 단계로 간다.
// 추정은 남겨 둔다. 현장에 재생 창이 없거나 자동재생이 막히면 아무도 신호를 안 보내는데,
// 그때 영영 멈추면 그날 방송이 통째로 죽는다.
function ttsWaitMs(textLength, rateVal) {
  const parsed = parseFloat(rateVal)
  const rate = Number.isFinite(parsed) && parsed > 0 ? parsed : 0.9
  const charsPerSec = 4.5 * (rate / 0.9)
  return Math.max(6000, Math.ceil(textLength / charsPerSec) * 1000 + 3000)
}

// 안내 음성이 끝나기를 기다린다 — 화면이 보내는 **실제 종료 신호**를 먼저 보고,
// 안 오면 추정 시간에 스스로 넘어간다.
//
// **상한은 추정 그대로다(더 늘리지 않는다).** 늘리면 화면이 없는 PC·자동재생이 막힌
// 브라우저에서 방송 사이가 통째로 길어진다 — 고치려던 것보다 나쁜 회귀다. 그래서 이 변경은
// 어느 경우에도 예전보다 나빠지지 않는다:
//   · 화면이 알려주면 → 추정보다 일찍 끝나고 빈 시간이 사라진다(대부분의 경우)
//   · 아무도 안 알려주면 → 예전과 똑같이 추정 시간을 기다린다
// 남는 한 가지는 "실제 발화가 추정보다 긴데 화면 신호도 늦는" 경우인데, 그건 예전과 같다.
// sinceGen — 재생을 지시하기 **직전**에 읽어 둔 cancelGeneration(). 그 뒤로 취소가 있었다면
// waitForAudioEnd 가 등록하지 않고 곧바로 'cancelled' 로 답한다(broadcastGate.js:130-140 의 계약).
// 안 넘기면 그 검사가 통째로 통과돼 **자동방송 경로에서만 가드가 죽는다** — 흐름은 넘긴다(P-54).
async function awaitTTSEnd(audioToken, title, estimateMs, tok, sinceGen) {
  console.log(`[시퀀서] "${title}" TTS 종료 대기 (상한 ${Math.round(estimateMs / 1000)}초)`)
  const reason = await waitForAudioEnd(audioToken, estimateMs, sinceGen)
  if (reason === 'timeout') {
    // 화면이 없거나 자동재생이 막혔다는 뜻일 수 있다. 소리가 안 났을 가능성이라 남긴다.
    console.log(`[시퀀서] "${title}" 종료 신호 없이 상한 도달`)
  }
  // tok은 취소 판정용이다 — waitForAudioEnd에는 취소 경로가 따로 있어(cancelGeneration)
  // 여기서는 상한만 맡는다. 서명에 남겨 두는 것은 호출부 두 곳의 모양을 같게 하기 위해서다.
  void tok
}

// **번호가 든 안내 문구는 소리로 만들지 않는다**(2026-11-10). 사용자 정의 단계 문구는 저장 때 검사를 받지만,
// 그 검사가 생기거나 규칙이 강해지기 전에 저장된 문구는 그대로 남아 있다(흐름 실행 직전 검사와 같은 이유).
// **번호(주민등록번호·휴대폰번호)만 본다** — 이 길에는 자동으로 지은 문구(일정·날씨·기념일)도 지나가서, 생년월일
// 판정까지 넣으면 「1919년 3월 1일」 같은 옛 날짜에 정상 방송이 멈춘다. 던지면 시퀀서가 이 단계만 실패로
// 적고 경보를 띄운 뒤 방송을 이어 간다. 오류 문구에 원문을 넣지 않는다(이력·경보에 그대로 남는다).
function 번호면막기(text, title) {
  if (require('./sensitiveInfo').번호찾기(String(text ?? '')).length) {
    throw new Error(`「${title || '안내 음성'}」 문구에 개인정보(주민등록번호·휴대폰번호)가 있어 이 단계를 건너뜁니다. 문구를 고쳐 주세요.`)
  }
}

async function stepTTS(db, text, title, tok, opts = {}) {
  if (!text?.trim()) return
  if (isCancelled(tok)) return
  번호면막기(text, title)
  const voiceMap = { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' }
  const voice    = voiceMap[opts.ttsVoice] || getSetting(db, 'tts_voice_morning', 'ko-KR-SunHiNeural')
  const rateVal  = parseFloat(getSetting(db, 'tts_rate',  '0.9')) || 0.9
  const pitchVal = parseFloat(getSetting(db, 'tts_pitch', '1'))   || 1
  const rate  = rateToStr(rateVal)
  const pitch = pitchToStr(pitchVal)
  let tmpFile = null
  try {
    // ── 3단계(2026-09-06) — **여기서 곧바로 합성하지 않는다.** ──────────────
    //
    // 예전에는 이 자리에서 `generateTTSWithRetry(..., { deadlineMs: 15초 })` 를 불렀다.
    // 캐시가 없으면 그 15초를 여기서 다 쓰고, 그래서 12:00 방송이 12:01에 나갔다.
    //
    // 이제 renderOnDemand 가 순서를 정한다 — **캐시가 먼저, 합성은 예외**다.
    // 캐시가 있으면 네트워크를 안 탄다. 없으면 그 사실을 세어 두고(선제 렌더가 제
    // 역할을 못 했다는 신호다) 즉시 만들어 **완료되는 대로** 재생한다.
    // 최악이 "몇 초 늦음"이지 **무음이 아니다.**
    //
    // 유예는 방송 성격이 정한다(domain/broadcastGrace.js):
    //   긴급 → 상한 없음 · {{시각}} 포함 → 30초 · 그 외 → 5분.
    // 넘기면 아래 catch 로 떨어져 그 단계만 건너뛴다(방송 전체는 계속 간다).
    const { resolveGrace } = require('../domain/broadcastGrace')
    const { obtainAudio } = require('./renderOnDemand')
    const grace = resolveGrace({ urgency: opts.urgency, content: text }, (k, d) => getSetting(db, k, d))
    const got = await obtainAudio({ text, voice, rate, pitch }, { graceMs: grace.ms, title: title || '자동방송' })
    tmpFile = got.file
    if (isCancelled(tok)) { deleteTmpFile(tmpFile); return }
    // 자막은 storeAudio 전에 읽는다 — 넘긴 뒤에는 화면이 받아 가면서 파일이 지워진다.
    // `?.`인 이유: 자막은 곁다리다. 여기서 던지면 단계가 통째로 죽어 **소리가 안 나간다.**
    // 자막이 없는 방송은 멀쩡한 방송이지만, 소리가 없는 방송은 실패다.
    const cues = readCues?.(tmpFile, text) ?? null
    const audioId = storeAudio(tmpFile)
    tmpFile = null
    // 이 스텝에만 쓸 안내 음성 볼륨. 화면은 이 재생에만 적용하고 자기 슬라이더는 안 건드린다.
    // token: 화면이 재생을 끝내면 이 값으로 알려준다(POST /api/morning/audio-ended) —
    // 음원 재생(prayer_play)이 이미 쓰던 길과 같다.
    const audioToken = crypto.randomBytes(8).toString('hex')
    const sinceGen = cancelGeneration()   // 지시 직전에 읽는다(P-54)
    broadcastSSE('scheduled_broadcast', {
      title: title || '자동방송', content: text, target: '전체', audioId,
      ttsVolume: resolveStepVolume(db, opts, 'tts'),
      token: audioToken,
      cues,   // 어절 시각(없으면 null) — 화면이 자막을 못 띄워도 소리는 그대로 나간다
    })
    // 첫 재생 지시 시각을 남긴다 — 예정 시각에서 여기까지가 사람이 느끼는 지연이다.
    // 재기만 한다(laneTiming 은 아무것도 막지 않는다). 처음 한 번만 찍힌다.
    try { require('./laneTiming').markFirstAudio(require('./runContext').currentRunId()) } catch { /* 계측이 방송을 죽이면 안 된다 */ }
    await awaitTTSEnd(audioToken, title, ttsWaitMs(text.length, rateVal), tok, sinceGen)
  } finally {
    if (tmpFile) deleteTmpFile(tmpFile)
  }
}

// ── 차분한 안내 TTS (식사 안내용 — 느린 속도, 낮은 피치) ──
async function stepPrayerTTS(db, text, title, tok, opts = {}) {
  if (!text?.trim()) return
  if (isCancelled(tok)) return
  번호면막기(text, title)
  const voiceMap = { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' }
  const voice = (opts.ttsVoice && voiceMap[opts.ttsVoice]) || getSetting(db, 'tts_voice_morning', 'ko-KR-SunHiNeural')
  const rate  = rateToStr(0.80)   // 0.9보다 느리게 (경건한 분위기)
  const pitch = '+0Hz'            // 피치 고정 — 자연스럽고 일정한 톤
  let tmpFile = null
  try {
    // ── 3단계(2026-09-06) — **여기서 곧바로 합성하지 않는다.** ──────────────
    //
    // 예전에는 이 자리에서 `generateTTSWithRetry(..., { deadlineMs: 15초 })` 를 불렀다.
    // 캐시가 없으면 그 15초를 여기서 다 쓰고, 그래서 12:00 방송이 12:01에 나갔다.
    //
    // 이제 renderOnDemand 가 순서를 정한다 — **캐시가 먼저, 합성은 예외**다.
    // 캐시가 있으면 네트워크를 안 탄다. 없으면 그 사실을 세어 두고(선제 렌더가 제
    // 역할을 못 했다는 신호다) 즉시 만들어 **완료되는 대로** 재생한다.
    // 최악이 "몇 초 늦음"이지 **무음이 아니다.**
    //
    // 유예는 방송 성격이 정한다(domain/broadcastGrace.js):
    //   긴급 → 상한 없음 · {{시각}} 포함 → 30초 · 그 외 → 5분.
    // 넘기면 아래 catch 로 떨어져 그 단계만 건너뛴다(방송 전체는 계속 간다).
    const { resolveGrace } = require('../domain/broadcastGrace')
    const { obtainAudio } = require('./renderOnDemand')
    const grace = resolveGrace({ urgency: opts.urgency, content: text }, (k, d) => getSetting(db, k, d))
    const got = await obtainAudio({ text, voice, rate, pitch }, { graceMs: grace.ms, title: title || '자동방송' })
    tmpFile = got.file
    if (isCancelled(tok)) { deleteTmpFile(tmpFile); return }
    const cues = readCues?.(tmpFile, text) ?? null
    const audioId = storeAudio(tmpFile)
    tmpFile = null
    const audioToken = crypto.randomBytes(8).toString('hex')
    const sinceGen = cancelGeneration()   // 지시 직전에 읽는다(P-54)
    broadcastSSE('scheduled_broadcast', {
      title: title || '식사 안내', content: text, target: '전체', audioId,
      ttsVolume: resolveStepVolume(db, opts, 'tts'),
      token: audioToken,
      cues,
    })
    // 0.75배속 기준 약 3.5자/초
    const estimate = Math.max(8000, Math.ceil(text.length / 3.5) * 1000 + 3000)
    await awaitTTSEnd(audioToken, title, estimate, tok, sinceGen)
  } finally {
    if (tmpFile) deleteTmpFile(tmpFile)
  }
}

// 두 번째 인자로 **카테고리 문자열**과 **해석된 연결 객체**를 둘 다 받는다.
//
// 왜 둘인가: 연결 고르개(설계 `design-upload-flow.md`)를 넣으면서 실행부가 받는 것이
// "카테고리 이름"에서 "이 단계가 가리키는 것"으로 넓어졌다. 그런데 **문자열을 넘기는
// 자리가 아직 있다** — `stepMealPrayer` 의 내부 호출과 시험 몇 개다. 그 자리를 한꺼번에
// 바꾸면 회귀 위험만 커지고 얻는 것이 없어서, 여기서 한 줄로 받아 준다.
// 문자열 = "그 카테고리 전체" = `folderId` 없는 폴더 연결이고, 그것이 **지금 동작 그대로**다.
const 연결로읽기 = (값) => (typeof 값 === 'string'
  ? { kind: 'folder', origin: 'default', category: 값, folderId: null, audioFileId: null, playlist: null, error: null }
  : 값)

// ── 음원 파일 재생 ─────────────────────────────────────────
async function stepAudioFile(db, source, trackIndex = 0, defaultWaitSec = 180, tok, opts = {}) {
  if (isCancelled(tok)) return
  const 연결 = 연결로읽기(source)
  // **사람이 고른 대상이 사라졌으면 기본값으로 안 돌아간다**(사용자 조건 3, 2026-09-13).
  // 조용히 다른 소리가 나가는 것이 요양원에서 가장 비싼 실패라, 건너뛰고 이력에 적는다.
  if (연결?.error) {
    console.warn(`[시퀀서] 연결 오류(${연결.error.code}) — 이 단계를 건너뜁니다: ${연결.error.message}`)
    return 단계사유.연결끊김
  }
  // 어느 파일이 나가는지는 domain/categoryPick 한 곳에서만 정한다 — 예전엔 이 판정이
  // 실행부·예상시간·화면 세 곳에 복사돼 있었고 서로 달랐다(화면은 "무작위"라고 적었다).
  const file = pickSourceFile(db, 연결, trackIndex)
  const category = file?.category ?? 연결?.category
  if (!file) {
    console.log(`[시퀀서] ${category ?? '연결 없음'} 음원 없음 (트랙 ${trackIndex + 1}) — 스킵`)
    // **사유를 남긴다.** 맨 `return`(= `undefined`)은 `이력판정` 의 마지막 줄에서
    // 「성공·사유 없음」이 된다 — 방송이 아무 소리도 안 냈는데 이력에는 성공으로 남았다.
    // 어휘도 판정도 이미 있었고(`단계사유.없음`), 바로 위 `연결끊김` 은 제대로 쓰고 있었다.
    // 이 자리만 빠뜨린 것이다(V③ R18·R19 지적 2, 2026-09-14).
    return 단계사유.없음
  }
  const audioToken = crypto.randomBytes(8).toString('hex')
  const sinceGen = cancelGeneration()   // 지시 직전에 읽는다(P-54)
  broadcastSSE('prayer_play', {
    url:        `/audio/${category}/${file.filename}`,
    name:       file.original_name,
    token:      audioToken,
    restoreBGM: opts.restoreBGM || false,  // 안내 후 BGM 자동복원 여부
    volume:     resolveStepVolume(db, opts, 'audio'),
    // 이 단계의 재생 배속(0.5~1.5). 없으면 화면이 정속으로 튼다.
    rate:       normalizePlaybackRate(opts.rate),
    // 화면이 잰 재생시간을 돌려보낼 수 있게 — 그래야 이 파일이 다음부터 상한(defaultWaitSec)에 안 걸린다
    audioFileId: file.id,
  })
  // 배속을 낮추면 실제 재생이 길어진다 — 상한을 안 나누면 노래 도중에 다음 단계로 넘어간다
  // (flowRunner.audioWaitCapMs와 같은 이유).
  const speed = normalizePlaybackRate(opts.rate) || 1
  const durationMs = file.duration > 0 ? Math.round(file.duration / speed) * 1000 + 2000 : defaultWaitSec * 1000
  console.log(`[시퀀서] "${file.original_name}" 재생 대기 (최대 ${Math.round(durationMs / 1000)}초)`)
  await waitForAudioEnd(audioToken, durationMs, sinceGen)
}

// ── 동영상 파일 재생 ────────────────────────────────────────
// Phase 6: "가장 먼저 업로드된 파일"이 아니라 audio_playlist의 활성 항목(재생목록
// 순서편집으로 관리자가 지정) 첫 번째를 재생한다 — 여러 영상을 등록해도 실제로
// 무엇이 나가는지 명확해야 한다는 요구사항 때문. playlist가 비어있으면(마이그레이션
// 백필 대상이 아니었던 극히 예외적 케이스) 기존 방식(id순 첫 파일)으로 폴백한다.
async function stepVideoFile(db, source, defaultWaitSec = 480, tok, opts = {}) {
  if (isCancelled(tok)) return
  const 연결 = 연결로읽기(source)
  if (연결?.error) {
    console.warn(`[시퀀서] 연결 오류(${연결.error.code}) — 이 단계를 건너뜁니다: ${연결.error.message}`)
    return 단계사유.연결끊김
  }
  // 음원과 같은 규칙을 쓴다 — 영상만 재생목록을 보던 것을 한 함수로 합쳤다.
  // 차례를 고른 단계는 그 폴더에서 랜덤·차례로 고른다(2026-09-21 사용자 지시 「영상도 마찬가지로」).
  // 안 고르면 예전과 **같은 함수**(맨 앞 파일) — 기존 현장 동작이 그대로다.
  const file = opts.mediaOrder
    ? require('../domain/categoryPick').pickSourceFileByOrder(db, 연결, opts.mediaOrder)
    : pickSourceFile(db, 연결, 0)
  const category = file?.category ?? 연결?.category
  // 이 PC 에 올린 파일만 튼다(2026-09-21 — 링크로 등록된 옛 항목은 파일이 없다).
  if (!file || !file.filename) {
    console.log(`[시퀀서] ${category ?? '연결 없음'} 영상 없음 — 스킵`)
    return 단계사유.없음   // 음원과 같은 이유 — 위 주석 참고
  }
  const videoToken = crypto.randomBytes(8).toString('hex')
  // BGM 페이드아웃 완료 후 영상 재생 (1500ms = 페이드 시간과 동일)
  nowPlaying.update({ bgm: null })
  broadcastSSE('bgm_stop', {})
  await new Promise(r => setTimeout(r, 1500))
  if (isCancelled(tok)) return

  // 위에서 bgm_stop 뒤 1.5초를 쉬므로 **여기서** 읽어야 한다. 토큰 만든 자리에서 읽으면
  // 그 1.5초 사이의 취소를 놓친다(P-54).
  const sinceGen = cancelGeneration()
  broadcastSSE('video_play', {
    // 이 스텝에만 쓸 영상 소리 볼륨. 화면은 이 재생에만 적용하고 자기 슬라이더는 안 건드린다.
    volume:   resolveStepVolume(db, opts, 'media'),
    url:      `/audio/${category}/${file.filename}`,
    source:   'file',
    name:     file.original_name,
    token:    videoToken,
    category,
    // TV 싱크 보정은 **하나뿐이라 단계마다 실어 보낼 것이 없다**(2026-09-16).
    // 그전에는 `delayProfile`(A/B)을 실어 화면이 두 값 중 하나를 고르게 했는데, 그
    // 사슬이 끊겨 조용히 틀린 값이 걸린 사고가 두 번 있었다(V③ R18·R23). 값이 하나면
    // 고를 일이 없다 — 사고 유형 자체가 사라졌다. 이유는 `domain/videoSync` 머리말.
    audioFileId: file.id,
    // 이 단계의 재생 배속(0.5~1.5).
    rate:     normalizePlaybackRate(opts.rate),
  })
  // 배속을 낮추면 실제 재생이 길어지므로 상한도 같이 나눈다(음원 단계와 같은 이유).
  // 길이를 모르는 파일은 defaultWaitSec 이 상한이다(관리자의 수동 종료 버튼 또는 타임아웃).
  const videoSpeed = normalizePlaybackRate(opts.rate) || 1
  const durationMs = file.duration > 0
    ? Math.round(file.duration / videoSpeed) * 1000 + 3000
    : defaultWaitSec * 1000
  console.log(`[시퀀서] "${file.original_name}" 영상 재생 대기 (최대 ${Math.round(durationMs / 1000)}초)`)
  // 영상 종료 신호 OR 타임아웃 중 먼저 오는 것
  await waitForVideoEnd(videoToken, durationMs, sinceGen)
}

// ── BGM 재생 시작 — 이 PC 의 방송용·식사용 BGM 폴더에서 ──────────────
// step.bgmRole:  'broadcast' | 'meal' (없으면 방송 종류로 — 점심·저녁=식사용, 나머지=방송용)
// step.bgmFolderId: 사람이 만든 BGM 폴더 번호(있으면 그 폴더 — 못 쓰면 위 용도로 대신하고 경보)
// step.bgmFileId: 곡 하나(audio_files.id, 2026-09-22) — 있으면 그 곡만. 없어졌으면 위 용도로 대신하고 경보
// step.bgmOrder: 'random' | 'seq' (없으면 용도 폴더는 그 용도의 기본 차례, 사람이 만든 폴더는 랜덤)
// step.durationSec: 초 단위 자동 정지 (> 0), 0이면 무제한 (durationMin보다 우선)
//
// 2026-09-21: 외부 동영상 연동을 걷어냈다(사용자 지시). 예전 소스 값(검색어·즐겨찾기·
// 자동)이 저장돼 있어도 **이 PC 음원으로** 튼다 — 첫 부팅 보정이 저장값도 'local' 로 고친다.
/**
 * @param {*} tok 취소 토큰. **선택이다** — 받는 쪽 코드가 같은 모양으로 부르게 남겨 둔다.
 */
// eslint-disable-next-line no-unused-vars
function stepBGMStart(db, mealKey, durationMin = 0, step = {}, tok = null) {
  const durationSec = parseInt(step.durationSec) || 0  // 초 단위 (저녁 마무리 등 짧은 방송용)
  // 탭 중복재생 방지용 이벤트 ID — 같은 PC에 탭이 여러 개일 때 첫 번째 탭만 재생
  const eventId = crypto.randomBytes(4).toString('hex')

  // 방송 BGM 볼륨 — 키·기본값은 domain/volume.js가 유일한 출처다.
  // 스텝에 bgmVolume이 있으면 이 스텝에만 그 값을 쓴다(전역 설정은 건드리지 않는다).
  const bgmDefault = resolveStepVolume(db, step, 'bgm', 'bgmVolume')

  const { 기본역할 } = require('../domain/bgmRoles')
  const role = step.bgmRole || 기본역할(mealKey)
  // 사람이 만든 폴더(step.bgmFolderId)를 못 쓰면 이 방송의 기본 용도 폴더로 대신 틀고 경보를 낸다(2026-09-22).
  const 고른것 = require('./localBgm').방송BGM고르기(db, { role, folderId: step.bgmFolderId, fileId: step.bgmFileId, order: step.bgmOrder })
  if (!고른것.ok) {
    // 조용히 넘어가지 않는다 — 폴더가 비었는지·없는지 이유를 남긴다(「조회 실패」와 「정말 비어 있음」을 가른다, CC-038).
    console.log(`[시퀀서] BGM 없음 — 스킵: ${고른것.사유}`)
    return
  }
  nowPlaying.update({ bgm: { title: 고른것.title } })
  broadcastSSE('bgm_start', {
    meal:  mealKey,
    files: 고른것.files,
    durationMin,
    durationSec,
    bgmDefault,
    eventId,
  })
  console.log(`[시퀀서] BGM 시작 — ${고른것.folderName}(${고른것.order}, ${mealKey}), 기본볼륨: ${bgmDefault}%`)
}

// ── 식사 안내: useGraceAudio 기준으로 녹음/TTS 선택 ───────────
async function stepMealPrayer(db, source, ttsText, title, tok, opts = {}) {
  if (isCancelled(tok)) return
  // useGraceAudio === false 이면 TTS 강제 (체크 해제) — **연결보다 먼저 본다.**
  // 사람이 "녹음 대신 TTS" 를 골라 뒀으면 연결이 무엇이든 그 뜻이 이긴다.
  if (opts.useGraceAudio === false) {
    await stepPrayerTTS(db, ttsText, title, tok, opts)
    return
  }
  const 연결 = 연결로읽기(source)
  // 연결 오류는 **TTS 로도 안 흘린다** — 사람이 고른 녹음이 사라진 것을 문구로 덮으면
  // 아무도 모른다(사용자 조건 3). 건너뛰고 이력에 남긴다.
  if (연결?.error) {
    console.warn(`[시퀀서] 연결 오류(${연결.error.code}) — ${title} 단계를 건너뜁니다: ${연결.error.message}`)
    return 단계사유.연결끊김
  }
  // **사람이 일부러 끊었으면(`source: null`) TTS 로도 안 간다.** "이 자리에서 아무것도
  // 내보내지 마라" 가 그 뜻이다 — 여기서 TTS 를 틀면 해제가 해제가 아니게 된다.
  if (연결?.kind === 'none') {
    console.log(`[시퀀서] ${title} — 연결 해제됨, 건너뜁니다`)
    return
  }
  // "파일이 있나"가 아니라 **"나갈 파일이 있나"**를 묻는다. 예전엔 개수만 셌는데,
  // 재생목록을 전부 꺼두면 개수는 있는데 나갈 것이 없어서 TTS도 안 나오고 조용히 넘어갔다.
  if (pickSourceFile(db, 연결, 0)) {
    // stepMealPrayer는 실행부가 아니라 헬퍼다 — step이 아니라 넘겨받은 opts를 그대로 이어준다
    return await stepAudioFile(db, 연결, 0, 300, tok, opts)
  }
  await stepPrayerTTS(db, ttsText, title, tok, opts)
}

// ── 공통 영상 스텝 실행 ────────────────────────────────────
// 방송 뒤 **소리 없이** 띄우는 배경 영상(아침·점심·저녁). 그 사이 배경음악은 계속 흐른다.
// 2026-09-21: 예전엔 외부 서비스에서 계절 자연 영상을 검색해 띄웠다 — 그 연동을 걷어내며 이 PC 의 「배경 영상」
// (scene-video) 폴더에서 고른다(사용자 결정). 차례는 단계의 mediaOrder, 없으면 랜덤(같은 영상만 계속
// 나오지 않게). 폴더가 비면 이 단계만 건너뛰고 사유를 남긴다 — 방송은 계속된다.
async function stepVideoAfter(db, step, bgmMealKey, tok) {
  if (isCancelled(tok)) return
  const { resolveStepSource } = require('../domain/stepSource')
  const { pickSourceFileByOrder } = require('../domain/categoryPick')
  const 연결 = 연결로읽기(resolveStepSource(db, step))
  if (연결?.error) {
    console.warn(`[시퀀서] 배경 영상 연결 오류(${연결.error.code}) — 이 단계를 건너뜁니다: ${연결.error.message}`)
    return 단계사유.연결끊김
  }
  const file = pickSourceFileByOrder(db, 연결, step.mediaOrder || 'random')
  const durationMin = parseInt(step.durationMin) || 10
  if (!file) { console.log('[시퀀서] 배경 영상 없음(음원 관리 → 배경 영상) — 스킵'); return 단계사유.없음 }
  // 이름을 함께 싣는다 — 없으면 받는 쪽이 무슨 영상인지 몰라 '아침 영상'으로 적는다.
  // 실제로 점심·저녁 식사 중 영상도 모니터 창에 '아침 영상'으로 나오고 있었다.
  broadcastSSE('morning_video_start', {
    url: `/audio/${file.category}/${file.filename}`, durationMin, name: step?.label || file.original_name || '자동방송 영상',
  })
  if (bgmMealKey) {
    stepBGMStart(db, bgmMealKey, durationMin, step, tok)
  } else {
    // 영상 재생 시 현재 BGM 타이머를 영상 길이와 동기화 → 영상 종료 시 BGM도 함께 종료
    broadcastSSE('bgm_set_timer', { durationSec: durationMin * 60 })
  }
  await tokenDelay(800, tok)
}

// ── 편집기에서 추가한 커스텀 스텝(bgm/audio/chime/delay/video_file) 실행 ──────
// 전부 flowRunner.runStep 하나로 위임(재구현하지 않음). 예전엔 require('./flowRunner')를 함수 안에서 lazy하게 불러야 했다(순환 require로
// resolveBGM/loadTTSConfig가 undefined로 굳는 실사고) — flowRunner가 위쪽을 다시 부르지
// 않게 배선을 편 뒤로는(배선도 ①, broadcastConfig·broadcastGate) 정상 require면 된다.
// tok을 넘겨서 정지 버튼(isCancelled)이 이 커스텀 스텝의 대기에도 즉시 반영되게 한다.
async function runCustomExtraStep(db, step, tok) {
  const stepType = step.customType
  // **여기 걸리는 것은 "실행할 것이 없는" 단계다** — 내용이 빈 커스텀 tts/message(위 default
  // 분기가 `content?.trim()` 이 있을 때만 stepTTS 로 보낸다)와 코드에 없는 옛 단계 id.
  // 예전엔 `false` 를 내서 **차임 고장과 글자 그대로 같은 줄**로 남았다(P-57 ②).
  const { 단계사유 } = require('../domain/stepHistory')
  if (!['bgm', 'audio', 'chime', 'delay', 'video_file'].includes(stepType)) return 단계사유.없음

  // 실패 어휘를 여기서 **비교하지 않는다**(P-57) — 사유를 그대로 흘려보내므로 값을 알 필요가
  // 없어졌다. 예전엔 여기서 CANCELLED·CHIME_FAILED 와 대조해 boolean 으로 뭉갰고, 그때는
  // 리터럴을 베끼지 않으려고 상수를 가져왔다(P-22 에서 대소문자가 어긋나 판정이 죽었다).
  const { runStep } = require('./flowRunner')
  // playlist 필드는 flowRunner.runStep이 config.playlist(배열)로 여러 개를 순서대로 재생하는 데
  // 쓰고, 단일 필드(bgm_value/audio_file_id)는 재생목록이 비어있는 구버전 저장분 하위호환용.
  //
  // 볼륨은 **이름을 갈아끼워 넘긴다**(CC-053). 화면(MorningEditor.volumeFieldFor)은 카멜로
  // 저장하는데 — BGM 단계는 step.bgmVolume, 나머지는 step.volume — flowRunner.runStep은
  // 주 소리를 config.volume, 반주를 config.bgm_volume(스네이크)으로 읽는다. 그 배선이
  // 빠져 있어서 커스텀 음원·차임벨·BGM·영상파일 단계는 자동방송 5종 전부에서 단계별 볼륨이
  // 조용히 무시되고 늘 시스템 기본값으로 나갔다(소리는 나므로 아무도 눈치채지 못한다).
  //
  // **값을 저장한 단계에만 영향이 있다.** resolveStepVolume/resolveBGM은 null·undefined·''을
  // "시스템 기본값"으로 보고, 0은 명시적 무음으로 본다 — 그래서 여기서 undefined를 그대로
  // 넘겨도 기존 동작(기본값)이 유지되고, 0을 falsy로 지우면 안 된다.
  //
  // 'delay'는 소리가 없어 볼륨 자체가 없다.
  const config =
    stepType === 'bgm'        ? { playlist: step.playlist, bgm_type: step.bgm_type, bgm_value: step.bgm_value, bgm_title: step.bgm_title, bgm_delay: step.bgm_delay, bgm_volume: step.bgmVolume } :
    stepType === 'audio'      ? { playlist: step.playlist, audio_file_id: step.audio_file_id, volume: step.volume, rate: step.rate } :
    stepType === 'chime'      ? { volume: step.volume } :
    stepType === 'video_file' ? { playlist: step.playlist, audio_file_id: step.audio_file_id, volume: step.volume, rate: step.rate } :
    stepType === 'delay'      ? { wait_sec: step.wait_sec } :
    {}
  // 흐름(flowRunner)이 돌려주는 결과를 **버리지 않는다**(P-22). 버리면 차임이 안 울려도
  // 그 단계가 이력에 성공으로 남는다.
  //
  // **읽는 쪽은 같은 날 생겼다**(2026-09-09, AP-0044). `broadcastSequencer.js` 의 다섯 레인이
  // `return await runCustomExtraStep(...)` 로 값을 흘려보내고, `runStepGuarded` 가
  // `outcome === false` 면 단계 이력에 실패로 적는다. **취소는 면제한다** —
  // 여기서 CANCELLED 도 false 로 뭉개지므로, 안 그러면 정지 버튼이 실패로 기록된다.
  //
  // **2026-09-10 (P-57): 사유를 그대로 넘긴다.** 예전엔 여기서 boolean 으로 뭉개는 바람에
  // "차임 고장"·"정지"·"실행할 것 없음"이 이력에서 한 줄로 보였고, 부르는 쪽
  // (`broadcastSequencer.runStepGuarded`)이 `isCancelled(tok)` 로 **다시 추측해** 취소를
  // 복원했다. 되짚기라서 틈이 생긴다 — 진짜 차임 고장 직후에 다른 방송이 밀어내면
  // `isCancelled` 가 참이 되어 **그 실패가 기록 없이 사라진다.**
  // 흐름은 처음부터 끝까지 갈라 적고 있었다. 이제 자동방송도 같은 값을 나른다.
  //
  // `CANCELLED`·`CHIME_FAILED` 는 `domain/stepHistory` 의 `단계사유` 가 정본이고
  // flowRunner 가 그것을 재수출한다 — 값을 리터럴로 베껴 적지 않는다(P-22 에서 대소문자가
  // 어긋나 판정이 통째로 죽은 적이 있다).
  //
  // `isStopped` 도 넘긴다 — 차임 단계는 3초 창 안에 정지되면 그것을 알아야 `CANCELLED` 를
  // 낸다. 안 넘기면 정지된 차임이 이력에 **'성공'** 으로 적힌다(흐름 쪽 P-49 ② 와 같은 결함).
  // 자동방송에는 앵커 개념이 없으므로 `isCancelled` 와 같은 것을 봐도 된다 — 흐름에서는
  // 앵커 도달까지 섞이기 때문에 둘을 갈랐다.
  return await runStep(db, { step_type: stepType, config, label: step.label },
    { isCancelled: () => isCancelled(tok), isStopped: () => isCancelled(tok) })
}

module.exports = {
  stepOpts, ttsWaitMs, awaitTTSEnd,
  stepTTS, stepPrayerTTS, stepAudioFile, stepVideoFile, stepBGMStart,
  stepMealPrayer, stepVideoAfter, runCustomExtraStep,
}
