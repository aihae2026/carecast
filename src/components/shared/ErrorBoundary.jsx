import { Component } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { 터진상태, 초기화할까, 그릴것, 기록하기 } from '../../lib/errorBoundaryState'

// 한 칸이 터져도 **옆 칸으로는 방송이 나가야 한다** (UX-44, 2026-09-11).
//
// 이 저장소에는 오류 경계가 **한 개도 없었다.** React 는 렌더 중 예외가 나면 트리 전체를
// 언마운트한다 — 즉 BGM 카드 하나가 `undefined.map` 으로 터지면 **쉬운 화면이
// 통째로 흰 화면**이 되고, 그 순간 현장 선생님은 차임벨도 즉시방송도 못 누른다.
// 요양원에서 흰 화면은 "방송을 못 내보내는 상태"다.
//
// 네트워크 실패 자체는 대개 `catch` 로 잡혀 있다. 위험한 것은 그 **다음**이다 —
// 실패로 상태가 비어 있는 채로 렌더가 돌 때. 그래서 방어선을 렌더 쪽에 둔다.
//
// **조용히 삼키지 않는다.** 화면에는 사람이 할 수 있는 다음 행동을 주고, 콘솔에는
// 원문을 남긴다. 무엇이 터졌는지 모르는 초록은 이 저장소가 가장 싫어하는 것이다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null, resetKey: props.resetKey }
  }

  // 판단은 `src/lib/errorBoundaryState.js` 에 있다 — 거기서 **실제로 실행해** 검증한다.
  // 여기 그대로 적으면 소스 문자열로만 확인하게 되고, 늘 null 을 돌려주는 회귀를 못 잡는다.
  static getDerivedStateFromError(err) {
    return 터진상태(err)
  }

  // 섹션을 옮기면(관리자 화면) 다시 그려 볼 기회를 준다 — 사람이 버튼을 또 누르게 하지 않는다.
  static getDerivedStateFromProps(props, state) {
    return 초기화할까(props, state)
  }

  componentDidCatch(err, info) {
    기록하기(this.props.이름, err, info?.componentStack)
  }

  render() {
    // 무엇을 그릴지도 `errorBoundaryState` 가 정한다 — 거기서 실제로 실행해 검증한다.
    // **오버레이·재생 host 층은 화면에 아무것도 안 띄운다**(`조용히`): 그 층들은 방송
    // 화면 **위에** 그려지므로 오류 카드를 띄우면 방송을 덮는다. 콘솔에는 그대로 남는다.
    const 뭘 = 그릴것(this.state, this.props)
    if (뭘 === 'children') return this.props.children
    if (뭘 === null) return null

    const 이름 = this.props.이름 ?? '이 칸'
    return (
      <div className="card-base p-4 flex flex-col items-center text-center gap-3">
        <AlertTriangle size={22} className="text-ds-v3-ink-2" />
        <div>
          <p className="text-sm font-semibold text-ds-v3-ink">{이름}을 못 그렸습니다</p>
          <p className="text-xs text-ds-v3-ink-2 mt-1 leading-relaxed">
            다른 기능은 그대로 씁니다. 이 칸만 다시 그려 보거나, 새로고침하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ err: null })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-ds-v3-line
                     text-xs font-normal text-ds-v3-ink-2 active:bg-ds-v3-bg transition-colors
                     min-h-[44px] min-w-[44px] justify-center"
        >
          <RotateCw size={14} />
          다시 시도
        </button>
      </div>
    )
  }
}
