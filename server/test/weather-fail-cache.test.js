// 날씨 조회 실패가 성공과 똑같이 10분 캐시되는 것(CC-032).
//
// weather.js의 toCache는 실패(null)도 성공과 같은 CACHE_TTL(10분)로 저장한다.
// 07:44 크론 갱신이 일시 오류로 null을 받으면 그 null이 10분 동안 살아 있어서,
// 07:50 아침방송이 날씨를 통째로 뺀 채 나간다 — API는 07:45에 이미 회복됐는데도.
// 무인 시스템이라 "다시 눌러볼 사람"이 없으므로 실패는 짧게만 기억해야 하고,
// 최근 성공값이 있으면 그걸로라도 방송해야 한다(6시의 기온이 8시에 크게 다르지 않다).
//
// 이 테스트가 고정하는 기대 동작:
//   1) 실패(null)는 10분이 아니라 짧게(약 1분 이내)만 캐시된다.
//   2) 최근(3시간 이내) 성공값이 있으면 새 조회가 실패해도 그 성공값을 돌려준다.
// 시간 진행은 실제 sleep 대신 Date.now()를 갈아끼워 흉내낸다(fromCache/toCache가
// Date.now만 본다). fetch는 fetch-timeout.test.js와 같은 방식으로 갈아끼운다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_wfailcache_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const {
  fetchCurrentWeather,
  fetchMinMaxTemp,
  fetchAirQuality,
  fetchUVIndex,
  fetchApparentTemp,
  clearWeatherCache,
} = require('../services/weather')

// ── 시계 조작: Date.now()만 앞으로 민다 ─────────────────────────
const realDateNow = Date.now
let clockOffsetMs = 0
function advanceClock(ms) { clockOffsetMs += ms }

// ── fetch 조작: 성공(KMA 초단기 JSON) / 실패(네트워크 오류) 전환 ──
const realFetch = globalThis.fetch
let fetchMode = 'fail' // 'ok25' | 'fail'

function kmaJson(items) {
  return JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: items } } } })
}
function ymdNow() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function okResponse(url) {
  const u = String(url)
  // 에어코리아만 res.json()을 직접 읽는다(나머지는 fetchText → res.text())
  if (u.includes('ArpltnInforInqireSvc')) {
    return {
      ok: true, status: 200,
      json: async () => ({ response: { body: { items: [
        { pm10Value: '30', pm25Value: '15', pm10Grade1h: '2', pm25Grade1h: '2' },
      ] } } }),
    }
  }
  // 자외선(apihub)은 고정 텍스트 포맷
  if (u.includes('kma_sfctm_uv.php')) {
    return { ok: true, status: 200, text: async () => `# START7777\n#TM,STN,UV-B\n${ymdNow()}0900,119,3.5\n# 7777END\n` }
  }
  // 체감온도는 Open-Meteo current/daily
  if (u.includes('open-meteo')) {
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        current: {
          temperature_2m: 25, apparent_temperature: 26, wind_speed_10m: 3,
          relative_humidity_2m: 60, weather_code: 0, precipitation: 0, rain: 0, snowfall: 0, showers: 0,
        },
        daily: { temperature_2m_max: [29], temperature_2m_min: [18] },
      }),
    }
  }
  let items = []
  if (u.includes('getVilageFcst')) {
    const today = ymdNow()
    items = [
      { category: 'TMN', fcstDate: today, fcstTime: '0600', fcstValue: '18' },
      { category: 'TMX', fcstDate: today, fcstTime: '1500', fcstValue: '29' },
    ]
  } else if (u.includes('getUltraSrtNcst')) {
    items = [
      { category: 'T1H', obsrValue: '25' },
      { category: 'REH', obsrValue: '60' },
      { category: 'PTY', obsrValue: '0' },
      { category: 'RN1', obsrValue: '강수없음' },
    ]
  } else if (u.includes('getUltraSrtFcst')) {
    items = [
      { fcstTime: '0900', category: 'SKY', fcstValue: '1' },
      { fcstTime: '0900', category: 'T1H', fcstValue: '25' },
      { fcstTime: '0900', category: 'REH', fcstValue: '60' },
      { fcstTime: '0900', category: 'PTY', fcstValue: '0' },
    ]
  }
  return { ok: true, status: 200, text: async () => kmaJson(items) }
}

function setSetting(key, value) {
  getDB().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

test.before(() => {
  initDB()
  Date.now = () => realDateNow.call(Date) + clockOffsetMs
  globalThis.fetch = async (url) => {
    if (fetchMode === 'ok25') return okResponse(url)
    throw new Error('테스트: 일시적 네트워크 오류')
  }
})

test.after(() => {
  Date.now = realDateNow
  globalThis.fetch = realFetch
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('실패(null)는 10분이 아니라 짧게만 캐시된다 — 2분 뒤 재조회는 다시 API를 봐야 한다', async () => {
  clearWeatherCache()
  // 키가 하나도 없으면 weather.js가 null을 캐시에 넣는다(현재 코드 388행) — 07:44의 실패 상황
  const first = await fetchCurrentWeather()
  assert.equal(first, null, '전제: 키 없는 첫 조회는 null이어야 한다')

  // 07:45에 관리자가 키를 넣었고(또는 API가 회복됐고), 07:46에 다시 조회하는 상황
  setSetting('kma_apihub_key', 'test-key')
  fetchMode = 'ok25'
  advanceClock(2 * 60 * 1000) // 2분 — 실패 캐시(약 1분)는 끝났고, 성공 캐시(10분)라면 아직 유효한 시점

  const second = await fetchCurrentWeather()
  assert.ok(second != null,
    '실패가 성공과 같은 10분 캐시에 남아, 회복된 지 1분이 지나도 계속 "날씨 없음"으로 방송된다')
  assert.equal(second.temperature, 25)
})

test('최근 성공값이 있으면 새 조회가 실패해도 그 값을 돌려준다 — 없는 것보다 6시 기온이 낫다', async () => {
  clearWeatherCache()
  setSetting('kma_apihub_key', 'test-key')

  // 1) 성공 조회로 최근 성공값을 만든다
  fetchMode = 'ok25'
  const good = await fetchCurrentWeather()
  assert.equal(good?.temperature, 25, '전제: 성공 조회가 값을 돌려줘야 한다')

  // 2) 11분 뒤(정규 캐시는 만료, 성공 시점에서 3시간 이내) API가 죽어 있다
  advanceClock(11 * 60 * 1000)
  fetchMode = 'fail'

  const fallback = await fetchCurrentWeather()
  assert.ok(fallback != null,
    '최근(3시간 이내) 성공값이 있는데도 null을 돌려주면 아침방송에서 날씨가 통째로 빠진다')
  assert.equal(fallback.temperature, 25, '마지막 성공값(25도)으로 폴백해야 한다')
})

// ── CC-032 꼬리: 아침방송 문구가 쓰는 다른 조회들도 같은 폴백을 갖는다 ──────
// morning.js의 getMorningData()는 현재날씨 말고도 최저최고기온·미세먼지·자외선·체감온도를
// 함께 읽어서 문장을 만든다. 폴백이 현재날씨에만 걸려 있으면 같은 1분짜리 API 장애에
// "오늘 최저 18도 최고 29도"·"미세먼지 보통" 문장만 통째로 빠진 방송이 나간다.
const LAST_GOOD_CASES = [
  { name: '최저·최고기온', fetch: fetchMinMaxTemp,   value: v => v?.minTemp,   expected: 18 },
  { name: '미세먼지',      fetch: fetchAirQuality,   value: v => v?.pm10,      expected: '30' },
  { name: '자외선',        fetch: fetchUVIndex,      value: v => v?.today,     expected: 3.5 },
  { name: '체감온도',      fetch: fetchApparentTemp, value: v => v?.value,     expected: 26 },
]

for (const c of LAST_GOOD_CASES) {
  test(`${c.name}도 새 조회가 실패하면 최근 성공값으로 방송한다`, async () => {
    clearWeatherCache()
    setSetting('kma_apihub_key', 'test-key')
    setSetting('airkorea_api_key', 'test-key')

    fetchMode = 'ok25'
    const good = await c.fetch()
    assert.equal(c.value(good), c.expected, `전제: 성공 조회가 ${c.name} 값을 돌려줘야 한다`)

    // 11분 뒤(정규 캐시 만료, 성공 시점에서 3시간 이내) API가 죽어 있다
    advanceClock(11 * 60 * 1000)
    fetchMode = 'fail'

    const fallback = await c.fetch()
    assert.equal(c.value(fallback), c.expected,
      `${c.name}이 폴백 없이 null이 되면 아침방송에서 그 문장만 조용히 빠진다`)
  })
}

// 반대 방향 가드 — 이 테스트는 RED로 시작하지 않는다(고칠 것이 아니라 막을 것이다).
// 기상특보는 "지나간 값을 되풀이하면 안 되는" 종류다. 3시간 폴백을 걸면 이미 해제된
// 호우경보를 세 시간 동안 계속 방송한다. 번들(weatherBundle)도 특보를 안에 싣고 다니므로
// 같은 이유로 제외한다.
test('기상특보·날씨 번들에는 지난 성공값 폴백을 걸지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'weather.js'), 'utf8')
  // **먼저 감시 대상이 이 파일에 있는지부터 본다.** 아래는 "없을 것"만 보는 단언이라,
  // lastGoodFor 자체가 다른 파일로 옮겨가면 **아무 신호 없이 통과한다**(2026-09-05에 순수
  // 함수 232줄을 domain/weatherCodes.js로 내리면서 이 위험이 실제 조건이 됐다).
  // docs/big-file-split-design.md가 경고하는 "거짓 초록"과 같은 모양이다.
  assert.match(src, /function lastGoodFor\(/,
    'lastGoodFor가 weather.js에 없다 — 아래 단언은 감시할 대상이 없는 채로 통과한다')
  for (const key of ['alert', 'weatherBundle']) {
    assert.ok(!new RegExp(`lastGoodFor\\(\\s*['"]${key}['"]`).test(src),
      `${key}에 지난 성공값 폴백이 걸렸다 — 해제된 특보를 3시간 동안 되풀이 방송하게 된다`)
  }
})
