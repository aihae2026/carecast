// 이 창이 **현장 PC(localhost)에서 열렸는가.**
//
// App.jsx 안에 있던 한 줄인데, 방송 SSE 처리기(hooks/useScheduledBroadcast)가 App.jsx 밖으로
// 나오면서 두 곳이 같은 값을 봐야 하게 됐다. 각자 만들면 tabId.js가 적어 둔 사고와 같은
// 빈틈이 열린다 — 한쪽만 고쳤을 때 서버가 지목한 창과 실제로 재생하는 창이 어긋난다.
// 현장 PC(localhost)에서만 leader 선출 — 리모트 PC는 항상 방송 처리
export const _IS_LOCAL   = ['localhost', '127.0.0.1'].includes(window.location.hostname)
