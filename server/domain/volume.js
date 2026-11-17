// 볼륨 단일 소스 — 채널 정의·기본값·별칭·읽기·쓰기를 여기 한 곳에만 둔다.
//
// 왜 만들었나(2026-08-28 조사): 볼륨이 오랫동안 어긋나 있었고, 원인은 전부 "같은 값을
// 가리키는 이름이 여러 개인데 기본값이 제각각"이었다.
//
//  1) 안내 음성 볼륨의 이름이 셋이었다
//     - vol_tts        : 음량 패널이 저장·표시
//     - vol_broadcast  : audioQueue.js/chimePlayer.js가 **실제 재생 때 읽던** 값
//     - tts_volume     : 관리자 'TTS 설정' 화면이 저장하던 값 — **읽는 재생 코드가 없었다.**
//       그래서 TTS 설정의 볼륨 슬라이더는 저장은 되는데 소리에 아무 영향이 없었다.
//  2) BGM 기본값이 갈라져 있었다
//     - vol_bgm(50)               : 음량 패널이 표시하던 값
//     - bgm_broadcast_default(70) : 방송이 실제로 시작하던 값
//       화면에는 50이라고 쓰여 있는데 방송은 70으로 나갔다.
//  3) 기본값이 8곳에 하드코딩돼 있어 한 곳을 고쳐도 나머지가 따라오지 않았다.
//  4) DB에 볼륨 키가 하나도 저장돼 있지 않아, 위 불일치가 전부 "코드 기본값"으로 드러났다.
//     (미러링은 저장할 때만 일어나므로, 한 번도 저장되지 않으면 영원히 어긋난 채로 돈다)
//
// 그래서 규칙은 하나다: **볼륨은 이 모듈로만 읽고 쓴다.** 직접 settings를 조회하지 않는다.
// 별칭에도 함께 써주기 때문에, 혹시 남아 있는 옛 경로가 있어도 값이 어긋나지 않는다.
'use strict'

// 채널 정의.
//  key      : 정규 키(앞으로 이것만 본다)
//  aliases  : 옛 이름. 읽을 때는 정규 키가 없을 때만 순서대로 보고, 쓸 때는 함께 갱신한다.
//  fallback : 아무 값도 없을 때 쓸 기본값 — 이 파일이 유일한 출처다.
const CHANNELS = {
  master: { key: 'vol_master', aliases: [],                          fallback: 70,  label: '전체 음량' },
  // vol_broadcast를 tts보다 먼저 보는 이유: 지금까지 **실제로 소리에 반영되던** 값이 그쪽이라,
  // 기존 설치의 체감 볼륨을 그대로 이어받는 게 맞다. tts_volume은 재생에 쓰인 적이 없어 맨 뒤.
  tts:    { key: 'vol_tts',    aliases: ['vol_broadcast', 'tts_volume'], fallback: 80, label: '안내 음성' },
  audio:  { key: 'vol_audio',  aliases: [],                          fallback: 100, label: '음원(안내 녹음)' },
  media:  { key: 'vol_media',  aliases: [],                          fallback: 70,  label: '영상' },
  // 70으로 통일한 이유: 지금 실제로 들리는 방송 BGM이 bgm_broadcast_default(70)이다.
  // 표시값이던 vol_bgm(50)에 맞추면 현장에서 방송 음악이 갑자기 작아진다 — 들리는 소리를
  // 바꾸지 않는 쪽을 기본으로 두고, 크기 조절은 음량 패널에서 하게 한다.
  bgm:    { key: 'vol_bgm',    aliases: ['bgm_broadcast_default'],   fallback: 70,  label: 'BGM' },
}

const CHANNEL_NAMES = Object.keys(CHANNELS)

// 이 모듈이 관리하는 모든 settings 키(정규 + 별칭) — 시딩·테스트에서 쓴다
const ALL_VOLUME_KEYS = CHANNEL_NAMES.flatMap(name => [CHANNELS[name].key, ...CHANNELS[name].aliases])

// 방송 유형 → 그 방송의 '주 소리'가 쓰는 채널.
//
// 예약 하나가 내는 소리는 대개 둘이다: 주 소리(안내 음성·차임벨·음원·영상)와 BGM 반주.
// 그래서 채널마다 컬럼을 두지 않고 schedules에 main_volume / bgm_volume 둘만 둔다.
//  - text  : 안내 음성(tts)
//  - chime : 차임벨 — 지금은 안내 음성과 같은 채널을 쓴다(chimePlayer.js)
//  - audio : 업로드 음원(audio)
//  - video : 업로드 영상(media)
//  - bgm   : 주 소리가 곧 BGM이라 bgm_volume이 맡는다 → 여기서는 null
//  - flow  : 단계마다 종류가 달라 한 값으로 정할 수 없다 → null (스텝 config가 맡는다)
const MAIN_CHANNEL_BY_TYPE = {
  text:         'tts',
  chime:        'tts',
  audio:        'audio',
  video:        'media',
  bgm:          null,
  flow:         null,
}

function mainChannelFor(broadcastType) {
  return MAIN_CHANNEL_BY_TYPE[broadcastType] ?? null
}

/**
 * 이 방송이 실제로 쓸 주 소리 볼륨(0~100).
 * 예약에 값이 있으면 그것만, 없으면 시스템 기본값. 채널이 없는 유형이면 null.
 *
 * 전역 설정을 임시로 바꿨다 되돌리는 방식을 쓰지 않는 이유는 bgm_volume과 같다 —
 * 되돌리기 전에 서버가 죽거나 다음 예약이 발동하면 값이 남는다.
 */
function resolveMainVolume(db, schedule) {
  const channel = mainChannelFor(schedule?.broadcast_type || 'text')
  if (!channel) return null
  const override = schedule?.main_volume
  if (override === null || override === undefined || override === '') return readVolume(db, channel)
  return clampVolume(override, readVolume(db, channel))
}

/**
 * 자동방송(아침 방송·국민체조·식전체조·저녁 마무리) 한 스텝이 쓸 볼륨(0~100).
 * 스텝에 값이 있으면 그것만, 없으면 시스템 기본값 — 예약별 볼륨(resolveMainVolume)과 같은 규칙이다.
 *
 * 전역 설정을 임시로 바꿨다 되돌리는 방식은 여기서도 금지다. 자동방송은 스텝이 8개까지
 * 이어지므로, 중간에 서버가 죽으면 되돌리기 전의 값이 그대로 남는다.
 *
 * @param {object} step  morning_steps 등의 스텝 객체
 * @param {string} channel 'tts' | 'audio' | 'media' | 'bgm'
 * @param {string} field 스텝에서 읽을 필드(주 소리는 'volume', 반주는 'bgmVolume')
 */
function resolveStepVolume(db, step, channel, field = 'volume') {
  const override = step?.[field]
  if (override === null || override === undefined || override === '') return readVolume(db, channel)
  return clampVolume(override, readVolume(db, channel))
}

// 흐름(FlowBuilder) 단계 유형 → 볼륨 채널.
// (2026-09-21: TV 송출 단계와 그 채널 `tv` 를 걷어냈다 — 사용자 결정 「TV 볼륨 없애기」.)
const FLOW_STEP_CHANNEL = {
  chime:      'tts',    // 차임벨은 안내 음성과 같은 채널을 쓴다(chimePlayer와 동일)
  tts:        'tts',
  audio:      'audio',
  video_file: 'media',
  bgm:        'bgm',
}

function flowStepChannel(stepType) {
  return FLOW_STEP_CHANNEL[stepType] ?? null
}

function isVolumeChannel(name) {
  return Object.prototype.hasOwnProperty.call(CHANNELS, name)
}

/**
 * 0~100 정수로 맞춘다. 숫자가 아니면 fallback.
 * 범위를 벗어난 값이 저장되면 재생 쪽(MCI 0-1000 등)에서 조용히 이상해지므로 입구에서 막는다.
 */
function clampVolume(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

// 읽기는 domain/settingsRead.js 한 곳을 쓴다 — 준비된 문장을 재사용하고, 여러 키는 한 번에 묻는다
const { rawSetting, rawSettingStrict, rawSettings } = require('./settingsRead')

/**
 * 한 채널의 볼륨(0~100). 정규 키 → 별칭 → fallback 순으로 본다.
 * @param {string} channel master|tts|audio|media|bgm
 */
function readVolume(db, channel) {
  const spec = CHANNELS[channel]
  if (!spec) throw new Error(`알 수 없는 볼륨 채널: ${channel}`)
  for (const key of [spec.key, ...spec.aliases]) {
    const raw = rawSetting(db, key)
    if (raw !== null && raw !== '') {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n)) return clampVolume(n, spec.fallback)
    }
  }
  return spec.fallback
}

/**
 * 같은 볼륨인데 **「모른다」를 기본값으로 덮지 않는다.** 값이 없으면 `null`, **못 읽으면 던진다.**
 *
 * 왜 따로 두나(V③ R20 지적 1, 2026-09-14): 위 `readVolume` 은 **재생용**이라 «값이 없다»
 * 와 «못 읽었다» 를 둘 다 기본값으로 바꾼다 — 소리를 내야 하니 그게 맞다.
 * 그런데 **판정용으로 쓰면 정반대가 된다.**
 *
 * 실제로 사고가 났다: 차임 판정이 «TV 볼륨이 0 인가» 를 물었는데 DB 조회가 죽으면
 * `rawSetting` 이 `null` → 여기서 **TV 기본값 100** → `100 > 0` 이라
 * **못 읽었는데 「소리가 난다」로 단정**해 차임을 막았다. 「모르는 것」이 「참」이 됐다.
 *
 * **재생 경로는 안 건드린다.** 이것을 부르는 쪽만 「모른다」를 보게 된다.
 * 볼륨을 `settings` 에서 직접 읽지 않는다는 규칙(CLAUDE.md 볼륨 규칙)은 그대로다 —
 * 판정도 이 모듈을 지난다.
 *
 * @returns {number|null} 0~100, 값이 없으면 null
 * @throws 조회 자체가 실패하면 던진다 — 부르는 쪽이 「모른다」를 다루게 한다
 */
function readVolumeOrNull(db, channel) {
  const spec = CHANNELS[channel]
  if (!spec) throw new Error(`알 수 없는 볼륨 채널: ${channel}`)
  for (const key of [spec.key, ...spec.aliases]) {
    const raw = rawSettingStrict(db, key)
    if (raw !== null && raw !== '') {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n)) return clampVolume(n, spec.fallback)
    }
  }
  return null
}

/** 전 채널을 한 번에 — GET /api/audio/volume, SSE 초기 동기화용 */
function readVolumes(db) {
  const out = {}
  for (const name of CHANNEL_NAMES) out[name] = readVolume(db, name)
  return out
}

// 설정 쓰기는 domain/settingsRead 한 곳을 지난다 — 여기서 자기 SQL로 쓰면 **변경 기록이
// 안 남는다**(2026-09-03, 설정 변경 기록을 그 통로에 붙였다). 볼륨은 사람이 가장 자주 만지는
// 설정이라 여기가 빠지면 기록이 반쪽이 된다.
const { writeSetting } = require('./settingsRead')

function putSetting(db, key, value) {
  writeSetting(db, key, value)
}

/**
 * 볼륨 저장. 넘어온 채널만 건드린다(부분 갱신).
 * 정규 키와 별칭을 **함께** 갱신하므로, 아직 옛 키를 보는 코드가 남아 있어도 값이 갈라지지 않는다.
 * @param   {object} patch { master?, tts?, audio?, media?, bgm? }
 * @returns {object} 실제로 저장된 값만 담은 객체(SSE로 그대로 보내면 된다)
 */
function writeVolumes(db, patch = {}) {
  const applied = {}
  for (const name of CHANNEL_NAMES) {
    const value = patch[name]
    if (value === undefined || value === null) continue
    const spec = CHANNELS[name]
    const v = clampVolume(value, spec.fallback)
    for (const key of [spec.key, ...spec.aliases]) putSetting(db, key, v)
    applied[name] = v
  }
  return applied
}

/**
 * 최초 1회 시딩 — 정규 키와 별칭을 기본값으로 채워 넣는다.
 *
 * 저장된 적이 없으면 화면·재생·SSE가 각자의 코드 기본값을 쓰게 되고, 그게 지금까지 볼륨이
 * 어긋나 보이던 주된 이유였다. 한 번 눈에 보이는 값으로 만들어 두면 어긋날 여지가 없다.
 * **이미 값이 있는 키는 절대 덮어쓰지 않는다**(현장에서 맞춰 둔 볼륨을 되돌리면 안 된다).
 */
function seedVolumeDefaults(db) {
  for (const name of CHANNEL_NAMES) {
    const spec = CHANNELS[name]
    // 정규 키가 비어 있어도 별칭에 값이 있으면 그 값을 정규 키로 승격한다 — 기존 설치의
    // 체감 볼륨을 기본값으로 덮어쓰지 않기 위함이다.
    const current = readVolume(db, name)
    for (const key of [spec.key, ...spec.aliases]) {
      if (rawSetting(db, key) === null) putSetting(db, key, current)
    }
  }
}

// 정성어 단계 → 실제 수치. "잔잔하게"가 몇 %인지는 스피커·공간마다 달라서 코드에 박으면
// 어르신들이 "너무 작다"고 할 때 배포를 다시 해야 한다. settings로 빼서 화면에서 고칠 수 있게 한다.
// (ontology.js는 낱말 → 단계까지만 알고, 숫자는 모른다)
const LEVEL_KEYS = {
  quiet: { key: 'volume_word_quiet', fallback: 30 },
  loud:  { key: 'volume_word_loud',  fallback: 85 },
}

/** { quiet: 30, loud: 85 } — 자연어 파서에 주입해서 쓴다 */
// 들어오는 볼륨 값이 받아들일 수 없는 값인가.
//
// **자르기(clamp)와 역할이 다르다.** 읽을 때는 계속 자른다 — DB에 이미 들어앉은 이상한 값
// 때문에 방송이 멈추면 안 된다. 막는 것은 들어오는 길뿐이다. 예약 저장(POST /api/schedules)이
// 쓰던 규칙과 같은 것을 볼륨 저장도 쓰게 해서, 같은 값을 어디로 넣든 같은 답이 나오게 한다:
// "조용히 자르지 않고 되묻는다 — 사람은 넣은 대로 될 거라 믿는다."
//
// null·undefined·''은 "안 보냈다"는 뜻이라 통과시킨다(부분 갱신). 0은 명시적 무음이라 유효하다.
function invalidVolumeValue(value) {
  if (value === null || value === undefined || value === '') return false
  const { isVolumeLike } = require('../services/scheduleStore')
  if (!isVolumeLike(value)) return true
  const n = Number(value)
  return n < 0 || n > 100
}

function readVolumeLevels(db) {
  const entries = Object.entries(LEVEL_KEYS)
  const got = rawSettings(db, entries.map(([, spec]) => spec.key))
  const out = {}
  for (const [level, spec] of entries) {
    const raw = got.get(spec.key)
    out[level] = raw === null || raw === undefined || raw === '' ? spec.fallback : clampVolume(raw, spec.fallback)
  }
  return out
}

/**
 * 정성어 수치 저장. 넘어온 단계만 건드린다(부분 갱신).
 * @returns {object} 실제로 저장된 값만 담은 객체
 */
function writeVolumeLevels(db, patch = {}) {
  const applied = {}
  for (const [level, spec] of Object.entries(LEVEL_KEYS)) {
    const value = patch[level]
    if (value === undefined || value === null || value === '') continue
    const v = clampVolume(value, spec.fallback)
    putSetting(db, spec.key, v)
    applied[level] = v
  }
  return applied
}

module.exports = {
  MAIN_CHANNEL_BY_TYPE,
  mainChannelFor,
  resolveMainVolume,
  resolveStepVolume,
  FLOW_STEP_CHANNEL,
  flowStepChannel,
  LEVEL_KEYS,
  invalidVolumeValue,
  readVolumeLevels,
  writeVolumeLevels,
  CHANNELS,
  CHANNEL_NAMES,
  ALL_VOLUME_KEYS,
  isVolumeChannel,
  clampVolume,
  readVolume,
  readVolumes,
  readVolumeOrNull,
  writeVolumes,
  seedVolumeDefaults,
}
