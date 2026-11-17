// 날씨 연동 카드 — 기상청·에어코리아.
//
// APISettings.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
// SrcBadge를 여기 같이 둔 이유: 쓰는 곳이 KmaApiCard 안 여섯 곳뿐이라 공용 잎이 아니다.
import { useState, useEffect } from 'react'
import { Cloud, Wind, RefreshCw, MapPin } from 'lucide-react'
import { 격자로, 위경도로, 격자범위밖, 가까운자외선관측소 } from '../../../lib/kmaGrid'
import { Badge } from '../../shared/Badge'
import ConnectionErrorNote from '../../shared/ConnectionErrorNote'
import {
  getKmaSettings, saveKmaSettings, getWeather, getAirQuality, getWeatherAlert, getUVIndex, getUVDebug, getMorningText, getAirKoreaSettings, saveAirKoreaSettings,
} from '../../../lib/api'
import { ApiKeyField } from './apiKeyField'

// ── 데이터 출처 배지 ──────────────────────────────────────────
function SrcBadge({ src }) {
  const isKma  = src === 'kma' || src === 'apihub' || src === 'kma-v2'
  const label  = src === 'apihub' ? 'KMA apihub' : src === 'kma-v2' ? 'KMA V2' : src === 'kma' ? 'KMA' : src === 'open-meteo' ? 'Open-Meteo' : src
  return (
    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap
      ${isKma ? 'bg-ds-v3-tts-bg text-ds-v3-tts' : 'bg-ds-v3-surface-2 text-ds-v3-ink-2'}`}>
      {label}
    </span>
  )
}

// ── 기상청 API 카드 ──────────────────────────────────────────
function KmaApiCard() {
  const [apiKey,        setApiKey]        = useState('')
  const [apihubKey,     setApihubKey]     = useState('')
  const [alertApiKey,   setAlertApiKey]   = useState('')
  const [livingApiKey,  setLivingApiKey]  = useState('')
  // **빈칸으로 시작한다**(UX-08, 2026-09-11). 예전엔 처음 운영한 시설의 격자·관측소·지역코드가
  // 박혀 있었다. 다른 지역 시설이 설치하면 화면에는 숫자가 차 있고, 그대로 저장하면
  // **남의 동네 날씨를 방송한다.** 빈칸이면 사람이 "뭘 넣지" 하고 멈추지만, 남의 좌표가
  // 차 있으면 멈추지 않는다 — 조용한 오독이 이 저장소에서 가장 비싼 실패다.
  // 저장된 값이 있으면 `refresh()` 가 채운다.
  const [nx,            setNx]            = useState('')
  const [ny,            setNy]            = useState('')
  const [uvStn,         setUvStn]         = useState('')
  const [areaNo,        setAreaNo]        = useState('')
  const [uvAreaNo,      setUvAreaNo]      = useState('')
  // 좌표로 격자를 계산하는 칸. 저장 대상이 아니라 **계산용**이라 settings 에 안 들어간다.
  const [위도,          set위도]          = useState('')
  const [경도,          set경도]          = useState('')
  const [좌표안내,      set좌표안내]      = useState(null)
  const [isSet,         setIsSet]         = useState(false)
  const [masked,        setMasked]        = useState(null)
  const [apihubIsSet,   setApihubIsSet]   = useState(false)
  const [apihubMasked,  setApihubMasked]  = useState(null)
  const [alertIsSet,    setAlertIsSet]    = useState(false)
  const [alertMasked,   setAlertMasked]   = useState(null)
  const [livingIsSet,   setLivingIsSet]   = useState(false)
  const [livingMasked,  setLivingMasked]  = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [testing,       setTesting]       = useState(false)
  const [preview,       setPreview]       = useState(null)
  const [previewInfo,   setPreviewInfo]   = useState(null)
  const [toast,         setToast]         = useState('')
  const [연동오류,     set연동오류]     = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const refresh = () => getKmaSettings().then(d => {
    setIsSet(d.apiKeySet);             setMasked(d.apiKeyMasked)
    setApihubIsSet(d.apihubKeySet);    setApihubMasked(d.apihubKeyMasked)
    setAlertIsSet(d.alertApiKeySet);   setAlertMasked(d.alertApiKeyMasked)
    setLivingIsSet(d.livingApiKeySet); setLivingMasked(d.livingApiKeyMasked)
    // 서버가 빈 값을 주면 **빈칸 그대로 둔다** — `?? ''` 로 undefined 를 지운다.
    setNx(d.nx ?? ''); setNy(d.ny ?? '')
    if (d.uvStn)   setUvStn(d.uvStn)
    if (d.areaNo)   setAreaNo(d.areaNo)
    if (d.uvAreaNo) setUvAreaNo(d.uvAreaNo)
    // **저장해 둔 좌표를 되살린다** (2026-09-18). 앞 판은 위경도를 화면에만 두고 저장하지
    // 않아, 새로고침하면 빈칸이 되고 「넣은 적이 없는」 것처럼 보였다.
    if (d.lat) set위도(String(d.lat))
    if (d.lon) set경도(String(d.lon))
  }).catch(() => {})

  useEffect(() => { refresh() }, [])

  // 위경도 → 격자. 자외선 관측소도 같이 골라 준다 — 사람이 그 번호를 또 찾게 하지 않는다.
  const 계산하기 = () => {
    const la = Number(위도), lo = Number(경도)
    if (!String(위도).trim() || !String(경도).trim() || !Number.isFinite(la) || !Number.isFinite(lo)) {
      set좌표안내({ 나쁨: true, 글: '위도와 경도를 숫자로 넣어 주세요.' }); return
    }
    const g = 격자로(la, lo)
    const 밖 = 격자범위밖(g.nx, g.ny)
    if (밖) { set좌표안내({ 나쁨: true, 글: `이 좌표로는 격자가 ${밖} — 위도·경도가 뒤바뀌지 않았는지 보세요.` }); return }
    setNx(String(g.nx)); setNy(String(g.ny))
    const uv = 가까운자외선관측소(la, lo)
    setUvStn(uv.stn)
    set좌표안내({
      나쁨: uv.멀다,
      // **멀면 멀다고 말한다.** 관측소가 넷뿐이라 광주·제주는 반드시 멀리 걸린다.
      // 그 사실을 숨기면 엉뚱한 지역의 자외선을 방송한다.
      글: uv.멀다
        ? `격자 ${g.nx}·${g.ny} 로 넣었습니다. 다만 자외선 관측소는 ${uv.이름}(${uv.stn})이 가장 가깝고 약 ${Math.round(uv.거리)}km 떨어져 있습니다 — 자외선 값은 이 시설과 다를 수 있습니다.`
        : `격자 ${g.nx}·${g.ny}, 자외선 관측소는 ${uv.이름}(${uv.stn}, 약 ${Math.round(uv.거리)}km)로 넣었습니다.`,
    })
  }

  // 브라우저가 아는 위치를 가져온다. 현장 PC 는 유선이라 정확도가 떨어질 수 있어
  // **넣어만 주고 계산은 사람이 누르게** 한다 — 틀린 좌표가 조용히 저장되면 안 된다.
  const 지금위치 = () => {
    if (!navigator.geolocation) {
      set좌표안내({ 나쁨: true, 글: '이 브라우저는 위치를 알려주지 않습니다. 지도에서 찾아 넣어 주세요.' }); return
    }
    set좌표안내({ 나쁨: false, 글: '위치를 묻는 중입니다…' })
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set위도(p.coords.latitude.toFixed(4)); set경도(p.coords.longitude.toFixed(4))
        set좌표안내({ 나쁨: false, 글: `위치를 넣었습니다(오차 약 ${Math.round(p.coords.accuracy)}m). 맞는지 보고 “격자 계산”을 누르세요.` })
      },
      (e) => set좌표안내({ 나쁨: true, 글: `위치를 못 받았습니다(${e.message}). 지도에서 찾아 넣어 주세요.` }),
      { timeout: 10000 },
    )
  }

  // 넣은 격자가 어디인지 되짚어 본다. 확인할 길이 없으면 아무 숫자나 넣고 저장하게 된다.
  const 격자설명 = (() => {
    if (!String(nx).trim() || !String(ny).trim()) return null
    const 밖 = 격자범위밖(nx, ny)
    if (밖) return { 나쁨: true, 글: `이 격자는 ${밖}.` }
    const p = 위경도로(nx, ny)
    return { 나쁨: false, 글: `이 격자의 중심은 위도 ${p.위도.toFixed(3)}, 경도 ${p.경도.toFixed(3)} 입니다.` }
  })()

  const handleSave = async () => {
    setSaving(true)
    try {
      // ── **좌표를 넣었으면 격자를 다시 계산해 함께 보낸다** (독립 검수 2026-09-18) ──────
      // 앞 판은 좌표만 새 값으로 보내고 격자는 화면 상태를 그대로 보냈다. 그래서 「격자 계산」을
      // 모르고 저장하면 **좌표는 부산, 격자는 옛 시설 자리**가 되어 — 기상청이 살아 있는 평소에는 옛 자리
      // 날씨가, 막힌 날에는 부산 체감온도가 같은 문안에 섞였다. 어느 쪽도 오류를 안 낸다.
      // 마법사와 같은 순서(좌표 → 격자 계산 → 함께 저장)로 맞춘다.
      const 위 = String(위도).trim(), 경 = String(경도).trim()
      let 좌표몫 = {}
      // 좌표가 기준이라 직접 넣은 격자·관측소는 계산값으로 바뀐다(위 결정 유지). 다르면 **그렇다고 말한다** —
      // 말없이 「저장 완료」만 띄우면 넣은 값이 저장된 줄 안다(2026-09-26 Codex 검수 Medium).
      let 바꿔씀 = false
      if (위 && 경) {
        const la = Number(위), lo = Number(경)
        if (!Number.isFinite(la) || !Number.isFinite(lo)) { showToast('위도·경도를 숫자로 넣어 주세요'); setSaving(false); return }
        const g = 격자로(la, lo)
        const 밖 = 격자범위밖(g.nx, g.ny)
        if (밖) { showToast(`이 좌표로는 격자가 ${밖} — 위도·경도가 뒤바뀌지 않았는지 보세요`); setSaving(false); return }
        const uv = 가까운자외선관측소(la, lo)
        좌표몫 = { lat: String(la), lon: String(lo), nx: String(g.nx), ny: String(g.ny), uvStn: uv.stn }
        바꿔씀 = String(nx).trim() !== 좌표몫.nx || String(ny).trim() !== 좌표몫.ny || String(uvStn).trim() !== String(uv.stn)
        setNx(String(g.nx)); setNy(String(g.ny)); setUvStn(uv.stn)
      }
      await saveKmaSettings({
        ...(apiKey.trim()       && { apiKey:       apiKey.trim() }),
        ...(apihubKey.trim()    && { apihubKey:    apihubKey.trim() }),
        ...(alertApiKey.trim()  && { alertApiKey:  alertApiKey.trim() }),
        ...(livingApiKey.trim() && { livingApiKey: livingApiKey.trim() }),
        nx, ny, uvStn, areaNo, uvAreaNo,
        ...좌표몫,
      })
      setApiKey(''); setApihubKey(''); setAlertApiKey(''); setLivingApiKey('')
      showToast(바꿔씀 ? `저장했습니다 — 격자·자외선 관측소는 위경도에서 다시 계산한 값(${좌표몫.nx}, ${좌표몫.ny} · ${좌표몫.uvStn})으로 저장했습니다` : '저장 완료'); refresh()
    } catch (e) { showToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const [alertTesting, setAlertTesting] = useState(false)
  const [alertResult,  setAlertResult]  = useState(null)
  const [uvTesting,    setUvTesting]    = useState(false)
  const [uvResult,     setUvResult]     = useState(null)
  const [uvDebug,      setUvDebug]      = useState(null)
  const [uvDebugging,  setUvDebugging]  = useState(false)

  const handleUVTest = async () => {
    setUvTesting(true); setUvResult(null); setUvDebug(null)
    try { const d = await getUVIndex(); setUvResult(d) }
    catch (e) { setUvResult({ error: e.message }) }
    finally { setUvTesting(false) }
  }

  const handleUVDebug = async () => {
    setUvDebugging(true); setUvDebug(null); setUvResult(null)
    try { const d = await getUVDebug(); setUvDebug(d) }
    catch (e) { setUvDebug({ error: e.message }) }
    finally { setUvDebugging(false) }
  }

  const handleTest = async () => {
    setTesting(true); setPreview(null); setPreviewInfo(null)
    try {
      const d = await getWeather()
      setPreview(d)
      // 추가 정보(자외선/체감온도/최저최고) 로딩
      getMorningText().then(m => { if (m?.info) setPreviewInfo(m.info) }).catch(() => {})
    }
    catch (e) { set연동오류(e) }
    finally { setTesting(false) }
  }

  const handleAlertTest = async () => {
    setAlertTesting(true); setAlertResult(null)
    try { const d = await getWeatherAlert(); setAlertResult(d) }
    catch (e) { setAlertResult({ error: e.message }) }
    finally { setAlertTesting(false) }
  }

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-tts-bg border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Cloud size={18} className="text-ds-v3-ink-2" />
          </div>
          <div>
            <h3 className="t-label font-semibold text-ds-v3-ink">기상청 API</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">apihub.kma.go.kr · 공공데이터포털</p>
          </div>
        </div>
      </div>

      {/* ── apihub 통합 인증키 ── */}
      <div className="bg-ds-v3-tts-bg border border-ds-v3-line rounded-btn px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ds-v3-tts">apihub.kma.go.kr 통합 인증키</p>
            <p className="text-[11px] text-ds-v3-tts mt-0.5">특보현황·자외선관측·동네예보 — 키 1개로 전체 사용</p>
          </div>
          <Badge variant={apihubIsSet ? 'success' : 'default'}>{apihubIsSet ? '설정됨' : '미설정'}</Badge>
        </div>
        <ApiKeyField value={apihubKey} masked={apihubMasked} isSet={apihubIsSet}
          onChange={setApihubKey} onClear={() => setApihubKey(' ')}
          placeholder="apihub.kma.go.kr authKey" />
      </div>

      {/* ── 이 시설의 위치 (UX-08, 2026-09-11) ──────────────────────────
          예전엔 격자 X·Y 를 사람이 직접 넣었고, 칸에는 처음 운영한 시설의 값이 미리 차 있었다.
          숫자 둘이 무슨 뜻인지 아는 사람은 거의 없고, 차 있으니 아무도 안 고쳤다.
          이제 **위도·경도를 넣으면 격자를 계산해 준다.** 격자 칸은 그대로 두되
          (직접 넣던 사람이 못 쓰게 되면 안 된다) 확인할 길을 옆에 붙였다. */}
      <div className="rounded-[10px] border border-ds-v3-line bg-ds-v3-bg p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <MapPin size={13} className="text-ds-v3-ink-2" />
          <span className="text-xs font-semibold text-ds-v3-ink">이 시설의 위치</span>
        </div>
        <p className="text-[11px] text-ds-v3-ink-2 leading-relaxed">
          지도에서 시설 위치의 위도·경도를 찾아 넣고 “격자 계산”을 누르세요.
          아래 격자 X·Y 가 자동으로 채워집니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" step="0.0001" value={위도} onChange={e => set위도(e.target.value)}
            placeholder="위도 (예: 37.5665)" className="input-base nums" />
          <input type="number" step="0.0001" value={경도} onChange={e => set경도(e.target.value)}
            placeholder="경도 (예: 126.9780)" className="input-base nums" />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={계산하기}
            className="flex-1 py-2 rounded-btn bg-ds-v3-ink text-white text-xs font-semibold
                       btn-press min-h-[44px]">
            격자 계산
          </button>
          <button type="button" onClick={지금위치}
            className="px-3 py-2 rounded-btn border border-ds-v3-line text-xs text-ds-v3-ink-2
                       btn-press min-h-[44px] min-w-[44px]">
            지금 위치 쓰기
          </button>
        </div>
        {좌표안내 && (
          <p className={`text-[11px] leading-relaxed ${좌표안내.나쁨 ? 'text-ds-v3-warn' : 'text-ds-v3-ink'}`}>
            {좌표안내.글}
          </p>
        )}
      </div>

      {/* 격자 좌표 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">격자 X (nx)</label>
          <input type="number" value={nx} onChange={e => setNx(e.target.value)}
            placeholder="위에서 계산" className="input-base nums" />
        </div>
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">격자 Y (ny)</label>
          <input type="number" value={ny} onChange={e => setNy(e.target.value)}
            placeholder="위에서 계산" className="input-base nums" />
        </div>
      </div>
      {/* 넣은 숫자가 어디인지 **되짚어 볼 길**을 준다. 확인할 방법이 없으면
          사람은 결국 아무 숫자나 넣고 저장한다. */}
      {격자설명 && (
        <p className={`text-[11px] leading-relaxed -mt-1 ${격자설명.나쁨 ? 'text-ds-v3-warn' : 'text-ds-v3-ink-2'}`}>
          {격자설명.글}
        </p>
      )}

      {/* 자외선 관측 지점 */}
      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">
          자외선관측 지점번호 (stn)
          <span className="ml-2 text-ds-v3-ink-2 font-normal">위 “격자 계산”이 가까운 곳으로 채웁니다</span>
        </label>
        <input type="text" value={uvStn} onChange={e => setUvStn(e.target.value)}
          placeholder="위에서 계산"
          className="input-base nums" />
        <p className="text-[11px] text-ds-v3-ink-2 mt-1">apihub 자외선관측(kma_sfctm_uv.php) 사용 시 적용. 관측소: 수원(119), 서울(108), 강릉(105), 부산(159)</p>
      </div>

      {/* 구 공공데이터포털 키 (선택) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-ds-v3-ink-2 hover:text-ds-v3-ink py-1">공공데이터포털 키 (기존/보조)</summary>
        <div className="space-y-3 mt-2">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ds-v3-ink-2">단기예보 인증키 (Encoding)</label>
              <Badge variant={isSet ? 'success' : 'default'}>{isSet ? '설정됨' : '미설정'}</Badge>
            </div>
            <ApiKeyField value={apiKey} masked={masked} isSet={isSet}
              onChange={setApiKey} onClear={() => setApiKey(' ')}
              placeholder="단기예보조회서비스 인증키 (인코딩)" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ds-v3-ink-2">기상특보 인증키 (Encoding)</label>
              <Badge variant={alertIsSet ? 'success' : 'default'}>{alertIsSet ? '설정됨' : '미설정'}</Badge>
            </div>
            <ApiKeyField value={alertApiKey} masked={alertMasked} isSet={alertIsSet}
              onChange={setAlertApiKey} onClear={() => setAlertApiKey(' ')}
              placeholder="기상특보조회서비스 인증키 (인코딩)" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ds-v3-ink-2">생활기상지수 인증키 (Decoding)</label>
              <Badge variant={livingIsSet ? 'success' : 'default'}>{livingIsSet ? '설정됨' : '미설정'}</Badge>
            </div>
            <ApiKeyField value={livingApiKey} masked={livingMasked} isSet={livingIsSet}
              onChange={setLivingApiKey} onClear={() => setLivingApiKey(' ')}
              placeholder="생활기상지수조회서비스 인증키 (디코딩 키)" />
            <p className="text-[11px] text-ds-v3-ink-2 mt-1">체감온도(getSenTaIdxV2) 사용 시 필요</p>
          </div>
          <div>
            <label className="block text-xs text-ds-v3-ink-2 mb-1.5">
              생활기상지수 지점코드 (areaNo)
              <span className="ml-2 text-ds-v3-ink-2 font-normal">서울특별시: 1100000000</span>
            </label>
            <input type="text" value={uvAreaNo} onChange={e => setUvAreaNo(e.target.value)}
              placeholder="예: 1100000000 (서울특별시)"
              className="input-base nums" />
          </div>
        </div>
      </details>

      {/* 날씨 미리보기 결과 */}
      {preview && (
        <div className="bg-ds-v3-tts-bg border border-ds-v3-line rounded-btn px-3 py-2 text-xs text-ds-v3-tts space-y-1">
          <div className="flex items-center justify-between">
            <span>날씨: <span className="font-semibold">{preview.precipitationType !== '없음' ? preview.precipitationType : preview.sky}</span>{preview.temperature != null && <span> {preview.temperature}°C</span>}</span>
            {preview.dataSources?.weather && <SrcBadge src={preview.dataSources.weather} />}
          </div>
          {previewInfo?.uvGrade && (
            <div className="flex items-center justify-between">
              <span>자외선: <span className="font-normal text-ds-v3-ink-2">지수 {previewInfo.uvIndex ?? '-'} ({previewInfo.uvGrade})</span></span>
              {preview.dataSources?.uv && preview.dataSources.uv !== 'none' && <SrcBadge src={preview.dataSources.uv} />}
            </div>
          )}
          {previewInfo?.apparentTemp != null && (
            <div className="flex items-center justify-between">
              <span>체감온도: <span className="font-normal text-ds-v3-ink-2">{previewInfo.apparentTemp}°C</span></span>
              {preview.dataSources?.apparent && <SrcBadge src={preview.dataSources.apparent} />}
            </div>
          )}
          {previewInfo?.tempRange && (
            <div className="flex items-center justify-between">
              <span>기온 범위: <span className="font-normal">{previewInfo.tempRange}</span></span>
              {preview.dataSources?.minmax && <SrcBadge src={preview.dataSources.minmax} />}
            </div>
          )}
        </div>
      )}

      {/* 자외선지수 조회 결과 */}
      {uvResult && (
        uvResult.error
          ? <ConnectionErrorNote 오류={uvResult.error} />
          : <div className="bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn px-3 py-2 text-xs text-ds-v3-ink-2">
              <div className="flex items-center justify-between">
                <span>자외선지수: <span className="font-semibold">{uvResult.today ?? '-'}</span>
                  {uvResult.todayLevel && <span> ({uvResult.todayLevel})</span>}
                </span>
                {uvResult.source && <SrcBadge src={uvResult.source} />}
              </div>
            </div>
      )}

      {/* 자외선 API 진단 결과 */}
      {uvDebug && (
        <div className="bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 text-xs text-ds-v3-ink space-y-1 font-mono">
          <div>키: <span className="text-ds-v3-ink">{uvDebug.keyMasked}</span>
            <span className="ml-2 text-ds-v3-ink-2">({uvDebug.keyIsEncoded ? '인코딩 키' : '디코딩 키'})</span>
          </div>
          {uvDebug.keySource && <div>키 출처: <span className={uvDebug.keySource.includes('fallback') ? 'text-ds-v3-ink-2 font-semibold' : 'text-ds-v3-ink-3'}>{uvDebug.keySource}</span></div>}
          <div>areaNo: <span className="text-ds-v3-ink">{uvDebug.areaNo}</span></div>
          <div>time: <span className="text-ds-v3-ink">{uvDebug.time}</span></div>
          {uvDebug.httpStatus && <div>HTTP: <span className={uvDebug.httpStatus === 200 ? 'text-ds-v3-ink-3' : 'text-ds-v3-warn'}>{uvDebug.httpStatus}</span></div>}
          {uvDebug.resultCode && (
            <div>resultCode: <span className={uvDebug.resultCode === '00' ? 'text-ds-v3-ink-3 font-semibold' : 'text-ds-v3-warn font-semibold'}>{uvDebug.resultCode}</span>
              {uvDebug.resultMsg && <span className="ml-1 text-ds-v3-ink-2">({uvDebug.resultMsg})</span>}
            </div>
          )}
          {uvDebug.url && (
            <details className="mt-1">
              <summary className="cursor-pointer text-ds-v3-ink-2">호출 URL 보기</summary>
              <pre className="mt-1 text-[10px] whitespace-pre-wrap break-all text-ds-v3-tts">{uvDebug.url}</pre>
            </details>
          )}
          {uvDebug.error && <div className="text-ds-v3-warn">{uvDebug.error}</div>}
          {uvDebug.rawBody && (
            <details className="mt-1">
              <summary className="cursor-pointer text-ds-v3-ink-2">원본 응답 보기</summary>
              <pre className="mt-1 text-[10px] whitespace-pre-wrap break-all text-ds-v3-ink-3">{uvDebug.rawBody}</pre>
            </details>
          )}
        </div>
      )}

      {/* 기상특보 조회 결과 */}
      {alertResult && !alertResult.error && (
        <div className="bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn px-3 py-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ds-v3-ink-2">특보 조회 결과</span>
            {alertResult.source && <SrcBadge src={alertResult.source} />}
          </div>
          {(alertResult.alerts ?? []).length === 0
            ? <p className="text-xs text-ds-v3-ink-2">현재 발효 중인 기상특보 없음</p>
            : (alertResult.alerts ?? []).map((a, i) => (
                <p key={i} className="text-xs text-ds-v3-ink-2 font-normal">⚠️ {a}</p>
              ))}
        </div>
      )}
      {alertResult?.error && (
        <ConnectionErrorNote 오류={alertResult.error} />
      )}

      {toast && <p className="text-xs text-ds-v3-ink-3">{toast}</p>}
      <ConnectionErrorNote 오류={연동오류} />

      <div className="flex flex-wrap gap-2">
        <button onClick={handleTest} disabled={testing || (!isSet && !apihubIsSet)}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />
          {testing ? '조회 중...' : '날씨 미리보기'}
        </button>
        <button onClick={handleAlertTest} disabled={alertTesting || (!alertIsSet && !apihubIsSet)}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:bg-ds-v3-surface-2 disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={alertTesting ? 'animate-spin' : ''} />
          {alertTesting ? '조회 중...' : '특보 조회'}
        </button>
        <button onClick={handleUVTest} disabled={uvTesting || (!livingIsSet && !apihubIsSet)}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:bg-ds-v3-surface-2 disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={uvTesting ? 'animate-spin' : ''} />
          {uvTesting ? '조회 중...' : '자외선 테스트'}
        </button>
        <button onClick={handleUVDebug} disabled={uvDebugging || (!livingIsSet && !apihubIsSet)}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-3 hover:bg-ds-v3-bg disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={uvDebugging ? 'animate-spin' : ''} />
          {uvDebugging ? '진단 중...' : 'API 진단'}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center px-3 py-2 bg-ds-v3-ink hover:bg-ds-v3-ink disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

// ── 에어코리아 API 카드 ──────────────────────────────────────
function AirKoreaApiCard() {
  const [apiKey,   setApiKey]   = useState('')
  const [station,  setStation]  = useState('')
  const [isSet,    setIsSet]    = useState(false)
  const [masked,   setMasked]   = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [preview,  setPreview]  = useState(null)
  const [toast,    setToast]    = useState('')
  const [연동오류,     set연동오류]     = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const refresh = () => getAirKoreaSettings().then(d => {
    setIsSet(d.apiKeySet); setMasked(d.apiKeyMasked); setStation(d.station)
  }).catch(() => {})

  useEffect(() => { refresh() }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveAirKoreaSettings({ ...(apiKey.trim() && { apiKey: apiKey.trim() }), station })
      setApiKey(''); showToast('저장 완료'); refresh()
    } catch (e) { showToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setPreview(null)
    try { const d = await getAirQuality(); setPreview(d) }
    catch (e) { set연동오류(e) }
    finally { setTesting(false) }
  }

  const gradeColor = { 좋음: 'text-ds-v3-ink-3 bg-ds-v3-surface-2 border-ds-v3-line', 보통: 'text-ds-v3-ink-2 bg-ds-v3-surface-2 border-ds-v3-line', 나쁨: 'text-ds-v3-ink-2 bg-ds-v3-surface-2 border-ds-v3-line', '매우나쁨': 'text-ds-v3-warn bg-ds-v3-warn-bg border-ds-v3-line' }

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-surface-2 border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Wind size={18} className="text-ds-v3-ink-3" />
          </div>
          <div><h3 className="t-label font-semibold text-ds-v3-ink">에어코리아</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">실시간 미세먼지 측정 (공공데이터포털)</p></div>
        </div>
        <Badge variant={isSet ? 'success' : 'default'}>{isSet ? '설정됨' : '미설정'}</Badge>
      </div>

      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">인증키 (Encoding)</label>
        <ApiKeyField value={apiKey} masked={masked} isSet={isSet} onChange={setApiKey} onClear={() => setApiKey(' ')} placeholder="공공데이터포털 발급 인증키(Encoding)" />
      </div>

      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">측정소명 <span className="text-ds-v3-ink-2">(비우면 예시값: 중구)</span></label>
        <input type="text" value={station} onChange={e => setStation(e.target.value)}
          placeholder="예: 중구, 종로구" className="input-base" />
      </div>

      {preview && (
        <div className={`border rounded-btn px-3 py-2 text-xs font-normal ${gradeColor[preview.pm10Grade] ?? 'text-ds-v3-ink-2 bg-ds-v3-bg border-ds-v3-line'}`}>
          PM10 {preview.pm10}㎍/m³ · {preview.pm10Grade} &nbsp;|&nbsp; PM2.5 {preview.pm25}㎍/m³ · {preview.pm25Grade}
        </div>
      )}

      {toast && <p className="text-xs text-ds-v3-ink-3">{toast}</p>}
      <ConnectionErrorNote 오류={연동오류} />

      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || !isSet}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />{testing ? '조회 중...' : '미세먼지 미리보기'}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center px-3 py-2 bg-ds-v3-ink-3 hover:bg-ds-v3-ink-3 disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

export { SrcBadge, KmaApiCard, AirKoreaApiCard }
