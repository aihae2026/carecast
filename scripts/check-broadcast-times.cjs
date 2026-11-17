// 방송 시각 사본들이 현장 값과 맞는지 대조한다.
//
// 왜 필요했나(2026-09-06): 현장에서 국민체조를 08:40 → 09:00 으로, 점심을 11:15 → 11:10 으로,
// 저녁을 16:15 → 16:14 로 바꿨는데 **저장소의 사본들은 그대로였다.** 그래서 배포 게이트가
// 없는 시각(08:40)을 지키고 **있는 시각(09:00) 직전에는 배포를 안 막았다.**
// 방송 도중 재시작은 그대로 무음이다.
//
// 이 검사가 보는 것은 둘이다:
//   1) 사본이 낡았는가 — site-baseline.json 을 언제 뽑았나. 오래되면 다시 뽑으라고 알린다.
//      **이게 없으면 사본끼리만 맞는지 보게 되고, 그 사본이 낡았으면 검사는 통과하면서
//      현장과는 계속 어긋난다.** 이번 사고가 정확히 그 모양이었다.
//   2) 사본끼리 맞는가 — 배포 게이트의 시각 배열이 baseline 과 같은가.
//
// **autoBroadcasts.js 의 defaultTime 은 대조 대상이 아니다.** 그것은 "설정이 비었을 때만 쓰는
// 초기값"이고 현장 값과 **일부러 다르게** 둔다(근거: CLAUDE.md·PROJECT_PROFILE).
// 여기서는 참고로만 보여 준다.
'use strict'

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const BASELINE = path.join(ROOT, 'server', 'config', 'site-baseline.json')
const GATE = path.join(ROOT, '.claude', 'skills', 'deploy-gate', 'scripts', 'predeploy-gate.sh')

// 며칠이 지나면 "다시 뽑으라"고 알릴지. 현장 값이 자주 바뀌는 시기에는 줄여 잡는다.
const MAX_AGE_DAYS = Number(process.env.CARECAST_BASELINE_MAX_AGE_DAYS) || 14

const TIME_KEYS = [
  ['morning_time',            '아침 종합 방송'],
  ['exercise_broadcast_time', '국민체조'],
  ['lunch_broadcast_time',    '점심 식사 전'],
  ['dinner_broadcast_time',   '저녁 식사 전'],
  ['evening_prayer_time',     '저녁 마무리'],
]

let 경고 = 0
let 실패 = 0
const warn = (m) => { console.warn(`[시각대조] ⚠ ${m}`); 경고 += 1 }
const bad  = (m) => { console.error(`[시각대조] FAIL ${m}`); 실패 += 1 }

// ── 1) baseline 이 있는가 · 낡지 않았는가 ────────────────────────────
if (!fs.existsSync(BASELINE)) {
  // 개발 PC 에는 없을 수 있다. 없다고 빌드를 막지는 않는다 — 다만 조용히 넘기지도 않는다.
  warn('site-baseline.json 이 없습니다 — 현장 시각과 대조할 수 없습니다.')
  warn('  현장 DB 를 복사해 와서: node scripts/make-site-baseline.cjs <database.db 경로>')
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const settings = baseline.settings || {}
// 둘 중 **오래된 쪽**을 본다. 5일 된 백업으로 오늘 뽑으면 extractedAt 은 오늘이지만
// 그 안의 값은 5일 전 것이다 — 낡음의 기준은 원본이다.
const meta = baseline._meta || {}
// 파일명의 날짜가 가장 믿을 만하다 — 복사해도 이름은 안 바뀐다(mtime 은 바뀐다).
const 후보 = [meta.extractedAt, meta.sourceDbModifiedAt, meta.sourceDbNamedAt].filter(Boolean)
const 뽑은시각 = 후보.sort()[0]

// 파일명에서 날짜를 못 읽었으면 낡음 판정이 **실제보다 최신으로 기울어진다.**
// mtime 은 복사하는 순간 오늘이 되기 때문이다. 그 사실을 숨기지 않는다.
if (Object.keys(meta).length && !meta.sourceDbNamedAt) {
  warn('원본 파일명에서 날짜를 읽지 못했습니다 — **실제보다 최신으로 보일 수 있습니다.**')
  warn(`  (원본: ${meta.sourceDb || '알 수 없음'}) 이 저장소의 백업 이름은 carecast_YYYYMMDD_HHMM.db 형식입니다.`)
  warn('  이름을 바꿔 복사했다면, 아래 "N일 전"은 복사한 날 기준일 수 있습니다.')
}

if (!뽑은시각) {
  warn('site-baseline.json 에 뽑은 시각(_meta.extractedAt)이 없습니다 — 낡았는지 알 수 없습니다.')
  warn('  다시 뽑으면 기록됩니다: node scripts/make-site-baseline.cjs <database.db 경로>')
} else {
  const 지난일 = Math.floor((Date.now() - new Date(뽑은시각).getTime()) / 86400000)
  if (지난일 >= MAX_AGE_DAYS) {
    warn(`현장 사본이 ${지난일}일 됐습니다(기준 ${MAX_AGE_DAYS}일). **현장 값을 다시 뽑아 갱신하세요.**`)
    warn('  현장 PC 의 server/db/database.db 와 -wal 을 복사해 와서:')
    warn('  node scripts/make-site-baseline.cjs <복사해 온 database.db 경로>')
    warn('  (사본이 낡으면 아래 대조가 통과해도 현장과는 어긋나 있을 수 있습니다)')
  } else {
    console.log(`[시각대조] 현장 사본 ${지난일}일 전 (${뽑은시각.slice(0, 10)}) — 기준 ${MAX_AGE_DAYS}일 이내`)
  }
}

// ── 2) 배포 게이트의 배열이 baseline 과 같은가 ────────────────────────
const 현장시각 = []
for (const [key, label] of TIME_KEYS) {
  const v = settings[key]
  if (!v) { warn(`baseline 에 ${label}(${key}) 값이 없습니다 — 대조에서 뺍니다.`); continue }
  현장시각.push({ key, label, time: String(v) })
}

// 게이트는 **값을 갖고 있으면 안 된다.** baseline 을 읽어야 한다.
//
// 2026-09-06 이전에는 게이트가 시각을 배열로 적어 뒀고, 그게 두 번째 사본이 되어
// 현장에서 시각을 바꾼 날부터 조용히 어긋났다. 그래서 지금 검사하는 것은
// "배열이 현장과 같은가"가 아니라 **"애초에 배열을 안 갖고 있는가"** 다.
if (fs.existsSync(GATE)) {
  const gateSrc = fs.readFileSync(GATE, 'utf8')
  const 읽는가 = /site-baseline\.json/.test(gateSrc)

  if (!읽는가) {
    bad('배포 게이트가 site-baseline.json 을 읽지 않습니다 — 시각을 직접 갖고 있으면 또 낡습니다.')
  } else {
    console.log('[시각대조] 배포 게이트가 site-baseline.json 을 읽습니다 (하드코딩 없음)')
  }

  // 하드코딩된 시각이 남아 있는지. **폴백은 예외다** — 파일이 없을 때 쓰는 코드 기본값이고,
  // autoBroadcasts.js 의 defaultTime 과 같아야 하며 현장 값과는 일부러 다르다.
  const 기본값 = (() => {
    try {
      const { AUTO_BROADCASTS } = require(path.join(ROOT, 'server', 'domain', 'autoBroadcasts'))
      return AUTO_BROADCASTS.map((s) => s.defaultTime).sort()
    } catch { return [] }
  })()
  const siteTimes = 현장시각.map((r) => r.time).sort()

  for (const m of gateSrc.matchAll(/BROADCAST_TIMES=\(([^)]*)\)/g)) {
    const arr = (m[1].match(/\d{2}:\d{2}/g) || [])
    if (!arr.length) continue                                   // 빈 배열 — 실행 시 채운다
    const sorted = [...arr].sort()
    if (기본값.length && sorted.join(',') === 기본값.join(',')) continue   // 폴백 — 정상
    if (sorted.join(',') !== siteTimes.join(',')) {
      bad(`배포 게이트에 현장과 다른 시각이 적혀 있습니다: ${arr.join(' ')}`)
      console.error(`        현장: ${siteTimes.join(' ')}`)
    }
  }
} else {
  warn('배포 게이트 파일을 찾지 못했습니다 — 대조를 건너뜁니다.')
}

// ── 참고: 코드 기본값은 일부러 다르다 ────────────────────────────────
try {
  const { AUTO_BROADCASTS } = require(path.join(ROOT, 'server', 'domain', 'autoBroadcasts'))
  const 다른것 = []
  for (const spec of AUTO_BROADCASTS) {
    const 현장 = settings[spec.timeKey]
    if (현장 && String(현장) !== spec.defaultTime) 다른것.push(`${spec.label} ${spec.defaultTime}→${현장}`)
  }
  if (다른것.length) {
    console.log(`[시각대조] 참고 — 코드 기본값과 현장이 다른 방송 ${다른것.length}건: ${다른것.join(', ')}`)
    console.log('           이것은 정상입니다. defaultTime 은 설정이 비었을 때만 쓰는 초기값입니다.')
  }
} catch (e) {
  warn(`코드 기본값을 읽지 못했습니다: ${e.message}`)
}

if (실패) {
  console.error(`\n[시각대조] FAIL — 사본이 현장 값과 다릅니다 (경고 ${경고}건)`)
  process.exit(1)
}
console.log(`[시각대조] PASS${경고 ? ` (경고 ${경고}건)` : ''}`)
