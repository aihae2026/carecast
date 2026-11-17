// 예약 방송 스케줄러 — node-cron으로 매분 DB를 조회해 방송을 자동 실행
const cron   = require('node-cron')
const crypto = require('crypto')
const { getDB }                                              = require('../db/schema')
const fs = require('fs')
const { generateTTSWithRetry, MIN_CACHE_BYTES, BROADCAST_BUDGET_MS, deleteTmpFile, readCues, rateToStr, pitchToStr, cachePathFor } = require('./tts')
const { broadcastSSE }                                       = require('./sse')
const { storeAudio }                                         = require('./audioStore')
const switchbot                                              = require('./switchbot')
const { checkBGMSchedule }                                  = require('./bgmScheduler')
const { playChime }                                          = require('./chimePlayer')
const { shouldRunToday, isOneTime, todayStr, nowHHMM }        = require('./repeatSchedule')
// 방송 하나가 남기는 로그를 한 이름표로 묶는다(CC-035). 여기서 열어야 그 안에서 도는
// 시퀀서·흐름러너·TTS의 로그까지 전부 같은 이름표를 단다.
const { withRun }                                             = require('./runContext')
const { resolveMainVolume }                                  = require('../domain/volume')
const { RUNNING, SUCCEEDED, FAILED, 흐름사유문구 }             = require('../domain/broadcastOutcome')
const { AUTO_BROADCASTS }                                    = require('../domain/autoBroadcasts')
const { rawSetting, rawSettings }                                        = require('../domain/settingsRead')
// 설정 해석(resolveBGM·loadTTSConfig)은 broadcastConfig.js로 내렸다(배선도 ① — flowRunner도
// 쓰는 공유물이라 여기 두면 역참조 순환이 된다). 기존 사용처(routes/morning.js, 테스트)를
// 위해 아래 module.exports에서 이름 그대로 재수출한다.
const { loadTTSConfig, resolveBGM }                          = require('./broadcastConfig')
const {
  fireMorningBroadcast,
  fireExerciseBroadcast,
  fireLunchBroadcast,
  fireDinnerBroadcast,
  fireEveningPrayerBroadcast,
} = require('./broadcastSequencer')

// 일과방송 5종의 정의(이름·설정키·기본 시각)는 domain/autoBroadcasts.js 한 곳에 있다.
// 여기서는 그 표의 id를 실제 발사 함수에 잇기만 한다 — 표에 줄을 더하고 여기에 짝을
// 안 지으면 서버가 뜰 때 바로 걸린다(아래 검사).
const AUTO_FIRE = {
  morning:        fireMorningBroadcast,
  exercise:       fireExerciseBroadcast,
  lunch:          fireLunchBroadcast,
  dinner:         fireDinnerBroadcast,
  evening_prayer: fireEveningPrayerBroadcast,
}
for (const spec of AUTO_BROADCASTS) {
  if (typeof AUTO_FIRE[spec.id] !== 'function') {
    throw new Error(`[스케줄러] 일과방송 "${spec.id}"에 짝지어진 발사 함수가 없다 — 그 방송은 영영 안 나간다`)
  }
}

// 스케줄러 cron이 마지막으로 돈 시각(epoch ms). null이면 아직 한 번도 안 돌았다.
// 이 값이 멈추면 정시 방송이 통째로 안 나가므로, 서버 생존 판정의 단일 지표로 쓴다.
let lastTickAt = null
function getLastTickAt() { return lastTickAt }

// ── **시계가 건너뛰면 그 사이 방송은 영영 안 나간다** (현장 사고 2026-09-15) ──────────
//
// 발동 조건은 **정확히 일치**다 — `scheduled_time = 지금 분`(아래 질의)이고, 자동방송도
// 같다. **유예창은 일부러 없다**(사용자 결정, review/findings.csv CC-002).
// 그래서 분이 하나씩 흐르는 동안은 아무 문제가 없는데, **시계가 점프하면 건너뛴 분은
// 아무도 안 본다.**
//
// 그날 현장 PC 시계가 실제보다 2분 늦어 있었고(11:12 ↔ 11:14), 사람이 시간을 자동
// 동기화하자 **11:12 → 11:16 으로 뛰었다.** 11:15 점심 식사 전 방송은 그 사이에 있었고,
// 어느 틱도 `11:15` 를 본 적이 없어 **조용히 사라졌다.** 화면도 아무 말이 없었다 —
// 발동이 없으면 이벤트도 없기 때문이다(사용자: *"아무 상황도 인지 못하듯이 멈춰있더라"*).
//
// **발동 규칙은 안 바꾼다.** 늦게 나가는 방송이 안 나가는 것보다 낫다는 보장이 없고
// (식사 전 안내가 10분 늦게 나가면 그건 다른 사고다), 그 판단은 사람이 할 일이다.
// 여기서는 **건너뛴 사실을 드러내기만** 한다 — 조용한 손실이 이 저장소에서 가장 비싸다.
const 점프허용분 = 1   // 1분씩 흐르는 정상 진행
let 지난틱분 = null
function 분값(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
/**
 * 건너뛴 분들 안에 **오늘 아직 안 나간 방송**이 있었나. 이름을 돌려준다.
 *
 * **이미 나간 것은 안 센다** — 사람이 수동으로 먼저 내보냈을 수 있고, 그때 「안 나갔다」고
 * 알리면 거짓 경보다. 자동방송 5종과 오늘 도는 예약을 같은 기준으로 본다.
 */
function 놓친방송찾기(db, 건너뛴, today) {
  const 분들 = new Set(건너뛴)
  const 이름 = []
  const { autoTime } = require('../domain/autoBroadcasts')
  const get = (k) => { try { return rawSetting(db, k) } catch { return null } }
  for (const spec of AUTO_BROADCASTS) {
    if (get(spec.enabledKey) !== 'true') continue
    const t = autoTime(get(spec.timeKey), spec)
    if (!t || !분들.has(t)) continue
    if (get(spec.firedKey) === today) continue       // 이미 나갔다
    이름.push(`${spec.label}(${t})`)
  }
  try {
    for (const s of db.prepare('SELECT * FROM schedules WHERE active = 1').all()) {
      if (!분들.has(s.scheduled_time)) continue
      if (s.last_fired === today) continue
      if (!shouldRunToday(s)) continue
      이름.push(`${s.title || '예약 방송'}(${s.scheduled_time})`)
    }
  } catch { /* 예약을 못 읽어도 자동방송 쪽은 알린다 */ }
  return 이름
}

/** 이번 틱이 **건너뛴 분들**. 정상이면 빈 배열. 자정을 넘거나 뒤로 간 경우는 안 센다. */
function 건너뛴분들(현재) {
  const 이전 = 지난틱분
  지난틱분 = 분값(현재)
  if (이전 == null || 지난틱분 == null) return []
  const 차 = 지난틱분 - 이전
  // 뒤로 간 시계(음수)와 자정 넘김은 여기서 안 다룬다 — 「건너뛴 방송」이 아니라
  // 다른 이야기이고, 섣불리 세면 매일 자정에 거짓 경보가 뜬다.
  if (차 <= 점프허용분 || 차 > 180) return []
  const 목록 = []
  for (let m = 이전 + 1; m < 지난틱분; m++) {
    목록.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return 목록
}


// DB에서 설정값 upsert
// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { writeSetting: setSetting } = require('../domain/settingsRead')

// 녹음 안내 예약 타입 → 음원 카테고리 맵
const PRAYER_CAT_MAP = {
  'morning-prayer':       'morning-prayer',
  'morning-prayer-staff': 'morning-prayer',
  'lunch-prayer':         'lunch-prayer',
  'lunch-prayer-staff':   'lunch-prayer',
  'dinner-prayer':        'dinner-prayer',
  'dinner-prayer-staff':  'dinner-prayer',
}

// 이 방송이 실제로 현장에서 소리가 날 수 있는 상태였는가.
//
// 정시 방송의 소리는 전부 현장 PC 브라우저가 낸다 — 스케줄러는 audioQueue(서버 스피커)를
// 부르지 않고 broadcastSSE로 쏘기만 한다. 그래서 현장 PC 재생 창이 닫혀 있으면 방송은
// 무음인데, 예전엔 그걸 알 방법이 없어 이력에 전부 성공으로 남았다.
//
// 한계를 분명히 해 둔다: 현장 청취자가 0명이면 **확실히** 무음이지만, 1 이상이라고 재생이
// 보장되지는 않는다. 그 한계와 유령 연결을 빼고 세는 이유는 아래 파일에 그대로 옮겨 뒀다.
//
// **판정 자체는 `services/sitePlayer` 한 곳에 있다**(P-51, 2026-09-10). 흐름(flowRunner)도
// 같은 판정을 봐야 하는데 그쪽은 scheduler 를 require 할 수 없어(배선도 ①,
// `route-wiring.test.js` 가 고정) 아래층으로 내렸다. **규칙은 한 글자도 안 바뀌었다** —
// 사본을 만들면 예약과 흐름의 성공 판정이 조용히 갈린다(FP-0005).
const { hasSitePlayer } = require('./sitePlayer')

// 틀 것이 아예 없었다는 사실을 남긴다.
//
// 왜 필요했나(2026-08-29 리뷰 CC-020이 가리킨 실제 문제): 예약이 참조하는 음원·영상이
// 지워졌거나 BGM 해석에 실패하면 console.error 한 줄만 남기고, **이력에는 성공으로 적혔다.**
// 현장 PC 재생 창이 열려 있으면 hasSitePlayer()가 true라 success=1이 된다. 소리는 아무것도
// 안 났는데 이력만 보면 정상이라, 어르신이 말해 주기 전엔 아무도 모른다.
//
// FK로는 못 막는다 — schedules.audio_file_id에는 외래키 선언 자체가 없다(실측). 참조가
// 깨졌는지는 발사 시점에 조회해 봐야 알 수 있으므로, 그 자리에서 실패로 적고 알린다.
// 경보 한 줄 보내기. **호출 시점에 require한다** — 상단에서 당기면 테스트가 require.cache로
// 갈아끼운 스텁을 못 보고, 경보 모듈이 죽었을 때 이 파일까지 못 뜨는 결합도 생긴다.
// 경보를 남기려다 예외가 나서 방송이 멈추면 본말전도이므로 절대 던지지 않는다.
function raiseAlert(kind, message, detail = {}) {
  try { require('./alert').raise(kind, message, detail) }
  catch (e) { console.error('[스케줄러] 경보 전달 실패:', e.message) }
}

// 문구에 막아야 할 개인정보(주민등록번호·휴대폰번호·생년월일)가 있으면 사람이 읽을 이름, 없으면 null.
// 저장 때(`checkSensitive`)와 **같은 판정**을 쓴다 — 저장은 통과했는데 발사에서 막히는 일이 없게.
function 막을개인정보(text) {
  const { detectSensitive, describe } = require('./sensitiveInfo')
  const { blocked } = detectSensitive(String(text ?? ''))
  return blocked.length ? describe(blocked) : null
}

function reportMissingSource(schedule, what) {
  const msg = `"${schedule.title}"의 ${what}을 찾을 수 없어 아무 소리도 나지 않았습니다.`
  console.error(`[스케줄러] ${msg}`)
  try { require('./alert').raise('예약방송', msg, { scheduleId: schedule.id }) }
  catch (e) { console.error('[스케줄러] 경보 전달 실패:', e.message) }
}

// 예약 실행 마무리 공통 처리 — 로그 기록 + last_fired 갱신 + 1회성 예약 자동 비활성화
// delivered=false면 success=0으로 남는다(위 hasSitePlayer 참고). 차임벨처럼 서버 스피커로
// 나가는 유형은 브라우저와 무관하므로 기본값 true를 그대로 쓴다.
// delivered로 boolean 대신 숫자(broadcastOutcome의 RUNNING 등)를 줄 수도 있다 — 흐름 방송은
// 이 시점에 결과를 모르므로 "진행 중"으로 남기고 나중에 flowOutcome이 정정한다.
// 반환값은 그 broadcasts 행의 id다. 정정하려면 어느 행인지 알아야 한다.
// **수동재생은 예약 상태를 안 건드린다**(사용자 결정 2026-09-01). 예전엔 확인차 한 번
// 눌러 본 방송이 last_fired에 오늘로 찍혀 **그날 정시에 안 나갔다** — 화면에 아무 표시가
// 없고 이력에는 "나갔다"로 남아 알아챌 방법이 없었다. 이제 이력만 남기고 예약은 그대로 둔다.
//
// 묶음(1·2차)도 예외가 아니다. 잠깐 예외로 뒀던 이유는 쉬운 화면의 「수동재생」이 "아직 안
// 나간 차수"를 last_fired로 골랐기 때문인데, 1차/2차 뱃지를 각각 버튼으로 바꾸면서
// 사람이 직접 고르게 됐다(2026-09-01). 고르는 규칙이 없어지니 예외도 없어졌다.
//
// 수동 여부는 호출부가 schedule에 _manual을 얹어 알린다 — 이 함수를 부르는 8곳의
// 시그니처를 다 바꾸는 것보다 작고, 그 8곳은 한 줄도 안 고쳐도 된다.
// prepMs — 발사에서 "화면에 재생 지시를 보낸" 시점까지 걸린 밀리초.
// 이력의 time은 **발사 시각**이라 그 뒤에 붙는 합성 시간이 이력에 안 보였다("12:00 예약인데
// 12:01에 나온다"의 정체가 그것이다). 이제 숫자로 남는다. TTS를 안 쓰는 유형은 null이다.
function finishScheduleFire(db, schedule, time, logContent, delivered = true, prepMs = null) {
  const keepSchedule = !!schedule._manual
  const successValue = typeof delivered === 'number' ? delivered : (delivered ? 1 : 0)
  const logId = db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success, prep_ms, run_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(todayStr(), time, '예약', logContent, '자동', schedule.target, successValue,
      Number.isFinite(prepMs) ? Math.round(prepMs) : null,
      // 이 이력 줄의 단계를 화면이 찾을 열쇠(0022). 로그 이름표와 같은 값이다.
      require('./runContext').currentRunId()).lastInsertRowid
  if (!keepSchedule) {
    // 보조 결과 연결이 실패해도 발사·중복 방지 날짜는 유지한다.
    try {
      require('../domain/scheduleOutcome').rememberScheduleOutcome(db, schedule.id, todayStr(), logId)
    } catch (e) {
      console.warn(`[스케줄러] 예약 #${schedule.id} 결과 연결 실패(방송은 계속한다): ${e.message}`)
    }
    db.prepare('UPDATE schedules SET last_fired = ? WHERE id = ?').run(todayStr(), schedule.id)
    if (isOneTime(schedule)) {
      db.prepare('UPDATE schedules SET active = 0 WHERE id = ?').run(schedule.id)
      // **"완료" 라고 말하지 않는다**(RB-01, Codex 소급 검수 2026-09-11). 이 자리는 발사
      // **직전**이다 — 차임 분기는 `playChime` 을 부르기도 전에 여기를 지난다. 그런데 문구가
      // "1회 방송 완료" 라, 로그를 되짚는 사람은 그 방송이 끝났다고 읽는다.
      // 이력(broadcasts)은 RUNNING → 정정으로 정직한데(ISSUE-002) 로그만 거짓말했다 —
      // `chime-log-honesty.test.js` 가 고친 것과 **같은 거짓말**이고, 그 검사가 `차임벨` 이
      // 든 줄만 봐서 이 줄을 못 봤다. 비활성화 시점은 그대로 두고 말만 바꾼다.
      console.log(`[스케줄러] "${schedule.title}" 1회 예약 발사 → 자동 비활성화 (결과는 따로 적힌다)`)
    }
  }
  // 로그 ↔ 이력 잇기(CC-035): 이 줄의 이름표로 로그를 모으고, #번호로 화면의 이력 행을 찾는다
  console.log(`[스케줄러] "${schedule.title}" 이력 #${logId} 기록 (성공=${successValue})`)
  return logId
}

// ── 미리 만들기(prewarm) ─────────────────────────────────────
//
// 왜 필요했나(2026-09-03 사용자 신고): "12:00 예약인데 12:01에 나온다". 발사는 정시인데
// **소리는 합성이 끝나야** 난다. 캐시 우선(tts.js)으로 두 번째부터는 즉시 나가지만,
// 문구를 새로 쓴 예약의 **첫 발사**는 여전히 합성을 기다린다.
// 그래서 발사 전에 10분 창에서 미리 만들어 캐시에 넣어 둔다.
//
// 지키는 것 셋:
//  · 발사와 **같은 함수로 문구를 짓는다**(ttsParamsForSchedule). 한 글자만 달라도 다른 캐시
//    키라, 미리 만든 것이 통째로 버려지고 아무 이득이 없다.
//  · **tick을 붙잡지 않는다.** 기다리지 않고 띄워 보낸다 — 미리 만들기가 늦어서 정작 지금
//    나가야 할 방송이 밀리면 본말전도다.
//  · **실패해도 아무 일도 안 일어난다.** 그때는 예전처럼 발사 시각에 합성한다.
const PREWARM_MAX = 5          // 캐시 적중·제외 항목을 뺀 실제 준비 요청 상한
let prewarmBusy = false        // 앞 tick의 미리 만들기가 아직 돌면 건너뛴다

// 이 유형들은 TTS를 쓰지 않는다(파일·영상·BGM·흐름·차임) — 미리 만들 것이 없다
const NO_TTS_TYPES = new Set(['chime', 'audio', 'video', 'bgm', 'flow'])

/** 예약 하나의 TTS 파라미터. 내용이 없으면 null. **발사와 미리만들기의 단일 출처다.** */
function ttsParamsForSchedule(schedule, tts) {
  const base = (schedule.content || '').trim()
  if (!base) return null
  // 반복 방송은 같은 문장을 두 번 읽는다 — 그 합쳐진 문장이 곧 캐시 키다.
  // **문장은 `domain/broadcastDefaults` 가 짓는다**(2026-09-14). 순서·예상시간·즉시 TTS 가
  // 같은 문장을 봐야 캐시가 맞고 예상 시간이 실제와 어긋나지 않는다.
  const text = require('../domain/broadcastDefaults').반복문안(base, schedule.repeat_broadcast)
  return { text, voice: tts.voice, rate: rateToStr(tts.rate), pitch: pitchToStr(tts.pitch) }
}

// 등록과 주기 점검이 같은 문구를 동시에 합성하지 않도록 한 작업자로 직렬 처리한다.
const pendingPrewarm = new Map()
const prewarmAttempts = new Map()
const prewarmCounts = { requested: 0, attempted: 0, made: 0, cached: 0, failed: 0, skipped: 0, busyTicks: 0 }
let prewarmWorker = null

function scheduleAudioReady(params) {
  try {
    // 차례 안의 어느 엔진으로든 준비돼 있으면 된다(고른 엔진이 실패해 이 PC 음성으로 만들어 둔 것 포함) —
    // 고른 엔진 것만 보면 그 엔진이 계속 실패하는 동안 매 점검마다 다시 합성한다(Codex ⑥ 1회차).
    const mp3 = require('./tts').준비된캐시(params, (e) => cachePathFor(params, undefined, e))
    if (!mp3 || fs.statSync(mp3).size < MIN_CACHE_BYTES) return false
    return !!readCues(mp3, params.text)?.lines?.length
  } catch { return false }
}

// 예약 점검(10분 안 예약 훑기)이 쓰는 「준비됨」 — 고음질판(예약 준비가 만든 것)이나 보통판 어느 쪽이든.
// 보통판만 보면 고음질판만 있는 예약을 매 점검 「미준비」로 세어 PREWARM_MAX 를 소진했다(Codex 2026-09-22 High).
function 예약준비됨(params) {
  return scheduleAudioReady({ ...params, 고음질: true }) || scheduleAudioReady(params)
}

function schedulePrewarmStats() {
  return { ...prewarmCounts, pending: pendingPrewarm.size, running: !!prewarmWorker }
}

async function prepareScheduleAudio(db, id) {
  let tmp = null
  try {
    // 큐에 넣은 뒤 수정·삭제·비활성화됐을 수 있다. 저장 당시의 사본을 재생 준비에 쓰지 않는다.
    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
    if (!row || !row.active || NO_TTS_TYPES.has(row.broadcast_type || 'text')) {
      prewarmCounts.skipped++; return 0
    }
    const 보통 = ttsParamsForSchedule(row, loadTTSConfig(db))
    if (!보통) { prewarmCounts.skipped++; return 0 }
    // 발사 때 막힐 문구는 미리 만들지도 않는다 — Azure 를 고른 PC 면 미리 만들기가 곧 외부 전송이다.
    if (막을개인정보(row.content)) { prewarmCounts.skipped++; return 0 }
    // 예약 미리 만들기는 **고음질**로(2026-09-22) — 방송 때는 고음질판이 있으면 그것을 쓴다(tts.generateTTSWithRetry).
    const params = { ...보통, 고음질: true }
    if (scheduleAudioReady(params)) { prewarmCounts.cached++; return 0 }
    prewarmCounts.attempted++
    prewarmAttempts.set(String(id), Date.now())
    // 빈 자막 사이드카도 보관하는 기존 TTS 정책은 유지한다. 예약 준비만 유효 자막을 요구한다.
    // 한 번 실패한 것은 다음 tick에 재시도한다. 등록 한 건이 60초 × 3회를 독점하지 않는다.
    // 예약 미리 만들기 — 합성 줄 맨 뒤(정시 방송이 먼저다).
    tmp = await generateTTSWithRetry(params, 1, { noCache: true, priority: 0 })
    if (!scheduleAudioReady(params)) throw new Error('음성 또는 자막 캐시 저장 미완료')
    prewarmCounts.made++
    console.log('[예약준비] 완료', { scheduleId: Number(id) })
    return 1
  } catch (error) {
    prewarmCounts.failed++
    console.warn('[예약준비] 실패 — 저장은 유지, 다음 점검에서 재시도', { scheduleId: Number(id), reason: error.message })
    return 0
  } finally { if (tmp) deleteTmpFile(tmp) }
}

function queueSchedulePrewarm(db, id) {
  prewarmCounts.requested++
  const key = String(id)
  const existing = pendingPrewarm.get(key)
  if (existing) return existing.promise
  let settle
  const promise = new Promise(resolve => { settle = resolve })
  pendingPrewarm.set(key, { db, id, promise, settle })
  startPrewarmWorker()
  return promise
}

function startPrewarmWorker() {
  if (!prewarmWorker && pendingPrewarm.size) {
    // 다음 이벤트 루프로 넘겨 예약 저장 응답을 먼저 보낸다. 별도 daemon은 만들지 않는다.
    prewarmWorker = new Promise(resolve => setImmediate(resolve)).then(async () => {
      while (pendingPrewarm.size) {
        const [jobKey, job] = pendingPrewarm.entries().next().value
        pendingPrewarm.delete(jobKey)
        job.settle(await prepareScheduleAudio(job.db, job.id))
      }
    }).finally(() => {
      prewarmWorker = null
      // 완료를 기다린 호출자가 넣은 다음 작업도 빠뜨리지 않고 깨운다.
      startPrewarmWorker()
    })
  }
}

async function waitForSchedulePrewarm() {
  while (prewarmWorker) await prewarmWorker
}

/** 앞으로 10분 안에 나갈 미준비 예약을 복구한다. 현재 분의 발사 판정은 바꾸지 않는다. */
async function prewarmUpcomingSchedules(db, now = new Date()) {
  if (prewarmBusy) { prewarmCounts.busyTicks++; return 0 }
  prewarmBusy = true
  let warmed = 0
  try {
    const occurrences = new Map()
    const minute = new Date(now); minute.setSeconds(0, 0)
    for (let n = 1; n <= 10; n++) {
      const at = new Date(minute.getTime() + n * 60_000)
      occurrences.set(nowHHMM(at), at)
    }
    const rows = db.prepare('SELECT * FROM schedules WHERE active = 1').all()
    const liveIds = new Set(rows.map(row => String(row.id)))
    for (const id of prewarmAttempts.keys()) if (!liveIds.has(id)) prewarmAttempts.delete(id)
    const tts = loadTTSConfig(db)
    const candidates = rows.filter(row => {
      const occurrence = occurrences.get(row.scheduled_time)
      if (!occurrence || row.last_fired === todayStr(occurrence) || !shouldRunToday(row, occurrence)) return false
      if (NO_TTS_TYPES.has(row.broadcast_type || 'text')) return false
      const params = ttsParamsForSchedule(row, tts)
      return params && !예약준비됨(params)
    })
    // 성공한 앞 다섯 건과 지속 실패 한 건이 뒤쪽을 영원히 가리지 않게 최근 시도 순서를 본다.
    candidates.sort((a, b) => (prewarmAttempts.get(String(a.id)) || 0) - (prewarmAttempts.get(String(b.id)) || 0)
      || occurrences.get(a.scheduled_time) - occurrences.get(b.scheduled_time) || a.id - b.id)
    const keys = new Set()
    let attempts = 0
    for (const row of candidates) {
      const params = ttsParamsForSchedule(row, tts)
      const key = cachePathFor(params)
      if (keys.has(key) || 예약준비됨(params)) continue
      keys.add(key)
      if (attempts++ >= PREWARM_MAX) break
      warmed += await queueSchedulePrewarm(db, row.id)
    }
  } catch (error) {
    prewarmCounts.failed++
    console.warn('[예약준비] 점검 실패:', error.message)
  } finally { prewarmBusy = false }
  return warmed
}

// 예약 방송 1건 실행 — broadcast_type에 따라 TTS/녹음 안내/차임벨/음원/BGM 처리.
// 로그 이름표(CC-035)는 **여기서** 연다 — 매분 tick·수동 실행·AI 즉시 방송 세 경로가 모두
// 이 함수를 지나므로, 호출부마다 열면 한 곳을 빠뜨리는 순간 그 방송만 이름표가 없어진다.
function fireSchedule(schedule, db) {
  return withRun(`예약${schedule.id}`, () => fireScheduleInner(schedule, db))
}

async function fireScheduleInner(schedule, db) {
  // **나가는 중임을 남긴다**(P-42). 같은 분 두 번째 예약이 이것을 보고 미뤄진다.
  // 걷는 것은 이 함수의 `finally` — 아래 `try` 가 함수 전체를 감싼다.
  // 차임벨은 공존이 명세라(td09 §3-B 규칙 5) 표시하지 않는다 — 표시하면 차임이
  // 그 뒤 예약을 막아 버린다.
  const 걷기 = (schedule.broadcast_type || 'text') === 'chime' ? () => {} : 예약나감표시()
  try {
  const startedAt = Date.now()          // 발사 순간. 소리 지시까지 얼마나 걸렸는지 재는 기준
  const broadcastType = schedule.broadcast_type || 'text'
  const time = nowHHMM()
  // 이 방송의 주 소리 볼륨(0~100). 예약에 값이 없으면 시스템 기본값이 그대로 들어온다.
  // 화면은 이 값을 받으면 그 재생에만 쓰고, 자기 슬라이더 값은 건드리지 않는다.
  const mainVolume = resolveMainVolume(db, schedule)
  // 이 예약이 트는 음원·영상의 재생 배속(0.5~1.5). NULL이면 화면이 원래 속도로 튼다.
  // 볼륨과 같은 규칙 — 전역 설정을 안 건드리고 이 방송 이벤트에만 싣는다.
  const rate = schedule.playback_rate ?? null

  // 차임벨 타입 — 서버 스피커 + 브라우저 Web Audio 동시 재생
  if (broadcastType === 'chime') {
    // 'general'이 이 시스템이 실제로 내는 차임음이다(carecast_chime.py PATTERNS). 예전엔 'meal'을
    // 넘겼지만 낼 수 있는 소리가 아니라 조용히 general로 접히고 있었다 — chime-types.test.js가 고정한다.
    //
    // 흐름 분기(아래 flow 타입)와 같은 규약이다 — RUNNING으로 먼저 적고, 재생 결과는 playChime의
    // 콜백으로 비동기에 와서 SUCCEEDED/FAILED로 확정한다(ISSUE-002, 2회차 재수정 2026-09-06).
    // 1회차는 "SUCCEEDED로 먼저 적고 실패만 내리는" 낙관적 정정이었는데, 콜백이 영영 안 오는
    // 경로(서버 강제종료·정전·autoUpdate 재시작)에서 그 행이 성공으로 굳었다 —
    // 기동 회수(flowOutcome.recoverInterrupted)는 RUNNING만 대상이라 그 행을 못 건졌다.
    // 독립 검수가 이를 CC-003(그래서 세 번째 상태를 만들었다)의 재발로 지적해 되돌렸다.
    const logId = finishScheduleFire(db, schedule, time, schedule.title, RUNNING)
    playChime('general', mainVolume, (ok) => {                        // 서버 스피커 (Python sounddevice)
      const { settleLog } = require('./flowOutcome')
      settleLog(db, logId, RUNNING, ok ? SUCCEEDED : FAILED, ok ? '' : '차임벨 재생 실패')
      // 결과를 아는 자리는 여기뿐이다. 발사 직후에 "완료"라고 찍었더니 4ms 뒤 실패한 것을
      // 로그가 먼저 완료로 말했다(ISSUE-008, EV-000448) — 이력은 정직했고 로그만 거짓이었다.
      console.log(`[스케줄러] "${schedule.title}" 차임벨 ${ok ? '재생 완료' : '재생 실패'} (${time})`)
    })
    broadcastSSE('chime_play', { type: 'general', volume: mainVolume }) // 브라우저 Web Audio API 트리거
    console.log(`[스케줄러] "${schedule.title}" 차임벨 발사 (${time}) — 재생 결과는 콜백에서 남긴다`)
    return
  }

  // 음원선택 타입 — 업로드된 음원 파일을 직접 재생(TTS 없음)
  if (broadcastType === 'audio') {
    const file = schedule.audio_file_id
      ? db.prepare('SELECT * FROM audio_files WHERE id = ?').get(schedule.audio_file_id)
      : null
    if (file) {
      broadcastSSE('prayer_play', {
        url:         `/audio/${file.category}/${file.filename}`,
        name:        file.original_name,
        token:       crypto.randomBytes(8).toString('hex'),
        restoreBGM:  false,
        volume:      mainVolume,
        rate,
        // 화면이 이 값으로 자막을 찾는다. 자동방송(broadcastSteps)·흐름(flowRunner)은 이미
        // 싣고 있는데 예약만 빠져 있어서, 예약으로 튼 음원에만 자막이 안 나왔다.
        audioFileId: file.id,
      })
    } else {
      reportMissingSource(schedule, `음원(id=${schedule.audio_file_id})`)
    }
    // 파일이 없었으면 소리가 난 적이 없다 — 청취자가 있어도 success=1로 적으면 안 된다
    finishScheduleFire(db, schedule, time, schedule.title, !!file && hasSitePlayer())
    console.log(`[스케줄러] "${schedule.title}" 음원 재생 ${file ? '완료' : '실패'} (${time})`)
    return
  }

  // 업로드 영상 타입 — audio_files(영상 카테고리, source_type='upload') 파일을 재생.
  // broadcastSequencer.js가 국민체조 등 자동 영상 재생에 쓰는 것과 동일한 video_play SSE.
  if (broadcastType === 'video') {
    const file = schedule.audio_file_id
      ? db.prepare('SELECT * FROM audio_files WHERE id = ?').get(schedule.audio_file_id)
      : null
    if (file) {
      // 자동방송(stepVideoFile)과 같은 순서 — 소리 있는 영상은 BGM을 끈다(§3-B 규칙 4).
      // bgm_stop은 로컬 BGM(MusicPlayer.stopBGM)을 세운다.
      // 이게 빠져서 예약 영상은 로컬 BGM 위에 소리가 얹혔다(td09 H11 — 자동방송과 비대칭).
      const sinceGen = require('./broadcastGate').cancelGeneration()
      broadcastSSE('bgm_stop', {})
      await new Promise(r => setTimeout(r, 1500))   // 페이드 완료 대기 — stepVideoFile과 동일
      // 그 1.5초는 자동방송이 시작되거나(밀어냄 = 세대 증가) 사람이 정지를 누르기에 충분하다
      // (레드 검증 F6). 세대가 달라졌으면 새 소리 위로 영상을 쏘지 않는다 — 녹음 안내 3.5초
      // 경로의 sinceGen과 같은 어휘·같은 이유. 미뤘다 다시 쏘지는 않는다: 세대 증가만으로는
      // "새 방송"과 "사람 정지"를 구별할 수 없고, 정지 직후 영상이 저절로 나오면 더 나쁘다.
      // 건너뛴 사실은 이력 실패 + 경보로 요란하게 남긴다(H5 상한 초과와 같은 결말).
      if (require('./broadcastGate').cancelGeneration() !== sinceGen) {
        const msg = `"${schedule.title}" 영상 예약이 페이드 대기 중 정지·새 방송과 겹쳐 나가지 않았습니다.`
        console.error(`[스케줄러] ${msg}`)
        raiseAlert('예약방송', msg, { scheduleId: schedule.id })
        finishScheduleFire(db, schedule, time, schedule.title, false)
        return
      }
      broadcastSSE('video_play', {
        url:      `/audio/${file.category}/${file.filename}`,
        source:   'file',
        videoId:  null,
        name:     file.original_name,
        token:    crypto.randomBytes(8).toString('hex'),
        category: file.category,
        volume:   mainVolume,
        rate,
        // 화면(VideoPlayer)이 이 값으로 자막을 찾는다. 음원 예약과 같은 누락이 영상에도 있어서,
        // 자막을 고쳐 「방송에 쓰기」로 저장해도 예약으로 튼 영상에만 자막이 안 나왔다.
        audioFileId: file.id,
      })
    } else {
      reportMissingSource(schedule, `영상(id=${schedule.audio_file_id})`)
    }
    finishScheduleFire(db, schedule, time, schedule.title, !!file && hasSitePlayer())
    console.log(`[스케줄러] "${schedule.title}" 영상 재생 ${file ? '완료' : '실패'} (${time})`)
    return
  }

  // BGM 단독 타입 — 배경음악만 재생(TTS 없음). 관리자 모달에서 이 타입을 고르면
  // bgm_enabled 체크박스 자체가 UI에 노출되지 않으므로(ScheduledBroadcast.jsx isBGM
  // 분기), 여기서는 항상 켜진 것으로 간주해서 resolveBGM을 호출한다.
  if (broadcastType === 'bgm') {
    const resolved = await resolveBGM(db, { ...schedule, bgm_enabled: 1 })
    if (resolved) {
      // 신호는 bgmEmit 하나가 낸다(이 PC 의 방송용·식사용 폴더 곡).
      require('./bgmEmit').emitBGM(resolved)
    } else {
      reportMissingSource(schedule, 'BGM')
    }
    finishScheduleFire(db, schedule, time, schedule.title, !!resolved && hasSitePlayer())
    console.log(`[스케줄러] "${schedule.title}" BGM 재생 ${resolved ? '완료' : '실패'} (${time})`)
    return
  }

  // 방송 흐름 타입 — flow_sequence_steps를 순서대로 실행.
  // (예전엔 flowRunner가 이 모듈을 역참조해서 순환 때문에 지연 require가 필수였다 —
  //  배선도 ①에서 해소됐지만, 흐름이 없는 기동 경로에서 굳이 당길 이유가 없어 그대로 둔다)
  if (broadcastType === 'flow') {
    if (schedule.flow_sequence_id) {
      const { runFlow } = require('./flowRunner')
      // 흐름은 예약 시각(at_time) 대기 때문에 수십 분 걸릴 수 있다. 기다렸다가는 같은 분(分)에
      // 걸린 다른 예약과 SwitchBot·BGM 점검이 흐름이 끝날 때까지 통째로 밀린다(음원 180초
      // 고정 대기 시절 실제로 12분씩 밀렸던 그 사고의 구조). 발사만 하고 바로 넘어간다 —
      // 중복 실행은 runFlow의 runningFlows 가드가 막고, 실패는 아래 catch 로그로 남는다.
      // 예약에 건 배속이 흐름 안의 음원·영상까지 따라간다 — 같은 예약을 두 군데서 설정하게 만들지 않는다.
      // 발사 즉시 기록한다 — 로그·last_fired·1회성 비활성화가 흐름이 끝날 때까지 밀리면,
      // 그 사이 서버가 죽었을 때 다음 기동에서 같은 예약이 또 발사될 수 있다.
      // 다만 **결과는 아직 모른다.** 흐름은 수십 분 걸릴 수 있고 3단계에서 죽을 수도 있다.
      // 그래서 "진행 중"으로 남기고, 끝나면 아래에서 성공/실패로 정정한다(CC-003).
      const logId = finishScheduleFire(db, schedule, time, schedule.title, RUNNING)
      const { settleFlowLog } = require('./flowOutcome')
      runFlow(db, schedule.flow_sequence_id, { rate })
        .then(result => {
          // 'completed_with_failures' — 끝까지 갔지만 고장 신호가 있었다(지금은 차임 연속 3회 실패뿐).
          // 차임 1~2회 실패는 여기 안 온다 — 보조 신호라 단계 이력에만 남는다(사용자 결정 2026-09-07).
          // outcomeOfFlow 가 실패로 정산하므로 여기서는 사유만 붙인다. 어느 단계였는지는 단계 이력에 있다.
          // 'completed_no_player' — 끝까지 갔지만 **브라우저가 내야 할 소리를 낼 창이 없었다**
          // (P-51, 사용자 승인 2026-09-10). 차임처럼 서버 스피커로 나가는 단계만 있는 흐름은
          // 여기 안 걸린다 — `domain/stepPlayer` 가 단계별 재생 주체를 가른다.
          // 문구는 `domain/broadcastOutcome` 한 곳이 정한다(P-34). 예전엔 여기 세 갈래를
          // 적고 나머지를 **한 줄로 뭉갰다** — `cancelled`(사람이 정지)·`preempted`(밀림)·
          // `skipped`(건너뜀)이 같은 말로 남아, "왜 안 나갔냐" 에 답할 수가 없었다.
          settleFlowLog(db, logId, result, 흐름사유문구(result))
        })
        .catch(err => {
          console.error(`[스케줄러] "${schedule.title}" 흐름 실행 실패:`, err.message)
          settleFlowLog(db, logId, 'failed', err.message)
          // 예전엔 위 console.error 한 줄이 전부라 화면·이력 어디에도 안 남았다.
          // 흐름이 죽으면 그 시간대 방송이 통째로 없는 것이므로 사람이 알아야 한다.
          raiseAlert('방송흐름', `"${schedule.title}" 방송이 중간에 멈췄습니다: ${err.message}`,
            { scheduleId: schedule.id })
        })
    } else {
      console.error(`[스케줄러] "${schedule.title}" 연결된 흐름이 없음`)
      finishScheduleFire(db, schedule, time, schedule.title, false)
      raiseAlert('방송흐름', `"${schedule.title}"에 연결된 흐름이 없어 방송이 나가지 않았습니다.`,
        { scheduleId: schedule.id })
    }
    console.log(`[스케줄러] "${schedule.title}" 흐름 시작 (${time})`)
    return
  }

  const tts  = loadTTSConfig(db)
  let tmpFile = null

  // BGM 해석 (차임벨 타입은 제외)
  const bgm = await resolveBGM(db, schedule)

  try {
    // 내용이 있으면 TTS 방송 실행
    if (schedule.content?.trim()) {
      // **실행 직전에도 개인정보 검사를 한다**(2026-11-10, 흐름과 같은 원칙 — 전문가 1차 검토 4-1).
      // 저장 때만 보면 검사가 생기거나 규칙이 강해지기 전에 저장된 예약이 그대로 나간다. 무인 발사라
      // 되물을 사람이 없으니 차단 항목이면 이 예약은 내보내지 않고 실패로 적고 경보를 띄운다.
      // 이력·경보에는 **문구 원문을 남기지 않는다**(아래 catch 는 원문을 적으므로 그 길로 보내지 않는다).
      const 막을것 = 막을개인정보(schedule.content)
      if (막을것) {
        const msg = `"${schedule.title}" 문구에 개인정보(${막을것})가 있어 방송하지 않았습니다. 예약을 열어 문구를 고쳐 주세요.`
        console.error(`[스케줄러] ${msg}`)
        finishScheduleFire(db, schedule, time, `${schedule.title} — 개인정보(${막을것})로 방송 안 함`, false)
        raiseAlert('예약방송', msg, { scheduleId: schedule.id })
        return
      }
      // 문구를 여기서 짓지 않는다 — 미리 만들기(prewarm)와 **글자 하나까지 같아야** 캐시가
      // 맞는다. 한 곳에서만 짓는 이유가 그것이다.
      // **정시에 나가는 것이 먼저다.** 15초 안에 못 만들면 어제 소리(캐시)로 내보내거나
      // 실패를 알린다 — 3분을 기다리면 그 사이 같은 분의 다른 예약까지 밀린다.
      // 예약 경로도 기존 즉시 렌더 집계에 남긴다. 재시도·시간 예산·발사 순서는 유지한다.
      const { isReady, recordMiss } = require('./renderOnDemand')
      if (!isReady(ttsParamsForSchedule(schedule, tts))) recordMiss({ title: schedule.title, scheduleId: schedule.id })
      tmpFile = await generateTTSWithRetry(ttsParamsForSchedule(schedule, tts), 3, { deadlineMs: BROADCAST_BUDGET_MS })
      // 자막은 읽은 문장 기준이다. repeat_broadcast면 문장이 두 번 이어붙는데(ttsParamsForSchedule),
      // 그 이어붙인 문장을 그대로 넘겨야 어절이 원문에 맞는다.
      const cues = readCues?.(tmpFile, ttsParamsForSchedule(schedule, tts).text) ?? null
      const audioId = storeAudio(tmpFile)
      tmpFile = null
      broadcastSSE('scheduled_broadcast', {
        title:   schedule.title,
        content: schedule.content,
        target:  schedule.target,
        audioId,
        bgm,        // null 또는 { videoId, embedUrl, bgmTitle, delay, bgmDefault }
        ttsVolume: mainVolume,  // 이 방송에만 쓸 안내 음성 볼륨(0~100)
        cues,
      })
    }

    // 녹음 안내 타입인 경우 — 3.5초 후 브라우저에 녹음 음원 재생 지시
    const prayerCat = PRAYER_CAT_MAP[broadcastType]
    if (prayerCat) {
      const withStaff = broadcastType.endsWith('-staff')
      // sinceGen: 발사를 예약하기 **직전**에 읽어 둔 cancelGeneration().
      // 그 3.5초는 사람이 정지 버튼을 누르거나 다음 자동방송이 시작되기에 충분한 시간인데,
      // 예전엔 콜백이 아무것도 확인하지 않고 쏴서 새 소리 위로 녹음 음원이 겹쳐 나갔다.
      // 세대가 달라졌다 = 그 사이 정지·새 방송이 있었다 = 보내지 않는다
      // (waitForAudioEnd의 sinceGen과 같은 어휘·같은 이유). 절대값이 아니라 이 방송이
      // 시작할 때의 값과 대조해야 과거의 취소 횟수가 멀쩡한 방송을 막지 않는다.
      const sinceGen = require('./broadcastGate').cancelGeneration()
      setTimeout(() => {
        if (require('./broadcastGate').cancelGeneration() !== sinceGen) return
        broadcastSSE('prayer_schedule_play', { category: prayerCat, withStaff })
      }, 3500)
    }

    // 여기까지 오는 데 걸린 시간이 곧 "정시에서 얼마나 밀렸나"다(합성이 대부분을 차지한다)
    const prepMs = Date.now() - startedAt
    finishScheduleFire(db, schedule, time, schedule.content || schedule.title, hasSitePlayer(), prepMs)
    console.log(`[스케줄러] "${schedule.title}" 방송 완료 (${time}, 대상: ${schedule.target}`
      + `, 준비 ${(prepMs / 1000).toFixed(1)}초)`)

  } catch (err) {
    console.error(`[스케줄러] "${schedule.title}" 방송 실패:`, err.message)
    db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(todayStr(), time, '예약', schedule.content || schedule.title, '자동', schedule.target, 0)
  } finally {
    if (tmpFile) deleteTmpFile(tmpFile)
  }
  } finally {
    // **반드시 걷는다**(P-42). 안 걷히면 그 뒤 예약이 전부 미뤄지다 상한에 걸려
    // **건너뛴다** — 겹치는 것보다 나쁠 수 있다(방송이 아예 안 나간다).
    // 위 `try` 가 함수 전체를 감싸므로, 어느 경로로 빠져나가도 여기를 지난다.
    걷기()
  }
}

// 아침 종합 방송 실행은 broadcastSequencer.fireMorningBroadcast()가 담당한다.
// (예전 이 자리에 있던 약 56줄짜리 중복 구현은 호출자 0건인 죽은 코드라 제거 — CC-046)

// SwitchBot 자동 ON/OFF 시간 체크 (매분 호출)
async function checkSwitchBotSchedule(db, current, today) {
  const autoControl = rawSetting(db, 'switchbot_auto_control')
  if (autoControl !== 'true') return  // 자동 제어 비활성화 시 스킵

  const onTime  = rawSetting(db, 'switchbot_on_time')  ?? '07:45'
  const offTime = rawSetting(db, 'switchbot_off_time') ?? '17:30'
  const onFired = rawSetting(db, 'switchbot_on_fired')
  const offFired= rawSetting(db, 'switchbot_off_fired')

  // 자동 ON — 당일 미실행 + 시간 일치
  if (current === onTime && onFired !== today) {
    try {
      await switchbot.sendCommand('press')
      setSetting(db, 'switchbot_on_fired',    today)
      setSetting(db, 'switchbot_last_control', JSON.stringify({ action: 'on', time: new Date().toISOString() }))
      db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(today, current, '시스템', `SwitchBot 자동 ON (${onTime})`, '자동', '-', 1)
      console.log(`[스케줄러] SwitchBot 자동 ON 완료 (${onTime})`)
    } catch (err) {
      console.error('[스케줄러] SwitchBot 자동 ON 실패:', err.message)
      db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(today, current, '시스템', `SwitchBot 자동 ON 오류: ${err.message}`, '자동', '-', 0)
    }
  }

  // 자동 OFF — 당일 미실행 + 시간 일치
  if (current === offTime && offFired !== today) {
    try {
      await switchbot.sendCommand('press')
      setSetting(db, 'switchbot_off_fired',   today)
      setSetting(db, 'switchbot_last_control', JSON.stringify({ action: 'off', time: new Date().toISOString() }))
      db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(today, current, '시스템', `SwitchBot 자동 OFF (${offTime})`, '자동', '-', 1)
      console.log(`[스케줄러] SwitchBot 자동 OFF 완료 (${offTime})`)
    } catch (err) {
      console.error('[스케줄러] SwitchBot 자동 OFF 실패:', err.message)
      db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(today, current, '시스템', `SwitchBot 자동 OFF 오류: ${err.message}`, '자동', '-', 0)
    }
  }
}

// 스케줄러 시작 (서버 기동 시 1회 호출)
// ── 자동방송 중의 예약은 미룬다 (td09 H5, (나)안 — 사용자 결정 2026-09-02) ─────────
// 자동방송 5종만 취소 토큰을 받고 예약은 토큰이 없어서, 자동방송 도중 예약 시각이 오면
// 시퀀서가 모른 채 예약 소리가 그 위에 얹혔다 — 안내 둘이 겹치면 어느 쪽도 못 알아듣는다.
// 진행 중 판정은 nowPlaying.broadcast — 시퀀서(broadcastStart)만 세우는 값이라 정확히
// "자동방송·수동재생 진행 중"이다(흐름과 예약 자신은 여기 안 잡힌다).
// 미룸 목록은 서버 메모리다 — 재시작하면 사라지고 그 예약은 그날 안 나간다(이력도 없음).
// 방송 도중 서버 재시작 자체가 드문 사고라 받아들인다. 상한을 두는 이유: broadcast 상태가
// 어떤 사고로 안 비워져도 예약이 조용히 무기한 밀리는 대신, 건너뛰고 **요란하게** 남는다.
// 차임벨은 미루지 않는다 — 차임은 공존이 명세다(td09 §3-B 규칙 5).
const deferred = new Map()   // `${id}|${날짜}|${시각}` → { schedule, since(ms) }

// "지금 소리가 나가고 있는가". 근거가 **둘**이다.
//   · nowPlaying.broadcast — 시퀀서를 지나는 것(자동방송·수동재생)
//   · micLive.isLive()     — 마이크 생방송. 서버 스피커로 직접 나가는 길이라 시퀀서를
//     안 지나고, 그래서 예전엔 여기에 안 잡혔다. 직원이 말하는 중에 정시 예약이 그 위로
//     얹혔다 — 안내 둘이 겹치면 어느 쪽도 못 알아듣는다(레드 검증 F6의 나머지 절반).
//     자동방송 중 예약을 미루는 이유(H5)와 같은 이유라 같은 길로 보낸다.
/**
 * 지금 소리가 나가는 중인가 — **소리를 내는 주체를 전부 본다** (P-42 · P-55, 2026-09-11).
 *
 * 전에는 `nowPlaying.broadcast` 와 `micLive` **둘만** 봤다. 그런데 즉시 TTS
 * (`routes/tts.js`)는 `audioQueue.enqueue` 로 **같은 서버 스피커**를 쓰면서 `nowPlaying` 에
 * 아무것도 안 남긴다([FACT] EV-004047 — `tts.js` 의 `nowPlaying` 참조 0건).
 * 그래서 **즉시 방송이 나가는 중에 정시가 오면 두 소리가 한 스피커로 겹쳤다.**
 *
 * **새 상태를 만들지 않았다.** `audioQueue.isBusy()` 가 이미 있고(`audioQueue.js:226`),
 * `autoUpdate.js:140` 은 **이미 그것을 본다** — 스케줄러만 안 보고 있었다. 그 비대칭이
 * 이 결함이었다. 같은 것을 여기서도 본다.
 *
 * **한 출처가 터져도 나머지는 본다.** 예전 코드는 `micLive` 조회를 `try { return ... }` 로
 * 감싸서 그것이 터지면 곧바로 `false` 였다 — 조회 실패가 게이트를 통째로 여는 모양이다.
 * 확신이 없을 때는 **막는 쪽**이 싸다(`autoUpdate` 가 같은 이유로 그렇게 한다).
 */
// **예약도 자기가 나가는 중임을 남긴다** (P-42, 2026-09-11).
//
// [FACT] `scheduler.js` 의 위 주석이 스스로 말했다 — `nowPlaying.broadcast` 는
// **시퀀서(`broadcastStart`)만 세우는 값**이라 "흐름과 예약 자신은 여기 안 잡힌다".
// 그래서 같은 분에 예약이 둘이면 `due` 배열을 순차 처리하는 동안 **앞 예약이 나가는 중이라는
// 사실이 아무 데도 안 남아**, 두 번째가 그대로 나가고 화면이 앞 소리를 `pause()` 로 끊는다.
// 이력에는 **둘 다 성공**으로 남는다.
//
// **`nowPlaying` 을 쓰지 않는 이유**: 그 값은 화면이 "지금 무엇이 나가는가" 를 그리는 데
// 쓴다. 예약마다 거기에 썼다 지우면 화면이 깜빡이고, 시퀀서가 쓰는 것과 뒤섞여 누가 지웠는지
// 모르게 된다. 여기서는 **게이트만 보면 되는 셈** 하나로 충분하다.
//
// 셈(count)인 이유: 미룸 처리(`processDeferred`)가 앞 예약과 겹쳐 돌 수 있어 둘이 동시에
// 표시될 수 있다. 참·거짓이면 먼저 끝난 쪽이 남은 쪽의 표시까지 지운다.
let _예약나감 = 0

/**
 * 예약 하나가 나가기 시작했다고 표시한다.
 * @returns {() => void} 걷는 함수. **반드시 `finally` 에서 부른다** — 안 걷히면
 *   그 뒤 예약이 전부 미뤄지다 상한에 걸려 **건너뛴다**(겹치는 것보다 나쁠 수 있다).
 *   같은 걷기를 두 번 불러도 셈이 음수로 안 내려간다.
 */
function 예약나감표시() {
  _예약나감 += 1
  let 걷었나 = false
  return () => { if (!걷었나) { 걷었나 = true; _예약나감 = Math.max(0, _예약나감 - 1) } }
}

// ── **낡은 「방송 중」은 무시한다** (현장 신고 2026-09-16) ──────────────────────
//
// `nowPlaying.broadcast` 는 **브라우저가 켜고 브라우저가 끈다.** 그 사이에 창이 닫히거나
// 새로고침되거나 SSE 가 끊기면 **끄는 쪽이 영영 안 온다.** 그러면 이 함수가 계속 true 를
// 내고, 그 뒤 예약이 전부 미뤄지다가 `deferMaxMin` 뒤에 「겹쳐서 건너뛰었습니다」로
// 버려진다. 2026-09-16 현장에서 환기방송 2차가 그렇게 빠졌다 — **겹친 것은 없었다.**
//
// 이 장치의 고장은 `duplicateBroadcast` 의 열쇠 끼임과 **같은 모양**이고, 거기 적어 둔
// 판단이 여기에도 그대로 맞는다: *막으려던 것(겹침)보다 나쁜 결과다 — 무음은 이 저장소에서
// 가장 비싼 실패다.* 그래서 상한을 둔다. 지나면 그 표시는 **없는 것으로 본다.**
//
// 20분: 가장 긴 자동방송(아침 종합)보다 넉넉히 길고, 「영원히」보다는 훨씬 짧다.
// 이 상한에 걸리는 것은 **정상이 아니므로 로그를 남긴다** — 조용히 지나가면 원인이 묻힌다.
const 방송표시상한ms = 20 * 60 * 1000
let _낡음알림 = 0

function broadcastInProgress() {
  let 바쁨 = false
  try { if (require('./broadcastGate').isBroadcastActive?.()) 바쁨 = true } catch { /* 아래 출처도 확인 */ }
  let queueBusy = null
  try { queueBusy = require('./audioQueue').isBusy() } catch { /* 모르면 화면 표시를 유지한다 */ }
  if (_예약나감 > 0) 바쁨 = true
  try {
    const np = require('./nowPlaying')
    const broadcast = np.get().broadcast
    // 서버 소리는 아래 audioQueue가 실제 재생 여부를 안다. 브라우저의 종료 보고가
    // 유실되어도 표시만으로 예약을 막지 않는다(20분 표시 상한보다 예약 포기가 10분 빠르다).
    // 그 외 방송은 브라우저에서 재생되므로 기존 표시·유예 판단을 유지한다.
    if (broadcast && (broadcast.서버소리 !== true || queueBusy !== false)) {
      // **모르면 「방송 중」이다.** 켜진 시각을 못 읽으면 낡았는지 판단할 근거가 없는데,
      // 그때 「낡았다」로 치면 **진짜 방송 위에 예약이 겹쳐 나간다.** 낡음 걸러내기는
      // 굳은 표시를 푸는 장치이지, 판단이 안 될 때 문을 여는 장치가 아니다.
      // (이 갈래를 반대로 썼다가 `broadcast-busy-sources.test.js` 가 잡았다.)
      const 켜진때 = np.getBroadcastSince?.() || 0
      const 켜진지 = 켜진때 ? Date.now() - 켜진때 : 0
      if (켜진지 <= 방송표시상한ms) 바쁨 = true
      else if (Date.now() - _낡음알림 > 60_000) {
        _낡음알림 = Date.now()
        console.warn(`[스케줄러] 「방송 중」 표시가 ${Math.round(켜진지 / 60000)}분째 안 꺼져 무시합니다 — `
          + '끄는 신호가 안 왔습니다(창이 닫혔거나 새로고침됐을 수 있습니다). 예약은 정상 발사합니다.')
      }
    }
  } catch { /* 못 읽으면 다음 출처로 */ }
  try { if (require('./micLive').isLive()) 바쁨 = true } catch { /* 위와 같다 */ }
  // 서버 스피커 대기열 — 즉시 TTS·마이크 재생이 여기로 간다(P-55 가 빠뜨린 자리)
  if (queueBusy === true) 바쁨 = true
  return 바쁨
}

// 미룸 상한(분). 스피커·운영마다 달라서 설정으로 열어 둔다(schedule_defer_max_min, 기본 10).
// 규칙·기본값은 domain/watchSettings 한 곳이다 — 설정 화면이 같은 것을 보여 줘야 해서 옮겼다(2026-09-23).
function deferMaxMin(db) {
  return require('../domain/watchSettings').미룸상한(db)
}

// 이 분에 자동방송 5종 중 발동할 것이 있는가 (레드 검증 F6 후속, 2026-09-03).
//
// tick은 예약을 먼저 돌고 자동방송을 나중에 돈다. 그래서 같은 분에 둘이 있으면
// **예약이 먼저 나가 이력에 성공으로 적히고, 1.5초 뒤 자동방송이 그것을 밀어낸다** —
// 홀에서는 잘려 나가는데 기록은 성공인 "거짓 성공"(CC-003 계열)이다.
// 아직 시작 전이라 broadcastInProgress()가 false인 **그 tick 하나**가 구멍이었다.
//
// 순서를 바꿔 자동방송을 먼저 돌리는 길도 있지만, 발사는 await하지 않으므로 "시작됐다"가
// 언제 참이 되는지가 실행 타이밍에 달린다 — 그런 배선은 조용히 어긋난다. 대신 설정을
// 읽어 **예정을 직접 본다**: 판정 근거가 발동부와 같은 세 조건(켜짐·시각 일치·오늘 미발동)이다.
function autoDueThisMinute(db, current, today) {
  const keys = AUTO_BROADCASTS.flatMap(b => [b.enabledKey, b.timeKey, b.firedKey])
  const s = rawSettings(db, keys)
  return AUTO_BROADCASTS.filter(spec =>
    s.get(spec.enabledKey) === 'true'
    && (s.get(spec.timeKey) ?? spec.defaultTime) === current   // ??다 — 빈 값은 "안 나감"
    && s.get(spec.firedKey) !== today)
}

/**
 * 예약 하나를 지금 내보내거나 미룬다.
 *
 * @param {boolean} 앞서나감 **이 tick 에서 이미 예약 하나가 나갔나**(P-42 후속, 2026-09-11).
 *   `_예약나감` 카운터로는 이것을 못 본다 — 브라우저가 내는 유형(예약 6종 중 다섯,
 *   PROJECT_PROFILE §1-3)은 **SSE 를 쏘고 곧바로 반환**하므로 `finally` 가 그 자리에서
 *   카운터를 걷는다. 그래서 다음 예약이 볼 때는 이미 0 이다([FACT] EV-004133 재현:
 *   같은 분 음원 예약 둘이 **둘 다** `prayer_play` 를 냈고 이력에 성공이 둘 남았다).
 *
 *   **실행 타이밍에 안 기댄다.** `setImmediate` 로 걷기를 미루면 지금은 되지만, 그 배선은
 *   `await` 의 순서에 달려 있어 조용히 어긋난다 — 이 파일이 `autoDueThisMinute` 주석에서
 *   스스로 경고하는 함정이다. 그래서 **부르는 쪽이 명시적으로 넘긴다.**
 * @returns {Promise<boolean>} 실제로 내보냈으면 true, 미뤘으면 false.
 */
async function deferOrFire(db, schedule, 앞서나감 = false, 지금 = nowHHMM()) {
  // 진행 중이거나(H5), 이 분에 자동방송이 예정돼 있으면(F6 후속), 같은 분 예약이 먼저
  // 나갔으면 미룬다. **판정은 `내보내면안되는이유` 한 곳에 있다** — 미룸 경로도 같은 것을
  // 본다(P-128). 여기는 "그래서 미룬다" 만 한다.
  const 이유 = 내보내면안되는이유(db, schedule, { 앞서나감, 지금 })
  if (이유) {
    const key = `${schedule.id}|${todayStr()}|${schedule.scheduled_time}`
    if (!deferred.has(key)) {
      deferred.set(key, { schedule, since: Date.now() })
      console.log(`[스케줄러] "${schedule.title}" ${이유} — 끝나면 내보낸다 (예정 ${schedule.scheduled_time})`)
    }
    return false
  }
  await fireSchedule(schedule, db)
  return true
}

/**
 * 이 분에 예정된 예약들을 **차례로** 내보낸다 — 하나가 나가면 나머지는 미룬다.
 *
 * **왜 함수로 떼어 놨나**(P-42 후속, 2026-09-11): 이 규칙은 `deferOrFire` 안이 아니라
 * **부르는 쪽**에 있다. tick 안에 두면 테스트가 그 자리를 못 밟아, 결함이 여기 있는데
 * `deferOrFire` 만 검사하고 초록을 봤다 — Codex 독립 검수가 그것을 지적했다.
 * 규칙이 사는 자리를 **직접 부를 수 있게** 만든다.
 *
 * 무엇을 고쳤나: 같은 분에 예약이 둘이면 이 루프가 **둘 다** 발사했다. 브라우저가 내는
 * 유형(예약 6종 중 다섯, PROJECT_PROFILE §1-3)은 SSE 를 쏘고 곧바로 반환해서
 * `_예약나감` 카운터가 그 자리에서 걷히고, 두 번째가 볼 때는 이미 0 이었다
 * ([FACT] EV-004133 재현 — `prayer_play` 2건 · 미뤄짐 0건 · 이력에 성공 2건).
 * 홀에서는 앞 소리가 끊기는데 **이력에는 둘 다 성공**이다(거짓 성공, CC-003 계열).
 *
 * **미룬 것은 버리는 것이 아니다** — `processDeferred` 가 다음 tick 에 다시 본다(상한 있음).
 *
 * **남은 구멍**: 다음 tick 은 1분 뒤다. 앞 방송이 1분보다 길면 그때 또 겹친다.
 * 끝까지 막으려면 **재생이 끝난 것을 서버가 알아야** 하는데 그 창구가 없다
 * ([FACT] EV-004134 — `POST /api/status/now-playing` 라우트는 있고 `src/` 에 호출 0건).
 * 길이로 잡는 길(`audio_files.duration`)은 겹침 대신 **건너뜀**을 만들 수 있어 사용자 결정을
 * 받는다. `docs/audit/ISSUES.md` P-42-2 참고.
 */
/**
 * **이 예약을 지금 내보내도 되나** — 발사 경로와 미룸 경로가 **같은 것**을 본다.
 *
 * @returns {string|null} 내보내면 안 되는 사유(사람이 읽을 말), 괜찮으면 null.
 *
 * **왜 뽑았나**(P-128, 2026-09-11): 이 규칙이 `deferOrFire` 와 `processDeferred` 두 곳에
 * 흩어져 있었고, **한쪽만 고쳐진 일이 이 함수 쌍에서만 네 번** 났다 —
 * 차임이 뒤 예약을 막던 것 · 미룬 tick 이 겹치던 것 · 미룬 차임이 진행 중에 막히던 것 ·
 * 23:59 예외가 한쪽에만 들어간 것. 전부 Codex 독립 검수가 잡았다(FP-0005 의 전형).
 * 이 저장소가 볼륨·음원 경로·식사 안내에서 같은 이유로 단일 출처를 만든 것과 같은 자리다.
 *
 * **여기에 안 넣은 것 둘**은 미룸에만 있는 개념이라 `processDeferred` 가 계속 갖는다 —
 * 날 넘김 처리(레드 검증 F2)와 미룸 상한(`deferMaxMin`). 사유를 받은 쪽이 "미룰지
 * 건너뛸지" 를 정하는 것도 부르는 쪽의 몫이다.
 */
function 내보내면안되는이유(db, schedule, { 앞서나감 = false, 지금 = nowHHMM() } = {}) {
  // 차임은 공존이 명세다(td09 §3-B 규칙 5) — 아래 어느 것에도 안 걸린다.
  if ((schedule.broadcast_type || 'text') === 'chime') return null

  // **미룰 수 없는 분에는 제한을 안 건다**(P-127). 미루기는 "다음 tick 이 다시 본다" 는
  // 약속 위에 서는데, 23:59 의 다음 tick 은 00:00 이고 거기서 날 넘김 처리(F2)가
  // 그 예약을 발사하지 않고 버린다. 겹치는 것보다 안 나가는 것이 나쁘다.
  if (지금 === '23:59') return null

  if (앞서나감) return '같은 분 예약이 먼저 나갔다'
  if (broadcastInProgress()) return '방송이 나가는 중이다'
  if (autoDueThisMinute(db, 지금, todayStr()).length > 0) return '이 분에 자동방송이 있다'
  return null
}

async function 이번분예약돌기(db, due, 앞서나감 = false, 지금 = nowHHMM()) {
  // **23:59 에는 한 건 제한을 걸지 않는다**(P-127, Codex R9 지적).
  //
  // 미루기는 "다음 tick 이 다시 본다" 는 약속 위에 서 있다. 그런데 **그 약속이 성립하지
  // 않는 분이 하루에 하나 있다** — 23:59 다. 다음 tick 은 00:00 이고, 거기서는 날 넘김
  // 처리(레드 검증 F2, `processDeferred` 의 `todayStr() !== keyDate`)가 그 예약을
  // **발사하지 않고 실패로 적고 버린다.**
  //
  // Codex 는 "원래 발생일을 유지해 다음 날 발사하라" 고 제안했지만 **따르지 않았다.**
  // 그 길은 F2 가 일부러 막은 것이다 — `finishScheduleFire` 가 새 날짜로 `last_fired` 를
  // 찍어 **그날 밤 원래 시각의 발화까지 통째로 막는다**(`scheduler.js` 의 F2 주석).
  // 겹침 하나를 줄이려다 **다음 날 방송을 통째로 날리는** 거래가 된다.
  //
  // 그래서 이 분에만 제한을 안 건다. **내 변경 이전 동작으로 되돌리는 것**이지 새로 정하는
  // 것이 아니다 — 전에는 23:59 에도 둘 다 나갔다. 겹치는 것은 나쁘지만, 요양원에서
  // **안 나가는 것이 더 나쁘다**(CLAUDE.md 감시 규칙과 같은 판단).
  for (const s of due) {
    if (!shouldRunToday(s)) continue
    const 나갔나 = await deferOrFire(db, s, 앞서나감, 지금)
    // **차임은 셈에 안 넣는다** — 차임은 공존이 명세다(td09 §3-B 규칙 5). 공존이 명세인 것이
    // 남을 막으면 앞뒤가 안 맞는다: 차임 하나 때문에 그 분의 안내 방송이 통째로 1분 늦는다.
    // 처음에 이 조건을 빼먹어서 `[차임, 음원]` 이 실제로 그렇게 됐다(Codex 재검수 2026-09-11).
    // 검사를 `[음원, 차임]` **한쪽만** 써서 못 봤다 — 경계는 양방향으로 쓴다.
    if (나갔나 && (s.broadcast_type || 'text') !== 'chime') 앞서나감 = true
  }
  return 앞서나감
}

// 재진입 가드(레드 검증 F1) — cron은 이전 tick을 안 기다린다. 발사 하나(TTS 생성 재시도
// 등)가 분 경계를 넘으면 다음 tick이 **낡은 스냅샷**으로 같은 예약을 또 발사할 수 있다.
let _deferBusy = false

/**
 * 미뤄 둔 예약을 **한 tick 에 하나** 내보낸다.
 *
 * @returns {Promise<boolean>} 이 tick 에 **비차임 예약을 실제로 내보냈나**(P-124, 2026-09-11).
 *   `tick` 은 이것을 먼저 돌고 `이번분예약돌기` 를 부르는데, 그쪽이 `앞서나감` 을 false 로
 *   새로 시작해서 **미룬 음원이 방금 나갔는데 이번 분의 새 예약이 그 위에 겹쳤다**
 *   — P-118 에서 고친 것과 같은 겹침이 경로만 바꿔 남아 있었다(Codex R6 검수).
 *   `_예약나감` 카운터로는 못 본다: 브라우저 재생 유형은 SSE 를 쏘고 곧바로 반환해
 *   `finally` 가 그 자리에서 걷는다. 그래서 **tick 이 값을 손으로 건네준다.**
 */
async function processDeferred(db, 지금 = nowHHMM()) {
  if (_deferBusy) return false
  _deferBusy = true
  let 내보냈나 = false
  try {
    for (const [key, d] of [...deferred]) {
      if (!deferred.has(key)) continue   // 스냅샷이 낡았다 — 다른 경로가 이미 처리했다

      // 미뤄진 사이 지워지거나 꺼진 예약은 조용히 버린다 — 사람이 지운 것을 실패로 적지 않는다
      const fresh = db.prepare('SELECT * FROM schedules WHERE id = ? AND active = 1').get(d.schedule.id)
      if (!fresh) { deferred.delete(key); continue }

      // 날을 넘긴 미룸은 발사하지 않는다(레드 검증 F2). 나가면 ① 요일 규칙이 다른 날로
      // 새고 ② finishScheduleFire가 새 날짜로 last_fired를 찍어 **그날 밤 원래 시각의
      // 발화까지 통째로 막는다.** 건너뛴 사실은 원래 날짜의 이력·경보로 남기되,
      // last_fired는 안 건드린다 — 오늘 발화는 살아야 한다.
      const keyDate = key.split('|')[1]
      if (todayStr() !== keyDate) {
        deferred.delete(key)
        const msg = `"${fresh.title}" 예약이 자동방송과 겹친 채 날을 넘겨 건너뛰었습니다. 오늘 예정 시각에는 정상 발화합니다.`
        console.error(`[스케줄러] ${msg}`)
        raiseAlert('예약방송', msg, { scheduleId: fresh.id })
        db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(keyDate, fresh.scheduled_time, '예약', fresh.content || fresh.title, '자동', fresh.target, 0)
        continue
      }

      // **판정은 발사 경로와 같은 것을 쓴다**(P-128). 차임 예외 · 한 건 제한 · 진행 중 ·
      // 이 분의 자동방송 · 23:59 예외가 전부 그 한 곳에 있다. 여기 또 적으면 한쪽만
      // 고쳐진다 — 이 함수 쌍에서만 네 번 그랬다(FP-0005).
      const 이유 = 내보내면안되는이유(db, fresh, { 앞서나감: 내보냈나, 지금 })
      if (이유) {
        // **미룸에만 있는 규칙 하나**: 너무 오래 기다렸으면 건너뛴 사실을 남긴다.
        // 방송이 나가는 중일 때만 센다 — 줄 서서 기다리는 동안 건너뛰어지지 않게.
        if (이유 === '방송이 나가는 중이다') {
          const waitedMin = (Date.now() - d.since) / 60000
          if (waitedMin >= deferMaxMin(db)) {
            deferred.delete(key)
            const msg = `"${fresh.title}" (${fresh.scheduled_time}) 예약이 다른 방송과 겹쳐 ${Math.round(waitedMin)}분을 기다렸지만 방송이 끝나지 않아 건너뛰었습니다.`
            console.error(`[스케줄러] ${msg}`)
            raiseAlert('예약방송', msg, { scheduleId: fresh.id })
            finishScheduleFire(db, fresh, fresh.scheduled_time, fresh.content || fresh.title, false)
          }
        } else {
          console.log(`[스케줄러] "${fresh.title}" ${이유} — 계속 미룬다 (예정 ${fresh.scheduled_time})`)
        }
        continue
      }

      deferred.delete(key)
      console.log(`[스케줄러] "${fresh.title}" 미뤄 둔 예약을 내보낸다 (예정 ${fresh.scheduled_time})`)
      await fireSchedule(fresh, db)
      // 차임은 셈에 안 든다 — 공존이 명세라 남의 차례를 먹으면 안 된다.
      if ((fresh.broadcast_type || 'text') !== 'chime') 내보냈나 = true
    }
  } finally { _deferBusy = false }
  return 내보냈나
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    // 매 분 살아 있었다는 증거. /api/health가 이것으로 "떠 있지만 멈춘" 상태를 구별한다
    // (2026-08-29 리뷰 CC-012). 포트가 LISTEN이어도 이벤트 루프가 멎으면 방송은 안 나간다.
    lastTickAt = Date.now()
    const db      = getDB()
    // 같은 표식을 DB에도 남긴다(ISSUE-006). lastTickAt은 프로세스가 죽으면 사라지는데,
    // 예약 누락 감시는 **죽은 뒤에** "그 시각에 서버가 떠 있었나"를 물어야 한다.
    // 비정상 종료 구간의 끝이 이 값이다 — 없으면 꺼져 있던 밤이 통째로 가동 구간이 된다.
    try { require('./serverBoot').heartbeat(db) } catch { /* 계측이 방송을 막지 않는다 */ }
    const current = nowHHMM()
    const today   = todayStr()

    // **시계가 뛰었으면 그 사이에 있던 방송을 사람에게 알린다**(위 머리말, 현장 사고 2026-09-15).
    // 알리려다 방송을 멈추면 본말전도라 **절대 던지지 않는다** — 단계 알림과 같은 규칙이다.
    try {
      const 건너뛴 = 건너뛴분들(current)
      if (건너뛴.length) {
        const 놓친것 = 놓친방송찾기(db, 건너뛴, today)
        console.warn(`[스케줄러] 시계가 ${건너뛴[0]} ~ ${건너뛴[건너뛴.length - 1]} 를 건너뛰었다`
          + (놓친것.length ? ` — 그 사이 방송 ${놓친것.length}건이 발동되지 않았다` : ''))
        if (놓친것.length) {
          require('./alert').raise('시계건너뜀',
            `현장 PC 시계가 ${건너뛴[0]} 부터 ${건너뛴[건너뛴.length - 1]} 까지 건너뛰어 `
            + `${놓친것.join(' · ')} 방송이 나가지 않았습니다. `
            + '필요하면 오늘 일과방송 목록에서 ▶ 로 직접 내보내 주세요.', {}, db)
        }
      }
    } catch (e) { console.warn('[스케줄러] 시계 점프 확인 실패:', e.message) }

    // 자동방송이 방금 끝났으면 미뤄 둔 예약부터 내보낸다(td09 H5) — due보다 먼저 보는
    // 이유: 미뤄진 것이 시각상 더 오래된 약속이다.
    // **이 tick 이 이미 하나 내보냈는지 건네받는다**(P-124). 안 건네주면 미룬 음원이 방금
    // 나갔는데 이번 분의 새 예약이 그 위에 겹친다 — P-118 과 같은 겹침이 경로만 다른 것이다.
    // **시각도 건네준다** — 이 tick 이 보는 분은 하나여야 한다. 각자 `nowHHMM()` 을 다시
    // 부르면 분 경계에서 앞뒤가 다른 분을 볼 수 있고, 23:59 예외가 한쪽에만 걸린다.
    const 미룬것나감 = await processDeferred(db, current)

    // 현재 시각 일치 + 오늘 아직 미실행 + 활성 상태인 예약 조회
    const due = db.prepare(`
      SELECT * FROM schedules
      WHERE active = 1
        AND scheduled_time = ?
        AND (last_fired IS NULL OR last_fired != ?)
    `).all(current, today)

    await 이번분예약돌기(db, due, 미룬것나감, current)

    // 앞으로 10분 안의 미준비 예약을 다시 확인한다. **기다리지 않는다** — 지금 나갈 방송이 먼저다.
    prewarmUpcomingSchedules(db).catch(() => { /* 위에서 이미 삼킨다 */ })

    // ── 하루 일과 자동방송 5종 (아침·체조·점심·저녁·저녁 마무리) ──────
    //
    // 예전엔 이 자리에 25줄짜리 블록이 5벌 있었고, 설정키 15개와 기본 시각 5개가
    // 문자열로 다시 적혀 있었다(2026-09-01 TD-02). 같은 내용의 정의표가 이미
    // domain/autoBroadcasts.js에 있는데도 발동부는 그걸 안 봐서, 표와 갈라지면
    // **화면이 보여주는 시각과 실제로 나가는 시각이 달라졌다.** 이제 한 곳만 본다.
    //
    // 발동 조건 세 가지는 예전과 글자 그대로 같다:
    //   켜짐이 문자열 'true'  ·  지금 시각과 정확히 일치  ·  오늘 아직 안 나감
    // (유예창은 일부러 없다 — 사용자 결정, review/findings.csv CC-002)
    //
    // 설정 15건을 한 번에 묻는다(TD-03). 예전엔 매분 15번 따로 물으면서 그때마다
    // 문장을 새로 만들었다. 캐시하는 것은 준비된 문장이지 값이 아니라,
    // 설정을 바꾸면 다음 tick이 곧바로 새 값을 본다.
    const autoKeys = AUTO_BROADCASTS.flatMap(b => [b.enabledKey, b.timeKey, b.firedKey])
    const autoSettings = rawSettings(db, autoKeys)

    for (const spec of AUTO_BROADCASTS) {
      if (autoSettings.get(spec.enabledKey) !== 'true') continue
      // `??`이지 `||`가 아니다 — 시각을 **빈 값으로 저장한** 방송은 예전부터 안 나갔다
      // (''는 현재 시각과 절대 안 맞는다). `||`로 쓰면 그런 방송이 기본 시각에 나가 버린다.
      // 설정이 아예 없을 때만 표의 기본 시각을 쓴다(rawSettings는 없는 키를 null로 준다).
      if ((autoSettings.get(spec.timeKey) ?? spec.defaultTime) !== current) continue
      if (autoSettings.get(spec.firedKey) === today) continue

      // 실행은 예전처럼 시퀀서가 맡는다. await하지 않는 것도 그대로다 —
      // 한 방송이 몇 분씩 도는 동안 다음 tick이 막히면 안 된다.
      withRun(spec.runLabel, () => AUTO_FIRE[spec.id](db))
        .catch(e => console.error(`[스케줄러] ${spec.errorLabel}:`, e.message))
    }

    // SwitchBot 자동 ON/OFF 체크
    await checkSwitchBotSchedule(db, current, today)

    // BGM / 식전 안내 자동재생 체크
    await checkBGMSchedule(db, current, today)
  })

  startWeatherAlertCron()

  console.log('[스케줄러] 예약 방송 스케줄러 시작됨 (매분 실행)')
}

// ── 기상특보 자동 방송 (근무시간 내 30분마다) ─────────────────
// startScheduler() 안에서만 등록한다 — 예전엔 모듈 최상위에서 바로 cron.schedule을 불러서
// 이 파일을 require만 해도(테스트 등) 타이머가 걸려 이벤트 루프가 안 끝났었다.
let _lastAlertKey = ''

function startWeatherAlertCron() {
  cron.schedule('*/30 * * * *', async () => {
  try {
    const db = getDB()
    const get = k => rawSetting(db, k)
    // 관리자가 "시스템 설정"에서 켜기 전까지는 자동방송 안 함 (기본값: 꺼짐)
    if (get('weather_alert_broadcast_enabled') !== 'true') { _lastAlertKey = ''; return }

    // 근무시간의 시작은 아침방송 시각이다. 기본값이 예전엔 여기만 08:30으로 남아 있어
    // (실제 발동은 07:50) 설정이 비어 있는 PC에서 둘이 갈라졌다 — 표를 따른다.
    const morningSpec = AUTO_BROADCASTS.find(b => b.id === 'morning')
    const morningTime = get('morning_time') ?? morningSpec.defaultTime
    const [mH, mM] = morningTime.split(':').map(Number)
    const now = new Date()
    const h = now.getHours(), m = now.getMinutes()

    // 근무시간 체크: 아침방송시간 ~ 17:30
    const afterStart = h > mH || (h === mH && m >= mM)
    const beforeEnd  = h < 17 || (h === 17 && m <= 30)
    if (!afterStart || !beforeEnd) return

    const { fetchWeatherAlert } = require('./weather')
    const alertBundle = await fetchWeatherAlert()
    const alerts = alertBundle?.alerts ?? alertBundle ?? []
    const alertKey = alerts.join('|')

    if (!alertKey) { _lastAlertKey = ''; return }
    if (alertKey === _lastAlertKey) return

    // 이전에 없던 새 특보만 추출
    const prevSet = _lastAlertKey ? new Set(_lastAlertKey.split('|')) : new Set()
    const newAlerts = alerts.filter(a => !prevSet.has(a))
    _lastAlertKey = alertKey

    if (newAlerts.length === 0) return

    const text = `긴급 기상특보 안내입니다. ${newAlerts.join('. ')} 각별히 주의하시기 바랍니다.`
    const tts  = loadTTSConfig(db)
    // 특보도 방송 경로다 — 늦게 나가는 기상특보는 값어치가 없다
    const tmpFile = await generateTTSWithRetry({ text, voice: tts.voice, rate: rateToStr(tts.rate), pitch: pitchToStr(tts.pitch) },
      3, { deadlineMs: BROADCAST_BUDGET_MS })
    const cues = readCues?.(tmpFile, text) ?? null
    const audioId = storeAudio(tmpFile)
    broadcastSSE('scheduled_broadcast', { title: '기상특보', content: text, target: '전체', audioId, cues })
    db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(todayStr(), nowHHMM(), '특보', text, '자동', '전체', 1)
    console.log(`[스케줄러] 기상특보 자동 방송: ${newAlerts.join(', ')}`)
  } catch (e) {
    console.error('[스케줄러] 기상특보 방송 오류:', e.message)
  }
  })
}

module.exports = {
  startScheduler, resolveBGM, fireSchedule, prewarmUpcomingSchedules, queueSchedulePrewarm, waitForSchedulePrewarm, schedulePrewarmStats, ttsParamsForSchedule, shouldRunToday, loadTTSConfig, getLastTickAt,
  // 미룸(td09 H5) 검증용 — 운영 코드는 tick 안에서만 부른다
  _defer: { deferred, deferOrFire, processDeferred, broadcastInProgress, 예약나감표시, 이번분예약돌기, 내보내면안되는이유, deferMaxMin },
}
