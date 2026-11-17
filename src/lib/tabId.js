// 이 창(탭)을 가리키는 이름표.
//
// 왜 따로 뺐나: 서버가 "소리 담당"을 정하려면 각 창을 구별할 이름이 필요한데, 그 이름을
// App.jsx 안에 두면 SSE를 여는 lib/api.js가 볼 수 없다. 두 곳이 각자 만들면 서버가 지목한
// 창과 실제로 재생하는 창이 어긋나 **아무도 소리를 안 낸다.** 이름표는 한 곳에서만 만든다.
//
// sessionStorage에 두는 이유: 새로고침해도 같은 이름을 유지해야 한다. 새로고침마다 이름이
// 바뀌면 서버가 방금 지목한 담당이 사라진 것으로 보이고, 그때마다 담당이 옮겨 다니며
// 재생이 끊긴다. 창을 닫으면 사라지는 것이 맞다 — 그 창은 정말로 없어진 것이다.
//
// 창마다 값이 다르다(sessionStorage는 탭 단위). 그래서 같은 PC에 창을 두 개 열면 서버가
// 둘을 구별할 수 있고, **접속 주소가 달라도**(localhost / 127.0.0.1) 서버 쪽 목록은
// 하나이므로 담당도 하나다 — 예전에 겹쳐 들리던 빈틈이 여기서 닫힌다.

const KEY = '_cct_id'

function make() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const TAB_ID = (() => {
  try {
    const saved = sessionStorage.getItem(KEY)
    if (saved) return saved
    const id = make()
    sessionStorage.setItem(KEY, id)
    return id
  } catch {
    // 사생활 모드·용량 초과 등으로 못 읽는 환경 — 새로고침하면 이름이 바뀌지만
    // 그래도 창끼리는 구별된다. 이름이 아예 없는 것보다 낫다.
    return make()
  }
})()

// 이 창이 **소리 담당이 될 수 있는가.**
//
// 모니터링 팝업(/monitor)과 개발 콘솔(/dev-console)은 읽기 전용 화면이라 재생 코드를
// 아예 타지 않는다. 그런 창이 담당으로 뽑히면 **아무도 소리를 안 낸다** — 겹쳐 들리는
// 것보다 훨씬 나쁜 사고다. 그래서 서버에 이름표를 아예 보내지 않는다(이름표 없는 창은
// 서버가 담당 후보에서 뺀다).
export const CAN_OWN_SOUND = (() => {
  try {
    const p = window.location.pathname
    // 개발 콘솔은 하위 주소(구성도 상세)도 같은 화면이다 — startsWith로 본다.
    return p !== '/monitor' && !p.startsWith('/dev-console')
  } catch { return true }
})()
