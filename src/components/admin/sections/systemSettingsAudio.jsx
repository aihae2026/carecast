// 음량·TTS 화면의 알맹이 — **오디오 출력 장치**와 **영상 오디오 딜레이 + 자막 오프셋**.
//
// ── 「이 PC의 역할」·「모바일 마이크」는 시스템 설정으로 갔다 (2026-09-16) ────────
// *"모바일 마이크는 시스템 설정으로 가도되고, 이 pc의 역할은 시스템 설정으로"*
// 둘 다 **소리 설정이 아니다** — 「이 PC 가 무엇인가」와 「이 PC 에 어떻게 접속하나」다.
// 소리를 맞추러 온 사람이 매번 지나칠 이유가 없고, 저것을 찾는 사람은 소리 화면을
// 뒤질 이유가 없다. → `systemSettingsPc.jsx`
//
// ── 「말로 쓰는 볼륨 표현」은 **음량 제어 밑으로 옮겼다** (사용자 결정 2026-09-16) ──
// *"없애도 되지 않아? 위랑 중복되는거같은대"* → *"그러면 음량제어 밑에 넣어놔"*.
// 중복이 아니다(위는 지금 나가는 크기, 그쪽은 「잔잔하게」라는 **말**이 몇 %인가).
// 헷갈린 이유가 멀리 떨어져 있어서였으므로, 지우는 대신 붙여 뒀다 —
// `systemSettingsVolumeWords.jsx` 가 `SoundSettings` 의 「종류별 음량」 바로 밑에 선다.
//
// ── 「방송 BGM 기본 볼륨」 카드는 걷었다 (사용자 지적 2026-09-16) ────────────────
// *"방송 BGM 기본 볼륨이랑 배경음악이랑 역할 중첩되는거 아니야?"* — 맞다.
// `bgm_broadcast_default` 는 2026-08-28 볼륨 정리 뒤 **`vol_bgm` 의 옛 이름(별칭)** 이다
// (`server/domain/volume.js:43`). 곧 이 카드와 음량 패널의 BGM 슬라이더가 **같은 숫자**를
// 서로 다른 자리에서 조절하고 있었다. 같은 값에 손잡이가 둘이면 사람은 어느 쪽을 믿을지
// 모른다 — 2026-08-28 사고가 정확히 그 모양이었다(화면엔 50, 방송은 70).
// **설정 키는 그대로 산다** — 지운 것은 화면의 두 번째 손잡이뿐이다.
//
// 왜 갈라냈나: SystemSettings.jsx 본체가 1204줄이었고 그중 이 그룹 하나가 444줄이었다(TD-10).
// 이 그룹이 쓰는 상태 31개는 전부 이 그룹 전용이라, 상태·로딩·저장 핸들러를 통째로 옮겨도
// 부모와 주고받을 props가 하나도 생기지 않는다.
//
// **부모가 이 컴포넌트를 항상 렌더한다 — 그룹이 닫혀 있어도.** 아래 초기 로드 effect가
// 화면이 열리는 순간 한 번 돌아야 하기 때문이다. 부모의 AccordionSection이 닫힌 그룹의
// children을 마운트하지 않도록 되돌리면, 그룹을 펼치는 순간 기본값(딜레이 450 등)이 잠깐
// 보였다가 실제 값으로 바뀐다. server/test/system-settings-eager-load.test.js가 고정한다.

import { useState, useEffect, useRef } from 'react'
import { Check, RefreshCw, Film, AlertTriangle, Monitor } from 'lucide-react'
// 볼륨 기본값은 화면 전체가 한 곳을 본다(UX-39) — 화면마다 숫자를 박으면 2026-08-28 사고다.
import {
         getVideoAudioDelay, saveVideoAudioDelay, getCaptionOffset, saveCaptionOffset, getAudioFiles,
         getTTSSettings, saveTTSSettings, getAudioDevices, getPcRole,
       } from '../../../lib/api'

function SystemSettingsAudio() {
  // 영상 오디오 딜레이 — 국민체조
  // 영상 보정 **하나**와 자막 오프셋 하나(2026-09-16). 기본값 0 — 새로 설치한 PC 는
  // 대개 TV 가 아니라 모니터로 그냥 본다. 거기서 450 은 근거 없이 0.45초 늦는 것이다.
  // 출력장치 설명문이 「이 PC 가 현장인가」에 따라 달라진다. 역할을 **정하는** 화면은
  // 시스템 설정으로 갔지만(2026-09-16), 여기서는 그 값을 **읽기만** 한다 —
  // 같은 사실을 두 화면이 따로 계산하지 않도록 서버가 준 판정을 그대로 쓴다.
  const [pcRole, setPcRole] = useState(null)

  const [delay,      setDelay]      = useState(0)
  const [delaySaved, setDelaySaved] = useState(false)
  const [delaySaving,setDelaySaving]= useState(false)
  const delayRef = useRef(0)
  // 영상 오디오 딜레이 — 식사전 체조
  const [capOffset,      setCapOffset]      = useState(0)
  const [capSaved,       setCapSaved]       = useState(false)
  const [capSaving,      setCapSaving]      = useState(false)
  const capOffsetRef = useRef(0)
  const [testingVideo,     setTestingVideo]     = useState(false)
  const [testingMealVideo, setTestingMealVideo] = useState(false)

  // 이 PC의 역할 (현장 PC / 개발·테스트 PC)

  // 오디오 출력 장치
  const [audioDevice,       setAudioDevice]       = useState('')
  const [devices,           setDevices]           = useState([])
  const [devicesLoading,    setDevicesLoading]    = useState(false)
  const [deviceNotFound,    setDeviceNotFound]    = useState(false)
  const [deviceLoadError,   setDeviceLoadError]   = useState('')
  const [deviceSaveError,   setDeviceSaveError]   = useState('')
  const [audioDeviceSaved,  setAudioDeviceSaved]  = useState(false)
  const [audioDeviceSaving, setAudioDeviceSaving] = useState(false)

  // 방송 BGM 기본 볼륨 상태
  // 자연어 볼륨 표현 수치 — "잔잔하게"/"크게"가 몇 %인지. 스피커·공간마다 달라서 여기서 조정한다.

  // 모바일 마이크 HTTPS 인증서

  useEffect(() => {
    // 영상 오디오 딜레이 초기 로드 — **하나뿐이다**(2026-09-16)
    getVideoAudioDelay().then(d => {
      const ms = Math.round((d.delayMs ?? 0) / 10) * 10  // step=10 기준 보정
      setDelay(ms); delayRef.current = ms
    }).catch(() => {})
    getCaptionOffset().then(d => {
      const ms = Math.round((d.offsetMs ?? 0) / 10) * 10
      setCapOffset(ms); capOffsetRef.current = ms
    }).catch(() => {})
    getPcRole().then(setPcRole).catch(() => { /* 못 읽으면 설명문이 개발 PC 쪽으로 읽힌다 */ })
    // 오디오 출력 장치 초기 로드
    getTTSSettings().then(d => setAudioDevice(d.audioDevice || '')).catch(() => {})
  }, [])

  // 오디오 출력 장치 목록 불러오기
  const handleLoadDevices = async () => {
    setDevicesLoading(true)
    setDeviceNotFound(false)
    setDeviceLoadError('')
    try {
      const list = await getAudioDevices()
      setDevices(list)
      if (audioDevice && !list.some(d => d.name === audioDevice || d.name.startsWith(audioDevice) || audioDevice.startsWith(d.name))) {
        setDeviceNotFound(true)
      }
    } catch (e) {
      setDeviceLoadError(e.message || '장치 목록을 불러오지 못했습니다.')
    }
    setDevicesLoading(false)
  }

  // 오디오 출력 장치 저장.
  // 실패를 삼키지 않는다 — 서버가 깨진 장치 이름을 400으로 막는데(2026-08-30),
  // 조용히 넘어가면 사람은 저장된 줄 알고 소리가 안 나는 이유를 영영 모른다.
  const handleSaveAudioDevice = async () => {
    setAudioDeviceSaving(true)
    setDeviceSaveError('')
    try {
      await saveTTSSettings({ audioDevice })
      setAudioDeviceSaved(true)
      setTimeout(() => setAudioDeviceSaved(false), 2000)
    } catch (e) {
      setDeviceSaveError(e?.message || '저장하지 못했습니다.')
    }
    setAudioDeviceSaving(false)
  }

  // 영상 오디오 딜레이 저장 — **하나뿐이다**(2026-09-16)
  const handleSaveDelay = async () => {
    setDelaySaving(true)
    try {
      await saveVideoAudioDelay(delayRef.current)
      window.dispatchEvent(new CustomEvent('carecast:video-audio-delay', { detail: delayRef.current }))
      setDelaySaved(true)
      setTimeout(() => setDelaySaved(false), 2000)
    } catch (e) { console.error('[설정] 영상 딜레이 저장 실패:', e.message) }  // '저장됨' 표시가 안 뜨는 것으로 사람이 알아챈다
    setDelaySaving(false)
  }

  // 자막 오프셋 저장
  const handleSaveCapOffset = async () => {
    setCapSaving(true)
    try {
      await saveCaptionOffset(capOffsetRef.current)
      window.dispatchEvent(new CustomEvent('carecast:caption-offset', { detail: capOffsetRef.current }))
      setCapSaved(true)
      setTimeout(() => setCapSaved(false), 2000)
    } catch (e) { console.error('[설정] 자막 오프셋 저장 실패:', e.message) }
    setCapSaving(false)
  }

  // 테스트 재생 공통: 지정된 카테고리 목록에서 첫 번째 파일 재생
  const playTestVideo = async (categories, setLoading) => {
    if (setLoading === setTestingVideo && testingVideo) return
    if (setLoading === setTestingMealVideo && testingMealVideo) return
    setLoading(true)
    try {
      let testFile = null
      for (const cat of categories) {
        const files = await getAudioFiles(cat).catch(() => [])
        if (files?.length > 0) { testFile = { ...files[0], category: cat }; break }
      }
      if (!testFile) {
        alert(`테스트할 영상 파일이 없습니다.\n음원 관리 → ${categories.join('/')} 카테고리에 영상을 업로드해 주세요.`)
        return
      }
      window.dispatchEvent(new CustomEvent('carecast:video-play', {
        detail: {
          url:      `/audio/${testFile.category}/${testFile.filename}`,
          name:     `[딜레이 테스트] ${testFile.original_name}`,
          token:    null,
          category: testFile.category,
        }
      }))
    } catch (e) {
      // 재생 테스트 시작 알림 실패 — 소리는 서버가 내고 있으므로 화면 표시만 못 맞춘다
      console.error('[설정] 재생 테스트 알림 실패:', e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTestVideo     = () => playTestVideo(['exercise-video'], setTestingVideo)
  const handleTestMealVideo = () => playTestVideo(['lunch-video', 'dinner-video'], setTestingMealVideo)

  return (
    <>
      {/* 오디오 출력 장치 */}
      <div className="card-base space-y-4">
        <h2 className="t-label font-semibold text-ds-v3-ink flex items-center gap-2">
          <Monitor size={15} className="text-ds-v3-tts" />
          오디오 출력 장치
        </h2>
        <p className="text-xs text-ds-v3-ink-2">
          TTS·BGM·음악 등 모든 방송 오디오가 출력될 스피커/장치를 고정합니다.
          <span className="block mt-1">
            {pcRole?.role === 'site'
              ? 'Windows 기본 장치가 바뀌어도 2분 이내에 자동으로 되돌립니다 (현장 PC).'
              : '방송은 여기서 고른 장치로 나가고, 이 PC의 Windows 사운드 설정은 건드리지 않습니다 (개발·테스트 PC).'}
          </span>
        </p>

        <div className="flex items-center gap-3">
          <select
            value={audioDevice}
            onChange={e => { setAudioDevice(e.target.value); setDeviceNotFound(false) }}
            className="input-base cursor-pointer flex-1"
          >
            <option value="">— 기본 출력 장치 사용 —</option>
            {devices.map(d => (
              <option key={d.index} value={d.name}>{d.name}</option>
            ))}
            {audioDevice && !devices.some(d => d.name === audioDevice) && (
              <option value={audioDevice}>{audioDevice} (오프라인)</option>
            )}
          </select>

          <button
            onClick={handleLoadDevices}
            disabled={devicesLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-ds-v3-surface-2 hover:bg-ds-v3-line
                       disabled:opacity-60 text-ds-v3-ink rounded-btn text-sm font-semibold
                       btn-press transition-colors whitespace-nowrap"
          >
            <RefreshCw size={13} className={devicesLoading ? 'animate-spin' : ''} />
            {devicesLoading ? '조회 중...' : '목록 불러오기'}
          </button>
        </div>

        {deviceLoadError && (
          <div className="flex items-start gap-2 p-3 bg-ds-v3-warn/10 border border-ds-v3-warn/30 rounded-[10px]">
            <AlertTriangle size={14} className="text-ds-v3-warn mt-0.5 shrink-0" />
            <p className="text-xs text-ds-v3-warn">
              장치 목록을 불러오지 못했습니다: {deviceLoadError}
            </p>
          </div>
        )}

        {deviceNotFound && (
          <div className="flex items-start gap-2 p-3 bg-ds-v3-ink-2/10 border border-ds-v3-ink-2/30 rounded-[10px]">
            <AlertTriangle size={14} className="text-ds-v3-ink-2 mt-0.5 shrink-0" />
            <p className="text-xs text-ds-v3-ink-2">
              저장된 장치 "<span className="font-semibold">{audioDevice}</span>"를 현재 PC에서 찾을 수 없습니다.
              목록에서 올바른 장치를 선택하거나, 기본 장치를 사용하려면 "— 기본 출력 장치 사용 —"을 선택하세요.
            </p>
          </div>
        )}

        {deviceSaveError && (
          <div className="flex items-start gap-2 p-3 bg-ds-v3-warn/10 border border-ds-v3-warn/30 rounded-[10px]">
            <AlertTriangle size={14} className="text-ds-v3-warn mt-0.5 shrink-0" />
            <p className="text-xs text-ds-v3-warn">저장하지 못했습니다: {deviceSaveError}</p>
          </div>
        )}

        {devices.length === 0 && !devicesLoading && (
          <p className="text-xs text-ds-v3-ink-2">[목록 불러오기]를 클릭하면 현재 PC의 오디오 출력 장치가 표시됩니다.</p>
        )}

        <button
          onClick={handleSaveAudioDevice}
          disabled={audioDeviceSaving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                     bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                     disabled:opacity-60"
        >
          {audioDeviceSaved
            ? <><Check size={14} /> 저장됨</>
            : audioDeviceSaving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* 영상 오디오 딜레이 (TV 싱크 보정) */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <Film size={15} className="text-ds-v3-tts" />
          영상 오디오 딜레이 (TV 싱크 보정)
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          PC 오디오는 방송시스템으로 즉시 나가고, 영상은 캡처카드 → TV 채널을 거쳐 조금 늦게 도착합니다.
          오디오를 그만큼 늦춰 TV에서 영상·소리가 같이 나오게 맞춥니다.<br />
          <b>영상 종류와 상관없이 같은 값</b>을 씁니다 — 늦는 이유가 영상이 아니라 그 경로이기 때문입니다.<br />
          <span className="text-ds-v3-ink-2 font-normal">현장 PC 화면에서는 어긋나 보이는 게 정상입니다. TV 화면에서 확인하세요.</span>
        </p>

        <div className="space-y-5">
          {/* ── **보정값은 하나다** (사용자 지시 2026-09-16) ────────────────────────
              *"이거 영상 하나로 통일해줘, 어차피 동일하게 TV에서 수신받아서 약간씩 늦는거잖아"*

              맞는 말이다. 지연은 「어느 영상이냐」가 아니라 **PC 오디오 → 방송설비** 와
              **캡처카드 → TV 채널** 의 경로 차이에서 온다. 그 경로는 영상마다 다르지
              않다 — 현장 값도 둘 다 400 이었다.

              슬라이더가 둘이면 **한쪽만 맞춰 두고 다른 쪽을 잊는다.** 그리고 갈래를
              고르는 배선(`delayProfile`)이 끊겨 조용히 틀린 값이 걸린 사고가 두 번
              있었다. 고를 것이 없으면 틀리게 고를 수도 없다. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-ds-v3-ink-2">오디오 딜레이</label>
              <span className="text-sm font-semibold text-ds-v3-tts nums">{delay} ms</span>
            </div>
            <input
              type="range"
              min={0} max={2000} step={10}
              value={delay}
              onChange={e => {
                const v = Number(e.target.value)
                setDelay(v); delayRef.current = v
                window.dispatchEvent(new CustomEvent('carecast:video-audio-delay', { detail: v }))
              }}
              className="w-full h-2 rounded-full cursor-pointer accent-ds-v3-tts"
            />
            <div className="flex justify-between text-[10px] text-ds-v3-ink-2 nums">
              <span>0 ms (모니터로 볼 때)</span>
              <span>2000 ms</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSaveDelay}
                disabled={delaySaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                           bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                           disabled:opacity-60"
              >
                {delaySaved
                  ? <><Check size={14} /> 저장됨</>
                  : delaySaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          <div className="border-t border-ds-v3-line/40" />

          {/* ── 자막 오프셋 (사용자 지시 2026-09-16) ──────────────────────────────
              *"자막도 속도도 물려서 자막은 조금 늦어, 그래서 조금 빠르게 설정할 수 있도록"*

              자막은 위 보정을 **그대로** 따라간다. 소리를 늦추면 자막도 같이 늦는데,
              사람 눈은 귀보다 자막을 먼저 찾아서 그게 늦게 느껴진다.
              그래서 **그 위에 더하는 값**을 따로 둔다. 왼쪽(음수)이 「자막을 당긴다」다. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ds-v3-ink">자막 시점</p>
            <p className="text-[11px] text-ds-v3-ink-2">
              자막은 위 딜레이를 따라갑니다. 그보다 <b>먼저 띄우려면 왼쪽</b>으로 미세요.
            </p>
            <div className="flex items-center justify-between">
              <label className="text-xs text-ds-v3-ink-2">자막 오프셋</label>
              <span className="text-sm font-semibold text-ds-v3-tts nums">
                {capOffset > 0 ? '+' : ''}{capOffset} ms
              </span>
            </div>
            <input
              type="range"
              min={-2000} max={2000} step={10}
              value={capOffset}
              onChange={e => {
                const v = Number(e.target.value)
                setCapOffset(v); capOffsetRef.current = v
                window.dispatchEvent(new CustomEvent('carecast:caption-offset', { detail: v }))
              }}
              className="w-full h-2 rounded-full cursor-pointer accent-ds-v3-tts"
            />
            <div className="flex justify-between text-[10px] text-ds-v3-ink-2 nums">
              <span>-2000 ms (자막 먼저)</span>
              <span>0 ms</span>
              <span>+2000 ms (자막 나중)</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSaveCapOffset}
                disabled={capSaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                           bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 transition-colors
                           disabled:opacity-60"
              >
                {capSaved
                  ? <><Check size={14} /> 저장됨</>
                  : capSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          <div className="border-t border-ds-v3-line/40" />

          {/* 테스트 재생 */}
          <div className="border-t border-ds-v3-line/40 pt-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleTestVideo}
                disabled={testingVideo}
                className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                           border border-ds-v3-tts text-ds-v3-tts hover:bg-ds-v3-tts-bg transition-colors
                           disabled:opacity-60"
              >
                <Film size={14} />
                {testingVideo ? '로드 중...' : '국민체조 테스트'}
              </button>
              <span className="text-xs text-ds-v3-ink-2">exercise-video 딜레이 확인</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleTestMealVideo}
                disabled={testingMealVideo}
                className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                           border border-ds-v3-tts text-ds-v3-tts hover:bg-ds-v3-tts-bg transition-colors
                           disabled:opacity-60"
              >
                <Film size={14} />
                {testingMealVideo ? '로드 중...' : '식사전체조 테스트'}
              </button>
              <span className="text-xs text-ds-v3-ink-2">lunch/dinner-video 딜레이 확인</span>
            </div>
            <p className="text-[11px] text-ds-v3-ink-2">현장 PC는 어긋나 보이는 게 정상입니다 — TV 화면에서 싱크를 확인하세요.</p>
          </div>
        </div>
      </div>

    </>
  )
}

export { SystemSettingsAudio }
