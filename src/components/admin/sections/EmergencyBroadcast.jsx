// 비상 방송 관리.
//
// ── 2026-09-16 에 셋을 고쳤다 (사용자 지시) ────────────────────────────────
// ① *"직접 입력 비상방송은 위로 올려주고"*
//    급할 때 필요한 것은 **지금 이 상황에 맞는 말**이다. 미리 적어 둔 넷은 그 다음이다.
//    맨 아래에 두면 스크롤을 내려야 하는데, 이 화면을 여는 사람은 이미 급하다.
//
// ② *"비상방송관리는 수정 편집할 수 있게 해줘야지"*
//    문안이 `src/data/presets.js` 에 박혀 있어 **개발자가 배포해야만** 고쳐졌다.
//    그런데 이 글은 그 시설의 말이다 — 대피로 이름, 집합 장소("1층 로비"), 호칭.
//    이제 화면에서 고치고 저장한다(`/api/settings/emergency-presets`).
//
// ③ 경고 배너의 SwitchBot 문구
//    *"비상 방송 실행 시 SwitchBot 전원이 자동 ON 됩니다"* 라고 단정하고 있었다.
//    코드는 실제로 `switchBotOn()` 을 부르지만, **연동할 플러그가 아직 없다**
//    (사용자 확정 2026-09-16: *"플러그 연동예정"*). 급할 때 *"전원이 켜지겠구나"* 하고
//    믿게 만드는 문구라 고친다 — **방송이 나간다는 사실만 단정한다.**
import { useState, useEffect, useCallback } from 'react'
import { Flame, UserX, AlertTriangle, Users, Radio, Pencil, Check, X, RotateCcw } from 'lucide-react'
import { emergencyPresets as 기본문안 } from '../../../data/presets'
import { ttsBroadcast, switchBotOn, getEmergencyPresets, saveEmergencyPresets } from '../../../lib/api'

const iconMap  = { Flame, UserX, AlertTriangle, Users, Radio }

const colorMap = {
  danger:  { border: '#FCA5A5', iconBg: 'bg-ds-v3-warn-bg',   icon: 'text-ds-v3-warn',  btn: 'bg-ds-v3-warn  hover:bg-ds-v3-warn'   },
  warning: { border: '#FCD34D', iconBg: 'bg-ds-v3-surface-2', icon: 'text-ds-v3-ink-2', btn: 'bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2' },
  primary: { border: '#93C5FD', iconBg: 'bg-ds-v3-tts-bg',    icon: 'text-ds-v3-tts',   btn: 'bg-ds-v3-tts hover:bg-ds-v3-ink'  },
}

// 비상 방송 실행 — 플러그 켜기를 **먼저 시도하되 기다려서 늦추지 않는다**.
//
// 예전에는 `await switchBotOn()` 이 앞에 있었다. 실패해도 방송은 나가지만, **응답이
// 느리면 그만큼 방송이 늦는다** — 외부 API 라 몇 초가 걸릴 수 있고, 그 몇 초가 비상
// 방송에서는 가장 비싼 시간이다. 이제 던져 두고 바로 방송으로 간다.
// ── **「방송 완료」라고 쓰지 않는다** (2026-09-17 브라우저 전수 시험) ─────────────────────────────
// 응답은 **스피커 대기열에 넣은 순간** 온다 — 소리가 난 뒤가 아니다. 재생이 거절돼 이력은 실패인데 화면은
// 「방송 완료」였다(비상 방송이다). 결과가 오기 전에 완료라고 적지 않는다(`chime-log-honesty` 와 같은 규칙).
const 보냄문구 = '스피커로 보냈습니다 — 소리가 안 나면 방송 로그를 확인하세요'

async function executeEmergencyBroadcast(content, setStatus) {
  setStatus('loading')
  // 결과를 안 기다린다. 실패해도 조용히 지나간다 — 조명·TV 는 방송의 조건이 아니다.
  switchBotOn().catch(() => {})
  try {
    await ttsBroadcast({ text: content, target: '전체', user: '비상방송', priority: true })
    setStatus('done')
  } catch {
    setStatus('error')
  }
}

// ── 프리셋 카드 — 보기와 고치기 두 모습 ────────────────────────────────────
function EmergencyCard({ preset, onEdit, editing, onCancel, onSave, saving }) {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [draft, setDraft] = useState(preset)
  const Icon  = iconMap[preset.icon] ?? AlertTriangle
  const color = colorMap[preset.color] ?? colorMap.danger

  // **고치기로 들어갈 때마다 지금 값에서 시작한다.** effect 로 setState 하지 않는다 —
  // `react-hooks/set-state-in-effect` 가 막고, 무엇보다 한 박자 늦게 반영돼 첫 그림이
  // 옛 값이다. 대신 부모가 `key` 에 편집 여부를 실어 **다시 마운트**시킨다.
  const handleBroadcast = () => {
    if (status === 'loading') return
    setStatus('idle')
    executeEmergencyBroadcast(preset.content, setStatus)
  }

  const 빈내용 = !String(draft.content ?? '').trim()

  return (
    <div className="card-base space-y-4" style={{ borderTop: `3px solid ${color.border}` }}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-[10px] ${color.iconBg} border border-ds-v3-line
                         flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} className={color.icon} />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              maxLength={20}
              aria-label="문안 제목"
              className="input-base py-1 text-sm font-semibold"
            />
          ) : (
            <>
              <h3 className="text-sm font-semibold text-ds-v3-ink truncate">{preset.title} 방송</h3>
              <span className={`text-[11px] font-semibold ${color.icon}`}>비상 문안</span>
            </>
          )}
        </div>
        {/* 고치기 단추는 **늘 보인다.** 마우스를 올려야 나오면 고칠 수 있다는 것도 모른다. */}
        {!editing && (
          <button onClick={onEdit} title="이 문안 고치기"
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                       text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-ds-v3-bg btn-press">
            <Pencil size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            rows={5}
            value={draft.content}
            onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            aria-label="방송 내용"
            className="input-base resize-y text-xs leading-relaxed"
          />
          <p className="text-[11px] text-ds-v3-ink-3">
            급할 때는 <b>짧을수록 빨리</b> 나갑니다. 지금 {String(draft.content ?? '').length}자.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => onSave(draft)} disabled={saving || 빈내용}
              className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                         bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors disabled:opacity-60">
              <Check size={14} /> {saving ? '저장 중...' : '저장'}
            </button>
            <button onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 rounded-btn text-sm
                         border border-ds-v3-line text-ds-v3-ink-2 hover:bg-ds-v3-bg btn-press">
              <X size={14} /> 취소
            </button>
            {빈내용 && <span className="text-[11px] text-ds-v3-warn">내용이 비면 눌러도 소리가 안 납니다</span>}
          </div>
        </>
      ) : (
        <>
          <div className="bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-3">
            <p className="text-xs text-ds-v3-ink-2 leading-relaxed">{preset.content}</p>
          </div>

          {status === 'done'  && <p className="text-xs text-ds-v3-ink-3">{보냄문구}</p>}
          {status === 'error' && <p className="text-xs text-ds-v3-warn">방송 실패 — 다시 시도해주세요</p>}

          <button
            onClick={handleBroadcast}
            disabled={status === 'loading'}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-btn
                        text-white text-sm font-semibold btn-press transition-colors disabled:opacity-70 ${color.btn}`}
          >
            {status === 'loading' ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                방송 중...
              </>
            ) : (
              <>
                <Radio size={15} />
                즉시 방송
              </>
            )}
          </button>
        </>
      )}
    </div>
  )
}

export default function EmergencyBroadcast() {
  const [customText, setCustomText] = useState('')
  const [customStatus, setCustomStatus] = useState('idle')

  // 서버가 안 뜨거나 아직 저장 전이면 **소스의 기본 문안**을 쓴다.
  // 빈 화면으로 시작하면 급할 때 읽을 것이 없다.
  const [presets, setPresets] = useState(기본문안)
  const [고치는중, set고치는중] = useState(null)   // 고치고 있는 문안의 id
  const [saving, setSaving] = useState(false)
  const [알림, set알림] = useState('')
  // 저장된 문안을 불러왔나 — '중' | '됨' | '실패'. 못 불러온 채 하나를 고쳐 저장하면 목록 전체를
  // 보내므로 시설이 고쳐 둔 다른 문안이 기본값으로 덮인다(2026-09-26 Codex 검수 High).
  // 방송은 막지 않는다 — 기본 문안이라도 급할 때 읽을 것이 있어야 한다.
  const [불러옴, set불러옴] = useState('중')

  const 불러오기 = useCallback(() => {
    getEmergencyPresets()
      .then(d => {
        if (Array.isArray(d?.presets) && d.presets.length) { setPresets(d.presets); set불러옴('됨') }
        else set불러옴('실패')
      })
      .catch(() => set불러옴('실패'))   // 기본 문안은 그대로 둔다 — 화면이 비면 안 된다
  }, [])
  useEffect(() => { 불러오기() }, [불러오기])

  const 저장 = async (바뀐것) => {
    if (불러옴 !== '됨') {
      set알림('저장된 문안을 아직 불러오지 못해 저장하지 않았습니다. 위의 「다시 불러오기」를 누른 뒤 고쳐 주세요.')
      return
    }
    setSaving(true); set알림('')
    const 새목록 = presets.map(p => (p.id === 바뀐것.id ? 바뀐것 : p))
    try {
      const r = await saveEmergencyPresets(새목록)
      setPresets(r?.presets ?? 새목록)
      set고치는중(null)
      set알림('저장했습니다.')
      setTimeout(() => set알림(''), 2500)
    } catch (e) {
      // **왜 안 됐는지 그대로 보여준다.** "저장 실패"만 띄우면 사람이 고칠 수가 없다.
      set알림(e.message || '저장하지 못했습니다.')
    }
    setSaving(false)
  }

  const 기본값으로 = async () => {
    if (!window.confirm('문안 넷을 처음 상태로 되돌릴까요? 지금 적어 둔 내용은 사라집니다.')) return
    setSaving(true); set알림('')
    try {
      const r = await saveEmergencyPresets(기본문안)
      setPresets(r?.presets ?? 기본문안)
      set불러옴('됨')   // 서버에 방금 전체를 적었으니 화면과 서버가 같다
      set고치는중(null)
      set알림('처음 상태로 되돌렸습니다.')
      setTimeout(() => set알림(''), 2500)
    } catch (e) { set알림(e.message || '되돌리지 못했습니다.') }
    setSaving(false)
  }

  const handleCustom = () => {
    if (!customText.trim() || customStatus === 'loading') return
    executeEmergencyBroadcast(customText.trim(), setCustomStatus)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-section text-ds-v3-ink">비상 방송 관리</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">급할 때 바로 내보내고, 문안은 여기서 고칩니다.</p>
      </div>

      {/* ── 경고 배너 ────────────────────────────────────────────────────────
          **단정하는 것은 사실뿐이다.** 앞 판은 *"SwitchBot 전원이 자동 ON 됩니다"* 라고
          적었는데, 연동할 플러그가 아직 없다(사용자 확정 2026-09-16). 급할 때
          "전원이 켜지겠구나" 하고 믿게 만드는 문구라 고쳤다. */}
      <div className="flex items-start gap-3 px-4 py-3 bg-ds-v3-warn-bg border border-ds-v3-line rounded-btn">
        <AlertTriangle size={15} className="text-ds-v3-warn flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ds-v3-warn font-normal leading-relaxed">
          비상 방송은 <b>나가던 소리를 끊고 가장 먼저</b> 나갑니다. 확인 절차가 없으니 눌러야 할 때만 누르세요.
          <br />
          <span className="text-ds-v3-ink-2">
            조명·TV 플러그(SwitchBot) 켜기도 함께 시도하지만, <b>아직 연결된 장치가 없어 실제로 켜지지는 않습니다.</b>
            {' '}연결되면 그때부터 함께 켜집니다.
          </span>
        </p>
      </div>

      {/* ── ① 직접 입력이 **맨 위**다 (사용자 지시 2026-09-16) ────────────────
          급할 때 필요한 것은 지금 이 상황에 맞는 말이다. 미리 적어 둔 넷은 그 다음이다. */}
      <div className="card-base space-y-3">
        <h2 className="text-sm font-semibold text-ds-v3-ink">직접 입력 비상 방송</h2>
        <p className="text-xs text-ds-v3-ink-2">지금 상황을 그대로 적어 바로 내보냅니다.</p>
        <textarea
          rows={3}
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          placeholder="예) 2층 복도에 물이 넘치고 있습니다. 직원분들은 2층으로 와 주십시오."
          className="input-base resize-none"
        />
        {customStatus === 'done'  && <p className="text-xs text-ds-v3-ink-3">{보냄문구}</p>}
        {customStatus === 'error' && <p className="text-xs text-ds-v3-warn">방송 실패 — 다시 시도해주세요</p>}
        <div className="flex justify-end">
          <button
            onClick={handleCustom}
            disabled={!customText.trim() || customStatus === 'loading'}
            className="flex items-center gap-2 px-5 py-2.5 bg-ds-v3-warn hover:bg-ds-v3-warn
                       text-white rounded-btn text-sm font-semibold btn-press transition-colors disabled:opacity-70"
          >
            {customStatus === 'loading' ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                방송 중...
              </>
            ) : (
              <>
                <Radio size={14} />
                즉시 방송
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── ② 미리 적어 둔 문안 — 고칠 수 있다 ──────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-ds-v3-ink">미리 적어 둔 문안</h2>
        <div className="flex items-center gap-3">
          {알림 && <span className="text-xs text-ds-v3-ink-2">{알림}</span>}
          <button onClick={기본값으로} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs
                       border border-ds-v3-line text-ds-v3-ink-2 hover:bg-ds-v3-bg btn-press disabled:opacity-60">
            <RotateCcw size={12} /> 처음 문안으로
          </button>
        </div>
      </div>

      {불러옴 === '실패' && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 bg-ds-v3-warn-bg border border-ds-v3-line rounded-btn">
          <p className="text-xs text-ds-v3-warn">
            저장된 문안을 불러오지 못해 <b>처음 문안</b>을 보여 드리고 있습니다. 방송은 되지만, 고쳐서 저장하려면 먼저 다시 불러와 주세요.
          </p>
          <button onClick={() => { set불러옴('중'); 불러오기() }}
            className="px-3 py-1.5 rounded-btn text-xs border border-ds-v3-line text-ds-v3-ink-2 hover:bg-ds-v3-bg btn-press">
            다시 불러오기
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4">
        {presets.map(preset => (
          <EmergencyCard
            // 편집 여부를 key 에 실어 **들어갈 때마다 지금 값에서 다시 시작**하게 한다
            // (effect 로 setState 하는 대신 — 위 카드 주석 참고).
            key={`${preset.id}:${고치는중 === preset.id}`}
            preset={preset}
            editing={고치는중 === preset.id}
            onEdit={() => set고치는중(preset.id)}
            onCancel={() => set고치는중(null)}
            onSave={저장}
            saving={saving}
          />
        ))}
      </div>
    </div>
  )
}
