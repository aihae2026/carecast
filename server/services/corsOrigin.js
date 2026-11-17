// 어디서 온 브라우저 요청까지 받아줄지 정한다(CC-029).
//
// 예전엔 `cors({ origin: true })`였다 — 임의의 웹사이트가 방문자의 브라우저를 통해 이 서버의
// API를 부를 수 있었다는 뜻이다. 응답은 못 읽지만 요청은 실행된다(DELETE /api/broadcasts,
// POST /api/morning/stop). 화면이 쓰는 요청은 전부 application/json이라 프리플라이트를
// 거치므로, 출처를 좁히면 그 경로가 실제로 닫힌다.
//
// **반대 방향 위험이 더 크다**: 잘못 좁히면 원격 제어가 통째로 죽는다. 현장 PC·원격 PC·
// 직원 폰이 전부 같은 랜에서 붙고, 주소는 DHCP에 따라 바뀐다. 그래서 특정 IP를 적지 않고
// "사설망이면 허용"으로 판정한다 — 막는 것은 공인 인터넷 주소뿐이다.
'use strict'

// 사설 IPv4 대역 + 링크로컬(DHCP 실패 시 폰이 169.254.x를 쓴다).
// 172는 16~31만 사설이다 — 172.15·172.32는 공인 주소다.
const PRIVATE_IPV4 = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
]

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// 환경변수로 더 열 수 있는 안전 밸브 — 현장에서 판정이 틀려 원격 제어가 죽었을 때
// 코드 배포 없이 뚫을 길이 있어야 한다. 쉼표로 구분한 출처 문자열 그대로 대조한다.
function extraFromEnv() {
  return (process.env.CARECAST_EXTRA_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * @param {string|undefined} origin  브라우저가 보낸 Origin 헤더
 * @param {{extra?: string[]}} opts  추가 허용 목록(기본값은 CARECAST_EXTRA_ORIGINS)
 */
function isAllowedOrigin(origin, { extra = extraFromEnv() } = {}) {
  // Origin이 아예 없으면 같은 출처 탐색이거나 브라우저가 아닌 요청(curl, 시작 bat의
  // 헬스체크)이다. 여기서 막으면 화면이 통째로 안 뜬다.
  if (!origin) return true
  if (extra.includes(origin)) return true

  let host
  try {
    const u = new URL(origin)
    // http/https가 아닌 스킴(javascript:, file:)은 hostname이 비거나 의미가 없다
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    host = u.hostname
  } catch { return false }   // 'null'(샌드박스 iframe)·깨진 값은 여기서 걸린다
  if (!host) return false

  if (LOOPBACK.has(host)) return true
  if (PRIVATE_IPV4.some(re => re.test(host))) return true
  // 랜 안에서 이름으로 붙는 경우 — 공인 DNS에는 점 없는 이름이 없고 mDNS(.local)도
  // 인터넷에서 못 온다. 'http://192.168.0.15.evil.com'은 점이 있으므로 여기서 안 걸린다.
  if (!host.includes('.')) return true
  if (host.endsWith('.local')) return true

  return false
}

// cors 미들웨어에 그대로 넘길 수 있는 형태. 거부는 throw가 아니라 false다 —
// throw하면 500이 나가서 "서버가 고장났다"로 보인다. false면 CORS 헤더만 빠진다.
const seen = new Set()
function corsOriginCheck(origin, callback) {
  const ok = isAllowedOrigin(origin)
  if (!ok && origin && !seen.has(origin)) {
    seen.add(origin)   // 같은 출처를 매 요청 찍으면 로그가 그것만 남는다
    console.warn(`[cors] 차단된 출처: ${origin} (필요하면 CARECAST_EXTRA_ORIGINS에 추가)`)
  }
  callback(null, ok)
}

// ── 다른 사이트가 보낸 「쓰기」 요청을 막는다 (공개판 보안 점검 2026-10-18) ────────────────
//
// CORS 는 **응답을 못 읽게** 할 뿐 요청 실행은 막지 않는다. 브라우저는 「단순 요청」
// (form 전송·multipart·text/plain POST)을 프리플라이트 없이 바로 보낸다. 그래서 직원이 이 PC
// 나 같은 와이파이의 폰으로 **아무 외부 웹페이지**를 열어 두면 그 페이지가
// `POST /api/mic/broadcast`(multipart — 시설 스피커로 녹음 재생)·`POST /api/audio/upload`·
// 본문 없는 POST 를 그대로 실행시킬 수 있었다.
//
// 판정은 위의 출처 판정을 **그대로** 쓴다 — 허용 범위를 새로 만들지 않는다.
//  · 읽기(GET·HEAD·OPTIONS)는 건드리지 않는다.
//  · Origin 이 있으면 isAllowedOrigin 으로 본다('null' 포함, 틀리면 403).
//  · Origin 이 없고 브라우저가 `Sec-Fetch-Site: cross-site` 를 붙였으면 막는다.
//  · 둘 다 없으면 브라우저가 아닌 요청(curl·시작 bat·시험)이라 통과 — 예전과 같다.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
function isCrossSiteWrite(req, opts) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return false
  const origin = req.headers?.origin
  if (origin !== undefined && origin !== '') return !isAllowedOrigin(origin, opts)
  return String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site'
}

function crossSiteWriteGuard(req, res, next) {
  if (!isCrossSiteWrite(req)) return next()
  const o = req.headers?.origin || `(sec-fetch-site=${req.headers?.['sec-fetch-site']})`
  if (!seen.has('w:' + o)) {
    seen.add('w:' + o)
    console.warn(`[cors] 다른 사이트의 쓰기 요청을 막았습니다: ${req.method} ${req.path} ← ${o} (필요하면 CARECAST_EXTRA_ORIGINS에 추가)`)
  }
  res.status(403).json({ error: '다른 사이트에서 보낸 요청이라 막았습니다.' })
}

// ── 「이 서버를 어떤 이름으로 불렀나」(Host)도 같은 규칙으로 본다 (추가 점검 2026-11-01) ───────────
//
// **DNS 리바인딩**: 직원이 연 외부 사이트(evil.com)가 자기 DNS 를 이 PC 의 랜 주소로 바꾸면, 브라우저는
// 그 뒤 요청을 evil.com 과 **같은 출처**로 보고 GET 에 Origin 을 안 붙인다. 위 출처 판정은 Origin 이
// 없으면 통과라 방송 이력·캘린더 일정 같은 읽기 API 가 그 사이트로 새어 나갔다.
// 그런데 그 요청의 Host 는 여전히 `evil.com` 이다 — 사설 주소·localhost·점 없는 이름·.local 이 아닌
// Host 는 받지 않는다. 판정은 출처 판정을 **그대로** 쓰고, 안전 밸브(CARECAST_EXTRA_ORIGINS)도 같다.
// Host 가 없으면(HTTP/1.0·일부 시험 도구) 예전처럼 통과 — 브라우저는 늘 붙인다.
function isAllowedHost(host, { extra = extraFromEnv() } = {}) {
  if (!host) return true
  let hostname
  try { hostname = new URL(`http://${host}`).hostname } catch { return false }
  // 안전 밸브는 출처 문자열(https://pc.lan:3443)로 적으므로 이름만 견준다 — 포트·스킴은 Host 로 못 가린다.
  if (extra.some(o => { try { return new URL(o).hostname === hostname } catch { return false } })) return true
  return isAllowedOrigin(`http://${host}`, { extra: [] })
}

const seenHost = new Set()
function hostGuard(req, res, next) {
  const host = req.headers?.host
  if (isAllowedHost(host)) return next()
  if (!seenHost.has(host)) {
    seenHost.add(host)
    console.warn(`[host] 허용되지 않은 주소 이름으로 온 요청을 막았습니다: ${host} (필요하면 CARECAST_EXTRA_ORIGINS에 추가)`)
  }
  res.status(403).type('text/plain').send('이 주소 이름으로는 접속할 수 없습니다. 방송 PC 의 IP 주소나 localhost 로 접속해 주세요.')
}

// WebSocket 연결(/ws/audio)은 CORS 를 아예 안 거친다 — 외부 페이지가 `role=broadcaster` 로 붙으면
// 시설 스피커로 소리를 흘릴 수 있다. 같은 출처 판정으로 막는다(Origin 없는 비브라우저 연결은 통과).
function isAllowedUpgrade(req, opts) {
  return isAllowedOrigin(req.headers?.origin, opts) && isAllowedHost(req.headers?.host, opts)
}

module.exports = { isAllowedOrigin, corsOriginCheck, isCrossSiteWrite, crossSiteWriteGuard, isAllowedUpgrade, isAllowedHost, hostGuard }
