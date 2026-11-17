import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { Volume2, Play, Square, Save } from 'lucide-react'
import { ttsVoices } from '../../../data/presets'
import { getTTSSettings, saveTTSSettings, ttsPreview } from '../../../lib/api'
import { audioBus } from '../../../lib/audioBus'
import TtsEngineChoice from './ttsEngineChoice'

function VoiceSelect({ label, value, onChange }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-ds-v3-ink-2 mb-1.5">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-base cursor-pointer"
      >
        {/* 저장된 음성이 목록 밖이어도 다른 목소리를 선택한 것처럼 보이면 안 된다. */}
        {value && !ttsVoices.some(v => v.value === value) && <option value={value}>저장된 음성 (목록 외)</option>}
        {ttsVoices.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </div>
  )
}

// 이 PC 음성(Supertonic)의 목소리 10개 — 번호(sid)는 모델 안의 화자 번호다(사용자 결정 2026-09-22).
// 남·여는 **실측**으로 적었다: 같은 문장을 10개로 만들어 기본 음높이(F0 중앙값)를 쟀더니 0~4번 175~237Hz,
// 5~9번 104~153Hz 였다(2026-09-22, 모델 문서에는 번호와 이름을 잇는 표가 없다). 1번이 현장에서 고른 기본이다.
const 이PC목소리 = [
  ...[0, 1, 2, 3, 4].map((sid, i) => ({ sid, 묶음: '여성', 이름: `여성 ${i + 1}` })),
  ...[5, 6, 7, 8, 9].map((sid, i) => ({ sid, 묶음: '남성', 이름: `남성 ${i + 1}` })),
]
const 기본화자 = 1
const 목소리이름 = (sid) => 이PC목소리.find(v => v.sid === sid)?.이름 || `목소리 ${sid}`
const 들어보기문장 = '안녕하세요, 어르신 여러분. 잠시 후 점심 식사가 준비됩니다.'

function SliderRow({ label, value, onChange, min, max, step, unit }) {
  const id = useId()
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <label htmlFor={id} className="text-xs text-ds-v3-ink-2">{label}</label>
        <span className="text-xs text-ds-v3-ink font-semibold nums">{value}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-ds-v3-tts cursor-pointer" />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-ds-v3-ink-2 nums">{min}{unit}</span>
        <span className="text-[10px] text-ds-v3-ink-2 nums">{max}{unit}</span>
      </div>
    </div>
  )
}

export default function TTSSettings() {
  const [voiceNormal,    setVoiceNormal]    = useState(ttsVoices[0].value)
  const [voiceMorning,   setVoiceMorning]   = useState(ttsVoices[1].value)
  const [voiceEmergency, setVoiceEmergency] = useState(ttsVoices[0].value)
  const [speed,   setSpeed]   = useState(0.9)
  // 문장 사이 쉼(ms, 0 = 안 씀) — 이 PC 음성만(사용자 지시 2026-09-22). 막대는 초 단위로 보인다.
  const [pauseMs, setPauseMs] = useState(0)
  const [pitch,   setPitch]   = useState(1.0)
  const [volume,  setVolume]  = useState(80)
  // 시작음·종료음 — 여기가 정본이다(예전엔 브라우저 localStorage 라 PC 마다 갈렸다).
  const [chimeStart, setChimeStart] = useState(true)
  const [chimeEnd,   setChimeEnd]   = useState(true)
  // 이 PC 음성 목소리(화자 0~9) — 저장된 값, 기본 1
  const [supertonicSid, setSupertonicSid] = useState(기본화자)
  // 엔진 카드가 알려 주는 지금 상태 — { primary, front }. **front(실제 맨 앞)** 로 목소리 칸을 고른다.
  const [엔진, set엔진] = useState(null)
  const 엔진받기 = useCallback((st) => set엔진(st), [])
  const azure앞 = 엔진?.front === 'azure'
  // 불러온 값(저장된 값) — 「저장하지 않은 변경이 있습니다」를 가른다. 엔진을 바꿔 숨은 칸의 값도 버리지 않는다.
  const [저장된값, set저장된값] = useState(null)
  const [testText, setTestText] = useState('안녕하세요, 어르신 여러분. 테스트 방송입니다.')
  const [playing,  setPlaying]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [toast,    setToast]    = useState('')
  const [error,    setError]    = useState('')

  const [loadState, setLoadState] = useState('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const toastTimerRef = useRef(null)
  const previewAudioRef = useRef(null)
  const previewBusRef = useRef(null)
  const previewGenerationRef = useRef(0)

  const showToast = useCallback((msg, isError = false) => {
    clearTimeout(toastTimerRef.current)
    setError(isError ? msg : '')
    setToast(isError ? '' : msg)
    // 실패 안내는 재시도할 때까지 남겨 읽을 시간을 보장한다.
    if (!isError) toastTimerRef.current = setTimeout(() => setToast(''), 3000)
  }, [])

  useEffect(() => {
    let cancelled = false
    getTTSSettings().then(data => {
      if (cancelled) return
      if (!data || !['voiceNormal', 'voiceMorning', 'voiceEmergency'].every(key => typeof data[key] === 'string' && data[key])
        || !['rate', 'pitch', 'volume'].every(key => Number.isFinite(data[key]))) {
        throw new Error('설정 응답을 확인할 수 없습니다.')
      }
      setVoiceNormal(data.voiceNormal)
      setVoiceMorning(data.voiceMorning)
      setVoiceEmergency(data.voiceEmergency)
      setSpeed(data.rate)
      setPitch(data.pitch)
      setVolume(data.volume)
      if (data.chimeStart !== undefined) setChimeStart(!!data.chimeStart)
      if (data.chimeEnd   !== undefined) setChimeEnd(!!data.chimeEnd)
      const sid = Number.isInteger(data.supertonicSid) ? data.supertonicSid : 기본화자
      setSupertonicSid(sid)
      const 쉼 = Number.isInteger(data.sentencePauseMs) ? data.sentencePauseMs : 0
      setPauseMs(쉼)
      set저장된값({ pauseMs: 쉼, voiceNormal: data.voiceNormal, voiceMorning: data.voiceMorning, voiceEmergency: data.voiceEmergency,
        speed: data.rate, pitch: data.pitch, volume: data.volume,
        chimeStart: data.chimeStart === undefined ? true : !!data.chimeStart,
        chimeEnd: data.chimeEnd === undefined ? true : !!data.chimeEnd, supertonicSid: sid })
      setLoadState('ready')
    }).catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [loadAttempt])

  // 생성 대기도 취소한다. 늦게 도착한 응답이 화면 밖에서 소리를 시작하면 안 된다.
  const stopPreview = useCallback(() => {
    previewGenerationRef.current += 1
    const audio = previewAudioRef.current
    previewAudioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      try { audio.pause() } catch { /* 종료된 재생도 나머지 자원은 정리한다 */ }
      if (audio._blobUrl) URL.revokeObjectURL(audio._blobUrl)
    }
    previewBusRef.current?.done()
    previewBusRef.current = null
    setPlaying(false)
    setPreparing(false)
  }, [])

  // 문장을 주면 그 문장으로(목소리 「들어 보기」), 안 주면 아래 미리 듣기 칸의 문장으로.
  const handlePreview = async (문장 = null) => {
    const 읽을 = (문장 ?? testText).trim()
    if (!읽을 || loadState !== 'ready' || playing) return
    stopPreview()
    const generation = previewGenerationRef.current
    setPlaying(true)
    setPreparing(true)
    setError('')
    // 실제 방송의 양보 신호는 음성 생성 중에도 이 요청을 취소할 수 있어야 한다.
    previewBusRef.current = audioBus.register({
      kind: 'preview-tts', label: '목소리 시험듣기', stop: () => stopPreview(),
    })
    try {
      // 이 PC 음성이 맨 앞이면 고른 목소리 번호를 실어 **저장하기 전에** 비교해 듣게 한다(서버 /api/tts/preview 가 받는다).
      const blob = await ttsPreview({ text: 읽을, voice: voiceNormal, rate: speed, pitch, ...(azure앞 ? {} : { sid: supertonicSid, pauseMs }) })
      if (generation !== previewGenerationRef.current) return
      const url = URL.createObjectURL(blob)
      let audio
      try { audio = new Audio(url) } catch (e) { URL.revokeObjectURL(url); throw e }
      audio._blobUrl = url
      previewAudioRef.current = audio
      audio.volume = Math.min(100, Math.max(0, volume)) / 100
      audio.onended = () => { if (generation === previewGenerationRef.current) stopPreview() }
      audio.onerror = () => {
        if (generation !== previewGenerationRef.current) return
        stopPreview()
        showToast('미리듣기 음성을 재생하지 못했습니다. 다시 시도해 주세요.', true)
      }
      await audio.play()
      if (generation === previewGenerationRef.current) setPreparing(false)
    } catch (e) {
      if (generation !== previewGenerationRef.current) return
      stopPreview()
      showToast(e?.name === 'NotAllowedError'
        ? '브라우저가 소리 재생을 막았습니다. 사이트의 소리 권한을 확인하고 다시 눌러 주세요.'
        : '미리듣기를 시작하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.', true)
    }
  }

  useEffect(() => () => {
    stopPreview()
    clearTimeout(toastTimerRef.current)
  }, [stopPreview])

  // 설정 저장 → DB에 반영
  const handleSave = async () => {
    if (loadState !== 'ready' || saving) return
    stopPreview()
    setSaving(true)
    try {
      await saveTTSSettings({
        voiceNormal, voiceMorning, voiceEmergency,
        rate: speed, pitch, volume,
        chimeStart, chimeEnd,
        supertonicSid, sentencePauseMs: pauseMs,
      })
      set저장된값({ voiceNormal, voiceMorning, voiceEmergency, speed, pitch, volume, chimeStart, chimeEnd, supertonicSid, pauseMs })
      showToast('설정이 저장되었습니다.')
    } catch (e) {
      showToast(e?.message || '설정을 저장하지 못했습니다. 다시 시도해 주세요.', true)
    } finally {
      setSaving(false)
    }
  }

  const 바뀐것있나 = Boolean(저장된값) && Object.entries({ voiceNormal, voiceMorning, voiceEmergency, speed, pitch, volume, chimeStart, chimeEnd, supertonicSid, pauseMs })
    .some(([k, v]) => 저장된값[k] !== v)

  return (
    <section aria-label="안내 음성 설정" className="space-y-5">
      {loadState === 'loading' && <p role="status" className="text-sm text-ds-v3-ink-2">저장된 음성 설정을 불러오는 중입니다.</p>}
      {loadState === 'error' && (
        <div role="alert" className="card-base space-y-3">
          <p className="text-sm text-ds-v3-warn">저장된 음성 설정을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.</p>
          <button type="button" className="px-4 py-2 border border-ds-v3-tts text-ds-v3-tts rounded-btn text-sm"
            onClick={() => { setLoadState('loading'); setLoadAttempt(value => value + 1) }}>설정 다시 불러오기</button>
        </div>
      )}
      <fieldset disabled={loadState !== 'ready' || saving} className="min-w-0 space-y-5">
      {/* 먼저 쓸 안내 음성(사용자 지시 2026-09-22) — 바로 저장된다(아래 「저장」 단추와 별개). */}
      <div className="card-base">
        <TtsEngineChoice onState={엔진받기} voiceNote={목소리이름(저장된값?.supertonicSid ?? supertonicSid)} />
      </div>
      <div className="grid grid-cols-1 tablet:grid-cols-2 gap-5">
        {/* 음성 선택 — **실제로 맨 앞에 선 엔진**의 목소리만 보인다(사용자 지시 2026-09-22 *「음성선택은 또 azure
            음성이잖아 … 아예 숨겨놨다가 Azure음성 선택하면 활성화되게」*). 엔진 상태를 읽기 전에는 어느 쪽도 먼저
            그리지 않는다 — 잘못된 쪽을 먼저 보이면 화면이 한 번 뒤집힌다. 숨긴 칸의 값은 버리지 않는다. */}
        <div className="card-base space-y-4">
          <h2 className="text-sm font-semibold text-ds-v3-ink">음성 선택</h2>
          {!엔진 && <p className="t-sub text-ds-v3-ink-2" role="status">어느 음성이 나가는지 확인하는 중입니다…</p>}
          {엔진?.error && <p className="t-sub text-ds-v3-warn" role="alert">어느 음성이 나가는지 확인하지 못했습니다 — 위 「다시 시도」를 눌러 주세요. 저장된 목소리는 그대로입니다.</p>}
          {엔진 && !엔진.error && !azure앞 && (
            <div className="space-y-2">
              <label htmlFor="tts-supertonic-sid" className="block t-sub text-ds-v3-ink-2">이 PC 음성 목소리</label>
              <div className="flex gap-2">
                <select id="tts-supertonic-sid" value={supertonicSid} onChange={e => { stopPreview(); setSupertonicSid(Number(e.target.value)) }}
                  className="input-base cursor-pointer flex-1 min-w-0">
                  {['여성', '남성'].map(묶음 => (
                    <optgroup key={묶음} label={묶음}>
                      {이PC목소리.filter(v => v.묶음 === 묶음).map(v => (
                        <option key={v.sid} value={v.sid}>{v.이름}{v.sid === 기본화자 ? ' · 기본' : ''}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" onClick={() => (playing ? stopPreview() : handlePreview(들어보기문장))}
                  className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-btn border border-ds-v3-tts/40 text-ds-v3-tts t-sub font-semibold btn-press">
                  {playing ? <Square size={13} /> : <Play size={13} />}{playing ? '정지' : '들어 보기'}
                </button>
              </div>
              <p className="t-sub text-ds-v3-ink-2">일반·아침·비상 방송 모두 이 목소리로 읽습니다. 고른 뒤 아래 「설정 저장」을 눌러야 방송에 쓰입니다.</p>
            </div>
          )}
          {엔진 && !엔진.error && azure앞 && (
            <>
              <VoiceSelect label="일반 방송 음성"  value={voiceNormal}    onChange={setVoiceNormal} />
              <VoiceSelect label="아침 방송 음성"  value={voiceMorning}   onChange={setVoiceMorning} />
              <VoiceSelect label="비상 방송 음성"  value={voiceEmergency} onChange={setVoiceEmergency} />
              {/* Azure 를 못 쓰면(인터넷 끊김) 실제로 이 PC 음성이 나간다 — 숨기면 「왜 다른 목소리가 나오지」가 된다 */}
              <p className="t-sub text-ds-v3-ink-2">Azure 를 못 쓸 때는 이 PC 음성 · <b className="text-ds-v3-ink">{목소리이름(supertonicSid)}</b>로 나갑니다.</p>
            </>
          )}
        </div>

        {/* 속도 / 음높이 / 볼륨 슬라이더 */}
        <div className="card-base space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ds-v3-ink">음성 속성</h2>
            <button
              onClick={() => { setSpeed(0.9); if (azure앞) setPitch(1.0) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-ds-v3-tts-bg border border-ds-v3-tts/30
                         text-ds-v3-tts rounded-btn text-xs font-semibold hover:bg-ds-v3-tts/10
                         transition-colors cursor-pointer"
              title={azure앞 ? '아침 방송 안내 멘트와 동일한 속도·음높이 (0.9배속, 기본 음높이)' : '아침 방송 안내 멘트와 동일한 속도 (0.9배속)'}
            >
              방송 맞춤 적용
            </button>
          </div>
          {/* 이 PC 음성은 0.8배보다 느리면 말 중간이 끊긴다(2026-09-22 실측: 0.6배에 한 문장 안 2.3초 무음) — 막대도 0.8부터.
              서버도 0.8배로 맞춰 합성하므로(ttsEngines/supertonic.js 가장느린속도) 더 느린 저장값이 남아 있어도 끊기지 않는다. */}
          <SliderRow label="말하기 속도" value={azure앞 ? speed : Math.max(0.8, speed)} onChange={setSpeed}
            min={azure앞 ? 0.5 : 0.8} max={2.0} step={0.1} unit="x" />
          {!azure앞 && speed < 0.8 && (
            <p className="t-sub text-ds-v3-warn -mt-3">⚠ 저장된 속도 {speed}x 는 이 PC 음성에서 끊겨 0.8x 로 나갑니다. 막대를 움직여 저장해 주세요.</p>
          )}
          {/* 문장 사이 쉼 — 이 PC 음성만. 엔진의 쉼 값은 효과가 없어 서버가 문장을 나눠 무음을 끼운다(domain/ttsSentences). */}
          {!azure앞 && (
            <div>
              <SliderRow label="문장 사이 쉼" value={pauseMs / 1000} onChange={(v) => { stopPreview(); setPauseMs(Math.round(v * 1000)) }}
                min={0} max={2} step={0.1} unit="초" />
              <p className="t-sub text-ds-v3-ink-3 mt-1">0초면 쓰지 않습니다. 느리게 들리게 하려면 속도를 낮추는 것보다 이것을 늘리는 쪽이 끊기지 않습니다.</p>
            </div>
          )}
          {/* 음높이는 Azure 에만 있다 — 이 PC 음성에는 없는 기능이라 **그리지 않는다**(잠가 두면 계속 눌러 보게 된다) */}
          {azure앞 && <SliderRow label="음높이" value={pitch} onChange={setPitch} min={0.5} max={2.0} step={0.1} unit="x" />}
          <SliderRow label="볼륨"        value={volume} onChange={setVolume} min={0}   max={100} step={5}   unit="%" />
        </div>
      </div>

      {/* ── 시작음·종료음 (사용자 결정 2026-09-13: *"설정에 둘까? 설정에?"*) ──────────
          즉시 방송에 딸려 나가는 알림음이다. 예전에는 방송을 내보내는 화면에서 매번
          켰다 껐다 했고 값이 **브라우저마다** 따로 있었다 — 현장 PC 에서 끈 것이 직원
          폰에서는 켜져 있었다. 이제 여기 한 곳에서 정하고 모든 기기가 그것을 본다. */}
      <div className="card-base space-y-3">
        <h2 className="text-sm font-semibold text-ds-v3-ink flex items-center gap-2">
          <Volume2 size={15} className="text-ds-v3-tts" />
          시작음 · 종료음
        </h2>
        <p className="text-xs text-ds-v3-ink-2 leading-relaxed">
          즉시 방송(TTS)을 내보낼 때 앞뒤에 붙는 알림음입니다.
          <b> BGM 이 나가는 중이면 자동으로 건너뜁니다</b> — 반주 위에 알림음까지 겹치면 안내가 안 들립니다.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none min-h-[44px]">
            <input type="checkbox" checked={chimeStart} onChange={e => setChimeStart(e.target.checked)}
              className="w-4 h-4 accent-ds-v3-tts cursor-pointer" />
            <span className="text-sm text-ds-v3-ink">시작음 (차임벨)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none min-h-[44px]">
            <input type="checkbox" checked={chimeEnd} onChange={e => setChimeEnd(e.target.checked)}
              className="w-4 h-4 accent-ds-v3-tts cursor-pointer" />
            <span className="text-sm text-ds-v3-ink">종료음</span>
          </label>
        </div>
      </div>

      {/* 미리 듣기 테스트 */}
      <div className="card-base space-y-4">
        <h2 className="text-sm font-semibold text-ds-v3-ink flex items-center gap-2">
          <Volume2 size={15} className="text-ds-v3-tts" />
          미리 듣기 테스트
        </h2>
        <textarea aria-label="미리듣기 문구" value={testText} onChange={e => setTestText(e.target.value)} rows={3}
          className="input-base resize-none" placeholder="테스트할 텍스트를 입력하세요..." />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ds-v3-ink-2">
            {azure앞
              ? <>현재 설정: Azure · 속도 {speed}x · 음높이 {pitch}x · 볼륨 {volume}%</>
              : <>현재 설정: 이 PC 음성 · {목소리이름(supertonicSid)} · 속도 {speed}x · 볼륨 {volume}%</>}
          </p>
          <button
            onClick={playing ? stopPreview : () => handlePreview()}
            disabled={!playing && !testText.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-ds-v3-ink hover:bg-black
                       disabled:opacity-60 text-white rounded-btn text-sm font-semibold
                       btn-press transition-colors">
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? (preparing ? '생성 취소' : '미리듣기 정지') : '미리 듣기'}
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-ds-v3-warn">{error}</p>}
      </div>

      {/* 저장 버튼 */}
      <div className="flex items-center justify-end gap-3">
        {toast && <p role="status" className="text-xs text-ds-v3-ink-3">{toast}</p>}
        {!toast && 바뀐것있나 && <p role="status" className="t-sub text-ds-v3-warn">저장하지 않은 변경이 있습니다</p>}
        <button
          onClick={handleSave}
          disabled={saving || loadState !== 'ready'}
          className="flex items-center gap-2 px-6 py-2.5 bg-ds-v3-ink hover:bg-black
                     disabled:opacity-60 text-white rounded-btn text-sm font-semibold
                     btn-press transition-colors">
          <Save size={14} />
          {saving ? '저장 중...' : '설정 저장'}
        </button>
      </div>
      </fieldset>
    </section>
  )
}
