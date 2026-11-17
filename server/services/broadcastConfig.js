// 방송 설정 해석 — TTS 목소리·속도와 BGM(이 PC 의 방송용·식사용 폴더)을 발동 시점에 풀어낸다.
//
// 왜 별도 파일인가(배선도 ①, 2026-08-30): 원래 scheduler.js 안에 있었는데, flowRunner도
// 같은 해석이 필요해서 scheduler를 역참조했고 — scheduler는 flowRunner를 부르므로 —
// 순환 require가 됐다(resolveBGM이 undefined로 굳는 실사고, broadcastSequencer.js의 옛
// 경고 주석 참고). 해석 함수는 아래층으로 내리고 scheduler가 재수출해 기존 사용처
// (routes/morning.js, volume.test.js 등)는 그대로 둔다.
'use strict'

const { rawSetting, 글자설정 } = require('../domain/settingsRead')
const { readVolume, clampVolume } = require('../domain/volume')

// DB에서 TTS 설정 읽기
function loadTTSConfig(db, voiceKey = 'tts_voice_normal') {
  const get = (k, d) => rawSetting(db, k) ?? d
  return {
    // **목소리는 `글자설정` 으로 읽는다**(P-113). `?? 기본값` 은 `null`·`undefined` 만
    // 거르므로 **빈 문자열이 저장돼 있으면 그대로 합성에 내려간다** — [FACT] EV-003961.
    // 빈 목소리에는 뜻이 없다("목소리 없이 읽는 방송" 은 없다). 반면 `rate`·`pitch` 는
    // `parseFloat` 이 빈 값을 NaN 으로 걸러 내므로 그대로 둔다.
    voice: 글자설정(rawSetting(db, voiceKey), 'ko-KR-SunHiNeural'),
    rate:  parseFloat(get('tts_rate',  '0.9')),
    pitch: parseFloat(get('tts_pitch', '1')),
  }
}

/**
 * BGM 설정 해석 → `{ kind:'local', files, bgmTitle, folderName, delay, endDelay, bgmDefault }` 또는 null.
 *
 * `bgm_type` 은 `local_broadcast` · `local_meal` · `local_f<폴더 번호>` (+`_seq` 면 차례로 — 규칙은
 * domain/bgmRoles.js). 곡은 그 폴더에서 고른다
 * (services/localBgm.js). 폴더가 비었거나 없으면 **null** — 이유는 로그에 남긴다(「조회 실패」와
 * 「정말 비어 있음」을 가른다, CC-038). 방송은 BGM 없이 계속된다.
 *
 * 2026-09-21: 외부 동영상 서비스 연동을 걷어냈다(사용자 지시). 그 전의 값(검색어·즐겨찾기·주소)이
 * 저장된 예약·흐름이 남아 있어도 **무음으로 떨어뜨리지 않고 방송용 BGM 으로 읽는다** — 첫 부팅 보정이
 * 저장값도 고치지만, 그 전에 발동하는 방송이 있어도 소리가 나게 한다. 「차례로」였던 것은 차례로 둔다.
 */
async function resolveBGM(db, schedule) {
  if (!schedule.bgm_enabled) return null
  const delay    = Number(schedule.bgm_delay     ?? 5)
  const endDelay = Number(schedule.bgm_end_delay ?? 0)

  // 이 방송에 쓸 BGM 볼륨. 예약에 값이 있으면 그것만, 없으면 시스템 기본값.
  // 전역 설정을 임시로 바꿨다가 되돌리는 방식을 쓰지 않는 이유: 되돌리기 전에 서버가 죽거나
  // 다음 예약이 발동하면 값이 남거나 섞인다. 이벤트에만 실으면 되돌릴 상태가 아예 없다.
  // 필드 이름을 bgmDefault로 두는 건 화면(App.jsx/MusicPlayer.jsx)이 이미 그 이름을 읽기 때문이다.
  const bgmDefault = schedule.bgm_volume == null
    ? readVolume(db, 'bgm')
    : clampVolume(schedule.bgm_volume, readVolume(db, 'bgm'))

  // 사람이 만든 폴더(`local_f<번호>`)를 **먼저** 본다 — 용도 규칙보다 늦게 보면 옛 값으로 읽혀 방송용이 나간다.
  // 못 쓰면 방송용으로 대신 틀고 경보를 낸다(예약·흐름·즉시방송은 식사 시간 여부를 모른다 — 기본은 방송용).
  const 폴더 = require('../domain/bgmRoles').폴더값(schedule.bgm_type)
  // 곡 하나(`local_a<번호>`, 2026-09-22) — 없어졌으면 방송용으로 대신 틀고 경보
  // 모양이 틀린 곡 값(local_a7_seq 등)은 없는 곡으로 본다 — 옛 값으로 읽으면 경보 없이 방송용이 나가고 차례까지 민다(Codex Medium)
  const { 곡값, 곡값인척 } = require('../domain/bgmRoles')
  const 곡 = 폴더 ? null : (곡값(schedule.bgm_type) || (곡값인척(schedule.bgm_type) ? { fileId: -1 } : null))
  const 로컬 = 폴더 || 곡 ? null : (로컬용도(schedule.bgm_type) || 옛값을로컬로(schedule.bgm_type))
  const 고른것 = 곡
    ? require('./localBgm').방송BGM고르기(db, { fileId: 곡.fileId, role: 'broadcast' })
    : 폴더
    ? require('./localBgm').방송BGM고르기(db, { folderId: 폴더.folderId, role: 'broadcast', order: 폴더.차례 ? 'seq' : 'random' })
    : require('./localBgm').로컬BGM고르기(db, { role: 로컬.role, order: 로컬.차례 ? 'seq' : 'random' })
  if (!고른것.ok) { console.warn(`[BGM 해석] ${고른것.사유}`); return null }
  return {
    kind: 'local', files: 고른것.files, bgmTitle: 고른것.title, folderName: 고른것.folderName,
    ...(고른것.대체 ? { 대체: true } : {}),
    delay, endDelay, bgmDefault,
  }
}

// `local_broadcast` · `local_meal` · 뒤에 `_seq` 가 붙으면 차례로. 용도 목록은 domain/bgmRoles.js 가 정본.
function 로컬용도(type) {
  const m = /^local_([a-z]+?)(_seq)?$/.exec(String(type || ''))
  if (!m) return null
  const { 역할찾기 } = require('../domain/bgmRoles')
  return 역할찾기(m[1]) ? { role: m[1], 차례: Boolean(m[2]) } : null
}

// 옛 값(빈 값 포함) → 방송용. 끝이 `_seq` 였으면 차례로를 지킨다.
function 옛값을로컬로(type) {
  return { role: 'broadcast', 차례: /_seq$/.test(String(type || '')) }
}

module.exports = { loadTTSConfig, resolveBGM, 로컬용도 }
