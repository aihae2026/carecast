import { useState, useEffect, Fragment } from 'react'
import { statusOf } from '../../../lib/broadcastStatus'
import { Search, Filter, Download, RefreshCw, Trash2, CalendarDays, Archive, ChevronRight, ChevronDown } from 'lucide-react'
import { TypeBadge, StatusBadge } from '../../shared/Badge'
import {
  getBroadcastLogs, purgeBroadcastLogsBefore, getBroadcastRetention, broadcastCsvUrl,
  getBroadcastSteps,
} from '../../../lib/api'

// 이력에 실제로 적히는 낱말과 맞춘다 — 빠진 것은 걸러도 안 나온다.
// 2026-09-10: 'BGM'(BGM 단독 재생)·'마이크'·'예약'·'특보'·'경보'가 빠져 있었다.
// '즉시'·'즐겨찾기'는 지금 쓰이지 않지만 옛 행이 남아 있어 그대로 둔다.
// ── 거르는 칸은 **통계와 같은 다섯**이다 (사용자 지적 2026-09-13) ────────────────
// *"통계는 즉시방송·TTS·BGM·자동방송·오류 다섯인데 필터는 뭔 놈의 게 저렇게 많아"* — 맞다.
// 칩이 열셋이었고, 그중 셋('즉시'·'즐겨찾기'·'AI')은 **아무도 이력에 안 적는 낱말**이라
// 눌러도 늘 0건이었다. 나머지도 통계와 축이 달라서, 칩으로 거른 수와 위 통계 수가
// 서로 안 맞았다 — 같은 화면에서 두 가지로 세고 있었다.
//
// 이제 **묶음 이름**을 보낸다. 어떤 낱말이 어느 묶음에 드는지는 서버의
// `domain/broadcastRecord.js` `종류칸` 하나가 정하고, **통계도 그것을 본다.**
// 여기에 낱말을 다시 적지 않는다 — 적는 순간 또 갈린다.
//
// 「오류」는 종류가 아니라 **결과**라 여기 없다. 바로 옆 「실패만」이 그 자리다 —
// 한 줄에 두 축을 섞으면 "오류이면서 TTS"를 어떻게 고르는지 물어야 한다.
const types = [
  { id: '전체',    label: '전체'     },
  { id: 'instant', label: '즉시방송' },
  { id: 'tts',     label: 'TTS'      },
  { id: 'bgm',     label: 'BGM'      },
  { id: 'auto',    label: '자동방송' },
]

// 한국 공휴일 (2024-2027) — YYYY-MM-DD
const KR_HOLIDAYS = new Set([
  // 2024
  '2024-01-01','2024-02-09','2024-02-10','2024-02-11','2024-02-12',
  '2024-03-01','2024-04-10','2024-05-05','2024-05-15','2024-06-06',
  '2024-08-15','2024-09-16','2024-09-17','2024-09-18',
  '2024-10-03','2024-10-09','2024-12-25',
  // 2025
  '2025-01-01','2025-01-28','2025-01-29','2025-01-30',
  '2025-03-01','2025-05-05','2025-05-06','2025-06-06',
  '2025-08-15','2025-10-03','2025-10-05','2025-10-06','2025-10-07','2025-10-08','2025-10-09',
  '2025-12-25',
  // 2026
  '2026-01-01','2026-02-16','2026-02-17','2026-02-18',
  '2026-03-01','2026-03-02','2026-05-05','2026-05-24','2026-05-25','2026-06-06',
  '2026-08-15','2026-09-24','2026-09-25','2026-09-26',
  '2026-10-03','2026-10-05','2026-10-09',
  '2026-12-25',
  // 2027
  '2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09',
  '2027-03-01','2027-05-05','2027-06-06',
  '2027-08-15','2027-08-16','2027-10-03','2027-10-04','2027-10-09',
  '2027-12-25',
])

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function getDateInfo(dateStr) {
  if (!dateStr) return null
  const d   = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const dayName = DAY_NAMES[day]
  const isHoliday  = KR_HOLIDAYS.has(dateStr)
  const isSunday   = day === 0
  const isSaturday = day === 6
  let color = 'text-ds-v3-ink-2'
  if (isHoliday || isSunday) color = 'text-ds-v3-warn'
  else if (isSaturday)       color = 'text-ds-v3-tts'
  const mm = dateStr.slice(5, 7)
  const dd = dateStr.slice(8, 10)
  return { label: `${mm}/${dd} (${dayName})`, color }
}

function normalize(rows) {
  return rows.map(r => ({
    id:      r.id,
    date:    r.date || null,
    time:    r.time,
    content: r.content,
    type:    r.type,
    user:    r.user || '방송담당',
    status:  statusOf(r.success),
    // 발사에서 소리 지시까지 걸린 시간. 이력의 시각은 **발사 시각**이라, 이 값이 없으면
    // "정시에 나갔나"를 사람 귀로만 알 수 있다(docs/db-retention-design.md 6번 갈래).
    prepMs:  Number.isFinite(r.prep_ms) ? r.prep_ms : null,
    // 이 줄의 단계 기록을 찾을 열쇠(0022). 없으면(수동 기록·경보) 펼칠 것이 없다.
    runKey:  r.run_key || null,
  }))
}

// 기본 조회 범위 — 최근 30일. 보관이 1년이라 전부 받으면 화면이 무거워지고,
// 정작 사람이 묻는 것은 대개 "요즘"이다. 옛것은 날짜를 넣어 찾는다.
// ISO 시각(UTC 포함)을 이 PC 시각 'YYYY-MM-DD HH:MM' 으로. 못 읽으면 받은 글자 그대로.
function 지역시각(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function daysAgoStr(n) {
  const d = new Date(Date.now() - n * 86400000)
  const p = v => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function BroadcastLog() {
  const [logs,       setLogs]       = useState([])
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('전체')
  const [from,       setFrom]       = useState(daysAgoStr(30))
  const [to,         setTo]         = useState(daysAgoStr(0))
  const [successFilter, setSuccessFilter] = useState('')   // '' 전체 · '1' 성공 · '0' 실패
  const [loading,    setLoading]    = useState(false)
  const [retention,  setRetention]  = useState(null)
  const [openSteps,  setOpenSteps]  = useState({})   // { [runKey]: 단계 배열 | 'loading' }

  // 서버에 넘기는 조건 — 화면 목록과 CSV가 **같은 것**을 본다
  const query = { from, to, type: typeFilter === '전체' ? '' : typeFilter,
    success: successFilter, limit: 2000 }

  const fetchLogs = () => {
    setLoading(true)
    getBroadcastLogs(query)
      .then(data => setLogs(normalize(data)))
      .catch(() => {})
      .finally(() => setLoading(false))
    getBroadcastRetention().then(setRetention).catch(() => {})
  }

  // 이력 한 줄을 펼쳐 그 방송의 단계를 본다(0021·0022). 한 번 받아 온 것은 다시 안 받는다.
  const toggleSteps = async (runKey) => {
    if (openSteps[runKey]) { setOpenSteps(p => ({ ...p, [runKey]: null })); return }
    setOpenSteps(p => ({ ...p, [runKey]: 'loading' }))
    try {
      const d = await getBroadcastSteps(runKey)
      setOpenSteps(p => ({ ...p, [runKey]: d.items || [] }))
    } catch {
      setOpenSteps(p => ({ ...p, [runKey]: [] }))
    }
  }

  // 전체 삭제를 없애고 **기준 날짜 이전만** 지운다. 지운 기준·건수는 서버가 남긴다.
  const handlePurge = async () => {
    const suggested = daysAgoStr(365)
    const before = prompt(
      '어느 날짜 이전 기록을 지울까요? (YYYY-MM-DD) — 그 날짜 당일 기록은 남고, 되돌릴 수 없습니다.',
      suggested)
    if (!before) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) { alert('YYYY-MM-DD 모양으로 넣어주세요.'); return }
    if (!confirm(`${before} 이전 기록을 지웁니다. 계속할까요?`)) return
    try {
      const r = await purgeBroadcastLogsBefore(before)
      alert(`${r.removed}건을 지웠습니다.`)
      fetchLogs()
    } catch (err) {
      alert(err.message)
    }
  }

  useEffect(() => { fetchLogs() }, [from, to, typeFilter, successFilter])   // eslint-disable-line react-hooks/exhaustive-deps

  // 남은 것은 글자 검색뿐 — 날짜·유형·결과는 서버가 이미 걸렀다
  const filtered = logs.filter(log =>
    log.content.includes(search) || (log.user || '').includes(search))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-section text-ds-v3-ink">방송 로그</h1>
          <p className="t-sub text-ds-v3-ink-2 mt-1">실행된 모든 방송 기록입니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchLogs} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-ds-v3-line
                       rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors
                       disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로 고침
          </button>
          {/* 지금 걸러 놓은 조건 그대로 파일 하나로 — 심사·감사 때 기간을 통째로 낸다.
              서버가 Content-Disposition으로 내려주므로 링크 하나면 브라우저가 받는다. */}
          <a href={broadcastCsvUrl(query)} download
            className="flex items-center gap-2 px-4 py-2 bg-white border border-ds-v3-line
                       rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
            <Download size={14} /> CSV 내보내기
          </a>
          <button onClick={handlePurge}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-ds-v3-line
                       rounded-btn text-sm text-ds-v3-warn hover:bg-ds-v3-warn-bg btn-press transition-colors">
            <Trash2 size={14} /> 오래된 기록 정리
          </button>
        </div>
      </div>

      {/* 기간 — 서버가 거른다. 기본 최근 30일이고, 옛것은 날짜를 바꿔 찾는다 */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <CalendarDays size={14} className="text-ds-v3-ink-2 flex-shrink-0" />
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
          className="input-base w-auto py-1.5" />
        <span className="text-ds-v3-ink-2">~</span>
        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
          className="input-base w-auto py-1.5" />
        {[['최근 7일', 7], ['30일', 30], ['1년', 365]].map(([label, n]) => (
          <button key={n} onClick={() => { setFrom(daysAgoStr(n)); setTo(daysAgoStr(0)) }}
            className="px-2.5 py-1.5 rounded-btn text-xs border border-ds-v3-line bg-white
                       text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
            {label}
          </button>
        ))}
        <span className="w-px h-5 bg-ds-v3-line mx-1" />
        {[['전체', ''], ['성공만', '1'], ['실패만', '0']].map(([label, v]) => (
          <button key={label} onClick={() => setSuccessFilter(v)}
            className={`px-2.5 py-1.5 rounded-btn text-xs font-normal btn-press transition-colors ${
              successFilter === v ? 'bg-ds-v3-ink text-white'
                : 'bg-white border border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 검색 + 필터 */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-v3-ink-2" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="내용 또는 담당자 검색..."
            className="input-base pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={14} className="text-ds-v3-ink-2 flex-shrink-0" />
          {types.map(t => (
            <button key={t.id} onClick={() => setTypeFilter(t.id)}
              className={`min-h-[32px] rounded-btn px-3 t-sub font-normal btn-press transition-colors ${
                typeFilter === t.id
                  ? 'bg-ds-v3-ink text-white'
                  : 'bg-white border border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      <div className="card-base overflow-hidden p-0">
        {/* 표만 제 안에서 옆으로 민다. 여섯 열의 고정 폭 합계가 이미 폰 폭(375)을 넘는데,
            카드의 `overflow-hidden`은 모서리를 다듬을 뿐이라 넘친 담당자·상태 열이
            **잘려서 볼 방법이 없었다**(2026-09-04). 감싸개를 하나 더 두면 본문은 안 밀리고
            표만 밀린다 — 카드의 둥근 모서리도 그대로 살아 있다. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ds-v3-bg border-b border-ds-v3-line">
            <tr className="text-left text-xs text-ds-v3-ink-2">
              <th className="px-4 py-3.5 font-semibold w-28">일자</th>
              <th className="px-4 py-3.5 font-semibold w-16">시간</th>
              <th className="px-4 py-3.5 font-semibold">방송 내용</th>
              <th className="px-4 py-3.5 font-semibold w-24">종류</th>
              <th className="px-4 py-3.5 font-semibold w-24">담당자</th>
              <th className="px-4 py-3.5 font-semibold w-20">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((log, idx) => {
              const dateInfo = getDateInfo(log.date)
              const 펼침 = log.runKey ? openSteps[log.runKey] : null
              return (
                <Fragment key={log.id}>
                <tr
                  className={`border-b border-ds-v3-line hover:bg-ds-v3-bg transition-colors ${
                    idx % 2 === 1 ? 'bg-ds-v3-bg' : 'bg-white'
                  }`}>
                  <td className={`px-4 py-3 nums text-xs font-normal ${dateInfo ? dateInfo.color : 'text-ds-v3-ink-2'}`}>
                    {dateInfo ? dateInfo.label : '—'}
                  </td>
                  <td className="px-4 py-3 nums text-ds-v3-ink-2 text-xs">
                    {/* 단계 기록이 있는 줄만 펼칠 수 있다 — 경보·수동 기록에는 단계가 없다 */}
                    {log.runKey && (
                      <button onClick={() => toggleSteps(log.runKey)}
                        title="단계별로 보기" aria-label="단계별로 보기"
                        className="mr-1 align-middle inline-flex items-center justify-center w-6 h-6 -my-1.5 text-ds-v3-ink-2 hover:text-ds-v3-tts">
                        {openSteps[log.runKey] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    )}
                    {log.time}
                    {/* 1초를 넘겨 밀린 것만 표시한다 — 늘 붙어 있으면 아무도 안 본다 */}
                    {log.prepMs != null && log.prepMs >= 1000 && (
                      <span className={`ml-1 ${log.prepMs >= 5000 ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink-2'}`}
                        title="발사에서 소리 지시까지 걸린 시간">
                        +{(log.prepMs / 1000).toFixed(0)}초
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ds-v3-ink">{log.content}</td>
                  <td className="px-4 py-3"><TypeBadge type={log.type} /></td>
                  <td className="px-4 py-3 text-ds-v3-ink-2 text-xs">{log.user}</td>
                  <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                </tr>
                {/* ── 펼친 단계는 **그 줄 바로 아래**다 (현장 지적 2026-09-15) ──────────
                    예전엔 이 블록이 표의 `filtered.map` **다음에 따로** 한 번 더 돌았다.
                    그래서 펼친 줄이 어디에 있든 단계는 **표 맨 아래**에 붙었다 — 위쪽 줄을
                    누르면 화살표만 바뀌고 내용은 수십 줄 밑에 나타나서, 쓰는 사람에게는
                    **"눌러도 아무 반응이 없다"** 로 보였다. 바로 위 주석이
                    *"위 행 바로 아래에 붙는다"* 라고 적고 있었는데 코드는 그렇지 않았다.
                    한 `map` 안에서 `Fragment` 로 두 줄을 내보내면 자리가 어긋날 수 없다. */}
                {펼침 && (
                <tr className="bg-ds-v3-bg/60 border-b border-ds-v3-line">
                <td colSpan={6} className="px-8 py-3">
                  {펼침 === 'loading' ? (
                    <span className="text-xs text-ds-v3-ink-2">단계를 불러오는 중…</span>
                  ) : 펼침.length === 0 ? (
                    <span className="text-xs text-ds-v3-ink-2">
                      이 방송의 단계 기록이 없습니다(기록을 넣기 전 방송이거나, 단계가 없는 방송입니다).
                    </span>
                  ) : (
                    <ol className="space-y-1">
                      {펼침.map(st => (
                        <li key={st.id} className="flex items-center gap-2 text-xs">
                          <span className="w-5 text-ds-v3-ink-2 nums">{st.step_no}.</span>
                          <span className="text-ds-v3-ink">{st.label}</span>
                          <span className={st.result === '실패' ? 'text-ds-v3-warn font-semibold' : 'text-ds-v3-ink-3'}>
                            {st.result}
                          </span>
                          {Number.isFinite(st.ms) && (
                            <span className="text-ds-v3-ink-2 nums">{(st.ms / 1000).toFixed(1)}초</span>
                          )}
                          {st.detail && <span className="text-ds-v3-ink-2 italic">— {st.detail}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </td>
                </tr>
                )}
                </Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-ds-v3-ink-2">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="px-5 py-3 bg-ds-v3-bg border-t border-ds-v3-line text-xs text-ds-v3-ink-2">
          총 <span className="text-ds-v3-ink font-semibold nums">{filtered.length}</span>건
          <span className="text-ds-v3-ink-2"> · {from} ~ {to}</span>
        </div>
      </div>

      {/* **지웠다는 사실**도 보여준다 — 사라진 기록이 정리인지 사고인지 구분할 수 있어야 한다
          (docs/db-retention-design.md). 서버가 남긴 것을 그대로 읽는다. */}
      {retention && (
        <div className="card-base">
          <div className="flex items-center gap-2 mb-2">
            <Archive size={14} className="text-ds-v3-ink-2" />
            <h2 className="text-sm font-semibold text-ds-v3-ink">보관 기록</h2>
            <span className="text-xs text-ds-v3-ink-2">
              방송 {retention.policy?.ops}일 · 경보 {retention.policy?.alert}일 뒤 자동 정리
            </span>
          </div>
          <p className="text-xs text-ds-v3-ink-2">
            {retention.at
              // 서버는 `toISOString()`(UTC) 으로 적는다 — 글자를 잘라 쓰면 **9시간 이른 시각**이 보였다
              // (2026-09-17 브라우저 전수 시험: 02:40 에 돈 정리가 「09-16 17:40」). 이 PC 시각으로 바꿔 보인다.
              ? <>마지막 자동 정리 <b className="text-ds-v3-ink">{지역시각(retention.at)}</b>
                  {' — '}방송 {retention.summary?.ops ?? 0}건 · 경보 {retention.summary?.alert ?? 0}건 ·
                  점검 {retention.summary?.checkin ?? 0}건</>
              : '아직 자동 정리가 돈 적이 없습니다.'}
          </p>
          {retention.manual?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {retention.manual.slice(0, 5).map((m, i) => (
                <li key={i} className="text-xs text-ds-v3-ink-2">
                  · 사람이 지움 — <b className="text-ds-v3-ink">{m.before} 이전 {m.removed}건</b>
                  <span className="text-ds-v3-ink-2"> ({지역시각(m.at)})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
