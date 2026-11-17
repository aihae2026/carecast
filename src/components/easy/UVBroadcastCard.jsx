import { useState, useEffect, useCallback } from 'react'
import { Sun, Thermometer, Radio, RefreshCw } from 'lucide-react'
import { getWeather, ttsBroadcast } from '../../lib/api'

const UV_CONFIG = {
  '위험':    { bg: 'bg-ds-v3-flow-bg', border: 'border-ds-v3-flow-line', text: 'text-ds-v3-flow', dot: 'bg-ds-v3-flow' },
  '매우높음': { bg: 'bg-ds-v3-warn-bg',    border: 'border-ds-v3-warn',    text: 'text-ds-v3-warn',    dot: 'bg-ds-v3-warn'    },
  '높음':    { bg: 'bg-ds-v3-surface-2', border: 'border-ds-v3-line-2', text: 'text-ds-v3-ink-2', dot: 'bg-ds-v3-line' },
  '보통':    { bg: 'bg-ds-v3-surface-2', border: 'border-ds-v3-line', text: 'text-ds-v3-ink-2', dot: 'bg-ds-v3-line' },
  '낮음':    { bg: 'bg-ds-v3-surface-2',  border: 'border-ds-v3-line',  text: 'text-ds-v3-ink-2',  dot: 'bg-ds-v3-line'  },
}

function uvAdvice(level) {
  switch (level) {
    case '위험':    return '가급적 외출을 자제하시고, 외출 시 자외선 차단제와 긴 소매 옷을 반드시 착용하시기 바랍니다.'
    case '매우높음': return '외출 시 모자와 양산을 준비하시고, 오후 시간대 장시간 야외활동은 자제하시기 바랍니다.'
    case '높음':    return '외출 시 자외선 차단제를 꼭 챙기시기 바랍니다.'
    case '보통':    return '외출 시 자외선 차단제를 바르시면 도움이 됩니다.'
    default:       return null
  }
}

function tempAdvice(t) {
  if (t >= 33) return `체감온도는 ${t}도로 높게 나타나고 있습니다.\n수분을 충분히 섭취하시고\n무더운 시간대 야외활동을 삼가시기 바랍니다.`
  if (t >= 28) return `체감온도는 ${t}도로 다소 높게 나타나고 있습니다.\n수분을 충분히 섭취하시고 더위에 주의하시기 바랍니다.`
  if (t <= 0)  return `체감온도는 ${t}도로 매우 낮게 나타나고 있습니다.\n따뜻한 옷차림을 꼭 갖추시기 바랍니다.`
  if (t <= 5)  return `체감온도는 ${t}도로 낮게 나타나고 있습니다.\n외출 시 따뜻하게 입으시기 바랍니다.`
  return null
}

function buildScript(uv, apparentTemp) {
  const parts = []

  if (uv?.value != null && uv?.level && uv.level !== '정보없음') {
    // 지역 이름을 박아 두지 않는다 — 한 기관의 지명이 다른 기관 방송에 그대로 나갔다(출시 검수 2026-10-17).
    parts.push(`오늘 자외선지수는 '${uv.level}' 수준입니다.`)
    const advice = uvAdvice(uv.level)
    if (advice) parts.push(advice)
  }

  if (apparentTemp?.value != null) {
    const advice = tempAdvice(apparentTemp.value)
    if (advice) parts.push(advice)
  }

  return parts.join('\n')
}

export default function UVBroadcastCard() {
  const [weather,      setWeather]      = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [result,       setResult]       = useState(null)  // 'ok' | 'err'

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await getWeather()
      setWeather(data)
    } catch (e) { console.error('[자외선] 날씨 조회 실패:', e.message) }  // 예전 값을 그대로 두고 다음 갱신을 기다린다
    finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const uv          = weather?.uv
  const apparentTemp = weather?.apparentTemp
  const script      = buildScript(uv, apparentTemp)
  const uvCfg       = UV_CONFIG[uv?.level] ?? null

  const handleBroadcast = async () => {
    if (!script || broadcasting) return
    setBroadcasting(true)
    setResult(null)
    try {
      await ttsBroadcast({ text: script, voice: 'ko-KR-SunHiNeural', target: '전체' })
      setResult('ok')
    } catch {
      setResult('err')
    } finally {
      setBroadcasting(false)
      setTimeout(() => setResult(null), 3000)
    }
  }

  return (
    <div className="easy-card bg-white">
      <div className="flex items-center gap-2 mb-3">
        <Sun size={15} className="text-ds-v3-ink-2" />
        <h3 className="text-xs font-semibold text-ds-v3-ink-2 uppercase tracking-widest">자외선 · 체감온도</h3>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="ml-auto text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors disabled:opacity-40 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw size={16} className="animate-spin text-ds-v3-ink-2" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {/* 자외선 */}
            <div className={`rounded-btn border p-2.5 ${uvCfg ? `${uvCfg.bg} ${uvCfg.border}` : 'bg-ds-v3-bg border-ds-v3-line'}`}>
              <div className="flex items-center gap-1 mb-1">
                <Sun size={10} className={uvCfg ? uvCfg.text : 'text-ds-v3-ink-2'} />
                <span className="text-xs text-ds-v3-ink-2">자외선지수</span>
              </div>
              {uv?.value != null ? (
                <>
                  <div className={`text-base font-semibold nums leading-none ${uvCfg ? uvCfg.text : 'text-ds-v3-ink'}`}>
                    {uv.value}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 ${uvCfg ? uvCfg.text : 'text-ds-v3-ink-2'}`}>
                    {uv.level}
                  </div>
                </>
              ) : (
                <div className="text-xs text-ds-v3-ink-2 mt-1">데이터 없음</div>
              )}
            </div>

            {/* 체감온도 */}
            <div className={`rounded-btn border p-2.5 ${
              apparentTemp?.value >= 33 ? 'bg-ds-v3-warn-bg border-ds-v3-warn-bg' :
              apparentTemp?.value >= 28 ? 'bg-ds-v3-surface-2 border-ds-v3-line' :
              apparentTemp?.value <= 5  ? 'bg-ds-v3-tts-bg border-ds-v3-tts-line' :
              'bg-ds-v3-bg border-ds-v3-line'
            }`}>
              <div className="flex items-center gap-1 mb-1">
                <Thermometer size={10} className="text-ds-v3-ink-2" />
                <span className="text-xs text-ds-v3-ink-2">체감온도</span>
              </div>
              {apparentTemp?.value != null ? (
                <>
                  <div className={`text-base font-semibold nums leading-none ${
                    apparentTemp.value >= 33 ? 'text-ds-v3-warn' :
                    apparentTemp.value >= 28 ? 'text-ds-v3-ink-2' :
                    apparentTemp.value <= 5  ? 'text-ds-v3-tts' :
                    'text-ds-v3-ink'
                  }`}>
                    {apparentTemp.value}°
                  </div>
                  <div className="text-xs text-ds-v3-ink-2 mt-0.5">
                    {apparentTemp.value >= 33 ? '매우 더움' :
                     apparentTemp.value >= 28 ? '더움' :
                     apparentTemp.value <= 0  ? '매우 추움' :
                     apparentTemp.value <= 5  ? '추움' : '적당'}
                  </div>
                </>
              ) : (
                <div className="text-xs text-ds-v3-ink-2 mt-1">데이터 없음</div>
              )}
            </div>
          </div>

          {/* 방송 시나리오 미리보기 */}
          {script && (
            <div className="mb-3 p-2 bg-ds-v3-bg rounded-btn border border-ds-v3-line">
              <p className="text-xs text-ds-v3-ink-2 leading-relaxed whitespace-pre-line line-clamp-3">{script}</p>
            </div>
          )}

          {/* 방송 버튼 */}
          <button
            onClick={handleBroadcast}
            disabled={!script || broadcasting}
            className={`w-full flex items-center justify-center gap-2 rounded-btn py-3
                        text-sm font-semibold btn-press transition-colors disabled:opacity-50
                        ${result === 'ok'  ? 'bg-ds-v3-ink-3 text-white' :
                          result === 'err' ? 'bg-ds-v3-warn text-white'  :
                          broadcasting     ? 'bg-ds-v3-tts/80 text-white animate-pulse' :
                                            'bg-ds-v3-tts text-white hover:bg-ds-v3-tts'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
          >
            <Radio size={15} className={broadcasting ? 'animate-pulse' : ''} />
            {broadcasting ? '방송 중...' :
             result === 'ok'  ? '보냈습니다' :   /* 대기열에 넣은 순간 온다 — 소리가 난 뒤가 아니다(EmergencyBroadcast 보냄문구) */
             result === 'err' ? '오류 발생' :
             '즉시 방송'}
          </button>

          {!script && (
            <p className="text-xs text-ds-v3-ink-2 text-center mt-2">
              API 키를 설정하면 자외선·체감온도 방송이 가능합니다.
            </p>
          )}
        </>
      )}
    </div>
  )
}
