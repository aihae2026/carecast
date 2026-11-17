#!/usr/bin/env node
// 자동방송 다섯의 **지금 동작**을 값으로 떠서 파일에 적는다 (기준선 생성기).
//
// 왜: 사용자 조건(2026-09-13) — *"설정을 변경하지 않은 기존 데이터에서 방송 시각, 단계 순서,
// 활성화 여부, 파일 선택과 폴백, 볼륨, TV·자막 보정이 변경 전후 동일해야 한다."*
// 말로 "같다"고 적는 것과 **값으로 대조하는 것**은 다르다. 이 스크립트는 코드를 고치기
// **전에** 한 번 돌려 `server/test/helpers/auto-broadcast-baseline.json` 을 만들고,
// 고친 뒤에는 `server/test/auto-broadcast-regression.test.js` 가 그 파일과 대조한다.
//
// **기준선은 다시 만들지 않는다.** 다시 만들면 "바뀐 뒤의 값"이 기준이 되어 시험이
// 자기 자신을 통과시킨다 — 이 저장소가 되풀이해 겪은 실패다(틀린 사실을 고정하는 테스트).
// 정말 기준을 옮겨야 하면 `--force` 를 주고, **무엇이 왜 바뀌었는지 커밋 메시지에 적는다.**
//
// 쓰는 법:  node scripts/snapshot-auto-broadcast.cjs [--force]
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')

const OUT = path.join(__dirname, '..', 'server', 'test', 'helpers', 'auto-broadcast-baseline.json')
const FORCE = process.argv.includes('--force')

if (fs.existsSync(OUT) && !FORCE) {
  console.error(`기준선이 이미 있다: ${path.relative(process.cwd(), OUT)}`)
  console.error('덮어쓰려면 --force. 다만 기준선을 다시 뜨면 회귀 시험이 의미를 잃는다.')
  process.exit(1)
}

// ── ① 시퀀서 소스에서 "단계 → 카테고리" 를 읽어 낸다 ─────────────────────────
//
// 이것이 이 스냅샷의 핵심이다. 기본 연결표를 손으로 옮겨 적으면 그 표가 맞는지
// 아무도 검사하지 못한다. **지금 실행부에 박혀 있는 문자열 그대로**를 떠서 얼린다.
function 시퀀서기본표() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'services', 'broadcastSequencer.js'), 'utf8')

  // `case 'xxx':` 로 자르고, 각 조각에서 첫 번째 step*File/stepMealPrayer 호출의
  // 카테고리 리터럴을 집는다. 조각은 다음 `case` 또는 `default:` 까지다.
  const 조각들 = []
  const re = /case\s+'([a-z0-9_]+)'\s*:/g
  let m, prev = null
  while ((m = re.exec(src)) !== null) {
    if (prev) 조각들.push({ id: prev.id, body: src.slice(prev.end, m.index) })
    prev = { id: m[1], end: m.index + m[0].length }
  }
  if (prev) 조각들.push({ id: prev.id, body: src.slice(prev.end, prev.end + 4000) })

  const 표 = {}
  for (const { id, body } of 조각들) {
    if (표[id]) continue                   // 같은 id 는 레인마다 한 번씩만 나온다
    const 리터럴 = /step(AudioFile|VideoFile|MealPrayer)\(\s*db\s*,\s*'([a-z-]+)'/.exec(body)
    if (리터럴) {
      표[id] = { kind: 리터럴[1] === 'VideoFile' ? 'video' : 'audio',
        via: 리터럴[1], category: 리터럴[2], conditional: false }
      continue
    }
    // 변수를 넘기는 단계 — 조각 안의 카테고리 후보를 모두 적어 둔다(조건부 폴백).
    const 변수호출 = /step(AudioFile|VideoFile)\(\s*db\s*,\s*([a-zA-Z_$][\w$]*)\s*,/.exec(body)
    if (변수호출) {
      const 후보 = [...body.matchAll(/'([a-z]+-[a-z-]+)'/g)].map(x => x[1])
      표[id] = { kind: 변수호출[1] === 'VideoFile' ? 'video' : 'audio', via: 변수호출[1],
        category: null, conditional: true, candidates: [...new Set(후보)] }
    }
  }
  return 표
}

const 기본표 = 시퀀서기본표()

// ── ② 세 시설 상태에서 실제 값을 뜬다 ─────────────────────────────────────
const DB_PATH = path.join(os.tmpdir(), `carecast_baseline_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const { getDB, initDB } = require('../server/db/schema')
const { DEFAULT_STEPS } = require('../server/services/broadcastSequencer')
const { buildBroadcastSchedule, buildBroadcastEstimate } = require('../server/domain/broadcastScheduleRead')
const { pickCategoryFile } = require('../server/domain/categoryPick')
const { SITE_KINDS, seedSite, TABS } = require('../server/test/helpers/siteFixtures')

initDB()
const db = getDB()

// 시설 상태를 갈아 끼우려고 세 표를 비운다. settings 는 `initDB` 가 시딩한 볼륨 등이
// 들어 있으므로 **자동방송 관련 키만** 지운다 — 볼륨 기본값이 사라지면 비교가 오염된다.
function 비우기() {
  db.prepare('DELETE FROM audio_playlist').run()
  db.prepare('DELETE FROM audio_files').run()
  db.prepare('DELETE FROM content_folders').run()
  const 지울키 = ['morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps']
  for (const k of 지울키) db.prepare('DELETE FROM settings WHERE key = ?').run(k)
}

// 실행부가 그 단계에서 **실제로 고르는 파일**. 지금 코드의 규칙 그대로다:
//   · 기본표의 카테고리 (evening_closing_audio 만 조건부)
//   · `pickCategoryFile` — 재생목록이 이기고, 없으면 올린 순서(id)
//   · stepMealPrayer 는 "나갈 파일이 있나"로 음원/TTS 를 가른다
function 고른파일(stepId) {
  const 칸 = 기본표[stepId]
  if (!칸) return null
  let category = 칸.category
  if (칸.conditional) {
    // evening_closing_audio: evening-prayer 가 비면 dinner-prayer (broadcastSequencer.js:749-751)
    const c = db.prepare('SELECT COUNT(*) AS c FROM audio_files WHERE category = ?').get('evening-prayer')
    category = (c?.c > 0) ? 'evening-prayer' : 'dinner-prayer'
  }
  const file = pickCategoryFile(db, category, 0)
  const out = { category, kind: 칸.kind, via: 칸.via }
  if (칸.via === 'MealPrayer') out.mode = file ? 'audio' : 'tts'   // 파일 없으면 TTS 로 간다
  out.file = file ? { id: file.id, filename: file.filename, name: file.original_name, duration: file.duration } : null
  // TV·자막 보정이 어느 값을 쓰는지 (VideoPlayer.jsx:269-271 — 카테고리 문자열 비교)
  if (칸.kind === 'video') out.delayBucket = category === 'exercise-video' ? 'exercise' : 'meal'
  return out
}

const sites = {}
for (const kind of SITE_KINDS) {
  비우기()
  seedSite(db, kind, { DEFAULT_STEPS })

  const sched = buildBroadcastSchedule(db)
  const est   = buildBroadcastEstimate(db)

  const tabs = {}
  for (const tab of TABS) {
    const b = sched[tab]
    tabs[tab] = {
      enabled: b.enabled,
      time:    b.time,
      // 단계 순서·활성화·볼륨·배속 — 사용자가 나열한 보존 대상 그대로
      steps: (b.steps || []).map(s => ({
        id: s.id, order: s.order, enabled: s.enabled !== false,
        volume: s.volume ?? null, bgmVolume: s.bgmVolume ?? null, rate: s.rate ?? null,
        durationMin: s.durationMin ?? null, durationSec: s.durationSec ?? null,
        bgmSource: s.bgmSource ?? null, customType: s.customType ?? null,
        // `source` 키가 **생기지 않았는지** 보는 자리. 기존 데이터에는 없어야 한다.
        hasSourceKey: Object.prototype.hasOwnProperty.call(s, 'source'),
        source: Object.prototype.hasOwnProperty.call(s, 'source') ? s.source : undefined,
      })),
      picks: Object.fromEntries((b.steps || [])
        .map(s => [s.id, 고른파일(s.id)]).filter(([, v]) => v !== null)),
      estimate: { totalMs: est[tab].totalMs, end: est[tab].end, startTime: est[tab].startTime },
    }
  }
  // 저장된 JSON 원문도 뜬다 — "볼륨만 바꿔 저장했는데 연결이 생겼다"를 바이트로 잡으려고.
  const rawSteps = {}
  for (const tab of TABS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`${tab}_steps`)
    rawSteps[tab] = row ? row.value : null
  }
  sites[kind] = { tabs, rawSteps }
}

const out = {
  생성: new Date().toISOString(),
  설명: '자동방송 다섯의 변경 전 동작. auto-broadcast-regression.test.js 가 이것과 대조한다.',
  시퀀서기본표: 기본표,
  sites,
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`기준선 기록: ${path.relative(process.cwd(), OUT)}`)
console.log(`  단계→카테고리 ${Object.keys(기본표).length}개, 시설 상태 ${SITE_KINDS.length}가지`)

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(DB_PATH + suffix) } catch { /* 없으면 무시 */ }
}
