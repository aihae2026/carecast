// 자동방송 편집에서 **BGM 을 TTS 단계 안의 토글로 보여주기 위한 짝짓기 규칙** (UX-16, 2026-09-11).
//
// 사용자 원문: *"자동순서편집기에 BGM이랑 TTS같이 있으니까 더 헷갈리는것 같아 그냥 TTS인데,
// 안에 토글로 BGM이 내제될 수 있게 하면 …"*
//
// ── **이것은 화면에서만 접는 일이다. 나가는 소리는 한 톨도 안 바뀐다.** ────────────
//
// 단계 배열(`steps`)을 **건드리지 않는다.** 서버 시퀀서(`broadcastSteps.js`)는 여전히
// 같은 배열을 같은 순서로 돌고, BGM 단계는 여전히 제 차례에 제 일을 한다.
// 이 모듈이 하는 일은 "화면에서 이 BGM 카드를 어느 TTS 카드 안에 접어 넣을까"뿐이다.
//
// **왜 이 경계를 지키나**: 자동방송 5종은 현장에서 매일 나가는 방송이다. 편집기 화면이
// 헷갈린다는 이유로 실행 모델을 바꾸면, 고치려던 것(헷갈림)보다 훨씬 비싼 것(방송이 달라짐)을
// 건드리게 된다. 헌장 §11 이 "부작용 기능의 문안·시각·대상이 바뀌는 변경은 반드시 묻는다"고
// 적은 자리다. 화면만 접는 것은 그 대상이 아니고, 되돌리기도 쉽다.
//
// ── 짝짓기 규칙 ─────────────────────────────────────────────────────────────
//
// **BGM 단계는 "바로 다음 줄"이 TTS 일 때만 그 카드에 접힌다.** 건너뛰며 찾지 않는다.
// TTS 판별은 `hasTtsInline` 이 정한다([FACT] `morningEditorConst.js:37-50` 의
// `TTS_STEP_KEYS` 12개 + `customType==='tts'|'message'`).
//
// ── **왜 "붙어 있을 때만"인가 — 이것이 이 모듈의 급소다** ──────────────────────
//
// 처음엔 "뒤에 오는 **첫** TTS" 를 찾아 건너뛰며 붙였다. 그러면 **카드 순서가 배열 순서를
// 거짓으로 보여준다.** 아침이 정확히 그 모양이다:
//
//   배열 : bgm(0) · date_weather_schedule(1) · morning_prayer_intro(2) · …
//   카드 : [날씨 안내] · [BGM+아침 안내] · …        ← BGM 이 날씨보다 **뒤**로 보인다
//
// `date_weather_schedule` 은 화면엔 TTS 처럼 보이지만 `TTS_STEP_KEYS` 에 **없다.**
// 그래서 건너뛰기 규칙은 BGM 을 그 너머로 데려갔고, 카드 순서를 그대로 펼치면
// **원래 배열과 달라졌다.** `카드이동` 은 카드 순서로 덩어리를 재조립하므로 —
//
//   [FACT] EV-003906 — 맨 뒤 카드를 한 칸 위로 옮기기만 해도 **건드리지도 않은 앞쪽 3줄이
//   바뀌었고**, 아침 BGM 이 날씨 안내 **앞 → 뒤**로 밀렸다. 나가는 소리가 바뀐 것이다.
//
// **붙어 있을 때만 접으면 이 문제가 통째로 사라진다.** 카드 하나가 배열에서 **연속한 구간**이
// 되므로 카드 순서 = 배열 순서가 **구조적으로** 보장된다. `시작`·`index`·이동·삽입이 전부
// 그 위에서 저절로 맞는다 — 규칙 하나로 막는 쪽이 검사 넷으로 막는 쪽보다 낫다.
//
// 실제 기본 순서에서 **10개 중 9개가 이미 붙어 있다**([FACT] EV-003905):
//   아침     bgm(0) **안 접힘**(날씨 안내가 끼어 있다)  ·  bgm_after(5)→medication_tts(6)
//   체조     bgm(0)→exercise_tts(1)
//   점심     bgm_start(0)→lunch_tts(1)         ·  bgm(6)→medication_tts(7)
//   저녁     bgm_start(0)→dinner_tts(1)        ·  bgm(4)→medication_tts(5)
//   마무리   bgm(0)→evening_prayer_tts(1) · bgm_closing(3)→evening_prayer_tts2(4)
//            · bgm_final(6)→evening_closing_tts(7)
//
// 안 접히는 하나(아침 첫 BGM)는 **제 카드로 남는다. 그게 맞다** — 그 BGM 은 날씨 안내
// 밑에도 깔리므로, 아침 첫 안내 카드 안에 넣으면 카드가 말하는 범위와 실제 범위가 달라진다.
//
// **짝을 못 찾으면 접지 않는다.** 사람이 순서를 바꿔 BGM 을 맨 뒤로 옮겼거나 뒤에 TTS 가
// 하나도 없으면 그 BGM 은 **제 카드로 남는다.** 억지로 아무 데나 붙이면 화면이 거짓말을 한다.
//
// **BGM 단독 방송은 접지 않는다**(`customType === 'bgm'`). 사용자 원문이
// *"BGM 단독 방송은 그대로 남는다"* 로 못 박은 것이고, 그것은 TTS 에 딸린 반주가 아니라
// 그 자체로 하나의 방송이다.
'use strict'

/**
 * 화면에 그릴 카드 목록을 만든다.
 *
 * **입력 배열을 절대 바꾸지 않는다** — 원소도 새로 뜨지 않고 그대로 참조한다.
 * (여기서 `{...step}` 으로 사본을 만들면 호출부의
 *  `steps.map(s => s.id === id ? {...s, x} : s)` 갱신이 **다른 객체**를 보게 되어
 *  화면은 바뀌는데 저장은 안 되는 종류의 어긋남이 난다.)
 *
 * @param {Array<object>} steps 단계 배열. 화면에 보이는 순서 그대로.
 * @param {(step:object)=>boolean} isBgm 붙박이 BGM 단계인가 (`hasBgmInline`)
 * @param {(step:object)=>boolean} isTts TTS 단계인가 (`hasTtsInline`)
 * @returns {Array<{step:object, bgm:object|null, index:number}>}
 *   `bgm` 이 있으면 그 카드는 TTS 카드이고 BGM 을 안에 접어 넣는다.
 *   접힌 BGM 은 목록에 **따로 나오지 않는다** — 같은 것이 두 번 보이면 안 된다.
 *
 *   **`index` 는 원래 배열에서의 자리다.** 화면이 이것을 그대로 써야 한다 —
 *   드래그 정렬(`moveStep(from, to)`)과 카드 사이 ＋ 삽입이 **배열 번호**로 도는데,
 *   접혀서 짧아진 카드 목록의 번호를 넘기면 **엉뚱한 자리로 옮겨진다.** 화면에서만
 *   접는다는 이 모듈의 전제가 깨지는 유일한 자리라 값을 여기서 실어 보낸다.
 *   접기 때문에 번호가 띄엄띄엄해지는 것은 정상이다.
 */
export function 카드묶기(steps, isBgm, isTts) {
  const 목록 = Array.isArray(steps) ? steps : []
  const 붙는곳 = new Map()   // TTS 의 배열 위치 → 그 앞의 BGM 단계
  const 접힘 = new Set()     // 접혀 들어간 BGM 의 배열 위치

  for (let i = 0; i < 목록.length; i++) {
    const s = 목록[i]
    if (!s || s.customType === 'bgm' || !isBgm(s)) continue   // 단독 BGM 은 그대로 둔다
    // **바로 다음 줄만 본다.** 건너뛰며 찾지 않는다 — 왜인지는 머리말의 "붙어 있을 때만" 참고.
    const t = 목록[i + 1]
    if (t && isTts(t) && !붙는곳.has(i + 1)) { 붙는곳.set(i + 1, s); 접힘.add(i) }
  }

  const 카드 = []
  for (let i = 0; i < 목록.length; i++) {
    if (접힘.has(i)) continue
    const bgm = 붙는곳.get(i) ?? null
    // `시작` 은 **카드가 배열에서 시작하는 자리**다. BGM 이 접혀 있으면 그 BGM 의 자리다.
    // 카드 사이 ＋ 가 이 값을 써야 새 단계가 **카드 위**에 들어간다 — `index` 를 쓰면
    // 접힌 BGM 과 TTS **사이**로 끼어들어 새 단계가 그 BGM 을 가져가 버린다
    // (2026-09-11 독립 검수 지적, 재현 3).
    카드.push({ step: 목록[i], bgm, index: i, 시작: bgm ? 목록.indexOf(bgm) : i })
  }
  return 카드
}

/**
 * **카드를 옮긴다 — 접힌 BGM 을 데리고 간다** (UX-16 후속, 2026-09-11).
 *
 * 접기만 하고 이동을 그대로 두면 조용히 어긋난다. 화면에서는 카드 하나를 끄는데
 * 배열에서는 **TTS 한 줄만** 움직이고 BGM 은 원래 자리에 남는다. 그러면:
 *   · 남은 BGM 은 그 자리의 **다음 TTS** 에 가서 붙는다 — 화면상 엉뚱한 안내에 반주가 달린다
 *   · 옮겨 간 TTS 는 반주를 잃는다
 *   · **방송 순서가 사람이 의도한 것과 달라진다** — "화면만 접는다"는 이 기능의 전제가
 *     깨지는 유일한 자리다
 *
 * 그래서 이동은 **카드 단위**로 한다. `[BGM, TTS]` 는 한 덩어리로 움직인다.
 *
 * @param {Array<object>} steps 원래 배열
 * @param {number} from 끄는 카드의 **배열 번호**(`카드묶기` 가 준 `index`)
 * @param {number} to   놓을 자리의 **배열 번호**
 * @returns {Array<object>} 새 배열. 옮길 것이 없으면 **원본을 그대로 돌려준다**(참조 동일)
 */
export function 카드이동(steps, from, to, isBgm, isTts) {
  const 목록 = Array.isArray(steps) ? steps : []
  if (from === to) return 목록

  const 카드 = 카드묶기(목록, isBgm, isTts)
  const 덩어리 = 카드.map((c) => (c.bgm ? [c.bgm, c.step] : [c.step]))
  const 출발 = 카드.findIndex((c) => c.index === from)
  const 도착 = 카드.findIndex((c) => c.index === to)
  // 카드가 아닌 번호(= 접힌 BGM 자체)를 받으면 아무것도 안 한다 —
  // 억지로 옮기면 짝이 깨진다. 접힌 BGM 은 애초에 끌 수 없다(카드가 없다).
  if (출발 < 0 || 도착 < 0 || 출발 === 도착) return 목록

  const [옮길것] = 덩어리.splice(출발, 1)
  덩어리.splice(도착, 0, 옮길것)
  return 덩어리.flat()
}

/**
 * 접힌 BGM 의 한 줄 요약 — TTS 카드 머리에 배지로 건다.
 * **꺼져 있으면 그 사실을 먼저 말한다** — 꺼진 것이 켜진 것처럼 보이면 안 된다.
 *
 * @param {object|null} bgm 접힌 BGM 단계
 * @param {Array<{id:string,label:string}>|((bgm: object) => string|null)} 용도목록 이름 목록, 또는 단계 → 폴더 이름
 */
export function bgm요약(bgm, 용도목록 = []) {
  if (!bgm) return ''
  if (!bgm.enabled) return 'BGM 꺼짐'
  // 용도를 안 고른 단계는 서버가 방송 종류로 정한다 — 여기서 짐작해 적지 않는다.
  // 이름 찾기는 함수로도 받는다(2026-09-22) — 폴더 이름은 사람이 바꾸므로 부르는 쪽이 서버 목록에서 찾아 준다.
  const 이름 = (typeof 용도목록 === 'function' ? 용도목록(bgm) : 용도목록.find((o) => o.id === bgm.bgmRole)?.label) || 'BGM'
  const 초 = Number(bgm.durationSec) || 0
  return 초 > 0 ? `${이름} · ${초}초` : 이름
}
