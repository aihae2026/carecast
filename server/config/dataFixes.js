// ── 1회성 데이터 보정 모음 (부팅 시 1회) ─────────────────────────────────────
//
// 흐름 구성·설정값은 현장 PC의 DB에만 있어서 코드 배포로는 못 바꾼다. 그래서 자동 업데이트로
// 배포되는 이 코드가 부팅 때 한 번 값을 고친다. 원래는 server/index.js에 try/catch 블록으로
// 8개가 쌓여 있었는데(약 130줄, 그중 6개가 완전한 빈 catch) 두 가지가 문제였다(CC-039):
//
//   · **적용 여부를 기록하지 않아 매 부팅마다 다시 돌았다.** "1회성 보정"이라고 적혀 있지만
//     실제로는 영구 강제였다 — 현장에서 사람이 체조 시각을 08:40으로 되돌려도 재부팅하면
//     조용히 09:00으로 돌아간다. 무엇이 되돌렸는지 화면에는 아무 단서도 없다.
//   · 빈 catch라 실패해도 흔적이 없었다. 보정이 안 먹은 것과 애초에 대상이 없던 것을 구별할
//     방법이 없다.
//
// 규칙 셋:
//   1. 보정 하나 = 마커 하나(`datafix_*`). 마커가 있으면 건너뛴다.
//   2. 마커는 **성공한 뒤에만** 남긴다. 던지면 마커가 안 남아 다음 부팅에 재시도된다.
//   3. 하나가 던져도 나머지는 계속 돈다. 실패는 경고로 남긴다(조용히 넘어가지 않는다).
//
// `datafix_` 접두어는 scripts/make-site-baseline.cjs가 제외한다 — 현장 마커가 다른 PC의
// 기초값으로 옮겨가면 그 PC에서는 보정이 한 번도 안 돈다.
'use strict'

const { rawSetting } = require('../domain/settingsRead')

const { DINNER_TTS_DEFAULT } =
  require('../domain/broadcastDefaults')

const get = (db, k) => rawSetting(db, k) ?? null
const put = (db, k, v) => db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(k, v)

// 각 보정은 바꾼 내역을 문자열 배열로 돌려준다(빈 배열 = 대상 없음). 로그에 그대로 나간다.
const DATA_FIXES = [
  {
    key: 'datafix_uv_area_no_20260831',
    label: '자외선 지역코드',
    run() {
      // **공개판에서는 값을 비운 빈 보정이다**(2026-10-17). 원래는 처음 운영한 한 시설에 잘못 저장된
      // 자외선 지역코드(법정동 코드) 하나를 바른 코드로 고쳤다. 그 코드 쌍이 곧 시설 위치라 공개 트리에
      // 남길 수 없다. 그 시설은 2026-08-31 에 이 보정을 이미 마쳐 마커가 서 있어 다시 돌지 않고,
      // 새로 설치한 PC 에는 그 잘못된 값이 생길 길이 없다 — 그래서 실제 동작은 달라지지 않는다.
      // 마커 열쇠는 그대로 둔다(이미 선 마커와 짝이 맞아야 「안 돈 보정」으로 오해하지 않는다).
      return []
    },
  },
  {
    key: 'datafix_prayer_prefix_20260831',
    label: '식사 안내 문구',
    run() {
      // **빈 보정이다**(2026-10-17, 기본 문구 종교 중립화). 원래는 식사 전 문구가 정해진 첫 문장으로
      // 시작하지 않으면 기본값으로 되돌렸다. 기본 문구가 「식사 안내」로 바뀌었으니 그 검사를 그대로 두면
      // 새 설치 첫 부팅에서 문구를 공연히 덮고, 시설이 직접 쓴 문안도 첫 문장이 다르면 지워 버린다.
      // 처음 운영한 시설은 2026-08-31 에 이미 마쳐 마커가 서 있어 다시 돌지 않는다.
      // 마커 열쇠는 그대로 둔다(이미 선 마커와 짝이 맞아야 「안 돈 보정」으로 오해하지 않는다).
      return []
    },
  },
  {
    key: 'datafix_step_duration_20260831',
    label: '방송 단계 재생시간',
    run(db) {
      const changed = []
      // morning_video: durationMin 30 → 15
      const mRaw = get(db, 'morning_steps')
      if (mRaw) {
        const steps = JSON.parse(mRaw)
        let touched = false
        steps.forEach(s => { if (s.id === 'morning_video' && s.durationMin === 30) { s.durationMin = 15; touched = true } })
        if (touched) { put(db, 'morning_steps', JSON.stringify(steps)); changed.push('morning_video durationMin 30→15') }
      }
      // bgm_final: durationSec 0(무제한) → 20초
      const eRaw = get(db, 'evening_prayer_steps')
      if (eRaw) {
        const steps = JSON.parse(eRaw)
        let touched = false
        steps.forEach(s => { if (s.id === 'bgm_final' && (s.durationSec == null || s.durationSec === 0)) { s.durationSec = 20; touched = true } })
        if (touched) { put(db, 'evening_prayer_steps', JSON.stringify(steps)); changed.push('bgm_final durationSec 0→20') }
      }
      return changed
    },
  },
  {
    key: 'datafix_dinner_tts_20260831',
    label: '저녁 방송 문구',
    run(db) {
      // 개발 중 넣어 둔 "test"가 현장에 남아 있던 건. 값이 아예 없을 때도 기본값을 넣는다.
      const v = get(db, 'dinner_tts')
      if (v !== null && v !== 'test' && v !== '') return []
      put(db, 'dinner_tts', DINNER_TTS_DEFAULT)
      return [`dinner_tts: ${v === null ? '없음' : `"${v}"`} → 기본값`]
    },
  },
  {
    key: 'datafix_meal_video_duration_20260831',
    label: '식사 중 영상 길이',
    run(db) {
      const changed = []
      for (const key of ['lunch_steps', 'dinner_steps']) {
        const raw = get(db, key)
        if (!raw) continue
        const steps = JSON.parse(raw)
        let touched = false
        steps.forEach(s => {
          if ((s.id === 'lunch_video_after' || s.id === 'dinner_video_after') && (s.durationMin === 30 || s.durationMin === 15)) {
            s.durationMin = 10; touched = true
          }
        })
        if (touched) { put(db, key, JSON.stringify(steps)); changed.push(`${key}: 식사중 영상 durationMin → 10분`) }
      }
      return changed
    },
  },
  {
    key: 'datafix_video_delay_20260831',
    label: '영상 오디오 딜레이',
    run(db) {
      const changed = []
      for (const key of ['video_audio_delay_ms', 'video_audio_delay_exercise_ms', 'video_audio_delay_meal_ms']) {
        if (get(db, key) !== '500') continue
        put(db, key, '450')
        changed.push(`${key}: 500 → 450`)
      }
      return changed
    },
  },
  {
    // ── 보정값 셋을 하나로 (사용자 지시 2026-09-16) ────────────────────────
    // *"이거 영상 하나로 통일해줘, 어차피 동일하게 TV에서 수신받아서 약간씩 늦는거잖아"*
    //
    // **이 이관이 없으면 현장 소리가 그날로 어긋난다.** 현장 값이 이랬다(2026-09-16 사본):
    //   video_audio_delay_ms            1000   ← 아무도 안 읽던 묵은 값
    //   video_audio_delay_exercise_ms    400   ← 실제로 쓰이던 값
    //   video_audio_delay_meal_ms        400   ← 실제로 쓰이던 값
    // 합치기만 하고 값을 안 옮기면 **400 이 1000 으로 튄다** — 0.6초가 더 늦어지는데
    // 오류는 안 난다. 사람이 TV 앞에 서야만 안다.
    //
    // 그래서 **실제로 쓰이던 값**(exercise)을 하나뿐인 키로 옮긴다. 둘이 달랐다면
    // 그 사실을 로그로 남긴다 — 조용히 한쪽을 버리지 않는다.
    key: 'datafix_video_delay_merge_20260916',
    label: '영상 오디오 딜레이 — 셋을 하나로',
    run(db) {
      const changed = []
      const { 딜레이키 } = require('../domain/videoSync')
      const 체조 = get(db, 'video_audio_delay_exercise_ms')
      const 식사 = get(db, 'video_audio_delay_meal_ms')

      // 쓰이던 값이 아예 없으면 옮길 것이 없다 — 새 PC 다. 기본값(0)으로 시작한다.
      if (체조 === null && 식사 === null) return changed

      if (체조 !== null && 식사 !== null && 체조 !== 식사) {
        changed.push(`⚠ 체조(${체조}ms)와 식사전(${식사}ms)이 달랐다 — 체조 값을 쓴다`)
      }
      const 옮길값 = 체조 ?? 식사
      const 지금 = get(db, 딜레이키)
      if (지금 === 옮길값) return changed
      put(db, 딜레이키, String(옮길값))
      changed.push(`${딜레이키}: ${지금 ?? '(없음)'} → ${옮길값}`)
      return changed
    },
  },
  {
    key: 'datafix_meal_bgm_duration_20260831',
    label: '식사 전 체조 BGM 길이',
    run(db) {
      const changed = []
      for (const key of ['lunch_bgm_duration', 'dinner_bgm_duration']) {
        const v = get(db, key)
        if (v !== null && v !== '0' && v !== '10') continue
        put(db, key, '5')
        changed.push(`${key}: ${v ?? '없음'} → 5(분)`)
      }
      return changed
    },
  },
  {
    key: 'datafix_exercise_time_20260831',
    label: '체조 방송 시각',
    run(db) {
      const changed = []
      // **저녁 줄은 뺐다**(2026-09-18, T-33 · 사용자 결정). 원래 「16:15 이면 16:20 으로」였는데,
      // 현장은 그 뒤 사람 손으로 **16:15** 가 됐다(동요가 끝나는 자리에 맞춘 값 — PROJECT_PROFILE §6).
      // 즉 방향이 반대가 됐다. 현장은 이 보정의 마커가 2026-08-31 에 이미 서서 다시 안 돌지만,
      // **새로 설치하는 PC 는 마커가 없어** 갓 심은 16:15 를 곧바로 16:20 으로 되돌리고 있었다
      // (부팅 순서가 `initDB()` → `applyDataFixes()` 라 그렇다).
      // 체조 줄은 그대로 둔다 — 08:40 → 09:00 은 지금도 맞는 방향이다.
      const updates = [
        ['exercise_broadcast_time', '08:40', '09:00'],
      ]
      for (const [key, oldVal, newVal] of updates) {
        const v = get(db, key)
        if (v === null) { put(db, key, newVal); changed.push(`${key}: 없음 → ${newVal}`); continue }
        if (v !== oldVal) continue
        put(db, key, newVal)
        changed.push(`${key}: ${oldVal} → ${newVal}`)
      }
      return changed
    },
  },
  {
    key: 'datafix_tts_voice_unknown_20260921',
    label: '없는 TTS 목소리',
    run(db) {
      // 2026-09-18 제출판은 `tts_voice_morning` 기본값이 없는 목소리(ko-KR-GookMinNeural)였고,
      // 서버에 검사가 없어 그대로 저장됐다 → 아침 방송 NoAudioReceived(HTTP 500).
      // 저장 검사(routes/settings.js)는 **앞으로** 막을 뿐이라 이미 들어간 값은 여기서 고친다.
      // **조용히 고친다**(사용자 결정 2026-09-20): 아침 방송은 매일 정해진 시각에 나가고,
      // 관리자가 설정 화면을 열 때까지 기다리면 그 사이 아침이 통째로 빈다. 다만 흔적은
      // settings_history 에 남긴다 — 「왜 내가 고른 목소리가 바뀌었지」에 답할 수 있어야 한다.
      // 없는 키(null)는 그대로 둔다 — 읽는 쪽 기본값이 이미 실재하는 목소리다.
      const { 있는목소리인가, 기본목소리 } = require('../domain/ttsVoices')
      const history = require('../domain/settingsHistory')
      const changed = []
      for (const key of ['tts_voice_normal', 'tts_voice_morning', 'tts_voice_emergency']) {
        const v = get(db, key)
        if (v === null || 있는목소리인가(v)) continue
        put(db, key, 기본목소리)
        history.record(db, key, v, 기본목소리, '데이터 보정')
        changed.push(`${key}: ${v === '' ? '(빈 값)' : v} → ${기본목소리}`)
      }
      return changed
    },
  },
  {
    key: 'datafix_bgm_role_folders_20260921',
    label: '배경음악 용도 폴더(방송용·식사용)',
    run(db) {
      // 사용자 지시(2026-09-21): 배경음악을 방송용·식사용 폴더로 나눠 튼다(domain/bgmRoles.js).
      // 폴더 번호는 PC 마다 다르므로 각 PC 가 첫 부팅에 자기 폴더를 만들고 번호를 키에 적는다.
      //  · 같은 이름 폴더가 bgm 맨 위에 이미 있으면 그것을 쓴다 — 둘을 만들지 않는다
      //  · 키가 이미 살아 있는 폴더를 가리키면 건드리지 않는다
      //  · **폴더 밖(맨 위)에 있던 배경음악은 식사용으로 옮긴다.** 예전엔 로컬 배경음악이 전부
      //    식사 시간 자동 BGM(bgmScheduler)에만 쓰였다 — 안 옮기면 그 방송이 무음이 된다
      const { 역할들 } = require('../domain/bgmRoles')
      const changed = []
      const 지금 = new Date().toISOString()
      for (const r of 역할들) {
        const 적힌 = parseInt(get(db, r.폴더키) ?? '', 10)
        if (적힌 && db.prepare("SELECT 1 FROM content_folders WHERE id = ? AND category = 'bgm'").get(적힌)) continue
        let 폴더 = db.prepare("SELECT id FROM content_folders WHERE category = 'bgm' AND parent_id IS NULL AND name = ?").get(r.이름)
        if (!폴더) {
          const id = db.prepare("INSERT INTO content_folders (category, parent_id, name, created_at) VALUES ('bgm', NULL, ?, ?)")
            .run(r.이름, 지금).lastInsertRowid
          폴더 = { id: Number(id) }
          changed.push(`배경음악 폴더 「${r.이름}」 만듦(#${폴더.id})`)
        }
        put(db, r.폴더키, String(폴더.id))
        changed.push(`${r.폴더키} → #${폴더.id}`)
      }
      const 식사 = parseInt(get(db, 'bgm_folder_meal') ?? '', 10)
      if (식사) {
        const n = db.prepare("UPDATE audio_files SET folder_id = ? WHERE category = 'bgm' AND folder_id IS NULL").run(식사).changes
        if (n) changed.push(`폴더 밖 배경음악 ${n}곡을 「식사용 BGM」으로 옮김`)
      }

      // ── 예전에 로컬 BGM 을 쓰던 자동방송 단계는 **식사용으로 못박는다**(QA 재현 2026-09-21) ──
      // 예전 판에서 `bgmSource: 'local'|'auto'` 단계는 **bgm 재생목록 전체**를 틀었다. 위에서 그 곡들을
      // 식사용으로 옮겼으므로, 용도를 안 적은 단계가 새 기본(아침·체조=방송용)을 따르면 **빈 방송용
      // 폴더를 봐서 무음**이 된다. 그래서 그런 단계에만 `bgmRole: 'meal'` 을 적어 예전 곡이 그대로
      // 나가게 한다. 사람이 나중에 단계 편집기에서 방송용으로 바꾸면 된다(설정 기록에 남는다).
      const { writeSetting } = require('../domain/settingsRead')
      for (const 키 of ['morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps']) {
        let 단계들
        try { 단계들 = JSON.parse(get(db, 키) || 'null') } catch { continue }
        if (!Array.isArray(단계들)) continue
        let 바꾼수 = 0
        const 새것 = 단계들.map(s => {
          if (!s || typeof s !== 'object' || s.bgmRole) return s
          if (s.bgmSource !== 'local' && s.bgmSource !== 'auto') return s
          바꾼수 += 1
          return { ...s, bgmRole: 'meal' }
        })
        if (바꾼수) {
          writeSetting(db, 키, JSON.stringify(새것), '데이터 보정')
          changed.push(`${키}: 예전 로컬 BGM 단계 ${바꾼수}개를 「식사용 BGM」으로 지정(예전 곡이 그대로 나가게)`)
        }
      }

      // 사람이 만든 다른 bgm 폴더의 곡은 **옮기지 않는다**(정리해 둔 구조를 흩지 않는다). 대신
      // 어느 용도에도 안 들어가 안 나간다는 것을 로그에 남긴다 — 화면(음원 관리)도 같은 수를 보여 준다.
      const 밖 = require('../services/localBgm').용도현황(db).outsideCount
      if (밖) changed.push(`⚠ 용도 폴더 밖 배경음악 ${밖}곡은 방송에 안 나갑니다 — 음원 관리에서 방송용·식사용으로 옮겨 주세요`)
      return changed
    },
  },
  {
    key: 'datafix_youtube_removal_20260921',
    label: '외부 동영상 연동 데이터 정리(보관 뒤 삭제)',
    // 보관 → 고치기·지우기 → 표·칸 삭제. 순서와 이유는 그 파일 머리말.
    run: db => require('./youtubeRemovalFix').run(db),
  },
  {
    // ── BGM 길이를 단계 칸으로 (사용자 지시 2026-09-24) ─────────────────────
    // *"0은 끝까지 트는걸로 하되 디폴트는 15분으로"* · 이미 저장된 것은 *"지금 멈추는 시간을 칸에 옮겨 적기"*.
    //
    // 네 방송의 첫 BGM 은 칸이 0/없으면 숨은 설정 `<방송>_bgm_duration`(분)으로 멈췄다. 재생은 이제 칸만 보고
    // (0 = 끝까지, 칸이 없으면 기본 900초) — **이 이관이 없으면 현장 소리가 그날로 바뀐다.** 그래서 옛 재생 코드와
    // 같은 규칙으로 「지금 멈추는 시간」을 구해, 새 규칙의 결과와 **다를 때만** 칸에 적는다. 사람이 적은 칸(>0)은 안 건드린다.
    key: 'datafix_bgm_duration_to_step_20260924',
    label: 'BGM 길이 — 숨은 분 설정을 단계 칸으로',
    run(db) {
      const changed = []
      const 옛기본 = { morning: '0', exercise: '0', lunch: '15', dinner: '15' }   // 옛 broadcastSequencer 의 getSetting 기본값
      for (const tab of Object.keys(옛기본)) {
        const raw분 = get(db, `${tab}_bgm_duration`)
        const 옛초 = (parseInt(raw분 === null ? 옛기본[tab] : raw분) || 0) * 60
        const 저장 = get(db, `${tab}_steps`)
        // **저장된 단계가 없으면 쓰지 않는다**(검수 High). 새 PC 는 옮길 「지금 소리」가 없고 사용자가 정한 기본 15분이 맞다.
        // 여기서 `*_steps` 를 만들면 같은 부팅의 기초값 심기(「있는 키는 손대지 않는다」)가 그 방송 순서를 통째로 건너뛴다.
        // 대가: 저장된 단계 없이 분 설정만 바꿔 쓰던 PC 는 15분으로 바뀐다(편집 화면에서 한 번이라도 저장했으면 해당 없음).
        if (!저장) continue
        let steps
        try { steps = JSON.parse(저장) } catch { changed.push(`⚠ ${tab}_steps 가 깨져 있어 BGM 길이를 옮기지 못했다(그대로 둠 — 재생은 기본 단계의 15분)`); continue }
        if (!Array.isArray(steps)) { changed.push(`⚠ ${tab}_steps 가 목록이 아니라 그대로 둠`); continue }
        const bgm = steps.find(s => s && s.id === 'bgm')
        // 판정은 **재생과 같은 식**(broadcastSteps.js stepBGMStart: parseInt(step.durationSec) || 0) — Number 로 보면
        // 0.5·"30abc" 에서 옛·새 결과를 잘못 셌다(검수 Low).
        if (bgm && (parseInt(bgm.durationSec) || 0) > 0) continue            // 사람이 적은 칸 — 옛 재생도 이것을 먼저 썼다
        // 새 규칙의 결과: 칸이 **있으면**(0·null·'' 포함 — 병합 {...기본, ...저장} 이 그 값으로 덮는다) 재생식 그대로, 없으면 기본 900
        const 새초 = bgm && Object.prototype.hasOwnProperty.call(bgm, 'durationSec') ? (parseInt(bgm.durationSec) || 0) : 900
        if (새초 === 옛초) continue
        if (bgm) bgm.durationSec = 옛초
        else steps.push({ id: 'bgm', durationSec: 옛초 })   // 병합(mergeStepsWithDefaults)이 기본 단계 위에 이 칸만 얹는다
        put(db, `${tab}_steps`, JSON.stringify(steps))
        changed.push(`${tab} 첫 BGM 재생 시간: ${새초 === 900 ? '기본 15분' : 새초 + '초'} 대신 지금처럼 ${옛초 ? 옛초 / 60 + '분' : '끝까지'}(${옛초}초)로 적음`)
      }
      return changed
    },
  },
  {
    // ── 제미나이 모델 고정 풀기 (사용자 요청 2026-10-23) ──────────────────────
    // *"현장은 2.5 에서 고정이 되어 있어서 난감했었어, 자동으로 따라 가게끔"*.
    // 저장된 `gemini-X.Y-flash` 는 대부분 옛 설정 화면이 「저장」 때 기본값을 박아 생긴 우연한 값이다
    // (domain/geminiModel.js 머리말). 그 꼴만 'auto' 로 바꾸고 원래 값은 `gemini_model_before_auto` 에
    // 남긴다 — 화면에서 되돌릴 수 있다. pro·preview·lite 처럼 일부러 고른 이름은 건드리지 않는다.
    key: 'datafix_gemini_model_auto_20261023',
    label: 'Gemini 모델 — 고정값을 자동 선택으로',
    run(db) {
      const 지금 = get(db, 'gemini_model')
      if (지금 === null || !/^gemini-\d+(\.\d+)?-flash$/.test(String(지금).trim())) return []
      put(db, 'gemini_model_before_auto', String(지금).trim())
      put(db, 'gemini_model', 'auto')
      return [`gemini_model: ${지금} → auto (이전 값은 gemini_model_before_auto 에 보관 — 관리자 화면에서 되돌릴 수 있다)`]
    },
  },
]

/**
 * 아직 안 돈 보정만 실행하고 마커를 남긴다.
 * @param {object} db
 * @param {Array} fixes 테스트용 주입(기본값은 위 목록 전부)
 * @returns {string[]} 이번 부팅에서 실제로 바뀐 내역
 */
function applyDataFixes(db, fixes = DATA_FIXES) {
  const changed = []
  for (const fix of fixes) {
    try {
      if (get(db, fix.key) !== null) continue
      const result = fix.run(db) || []
      // 마커는 성공한 뒤에만. 바꾼 게 없어도(대상 없음) 마커는 남긴다 — 그 판정도 1회면 족하다.
      put(db, fix.key, new Date().toISOString())
      for (const line of result) {
        console.log(`[데이터 보정] ${line}`)
        changed.push(line)
      }
    } catch (e) {
      // 던지면 마커가 안 남아 다음 부팅에 다시 시도된다. 조용히 넘어가지 않는다.
      console.warn(`[데이터 보정] "${fix.label}" 실패(기동은 계속, 다음 부팅에 재시도):`, e.message)
    }
  }
  return changed
}

module.exports = { applyDataFixes, DATA_FIXES }
