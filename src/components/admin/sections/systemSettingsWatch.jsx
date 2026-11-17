// 시스템 설정 '방송 운영 · 자동화' 의 한 카드 — 방송 알림 · 백업 (2026-09-23).
//
// 서버는 오래전부터 이 넷을 읽고 있었는데 **바꾸는 칸이 없었다**(코드 주석마다 「설정으로 바꾼다」).
// 범위·기본값은 서버(`domain/watchSettings`)가 함께 준다 — 이 화면은 숫자를 따로 들고 있지 않는다.
//
// **말은 경보 문장에 맞춘다**(화면 검수 2026-09-23). 경보는 「나가지 않았습니다 / 끝나지 않았습니다」,
// 사용 설명서는 「안 나감 / 안 끝남」이다 — 「유예」「미룸 상한」으로 적으면 실무자가 이 칸을 경보와
// 이어 읽지 못한다. 그리고 **무엇이 실제로 보이는지 그대로 적는다**: 자동 방송의 「안 나감」은
// 화면 알림에서 가려져 있고(`src/lib/alertStore.js` 의 HIDDEN_KINDS, 2026-09-01 사용자 결정)
// 방송 이력에만 남는다. 「알립니다」라고 적으면 1분으로 줄여 놓고 알림을 기다리게 된다.
//
// 숫자 칸은 `type="number"` 를 쓰지 않는다 — 이 화면은 긴 한 장이라, 칸을 누른 채 휠로 내려가면
// 값이 조용히 바뀐다. 범위 검사는 서버가 한다.
//
// **부모가 이 컴포넌트를 항상 렌더한다.** 아래 초기 로드 effect 가 화면이 열리는 순간 한 번 돌아야
// 값이 채워진 채로 보인다. server/test/system-settings-eager-load.test.js 가 고정한다.

import { useState, useEffect } from 'react'
import { ShieldCheck, Check } from 'lucide-react'
import { getWatchSettings, saveWatchSettings } from '../../../lib/api'

// 묶음 → 칸. 순서가 화면 순서다. 성격이 셋이라 나눈다 — 알림 둘은 기록·알림만 바꾸고,
// 겹친 예약은 **방송을 실제로 건너뛸지**를 정하고, 백업은 방송과 무관하다.
const 묶음들 = [
  { 제목: '알림', 칸들: [
    { field: 'graceMin', label: '안 나감 알림까지 기다리는 시간',
      help: '예정 시각이 지나고 이만큼 기다려도 방송이 시작되지 않으면 방송 이력에 「안 나감」으로 남깁니다. '
          + '자동 방송은 화면 알림이 뜨지 않고, 한 번만 하는 예약은 화면 위쪽에도 알립니다.' },
    // 「시작한 뒤」가 아니라 **예정 시각부터** 센다(watchdog.js:195 — 예정 + 유예). 자정을 넘기면 그날
    // 23:59 로 당긴다(clampToToday). 2026-09-24 Codex 검수: 처음 문구가 「시작된 뒤」라 틀렸다.
    { field: 'runGraceMin', label: '안 끝남 알림까지 기다리는 시간',
      help: '방송이 시작은 했는데 예정 시각부터 이만큼 지나도 끝나지 않으면 화면 위쪽에 「안 끝남」 알림을 띄웁니다. '
          + '가장 긴 방송(아침 종합 방송은 40분이 넘기도 합니다)보다 넉넉히 두세요. 밤늦은 방송은 그날 안에 알리도록 더 짧아집니다.' },
  ] },
  { 제목: '겹친 예약', 칸들: [
    { field: 'deferMaxMin', label: '겹친 예약 방송을 기다리는 최대 시간',
      help: '예약 시각에 다른 방송이 나가고 있으면 끝날 때까지 기다렸다가 내보냅니다. '
          + '이만큼 기다려도 앞 방송이 안 끝나면 이 예약은 이번엔 건너뛰고 알림을 남깁니다.' },
  ] },
]

function SystemSettingsWatch() {
  const [값,      set값]      = useState(null)   // 서버가 준 전체(값·defaults·limits). 못 읽었으면 null
  const [입력,    set입력]    = useState({})     // 칸에 적힌 글자 그대로
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')     // 카드 전체의 사유(불러오기 실패 등)
  const [틀린칸,  set틀린칸]  = useState(null)   // { field, 사유 } — 그 칸 바로 아래에 띄운다
  const [notice,  setNotice]  = useState('')

  const 채우기 = (d) => {
    set값(d)
    set입력({
      backupTime:  d.backupTime,
      graceMin:    String(d.graceMin),
      runGraceMin: String(d.runGraceMin),
      deferMaxMin: String(d.deferMaxMin),
    })
  }

  useEffect(() => {
    getWatchSettings().then(채우기).catch(() => setError('지금 값을 불러오지 못했습니다. 화면을 새로고침해 주세요.'))
  }, [])

  const 고치기 = (field, v) => {
    set입력(p => ({ ...p, [field]: v }))
    if (틀린칸?.field === field) set틀린칸(null)
  }

  // **바뀐 칸만 보낸다**(2026-09-24 Codex 검수). 네 칸을 늘 다 보내면 ① 옛 DB 에 범위 밖 값(예: 유예 0)이 있을 때
  // 백업 시각만 바꿔도 400 으로 막히고 ② 다른 화면이 그사이 바꾼 값을 이 화면의 낡은 값으로 덮는다.
  const 바뀐것 = () => {
    if (!값) return {}
    const 처음 = { backupTime: 값.backupTime, graceMin: String(값.graceMin),
                   runGraceMin: String(값.runGraceMin), deferMaxMin: String(값.deferMaxMin) }
    return Object.fromEntries(Object.entries(입력).filter(([k, v]) => String(v).trim() !== 처음[k]))
  }

  const handleSave = async () => {
    const 보낼것 = 바뀐것()
    setError(''); set틀린칸(null); setNotice('')
    if (Object.keys(보낼것).length === 0) { setNotice('바뀐 값이 없습니다.'); return }
    setSaving(true)
    try {
      await saveWatchSettings(보낼것)
    } catch (e) {
      // 범위 밖이면 서버가 어느 칸인지와 사유를 준다. 조용히 넘기면 사람은 저장된 줄 안다.
      const field = e?.data?.field
      if (field) set틀린칸({ field, 사유: e.message })
      else setError(e?.message || '저장하지 못했습니다.')
      setSaving(false)
      return
    }
    // 저장이 확정된 칸은 **비교 기준도 곧바로 옮긴다**(Codex 재검수 2026-09-24). 아래 다시 읽기가 실패하면 기준이
    // 옛 값에 머물러, 5→7 저장 뒤 다시 5 로 되돌리는 저장을 「바뀐 값 없음」으로 버린다(서버 7, 화면 5).
    set값(p => ({ ...p, ...Object.fromEntries(Object.entries(보낼것).map(
      ([k, v]) => [k, k === 'backupTime' ? v : Number(String(v).trim())])) }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // 저장은 끝났다. 다시 읽기만 실패하면 「저장 실패」로 보이면 안 된다.
    try { 채우기(await getWatchSettings()) }
    catch { setNotice('저장했습니다. 화면의 값은 새로고침하면 맞춰집니다.') }
    setSaving(false)
  }

  const 칸그리기 = (칸) => {
    const 범위 = 값.limits?.[칸.field]
    const 틀림 = 틀린칸?.field === 칸.field
    return (
      <div key={칸.field}>
        <label htmlFor={`watch-${칸.field}`} className="block text-sm text-ds-v3-ink-2 mb-1">{칸.label}</label>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <input
            id={`watch-${칸.field}`}
            type="text" inputMode="numeric" pattern="[0-9]*"
            value={입력[칸.field] ?? ''}
            onChange={e => 고치기(칸.field, e.target.value)}
            disabled={saving}   // 저장 응답이 오면 칸을 서버 값으로 다시 채운다 — 그 사이 고친 것이 사라지지 않게 잠근다
            aria-invalid={틀림 || undefined}
            aria-describedby={`watch-${칸.field}-help${틀림 ? ` watch-${칸.field}-err` : ''}`}
            className={'input-base w-24 text-base nums' + (틀림 ? ' border-ds-v3-warn' : '')}
          />
          <span className="text-sm text-ds-v3-ink-2">분</span>
          <span className="text-[13px] text-ds-v3-ink-3 nums whitespace-nowrap">
            (기본 {값.defaults?.[칸.field]}분{범위 ? ` · ${범위.min}~${범위.max}분` : ''})
          </span>
        </div>
        {틀림 && <p id={`watch-${칸.field}-err`} role="alert" className="mt-1 text-[13px] text-ds-v3-warn">{틀린칸.사유}</p>}
        <p id={`watch-${칸.field}-help`} className="mt-1 text-[13px] text-ds-v3-ink-2">{칸.help}</p>
      </div>
    )
  }

  const 백업틀림 = 틀린칸?.field === 'backupTime'

  return (
    <div className="card-base">
      <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
        <ShieldCheck size={15} className="text-ds-v3-ink-2" />
        방송 알림 · 백업
      </h2>
      <p className="text-sm text-ds-v3-ink-2 mb-4">
        안 나간 방송·안 끝난 방송을 언제 알릴지, 겹친 예약을 얼마나 기다릴지, 매일 언제 백업할지 정합니다. 기본값 그대로 두어도 됩니다.
      </p>

      {!값 && !error && <p className="text-[13px] text-ds-v3-ink-3">지금 값을 불러오는 중입니다…</p>}

      {값 && (
        <div className="space-y-4">
          {묶음들.map((묶음, i) => (
            <div key={묶음.제목} className={'space-y-4' + (i > 0 ? ' pt-4 border-t border-ds-v3-line/50' : '')}>
              <h3 className="text-sm font-semibold text-ds-v3-ink m-0">{묶음.제목}</h3>
              {묶음.칸들.map(칸그리기)}
            </div>
          ))}

          <div className="space-y-4 pt-4 border-t border-ds-v3-line/50">
            <h3 className="text-sm font-semibold text-ds-v3-ink m-0">백업</h3>
            <div>
              <label htmlFor="watch-backupTime" className="block text-sm text-ds-v3-ink-2 mb-1">매일 백업 시각</label>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <input
                  id="watch-backupTime"
                  type="time"
                  value={입력.backupTime ?? ''}
                  onChange={e => 고치기('backupTime', e.target.value)}
                  disabled={saving}
                  aria-invalid={백업틀림 || undefined}
                  aria-describedby={`watch-backupTime-help${백업틀림 ? ' watch-backupTime-err' : ''}`}
                  className={'input-base w-40 text-base nums' + (백업틀림 ? ' border-ds-v3-warn' : '')}
                />
                <span className="text-[13px] text-ds-v3-ink-3 nums whitespace-nowrap">(기본 {값.defaults?.backupTime})</span>
              </div>
              {백업틀림 && <p id="watch-backupTime-err" role="alert" className="mt-1 text-[13px] text-ds-v3-warn">{틀린칸.사유}</p>}
              <p id="watch-backupTime-help" className="mt-1 text-[13px] text-ds-v3-ink-2">
                매일 이 시각에 예약·설정·방송 이력을 통째로 백업합니다. PC가 꺼져 있으면 건너뛰고, 다음에 서버가 켜질 때 한 번 백업합니다.
                위의 「자동 종료」로 PC를 끈다면 PC가 켜져 있는 시각으로 두세요.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-btn text-sm font-normal
                         bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                         disabled:opacity-60"
            >
              {saved
                ? <><Check size={14} /> 저장됨</>
                : saving ? '저장 중...' : '저장'}
            </button>
            {notice && <span className="text-[13px] text-ds-v3-ink-2">{notice}</span>}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-ds-v3-warn">{error}</p>}
    </div>
  )
}

export { SystemSettingsWatch }
