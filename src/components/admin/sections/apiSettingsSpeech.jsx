// 안내 음성 엔진 카드 둘 (2026-09-21) — 엔진 차례·상태와 Azure 음성(선택) 키.
//
// 사용자 지시: 기본 Supertonic 3(이 PC) · 선택 Azure · 마지막 대비 윈도우 기본 음성.
// 두 칸 격자에 나란히 둔다(APISettings 의 다른 그룹과 같은 폭 — 한 장만 두면 옆 칸이 빈다).
import { useState, useEffect } from 'react'
import { AudioLines, Mic, RefreshCw } from 'lucide-react'
import { Badge } from '../../shared/Badge'
import ConnectionErrorNote from '../../shared/ConnectionErrorNote'
import { getTtsEngines, getAzureSpeech, saveAzureSpeech, testAzureSpeech } from '../../../lib/api'
import { ApiKeyField } from './apiKeyField'
import TtsEngineChoice from './ttsEngineChoice'

// ── 엔진 차례 · 상태 ─────────────────────────────────────────────
// 방송이 실제로 어느 엔진으로 나가는지 사람이 볼 수 있어야 한다 — 모델을 안 받은 현장 PC 는
// 조용히 다음 엔진으로 넘어가므로(무음은 아니지만 목소리가 다르다), 여기서 이유를 보여 준다.
function TtsEngineCard({ refreshKey }) {
  const [engines, setEngines] = useState(null)
  const [error, setError] = useState(null)
  const [다시, set다시] = useState(0)   // 먼저 쓸 엔진을 바꾸면 차례를 다시 읽는다
  useEffect(() => {
    let 살아있음 = true
    getTtsEngines()
      .then((d) => { if (살아있음) { setEngines(d.engines || []); setError(null) } })
      .catch((e) => { if (살아있음) setError(e) })
    return () => { 살아있음 = false }
  }, [refreshKey, 다시])

  const 첫 = engines?.find((e) => e.order === 0)
  return (
    <div className="card-base space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-tts-bg border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <AudioLines size={18} className="text-ds-v3-tts" />
          </div>
          <div><h3 className="t-label font-semibold text-ds-v3-ink">안내 음성 엔진</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">위에서부터 차례로 씁니다 — 앞이 안 되면 다음으로</p></div>
        </div>
        {첫 && <Badge variant={첫.name === 'supertonic' ? 'success' : 'warning'}>지금: {첫.label.split(' (')[0]}</Badge>}
      </div>
      {/* 먼저 쓸 엔진 고르기 — TTS 설정 화면과 같은 부품(사용자 지시 2026-09-22) */}
      <TtsEngineChoice refreshKey={refreshKey} onChanged={() => set다시((n) => n + 1)} />
      {error && <ConnectionErrorNote 오류={error} />}
      {!engines && !error && <p className="text-xs text-ds-v3-ink-2">불러오는 중…</p>}
      {engines && (
        <ul className="space-y-1.5">
          {engines.map((e) => (
            <li key={e.name} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${e.ok ? 'bg-ds-v3-tts' : 'bg-ds-v3-line'}`}
                aria-hidden="true" />
              <span className="flex-1">
                <span className={e.ok ? 'text-ds-v3-ink' : 'text-ds-v3-ink-2'}>{e.label}</span>
                {/* 색만으로 말하지 않는다 — 쓸 수 없으면 글로 이유를 적는다 */}
                <span className="text-ds-v3-ink-2">{e.ok ? ' — 사용 가능' : ` — 안 씀${e.reason ? ` (${e.reason})` : ''}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-ds-v3-ink-2">
        Supertonic 모델이 없으면 CareCast 폴더(맨 위)에서 <code className="font-mono">npm run setup:tts</code> 를 한 번 돌립니다.
        합성 음성은 사람 목소리가 아니라는 것을 어르신께 알려 두는 것이 좋습니다.
      </p>
    </div>
  )
}

// ── Azure 음성(선택) ─────────────────────────────────────────────
function AzureSpeechCard({ onSaved }) {
  const [isSet, setIsSet] = useState(false)
  const [masked, setMasked] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [region, setRegion] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [toast, setToast] = useState('')

  const refresh = async () => {
    try {
      const d = await getAzureSpeech()
      setIsSet(!!d.keySet); setMasked(d.keyMasked); setRegion(d.region || '')
    } catch (e) { setToast('불러오기 실패: ' + e.message) }
  }
  useEffect(() => {
    let 살아있음 = true
    getAzureSpeech()
      .then((d) => { if (살아있음) { setIsSet(!!d.keySet); setMasked(d.keyMasked); setRegion(d.region || '') } })
      .catch((e) => { if (살아있음) setToast('불러오기 실패: ' + e.message) })
    return () => { 살아있음 = false }
  }, [])

  const handleSave = async () => {
    setSaving(true); setToast('')
    try {
      const body = { region: region.trim() }
      if (apiKey.trim()) body.key = apiKey.trim()
      await saveAzureSpeech(body)
      setApiKey(''); setTestResult(null)
      setToast('저장 완료'); await refresh(); onSaved?.()
    } catch (e) { setToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }
  const handleRemove = async () => {
    setSaving(true); setToast('')
    try { await saveAzureSpeech({ key: '' }); setApiKey(''); setTestResult(null); setToast('키를 지웠습니다 — Azure 는 쓰지 않습니다'); await refresh(); onSaved?.() }
    catch (e) { setToast('지우기 실패: ' + e.message) }
    finally { setSaving(false) }
  }
  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try { setTestResult(await testAzureSpeech()) }
    catch (e) { setTestResult({ ok: false, error: e.message }) }
    finally { setTesting(false) }
  }

  const badgeVariant = testResult ? (testResult.ok ? 'success' : 'danger') : isSet ? 'success' : 'default'
  const badgeLabel = testResult ? (testResult.ok ? `연결됨 (${testResult.ms}ms)` : '오류') : isSet ? '설정됨' : '안 씀'

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-tts-bg border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Mic size={18} className="text-ds-v3-tts" />
          </div>
          <div><h3 className="t-label font-semibold text-ds-v3-ink">Azure 음성 (선택)</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">Microsoft — 이 PC 엔진이 안 될 때 인터넷으로 씁니다</p></div>
        </div>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>

      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5" htmlFor="azure-region">지역</label>
        <input id="azure-region" type="text" value={region} onChange={(e) => setRegion(e.target.value)}
          placeholder="예: koreacentral" className="input-base font-mono" autoComplete="off" />
      </div>
      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">키</label>
        <ApiKeyField value={apiKey} masked={masked} isSet={isSet} onChange={setApiKey} onClear={() => setApiKey(' ')} placeholder="Speech 서비스 키" />
        {testResult && !testResult.ok && <ConnectionErrorNote 오류={testResult.error} className="mt-1.5" />}
        {toast && <p className="text-xs text-ds-v3-ink-3 mt-1" role="status">{toast}</p>}
        <p className="text-[11px] text-ds-v3-ink-2 mt-1">
          기관마다 <b>자기</b> Azure 구독·키를 씁니다(무료 계층 월 50만 자). 비워 두면 이 PC 의 음성만 씁니다.
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || !isSet}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />{testing ? '확인 중...' : '연결 테스트'}
        </button>
        {isSet && (
          <button onClick={handleRemove} disabled={saving}
            className="px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
            키 지우기
          </button>
        )}
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center px-3 py-2 bg-ds-v3-ink hover:bg-ds-v3-ink disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

// 둘을 한 묶음으로 — Azure 를 저장하면 엔진 차례 카드가 다시 읽는다.
export function SpeechEngineCards() {
  const [n, setN] = useState(0)
  return (
    <>
      <TtsEngineCard refreshKey={n} />
      <AzureSpeechCard onSaved={() => setN((x) => x + 1)} />
    </>
  )
}
