// AI 연동 카드 — 제공자 선택과 Gemini 키.
//
// APISettings.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
import { useState, useEffect } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { Badge } from '../../shared/Badge'
import ConnectionErrorNote from '../../shared/ConnectionErrorNote'
import {
  getAPIKeys, saveAPIKey, testGemini, getAIProvider, saveAIProvider, saveGeminiModel,
  getGeminiModels,
} from '../../../lib/api'
import { ApiKeyField } from './apiKeyField'

// ── AI 제공자 선택 ────────────────────────────────────────
function AIProviderSelector() {
  const [provider,    setProvider]    = useState('gemini')
  // 모델 이름을 화면이 박아 두지 않는다 — 서버가 준 값을 그대로 쓴다(2026-09-06).
  // 박아 뒀더니 서버와 갈려서 **보여 주는 모델과 실제로 부르는 모델이 달랐다.**
  const [geminiModel, setGeminiModel] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState('')

  useEffect(() => {
    const 읽기 = () => getAIProvider().then(d => {
      setProvider(d.provider || 'gemini')
      // 저장값이 'auto' 일 수 있다 — 보여 줄 것은 **지금 실제로 부르는 모델**이다
      const 보일것 = d.resolvedModel || d.geminiModel
      if (보일것) setGeminiModel(보일것)
    }).catch(() => {})
    읽기()
    // 아래 Gemini 카드가 저장하면 다시 읽는다 — 안 그러면 한 화면에 모델 이름이 둘로 갈린다(2026-10-23 QA)
    window.addEventListener('carecast:ai-settings-saved', 읽기)
    return () => window.removeEventListener('carecast:ai-settings-saved', 읽기)
  }, [])

  const handleSelect = async (value) => {
    setProvider(value)
    setSaving(true)
    try {
      await saveAIProvider(value)
      setToast('Gemini로 변경됨')
      setTimeout(() => setToast(''), 2500)
    } catch (e) { setToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const options = [
    { value: 'gemini', label: 'Gemini', sub: `Google — ${geminiModel}`, color: 'border-ds-v3-tts-line bg-ds-v3-tts-bg text-ds-v3-tts' },
  ]

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="t-label font-semibold text-ds-v3-ink">기본 AI 제공자</h2>
        {toast && <p className="text-xs text-ds-v3-ink-3">{toast}</p>}
      </div>
      <p className="text-xs text-ds-v3-ink-2">AI 방송 도우미에서 사용할 기본 AI 엔진을 선택합니다.</p>
      <div className="flex gap-3">
        {options.map(opt => (
          <button key={opt.value} onClick={() => handleSelect(opt.value)} disabled={saving}
            className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-[12px] border-2
                        transition-colors text-left btn-press
                        ${provider === opt.value ? opt.color : 'border-ds-v3-line bg-white text-ds-v3-ink-2 hover:border-ds-v3-line/60'}`}>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${provider === opt.value ? '' : 'text-ds-v3-ink'}`}>{opt.label}</p>
              <p className={`text-[11px] mt-0.5 ${provider === opt.value ? 'text-ds-v3-tts' : 'text-ds-v3-ink-2'}`}>{opt.sub}</p>
            </div>
            {provider === opt.value && (
              <span className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center flex-shrink-0">
                <span className="w-2 h-2 rounded-full bg-current" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Gemini API 카드 ──────────────────────────────────────────
// 기본 모델 이름은 **서버가 알려 준다**(`/api/settings/ai` 의 defaultModel).
// 여기 박아 뒀더니 서버 값과 갈렸고, 설정이 비었을 때 화면은 3.6 이라 하는데 실제 호출은
// 3.5 로 나갔다(2026-09-06). 단일 출처는 server/domain/geminiModel.js 다.
function GeminiApiCard() {
  const [apiKey,      setApiKey]      = useState('')
  const [masked,      setMasked]      = useState(null)
  const [isSet,       setIsSet]       = useState(false)
  const [geminiModel, setGeminiModel] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  // 자동으로 최신 Flash 를 따라가는가(2026-10-23). 켜져 있으면 입력칸 대신 「지금: X」를 보여 주고
  // 저장 때 'auto' 를 보낸다 — 모델 이름을 박지 않는다(박으면 구글이 그 모델을 닫는 날 AI 가 멈춘다).
  const [auto,          setAuto]          = useState(true)
  // 저장돼 있는 것이 자동인가 — 체크만 켜고 아직 저장 안 했으면 「지금:」이 옛 값이라 보여 주지 않는다
  const [savedAuto,     setSavedAuto]     = useState(true)
  const [resolvedModel, setResolvedModel] = useState('')
  const [autoAt,        setAutoAt]        = useState('')
  const [beforeAuto,    setBeforeAuto]    = useState('')
  // 고를 수 있는 모델 목록. **자동으로 안 부른다** — 키가 없으면 헛걸음이고, 사람이 모델을
  // 바꿀 때만 필요하다. 버튼을 누르면 그때 구글에게 물어본다.
  const [models,        setModels]        = useState([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsReason,  setModelsReason]  = useState('')
  // 모델 조회 실패의 **원문까지** 남긴다 — 요약만 두면 다시 볼 길이 없다.
  const [modelsError,   setModelsError]   = useState(null)
  const [testing,     setTesting]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [testResult,  setTestResult]  = useState(null)
  const [toast,       setToast]       = useState('')
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const refresh = () => {
    getAPIKeys().then(d => { setIsSet(d.gemini.set); setMasked(d.gemini.masked) }).catch(() => {})
    getAIProvider().then(d => {
      const 자동 = !d.geminiModel || d.geminiModel === 'auto'
      setAuto(자동)
      setSavedAuto(자동)
      // 자동이면 입력칸에는 지금 쓰는 값을 넣어 둔다 — 자동을 끄면 그 값에서 시작한다
      setGeminiModel(자동 ? (d.resolvedModel || '') : d.geminiModel)
      setResolvedModel(d.resolvedModel || '')
      setAutoAt(d.autoAt || '')
      setBeforeAuto(d.beforeAuto || '')
      if (d.defaultModel) setDefaultModel(d.defaultModel)
    }).catch(() => {})
  }
  useEffect(() => { refresh() }, [])

  const loadModels = async () => {
    setLoadingModels(true); setModelsReason(''); setModelsError(null)
    try {
      const d = await getGeminiModels()
      setModels(d.models || [])
      // 못 받아도 오류로 띄우지 않는다 — 손입력 경로가 그대로 살아 있다
      // **원문을 그대로 띄우지도, 통째로 버리지도 않는다**(UX-10). 서버가 넘겨 준
      // `reason` 은 외부 API 오류 문구를 담을 수 있고 거기에 키가 섞일 수 있다 —
      // 그렇다고 한 줄 요약만 남기면 다음 행동과 원문을 잃는다(Codex 지적, EV-004669).
      // 오류 자체를 넘겨 `ConnectionErrorNote` 가 가려서 보여 주게 한다.
      if (d.reason) setModelsError(d.reason)
      else if ((d.models || []).length === 0) setModelsReason('쓸 수 있는 모델이 없습니다.')
    } catch (e) { setModelsError(e) }
    finally { setLoadingModels(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (apiKey.trim()) {
        await saveAPIKey('gemini_api_key', apiKey.trim())
        setApiKey('')
      }
      // 자동이면 'auto' 를 보낸다 — 입력칸의 이름을 보내면 그 이름이 박혀 다시 고정된다.
      // 자동을 끈 채 비워서 저장해도 서버가 자동으로 돌린다.
      await saveGeminiModel(auto ? 'auto' : geminiModel)
      showToast('저장 완료')
      refresh()
      window.dispatchEvent(new Event('carecast:ai-settings-saved'))
    } catch (e) { showToast('저장 실패: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try { const r = await testGemini(); setTestResult(r) }
    catch (e) { setTestResult({ ok: false, error: e.message }) }
    finally { setTesting(false) }
  }

  const badgeVariant = testResult ? (testResult.ok ? 'success' : 'danger') : isSet ? 'success' : 'default'
  const badgeLabel   = testResult
    ? testResult.ok ? `연동됨 (${testResult.model ?? geminiModel})` : '오류'
    : isSet ? '설정됨' : '미설정'

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-ds-v3-tts-bg border border-ds-v3-line flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-ds-v3-tts" />
          </div>
          <div><h3 className="t-label font-semibold text-ds-v3-ink">Gemini</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">Google — {geminiModel}</p></div>
        </div>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>

      {/* 모델명 입력 */}
      <div>
        {/* 자동으로 최신 모델 — 기본으로 켜져 있다(2026-10-23). 켜 두면 하루 한 번 구글 목록에서 가장 최신
            정식 Flash 를 골라 쓴다. 이름을 박아 두면 구글이 그 모델을 닫는 날 AI 가 멈춘다(현장 2.5 고정). */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-ds-v3-tts cursor-pointer flex-shrink-0" />
          <span className="text-xs text-ds-v3-ink">
            <b className="font-semibold">자동으로 최신 모델 쓰기</b>
            <span className="block text-[11px] text-ds-v3-ink-2 mt-0.5">
              하루 한 번 구글에서 가장 최신 Flash 모델을 찾아 씁니다.
              {auto && !savedAuto && <> 저장하면 최신 모델을 고릅니다.</>}
              {auto && savedAuto && resolvedModel && <> 지금: <span className="font-mono text-ds-v3-ink">{resolvedModel}</span>
                {autoAt && <> ({new Date(autoAt).toLocaleDateString('ko-KR')} 확인)</>}</>}
            </span>
          </span>
        </label>
        {auto && beforeAuto && (
          <p className="text-[11px] text-ds-v3-ink-2 mt-1.5 ml-6">
            예전에 고정돼 있던 모델: <span className="font-mono">{beforeAuto}</span>{' '}
            <button type="button" onClick={() => { setAuto(false); setGeminiModel(beforeAuto) }}
              className="underline hover:text-ds-v3-ink">이 모델로 되돌리기</button>
            {' '}(되돌린 뒤 「저장」)
          </p>
        )}
        {!auto && (<div className="mt-3">
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">
          모델명
          {defaultModel && <span className="ml-2 text-ds-v3-ink-2 font-normal">기본: {defaultModel}</span>}
        </label>
        {/* 목록은 구글에게 물어서 채운다. **입력칸은 그대로 둔다** — 목록에 없는 모델을
            써야 할 때가 있고, 목록을 못 받는 날에도 손으로 넣을 수 있어야 한다. */}
        <input type="text" list="gemini-model-list"
          value={geminiModel} onChange={e => setGeminiModel(e.target.value)}
          placeholder={defaultModel ? `예: ${defaultModel}` : '모델명을 입력하세요'}
          className="input-base font-mono" />
        <datalist id="gemini-model-list">
          {models.map(m => <option key={m} value={m} />)}
        </datalist>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={loadModels} disabled={loadingModels}
            className="text-[11px] text-ds-v3-ink-2 hover:underline disabled:opacity-50 inline-flex items-center min-h-[24px] px-1 -mx-1">
            {loadingModels ? '불러오는 중…' : '쓸 수 있는 모델 목록 불러오기'}
          </button>
          {models.length > 0 && <span className="text-[11px] text-ds-v3-ink-2">{models.length}개 — 입력칸을 누르면 나옵니다</span>}
          {modelsReason && <span className="text-[11px] text-ds-v3-ink-2">{modelsReason}</span>}
        </div>
        {/* 실패는 **카드로** 남긴다 — 무엇이 문제고 다음에 뭘 하면 되는지, 그리고
            (가린) 원문까지. 한 줄 요약만 두면 "연결에 실패했습니다" 로 끝난다. */}
        </div>)}
        <ConnectionErrorNote 오류={modelsError} className="mt-2" />
        <p className="text-[11px] text-ds-v3-ink-2 mt-1">
          무료 쿼터 초과 시 다른 모델로 변경하세요. 저장된 모델이 없어지면 AI 기능은
          자동으로 외부 API → 정해진 틀 순서로 넘어갑니다(멈추지 않습니다).
        </p>
      </div>

      {/* API 키 */}
      <div>
        <label className="block text-xs text-ds-v3-ink-2 mb-1.5">API Key</label>
        <ApiKeyField value={apiKey} masked={masked} isSet={isSet} onChange={setApiKey} onClear={() => setApiKey(' ')} placeholder="AIza..." />
        {/* 원문을 날것으로 띄우지 않는다 — 무엇이 문제고 다음에 뭘 하면 되는지를 말한다(UX-10). */}
        {testResult && !testResult.ok && (
          <ConnectionErrorNote 오류={testResult.error} className="mt-1.5" />
        )}
        {toast && <p className="text-xs text-ds-v3-ink-3 mt-1">{toast}</p>}
      </div>

      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || !isSet}
          className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-bg border border-ds-v3-line rounded-btn text-xs font-normal text-ds-v3-ink-2 hover:text-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          <RefreshCw size={13} className={testing ? 'animate-spin' : ''} />{testing ? '테스트 중...' : '연결 테스트'}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center px-3 py-2 bg-ds-v3-ink hover:bg-ds-v3-ink disabled:opacity-50 text-white rounded-btn text-xs font-semibold btn-press transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

export { AIProviderSelector, GeminiApiCard }
