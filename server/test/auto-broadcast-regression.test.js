// **기존 자동방송 동작이 바뀌지 않았다** — 값으로 대조하는 회귀 시험.
//
// 사용자 조건(2026-09-13, 최상위 합격 조건):
//   *"설정을 변경하지 않은 기존 데이터에서 방송 시각, 단계 순서, 활성화 여부,
//     파일 선택과 폴백, 볼륨, TV·자막 보정이 변경 전후 동일해야 한다.
//     볼륨만 저장했을 때도 연결은 바뀌면 안 된다."*
//
// **기준선은 고치기 전에 떴다** — `scripts/snapshot-auto-broadcast.cjs` 가
// `helpers/auto-broadcast-baseline.json` 을 만들었고, 그 안에는 그때의 시퀀서 switch 에
// 박혀 있던 카테고리 문자열까지 들어 있다(소스를 파싱해 떴다). 그러므로 이 시험은
// **내가 옮겨 적은 표가 맞는지**를 내 표로 검사하지 않는다.
//
// ⚠ 기준선을 다시 뜨면 이 시험은 자기 자신을 통과시킨다. 이 저장소가 되풀이해 겪은
// 실패가 그것이다(틀린 사실을 고정하는 테스트). 기준선 파일은 손대지 않는다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_autoregress_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { DEFAULT_STEPS } = require('../services/broadcastSequencer')
const { buildBroadcastSchedule, buildBroadcastEstimate } = require('../domain/broadcastScheduleRead')
const { pickSourceFile } = require('../domain/categoryPick')
const { resolveStepSource, STEP_DEFAULT_SOURCE, defaultCategoryFor } = require('../domain/stepSource')
const { SITE_KINDS, seedSite, TABS } = require('./helpers/siteFixtures')

const 기준선 = require('./helpers/auto-broadcast-baseline.json')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// BGM 길이 옮겨 적기(2026-09-24) — 실제 부팅처럼 시설을 세운 뒤 한 번 돌린다. 마커가 남으면 다음 시설에서 안 돌므로 비울 때 지운다.
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')
const BGM길이이관 = DATA_FIXES.filter(f => f.key === 'datafix_bgm_duration_to_step_20260924')

function 비우기(db) {
  db.prepare('DELETE FROM audio_playlist').run()
  db.prepare('DELETE FROM audio_files').run()
  db.prepare('DELETE FROM content_folders').run()
  for (const tab of TABS) db.prepare('DELETE FROM settings WHERE key = ?').run(`${tab}_steps`)
  db.prepare("DELETE FROM settings WHERE key = 'datafix_bgm_duration_to_step_20260924'").run()
}

// 기존 시설이 **저장해 둔** 단계는 그때의 기본 단계로 만들어졌다 — 네 방송의 첫 BGM 에 durationSec 칸이 없던 때다(2026-09-24 이전).
// 지금 기본 단계(900초)로 세우면 새 기본값이 「사람이 저장한 값」처럼 들어가 옮겨 적기를 시험하지 못한다(처음 판이 그렇게 헛돌았다).
// 같은 이유로 「기도·묵상 시간(선택)」 단계는 **켜진 채로** 저장돼 있다 — 기본 꺼짐은 2026-10-17 에 생겼다(아래 ⑤).
const 기도단계 = new Set(['morning_prayer_intro', 'morning_prayer', 'lunch_prayer_intro', 'lunch_prayer_audio',
  'evening_prayer_audio', 'evening_prayer_tts2', 'evening_closing_audio'])
const 옛기본단계 = Object.fromEntries(Object.entries(DEFAULT_STEPS).map(([tab, steps]) => [tab,
  steps.map((s) => (s.id === 'bgm' && ['morning', 'exercise', 'lunch', 'dinner'].includes(tab)
    ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'durationSec')) : s))
    .map((s) => (기도단계.has(s.id) ? { ...s, enabled: true } : s))]))

function 시설세우기(kind) {
  const db = getDB()
  비우기(db)
  seedSite(db, kind, { DEFAULT_STEPS: 옛기본단계 })
  applyDataFixes(db, BGM길이이관)
  return db
}

// 기준선과 같은 모양으로 지금 코드의 값을 뜬다. **기준선 생성기와 같은 필드**여야 한다 —
// 한쪽만 늘리면 비교가 헐거워진다.
function 지금값(db, step) {
  const 연결 = resolveStepSource(db, step)
  if (연결.kind === 'none' && 연결.origin === 'unset') return null
  const file = pickSourceFile(db, 연결, 0)
  const stepId = String(step.id || '')
  const 칸 = STEP_DEFAULT_SOURCE[stepId]
  const out = {
    category: 연결.category,
    kind: 칸?.media ?? 연결.media,
    // 기준선의 `via` 는 실행부가 어느 함수를 타는지였다. 그 갈래는 단계 id 로 고정이라
    // 여기서 같은 방식으로 되살린다 — 값이 달라지면 실행 경로가 바뀐 것이다.
    via: VIA[stepId],
  }
  if (VIA[stepId] === 'MealPrayer') out.mode = file ? 'audio' : 'tts'
  // **`id` 는 비교에서 뺀다.** audio_files 의 자동증가 번호는 이 시험이 세 시설을 차례로
  // 세우면서 계속 올라가므로 기준선의 번호와 안 맞는다 — 그것은 픽스처의 사정이지
  // 방송 동작이 아니다. **"어느 파일이 나가나"는 filename·이름·길이가 말한다**(픽스처의
  // filename 은 카테고리마다 유일하다). 번호로 비교하면 시험 순서만 바꿔도 빨간불이 되고,
  // 그러면 진짜 회귀가 왔을 때 사람이 이 시험을 안 믿는다.
  out.file = file
    ? { filename: file.filename, name: file.original_name, duration: file.duration }
    : null
  // **`delayBucket` 은 이제 안 잰다**(2026-09-16). TV 싱크 보정값이 하나로 합쳐져
  // 갈래(A/B)라는 개념이 사라졌다 — 없는 것을 기준선과 견줄 수는 없다.
  // 기준선 JSON 에는 그 칸이 남아 있으므로 **비교할 때 양쪽에서 벗긴다**(아래).
  // 기준선을 다시 뜨지 않는 이유: 그 파일의 값어치는 「고치기 전」이라는 데 있다.
  return out
}

// ── **사용자가 결정한 변경만** 기준선에 덧씌운다 (2026-09-21) ────────────────────────
// 기준선 파일은 손대지 않는다(위 머리말). 대신 **이번에 일부러 바꾼 것**을 여기 이름을 달아 적고,
// 비교할 때 기준선 쪽에만 덧씌운다 — 목록 밖의 차이는 그대로 빨간불이다.
//   ① BGM 소스: 외부 동영상 검색(`yt_*`) → 이 PC 음원(`local`). 사용자 지시 「youtube를 완전히 다 빼야해」.
//      용도는 서버 기본(점심·저녁=식사용)이라 단계에 적힌 것은 소스뿐이다.
//   ② 방송 뒤 계절 영상 셋: 외부 검색 → 이 PC 의 「배경 영상」(scene-video) 폴더(사용자 결정 「로컬 영상으로」).
//      전에는 파일 연결이 없는 단계라 고른 것이 없었다(null). 이제 그 카테고리에서 고른다.
//   ③ (2026-09-24) 네 방송의 첫 BGM 길이: 칸이 비면 숨은 분 설정(`<방송>_bgm_duration`)으로 멈추던 것을 **단계 칸으로** 옮겼다
//      (사용자 「0은 끝까지, 디폴트는 15분」 · 「지금 멈추는 시간을 칸에 옮겨 적기」). 기준선의 칸은 null(= 분 설정이 정함)이다.
//      그래서 **소리가 같다**는 것은 「칸 값 = 예전 규칙으로 멈추던 초」로 확인한다 — 옛 재생 코드의 규칙 그대로 계산한다.
const 옛BGM기본분 = { morning: '0', exercise: '0', lunch: '15', dinner: '15' }   // 옛 broadcastSequencer 의 getSetting 기본값
//   ④ (2026-10-17) 기본 TTS 문안을 종교 중립으로 바꿨다(사용자 결정 「기본 방송 문안을 종교 중립으로」 · 검수 c6 지적 1).
//      식사 안내·기도·묵상 안내·마음 안정 안내 문구의 글자 수가 달라져 **그 문구를 읽는 방송의 예상 시간만** 바뀐다.
//      legacy·mixed 는 기도 단계가 켜진 채 저장돼 있으므로 차이는 **문안 길이뿐**이다
//      (점심 +2초: 기도·묵상 안내가 길어짐 / 저녁 마무리 -3초 / 아침 0: 식사 안내 -1자와 기도·묵상 안내 +자가 상쇄).
//   ⑤ 아래 `기도단계꺼짐차이` — [new] 는 문안 차이에 **꺼진 기도 단계만큼** 더 줄어든다.
//      아침 -28.6초 · 점심 -28.6초 · 저녁 식사 전 -16초(문안만 — 기도 단계 없음) · 저녁 마무리 -17.4초.
//      끝 시각은 저녁 마무리만 1분 당겨지고(18:02 → 18:01) 나머지는 같다.
//      목록 밖의 탭·시설에서 1ms 라도 다르면 그대로 빨간불이다.
//      (기준선 JSON 의 파일 이름·단계 이름은 같은 결정으로 낱말만 바꿨다 — 동작 값은 그대로다.)
const 문안교체차이 = {
  legacy: { lunch: 2000, evening_prayer: -3000 },
  mixed:  { lunch: 2000, evening_prayer: -3000 },
}
//   ⑤ (2026-10-17) 기도 단계를 **기본으로 꺼진 선택 항목**으로 바꿨다(사용자 결정 「기본 방송 문안을 종교 중립으로」).
//      단계 수·순서·id·시각은 그대로이고, **저장된 단계가 없는 PC([new])에서만** 위 `기도단계` 의 enabled 가
//      false 가 된다. 저장된 단계가 있는 PC(legacy·mixed)는 저장된 enabled 를 그대로 쓴다 — 그래서 값이 같다.
//      [new] 의 예상 시간은 문안 차이와 꺼진 단계를 합쳐 아래만큼 줄어든다(④ 참고).
const 기도단계꺼짐차이 = {
  new: { morning: -28600, lunch: -28600, dinner: -16000, evening_prayer: -17400 },
}
test('⑤ 기본으로 꺼진 단계는 「기도·묵상 시간(선택)」 단계뿐이다 — 단계 수·순서는 그대로다', () => {
  const 꺼짐 = Object.values(DEFAULT_STEPS).flat().filter(s => s.enabled === false)
  assert.deepEqual(new Set(꺼짐.map(s => s.id)), 기도단계, '기본 꺼짐 단계 목록이 결정과 다르다')
  for (const s of 꺼짐) assert.match(s.label, /^기도·묵상 시간 .*\(선택\)$/, `${s.id} 이름표가 선택 항목으로 안 보인다: ${s.label}`)
  for (const [tab, 옛] of Object.entries(기준선.sites.new.tabs)) {
    assert.deepEqual(DEFAULT_STEPS[tab].map(s => s.id), 옛.steps.map(s => s.id), `${tab} 단계 수·순서가 바뀌었다`)
  }
})
const 의도된변경 = {
  기도단계꺼짐: (db, tab, step) => (기도단계.has(step.id)
    && !db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`${tab}_steps`) ? false : step.enabled),
  bgmSource: (v) => (typeof v === 'string' && v.startsWith('yt_') ? 'local' : v),
  배경영상: new Set(['morning_video', 'lunch_video_after', 'dinner_video_after']),
  첫BGM초: (db, tab, step) => {
    if (step.id !== 'bgm' || !(tab in 옛BGM기본분) || step.durationSec != null) return step.durationSec
    // 저장된 단계가 없는 PC(새 PC — [new] 시설)는 옮겨 적지 않고 사용자가 정한 기본 15분으로 시작한다(의도한 차이)
    if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`${tab}_steps`)) return 900
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get(`${tab}_bgm_duration`)?.value
    return (parseInt(raw == null ? 옛BGM기본분[tab] : raw) || 0) * 60
  },
}

// 단계 id → 실행부가 타는 함수. **기준선에 적힌 것을 그대로 읽어** 쓴다(내가 다시 적지 않는다).
const VIA = Object.fromEntries(
  Object.entries(기준선.시퀀서기본표).map(([id, v]) => [id, v.via]))

// ── ① 기본 연결표가 **고치기 전 시퀀서 switch 와 같은가** ───────────────────────
test('기본 연결표가 고치기 전 실행부의 카테고리와 글자 그대로 같다', () => {
  const db = 시설세우기('legacy')
  for (const [stepId, 옛값] of Object.entries(기준선.시퀀서기본표)) {
    const 지금 = defaultCategoryFor(db, stepId)
    if (옛값.conditional) {
      // 조건부(저녁 마무리 마침) — legacy 는 evening-prayer 가 비어 있으니 dinner-prayer 여야 한다
      assert.ok(옛값.candidates.includes(지금),
        `${stepId}: 조건부 폴백이 옛 후보(${옛값.candidates.join('·')}) 밖으로 나갔다 — ${지금}`)
    } else {
      assert.equal(지금, 옛값.category,
        `${stepId} 의 기본 카테고리가 바뀌었다 — 이 단계의 소리가 달라진다`)
    }
  }
  // 표가 **줄지 않았는지**도 본다. 빠뜨린 단계는 기본값이 없어 조용히 건너뛴다.
  for (const stepId of Object.keys(기준선.시퀀서기본표)) {
    assert.ok(STEP_DEFAULT_SOURCE[stepId], `${stepId} 가 기본표에서 사라졌다`)
  }
})

// ── ② 세 시설 상태에서 전부 같은가 ──────────────────────────────────────────
for (const kind of SITE_KINDS) {
  test(`[${kind}] 방송 시각·단계 순서·활성화·볼륨이 변경 전과 같다`, () => {
    const db = 시설세우기(kind)
    const sched = buildBroadcastSchedule(db)
    for (const tab of TABS) {
      const 옛 = 기준선.sites[kind].tabs[tab]
      const b = sched[tab]
      assert.equal(b.enabled, 옛.enabled, `${tab} 활성화 여부가 바뀌었다`)
      assert.equal(b.time,    옛.time,    `${tab} 방송 시각이 바뀌었다`)
      const 지금단계 = (b.steps || []).map(s => ({
        id: s.id, order: s.order, enabled: s.enabled !== false,
        volume: s.volume ?? null, bgmVolume: s.bgmVolume ?? null, rate: s.rate ?? null,
        durationMin: s.durationMin ?? null, durationSec: s.durationSec ?? null,
        bgmSource: s.bgmSource ?? null, customType: s.customType ?? null,
        hasSourceKey: Object.prototype.hasOwnProperty.call(s, 'source'),
      }))
      const 옛단계 = 옛.steps.map(({ source: _s, ...나머지 }) => {
        void _s
        return { ...나머지, enabled: 의도된변경.기도단계꺼짐(db, tab, 나머지), bgmSource: 의도된변경.bgmSource(나머지.bgmSource), durationSec: 의도된변경.첫BGM초(db, tab, 나머지) }
      })
      assert.deepEqual(지금단계, 옛단계, `${tab} 단계 순서·활성화·볼륨이 바뀌었다`)
    }
  })

  test(`[${kind}] 파일 선택과 폴백이 변경 전과 같다`, () => {
    const db = 시설세우기(kind)
    const sched = buildBroadcastSchedule(db)
    for (const tab of TABS) {
      const 옛 = 기준선.sites[kind].tabs[tab].picks
      const 지금 = Object.fromEntries((sched[tab].steps || [])
        .map(s => [s.id, 지금값(db, s)]).filter(([, v]) => v !== null))
      // 기준선 쪽에서도 같은 이유로 `id` 를 벗긴다(위 `지금값` 주석).
      const 옛벗김 = Object.fromEntries(Object.entries(옛).map(([k, v]) => {
        // `delayBucket` 은 2026-09-16 에 없어진 개념이다 — 기준선에는 남아 있으므로 벗긴다.
        const { delayBucket: _갈래, ...값 } = v ?? {}
        void _갈래
        if (!값?.file) return [k, 값]
        const { id: _번호, ...파일 } = 값.file
        void _번호
        return [k, { ...값, file: 파일 }]
      }))
      // ② 배경 영상 셋은 이제 「배경 영상」 폴더에서 고른다 — 기준선에 없던 칸이라 그대로 받되,
      //    **카테고리가 scene-video 인지는 본다**(엉뚱한 폴더로 새면 빨간불).
      for (const id of 의도된변경.배경영상) {
        if (지금[id] === undefined) continue
        assert.equal(지금[id].category, 'scene-video', `${tab}.${id} 가 배경 영상 폴더가 아닌 곳을 본다`)
        if (!(id in 옛벗김)) delete 지금[id]
      }
      assert.deepEqual(지금, 옛벗김, `${tab} 에서 나가는 파일이 바뀌었다`)
    }
  })

  test(`[${kind}] 예상 소요시간이 변경 전과 같다`, () => {
    const db = 시설세우기(kind)
    const est = buildBroadcastEstimate(db)
    for (const tab of TABS) {
      const 옛 = 기준선.sites[kind].tabs[tab].estimate
      const 차이 = (문안교체차이[kind]?.[tab] ?? 0) + (기도단계꺼짐차이[kind]?.[tab] ?? 0)
      assert.equal(est[tab].totalMs,   옛.totalMs + 차이,   `${tab} 예상 시간이 바뀌었다`)
      assert.equal(est[tab].startTime, 옛.startTime)
      if (!차이) { assert.deepEqual(est[tab].end, 옛.end); continue }
      // 문안이 짧아진 방송은 끝 시각이 같거나 1분 안쪽으로 당겨질 수 있다(분 단위 반올림).
      const 분 = (e) => e.dayOffset * 1440 + Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3, 5))
      const 당김 = 분(옛.end) - 분(est[tab].end)
      assert.ok(당김 >= 0 && 당김 <= 1, `${tab} 끝 시각이 문안 차이로 설명되지 않는다: ${JSON.stringify(est[tab].end)} vs ${JSON.stringify(옛.end)}`)
    }
  })
}

// ── ③ 저녁 마무리 조건부 폴백 — 규칙 자체를 값으로 확인한다 ────────────────────────
test('저녁 마무리 마침 음원: evening-prayer 가 비면 dinner-prayer 로 떨어지고, 채우면 되돌아온다', () => {
  const db = 시설세우기('legacy')
  assert.equal(defaultCategoryFor(db, 'evening_closing_audio'), 'dinner-prayer',
    'evening-prayer 가 비었는데 폴백이 안 걸렸다')

  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES ('evening-prayer', 'ep.mp3', '저녁 마무리 마침.mp3', 88, '2026-01-02')`).run()
  assert.equal(defaultCategoryFor(db, 'evening_closing_audio'), 'evening-prayer',
    '파일을 넣었는데도 폴백에 머물렀다')

  const step = { id: 'evening_closing_audio' }
  const file = pickSourceFile(db, resolveStepSource(db, step), 0)
  assert.equal(file.original_name, '저녁 마무리 마침.mp3')
})

// ── ④ TV·자막 보정 ─────────────────────────────────────────────────────────
//
// **2026-09-16 에 보정값을 하나로 합쳤다**(사용자 지시). 그전에는 둘이었다 —
// 국민체조(`video_audio_delay_exercise_ms`)와 식사전 체조(`video_audio_delay_meal_ms`).
// 갈래를 고르려고 `delayProfile`(A/B)이 서버 → 화면 → 재생기로 흘렀고, **그 사슬이
// 끊겨 조용히 틀린 값이 걸린 사고가 두 번** 있었다(V③ R18·R23, 2026-09-14).
//
// 두 값은 **같은 것을 재고 있었다** — 지연은 캡처카드→TV 경로에서 오고 그 경로는 영상마다
// 다르지 않다. 현장 값도 둘 다 400 이었다. **고를 것이 없으면 틀리게 고를 수도 없다.**
//
// 그래서 갈래를 고정하던 시험 둘(기본 매핑 A/B · 단계에 붙는가)은 **지웠다.** 없는 것을
// 지키는 시험은 다음 사람에게 "그런 개념이 있다"고 거짓말한다. 대신 **합쳐진 뒤의
// 사실**을 여기서 지킨다.

test('보정 설정 키는 **하나**다 — 갈라 두면 한쪽만 맞춰 두고 잊는다', () => {
  const 도메인 = fs.readFileSync(path.join(__dirname, '..', 'domain', 'videoSync.js'), 'utf8')
  const 라우트 = fs.readFileSync(path.join(__dirname, '..', 'routes', 'settings.js'), 'utf8')

  // 긍정 앵커 — 감시할 대상이 있다(CLAUDE.md "파일을 가를 때" ②).
  assert.match(도메인, /딜레이키 = 'video_audio_delay_ms'/, '보정 키를 못 찾았다')
  assert.match(도메인, /자막오프셋키 = 'caption_offset_ms'/, '자막 오프셋 키를 못 찾았다')

  // 갈라 두었던 옛 키를 **다시 쓰지 않는다.**
  for (const 옛키 of ['video_audio_delay_exercise_ms', 'video_audio_delay_meal_ms']) {
    assert.ok(!라우트.includes(옛키), `라우트가 옛 키 ${옛키} 를 다시 쓴다 — 값이 또 갈린다`)
  }
  // 규칙이 라우트에 사본으로 남아 있지 않다.
  assert.match(라우트, /require\('\.\.\/domain\/videoSync'\)/, '라우트가 규칙을 따로 들고 있다')
})

test('**배포 기본값은 0 이다** — 새 PC 는 대개 TV 가 아니라 모니터로 본다', () => {
  // 사용자 지시 2026-09-16: *"설치 배포할때는 그냥 기본값, 모니터에서 나오는 그대로 0"*.
  // 앞 기본값 450 은 **처음 운영한 시설의 캡처카드·TV 조합에서 잰 값**이지 어느 시설에나
  // 맞는 값이 아니다. 거기서 450 은 소리가 근거 없이 0.45초 늦는다는 뜻이다.
  const { 딜레이기본, 자막오프셋기본 } = require('../domain/videoSync')
  assert.equal(딜레이기본, 0, '영상 보정 기본값이 0 이 아니다 — 새 시설 소리가 근거 없이 늦는다')
  assert.equal(자막오프셋기본, 0, '자막 오프셋 기본값이 0 이 아니다')
})

// ── **빈 값이 현장 보정을 0 으로 덮어쓰지 않는다** (V③ R19 지적 4, 2026-09-14) ──────────
//
// 예전 검사는 `delayMs === undefined || isNaN(Number(delayMs))` 였다. 그런데
// **`Number(null)` · `Number('')` · `Number('   ')` 가 전부 0 이다.** 그래서 빈 값이 검사를
// 통과해 `'0'` 이 쓰였다 — 200 을 돌려주므로 화면은 "저장됐다"고 말하고, 그 뒤로 소리와
// 자막이 어긋난다. **오류가 안 난다.**
//
// 글자로 안 보고 **진짜 함수를 부른다** — 이제 `domain/videoSync` 에 있어 그냥 require 한다.
test('보정값: 빈 값은 막고 명시적 0 은 받는다 — 진짜 함수를 부른다', () => {
  const { 보정값읽기, 자막오프셋읽기 } = require('../domain/videoSync')

  // **막아야 하는 것** — 값을 안 준 것이다
  for (const 빈것 of [undefined, null, '', '   ', 'abc', NaN, true, {}]) {
    const r = 보정값읽기(빈것)
    assert.equal(r.ok, false, `빈 값이 통과했다: ${JSON.stringify(빈것)} — 현장 보정이 0 으로 덮인다`)
    assert.ok(r.사유 && r.사유.length > 0, '왜 막혔는지를 안 말한다')
  }

  // **받아야 하는 것** — 0 은 보정을 끄는 정당한 조작이다.
  assert.deepEqual(보정값읽기(0), { ok: true, 값: 0 }, '명시적 0 을 막으면 보정을 끌 방법이 없다')
  assert.deepEqual(보정값읽기('0'), { ok: true, 값: 0 })
  assert.deepEqual(보정값읽기(450), { ok: true, 값: 450 })
  // 영상 보정은 **0 밑으로 안 간다** — 소리를 미리 낼 수는 없다.
  assert.deepEqual(보정값읽기(-100), { ok: true, 값: 0 })
  assert.deepEqual(보정값읽기(9999), { ok: true, 값: 2000 })

  // **자막 오프셋은 음수가 된다** — 당기는 것이 이 값의 존재 이유다.
  assert.deepEqual(자막오프셋읽기(-800), { ok: true, 값: -800 }, '자막을 당길 수 없으면 이 값이 쓸모없다')
  assert.deepEqual(자막오프셋읽기(-9999), { ok: true, 값: -2000 })
  assert.deepEqual(자막오프셋읽기(9999), { ok: true, 값: 2000 })
  assert.equal(자막오프셋읽기('').ok, false, '빈 값이 자막 오프셋을 0 으로 덮는다')

  // 라우트가 옛 검사를 다시 들이지 않았다.
  const 라우트 = fs.readFileSync(path.join(__dirname, '..', 'routes', 'settings.js'), 'utf8')
  assert.ok(!/isNaN\(Number\(delayMs\)\)/.test(라우트), '옛 검사가 되살아났다 — 빈 값이 통과한다')
})

test('자막 시점 = **영상 보정 + 자막 오프셋** — 소리만 옮기면 글자가 어긋난다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'broadcast', 'VideoPlayer.jsx'), 'utf8')
  // 긍정 앵커 — 보정을 거는 자리가 이 파일에 있다
  assert.ok(src.includes('setupWebAudioDelay(v, delayMs)'), '소리 보정을 거는 자리가 없다')
  // 자막에는 **둘을 함께** 넘긴다.
  assert.match(src, /자막붙이기\(v, delayMs, captionOffsetRef\.current\)/,
    '자막에 오프셋을 안 넘긴다 — 자막을 당기는 설정이 아무 일도 안 한다')
  // 슬라이더를 미는 동안에도 둘이 같이 움직인다.
  assert.match(src, /자막보정\(ms, captionOffsetRef\.current\)/,
    '영상 슬라이더를 밀 때 자막이 안 따라간다')
  assert.match(src, /자막보정\(audioDelayRef\.current, ms\)/,
    '자막 슬라이더를 밀 때 반영이 안 된다')
  // 갈래는 사라졌다 — 되살아나면 이 시험이 먼저 안다.
  assert.ok(!src.includes('보정갈래'), '보정 갈래(A/B)가 되살아났다 — 값은 하나뿐이다')
})

// ── 서버가 실은 칸이 **재생기까지 간다** (V③ R18 지적 3 → R23 지적 1, 2026-09-14) ────────
//
// 무엇이 뚫려 있었나: `broadcastSteps.js` 가 실어 보낸 칸 하나를 `useScheduledBroadcast` 의
// `video_play` 변환이 **빼고** 넘겼다. 그러면 재생기가 그 값을 못 보는데 **오류는 안 난다.**
//
// 첫 판 시험은 훅 소스에 그 이름이 **있는지만** 봤다. 검수관이 깨뜨려 증명했다 —
// *"메모리에서 실제 전달 코드를 `undefined` 로 바꿔도 단언이 통과했다."*
// 그래서 판정을 화면 밖(`lib/videoPlayEvent`)으로 내리고 **사슬을 통째로 돌린다.**
//
// 사고의 주인공이던 `delayProfile` 은 2026-09-16 에 없앴지만 **이 시험은 남긴다** —
// 칸을 빠뜨리는 실수는 어느 칸에서든 일어난다.
test('서버가 실은 칸이 화면을 지나 재생기까지 간다 — 사슬을 실제로 돌린다', async () => {
  const V = await import(
    'file:///' + path.join(__dirname, '..', '..', 'src', 'lib', 'videoPlayEvent.js').replace(/\\/g, '/'))

  const 서버가보낸것 = {
    url: '/audio/misc-video/x.mp4', name: '체조', token: 't1',
    category: 'misc-video', source: null, videoId: null,
    volume: 70, rate: 1, audioFileId: 9,
  }
  const 화면이넘긴것 = V.영상재생상세(서버가보낸것)

  // **한 칸도 잃지 않는다.**
  for (const 칸 of ['url', 'name', 'token', 'category', 'volume', 'rate', 'audioFileId']) {
    assert.equal(화면이넘긴것[칸], 서버가보낸것[칸], `「${칸}」 이 재생기까지 안 간다`)
  }

  // **화면이 detail 을 손으로 조립하지 않는다** — 조립하면 또 한 칸이 조용히 빠진다.
  const 훅 = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'hooks', 'useScheduledBroadcast.js'), 'utf8')
  assert.match(훅, /detail: 영상재생상세\(/, '화면이 detail 을 손으로 조립한다')

  // 없앤 갈래가 되살아나지 않았다.
  assert.equal(typeof V.보정갈래, 'undefined', '보정갈래 가 되살아났다 — 값은 하나뿐이다')
})
