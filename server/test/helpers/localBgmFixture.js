// 시험용 로컬 배경음악 — 방송용·식사용 폴더를 만들고 곡을 한 곡씩 넣는다 (2026-09-21).
//
// 외부 동영상 연동을 걷어낸 뒤 BGM 은 **이 PC 의 용도 폴더 곡**뿐이다. 폴더가 비면 resolveBGM 이
// null 을 돌려주므로(아무거나 틀지 않는다), BGM 이 실제로 실리는 것을 보려는 시험은 곡을 먼저 심는다.
// 폴더 만들기·설정 키는 **실제 첫 부팅 보정과 같은 함수**를 부른다 — 시험이 다른 길로 만들면 둘이 갈린다.
'use strict'

const { DATA_FIXES } = require('../../config/dataFixes')

/**
 * @param {object} db
 * @param {{ 곡: {broadcast?: string[], meal?: string[]} }} [opts] 용도별 곡 이름(파일 이름으로도 쓴다)
 * @returns {{ broadcast: number, meal: number }} 두 폴더 번호
 */
function 로컬BGM심기(db, { 곡 = { broadcast: ['방송곡.mp3'], meal: ['식사곡.mp3'] } } = {}) {
  DATA_FIXES.find(f => f.key === 'datafix_bgm_role_folders_20260921').run(db)
  const 폴더 = {
    broadcast: parseInt(db.prepare("SELECT value FROM settings WHERE key = 'bgm_folder_broadcast'").get().value, 10),
    meal:      parseInt(db.prepare("SELECT value FROM settings WHERE key = 'bgm_folder_meal'").get().value, 10),
  }
  let 차례 = db.prepare("SELECT COALESCE(MAX(sort_order), -1) m FROM audio_playlist WHERE category = 'bgm'").get().m
  for (const [role, 이름들] of Object.entries(곡)) {
    for (const 이름 of 이름들 || []) {
      const id = db.prepare(
        "INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id) VALUES ('bgm', ?, ?, 120, ?, ?)"
      ).run(이름, 이름, new Date().toISOString(), 폴더[role]).lastInsertRowid
      db.prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('bgm', ?, ?, 1)").run(id, ++차례)
    }
  }
  return 폴더
}

module.exports = { 로컬BGM심기 }
