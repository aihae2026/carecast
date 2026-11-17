// 초기 설정 — **사이드바 없는 전체 화면, 한 장에 한 질문** (사용자 확정 시안 2026-09-16, N2·N3·N4).
//
// *"애플이나 윈도우가 그렇게 하든? 토스가 그렇게해? … 큰 화면으로 하나하나씩 설정할 수 있도록"*
// *"초기설정할때 음악 테스트 해보는것도 넣는다고 했는데 왜 안넣었냐"*
//
// 기관 → 준비물 → 스피커 → **소리 시험** → 연결(AI·날씨) → 접속 주소 → 마무리 → 「잠시만 기다려 주세요」.
//
// ── 지키는 규칙 (가드: `server/test/setup-wizard.test.js`) ─────────────────────────────
//  · **문구·기본값·상한·판정은 `lib/setupRules.js` 에서 온다** — 이 파일에 다시 적지 않는다(UX-13).
//  · **저장은 `lib/api.js` 의 기존 창구만 쓴다** — 새 저장 경로를 만들지 않는다.
//  · **지금 값을 못 읽었으면 저장하지 않는다** — 빈 초안이 멀쩡한 설정을 덮는다(2026-09-11 독립 검수).
//  · **막지 않는다** — 「나중에 설정하기」는 늘 오른쪽 위에 있다. 급할 때 방송을 못 하면 안 된다.
//
// `AdminMode` 의 `setupWizard` 칸으로 열려도 **화면 전체를 덮는다**(`fixed inset-0`) — 관리자
// 껍데기 안의 작은 칸으로 뜨던 것이 N3 신고였다. 첫 실행 이동(`HomeMode`)도 같은 자리로 온다.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bell, Check, ChevronLeft, ExternalLink, Loader2, Copy, Share2, ShieldCheck, RefreshCw, MapPin } from 'lucide-react'
import SetupPrereqs from './SetupPrereqs'
import AddressQR from '../../shared/AddressQR'
import BrandMark from '../../shared/BrandMark'
import { 보통으로고정, 먹이기, 읽기 as 배율읽기, 처음이면기본저장 } from '../../../lib/bigView'
// 좌표 → 격자·자외선 관측소. **계산 규칙은 관리자 화면과 같은 모듈을 쓴다** — 두 벌로 두면 갈린다.
import { 격자로, 격자범위밖, 가까운자외선관측소 } from '../../../lib/kmaGrid'
import {
  단계목록, 마지막단계인가, 진행률, 연동항목,
  기관글자수상한, 기관글자검사, 준비상태, 마무리문구, 저장해도되나,
} from '../../../lib/setupRules'
import {
  getOrgInfo, saveOrgInfo,
  getAPIKeys, saveAPIKey, getKmaSettings, saveKmaSettings,
  getTTSSettings, saveTTSSettings, getAudioDevices, fireChime,
  getServerInfo, openSetupFirewall, getWarmup, markSetupSeen, getSetupState, getPlaceName,
  getLicenseConsent, saveLicenseConsent,
} from '../../../lib/api'
// 이용 조건 장(2026-10-07) — 글과 판은 설정의 「라이선스 · 고지」 화면과 같은 모듈에서 온다.
import { 약관판, 약관항목, 동의필요, 동의날짜 } from '../../../lib/licenseNotice'

const 큰입력 = 'w-full min-h-[56px] px-4 rounded-[14px] border border-ds-v3-line-2 bg-white text-lg text-ds-v3-ink '
  + 'placeholder:text-ds-v3-ink-3 focus:outline-none focus:border-ds-v3-tts focus:ring-4 focus:ring-ds-v3-tts/15'

// 이 PC 에서 연 화면인가 — 방화벽 열기는 방송 PC 에서만 뜻이 있다(서버도 따로 막는다).
const 이PC인가 = () => { try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname) } catch { return false } }

// 준비 화면 문구 — 서버 준비 단계를 사람 말로. 남은 건수 대신 무엇을 하는지 말한다(사용자 지시).
function 준비문구(w) {
  if (!w?.running) return '준비가 끝났어요'
  if (w.단계 === '연결 확인') return '인터넷 연결을 확인하고 있어요'
  if (Number(w.remaining) > 0) return '오늘 방송 문안을 미리 읽어 두고 있어요'
  return '안내 방송 목소리를 준비하고 있어요'
}

export default function SetupWizard() {
  const [단계, set단계] = useState(단계목록[0].id)

  // 각 장이 실제로 받아 온 것. **안 해 봤으면 null** — 빈 값과 구별해야 마무리 표가 '확인 불가'를 낸다.
  const [org, setOrg] = useState(null)
  const [tts, setTts] = useState(null)           // { audioDevice }
  const [키현황, set키현황] = useState(null)      // { gemini:{set,masked}, kma:{…} }
  const [장치목록, set장치목록] = useState(null)   // null = 찾는 중
  const [주소, set주소] = useState(null)          // { url, 후보들 } | { url:'' }
  const [소리, set소리] = useState(null)          // '들림' | '안 들림' | null
  const [울리는중, set울리는중] = useState(false)
  const [울림결과, set울림결과] = useState('')     // '' | 'ok' | 오류 문장
  const [방화벽, set방화벽] = useState('')        // 방화벽 단추 뒤 안내
  const [공유알림, set공유알림] = useState('')
  const [저장중, set저장중] = useState(false)
  const [알림, set알림] = useState('')
  const [준비, set준비] = useState(null)          // 마지막 「잠시만」 화면. null = 안 띄움

  // 입력 중인 값 — 「다음」을 눌러 저장하기 전까지는 위 상태를 건드리지 않는다.
  const [이름초안, set이름초안] = useState('')
  const [표어초안, set표어초안] = useState('')
  const [장치초안, set장치초안] = useState('')
  const [키초안, set키초안] = useState({ gemini: '', kma: '' })
  const [위도초안, set위도초안] = useState('')
  const [경도초안, set경도초안] = useState('')
  // 이용 조건 — 지금 기록(undefined = 읽는 중, null = 동의한 적 없음)과 이 장의 입력.
  const [동의기록, set동의기록] = useState(undefined)
  const [동의함, set동의함] = useState(false)
  const [동의자초안, set동의자초안] = useState('')
  const [위치안내, set위치안내] = useState(null)   // { 나쁨, 글 }
  const [좌표읽음, set좌표읽음] = useState(null)   // 지금 저장돼 있는 좌표 { lat, lon }
  const [먼관측소, set먼관측소] = useState('')     // 마무리 장까지 들고 갈 경고
  // ── **좌표를 지역 이름으로 보여 준다** (사용자 지시 2026-09-18 밤) ──────────────────────────
  // *"위도하고 경도만 나오면 어떻게 해 … ○○도 ○○시 서울시 용산구 뭐 이런식으로 관측소 별로 보여줘야지"*
  // 숫자 두 개로는 그것이 우리 시설인지 사람이 모른다. 이름·자외선 관측소를 보여 주면 틀렸을 때 바로 보인다.
  // 이름은 서버가 묻는다(`services/placeName.js` — 이용 규칙 때문). 못 받아도 저장은 그대로 된다.
  // 좌표 판정은 그리는 중에 계산한다(격자 범위 밖이면 없음 — 그건 「다음」에서 따로 알린다).
  const 좌표 = useMemo(() => {
    const 위 = String(위도초안).trim(), 경 = String(경도초안).trim()
    const la = Number(위), lo = Number(경)
    if (!위 || !경 || !Number.isFinite(la) || !Number.isFinite(lo)) return null
    const g = 격자로(la, lo)
    if (격자범위밖(g.nx, g.ny)) return null
    const uv = 가까운자외선관측소(la, lo)
    return { la, lo, 열쇠: `${위},${경}`, 관측소: `자외선 관측소 ${uv.이름}(약 ${Math.round(uv.거리)}km)` }
  }, [위도초안, 경도초안])
  const [이름결과, set이름결과] = useState(null)   // { 열쇠, ok, 이름?, 출처? }
  useEffect(() => {
    if (!좌표) return
    let 끝남 = false
    // 칠 때마다 묻지 않는다 — 손을 멈춘 뒤 한 번(이용 규칙: 자동 완성 금지).
    const t = setTimeout(() => {
      getPlaceName(좌표.la, 좌표.lo)
        .then((r) => { if (!끝남) set이름결과({ 열쇠: 좌표.열쇠, ok: !!r?.ok, 이름: r?.이름, 출처: r?.출처 }) })
        .catch(() => { if (!끝남) set이름결과({ 열쇠: 좌표.열쇠, ok: false }) })
    }, 800)
    return () => { 끝남 = true; clearTimeout(t) }
  }, [좌표])
  const 받은것 = 좌표 && 이름결과?.열쇠 === 좌표.열쇠 ? 이름결과 : null
  const 지역 = 좌표 && { 관측소: 좌표.관측소, 이름: 받은것?.ok ? 받은것.이름 : null, 출처: 받은것?.ok ? 받은것.출처 : null, 못받음: !!받은것 && !받은것.ok }

  // ── 처음 한 번 지금 값을 읽는다 — **마법사는 빈 종이가 아니다** ────────────────
  // 응답 모양이 둘 다 달라 한 모양으로 맞춘다. `{ set, masked }` 는 객체라 늘 truthy — `.set` 을 본다.
  const 키읽기 = useCallback(() => Promise.all([getAPIKeys(), getKmaSettings()])
    .then(([ai, kma]) => set키현황({
      gemini: { set: !!ai?.gemini?.set, masked: ai?.gemini?.masked || '' },
      kma: { set: !!kma?.apiKeySet, masked: kma?.apiKeyMasked || '' },
    }) || set좌표읽음({ lat: kma?.lat ?? '', lon: kma?.lon ?? '' }))
    .catch(() => set키현황(null)), [])

  // ── **처음 안내는 맨 처음 설정 때만** (사용자 신고 2026-09-18) ────────────────────────────
  // *"초기설정하고 나서 완료되면 왜 바로 처음 안내 다시보기 나와 … 맨처음 기초설정 말고는 … 굳이 처음 안내 다시보기 안해도 되고"*
  // 앞 판은 끝낼 때 `나가기(true)` 로 **언제나** 처음 안내를 켰다. 메뉴 → 초기 설정으로 다시 들어와 끝내도 11장이 또 떴다.
  //
  // **「끝냈나」가 아니라 「처음인가」를 본다.** 현장 PC 는 마법사가 생기기 전부터 돌던 PC 라 `setup_done_at` 이
  // **비어 있다**(2026-09-18 현장 사본 확인) — 「끝냈나」만 보면 현장에서 메뉴로 초기 설정을 열어 끝내는 순간
  // 「처음」으로 읽혀 아래 자막 크기까지 바뀐다. 서버의 「처음인가」는 **끝낸 적도 없고 방송도 한 번도 안 한** PC 만
  // 참이라, 방송 기록이 수백 건인 현장은 절대 처음이 안 된다.
  // **들어올 때** 읽는다 — 끝낼 때 읽으면 `markSetupSeen()` 이 표시를 세운 뒤고, 소리 시험이 기록을 남겼을 수도 있다.
  // **못 읽으면 처음이 아닌 것으로 본다** — 잘못 「처음」으로 보면 쓰던 PC 의 방송 글자가 작아진다. 반대쪽 손해
  // (새 PC 가 안내를 못 봄)는 메뉴의 「처음 안내 다시 보기」로 메울 수 있다.
  const 처음설정 = useRef(false)
  useEffect(() => {
    getSetupState().then((s) => { 처음설정.current = !!s?.처음인가 }).catch(() => { /* 못 읽으면 처음이 아니다 */ })
  }, [])

  // 떠 있는 동안 「방송 화면」 단추를 감춘다(index.css `body[data-cc-setup]`) — 마법사 위로 올라온다.
  useEffect(() => {
    document.body.dataset.ccSetup = '1'
    return () => { delete document.body.dataset.ccSetup }
  }, [])

  useEffect(() => {
    getOrgInfo().then((d) => {
      const v = { name: d?.name || '', slogan: d?.slogan || '' }
      setOrg(v); set이름초안(v.name); set표어초안(v.slogan)
    }).catch(() => setOrg(null))
    getTTSSettings().then((t) => {
      const v = { audioDevice: t?.audioDevice ?? '' }
      setTts(v); set장치초안(v.audioDevice)
    }).catch(() => setTts(null))
    // 장치 목록은 PowerShell 조회라 느릴 수 있다 — 실패해도 마법사는 계속 간다.
    getAudioDevices().then((d) => set장치목록(Array.isArray(d) ? d : [])).catch(() => set장치목록([]))
    getServerInfo().then((info) => {
      const 후보 = Array.isArray(info?.addresses) ? info.addresses : []
      const 고른것 = 후보.find((r) => r.recommended) || 후보.find((r) => !r.virtual) || 후보[0]
      // 마이크용(보안) QR 은 뺐다(사용자 지시 2026-09-17 「어차피 휴대폰으로 열어서 새로 열면 되는거잖아」) —
      // 휴대폰에서 마이크를 누르면 그 화면이 보안 주소로 안내한다(InstantBroadcast). QR 은 하나만 둔다.
      set주소({ url: 고른것 ? `http://${고른것.address}:${info.port}` : '', 후보들: 후보, port: info.port })
    }).catch(() => set주소(null))
    // 못 읽으면 「동의한 적 없음」으로 두고 다시 받는다 — 동의는 더하기라 덮을 것이 없다.
    getLicenseConsent().then((r) => set동의기록(r?.consent ?? null)).catch(() => set동의기록(null))
    키읽기()
  }, [키읽기])

  const 현재 = 단계목록.find((s) => s.id === 단계) ?? 단계목록[0]
  const 이동 = useCallback((id) => { set단계(id); set알림('') }, [])
  const 옆으로 = (delta) => {
    const i = 단계목록.findIndex((s) => s.id === 단계)
    이동(단계목록[Math.min(단계목록.length - 1, Math.max(0, i + delta))].id)
  }

  const 이름오류 = 기관글자검사(이름초안)
  const 표어오류 = 기관글자검사(표어초안)

  // **저장해도 되는가는 규칙 모듈이 정한다** — 화면이 판정하지 않는다.
  const 저장판정 = 저장해도되나(단계, { 이름: 이름초안, 표어: 표어초안, 키들: 키초안, 장치: 장치초안, 위도: 위도초안, 경도: 경도초안, 동의함, 동의자: 동의자초안 }, { org, tts })
  const 저장가능 = 저장판정.ok

  // 바뀐 것이 있는가 — 안 바꿨으면 「다음」이 아무것도 보내지 않는다.
  // **지금 값을 못 읽었어도(null) 사람이 적거나 고른 것은 「바뀜」이다** (적대적 검증 T-32-2, 2026-09-17).
  // 앞 판은 `org &&`·`tts &&` 로 묶어 조회 실패 때 바뀜=false → 입력을 **말없이 버리고** 다음 장으로 넘어갔고,
  // 「못 읽었습니다 — 새로고침」 안내도 안 보였다. 이제 바뀜이 서면 저장 규칙이 막고 그 이유가 화면에 뜬다.
  const 바뀜 = (단계 === 'org' && (org
      ? (이름초안 !== org.name || 표어초안 !== org.slogan)
      : !!(이름초안.trim() || 표어초안.trim())))
    || (단계 === 'speaker' && (tts ? 장치초안 !== tts.audioDevice : 장치초안 !== ''))
    || (단계 === 'api' && (Object.values(키초안).some((v) => v.trim())
        || !!(String(위도초안).trim() && String(경도초안).trim())))
    // 이용 조건: 표시했거나 이름을 적기 시작했으면 「바뀜」 — 그때부터 저장 규칙이 이유를 말한다.
    // **이미 이번 판에 동의했으면 바뀜이 아니다**(검수 1회차 Low): 읽기 전에 표시만 해 두고 「이미 동의」가
    // 돌아오면 입력칸은 사라지는데 바뀜만 남아 「다음」이 잠기고 고칠 칸도 없었다.
    || (단계 === 'terms' && 동의필요(동의기록) && (동의함 || !!동의자초안.trim()))

  // ── 「다음」 = 바뀐 것만 저장하고 넘어간다 ─────────────────────────────────
  const 다음 = async () => {
    if (마지막단계인가(단계)) return 끝내기()
    if (!바뀜) return 옆으로(1)
    if (!저장가능) return   // 이유는 아래에 적혀 있다
    set저장중(true); set알림('')
    try {
      if (단계 === 'org') {
        await saveOrgInfo({ name: 이름초안, slogan: 표어초안 })
        setOrg({ name: 이름초안, slogan: 표어초안 })
      } else if (단계 === 'speaker') {
        await saveTTSSettings({ audioDevice: 장치초안 })
        setTts({ audioDevice: 장치초안 })
        set소리(null); set울림결과('')   // 스피커가 바뀌었으니 소리 시험은 다시
      } else if (단계 === 'terms') {
        const r = await saveLicenseConsent(약관판, 동의자초안.trim())
        set동의기록(r?.consent ?? null); set동의함(false); set동의자초안('')
      } else if (단계 === 'api') {
        // ── **좌표부터 검사한다** (독립 검수 2026-09-18) ──────────────────────────────
        // 앞 판은 키를 먼저 저장하고 입력칸을 비운 뒤 좌표를 봤다. 격자가 범위 밖이면 거기서
        // 되돌아 나가는데, 그때 **키는 이미 저장됐는데 화면은 「미설정」**으로 남아 사람이
        // 키를 다시 붙여 넣었다. 검사를 앞에 두면 틀렸을 때 **아무것도 저장되지 않는다.**
        const 위 = String(위도초안).trim(), 경 = String(경도초안).trim()
        let 좌표저장 = null
        if (위 && 경) {
          const la = Number(위), lo = Number(경)
          if (!Number.isFinite(la) || !Number.isFinite(lo)) { set알림('위도·경도를 숫자로 넣어 주세요.'); set저장중(false); return }
          const g = 격자로(la, lo)
          const 밖 = 격자범위밖(g.nx, g.ny)
          if (밖) { set알림(`이 좌표로는 격자가 ${밖} — 위도·경도가 뒤바뀌지 않았는지 보세요.`); set저장중(false); return }
          const uv = 가까운자외선관측소(la, lo)
          좌표저장 = { lat: String(la), lon: String(lo), nx: String(g.nx), ny: String(g.ny), uvStn: uv.stn, uv }
        }

        for (const 항목 of 연동항목) {
          const v = 키초안[항목.id]?.trim()
          if (!v) continue
          if (항목.저장 === 'apiKeys') await saveAPIKey(항목.키, v)
          else if (항목.저장 === 'kma') await saveKmaSettings({ apiKey: v })
        }
        set키초안({ gemini: '', kma: '' })

        if (좌표저장) {
          const { uv, ...보낼것 } = 좌표저장
          await saveKmaSettings(보낼것)
          set좌표읽음({ lat: 좌표저장.lat, lon: 좌표저장.lon })
          // **자외선 관측소가 멀면 그 사실을 마무리 장까지 들고 간다.** 여기서만 띄우면
          // 곧바로 다음 장으로 넘어가 사람 눈에 안 닿는다(광주·제주권이 늘 이 경우다).
          if (uv.멀다) set먼관측소(`자외선 관측소는 ${uv.이름}이 가장 가깝고 약 ${Math.round(uv.거리)}km 떨어져 있어, 자외선 값은 이 시설과 다를 수 있습니다.`)
          else set먼관측소('')
        }
        await 키읽기()
      }
      옆으로(1)
    } catch (e) {
      // **실패를 성공처럼 보여주지 않는다.** 서버가 400 으로 막는 경우가 실제로 있다.
      set알림(`저장하지 못했습니다 — ${e?.message || '알 수 없는 오류'}`)
    } finally { set저장중(false) }
  }

  // ── 이 시설의 위치 ─────────────────────────────────────────────────────────────
  // 브라우저가 아는 위치를 **넣어만 준다.** 맞는지는 사람이 보고 넘긴다 — 실내 데스크톱은
  // 와이파이로 추정해 수백 m 틀릴 수 있다.
  //
  // **이 마법사는 `localhost` 전용이 아니다**(독립 검수 2026-09-18 정정). `이PC인가()` 는 방화벽
  // 안내 카드 하나만 감싸고, 마법사 자체는 사이드바·브랜드 메뉴에서 **어느 기기로도 열린다**
  // (`localhost` 로 제한되는 것은 첫 실행 자동 이동뿐이다 — `HomeMode.jsx` 의 `_IS_LOCAL`).
  // 브라우저 위치 기능은 `https` 또는 `localhost` 에서만 되므로, 휴대폰으로 `http://192.168…` 을
  // 열고 누르면 **「권한 거부」처럼 보이지만 진짜 이유는 주소가 http 인 것**이다. 그 사실을
  // 실패 안내에 적어 사람이 원인을 찾게 한다.
  const 지금위치 = () => {
    if (!navigator.geolocation) {
      set위치안내({ 나쁨: true, 글: '이 브라우저는 위치를 알려주지 않습니다. 위도·경도를 직접 넣어 주세요.' }); return
    }
    set위치안내({ 나쁨: false, 글: '위치를 묻는 중입니다…' })
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set위도초안(p.coords.latitude.toFixed(4)); set경도초안(p.coords.longitude.toFixed(4))
        set위치안내({ 나쁨: false, 글: `위치를 넣었습니다(오차 약 ${Math.round(p.coords.accuracy)}m). 맞는지 보고 「다음」을 누르세요.` })
      },
      (e) => set위치안내({ 나쁨: true, 글: 이PC인가()
        ? `위치를 못 받았습니다(${e.message}). 위도·경도를 직접 넣어 주세요.`
        : '휴대폰·다른 PC 에서는 위치를 받아 올 수 없습니다(주소가 http 라서요). 방송 PC 화면에서 누르거나, 위도·경도를 직접 넣어 주세요.' }),
      { timeout: 10000 },
    )
  }

  // ── 소리 시험 — **고른 스피커로 차임이 실제로 나간다** ─────────────────────────
  const 울리기 = async () => {
    if (울리는중) return
    set울리는중(true); set울림결과(''); set소리(null)
    try { await fireChime('general'); set울림결과('ok') }
    catch (e) { set울림결과(e?.message || '차임을 울리지 못했습니다.') }
    finally { set울리는중(false) }
  }

  // ── 접속 주소 — 복사 · 공유(막힌 곳에서는 복사로 떨어지고 그렇다고 말한다) ──────────
  const 복사 = async () => {
    try { await navigator.clipboard.writeText(주소.url); set공유알림('주소를 복사했어요. 카카오톡이나 문자에 붙여 넣어 보내세요.') }
    catch { set공유알림('주소를 길게 눌러 복사해 주세요.') }
  }
  const 공유 = async () => {
    if (!navigator.share) return 복사()
    try { await navigator.share({ title: 'CareCast 접속 주소', text: '시설 와이파이에서 열어 주세요', url: 주소.url }); set공유알림('') }
    catch (e) { if (e?.name !== 'AbortError') await 복사() }
  }
  const 방화벽열기 = async () => {
    set방화벽('')
    try {
      const r = await openSetupFirewall()
      // 권한 창에서 「예」를 눌렀는지는 서버도 모른다 — 「열었다」고 말하지 않는다.
      set방화벽(r?.띄움 ? '창이 떴어요. 「변경을 허용할까요?」에 「예」를 누르고, 검은 창에 「완료」가 나오면 아래 주소를 휴대폰에서 열어 보세요.'
        : '이 화면에서는 창을 띄우지 않았어요.')
    } catch (e) { set방화벽(e?.message || '창을 띄우지 못했습니다.') }
  }

  // ── 끝내기 — 봤다고 남기고, 준비가 끝날 때까지 「잠시만 기다려 주세요」 ────────────
  const 끝낸적 = useRef(false)
  const 나가기 = useCallback(async (처음안내) => {
    if (끝낸적.current) return
    끝낸적.current = true
    // **처음 설정이면 방송 화면 자막을 「중간」으로 시작한다** (사용자 지시 2026-09-18 「방송화면은 자막 중간값이 기초 설정으로」).
    // 기본값(`domain/broadcastTextSize` 의 `large`)을 바꾸지 않는 이유 — 현장 PC 는 이 값을 **저장해 두지 않고
    // 기본값을 따라가고 있어서**(2026-09-18 현장 사본 확인), 기본값을 바꾸면 다음 자동 업데이트 때 현장 방송 화면
    // 글자가 작아진다. 2026-09-15 에 사용자가 1.5배로 키워 달라고 한 바로 그 화면이다.
    // 그래서 **새로 설치한 PC 의 첫 설정에서만** 「중간」을 저장한다. 안 보낸 칸은 서버가 안 건드린다(P-115 — 이름·표어 그대로).
    const 첫설정 = 처음설정.current
    if (첫설정) { try { await saveOrgInfo({ textSize: 'medium' }) } catch { /* 못 넣어도 방송은 크게로 나간다 — 나가는 것을 막지 않는다 */ } }
    try { await markSetupSeen() } catch { /* 표시에 실패해도 나가는 것은 막지 않는다 */ }
    처음이면기본저장()   // 아직 고른 배율이 없으면 「크게」로 시작(사용자 지시 2026-09-17)
    if (처음안내 && 첫설정) { try { localStorage.setItem('carecast:tour-pending', '1') } catch { /* 못 써도 진행 */ } }
    // 이 부품은 라우터를 안 받으므로 주소로 옮긴다 — 설정을 막 끝낸 참이라 새로 뜨는 편이 깨끗하다.
    window.location.href = '/simple'
  }, [])
  const 끝내기 = () => set준비({ 시작: Date.now(), w: null, 진행: 15, 끝: false })

  const 준비시작 = 준비?.시작
  useEffect(() => {
    if (!준비시작) return
    let 살아있음 = true, 타이머 = null
    const 최소ms = 1800, 최대ms = 60_000
    const 묻기 = async () => {
      let w = null
      try { w = await getWarmup() } catch { /* 못 물으면 끝난 것으로 본다 */ }
      if (!살아있음) return
      const 지남 = Date.now() - 준비시작
      const 더기다림 = (w?.running && 지남 < 최대ms) || 지남 < 최소ms
      // 진행 막대는 **끝을 모르면 90% 에서 멈춘다** — 끝난 척하지 않는다(G-33).
      set준비((p) => (p ? { ...p, w, 진행: 더기다림 ? Math.min(90, 15 + Math.round(지남 / 600)) : 100, 끝: !더기다림 } : p))
      타이머 = 더기다림 ? setTimeout(묻기, 1500) : setTimeout(() => 나가기(true), 700)
    }
    묻기()
    return () => { 살아있음 = false; if (타이머) clearTimeout(타이머) }
  }, [준비시작, 나가기])

  const 줄들 = 준비상태({
    org, device: tts ? tts.audioDevice : null, sound: 소리,
    keys: 키현황 ? { gemini: 키현황.gemini.set, kma: 키현황.kma.set } : null,
    address: 주소 ? 주소.url : null,
  })
  const 장치이름 = (d) => (typeof d === 'string' ? d : (d?.name ?? ''))
  // **지금 설정된 장치를 맨 위에** (사용자 지시 2026-09-17) — 대개 그대로 두고 「다음」을 누르므로 눈이 먼저 가는 자리에.
  const 장치들 = 장치목록 == null ? null : (() => {
    const 전부 = [{ name: '' }, ...장치목록]
    const 지금 = tts ? 전부.findIndex((d) => 장치이름(d) === tts.audioDevice) : -1
    return 지금 > 0 ? [전부[지금], ...전부.filter((_, i) => i !== 지금)] : 전부
  })()

  // 초기 설정 판은 **보통 크기로** 띄운다 — 크게 보기 배율은 끝나면 돌아간다(bigView 「보통으로고정」).
  //
  // ── **떠 있는 동안 뒤 화면을 잠근다** (현장 지적 2026-09-18) ────────────────────────────
  // 이 판은 `fixed inset-0` 이라 화면을 다 덮는데, **뒤의 관리자 화면은 그대로 스크롤된다.**
  // 창을 줄인 노트북·태블릿(세로가 짧을 때)에서는 뒤 화면이 넘쳐 스크롤 막대가 생기고,
  // 휠을 굴리면 **막대만 움직이고 앞은 그대로**라 「스크롤이 안 먹는다」로 보인다. 그 상태에서
  // 아래쪽을 누르면 있어야 할 자리에 아무것도 없어 빈 곳을 누르게 된다.
  // 전체화면에서는 뒤 화면이 안 넘쳐 스크롤 막대가 없으니 이 증상이 안 난다 — 그래서
  // 「창 모드일 때만」으로 보였다. 사용자 원문: *"스크롤이 한계때문에 그런가 약간 위에 빈화면을 눌리는 것 같더라고"*
  //
  // 자리를 기억했다 되돌린다 — 안 그러면 마법사를 닫았을 때 관리자 화면이 맨 위로 튄다.
  useEffect(() => {
    보통으로고정(true); 먹이기(1)
    const el = document.documentElement
    const 있던스크롤 = window.scrollY
    const 있던overflow = el.style.overflow
    el.style.overflow = 'hidden'
    return () => {
      보통으로고정(false); 먹이기(배율읽기())
      el.style.overflow = 있던overflow
      window.scrollTo(0, 있던스크롤)
    }
  }, [])

  return (
    <div data-plain-cards className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-ds-v3-bg text-ds-v3-ink" role="dialog" aria-modal="true" aria-labelledby="setup-q">
      {/* 배경 물감 — 간편 화면과 같은 두 방울(dev HomeShell 값) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[-14%] top-[-22vh] h-[min(760px,calc(86vh/var(--cc-zoom,1)))]">
        <span className="absolute left-[2%] top-[2%] block h-[96%] w-[66%] rounded-full opacity-50 mix-blend-multiply blur-[78px]"
          style={{ background: 'radial-gradient(closest-side, rgba(var(--ds-v3-drop-tts),1) 0%, rgba(var(--ds-v3-drop-tts),.6) 34%, rgba(var(--ds-v3-drop-tts),.24) 56%, rgba(var(--ds-v3-drop-tts),0) 82%)' }} />
        <span className="absolute right-[2%] top-[2%] block h-[96%] w-[66%] rounded-full opacity-50 mix-blend-multiply blur-[78px]"
          style={{ background: 'radial-gradient(closest-side, rgba(var(--ds-v3-drop-bgm),1) 0%, rgba(var(--ds-v3-drop-bgm),.6) 34%, rgba(var(--ds-v3-drop-bgm),.24) 56%, rgba(var(--ds-v3-drop-bgm),0) 82%)' }} />
      </div>

      {/* ── **설치 창 크기로 떠 있다가, 끝나면 화면 가득** (사용자 아이디어 2026-09-17) ─────────────
          *"너무 넓어보이면 보기싫으니까 딱 목업 디자인 만큼 창을 최소화 했다가 설치할 때 완료되면 전체창으로"*
          **브라우저 창 자체를 줄이고 키우지 않는다** — 스스로 연 창이 아니면 크기를 못 바꾸고, 새 창을 열면
          창이 둘이 되어 「소리 내는 창(대표 탭)」 판정이 흔들린다(과거 창 여러 개로 방송 오류). 그래서 **같은 창 안에서**
          시안 크기의 둥근 판으로 띄우고, 「시작하기」를 누르면 그 판이 화면 가득 넓어진다.
          좁은 화면(휴대폰)은 처음부터 가득 쓴다 — 거기서 판을 띄우면 글자 자리만 준다. */}
      <div className={'relative flex h-full w-full flex-col overflow-hidden transition-[max-width,max-height,border-radius] duration-500 ease-out '
        + (준비 ? 'tablet:max-h-full tablet:max-w-full tablet:rounded-none'
                : 'tablet:max-h-[min(820px,calc(100%-24px))] tablet:max-w-[min(1060px,calc(100%-48px))] tablet:rounded-[28px] tablet:border tablet:border-white/70 tablet:bg-white/55 tablet:shadow-[0_24px_70px_rgba(26,29,46,.14)] tablet:backdrop-blur-xl')}>

      {/* 머리 — 로고 · 몇 번째인지(점) · 나중에 설정하기 */}
      <header className="relative flex items-center gap-4 px-5 tablet:px-8 py-3">
        <BrandMark size="lg" />
        <div className="mx-auto flex items-center gap-1.5" aria-hidden="true">
          {단계목록.map((s) => (
            <span key={s.id} className={'h-2 rounded-full transition-all '
              + (s.id === 단계 ? 'w-6 bg-ds-v3-ink' : s.번호 < 현재.번호 ? 'w-2 bg-ds-v3-ink-3' : 'w-2 bg-ds-v3-line-2')} />
          ))}
        </div>
        <button type="button" onClick={() => 나가기(false)}
          className="min-h-[44px] px-3 rounded-full text-[15px] font-semibold text-ds-v3-ink-2 hover:bg-white/70">
          나중에 설정하기
        </button>
      </header>
      <div className="sr-only" aria-live="polite">{현재.번호} / {단계목록.length} {현재.제목} · 진행 {Math.round(진행률(단계) * 100)}%</div>

      {/* 본문 — 한 장에 한 질문 */}
      <main className="relative flex-1 overflow-y-auto px-5 tablet:px-8">
        {/* 위 여백은 창 높이에 맞춰 줄인다 — 노트북(세로 700px대)에서 끌어 내리지 않고 한 장이 다 보이게(2026-09-17) */}
        <div className="mx-auto w-full max-w-[700px] pt-4 tablet:pt-[clamp(8px,3vh,40px)] pb-6">
          <p className="text-[15px] font-semibold text-ds-v3-ink-3 tabular-nums">{현재.번호} / {단계목록.length}</p>
          <h2 id="setup-q" className="mt-2 text-[clamp(26px,4vw,36px)] [@media(max-height:720px)]:mt-1 [@media(max-height:720px)]:text-[26px] font-semibold leading-tight tracking-tight">{현재.질문}</h2>
          <p className="mt-3 [@media(max-height:720px)]:mt-1.5 text-[17px] [@media(max-height:720px)]:text-[16px] leading-relaxed text-ds-v3-ink-2">{현재.도움}</p>

          <div className="mt-[clamp(16px,3.2vh,32px)]">
            {단계 === 'org' && (
              <div className="space-y-6">
                <label className="block">
                  <span className="block text-[15px] font-semibold mb-2">기관 이름</span>
                  <input className={큰입력} value={이름초안} onChange={(e) => set이름초안(e.target.value)} />
                  <span className={'block mt-2 text-sm ' + (이름오류 ? 'text-ds-v3-warn' : 'text-ds-v3-ink-3')}>
                    {이름오류 || `${기관글자수상한}자까지 · 비우면 화면에 이름이 안 나옵니다`}
                  </span>
                </label>
                <label className="block">
                  <span className="block text-[15px] font-semibold mb-2">방송 대기 문구 <span className="font-normal text-ds-v3-ink-3">(선택)</span></span>
                  <input className={큰입력} value={표어초안} onChange={(e) => set표어초안(e.target.value)} />
                  {표어오류 && <span className="block mt-2 text-sm text-ds-v3-warn">{표어오류}</span>}
                </label>
              </div>
            )}

            {단계 === 'terms' && (
              <div className="space-y-4">
                {동의기록 && !동의필요(동의기록) && (
                  <p className="flex items-center gap-2 rounded-[14px] bg-ds-v3-surface-2 px-4 py-3 text-[15px] text-ds-v3-ink-2">
                    <Check size={18} aria-hidden="true" /> 이미 동의했습니다 — {동의기록.by} · {동의날짜(동의기록.at)}
                  </p>
                )}
                <ol className="m-0 list-none space-y-2.5 rounded-[22px] bg-white/85 p-5 shadow-v3-card">
                  {약관항목.map((x, i) => (
                    <li key={i}>
                      <p className="text-[16px] font-semibold">{i + 1}. {x.제목}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-ds-v3-ink-2">{x.글}</p>
                    </li>
                  ))}
                </ol>
                <p className="text-[14px] text-ds-v3-ink-3">
                  이용 제한 전체와 뽑아 붙일 게시문은 메뉴 → 라이선스 · 고지에 있습니다.
                </p>
                {동의필요(동의기록) && (<>
                  <label className="flex min-h-[52px] items-center gap-3 text-[16px] font-semibold">
                    <input type="checkbox" className="h-6 w-6" checked={동의함} onChange={(e) => set동의함(e.target.checked)} />
                    위 내용을 읽었고 동의합니다
                  </label>
                  <label className="block">
                    <span className="block text-[15px] font-semibold mb-2">동의하는 분 (이름 또는 직책)</span>
                    <input className={큰입력} value={동의자초안} onChange={(e) => set동의자초안(e.target.value)} placeholder="예: 사무국장" />
                  </label>
                </>)}
              </div>
            )}

            {단계 === 'ready' && <div className="rounded-[22px] bg-white/85 p-5 shadow-v3-card"><SetupPrereqs /></div>}

            {단계 === 'speaker' && (
              <div role="radiogroup" aria-label="출력 장치" className="space-y-2.5">
                {장치목록 == null && <p className="flex items-center gap-2 text-[16px] text-ds-v3-ink-2"><Loader2 size={18} className="motion-safe:animate-spin" /> 이 PC 의 스피커를 찾고 있어요…</p>}
                {장치들 != null && 장치들.map((d) => {
                  const 이름 = 장치이름(d)
                  const 고름 = 장치초안 === 이름
                  return (
                    <button key={이름 || '기본'} type="button" role="radio" aria-checked={고름} onClick={() => set장치초안(이름)}
                      className={'flex w-full items-center gap-3 min-h-[60px] px-4 rounded-[14px] border text-left text-[17px] transition-colors '
                        + (고름 ? 'border-ds-v3-ink bg-white font-semibold shadow-v3-card' : 'border-ds-v3-line bg-white/70 hover:bg-white')}>
                      <span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ' + (고름 ? 'border-ds-v3-ink' : 'border-ds-v3-line-2')}>
                        {고름 && <span className="h-3 w-3 rounded-full bg-ds-v3-ink" />}
                      </span>
                      <span className="min-w-0 flex-1 break-words">{이름 || 'Windows 기본 장치'}</span>
                      {tts && tts.audioDevice === 이름 && <span className="shrink-0 text-sm font-normal text-ds-v3-ink-3">지금 설정</span>}
                    </button>
                  )
                })}
                {/* **목록 새로 고침** (사용자 지시 2026-09-17 「추후에 들어올 수 있단 말이야」) — 스피커·앰프 선을 꽂은 뒤
                    다시 찾는다. 서버는 매번 캐시를 비우고 새로 조회한다(routes/audio.js GET /devices). */}
                {장치목록 != null && (
                  <button type="button" onClick={() => { set장치목록(null); getAudioDevices().then((d) => set장치목록(Array.isArray(d) ? d : [])).catch(() => set장치목록([])) }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ds-v3-line-2 bg-white px-4 text-[15px] font-semibold text-ds-v3-ink-2 hover:bg-ds-v3-surface-2">
                    <RefreshCw size={16} aria-hidden="true" /> 목록 새로 고침
                  </button>
                )}
                {장치목록 != null && 장치목록.length === 0 && (
                  <p className="text-sm text-ds-v3-ink-3">스피커를 따로 못 찾았어요. 앰프·스피커 선을 꽂았다면 「목록 새로 고침」을 눌러 보세요. 모르겠으면 「Windows 기본 장치」로 두셔도 됩니다.</p>
                )}
                {/* 목록 조회가 실패해도 지금 저장된 장치는 고를 수 있게 남긴다 */}
                {장치목록 != null && 장치초안 && !장치목록.some((d) => 장치이름(d) === 장치초안) && (
                  <p className="text-sm text-ds-v3-ink-3">지금 설정된 「{장치초안}」은 목록에서 못 찾았어요. 다른 장치를 골라 보세요.</p>
                )}
              </div>
            )}

            {단계 === 'sound' && (
              <div className="flex flex-col items-center text-center">
                <button type="button" onClick={울리기} disabled={울리는중} aria-label="차임 울려 보기"
                  className="relative grid h-32 w-32 place-items-center rounded-full bg-white shadow-v3-card text-ds-v3-tts disabled:opacity-80">
                  {울리는중 && <span className="absolute inset-0 rounded-full border-4 border-ds-v3-tts/40 motion-safe:animate-ping" />}
                  <Bell size={44} strokeWidth={1.8} />
                </button>
                <p className="mt-4 text-[17px] font-semibold">{울리는중 ? '울리는 중…' : 울림결과 === 'ok' ? '딩동 — 들리셨나요?' : '눌러서 차임 울려 보기'}</p>
                {울림결과 && 울림결과 !== 'ok' && <p className="mt-2 text-[15px] text-ds-v3-warn" role="alert">{울림결과}</p>}
                <p className="mt-1 text-sm text-ds-v3-ink-3">고른 스피커: {tts?.audioDevice || 'Windows 기본 장치'}</p>

                {울림결과 && (
                  <div role="radiogroup" aria-label="소리가 들렸나요" className="mt-6 grid w-full max-w-[420px] grid-cols-2 gap-3">
                    {[['들림', '들려요'], ['안 들림', '안 들려요']].map(([값, 글]) => {
                      const 고름 = 소리 === 값, 다른것골랐나 = 소리 && !고름
                      return (
                        <button key={값} type="button" role="radio" aria-checked={고름} onClick={() => set소리(값)}
                          className={'flex min-h-[60px] items-center justify-center gap-2 rounded-[14px] border-2 text-[17px] font-semibold transition '
                            + (고름 ? (값 === '들림' ? 'border-ds-v3-tts bg-ds-v3-tts text-white' : 'border-ds-v3-warn bg-ds-v3-warn text-white')
                              : 'border-ds-v3-line-2 bg-white text-ds-v3-ink')
                            + (다른것골랐나 ? ' opacity-45' : '')}>
                          {고름 && <Check size={20} />} {글}
                        </button>
                      )
                    })}
                  </div>
                )}
                {소리 === '안 들림' && (
                  <p className="mt-4 text-[15px] text-ds-v3-ink-2">
                    <b className="font-semibold">다른 장치를 골라 보세요.</b> 스피커 전원·볼륨도 함께 확인해 주세요.{' '}
                    <button type="button" onClick={() => 이동('speaker')} className="font-semibold text-ds-v3-tts underline underline-offset-4 min-h-[44px]">스피커 다시 고르기</button>
                  </p>
                )}
                {소리 === '들림' && <p className="mt-4 text-[15px] text-ds-v3-ink-2"><b className="font-semibold">좋습니다.</b> 이 장치로 모든 방송이 나갑니다.</p>}
              </div>
            )}

            {단계 === 'api' && (
              <div className="space-y-6 [@media(max-height:720px)]:space-y-3">
                {연동항목.map((항목) => (
                  <label key={항목.id} className="block">
                    <span className="mb-2 flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-semibold">{항목.이름}</span>
                      <a href={항목.발급링크} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[15px] font-semibold text-ds-v3-tts hover:underline">
                        발급받기 <ExternalLink size={14} />
                      </a>
                    </span>
                    <input className={큰입력} type="password" autoComplete="off"
                      value={키초안[항목.id]} onChange={(e) => set키초안((k) => ({ ...k, [항목.id]: e.target.value }))}
                      placeholder={키현황?.[항목.id]?.set ? `저장됨 (${키현황[항목.id].masked}) — 바꾸려면 새 키를 넣으세요` : '받은 키를 붙여 넣기'} />
                    <span className="mt-2 [@media(max-height:720px)]:mt-1 block text-sm leading-relaxed text-ds-v3-ink-3">{항목.쓰임}</span>
                  </label>
                ))}

                {/* ── **이 시설의 위치** (2026-09-18) ────────────────────────────────────────────
                    안 넣으면 **기본값(서울) 날씨가 조용히 나간다.** 기상청이 막혔을 때 쓰는
                    Open-Meteo 가 위경도로만 조회하기 때문이다(`weather.js:371,533`). 오류도 경고도
                    안 나서 설치한 기관은 자기 날씨인 줄 안다 — 그래서 키를 묻는 이 자리에서 함께 묻는다.
                    격자·자외선 관측소는 좌표에서 계산되므로 사람이 번호를 찾을 필요가 없다. */}
                <div className="rounded-[22px] border border-ds-v3-line bg-white/80 px-5 py-4">
                  <b className="block text-[18px] font-semibold">이 시설은 어디에 있나요?</b>
                  <p className="mt-1 text-[15px] leading-relaxed text-ds-v3-ink-2">
                    날씨를 이 지역 기준으로 읽어 줍니다.{' '}
                    {좌표읽음?.lat && 좌표읽음?.lon
                      ? <b className="font-semibold">지금은 위도 {좌표읽음.lat}, 경도 {좌표읽음.lon} 로 설정돼 있습니다.</b>
                      : <b className="font-semibold">안 넣으면 기본값(서울) 날씨가 나갑니다.</b>}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={지금위치}
                      className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-ds-v3-ink px-5 text-[16px] font-semibold text-white">
                      <MapPin size={17} /> 지금 위치로 넣기
                    </button>
                    <input className="min-h-[48px] w-[8.5rem] rounded-[14px] border border-ds-v3-line-2 bg-white px-3 text-[16px] nums"
                      type="number" step="0.0001" inputMode="decimal" aria-label="위도"
                      value={위도초안} onChange={(e) => set위도초안(e.target.value)} placeholder="위도 37.5665" />
                    <input className="min-h-[48px] w-[8.5rem] rounded-[14px] border border-ds-v3-line-2 bg-white px-3 text-[16px] nums"
                      type="number" step="0.0001" inputMode="decimal" aria-label="경도"
                      value={경도초안} onChange={(e) => set경도초안(e.target.value)} placeholder="경도 126.9780" />
                  </div>
                  {지역 && (
                    <p className="mt-2 text-[15px] text-ds-v3-ink" role="status" data-testid="place-name">
                      <MapPin size={15} className="mr-1 inline -mt-0.5" aria-hidden="true" />
                      {지역.이름
                        ? <b className="font-semibold">{지역.이름}</b>
                        : 지역.못받음
                          ? <span className="text-ds-v3-ink-2">지역 이름을 못 받았습니다 — 지도 앱에서 좌표를 확인해 주세요</span>
                          : <span className="text-ds-v3-ink-2">지역 이름을 찾는 중…</span>}
                      <span className="text-ds-v3-ink-2"> · {지역.관측소}</span>
                      {지역.출처 && <span className="ml-1 text-[13px] text-ds-v3-ink-3">({지역.출처})</span>}
                    </p>
                  )}
                  {위치안내 && <p className={'mt-2 text-sm font-semibold ' + (위치안내.나쁨 ? 'text-ds-v3-warn' : 'text-ds-v3-ink')} role="status">{위치안내.글}</p>}
                  <p className="mt-2 text-sm text-ds-v3-ink-3">위치에 오차가 있다면 설정 → AI · API 연동에서 위도·경도를 직접 입력해 주세요. 지도 앱에서 시설을 길게 누르면 위도·경도가 나옵니다.</p>
                </div>
              </div>
            )}

            {단계 === 'address' && (
              <div className="space-y-5">
                {/* ── **허용이 먼저, 주소는 그다음** (현장 지적 2026-09-18) ────────────────────────
                    앞 판은 주소·QR 을 위에 두고 방화벽 허용을 아래에 뒀다. 그런데 **사람이 실제로 하는 순서는
                    반대다** — 허용을 안 하면 주소를 쳐도 안 열리고 QR 을 찍어도 안 열린다. 위에서부터 하다가
                    안 되니까 아래로 내려가 허용을 누르고 다시 올라와야 했다.
                    사용자 원문: *"권한설정을 하고 주소를 복사하고 카메라로 QR 가보지 않을까?"* */}
                {주소 == null && <p className="text-[16px] text-ds-v3-ink-2">주소를 불러오지 못했어요. 서버 연결을 확인해 주세요.</p>}
                {주소 && !주소.url && <p className="text-[16px] text-ds-v3-warn">다른 기기에서 들어올 주소를 찾지 못했어요. 이 PC 의 유선·와이파이 연결을 확인해 주세요.</p>}
                {이PC인가() && (
                  <div className="rounded-[22px] border border-ds-v3-line bg-white/80 px-5 py-4">
                    <span className="inline-block rounded-full bg-ds-v3-surface-2 px-2.5 py-0.5 text-[13px] font-semibold text-ds-v3-ink-2">먼저 · 이 PC 에서 한 번만</span>
                    <b className="mt-2 block text-[18px] font-semibold">휴대폰이 들어올 수 있게 열기</b>
                    <p className="mt-1 text-[15px] leading-relaxed text-ds-v3-ink-2">Windows 가 다른 기기의 접속을 막아 두고 있어요.<br />한 번 열어 두면 시설 와이파이 안에서만 들어올 수 있어요.</p>
                    <button type="button" onClick={방화벽열기}
                      className="mt-3 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-ds-v3-ink px-5 text-[16px] font-semibold text-white">
                      <ShieldCheck size={18} /> 휴대폰 접속 허용하기
                    </button>
                    <p className="mt-2 text-sm text-ds-v3-ink-3">「변경을 허용할까요?」가 뜨면 「예」를 눌러 주세요. 그다음에 아래 주소를 휴대폰에서 열면 됩니다.</p>
                    {방화벽 && <p className="mt-2 text-[15px] font-semibold text-ds-v3-ink" role="status">{방화벽}</p>}
                  </div>
                )}
                {주소?.url && (
                  <div className="rounded-[22px] bg-white px-5 py-4 shadow-v3-card tablet:flex tablet:items-center tablet:gap-5">
                    <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="min-w-0 flex-1 break-all text-[22px] font-semibold tabular-nums select-all">{주소.url}</code>
                      <button type="button" onClick={복사} className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full border border-ds-v3-line-2 px-4 text-[15px] font-semibold"><Copy size={16} /> 복사</button>
                      <button type="button" onClick={공유} className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full border border-ds-v3-line-2 px-4 text-[15px] font-semibold"><Share2 size={16} /> 공유</button>
                    </div>
                    <p className="mt-3 text-sm text-ds-v3-ink-3">시설 와이파이에 연결된 기기에서만 열려요. 휴대폰 데이터(LTE)로는 안 열립니다.</p>
                    {공유알림 && <p className="mt-2 text-sm font-semibold text-ds-v3-tts" role="status">{공유알림}</p>}
                    </div>
                    {/* **휴대폰 카메라로 찍으면 바로 열린다** (사용자 지시 2026-09-17 「QR로 만들어주면 … 직접 입력하기 좀 그렇잖아」).
                        휴대폰 화면에서는 안 그린다 — 이미 휴대폰으로 보고 있다. */}
                    <div className="hidden shrink-0 gap-3 tablet:flex">
                      <AddressQR url={주소.url} size={92} label="휴대폰으로 열기" />
                    </div>
                  </div>
                )}
                <p className="text-sm leading-relaxed text-ds-v3-ink-3">그래도 안 열리면 휴대폰이 <b className="font-semibold">다른 공유기</b>에 붙어 있을 수 있어요 — 휴대폰 와이파이 이름이 이 PC 와 같은지 확인해 주세요.</p>
              </div>
            )}

            {단계 === 'done' && (
              <div className="space-y-4 [@media(max-height:720px)]:space-y-2.5">
                <p className="text-[17px] font-semibold">{마무리문구(줄들)}</p>
                {/* **자외선 관측소가 멀면 여기서 말한다** — 좌표를 저장한 장에서만 띄우면
                    곧바로 다음 장으로 넘어가 사람 눈에 안 닿는다(광주·제주권이 늘 이 경우다). */}
                {먼관측소 && (
                  <p className="rounded-[14px] bg-ds-v3-warn-bg px-4 py-3 text-[15px] leading-relaxed text-ds-v3-ink" role="status">
                    {먼관측소}
                  </p>
                )}
                <ul className="divide-y divide-ds-v3-line rounded-[22px] bg-white px-5 shadow-v3-card">
                  {줄들.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-4 [@media(max-height:720px)]:py-2.5 text-[16px]">
                      <span className="font-semibold">{r.이름}</span>
                      <span className={'text-right ' + (r.상태 === '실패' ? 'font-semibold text-ds-v3-warn' : r.상태 === '정상' ? 'text-ds-v3-ink' : 'text-ds-v3-ink-3')}>
                        {r.상태 === '정상' ? r.문구 : `${r.상태} · ${r.문구}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-ds-v3-ink-3">이 표는 실제로 받아 온 값만 봅니다. 해 보지 않은 것은 「확인 불가」로 남습니다.</p>
              </div>
            )}

            {/* **「다음」만 잠그면 사람은 왜인지 모른다** — 막힌 이유를 적는다 */}
            {바뀜 && !저장판정.ok && 저장판정.이유 && (
              <p className="mt-5 rounded-[14px] bg-ds-v3-surface-2 px-4 py-3 text-[15px] text-ds-v3-ink-2" role="alert">{저장판정.이유}</p>
            )}
            {알림 && <p className="mt-5 text-[15px] font-semibold text-ds-v3-warn" role="alert">{알림}</p>}
          </div>
        </div>
      </main>

      {/* 아래 — 이전 · 다음 */}
      <footer className="relative flex items-center gap-3 border-t border-ds-v3-line bg-white/80 px-5 tablet:px-8 py-4 backdrop-blur">
        <button type="button" onClick={() => 옆으로(-1)} disabled={현재.번호 === 1}
          className="inline-flex min-h-[52px] items-center gap-1 rounded-full px-5 text-[16px] font-semibold text-ds-v3-ink-2 hover:bg-ds-v3-surface-2 disabled:invisible">
          <ChevronLeft size={18} /> 이전
        </button>
        <button type="button" onClick={다음} disabled={저장중 || (바뀜 && !저장가능)}
          className="ml-auto inline-flex min-h-[52px] min-w-[140px] items-center justify-center gap-2 rounded-full bg-ds-v3-ink px-7 text-[17px] font-semibold text-white disabled:opacity-50">
          {저장중 && <Loader2 size={18} className="motion-safe:animate-spin" />}
          {마지막단계인가(단계) ? '시작하기'
            : 단계 === 'api' && !바뀜 ? '건너뛰고 다음'
            : 단계 === 'sound' && !소리 ? '건너뛰고 다음'
            : 단계 === 'terms' && !바뀜 && 동의필요(동의기록) ? '건너뛰고 다음'
            : 단계 === 'terms' && 바뀜 ? '동의하고 다음'
            : '다음'}
        </button>
      </footer>
      </div>

      {/* 마지막 — 잠시만 기다려 주세요. 판이 가득 넓어진 뒤(0.45초) 스며든다. 움직임 줄이기면 바로 뜬다. */}
      {준비 && (
        <div className="fixed inset-0 z-[80] grid place-items-center overflow-hidden bg-white/60 backdrop-blur-xl motion-safe:animate-[cc-fade-in_.4s_.45s_both]" role="status" aria-live="polite">
          <span aria-hidden="true" className="absolute -left-[10%] -top-[15%] h-[70vmax] w-[70vmax] rounded-full opacity-70 blur-[60px] motion-safe:animate-[cc-drift-b_9s_ease-in-out_infinite]"
            style={{ background: 'radial-gradient(circle, rgba(var(--ds-v3-drop-tts),.75), rgba(var(--ds-v3-drop-tts),0) 68%)' }} />
          <span aria-hidden="true" className="absolute -bottom-[18%] -right-[12%] h-[70vmax] w-[70vmax] rounded-full opacity-70 blur-[60px] motion-safe:animate-[cc-drift-r_11s_ease-in-out_infinite]"
            style={{ background: 'radial-gradient(circle, rgba(var(--ds-v3-drop-bgm),.7), rgba(var(--ds-v3-drop-bgm),0) 68%)' }} />
          <div className="relative px-6 text-center">
            <h3 className="text-[clamp(28px,4.5vw,40px)] font-semibold tracking-tight">잠시만 기다려 주세요</h3>
            <p className="mt-3 text-[18px] text-ds-v3-ink-2">따뜻한 하루가 좋은 소리로 시작됩니다</p>
            <div className="mx-auto mt-8 h-1.5 w-[min(320px,calc(70vw/var(--cc-zoom,1)))] overflow-hidden rounded-full bg-white/80">
              <div className="h-full rounded-full bg-ds-v3-ink transition-[width] duration-700"
                style={{ width: `${준비.진행}%` }} />
            </div>
            <p className="mt-3 text-[15px] text-ds-v3-ink-3">{준비.끝 ? '준비가 끝났어요' : 준비문구(준비.w)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
