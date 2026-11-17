// 자동방송 5종의 설정을 **한 벌로 읽는 규칙** — 시각·단계·문구, 그리고 BGM이 저장된 음원을
// 실제로 쓰는지.
//
// `routes/settings.js`(1213줄)에서 **통째로 내려왔다**(2026-09-05, TD-10 기회식).
// **옮기기만 했고 동작은 바꾸지 않았다** — 아래 본문은 원본과 줄 단위로 같다.
//
// 왜 `domain/`인가: 처음엔 이웃 라우트 파일로 갈랐다가 route-wiring.test.js에 걸렸다.
// 라우트 파일은 require 시점에 부작용(Router 생성 등)이 있어서 서로 당기면 로드 순서에
// 얽힌다 — 그 테스트가 알려주는 답이 "공유할 것은 services/나 domain/으로 내린다"였다.
// 여기 있는 것은 DB를 **주입받아** 평범한 객체를 돌려주는 순수 읽기라 domain/이 제자리다.
//
// **단일 출처다.** 화면 편집기(GET /broadcast-schedule)와 예상시간(/estimate)이 같은 것을
// 봐야 한다 — 두 벌로 두면 한쪽만 고쳐져 화면 숫자와 실제 구성이 갈린다. 사본도 폴백도 두지 않는다.
'use strict'

const { rawSetting } = require('./settingsRead')
const { AUTO_BROADCASTS, readAutoNames } = require('./autoBroadcasts')

// routes/settings.js와 같은 **얇은 감싸개**다. 사설 사본이 아니라 settingsRead 위임이고,
// settings-read-failure.test.js가 그 구분을 본다 — 이 파일도 그 검사 목록에 넣었다.
function getSetting(db, key, defaultValue = '') { return rawSetting(db, key) ?? defaultValue }
const autoDefaultTime = id => AUTO_BROADCASTS.find(b => b.id === id).defaultTime

// ── 방송 일정 편집기 설정 ──────────────────────────────────────

// 5개 방송의 설정을 한 벌로 읽는다. GET /broadcast-schedule과 그 아래 /estimate가 **같은 것**을
// 봐야 해서 함수로 뺐다 — 두 벌로 두면 한쪽만 고쳐져 화면 숫자와 실제 구성이 갈린다.
function buildBroadcastSchedule(db) {
  {
    const {
      BREAKFAST_PRAYER_DEFAULT, LUNCH_PRAYER_DEFAULT, DINNER_PRAYER_DEFAULT,
      EXERCISE_TTS_DEFAULT, LUNCH_TTS_DEFAULT, DINNER_TTS_DEFAULT,
      EVENING_PRAYER_TTS_DEFAULT,
      EVENING_PRAYER_TTS2_DEFAULT,
      EVENING_CLOSING_TTS_DEFAULT,
      MORNING_PRAYER_INTRO_DEFAULT,
      LUNCH_PRAYER_INTRO_DEFAULT, DINNER_PRAYER_INTRO_DEFAULT,
      DEFAULT_STEPS, mergeStepsWithDefaults,
    } = require('../services/broadcastSequencer')

    // 병합 로직은 broadcastSequencer.js의 mergeStepsWithDefaults 하나로 통일(중복 제거) —
    // 과거 이 자리에 같은 로직이 복붙돼 있어 커스텀 스텝이 여기서만 조용히 drop되던 버그가 있었음.
    // 화면이 "이 단계는 무엇에 연결돼 있나"를 그리려면 해석 결과가 필요하다. 그런데
    // **해석은 서버가 한 번만** 한다(설계 §2-C) — 화면이 따로 해석하면 두 벌이 갈린다.
    // 그래서 `sourceResolved` 를 **읽기 전용 파생 필드**로 얹는다.
    //
    // ⚠ 이 필드는 **저장 경로에서 반드시 걷힌다**(`routes/settings.js` 의 `단계정리`).
    // 화면이 받은 것을 통째로 되돌려 보내기 때문이다 — 안 걷으면 화면을 열고 볼륨만
    // 바꿔 저장해도 다섯 방송 모든 단계에 기본 연결이 박힌다.
    // `source` 키 자체는 **건드리지 않는다** — 없으면 없는 채로 내보낸다.
    const 연결얹기 = (steps) => {
      const { resolveStepSource } = require('./stepSource')
      return steps.map(s => ({
        ...s,
        sourceResolved: resolveStepSource(db, s),
        // 영상 단계의 TV 싱크 보정 갈래도 화면이 알아야 고르개를 그린다.
      }))
    }

    const parseSteps = (key, tab) => {
      const raw = getSetting(db, key, '')
      if (!raw) return 연결얹기(DEFAULT_STEPS[tab])
      try {
        return 연결얹기(mergeStepsWithDefaults(DEFAULT_STEPS[tab], JSON.parse(raw)))
      } catch (e) {
        // 저장된 단계가 깨졌으면 기본 단계로 돌아간다(화면이 500으로 막히면 고칠 방법이 없다).
        // 다만 조용히 넘기면 사람이 편집한 순서가 사라진 이유를 영영 모른다.
        console.error(`[settings] ${tab} 단계 설정이 깨져 기본값으로 돌아간다:`, e.message)
      }
      return 연결얹기(DEFAULT_STEPS[tab])
    }

    // 화면에 보여줄 이름 — 사람이 바꿀 수 있다. 표시 전용이라 이력 문구는 안 따라간다.
    const autoNames = readAutoNames(db)

    return {
      morning: {
        enabled:               getSetting(db, 'morning_enabled', 'true') === 'true',
        name:                  autoNames.morning,
        time:                  getSetting(db, 'morning_time', autoDefaultTime('morning')),
        steps:                 parseSteps('morning_steps', 'morning'),
        bgmDuration:           parseInt(getSetting(db, 'morning_bgm_duration', '0')) || 0,
        morningPrayerIntroTts: getSetting(db, 'morning_prayer_intro_tts', MORNING_PRAYER_INTRO_DEFAULT),
      },
      exercise: {
        enabled:     getSetting(db, 'exercise_broadcast_enabled', 'true') === 'true',
        name:                  autoNames.exercise,
        time:        getSetting(db, 'exercise_broadcast_time', autoDefaultTime('exercise')),
        steps:       parseSteps('exercise_steps', 'exercise'),
        tts:         getSetting(db, 'exercise_tts', EXERCISE_TTS_DEFAULT),
      },
      lunch: {
        enabled:             getSetting(db, 'lunch_broadcast_enabled', 'true') === 'true',
        name:                  autoNames.lunch,
        time:                getSetting(db, 'lunch_broadcast_time', autoDefaultTime('lunch')),
        steps:               parseSteps('lunch_steps', 'lunch'),
        tts:                 getSetting(db, 'lunch_tts', LUNCH_TTS_DEFAULT),
        prayerTts:           getSetting(db, 'lunch_prayer_tts', LUNCH_PRAYER_DEFAULT),
        bgmDuration:         parseInt(getSetting(db, 'lunch_bgm_duration', '15')) || 0,
        lunchPrayerIntroTts: getSetting(db, 'lunch_prayer_intro_tts', LUNCH_PRAYER_INTRO_DEFAULT),
      },
      dinner: {
        enabled:              getSetting(db, 'dinner_broadcast_enabled', 'true') === 'true',
        name:                  autoNames.dinner,
        time:                 getSetting(db, 'dinner_broadcast_time', autoDefaultTime('dinner')),
        steps:                parseSteps('dinner_steps', 'dinner'),
        tts:                  getSetting(db, 'dinner_tts', DINNER_TTS_DEFAULT),
        prayerTts:            getSetting(db, 'dinner_prayer_tts', DINNER_PRAYER_DEFAULT),
        bgmDuration:          parseInt(getSetting(db, 'dinner_bgm_duration', '15')) || 0,
        dinnerPrayerIntroTts: getSetting(db, 'dinner_prayer_intro_tts', DINNER_PRAYER_INTRO_DEFAULT),
      },
      breakfastPrayerTts: getSetting(db, 'breakfast_prayer_tts', BREAKFAST_PRAYER_DEFAULT),
      evening_prayer: {
        enabled: getSetting(db, 'evening_prayer_enabled', 'true') === 'true',
        name:                  autoNames.evening_prayer,
        time:    getSetting(db, 'evening_prayer_time', autoDefaultTime('evening_prayer')),
        steps:   parseSteps('evening_prayer_steps', 'evening_prayer'),
        tts:        getSetting(db, 'evening_prayer_tts',  EVENING_PRAYER_TTS_DEFAULT),
        tts2:       getSetting(db, 'evening_prayer_tts2', EVENING_PRAYER_TTS2_DEFAULT),
        closingTts: getSetting(db, 'evening_closing_tts', EVENING_CLOSING_TTS_DEFAULT),
      },
    }
  }
}

// ── 자동방송이 **저장된 BGM 음원을 실제로 쓰는가** ────────────
//
// 처음 만든 까닭: 예전엔 BGM 단계 대부분이 외부 키워드 검색이라 **올린 음원을 아예 안 봤고**, 사람은
// 음원을 올려 두고 왜 안 나오는지 알 길이 없었다. 2026-09-21 부터는 모든 BGM 단계가 이 PC 음원을
// 쓴다 — 이제 알려 줄 것은 「어느 단계가 **어느 폴더**(방송용·식사용)를 보나」다.
//
// **고정 문구로 적지 않는다.** 편집기에서 방식을 바꾸면 그 문구가 그날부터 새 거짓말이 된다.
// 그래서 지금 설정을 세어서 알려 주고, 화면은 그 숫자를 그대로 읽는다.
//
// 무엇이 BGM 단계인가: id가 bgm으로 시작하는 것(bgm · bgm_start · bgm_after · bgm_closing ·
// bgm_final). 목록을 또 한 벌 적어 두면 단계가 늘 때 여기만 안 고쳐진다.
const AUTO_TABS = ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']

// "몇 개"만으로는 부족해서 **어느 단계인지**를 같이 준다 — 사람이 "왜 안 나오지"를 풀려면
// 어디를 고쳐야 하는지 알아야 한다. 폴더(role)는 실행부(stepBGMStart)와 같은 규칙으로 푼다.
function readBgmUsage(db) {
  const sched = buildBroadcastSchedule(db)
  const broadcasts = []
  for (const tab of AUTO_TABS) {
    const b = sched[tab]
    if (!b) continue
    const steps = (b.steps || [])
      .filter(st => st && st.enabled !== false && String(st.id || '').startsWith('bgm'))
      .map(st => {
        const role = st.bgmRole || require('./bgmRoles').기본역할(tab)
        // 사람이 만든 폴더를 고른 단계(2026-09-22) — 그 번호를 같이 준다(용도만 적으면 다른 폴더로 읽힌다).
        const folderId = parseInt(st.bgmFolderId, 10) || null
        return { id: st.id, label: st.label || st.id, source: 'local', role, folderId, usesLocal: true }
      })
    broadcasts.push({ id: tab, name: b.name, enabled: !!b.enabled, steps })
  }
  // 꺼 놓은 방송은 세지 않는다 — 안 나가는 방송이 "여기 음원을 쓴다"고 세어지면 그것도 거짓이다.
  const live = broadcasts.filter(b => b.enabled)
  const total      = live.reduce((n, b) => n + b.steps.length, 0)
  const usingLocal = live.reduce((n, b) => n + b.steps.filter(st => st.usesLocal).length, 0)
  // 화면이 그대로 읽을 수 있게 "방송 이름 — 단계 이름"으로 미리 엮어 준다.
  const localSteps = live.flatMap(b => b.steps.filter(st => st.usesLocal)
    .map(st => b.name + ' 「' + st.label + '」'))
  return { total, usingLocal, localSteps, broadcasts }
}


// GET /api/settings/broadcast-schedule/estimate — 방송별 예상 소요시간
//
// 편집기 머리에 "대략 41분 · 08:31에 끝남"을 띄우려는 것. 계산은 화면이 아니라 **서버**가
// 한다 — 얼마나 기다리는지 아는 것은 실행하는 쪽이고, 화면이 따로 세면 두 값이 갈린다.
//
// 재료(문구·파일 길이)는 여기서 모아 순수 함수(domain/broadcastEstimate)에 넘긴다.
// 파일은 **그 단계가 실제로 틀 파일**을 골라야 한다 — 음원은 카테고리에서 id 순 첫 번째
// (stepAudioFile), 영상은 재생목록의 활성 첫 번째(stepVideoFile)다.
//
// 라우트에서 내려왔다(2026-09-05). **재료를 모으는 일**이라 여기 산다 — 위 buildBroadcastSchedule과
// 같은 설정을 봐야 하고, 실제 셈은 domain/broadcastEstimate가 한다(순수 함수).
function buildBroadcastEstimate(db) {
  const { estimateBroadcastDuration, estimateEndTime } =
    require('../domain/broadcastEstimate')
  const { pickSourceFile } = require('../domain/categoryPick')
  const { todayStr } = require('../services/repeatSchedule')
  // 저녁 마무리 3종은 실행부가 `getSetting(...) || 기본문구`로 읽는다 — 빈칸으로 저장돼 있어도
  // 기본 문구가 나간다. buildBroadcastSchedule 쪽에 이 폴백을 넣으면 **편집기 화면의 빈 칸이
  // 기본 문구로 채워져** 사람이 일부러 비운 값을 덮어쓰므로, 추정 경로에서만 맞춘다.
  const {
    EVENING_PRAYER_TTS_DEFAULT, EVENING_PRAYER_TTS2_DEFAULT, EVENING_CLOSING_TTS_DEFAULT,
  } = require('../services/broadcastSequencer')
  const sched = buildBroadcastSchedule(db)

  // 이 단계가 실제로 틀 파일. **"없음"과 "길이 모름"을 갈라서 넘긴다** — 실행부는 파일이
  // 아예 없으면 대기 없이 건너뛰므로(stepAudioFile/stepVideoFile의 `if (!file) return`),
  // 둘을 뭉뚱그리면 없는 소리를 5분짜리로 적게 된다.
  // 2026-09-13: 카테고리를 이 자리에서 **다시 정하지 않는다.** 예전엔 `STEP_AUDIO_CATEGORY`
  // 표와 저녁 마무리 폴백이 여기 한 벌 더 있었는데, 이제 연결 해석이 `domain/stepSource` 한
  // 곳이라 그 사본이 필요 없다. **사람이 폴더·파일을 연결한 단계**도 이 길로 같이 온다 —
  // 안 그러면 사람이 연결을 바꾼 뒤 화면의 예상 시간만 옛 파일 길이로 남는다.
  const fileFor = (step) => {
    const { resolveStepSource } = require('./stepSource')
    const 연결 = resolveStepSource(db, step)
    // 이 단계는 파일을 트는 자리가 아니다(TTS·BGM·대기 등) — 셈에서 빠진다.
    if (연결.kind === 'none' && 연결.origin === 'unset') return undefined
    // 실행부와 **같은 함수**로 고른다(domain/categoryPick). 예전엔 이 자리에 실행부 규칙을
    // 베껴 놓고 "흐리면 화면 숫자가 거짓이 된다"는 주석으로 지켰는데, 규칙이 바뀌면 결국
    // 어긋난다. 이제 규칙이 한 곳에 있으니 베낄 것이 없다.
    const first = pickSourceFile(db, 연결, 0)
    return first ? { exists: true, duration: first.duration } : { exists: false }
  }

  const ttsRate = parseFloat(getSetting(db, 'tts_rate', '0.9')) || 0.9
  const TEXT_OF = {
    morning: {
      date_weather_schedule: '',   // 서버가 그 자리에서 조립한다 — 길이를 미리 알 수 없다
      morning_prayer_intro:  sched.morning.morningPrayerIntroTts,
      breakfast_prayer_tts:  sched.breakfastPrayerTts,
    },
    exercise: { exercise_tts: sched.exercise.tts },
    lunch: {
      lunch_tts:           sched.lunch.tts,
      lunch_prayer_intro:  sched.lunch.lunchPrayerIntroTts,
      lunch_prayer_tts:    sched.lunch.prayerTts,
    },
    dinner: {
      dinner_tts:        sched.dinner.tts,
      dinner_prayer_tts: sched.dinner.prayerTts,
    },
    evening_prayer: {
      evening_prayer_tts:  sched.evening_prayer.tts        || EVENING_PRAYER_TTS_DEFAULT,
      evening_prayer_tts2: sched.evening_prayer.tts2       || EVENING_PRAYER_TTS2_DEFAULT,
      evening_closing_tts: sched.evening_prayer.closingTts || EVENING_CLOSING_TTS_DEFAULT,
    },
  }

  const TABS = ["morning", "exercise", "lunch", "dinner", "evening_prayer"]

  // 커스텀 음원·영상 단계는 카테고리가 아니라 **audio_files의 id 목록**(playlist)으로 파일을
  // 고른다(runCustomExtraStep → flowRunner). 그 길이를 안 넘기면 추정이 곡마다 상한 180초로
  // 뭉개서, 4곡짜리 재생목록이 3분으로 나온다. 다섯 탭의 id를 모아 **한 번에** 조회한다 —
  // 단계마다 쿼리를 돌면 요청 하나가 수십 건이 된다.
  const playlistIds = new Set()
  for (const tab of TABS) {
    for (const st of sched[tab].steps || []) {
      if (st.customType !== "audio" && st.customType !== "video_file") continue
      const ids = Array.isArray(st.playlist) && st.playlist.length
        ? st.playlist
        : (st.audio_file_id ? [st.audio_file_id] : [])
      for (const id of ids) playlistIds.add(Number(id))
    }
  }
  const durationById = new Map()
  if (playlistIds.size) {
    const ids = [...playlistIds].filter(Number.isFinite)
    const rows = db.prepare(
      `SELECT id, duration FROM audio_files WHERE id IN (${ids.map(() => "?").join(",")})`
    ).all(...ids)
    for (const row of rows) durationById.set(row.id, { exists: true, duration: row.duration })
  }

  const out = {}
  for (const tab of TABS) {
    const steps = sched[tab].steps || []
    const audioFiles = {}
    for (const s of steps) {
      const f = fileFor(s)
      if (f !== undefined) audioFiles[s.id] = f
      if (s.customType !== "audio" && s.customType !== "video_file") continue
      const ids = Array.isArray(s.playlist) && s.playlist.length
        ? s.playlist
        : (s.audio_file_id ? [s.audio_file_id] : [])
      // 지워진 파일은 실행부가 `if (!file) continue`로 건너뛴다 — 없음으로 넘겨야 0초가 된다.
      for (const id of ids) audioFiles[id] = durationById.get(Number(id)) ?? { exists: false }
    }
    const r = estimateBroadcastDuration(steps, {
      tab, lane: 'auto', ttsRate, texts: TEXT_OF[tab] || {}, audioFiles,
      today: todayStr(),   // 투약 안내의 종료일이 지났으면 그 단계는 안 나간다
    })
    out[tab] = {
      ...r,
      startTime: sched[tab].time,
      end: estimateEndTime(sched[tab].time, r.totalMs),
    }
  }
  return out
}

// ── 자동순서가 **무엇을 쓰고 있나** ─────────────────────────────────────────
//
// 왜 필요한가(설계 §4-C, 사용자 결정 2026-09-13): 폴더를 지우려는데 자동순서의 어느 단계가
// 그것을 가리키고 있으면 **막아야 한다.** 안 막으면 그 단계는 다음 방송에서 조용히
// 건너뛰어지고, 사람은 왜 안 나가는지 모른다.
//
// **화면만 막으면 API 로 우회된다** — 그래서 서버가 판정하고, 화면은 그 결과를 그린다.
//
// 돌려주는 것 셋:
//   folders    — 폴더 id → 그 폴더를 명시적으로 연결한 단계들
//   files      — 파일 id → 그 파일을 연결한 단계들
//   categories — 카테고리 → 그 갈래를 쓰는 단계들(**기본 연결 포함**). 업로드 화면의
//                「N곳에서 씀」이 읽는 값이다.
//
// 꺼 놓은 방송·단계도 **센다.** 지금 안 나갈 뿐 설정은 그것을 가리키고 있어서,
// 지웠다가 나중에 켜면 그때 조용히 비어 버린다.
function readSourceUsage(db) {
  const { resolveStepSource } = require('./stepSource')
  const sched = buildBroadcastSchedule(db)
  const folders = new Map(), files = new Map(), categories = new Map()
  const 담기 = (map, key, 값) => {
    if (key === null || key === undefined) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(값)
  }

  for (const tab of AUTO_TABS) {
    const b = sched[tab]
    if (!b) continue
    const steps = b.steps || []
    steps.forEach((st, i) => {
      const 연결 = resolveStepSource(db, st)
      if (연결.kind === 'none') return
      const 자리 = {
        tab, broadcast: b.name, time: b.time, broadcastEnabled: !!b.enabled,
        stepId: st.id, stepLabel: st.label || st.id, stepNo: i + 1,
        stepEnabled: st.enabled !== false,
        // 기본값이라 아직 저장 안 된 연결인지 — 화면이 문구를 가르는 근거
        origin: 연결.origin,
      }
      if (연결.kind === 'folder') {
        담기(categories, 연결.category, 자리)
        // 폴더를 콕 집어 연결한 것만 폴더 쓰임이다. 카테고리 전체(기본값)는 폴더를 안 가리킨다.
        if (연결.folderId != null) 담기(folders, 연결.folderId, 자리)
      } else if (연결.kind === 'file') {
        담기(files, 연결.audioFileId, 자리)
        if (연결.category) 담기(categories, 연결.category, 자리)
      }
    })
  }
  return { folders, files, categories }
}

/**
 * **사람이 만든 BGM 폴더를 어디서 쓰나** (2026-09-22) — 폴더 삭제를 막고 「어디서 쓰는지」 이름을 대려고.
 * 세 곳을 본다: 예약(`schedules.bgm_type`) · 흐름 단계(`config.bgm_type`·`playlist[]`) ·
 * 자동방송 단계(`bgmFolderId`·커스텀 BGM 단계의 `bgm_type`·`playlist[]`). 저장값 규칙은 domain/bgmRoles.폴더값.
 * 꺼 둔 예약·방송도 센다 — 다시 켜는 순간 그 폴더를 찾는다.
 * **단 예약은 BGM 을 실제로 까는 것만**(BGM 켬, 또는 배경음악 방송) — BGM 을 끈 예약은 화면에서 고르개가 숨어
 * 폴더를 바꿀 길이 없는데 삭제만 막혔다(코드 검수 Medium 2026-09-22). 다시 켜면 방송 때 대신 틀기+경보가 받는다.
 * @returns {Map<number, string[]>} 폴더 번호 → 사람이 읽을 자리 이름들
 */
function readBgmFolderUsage(db) {
  const { 폴더값 } = require('./bgmRoles')
  const 쓰임 = new Map()
  const 담기 = (id, 자리) => {
    if (!id) return
    if (!쓰임.has(id)) 쓰임.set(id, [])
    const 목록 = 쓰임.get(id)
    if (!목록.includes(자리)) 목록.push(자리)
  }
  // 한 설정(단계·흐름 config·재생목록 한 곡)이 가리키는 폴더 번호들
  const 번호들 = (c) => {
    if (!c || typeof c !== 'object') return []
    const out = []
    const 한곡 = 폴더값(c.bgm_type)
    if (한곡) out.push(한곡.folderId)
    if (Array.isArray(c.playlist)) for (const it of c.playlist) { const p = 폴더값(it?.bgm_type); if (p) out.push(p.folderId) }
    return out
  }

  for (const r of db.prepare("SELECT title, scheduled_time, bgm_type FROM schedules WHERE bgm_type LIKE 'local\\_f%' ESCAPE '\\' AND (bgm_enabled = 1 OR broadcast_type = 'bgm')").all()) {
    const p = 폴더값(r.bgm_type)
    if (p) 담기(p.folderId, `예약 「${r.title || '제목 없음'}」${r.scheduled_time ? ` (${String(r.scheduled_time).slice(0, 16)})` : ''}`)
  }
  for (const r of db.prepare(`SELECT s.label, s.config, f.name AS flow FROM flow_sequence_steps s
                              JOIN flow_sequences f ON f.id = s.flow_sequence_id`).all()) {
    let c; try { c = JSON.parse(r.config || '{}') } catch { continue }
    for (const id of 번호들(c)) 담기(id, `흐름 「${r.flow}」${r.label ? ` › ${r.label}` : ''}`)
  }
  const sched = buildBroadcastSchedule(db)
  for (const tab of AUTO_TABS) {
    const b = sched[tab]
    if (!b) continue
    ;(b.steps || []).forEach((st, i) => {
      const 자리 = `자동방송 「${b.name}」 ${i + 1}단계${st.label ? ` ${st.label}` : ''}`
      const 지정 = parseInt(st?.bgmFolderId, 10)
      if (지정 > 0) 담기(지정, 자리)
      for (const id of 번호들(st)) 담기(id, 자리)
    })
  }
  return 쓰임
}

module.exports = { buildBroadcastSchedule, readBgmUsage, buildBroadcastEstimate, readSourceUsage, readBgmFolderUsage }
