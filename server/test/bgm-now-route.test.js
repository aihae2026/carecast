// **배경음악을 지금 내보내는 길은 예약 행을 안 만든다** (사용자 결정 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 그전까지 「배경음악」을 지금 내보내려면 화면이 **예약을 하나 만들고**(`createSchedule`)
// 그것을 실행했다(`triggerSchedule`). 그 행은 「지금 시각 · 반복 없음 · 꺼짐」이라
// 다시 울리지는 않지만 **지워지지도 않는다.** 달력은 일시정지한 예약도 일부러 보여 주므로
// (안 보이면 사람이 「지웠나?」 하고 다시 만들어 중복이 난다), 즉시 방송을 쓸 때마다
// **쓰지도 않을 흐린 줄이 달력에 하나씩 쌓인다.**
//
// 규칙: **「즉시는 휘발성, 업로드는 영구」**(`docs/journal/decisions.md`).
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
//  · **행을 안 만든다** — 부른 앞뒤로 `schedules` 개수가 같다
//  · **예약 경로와 같은 신호를 쏜다** — 두 길이 다른 신호면 화면이 다르게 재생한다
//  · **이력은 남긴다** — 행을 안 남기는 것과 무엇이 나갔는지 모르는 것은 다른 일이다
//  · **소리 낼 창이 없으면 성공으로 안 적는다**(2026-09-14 저녁 마무리 사고의 규칙)
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmnow_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 소스 = fs.readFileSync(path.join(ROOT, 'server/routes/audio.js'), 'utf8')
const 코드만 = 소스.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

test('긍정 앵커 — 즉시 배경음악 길이 있다', () => {
  assert.match(코드만, /router\.post\('\/bgm\/now'/, '즉시 배경음악 길이 없다')
})

test('**예약 행을 안 만든다** — 이 길에 예약을 쓰는 코드가 없다', () => {
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 블 = 코드만.slice(i, i + 2600)
  for (const 금지 of ['INSERT INTO schedules', 'createSchedule', 'triggerSchedule']) {
    assert.ok(!블.includes(금지),
      `이 길이 예약을 만든다(${금지}) — 그러면 달력에 흐린 줄이 쌓인다`)
  }
})

test('**예약 경로와 같은 신호·같은 해석**을 쓴다', () => {
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 블 = 코드만.slice(i, i + 2600)
  // 스케줄러의 `bgm` 갈래와 같아야 한다 — 두 길이 다르면 화면이 다르게 재생한다.
  assert.ok(블.includes('resolveBGM'), '고른 음악을 푸는 함수가 다르다')
  // 2026-09-21: 신호는 bgmEmit 하나가 낸다(로컬 폴더 → bgm_start, 유튜브 → bgm_youtube_start).
  assert.ok(블.includes('emitBGM('), '예약 경로와 다른 신호를 쏜다 — bgmEmit 을 안 거친다')

  const 스케줄러 = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')
  assert.ok(스케줄러.includes('emitBGM('),
    '스케줄러가 bgmEmit 을 안 거친다 — 이 시험의 전제가 무너졌다')
})

test('**이력을 남긴다** — 무엇이 나갔는지는 알아야 한다', () => {
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 블 = 코드만.slice(i, i + 2600)
  // **낱말이 아니라 부르는 것을 본다.** 처음엔 `블.includes('시작기록')` 이었는데,
  // 그 낱말이 바로 위 `require` 줄에도 있어서 **호출을 통째로 지워도 통과했다**
  // (변이로 확인했다 — `feedback_carecast_fake_oracle` 의 세 모양 중 하나다).
  assert.match(블, /시작기록\(db,/, '방송 이력을 안 남긴다 — "그날 뭐 틀었지"에 답할 수 없다')
  assert.match(블, /type:\s*'BGM'/, '이력의 갈래가 BGM 이 아니다 — 대시보드 칸이 안 센다')
})

test('**소리 낼 창이 없으면 성공으로 안 적는다** — 2026-09-14 사고의 규칙', () => {
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 블 = 코드만.slice(i, i + 2600)
  assert.ok(블.includes('hasSitePlayer'), '창이 있는지 안 본다')
  assert.ok(블.includes('소리낼수있나'), '창이 소리를 낼 수 있는지 안 본다 — 붙어만 있으면 성공이 된다')
  assert.ok(블.includes('실패로정정'), '무음인데 성공으로 남는다')
  assert.ok(/사유\.화면없음/.test(블), '무음 사유를 안 남긴다')
})

test('**드라이런에서 소리가 안 나간다** — 이 신호가 차단 목록에 있다', () => {
  // 검수·개발 중에 이 길을 불러도 스피커가 울리면 안 된다. 막는 자리는
  // `services/hardwareMode.js` 의 `소리이벤트` 한 곳이다.
  const hm = fs.readFileSync(path.join(ROOT, 'server/services/hardwareMode.js'), 'utf8')
  const i = hm.indexOf('const 소리이벤트')
  assert.ok(i > 0, '소리 이벤트 목록을 못 찾았다')
  assert.ok(hm.slice(i, i + 900).includes("'bgm_start'"),
    '이 신호가 드라이런 차단 목록에 없다 — 검수 중에 진짜 소리가 난다')
})

// ── **얼마나 틀지 화면이 정한다** (사용자 지적 2026-09-15) ──────────────────────
// *"배경음악이나 지금방송에서 bgm 시작 0초 먼저, 재생시간 0초 이거 조절할 수 있게
//   해줘야 하는 거 아니야?"*
//
// 앞 판은 이 길이 `durationSec: 0` 을 **박아 두고** 있었다. 화면에 칸을 만들어도
// 서버가 무시했을 것이다 — 순서의 BGM 토글과 **같은 모양의 실수**다(안 먹는 칸).
test('**재생 시간을 화면에서 받아 실어 보낸다** — 0 을 박아 두지 않는다', () => {
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 다음 = 코드만.slice(i + 10).search(/router\.(get|post|put|delete)\(/)
  const 블 = 다음 >= 0 ? 코드만.slice(i, i + 10 + 다음) : 코드만.slice(i)

  assert.ok(!/durationSec:\s*0\s*,/.test(블),
    '재생 시간이 0 으로 박혀 있다 — 화면에 칸을 만들어도 서버가 무시한다')
  // `[^,]*` 로 쓰면 `Math.max(0, Number(...))` 안의 쉼표에서 끊긴다 — 처음에 그렇게
  // 썼다가 멀쩡한 코드에서 빨간불이 났다.
  assert.match(블, /durationSec:[\s\S]{0,80}duration_sec/,
    '요청에서 재생 시간을 안 읽는다')
})

test('**멈추는 일은 화면이 한다** — 서버가 타이머를 들면 안 된다', () => {
  // 서버가 「N초 뒤 정지」 타이머를 들고 있으면, 그 사이 서버가 죽었을 때 음악이
  // 영영 안 꺼진다. 화면은 `durationSec` 을 받아 제 타이머로 끈다.
  const i = 코드만.indexOf("router.post('/bgm/now'")
  const 다음 = 코드만.slice(i + 10).search(/router\.(get|post|put|delete)\(/)
  const 블 = 다음 >= 0 ? 코드만.slice(i, i + 10 + 다음) : 코드만.slice(i)
  assert.ok(!/setTimeout|setInterval/.test(블),
    '서버가 정지 타이머를 든다 — 서버가 죽으면 음악이 영영 안 꺼진다')

  // 화면 쪽에 그 타이머가 있다는 것이 이 판단의 전제다. 2026-09-21 부터 BGM 은 이 PC 음원이라
  // 재생기(MusicPlayer)가 `bgm_start` 의 `durationSec` 을 받아 제 타이머로 끈다.
  const 재생기 = fs.readFileSync(path.join(ROOT, 'src/components/easy/MusicPlayer.jsx'), 'utf8')
  assert.match(재생기, /durationSec > 0/, '화면이 재생 시간을 안 본다 — 전제가 무너졌다')
})

test('**화면이 그 값을 보낸다** — 칸만 만들고 안 보내면 소용없다', () => {
  const 카드 = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 카드코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(카드코드, /duration_sec:\s*Number\(d\.duration_sec\)/,
    '즉시 배경음악에 재생 시간을 안 싣는다')
  assert.match(카드코드, /duration_sec:\s*Math\.max/,
    '재생 시간을 고치는 칸이 없다')
  assert.match(카드코드, /bgm_delay:\s*Math\.max/,
    '「몇 초 먼저」를 고치는 칸이 없다')
})

test('**BGM 은 시작과 끝을 둘 다 묻는다** (사용자 지적 2026-09-15)', () => {
  // *"야 bgm은 시작 종료 있어야지."* 「자세히」 모달에는 두 칸이 다 있는데 빠른
  // 카드에는 앞 칸만 있었다 — 그러면 **안내가 끝나는 순간 음악이 뚝 끊긴다.**
  // 그 어색함을 없애려고 뒤 칸이 생긴 것이다(UX-17). 같은 물음이 화면마다 다르면 안 된다.
  const 카드 = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 카드코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(카드코드, /bgm_end_delay:\s*Math\.max/,
    '「안내가 끝나고 몇 초 더」를 고치는 칸이 없다 — 안내가 끝나면 음악이 뚝 끊긴다')

  const 모달 = fs.readFileSync(path.join(ROOT, 'src/components/shared/ScheduleModal.jsx'), 'utf8')
  assert.match(모달, /bgm_end_delay/, '「자세히」에서 그 칸이 사라졌다 — 이 시험의 전제가 무너졌다')
})

test('**배경음악 재생 시간은 분으로 묻고 초로 보낸다**', () => {
  // *"배경음악은 최소 단위를 분으로 해야 하지 않겠냐."* 맞다 — 반주로 까는 음악을
  // 초 단위로 정할 일이 없다. 다만 **서버 계약은 초**라, 화면이 × 60 해서 보낸다.
  const 카드 = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 카드코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(카드코드, /duration_sec:\s*Math\.max\(0,\s*Number\(e\.target\.value\)\s*\|\|\s*0\)\s*\*\s*60/,
    '분을 초로 안 바꿔 보낸다 — 30 을 적으면 30초만 나간다')
  assert.match(카드코드, /aria-label="배경음악 재생 시간\(분\)"/,
    '단위가 분이라고 말하지 않는다')
})

test('**화면이 이 길을 실제로 쓴다** — 길만 만들고 안 쓰면 소용없다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  assert.match(api, /startBgmNow/, 'api 에 부르는 자리가 없다')
  assert.ok(api.includes("'/api/audio/bgm/now'"), 'api 가 다른 주소를 부른다')

  const 카드 = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 카드코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(카드코드, /startBgmNow\(/, '즉시 실행이 아직 이 길을 안 쓴다')
})

// ── **두 번째 조각 — 음원·유튜브 TV** (2026-09-15) ──────────────────────────────
// 같은 규칙(「즉시는 휘발성, 업로드는 영구」)의 다음 유형이다. 여기서 휘발성인 것은
// **트는 일**이고, 업로드에 등록된 **파일 자체는 그대로 남는다.**
const 음원길 = fs.readFileSync(path.join(ROOT, 'server/routes/audio.js'), 'utf8')
const 음원코드 = 음원길.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const 음원블록 = () => {
  const i = 음원코드.indexOf("router.post('/play-now'")
  assert.ok(i > 0, '즉시 음원 길이 없다')
  return 음원코드.slice(i, i + 3400)
}

test('긍정 앵커 — 즉시 음원·유튜브TV 길이 있다', () => {
  assert.ok(음원블록().length > 500, '길은 있는데 몸통이 비었다')
})

test('**음원 길도 예약 행을 안 만든다**', () => {
  const 블 = 음원블록()
  for (const 금지 of ['INSERT INTO schedules', 'createSchedule', 'triggerSchedule']) {
    assert.ok(!블.includes(금지), `이 길이 예약을 만든다(${금지})`)
  }
})

test('**예약 경로와 같은 신호를 쏜다** — 음원', () => {
  const 블 = 음원블록()
  assert.ok(블.includes('prayer_play'), '음원이 예약 경로와 다른 신호를 쏜다')
  // 외부 TV 송출 갈래는 2026-09-21 걷어냈다 — 되살아나면 받을 화면이 없다.
  assert.ok(!블.includes("'tv-start'"), '걷어낸 TV 송출 신호가 되살아났다')
  // 자막은 이 값으로 찾는다 — 빠뜨리면 그 음원에만 자막이 안 나온다(예약 경로의 교훈).
  assert.ok(블.includes('audioFileId'), '자막을 찾을 값을 안 싣는다')
  const 스케줄러 = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')
  for (const 신호 of ['prayer_play']) {
    assert.ok(스케줄러.includes(신호), `스케줄러가 「${신호}」 를 안 쓴다 — 전제가 무너졌다`)
  }
})

test('**음원 길도 이력·무음 규칙을 지킨다**', () => {
  const 블 = 음원블록()
  assert.match(블, /시작기록\(db,/, '이력을 안 남긴다')
  assert.ok(블.includes('hasSitePlayer') && 블.includes('소리낼수있나'),
    '소리 낼 창이 있는지 안 본다')
  assert.ok(/사유\.화면없음/.test(블), '무음인데 성공으로 남는다')
})

test('**영상은 아직 이 길이 아니다** — 페이드 판단을 복사하지 않는다', () => {
  // 영상 예약은 쏘기 전에 BGM 을 끄고 1.5초 페이드를 기다린 뒤 겹침을 다시 본다
  // (`scheduler.js` 의 video 갈래, td09 H11). 그 판단이 두 벌이 되면 한쪽만 고치는 날
  // 영상이 남의 소리 위로 나간다. **옮기기 전에 그 자리를 한 곳으로 빼는 것이 먼저다.**
  const 블 = 음원블록()
  assert.ok(!블.includes('video_play'),
    '영상을 이 길로 옮겼다 — 페이드·겹침 판단이 빠졌는지 먼저 확인할 것')
  const 스케줄러 = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')
  assert.ok(스케줄러.includes('bgm_stop'),
    '예약 경로의 페이드 판단이 사라졌다 — 이 시험의 전제가 무너졌다')
})

test('**화면이 이 길도 실제로 쓴다**', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  assert.match(api, /playFileNow/, 'api 에 부르는 자리가 없다')
  assert.ok(api.includes("'/api/audio/play-now'"), 'api 가 다른 주소를 부른다')
  const 카드 = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
  const 카드코드 = 카드.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(카드코드, /playFileNow\(/, '즉시 실행이 아직 이 길을 안 쓴다')
})
