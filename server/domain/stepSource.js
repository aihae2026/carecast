// "이 단계는 **무엇에** 연결돼 있나" — 연결 해석의 **단일 출처**.
//
// 배경(설계 `docs/audit/design-upload-flow.md` §2-C): 지금까지 단계가 파일을 가리키는 방식이
// 둘이었다 — 고정 단계는 **실행부 switch 에 박힌 카테고리 문자열**, 커스텀 단계는
// `step.audio_file_id`/`step.playlist`. 사람이 고를 수 있는 자리가 없었고, 새 시설은
// 쓰지도 않을 카테고리 열두 칸을 받아 들었다.
//
// 이제 단계 객체의 `source` 키 하나가 **네 상태**를 다 말한다:
//
//   ① 키가 없다            → 저장한 적 없음. 아래 기본표대로 간다(지금 동작 그대로).
//   ② { kind:'folder' … }  → 그 폴더(또는 카테고리 전체)에서 규칙대로 고른다.
//   ③ { kind:'file' … }    → 그 파일 하나.
//   ④ null                 → **사람이 일부러 끊었다.** 건너뛴다. 기본값이 다시 붙지 않는다.
//
// ②와 ④를 가르는 것이 이 설계의 핵심이다. `null` 과 "키 없음"은 다른 뜻이고,
// 둘 다 JSON 왕복과 `mergeStepsWithDefaults`(spread)를 그대로 통과한다.
//
// **기본표는 실행부 switch 의 값을 그대로 옮긴 것이다.** 옮긴 것이 맞는지는
// `server/test/auto-broadcast-regression.test.js` 가 **고치기 전에 떠 둔 기준선**
// (`helpers/auto-broadcast-baseline.json`)과 대조해서 지킨다 — 표를 손으로 고치면
// 그 시험이 빨간불이 된다.
'use strict'

// 단계 id → 기본 연결. `media` 는 그 자리에 들어갈 수 있는 파일 종류다(서버 검증에 쓴다).
//
// **`dinner_prayer_audio` 는 지금 실행부 switch 에 없다**(기준선 실측 2026-09-13 —
// 뜬 단계 10개에 안 들어 있었다). 그런데 예상시간표(`broadcastEstimate.STEP_AUDIO_CATEGORY`)와
// 편집기 화면(`morningEditorConst.js:20`)에는 있다. 지우면 그 둘의 동작이 바뀌므로 **남긴다.**
const STEP_DEFAULT_SOURCE = {
  morning_prayer:        { category: 'morning-prayer',  media: 'audio' },
  lunch_prayer_audio:    { category: 'lunch-prayer',    media: 'audio' },
  dinner_prayer_audio:   { category: 'dinner-prayer',   media: 'audio' },
  evening_prayer_audio:  { category: 'dinner-prayer',   media: 'audio' },
  breakfast_prayer_tts:  { category: 'breakfast-grace', media: 'audio' },
  lunch_prayer_tts:      { category: 'lunch-grace',     media: 'audio' },
  dinner_prayer_tts:     { category: 'dinner-grace',    media: 'audio' },
  // TV 싱크 보정은 **단계에 안 붙는다**(2026-09-16). 보정값이 하나뿐이라 고를 것이 없다 —
  // 자세한 이유는 `domain/videoSync` 머리말. 이 표는 이제 폴더·매체만 정한다.
  // 화면이 `category === 'exercise-video'` 로 갈라 쓰던 두 값이 각각 'A'·'B' 다.
  exercise_video:        { category: 'exercise-video',  media: 'video' },
  lunch_video:           { category: 'lunch-video',     media: 'video' },
  dinner_video:          { category: 'dinner-video',    media: 'video' },
  // 방송 뒤 소리 없이 띄우는 배경 영상 셋(2026-09-21). 예전엔 외부 서비스의 계절 영상 검색이었다 — 그 연동을
  // 걷어내며 이 PC 의 「배경 영상」에서 고르게 바꿨다(사용자 결정). 차례는 단계의 mediaOrder(기본 랜덤).
  morning_video:         { category: 'scene-video',     media: 'video' },
  lunch_video_after:     { category: 'scene-video',     media: 'video' },
  dinner_video_after:    { category: 'scene-video',     media: 'video' },
  // evening_closing_audio 는 **조건부**라 표로 못 적는다 — 아래 `저녁마침카테고리()`.
  evening_closing_audio: { category: null, media: 'audio', conditional: 'eveningClosing' },
}

// 저녁 마무리 음원의 폴백. `broadcastSequencer.js:747-751` 의 규칙을 **그대로** 옮겼다:
// evening-prayer 에 파일이 하나도 없으면 dinner-prayer(저녁 첫 안내 음원)를 대신 쓴다.
// **규칙을 바꾸지 않는다** — 여기 손대면 저녁 방송이 조용히 달라진다.
function 저녁마침카테고리(db) {
  const c = db.prepare('SELECT COUNT(*) as c FROM audio_files WHERE category = ?').get('evening-prayer')
  return (c?.c > 0) ? 'evening-prayer' : 'dinner-prayer'
}

/** 이 단계가 기본으로 쓰는 카테고리(없으면 null). 조건부 단계는 db 를 봐야 한다. */
function defaultCategoryFor(db, stepId) {
  const 칸 = STEP_DEFAULT_SOURCE[stepId]
  if (!칸) return null
  if (칸.conditional === 'eveningClosing') return 저녁마침카테고리(db)
  return 칸.category
}

/** 이 단계 자리에 들어갈 수 있는 파일 종류('audio' | 'video' | null). */
function defaultMediaFor(stepId, step = null) {
  const 칸 = STEP_DEFAULT_SOURCE[stepId]
  if (칸) return 칸.media
  // 커스텀 단계는 customType 이 말해 준다.
  const t = step?.customType
  if (t === 'video' || t === 'video_file') return 'video'
  if (t === 'audio') return 'audio'
  return null
}

const 없음 = (origin, error = null) => ({
  kind: 'none', origin, category: null, folderId: null, audioFileId: null,
  playlist: null, media: null, error,
})

/**
 * 이 단계가 실제로 가리키는 것.
 *
 * 갈래는 다섯이고 **순서가 곧 우선순위**다(설계 §2-C):
 *   1. `source` 키가 있고 `null`      → 해제. 건너뛴다.            ← 기본값 안 붙음
 *   2. `source` 키가 있고 객체         → 그것(검증해서 쓴다)
 *   3. `audio_file_id` / `playlist`   → 파일. 기존 커스텀 단계 그대로
 *   4. 기본표                         → 폴더(=카테고리 전체). 읽을 때만 붙는다
 *   5. 아무것도 없음                   → 건너뛴다
 *
 * **DB 에 아무것도 쓰지 않는다.** 읽기 전용이다.
 *
 * @param {object} db   node:sqlite DatabaseSync
 * @param {object} step 단계 객체(`id` 를 담고 있어야 한다)
 * @returns {{kind:'folder'|'file'|'none', origin:string, category:?string, folderId:?number,
 *            audioFileId:?number, playlist:?number[], media:?string, error:?object}}
 */
function resolveStepSource(db, step) {
  if (!step) return 없음('unset')
  const stepId = String(step.id || '')
  const media  = defaultMediaFor(stepId, step)

  // ① · ② — 사람이 저장한 값이 **가장 세다**
  if (Object.prototype.hasOwnProperty.call(step, 'source')) {
    if (step.source === null) return { ...없음('saved'), media }   // 해제
    if (typeof step.source === 'object') {
      const v = validateSource(db, step.source, { media })
      if (v.error) return { ...없음('saved'), media, error: v.error }
      return { ...v.source, origin: 'saved', media }
    }
    // 문자열·숫자 따위가 들어와 있으면 **기본값으로 돌아가지 않는다** — 조용한 폴백은
    // "연결했다고 믿는데 다른 것이 나가는" 실패를 만든다(설계 §4-B).
    return { ...없음('saved'), media, error: { code: 'BAD_SOURCE', message: '연결 정보 형식이 올바르지 않습니다.' } }
  }

  // ③ 기존 커스텀 단계 — 파일 id 를 직접 들고 있다
  const 목록 = Array.isArray(step.playlist) && step.playlist.length
    ? step.playlist.map(Number).filter(Number.isFinite) : null
  if (목록?.length) {
    return { kind: 'file', origin: 'legacy', category: null, folderId: null,
      audioFileId: 목록[0], playlist: 목록, media, error: null }
  }
  if (step.audio_file_id) {
    return { kind: 'file', origin: 'legacy', category: null, folderId: null,
      audioFileId: Number(step.audio_file_id), playlist: null, media, error: null }
  }

  // ④ 기본표 — **읽을 때만** 붙는다. 저장되지 않는다.
  const cat = defaultCategoryFor(db, stepId)
  if (cat) {
    return { kind: 'folder', origin: 'default', category: cat, folderId: null,
      audioFileId: null, playlist: null, media, error: null }
  }

  // ⑤ 가리키는 것이 없다
  return { ...없음('unset'), media }
}

/**
 * 저장하려는(또는 저장돼 있는) `source` 객체가 말이 되는지 본다.
 *
 * **없어진 대상을 기본값으로 바꿔치지 않는다**(사용자 조건 3, 2026-09-13). 연결한 폴더나
 * 파일이 사라졌으면 그 단계는 **건너뛰고 연결 오류를 알린다** — 조용히 다른 소리가
 * 나가는 것이 요양원에서 가장 비싼 실패라서다.
 *
 * @param {object} db
 * @param {object} source 검사할 값
 * @param {{media?: string}} opts 이 자리에 들어갈 수 있는 종류
 * @returns {{source?: object, error?: {code: string, message: string}}}
 */
function validateSource(db, source, opts = {}) {
  const 오류 = (code, message) => ({ error: { code, message } })
  if (source === null) return { source: 없음('saved') }
  if (typeof source !== 'object' || Array.isArray(source)) {
    return 오류('BAD_SOURCE', '연결 정보 형식이 올바르지 않습니다.')
  }
  const kind = String(source.kind || '')
  if (kind !== 'folder' && kind !== 'file') {
    return 오류('BAD_KIND', `연결 종류가 올바르지 않습니다: ${source.kind ?? '(없음)'}`)
  }

  if (kind === 'file') {
    const id = Number(source.audioFileId)
    if (!Number.isFinite(id) || id <= 0) return 오류('BAD_FILE_ID', '파일 번호가 올바르지 않습니다.')
    const row = db.prepare('SELECT id, category FROM audio_files WHERE id = ?').get(id)
    if (!row) return 오류('FILE_GONE', '연결된 파일이 없습니다. 다시 골라 주세요.')
    const 종류맞음 = 미디어종류(row.category)
    if (opts.media && 종류맞음 && 종류맞음 !== opts.media) {
      return 오류('MEDIA_MISMATCH',
        opts.media === 'video' ? '이 단계에는 영상만 연결할 수 있습니다.' : '이 단계에는 음원만 연결할 수 있습니다.')
    }
    return { source: { kind: 'file', category: row.category, folderId: null,
      audioFileId: id, playlist: null, error: null } }
  }

  // kind === 'folder'
  const category = String(source.category || '')
  if (!category) return 오류('BAD_CATEGORY', '폴더가 속한 갈래가 없습니다.')
  const 종류 = 미디어종류(category)
  if (opts.media && 종류 && 종류 !== opts.media) {
    return 오류('MEDIA_MISMATCH',
      opts.media === 'video' ? '이 단계에는 영상 폴더만 연결할 수 있습니다.' : '이 단계에는 음원 폴더만 연결할 수 있습니다.')
  }
  let folderId = null
  if (source.folderId !== undefined && source.folderId !== null && source.folderId !== '') {
    folderId = Number(source.folderId)
    if (!Number.isFinite(folderId) || folderId <= 0) return 오류('BAD_FOLDER_ID', '폴더 번호가 올바르지 않습니다.')
    const row = db.prepare('SELECT id, category FROM content_folders WHERE id = ?').get(folderId)
    if (!row) return 오류('FOLDER_GONE', '연결된 폴더가 없습니다. 다시 골라 주세요.')
    if (row.category !== category) {
      return 오류('FOLDER_CATEGORY_MISMATCH', '폴더가 그 갈래에 없습니다.')
    }
  }
  return { source: { kind: 'folder', category, folderId, audioFileId: null, playlist: null, error: null } }
}

// 카테고리 이름으로 음원/영상을 가른다. `routes/audio.js` 의 `VIDEO_CATS` 와 같은 판정인데
// 그 파일은 라우트라 domain 에서 require 하지 않는다(route-wiring 규칙). 규칙이 단순해서
// (이름이 -video 로 끝난다) 베끼는 대신 **모양으로** 본다 — 새 영상 카테고리가 생겨도 따라온다.
function 미디어종류(category) {
  if (!category) return null
  return String(category).endsWith('-video') ? 'video' : 'audio'
}

/** 사람이 일부러 끊었나(기본값을 다시 붙이면 안 되는 상태인가). */
function isDisconnected(resolved) {
  return !!resolved && resolved.kind === 'none' && resolved.origin === 'saved'
}

module.exports = {
  STEP_DEFAULT_SOURCE, resolveStepSource, validateSource,
  defaultCategoryFor, defaultMediaFor, isDisconnected, 미디어종류,
}
