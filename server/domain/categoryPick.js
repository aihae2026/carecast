// "이 자리에서 지금 나가는 파일은 무엇인가" — **단일 출처**.
//
// 왜 필요했나(2026-09-04): 같은 판정이 세 곳에 복사돼 있었고 서로 달랐다.
//   · 실행부  `broadcastSteps.js` — 음원은 `ORDER BY id` 첫 번째, 영상은 재생목록 활성 첫 번째
//   · 예상시간 `routes/settings.js` — 위를 그대로 베껴 쓰고, 어긋나지 말라고 주석까지 달아 뒀다
//   · 화면    `musicManagementConst.js` referenceBadge — "무작위 후보로 사용"이라 **틀리게** 적었다
// 화면은 목록을 `uploaded_at DESC`로 보여주는데 실행부는 `id` 순 첫 번째를 튼다. 즉 **맨 위
// 카드와 실제 나가는 파일이 정반대**였다. 안내 음원을 새로 올려 바꾼 줄 알았는데 예전 것이
// 계속 나갔다 — 사람이 바꿨다고 믿는데 안 바뀌는, 가장 찾기 어려운 실패다.
//
// 이제 실행부·예상시간·화면이 전부 이 함수 하나를 본다.
'use strict'

/**
 * 이 카테고리에서 trackIndex번째로 나갈 파일.
 *
 * 재생목록(audio_playlist)에 이 카테고리 행이 있으면 **그 순서가 이긴다**. 없으면 예전처럼
 * 올린 순서(id)다 — 재생목록 행이 하나도 없는 기존 현장은 동작이 그대로다.
 *
 * BGM에는 쓰지 않는다. BGM은 활성 항목을 **전부** 순서대로 틀기 때문이다(bgmScheduler.js).
 *
 * @returns {object|undefined} audio_files 행. 없으면 undefined
 */
function pickCategoryFile(db, category, trackIndex = 0) {
  return categoryCandidates(db, category)[trackIndex]
}

// 이 카테고리에서 나갈 수 있는 파일 전부, 나가는 순서대로. 위 규칙(재생목록이 이기고, 없으면
// 올린 순서)을 **목록째** 돌려준다 — 한 개를 고르는 것(pick…)과 차례로·랜덤으로 고르는 것
// (pickSourceFileByOrder)이 같은 목록을 보게 하려는 것이다(2026-09-21).
function categoryCandidates(db, category) {
  const fromPlaylist = db.prepare(`
    SELECT af.* FROM audio_playlist ap
    JOIN audio_files af ON af.id = ap.audio_file_id
    WHERE ap.category = ? AND ap.active = 1
    ORDER BY ap.sort_order
  `).all(category)
  if (fromPlaylist.length) return fromPlaylist
  return db.prepare('SELECT * FROM audio_files WHERE category = ? ORDER BY id').all(category)
}

/**
 * 해석된 연결(`domain/stepSource.resolveStepSource`)에서 trackIndex번째로 나갈 파일.
 *
 * 위 `pickCategoryFile` 의 **확장**이지 대체가 아니다. 갈래는 셋뿐이다:
 *
 *   · kind 'none'                → 없음(건너뛴다). 해제든 오류든 **기본값으로 안 돌아간다**
 *   · kind 'folder', folderId 없음 → `pickCategoryFile` 에 **그대로 위임**
 *   · kind 'folder', folderId 있음 → 같은 규칙을 그 폴더 안으로 좁힌 것
 *   · kind 'file'                 → 그 파일 하나
 *
 * **두 번째 갈래가 회귀의 핵심이다.** 기존 다섯 방송은 전부 여기로 떨어지고, 위임이라
 * 질의가 같은 것이 아니라 **같은 함수**다 — 베낀 것이 아니라서 어긋날 수가 없다.
 *
 * 폴더 안에서도 순서 규칙은 같다: 재생목록(audio_playlist)이 이기고, 없으면 올린 순서(id).
 * 사용자 조건(2026-09-13) *"기존 폴더 파일 선택 순서를 유지하라"* 가 이 줄이다.
 */
function pickSourceFile(db, resolved, trackIndex = 0) {
  if (!resolved || resolved.kind === 'none') return undefined

  if (resolved.kind === 'file') {
    // 커스텀 단계가 재생목록(id 배열)을 들고 있으면 그 순서가 곧 순서다.
    const ids = Array.isArray(resolved.playlist) && resolved.playlist.length
      ? resolved.playlist : (resolved.audioFileId ? [resolved.audioFileId] : [])
    const id = ids[trackIndex]
    if (!id) return undefined
    return db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
  }

  return sourceCandidates(db, resolved)[trackIndex]
}

// 연결이 가리키는 파일 전부, 나가는 순서대로(폴더 갈래). 규칙은 위 pickSourceFile 과 같다.
function sourceCandidates(db, resolved) {
  if (!resolved || resolved.kind === 'none') return []
  if (resolved.kind === 'file') {
    const ids = Array.isArray(resolved.playlist) && resolved.playlist.length
      ? resolved.playlist : (resolved.audioFileId ? [resolved.audioFileId] : [])
    const get = db.prepare('SELECT * FROM audio_files WHERE id = ?')
    return ids.map(id => get.get(id)).filter(Boolean)
  }
  if (resolved.folderId == null) return categoryCandidates(db, resolved.category)

  const fromPlaylist = db.prepare(`
    SELECT af.* FROM audio_playlist ap
    JOIN audio_files af ON af.id = ap.audio_file_id
    WHERE ap.category = ? AND ap.active = 1 AND af.folder_id = ?
    ORDER BY ap.sort_order
  `).all(resolved.category, resolved.folderId)
  if (fromPlaylist.length) return fromPlaylist
  return db.prepare('SELECT * FROM audio_files WHERE category = ? AND folder_id = ? ORDER BY id')
    .all(resolved.category, resolved.folderId)
}

/**
 * 연결이 가리키는 파일들에서 **랜덤 또는 차례로** 하나 (2026-09-21, 영상 단계용).
 *
 * *"영상도 마찬가지로 그렇게 돌릴 수 있도록"* — 배경음악의 방송용·식사용 폴더처럼, 영상 폴더에
 * 여러 개를 넣어 두고 방송마다 바꿔 튼다. 규칙은 배경음악과 같은 것을 쓴다(domain/bgmRoles 재생순서):
 * 랜덤은 섞은 첫 번째, 차례로는 틀 때마다 한 칸씩 밀린다. 차례 자리는 연결(카테고리·폴더)마다
 * 따로 적는다 — 한 칸을 나눠 쓰면 두 단계가 서로의 자리를 민다.
 */
function pickSourceFileByOrder(db, resolved, order) {
  const 목록 = sourceCandidates(db, resolved)
  if (!목록.length) return undefined
  const { 재생순서 } = require('./bgmRoles')
  if (order !== 'seq') return 재생순서(목록, 'random', 0).목록[0]
  const { rawSetting, writeSetting } = require('./settingsRead')
  const 키 = 영상차례키(resolved)
  const 시작 = parseInt(rawSetting(db, 키) ?? '0', 10) || 0
  const { 목록: 돌린것, 다음자리 } = 재생순서(목록, 'seq', 시작)
  writeSetting(db, 키, String(다음자리), '자동')
  return 돌린것[0]
}

// `media_seq_` 로 시작한다 — 틀 때마다 기계가 쓰는 값이라 설정 기록·기초값에서 뺀다.
const 영상차례키 = (resolved) => resolved.kind === 'file'
  ? `media_seq_file_${(resolved.playlist || [resolved.audioFileId]).join('-')}`
  : `media_seq_${resolved.category}_${resolved.folderId ?? 'root'}`

/** 이 카테고리에서 지금 나가는 파일의 id(없으면 null). 화면이 "← 나감"을 찍는 근거다. */
function primaryFileId(db, category) {
  return pickCategoryFile(db, category, 0)?.id ?? null
}

/**
 * 이 파일이 그 자리에서 나가게 만든다. 재생목록 맨 앞으로 올리고 활성으로 둔다.
 * 나머지 파일은 뒤로 밀릴 뿐 지워지지 않는다 — 되돌리려면 다른 것을 다시 올리면 된다.
 */
function makePrimary(db, category, audioFileId) {
  const 있는것 = db.prepare(
    'SELECT audio_file_id FROM audio_playlist WHERE category = ? AND active = 1 ORDER BY sort_order'
  ).all(category).map(r => r.audio_file_id)

  // 재생목록이 비어 있으면 지금까지의 순서(=올린 순서)를 그대로 옮겨 적고 시작한다.
  // 그래야 "맨 앞으로 올린다"가 나머지 순서를 뒤섞지 않는다.
  const 바탕 = 있는것.length
    ? 있는것
    : db.prepare('SELECT id FROM audio_files WHERE category = ? ORDER BY id').all(category).map(r => r.id)

  const 새순서 = [audioFileId, ...바탕.filter(id => id !== audioFileId)]

  db.prepare('DELETE FROM audio_playlist WHERE category = ?').run(category)
  const ins = db.prepare(
    'INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, 1)'
  )
  새순서.forEach((id, i) => ins.run(category, id, i))
  return 새순서.length
}

module.exports = { pickCategoryFile, pickSourceFile, pickSourceFileByOrder, sourceCandidates, primaryFileId, makePrimary }
