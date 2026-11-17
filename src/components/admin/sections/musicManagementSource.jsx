// 음원의 출처·이용 조건 칸 (사용자 지시 2026-09-21).
//
// *"출처표기에 저작권한에 대해서도 적어서 분쟁안되게 로컬에서 등록해야한다고 적어주고"*
//
// 둘을 둔다: 올리기 전에 적는 칸(한 번 적으면 이번에 올리는 파일 전부에 들어간다)과,
// 올린 뒤 오른쪽 상세에서 고치는 칸. 무엇을 받고 막는지는 서버(server/domain/audioSource.js)가
// 정한다 — 여기서 먼저 막는 것은 **올리기 전에 알려 주려는 것**일 뿐 정본이 아니다.
import { useState, useEffect, useRef } from 'react'
import { ShieldCheck, Check, AlertCircle } from 'lucide-react'
import { PIXABAY출처, PIXABAY주소자리, Pixabay주소인가 } from '../../../lib/audioSourceForm'
import { getBgmRoles, setBgmRoleOrder } from '../../../lib/api'
import { BGM_ORDERS } from '../../../lib/bgmTypes'

const 칸들 = [
  { key: 'source_name',  label: '출처',      placeholder: '예: Pixabay, 직접 구매' },
  { key: 'source_url',   label: '출처 주소', placeholder: 'https://… (없으면 비워 두세요)' },
  { key: 'license_note', label: '이용 조건', placeholder: '예: Pixabay Content License · 출처 표시 불필요' },
]

/** 올리기 전에 적는 칸. `required` 면 배경음악이다(비우면 못 올린다). */
// compact — 업로드 화면 왼쪽 칸 아래에 **세로로 줄여** 넣는 모양(사용자 지시 2026-09-22 「픽사베이 어쩌구 있으니까
// 정신사나와, 왼쪽 폴더 아래에 축약해서 세로로」). 안내문은 한 줄로 줄이고 칸은 한 줄에 하나씩 쌓는다.
export function SourceUploadFields({ value, onChange, required, compact = false }) {
  const 바꿈 = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  const 주소칸 = useRef(null)
  const Pixabay고름 = value.source_name?.trim() === PIXABAY출처.source_name
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2 px-3 py-2.5 rounded-btn border border-ds-v3-line bg-ds-v3-surface-2'}>
      {compact ? (
        <p className="flex items-center gap-1 t-sub font-semibold text-ds-v3-ink-2">
          <ShieldCheck size={13} className="flex-shrink-0" /> 올릴 곡의 출처{required ? ' (배경음악은 필수)' : ''}
        </p>
      ) : (
      <p className="flex items-start gap-1.5 t-sub text-ds-v3-ink">
        <ShieldCheck size={14} className="flex-shrink-0 mt-0.5 text-ds-v3-ink-2" />
        <span>
          <b>저작권이 확인된 음원만 이 PC 에 직접 올려 주세요.</b>{' '}
          출처와 이용 조건을 적어 두면 나중에 「이 음악 어디서 받았나」에 답할 근거가 됩니다.
          {required ? ' 배경음악은 출처와 이용 조건을 적어야 올라갑니다.' : ' 직접 녹음한 파일이면 비워 두어도 됩니다.'}
        </span>
      </p>
      )}
      <div className={compact ? 'grid gap-1' : 'grid gap-1.5 tablet:grid-cols-3'}>
        {칸들.map(c => (
          <label key={c.key} className="space-y-0.5">
            <span className="t-sub text-ds-v3-ink-2">
              {c.label}{required && c.key !== 'source_url' ? ' *' : ''}
            </span>
            <input value={value[c.key]} onChange={바꿈(c.key)}
              placeholder={c.key === 'source_url' && Pixabay고름 ? PIXABAY주소자리 : c.placeholder}
              ref={c.key === 'source_url' ? 주소칸 : undefined}
              maxLength={300} className="input-base w-full" />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* 이미 다른 내용을 적어 두었으면 묻고 덮는다 — 말없이 덮으면 적어 둔 구매처가 사라진다.
            주소 칸은 비워 두고(곡 페이지 주소는 사람이 붙여 넣는다) 그 칸으로 커서를 옮긴다. 이미 적힌
            Pixabay 곡 주소는 남긴다. */}
        <button type="button" onClick={() => {
          const 남길주소 = Pixabay주소인가(value.source_url) ? value.source_url.trim() : ''
          const 적힌것 = 칸들.some(c => {
            const v = value[c.key]?.trim()
            if (!v) return false
            if (c.key === 'source_url') return v !== 남길주소
            return v !== PIXABAY출처[c.key]
          })
          if (적힌것 && !window.confirm('적어 둔 출처·이용 조건을 Pixabay 내용으로 바꿀까요?')) return
          onChange({ ...PIXABAY출처, source_url: 남길주소 })
          setTimeout(() => 주소칸.current?.focus(), 0)
        }}
          className="px-2.5 py-1.5 rounded-btn border border-ds-v3-line t-sub text-ds-v3-ink-2
                     hover:text-ds-v3-ink btn-press transition-colors">
          Pixabay 로 채우기
        </button>
        {!compact && <span className="t-sub text-ds-v3-ink-3">이번에 올리는 파일 전부에 같은 내용이 들어갑니다.</span>}
        {Pixabay고름 && (
          <span className="t-sub text-ds-v3-ink-3">
            Pixabay 는 예시일 뿐이며 CareCast 는 음원의 권리를 보증하지 않습니다 — 곡 페이지 주소·받은 날짜를 남기고, 방패 표시 곡은 인증서를 받아 두세요.
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 올린 뒤 상세에서 보고 고치는 칸. `onSave(값)` 은 서버에 저장하고 실패하면 던진다.
 * 부르는 쪽이 `key={file.id}` 를 준다 — 다른 파일을 고르면 새로 그려져 칸이 그 파일 값이 된다.
 */
export function SourceDetail({ file, onSave }) {
  const [값, set값] = useState(() => ({
    source_name: file.source_name ?? '', source_url: file.source_url ?? '', license_note: file.license_note ?? '',
  }))
  const [상태, set상태] = useState('')      // '' | 'saving' | 'saved' | 오류 문구

  const 저장 = async () => {
    set상태('saving')
    try { await onSave(값); set상태('saved') }
    catch (e) { set상태(e.message || '저장하지 못했습니다.') }
  }
  const 오류 = 상태 && 상태 !== 'saving' && 상태 !== 'saved'

  return (
    <div className="space-y-1.5" role="group" aria-label="출처 · 이용 조건">
      <p className="t-sub text-ds-v3-ink-2">출처 · 이용 조건</p>
      {칸들.map(c => (
        <input key={c.key} value={값[c.key]} placeholder={`${c.label} — ${c.placeholder}`} maxLength={300}
          onChange={e => { set값({ ...값, [c.key]: e.target.value }); set상태('') }}
          aria-label={c.label} className="input-base w-full" />
      ))}
      {값.source_url && /^https?:\/\//i.test(값.source_url) && (
        <a href={값.source_url} target="_blank" rel="noopener noreferrer"
          className="t-sub text-ds-v3-ink-2 underline break-all">{값.source_url}</a>
      )}
      <div className="flex items-center gap-2">
        <button onClick={저장} disabled={상태 === 'saving'}
          className="flex items-center gap-1 px-3 py-1.5 rounded-btn border border-ds-v3-line t-sub
                     text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors disabled:opacity-60">
          <Check size={13} /> {상태 === 'saving' ? '저장 중…' : '출처 저장'}
        </button>
        {상태 === 'saved' && <span className="t-sub text-ds-v3-ink-3">저장했습니다.</span>}
        {오류 && <span className="t-sub text-ds-v3-warn">{상태}</span>}
      </div>
    </div>
  )
}

/**
 * 배경음악 두 용도의 현황 — 음원 관리 BGM 자리 맨 위 (2026-09-21 화면 검수 High·QA).
 *
 * 세 가지를 **글로** 보여 준다: ① 방송용·식사용에 실제로 나가는 곡 수(꺼 둔 곡은 따로)
 * ② 어느 용도에도 안 들어가 **안 나가는 곡 수** — 맨 위에 올리고 안 옮긴 곡이 여기 걸린다
 * ③ 그 용도의 기본 차례(자동 방송이 따르는 것) — 여기서 바꾼다. 서버: GET/PUT /api/audio/bgm/roles.
 * `refreshKey` 가 바뀌면(올리기·옮기기로 목록이 바뀌면) 다시 센다.
 */
export function BgmRolePanel({ refreshKey }) {
  const [현황, set현황] = useState(null)      // null = 불러오는 중
  const [오류, set오류] = useState('')
  const [다시, set다시] = useState(0)

  useEffect(() => {
    let 끝남 = false
    getBgmRoles()
      .then(r => { if (!끝남) { set현황(r); set오류('') } })
      .catch(e => { if (!끝남) set오류(e.message || '현황을 못 불러왔습니다.') })
    return () => { 끝남 = true }
  }, [refreshKey, 다시])

  const 차례바꾸기 = async (role, order) => {
    try { await setBgmRoleOrder(role, order); set다시(n => n + 1) }
    catch (e) { set오류(e.message || '차례를 바꾸지 못했습니다.') }
  }

  if (오류) {
    return (
      <p className="flex items-center gap-1.5 t-sub text-ds-v3-warn">
        <AlertCircle size={14} /> {오류}
        <button type="button" onClick={() => set다시(n => n + 1)} className="underline">다시 시도</button>
      </p>
    )
  }
  if (!현황) return <p className="t-sub text-ds-v3-ink-3">배경음악 현황을 불러오는 중…</p>

  return (
    <div className="space-y-1.5 px-3 py-2.5 rounded-btn border border-ds-v3-line">
      {현황.roles.map(r => (
        <div key={r.role} className="flex flex-wrap items-center gap-2">
          {/* 이름은 폴더의 지금 이름 — 업로드 화면에서 바꾼다(2026-09-22). 못 찾으면 용도 이름 */}
          <span className="t-sub font-semibold text-ds-v3-ink w-24 flex-shrink-0 truncate" title={r.folderName || r.name}>{r.folderName || r.name}</span>
          <span className={`t-sub ${r.count ? 'text-ds-v3-ink-2' : 'text-ds-v3-warn'}`}>
            {r.problem ? r.problem
              : r.count ? `${r.count}곡 나감${r.offCount ? ` · 꺼 둔 곡 ${r.offCount}` : ''}`
              : r.offCount ? `곡이 모두 꺼져 있음(${r.offCount}) — 순서 편집에서 켜 주세요` : '비어 있음 — 곡을 올리거나 이 폴더로 옮겨 주세요'}
          </span>
          {!r.problem && (
            <span className="flex items-center gap-1 ml-auto" role="group" aria-label={`${r.folderName || r.name} 기본 차례`}>
              <span className="t-sub text-ds-v3-ink-3">기본 차례</span>
              {BGM_ORDERS.map(o => (
                <button key={o.id} type="button" title={o.desc} aria-pressed={r.order === o.id}
                  onClick={() => r.order !== o.id && 차례바꾸기(r.role, o.id)}
                  className={`px-2.5 py-1 rounded-full t-sub font-semibold transition-colors ${
                    r.order === o.id ? 'bg-ds-v3-ink text-white' : 'bg-ds-v3-surface-2 text-ds-v3-ink-2 hover:bg-white'}`}>
                  {o.label}
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
      {현황.outsideCount > 0 && (
        <p className="flex items-start gap-1.5 t-sub text-ds-v3-warn">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          어느 방송도 고르지 않은 폴더(또는 배경음악 맨 위)에 있는 곡 {현황.outsideCount}개는 방송에 나가지 않습니다. 예약·자동방송에서 그 폴더를 고르거나, 곡을 골라 「옮기기」로 방송이 쓰는 폴더에 넣어 주세요.
        </p>
      )}
    </div>
  )
}
