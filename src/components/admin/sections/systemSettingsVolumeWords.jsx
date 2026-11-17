// **말로 쓰는 볼륨 표현** — "잔잔하게"가 몇 %인지.
//
// ── 왜 따로 떨어져 나왔나 (사용자 지시 2026-09-16) ──────────────────────────
// *"말로 쓰는 볼륨 표현 이건 없애도 되지 않아? 위랑 중복되는거같은대"*
//
// 중복으로 보이는 것이 당연하다 — 슬라이더가 %를 정하는 모습이 「종류별 음량」과 똑같다.
// **그런데 다른 것이다.** 종류별 음량은 *지금 나가는 소리의 크기*이고, 여기는
// *"볼륨은 잔잔하게" 라고 **말했을 때** 그 말이 몇 %인가*를 정한다.
//
// 코드에 숫자를 박지 않는 이유는 `CLAUDE.md` 「자연어로 설정을 건드릴 때」에 있다 —
// *"'잔잔하게'가 몇 %인지는 스피커·공간마다 달라서 배포 없이 조정할 수 있어야 한다."*
//
// 그래서 지우지 않고 **음량 제어 바로 밑으로 옮겼다**(사용자 결정: *"그러면 음량제어
// 밑에 넣어놔"*). 헷갈린 이유가 「멀리 떨어져 있어서」였다면, 붙여 두면 관계가 보인다 —
// 위가 *소리 크기*, 아래가 *그 크기를 부르는 말*이다.
import { useState, useEffect, useRef } from 'react'
import { Volume2, Check } from 'lucide-react'
import { 말볼륨기본값 } from '../../../lib/volumeDefaults'
import { getVolumeWords, saveVolumeWords } from '../../../lib/api'

export default function SystemSettingsVolumeWords() {
  const [volQuiet,      setVolQuiet]      = useState(말볼륨기본값.quiet)
  const [volLoud,       setVolLoud]       = useState(말볼륨기본값.loud)
  const [volWordsSaved, setVolWordsSaved] = useState(false)
  const [volWordsSaving,setVolWordsSaving]= useState(false)
  const volQuietRef = useRef(말볼륨기본값.quiet)
  const volLoudRef  = useRef(말볼륨기본값.loud)

  useEffect(() => {
    getVolumeWords().then(d => {
      const q = d.quiet ?? 말볼륨기본값.quiet, l = d.loud ?? 말볼륨기본값.loud
      setVolQuiet(q); volQuietRef.current = q
      setVolLoud(l);  volLoudRef.current  = l
    }).catch(() => { /* 기본값 그대로 쓴다 — 이 화면이 비면 뭘 고칠지 모른다 */ })
  }, [])

  const 저장 = async () => {
    setVolWordsSaving(true)
    try {
      await saveVolumeWords({ quiet: volQuietRef.current, loud: volLoudRef.current })
      setVolWordsSaved(true)
      setTimeout(() => setVolWordsSaved(false), 2000)
    } catch (e) { console.error('[설정] 말 볼륨 저장 실패:', e.message) }  // '저장됨'이 안 뜨는 것으로 사람이 알아챈다
    setVolWordsSaving(false)
  }

  return (
    <div className="card-base">
      <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
        <Volume2 size={15} className="text-ds-v3-tts" />
        말로 예약할 때의 &quot;잔잔하게 · 크게&quot;
      </h2>
      <p className="text-xs text-ds-v3-ink-2 mb-4">
        <b>위 슬라이더와는 다른 것입니다.</b> 위는 <b>지금 나가는 소리의 크기</b>이고,
        여기는 <span className="font-semibold">&quot;볼륨은 잔잔하게&quot;</span>라고 <b>말로 예약했을 때</b>
        {' '}그 말이 몇 %인지를 정합니다.<br />
        스피커와 공간에 따라 체감이 다르니, 어르신들이 &quot;잘 안 들린다&quot;고 하시면 여기서 올려 주세요.<br />
        <span className="text-ds-v3-ink-2">이 값은 그 예약에만 적용되고, 위 음량 설정은 그대로 유지됩니다.</span>
      </p>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-ds-v3-ink-2 font-normal">
              &quot;잔잔하게 · 조용히 · 작게&quot;
            </label>
            <span className="text-sm font-semibold text-ds-v3-tts nums">{volQuiet}%</span>
          </div>
          <input
            type="range"
            min={0} max={100} step={5}
            value={volQuiet}
            onChange={e => {
              const v = Number(e.target.value)
              setVolQuiet(v); volQuietRef.current = v
            }}
            className="w-full h-2 rounded-full cursor-pointer accent-ds-v3-tts"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-ds-v3-ink-2 font-normal">
              &quot;크게 · 잘 들리게 · 우렁차게&quot;
            </label>
            <span className="text-sm font-semibold text-ds-v3-tts nums">{volLoud}%</span>
          </div>
          <input
            type="range"
            min={0} max={100} step={5}
            value={volLoud}
            onChange={e => {
              const v = Number(e.target.value)
              setVolLoud(v); volLoudRef.current = v
            }}
            className="w-full h-2 rounded-full cursor-pointer accent-ds-v3-tts"
          />
        </div>

        {volQuiet >= volLoud && (
          <p className="text-[11px] text-ds-v3-ink-2">
            ⚠ &quot;잔잔하게&quot;가 &quot;크게&quot;보다 크거나 같습니다 — 말한 것과 반대로 나갈 수 있습니다.
          </p>
        )}

        <div className="bg-ds-v3-tts-bg border border-ds-v3-tts/20 rounded-[10px] px-3 py-2.5 text-xs text-ds-v3-ink-2 space-y-0.5">
          <p className="font-semibold text-ds-v3-tts mb-1">예시</p>
          <p>• &quot;오후 두시에 프로그램 안내하고, 볼륨은 잔잔하게&quot; → BGM {volQuiet}%</p>
          <p>• &quot;투약 안내, 안내 음성은 크게&quot; → 안내 음성 {volLoud}%</p>
          <p className="pt-1 text-ds-v3-ink-2">&quot;볼륨 40으로&quot;처럼 숫자를 직접 말하면 그 값이 그대로 쓰입니다.</p>
        </div>

        <button
          onClick={저장}
          disabled={volWordsSaving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-btn text-sm font-normal
                     bg-ds-v3-ink text-white hover:bg-ds-v3-ink transition-colors
                     disabled:opacity-60"
        >
          {volWordsSaved
            ? <><Check size={14} /> 저장됨</>
            : volWordsSaving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}
