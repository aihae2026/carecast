// BGM 을 「어느 폴더」에서 가져올지, 「어떤 차례로」 틀지 — 두 물음을 두 줄로 묻는다.
//
// 「랜덤」·「차례로」를 폴더 이름에 붙이지 않고 따로 묻는 이유(사용자 지적 2026-09-13): 붙이면
// 폴더가 늘 때마다 칩이 곱절로 불어난다.
//
// 2026-09-22: 폴더를 **아래로 펼치는 목록**으로 고른다(사용자 지시 *「아래로 떨어지는 토글이 낫지 않나?」*).
// 폴더는 기본 두 개(방송용·식사용) 말고도 사람이 업로드 화면에서 만든 것이 늘어난다 — 칩이면 가로로 불어난다.
// 목록의 이름은 **서버에서 읽은 지금 이름**이다(업로드 화면에서 이름을 바꾸면 여기도 바뀐다). 저장값은
// 번호로 잇는다 — 규칙은 `src/lib/bgmTypes.js` 가 혼자 안다. 이 파일은 그리기만 한다.
//
// 자동방송 단계 편집기(StepList)도 같은 목록 부품(`BgmFolderSelect`)을 쓴다 — 두 벌이면 한쪽 이름만 바뀐다.
// 차례 칩의 생김새는 화면마다 다르므로(흐름 편집기는 장미색 알약, 예약 모달은 네모 버튼) 밖에서 받는다.
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { BGM_ORDERS, BGM_LOCAL, bgmSourceOf, bgmOrderOf, bgmTypeFrom, sourceOfFolder, folderOfSource, 곡하나인가, songOfSource } from '../../lib/bgmTypes'
import { useBgmFolders, bgmUploadPathFor } from '../../lib/bgmFolders'

// 폴더 경로 이름 — 하위 폴더는 「가요 › 옛날」로 적는다(같은 이름이 두 군데 있어도 갈린다).
function 경로이름(folder, 모두) {
  const 이름들 = [folder.name]
  let p = folder.parent_id, 깊이 = 0
  while (p != null && 깊이++ < 10) {
    const 위 = 모두.find(f => f.id === p)
    if (!위) break
    이름들.unshift(위.name); p = 위.parent_id
  }
  return 이름들.join(' › ')
}
const 곡수글 = (f) => (f.count ? `${f.count}곡` : f.offCount ? '곡이 모두 꺼짐' : '비어 있음')
const 막기 = (e) => e.stopPropagation()

/**
 * BGM 폴더 하나를 고르는 목록.
 * @param {string|null} source  고른 갈래(`local_broadcast` · `local_meal` · `local_f12`), 안 골랐으면 null
 * @param {(source: string|null) => void} onSource
 * @param {string|((기본이름: string) => string)} [noneLabel] 주면 「안 고름」 칸을 맨 위에 둔다(자동방송 단계 — 방송 종류로 정해짐)
 * @param {'broadcast'|'meal'} [defaultRole] 이 화면의 기본 폴더(「· 기본」 표시, 대신 트는 곳 안내)
 */
export function BgmFolderSelect({ source, onSource, noneLabel, defaultRole = 'broadcast', labelClass = 't-sub text-ds-v3-ink-2' }) {
  const id = useId()
  const { folders, songs, state, reload } = useBgmFolders()
  // 폴더째 / 곡 하나 (사용자 지시 2026-09-22 「폴더별로도 할 수 있지만 개별적 파일로도」)
  const 곡모드 = 곡하나인가(source)
  const 고른곡 = 곡모드 ? songOfSource(source, songs) : null
  const 곡없어짐 = Boolean(곡모드 && songs && !고른곡)
  const 폴더이름 = (fid) => (folders || []).find(f => f.id === fid)?.name || '폴더 밖'
  const 곡묶음 = (() => {
    const m = new Map()
    for (const s of songs || []) { const k = 폴더이름(s.folder_id); if (!m.has(k)) m.set(k, []); m.get(k).push(s) }
    return [...m.entries()]
  })()
  const 목록 = folders || []
  const 용도폴더 = BGM_LOCAL.map(s => 목록.find(f => f.role === s.role)).filter(Boolean)
  const 만든폴더 = 목록.filter(f => !f.role)
  const 기본폴더 = 목록.find(f => f.role === defaultRole)
  const 기본이름 = 기본폴더?.name || BGM_LOCAL.find(s => s.role === defaultRole)?.label
  const 고른폴더 = source ? folderOfSource(source, folders) : null
  const 사람폴더 = Boolean(source && /^local_f/.test(source))
  // 사람이 만든 폴더가 목록에 없으면 지워진 것이다(서버가 기본 폴더로 대신 튼다). 기본 폴더가 없으면 대신 틀 곳이 없다.
  const 없어짐 = Boolean(사람폴더 && folders && !고른폴더)
  // 곡 하나(`local_a…`)는 폴더가 아니다 — 폴더 경고를 띄우면 「「」 폴더를 찾지 못했습니다」가 뜬다(사용자 화면 2026-09-22)
  const 기본없음 = Boolean(source && !사람폴더 && !곡모드 && folders && !고른폴더)
  // 곡 하나 — 그 곡이 든 폴더 경로만 한 줄로 알린다(사용자 지시 2026-09-22 「소속 폴더 경로만 알려주면」)
  const 곡폴더 = 고른곡?.folder_id != null ? 목록.find(f => f.id === 고른곡.folder_id) : null
  const 곡경로 = 고른곡 ? (곡폴더 ? 경로이름(곡폴더, 목록) : '배경음악 (폴더 밖)') : ''
  // 「업로드에서 폴더 보기」 — 곡 하나면 그 곡이 든 폴더로
  const 보기폴더 = 곡모드 ? (고른곡?.folder_id ?? null) : 고른폴더?.id

  const 항목 = (f) => (
    <option key={f.id} value={sourceOfFolder(f)}>
      {경로이름(f, 목록)} · {곡수글(f)}{f.role === defaultRole ? ' · 이 방송 기본' : ''}
    </option>
  )

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <label htmlFor={id} className={labelClass}>{곡모드 ? 'BGM 곡' : 'BGM 폴더'}</label>
        <Link target="_blank" rel="noopener" to={bgmUploadPathFor(보기폴더)} onClick={막기} className="t-sub text-ds-v3-bgm underline-offset-2 hover:underline">
          업로드에서 폴더 보기 →
        </Link>
      </div>

      {/* 폴더째(랜덤·차례로) / 곡 하나 — 곡 하나는 늘 그 곡만 튼다 */}
      <div className="flex gap-1.5" role="radiogroup" aria-label="BGM 고르는 방법">
        {[['folder', '폴더째'], ['song', '곡 하나']].map(([k, 글]) => {
          const 켬 = k === 'song' ? 곡모드 : !곡모드
          return (
            <button key={k} type="button" role="radio" aria-checked={켬}
              onClick={(e) => {
                막기(e)
                if (켬) return
                if (k === 'song') { const 첫곡 = (songs || [])[0]; if (첫곡) onSource(`local_a${첫곡.id}`) }
                else onSource(BGM_LOCAL.find(s => s.role === defaultRole)?.id || BGM_LOCAL[0].id)
              }}
              disabled={k === 'song' && !(songs || []).length}
              className={`px-3 min-h-[36px] rounded-full t-sub font-semibold border transition-colors disabled:opacity-40 ${
                켬 ? 'bg-ds-v3-bgm text-white border-ds-v3-bgm' : 'bg-white text-ds-v3-ink-2 border-ds-v3-line hover:border-ds-v3-bgm'}`}>
              {글}
            </button>
          )
        })}
      </div>

      {곡모드 && folders ? (
        <select id={id} className="input-base cursor-pointer w-full min-h-[44px]"
          value={source ?? ''} onClick={막기} onPointerDown={막기} onDragStart={막기}
          onChange={(e) => onSource(e.target.value || null)}>
          {곡없어짐 && <option value={source}>(없어진 곡)</option>}
          {곡묶음.map(([폴더, 곡들]) => (
            <optgroup key={폴더} label={폴더}>
              {곡들.map(s => <option key={s.id} value={`local_a${s.id}`}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      ) : state === 'error' && !folders ? (
        <p role="alert" className="t-sub text-ds-v3-warn">
          BGM 폴더 목록을 불러오지 못했습니다. 저장된 선택은 그대로 둡니다.{' '}
          <button type="button" onClick={(e) => { 막기(e); reload() }}
            className="underline font-semibold min-h-[44px] px-1">다시 불러오기</button>
        </p>
      ) : (
        <select id={id} className="input-base cursor-pointer w-full min-h-[44px]"
          value={source ?? ''} disabled={!folders}
          onClick={막기} onPointerDown={막기} onDragStart={막기}
          onChange={(e) => onSource(e.target.value || null)}>
          {!folders && <option value={source ?? ''}>폴더 목록을 불러오는 중…</option>}
          {folders && noneLabel && <option value="">{typeof noneLabel === 'function' ? noneLabel(기본이름) : noneLabel}</option>}
          {folders && 없어짐 && <option value={source}>(없어진 폴더)</option>}
          {folders && <optgroup label="처음부터 있는 폴더">{용도폴더.map(항목)}</optgroup>}
          {folders && 만든폴더.length > 0 && <optgroup label="만든 폴더">{만든폴더.map(항목)}</optgroup>}
        </select>
      )}

      {/* 고른 폴더가 못 쓰는 상태면 **고른 자리에서** 글로 알린다 — 목록 글자만으로는 지나치기 쉽다.
          문구는 서버 동작 그대로다(server/services/localBgm.js 방송BGM고르기): 사람이 만든 폴더는 기본 폴더로
          대신 나가고 경보가 뜬다, 기본 폴더가 비면 배경음악 없이 나간다. */}
      {곡모드 && 곡경로 && <p className="t-sub text-ds-v3-ink-2">📁 {곡경로}</p>}
      {곡없어짐 && (
        <p className="t-sub text-ds-v3-warn">⚠ 고른 곡이 없어져 「{기본이름}」(기본) 폴더 곡으로 대신 나갑니다. 다른 곡을 골라 주세요.</p>
      )}
      {없어짐 && (
        <p className="t-sub text-ds-v3-warn">⚠ 선택한 폴더가 없어져 「{기본이름}」(기본)으로 대신 나갑니다. 다른 폴더를 골라 주세요.</p>
      )}
      {기본없음 && (
        <p className="t-sub text-ds-v3-warn">⚠ 「{BGM_LOCAL.find(s => s.id === source)?.label}」 폴더를 찾지 못했습니다 — 배경음악 없이 안내만 나갑니다. 관리자에게 알려 주세요.</p>
      )}
      {고른폴더 && !고른폴더.count && (
        <p className="t-sub text-ds-v3-warn">
          ⚠ 「{고른폴더.name}」 폴더에 나갈 곡이 없습니다 —{' '}
          {사람폴더 ? `방송 때는 「${기본이름}」으로 대신 나가고 경보가 뜹니다.` : '이대로 두면 배경음악 없이 안내만 나갑니다.'}{' '}
          <Link target="_blank" rel="noopener" to={bgmUploadPathFor(고른폴더.id)} onClick={막기} className="underline font-semibold">곡 넣으러 가기</Link>
        </p>
      )}
    </div>
  )
}

export default function BgmSourcePicker({
  value,                    // 저장된 bgm_type
  onChange,                 // (새 bgm_type) => void
  chipClass,                // (고름:boolean) => string — 차례 칩
  labelClass = 't-sub text-ds-v3-ink-2',
  defaultRole = 'broadcast',
}) {
  const 지금출처 = bgmSourceOf(value)
  const 지금차례 = bgmOrderOf(value)

  return (
    <div className="space-y-2">
      <BgmFolderSelect source={지금출처} defaultRole={defaultRole} labelClass={labelClass}
        onSource={(s) => onChange(bgmTypeFrom(s, 지금차례))} />
      {/* 곡 하나에는 차례가 없다 — 칩을 보이지 않는다 */}
      {!곡하나인가(지금출처) && <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`${labelClass} flex-shrink-0`}>차례</span>
        {BGM_ORDERS.map(o => (
          <button key={o.id} type="button" title={o.desc} aria-pressed={지금차례 === o.id}
            onClick={(e) => { 막기(e); onChange(bgmTypeFrom(지금출처, o.id)) }}
            onDragStart={막기}
            className={`min-h-[44px] ${chipClass(지금차례 === o.id)}`}>
            {o.label}
          </button>
        ))}
      </div>}
    </div>
  )
}
