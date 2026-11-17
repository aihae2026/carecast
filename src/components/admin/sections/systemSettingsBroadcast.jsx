// 시스템 설정 '방송 운영 · 자동화' 아코디언의 알맹이 — 자동 종료, 기상특보 자동방송,
// 방송 구역 설정(준비 중).
//
// 즐겨찾기 버튼 관리(FavoritesEditor)는 부모에 그대로 두고, 부모가 이 컴포넌트 바로 뒤에
// 형제로 그린다 — 자기 상태를 스스로 들고 있어서 여기로 끌고 올 이유가 없다.
//
// **부모가 이 컴포넌트를 항상 렌더한다 — 그룹이 닫혀 있어도.** 아래 초기 로드 effect가
// 화면이 열리는 순간 한 번 돌아야 한다. 닫힌 그룹을 마운트하지 않도록 되돌리면 그룹을
// 펼치는 순간 종료 시각 칸이 빈 채로 잠깐 보인다.
// server/test/system-settings-eager-load.test.js가 고정한다.

import { useState, useEffect } from 'react'
import { PowerOff, Check, CloudLightning, Building2 } from 'lucide-react'
import { getAutoShutdown, saveAutoShutdown,
         getWeatherAlertSettings, saveWeatherAlertSettings,
         getOrgInfo, saveOrgInfo } from '../../../lib/api'
import { 글자크기들, 기본글자크기 } from '../../../lib/broadcastTextSize'

function SystemSettingsBroadcast() {
  // 기관 이름·표어 — 방송 중 홀 TV를 덮는 화면의 큰 글씨. 비워 두면 그 줄이 안 나간다.
  const [orgName,   setOrgName]   = useState('')
  const [orgSlogan, setOrgSlogan] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgSaved,  setOrgSaved]  = useState(false)
  const [orgError,  setOrgError]  = useState('')
  // 방송 화면 글자 크기(크게·중간·작게) — 사용자 지시 2026-09-16. 같은 화면의 글자라 이 칸에 둔다.
  const [orgTextSize, setOrgTextSize] = useState(기본글자크기)

  const [shutdownTime,  setShutdownTime]  = useState('')
  const [shutdownSaved, setShutdownSaved] = useState(false)
  const [shutdownSaving,setShutdownSaving]= useState(false)

  // 기상특보 자동방송
  const [alertBroadcastEnabled, setAlertBroadcastEnabled] = useState(false)
  const [alertBroadcastSaving,  setAlertBroadcastSaving]  = useState(false)

  useEffect(() => {
    getOrgInfo().then(d => {
      setOrgName(d?.name || ''); setOrgSlogan(d?.slogan || '')
      if (d?.textSize) setOrgTextSize(d.textSize)
    }).catch(() => {})
    getAutoShutdown().then(d => setShutdownTime(d.time ?? '')).catch(() => {})
    // 기상특보 자동방송 초기 로드
    getWeatherAlertSettings().then(d => setAlertBroadcastEnabled(!!d.autoBroadcastEnabled)).catch(() => {})
  }, [])

  const handleToggleAlertBroadcast = async () => {
    const next = !alertBroadcastEnabled
    setAlertBroadcastSaving(true)
    try {
      await saveWeatherAlertSettings(next)
      setAlertBroadcastEnabled(next)
    } catch { /* 저장 실패 시 토글 상태 원복 안 함 — 사용자가 다시 눌러 재시도 */ }
    finally { setAlertBroadcastSaving(false) }
  }

  const handleSaveOrg = async () => {
    setOrgSaving(true); setOrgError('')
    try {
      await saveOrgInfo({ name: orgName, slogan: orgSlogan, textSize: orgTextSize })
      setOrgSaved(true)
      setTimeout(() => setOrgSaved(false), 2000)
    } catch (e) {
      // 서버가 막는 경우가 실제로 있다(깨진 글자). 조용히 넘기면 사람은 저장된 줄 안다.
      setOrgError(e?.message || '저장하지 못했습니다.')
    } finally { setOrgSaving(false) }
  }

  const handleSaveShutdown = async () => {
    setShutdownSaving(true)
    try {
      await saveAutoShutdown(shutdownTime)
      setShutdownSaved(true)
      setTimeout(() => setShutdownSaved(false), 2000)
    } catch (e) { console.error('[설정] 자동종료 시각 저장 실패:', e.message) }  // '저장됨' 표시가 안 뜨는 것으로 사람이 알아챈다
    setShutdownSaving(false)
  }

  return (
    <>
      {/* 기관 이름·표어 (방송 대기화면) */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <Building2 size={15} className="text-ds-v3-ink-2" />
          방송 화면 문구
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          방송 중 화면 전체를 덮는 큰 글씨입니다. 비워 두면 그 줄은 나오지 않습니다.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-ds-v3-ink-2 mb-1">표어 (윗줄)</label>
            <input
              type="text" value={orgSlogan} maxLength={40}
              onChange={e => setOrgSlogan(e.target.value)}
              className="input-base w-full max-w-md"
            />
          </div>
          <div>
            <label className="block text-xs text-ds-v3-ink-2 mb-1">기관 이름 (아랫줄)</label>
            <input
              type="text" value={orgName} maxLength={40}
              onChange={e => setOrgName(e.target.value)}
              className="input-base w-full max-w-md"
            />
          </div>
          {/* ── **방송 화면 글자 크기** (사용자 지시 2026-09-16) ─────────────────────
              *"그 방송화면에 자막 크기 설정할 수 있게 끔 하게 해줘, 설정에서 크게, 중간, 작게"*
              표어·기관 이름과 **자막에 함께** 걸린다 — 한 화면의 글자라 따로 놀면 어색하다.
              「크게」가 지금 크기다(2026-09-15 에 1.5배로 키운 그 크기). */}
          <div>
            <span id="org-text-size-label" className="block text-xs text-ds-v3-ink-2 mb-1">방송 화면 글자 크기</span>
            <div role="radiogroup" aria-labelledby="org-text-size-label"
                 className="inline-flex rounded-full border border-ds-v3-line bg-ds-v3-bg p-1 gap-1">
              {글자크기들.map(k => (
                <button key={k.id} type="button" role="radio" aria-checked={orgTextSize === k.id}
                  onClick={() => setOrgTextSize(k.id)}
                  className={'min-h-[44px] min-w-[72px] rounded-full px-4 text-sm font-semibold transition-colors '
                    + (orgTextSize === k.id
                      ? 'bg-ds-v3-ink text-white'
                      : 'text-ds-v3-ink-2 hover:text-ds-v3-ink')}>
                  {k.이름}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ds-v3-ink-2">표어·기관 이름과 방송 자막에 함께 적용됩니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveOrg}
              disabled={orgSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                         bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                         disabled:opacity-60"
            >
              {orgSaved
                ? <><Check size={14} /> 저장됨</>
                : orgSaving ? '저장 중...' : '저장'}
            </button>
            {orgError && <span className="text-xs text-ds-v3-warn">{orgError}</span>}
          </div>
          <p className="text-xs text-ds-v3-ink-2">
            저장하면 홀 화면에 바로 반영됩니다.
          </p>
        </div>
      </div>

      {/* 자동 종료 */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <PowerOff size={15} className="text-ds-v3-ink-2" />
          자동 종료
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          매일 지정한 시각에 PC를 자동으로 종료합니다. 비워두면 자동 종료를 사용하지 않습니다.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs text-ds-v3-ink-2 mb-1">종료 시각</label>
            <input
              type="time"
              value={shutdownTime}
              onChange={e => setShutdownTime(e.target.value)}
              className="input-base w-40 text-base nums"
            />
          </div>
          <button
            onClick={handleSaveShutdown}
            disabled={shutdownSaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                       bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                       disabled:opacity-60 mt-4"
          >
            {shutdownSaved
              ? <><Check size={14} /> 저장됨</>
              : shutdownSaving ? '저장 중...' : '저장'}
          </button>
          {shutdownTime && (
            <button
              onClick={() => { setShutdownTime(''); saveAutoShutdown('') }}
              className="px-3 py-2 rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-warn
                         border border-ds-v3-line transition-colors mt-4"
            >
              해제
            </button>
          )}
        </div>
        {shutdownTime && (
          <p className="text-xs text-ds-v3-ink-2 mt-2">
            매일 {shutdownTime}에 PC가 종료됩니다. (종료 30초 전 알림 표시)
          </p>
        )}
      </div>

      {/* 기상특보 자동방송 */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <CloudLightning size={15} className="text-ds-v3-ink-2" />
          기상특보 자동방송
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          서울(기본 특보 지역 — 아직 바꿀 수 없음) 기준 새 기상특보가 발효되면 근무시간(아침방송시간~17:30) 중 자동으로 안내 방송합니다.
        </p>
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <div onClick={handleToggleAlertBroadcast}
            className={`w-10 rounded-full transition-colors flex-shrink-0 ${alertBroadcastEnabled ? 'bg-ds-v3-tts' : 'bg-ds-v3-line-2'}`}
            style={{ height: '22px', position: 'relative', cursor: alertBroadcastSaving ? 'wait' : 'pointer', opacity: alertBroadcastSaving ? 0.6 : 1 }}>
            <span className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform"
              style={{ left: alertBroadcastEnabled ? '20px' : '2px' }} />
          </div>
          <span className="text-sm text-ds-v3-ink font-normal">{alertBroadcastEnabled ? '켜짐' : '꺼짐'}</span>
        </label>
      </div>

    </>
  )
}

export { SystemSettingsBroadcast }
