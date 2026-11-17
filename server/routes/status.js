const express     = require('express')
const os          = require('os')
const { getLocalIP } = require('../domain/networkAddresses')
const { getDB }   = require('../db/schema')
const nowPlaying  = require('../services/nowPlaying')
const netHealth   = require('../services/netHealth')
// 설정은 `domain/settingsRead` 로만 읽는다 — `settings-read-single-source.test.js` 가 고정한다.
const { rawSetting } = require('../domain/settingsRead')

const router = express.Router()


// ── CPU 사용률 ────────────────────────────────────────────────
// os.cpus()의 times는 "부팅 이후 누적"이라 한 번만 읽으면 부팅 이후 평균밖에 안 나온다.
// 이전 호출 시점의 스냅샷을 들고 있다가 그 사이의 델타로 계산해야 "지금" 사용률이 나온다.
// 첫 호출은 비교 대상이 없어 null(=화면에 "측정 중")을 반환한다.
let prevCpu = null

function snapshotCpu() {
  return os.cpus().reduce((acc, c) => {
    const t = c.times
    acc.idle  += t.idle
    acc.total += t.user + t.nice + t.sys + t.idle + t.irq
    return acc
  }, { idle: 0, total: 0 })
}

function getCpuUsagePct() {
  const cur = snapshotCpu()
  const prev = prevCpu
  prevCpu = cur
  if (!prev) return null

  const idleDiff  = cur.idle - prev.idle
  const totalDiff = cur.total - prev.total
  if (totalDiff <= 0) return null

  const pct = Math.round((1 - idleDiff / totalDiff) * 100)
  return Math.max(0, Math.min(100, pct))
}

// ── 오디오 입출력 장치 요약 ────────────────────────────────────
// audioDevices.js의 캐시를 그대로 쓰므로(서버 실행 중 장치는 잘 안 바뀜) 보통은 PowerShell을
// 새로 띄우지 않는다. 조회 실패 시 null → 화면에 "확인 불가"로 표시하고, 절대 가짜 값을
// 만들어내지 않는다.
//
// **이 응답을 기다리지 않는다.** /api/status는 창마다 4초 간격으로 폴링되는 연결 감시용
// 경로다(App.jsx useConnectionWatch, 3초 타임아웃 2연속 실패 → "서버 재연결 중" 오버레이).
// 장치 조회는 PowerShell을 띄우는 일이라 캐시가 식은 순간엔 수백 ms~수 초가 걸린다 —
// 그걸 응답 안에서 await 하면 서버는 멀쩡한데 화면만 "끊겼다"고 판단한다. 그래서 마지막으로
// 알아낸 값을 즉시 돌려주고, 갱신은 뒤에서 돌린다. 첫 응답은 null(=확인 중)이고 곧 채워진다.
let audioSnapshot = { output: null, input: null }
let audioRefreshing = false

function refreshAudioSummary() {
  if (audioRefreshing) return
  // 하드웨어 접근 없음 모드(테스트·맥 개발)에서는 아예 띄우지 않는다. 예전엔 응답 안에서
  // await 했기 때문에 테스트가 끝나기 전에 PowerShell도 끝났지만, 이제 뒤에서 도는 일이라
  // 그대로 두면 남은 프로세스가 이벤트 루프를 붙잡아 node --test가 안 끝난다(CC-050과 같은 함정).
  if (require('../services/hardwareMode').hardwareDisabled()) return
  audioRefreshing = true
  const { listWaveOutDevices, listWaveInDevices } = require('../services/audioDevices')
  const safe = async (fn) => {
    try { return await fn() } catch { return null }
  }
  Promise.all([safe(listWaveOutDevices), safe(listWaveInDevices)])
    .then(([out, mic]) => {
      audioSnapshot = {
        // **이름 목록도 보낸다**(UX-35). 첫 장치만으로는 "설정해 둔 장치가 아직 있나" 를
        // **없다고 단정할 수 없다** — 둘째 이후에 있을 수 있다. 그 모르는 상태를 "연결 끊김"
        // 으로 칠하면 꾸민 실패 이유가 된다. 32개까지만 — 목록이 길어도 화면은 이름 하나만 쓴다.
        output: out
          ? { count: out.length, first: out[0]?.name ?? null, names: out.slice(0, 32).map(d => d.name) }
          : null,
        input:  mic ? { count: mic.length, first: mic[0]?.name ?? null } : null,
      }
    })
    .catch(() => { /* safe()가 이미 흡수한다 — 여기 오면 스냅샷을 그대로 둔다 */ })
    .finally(() => { audioRefreshing = false })
}

// GET /api/status — 서버 상태 반환
const { 오류수, 종류별집계 } = require('../domain/broadcastRecord')

router.get('/', async (req, res) => {
  try {
    const db = getDB()

    const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM broadcasts').get().cnt
    const now        = new Date()
    const monthPfx   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    // 오류도 **이번 달만** 센다 (P-17). 예전엔 날짜 조건이 없어 개설 이래 누적이었는데,
    // 화면에서는 이번달·TTS·즉시·예약/자동 타일과 **한 줄에 나란히** 서고 라벨은 그냥 "오류"다
    // (Dashboard.jsx:386). 옆이 전부 이번 달이니 사람은 그것도 이번 달로 읽는다 —
    // 실제로는 몇 달 지나면 이번 달에 아무 문제가 없어도 숫자가 계속 커져 있었다.
    // 숫자가 틀린 게 아니라 **옆 숫자와 다른 것을 세면서 같은 것처럼 보이던 것**이다.
    // 누적이 필요하면 방송이력 화면에서 기간을 열어 본다.
    // ── P-31: **밀림은 오류가 아니다** ────────────────────────────────
    // 밀림(다른 방송이 앞 소리를 밀어냄)은 이력에 `success = 0` 으로 남는다 —
    // ISSUE-010 의 사용자 결정(2026-09-07)이 "이력에는 남기고 배너는 안 띄운다"였다.
    // 그런데 이 카드가 그것까지 세서, **수동재생으로 정시 방송을 앞당길 때마다 오류가 1씩
    // 올랐다.** 배너는 조용한데 숫자만 오르니 "화면은 조용하다"가 절반만 참이었다.
    // 문구는 `domain/broadcastRecord.js` 단일 출처를 쓴다 — 네 자리가 같은 것을 본다.
    // **질의는 `domain/broadcastRecord.오류수` 한 곳에 있다**(P-97). 예전엔 이 질의가
    // 여기와 `routes/broadcasts.js` 에 복사돼 있었고, 사유를 더하면서 실제로 한쪽만 고쳤다.
    const errorCount = 오류수(db, monthPfx)
    const monthCount = db.prepare("SELECT COUNT(*) as cnt FROM broadcasts WHERE date LIKE ? AND success = 1").get(`${monthPfx}-%`).cnt
    const recent     = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 10').all()

    // 이번 달 종류별 집계 — 대시보드 통계 카드용(즉시방송·TTS·BGM 단독·자동방송).
    // 예전엔 이 숫자를 src/data/dummy.js의 가짜 값으로 채워서, 실제 값(이번달/오류) 옆에
    // 지어낸 숫자가 진짜처럼 표시되던 문제가 있었다. 실제 집계로 대체.
    //
    // **칸 정의와 질의는 `domain/broadcastRecord.종류별집계` 한 곳에 있다**(UX-34).
    // 예전엔 여기와 `routes/broadcasts.js` 가 각자 목록을 들고 있었고 **이미 서로 달랐다** —
    // 여기서는 '즉시' 하나만, 저기서는 '즉시','차임벨','즐겨찾기','AI' 였다. FP-0005 그대로다.
    // `scheduled` 는 옛 화면(쉬운화면 월간통계)이 아직 읽으므로 이름을 남겨 둔다.
    const byType = 종류별집계(db, monthPfx)
    const byTypeAll = 종류별집계(db, null)

    const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10
    const memUsed  = Math.round((1 - os.freemem() / os.totalmem()) * 100)

    // 시스템 상태 카드용 실측값 — 예전엔 CPU/오디오/마이크가 dummy.js의 고정 문자열이라
    // 현장에서 오디오 장치가 빠져도 "정상 출력"으로 보이는 사각지대가 있었다.
    const cpus = os.cpus()
    refreshAudioSummary()          // 뒤에서 갱신 — 응답은 기다리지 않는다
    // **설정된 출력장치 이름도 함께 보낸다**(UX-35, 2026-09-11).
    // 장치가 몇 개 보이느냐만으로는 "정상" 이라고 말할 수 없다 — `audio_device` 를 안
    // 정했으면 방송이 **Windows 기본 장치**로 나가고, 그러면 엉뚱한 데서 소리가 난다
    // (CLAUDE.md "새 PC 를 세팅할 때 손으로 넣어야 하는 값"). 화면이 그것을 **미설정**으로
    // 가르려면 이 값이 있어야 한다. 화면에서 다시 조회하게 두면 두 벌이 된다.
    const audio = { ...audioSnapshot, configuredOutput: rawSetting(db, 'audio_device') || '' }

    res.json({
      ok: true,
      ip: getLocalIP(),
      // 랜 주소만으로는 인터넷 여부를 알 수 없다 — 실제 외부 통신 성패를 함께 보낸다(CC-025)
      net: netHealth.summary(),
      uptime: Math.floor(os.uptime()),
      // ── **프로세스가 언제 떴나** (현장 지적 2026-09-15) ────────────────────────────
      // 위 `uptime` 은 **PC 가 켜진 뒤**의 시간이라 서버가 재시작해도 안 줄어든다.
      // 그래서 화면은 「업데이트가 끝나 서버가 새로 떴는지」를 알 방법이 없었고,
      // 업데이트 신호를 받자마자 **서버가 아직 살아 있을 때** 새로고침했다.
      // 그 1.5초 뒤 서버가 내려가면서 **받아오던 화면 파일이 끊겨 흰 화면**이 됐다.
      // 이 값이 **줄어들면** 프로세스가 새로 뜬 것이다 — 그때 새로고침하면 안전하다.
      procUptime: Math.floor(process.uptime()),
      platform: os.platform(),
      memory: { totalGB: totalMem, usedPct: memUsed },
      cpu: { usagePct: getCpuUsagePct(), cores: cpus.length, model: cpus[0]?.model?.trim() ?? null },
      audio,
      // `scheduled` 는 **옛 이름**이다 — 쉬운화면 월간통계가 아직 읽는다. 뜻은 `auto` 와 같다.
      // 화면의 "전체" 보기가 이번 달과 **같은 규칙**으로 세도록 전체 기간 값도 함께 보낸다.
      // 예전엔 전체 보기에 종류별 숫자가 없어서 이번 달 숫자를 그대로 두고 라벨만 바꿨다.
      broadcasts: {
        total: totalCount, month: monthCount, error: errorCount,
        ...byType, scheduled: byType.auto,
        allTime: { ...byTypeAll, scheduled: byTypeAll.auto, error: 오류수(db, null) },
      },
      recentBroadcasts: recent,
    })
  } catch (err) {
    console.error('[status/GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/status/now-playing — 현재 재생 상태 조회 (다른 PC에서 폴링)
router.get('/now-playing', (req, res) => res.json(nowPlaying.get()))

// POST /api/status/now-playing — 메인 PC가 재생 상태 보고
router.post('/now-playing', (req, res) => {
  nowPlaying.update(req.body)
  res.json({ ok: true })
})

// ── 경보 「확인」은 **서버가 기억한다** (현장 지적 2026-09-15) ────────────────────
//
// 확인 기록이 `localStorage` 에만 있었다. 그 저장소는 **주소마다·브라우저 프로필마다
// 따로**라, 같은 사람이 같은 PC 에서 봐도 —
//   · `localhost` 로 열었다가 랜 주소로 열면 → 확인이 안 넘어간다
//   · 방송 화면 전용 프로필이 새로 생기면 → 빈 채로 시작한다
//   · 다른 기기(직원 폰)에서 보면 → 처음부터 다시 뜬다
// 그래서 **확인을 눌렀는데 들어갈 때마다 또 떴다.** 잔소리가 되면 사람이 진짜 경보까지
// 안 읽는다 — 이 배너를 만든 이유 자체가 무너진다.
//
// 표를 새로 만들지 않고 `settings` 에 **그날 치만** 둔다. 경보 id 가 `날짜|종류|문구` 라
// 날짜가 바뀌면 새 id 가 되므로, 어제 것을 들고 있을 이유가 없다.
// **못 읽거나 못 쓰면 조용히 넘어간다** — 확인 기록이 없으면 배너가 뜰 뿐이고,
// 그쪽이 안전한 실패다(경보를 숨기는 쪽으로 실패하지 않는다).
const 확인키 = (날짜) => `alert_acked_${날짜}`
const 오늘문자열 = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function 확인목록(날짜) {
  try {
    const raw = rawSetting(getDB(), 확인키(날짜))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(v => typeof v === 'string') : []
  } catch { return [] }
}

// ── 첫 화면이 거는 말 (사용자 지시 2026-09-15) ────────────────────────────────────
//
// *"기능 메뉴얼 논리 구조와 문구 규칙이 연결 파싱 되어서 AI 개입 없어도 자동으로
//   기능 안내 등등이 나갈 수 있도록."*
//
// **매뉴얼을 서버에서 읽는다.** 화면은 파일을 못 읽고, 읽게 하면 매뉴얼 전문을 브라우저로
// 내려보내야 한다(수십 KB 를 첫 화면마다). 서버가 **한 번 읽어 두고** 한 줄만 준다.
//
// **다시 읽는 조건은 파일이 바뀐 것**이다 — 매뉴얼을 고치고 서버를 재시작하지 않아도
// 안내가 따라온다. 개발 중에 그게 안 되면 고쳐도 안 바뀌는 것처럼 보인다.
const 매뉴얼경로 = require('path').join(__dirname, '..', '..', 'docs', 'MANUAL-USER.md')
let 기능캐시 = null
let 매뉴얼시각 = 0
function 기능목록() {
  try {
    const fs = require('fs')
    const t = fs.statSync(매뉴얼경로).mtimeMs
    if (!기능캐시 || t !== 매뉴얼시각) {
      기능캐시 = require('../domain/guideTips').기능읽기(fs.readFileSync(매뉴얼경로, 'utf8'))
      매뉴얼시각 = t
    }
  } catch { 기능캐시 = 기능캐시 || [] }   // 매뉴얼이 없어도 화면은 돌아야 한다
  return 기능캐시
}

// GET /api/status/tip?rot=N — 지금 첫 화면에 띄울 한 줄.
//
// **오늘 목록은 화면이 이미 들고 있다**(`/api/schedules/today`). 그것을 그대로 보내면
// 같은 것을 두 번 세지 않는다 — 여기서 다시 세면 화면의 「안 나감」과 이 문장이 갈린다.
router.post('/tip', (req, res) => {
  try {
    const { 차례짜기 } = require('../domain/guideTips')
    const 오늘 = Array.isArray(req.body?.today) ? req.body.today : []
    // **차례표를 통째로 준다**(2026-09-15 정정).
    //  · `붙잡는말` — 있으면 그것만 띄우고 **안 돈다**(안 나간 방송).
    //  · `차례` — 돌 문구들. 각 칸에 `머무는초` 가 붙어 있다.
    //
    // 처음엔 회전 번호를 받아 한 줄씩 줬는데, 그러면 화면이 **회전할 때마다 서버를
    // 다시 불러야** 했다(12초마다 두 번, 분당 10회). 상태는 그렇게 자주 안 바뀐다 —
    // 60초에 한 번 차례표를 받아 두면 그 뒤로는 화면이 제자리에서 돈다.
    res.json(차례짜기({ 기능들: 기능목록(), 오늘 }))
  } catch (e) {
    // 안내 한 줄 때문에 화면이 멈추면 안 된다 — 못 만들면 **아무 말도 안 한다.**
    console.warn('[안내] 차례표 만들기 실패:', e.message)
    res.json({ 붙잡는말: null, 차례: [] })
  }
})

// GET /api/status/acked-alerts — 오늘 이미 확인한 경보 id 목록
router.get('/acked-alerts', (req, res) => {
  const date = 오늘문자열()
  res.json({ date, ids: 확인목록(date) })
})

// POST /api/status/acked-alerts { id } — 「확인」을 눌렀다
router.post('/acked-alerts', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 300) : ''
  if (!id) return res.status(400).json({ error: 'id 가 필요합니다' })
  const date = 오늘문자열()
  try {
    const 이미 = 확인목록(date)
    if (!이미.includes(id)) {
      // 상한을 둔다 — 하루에 경보가 쏟아져도 설정 한 칸이 무한히 크지 않게.
      const 다음 = [...이미, id].slice(-300)
      getDB().prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(확인키(date), JSON.stringify(다음))
    }
    res.json({ ok: true })
  } catch (e) {
    // 못 적어도 화면은 그 자리에서 사라진다(그 창의 localStorage 는 그대로 쓴다).
    console.warn('[경보확인] 저장 실패:', e.message)
    res.json({ ok: false })
  }
})

module.exports = router
