// 「고도화 제안 > 자연어 학습」 탭 — 2단계 "세어서 보여주기만 한다"
// (고도화 제안 #10, 설계는 docs/nl-learning-design.md)
//
// 이 화면은 **읽기만 한다.** 버튼으로 사전을 바꾸거나 기본값을 조정하는 길을 두지 않는다 —
// 학습 결과가 방송 동작을 조용히 바꾸는 것이 이 설계가 막으려는 실패다.
// 원문(raw_input)도 띄우지 않는다(설계 §3). 낱말과 숫자만 보여준다.
import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../../../lib/api'
import { RefreshCw, Sprout, Hourglass, AlertCircle } from 'lucide-react'

const TYPE_LABELS = {
  text: '안내 방송', chime: '차임벨', audio: '음원', video: '영상',
  bgm: 'BGM', flow: '흐름',
}
const typeLabel = (t) => TYPE_LABELS[t] ?? t

// 가로 막대 하나. 비율은 표본 대비이고, 막대는 목록 안에서 가장 큰 값을 기준으로 그린다 —
// 5%짜리들만 있는 날 막대가 전부 실선처럼 보이면 어느 쪽이 더 잦은지 못 읽는다.
function Bar({ ratio }) {
  return (
    <div className="h-1.5 bg-ds-v3-bg rounded-full overflow-hidden">
      <div className="h-full bg-ds-v3-tts/70 rounded-full"
        style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <div className="border border-ds-v3-line rounded-card p-4">
      <h3 className="text-sm font-semibold text-ds-v3-ink mb-0.5">{title}</h3>
      <p className="text-[11px] text-ds-v3-ink-2 mb-3">{hint}</p>
      {children}
    </div>
  )
}

const Empty = ({ children }) => <p className="text-xs text-ds-v3-ink-2 py-1">{children}</p>

export default function NlLearningCard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    apiGet('/api/dev/nl-stats')
      .then(d => { setStats(d); setError(null) })
      .catch(e => setError(e?.message ?? '통계를 읽지 못했습니다.'))
  }, [])
  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-ds-v3-ink-2 border border-ds-v3-line rounded-card p-4">
        <AlertCircle size={14} className="text-ds-v3-ink-2" /> {error}
      </div>
    )
  }
  if (!stats) return <p className="text-sm text-ds-v3-ink-2">불러오는 중…</p>

  const maxField = Math.max(1, ...(stats.fieldEdits ?? []).map(f => f.count))
  const maxWord  = Math.max(1, ...(stats.unknownWords ?? []).map(w => w.count))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Sprout size={16} className="text-ds-v3-tts mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-ds-v3-ink font-normal">자연어 예약을 사람이 어떻게 고쳤나</p>
          <p className="text-[11px] text-ds-v3-ink-2 mt-0.5">
            승인 화면에서 사람이 고친 값만 셉니다. <b>세기만 하고 아무것도 바꾸지 않습니다</b> —
            사전(어휘)·기본값 수정은 사람이 확인한 뒤 손으로 합니다.
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press px-2 py-1 rounded-btn shrink-0">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {!stats.enough ? (
        <div className="border border-ds-v3-line rounded-card p-5 text-center">
          <Hourglass size={18} className="text-ds-v3-ink-2 mx-auto mb-2" />
          <p className="text-sm font-normal text-ds-v3-ink">아직 판단할 만큼 안 쌓였습니다</p>
          <p className="text-xs text-ds-v3-ink-2 mt-1">
            표본 <b className="text-ds-v3-ink">{stats.samples}건</b> / 최소 {stats.minSamples}건
          </p>
          <p className="text-[11px] text-ds-v3-ink-2 mt-3 leading-relaxed">
            표본은 <b>자연어로 만든 초안을 승인한 건</b>입니다(거절은 셈에서 뺍니다 — 왜 거절했는지
            모르면 잘못 읽은 것인지 마음이 바뀐 것인지 구분할 수 없습니다).<br />
            몇 건으로 규칙을 만들면 그게 곧 오작동이라, 최소 건수까지는 아무 말도 하지 않습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-ds-v3-ink-2">
            표본 <b className="text-ds-v3-ink">{stats.samples}건</b> (승인된 자연어 예약)
          </p>

          <Section title="어디를 자꾸 고치나" hint="사람이 승인하며 고친 항목 — 분모는 표본 전체">
            {stats.fieldEdits.length === 0 ? <Empty>고친 항목이 없습니다.</Empty> : (
              <ul className="space-y-2">
                {stats.fieldEdits.map(f => (
                  <li key={f.field}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="text-ds-v3-ink">{f.label}</span>
                      <span className="text-ds-v3-ink-2">{f.count}건 · {f.rate}%</span>
                    </div>
                    <Bar ratio={f.count / maxField} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="오전 · 오후 오독"
            hint="시각이 정확히 12시간 어긋나게 고쳐진 건 — 확인 카드 기본값을 조정할 근거">
            <p className="text-sm text-ds-v3-ink">
              <b>{stats.ampm.count}건</b>
              <span className="text-ds-v3-ink-2 text-xs"> · 표본의 {stats.ampm.rate}%
                (시각을 고친 건은 모두 {stats.ampm.timeEdits}건)</span>
            </p>
          </Section>

          <Section title="방송 유형 오독" hint="AI가 읽은 유형 → 사람이 고른 유형. 되묻기 문구를 고칠 근거">
            {stats.typeMisreads.length === 0 ? <Empty>유형을 고친 건이 없습니다.</Empty> : (
              <ul className="space-y-1.5">
                {stats.typeMisreads.map(m => (
                  <li key={`${m.from}-${m.to}`} className="flex items-baseline justify-between text-xs">
                    <span className="text-ds-v3-ink">
                      {typeLabel(m.from)} <span className="text-ds-v3-ink-2">→</span> {typeLabel(m.to)}
                    </span>
                    <span className="text-ds-v3-ink-2">{m.count}건</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="사전에 없는 낱말"
            hint="두 번 이상 나온 말만. '유형도 고침'이 함께 높으면 사전에 넣을 값어치가 있습니다">
            {stats.unknownWords.length === 0 ? <Empty>후보가 없습니다.</Empty> : (
              <ul className="space-y-2">
                {stats.unknownWords.map(w => (
                  <li key={w.word}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="text-ds-v3-ink">{w.word}</span>
                      <span className="text-ds-v3-ink-2">
                        {w.count}건{w.withTypeEdit > 0 && ` · 유형도 고침 ${w.withTypeEdit}건`}
                      </span>
                    </div>
                    <Bar ratio={w.count / maxWord} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}
