// 시설 상태 세 가지를 더미 데이터로 심는다 — **운영 DB 사본을 기다리지 않고** 검증하려고.
//
// 사용자 조건(2026-09-13): *"운영 DB 사본을 기다리지 말고 더미 데이터로 확인해 —
// 신규 시설(폴더·파일 0), 기존 카테고리만 있는 시설, 사용자 폴더가 섞인 시설."*
//
// 세 상태의 뜻:
//   new    — 오늘 처음 켠 시설. audio_files 0행, content_folders 0행, `*_steps` 설정 없음.
//            자동방송 다섯이 **파일을 하나도 못 찾는** 상태다(= 전부 건너뛴다).
//   legacy — 지금 운영 중인 현장. 시스템 카테고리에만 파일이 있고 사용자 폴더는 0개.
//            `*_steps` 는 편집기가 저장한 모양 그대로(=**`source` 키가 없다**).
//   mixed  — 사용자가 폴더를 만들어 쓰기 시작한 시설. 시스템 카테고리 + `misc-audio`·
//            `misc-video` 아래 폴더와 그 안의 파일이 함께 있다. 여기서도 `*_steps` 에는
//            `source` 키가 **없다** — 연결 기능을 쓰기 전 상태라야 "손대지 않은 기존
//            데이터"의 회귀 기준이 된다.
//
// **`source` 를 쓰는 시나리오는 여기 넣지 않는다.** 그것은 새 기능의 시험이고, 이 파일은
// **변경 전후가 같아야 하는 바탕**이다. 둘을 섞으면 "기존 동작 보존"을 증명하지 못한다.
'use strict'

const SITE_KINDS = ['new', 'legacy', 'mixed']

// 심는 순서가 곧 audio_files.id 순서다 — `pickCategoryFile` 이 재생목록이 없을 때
// `ORDER BY id` 로 고르므로, 이 순서를 바꾸면 "어느 파일이 나가나"가 바뀐다.
const LEGACY_FILES = [
  // [category, filename, original_name, duration]
  // original_name 은 auto-broadcast-baseline.json 의 기준 출력과 짝이다 — 바꿀 때는 두 파일을 함께
  // 바꾼다(한쪽만 바꾸면 회귀 시험이 깨진다).
  ['bgm',             'bgm1.mp3',      '식사 배경음악 1.mp3',      212],
  ['bgm',             'bgm2.mp3',      '식사 배경음악 2.mp3',      188],
  ['morning-prayer',  'mp_old.mp3',    '아침 음원 (예전).mp3',      141],
  ['morning-prayer',  'mp_new.mp3',    '아침 음원 (새로 녹음).mp3', 155],
  ['lunch-prayer',    'lp.mp3',        '점심 음원.mp3',        96],
  ['dinner-prayer',   'dp.mp3',        '저녁 첫 음원.mp3',        104],
  ['breakfast-grace', 'bg.mp3',        '아침 식사 전 음원.mp3',    41],
  ['lunch-grace',     'lg.mp3',        '점심 식사 전 음원.mp3',    38],
  ['staff',           'staff1.mp3',    '직원 안내.mp3',            30],
  ['exercise-video',  'ex.mp4',        '국민체조.mp4',             372],
  ['lunch-video',     'lv.mp4',        '식사전 체조 (점심).mp4',   301],
  ['dinner-video',    'dv.mp4',        '식사전 체조 (저녁).mp4',   298],
  // evening-prayer 는 **일부러 비워 둔다** — 저녁 마무리 마침 음원의 조건부 폴백
  // (evening-prayer 가 비면 dinner-prayer)이 실제로 걸리는지 보려고.
  // dinner-grace 도 비워 둔다 — 파일이 없으면 TTS 로 넘어가는 갈래가 살아 있는지 본다.
]

// 사용자가 만든 폴더와 그 안의 파일. 폴더는 `misc-audio`·`misc-video` 아래 산다.
const MIXED_FOLDERS = [
  // [category, name, parentName|null]
  ['misc-audio', '아침 음악',      null],
  ['misc-audio', '2026년',        '아침 음악'],   // 하위 폴더 — 삭제 규칙 확인용
  ['misc-audio', '행사 안내',      null],
  ['misc-video', '체조 영상 모음',  null],
]

const MIXED_FILES = [
  // [category, filename, original_name, duration, folderName|null]
  ['misc-audio', 'praise1.mp3', '아침 음악 1.mp3',   174, '아침 음악'],
  ['misc-audio', 'praise2.mp3', '아침 음악 2.mp3',   163, '2026년'],
  ['misc-audio', 'event1.mp3',  '어버이날 안내.mp3',  52,  '행사 안내'],
  ['misc-audio', 'loose.mp3',   '폴더 밖 음원.mp3',   61,  null],
  ['misc-video', 'gym1.mp4',    '실내 체조.mp4',     280, '체조 영상 모음'],
]

// 현장 실제 시각(PROJECT_PROFILE §6). 코드 기본값과 셋이 다르므로 **저장된 값**으로 심는다 —
// 기본값으로 심으면 "설정이 지워진 시설"을 시험하는 셈이 된다.
const SITE_TIMES = {
  morning_time:            '07:50',
  exercise_broadcast_time: '09:00',
  lunch_broadcast_time:    '11:10',
  dinner_broadcast_time:   '16:14',
  evening_prayer_time:     '18:00',
}

const TABS = ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']
const STEPS_KEY = { morning: 'morning_steps', exercise: 'exercise_steps', lunch: 'lunch_steps',
  dinner: 'dinner_steps', evening_prayer: 'evening_prayer_steps' }

// 편집기가 저장하는 모양을 흉내낸다 — 기본 단계에 **사람이 만질 법한 변경**만 얹는다.
// 순서 바꾸기·하나 끄기·볼륨·배속. `source` 는 넣지 않는다(위 머리말).
function 저장된단계(defaults) {
  const steps = defaults.map((d, i) => ({ ...d, order: i }))
  // 사람이 한 일 셋
  if (steps.length >= 3) {
    // ① 마지막 두 개의 순서를 바꾼다
    const a = steps[steps.length - 1], b = steps[steps.length - 2]
    const t = a.order; a.order = b.order; b.order = t
    // ② 가운데 하나를 끈다
    steps[Math.floor(steps.length / 2)].enabled = false
    // ③ 첫 단계에 볼륨을 박는다
    steps[0].volume = 62
  }
  return steps
}

function seedSite(db, kind, { DEFAULT_STEPS }) {
  if (!SITE_KINDS.includes(kind)) throw new Error(`알 수 없는 시설 상태: ${kind}`)

  const put = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(k, String(v))

  // 방송 시각·활성화는 세 상태 모두 같다 — 이것이 달라지면 비교가 시각 차이로 오염된다.
  for (const [k, v] of Object.entries(SITE_TIMES)) put(k, v)
  put('morning_enabled', 'true')
  put('exercise_broadcast_enabled', 'true')
  put('lunch_broadcast_enabled', 'true')
  put('dinner_broadcast_enabled', 'true')
  put('evening_prayer_enabled', 'true')

  if (kind === 'new') return { folderIds: {} }

  const insFile = db.prepare(
    `INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const 올린때 = '2026-01-02T03:04:05.000Z'
  for (const [cat, fn, orig, dur] of LEGACY_FILES) insFile.run(cat, fn, orig, dur, 올린때, null)

  // 영상 3종은 서버 기동 백필이 재생목록에 자동 등록한다(schema.js:312~). 여기서는 DB 를
  // 직접 심으므로 그 백필이 안 돌았다 — 실행부와 같은 상태를 만들려면 손으로 넣는다.
  const insPl = db.prepare(
    'INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, 1)'
  )
  for (const cat of ['exercise-video', 'lunch-video', 'dinner-video']) {
    const row = db.prepare('SELECT id FROM audio_files WHERE category = ? ORDER BY id').get(cat)
    if (row) insPl.run(cat, row.id, 0)
  }
  // 아침 방송 음원은 **재생목록이 이긴다**는 규칙이 실제로 걸리는지 보려고 두 번째 파일을 앞에 둔다.
  // (id 순이면 '예전' 이 나가고, 재생목록이 이기면 '새로 녹음' 이 나간다)
  {
    const rows = db.prepare("SELECT id FROM audio_files WHERE category = 'morning-prayer' ORDER BY id").all()
    if (rows.length === 2) { insPl.run('morning-prayer', rows[1].id, 0); insPl.run('morning-prayer', rows[0].id, 1) }
  }

  const folderIds = {}
  if (kind === 'mixed') {
    const insFolder = db.prepare(
      'INSERT INTO content_folders (category, parent_id, name, created_at) VALUES (?, ?, ?, ?)'
    )
    for (const [cat, name, parentName] of MIXED_FOLDERS) {
      const parentId = parentName ? folderIds[parentName] : null
      const r = insFolder.run(cat, parentId, name, 올린때)
      folderIds[name] = Number(r.lastInsertRowid)
    }
    for (const [cat, fn, orig, dur, folderName] of MIXED_FILES) {
      insFile.run(cat, fn, orig, dur, 올린때, folderName ? folderIds[folderName] : null)
    }
  }

  // 편집기가 저장해 둔 단계 설정 — legacy·mixed 모두 같다.
  for (const tab of TABS) put(STEPS_KEY[tab], JSON.stringify(저장된단계(DEFAULT_STEPS[tab] ?? [])))

  return { folderIds }
}

module.exports = { SITE_KINDS, seedSite, TABS, STEPS_KEY, SITE_TIMES, MIXED_FOLDERS, MIXED_FILES, LEGACY_FILES }
