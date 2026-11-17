// 소리 장부(audioBus) — **지금 이 브라우저에서 어떤 소리가 나고 있는지**를 아는 유일한 곳.
//
// 왜 있나: "지금 어떤 소리가 나고 있는지 아는 주체가 없다." 재생 주체가 20곳인데 각자
// 자기 손잡이만 들고 있어서, "겹쳐 들려요" 신고가 오면 무엇과 무엇이었는지 아무도 말을
// 못 했다. 2026-09-01~02 이틀 동안만 이 유형의 사고를 셋 고쳤다(e049d7c·90c432a·a0ccc99).
// 전수조사와 단계 계획은 docs/td09-audiobus.md — **이 파일은 그 계획의 1단계다.**
//
// 1단계: **등록만 한다. 동작 무변경.** 소리가 시작될 때 register, 끝날 때 done.
//   등록 시점에 이미 다른 소리가 활성이면 겹침 기록(링버퍼 최근 50건)에 남긴다 —
//   다음 신고 때 개발자 도구에서 window.CC_AUDIO_BUS.snapshot()으로 조회한다.
// 2단계: 규칙표(문서 §3) 사용자 승인. 3단계: 한 갈래씩 정지·양보를 여기로 위임.
//
// **3단계 첫 갈래 = 미리듣기(2026-09-02).** register가 선택적 `stop` 콜백을 받고,
// stopKinds(접두사)가 그 콜백을 불러 준다. 지금 위임된 것은 **미리듣기뿐**이다
// (kind가 'preview-'로 시작하는 것들). 실제 방송(TTS·BGM·영상·TV)의 정지는 아직
// 각자의 손잡이가 쥐고 있다 — 갈래마다 사용자 승인과 소리 확인을 거쳐 옮긴다.
// **stop을 안 넘긴 등록은 예전 그대로다**(stopKinds가 건드릴 수 없다 — 하위호환).
//
// 절대 규칙: **이 모듈은 던지지 않는다.** 장부 기록 하나 때문에 방송 시퀀스가 죽으면
// 안 된다(이 저장소의 반복 원칙 — "감시 기록 하나 때문에 시퀀스가 죽으면 안 된다").
// window가 없으면(서버 테스트가 import) 전부 no-op이다.
//
// 근사에 대해: **재생을 지시한 시점=등록, 제거/정지 지시=해제**로 근사한다. 페이드아웃 몇백 ms의
// 오차가 있다. (예전엔 외부 동영상 iframe 도 여기 올렸다 — 2026-09-21 걷어냈다.) TTS도 autoplay가 끝까지 차단되면 "등록됐지만 무음"일 수 있다 — 장부는 "내려던
// 소리"의 기록이지 마이크 측정이 아니다.
//
// 일부러 등록하지 않는 곳(문서 §1·§5 — 가드 테스트의 목록에도 없다):
//  · useAudioListener.js — 서버가 청크를 릴레이하지 않아 현재 도달 불가(문서 H14)
//  · InstantBroadcast.jsx의 무음 유지 오디오 — 실소리는 서버 스피커로 나간다(#10)
//  · C군(MorningVideoDisplay·MonitorPage) — 뮤트 표시 전용, 소리가 없다

const activeMap = new Map()   // id → { id, kind, label, since, stop }
const overlapLog = []         // 겹침 기록 링버퍼 — 최근 50건만 유지
const OVERLAP_MAX = 50
let nextId = 0
let stopping = false          // stopKinds 재진입 방어(아래 stopKinds 주석)

// 소리 시작을 장부에 올린다. kind는 짧은 영문 슬러그(문서 §1의 표를 따른다):
// 'tts' | 'bgm-local' | 'prayer' | 'staff' | 'video' | 'chime'
// | 'preview-tts' | 'preview-audio' | 'preview-loop' | 'preview-bgm'
//
// info.stop — **선택**이다. 넘기면 stopKinds가 이 소리를 세울 수 있다(3단계 위임).
// 안 넘기면 예전과 똑같이 기록만 되고 아무도 못 세운다 — 기존 호출부는 고칠 것이 없다.
// stop은 **자기가 켠 것만** 끄는 함수여야 한다(전역 정지 신호를 무조건 쏘면 안 된다 —
// 문서 H3이 바로 그 사고였다: 미리듣기 정지가 실제 방송 BGM까지 세웠다).
// @returns {{ done: () => void }} — 소리가 끝나면 부른다. 여러 번 불러도 안전하다.
//   done은 **장부에서 빼기만 한다.** stop을 부르지 않는다(이미 끝난 소리다).
export function register(info) {
  try {
    if (typeof window === 'undefined') return { done() {} }
    const kind  = (info && typeof info.kind === 'string' && info.kind) ? info.kind : 'unknown'
    const label = (info && info.label != null) ? String(info.label) : ''
    const stop  = (info && typeof info.stop === 'function') ? info.stop : null
    const id    = ++nextId
    // 등록 시점에 이미 활성인 소리가 있으면 겹침으로 기록한다 — 1단계의 존재 이유.
    if (activeMap.size > 0) {
      overlapLog.push({
        시각: new Date().toISOString(),
        시작한것: { kind, label },
        그때활성목록: [...activeMap.values()].map(a => ({ kind: a.kind, label: a.label })),
      })
      if (overlapLog.length > OVERLAP_MAX) overlapLog.splice(0, overlapLog.length - OVERLAP_MAX)
    }
    activeMap.set(id, { id, kind, label, since: new Date().toISOString(), stop })
    let ended = false
    return {
      done() {
        try {
          if (ended) return
          ended = true
          activeMap.delete(id)
        } catch { /* 장부 해제 실패로 소리 경로가 죽으면 안 된다 */ }
      },
    }
  } catch {
    // 장부 등록에 실패해도 소리는 나야 한다 — 호출부가 구분할 필요 없게 같은 모양을 준다
    return { done() {} }
  }
}

// kind가 주어진 접두사로 시작하는 활성 소리를 세운다(3단계 위임의 손잡이).
// 예: stopKinds('preview-') → preview-tts·preview-audio·preview-loop이 전부 비킨다.
// stop을 안 넘기고 등록한 소리는 **세울 수 없으므로 건드리지 않는다**(장부에도 남는다).
// @param {string|string[]} prefixes
// @returns {number} 실제로 stop을 부른 개수 — 던지지 않는다(호출부가 감쌀 필요 없다).
export function stopKinds(prefixes) {
  try {
    if (typeof window === 'undefined') return 0
    // ── 재진입 방어 (두 겹) ──────────────────────────────────────────────
    // stop 콜백은 대개 그 화면의 "미리듣기 끄기" 함수인데, 그 함수가 다시 stopKinds나
    // 자기 관문을 부르면 무한루프가 된다. 그래서:
    //  (1) **먼저 목록을 스냅샷 뜨고 장부에서 뺀 뒤** stop을 부른다 — 되들어와도 볼 것이 없다.
    //  (2) 처리 중 플래그 — 되들어온 호출은 0을 돌려주고 끝난다. 바깥 순회가 이미 그
    //      스냅샷을 책임지고 있으므로 잃는 것이 없다.
    if (stopping) return 0
    const list = Array.isArray(prefixes) ? prefixes : [prefixes]
    const pre  = list.filter(p => typeof p === 'string' && p)
    if (!pre.length) return 0
    const targets = [...activeMap.values()]
      .filter(a => a.stop && pre.some(p => String(a.kind).startsWith(p)))
    for (const t of targets) activeMap.delete(t.id)   // (1) 부르기 전에 뺀다
    stopping = true
    let n = 0
    try {
      for (const t of targets) {
        // 하나가 던져도 나머지를 계속 세운다 — 한 화면의 실수로 다른 소리가 남으면 안 된다
        try { t.stop(); n++ } catch { /* 이 소리 하나만 못 섰다. 다음으로 간다 */ }
      }
    } finally { stopping = false }
    return n
  } catch {
    return 0   // 장부 때문에 소리 경로가 죽으면 안 된다 — 이 모듈의 절대 규칙
  }
}

// 지금 활성인 소리와 최근 겹침 기록. 개발자 도구에서 window.CC_AUDIO_BUS.snapshot().
export function snapshot() {
  try {
    return {
      active:   [...activeMap.values()].map(a => ({ kind: a.kind, label: a.label, since: a.since })),
      overlaps: overlapLog.slice(),
    }
  } catch {
    return { active: [], overlaps: [] }
  }
}

// 배선 파일들이 `audioBus.register(...)`로 부른다 — grep으로 배선 여부를 셀 수 있는 이름
// (server/test/audio-bus-coverage.test.js가 이 이름의 존재를 파일마다 검사한다).
export const audioBus = { register, snapshot, stopKinds }

// 현장에서 "겹쳐 들려요" 신고가 오면: F12 → window.CC_AUDIO_BUS.snapshot()
try {
  if (typeof window !== 'undefined') window.CC_AUDIO_BUS = { snapshot }
} catch { /* 노출 실패는 조회 편의만 잃는다 — 장부 자체는 동작한다 */ }
