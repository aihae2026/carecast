#!/usr/bin/env node
// 현장 DB 가 이번 변경과 **맞는지**를 개인정보 없이 확인한다.
//
// 왜 필요한가(사용자 지시 2026-09-13): *"현장 데이터가 필요하다면 우선 익명화한 구조·집계로
// 확인해."* 이 저장소의 개발 DB 에는 음원도 폴더도 **0행**이라, 업로드·연결 화면이 현장의
// 실제 데이터에서 어떻게 보이는지는 **아직 아무도 모른다.** 그렇다고 파일 이름과 방송 문구가
// 든 DB 를 통째로 가져올 이유는 없다 — 판정에 필요한 것은 **개수와 구조**뿐이다.
//
// **이 스크립트가 절대 찍지 않는 것**: 파일 이름 · 폴더 이름 · 방송 문구 · 설정값 · API 키.
// 찍는 것은 개수, 종류(카테고리 열쇠), 참·거짓뿐이다. 카테고리 열쇠는 코드에 이미 박혀 있는
// 낱말이라(`morning-prayer` 등) 새로 드러나는 것이 없다.
//
// 쓰는 법 (현장 PC 또는 현장 DB 사본이 있는 곳에서):
//   node scripts/field-compat-report.cjs <database.db 경로>
//
// 결과를 그대로 붙여 주면 된다. 이름이 안 들어간다.
'use strict'

const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DBP = process.argv[2]
if (!DBP) {
  console.error('사용법: node scripts/field-compat-report.cjs <database.db 경로>')
  console.error('  ※ 원본을 열지 않고 **사본**을 쓰는 것을 권한다(WAL 이 있으면 -wal·-shm 도 같이 복사).')
  process.exit(2)
}

// **읽기 전용으로 연다.** 확인하려고 연 것이 값을 바꾸면 안 된다.
let db
try {
  db = new DatabaseSync(path.resolve(DBP), { readOnly: true })
} catch (e) {
  console.error('DB 를 못 열었다:', e.message)
  process.exit(1)
}

const 세기 = (sql, ...args) => { try { return db.prepare(sql).get(...args)?.c ?? 0 } catch { return null } }
const 줄 = (k, v) => console.log('  ' + String(k).padEnd(34) + ' ' + v)

console.log('\n===== 현장 호환 확인 (이름 없음 · 집계만) =====')
console.log('생성:', new Date().toISOString())

console.log('\n[1] 규모 — 업로드 화면이 몇 줄을 그리게 되나')
줄('audio_files 행 수', 세기('SELECT COUNT(*) c FROM audio_files'))
줄('content_folders 행 수', 세기('SELECT COUNT(*) c FROM content_folders'))
줄('audio_playlist 행 수', 세기('SELECT COUNT(*) c FROM audio_playlist'))
줄('폴더 안에 든 파일 수', 세기('SELECT COUNT(*) c FROM audio_files WHERE folder_id IS NOT NULL'))
줄('하위 폴더(부모가 있는) 수', 세기('SELECT COUNT(*) c FROM content_folders WHERE parent_id IS NOT NULL'))
줄('파일 없는(링크) 항목 수', 세기("SELECT COUNT(*) c FROM audio_files WHERE filename = ''"))

console.log('\n[2] 갈래별 파일 수 — 왼쪽에서 내린 카테고리가 꼬리표로 잘 보이나')
console.log('    (카테고리 열쇠는 코드에 이미 있는 낱말이다. 파일 이름은 안 찍는다.)')
try {
  const rows = db.prepare('SELECT category, COUNT(*) c FROM audio_files GROUP BY category ORDER BY c DESC').all()
  if (!rows.length) console.log('    (음원이 없다)')
  for (const r of rows) 줄(r.category, r.c + '개')
} catch (e) { console.log('    못 읽음:', e.message) }

console.log('\n[3] 폴더가 어느 갈래 아래 있나 — 왼쪽 트리가 그릴 것')
try {
  const rows = db.prepare('SELECT category, COUNT(*) c FROM content_folders GROUP BY category').all()
  if (!rows.length) console.log('    (폴더가 없다 — 새 화면에서는 「폴더 없음」으로 보인다)')
  for (const r of rows) 줄(r.category, r.c + '개')
} catch (e) { console.log('    못 읽음:', e.message) }

console.log('\n[4] 자동방송 단계 설정 — 이번 변경이 읽는 자리')
for (const k of ['morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps']) {
  let v = null
  try { v = db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null } catch { /* 무시 */ }
  if (v === null) { 줄(k, '저장 없음 (기본 단계 그대로)'); continue }
  let n, src, 파생
  try {
    const arr = JSON.parse(v)
    n = Array.isArray(arr) ? arr.length : null
    src = Array.isArray(arr) ? arr.filter(s => s && Object.prototype.hasOwnProperty.call(s, 'source')).length : 0
    파생 = /"sourceResolved"|"delayProfileResolved"/.test(v)
  } catch { 줄(k, '**JSON 이 깨져 있다** — 화면이 기본 단계로 돌아간다'); continue }
  줄(k, `단계 ${n}개 · source 키 ${src}개` + (파생 ? ' · ⚠ 파생값이 저장돼 있다' : ''))
}

console.log('\n[5] 이번 변경과 부딪힐 만한 것')
{
  const 폴더 = 세기('SELECT COUNT(*) c FROM content_folders')
  const 파일 = 세기('SELECT COUNT(*) c FROM audio_files')
  const misc = 세기("SELECT COUNT(*) c FROM content_folders WHERE category IN ('misc','misc-audio','misc-video')")
  const 시스템폴더 = (폴더 ?? 0) - (misc ?? 0)
  줄('사용자 폴더(misc 계열)', misc + '개 — 새 왼쪽 트리에 그대로 보인다')
  줄('시스템 카테고리 아래 폴더', 시스템폴더 + '개'
    + (시스템폴더 > 0 ? ' — ⚠ 왼쪽에서 카테고리를 내렸으므로 **꼬리표를 눌러** 들어간다' : ''))
  줄('예전 「내 폴더」(misc)', 세기("SELECT COUNT(*) c FROM content_folders WHERE category = 'misc'")
    + '개 — 0보다 크면 왼쪽에 「예전 폴더」로 보인다')
  줄('폴더별 조회 인덱스가 필요한 규모인가',
    (파일 ?? 0) >= 2000 ? `**그렇다(${파일}행)** — idx_audio_files_folder 를 다시 검토할 것`
      : `아니다(${파일}행) — 실측상 수천 행부터 의미가 있다`)
}

console.log('\n[6] 스키마가 이 코드와 맞나')
for (const [표, 칸] of [['audio_files', 'folder_id'], ['audio_files', 'source_type'], ['content_folders', 'parent_id']]) {
  let 있나 = false
  try { 있나 = db.prepare(`PRAGMA table_info(${표})`).all().some(c => c.name === 칸) } catch { /* 무시 */ }
  줄(`${표}.${칸}`, 있나 ? '있다' : '**없다 — 서버를 한 번 띄워 initDB 를 태워야 한다**')
}

db.close()
console.log('\n※ 이 출력에는 파일 이름·폴더 이름·방송 문구·설정값이 들어 있지 않다.\n')
