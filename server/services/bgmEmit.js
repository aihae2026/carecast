// BGM 시작 신호를 내는 자리 — resolveBGM 이 푼 결과(이 PC 의 방송용·식사용 폴더 곡)를 낸다 (2026-09-21).
//
// 즉시방송(routes/tts.js)·홈 배경음방송(routes/audio.js /bgm/now)·흐름(flowRunner)·예약 BGM(scheduler)
// 네 곳이 이것을 쓴다. 신호를 내는 곳을 하나로 두어, 한 곳에만 eventId 를 빠뜨리거나 모양이 갈리는
// 일을 막는다.
//
// 모양은 받는 쪽(MusicPlayer.jsx)이 읽는 그대로다:
//   `bgm_start` { files, durationMin, durationSec, bgmDefault, eventId }
// `eventId` 는 같은 PC 에 탭이 여럿일 때 한 탭만 틀게 하는 번호다(받는 쪽 localStorage 표시).
'use strict'

const crypto = require('crypto')

/**
 * @param {object} resolved resolveBGM 의 결과(null 이 아니어야 한다)
 * @param {{durationMin?: number, durationSec?: number}} opts 얼마나 틀지. 0 은 무제한
 */
function emitBGM(resolved, { durationMin = 0, durationSec = 0 } = {}) {
  // 부르는 때마다 읽는다 — 시험이 신호를 가로채 보려고 바꿔 끼운 것도 그대로 따른다.
  const { broadcastSSE } = require('./sse')
  broadcastSSE('bgm_start', {
    files: resolved.files, durationMin, durationSec, bgmDefault: resolved.bgmDefault,
    eventId: crypto.randomBytes(4).toString('hex'),
  })
}

module.exports = { emitBGM }
