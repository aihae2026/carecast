import { useState, useEffect } from 'react'
import { Monitor, Wifi, Headphones, Mic, GitCommit } from 'lucide-react'
import { apiGet } from '../../lib/api'
import { buildStatusCards } from '../../lib/systemStatus'
import HelpTip from '../shared/HelpTip'
// 창 여는 규칙은 한 곳이다 — 주소·크기·창 이름을 여기 다시 적지 않는다(`lib/monitorWindow.js`).
import MonitorOpenButton from '../home/MonitorOpenButton'

const statusIcons = { pc: Monitor, net: Wifi, audio: Headphones, mic: Mic }
const statusDot   = { online: 'bg-ds-v3-ink-3', warning: 'bg-ds-v3-ink-2', offline: 'bg-ds-v3-warn' }

function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${h}:${min}`
}

// 우측 컴팩트 카드: 방송 장치 상태 4개 + 업데이트 정보
export default function SystemStatusCompact() {
  // 서버 응답 전에는 실측값이 없으므로 '확인 불가'(회색)로 시작 — 가짜 값을 먼저 보여주지 않는다
  const [cards,      setCards]      = useState(() => buildStatusCards(null))
  const [gitInfo,    setGitInfo]    = useState(null)
  const [autoStatus, setAutoStatus] = useState(null)
  // 팝업이 막혔나 — 막힌 것을 안 알리면 "눌렀는데 안 열린다"만 남는다.

  useEffect(() => {
    apiGet('/api/status')
      .then(data => setCards(buildStatusCards(data)))
      .catch(() => {})

    // 설치판(`gitRepo:false`)은 **예전처럼 이 칸을 안 띄운다** — 서버가 이제 설치판에도 판 번호를 주는데
    // (2026-09-18), 여기엔 제목·빌드 시각·자동 업데이트 줄이 없어 속이 빈 칸이 됐다(독립 검수 지적).
    // 설치판의 판 정보는 설정 → 업데이트 카드가 보여 준다.
    apiGet('/api/update/info')
      .then(data => { if (data.commit && data.gitRepo !== false) setGitInfo(data) })
      .catch(() => {})

    apiGet('/api/update/auto-status')
      .then(data => setAutoStatus(data))
      .catch(() => {})
  }, [])

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ds-v3-ink">시스템 상태</h3>
          <HelpTip id="systemStatus" />
        <span className="flex items-center gap-1.5 text-xs text-ds-v3-ink-2">
          <span className="w-1.5 h-1.5 rounded-full bg-ds-v3-ink-3 animate-pulse" />
          실시간
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(s => {
          const Icon = statusIcons[s.id]
          return (
            <div
              key={s.id}
              className="flex items-center gap-2 bg-ds-v3-bg rounded-btn px-2.5 py-2.5 border border-ds-v3-line"
            >
              <Icon size={15} className="text-ds-v3-ink-2 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ds-v3-ink-2 leading-none mb-0.5">{s.name}</p>
                <p className="text-sm font-semibold text-ds-v3-ink truncate">{s.value}</p>
              </div>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot[s.status] ?? 'bg-ds-v3-line'}`} />
            </div>
          )
        })}
      </div>

      {/* 모니터링 창 — **단추는 `MonitorOpenButton` 한 곳에서 만든다**(2026-09-14).
          여기와 간편모음 맨 위 두 자리가 같은 부품을 쓴다. 사본을 두면 팝업 차단 안내가
          한쪽에만 붙거나 문구가 갈린다. */}
      <MonitorOpenButton />

      {/* 업데이트 정보 */}
      {gitInfo && (
        <div className="mt-2.5 pt-2.5 border-t border-ds-v3-line/50">
          <div className="flex items-center gap-1.5 mb-1">
            <GitCommit size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
            <span className="text-xs font-semibold text-ds-v3-ink-2">업데이트 정보</span>
            {gitInfo.buildAt && (
              <span className="ml-auto text-xs text-ds-v3-tts font-semibold">
                {fmtDateTime(gitInfo.buildAt)} 빌드
              </span>
            )}
          </div>
          <p className="text-xs text-ds-v3-ink font-normal truncate leading-snug">{gitInfo.subject}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-ds-v3-ink-2 font-mono">{gitInfo.commit}</span>
            <span className="text-xs text-ds-v3-ink-2">·</span>
            <span className="text-xs text-ds-v3-ink-2">{gitInfo.date}</span>
          </div>
          {/* 자동 업데이트 상태 */}
          {autoStatus && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${autoStatus.lastError ? 'bg-ds-v3-warn' : 'bg-ds-v3-ink-3'}`} />
              <span className="text-xs text-ds-v3-ink-2 truncate">
                {autoStatus.lastError
                  ? `자동업데이트 오류: ${autoStatus.lastError.slice(0, 60)}`
                  : autoStatus.lastCheck
                    ? `자동확인: ${fmtDateTime(autoStatus.lastCheck)}`
                    : '자동업데이트 대기 중'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
