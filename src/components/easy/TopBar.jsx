import { useEffect, useState } from 'react'
import { LogOut, Cloud, Wind, CloudRain, CloudSnow, CloudLightning } from 'lucide-react'
import BrandMark from '../shared/BrandMark'
import { getWeather, getAirQuality, getMorningText } from '../../lib/api'
import HelpTip from '../shared/HelpTip'
// 창 여는 규칙은 한 곳이다 — 주소·크기·창 이름을 여기 다시 적지 않는다(`lib/monitorWindow.js`).
import MonitorOpenButton from '../home/MonitorOpenButton'
// 날짜·시각 짓는 규칙은 `lib/clock.js` 한 곳이다 — 통합 홈 머리줄 시계가 같은 것을 쓴다.
import { formatDate, formatTime } from '../../lib/clock'

// 날씨 상태에 따른 아이콘 선택
function WeatherIcon({ weather, size = 15 }) {
  if (!weather) return <Cloud size={size} className="text-ds-v3-tts" />
  if (weather.includes('비'))  return <CloudRain      size={size} className="text-ds-v3-tts" />
  if (weather.includes('눈'))  return <CloudSnow      size={size} className="text-ds-v3-tts" />
  if (weather.includes('구름')) return <Cloud          size={size} className="text-ds-v3-ink-2" />
  if (weather.includes('흐림')) return <CloudLightning size={size} className="text-ds-v3-ink-2" />
  return <Cloud size={size} className="text-ds-v3-tts" />
}

// 미세먼지 등급 → 색상
const DUST_COLOR = { 좋음: 'text-ds-v3-ink-2', 보통: 'text-ds-v3-ink-2', 나쁨: 'text-ds-v3-ink-2', '매우나쁨': 'text-ds-v3-warn' }

const UV_THRESHOLDS = { '위험': 11, '매우높음': 8, '높음': 6, '보통': 3, '낮음': 0 }
function uvLabel(grade, index) {
  if (!grade) return null
  if (index == null) return `자외선 ${grade}`
  const t = UV_THRESHOLDS[grade]
  if (grade === '낮음') return `자외선 지수 ${index} (낮음)`
  return t != null ? `자외선 지수 ${index} (${t}이상이면 ${grade})` : `자외선 지수 ${index}`
}

export default function TopBar() {
  const [now,        setNow]        = useState(new Date())
  const [weather,    setWeather]    = useState(null)   // { temp, weather, precip }
  const [air,        setAir]        = useState(null)   // { pm10Grade }
  const [morningInfo, setMorningInfo] = useState(null) // { uvGrade, apparentTemp, tempRange, ... }

  // 1초마다 시계 업데이트
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // 날씨·미세먼지 최초 로딩 및 10분마다 갱신
  useEffect(() => {
    const loadWeather = () => {
      getWeather().then(setWeather).catch(() => {})
      getAirQuality().then(setAir).catch(() => {})
    }
    loadWeather()
    const t = setInterval(loadWeather, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // 마운트 시 1회 — 자외선/체감온도/최저최고 등 추가 정보 로딩
  useEffect(() => {
    getMorningText().then(data => {
      if (data?.info) setMorningInfo(data.info)
    }).catch(() => {})
  }, [])

  const dustColor = air ? (DUST_COLOR[air.pm10Grade] ?? 'text-ds-v3-ink-2') : 'text-ds-v3-ink-2'

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-ds-v3-line flex-shrink-0"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* 로고 */}
      <div className="flex items-center gap-2.5">
        <BrandMark size="md" ai />
      </div>

      {/* 날짜 / 시간 */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xs text-ds-v3-ink-2">{formatDate(now)}</span>
        <span className="text-xl font-semibold nums text-ds-v3-ink">{formatTime(now)}</span>
      </div>

      {/* 날씨 + 로그아웃 */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3 text-sm">
          {/* 날씨 정보 */}
          <div className="flex items-center gap-1.5">
            <WeatherIcon weather={weather ? (weather.precipitationType !== '없음' ? weather.precipitationType : weather.sky) : null} />
            {weather ? (
              <>
                <span className="font-semibold text-ds-v3-ink nums text-base">
                  {weather.temperature != null ? Math.floor(weather.temperature) + '°C' : ''}
                </span>
                <span className="text-ds-v3-ink-2 text-sm">
                  {weather.precipitationType !== '없음'
                    ? weather.precipitationType
                    : (weather.sky || '')}
                </span>
              </>
            ) : (
              <span className="text-ds-v3-ink-2 text-sm">날씨 정보 없음</span>
            )}
          </div>
          <div className="w-px h-4 bg-ds-v3-line" />
          {/* 미세먼지 */}
          <div className="flex items-center gap-1.5 text-ds-v3-ink-2 text-sm">
            <Wind size={14} />
            <span>미세먼지{' '}
              <span className={`font-semibold ${dustColor}`}>
                {air ? air.pm10Grade : '-'}
              </span>
            </span>
          </div>
          {/* 자외선 */}
          {morningInfo?.uvGrade && (
            <>
              <div className="w-px h-4 bg-ds-v3-line" />
              <span className="text-sm font-semibold text-ds-v3-ink-2">{uvLabel(morningInfo.uvGrade, morningInfo.uvIndex)}</span>
            </>
          )}
          {/* 체감온도 */}
          {morningInfo?.apparentTemp != null && (
            <>
              <div className="w-px h-4 bg-ds-v3-line" />
              <span className="text-sm text-ds-v3-ink-2">체감 <span className="font-semibold text-ds-v3-ink-2 nums">{morningInfo.apparentTemp}°C</span></span>
            </>
          )}
          {/* 최저/최고 */}
          {morningInfo?.tempRange && (
            <>
              <div className="w-px h-4 bg-ds-v3-line" />
              <span className="text-sm text-ds-v3-ink-2 nums">{morningInfo.tempRange}</span>
            </>
          )}
        </div>

        {/* 단추는 `MonitorOpenButton` 한 곳에서 만든다(2026-09-14) — 사본을 두면
            팝업 차단 안내가 한쪽에만 붙거나 문구가 갈린다. */}
        <div className="min-w-[180px]"><MonitorOpenButton /></div>
        <HelpTip id="monitorWindow" />

        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-ds-v3-bg border border-ds-v3-line
                           text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink hover:border-ds-v3-line-2 btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
          <LogOut size={14} />
          로그아웃
        </button>
      </div>
    </header>
  )
}
