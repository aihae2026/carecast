// 외부 동영상 서비스(유튜브) 연동을 걷어낸 뒤 남은 데이터를 정리한다 — 부팅 보정 하나 (2026-09-21).
//
// 사용자 결정(2026-09-21 「youtube를 완전히 다 빼야해」, 넷 모두 추천안):
//   · 방송 뒤 계절 영상 세 단계 → 이 PC 의 「배경 영상」 폴더 영상으로 (코드가 바꾼다 — 여기선 옛 키만 뺀다)
//   · 유튜브 TV 예약·흐름 단계 → **삭제**
//   · TV 송출 볼륨(vol_tv) → **없앤다**
//   · DB 의 유튜브 데이터 → **파일로 보관한 뒤 삭제**(API 키는 가려서)
//
// ── 순서가 규칙이다 ─────────────────────────────────────────────────────────
//   ① 지울 것을 모아 **파일에 먼저 쓴다.** 쓰기에 실패하면 던진다 → 마커가 안 남아 다음 부팅에
//      다시 돈다. **보관 못 한 채 지우는 길은 없다.**
//   ② 값 고치기·행 지우기는 한 트랜잭션. 중간에 죽으면 통째로 되돌아간다.
//   ③ 표·칸 삭제(DDL)는 맨 끝. 실패해도 데이터는 이미 정리됐으니 ⚠ 로만 남기고 넘어간다
//      (남은 빈 칸은 verify:db 에 「미선언 칼럼」 경고로 보인다).
//
// ── 되돌리기(이전 앱) ───────────────────────────────────────────────────────
// 이전 앱의 initDB 는 `CREATE TABLE IF NOT EXISTS youtube_favorites` 와 칸 ALTER 를 **부팅마다**
// 돈다 — 표·칸을 지워도 이전 앱으로 돌아가면 빈 채로 다시 생긴다. 데이터는 ① 의 파일에 있다.
'use strict'

const fs = require('fs')
const path = require('path')
const { rawSetting, writeSetting } = require('../domain/settingsRead')

const 기본보관폴더 = path.join(__dirname, '..', 'db', 'backups')

// 지우는 설정 키. API 키는 파일에도 **가려서** 남긴다(끝 네 자리만).
const 지울설정 = ['youtube_api_key', 'vol_tv', 'vol_tv_decided', 'morning_bgm_type', 'morning_bgm_value']
const 단계키들 = ['morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps']
const 배경영상단계 = new Set(['morning_video', 'lunch_video_after', 'dinner_video_after'])
// BGM 단계에서 남길 키 — 나머지 `bgm*`(검색어·즐겨찾기 폴더 등)는 옛 소스 전용이라 뺀다.
const 남길BGM키 = new Set(['bgmSource', 'bgmRole', 'bgmOrder', 'bgmFolderId', 'bgmVolume'])

function 가리기(v) {
  const s = String(v ?? '')
  if (!s) return ''
  return s.length <= 4 ? '(가려짐)' : `(가려짐 …${s.slice(-4)})`
}

// 옛 BGM 종류 → 로컬. 차례로(`_seq`)였던 것은 차례로 둔다. 이미 로컬이거나 빈 값이면 그대로.
function bgm종류고치기(t) {
  const s = String(t ?? '')
  if (!s || s.startsWith('local_')) return t
  return /_seq$/.test(s) ? 'local_broadcast_seq' : 'local_broadcast'
}

// BGM 설정 하나(`{bgm_type, bgm_value, bgm_title, playlist?}`)를 로컬로. 바뀐 게 없으면 같은 객체를 돌려준다.
// 재생목록(`playlist`)의 곡마다 같은 규칙 — flowRunner 가 곡마다 resolveBGM 을 부른다.
function bgm설정고치기(c) {
  let n = c
  if (bgm종류고치기(c.bgm_type) !== c.bgm_type) n = { ...n, bgm_type: bgm종류고치기(c.bgm_type), bgm_value: null, bgm_title: null }
  if (Array.isArray(c.playlist)) {
    const 새목록 = c.playlist.map(it => (it && typeof it === 'object' ? bgm설정고치기(it) : it))
    if (새목록.some((it, i) => it !== c.playlist[i])) n = { ...n, playlist: 새목록 }
  }
  return n
}

/**
 * 자동방송 단계 배열 하나를 고친다. **순수 함수** — 기초값 파일(site-baseline.json)도 같은 것으로 고친다.
 * @returns {{ steps: any[], 바꾼것: string[] }}
 */
function 단계고치기(steps) {
  const 바꾼것 = []
  if (!Array.isArray(steps)) return { steps, 바꾼것 }
  const out = []
  for (const s of steps) {
    if (!s || typeof s !== 'object') { out.push(s); continue }
    if (s.customType === 'youtube_tv') { 바꾼것.push(`「${s.label || s.id}」 TV 송출 단계 삭제`); continue }
    let n = s
    if (typeof s.bgmSource === 'string' && s.bgmSource.startsWith('yt_')) {
      n = { ...n, bgmSource: 'local' }
      for (const k of Object.keys(n)) if (k.startsWith('bgm') && !남길BGM키.has(k)) delete n[k]
      // 차례로(`…_seq`)였던 단계는 차례를 **옮겨 적는다** — 로컬 단계의 차례는 bgmOrder 칸이 정한다.
      // 이게 없으면 사용자가 고른 순차 재생이 랜덤으로 바뀐다(Codex 3단계 1회차 Medium).
      if (/_seq$/.test(s.bgmSource) && !n.bgmOrder) n.bgmOrder = 'seq'
      바꾼것.push(`「${s.label || s.id}」 BGM → 이 PC 음원`)
    }
    if (배경영상단계.has(s.id) && ('videoId' in s || 'videoSearch' in s)) {
      n = { ...n }
      delete n.videoId; delete n.videoSearch
      if (typeof n.label === 'string') n.label = n.label.replace(/YouTube\s*영상/i, '배경 영상')
      바꾼것.push(`「${n.label || s.id}」 → 배경 영상 폴더`)
    }
    if (s.customType === 'bgm' && bgm설정고치기(s) !== s) {
      n = bgm설정고치기(n)
      바꾼것.push(`「${s.label || s.id}」 BGM → 이 PC 음원`)
    }
    out.push(n)
  }
  return { steps: out, 바꾼것 }
}

function 표있나(db, 표) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(표))
}
function 칸있나(db, 표, 칸) {
  return db.prepare(`PRAGMA table_info(${표})`).all().some(c => c.name === 칸)
}

/**
 * @param {object} db
 * @param {{ 보관폴더?: string, 지금?: Date }} opts 시험용 주입
 * @returns {string[]} 바꾼 내역
 */
function run(db, { 보관폴더 = 기본보관폴더, 지금 = new Date() } = {}) {
  const changed = []
  const 유튜브칸 = 칸있나(db, 'audio_files', 'source_type')
  const 즐겨찾기표 = 표있나(db, 'youtube_favorites')

  // ── ① 모으기 ──────────────────────────────────────────────
  const 보관 = { 만든때: 지금.toISOString(), 이유: '외부 동영상 연동 제거(2026-09-21 사용자 결정) — 지우기 전에 보관', settings: {}, steps: {} }
  for (const k of 지울설정) {
    const v = rawSetting(db, k)
    if (v != null) 보관.settings[k] = k === 'youtube_api_key' ? 가리기(v) : v
  }
  const 단계새값 = {}
  for (const k of 단계키들) {
    const raw = rawSetting(db, k)
    let 배열; try { 배열 = JSON.parse(raw || 'null') } catch { continue }
    const r = 단계고치기(배열)
    if (r.바꾼것.length) { 보관.steps[k] = raw; 단계새값[k] = r }
  }
  보관.youtube_favorites = 즐겨찾기표 ? db.prepare('SELECT * FROM youtube_favorites').all() : []
  보관.audio_files = 유튜브칸 ? db.prepare("SELECT * FROM audio_files WHERE source_type = 'youtube'").all() : []
  const 파일id = 보관.audio_files.map(r => r.id)
  보관.audio_playlist = 파일id.length
    ? db.prepare(`SELECT * FROM audio_playlist WHERE audio_file_id IN (${파일id.map(() => '?').join(',')})`).all(...파일id)
    : []
  보관.schedules_deleted = db.prepare("SELECT * FROM schedules WHERE broadcast_type = 'youtube-tv'").all()
  보관.schedules_bgm_changed = db.prepare(
    "SELECT id, bgm_type, bgm_value, bgm_title FROM schedules WHERE broadcast_type != 'youtube-tv' AND bgm_type IS NOT NULL AND bgm_type != '' AND bgm_type NOT LIKE 'local\\_%' ESCAPE '\\'"
  ).all()
  const 흐름단계 = db.prepare('SELECT * FROM flow_sequence_steps').all()
  보관.flow_steps_deleted = 흐름단계.filter(r => r.step_type === 'video')
  보관.flow_steps_bgm_changed = []
  const 흐름bgm새값 = []
  for (const r of 흐름단계) {
    if (r.step_type !== 'bgm') continue
    let c; try { c = JSON.parse(r.config || '{}') } catch { continue }
    const 새것 = bgm설정고치기(c)
    if (새것 === c) continue
    보관.flow_steps_bgm_changed.push(r)
    흐름bgm새값.push({ id: r.id, config: JSON.stringify(새것) })
  }

  const 있나 = Object.keys(보관.settings).length || Object.keys(보관.steps).length ||
    보관.youtube_favorites.length || 보관.audio_files.length || 보관.schedules_deleted.length ||
    보관.schedules_bgm_changed.length || 보관.flow_steps_deleted.length || 보관.flow_steps_bgm_changed.length

  if (있나) {
    fs.mkdirSync(보관폴더, { recursive: true })
    const 이름 = `youtube-removed-${지금.toISOString().replace(/[:.]/g, '-')}.json`
    // 쓰기 실패는 여기서 던진다 — 아래 지우기로 가지 않는다(① 규칙).
    fs.writeFileSync(path.join(보관폴더, 이름), JSON.stringify(보관, null, 2), 'utf8')
    changed.push(`지우기 전 보관 → server/db/backups/${이름}`)

    // ── ② 고치기·지우기(한 트랜잭션) ───────────────────────────
    const history = require('../domain/settingsHistory')
    db.exec('BEGIN')
    try {
      for (const [k, r] of Object.entries(단계새값)) {
        writeSetting(db, k, JSON.stringify(r.steps), '데이터 보정')
        for (const 줄 of r.바꾼것) changed.push(`${k}: ${줄}`)
      }
      for (const k of Object.keys(보관.settings)) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(k)
        history.record(db, k, 보관.settings[k], null, '데이터 보정')
        changed.push(`설정 ${k} 삭제`)
      }
      if (보관.schedules_deleted.length) {
        db.prepare("DELETE FROM schedules WHERE broadcast_type = 'youtube-tv'").run()
        changed.push(`TV 송출 예약 ${보관.schedules_deleted.length}개 삭제`)
      }
      for (const r of 보관.schedules_bgm_changed) {
        db.prepare("UPDATE schedules SET bgm_type = ?, bgm_value = '', bgm_title = '' WHERE id = ?").run(bgm종류고치기(r.bgm_type), r.id)
      }
      if (보관.schedules_bgm_changed.length) changed.push(`예약 ${보관.schedules_bgm_changed.length}개의 BGM → 이 PC 방송용 BGM`)
      if (보관.flow_steps_deleted.length) {
        db.prepare("DELETE FROM flow_sequence_steps WHERE step_type = 'video'").run()
        changed.push(`흐름의 TV 송출 단계 ${보관.flow_steps_deleted.length}개 삭제`)
      }
      for (const r of 흐름bgm새값) db.prepare('UPDATE flow_sequence_steps SET config = ? WHERE id = ?').run(r.config, r.id)
      if (흐름bgm새값.length) changed.push(`흐름 BGM 단계 ${흐름bgm새값.length}개 → 이 PC 방송용 BGM`)
      if (파일id.length) {
        const q = 파일id.map(() => '?').join(',')
        db.prepare(`DELETE FROM audio_playlist WHERE audio_file_id IN (${q})`).run(...파일id)
        db.prepare(`DELETE FROM audio_files WHERE id IN (${q})`).run(...파일id)
        changed.push(`링크로 등록된 영상 ${파일id.length}개 삭제`)
      }
      if (보관.youtube_favorites.length) {
        db.prepare('DELETE FROM youtube_favorites').run()
        changed.push(`즐겨찾기 ${보관.youtube_favorites.length}개 삭제`)
      }
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 이미 끝났으면 무시 */ }
      throw e
    }
  }

  // ── ③ 표·칸 삭제 ─────────────────────────────────────────
  const ddl = []
  if (즐겨찾기표) ddl.push(['즐겨찾기 표', 'DROP TABLE youtube_favorites'])
  for (const 칸 of ['youtube_video_id', 'youtube_url', 'source_type']) {
    if (칸있나(db, 'audio_files', 칸)) ddl.push([`audio_files.${칸}`, `ALTER TABLE audio_files DROP COLUMN ${칸}`])
  }
  for (const [이름, sql] of ddl) {
    try { db.exec(sql); changed.push(`${이름} 삭제`) }
    catch (e) { changed.push(`⚠ ${이름} 삭제 실패(데이터는 정리됨): ${e.message}`) }
  }
  return changed
}

module.exports = { run, 단계고치기, bgm종류고치기, bgm설정고치기, 가리기 }
