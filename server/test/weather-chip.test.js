'use strict'
// **머리줄 날씨 칩은 반나절에 한 번만 받는다** (사용자 지시 2026-09-15).
//
// *"그냥 오전 오후 한번씩만 불러와서 그걸로 쓰면 되잖아"*
//
// 이 칩이 말하는 것(오늘의 최고·최저·습도·자외선)은 하루 사이에 거의 안 바뀌고,
// 공공데이터 개발 계정은 **하루 1만 건** 한도가 있다. 화면이 30초마다 물어도
// 바깥으로는 **반나절에 한 번**만 나가야 한다.
//
// 시계에 기대지 않는다 — `반나절칸`·`아직쓸만한가` 에 **날짜를 넣어** 부른다.
// (`feedback_carecast_fake_oracle` 의 세 모양 중 「시계에 기댐」을 피한다.)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 반나절칸, 칩만들기, 아직쓸만한가 } = require('../domain/weatherChip')

const 때 = (s) => new Date(s)

test('하루가 **오전·오후 두 칸**으로 갈린다 — 12시가 경계다', () => {
  assert.equal(반나절칸(때('2026-09-15T00:00:00')), '2026-09-15/오전')
  assert.equal(반나절칸(때('2026-09-15T11:59:59')), '2026-09-15/오전')
  assert.equal(반나절칸(때('2026-09-15T12:00:00')), '2026-09-15/오후')
  assert.equal(반나절칸(때('2026-09-15T23:59:59')), '2026-09-15/오후')
})

test('날이 바뀌면 칸도 바뀐다 — 어제 오후 값을 오늘 오전에 쓰면 안 된다', () => {
  assert.notEqual(반나절칸(때('2026-09-15T13:00:00')), 반나절칸(때('2026-09-16T13:00:00')))
})

test('**같은 칸 안에서는 다시 안 받는다**', () => {
  const 받아둔것 = 칩만들기({ maxTemp: 21, minTemp: 9, humidity: 60 }, 때('2026-09-15T13:00:00'))
  assert.equal(아직쓸만한가(받아둔것, 때('2026-09-15T13:00:01')), true, '1초 뒤에 또 받는다')
  assert.equal(아직쓸만한가(받아둔것, 때('2026-09-15T23:59:00')), true, '같은 오후인데 또 받는다')
})

test('**칸이 바뀌면 다시 받는다** — 오전 값을 저녁까지 쓰면 최고기온이 틀린다', () => {
  const 오전것 = 칩만들기({ maxTemp: 21, minTemp: 9 }, 때('2026-09-15T09:00:00'))
  assert.equal(아직쓸만한가(오전것, 때('2026-09-15T12:00:00')), false, '오후가 됐는데 오전 값을 쓴다')
  assert.equal(아직쓸만한가(오전것, 때('2026-09-16T09:00:00')), false, '다음 날인데 어제 값을 쓴다')
  assert.equal(아직쓸만한가(null, 때('2026-09-15T09:00:00')), false, '받아 둔 것이 없는데 쓸만하다고 한다')
})

test('묶음에서 칩이 쓸 것만 뽑고 **반올림**한다', () => {
  const 칩 = 칩만들기({
    maxTemp: 21.4, minTemp: 8.6, temperature: 18.5, humidity: 62.3,
    uv: { value: 3, level: '낮음' }, sky: '구름조금', fetchedAt: '2026-09-15T13:00:00+09:00',
  }, 때('2026-09-15T13:00:00'))
  assert.equal(칩.최고, 21)
  assert.equal(칩.최저, 9)
  assert.equal(칩.습도, 62)
  assert.equal(칩.자외선, '낮음')
  assert.equal(칩.자외선수치, 3)
  assert.equal(칩.하늘, '구름조금')
  assert.equal(칩.칸, '2026-09-15/오후')
})

test('**없는 값은 지어내지 않는다** — null 로 둔다', () => {
  // 「-」나 「0」으로 채우면 사람이 그것을 값으로 읽는다. 화면은 null 칸을 안 그린다.
  const 칩 = 칩만들기({ maxTemp: 21, minTemp: null, humidity: undefined, uv: null }, 때('2026-09-15T13:00:00'))
  assert.equal(칩.최저, null)
  assert.equal(칩.습도, null)
  assert.equal(칩.자외선, null)
  assert.equal(칩.최고, 21, '멀쩡한 값까지 지웠다')
})

test('**하나도 없으면 칩을 아예 안 만든다** — 빈 껍데기를 그리면 안 된다', () => {
  assert.equal(칩만들기({ maxTemp: null, minTemp: null, humidity: null, uv: null }), null)
  assert.equal(칩만들기(null), null)
  assert.equal(칩만들기(undefined), null)
})

test('숫자가 아닌 것이 와도 안 죽고 null 이 된다', () => {
  // 바깥 API 가 문자열·NaN 을 준 적이 있다. 화면에 「NaN°」가 뜨면 안 된다.
  const 칩 = 칩만들기({ maxTemp: '이십일', minTemp: NaN, temperature: 18 }, 때('2026-09-15T13:00:00'))
  assert.equal(칩.최고, null)
  assert.equal(칩.최저, null)
  assert.equal(칩.지금기온, 18)
})

// ── 라우트가 실제로 이 규칙을 쓰는지 소스로 고정한다 ────────────────────────
test('**라우트가 반나절 규칙을 쓴다** — 안 쓰면 요청마다 바깥으로 나간다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/weather.js'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /router\.get\('\/chip'/, '칩 끝점이 없다')
  const i = 코드만.indexOf("router.get('/chip'")
  // **고정 길이로 자르지 않는다.** 처음엔 `slice(i, i + 1600)` 이었는데 그 창이 **다음
  // 라우트까지** 삼켰고, 거기 있는 `clearWeatherCache()` 를 이 끝점의 것으로 읽어
  // 엉뚱하게 빨간불이 났다 — 반대로 진짜 문제를 가릴 수도 있는 자르기다
  // (`feedback_carecast_fake_oracle` 의 「고정 창으로 소스 자르기」).
  // **다음 라우트가 시작하는 자리**에서 끊는다.
  const 다음 = 코드만.slice(i + 10).search(/router\.(get|post|put|delete)\(/)
  const 블 = 다음 >= 0 ? 코드만.slice(i, i + 10 + 다음) : 코드만.slice(i)
  assert.ok(블.length > 200 && 블.length < 3000,
    `끝점 하나만 잘라야 한다 — ${블.length}자를 읽었다`)
  assert.match(블, /아직쓸만한가\(/, '받아 둔 것을 다시 쓰지 않는다 — 요청마다 바깥으로 나간다')
  assert.match(블, /칩만들기\(/, '칩을 만드는 규칙을 안 쓴다')
  // **캐시를 지우면 안 된다.** 옆의 진단 끝점들은 `clearWeatherCache()` 를 부르는데,
  // 그것을 여기 복사해 오면 반나절 규칙이 무의미해진다(부를 때마다 새로 받는다).
  assert.ok(!블.includes('clearWeatherCache'),
    '칩 끝점이 캐시를 지운다 — 반나절에 한 번이라는 규칙이 무너진다')
})

test('**화면이 이 끝점을 쓴다** — 길만 만들고 안 쓰면 소용없다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/lib/api.js'), 'utf8')
  assert.match(api, /getWeatherChip/, 'api 에 부르는 자리가 없다')
  assert.ok(api.includes("'/api/weather/chip'"), 'api 가 다른 주소를 부른다')
})

// ── **Open-Meteo 값이 칩에 섞이면 칩 옆에 출처를 단다** (사용자 지시 2026-10-07) ──────────────
// *"출처표시에도 날씨 달고 거기도 하면 안돼?"* — Open-Meteo 원문(open-meteo.com/en/licence)은 「데이터를
// 보여 주는 자리 옆에」 `Weather data by Open-Meteo.com` 링크를 요구한다. 칩의 최고·최저(기상청 단기예보 실패 시)와
// 습도(초단기 실황이 없을 때)는 Open-Meteo 로 채워질 수 있다(`services/weather.js` 의 묶음).
// **기상청 값만 보일 때는 달지 않는다** — 쓰지 않은 출처를 다는 것도 틀린 고지다.
test('**Open-Meteo 값이 칩에 있을 때만 출처 표시가 켜진다**', () => {
  const 기상청 = { maxTemp: 25, minTemp: 15, humidity: 60, humiditySource: 'kma', dataSources: { weather: 'kma', minmax: 'kma' } }
  assert.equal(칩만들기(기상청).오픈메테오, false, '기상청 값뿐인데 Open-Meteo 출처를 단다')
  assert.equal(칩만들기({ ...기상청, dataSources: { weather: 'kma', minmax: 'open-meteo' } }).오픈메테오, true,
    '최고·최저가 Open-Meteo 인데 출처가 없다')
  assert.equal(칩만들기({ ...기상청, humiditySource: 'open-meteo' }).오픈메테오, true, '습도가 Open-Meteo 인데 출처가 없다')
  // 그 칸이 비어 있으면(값을 안 그리면) 출처도 없다 — 기본값 'open-meteo' 를 그대로 믿지 않는다.
  assert.equal(칩만들기({ humidity: 60, humiditySource: 'kma', dataSources: { minmax: 'open-meteo' } }).오픈메테오, false,
    '최고·최저가 비었는데(안 그리는데) 그 출처를 단다')
})

test('**날씨 묶음이 습도의 출처를 적는다 · 화면이 출처 링크를 그린다**', () => {
  const w = fs.readFileSync(path.join(ROOT, 'server/services/weather.js'), 'utf8')
  assert.match(w, /humiditySource:/, '습도가 어디서 왔는지 묶음에 없다 — 칩이 Open-Meteo 여부를 모른다')
  const 칩화면 = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeWeatherChip.jsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(칩화면, /칩\.오픈메테오 &&/, '칩이 출처 표시를 조건으로 그리지 않는다')
  assert.match(칩화면, /https:\/\/open-meteo\.com\//, '원문이 요구하는 링크가 없다')
  assert.match(칩화면, /Weather data by Open-Meteo\.com/, '원문이 요구하는 글이 없다')
})
