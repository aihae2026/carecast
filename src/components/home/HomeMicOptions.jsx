// **방송 차임 설정** — 「지금 방송」과 「누르고 말하기」 앞뒤에 붙는 차임의 켬/끔.
// 목업 v3 에서 이 둘은 **서랍**에 있다.
//
// 왜 서랍인가: 급한 안내를 해야 하는 순간에 서랍을 여는 한 번이 더 붙으면 그게 사고라서,
// **내보내는 단추**(「누르고 말하기」)는 화면에 늘 둔다. 반대로 차임 켬/끔은 한 번 정하면
// 몇 달 안 건드리는 값이라 서랍이 맞다. 그 판단은 그대로다.
//
// **이름과 설명은 2026-09-15 에 고쳤다**(사용자 지시) — 칸 이름이 「즉시 방송」이라
// 여기서 방송을 내보내는 줄 알게 했고, 설명은 **다른 단추가 어디 있는지**만 말하고
// 정작 이 차임이 **어느 방송에 붙는지**는 안 적고 있었다.
//
// **값은 `useChimeToggles` 한 곳에서 온다.** 여기서 껐는데 알약 쪽이 모르면,
// 사람이 껐다고 믿는 차임이 그대로 울린다.
import { useChimeToggles } from '../../hooks/useChimeToggles'

function 옵션({ on, onChange, children }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={'min-h-[42px] flex-1 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors '
        + (on
          ? 'border-ds-v3-tts bg-ds-v3-tts-bg text-ds-v3-tts'
          : 'border-ds-v3-line-2 bg-ds-v3-surface text-ds-v3-ink-3 hover:bg-ds-v3-surface-2')}>
      {children}
    </button>
  )
}

export default function HomeMicOptions() {
  const { chime, endChime, setChime, setEndChime } = useChimeToggles()
  return (
    <>
      {/* ── **무엇의 차임인지 적는다** (사용자 지시 2026-09-15) ──────────────────────
          앞 판은 *"「누르고 말하기」는 서랍을 열지 않아도 화면에 늘 있습니다"* 였다.
          그건 **이 칸이 무엇을 하는지**가 아니라 **다른 단추가 어디 있는지**를 말한 것이라,
          여기서 켜고 끄는 차임이 **어느 방송에 붙는지**는 아무도 알 수 없었다. */}
      <p className="m-0 mb-2.5 text-[13px] text-ds-v3-ink-2">
        <b className="font-semibold text-ds-v3-ink">「지금 방송」과 「누르고 말하기」</b>의
        앞뒤에 붙는 차임을 켜고 끕니다.
      </p>
      {/* 켬/끔을 **글자로도** 말한다 — 색만으로는 색각 차이를 못 넘는다(G-7).
          `aria-pressed` 가 보조기술에 같은 사실을 전한다.

          ── **글자를 「지금 방송」 카드와 맞춘다** (사용자 지시 2026-09-15) ──────────────
          같은 값을 만지는 자리가 둘인데 한쪽은 「시작 차임 켬/끔 · 종료음」,
          한쪽은 「시작 차임 ON/OFF · 종료 차임」이었다. **같은 것을 다르게 부르면
          사람은 다른 것으로 믿는다** — 특히 「종료음」과 「종료 차임」은 다른 기능처럼 읽힌다.
          카드 쪽(`QuickSchedulePhrase` 의 차임옵션)이 정본이고 여기를 맞춘다. */}
      <div className="flex gap-2">
        <옵션 on={chime} onChange={setChime}>시작 차임 {chime ? 'ON' : 'OFF'}</옵션>
        <옵션 on={endChime} onChange={setEndChime}>종료 차임 {endChime ? 'ON' : 'OFF'}</옵션>
      </div>
    </>
  )
}
