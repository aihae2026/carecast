// 오류 경계의 **판단**만 떼어 둔 곳 (UX-44, 2026-09-11).
//
// 왜 따로 두나 — 경계는 클래스 컴포넌트라 React 렌더 없이는 못 돌린다. 이 저장소에는
// jsdom·react-test-renderer 가 없고, 의존성을 더하는 것은 승인 대상이다(헌장 §9).
// 그래서 **판단을 순수 함수로 내려** 실제로 실행해 본다. 소스 문자열만 보는 가드는
// `getDerivedStateFromProps` 가 늘 null 을 돌려줘도 통과한다 — Codex 독립 검수가
// 정확히 그 점을 짚었다(2026-09-11, EV-004516).
//
// `src/lib/setupRules.js`·`bgmFade.js`·`volumeDefaults.js` 와 같은 자리다.

// 렌더에서 터졌을 때의 상태.
export function 터진상태(err) {
  return { err }
}

// props 가 바뀌었을 때 경계를 스스로 풀지 정한다.
//
// **같은 resetKey 면 null 을 돌려준다.** null 은 "상태를 그대로 두라"는 뜻이라,
// 여기서 매번 객체를 돌려주면 fallback 이 뜬 그 프레임에 바로 다시 그리려 들고
// 같은 오류가 또 나서 **무한 재시도**가 된다. 그게 이 함수의 가장 위험한 실패다.
export function 초기화할까(props, state) {
  if (props.resetKey !== state.resetKey) return { err: null, resetKey: props.resetKey }
  return null
}

// 무엇을 그릴지 정한다 — `'children'` · `null`(조용히) · `'안내'`(오류 카드).
//
// 소스에 `if (this.props.조용히) return null` 이 **쓰여 있다**는 것과 그것이 **그렇게
// 돈다**는 것은 다르다. Codex 독립 검수가 그 점을 짚었다(2026-09-11, EV-004535) —
// `componentDidCatch` 첫 줄에 `return` 을 넣어 콘솔 기록을 막아도 가드 11개가 다 통과했다.
export function 그릴것(state, props) {
  if (!state.err) return 'children'
  if (props.조용히) return null
  return '안내'
}

// 오류를 어디에 남길지. **`조용히` 여도 콘솔에는 남는다** — 화면에서 자리를 옮기는 것이지
// 삼키는 것이 아니다. 콘솔을 인자로 받아서 테스트가 가짜를 넣고 실제로 확인할 수 있다.
export function 기록하기(이름, err, 스택, 콘솔 = console) {
  콘솔.error(`[화면오류] ${이름 ?? '알 수 없는 칸'}`, err, 스택)
}
