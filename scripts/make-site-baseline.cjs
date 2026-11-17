#!/usr/bin/env node
// 현장 PC의 DB에서 "기초 설정"을 뽑아 server/config/site-baseline.json으로 만든다.
//
// 쓰는 법:
//   node scripts/make-site-baseline.cjs "<현장 DB 사본 경로>\\database.db"
//
// 왜 필요했나(2026-08-30): server/db/는 gitignore라 PC를 옮기면 따라오지 않는다. 그래서
// 개발 PC에는 예약(환기방송 포함)·연속 방송 흐름이 한 번도 있던 적이 없고,
// 화면은 그걸 "없어졌다"로 보여준다. 같은 뿌리로 최소 세 번 헛걸음했다.
//
// **이 스크립트의 제1임무는 비밀키를 밖으로 내보내지 않는 것이다.**
// 결과 JSON은 git에 커밋된다. 한 번 올라가면 저장소가 비공개여도 되돌리기 어렵다
// (CC-001에서 기상청 실키로 이미 겪었다). 그래서 거르는 규칙을 셋으로 겹쳐 둔다.
//   1) 이름으로 아는 비밀키 목록(DENY_KEYS)
//   2) 이름 생김새로 거르기(key/secret/token/password/credential)  ← 새 키가 생겨도 걸린다
//   3) 다 거른 뒤 **값**을 훑어 비밀키처럼 생긴 게 있으면 아예 파일을 안 쓴다  ← 마지막 그물
//
// ── 비밀키는 걸렀지만 **시설 식별 정보는 남아 있다** (2026-09-06) ──────────────
//
// 이 파일에는 걸러지지 않는, 그러나 민감한 것이 있다:
//   · 위치 — `airkorea_station`(측정소 이름) · 기상청 격자 `kma_nx`/`kma_ny` · 법정동 코드
//     `kma_area_no`/`uv_area_no`. 이것만으로 **시설이 어디인지 특정된다.**
//   · 생활 — 방송 문안과 시각 전부. **어느 시설에서 매일 몇 시에 무슨 방송이 나가는지**가
//     그대로 드러난다(식사·환기 시각까지).
//
// **이 파일은 비공개 저장소를 전제로 커밋된다.**
// **저장소를 공개로 전환할 때는 반드시 이 파일을 제외할 것.** 그때는 커밋 이력에서도
// 지워야 한다 — 히스토리에 남으면 공개 전환 순간 함께 공개된다.
// (없어도 개발과 verify 는 돌아간다. siteBaseline.js 와 check-broadcast-times.cjs 가
//  파일이 없는 경우를 정상 경로로 다룬다.)
// ──────────────────────────────────────────────────────────────────
'use strict'

const fs   = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const OUT = path.join(__dirname, '..', 'server', 'config', 'site-baseline.json')

// ── 1) 이름으로 아는 것 ────────────────────────────────────────
const DENY_KEYS = new Set([
  // 비밀 — 절대 나가면 안 된다
  // youtube_api_key: 연동은 2026-09-21 걷어냈지만 **그 전 DB 에서 뽑을 때** 여전히 들어 있다 — 비밀이다.
  'youtube_api_key', 'gemini_api_key', 'anthropic_api_key', 'openai_api_key',
  'kma_api_key', 'kma_apihub_key', 'kma_living_api_key', 'kma_alert_api_key',
  'airkorea_api_key', 'switchbot_token', 'switchbot_secret', 'switchbot_device_id',
  'gcal_client_id', 'gcal_client_secret', 'gcal_refresh_token',
  'azure_speech_key',   // 선택 안내 음성 엔진(2026-09-21). 설치처마다 자기 키 — 남의 키를 심지 않는다.
  // PC마다 달라야 하는 것 — 가져오면 오히려 사고가 난다
  'audio_device',        // 현장 스피커 이름을 개발 PC에 넣으면 소리가 엉뚱한 데로 간다
  'auto_shutdown_time',  // 현장은 18:21. 이걸 가져오면 개발 PC가 한창 일할 때 꺼진다
  'pc_role',             // 이 PC가 현장인지 개발인지는 각자 판단한다
  // 시간이 지나면 썩는 값 — 남의 PC에서 뽑아 심으면 새 PC가 설치하자마자 죽는다
  'gemini_model',        // 2026-09-06 실측: 현장 값 'gemini-2.5-flash'를 구글이
                         // "no longer available to new users"로 닫았다. 새 키로 부르면
                         // 곧바로 404다 — 즉 새 PC는 AI가 처음부터 안 된다.
                         // 새 PC는 코드 기본값(server/domain/geminiModel.js)을 쓰게 두고,
                         // 모델 교체는 그 한 곳만 고친다. 현장에서 바꾸는 자리는
                         // 관리자 화면이고, 거기 "목록 불러오기" 버튼이 있다.
  // 자동 선택(2026-10-23)이 그 PC 에서 고른 값·시각·이전 값 — PC 마다 다르고 시간이 지나면 썩는다
  'gemini_model_auto', 'gemini_model_auto_at', 'gemini_model_auto_probe_ms', 'gemini_model_before_auto',
])

// ── 2) 생김새로 거르기 — 새 키가 생겨도 걸리도록 ──────────────
const DENY_PATTERNS = [
  /key$/i, /secret/i, /token/i, /password/i, /credential/i,
  /_last_fired$/,        // 오늘 나갔는지 여부. 남의 PC 기록이라 의미 없다
  /^watchdog_alerted_/,  // 경보 중복 방지 표시
  /^auto_update_last$/, /^loop_last_run$/, /^datafix_/,
  // 배경음악 용도 폴더 번호와 「차례로」 자리(2026-09-21). 폴더 번호는 **그 PC 의 폴더 표**를
  // 가리킨다 — 폴더도 음원도 기초값을 따라가지 않으므로, 옮기면 남의 PC 에서 엉뚱한 폴더나
  // 없는 폴더를 가리킨다. 새 PC 는 첫 부팅 보정(dataFixes)이 자기 폴더를 만들어 적는다.
  /^bgm_folder_/, /^local_bgm_seq_/, /^media_seq_/,
  // 이용 조건 동의 기록(2026-10-07) — **그 기관이** 동의한 것이다. 옮기면 새 PC 가 동의한 적 없이
  // 「이미 동의함」으로 시작한다.
  /^license_consent_/,
]

// ── 3) 값이 비밀키처럼 생겼나 ─────────────────────────────────
const SECRET_VALUE = [
  /AIza[0-9A-Za-z_-]{30,}/,          // Google/Gemini
  /sk-[A-Za-z0-9]{20,}/,             // OpenAI 계열
  /[A-Za-z0-9+/]{40,}={0,2}/,        // 긴 base64 (기상청 서비스키가 이 모양)
  /\b[0-9a-f]{32,}\b/,               // 긴 hex
]

function allowedKey(key) {
  if (DENY_KEYS.has(key)) return false
  return !DENY_PATTERNS.some(re => re.test(key))
}

function looksSecret(value) {
  const v = String(value ?? '')
  if (v.length < 20) return false
  return SECRET_VALUE.some(re => re.test(v))
}

function rows(db, sql) {
  try { return db.prepare(sql).all() } catch { return [] }
}

// 외부 동영상 연동을 걷어내기 전(2026-09-21 이전) DB 에서 뽑아도 **걷어낸 뒤의 모양**으로 만든다.
// 새 PC 는 기초값을 부팅 보정 **뒤에** 심으므로(server/index.js), 옛 값이 들어가면 보정 없이 그대로 남는다.
// 변환은 부팅 보정과 같은 함수를 쓴다 — 두 벌이 되면 한쪽만 고치는 날 둘이 갈라진다.
function 옛연동걷기(data) {
  const 걷기 = require(path.join(__dirname, '..', 'server', 'config', 'youtubeRemovalFix'))
  for (const k of ['morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps']) {
    if (!data.settings[k]) continue
    let 배열; try { 배열 = JSON.parse(data.settings[k]) } catch { continue }
    const r = 걷기.단계고치기(배열)
    if (r.바꾼것.length) data.settings[k] = JSON.stringify(r.steps)
  }
  for (const k of ['vol_tv', 'vol_tv_decided', 'morning_bgm_type', 'morning_bgm_value']) delete data.settings[k]
  data.schedules = data.schedules
    .filter(s => s.broadcast_type !== 'youtube-tv')
    .map(s => (걷기.bgm종류고치기(s.bgm_type) !== s.bgm_type ? { ...s, bgm_type: 걷기.bgm종류고치기(s.bgm_type), bgm_value: '', bgm_title: '' } : s))
  data.flow_sequence_steps = data.flow_sequence_steps
    .filter(r => r.step_type !== 'video')
    .map(r => {
      if (r.step_type !== 'bgm') return r
      let c; try { c = JSON.parse(r.config || '{}') } catch { return r }
      const 새것 = 걷기.bgm설정고치기(c)
      return 새것 === c ? r : { ...r, config: JSON.stringify(새것) }
    })
}

function main() {
  const src = process.argv[2]
  if (!src) {
    console.error('사용법: node scripts/make-site-baseline.cjs <현장 database.db 경로>')
    process.exit(1)
  }
  if (!fs.existsSync(src)) {
    console.error(`파일이 없습니다: ${src}`)
    process.exit(1)
  }

  const db = new DatabaseSync(src, { readOnly: true })

  const settings = {}
  const dropped  = []
  for (const r of rows(db, 'SELECT key, value FROM settings')) {
    if (!allowedKey(r.key)) { dropped.push(r.key); continue }
    settings[r.key] = r.value
  }

  const data = {
    _생성: new Date().toISOString(),
    _설명: '현장 PC 설정에서 비밀키를 빼고 뽑은 기초값. 서버 기동 시 비어 있는 것만 채운다.',
    settings,
    schedules:           rows(db, 'SELECT * FROM schedules WHERE active = 1'),
    flow_sequences:      rows(db, 'SELECT * FROM flow_sequences'),
    flow_sequence_steps: rows(db, 'SELECT * FROM flow_sequence_steps ORDER BY flow_sequence_id, sort_order'),
    favorites:           rows(db, 'SELECT * FROM favorites'),
  }
  db.close()
  옛연동걷기(data)

  // 언제 뽑았는지 남긴다 — **이것이 없으면 낡은 사본인지 아무도 모른다.**
  // 2026-09-06에 겪은 일: 현장에서 방송 시각을 바꿨는데 저장소의 사본들은 그대로였고,
  // 배포 게이트가 없는 시각을 지키고 있었다. 사본끼리 맞는지 검사해도, 그 사본이
  // 낡았으면 검사는 통과하면서 현장과는 계속 어긋난다.
  // scripts/check-broadcast-times.cjs 가 이 값을 보고 오래됐으면 경고한다.
  data._meta = {
    extractedAt: new Date().toISOString(),
    sourceDb: path.basename(src),
    // **원본 DB 가 언제 것인지도 남긴다.** extractedAt 만 있으면 5일 된 백업으로 오늘 뽑아도
    // '0일 전'로 보인다 — 낡음을 못 잡는다. 검사는 둘 중 **오래된 쪽**을 본다.
    // 이 저장소의 백업 파일명은 carecast_YYYYMMDD_HHMM.db 다(services/backup.js).
    // **파일명이 가장 믿을 만하다** — 복사하면 mtime 은 오늘이 되지만 이름은 그대로다.
    sourceDbNamedAt: (() => {
      const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(path.basename(src))
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00` : null
    })(),
    sourceDbModifiedAt: (() => { try { return fs.statSync(src).mtime.toISOString() } catch { return null } })(),
    note: "현장 DB에서 뽑은 시각. 오래되면 verify가 다시 뽑으라고 알린다.",
  }

  // ── 마지막 그물: 값 전수 검사 ──
  const leaks = []
  const walk = (node, at) => {
    if (node === null || node === undefined) return
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`)
      return
    }
    if (looksSecret(node)) leaks.push(`${at} = ${String(node).slice(0, 12)}…`)
  }
  walk(data, '')

  if (leaks.length) {
    console.error('\n비밀키처럼 보이는 값이 남아 있어 파일을 쓰지 않았습니다:')
    for (const l of leaks) console.error('  -', l)
    console.error('\nDENY_KEYS에 해당 키를 추가한 뒤 다시 돌리세요.')
    process.exit(2)
  }

  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')

  console.log(`\n기초 설정을 만들었습니다 → ${path.relative(process.cwd(), OUT)}`)
  console.log(`  설정값        ${Object.keys(settings).length}개`)
  console.log(`  예약          ${data.schedules.length}개`)
  console.log(`  연속 방송     ${data.flow_sequences.length}개 (단계 ${data.flow_sequence_steps.length})`)
  console.log(`  즐겨찾기 버튼  ${data.favorites.length}개`)
  console.log(`\n  제외한 키 ${dropped.length}개: ${dropped.join(', ') || '(없음)'}`)
  console.log('\n서버를 재시작하면 비어 있는 항목만 채워집니다(있는 값은 안 덮어씁니다).')
}

main()
