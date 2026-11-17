// 음량 및 TTS — **소리에 관한 설정이 모이는 한 자리** (UX-37 ~ UX-40, 2026-09-11).
//
// 왜 만들었나(사용자 지시):
//   *"모니터링에서 음량제어 중요하니까 하나 넣고, 쉬운화면에 있는 TTS 및 음량제어를
//     가져오는게 어때. 그리고 거기에 음량 관련된 설정은 다 갖다 넣는거지 …
//     음량 관련된 모든건 거기서 해결할 수 있도록"*
//
// 그전에는 넷으로 흩어져 있었다 —
//   · 종류별 음량 슬라이더 : 쉬운 화면 `easy/VolumePanel.jsx`
//   · TTS 목소리·속도·볼륨 : 시스템 설정 'TTS 설정' 아코디언
//   · 출력 장치·BGM 기본 볼륨·말로 쓰는 볼륨 : 시스템 설정 '오디오' 아코디언
//   · 그래서 "소리를 어디서 조절하나"에 답이 셋이었다.
//
// **로직을 옮겨 적지 않는다.** 세 컴포넌트를 그대로 불러 쓴다 — 값을 읽고 쓰는 규칙은
// 여전히 `server/domain/volume.js` 한 곳이고, 화면이 늘었다고 기본값이 두 벌이 되면
// 그게 바로 이 저장소가 2026-08-28 에 겪은 사고다(같은 볼륨의 이름이 셋이었다).
//
// 시스템 설정에서는 두 아코디언을 **뺐다.** 옛 링크(`?section=ttsSettings` 등)는
// `AdminMode.jsx` 의 `LEGACY_REDIRECTS` 가 여기로 보낸다.
import { Sliders, Mic2, SlidersHorizontal } from 'lucide-react'
import VolumePanel from '../../easy/VolumePanel'
import SystemSettingsVolumeWords from './systemSettingsVolumeWords'
import TTSSettings from './TTSSettings'
import { SystemSettingsAudio } from './systemSettingsAudio'

function 구역({ Icon, title, hint, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 w-7 h-7 rounded-[9px] bg-ds-v3-tts-bg flex items-center justify-center shrink-0">
          <Icon size={15} className="text-ds-v3-ink-2" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ds-v3-ink leading-tight">{title}</h2>
          <p className="text-xs text-ds-v3-ink-2 mt-0.5 leading-relaxed">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

export default function SoundSettings() {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-section text-ds-v3-ink">음량 및 TTS</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          소리에 관한 설정은 모두 이 화면에 있습니다 — 종류별 음량, 소리가 나갈 장치, 안내 음성.
        </p>
      </div>

      <구역
        Icon={Sliders}
        title="종류별 음량"
        hint="방송 종류마다 소리 크기를 따로 정합니다. 위쪽 버튼(조용히·보통·실내방송·최대)을 누르면 한 번에 맞춰집니다. 맨 아래는 「잔잔하게」처럼 말로 예약할 때 그 말이 몇 %인지입니다."
      >
        {/* 쉬운 화면과 **같은 컴포넌트**다. 두 화면이 같은 값을 보고 같은 곳에 쓴다. */}
        <VolumePanel />

        {/* ── 「잔잔하게」가 몇 %인가 — **바로 여기** (사용자 결정 2026-09-16) ──────
            *"말로 쓰는 볼륨 표현 이건 없애도 되지 않아? 위랑 중복되는거같은대"*
            → *"그러면 음량제어 밑에 넣어놔"*

            중복이 아니다 — 위는 **지금 나가는 소리의 크기**, 여기는 **"볼륨은 잔잔하게"
            라고 말했을 때 그 말이 몇 %인가**다. 다만 멀리(맨 아래 구역에) 떨어져 있어서
            관계가 안 보였고, 그래서 중복처럼 읽혔다. 붙여 두면 관계가 보인다. */}
        <SystemSettingsVolumeWords />
      </구역>

      <구역
        Icon={Mic2}
        title="안내 음성 (TTS)"
        hint="글로 쓴 방송문을 읽어 주는 목소리입니다. 아래 '볼륨'은 위 '종류별 음량'의 안내 음성과 같은 값입니다 — 어느 쪽에서 바꿔도 됩니다."
      >
        <TTSSettings />
      </구역>

      <구역
        Icon={SlidersHorizontal}
        title="소리가 나갈 곳과 기본값"
        hint="어느 스피커로 내보낼지, TV로 보낼 때 소리를 얼마나 늦출지, 자막을 얼마나 당길지 정합니다."
      >
        {/* 이 PC의 역할·영상 오디오 딜레이·모바일 마이크도 이 안에 함께 있다 —
            전부 "소리가 어떻게 나가는가"에 관한 것이라 갈라 두지 않았다. */}
        <SystemSettingsAudio />
      </구역>
    </div>
  )
}
