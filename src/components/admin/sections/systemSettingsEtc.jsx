// 시스템 설정 '기타' 아코디언의 알맹이 — 소프트웨어 업데이트(수동 실행·진행 로그·자동
// 업데이트 내역)와 준비 중인 알림·보안 카드.
//
// **부모가 이 컴포넌트를 항상 렌더한다 — 그룹이 닫혀 있어도.** 아래 초기 로드 effect가
// 화면이 열리는 순간 한 번 돌아야 커밋 정보와 자동 업데이트 내역이 이미 채워진 채로
// 펼쳐진다. 닫힌 그룹을 마운트하지 않도록 되돌리면 펼치는 순간 빈 카드가 잠깐 보인다.
// server/test/system-settings-eager-load.test.js가 고정한다.

import { useState, useEffect, useRef } from 'react'
import { RefreshCw, GitCommit, History } from 'lucide-react'
import { apiGet, getUpdateInfo, getUpdateStatus, startUpdate } from '../../../lib/api'

function SystemSettingsEtc() {
  const [commitInfo,    setCommitInfo]    = useState(null)
  const [autoStatus,    setAutoStatus]    = useState(null)
  const [updateRunning, setUpdateRunning] = useState(false)
  const [updateLog,     setUpdateLog]     = useState([])
  const [updateDone,    setUpdateDone]    = useState(false)
  const [updateError,   setUpdateError]   = useState(null)
  const pollRef = useRef(null)
  const logEndRef = useRef(null)

  // ── P-70: 3초 뒤 무조건 새로고침하지 않는다 ──────────────────────────
  // 예전엔 `done` 을 받는 순간 `setTimeout(reload, 3000)` 이었다. 그런데 빌드가 끝난 것과
  // **서버가 재시작한 것은 다르다** — 실제 재시작은 `restartWhenIdle()` 이 방송이 끝날
  // 때까지 기다린다(`routes/update.js`). 마이크나 서버 스피커가 오래 켜져 있으면 화면만
  // 새로고침돼 "완료"로 보이고 **프로세스는 여전히 옛 코드**다.
  //
  // 그래서 **서버가 실제로 내려갔다 올라오는 것을 본다.** 한 번 실패한 뒤 다시 성공하면
  // 그때가 재시작이 끝난 순간이다. 그 전까지는 "재시작을 기다리는 중"이라고 정직하게 적는다.
  const 재시작감시 = () => {
    clearInterval(pollRef.current)
    let 끊긴적 = false
    pollRef.current = setInterval(async () => {
      try {
        await getUpdateStatus()
        if (끊긴적) { clearInterval(pollRef.current); window.location.reload() }
      } catch { 끊긴적 = true }   // 서버가 내려갔다 — 다음 성공이 재시작 완료다
    }, 1000)
  }

  const pollStatus = () => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await getUpdateStatus()
        setUpdateLog(s.log ?? [])
        if (s.done) {
          setUpdateDone(true)
          // **running 을 안 푼다.** 서버도 재시작이 끝날 때까지 안 푼다(P-72).
          // 여기서 풀면 버튼이 열려 "이미 업데이트 중입니다"라는 거짓 문구를 만난다.
          재시작감시()
        } else if (!s.running && s.error) {
          setUpdateError(s.error)
          setUpdateRunning(false)
          clearInterval(pollRef.current)
        }
      } catch (e) { console.error('[설정] 업데이트 진행 조회 실패:', e.message) }  // 다음 1초 뒤 폴링이 다시 시도한다
    }, 1000)
  }

  useEffect(() => {
    getUpdateInfo().then(setCommitInfo).catch(() => {})
    apiGet('/api/update/auto-status').then(setAutoStatus).catch(() => {})
    // ── P-82: 새로 뜬 화면도 "재시작 대기 중"을 안다 ────────────────────
    // 예전엔 마운트 때 `/api/update/status` 를 안 봤다. 그래서 새로고침된 화면은
    // **버튼이 눌리는 모양이고 로그창이 비어 있었다.** 누르면 "이미 업데이트 중입니다"가
    // 뜨는데, 진실은 "업데이트는 끝났고 재시작을 기다리는 중"이다 — 문구가 사실과 달랐다.
    getUpdateStatus().then((s) => {
      if (!s || !s.running) return
      setUpdateLog(s.log ?? [])
      setUpdateRunning(true)
      if (s.done) { setUpdateDone(true); 재시작감시() } else pollStatus()
    }).catch(() => {})
    return () => clearInterval(pollRef.current)   // P-87: 떠날 때 폴링을 걷는다
    // 마운트 때 **한 번만** 돌아야 한다 — 의존성에 pollStatus 를 넣으면 매 렌더마다
    // 다시 붙어 폴링이 겹친다. 두 함수는 ref 만 만지고 상태를 안 닫는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [updateLog])

  const handleUpdate = async () => {
    if (updateRunning) return
    setUpdateRunning(true)
    setUpdateLog([])
    setUpdateDone(false)
    setUpdateError(null)
    try {
      const res = await startUpdate()
      if (!res.ok) { setUpdateError(res.msg); setUpdateRunning(false); return }
      pollStatus()
    } catch (e) {
      setUpdateError(e.message)
      setUpdateRunning(false)
    }
  }

  // ── **설치판은 새 설치 파일로 업데이트한다** (사용자 지적 2026-09-18) ──────────────────────────
  // 설치판에는 `git pull` 할 저장소가 없어 아래 「지금 업데이트」 단추는 실패만 한다. 서버가 `gitRepo:false` 를
  // 알려 주면 단추·자동 업데이트 내역 대신 **README 「업데이트」와 같은 문구**로 방법을 보여 준다(두 곳의 말이 갈리지 않게).
  // `gitRepo` 를 **모를 때(아직 못 읽음)는 예전 화면**이다 — 소스로 깐 현장 PC 의 단추를 잘못 감추지 않는다.
  if (commitInfo?.gitRepo === false) {
    return (
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <RefreshCw size={15} className="text-ds-v3-ink-2" />
          업데이트
        </h2>
        {/* 말투: 「깐 판」이 아니라 「설치했습니다」·「버전」(사용자 지적 — 「깔면」은 너무 구어체, 2026-09-18 디자인 검수 1·2).
            글자는 13px 밑으로 안 내린다(G-8) — 옆 카드의 text-xs(12px)를 새로 들이지 않는다. */}
        <p className="text-sm text-ds-v3-ink-2 mb-3">
          이 PC는 <b className="text-ds-v3-ink">설치 파일로 설치</b>했습니다. 새 버전이 나오면 설치 파일을 다시 실행해 업데이트합니다.
          설치 중에는 방송이 멈추므로 <b className="text-ds-v3-ink">자동방송 시각을 피해서</b> 하세요.
        </p>
        {commitInfo.commit && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-ds-v3-bg rounded-[10px] border border-ds-v3-line text-[13px] text-ds-v3-ink-2">
            <span>지금 버전</span>
            {commitInfo.date && <span className="nums">{commitInfo.date}</span>}
            <span className="nums text-ds-v3-ink-3">({commitInfo.commit})</span>
          </div>
        )}
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-ds-v3-ink-2">
          <li>설치해 준 담당자에게 새 <b className="text-ds-v3-ink">CareCast-Setup.exe</b>를 받습니다.</li>
          <li>실행한 뒤 <b className="text-ds-v3-ink">「기록을 그대로 두고 설치」</b>를 고릅니다 — 예약·이력·설정이 그대로 남습니다.</li>
          <li>설치가 끝나면 방송 화면이 다시 열렸는지 봅니다. 안 열렸으면 바탕화면의 <b className="text-ds-v3-ink">CareCast AI</b> 아이콘을 누릅니다.</li>
        </ol>
      </div>
    )
  }

  return (
    <>
      {/* 소프트웨어 업데이트 */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <RefreshCw size={15} className="text-ds-v3-ink-2" />
          소프트웨어 업데이트
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          개발자가 새 버전을 GitHub에 올리면 버튼 한 번으로 자동 업데이트됩니다.
        </p>

        {commitInfo?.commit && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-ds-v3-bg rounded-[10px] border border-ds-v3-line">
            <GitCommit size={13} className="text-ds-v3-ink-2 shrink-0" />
            <span className="text-xs text-ds-v3-ink-2 nums">{commitInfo.commit}</span>
            <span className="text-xs text-ds-v3-ink-2 truncate">{commitInfo.subject}</span>
            <span className="text-xs text-ds-v3-ink-2 ml-auto shrink-0">{commitInfo.date}</span>
          </div>
        )}

        <button
          onClick={handleUpdate}
          disabled={updateRunning || updateDone}
          className="flex items-center gap-2 px-5 py-2.5 rounded-btn text-sm font-normal
                     bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                     disabled:opacity-60"
        >
          <RefreshCw size={14} className={updateRunning ? 'animate-spin' : ''} />
          {updateDone ? '완료 — 재시작을 기다리는 중' : updateRunning ? '업데이트 중...' : '지금 업데이트'}
        </button>

        {(updateLog.length > 0 || updateError) && (
          <div className="mt-3 bg-ds-v3-ink-3 rounded-[10px] p-3 max-h-48 overflow-y-auto font-mono text-xs text-ds-v3-line-2">
            {updateLog.map((line, i) => (
              <div key={i} className="leading-relaxed">{line}</div>
            ))}
            {updateError && <div className="text-ds-v3-warn mt-1">❌ {updateError}</div>}
            {updateDone && (
              <div className="text-ds-v3-ink-3 mt-1">
                업데이트는 끝났습니다. 방송이 없을 때 서버가 재시작되고, 그때 이 화면이 저절로 새로고침됩니다.
                {/* P-70·P-82: "3초 후" 라고 적던 자리다. 빌드가 끝난 것과 서버가 재시작한 것은 다르다 — */}
                {/* 마이크·스피커가 켜져 있으면 재시작은 그만큼 미뤄진다. 시간을 약속하지 않는다. */}
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        )}

        {/* 자동 업데이트 내역 */}
        {autoStatus && (
          <div className="mt-4 pt-4 border-t border-ds-v3-line/50">
            <div className="flex items-center gap-2 mb-2">
              <History size={13} className="text-ds-v3-ink-2" />
              <span className="text-xs font-semibold text-ds-v3-ink-2">자동 업데이트 내역</span>
              <span className={`ml-auto flex items-center gap-1 text-[11px] font-normal
                ${autoStatus.lastError ? 'text-ds-v3-warn' : 'text-ds-v3-ink-3'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${autoStatus.lastError ? 'bg-ds-v3-warn' : 'bg-ds-v3-ink-3'}`} />
                {autoStatus.lastError ? '오류' : '정상'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-ds-v3-bg rounded-[8px] px-3 py-2 border border-ds-v3-line">
                <p className="text-[10px] text-ds-v3-ink-2 mb-0.5">마지막 확인</p>
                <p className="text-xs font-semibold text-ds-v3-ink nums">
                  {autoStatus.lastCheck
                    ? new Date(autoStatus.lastCheck).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '대기 중'}
                </p>
              </div>
              <div className="bg-ds-v3-bg rounded-[8px] px-3 py-2 border border-ds-v3-line">
                <p className="text-[10px] text-ds-v3-ink-2 mb-0.5">마지막 업데이트</p>
                <p className="text-xs font-semibold text-ds-v3-ink nums">
                  {autoStatus.lastUpdate
                    ? new Date(autoStatus.lastUpdate).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '없음'}
                </p>
              </div>
            </div>
            {autoStatus.lastError && (
              <div className="mb-3 px-3 py-2 bg-ds-v3-warn-bg border border-ds-v3-line rounded-[8px]">
                <p className="text-[11px] text-ds-v3-warn font-semibold mb-0.5">오류 내용</p>
                <p className="text-[11px] text-ds-v3-warn break-all">{autoStatus.lastError}</p>
              </div>
            )}
            {autoStatus.log?.length > 0 && (
              <div className="bg-ds-v3-ink-3 rounded-[8px] p-2.5 max-h-36 overflow-y-auto font-mono text-[11px] text-ds-v3-ink-3 space-y-0.5">
                {autoStatus.log.map((line, i) => (
                  <div key={i} className="leading-relaxed">{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </>
  )
}

export { SystemSettingsEtc }
