// 누르고 말하기가 쓸 마이크를 고른다 — InstantBroadcast 에서 떼어 낸 규칙(시험할 수 있게).
// ── **마이크 자동 고르기** (사용자 신고 2026-09-18) ────────────────────────────────────────────
// *"한번 마이크 잘못 고르면 계속 못쓰는거잖아, 자동으로 마이크 줌처럼 되는것 잡아주면 안돼?"*
// 브라우저는 Windows **기본 녹음 장치**를 쓴다. 그것이 소리 없는 장치(가상 오디오·스테레오 믹스 등)면
// 오류 없이 **완전한 무음**을 받아, 차임만 나가고 목소리는 안 나갔다(서버 로그에 청크가 한 줄도 없었다).
//
// 규칙: ① 지난번에 고른 마이크가 있으면 그것부터 연다. ② 0.4초 동안 신호가 **아예 없으면**(디지털 무음)
// 다른 마이크를 차례로 열어 신호가 있는 첫 것으로 바꾸고 **기억한다**. ③ 다 무음이면 처음 것을 그대로 쓴다
// (마이크 음소거 스위치일 수 있다 — 방송 자체를 막지는 않는다).
// **조용한 방의 진짜 마이크는 무음이 아니다**(바닥 잡음이 있다). 그래서 문턱은 사실상 「0 인가」다.
//
// `신호있나` 는 **셋**을 낸다 — true(있다) · false(무음) · null(못 쟀다). 못 잰 것을 「있다」로 뭉개면
// 방향이 자리마다 반대가 된다: 처음 연 마이크는 못 쟀다고 버리면 안 되지만(멀쩡한 마이크를 버린다),
// **후보는 못 쟀다고 채택하면 안 된다**(무음일 수도 있는 것을 기억해 굳힌다). 그래서 갈라 둔다.
export const 마이크키 = 'carecast:micDeviceId'
const 무음문턱 = 1e-6

// ── **소리를 되받는 장치는 마이크가 아니다** (적대적 검수 2026-09-18) ──────────────────────
// 「스테레오 믹스」·가상 오디오 케이블처럼 **지금 나가는 소리를 그대로 입력으로 돌려주는** 장치가 있다.
// 그런 장치는 BGM 이나 방송이 나가는 중이면 **신호가 가득**하므로, 아래 무음 검사만으로는 진짜 마이크와
// 구별되지 않는다. 노트북 마이크가 하드웨어 음소거(F4)인 상태에서 한 번 뽑히면 **그것을 기억해서**
// 그 뒤로는 홀에 사람 목소리 대신 스피커 소리가 되돌아 나간다(하울링). 고치려던 신고
// *"한번 마이크 잘못 고르면 계속 못쓰는거잖아"* 를 이 기능이 스스로 만들어 내는 자리였다.
// 이름으로 거른다 — 브라우저가 「이건 되받는 장치다」를 알려주는 표준 값이 없다.
const 되받는이름 = /스테레오\s*믹스|스테레오믹스|stereo\s*mix|what\s*u\s*hear|wave\s*out|루프백|loopback|가상\s*오디오|virtual\s*(audio|cable)|vb-?audio|voicemeeter|cable\s*output|재생\s*리디렉션|mix에서 녹음/i

export function 되받는장치(이름) {
  return 되받는이름.test(String(이름 || ''))
}

export async function 신호있나(stream, ms = 400, AC = globalThis.AudioContext) {
  let ctx = null
  try {
    ctx = new AC()
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    if (ctx.state !== 'running') return null   // 못 쟀다 — 「있다」와 구별한다(아래 주석)
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    const 끝 = Date.now() + ms
    while (Date.now() < 끝) {
      await new Promise((r) => setTimeout(r, 60))
      an.getFloatTimeDomainData(buf)
      for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > 무음문턱) return true
    }
    return false
  } catch {
    return null   // 못 쟀다
  } finally {
    ctx?.close().catch(() => {})
  }
}

/** 저장해 둔 id 의 장치 이름을 찾는다 — 목록을 못 읽으면 빈 문자열(그러면 거르지 않는다). */
async function 이름찾기(deviceId, md) {
  try {
    const 목록 = await md.enumerateDevices()
    return 목록.find((d) => d.deviceId === deviceId)?.label || ''
  } catch { return '' }
}

function 마이크열기(deviceId, md) {
  const 고름 = deviceId ? { deviceId: { exact: deviceId } } : {}
  return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...고름 }, video: false })
    .catch(() => md.getUserMedia({ audio: deviceId ? 고름 : true, video: false }))
}

/** 의존은 시험용 이음새 — 화면에서는 기본값(브라우저 것)을 쓴다. */
export async function 마이크고르기({ md = globalThis.navigator?.mediaDevices, 저장소 = globalThis.localStorage, 재기 = 신호있나 } = {}) {
  let 저장 = null
  try { 저장 = 저장소.getItem(마이크키) } catch { /* 못 읽으면 기본 장치부터 */ }
  let stream = null
  // 예전 판이 되받는 장치를 기억해 뒀을 수 있다 — 그 값은 버리고 기본 장치부터 다시 고른다(스스로 풀린다).
  if (저장 && 되받는장치(await 이름찾기(저장, md))) {
    try { 저장소.removeItem(마이크키) } catch { /* 못 지워도 아래에서 안 쓴다 */ }
    저장 = null
  }
  if (저장) stream = await 마이크열기(저장, md).catch(() => null)   // 그 장치가 빠졌으면 기본 장치로
  if (!stream) stream = await 마이크열기(null, md)                 // 권한 거부 등은 그대로 던진다 — 화면이 이유를 말한다
  const 지금id = stream.getAudioTracks()[0]?.getSettings?.().deviceId
  let 목록 = []
  try { 목록 = (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId) } catch { /* 목록이 없으면 처음 것을 쓴다 */ }

  // **기본 장치가 되받는 장치면 신호가 있어도 다른 것을 찾는다.** Windows 기본 녹음 장치가
  // 「스테레오 믹스」로 잡혀 있는 PC 가 있다 — 그때는 무음 검사를 통과해 버리므로(소리가 흐르니까)
  // 아래 후보 가드만으로는 못 막는다. 대신 대안이 없으면 이 스트림을 그대로 쓴다(방송은 막지 않는다).
  const 지금되받나 = 되받는장치(목록.find((d) => d.deviceId === 지금id)?.label)
  if (!지금되받나 && (await 재기(stream)) !== false) return stream   // 못 쟀으면(null) 그대로 쓴다
  for (const d of 목록) {
    if (d.deviceId === 지금id || d.deviceId === 'default' || d.deviceId === 'communications') continue
    if (되받는장치(d.label)) continue   // 스피커 소리를 되돌려주는 장치 — 신호가 있어도 마이크가 아니다
    const 후보 = await 마이크열기(d.deviceId, md).catch(() => null)
    if (!후보) continue
    if ((await 재기(후보)) === true) {   // **못 쟀으면 채택하지 않는다** — 기억까지 하는 자리라서다
      stream.getTracks().forEach((t) => t.stop())
      try { 저장소.setItem(마이크키, d.deviceId) } catch { /* 기억 못 해도 이번 방송은 나간다 */ }
      console.info(`[즉시방송] 기본 마이크가 ${지금되받나 ? '스피커 소리를 되받는 장치라' : '무음이라'} 다른 마이크로 바꿨습니다:`, d.label || d.deviceId)
      return 후보
    }
    후보.getTracks().forEach((t) => t.stop())
  }
  return stream
}
