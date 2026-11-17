import { useState } from 'react'

// 초·횟수 같은 **정수 한 칸**. 선재생 초·대기 초·곡 재생시간이 같은 칸을 쓴다.
//
// 왜 만들었나(2026-09-02): 현장에서 "0이 막고 있어서 010이 된다"는 신고. 원인은 React의
// number 입력 특성이다 —
//   값이 10인 칸에서 커서를 맨 앞에 두고 0을 치면 화면은 "010"이 되고, 처리기는
//   `Number("010")` = 10을 상태에 넣는다. **상태가 10에서 10으로 안 바뀌므로 React는
//   다시 그릴 것이 없다고 보고 화면의 "010"을 그대로 둔다.** 숫자로만 받으면 이 틈이
//   구조적으로 안 닫힌다(문자열 상태로 바꿔도 "10"→"10"이라 똑같이 막힌다).
// 그래서 **앞자리 0을 지운 값을 DOM에 직접 써 준다.** 리액트답지 않아 보이지만, 화면과
// 상태가 갈라지는 이 경우에는 이것이 정확한 처방이다.
//
// 자르는 시점은 RateInput과 같은 규칙을 따른다: **입력 중에는 안 자르고, 칸을 벗어나거나
// Enter를 칠 때 범위 안으로 자른다.** 입력 중에 자르면 "8"을 치는 순간 최소값으로 튄다.
// 지우고 다시 적는 것도 막으면 안 되므로 빈 칸을 잠시 허용한다.
export default function NumBox({
  value, onChange, min = 0, max = 9999, className = '', title, onClick,
}) {
  const [text, setText] = useState(String(value ?? min))
  // 바깥에서 값이 바뀌면(다른 단계 선택 등) 칸도 따라간다. useEffect로 setState 하면 렌더가
  // 한 번 더 돌고 lint에도 걸린다 — RateInput과 같은 "렌더 중 조정"을 쓴다.
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(String(value ?? min)) }

  const commit = () => {
    if (text === '') { setText(String(value ?? min)); return }   // 빈 칸으로 두면 이전 값으로 되돌린다
    const n = Math.min(max, Math.max(min, Math.trunc(Number(text) || 0)))
    setText(String(n))
    if (n !== value) onChange(n)
  }

  return (
    <input
      type="number" min={min} max={max} value={text} title={title} onClick={onClick}
      onChange={e => {
        const raw = e.target.value
        // "010" → "10". 이 한 줄이 없으면 숫자로는 같은 값이라 화면이 안 고쳐진다(위 주석).
        const cleaned = raw.replace(/^0+(?=\d)/, '')
        if (cleaned !== raw) e.target.value = cleaned
        setText(cleaned)
        const n = Number(cleaned)
        // 입력 중에는 범위를 안 자른다. 다만 숫자로 읽히는 값이면 바로 위로 올려 보내
        // 미리보기·소요시간 계산이 타이핑에 따라 살아 움직이게 한다.
        if (cleaned !== '' && Number.isFinite(n) && n !== value) onChange(n)
      }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } }}
      className={className}
    />
  )
}
