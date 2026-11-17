// **이 PC 에 관한 것** — 역할과 모바일 마이크(HTTPS).
//
// ── 왜 「음량 및 TTS」에서 떨어져 나왔나 (사용자 지시 2026-09-16) ────────────────
// *"모바일 마이크는 시스템 설정으로 가도되고, 이 pc의 역할은 시스템 설정으로"*
//
// 맞다. 둘 다 **소리 설정이 아니다** — 「이 PC 가 무엇인가」와 「이 PC 에 어떻게
// 접속하나」다. 소리 화면에 있으면 소리를 맞추러 온 사람이 매번 지나쳐야 하고,
// 정작 이것들을 찾는 사람은 소리 화면을 뒤질 이유가 없다.
//
// ── 「배포시에는 없애도 되」는 어떻게 했나 ──────────────────────────────────
// 사용자 말씀은 *"(근데 배포시에는 없애도 되)"* 였다. **지우지는 않았다** — 코드는 한
// 벌이라 「배포판에서만 없애기」는 갈래를 하나 더 만드는 일이고, 그 갈래는 이 저장소가
// 여러 번 데인 모양이다(`docs/PACKAGING.md` §4 — 브랜치·저장소를 가르지 않는 이유).
//
// 대신 **「자동」일 때는 조용히 둔다.** 새로 설치한 PC 는 손댈 일이 없으므로 접어 두고,
// 사람이 일부러 바꿔 둔 PC 에서만 펼쳐서 보여 준다. 없애는 것과 같은 효과를 내면서
// 필요할 때 길이 남는다.
import { useState, useEffect } from 'react'
import { Monitor, Smartphone, Lock, Check, AlertTriangle } from 'lucide-react'
import { apiGet, getPcRole, savePcRole, generateSSLCert } from '../../../lib/api'
import ConnectionGuide from '../../shared/ConnectionGuide'

export default function SystemSettingsPc() {
  const [pcRole,       setPcRole]       = useState(null)   // 서버가 준 현재 판정
  const [pcRoleSaving, setPcRoleSaving] = useState(false)
  const [pcRoleSaved,  setPcRoleSaved]  = useState(false)
  const [펼침,         set펼침]         = useState(false)

  const [httpsEnabled,  setHttpsEnabled]  = useState(false)
  const [httpsPort,     setHttpsPort]     = useState(3443)
  const [certGenerating,setCertGenerating]= useState(false)
  const [certMsg,       setCertMsg]       = useState('')
  const [certError,     setCertError]     = useState('')

  useEffect(() => {
    getPcRole().then(setPcRole).catch(() => {})
    apiGet('/api/server-info').then(d => {
      setHttpsEnabled(!!d.httpsEnabled)
      if (d.httpsPort) setHttpsPort(d.httpsPort)
    }).catch(() => {})
  }, [])

  // 역할은 **서버 재시작 후부터** 적용된다(라우트 주석 참고).
  const handleSavePcRole = async (value) => {
    setPcRoleSaving(true)
    try {
      await savePcRole(value)
      const fresh = await getPcRole()
      setPcRole(fresh)
      setPcRoleSaved(true)
    } catch (e) { console.error('[설정] PC 역할 저장 실패:', e.message) }
    setPcRoleSaving(false)
  }

  // 손대 둔 PC 에서만 펼쳐 둔다 — 「자동」이면 볼 것이 없다.
  const 손댔나 = !!pcRole && pcRole.override && pcRole.override !== 'auto'
  const 역할보임 = 펼침 || 손댔나

  return (
    <>
      <ConnectionGuide />
      {/* ── 이 PC의 역할 ─────────────────────────────────────────────────── */}
      <div className="card-base space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-label font-semibold text-ds-v3-ink flex items-center gap-2">
            <Monitor size={15} className="text-ds-v3-tts" />
            이 PC의 역할
          </h2>
          <span className="t-sub text-ds-v3-ink-2">
            지금: <b className="text-ds-v3-ink">{pcRole?.label ?? '확인 중'}</b>
          </span>
        </div>

        {!역할보임 ? (
          <p className="text-xs text-ds-v3-ink-2">
            브랜치로 알아서 판정합니다. 대개 이대로 두면 됩니다.{' '}
            <button type="button" onClick={() => set펼침(true)}
              className="font-semibold text-ds-v3-tts hover:underline">직접 정하기</button>
          </p>
        ) : (
          <>
            <p className="text-xs text-ds-v3-ink-2 leading-relaxed">
              <span className="font-semibold">현장 PC</span>는 어르신께 실제로 방송이 나가는 PC입니다.
              누가 스피커 설정을 바꿔도 케어캐스트가 2분마다 되돌려 놓습니다.<br />
              <span className="font-semibold">개발·테스트 PC</span>에서는 되돌리지 않습니다 —
              이 PC의 사운드 장치는 사람이 정한 대로 둡니다.
              (방송을 내보낼 장치를 고르는 것은 양쪽 다 그대로 됩니다.)
            </p>

            <div className="flex items-center gap-3">
              <select
                value={pcRole?.override ?? 'auto'}
                onChange={e => handleSavePcRole(e.target.value)}
                disabled={pcRoleSaving || !pcRole}
                aria-label="이 PC의 역할"
                className="input-base cursor-pointer flex-1"
              >
                <option value="auto">자동 (브랜치로 판정)</option>
                <option value="site">현장 PC</option>
                <option value="dev">개발·테스트 PC</option>
              </select>
              {pcRoleSaved && (
                <span className="text-xs text-ds-v3-tts font-semibold whitespace-nowrap flex items-center gap-1">
                  <Check size={13} /> 저장됨
                </span>
              )}
            </div>

            {pcRole && (
              <p className="text-xs text-ds-v3-ink-2">
                지금 적용 중: <span className="font-semibold text-ds-v3-ink">{pcRole.label}</span>
                {' '}({pcRole.source === '브랜치'
                  ? `브랜치 ${pcRole.branch || '알 수 없음'} 기준`
                  : '이 화면에서 지정함'})
              </p>
            )}
            {pcRoleSaved && (
              <div className="flex items-start gap-2 p-3 bg-ds-v3-ink-2/10 border border-ds-v3-ink-2/30 rounded-[10px]">
                <AlertTriangle size={14} className="text-ds-v3-ink-2 mt-0.5 shrink-0" />
                <p className="text-xs text-ds-v3-ink-2">
                  바꾼 역할은 <span className="font-semibold">서버를 다시 시작해야</span> 적용됩니다.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 모바일 마이크 (HTTPS) ────────────────────────────────────────── */}
      <div className="card-base">
        <div className="flex items-center justify-between mb-3">
          <h2 className="t-label font-semibold text-ds-v3-ink flex items-center gap-2">
            <Smartphone size={15} className="text-ds-v3-tts" />
            모바일 마이크 (HTTPS)
          </h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border
            ${httpsEnabled ? 'text-ds-v3-ink-3 bg-ds-v3-surface-2 border-ds-v3-line' : 'text-ds-v3-ink-2 bg-ds-v3-bg border-ds-v3-line'}`}>
            {httpsEnabled ? `활성화 (포트 ${httpsPort})` : '비활성화'}
          </span>
        </div>
        <p className="text-xs text-ds-v3-ink-2 mb-3 leading-relaxed">
          모바일 기기에서 마이크로 실시간 방송하려면 HTTPS가 필요합니다.<br />
          {httpsEnabled
            ? `현재 포트 ${httpsPort}에서 HTTPS가 실행 중입니다. 모바일에서 https://[서버IP]:${httpsPort} 로 접속하세요.`
            : '아래 버튼으로 자체 서명 인증서를 만든 뒤 서버를 다시 시작하세요.'}
        </p>
        {!httpsEnabled && (
          <button
            onClick={async () => {
              setCertGenerating(true); setCertMsg(''); setCertError('')
              try {
                const r = await generateSSLCert()
                setCertMsg(r.message || '인증서를 만들었습니다. 서버를 다시 시작하세요.')
              } catch (e) { setCertError(e.message || '인증서를 만들지 못했습니다.') }
              setCertGenerating(false)
            }}
            disabled={certGenerating}
            className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-normal
                       bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors disabled:opacity-60"
          >
            <Lock size={13} className={certGenerating ? 'animate-pulse' : ''} />
            {certGenerating ? '생성 중...' : '인증서 생성'}
          </button>
        )}
        {certMsg && (
          <p className="mt-3 text-xs text-ds-v3-ink-3 whitespace-pre-line leading-relaxed">{certMsg}</p>
        )}
        {certError && (
          <p className="mt-3 text-xs text-ds-v3-warn whitespace-pre-line leading-relaxed">{certError}</p>
        )}
      </div>
    </>
  )
}
