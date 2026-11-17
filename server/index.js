const express    = require('express')
const cors       = require('cors')
const { networkCandidates, getLocalIP } = require('./domain/networkAddresses')
const path       = require('path')
const http       = require('http')
const https      = require('https')
const fs         = require('fs')
const { playChunk } = require('./services/audioPlayer')

const { initDB }         = require('./db/schema')
const { startScheduler } = require('./services/scheduler')
const startAutoUpdate    = require('./services/autoUpdate')
const ttsRoutes          = require('./routes/tts')
const favoritesRoutes    = require('./routes/favorites')
const broadcastsRoutes   = require('./routes/broadcasts')
const statusRoutes       = require('./routes/status')
const settingsRoutes     = require('./routes/settings')
const aiRoutes           = require('./routes/ai')
const schedulesRoutes    = require('./routes/schedules')
const scheduleDraftsRoutes = require('./routes/scheduleDrafts')
const flowsRoutes        = require('./routes/flows')
const eventsRoutes       = require('./routes/events')
const audioRoutes        = require('./routes/audio')
const morningRoutes      = require('./routes/morning')
const weatherRoutes      = require('./routes/weather')
const airQualityRoutes   = require('./routes/airQuality')
const weatherAlertRoutes = require('./routes/weatherAlert')
const calendarRoutes     = require('./routes/calendar')
const switchbotRoutes    = require('./routes/switchbot')
const micRoutes          = require('./routes/mic')
const updateRoutes       = require('./routes/update')
const broadcastLockRoutes = require('./routes/broadcastLock')
const devlogRoutes        = require('./routes/devlog')
const improvementProposalsRoutes = require('./routes/improvementProposals')
const coachingBriefRoutes = require('./routes/coachingBrief')

// ── 안전망: 로그 파일 + 전역 예외 핸들러 (다른 무엇보다 먼저) ──────────────
// 순서가 중요하다. fileLog가 console을 먼저 감싸야 그 뒤의 모든 로그(부트 마이그레이션,
// 스케줄러, 크래시 스택)가 날짜별 파일에 남는다. fatal은 그다음에 걸어야 자기 기록이
// 파일까지 도달한다.
//
// 왜 넣었나(2026-08-29 리뷰): 이 서버에는 전역 예외 핸들러가 없어서, 자식 프로세스 실행
// 실패 한 번에 프로세스가 통째로 죽는데 **왜 죽었는지가 어디에도 안 남았다.** 로그도 cmd
// 창 스크롤백에만 있어서 창을 닫거나 재부팅하면 사라졌다. 무인 운영에서 원인 추적이
// 불가능한 상태였다.
require('./services/fileLog').install()
require('./services/fatal').install({
  onFatal: (err) => {
    // 죽는 순간에도 방송 이력에 흔적을 남긴다 — 직원이 보는 화면에서 "그때 서버가 죽었다"가
    // 보여야 한다. alert.raise는 어떤 경우에도 던지지 않으므로 종료를 막지 않는다.
    require('./services/alert').raise('서버', `비정상 종료: ${err?.message ?? err}`)
  },
})
// 종료 정리(CC-023): 어떤 경로로 떠나든(Ctrl+C, 창 닫기, 자동업데이트 exit(100), fatal)
// 재생 중인 오디오 자식을 두고 가지 않는다. fatal 다음에 걸어야 crash 기록이 먼저 남는다.
require('./services/shutdown').install()

const app        = express()
// ── 포트는 **3001 이 기본이고, 그 값은 안 바뀐다** ────────────────────────────
// 현장 PC·원격 PC·직원 폰·시작 bat·감시 루프가 전부 3001 을 안다. 여기를 다른 값으로
// 바꾸면 그 전부가 조용히 어긋나므로, **기본값은 건드리지 않는다.**
//
// 환경변수는 **한 가지 용도**로만 연다(2026-09-16): 이미 3001 을 쓰는 PC 에서
// **격리된 사본을 띄워 재 보기** 위해서다. 사용자 지시 *"샌드박스 구성해서 니가
// 독립적으로 해봐 테스트"* — 그런데 돌고 있는 서버를 죽이면 안 되고(다른 세션의 것이다),
// 포트가 상수라 둘째 사본을 띄울 길이 아예 없었다.
//
// 값을 안 주면 예전과 **글자 그대로 같다.** 설치판·현장은 이 변수를 안 쓴다.
const 포트읽기 = (이름, 기본) => {
  const v = Number(process.env[이름])
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : 기본
}
const HTTP_PORT  = 포트읽기('CARECAST_PORT', 3001)
const HTTPS_PORT = 포트읽기('CARECAST_HTTPS_PORT', 3443)

// 미들웨어 — CORS·JSON은 모든 라우트보다 먼저 등록
// 맨 앞: 이 서버를 부른 이름(Host)이 랜 주소가 아니면 막는다 — DNS 리바인딩으로 읽기 API 가 새지 않게(corsOrigin.js).
app.use(require('./services/corsOrigin').hostGuard)
// 출처는 사설망(랜)만 받는다 — 판정은 services/corsOrigin.js 한 곳(CC-029).
// 예전의 "모든 출처 허용"은 임의의 웹사이트가 방문자 브라우저로 이 API를 부를 수 있다는 뜻이었다.
app.use(cors({ origin: require('./services/corsOrigin').corsOriginCheck, credentials: true }))
// CORS 는 응답만 가린다 — 다른 사이트가 보낸 form·multipart POST 는 실행된다. 쓰기는 여기서 막는다.
app.use(require('./services/corsOrigin').crossSiteWriteGuard)
const WS막은출처 = new Set()   // 마이크 WS 를 막은 출처 — 로그를 출처마다 한 번만 남긴다
app.use(express.json())

// 업로드된 음원 파일 정적 서빙 (/audio/{category}/{filename})
app.use('/audio', express.static(require('./domain/audioPaths').AUDIO_DIR))

// 로컬 네트워크 IP 감지

// 로컬 IP 조회 엔드포인트
app.get('/api/server-info', (req, res) => {
  const addresses = networkCandidates()
  res.json({
    ip:           addresses[0]?.address || '127.0.0.1',
    addresses,
    port:         HTTP_PORT,
    httpsPort:    httpsServer ? HTTPS_PORT : null,
    httpsEnabled: !!httpsServer,
  })
})

// 라우트 등록
app.use('/api/tts',        ttsRoutes)
app.use('/api/favorites',  favoritesRoutes)
app.use('/api/broadcasts', broadcastsRoutes)
app.use('/api/status',     statusRoutes)
app.use('/api/settings',   settingsRoutes)
app.use('/api/ai',         aiRoutes)
app.use('/api/schedules',     schedulesRoutes)
app.use('/api/schedule-drafts', scheduleDraftsRoutes)
app.use('/api/flows',         flowsRoutes)
app.use('/api/events',        eventsRoutes)
app.use('/api/audio',         audioRoutes)
app.use('/api/morning',       morningRoutes)
app.use('/api/weather',       weatherRoutes)
app.use('/api/air-quality',   airQualityRoutes)
app.use('/api/weather-alert', weatherAlertRoutes)
app.use('/api/calendar',      calendarRoutes)
app.use('/api/switchbot',     switchbotRoutes)
app.use('/api/mic',          micRoutes)
app.use('/api/update',        updateRoutes)
// 시작 bat이 curl로 부르는 생존 확인 — 포트 LISTEN만으로는 "떠 있지만 멈춘" 상태를 못 잡는다
app.use('/api/health',        require('./routes/health'))
app.use('/api/broadcast-lock', broadcastLockRoutes)
// 개발 콘솔 라우트 — 바꾸기·실행(GET 외)은 이 PC 에서만 받는다(services/devGuard.js — 2026-11-10 추가 점검).
const { 이PC에서만바꾸기 } = require('./services/devGuard')
app.use('/api/devlog',        이PC에서만바꾸기, devlogRoutes)
app.use('/api/dev/proposals', 이PC에서만바꾸기, improvementProposalsRoutes)
app.use('/api/dev/brief',     이PC에서만바꾸기, coachingBriefRoutes)
// 자연어 예약 학습 통계(읽기 전용) — 「고도화 제안 > 자연어 학습」 탭이 읽는다
app.use('/api/dev/nl-stats',  이PC에서만바꾸기, require('./routes/nlStats'))
// 구성도 그림 — 개발 콘솔의 「구성도」 탭이 읽는다. /api 밑에 두는 이유는 그 파일 머리말 참고.
app.use('/api/dev/arch',      이PC에서만바꾸기, require('./routes/archViews'))

// ── 프로덕션: 빌드된 프론트엔드 서빙 ────────────────────────
const distPath = path.join(__dirname, '../dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }))
  // SPA catch-all — /api, /audio 이외 모든 경로는 index.html 반환
  // index.html은 캐시 금지 → 업데이트 후 브라우저가 항상 새 파일 로드
  // ── **빌드 중에는 흰 화면 대신 「업데이트 중」을 준다** (사용자 지시 2026-09-15) ──────
  //
  // `npm run build` 는 `dist/` 를 **먼저 비우고** 새로 쓴다. 그 몇 분 사이에 화면을 열거나
  // 새로고침하면 `index.html` 이 없어서 **아무것도 없는 흰 화면**이 뜬다. 사람은 그게
  // 고장인지 업데이트인지 알 수 없고, 사용자 지적 요지 그대로 「빈 화면만 덩그러니 뜬다」다.
  //
  // 고치는 방법 둘 중 하나를 골랐다:
  //   ① 빌드를 임시 폴더에 하고 끝나면 통째로 바꿔치기 — 흰 화면이 **아예 안 생긴다**.
  //      다만 빌드 산출 경로를 건드리는 일이라 설치·자동업데이트·검증이 같이 걸린다.
  //   ② **없을 때 대신 줄 것을 준다** — 여기 다섯 줄. 흰 화면이 「업데이트 중」이 된다.
  // 오늘은 ②다. ①은 되돌리기 어려운 변경이라 따로 정할 일이다(TODO 에 적었다).
  //
  // 이 쪽지는 **스스로 다시 확인한다** — 3초마다 `/api/status` 를 두드려 살아나면
  // 그 자리에서 새로고침한다. 사람이 F5 를 안 눌러도 돌아온다.
  const 업데이트중쪽지 = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CareCast — 업데이트 중</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f6f7fb;color:#1f2330;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;text-align:center}
.box{padding:24px}h1{font-size:20px;margin:0 0 8px}p{margin:4px 0;color:#5b6070;font-size:14px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2563eb;margin-right:6px;
animation:b 1.2s ease-in-out infinite}@keyframes b{0%,100%{opacity:.25}50%{opacity:1}}</style></head>
<body><div class="box"><h1><span class="dot"></span>업데이트 중입니다</h1>
<p>새 화면을 만드는 중입니다. 보통 1~3분 걸립니다.</p>
<p><b>끝나면 자동으로 돌아옵니다</b> — 이 창을 닫지 마세요.</p>
<p style="margin-top:14px;font-size:13px">방송은 그대로 나갑니다. 화면만 잠시 없는 것입니다.</p></div>
<script>setInterval(function(){fetch('/api/status',{cache:'no-store'})
.then(function(r){if(r.ok)location.reload()}).catch(function(){})},3000)</script></body></html>`

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/audio')) return next()
    res.set('Cache-Control', 'no-store')
    const index = path.join(distPath, 'index.html')
    // **없을 때만** 쪽지를 준다. 있으면 예전과 글자 그대로 같다.
    if (!fs.existsSync(index)) return res.status(503).type('html').send(업데이트중쪽지)
    res.sendFile(index)
  })
}

// ── DB 초기화 및 스케줄러 시작 ──────────────────────────────
initDB()

// 1회성 데이터 보정(main 전용) — 점심·저녁 동요 흐름의 BGM 단계에 예약 시각(11:15/16:20)을
// 채운다. 흐름 구성은 현장 DB에만 있는 데이터라 코드 배포로는 값이 안 바뀌므로, 자동
// 업데이트로 배포되는 이 코드가 부팅 시 딱 한 번 실행되고 결과를 settings에 남긴다.
// 안전장치(이미 값 있으면 보존, 대상 못 찾으면 무변경)는 config/mealFlowAnchorFix.js 참고.
const { applyMealFlowAnchorFix } = require('./config/mealFlowAnchorFix')
applyMealFlowAnchorFix(require('./db/schema').getDB())

// server/.env는 settings 테이블에 아직 없는 키만 채워넣는 1회성 임포트 용도.
// switchbot/weather/calendar 서비스는 전부 settings 테이블에서만 값을 읽으므로,
// 관리자 화면에 이미 입력된 값이 있으면 이 임포트가 절대 덮어쓰지 않는다.
const { importEnvToSettings } = require('./config/importEnvSettings')
const { imported: envImportedKeys } = importEnvToSettings()
if (envImportedKeys.length) {
  console.log(`[ENV] .env → settings 임포트: ${envImportedKeys.join(', ')}`)
}

// ── 1회성 데이터 보정 ────────────────────────────────────────
// 옛 값·개발 중 잔재를 부팅 때 한 번 고친다. 원래는 이 자리에 try/catch 블록 8개가 쌓여
// 있었는데, 마커가 없어 매 부팅마다 다시 돌았다 — 현장에서 사람이 되돌린 값을 재부팅이
// 조용히 뒤집었다(CC-039). 지금은 보정마다 마커가 있고, 실패한 것만 다음 부팅에 재시도된다.
const { applyDataFixes } = require('./config/dataFixes')
applyDataFixes(require('./db/schema').getDB())


// 볼륨 별칭 정규화 — 같은 볼륨을 가리키는 옛 이름들(vol_broadcast/tts_volume,
// bgm_broadcast_default)을 정규 키 값에 맞춰 다시 써 준다.
//
// 예전엔 이 자리에서 "구값이면 새 값으로 강제 교정"을 했는데, 그게 문제를 키웠다.
// vol_broadcast만 100으로 올리고 vol_tts는 그대로 두는 식이라, 같은 볼륨의 이름 셋이
// 서로 다른 값을 갖게 됐다(화면 80 / 실제 재생 100). 값을 바꾸지 말고 **맞추기만** 한다.
try {
  const { getDB } = require('./db/schema')
  const { CHANNEL_NAMES, readVolume, writeVolumes } = require('./domain/volume')
  const _db = getDB()
  const current = {}
  for (const name of CHANNEL_NAMES) current[name] = readVolume(_db, name)
  writeVolumes(_db, current)
} catch (e) { console.warn('[볼륨 별칭 정규화 오류]', e.message) }


// ── 이 PC의 역할 ──────────────────────────────────────────────
// 현장 PC(main)와 개발·테스트 PC에서 동작이 갈리는 것들이 있다. 무엇으로 판정했는지를
// 부팅 로그에 남긴다 — 조용히 정해지면 "왜 내 사운드 장치가 자꾸 바뀌지?"를 아무도 못 푼다.
try {
  const { getRole, roleLabel, detectBranch } = require('./services/pcRole')
  const r = getRole(require('./db/schema').getDB())
  console.log(`[PC 역할] ${roleLabel(r)} (브랜치 "${detectBranch() || '?'}" 기준, 관리자 화면 '오디오'에서 변경)`)
} catch (e) {
  console.warn('[PC 역할] 판정 실패(기동은 계속):', e.message)
}

// 현장 PC 설정을 기초값으로 심는다 — **비어 있는 것만.** 이미 값이 있으면 손대지 않으므로
// 현장 PC에서 돌아도 아무 일이 안 일어난다. 개발 PC의 DB는 gitignore라 늘 비어 있었고,
// 그래서 예약·환기방송·즐겨찾기가 "없어졌다"는 신고가 반복됐다(2026-08-30).
try {
  const done = require('./config/siteBaseline').applyBaseline(require('./db/schema').getDB())
  if (done) {
    const 심은것 = Object.entries(done).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`)
    console.log(심은것.length
      ? `[기초설정] 현장 기초값을 심었습니다 — ${심은것.join(' · ')}`
      : '[기초설정] 이미 값이 있어 아무것도 바꾸지 않았습니다')
  }
} catch (e) {
  console.warn('[기초설정] 심기 실패(기동은 계속):', e.message)
}

// 지난 프로세스가 흐름 방송 도중에 죽었으면 이력에 "진행 중" 행이 남는다. 고쳐 줄 사람이
// 없으므로 여기서 중단으로 정리한다 — 성공도 실패도 아닌 채 굳는 것은 성공으로 굳는 것과
// 똑같이 나쁘다(CC-003).
try {
  const n = require('./services/flowOutcome').recoverInterrupted(require('./db/schema').getDB())
  if (n) console.log(`[흐름정산] 지난 실행에서 중단된 방송 ${n}건을 실패로 정리했습니다`)
} catch (e) {
  console.warn('[흐름정산] 중단분 정리 실패(기동은 계속):', e.message)
}

// 가동 구간을 남긴다(ISSUE-006). 예약 누락 감시가 "그 시각에 서버가 떠 있었나"를 이걸로 답한다 —
// 없으면 밤새 꺼져 있던 시간의 예약이 전부 누락으로 잡혀 매일 오경보가 난다.
// 생존 표식은 스케줄러 tick이 매분 갱신하고(scheduler.js), 정상 종료만 stopped_at을 남긴다.
try {
  const boot = require('./services/serverBoot')
  const db = require('./db/schema').getDB()
  boot.recordBoot(db)
  // 정상 종료로 떠나는 모든 경로를 여기서 잡는다(shutdown.js가 마지막에 process.exit을 부른다).
  // 강제 종료·정전은 여기 안 온다 — 그때 stopped_at이 NULL로 남는 것이 이 설계의 의도다.
  process.on('exit', () => { try { boot.recordStop(db) } catch { /* 종료 중이라 삼킨다 */ } })
} catch (e) {
  console.warn('[가동기록] 기동 기록 실패(기동은 계속):', e.message)
}

startScheduler()
startAutoUpdate()

// 제미나이 모델 자동 선택 — 첫 회는 부팅 5분 뒤(첫 방송·예열과 안 다투게), 그 뒤 하루 한 번.
// 모델이 없어졌다는 404 는 래퍼가 여기로 신고한다(services/geminiModelAuto.js 머리말).
try {
  const 자동모델 = require('./services/geminiModelAuto')
  require('./services/geminiClient').setModelMissingHandler((m) => 자동모델.onModelMissing(m))
  자동모델.startAutoModelSchedule()
} catch (e) { console.warn('[Gemini 모델] 자동 선택을 켜지 못했습니다(AI 는 저장된 값으로 계속):', e.message) }

// ── 자동방송 문안 선제 렌더 (2026-09-06) ──────────────────────
//
// **반드시 startScheduler() 뒤이고, 반드시 비동기다.** 현장은 07:45 전원 · 07:49 부팅 완료 ·
// 07:50 첫 방송이다 — 여기서 동기로 기다리면 그 60초를 합성에 다 쓰고 스케줄러가 늦게 뜬다.
// 순서가 뒤집히면 고치려던 것보다 나쁜 일이 생긴다. server/test/prerender-boot.test.js 가
// 이 순서를 소스로 고정한다.
//
// 안에서 하는 순서(services/bootWarmup.js):
//   ① 네트워크 도달 확인 — 부팅 직후엔 DHCP·Wi-Fi 가 아직 안 붙어 있을 수 있다
//   ② TTS 예열 — 짧은 더미 1회로 연결 수립 비용을 첫 방송 **이전에** 치른다(결과는 버린다)
//   ③ 선제 렌더 — 다음 발사가 가까운 방송부터
setImmediate(() => {
  require('./services/bootWarmup')
    .warmupThenPrerender(require('./db/schema').getDB())
    .catch((e) => console.warn('[선제렌더] 기동 준비 실패(방송에는 영향 없음):', e.message))
})
// 차임 파형도 소리 없이 미리 만든다 — 첫 차임이 늦게 울리지 않게(2026-09-17). 네트워크와 무관해 따로 둔다.
setTimeout(() => {
  try { require('./services/chimePlayer').차임미리만들기() } catch { /* 누를 때 만든다 */ }
}, 3000).unref?.()

// ── 나를 되살릴 파일이 아직 성한가 ─────────────────────────────
// 서버가 죽었을 때 다시 띄우는 것은 시작 bat 하나뿐인데, **그 파일은 자동 업데이트로
// 갱신되지 않는다**(설치할 때 찍힌 그대로 남는다). 그래서 현장 PC의 감시 루프가 몇 달
// 묵은 판본이거나 깨져 있어도 아무도 모른다 — 실제로 2026-09-04 현장 도스창에서
// 4.83초마다 실패가 찍히고 있는 것을 발견했다. 기동할 때 한 번만 보고 말한다.
require('./services/startBatCheck').checkStartBats()

// ── 방송 누락 감시 ────────────────────────────────────────────
// 예정 시각 +5분에 *_last_fired가 오늘이 아니면 경보를 남긴다. 이게 없으면 "나갔어야 할
// 방송이 안 나간 것"을 아무도 모른다 — 발동 자체가 없으면 broadcasts에 행조차 안 생겨서
// 이력 화면에서 "없었던 것"과 구별되지 않는다.
require('./services/watchdog').startWatchdog(require('./db/schema').getDB())

// ── DB 백업 ───────────────────────────────────────────────────
// 이 시스템의 모든 것이 SQLite 파일 하나에 있다 — 예약·자동방송 시각·볼륨·API 키·이력까지.
// 그런데 백업이 코드에 전혀 없었다(CC-021). 기동 시 1회 + 매일 정해진 시각에 남긴다.
require('./services/backup').startBackupSchedule(require('./db/schema').getDB())

// ── 보관 기간 정리 ────────────────────────────────────────────
// 백업(04:30) **직후**(04:35)에 돈다 — 지우기 전 마지막 모습이 스냅샷에 남은 뒤라야 한다.
// 방송 365일 · 경보 180일 · 점검 90일(설정으로 조정). 지운 건수도 함께 남긴다.
// 왜 필요했나: 백업·로그·TTS 캐시에는 30일 회전이 있는데 DB 안의 행에는 보관 기간이
// 하나도 없었다(docs/db-retention-design.md). 방송 문구에는 개인정보가 섞일 수 있다.
require('./services/retention').startRetentionSchedule(require('./db/schema').getDB())

// ── 체크리스트 문항 1회 시딩 ──────────────────────────────────
// 문항이 코드 상수에서 DB로 옮겨 왔다(0019, 고도화 제안 #23). 기존 주차에는 문항 행이 없어서
// **그대로 두면 지금 화면에 보이던 1·2주차 문항이 통째로 사라진다.**
// 이미 문항이 있는 주차는 건드리지 않는다 — 사람이 화면에서 고친 것을 되돌리면 안 된다.
try {
  const seeded = require('./domain/checklistItems').seedMissingWeeks(require('./db/schema').getDB())
  if (seeded) console.log(`[체크리스트] 문항이 없던 ${seeded}개 주차에 기본 문항을 채웠습니다`)
} catch (e) {
  console.warn('[체크리스트] 문항 시딩 실패(기동은 계속):', e.message)
}

// ── TTS 폴백 캐시 청소 ────────────────────────────────────────
// 아침 방송 문구에 날씨·날짜가 들어가 매일 새 캐시 키가 생긴다. 지우는 주체가 없으면
// 무인 운영에서 계속 쌓이고, 디스크가 차면 SQLite 쓰기가 막혀 방송 기록이 끊긴다.
try {
  const removed = require('./services/tts').pruneCache()
  if (removed) console.log(`[TTS] 오래된 폴백 캐시 ${removed}개 정리`)
} catch (e) {
  console.warn('[TTS] 폴백 캐시 정리 실패(기동은 계속):', e.message)
}

// ── 자동 종료 스케줄러 ────────────────────────────────────────
const { scheduleAutoShutdown } = require('./services/autoShutdown')
scheduleAutoShutdown()

// ── 오디오 출력 장치 감시 (2분 간격으로 설정 장치 복원) ─────────
const { startWatcher: startAudioDeviceWatcher } = require('./services/audioDeviceWatcher')
const { getDB: _getDB } = require('./db/schema')
startAudioDeviceWatcher(_getDB())

// ── HTTP 서버 (3001) — 메인 서버 ────────────────────────────────
const httpServer = http.createServer(app)

// ── HTTPS 서버 (3443) — 모바일 마이크 전용, 인증서 있을 때만 활성화 ──
let httpsServer = null
const SSL_DIR  = path.join(__dirname, 'ssl')
const KEY_PATH = path.join(SSL_DIR, 'key.pem')
const CRT_PATH = path.join(SSL_DIR, 'cert.pem')

// 인증서가 없으면 **openssl 없이 한 번 만든다**(services/httpsCert — 설치본 노트북에서 휴대폰 마이크가 안 되던 것, 2026-09-17).
{
  const 인증서 = require('./services/httpsCert')
  let tls = 인증서.인증서읽기(SSL_DIR)
  if (!tls && !fs.existsSync(KEY_PATH) && !fs.existsSync(CRT_PATH) && 인증서.자동생성해도되나()) {
    try {
      const { networkCandidates } = require('./domain/networkAddresses')
      if (인증서.인증서만들기(networkCandidates().map((r) => r.address), { 폴더: SSL_DIR })) tls = 인증서.인증서읽기(SSL_DIR)
    } catch (e) { console.warn('[HTTPS] 인증서 자동 생성 실패(HTTP 는 그대로):', e.message) }
  }
  if (tls) {
    try {
      httpsServer = https.createServer(tls, app)
      console.log('[HTTPS] 인증서 발견 — 모바일 마이크 서버 활성화 (포트 3443)')
    } catch (e) {
      console.warn('[HTTPS] 인증서 로드 실패:', e.message)
    }
  }
}

// ── WebSocket 서버 (/ws/audio) — HTTP·HTTPS 공유 상태 ──────────
try {
  const { WebSocketServer } = require('ws')
  const wss = new WebSocketServer({ noServer: true })
  let broadcaster    = null
  const wsListeners  = new Set()

  function handleWsUpgrade(server) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname !== '/ws/audio') { socket.destroy(); return }
      // 외부 웹페이지가 연결해 시설 스피커로 소리를 흘리지 못하게 — 출처 판정은 CORS 와 같다.
      if (!require('./services/corsOrigin').isAllowedUpgrade(req)) {
        // 같은 출처는 한 번만 찍는다 — 재연결을 되풀이하면 같은 줄이 로그를 덮는다
        if (!WS막은출처.has(String(req.headers.origin))) {
          WS막은출처.add(String(req.headers.origin))
          console.warn(`[WS] 허용되지 않은 출처의 연결을 막았습니다: ${req.headers.origin}`)
        }
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const role = url.searchParams.get('role')
        if (role === 'broadcaster') {
          // **주인을 모듈에 등록한다**(P-63). 전에는 이 지역 변수에만 있어서
          // HTTP 폴백(`routes/mic.js` 의 `POST /stream`)이 **볼 수조차 없었다** —
          // 그래서 WS 로 방송 중인데 다른 기기가 HTTP 로 끼어들면 소리가 섞였다.
          // 이름표는 화면이 붙여 보내는 탭 id 를 쓰고, 없으면 연결마다 하나 만든다.
          const 이름 = url.searchParams.get('tab') || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          // **앞선 WS 방송자는 넘겨받는 것이 명세다**(마지막 연결이 이긴다 — 폰을 다시 잡는 흔한 길).
          // 그 사람의 소유권을 `terminate()` **전에** 놓는다. `close` 핸들러가 놓아 주긴 하지만
          // 그건 다음 틱이라, 아래 `잡기` 가 방금 죽인 사람 때문에 거절된다.
          if (broadcaster) {
            try { require('./services/micOwner').놓기(broadcaster.__주인이름) } catch { /* 이름이 없거나 이미 남의 것이면 놓을 게 없다 */ }
            broadcaster.terminate()
            broadcaster = null
          }
          // **못 잡으면 받아들이지 않는다**(Codex 3차 검수 2026-09-11). 전에는 반환값을 버리고
          // 무조건 등록해서, HTTP 로 다른 기기가 방송 중이면 이 연결의 청크가 `playChunk` 에서
          // 전부 버려지는데 **화면은 "방송 중"이고 홀만 조용했다.**
          // 닫으면 화면이 HTTP 폴백으로 내려가 `POST /stream` 이 409 를 돌려주고,
          // 그때 사람에게 보인다 — 알림 길을 새로 만들지 않고 이미 있는 길로 모은다.
          if (!require('./services/micOwner').잡기(이름)) {
            console.log('[WS] 방송자 거절 — 다른 기기가 마이크 방송 중이다')
            try { ws.close(4409, 'mic-busy') } catch { /* 이미 끊긴 소켓 */ }
            return
          }
          broadcaster = ws
          ws.__주인이름 = 이름
          wsListeners.forEach(l => l.readyState === 1 && l.send(JSON.stringify({ type: 'start' })))
          console.log('[WS] 방송자 연결됨')
          let msgCount = 0
          ws.on('message', (data) => {
            try {
              if (msgCount === 0) console.log('[WS] 첫 오디오 수신:', data.length, 'bytes')
              msgCount++
              // 신호등 — 청크가 오는 길은 둘이다(WS가 1차, /api/mic/stream이 HTTP 폴백).
              // 한쪽에만 달면 폰(WS)으로 방송할 때 다른 화면이 여전히 모른다.
              // **실제로 재생된 청크만** 켠다 — 이유는 routes/mic.js의 같은 자리 주석 참고.
              if (playChunk(data, ws.__주인이름)) require('./services/micLive').chunkArrived()
            } catch (e) { console.error('[WS] playChunk 오류:', e.message) }
          })
          ws.on('close', () => {
            // **내가 아직 방송자일 때만 정리한다.** 인계로 죽은 옛 연결의 close 는 한 틱 뒤에
            // 오는데, 그때는 새 방송자가 이미 앉아 있다. 그걸 확인 없이 지우면 **방금 시작한
            // 방송이 stop 으로 꺼진다**(Codex 3차 검수 2026-09-11).
            if (broadcaster !== ws) return
            console.log('[WS] 방송자 연결 해제')
            broadcaster = null
            // **놓는다.** 안 놓으면 만료(15초)까지 다음 기기가 막힌다 —
            // 정상 종료인데 기다리게 할 이유가 없다.
            require('./services/micOwner').놓기(ws.__주인이름)
            wsListeners.forEach(l => l.readyState === 1 && l.send(JSON.stringify({ type: 'stop' })))
          })
        } else {
          wsListeners.add(ws)
          if (broadcaster) ws.send(JSON.stringify({ type: 'start' }))
          ws.on('close', () => wsListeners.delete(ws))
        }
      })
    })
  }

  handleWsUpgrade(httpServer)
  if (httpsServer) handleWsUpgrade(httpsServer)
} catch (err) {
  // ws 패키지 없을 때 WebSocket 기능 비활성화 (개발 모드에서는 Vite가 처리).
  // 기능은 이대로 계속 뜬다 — 다만 조용히 사라지면 안 된다(CC-041): 여기서 꺼지면
  // 휴대폰 마이크 방송만 안 되는데, 로그가 없으면 현장에서 원인을 찾을 방법이 없다.
  console.warn('[WS] WebSocket 서버 비활성화 — 휴대폰 마이크 방송 불가:', err.message)
}

// ── 서버 기동 ────────────────────────────────────────────────────
const ip     = getLocalIP()
const isProd = fs.existsSync(distPath)

// 이미 실행 중인 경우: 브라우저만 열고 조용히 종료 (중복 실행 방지)
// ── **`localhost` 로 들어오는 길을 열어 둔다** (실측 2026-09-16) ────────────────
// 사용자 신고: *"엄청 느리고, 서버응답도 느리고"*. 샌드박스에서 재 보니 원인이 나왔다.
//
//     localhost   → 연결에 **207ms**
//     127.0.0.1   → 연결에 **1.0ms**
//     [::1]       → 연결 안 됨
//
// 서버가 `'0.0.0.0'` 에만 묶여 있었다 — 그건 **IPv4 전용**이다. 그런데 Windows 는
// `localhost` 를 **`::1`(IPv6) 부터** 찾는다. 그래서 브라우저·curl 이 먼저 IPv6 로
// 두드렸다가 거절당하고 IPv4 로 넘어가는데, 그 실패·재시도에 **매 요청 200ms** 가 든다.
//
// **하필 방송 화면이 `localhost` 로 열린다**(`carecast-loop.template.bat` 의
// `--app=http://localhost:3001`). 화면 한 장이 API 를 수십 번 부르므로 그 200ms 가
// 그만큼 곱해진다 — 「느리다」의 정체다.
//
// `'::'` 에 묶으면 **IPv4 도 함께 받는다**(Node 의 기본이 dual-stack 이고, IPv4 주소는
// IPv4-mapped 로 들어온다). 랜에서 오는 길은 그대로 열려 있다.
//
// **IPv6 가 꺼진 PC 도 있다.** 그때는 `::` 바인딩이 실패하므로 예전 값으로 되돌아간다 —
// 새 규칙이 옛 규칙보다 나빠지면 안 된다(감시 루프의 curl 폴백과 같은 원칙).
const 듣는주소 = process.env.CARECAST_BIND || '::'
function 묶기실패인가(err) {
  return err && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL')
}
let ipv6되돌림 = false

httpServer.on('error', (err) => {
  if (묶기실패인가(err) && !ipv6되돌림) {
    ipv6되돌림 = true
    console.warn(`[서버] IPv6(${듣는주소}) 로 못 묶었습니다(${err.code}) — IPv4 로만 엽니다.`)
    console.warn('[서버] 이 PC 에서는 localhost 접속이 200ms 가량 느릴 수 있습니다. 화면을 127.0.0.1 로 여세요.')
    httpServer.listen(HTTP_PORT, '0.0.0.0')
    return
  }
  if (err.code === 'EADDRINUSE') {
    console.log(`[서버] 포트 ${HTTP_PORT} 이미 사용 중 — CareCast가 이미 실행 중입니다. 종료합니다.`)
    process.exit(0)
  } else {
    console.error('[서버] 오류:', err)
    process.exit(1)
  }
})

function 서버배너() {
  // 실제로 어느 주소에 묶였는지 함께 적는다 — 폴백이 일어났는지 로그만 보고 알 수 있어야 한다.
  const 묶인곳 = (() => { try { return httpServer.address()?.address ?? '?' } catch { return '?' } })()
  console.log('\n========================================')
  console.log('  CareCast AI 서버 실행 중')
  console.log('========================================')
  if (isProd) {
    console.log(`  앱 (로컬):     http://localhost:${HTTP_PORT}`)
    console.log(`  앱 (네트워크): http://${ip}:${HTTP_PORT}`)
    console.log(`  관리자 화면:   http://${ip}:${HTTP_PORT}/admin`)
  } else {
    console.log(`  프론트 (로컬):    http://localhost:5173`)
    console.log(`  프론트 (네트워크): http://${ip}:5173`)
    console.log(`  관리자 화면:       http://${ip}:5173/admin`)
  }
  console.log('----------------------------------------')
  console.log(`  API 서버 (HTTP):  http://${ip}:${HTTP_PORT}`)
  if (httpsServer) {
    console.log(`  API 서버 (HTTPS): https://${ip}:${HTTPS_PORT}  ← 모바일 마이크`)
    console.log('  ✓ HTTPS 활성화 — 모바일 마이크 사용 가능')
  } else {
    console.log('  HTTPS 비활성화 — 관리자 화면에서 인증서 생성 후 재시작하면 활성화됩니다')
  }
  console.log('========================================\n')

  console.log(`  듣는 주소: ${묶인곳}${묶인곳 === '::' ? ' (IPv4·IPv6 둘 다)' : ' (IPv4 전용)'}`)

  // 브라우저 자동 실행은 CareCast 시작.bat 이 담당 — 서버는 열지 않음
}

// 먼저 `::` 로 연다. 실패하면 위 error 핸들러가 `'0.0.0.0'` 으로 다시 부른다 —
// **배너는 어느 쪽이든 한 번만 나온다**(`listening` 은 실제로 묶인 뒤에 울린다).
httpServer.once('listening', 서버배너)
httpServer.listen(HTTP_PORT, 듣는주소)

if (httpsServer) {
  // HTTP 와 **같은 규칙**이다(위 머리말). 여기만 IPv4 로 두면 `https://localhost` 가
  // 그대로 200ms 를 물고, 모바일 마이크 경로만 조용히 느려진다.
  httpsServer.once('listening', () => {
    console.log(`[HTTPS] 포트 ${HTTPS_PORT} 리스닝 — 모바일 마이크 전용`)
  })
  // 되돌림은 **한 번뿐**이다. 표식이 없으면 IPv4 로도 실패할 때 서로를 다시 불러 무한히 돈다.
  let https되돌림 = false
  httpsServer.on('error', (err) => {
    if (묶기실패인가(err) && !https되돌림) {
      https되돌림 = true
      console.warn(`[HTTPS] IPv6 로 못 묶었습니다(${err.code}) — IPv4 로만 엽니다.`)
      httpsServer.listen(HTTPS_PORT, '0.0.0.0')
      return
    }
    console.error('[HTTPS] 오류:', err.message)
  })
  httpsServer.listen(HTTPS_PORT, 듣는주소)
}
