// 재생목록 항목 하나를 어떻게 읽을 것인가 — 화면(편집) 쪽 규칙.
//
// 서버 쪽 짝은 server/domain/playlistItems.js다. 서버는 src/를 참조하지 않는 구조라
// 각자 두고, server/test/playlist-per-item.test.js가 **둘이 같은 답을 내는지** 대조한다.
// (규칙이 갈리면 편집 화면에 보이는 것과 실제로 나가는 소리가 달라진다.)
//
// 항목은 두 가지 모양을 다 받는다:
//   `3`                       — 옛 저장분. 배속·소리는 단계 설정을 따른다
//   `{ id: 3, rate: 0.75 }`   — 이 영상만 따로

/** 재생목록을 `{ id, rate, volume }` 배열로 편다. 값이 없으면 null. */
export function normalizePlaylistItems(playlist) {
  if (!Array.isArray(playlist)) return []
  const out = []
  for (const entry of playlist) {
    if (entry === null || entry === undefined || entry === '') continue
    if (typeof entry === 'object') {
      const id = entry.id ?? entry.audio_file_id
      if (id === null || id === undefined || id === '') continue
      out.push({ id, rate: entry.rate ?? null, volume: entry.volume ?? null })
    } else {
      out.push({ id: entry, rate: null, volume: null })
    }
  }
  return out
}

/**
 * 저장할 모양으로 되돌린다. **값이 하나도 없는 항목은 다시 숫자로 적는다** —
 * 손대지 않은 재생목록이 `[3,7]`에서 `[{id:3,...},{id:7,...}]`로 바뀌면
 * 실제로 달라진 것이 없는데도 저장분이 통째로 바뀌어, 나중에 무엇을 고쳤는지 못 읽는다.
 */
export function denormalizePlaylistItems(items) {
  return items.map(it =>
    (it.rate === null || it.rate === undefined) && (it.volume === null || it.volume === undefined)
      ? it.id
      : { id: it.id, ...(it.rate != null ? { rate: it.rate } : {}), ...(it.volume != null ? { volume: it.volume } : {}) })
}

/** 선택된 id 목록이 바뀌었을 때, 남아 있는 항목의 개별 설정을 지키면서 새 순서로 맞춘다. */
export function reconcilePlaylist(playlist, nextIds) {
  const byId = new Map(normalizePlaylistItems(playlist).map(it => [String(it.id), it]))
  return denormalizePlaylistItems(
    nextIds.map(id => byId.get(String(id)) ?? { id, rate: null, volume: null }))
}
