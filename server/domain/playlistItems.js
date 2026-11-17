// 재생목록 항목 하나를 어떻게 읽을 것인가 — 서버(재생) 쪽 규칙.
//
// 재생목록은 오래 `[3, 7, 12]`(audio_files의 id 배열)이었다. 배속·소리는 **단계**에 하나씩만
// 붙어서, 한 단계에 영상 셋을 담으면 셋 다 같은 배속으로 나갔다.
//
// 항목을 `{ id, rate, volume }` 객체로도 쓸 수 있게 넓힌다. **DB 표는 안 건드린다** —
// 재생목록은 원래 단계 설정 안에 JSON으로 들어 있어서, 담기는 모양만 넓히면 된다.
// 옛 저장분(숫자 배열)은 그대로 읽히고, 값이 없는 항목은 단계 설정을 따른다.
//
// 화면 쪽에도 같은 규칙이 필요하다(src/lib/playlistItems.js). 서버는 src/를 참조하지
// 않는 구조라 각자 두고, server/test/playlist-per-item.test.js가 **둘이 같은 답을 내는지**
// 대조한다.
'use strict'

/**
 * 재생목록을 `{ id, rate, volume }` 배열로 편다. 값이 없으면 null이다
 * (undefined로 두면 호출부마다 `?? null`을 적게 되고 하나를 빠뜨리면 undefined가 샌다).
 */
function normalizePlaylistItems(playlist) {
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
 * 이 항목을 실제로 어떤 소리·배속으로 틀 것인가.
 * 항목 값이 이기고, 없으면 단계 값을 따른다.
 *
 * **`??`를 쓴다.** 볼륨 0은 "설정 안 함"이 아니라 **명시적 무음**이다 —
 * `||`로 쓰면 무음으로 두려던 영상이 소리를 낸다.
 */
function resolvePlaylistItem(item, step = {}) {
  return {
    id:     item.id,
    volume: item.volume ?? step.volume ?? null,
    rate:   item.rate   ?? step.rate   ?? null,
  }
}

module.exports = { normalizePlaylistItems, resolvePlaylistItem }
