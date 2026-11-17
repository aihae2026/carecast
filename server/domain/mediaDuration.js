'use strict'
// 음원·영상의 **재생시간을 받아 적는 규칙**의 단일 출처.
//
// 왜 갈라냈나: 업로드 라우트는 `duration` 을 늘 0 으로 넣는다(브라우저만 길이를 안다).
// 그것을 채우는 규칙이 `routes/morning.js` 안에만 있었는데, 그 자리는 "방송이 끝났다"
// 라우트다. 관리 화면이 길이를 채우려고 그 라우트를 부르면 **방송 종료 신호까지 같이
// 나간다.** 그래서 규칙만 여기로 내리고 라우트를 따로 냈다(`routes/audio.js`).
//
// 규칙 자체는 하나뿐이고, 그 하나가 중요하다 — **이미 값이 있으면 덮어쓰지 않는다.**
// 중간에 끊긴 재생이 진짜 길이를 3초 따위로 망치면, 다음 방송이 곡을 자르고 넘어간다
// (볼륨 시딩·site-baseline 과 같은 원칙).

/**
 * 화면이 실제로 잰 재생시간을 `audio_files.duration` 에 남긴다.
 * @returns {boolean} 실제로 쓴 경우에만 true (이미 값이 있거나 값이 이상하면 false)
 */
function recordMeasuredDuration(db, audioFileId, seconds) {
  const id = Number(audioFileId)
  const sec = Number(seconds)
  if (!id || !Number.isFinite(sec) || sec <= 0) return false
  // 말이 안 되는 길이는 안 받는다. 24시간이 넘는 음원은 이 시설에 없고, 그런 값이 들어오면
  // 흐름 계산이 통째로 망가진다(시퀀서가 그 시간만큼 기다린다).
  if (sec > 24 * 60 * 60) return false
  const r = db.prepare('UPDATE audio_files SET duration = ? WHERE id = ? AND (duration IS NULL OR duration <= 0)')
    .run(Math.round(sec), id)
  return r.changes > 0
}

module.exports = { recordMeasuredDuration }
