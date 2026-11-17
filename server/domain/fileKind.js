'use strict'
// **올린 파일이 진짜 무엇인가** — 이름이 아니라 내용으로 가른다 (UX-06, 2026-09-11).
//
// 지금까지는 확장자만 봤다(`routes/audio.js` 의 `fileFilter`). 확장자는 **사람이 붙이는
// 이름표**라 틀릴 수 있고, 틀리면 조용히 지나간다 — `노래.mp3` 라는 이름의 영상 파일이
// 음원 칸에 들어앉으면 **방송 시각에 소리가 안 난다.** 업로드할 때는 아무 말이 없고,
// 어르신 앞에서 조용한 3분이 지나야 안다. 이 저장소에서 가장 비싼 실패의 모양이다.
//
// **매직 넘버만 본다.** 파일 앞머리 몇 바이트는 포맷이 규격으로 정해 둔 것이라, 이름과 달리
// 사람이 실수로 바꾸지 못한다. 디코딩은 하지 않는다 — 그건 재생기가 할 일이고, 여기서
// 하려 들면 외부 도구 의존이 생긴다(구조 단순성 원칙).
//
// **모르면 `null` 이다.** "아마 오디오겠지" 로 통과시키지 않는다 — 그 추측이 위 사고를 만든다.

/** 앞머리를 보는 데 필요한 바이트 수. 호출부가 이만큼만 읽으면 된다. */
const 머리크기 = 16

const 같나 = (buf, off, bytes) => bytes.every((b, i) => buf[off + i] === b)
const 글자 = (buf, off, s) => 같나(buf, off, [...s].map(c => c.charCodeAt(0)))

/**
 * @param {Buffer|Uint8Array} buf 파일 앞머리(최소 `머리크기` 바이트)
 * @returns {'audio'|'video'|null} 모르면 `null`
 */
function 파일종류(buf) {
  if (!buf || buf.length < 12) return null

  // ── 오디오 ────────────────────────────────────────────────
  // MP3 — ID3 태그가 앞에 붙거나, 없으면 프레임 동기(0xFF 0xEx/0xFx)로 시작한다.
  if (글자(buf, 0, 'ID3')) return 'audio'
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'audio'
  // WAV — RIFF....WAVE. 앞 4바이트가 RIFF 인 것은 AVI 도 같아서 8번째부터 봐야 갈린다.
  if (글자(buf, 0, 'RIFF') && 글자(buf, 8, 'WAVE')) return 'audio'

  // ── 영상 ──────────────────────────────────────────────────
  // MP4·MOV — 길이 4바이트 뒤에 'ftyp'. 브랜드(qt/isom/mp42…)는 안 가른다.
  if (글자(buf, 4, 'ftyp')) return 'video'
  // WebM·Matroska — EBML 머리
  if (같나(buf, 0, [0x1A, 0x45, 0xDF, 0xA3])) return 'video'
  // AVI — RIFF....AVI␠
  if (글자(buf, 0, 'RIFF') && 글자(buf, 8, 'AVI ')) return 'video'

  return null
}

/**
 * 이 카테고리에 이 내용을 받아도 되나.
 *
 * @returns {{ok: true} | {ok: false, 이유: string}}
 *
 * **모르는 내용은 안 받는다.** 여기서 통과시키면 확장자만 보던 때로 되돌아간다.
 * 다만 이유를 사람 말로 돌려준다 — "업로드 실패" 네 글자로는 아무도 못 고친다.
 */
function 받아도되나(원하는종류, buf) {
  const 실제 = 파일종류(buf)
  if (실제 === null) {
    return { ok: false, 이유: '파일 내용을 알아볼 수 없습니다. MP3·WAV(음원) 또는 MP4·WebM·MOV·AVI(영상)만 올릴 수 있습니다.' }
  }
  if (실제 !== 원하는종류) {
    const 말 = { audio: '음원', video: '영상' }
    return {
      ok: false,
      이유: `${말[원하는종류]} 칸인데 내용이 ${말[실제]} 파일입니다. 이름(확장자)이 아니라 내용으로 봤습니다 — 파일을 다시 확인해 주세요.`,
    }
  }
  return { ok: true }
}

module.exports = { 머리크기, 파일종류, 받아도되나 }
