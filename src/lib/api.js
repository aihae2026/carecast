// Vite 프록시를 통해 같은 origin으로 API 접근 — Mixed Content 없음, 인터넷 접속 지원
import { TAB_ID, CAN_OWN_SOUND } from './tabId'
import { isSoundReady } from './audioStreamState'
import { 안내중 } from './tourStage'
const API_URL = ''

// 처음 안내 중에도 통과하는 **보고** 주소 — 소리를 새로 내지 않고, 이미 나가는 방송의 상태만 알린다(아래 fetchT).
const 안내중보고주소 = [
  /^\/api\/morning\/(audio-ended|video-ended|play-started)$/,
  /^\/api\/status\/now-playing$/,
  /^\/api\/broadcasts$/,                 // 재생 실패 경보 기록(이력 한 줄) — 소리 없음
  /^\/api\/audio\/files\/\d+\/duration$/,
]
function 안내중에도보고(url) {
  const 경로 = String(url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  return 안내중보고주소.some((re) => re.test(경로))
}

// fetch에 타임아웃 적용 (기본 10초) — 서버 응답 없을 때 무한 대기 방지
function fetchT(url, options = {}, ms = 10000) {
  // ── **처음 안내 중에는 아무것도 서버에 쓰지 않는다** (사용자 확정 조건 2026-09-17) ─────────
  // *"안내 중에 밝혀진 단추를 눌러도 실제 방송이 나가지 않게 막아야 합니다 … 응 그렇게 해 기억했다가"*
  // 안내는 실제 부품을 움직인다. 부품이 실수로 저장·방송·차임을 불러도 **보내기 전에** 여기서 끊는다.
  // 모든 쓰기 창구(apiPost·apiPut·apiPatch·apiDelete)가 이 함수를 지나므로 **한 자리**면 된다.
  // 읽기(GET)는 막지 않는다 — 순서·단계 목록을 보여 줘야 한다.
  //
  // **단, 이미 나가고 있는 방송의 「보고」는 막지 않는다** (2026-09-17 독립 검수 F1). 끝 알림(audio/video-ended)·
  // 재생 시작·지금 재생 중·재생 실패 기록은 새 소리를 내지 않는다. 막으면 서버가 끝 알림을 상한(음원 180초·
  // 영상 480초)까지 기다리며 레인이 켜진 채 남고, 그동안 예약이 밀리거나 버려진다 — 안내와 방송이 겹치는 순간에.
  const 방식 = String(options.method || 'GET').toUpperCase()
  if (방식 !== 'GET' && 안내중() && !안내중에도보고(url)) {
    return Promise.reject(Object.assign(new Error('처음 안내 중이라 실제로 보내지 않았습니다.'), { tour: true }))
  }
  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...options, signal: ctrl.signal })
    .then(res => { clearTimeout(tid); return res })
    // 초과 시간을 문구에 그대로 적는다 — 예전엔 10초로 박아 놔서, 25초짜리 받아쓰기가
    // 끊겼는데도 "10초 초과"라고 떠서 원인을 엉뚱한 데서 찾게 만들었다.
    .catch(err => {
      clearTimeout(tid)
      if (err.name === 'AbortError') throw new Error(`서버 응답 없음 (${Math.round(ms / 1000)}초 초과)`)
      throw err
    })
}

// 응답 본문을 JSON 으로 읽는다. **JSON 이 아니면 사람 말로 바꾼다** (2026-09-12).
//
// 왜 필요했나: 서버는 모르는 주소에 **SPA 화면(HTML)을 200 으로** 돌려준다(`index.js` 의
// 마지막 catch-all — 새로고침해도 주소가 살아 있게 하는 장치다). 그래서 없는 엔드포인트를
// 부르면 `res.ok` 가 참인데 본문이 HTML 이고, `res.json()` 이
// `Unexpected token '<', "<!doctype "... is not valid JSON` 을 던진다.
//
// 그 문구가 **현장 직원 화면에 그대로 나간다.** 실제로 날 수 있는 상황이다 — 자동 업데이트가
// 서버를 바꾼 뒤 아직 새로고침 안 한 창이 옛 주소를 부르면 정확히 이 모양이 된다
// (CLAUDE.md 의 자동 새로고침 단서 둘이 모두 조건부다).
//
// 그래서 **무엇이 문제이고 다음에 뭘 하면 되는지**로 바꾼다(UX-10 연동 오류 규약).
async function 본문JSON(res, path) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    const HTML인가 = /^\s*<(!doctype|html)/i.test(text)
    throw Object.assign(new Error(
      HTML인가
        ? `이 화면이 서버에 없는 주소(${path})를 불렀습니다. 업데이트 직후라면 새로고침(F5)하면 맞춰집니다.`
        : `서버가 알 수 없는 형식으로 답했습니다 (${path}).`,
    ), { status: res.status, notJson: true })
  }
}

/**
 * 실패 응답의 **본문을 버리지 않는다** (V③ R19 지적 6, 2026-09-14).
 *
 * 예전에는 `res.json().catch(() => ({ error: res.statusText }))` 였다. 서버가 JSON 이
 * 아닌 것으로 답하면 — 프록시가 끼어들거나, 디스크가 찬 503 처럼 평문으로 답할 때 —
 * **서버가 알려 준 진짜 이유를 통째로 버리고** `Service Unavailable` 같은 껍데기만 남겼다.
 * 실측: 503 본문 `disk unavailable: retry later` 가 세 함수 전부에서 사라졌다.
 *
 * 그래서 **한 번만 읽어(text) 판단한다**:
 *   · JSON 이면 그대로 — `error`·`data` 를 쓰는 기존 호출부가 그대로 돈다
 *   · 평문이면 그 문장을 쓴다 — 사람에게 쓸모 있는 유일한 단서다
 *   · HTML 이면 버린다 — 오류 페이지 원문은 사람에게 아무 도움이 안 된다
 *   · 비어 있으면 기본 문구
 *
 * 본문을 **두 번 읽지 않는다** — `res.json()` 뒤에 `res.text()` 를 부르면 스트림이 이미
 * 소비돼 빈 문자열이 나온다. 그래서 `본문JSON` 과 같은 모양으로 text 를 먼저 받는다.
 */
async function 오류본문(res, 기본) {
  const 뒷말 = 기본 || res.statusText || '서버 오류'
  const text = await res.text().catch(() => '')
  if (!text.trim()) return { error: 뒷말 }
  try { return JSON.parse(text) } catch { /* 평문이거나 HTML 이다 — 아래에서 가른다 */ }
  if (/^\s*<(!doctype|html)/i.test(text)) return { error: 뒷말 }
  return { error: text.replace(/\s+/g, ' ').trim().slice(0, 300) }
}

export async function apiGet(path) {
  const res = await fetchT(`${API_URL}${path}`)
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try { msg = JSON.parse(text).error || text } catch { /* 서버가 JSON이 아닌 오류(HTML·빈 본문)를 줄 수 있다 — 그때는 원문을 그대로 보여준다 */ }
    throw new Error(msg)
  }
  return 본문JSON(res, path)
}

// **누가 보냈는지를 실어 보낸다** (P-16, 2026-09-11).
//
// 서버가 "예약이 바뀌었다"를 모든 화면에 쏘는데, **바꾼 화면까지 다시 읽으면 깜빡인다**
// (그 화면은 이미 자기 상태를 고쳤다). 이 머리글을 보고 받는 쪽이 자기 것을 건너뛴다.
// `TAB_ID` 는 소리 담당을 정할 때 쓰는 것과 **같은 이름표**다 — 두 벌로 만들지 않는다.
const 보낸이머리글 = { 'X-CareCast-Tab': TAB_ID }

export async function apiPost(path, body, ms) {
  const res = await fetchT(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...보낸이머리글 },
    body: JSON.stringify(body),
  }, ms)
  if (!res.ok) {
    const err = await 오류본문(res)
    // 상태코드와 응답 본문을 Error에 실어둔다 — 민감정보 확인(409)처럼 단순 에러가 아닌
    // 응답을 구분해야 하는 곳에서 쓴다. 기존 호출부는 .message만 보므로 영향 없음.
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status, data: err })
  }
  return 본문JSON(res, path)
}

export async function apiPut(path, body) {
  const res = await fetchT(`${API_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...보낸이머리글 },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await 오류본문(res)
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status, data: err })
  }
  return 본문JSON(res, path)
}

// 민감정보 확인(409) 처리 — 서버가 "이름이 포함됐는데 진행할까요?"로 되물으면
// 확인창을 띄우고, 사용자가 승인하면 ackWarnings를 붙여 한 번만 재요청한다.
//
// 이 처리를 화면마다 넣으면 방송 보내는 곳이 5군데라 빠뜨리기 쉬워서, 여기 한 곳에 둔다.
// (차단(400)은 되물을 것 없이 그대로 에러로 올라간다)
async function postWithConfirm(path, body, ms) {
  try {
    return await apiPost(path, body, ms)
  } catch (e) {
    if (e.status !== 409 || !e.data?.needsConfirm) throw e
    if (!window.confirm(e.message)) {
      throw Object.assign(new Error('사용자가 취소했습니다.'), { cancelled: true })
    }
    return apiPost(path, { ...body, ackWarnings: true }, ms)
  }
}

async function putWithConfirm(path, body) {
  try {
    return await apiPut(path, body)
  } catch (e) {
    if (e.status !== 409 || !e.data?.needsConfirm) throw e
    if (!window.confirm(e.message)) {
      throw Object.assign(new Error('사용자가 취소했습니다.'), { cancelled: true })
    }
    return apiPut(path, { ...body, ackWarnings: true })
  }
}

export async function apiDelete(path) {
  const res = await fetchT(`${API_URL}${path}`, { method: 'DELETE', headers: { ...보낸이머리글 } })
  // **본문을 통째로 던지지 않는다** (2026-09-13, 브라우저 검증에서 드러났다).
  //
  // 여기만 `res.text()` 였다 — `apiPost`·`apiPut` 은 진작 JSON 을 풀어 `error` 만 꺼내고
  // `status`·`data` 를 얹어 던진다. 그래서 폴더 삭제가 막혔을 때 화면에
  // `{"error":"…","usedBy":[{"tab":"morning",…}]}` 라는 **JSON 원문이 그대로** 떴다.
  // 사람은 그것을 못 읽고, 어디서 쓰고 있는지도 못 본다.
  //
  // `data` 를 얹는 것이 핵심이다 — 부르는 쪽이 `usedBy`(사용처 목록)를 꺼내 쓸 수 있어야
  // "이 폴더를 어디서 쓰고 있습니다"를 문장으로 지을 수 있다.
  if (!res.ok) {
    const err = await 오류본문(res)
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status, data: err })
  }
  return 본문JSON(res, path)
}

// TTS 미리 듣기 → 오디오 Blob 반환 (voice/rate/pitch 생략 시 서버 DB 설정 사용)
// sid = 이 PC 음성 목소리 번호(0~9) — 설정 화면이 **저장 전에** 고른 목소리로 들려준다. 빠뜨리면 저장된 목소리로 나간다(사용자 신고 2026-09-22).
export async function ttsPreview({ text, voice, rate, pitch, sid, pauseMs } = {}) {
  const res = await fetch(`${API_URL}/api/tts/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate, pitch, ...(sid != null ? { sid } : {}), ...(pauseMs != null ? { pauseMs } : {}) }),
  })
  if (!res.ok) {
    const err = await 오류본문(res, '서버 오류')
    throw new Error(err.error)
  }
  return res.blob()
}

/**
 * **차임을 지금 내보낸다** (사용자 결정 2026-09-15).
 *
 * 2026-09-14 지시는 *"차임벨을 독립 실행 모드로 만들지 마라 — 설정 패널만"* 이었는데,
 * 09-15 에 **뒤집혔다**: *"진짜 소리나는 시작차임, 종료차임 이걸로 소리나가는걸로"*.
 * 설정(켬/끔)은 「지금 방송」·「누르고 말하기」 쪽으로 옮기고, 이 단추는 **발사**만 한다.
 *
 * **전관 스피커로 나간다. 되돌릴 수 없다.** 그래서 부르는 쪽이 연타를 막아야 한다.
 *
 * @param {'general'|'end'} 종류 시작 차임 / 종료 차임
 */
export async function fireChime(종류 = 'general') {
  const t = 종류 === 'end' ? 'end' : 'general'
  // ── `wait=1` — **결과를 알고 싶은 쪽**이다 (V③ UI-0915-R2) ────────────────────
  // 이 단추는 사람이 "났나?" 를 보려고 누른다. 그래서 재생이 끝날 때까지 기다려
  // 성공·실패·모름을 받는다. **마이크·즐겨찾기는 안 붙인다** — 그쪽은 빨리 돌아와야
  // 하고(차임 뒤 2.6초에 맞춰 목소리를 보내기 시작한다) 계약도 예전 그대로다.
  //
  // **제한시간을 서버보다 길게 준다.** 기본값이 10초인데 서버의 기다림 상한이 12초라,
  // 그냥 두면 **브라우저가 먼저 끊어** 서버가 보내는 504 「났는지 확인하지 못했습니다」를
  // 영영 못 받는다(검수관이 실측). 통신 여유까지 얹어 15초로 둔다.
  //
  // ── **반드시 끝난다** (V③ UI-0915-R4 지적) ───────────────────────────────────
  // `fetchT` 는 **머리글을 받는 순간** 제한시간을 푼다. 그 뒤 본문을 읽다가 멈추면
  // (`res.text()`) 이 약속이 **영영 안 끝난다.** 부르는 쪽은 그 약속의 `finally` 에서
  // 빗장을 푸는데, 안 끝나니 **차임 단추가 영영 안 먹는다** — 이 저장소가 가장 경계하는
  // 「열쇠가 끼는」 고장이다(`duplicateBroadcast` 머리말).
  //
  // 그래서 여기서 **바깥 울타리**를 하나 더 두른다. 본문이 멈춰도 20초면 끝난다.
  // (`apiPost` 의 본문 대기까지 제한시간을 끌고 가는 것이 더 근본이지만, 그건 이 창구
  //  하나가 아니라 **모든 호출부**의 동작을 바꾸는 일이라 따로 다룬다 — 남은 일에 적었다.)
  const 바깥울타리ms = 20_000
  return Promise.race([
    apiPost(`/api/mic/chime?type=${t}&wait=1`, {}, 15_000),
    new Promise((_, rej) => setTimeout(
      () => rej(new Error('차임벨 응답이 오지 않았습니다. 소리를 들어 보세요.')), 바깥울타리ms)),
  ])
}

// TTS 방송 → 서버 스피커로 재생 (클라이언트 오디오 없음)
// priority=true면 현재 재생 중단 후 즉시 재생 (비상방송)
export async function ttsBroadcast({
  text, voice, target, priority, chimeStart, chimeEnd,
  // ── 「지금 방송」이 예약 경로에서 넘어오며 함께 오는 것들 (B-3, 2026-09-14) ─────
  // **안 주면 예전 그대로다** — 「누르고 말하기」·즐겨찾기·비상방송에 회귀가 없다.
  volume, repeat, bgm,
} = {}) {
  // TTS 생성에 시간이 걸릴 수 있어 30초 타임아웃.
  // **BGM 을 깔면 그만큼 더 걸린다** — 반주를 먼저 틀고 `bgm_delay`(기본 5초)를 기다린 뒤
  // 안내가 나가기 때문이다. 그 시간을 못 기다리면 화면이 실패로 읽는다(실제로는 나가는 중).
  const 여유 = bgm ? (Number(bgm.bgm_delay ?? 5) + Number(bgm.bgm_end_delay ?? 0)) * 1000 : 0
  // 민감정보 경고(409)는 postWithConfirm이 확인창 → 재요청까지 처리한다.
  return postWithConfirm(
    '/api/tts/broadcast',
    { text, voice, target, priority, chimeStart, chimeEnd, volume, repeat, bgm },
    30000 + 여유,
  )
}

/**
 * **음성을 미리 만들어 둔다** — 소리도 이력도 없다(2026-09-17 느림 신고). 「지금 방송」 카드가 떠 있는 동안 부른다.
 * 실패해도 아무 일 없다 — 방송 때 다시 만든다. 그래서 오류를 삼킨다.
 */
export function prepareTTS({ text, repeat } = {}) {
  return apiPost('/api/tts/prepare', { text, repeat: !!repeat }, 5000).catch(() => null)
}

/**
 * **배경음악을 지금 내보낸다 — 예약 행을 안 남긴다** (사용자 결정 2026-09-15).
 *
 * 그전에는 화면이 예약을 하나 만들고 그것을 실행했다. 그 행은 꺼진 채로 **지워지지
 * 않아서**, 즉시 방송을 쓸 때마다 달력에 흐린 줄이 하나씩 쌓였다.
 * 규칙은 「즉시는 휘발성, 업로드는 영구」다(`docs/journal/decisions.md`).
 *
 * 전관 스피커로 나간다 — 부르는 쪽이 연타를 막는다.
 */
export const startBgmNow = (bgm) => apiPost('/api/audio/bgm/now', bgm || {}, 20000)

/**
 * **올려 둔 음원을 지금 내보낸다 — 예약 행을 안 남긴다** (2026-09-15).
 *
 * 「즉시는 휘발성, 업로드는 영구」의 두 번째 조각이다. **트는 것이 휘발성**이고
 * 등록된 파일 자체는 그대로 남는다.
 *
 * **영상(`video`)은 아직 이 길이 아니다** — 쏘기 전에 BGM 을 끄고 페이드를 기다리는
 * 판단이 예약 경로에만 있어서, 먼저 그 자리를 한 곳으로 뺀 다음 옮긴다.
 */
export const playFileNow = (spec) => apiPost('/api/audio/play-now', spec || {}, 20000)

// TTS 설정
export const getTTSSettings  = ()     => apiGet('/api/settings/tts')
export const saveTTSSettings = (data) => apiPost('/api/settings/tts', data)
// 이 PC의 역할(현장 PC / 개발·테스트 PC). 브랜치 자동 판정을 화면에서 덮어쓴다.
export const getPcRole  = ()     => apiGet('/api/settings/pc-role')
export const savePcRole = (role) => apiPost('/api/settings/pc-role', { role })

// 오디오 출력 장치 목록 조회 (현재 PC의 waveOut 장치)
export const getAudioDevices = () => apiGet('/api/audio/devices')

// AI 제공자 설정 (getAIProvider는 { provider, geminiModel } 반환 — Claude는 선택 UI가 없어져
// 실질적으로 Gemini 고정이다. 2026-08-27: 안 쓰이던 Claude API 카드·saveAnthropicModel·
// testClaude 제거)
export const getAIProvider      = ()        => apiGet('/api/settings/ai')
export const saveAIProvider     = (provider) => apiPost('/api/settings/ai', { provider })
export const saveGeminiModel    = (model)   => apiPost('/api/settings/ai', { geminiModel: model })

// API 키 관련
export const getAPIKeys   = ()           => apiGet('/api/settings/api-keys')
export const saveAPIKey   = (key, value) => apiPost('/api/settings/api-keys', { key, value })
export const testGemini   = ()           => apiPost('/api/ai/test-gemini', {})
// 안내 음성 엔진(2026-09-21) — 차례·상태, Azure 음성(선택) 키·지역·연결 확인
export const getTtsEngines    = ()     => apiGet('/api/tts/engines')
export const saveTtsEnginePrimary = (primary) => apiPost('/api/tts/engines', { primary })
export const getAzureSpeech   = ()     => apiGet('/api/settings/azure-speech')
export const saveAzureSpeech  = (data) => apiPost('/api/settings/azure-speech', data)
export const testAzureSpeech  = ()     => apiPost('/api/settings/azure-speech/test', {})

// AI 방송문 생성 (서버에서 설정된 제공자 자동 선택)
// Gemini가 "생각" 토큰을 많이 쓰는 모델이라 기본 10초로는 종종 부족함 — 30초로 여유
export const generateAI   = (keyword)   => apiPost('/api/ai/generate', { keyword }, 30000)

// PATCH 요청 헬퍼 (예약 토글 등)
export async function apiPatch(path, body = {}) {
  const res = await fetchT(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...보낸이머리글 },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return 본문JSON(res, path)
}

// 자연어 문장 → 예약 초안(저장하지 않음. 모달을 채워 열고 사람이 확인 후 저장한다)
export const parseSchedulePhrase = (text)    => apiPost('/api/schedules/parse-phrase', { text })

// 자연어 방송 예약 초안(schedule_drafts, AI 문구 생성 포함) — parse는 AI 호출이라 여유 있게
// 30초. 승인 전까지는 schedules에 안 들어감. parseSchedulePhrase(규칙 기반, 문구 생성 없음)와는
// 별도 경로 — 어느 쪽을 쓸지는 화면에 따라 다름.
export const parseScheduleDraft   = (text)          => apiPost('/api/schedule-drafts/parse', { text }, 30000)
export const getScheduleDrafts    = (status)        => apiGet(`/api/schedule-drafts${status ? `?status=${status}` : ''}`)
// 승인도 민감정보 확인(409)을 탄다 — AI가 쓴 문구라 사람이 덜 꼼꼼히 읽는다(CC-037).
export const approveScheduleDraft = (id, overrides) => postWithConfirm(`/api/schedule-drafts/${id}/approve`, overrides || {})
export const rejectScheduleDraft  = (id)            => apiPost(`/api/schedule-drafts/${id}/reject`, {})

// 예약 방송 CRUD
export const getSchedules     = ()           => apiGet('/api/schedules')
// 오늘 나갈 방송 전부(일과방송 + 예약)를 예정/완료/누락 판정까지 붙여서 받는다.
// getSchedules()로는 일과방송 5종이 안 보인다 — 그것들은 schedules 테이블이 아니라
// settings의 시각·활성 키로 돌기 때문이다(CC-026). 판정 유예는 watchdog과 같은 값을 쓴다.
export const getTodaySchedule = ()           => apiGet('/api/schedules/today')
export const createSchedule   = (data)       => postWithConfirm('/api/schedules', data)
export const updateSchedule   = (id, data)   => putWithConfirm(`/api/schedules/${id}`, data)
export const toggleSchedule   = (id)         => apiPatch(`/api/schedules/${id}/toggle`)
export const deleteSchedule   = (id)         => apiDelete(`/api/schedules/${id}`)
export const triggerSchedule  = (id)         => apiPost(`/api/schedules/${id}/trigger`, {})
// 자연어로 만든 예약(managed_by='ai')만 다루는 경로 — "방금 추가한 거 취소"가 쓴다.
// 일반 deleteSchedule은 어떤 예약이든 지우므로, 취소는 반드시 이쪽을 써서 사람이 만든 예약과
// 자동방송 순서 편집기의 행이 휩쓸리지 않게 한다(서버도 소유자를 확인하고 403으로 막는다).
export const getAiSchedules   = ()           => apiGet('/api/schedules/ai')
export const cancelAiSchedule = (id)         => apiDelete(`/api/schedules/ai/${id}`)

// 방송 흐름(순서) 만들기 CRUD
export const getFlows    = ()         => apiGet('/api/flows')
export const getFlow     = (id)       => apiGet(`/api/flows/${id}`)
// 이 흐름을 틀면 얼마나 걸리고 무엇이 빠지나 — 자동방송 점검과 같은 계산을 쓴다
export const getFlowEstimate = (id)   => apiGet(`/api/flows/${id}/estimate`)
// 안내 음성 문안에 이름 등이 있으면 서버가 409 로 되묻는다(전문가 1차 검토 4-1) — 확인창을 거쳐 다시 보낸다.
export const createFlow  = (data)     => postWithConfirm('/api/flows', data)
export const updateFlow  = (id, data) => putWithConfirm(`/api/flows/${id}`, data)
// 흐름 통째로 복사 — name을 비우면 서버가 "원래이름 (복사본)"으로 붙인다
export const duplicateFlow = (id, name) => apiPost(`/api/flows/${id}/duplicate`, { name })
export const deleteFlow  = (id)       => apiDelete(`/api/flows/${id}`)

// 아침 방송 설정 (레거시 — 하위 호환)
export const getMorningSettings  = ()     => apiGet('/api/settings/morning')
export const saveMorningSettings = (data) => apiPost('/api/settings/morning', data)

// 방송 일정 편집기 — 4개 시간대 설정
export const getBroadcastSchedule  = ()     => apiGet('/api/settings/broadcast-schedule')
// 자동방송이 저장된 BGM 음원을 실제로 쓰는지 — 음원 관리의 BGM 폴더가 이 답을 보여준다
export const getBgmUsage           = ()     => apiGet('/api/settings/bgm-usage')
// 방송별 예상 소요시간 — 계산은 서버가 한다(얼마나 기다리는지 아는 쪽이 실행부라서)
export const getBroadcastEstimate  = ()     => apiGet('/api/settings/broadcast-schedule/estimate')
// 안내 문구에 이름 등이 있으면 서버가 409 로 되묻는다 — 확인창을 거쳐 다시 보낸다.
export const saveBroadcastSchedule = (data) => postWithConfirm('/api/settings/broadcast-schedule', data)

// 시간대별 수동 방송 트리거
export const triggerMorningBroadcast       = (selection = {}) => apiPost('/api/morning/trigger', selection)
export const triggerExerciseBroadcast      = (selection = {}) => apiPost('/api/morning/trigger/exercise', selection)
export const triggerLunchBroadcast         = (selection = {}) => apiPost('/api/morning/trigger/lunch', selection)
export const triggerDinnerBroadcast        = (selection = {}) => apiPost('/api/morning/trigger/dinner', selection)
export const triggerEveningPrayerBroadcast = (selection = {}) => apiPost('/api/morning/trigger/evening-prayer', selection)
export const getAutoBroadcastSteps = (tab) => apiGet(`/api/morning/steps/${encodeURIComponent(tab)}`)
export const stopBroadcast            = () => apiPost('/api/morning/stop', {})
export const videoEnded               = (token, extra = {}) => apiPost('/api/morning/video-ended', { token, ...extra })
// audioFileId·duration은 선택 — 화면이 실제로 잰 재생시간을 함께 보내면 서버가 audio_files에
// 받아 적는다. 업로드 때는 길이를 알 수 없어 0으로 들어가고, 그동안 흐름·시퀀서가 "모르는
// 파일"의 대기 상한(180초)까지 기다렸다. 한 번 재생하고 나면 그다음부터는 정확해진다.
export const audioEnded               = (token, extra = {}) => apiPost('/api/morning/audio-ended', { token, ...extra })

// 실시간 재생 상태 (다른 PC 동기화용)
export const getNowPlaying  = ()     => apiGet('/api/status/now-playing')
export const postNowPlaying = (data) => apiPost('/api/status/now-playing', data)

// ── 경보 「확인」은 **서버가 기억한다** (현장 지적 2026-09-15) ────────────────────
// 확인 기록이 브라우저에만 있으면 주소·프로필·기기마다 따로라, 확인을 눌러도
// **들어갈 때마다 또 뜬다.** 실패해도 화면은 그대로 돈다 — 그 창의 localStorage 는
// 여전히 쓰므로 적어도 이 창에서는 안 다시 뜬다.
// 첫 화면이 거는 말 한 줄. **매뉴얼에서 뽑은 기능 + 오늘 상태**로 서버가 고른다 —
// AI 를 안 쓴다. 오늘 목록은 화면이 이미 들고 있는 것을 그대로 보낸다(두 번 세지 않게).
// 회전 번호는 **안 보낸다** — 상태 한 줄과 기능 안내 목록을 함께 받아 화면이 제자리에서 돈다.
export const getHomeTip = (today) => apiPost('/api/status/tip', { today })
export const getAckedAlerts = ()   => apiGet('/api/status/acked-alerts')
export const ackAlert       = (id) => apiPost('/api/status/acked-alerts', { id })

// 아침 방송 텍스트 조회 및 수동 실행
export const getMorningText = () => apiGet('/api/morning/text')
export const triggerMorning = () => apiPost('/api/morning/trigger', {})

// 아침 방송 미리 듣기 → 오디오 Blob 반환
export async function morningPreview() {
  const res = await fetch(`${API_URL}/api/morning/trigger?preview=1`, { method: 'POST' })
  if (!res.ok) {
    const err = await 오류본문(res, '서버 오류')
    throw new Error(err.error)
  }
  return res.blob()
}

// 스케줄 방송 오디오 Blob 반환
export async function fetchScheduledAudio(audioId) {
  const res = await fetch(`${API_URL}/api/audio/${audioId}`)
  if (!res.ok) throw new Error('오디오를 불러올 수 없습니다.')
  return res.blob()
}

// ── 날씨 / 미세먼지 / 특보 ──────────────────────────────
export const getWeather        = () => apiGet('/api/weather')
// 머리줄에 붙는 작은 날씨. **자주 불러도 된다** — 서버가 반나절에 한 번만 바깥으로 나간다
// (`domain/weatherChip.js`). 화면이 부르는 간격과 바깥 호출 횟수는 별개다.
export const getWeatherChip    = () => apiGet('/api/weather/chip')
export const getUVIndex        = () => apiGet('/api/weather/uv')
export const getUVDebug        = () => apiGet('/api/weather/uv-debug')
export const getAirQuality     = () => apiGet('/api/air-quality')
export const getWeatherAlert   = () => apiGet('/api/weather-alert')

// ── 기상청 설정 ──────────────────────────────────────────
export const getKmaSettings  = ()     => apiGet('/api/settings/kma')
export const saveKmaSettings = (data) => apiPost('/api/settings/kma', data)
// 좌표 → 지역 이름(「서울특별시 용산구 …」). 초기 설정에서 사람이 넣은 위치가 맞는지 보이려고 쓴다.
export const getPlaceName = (lat, lon) =>
  apiGet(`/api/settings/place-name?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)

// ── 에어코리아 설정 ──────────────────────────────────────
export const getAirKoreaSettings  = ()     => apiGet('/api/settings/airkorea')
export const saveAirKoreaSettings = (data) => apiPost('/api/settings/airkorea', data)

// ── Google Calendar ──────────────────────────────────────
export const getGCalSettings    = ()     => apiGet('/api/settings/gcal')
export const saveGCalSettings   = (data) => apiPost('/api/settings/gcal', data)
export const getCalendarAuthUrl = ()     => apiGet('/api/calendar/auth-url')
export const getCalendarStatus  = ()     => apiGet('/api/calendar/status')
export const getCalendarToday   = ()     => apiGet('/api/calendar/today')
export const disconnectCalendar = ()     => apiPost('/api/calendar/disconnect', {})

// 방송 로그
export const broadcastLogs    = ()  => apiGet('/api/broadcasts?limit=200')
// 이력 삭제는 **기준 날짜를 받는다**(그 날짜 이전만 지운다). 예전엔 인자 없이 전부 지웠고
// 지운 흔적도 안 남았다 — CCTV로 치면 녹화본 전체 삭제에 기록이 없는 것이다
// (docs/db-retention-design.md).
export const purgeBroadcastLogsBefore = (before) =>
  apiDelete(`/api/broadcasts?before=${encodeURIComponent(before)}`)

// 방송 한 편이 어느 단계까지 갔나(0021). 이력 한 줄을 펼칠 때 읽는다.
export const getBroadcastSteps = (runKey) =>
  apiGet(`/api/broadcasts/steps?run=${encodeURIComponent(runKey)}`)

// 마지막 자동 정리·수동 삭제 기록. "지웠다는 사실"을 화면이 읽는 곳.
// 화면이 실제로 소리를 시작한 순간을 서버에 한 줄 남긴다. 실패해도 방송에는 영향이 없다 —
// 진단용이지 동작이 아니다(서버 지시부터 소리까지의 구간이 지금은 통째로 안 보인다).
export const reportPlayStarted = (payload) =>
  apiPost('/api/morning/play-started', payload).catch(() => {})

export const getBroadcastRetention = () => apiGet('/api/broadcasts/retention')

// 이력 거르기 — 서버가 거른다(보관 1년이면 최근 500건만 받아서는 옛 기록에 닿지 못한다)
export const getBroadcastLogs = (params = {}) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) q.set(k, v)
  return apiGet(`/api/broadcasts?${q.toString()}`)
}

// CSV는 서버가 파일로 내려준다(Content-Disposition) — 링크 하나면 브라우저가 알아서 받는다
export const broadcastCsvUrl = (params = {}) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) q.set(k, v)
  return `/api/broadcasts/export.csv?${q.toString()}`
}

// 방송이 화면에서 재생되지 못했다는 사실을 화면과 서버 양쪽에 남긴다.
// 예전엔 재생 실패가 App.jsx의 빈 catch로 전부 삼켜져서, 아무 소리도 안 났는데 이력에는
// 성공으로 남았다(2026-08-29 리뷰 CC-009).
//
// 순서가 중요하다 — **화면에 먼저 띄우고 서버에 보고한다.** 보고가 실패할 수 있고, 그
// 실패의 원인이 바로 네트워크 단절인 경우가 많다. 그때야말로 사람이 알아야 하는 상황이다.
//
// 이력에 '경보'로 적는 이유: SystemAlertBanner가 새로고침 후 오늘자 경보를 복원할 때
// 이 행을 같은 id로 다시 찾아낸다(alertStore의 `날짜|종류|문구` 규칙). 아래 CustomEvent와
// 문구를 똑같이 맞춰야 새로고침 전후로 같은 경보가 두 줄로 보이지 않는다.
export function reportBroadcastFailure(title, reason) {
  const message = `${title || '방송'}이(가) 재생되지 않았습니다 — ${reason}`
  try {
    window.dispatchEvent(new CustomEvent('carecast:alert', { detail: { kind: '재생실패', message } }))
  } catch { /* 배너가 없어도 아래 보고는 간다 */ }
  return apiPost('/api/broadcasts', {
    type: '경보', user: '자동', target: '-', success: 0,
    content: `[재생실패] ${message}`.slice(0, 300),
  }).catch(() => { /* 네트워크가 끊긴 상황이 바로 이 실패의 원인일 수 있다 */ })
}
export const getBroadcastSummary = (year, month) => apiGet(`/api/broadcasts/summary?year=${year}&month=${month}`)

// 음원 이름 변경
export const renameAudioFile  = (id, name) => apiPatch(`/api/audio/${id}`, { original_name: name })
// 출처·이용 조건 고치기 — 셋을 한 묶음으로 보낸다(server/domain/audioSource.js 가 판정).
export const updateAudioSource = (id, { source_name, source_url, license_note }) =>
  apiPatch(`/api/audio/${id}`, { source_name, source_url, license_note })

// ── 볼륨 제어 ────────────────────────────────────────────────
export const getVolume  = ()     => apiGet('/api/audio/volume')
export const saveVolume = (data) => apiPost('/api/audio/volume', data)
export const startLocalBGM = () => apiPost('/api/audio/bgm/start', {})
// 편집 화면 미리듣기용 한 곡 — 서버는 소리를 안 낸다(이 브라우저만 튼다). { ok, url, name } | { ok:false, reason }
// folderId 가 있으면 그 폴더(사람이 만든 BGM 폴더, 2026-09-22) — 비었으면 대신 틀지 않고 비었다고 답한다.
// fileId 가 있으면 그 곡 하나(2026-09-22 「개별적 파일로도」).
export const getBgmPreview = (role, folderId = null, fileId = null) => apiGet(fileId
  ? `/api/audio/bgm/preview?fileId=${encodeURIComponent(fileId)}`
  : folderId
  ? `/api/audio/bgm/preview?folderId=${encodeURIComponent(folderId)}`
  : `/api/audio/bgm/preview?role=${encodeURIComponent(role || 'broadcast')}`)
// 모든 BGM 폴더 { folders: [{ id, name, parent_id, role, count, offCount }], songs: [{ id, name, folder_id }] } — 고르개가 지금 이름을 그린다(2026-09-22)
export const getBgmFolders = () => apiGet('/api/audio/bgm/folders')
// 배경음악 두 용도(방송용·식사용)의 곡 수·기본 차례·안 나가는 곡 수 (2026-09-21)
export const getBgmRoles = () => apiGet('/api/audio/bgm/roles')
export const setBgmRoleOrder = (role, order) => apiPut(`/api/audio/bgm/roles/${role}`, { order })
export const stopLocalBGM  = () => apiPost('/api/audio/bgm/stop',  {})
export const setBGMTimer   = (durationSec) => apiPost('/api/audio/bgm/set-timer', { durationSec })

// ── 실시간 연결(SSE)은 **한 창에 하나** ──────────────────────────────
//
// 예전에는 창 하나가 셋을 열었다 — 여기(initSSE) · MusicPlayer · SystemAlertBanner.
// 브라우저는 주소 하나당 소켓이 6개뿐이고(HTTPS가 꺼져 있어 HTTP/1.1) SSE는 그 소켓을
// **끊지 않고 계속 붙잡는다.** 창 하나가 3개를 물면 남는 건 3개, 모니터링 창까지 열면
// 2개다. 화면 하나가 진입하면서 대여섯 개를 쏘면 뒤쪽은 소켓을 못 받고 줄을 서고,
// 그러면 화면은 "불러오는 중"에서 안 풀리고 연결 감시는 그 줄서기를 끊김으로 읽는다.
// 2026-09-01에 현장 PC를 원격에서 열었을 때 실제로 그렇게 됐다(서버는 4ms로 멀쩡했다).
//
// **호출부의 핸들러 본문은 한 줄도 안 고쳤다.** 재생 경로(MusicPlayer)가 걸려 있어서,
// 바꾼 것은 "어디에 붙느냐"뿐이다 — openSSEBus()가 EventSource처럼 생긴 창구를 주고
// 핸들러는 예전 그대로 진짜 MessageEvent를 받는다(e.data가 그대로 산다).
//
// server/test/sse-single-connection.test.js가 `new EventSource`가 저장소에 한 곳뿐인 것을
// 고정한다 — 없으면 다음에 누가 또 하나 연다.
let sseES = null
let sseTimer = null
const sseSubs = new Map()      // 이벤트 이름 → 핸들러 Set
// 연결이 살아 있는지 보고 싶은 화면들. 모니터링 창처럼 **화면이 SSE로만 채워지는 곳**은
// 연결이 죽으면 화면이 조용히 멈춘다 — 그때 아무 표시가 없으면 원인을 못 찾는다.
const sseStateSubs = new Set()
let sseAlive = false
function sseSetAlive(v) {
  if (sseAlive === v) return
  sseAlive = v
  for (const cb of sseStateSubs) { try { cb(v) } catch { /* 한 화면이 던져도 나머지는 받는다 */ } }
}
const sseAttached = new Set()  // 지금 연결에 붙여 둔 이벤트 이름

function sseAttach(name) {
  if (!sseES || sseAttached.has(name)) return
  sseAttached.add(name)
  // 진짜 MessageEvent를 그대로 넘긴다 — 호출부가 e.data를 파싱한다.
  sseES.addEventListener(name, (e) => {
    const set = sseSubs.get(name)
    if (!set) return
    for (const fn of set) {
      try { fn(e) } catch { /* 한 구독자가 던져도 나머지 구독은 살아 있어야 한다 */ }
    }
  })
}

// ── 이 창이 살아 있음을 서버에 알린다 (H15, 2026-09-02) ───────
//
// 무엇을 고치나: 서버는 SSE 연결이 열려 있으면 그 창이 살아 있다고 믿고 **소리 담당**으로
// 지목한다. 그런데 Vite 프록시는 브라우저를 닫아도 백엔드 쪽 연결을 안 끊는다 — 담당이
// 이미 없어진 창이라 **어느 창에서도 소리가 안 났다.** 현장도 원격 데스크톱이 죽으면 같다.
// 그래서 브라우저가 실제로 돌고 있어야만 보낼 수 있는 신호를 주기적으로 보낸다.
// 서버는 90초 동안 소식이 없는 창을 담당 후보에서 뺀다(server/services/sse.js).
//
// 10초인 이유: 브라우저는 가려진 창의 타이머를 **1분에 한 번까지** 눌러 버린다. 10초로
// 잡아도 최악이 60초라 서버의 90초 안에 들어온다. 더 자주 보내도 눌리는 건 똑같다.
const 생존신호_간격 = 10_000
let 생존타이머 = null

function 생존신호() {
  // 소리를 낼 수 없는 창(모니터·개발 콘솔)은 담당 후보가 아니다 — 보낼 이유가 없다.
  if (!CAN_OWN_SOUND) return
  try {
    // **소리를 낼 수 있는 상태인지 함께 보낸다**(현장 사고 2026-09-15).
    // 창이 붙어 있는 것과 소리를 낼 수 있는 것은 다르다 — 브라우저가 자동재생을 막으면
    // 창은 멀쩡히 그려지고 소리만 안 난다. 서버는 그것을 알 방법이 없어서 무음 방송을
    // **성공으로 적었다.** 이 값 하나가 그 구멍을 메운다.
    const 소리 = isSoundReady() ? 'on' : 'off'
    // keepalive: 창이 닫히는 순간에 걸쳐도 요청이 살아남는다
    fetch(`${API_URL}/api/events/alive?tab=${encodeURIComponent(TAB_ID)}&sound=${소리}`,
      { method: 'POST', keepalive: true })
      .catch(() => { /* 못 보내도 화면은 그대로 돈다 — 담당이 넘어갈 뿐이다 */ })
  } catch { /* fetch 자체가 막힌 환경 — 옛 규칙(붙은 순서)으로 떨어진다 */ }
}

// 창이 다시 보이면 눌려 있던 타이머와 무관하게 **그 자리에서** 한 번 알린다.
function 보이면바로() { if (!document.hidden) 생존신호() }

// 닫히는 창은 스스로 인사하고 간다 — 이게 있으면 유령이 90초를 사는 대신 즉시 사라진다.
// 개발 PC에서 창을 여닫을 때마다 유령이 쌓이던 것이 여기서 끊긴다.
function 떠난다고알림() {
  if (!CAN_OWN_SOUND) return
  try { navigator.sendBeacon(`${API_URL}/api/events/bye?tab=${encodeURIComponent(TAB_ID)}`) }
  catch { /* 못 보내면 서버가 90초 뒤에 알아서 넘긴다 */ }
}

function 생존신호시작() {
  if (생존타이머 || !CAN_OWN_SOUND) return
  생존신호()
  생존타이머 = setInterval(생존신호, 생존신호_간격)
  document.addEventListener('visibilitychange', 보이면바로)
  window.addEventListener('pagehide', 떠난다고알림)
}

function 생존신호중단() {
  if (생존타이머) { clearInterval(생존타이머); 생존타이머 = null }
  document.removeEventListener('visibilitychange', 보이면바로)
  window.removeEventListener('pagehide', 떠난다고알림)
}

function sseConnect() {
  if (sseES) return
  // 소리를 낼 수 없는 창(모니터·개발 콘솔)은 이름표를 안 보낸다 — 담당으로 뽑히면
  // 아무도 소리를 안 낸다. 이름표 없는 연결은 서버가 담당 후보에서 뺀다.
  const 이름표 = CAN_OWN_SOUND ? `?tab=${encodeURIComponent(TAB_ID)}` : ''
  sseES = new EventSource(`${API_URL}/api/events${이름표}`)
  sseAttached.clear()
  for (const name of sseSubs.keys()) sseAttach(name)
  sseES.addEventListener('connected', () => sseSetAlive(true))
  sseES.onopen = () => sseSetAlive(true)
  // 연결이 열린 창만 담당 후보다 — 신호도 그때부터 보낸다
  생존신호시작()
  sseES.onerror = () => {
    sseSetAlive(false)
    try { sseES.close() } catch { /* 이미 닫힌 연결 */ }
    sseES = null
    sseAttached.clear()
    // 구독자가 남아 있을 때만 다시 붙는다.
    if (sseSubs.size > 0 && !sseTimer) sseTimer = setTimeout(() => { sseTimer = null; sseConnect() }, 3000)
  }
}

function sseSubscribeRaw(name, fn) {
  let set = sseSubs.get(name)
  if (!set) { set = new Set(); sseSubs.set(name, set) }
  set.add(fn)
  sseConnect()
  sseAttach(name)
  return () => {
    set.delete(fn)
    if (set.size === 0) sseSubs.delete(name)
    if (sseSubs.size === 0) {
      clearTimeout(sseTimer); sseTimer = null
      try { sseES?.close() } catch { /* 이미 닫힘 */ }
      sseES = null
      sseAttached.clear()
      생존신호중단()
    }
  }
}

/**
 * EventSource처럼 생긴 창구. `addEventListener(이름, 핸들러)`만 쓰면 되고,
 * 실제 연결은 창에 하나뿐인 것을 나눠 쓴다. 끝낼 때 close()를 부른다.
 */
/**
 * 실시간 연결이 살아 있는지 알려준다. 붙는 순간 지금 상태로 한 번 부른다.
 */
export function subscribeSSEState(cb) {
  sseStateSubs.add(cb)
  cb(sseAlive)
  return () => sseStateSubs.delete(cb)
}

export function openSSEBus() {
  const offs = []
  return {
    addEventListener(name, fn) { offs.push(sseSubscribeRaw(name, fn)) },
    close() { for (const off of offs) off(); offs.length = 0 },
  }
}

// SSE 연결 초기화 — 스케줄 방송 이벤트 수신 (WiFi 끊김 시 자동 재연결)
export function initSSE(onBroadcast) {
  // 창에 하나뿐인 연결에 붙는다(위 openSSEBus 참고). 이벤트 목록과 핸들러는 그대로다.
  const es = openSSEBus()

  function connect() {
    const handle = (type) => (e) => {
      try { onBroadcast({ ...JSON.parse(e.data), type }) } catch { /* 우리 형식이 아닌 SSE 데이터는 무시한다 — 여기서 던지면 이벤트 구독이 끊긴다 */ }
    }
    es.addEventListener('scheduled_broadcast',  handle('scheduled'))
    // **켜는 것과 끄는 것은 한 쌍이다** (V③ R11 지적, 2026-09-14).
    // 시작만 구독하고 정지를 안 받으면, 훅에 걸린 **350ms 시작 타이머를 걷을 길이 없다** —
    // 즉시 방송의 안내가 실패해 서버가 곧바로 정지를 쏴도 그 뒤에 반주가 켜져 영영 안 꺼진다.
    // 훅에 분기를 넣어 놓고 **여기 한 줄을 빠뜨려서** 그 분기가 한 번도 안 돌았다.
    es.addEventListener('bgm_stop',             handle('bgm_stop'))
    es.addEventListener('broadcast_started',    handle('broadcast_started'))
    es.addEventListener('broadcast_stopped',    handle('broadcast_stopped'))
    es.addEventListener('broadcast_completed',  handle('broadcast_completed'))
    // 지금 몇 번째 단계인지 — App.jsx가 **앞에서** 가로챈다(끝단은 TTS 재생이다)
    es.addEventListener('broadcast_step',       handle('broadcast_step'))
    es.addEventListener('video_play',           handle('video_play'))
    es.addEventListener('morning_video_start',  handle('morning_video_start'))
    // 서버 스피커 TTS의 시작·끝 — BGM 덕킹용(td09 H6). 실소리가 서버에서 나는 방송이라
    // 이 신호 없이는 어떤 창도 낮출 시점을 모른다.
    es.addEventListener('tts_speak',            handle('tts_speak'))
    // 소리 내는 창이 "진짜로 소리가 시작됐다"고 보고한 것을 서버가 되쏜 것 —
    // 소리를 안 내는 창이 자막 시계를 어림값에서 실측으로 바꿔 다는 데 쓴다.
    es.addEventListener('caption_sync',         handle('caption_sync'))
    es.addEventListener('favorites_updated',    handle('favorites_updated'))
    // 기관 이름·표어가 바뀌면 홀 TV 가 **그 자리에서** 갈아 끼운다(설정 저장 → SSE)
    es.addEventListener('org_info',             handle('org_info'))
    // 예약이 바뀌었다 — 다른 기기·다른 화면이 지우거나 고친 것(P-16). 요양원은 현장 PC·
    // 직원 폰·관리자 화면을 동시에 보므로, 이 줄이 없으면 **새로고침해야만** 최신을 본다.
    es.addEventListener('schedules_updated',    handle('schedules_updated'))
    es.addEventListener('server_update',        handle('server_update'))
    // 소리 담당 지목 — 서버가 정한다. 브라우저 저장공간은 접속 주소마다 분리돼서
    // localhost와 127.0.0.1로 각각 열면 담당이 둘이 됐다(겹쳐 들리던 원인).
    es.addEventListener('sound_owner',          handle('sound_owner'))
    // 다른 기기가 마이크 생방송 중이다 — 쉬운 화면의 즉시 방송 카드가 "다른 기기에서 방송 중"을
    // 띄우는 근거다(InstantBroadcast.jsx). **이 줄이 2026-09-08까지 없었다**(P-45):
    // 서버는 쏘고(micLive.js) 화면은 기다리는데 사이가 끊겨 있어서, 서버는 마이크 방송을 알고
    // 예약을 미루는데 **사람 화면에는 아무 표시도 안 났다.** 처리 분기는 그때도 있었으므로
    // (useScheduledBroadcast.js) 문자열 검색으로는 멀쩡해 보였다 — 도달 불가한 코드가
    // 배선을 대신 증언한 것이다. server/test/sse-event-wiring.test.js 가 이 짝을 고정한다.
    es.addEventListener('mic_live',             handle('mic_live'))
    // 다시 붙는 일은 공유 연결이 맡는다 — 여기서 재연결을 따로 돌리면 창당 연결이 다시 늘어난다.
  }

  connect()
  return { close() { es.close() } }
}

// ── 자동 종료 ─────────────────────────────────────────────────
export const getAutoShutdown  = ()           => apiGet('/api/settings/auto-shutdown')
export const saveAutoShutdown = (time)       => apiPost('/api/settings/auto-shutdown', { time })

// ── 방송 감시·백업 (누락·멈춤 알림 유예, 예약 미룸 상한, 백업 시각) ─────────
// 범위·기본값은 서버가 함께 준다(`limits`·`defaults`) — 화면이 따로 들고 있지 않는다.
export const getWatchSettings  = ()     => apiGet('/api/settings/watch')
export const saveWatchSettings = (data) => apiPost('/api/settings/watch', data)

// ── 기관 이름·표어 (방송 대기화면의 큰 글씨) ─────────────────
// 비어 있는 것이 기본이고, 비면 화면이 그 줄을 안 그린다.
export const getOrgInfo  = ()     => apiGet('/api/settings/org')
export const saveOrgInfo = (info) => apiPost('/api/settings/org', info)

// ── 기상특보 자동방송 ────────────────────────────────────────
export const getWeatherAlertSettings  = ()          => apiGet('/api/settings/weather-alert')
export const saveWeatherAlertSettings = (enabled)   => apiPost('/api/settings/weather-alert', { autoBroadcastEnabled: enabled })

// ── AI 방송문 작성 지침 (빈 문자열 저장 = 코드 기본값 사용) ──────
export const getBroadcastPrompt  = ()        => apiGet('/api/settings/broadcast-prompt')
export const saveBroadcastPrompt = (prompt)  => apiPost('/api/settings/broadcast-prompt', { prompt })

// 이 키로 지금 쓸 수 있는 제미나이 모델 목록. 못 받아도 오류가 아니다(손입력이 살아 있다).
export const getGeminiModels = ()            => apiGet('/api/ai/models')

// ── 로컬 AI(1차) 허용 스위치 — "허용"이고, "가능"은 브라우저 진단이 따로 본다 ──
export const getLocalAiEnabled  = ()          => apiGet('/api/settings/local-ai')
export const saveLocalAiEnabled = (enabled)   => apiPost('/api/settings/local-ai', { enabled })

// ── 영상 오디오 딜레이 (TV 싱크 보정) ─────────────────────────
// **값은 하나다**(2026-09-16). 영상마다 갈라 두었던 둘(체조·식사전)은 같은 것을 재고
// 있었다 — 지연은 캡처카드→TV 경로에서 오고 그 경로는 영상마다 다르지 않다.
export const getVideoAudioDelay  = ()        => apiGet('/api/settings/video-audio-delay')
export const saveVideoAudioDelay = (delayMs) => apiPost('/api/settings/video-audio-delay', { delayMs })
// 비상방송 문안 — 소스에 박혀 있던 것을 화면에서 고칠 수 있게 했다(2026-09-16).
export const getEmergencyPresets  = ()        => apiGet('/api/settings/emergency-presets')
export const saveEmergencyPresets = (presets) => apiPost('/api/settings/emergency-presets', { presets })

// 자막 오프셋 — 영상 보정 **위에 더하는** 값. 음수면 자막이 먼저 뜬다.
export const getCaptionOffset  = ()         => apiGet('/api/settings/caption-offset')
export const saveCaptionOffset = (offsetMs) => apiPost('/api/settings/caption-offset', { offsetMs })

// ── 방송 BGM 기본 볼륨 ────────────────────────────────────────
export const getBgmBroadcastDefault  = ()           => apiGet('/api/settings/bgm-broadcast-default')
export const saveBgmBroadcastDefault = (bgmDefault) => apiPost('/api/settings/bgm-broadcast-default', { bgmDefault })

// 자연어 볼륨 표현 수치 — "잔잔하게"가 몇 %인지. 스피커·공간마다 달라서 현장에서 조정한다
// (낱말 목록은 server/domain/ontology.js가 갖고, 숫자만 설정으로 뺐다)
export const getVolumeWords  = ()      => apiGet('/api/settings/volume-words')
export const saveVolumeWords = (words) => apiPost('/api/settings/volume-words', words)

// ── 자동 업데이트 ─────────────────────────────────────────────
export const getUpdateInfo   = () => apiGet('/api/update/info')
export const getUpdateStatus = () => apiGet('/api/update/status')
export const startUpdate     = () => apiPost('/api/update/start', {})

// ── SwitchBot ────────────────────────────────────────────────
export const getSwitchBotSettings  = ()     => apiGet('/api/settings/switchbot')
export const saveSwitchBotSettings = (data) => apiPost('/api/settings/switchbot', data)
export const getSwitchBotStatus    = ()     => apiGet('/api/switchbot/status')
// 이 계정의 장치 목록 — Device ID 를 손으로 적게 하지 않는다(UX-08).
// **읽기만 한다.** 장치를 누르는 경로(`/on`·`/off`)와는 다른 층이다.
export const getSwitchBotDevices   = ()     => apiGet('/api/switchbot/devices')
export const switchBotOn           = ()     => apiPost('/api/switchbot/on', {})
export const switchBotOff          = ()     => apiPost('/api/switchbot/off', {})

// ── 즐겨찾기 버튼 (쉬운화면) ──────────────────────────────────────
export const getFavorites    = ()         => apiGet('/api/favorites')
export const createFavorite  = (data)     => apiPost('/api/favorites', data)
export const updateFavorite  = (id, data) => apiPut(`/api/favorites/${id}`, data)
export const deleteFavoriteBtn = (id)     => apiDelete(`/api/favorites/${id}`)

// ── 음원 관리 ────────────────────────────────────────────────────
// 정적 음원 파일 기본 URL — /audio/{category}/{filename} 형태로 접근
export const AUDIO_URL = `${API_URL}/audio`

// folderId를 안 주면 카테고리 전체(폴더 무관, 기존 동작), 주면(빈 값=루트) 그 폴더 레벨만
export const getAudioFiles = (cat, folderId) => {
  if (!cat) return apiGet('/api/audio')
  const params = new URLSearchParams({ category: cat })
  if (folderId !== undefined) params.set('folder_id', folderId || '')
  return apiGet(`/api/audio?${params.toString()}`)
}
// 화면이 잰 재생시간을 받아 적게 한다 (2026-09-12).
// 업로드는 `duration` 을 늘 0 으로 넣고, 길이를 아는 것은 브라우저뿐이다. 예전에는
// **그 파일이 한 번 방송으로 나가야** 채워졌다 — 올리기만 한 파일은 목록에서 영영 빈칸이었다.
// 서버는 이미 값이 있으면 안 덮어쓴다(`domain/mediaDuration.js`).
export const recordAudioDuration = (id, seconds) =>
  apiPost(`/api/audio/files/${id}/duration`, { seconds })
export const deleteAudioFile = (id)         => apiDelete(`/api/audio/${id}`)
export const moveAudioFile   = (id, folderId) => apiPost(`/api/audio/files/${id}/move`, { folder_id: folderId || null })
export const getPlaylist     = (cat)        => apiGet(`/api/audio/playlist?category=${cat}`)
export const savePlaylist    = (cat, items) => apiPost('/api/audio/playlist', { category: cat, items })
export const getRandomStaff  = ()           => apiGet('/api/audio/random?category=staff')
export const getBGMSchedule  = ()           => apiGet('/api/audio/schedule')
export const saveBGMSchedule = (data)       => apiPost('/api/audio/schedule', data)

// 폴더(카테고리)별 메모
export const getCategoryNote  = (category)       => apiGet(`/api/audio/categories/${category}/note`)
export const saveCategoryNote = (category, note) => apiPut(`/api/audio/categories/${category}/note`, { note })

// 실제 하위폴더(content_folders) — parentId 없으면 해당 category의 최상위
export const getFolders = (category, parentId) => {
  const params = new URLSearchParams({ category })
  if (parentId) params.set('parent_id', parentId)
  return apiGet(`/api/audio/folders?${params.toString()}`)
}
export const createFolder = (category, parentId, name) =>
  apiPost('/api/audio/folders', { category, parent_id: parentId || null, name })
export const renameFolder = (id, name)     => apiPatch(`/api/audio/folders/${id}`, { name })
export const moveFolder   = (id, parentId) => apiPatch(`/api/audio/folders/${id}`, { parent_id: parentId || null })
export const deleteFolder = (id)           => apiDelete(`/api/audio/folders/${id}`)
// 자동순서가 무엇을 쓰고 있나 — 폴더·파일·카테고리별 사용처(2026-09-13).
// **판정은 서버가 한다**(`domain/broadcastScheduleRead.readSourceUsage`). 화면이 따로 세면
// 삭제를 막는 근거와 보여 주는 숫자가 갈려 "쓰는 데 없다는데 왜 안 지워지지"가 된다.
export const getFolderUsage = () => apiGet('/api/audio/folders/usage')

// 음원 업로드 — multipart/form-data
/**
 * 음원·영상 업로드. `onProgress(0~100)` 을 주면 **올라가는 동안** 몇 %인지 알려준다.
 *
 * **왜 `fetch` 가 아니라 XHR 인가**(UX-06, 2026-09-11): `fetch` 는 업로드 진행률을 안 준다.
 * 500MB 영상을 올리는 동안 화면이 "업로드 중…" 한 줄로 멈춰 있으면, 사람은 멈춘 줄 알고
 * 다시 누른다 — 그러면 같은 파일이 둘 올라간다. 진행률은 장식이 아니라 **중복 업로드를
 * 막는 장치**다.
 *
 * 오류 계약은 그대로다 — 서버가 준 `error` 문구를 그대로 `Error` 로 던진다.
 * 그 문구가 *"영상 칸인데 내용이 음원 파일입니다"* 처럼 **무엇을 고쳐야 하는지**를 담는다.
 */
export function uploadAudioFile(category, file, folderId, onProgress, source = null) {
  const form = new FormData()
  // 출처·이용 조건(2026-09-21) — **파일보다 먼저** 붙인다. multer 는 파일을 만나는 순간까지
  // 읽은 글자 칸만 req.body 에 넣어서, 뒤에 붙이면 서버가 「출처 없음」으로 거절한다.
  // 배경음악은 서버가 이 칸을 필수로 본다(server/domain/audioSource.js).
  for (const k of ['source_name', 'source_url', 'license_note']) {
    if (source?.[k] != null) form.append(k, source[k])
  }
  form.append('file', file)
  const qs = new URLSearchParams({ category })
  if (folderId) qs.set('folder_id', folderId)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/api/audio/upload?${qs.toString()}`)
    if (typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        // `lengthComputable` 이 거짓이면 전체 크기를 모른다 — 그때는 숫자를 지어내지 않는다.
        if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    const 실패 = (기본문구) => {
      let msg = 기본문구
      try { msg = JSON.parse(xhr.responseText)?.error || 기본문구 } catch { /* 본문이 JSON 이 아니면 기본 문구 */ }
      reject(new Error(msg))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)) } catch { resolve({ ok: true }) }
      } else 실패('업로드 실패')
    }
    // 끊김·취소도 **조용히 성공으로 두지 않는다** — 안 올라간 파일이 올라간 줄 알면 안 된다.
    xhr.onerror = () => reject(new Error('업로드 중 연결이 끊겼습니다. 다시 시도해 주세요.'))
    xhr.onabort = () => reject(new Error('업로드가 취소됐습니다.'))
    xhr.send(form)
  })
}

// ── 음원 자막 ───────────────────────────────────────────────────
// 목록에 얹지 않고 재생하는 그 파일 것만 따로 받는다 — 자막 하나가 10KB를 넘어서,
// 목록에 섞으면 화면이 열릴 때마다 그 덩어리가 전부 따라온다.
export const getAudioSubtitle  = (id)        => apiGet(`/api/audio/files/${id}/subtitle`)
// status를 안 주면 서버가 초안으로 받는다. 방송에 내보내려면 'ready'를 명시해야 한다.
export const saveAudioSubtitle = (id, body)  => apiPut(`/api/audio/files/${id}/subtitle`, body)
export const deleteAudioSubtitle = (id)      => apiDelete(`/api/audio/files/${id}/subtitle`)
// 받아쓰기 — **저장하지 않고 결과만 돌려준다.** 사람이 편집기에서 보고 고친 뒤 저장한다.
// 십수 초 걸린다(32초 음원에 10초쯤). 부르는 쪽이 기다린다는 표시를 해야 한다.
// 10분을 준다. 기본 10초로는 어림도 없다 — 32초짜리 음원에 25초가 걸린다(실측).
// 받아쓰기 프로그램이 없을 때 그 자리에서 설치한다(사용자 지시 2026-09-15).
// 몇 분 걸리므로 화면은 「설치 중」을 띄우고 기다린다.
export const installSttEngine = () => apiPost('/api/audio/subtitle/install-stt', {})
// 준비물 점검 — 이 PC 에 파이썬·음성합성·받아쓰기가 있나(2026-09-16).
// **40초까지 기다린다** — 갓 설치한 PC 의 첫 기동은 음성 합성·백신 검사와 겹쳐 파이썬이 늦게 뜬다(2026-09-17 노트북 실기).
// 서버 쪽 한도(20초)보다 길게 둬야 「없음」 대신 「응답 없음」으로 끊기지 않는다.
export const getPrerequisites = async () => {
  const res = await fetchT(`${API_URL}/api/settings/prerequisites`, {}, 40000)
  if (!res.ok) throw new Error((await res.text()).slice(0, 300))
  return 본문JSON(res, '/api/settings/prerequisites')
}
// 초기 설정을 처음 한 번 띄우기 위한 상태(2026-09-16).
export const getSetupState  = () => apiGet('/api/settings/setup-state')
export const markSetupSeen  = () => apiPost('/api/settings/setup-state', {})
// 이용 조건 동의 기록(2026-10-07) — { consent: { version, by, at } | null }. 방송과 무관한 기록이다.
export const getLicenseConsent  = () => apiGet('/api/settings/license-consent')
export const saveLicenseConsent = (version, by) => apiPost('/api/settings/license-consent', { version, by })
// 초기 설정 「휴대폰 접속 허용하기」 — 설치 폴더의 방화벽 열기 파일을 방송 PC 에 띄운다(이 PC 화면에서만).
export const openSetupFirewall = () => apiPost('/api/settings/setup-firewall', {})
// 기동 준비(목소리 미리 만들기) 진행 — 초기 설정 마지막 「잠시만 기다려 주세요」 화면이 본다.
export const getWarmup = () => apiGet('/api/health').then((h) => h?.warmup ?? null)
// 이 PC 의 접속 주소 후보(ConnectionGuide 와 같은 창구)
export const getServerInfo = () => apiGet('/api/server-info')

export const transcribeAudioSubtitle = (id, model) =>
  apiPost(`/api/audio/files/${id}/subtitle/transcribe`, { model }, 10 * 60 * 1000)
// 이 파일이 그 자리에서 나가게 만든다(재생목록 맨 앞으로). 녹음 음원·영상 자리에만 뜻이 있다 —
// BGM은 목록 전체가 순서대로 나가므로 서버가 거절한다.
export const makeAudioPrimary = (id) => apiPost(`/api/audio/files/${id}/make-primary`, {})

// 지금 무엇을 몇 퍼센트까지 받아쓰는 중인지. 편집기 진행 바와 목록 뱃지가 1초마다 본다.
export const getSubtitleProgress = () => apiGet('/api/audio/subtitle/progress')

// 받아쓴 글자를 AI로 다듬는다 — **시각은 그대로**, 글자만. 저장은 안 하고 결과만 준다.
// 줄 수가 달라지면 서버가 거절한다(타이밍이 통째로 어긋나므로).
export const polishAudioSubtitle = (id, lines) =>
  apiPost(`/api/audio/files/${id}/subtitle/polish`, { lines }, 60 * 1000)

// 이 카테고리에 정해진 문구(식사 안내 등). 없으면 text가 null이다.
export const getSubtitleDefaultText  = (id)        => apiGet(`/api/audio/files/${id}/subtitle/default-text`)

// 모바일 마이크용 SSL 인증서 수동 생성
export const generateSSLCert = () => apiPost('/api/settings/generate-cert', {})

export { API_URL }
