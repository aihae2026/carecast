// 그 밖의 연동 카드 — 구글 캘린더·스위치봇.
// (외부 동영상 키 카드는 2026-09-21 걷어냈다 — 배경음악·영상은 이 PC 에 올린 파일이다.)
//
// APISettings.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
import { useState, useEffect } from 'react'
import { Calendar, Zap, Eye, EyeOff, RefreshCw, Link, Unlink } from 'lucide-react'
import { Badge } from '../../shared/Badge'
import Toggle from '../../shared/Toggle'
import ConnectionErrorNote from '../../shared/ConnectionErrorNote'
import {
  getGCalSettings, saveGCalSettings, getCalendarAuthUrl, getCalendarStatus, getCalendarToday, disconnectCalendar, getSwitchBotSettings, saveSwitchBotSettings, getSwitchBotStatus, getSwitchBotDevices, switchBotOn,
} from '../../../lib/api'
// 손으로 안 넣어도 되는 값의 **정본**. 화면마다 따로 적으면 기본값이 갈린다(UX-13·UX-39).
import { 기본CalendarId, 기본RedirectUri } from '../../../lib/setupRules'

// ── Google Calendar 카드 ─────────────────────────────────────
function GoogleCalendarCard() {
  const [clientId,     setClientId]     = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [calendarId,   setCalendarId]   = useState(기본CalendarId)
  const [redirectUri,  setRedirectUri]  = useState(기본RedirectUri)
  const [connected,    setConnected]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [testing,      setTesting]      = useState(false)
  const [events,       setEvents]       = useState(null)
  const [toast,        setToast]        = useState('')
  const [showSecret,   setShowSecret]   = useState(false)
  // **오류는 토스트로 내보내지 않는다.** 3초 뒤 사라지면 다음 행동과 원문을 통째로
  // 잃는다 — 원문을 날것으로 띄우던 것을 고치면서 반대편으로 넘어갔던 자리다
  // (Codex 지적, 2026-09-11 EV-004651). 카드에 남겨서 읽을 시간을 준다.
  const [연동오류,     set연동오류]     = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // **서버가 빈 값을 주면 칸을 비우지 않는다.** 예전에는 그대로 덮어써서, 아직 아무것도
  // 저장 안 한 새 PC 에서 칸이 통째로 비었다 — 화면에 "(기본: primary)" 라고 적어 두고
  // 정작 넣어 주지는 않은 것이다. 저장된 값이 있으면 그것이 이기고, 없으면 계산값을 둔다.
  const refresh = () => getGCalSettings().then(d => {
    setClientId(d.clientId)
    setCalendarId(d.calendarId || 기본CalendarId)
    setRedirectUri(d.redirectUri || 기본RedirectUri())
    setConnected(d.connected)
  }).catch(() => {})

  useEffect(() => { refresh() }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveGCalSettings({ clientId, ...(clientSecret && { clientSecret }), calendarId, redirectUri })
      setClientSecret(''); showToast('저장 완료')
    } catch (e) { showToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleConnect = async () => {
    try {
      const { url } = await getCalendarAuthUrl()
      // OAuth 창을 팝업으로 열기
      const popup = window.open(url, 'google_oauth', 'width=500,height=600,left=200,top=100')
      // 팝업 닫힘 감지 → 연동 상태 갱신
      const check = setInterval(() => {
        if (popup?.closed) {
          clearInterval(check)
          getCalendarStatus().then(d => setConnected(d.connected)).catch(() => {})
        }
      }, 1000)
    } catch (e) { set연동오류(e) }
  }

  const handleDisconnect = async () => {
    if (!confirm('Google Calendar 연동을 해제하시겠습니까?')) return
    try { await disconnectCalendar(); setConnected(false); setEvents(null); showToast('연동 해제됨') }
    catch (e) { set연동오류(e) }
  }

  const handleTestEvents = async () => {
    setTesting(true); setEvents(null)
    try { const d = await getCalendarToday(); setEvents(d.events) }
    catch (e) { set연동오류(e) }
    finally { setTesting(false) }
  }

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-surface-2 border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Calendar size={18} className="text-ds-v3-ink-2" />
          </div>
          <div><h3 className="t-label font-semibold text-ds-v3-ink">Google Calendar</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">시설 일정 자동 방송 반영</p></div>
        </div>
        <Badge variant={connected ? 'success' : 'default'}>{connected ? '연동됨' : '미연동'}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">OAuth Client ID</label>
          <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="xxxxx.apps.googleusercontent.com"
            className="input-base font-mono" />
        </div>
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">OAuth Client Secret</label>
          <div className="relative">
            <input type={showSecret ? 'text' : 'password'} value={clientSecret}
              onChange={e => setClientSecret(e.target.value)} placeholder="비어 있으면 기존 값 유지"
              className="input-base font-mono pr-10" />
            <button onClick={() => setShowSecret(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-[24px] min-h-[24px] -mr-[5px] text-ds-v3-ink-2 hover:text-ds-v3-ink">
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ds-v3-ink-2 mb-1.5">Calendar ID <span className="text-ds-v3-ink-2">(기본: primary)</span></label>
            <input type="text" value={calendarId} onChange={e => setCalendarId(e.target.value)}
              className="input-base" />
          </div>
          <div>
            <label className="block text-xs text-ds-v3-ink-2 mb-1.5">
              Redirect URI <span className="text-ds-v3-ink-2">(이 화면 주소에서 자동)</span>
            </label>
            <input type="text" value={redirectUri} onChange={e => setRedirectUri(e.target.value)}
              className="input-base font-mono" />
          </div>
        </div>
      </div>

      {/* 일정 테스트 결과 */}
      {events !== null && (
        <div className="bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn px-3 py-2">
          <p className="text-xs font-semibold text-ds-v3-ink-2 mb-1">오늘 일정 ({events.length}건)</p>
          {events.length === 0
            ? <p className="text-xs text-ds-v3-ink-2">등록된 일정이 없습니다.</p>
            : events.map((e, i) => (
                <p key={i} className="text-xs text-ds-v3-ink-2">• {e.title}{!e.isAllDay && ` (${e.start?.slice(11,16)})`}</p>
              ))}
        </div>
      )}

      {toast && <p className="text-xs text-ds-v3-ink-3">{toast}</p>}
      <ConnectionErrorNote 오류={연동오류} />

      <div className="flex gap-2 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-ink hover:bg-ds-v3-ink disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '설정 저장'}
        </button>
        {!connected ? (
          <button onClick={handleConnect}
            className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
            <Link size={13} /> Google 연동
          </button>
        ) : (
          <>
            <button onClick={handleTestEvents} disabled={testing}
              className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
              <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />{testing ? '조회 중...' : '오늘 일정 테스트'}
            </button>
            <button onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-3 py-2 border border-ds-v3-warn/30 text-ds-v3-warn rounded-btn text-xs font-normal hover:bg-ds-v3-warn-bg btn-press transition-colors">
              <Unlink size={13} /> 연동 해제
            </button>
          </>
        )}
      </div>

      {/* 설정 가이드 */}
      <div className="text-[11px] text-ds-v3-ink-2 bg-ds-v3-bg rounded-btn px-3 py-2 leading-relaxed">
        Google Cloud Console → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID 생성 후<br/>
        승인된 리디렉션 URI에 위 Redirect URI를 등록해야 합니다.
      </div>
    </div>
  )
}

// ── SwitchBot 연동 카드 ──────────────────────────────────────
function SwitchBotCard() {
  // 인증 정보
  const [token,    setToken]    = useState('')
  const [secret,   setSecret]   = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [tokenSet,     setTokenSet]     = useState(false)
  const [tokenMasked,  setTokenMasked]  = useState(null)
  const [secretSet,    setSecretSet]    = useState(false)
  const [secretMasked, setSecretMasked] = useState(null)

  // 시간 설정
  const [onTime,      setOnTime]      = useState('07:45')
  const [offTime,     setOffTime]     = useState('17:30')
  const [autoControl, setAutoControl] = useState(true)

  // UI 상태
  const [saving,         setSaving]         = useState(false)
  const [testing,        setTesting]        = useState(false)
  const [testResult,     setTestResult]     = useState(null)   // { power } | { error }
  const [controlLoading, setControlLoading] = useState(null)   // 'on' | 'off' | null
  const [toast,          setToast]          = useState('')
  const [showToken,      setShowToken]      = useState(false)
  const [showSecret,     setShowSecret]     = useState(false)

  const [연동오류,     set연동오류]     = useState(null)
  // 장치 목록 — `null` 은 "아직 안 물어봤다 / 못 받았다", `[]` 는 "물어봤는데 하나도 없다".
  // 둘을 섞으면 화면이 "장치가 없다"와 "아직 모른다"를 같게 말한다(UX-08, 2026-09-12).
  const [장치목록,     set장치목록]     = useState(null)
  const [장치찾는중,   set장치찾는중]   = useState(false)
  const [장치오류,     set장치오류]     = useState('')
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // 목록을 가져온다. **못 가져온 이유를 빈 목록으로 바꾸지 않는다** — 토큰이 틀린 것과
  // 장치가 없는 것은 사람이 고칠 곳이 다르다.
  const 장치불러오기 = async () => {
    set장치찾는중(true); set장치오류('')
    try {
      const d = await getSwitchBotDevices()
      set장치목록(d.devices || [])
    } catch (e) {
      set장치오류(e?.message || '장치 목록을 받지 못했습니다.')
      set장치목록(null)
    } finally { set장치찾는중(false) }
  }

  const refresh = () =>
    getSwitchBotSettings().then(d => {
      setTokenSet(d.tokenSet);   setTokenMasked(d.tokenMasked)
      setSecretSet(d.secretSet); setSecretMasked(d.secretMasked)
      setDeviceId(d.deviceId)
      setOnTime(d.onTime);  setOffTime(d.offTime)
      setAutoControl(d.autoControl)
    }).catch(() => {})

  useEffect(() => { refresh() }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSwitchBotSettings({
        ...(token.trim()    && { token:  token.trim()  }),
        ...(secret.trim()   && { secret: secret.trim() }),
        deviceId, onTime, offTime, autoControl,
      })
      setToken(''); setSecret('')
      showToast('저장 완료')
      refresh()
    } catch (e) { showToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const data = await getSwitchBotStatus()
      if (data.error) throw new Error(data.error)
      setTestResult({ power: data.power })
    } catch (e) { setTestResult({ error: e.message }) }
    finally { setTesting(false) }
  }

  const handleControl = async () => {
    setControlLoading('press')
    try {
      await switchBotOn()  // /api/switchbot/on → press 명령
      showToast('누르기 명령 전송 완료')
    } catch (e) { set연동오류(e) }
    finally { setControlLoading(null) }
  }

  const isSet = tokenSet && secretSet && !!deviceId
  const badgeVariant = isSet ? 'success' : 'default'
  const badgeLabel   = isSet ? '연동됨' : '미설정'

  return (
    <div className="card-base space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-surface-2 border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-ds-v3-ink-2" />
          </div>
          <div>
            <h3 className="t-label font-semibold text-ds-v3-ink">SwitchBot</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">방송 장비 전원 자동 제어</p>
          </div>
        </div>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>

      {/* API Token */}
      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">API Token</label>
        {tokenSet && !token ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ds-v3-ink-2 font-mono bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 flex-1">
              {tokenMasked}
            </span>
            <button onClick={() => setToken(' ')} className="text-xs text-ds-v3-ink-2 hover:underline whitespace-nowrap inline-flex items-center min-h-[24px] px-1 -mx-1">변경</button>
          </div>
        ) : (
          <div className="relative">
            <input type={showToken ? 'text' : 'password'} value={token}
              onChange={e => setToken(e.target.value)} placeholder="SwitchBot Open API Token"
              className="input-base pr-10 font-mono" />
            <button onClick={() => setShowToken(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Client Secret */}
      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">Client Secret</label>
        {secretSet && !secret ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ds-v3-ink-2 font-mono bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 flex-1">
              {secretMasked}
            </span>
            <button onClick={() => setSecret(' ')} className="text-xs text-ds-v3-ink-2 hover:underline whitespace-nowrap inline-flex items-center min-h-[24px] px-1 -mx-1">변경</button>
          </div>
        ) : (
          <div className="relative">
            <input type={showSecret ? 'text' : 'password'} value={secret}
              onChange={e => setSecret(e.target.value)} placeholder="SwitchBot Open API Secret"
              className="input-base pr-10 font-mono" />
            <button onClick={() => setShowSecret(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Device ID — **고르게 한다.** 손으로 적는 길은 남겨 둔다(UX-08, 2026-09-12).
          계정이 아는 것을 사람에게 다시 적게 하지 않는다. 그 값은 16진 문자열이라
          한 글자만 틀려도 조용히 안 먹고, 화면은 "연결 끊김"이라 말하는데 사람은
          토큰을 의심한다. 목록을 못 받으면 **왜 못 받았는지** 말하고 칸은 그대로 둔다. */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs text-ds-v3-ink-2">Device ID</label>
          <button type="button" onClick={장치불러오기} disabled={장치찾는중 || !(tokenSet || token) || !(secretSet || secret)}
            className="text-[11px] text-ds-v3-ink-2 hover:underline disabled:opacity-50
                       inline-flex items-center min-h-[24px] px-1 -mx-1">
            {장치찾는중 ? '장치를 찾는 중…' : '내 장치 목록 불러오기'}
          </button>
        </div>

        {Array.isArray(장치목록) && 장치목록.length > 0 && (
          <select value={장치목록.some(d => d.deviceId === deviceId) ? deviceId : ''}
            onChange={e => { if (e.target.value) setDeviceId(e.target.value) }}
            aria-label="장치 고르기"
            className="input-base mb-1.5">
            <option value="">고르지 않음 — 아래에 직접 적습니다</option>
            {장치목록.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.name || '(이름 없음)'} · {d.type}{d.kind === 'remote' ? ' (리모컨)' : ''}
              </option>
            ))}
          </select>
        )}

        <input type="text" value={deviceId} onChange={e => setDeviceId(e.target.value)}
          placeholder="SwitchBot 장치 ID (앱 &gt; 장치 &gt; 장치 정보)"
          className="input-base font-mono" />

        {/* **"없다"와 "모른다"를 가른다.** 빈 목록을 오류로 적으면 진짜 빈 계정을 고장으로
            읽고, 오류를 빈 목록으로 적으면 토큰 문제를 장치 문제로 읽는다. */}
        {Array.isArray(장치목록) && 장치목록.length === 0 && !장치오류 && (
          <p className="mt-1.5 text-[11px] text-ds-v3-ink-2">
            이 계정에 등록된 장치가 없습니다. SwitchBot 앱에서 장치를 먼저 추가해 주세요.
          </p>
        )}
        {장치오류 && (
          <p className="mt-1.5 text-[11px] text-ds-v3-ink-2">
            장치 목록을 받지 못했습니다 — {장치오류} 토큰·시크릿을 저장했는지, 인터넷이 되는지 확인해 주세요.
            그동안은 아래 칸에 직접 적어도 됩니다.
          </p>
        )}
      </div>

      {/* 자동 제어 시간 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">자동 ON 시간</label>
          <input type="time" value={onTime} onChange={e => setOnTime(e.target.value)}
            className="input-base nums" />
        </div>
        <div>
          <label className="block text-xs text-ds-v3-ink-2 mb-1.5">자동 OFF 시간</label>
          <input type="time" value={offTime} onChange={e => setOffTime(e.target.value)}
            className="input-base nums" />
        </div>
      </div>

      {/* 자동 전원 제어 토글 */}
      <div className="flex items-center justify-between py-1">
        <div>
          <p className="text-sm text-ds-v3-ink">자동 전원 제어</p>
          <p className="text-xs text-ds-v3-ink-2 mt-0.5">설정한 시간에 자동으로 ON/OFF 합니다</p>
        </div>
        <Toggle defaultChecked={autoControl} onChange={val => setAutoControl(val)} />
      </div>

      {/* 테스트 결과 */}
      {testResult && (
        <div className={`rounded-btn px-3 py-2 text-xs border ${
          testResult.error
            ? 'bg-ds-v3-warn-bg border-ds-v3-line text-ds-v3-warn'
            : 'bg-ds-v3-surface-2 border-ds-v3-line text-ds-v3-ink-3'
        }`}>
          {/* 오류는 공통 규약이 사람 말로 옮긴다(UX-10). 성공 문구는 이 카드 고유다. */}
          {testResult.error
            ? <ConnectionErrorNote 오류={testResult.error} />
            : `현재 상태: 전원 ${testResult.power === 'on' ? 'ON ● 켜짐' : 'OFF ○ 꺼짐'}`}
        </div>
      )}

      {/* 수동 제어 */}
      {isSet && (
        <div className="space-y-1.5">
          <p className="text-xs text-ds-v3-ink-2">수동 제어 (누를 때마다 ON↔OFF 전환)</p>
          <button onClick={handleControl} disabled={!!controlLoading}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5
                       bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 disabled:opacity-50
                       text-white rounded-btn text-sm font-semibold btn-press transition-colors">
            {controlLoading ? '명령 전송 중...' : '누르기'}
          </button>
        </div>
      )}

      {toast && <p className="text-xs text-ds-v3-ink-3">{toast}</p>}
      <ConnectionErrorNote 오류={연동오류} />

      {/* 버튼 */}
      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || !isSet}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn
                     text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />
          {testing ? '조회 중...' : '연결 테스트'}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center px-3 py-2 bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2
                     disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

export { GoogleCalendarCard, SwitchBotCard }
