import { useState, useEffect, useRef } from 'react'
import { Star, Radio, Bell, Sunrise, Calendar, Cloud, Wind, Clock,
         Pause, Play, Music2, AlertTriangle, Square,
         Sun, Thermometer, Droplets } from 'lucide-react'
import { apiGet, apiPost, ttsBroadcast, getMorningText, morningPreview, triggerMorning,
         getMorningSettings, saveMorningSettings,
         stopBroadcast as stopBroadcastAPI } from '../../lib/api'
import HelpTip from '../shared/HelpTip'
import { audioBus } from '../../lib/audioBus'
import { bgmFolderName } from '../../lib/bgmTypes'
import { useBgmFolders } from '../../lib/bgmFolders'

// UV 등급별 스타일
const UV_CONFIG = {
  '위험':    { bg: 'bg-ds-v3-flow-bg', border: 'border-ds-v3-flow-line', text: 'text-ds-v3-flow' },
  '매우높음': { bg: 'bg-ds-v3-warn-bg',    border: 'border-ds-v3-warn',    text: 'text-ds-v3-warn'    },
  '높음':    { bg: 'bg-ds-v3-surface-2', border: 'border-ds-v3-line-2', text: 'text-ds-v3-ink-2' },
  '보통':    { bg: 'bg-ds-v3-surface-2',  border: 'border-ds-v3-line', text: 'text-ds-v3-ink-2' },
  '낮음':    { bg: 'bg-ds-v3-surface-2',   border: 'border-ds-v3-line',  text: 'text-ds-v3-ink-2'  },
}

// 체감온도 등급별 스타일
function tempConfig(t) {
  if (t == null) return { bg: 'bg-ds-v3-bg', border: 'border-ds-v3-line', text: 'text-ds-v3-ink' }
  if (t >= 33) return { bg: 'bg-ds-v3-warn-bg',    border: 'border-ds-v3-warn',    text: 'text-ds-v3-warn' }
  if (t >= 28) return { bg: 'bg-ds-v3-surface-2', border: 'border-ds-v3-line-2', text: 'text-ds-v3-ink-2' }
  if (t <= 0)  return { bg: 'bg-ds-v3-tts-bg',   border: 'border-ds-v3-tts-line',   text: 'text-ds-v3-tts' }
  if (t <= 5)  return { bg: 'bg-ds-v3-tts-bg',    border: 'border-ds-v3-tts-line',   text: 'text-ds-v3-tts' }
  return { bg: 'bg-ds-v3-bg', border: 'border-ds-v3-line', text: 'text-ds-v3-ink' }
}

const fallbackFavs = [
  { id: 1, label: '식사 안내',     content: '어르신 여러분, 식사 시간이 되었습니다. 식당으로 이동해 주시기 바랍니다.',   voice: 'ko-KR-SunHiNeural' },
  { id: 2, label: '약 복용',       content: '약 복용 시간입니다. 담당 간호사에게 약을 받아 복용해 주시기 바랍니다.',     voice: 'ko-KR-SunHiNeural' },
  { id: 3, label: '프로그램 시작', content: '오늘의 프로그램이 시작됩니다. 1층 강당으로 모여 주시기 바랍니다.',          voice: 'ko-KR-SunHiNeural' },
  { id: 4, label: '보호자 안내',   content: '보호자분께서 방문하셨습니다. 1층 접수처로 나와 주시기 바랍니다.',           voice: 'ko-KR-SunHiNeural' },
]

const chimes = [
  { id: 'general', label: '일반 차임', cls: 'bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 text-white border-transparent' },
  { id: 'end',     label: '종료음',    cls: 'bg-white border border-ds-v3-ink-2/40 text-ds-v3-ink-2 hover:bg-ds-v3-surface-2' },
]

// 즐겨찾기 섹션 — 1줄 가로 배열
/**
 * 즐겨찾기 버튼 — 한 번 눌러 바로 내보내는 문구 넷.
 *
 * @param {boolean} [bare] **껍데기를 벗고 들어간다.** 통합 홈의 「소리 조절」 서랍은
 *   `HomePanel` 이 이미 카드와 제목줄을 주므로, 여기서 또 카드를 그리면 카드 안에 카드가 된다
 *   (`VolumePanel` 과 같은 규칙).
 *
 * 통합 홈에 이 기능이 **빠져 있었다**(사용자 지적 2026-09-13: *"즐겨찾기 설정 추가했는데
 * 간편에는 없잖아"*). 설정에서 버튼을 만들어 놓고 정작 누를 자리가 없었다 —
 * 만드는 곳과 쓰는 곳이 갈려 있으면 만든 것이 안 쓰인다.
 * 자리는 사용자가 정했다: **서랍의 「즉시 방송」 바로 밑.** 둘 다 "지금 바로 내보낸다"라
 * 같은 묶음이고, 마이크가 말로 하는 것이면 이쪽은 미리 적어 둔 말로 하는 것이다.
 */
export function FavsCard({ bare = false }) {
  const [favorites,    setFavorites]    = useState(fallbackFavs)
  const [broadcasting, setBroadcasting] = useState(null)

  const reload = () => {
    apiGet('/api/favorites')
      .then(data => { if (data.length > 0) setFavorites(data); else setFavorites([]) })
      .catch(() => {})
  }

  useEffect(() => {
    reload()
    window.addEventListener('carecast:favorites-updated', reload)
    return () => window.removeEventListener('carecast:favorites-updated', reload)
  }, [])

  const handleBroadcast = async (fav) => {
    setBroadcasting(fav.id)
    try {
      await ttsBroadcast({ text: fav.content, voice: fav.voice || 'ko-KR-SunHiNeural', target: '전체' })
    } catch (e) { console.error('[즐겨찾기] 방송 실패:', e.message) }  // 버튼 잠금은 finally가 풀어준다 — 소리가 안 난 것으로 사람이 알아챈다
    finally { setBroadcasting(null) }
  }

  // 버튼이 하나도 없으면 **그 사실을 말한다.** 빈 줄만 남기면 고장으로 읽힌다.
  if (bare && favorites.length === 0) {
    return <p className="t-sub text-ds-v3-ink-2">아직 없습니다. 설정 › 즐겨찾기 버튼에서 만들 수 있습니다.</p>
  }

  const 목록 = (
    <div className={bare ? 'grid grid-cols-2 gap-2' : 'flex gap-1.5'}>
        {favorites.slice(0, 4).map(fav => (
          <button
            key={fav.id}
            onClick={() => handleBroadcast(fav)}
            disabled={broadcasting !== null}
            className={`flex-1 flex flex-col items-center justify-center gap-1 px-1 py-2.5 bg-white
                       border rounded-btn text-center btn-press transition-colors group disabled:opacity-60
                       ${broadcasting === fav.id
                         ? 'border-ds-v3-warn/40 bg-ds-v3-warn-bg'
                         : 'border-ds-v3-warn/15 hover:border-ds-v3-warn/40 hover:bg-ds-v3-warn-bg'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
          >
            <Radio size={13} className={`flex-shrink-0 transition-colors ${
              broadcasting === fav.id ? 'text-ds-v3-warn animate-pulse' : 'text-ds-v3-warn/50 group-hover:text-ds-v3-warn'
            }`} />
            <span className="text-xs font-semibold text-ds-v3-ink leading-tight text-center">{fav.label}</span>
          </button>
        ))}
      </div>
  )

  if (bare) return 목록

  return (
    <div className="easy-card bg-white" style={{ minHeight: 'auto' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <Star size={15} className="text-ds-v3-warn" />
        <span className="text-sm font-semibold text-ds-v3-ink">즐겨찾기</span>
        <HelpTip id="favorites" />
      </div>
      {목록}
    </div>
  )
}

// 차임벨 섹션
export function ChimeCard() {
  const [playing, setPlaying] = useState(null)

  const handleChime = async (id) => {
    if (playing) return
    setPlaying(id)
    try {
      await apiPost(`/api/mic/chime?type=${id}`, {})
    } catch (e) { console.error('[즐겨찾기] 차임벨 실패:', e.message) }  // 아래 타이머가 버튼 잠금을 풀어준다
    setTimeout(() => setPlaying(null), id === 'end' ? 4000 : 2500)
  }

  return (
    <div className="easy-card bg-ds-v3-surface-2" style={{ minHeight: 'auto' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <Bell size={15} className="text-ds-v3-ink-2" />
        <span className="text-sm font-semibold text-ds-v3-ink">차임벨</span>
        <HelpTip id="chime" />
      </div>
      <div className="flex flex-col gap-2">
        {chimes.map(c => (
          <button
            key={c.id}
            onClick={() => handleChime(c.id)}
            disabled={playing !== null}
            className={`flex items-center justify-center gap-2 w-full rounded-btn py-3.5
                        text-sm font-semibold border btn-press transition-colors disabled:opacity-60
                        ${c.cls} ${playing === c.id ? 'animate-pulse' : ''} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
          >
            <Bell size={14} className={playing === c.id ? 'animate-bounce' : ''} />
            {playing === c.id ? '재생 중...' : c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// 아침 방송 카드 (오늘 방송 일정 + 날씨 + UV + 특보)
export function MorningCard() {
  useBgmFolders()   // 방송용 폴더의 지금 이름(업로드 화면에서 바뀐다)
  const [info,         setInfo]         = useState(null)
  const [previewText,  setPreviewText]  = useState('')
  const [playing,      setPlaying]      = useState(false)
  const [paused,       setPaused]       = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [isLive,       setIsLive]       = useState(false)
  const [bgmEnabled,   setBgmEnabled]   = useState(false)
  const [bgmDelay,     setBgmDelay]     = useState('5')
  const [bgmEndDelay,  setBgmEndDelay]  = useState('0')
  const [showBgm,      setShowBgm]      = useState(false)
  const [showText,     setShowText]     = useState(false)
  const audioRef = useRef(null)
  const previewBusRef = useRef(null)   // [audioBus] 아침방송 미리듣기 장부 등록 손잡이

  useEffect(() => {
    getMorningText().then(data => {
      setInfo(data.info)
      if (data.text) setPreviewText(data.text)
    }).catch(() => {})
    getMorningSettings().then(d => {
      if (d.bgmEnabled  !== undefined) setBgmEnabled(d.bgmEnabled)
      if (d.bgmDelay     != null) setBgmDelay(String(d.bgmDelay ?? 5))
      if (d.bgmEndDelay  != null) setBgmEndDelay(String(d.bgmEndDelay ?? 0))
    }).catch(() => {})

    const onStart = () => setIsLive(true)
    const onEnd   = () => setIsLive(false)
    window.addEventListener('carecast:broadcast-started', onStart)
    window.addEventListener('carecast:broadcast-ended',   onEnd)

    return () => {
      if (audioRef.current) audioRef.current.pause()
      // [audioBus] 화면 이탈 정리 — 장부 해제
      previewBusRef.current?.done(); previewBusRef.current = null
      window.removeEventListener('carecast:broadcast-started', onStart)
      window.removeEventListener('carecast:broadcast-ended',   onEnd)
    }
  }, [])

  // **화면만 바뀌고 서버는 모르는 상태**를 막는다. 저장이 실패해도 아무 말이 없으면,
  // 선생님은 껐다고 믿는데 다음날 아침 방송은 옛 설정으로 나간다 — 이 저장소가 가장
  // 경계하는 종류다(CLAUDE.md: "직원이 껐다고 믿는데 방송이 나가는 운영 위험").
  const [bgmSaveError, setBgmSaveError] = useState('')

  const saveBgm = (patch) => {
    const next = {
      bgmEnabled,
      bgmDelay: parseInt(bgmDelay) || 0,
      bgmEndDelay: parseInt(bgmEndDelay) || 0,
      ...patch,
    }
    setBgmSaveError('')
    saveMorningSettings(next)
      .catch(err => setBgmSaveError(err?.message || '저장하지 못했습니다 — 다시 눌러 주세요.'))
  }


  const handlePreview = async () => {
    if (paused && audioRef.current) {
      audioRef.current.play()
      // [audioBus] 일시정지에서 다시 시작 — 다시 등록
      previewBusRef.current?.done()
      previewBusRef.current = audioBus.register({ kind: 'preview-tts', label: '아침방송 미리듣기' })
      setPlaying(true); setPaused(false)
      return
    }
    if (playing && audioRef.current) {
      audioRef.current.pause()
      // [audioBus] 일시정지 — 소리가 멎었으니 장부에서 내린다
      previewBusRef.current?.done(); previewBusRef.current = null
      setPlaying(false); setPaused(true)
      return
    }
    setPlaying(true); setPaused(false)
    try {
      const blob  = await morningPreview()
      const url   = URL.createObjectURL(blob)
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      // [audioBus] 아침방송 미리듣기 등록 — 자연 종료는 addEventListener로 해제(onended 유지)
      previewBusRef.current?.done()
      previewBusRef.current = audioBus.register({ kind: 'preview-tts', label: '아침방송 미리듣기' })
      audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
      audio.play()
      audio.onended = () => { setPlaying(false); setPaused(false); URL.revokeObjectURL(url); audioRef.current = null }
    } catch { setPlaying(false) }
  }

  const handleBroadcast = async () => {
    if (broadcasting || isLive) return
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    // [audioBus] 실제 방송을 시작하며 미리듣기를 끈다 — 장부 해제
    previewBusRef.current?.done(); previewBusRef.current = null
    setPlaying(false); setPaused(false)
    setBroadcasting(true)
    try { await triggerMorning() } catch (e) { console.error('[즐겨찾기] 아침방송 실행 실패:', e.message) }  // 버튼 잠금은 finally가 풀어준다
    finally { setBroadcasting(false) }
  }

  const handleStop = async () => {
    setIsLive(false)
    window.dispatchEvent(new CustomEvent('carecast:stop-broadcast'))
    try { await stopBroadcastAPI() } catch (e) { console.error('[즐겨찾기] 정지 요청 실패:', e.message) }  // 화면 쪽 정지(carecast:stop-broadcast)는 이미 보냈다
  }

  // 날씨/일정 4칸 그리드 아이템
  const infoItems = [
    { icon: Calendar, label: '날짜', value: info?.date     ?? '-', sub: null },
    { icon: Cloud,    label: '날씨', value: info?.weather  ?? '-', sub: info?.tempRange ?? null },
    { icon: Wind,     label: '먼지', value: info?.dust     ?? '-', sub: null },
    { icon: Clock,    label: '일정', value: info?.schedule ?? '-', sub: null },
  ]

  // UV 스타일
  const uvCfg = UV_CONFIG[info?.uvGrade] ?? null
  const tCfg  = tempConfig(info?.apparentTemp)
  const hasAlert = info?.alerts?.length > 0

  const previewLabel = playing ? '일시정지' : paused ? '계속 듣기' : '미리 듣기'
  const PreviewIcon  = playing ? Pause : Play

  return (
    <div className="easy-card bg-white" style={{ minHeight: 'auto' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <Sunrise size={15} className="text-ds-v3-ink-2" />
        <span className="text-sm font-semibold text-ds-v3-ink-2 uppercase tracking-widest">오늘 방송 일정</span>
        <HelpTip id="morningCard" />
      </div>

      {/* 날씨/일정 정보 2×2 그리드 */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {infoItems.map(c => {
          const Icon = c.icon
          return (
            <div key={c.label} className="flex items-center gap-1.5 bg-ds-v3-bg rounded-btn px-2 py-2 border border-ds-v3-ink-2/15">
              <Icon size={12} className="text-ds-v3-ink-2 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-ds-v3-ink-2">{c.label}</div>
                <div className="text-xs text-ds-v3-ink font-semibold truncate">{c.value}</div>
                {c.sub && <div className="text-xs text-ds-v3-ink-2">{c.sub}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* 자외선지수 + 체감온도 + 습도 + 특보 — 4칸 그리드 (색상 코딩) */}
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {/* 자외선지수 */}
        <div className={`flex flex-col gap-0.5 rounded-btn border p-2 ${
          uvCfg ? `${uvCfg.bg} ${uvCfg.border}` : 'bg-ds-v3-bg border-ds-v3-line'
        }`}>
          <div className="flex items-center gap-1">
            <Sun size={10} className={uvCfg ? uvCfg.text : 'text-ds-v3-ink-2'} />
            <span className="text-xs text-ds-v3-ink-2">자외선지수</span>
          </div>
          {info?.uvIndex != null ? (
            <>
              <span className={`text-base font-semibold nums leading-none ${uvCfg ? uvCfg.text : 'text-ds-v3-ink'}`}>
                {info.uvIndex}
              </span>
              <span className={`text-xs font-semibold ${uvCfg ? uvCfg.text : 'text-ds-v3-ink-2'}`}>
                {info.uvGrade}
              </span>
            </>
          ) : (
            <span className="text-xs text-ds-v3-ink-2 mt-0.5">정보없음</span>
          )}
        </div>

        {/* 체감온도 */}
        <div className={`flex flex-col gap-0.5 rounded-btn border p-2 ${tCfg.bg} ${tCfg.border}`}>
          <div className="flex items-center gap-1">
            <Thermometer size={10} className="text-ds-v3-ink-2" />
            <span className="text-xs text-ds-v3-ink-2">체감온도</span>
          </div>
          {info?.apparentTemp != null ? (
            <>
              <span className={`text-base font-semibold nums leading-none ${tCfg.text}`}>
                {info.apparentTemp}°
              </span>
              <span className={`text-xs font-semibold ${tCfg.text}`}>
                {info.apparentTemp >= 33 ? '매우 더움' :
                 info.apparentTemp >= 28 ? '더움' :
                 info.apparentTemp <= 0  ? '매우 추움' :
                 info.apparentTemp <= 5  ? '추움' : '적당'}
              </span>
            </>
          ) : (
            <span className="text-xs text-ds-v3-ink-2 mt-0.5">정보없음</span>
          )}
        </div>

        {/* 습도 */}
        <div className={`flex flex-col gap-0.5 rounded-btn border p-2 ${
          info?.humidity != null && info.humidity >= 80 ? 'bg-ds-v3-tts-bg border-ds-v3-tts-line' : 'bg-ds-v3-bg border-ds-v3-line'
        }`}>
          <div className="flex items-center gap-1">
            <Droplets size={10} className={info?.humidity >= 80 ? 'text-ds-v3-tts' : 'text-ds-v3-ink-2'} />
            <span className="text-xs text-ds-v3-ink-2">습도</span>
          </div>
          {info?.humidity != null ? (
            <>
              <span className={`text-base font-semibold nums leading-none ${info.humidity >= 80 ? 'text-ds-v3-tts' : 'text-ds-v3-ink'}`}>
                {info.humidity}%
              </span>
              <span className={`text-xs font-semibold ${info.humidity >= 80 ? 'text-ds-v3-tts' : 'text-ds-v3-ink-2'}`}>
                {info.humidity >= 80 ? '높음' : info.humidity >= 60 ? '보통' : '낮음'}
              </span>
            </>
          ) : (
            <span className="text-xs text-ds-v3-ink-2 mt-0.5">정보없음</span>
          )}
        </div>

        {/* 특보 */}
        <div className={`flex flex-col gap-0.5 rounded-btn border p-2 ${
          hasAlert ? 'bg-ds-v3-surface-2 border-ds-v3-line-2' : 'bg-ds-v3-bg border-ds-v3-line'
        }`}>
          <div className="flex items-center gap-1">
            <AlertTriangle size={10} className={hasAlert ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink-2'} />
            <span className="text-xs text-ds-v3-ink-2">특보</span>
          </div>
          <span className={`text-xs font-semibold leading-tight ${hasAlert ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink-2'}`}>
            {hasAlert ? info.alerts[0] : '없음'}
          </span>
          {hasAlert && info.alerts.length > 1 && (
            <span className="text-xs text-ds-v3-ink-2">+{info.alerts.length - 1}개</span>
          )}
        </div>
      </div>

      {info?.activity && (
        <div className="text-xs text-ds-v3-ink-2 mb-2 leading-relaxed">{info.activity}</div>
      )}
      {info?.quote && (
        <p className="text-xs text-ds-v3-ink-2 italic leading-relaxed line-clamp-2 mb-2">{info.quote}</p>
      )}

      {/* 방송 내용 미리보기 (접이식) */}
      <div className="mb-2">
        <button onClick={() => setShowText(v => !v)}
          className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors w-full min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
          <span>방송 내용 미리보기</span>
          <span className="ml-auto">{showText ? '▲' : '▼'}</span>
        </button>
        {showText && previewText && (
          <div className="mt-1 p-2 bg-ds-v3-bg rounded-btn border border-ds-v3-line">
            <p className="text-xs text-ds-v3-ink-2 leading-relaxed line-clamp-4">{previewText}</p>
          </div>
        )}
      </div>

      {/* BGM 설정 토글 */}
      <div className="mb-2">
        <button onClick={() => setShowBgm(v => !v)}
          className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors w-full min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
          <Music2 size={11} className={bgmEnabled ? 'text-ds-v3-warn' : ''} />
          <span>BGM 재생 {bgmEnabled ? 'ON' : 'OFF'}</span>
          <span className="ml-auto">{showBgm ? '▲' : '▼'}</span>
        </button>
        {showBgm && (
          <div className="mt-2 space-y-2 p-2 bg-ds-v3-bg rounded-btn border border-ds-v3-line">
            {bgmSaveError && (
              <p className="text-xs text-ds-v3-warn line-clamp-2">
                {bgmSaveError}<br />화면에는 바뀌어 보여도 저장되지 않았습니다.
              </p>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={bgmEnabled}
                onChange={e => { setBgmEnabled(e.target.checked); saveBgm({ bgmEnabled: e.target.checked }) }}
                className="w-3.5 h-3.5 accent-ds-v3-warn" />
              <span className="text-xs text-ds-v3-ink">BGM 활성화</span>
            </label>
            {bgmEnabled && (
              <>
                {/* 곡은 이 PC 의 「방송용 BGM」 폴더에서 나온다(2026-09-21 외부 연동 제거 — 검색어·즐겨찾기·주소 칸을 걷었다) */}
                <p className="text-xs text-ds-v3-ink-2">곡은 업로드 › 배경음악의 「{bgmFolderName('local_broadcast')}」 폴더에서 나옵니다.</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input type="number" min={0} max={60} value={bgmDelay}
                    onChange={e => setBgmDelay(e.target.value)}
                    onBlur={() => {
                      const v = bgmDelay === '' ? '0' : bgmDelay
                      setBgmDelay(v)
                      saveBgm({ bgmDelay: parseInt(v) || 0 })
                    }}
                    className="w-12 bg-white border border-ds-v3-line rounded px-2 py-1 text-xs
                               text-ds-v3-ink focus:outline-none focus:border-ds-v3-warn text-center nums" />
                  <span className="text-xs text-ds-v3-ink-2">초 후 방송 시작</span>
                  <input type="number" min={0} max={120} value={bgmEndDelay}
                    onChange={e => setBgmEndDelay(e.target.value)}
                    onBlur={() => {
                      const v = bgmEndDelay === '' ? '0' : bgmEndDelay
                      setBgmEndDelay(v)
                      saveBgm({ bgmEndDelay: parseInt(v) || 0 })
                    }}
                    className="w-12 bg-white border border-ds-v3-line rounded px-2 py-1 text-xs
                               text-ds-v3-ink focus:outline-none focus:border-ds-v3-warn text-center nums" />
                  <span className="text-xs text-ds-v3-ink-2">초 후 BGM 종료</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 mt-auto">
        <button onClick={handlePreview}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-btn py-3 text-sm font-semibold
                     btn-press transition-colors border
                     ${paused
                       ? 'bg-ds-v3-surface-2 border-ds-v3-line-2 text-ds-v3-ink-2'
                       : 'bg-white border-ds-v3-ink-2/30 text-ds-v3-ink-2 hover:bg-ds-v3-surface-2'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}>
          <PreviewIcon size={14} />
          {previewLabel}
        </button>
        {isLive ? (
          <button onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-1.5 bg-ds-v3-warn hover:bg-ds-v3-warn
                       text-white rounded-btn py-3 text-sm font-semibold btn-press transition-colors animate-pulse min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
            <Square size={14} />
            중지하기
          </button>
        ) : (
          <button onClick={handleBroadcast} disabled={broadcasting}
            className="flex-1 flex items-center justify-center gap-1.5 bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2
                       text-white rounded-btn py-3 text-sm font-semibold btn-press transition-colors disabled:opacity-60 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
            <Radio size={14} />
            {broadcasting ? '전송 중...' : '방송하기'}
          </button>
        )}
      </div>
    </div>
  )
}

// 하위 호환용
export default function FavoritesBar() {
  return (
    <div className="grid grid-cols-[1fr_160px_1fr] gap-4">
      <FavsCard />
      <ChimeCard />
      <MorningCard />
    </div>
  )
}
