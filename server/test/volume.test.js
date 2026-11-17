// 볼륨 단일 소스(server/domain/volume.js).
//
// 이 모듈이 생기기 전에는 같은 볼륨을 가리키는 이름이 여럿이고 기본값이 제각각이라
// "화면엔 50인데 방송은 70", "TTS 설정 슬라이더는 소리에 영향 없음" 같은 일이 있었다.
// 그 상태로 돌아가지 않도록, 값 규칙과 **아무도 키를 직접 읽지 않는다**는 규칙을 같이 고정한다.
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_volume_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const {
  CHANNELS,
  CHANNEL_NAMES,
  ALL_VOLUME_KEYS,
  clampVolume,
  readVolume,
  readVolumes,
  writeVolumes,
  seedVolumeDefaults,
} = require('../domain/volume')

test.before(() => {
  initDB()
  // resolveBGM 이 BGM 을 풀려면 곡이 있어야 한다 — 빈 폴더면 null 이다(2026-09-21 이 PC 음원만)
  require('./helpers/localBgmFixture').로컬BGM심기(getDB())
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function put(key, value) {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
function drop(key) {
  getDB().prepare('DELETE FROM settings WHERE key = ?').run(key)
}
function dropAll() {
  for (const key of ALL_VOLUME_KEYS) drop(key)
}

// ── 값 규칙 ───────────────────────────────────────────────────
test('0~100 정수로 맞추고, 숫자가 아니면 기본값을 쓴다', () => {
  assert.equal(clampVolume(150, 50), 100)
  assert.equal(clampVolume(-10, 50), 0)
  assert.equal(clampVolume('45', 50), 45)
  assert.equal(clampVolume(45.6, 50), 46)
  for (const bad of ['', null, undefined, 'abc', NaN, {}, []]) {
    assert.equal(clampVolume(bad, 50), 50, `${JSON.stringify(bad)} → 기본값`)
  }
})

test('저장된 값이 없으면 채널 기본값을 쓴다', () => {
  dropAll()
  // (TV 송출 채널 tv 는 2026-09-21 걷어냈다 — 사용자 결정 「TV 볼륨 없애기」)
  assert.deepEqual(readVolumes(getDB()), { master: 70, tts: 80, audio: 100, media: 70, bgm: 70 })
})

test('BGM 기본값은 방송에서 실제로 들리던 70이다', () => {
  // 표시값이던 vol_bgm(50)에 맞추면 현장에서 방송 음악이 갑자기 작아진다.
  dropAll()
  assert.equal(readVolume(getDB(), 'bgm'), 70)
})

// ── 별칭 ──────────────────────────────────────────────────────
test('정규 키가 없으면 옛 이름을 순서대로 본다', () => {
  dropAll()
  put('vol_broadcast', 55)          // 지금까지 실제 재생이 읽던 값
  assert.equal(readVolume(getDB(), 'tts'), 55)

  dropAll()
  put('tts_volume', 33)             // 재생에 쓰인 적 없던 화면 전용 키
  assert.equal(readVolume(getDB(), 'tts'), 33)

  dropAll()
  put('bgm_broadcast_default', 42)
  assert.equal(readVolume(getDB(), 'bgm'), 42)
})

test('정규 키가 옛 이름보다 우선한다', () => {
  dropAll()
  put('vol_tts', 90)
  put('vol_broadcast', 10)
  assert.equal(readVolume(getDB(), 'tts'), 90)
})

test('저장하면 정규 키와 옛 이름이 같은 값이 된다', () => {
  dropAll()
  const applied = writeVolumes(getDB(), { tts: 65, bgm: 25 })
  assert.deepEqual(applied, { tts: 65, bgm: 25 }, '실제로 저장된 채널만 돌려준다')
  const get = (k) => getDB().prepare('SELECT value FROM settings WHERE key=?').get(k)?.value
  for (const k of ['vol_tts', 'vol_broadcast', 'tts_volume']) assert.equal(get(k), '65', k)
  for (const k of ['vol_bgm', 'bgm_broadcast_default'])       assert.equal(get(k), '25', k)
})

test('넘기지 않은 채널은 건드리지 않는다(부분 갱신)', () => {
  dropAll()
  writeVolumes(getDB(), { master: 40 })
  assert.equal(readVolume(getDB(), 'master'), 40)
  assert.equal(getDB().prepare("SELECT value FROM settings WHERE key='vol_tts'").get(), undefined)
})

test('범위를 벗어난 값은 저장 단계에서 막는다', () => {
  dropAll()
  writeVolumes(getDB(), { bgm: 500, master: -20 })
  assert.equal(readVolume(getDB(), 'bgm'), 100)
  assert.equal(readVolume(getDB(), 'master'), 0)
})

// ── 시딩 ──────────────────────────────────────────────────────
test('시딩은 비어 있는 키만 채우고 기존 값은 그대로 둔다', () => {
  dropAll()
  put('vol_master', 15)                       // 현장에서 맞춰 둔 값이라고 가정
  seedVolumeDefaults(getDB())
  assert.equal(readVolume(getDB(), 'master'), 15, '현장 설정을 기본값으로 덮으면 안 된다')
  assert.equal(readVolume(getDB(), 'tts'), 80)
  for (const key of ALL_VOLUME_KEYS) {
    assert.ok(
      getDB().prepare('SELECT value FROM settings WHERE key=?').get(key),
      `${key}가 비어 있으면 화면·재생이 각자 기본값을 쓰게 된다`
    )
  }
})

test('정규 키가 비어도 옛 이름에 값이 있으면 그 값으로 승격한다', () => {
  dropAll()
  put('vol_broadcast', 35)   // 옛 설치에서 실제로 쓰이던 볼륨
  seedVolumeDefaults(getDB())
  assert.equal(readVolume(getDB(), 'tts'), 35, '기존 체감 볼륨을 기본값으로 덮으면 안 된다')
  assert.equal(getDB().prepare("SELECT value FROM settings WHERE key='vol_tts'").get().value, '35')
})

// ── 드리프트 방어 ─────────────────────────────────────────────
test('볼륨 키를 직접 읽고 쓰는 코드가 이 모듈 밖에 없다', () => {
  // 기본값이 8곳에 흩어져 있던 것이 볼륨 불일치의 근본 원인이었다.
  // 새 코드가 다시 settings에서 볼륨 키를 직접 꺼내 쓰면 여기서 걸린다.
  const roots = ['routes', 'services', 'domain', 'db']
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  for (const r of roots) walk(path.join(__dirname, '..', r))
  files.push(path.join(__dirname, '..', 'index.js'))

  const offenders = []
  for (const file of files) {
    if (file.endsWith(path.join('domain', 'volume.js'))) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '')          // 주석은 설명용이라 제외
      for (const key of ALL_VOLUME_KEYS) {
        if (code.includes(`'${key}'`) || code.includes(`"${key}"`)) {
          offenders.push(`${path.relative(path.join(__dirname, '..'), file)}:${i + 1} → ${key}`)
        }
      }
    })
  }
  assert.deepEqual(offenders, [], `볼륨은 domain/volume.js로만 읽고 써야 한다:\n${offenders.join('\n')}`)
})

test('채널 정의가 온전하다', () => {
  assert.deepEqual(CHANNEL_NAMES, ['master', 'tts', 'audio', 'media', 'bgm'])
  const seen = new Set()
  for (const name of CHANNEL_NAMES) {
    const spec = CHANNELS[name]
    assert.equal(typeof spec.key, 'string')
    assert.equal(clampVolume(spec.fallback, -1), spec.fallback, `${name} 기본값이 0~100이어야 한다`)
    for (const key of [spec.key, ...spec.aliases]) {
      assert.ok(!seen.has(key), `${key}가 두 채널에 걸쳐 있다 — 저장 시 서로 덮어쓴다`)
      seen.add(key)
    }
  }
})

// ── 예약별 오버라이드 (되돌릴 상태를 만들지 않는다) ───────────
test('resolveBGM: 예약에 볼륨이 없으면 시스템 기본값을 싣는다', async () => {
  const { resolveBGM } = require('../services/scheduler')
  dropAll()
  writeVolumes(getDB(), { bgm: 55 })
  const r = await resolveBGM(getDB(), { bgm_enabled: 1, bgm_type: 'url', bgm_value: 'abc123' })
  assert.equal(r.bgmDefault, 55)
})

test('resolveBGM: 예약에 볼륨이 있으면 그 값만 싣고 시스템 설정은 건드리지 않는다', async () => {
  const { resolveBGM } = require('../services/scheduler')
  dropAll()
  writeVolumes(getDB(), { bgm: 55 })
  const r = await resolveBGM(getDB(), { bgm_enabled: 1, bgm_type: 'url', bgm_value: 'abc123', bgm_volume: 20 })
  assert.equal(r.bgmDefault, 20)
  assert.equal(readVolume(getDB(), 'bgm'), 55, '전역 설정이 바뀌면 되돌릴 상태가 생긴다 — 그러면 안 된다')
})

test('resolveBGM: 0(무음)도 오버라이드로 인정한다', async () => {
  const { resolveBGM } = require('../services/scheduler')
  dropAll()
  writeVolumes(getDB(), { bgm: 55 })
  const r = await resolveBGM(getDB(), { bgm_enabled: 1, bgm_type: 'url', bgm_value: 'abc123', bgm_volume: 0 })
  assert.equal(r.bgmDefault, 0)
})

// ── 주 소리 볼륨(main_volume) ─────────────────────────────────
// 예약 하나가 내는 소리는 대개 둘(주 소리 + BGM 반주)이라 컬럼도 둘만 둔다.
test('방송 유형마다 주 소리 채널이 정해져 있다', () => {
  const { mainChannelFor } = require('../domain/volume')
  assert.equal(mainChannelFor('text'), 'tts')
  assert.equal(mainChannelFor('chime'), 'tts')   // 차임벨은 안내 음성과 같은 채널을 쓴다
  assert.equal(mainChannelFor('audio'), 'audio')
  assert.equal(mainChannelFor('video'), 'media')
  // (외부 TV 송출 유형은 2026-09-21 걷어냈다 — 모르는 유형처럼 채널이 없다)
  assert.equal(mainChannelFor('youtube-tv'), null)
  assert.equal(mainChannelFor('bgm'), null, 'BGM은 bgm_volume이 맡는다')
  assert.equal(mainChannelFor('flow'), null, '단계마다 종류가 달라 한 값으로 못 정한다')
  assert.equal(mainChannelFor('없는유형'), null)
})

test('예약에 값이 없으면 그 채널의 시스템 기본값을 쓴다', () => {
  const { resolveMainVolume } = require('../domain/volume')
  dropAll()
  writeVolumes(getDB(), { tts: 60, audio: 90, media: 40 })
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'text' }), 60)
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'audio' }), 90)
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'video' }), 40)
})

test('예약에 값이 있으면 그 값만 쓰고 시스템 설정은 그대로 둔다', () => {
  const { resolveMainVolume } = require('../domain/volume')
  dropAll()
  writeVolumes(getDB(), { tts: 60 })
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'text', main_volume: 25 }), 25)
  assert.equal(readVolume(getDB(), 'tts'), 60, '되돌릴 상태를 만들면 안 된다')
})

test('0(무음)도 오버라이드로 인정하고, 빈 값은 기본값으로 넘어간다', () => {
  const { resolveMainVolume } = require('../domain/volume')
  dropAll()
  writeVolumes(getDB(), { tts: 60 })
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'text', main_volume: 0 }), 0)
  for (const empty of [null, undefined, '']) {
    assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'text', main_volume: empty }), 60)
  }
})

test('채널이 없는 유형은 주 소리 볼륨을 만들지 않는다', () => {
  const { resolveMainVolume } = require('../domain/volume')
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'bgm', main_volume: 30 }), null)
  assert.equal(resolveMainVolume(getDB(), { broadcast_type: 'flow', main_volume: 30 }), null)
})

// ── 정성어 수치 (현장에서 조정 가능해야 한다) ─────────────────
test('저장된 값이 없으면 기본값(잔잔하게 30 / 크게 85)을 쓴다', () => {
  const { readVolumeLevels, LEVEL_KEYS } = require('../domain/volume')
  for (const spec of Object.values(LEVEL_KEYS)) drop(spec.key)
  assert.deepEqual(readVolumeLevels(getDB()), { quiet: 30, loud: 85 })
})

test('저장하면 그 값을 읽고, 넘기지 않은 단계는 그대로 둔다', () => {
  const { readVolumeLevels, writeVolumeLevels, LEVEL_KEYS } = require('../domain/volume')
  for (const spec of Object.values(LEVEL_KEYS)) drop(spec.key)
  assert.deepEqual(writeVolumeLevels(getDB(), { quiet: 15 }), { quiet: 15 })
  assert.deepEqual(readVolumeLevels(getDB()), { quiet: 15, loud: 85 })
})

test('범위를 벗어난 값은 저장 단계에서 잘라낸다', () => {
  const { readVolumeLevels, writeVolumeLevels } = require('../domain/volume')
  writeVolumeLevels(getDB(), { quiet: -5, loud: 500 })
  assert.deepEqual(readVolumeLevels(getDB()), { quiet: 0, loud: 100 })
})

test('설정한 수치가 자연어 파싱 결과에 그대로 반영된다', () => {
  // 이게 이 설정의 존재 이유다 — 배포 없이 "잔잔하게"의 크기를 바꿀 수 있어야 한다
  const { readVolumeLevels, writeVolumeLevels } = require('../domain/volume')
  const { parseSchedulePhrase } = require('../services/schedulePhrase')
  const NOW = new Date(2026, 7, 27, 10, 0, 0)

  writeVolumeLevels(getDB(), { quiet: 12 })
  let r = parseSchedulePhrase('오후 2시 안내, 볼륨은 잔잔하게', NOW, { volumeLevels: readVolumeLevels(getDB()) })
  assert.equal(r.bgm_volume, 12)

  writeVolumeLevels(getDB(), { quiet: 55 })
  r = parseSchedulePhrase('오후 2시 안내, 볼륨은 잔잔하게', NOW, { volumeLevels: readVolumeLevels(getDB()) })
  assert.equal(r.bgm_volume, 55, '설정을 바꿨는데 파싱 결과가 안 따라오면 이 설정은 의미가 없다')
})

test('화면의 유형→채널 표가 서버와 같다', () => {
  // 어긋나면 "안내 음성 볼륨"이라 써놓고 실제로는 영상 볼륨이 바뀌는 식이 된다.
  const { MAIN_CHANNEL_BY_TYPE } = require('../domain/volume')
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'scheduleUtils.js'), 'utf8')
  const block = src.match(/export const MAIN_VOLUME_CHANNEL = \{([\s\S]*?)\n\}/)
  assert.ok(block, 'scheduleUtils.js에서 MAIN_VOLUME_CHANNEL을 찾지 못했다')

  const client = {}
  for (const m of block[1].matchAll(/'?([\w-]+)'?\s*:\s*(?:'([^']+)'|null)/g)) {
    client[m[1]] = m[2] ?? null
  }
  assert.deepEqual(client, MAIN_CHANNEL_BY_TYPE)
})
