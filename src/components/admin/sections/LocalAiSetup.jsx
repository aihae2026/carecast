// 로컬 AI 진단 — 이 PC 에서 1차(브라우저 내장 모델)를 쓸 수 있는가.
//
// **이 화면이 없어도 방송은 100% 정상이다.** 방송 실행 경로는 LLM 을 안 쓰고, 문구 생성·
// 자연어 파싱은 사람이 누를 때만 돈다. 로컬이 안 되면 조용히 2차 API 로 간다.
// 그래서 여기서 나오는 "못 씁니다"는 **경고가 아니라 정보**다 — 붉게 칠하지 않는다.
//
// **켜지는 조건이 둘이고 둘 다 필요하다.**
//   허용 = 사람이 이 화면의 토글을 켠 것 (서버 설정 `local_ai_enabled`, 모든 PC 공통)
//   가능 = 이 브라우저에 모델이 실제로 있는가 (localStorage 진단, PC 마다 다르다)
// 하나로 합치면 둘 중 하나가 반드시 틀린다 — 서버 설정만이면 사양 다른 PC 에서 매번 실패하고,
// 진단만이면 사람이 승인한 적 없는데 모델이 돈다.
//
// **방송용 PC(pcRole=site)에는 아예 띄우지 않는다.** 4GB 내려받기 버튼을 현장 PC 화면에
// 두면 누군가 누른다. 판단은 새 설정을 만들지 않고 이미 있는 `pcRole` 을 쓴다
// (server/services/pcRole.js 머리말 3번).
import { useState, useEffect } from 'react'
import { Cpu, Download, RefreshCw, Copy, Check } from 'lucide-react'
import { Badge } from '../../shared/Badge'
import { getPcRole, getLocalAiEnabled, saveLocalAiEnabled } from '../../../lib/api'
import {
  availability, downloadModel, probeUnavailableReason, saveDiagnosis, loadDiagnosis,
  outputLanguageSupported,
  lastFailure, clearFailures, localGivenUp, _resetWarmup, FAIL_LIMIT,
  AVAILABILITY_LABEL, REQUIREMENTS, FLAG_URLS, INTERNALS_URL, COMPONENTS_URL,
} from '../../../lib/localModel'

const BADGE = {
  available:    'success',
  downloading:  'primary',
  downloadable: 'primary',
  unavailable:  'default',
  unsupported:  'default',
}

function CopyRow({ text }) {
  const [복사됨, set복사됨] = useState(false)
  const 복사 = async () => {
    // 클립보드는 권한이 막힐 수 있다. 실패해도 주소는 화면에 그대로 보이므로
    // 사람이 손으로 옮겨 적을 수 있다 — 여기서 오류를 띄우지 않는다.
    try {
      await navigator.clipboard.writeText(text)
      set복사됨(true)
      setTimeout(() => set복사됨(false), 2000)
    } catch { /* 주소는 화면에 보인다 */ }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-ds-v3-bg px-2 py-1 text-xs text-ds-v3-ink">{text}</code>
      <button onClick={복사} className="rounded border border-ds-v3-line p-1 min-w-[24px] min-h-[24px] inline-flex items-center justify-center text-ds-v3-ink-2 hover:bg-ds-v3-bg"
              title="주소 복사">
        {복사됨 ? <Check size={13} className="text-ds-v3-ink-3" /> : <Copy size={13} />}
      </button>
    </div>
  )
}

// 크롬이 모델을 못 띄우는 흔한 원인과 처방. 요건 목록만 보여 주면 사람은 자기 PC 사양을
// 의심하며 시간을 버린다 — 실제로 이 PC 가 요건을 다 만족하는데도 안 됐다(2026-09-06).
function 켜는법() {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ds-v3-ink">
        ① 아래 두 주소를 차례로 열어 <span className="font-normal">Enabled</span> 로 바꾸고 크롬을 다시 시작합니다.
      </p>
      {FLAG_URLS.map(u => <CopyRow key={u} text={u} />)}
      <p className="text-xs text-ds-v3-ink">
        ② 그다음 아래를 열어 <span className="font-normal">Optimization Guide On Device Model</span> 의
        버전이 <code className="rounded bg-ds-v3-bg px-1">0.0.0.0</code> 이면 "업데이트 확인"을 눌러 내려받습니다.
      </p>
      <CopyRow text={COMPONENTS_URL} />
      <p className="text-xs text-ds-v3-ink-2">그래도 안 되면 아래에서 자세한 원인을 볼 수 있습니다.</p>
      <CopyRow text={INTERNALS_URL} />
    </div>
  )
}

export default function LocalAiSetup() {
  const [role,     setRole]     = useState(null)   // 서버가 준 pcRole 판정
  // 저장된 진단은 **첫 렌더에서 바로 읽는다.** effect 에서 읽어 setState 하면 렌더가 한 번 더 돈다.
  const [상태,     set상태]     = useState(() => loadDiagnosis()?.status || null)
  // 이 모델이 한국어를 낼 수 있나. **쓸 수 있음과 별개 조건**이다 — 크롬 152 는 모델이
  // 준비돼 있어도 한국어를 지원 언어로 치지 않는다(2026-09-06 실측).
  const [한국어,   set한국어]   = useState(() => loadDiagnosis()?.ko ?? null)
  const [허용,     set허용]     = useState(false)  // 서버 설정 — 사람이 켠 것
  // 대시보드의 "AI 방송 도우미" 스위치. 이게 꺼져 있으면 로컬을 켜 둬도 안 돈다 —
  // 체크는 그대로 두고 왜 안 도는지를 밝힌다. 안 그러면 "켰는데 왜 안 되냐"가 된다.
  const [AI기능,   setAI기능]   = useState(true)
  const [사유,     set사유]     = useState('')     // 왜 못 쓰는지(크롬이 준 문장 그대로)
  const [진단중,   set진단중]   = useState(false)
  const [내려받는중, set내려받는중] = useState(false)
  const [진행률,   set진행률]   = useState(0)
  const [실패사유, set실패사유] = useState('')
  // 실제로 문구를 만들려다 로컬이 실패한 기록. **이걸 화면에 보여 주지 않으면 사람은
  // 콘솔을 열어야 이유를 안다** — 실제로 그래서 원인을 못 찾았다(2026-09-06).
  const [실패기록, set실패기록] = useState(() => lastFailure())

  useEffect(() => {
    // 역할을 못 읽으면 **현장으로 본다** — pcRole.js 의 "모르면 현장" 규칙과 같은 방향이다.
    // 모르는데 내려받기 버튼을 띄우는 쪽이 나쁘다.
    getPcRole().then(d => setRole(d?.role || 'site')).catch(() => setRole('site'))
    getLocalAiEnabled().then(d => {
      // 체크 표시는 **사람이 켠 것**(localAllowed)을 그대로 비춘다. enabled 는 "지금 실제로
      // 도는가"라서, AI 기능이 꺼지면 사람이 켠 적 없는 것처럼 보인다.
      set허용(!!(d?.localAllowed ?? d?.enabled))
      setAI기능(d?.aiFeature !== false)
    }).catch(() => {})
  }, [])

  // 화면에 들어오면 **한 번은 저절로 살펴본다.** 사람이 "진단하기"를 눌러야만 알 수 있으면
  // 대부분은 안 누르고, 로컬 경로가 있는지조차 모른 채 지나간다. 읽기만 하는 조회라
  // 내려받기 같은 부작용이 없다(`downloadable` 이어도 여기서는 받지 않는다).
  // 살펴보고 저장하는 일은 세 곳(자동·다시진단·내려받기 뒤)에서 필요하다.
  // **한 곳에만 둔다** — 사본을 두면 한쪽만 고쳐지고, 그때 화면과 실제 판정이 갈린다.
  const 살펴보기 = async () => {
    const v = await availability()
    // 한국어 지원은 **쓸 수 있음과 별개 조건**이다. 함께 저장해야 1차 판정이 이걸 본다.
    const ko = v === 'unavailable' || v === 'unsupported' ? false : await outputLanguageSupported()
    set상태(v); set한국어(ko)
    saveDiagnosis({ status: v, ko })
    // `downloadable` 일 때는 캐묻지 않는다 — create() 가 4GB 내려받기를 시작한다
    if (v === 'unavailable') set사유(await probeUnavailableReason())
    return v
  }

  useEffect(() => {
    if (role !== 'dev' || 상태) return
    // 첫 렌더에서 곧바로 상태를 바꾸지 않는다(연쇄 렌더). 다음 차례로 미룬다.
    Promise.resolve().then(() => 살펴보기()).catch(() => {})
  }, [role, 상태])

  const 진단 = async () => {
    set진단중(true); set실패사유(''); set사유('')
    // **"다시 진단"이 포기 상태를 푸는 유일한 자리다.** 안 그러면 원인을 고쳐도
    // 이 브라우저는 영영 로컬을 안 쓴다.
    clearFailures(); _resetWarmup(); set실패기록(null)
    await 살펴보기()
    set진단중(false)
  }

  const 토글 = async () => {
    const 다음 = !허용
    set허용(다음)
    try { await saveLocalAiEnabled(다음) } catch { set허용(!다음) }
  }

  const 내려받기 = async () => {
    set내려받는중(true); set진행률(0); set실패사유('')
    const r = await downloadModel((ratio) => set진행률(Math.round(ratio * 100)))
    if (!r.ok) set실패사유(r.reason)
    await 살펴보기()
    set내려받는중(false)
  }

  if (role === null) return null   // 역할을 읽기 전에는 아무것도 안 띄운다

  // ── 방송용 PC — 띄우지 않는다 ────────────────────────────────
  if (role === 'site') {
    return (
      <div className="card-base space-y-2">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-ds-v3-ink-2" />
          <h2 className="t-label font-semibold text-ds-v3-ink">로컬 AI</h2>
          <Badge variant="default">방송용 PC — 사용 안 함</Badge>
        </div>
        <p className="text-xs text-ds-v3-ink-2">
          이 PC 는 방송용으로 판정되어 로컬 AI 진단을 띄우지 않습니다. AI 기능은 외부 API 로
          정상 동작합니다. 판정을 바꾸려면 <span className="font-normal">시스템 설정 → 오디오 → 이 PC 의 역할</span>에서 변경하세요.
        </p>
      </div>
    )
  }

  // **모델이 준비된 것과 쓸 만한 것은 다르다.** 크롬 152 는 모델이 available 이어도
  // 한국어를 지원 언어로 치지 않아, 방송문 자리에 마크다운 제목이 나온다(2026-09-06 실측).
  const 한국어안됨 = 상태 === 'available' && 한국어 === false
  const 쓸수있음   = 상태 === 'available' && 한국어 === true
  const 도는중     = 허용 && 쓸수있음 && AI기능

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-ds-v3-ink-2" />
        <h2 className="t-label font-semibold text-ds-v3-ink">로컬 AI 진단</h2>
        {상태 && (
          <Badge variant={한국어안됨 ? 'warning' : (BADGE[상태] ?? 'default')}>
            {한국어안됨 ? '한국어 미지원' : AVAILABILITY_LABEL[상태]}
          </Badge>
        )}
        {도는중 && <Badge variant="success">1차로 사용 중</Badge>}
        <div className="flex-1" />
        <button onClick={진단} disabled={진단중 || 내려받는중}
                className="flex items-center gap-1 rounded border border-ds-v3-line px-2 py-1 text-xs text-ds-v3-ink-2 hover:bg-ds-v3-bg disabled:opacity-50">
          <RefreshCw size={12} className={진단중 ? 'animate-spin' : ''} />
          {상태 ? '다시 진단' : '진단하기'}
        </button>
      </div>

      <p className="text-xs text-ds-v3-ink-2">
        인터넷이나 API 키 없이 이 PC 안에서 문구를 만듭니다. <span className="font-normal">쓸 수 없어도 문제가 아닙니다</span> —
        그럴 때는 외부 API 로, API 도 안 되면 정해진 틀로 자동으로 넘어갑니다.
        방송이 나가는 것 자체에는 영향이 없습니다.
      </p>

      {/* 허용 토글 — 쓸 수 있다고 진단된 뒤에만 의미가 있다. 켜는 것은 언제나 사람이 한다. */}
      <label className={`flex items-center gap-2 text-xs ${쓸수있음 ? 'text-ds-v3-ink' : 'text-ds-v3-ink-2'}`}>
        <input type="checkbox" checked={허용} onChange={토글} disabled={!쓸수있음}
               className="h-4 w-4 accent-ds-v3-tts disabled:opacity-40" />
        <span>
          이 시스템에서 로컬 AI 를 <span className="font-normal">1차로 사용</span>합니다
          {!쓸수있음 && (
            <span className="text-ds-v3-ink-2">
              {한국어안됨 ? ' — 한국어가 지원되면 켤 수 있습니다' : ' — 쓸 수 있다고 진단되면 켤 수 있습니다'}
            </span>
          )}
        </span>
      </label>

      {/* 여기가 이 카드에서 제일 중요한 안내다. 모델이 "준비 완료"로 보이기 때문에,
          말해 주지 않으면 켰다가 방송문 자리에 마크다운이 나오는 것을 사람이 겪는다. */}
      {한국어안됨 && (
        <div className="space-y-1 rounded-md border border-ds-v3-line bg-ds-v3-surface-2 p-3">
          <p className="text-xs text-ds-v3-ink">
            모델은 준비됐지만 <span className="font-semibold">이 크롬은 한국어 출력을 지원하지 않습니다.</span>
            {' '}억지로 쓰면 방송문 자리에 <code className="rounded bg-white px-1">## 제목</code>이나
            {' '}<code className="rounded bg-white px-1">YYYY년</code> 같은 것이 섞여 나옵니다 —
            그대로 읽히면 어르신께 그 글자가 그대로 나갑니다.
          </p>
          <p className="text-xs text-ds-v3-ink-2">
            지금은 <span className="font-normal">외부 AI</span>가 문구를 만듭니다. 크롬이 한국어를 지원하면
            {' '}<span className="font-normal">&quot;다시 진단&quot;</span>만 누르면 저절로 켜집니다 —
            지원 언어 목록을 코드에 박아 두지 않았습니다.
          </p>
        </div>
      )}

      {/* 실제로 써 보다 실패한 기록. 진단은 "쓸 수 있다"고 하는데 정작 안 될 때가 있고,
          그 이유는 여기 말고는 브라우저 콘솔에만 남는다. */}
      {실패기록 && (
        <div className="space-y-1 rounded-md border border-ds-v3-line bg-ds-v3-surface-2 p-3">
          <p className="text-xs text-ds-v3-ink">
            마지막으로 문구를 만들 때 로컬이 실패했습니다
            {실패기록.count > 1 && <> (연속 {실패기록.count}회)</>} — <span className="font-normal">{실패기록.reason}</span>
          </p>
          {localGivenUp() && (
            <p className="text-xs text-ds-v3-ink-2">
              {FAIL_LIMIT}회 연속이라 지금은 <span className="font-normal">로컬을 건너뛰고 외부 AI 로</span> 바로 갑니다 —
              기다리는 시간을 줄이기 위해서입니다. 원인을 고치셨으면 위 <span className="font-normal">&quot;다시 진단&quot;</span>을 눌러 주세요.
            </p>
          )}
        </div>
      )}

      {/* 켜 뒀는데 안 도는 경우가 딱 하나 있다. 그것을 말해 주지 않으면 원인을 못 찾는다. */}
      {허용 && 쓸수있음 && !AI기능 && (
        <p className="text-xs text-ds-v3-ink-2">
          지금은 돌지 않습니다 — 대시보드의 <span className="font-semibold">&quot;기능 활성화 → AI 방송 도우미&quot;</span>가 꺼져 있습니다.
        </p>
      )}

      {상태 === 'downloadable' && (
        <div className="space-y-2">
          <p className="text-xs text-ds-v3-ink">
            이 PC 는 로컬 AI 를 쓸 수 있습니다. 처음 한 번 <span className="font-normal">약 4GB</span> 를 내려받아야 합니다.
          </p>
          <button onClick={내려받기} disabled={내려받는중}
                  className="flex items-center gap-1.5 rounded-md bg-ds-v3-ink px-3 py-1.5 text-xs font-normal text-white disabled:opacity-50">
            <Download size={13} />
            {내려받는중 ? `내려받는 중… ${진행률}%` : '로컬 AI 내려받기 (약 4GB)'}
          </button>
        </div>
      )}

      {(상태 === 'downloading' || 내려받는중) && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-ds-v3-bg">
          <div className="h-full bg-ds-v3-tts transition-all" style={{ width: `${진행률}%` }} />
        </div>
      )}

      {실패사유 && <p className="text-xs text-ds-v3-ink-2">내려받기가 끝나지 못했습니다: {실패사유}</p>}

      {상태 === 'unsupported' && (
        <div className="space-y-2 rounded-md border border-ds-v3-line bg-ds-v3-surface-2 p-3">
          <p className="text-xs text-ds-v3-ink">
            이 브라우저에 로컬 AI 경로가 없습니다. 크롬 138 이상이어야 하고,
            <span className="font-normal"> 프로그램이 대신 켤 수 없어</span> 아래를 직접 열어 주셔야 합니다.
          </p>
          {켜는법()}
        </div>
      )}

      {상태 === 'unavailable' && (
        <div className="space-y-2 rounded-md border border-ds-v3-line bg-ds-v3-bg p-3">
          <p className="text-xs text-ds-v3-ink">
            지금은 이 PC 에서 로컬 AI 가 안 켜집니다.
            {사유 && <span className="text-ds-v3-ink-2"> (크롬이 알려 준 이유: {사유})</span>}
          </p>
          {/* 사양 부족보다 **구성요소 미설치**가 훨씬 흔하다. 그래서 처방을 먼저 보여 준다. */}
          {켜는법()}
          <details className="text-xs text-ds-v3-ink-2">
            <summary className="cursor-pointer">PC 사양 요건 보기</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {REQUIREMENTS.map(r => <li key={r}>{r}</li>)}
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}
