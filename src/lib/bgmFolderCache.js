// BGM 폴더 목록의 **지금 한 벌** — 아무것도 불러오지 않는 순수 모듈(2026-09-22).
//
// src/lib/bgmTypes.js 는 서버 시험이 node 로 바로 읽는다(bgmPreview 경유). 거기서 React·API 모듈을 부르면
// 시험이 못 뜬다. 그래서 목록은 여기 두고, 읽어 오는 일(bgmFolders.js)과 이름 찾기(bgmTypes.js)가 이것만 본다.
let 목록 = null

/** 지금 들고 있는 목록(아직 못 불러왔으면 null). */
export const bgmFoldersNow = () => 목록

let 곡들 = null
/** 배경음악 곡 목록(곡 하나 고르기, 2026-09-22) — 못 불러왔으면 null. */
export const bgmSongsNow = () => 곡들

/** bgmFolders.js 만 부른다. */
export function setBgmFoldersNow(folders, songs = null) {
  목록 = Array.isArray(folders) ? folders : null
  곡들 = Array.isArray(songs) ? songs : null
}
