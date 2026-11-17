// 차임벨을 **이 브라우저에서** 낸다 — 서버 스피커도, 현장 PC도 건드리지 않는다.
//
// 왜 브라우저에서 합성하나: 서버 차임(services/carecast_chime.py)은 현장 PC 스피커로 나간다.
// 미리듣기에 그걸 쓰면 **홀에 실제 방송이 나가버린다.** 그래서 브라우저가 직접 소리를 만든다.
//
// 서버 차임의 정확한 복제가 아니라 "같은 인상"을 주는 소리다(종 두 번 + 배음).
// 원래 ScheduledBroadcastMini.jsx 안에 있던 것을 순서편집기 미리듣기와 나눠 쓰려고 옮겼다 —
// 한쪽만 고치면 화면에 따라 미리듣기 소리가 달라진다.
import { audioBus } from './audioBus.js'   // 확장자를 붙인다 — 서버 시험(node)이 이 파일을 직접 돌린다(bgmPreview.js 와 같은 이유)

const NOTES = [{ f: 659.25, t: 0 }, { f: 523.25, t: 0.55 }]
// **서버 스피커 대신 울릴 때**(chime_fallback_play, 2026-09-26)는 서버 차임과 같은 음 순서를 쓴다 —
// services/carecast_chime.py 의 PATTERNS(시작음 도·미·솔, 종료음 솔·미·도). 미리듣기(인자 없는 호출)는 위 두 음 그대로다.
const 종류별음 = {
  general: [{ f: 523.25, t: 0 }, { f: 659.25, t: 0.5 }, { f: 783.99, t: 1.0 }],
  end:     [{ f: 783.99, t: 0 }, { f: 659.25, t: 0.5 }, { f: 523.25, t: 1.0 }],
}
// [배음비, 세기, 감쇠초]
const PARTIALS = [[1.0, 0.55, 3.5], [2.756, 0.18, 1.2], [5.404, 0.07, 0.6]]

/**
 * @param {{type?: 'general'|'end', volume?: number}} [opts] 서버가 보낸 종류·볼륨(0~100). 안 주면 미리듣기 소리(예전 그대로).
 *   볼륨 0 이면 울리지 않는다 — 서버 차임도 볼륨 0 이면 무음이다(2026-09-26 Codex 교차검수 T36 Medium).
 */
export function playBrowserChime(opts) {
  const 대체 = opts && typeof opts === 'object'
  const 배율 = 대체 && Number.isFinite(Number(opts.volume)) ? Math.min(1, Math.max(0, Number(opts.volume) / 100)) : 1
  if (배율 <= 0) return
  const 음들 = 대체 ? (종류별음[opts.type] || 종류별음.general) : NOTES
  // [audioBus] 차임 미리듣기 등록 — 자체 감쇠 약 2.5초라 정지 수단이 없다.
  // 감쇠가 끝났을 시점(2600ms)에 자동 해제한다(td09 1단계 — 기록만, 동작 무변경).
  const reg = audioBus.register({ kind: 'chime', label: '브라우저 차임' })
  setTimeout(() => reg.done(), 대체 ? 3600 : 2600)
  try {
    const ctx = new AudioContext()
    for (const { f, t } of 음들) {
      for (const [ratio, amp, decay] of PARTIALS) {
        const osc = ctx.createOscillator(); const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'; osc.frequency.value = f * ratio
        const s = ctx.currentTime + t
        gain.gain.setValueAtTime(0, s)
        gain.gain.linearRampToValueAtTime(amp * 배율, s + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.0001, s + decay)
        osc.start(s); osc.stop(s + decay + 0.1)
      }
    }
  } catch { /* WebAudio가 막힌 브라우저(사용자 조작 전)에서는 효과음만 안 난다 */ }
}
