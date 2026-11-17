// 코칭 브리프 화면이 서버를 부르는 얇은 배관 + 날짜 표시 하나.
//
// ImprovementProposals.jsx(1,280줄)에서 옮겨 왔다(2026-09-05, TD-10 기회식).
// **옮기기만 했고 동작은 바꾸지 않았다.**
//
// **왜 .js인가**: 아래 것들을 카드 파일 셋과 본체가 나눠 쓴다. 컴포넌트와 같은 .jsx에서
// 내보내면 Fast Refresh가 깨진다(eslint react-refresh/only-export-components).
// TD-10에서 MorningEditor가 3분할이 아니라 4분할이 된 것과 같은 이유다.

import { apiGet, apiPost, apiPut, apiDelete } from '../../../lib/api'

const BRIEF_API = '/api/dev/brief'
const briefGet    = (path)       => apiGet(`${BRIEF_API}${path}`)
const briefPost   = (path, body) => apiPost(`${BRIEF_API}${path}`, body)
const briefPut    = (path, body) => apiPut(`${BRIEF_API}${path}`, body)
const briefDelete = (path)       => apiDelete(`${BRIEF_API}${path}`)
const startVerifyRun       = () => apiPost(`${BRIEF_API}/checkins/run-verify`, {})
const fetchVerifyRunStatus = () => apiGet(`${BRIEF_API}/checkins/run-verify/status`)

function fmtDate(d) {
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

export { BRIEF_API, briefGet, briefPost, briefPut, briefDelete, startVerifyRun, fetchVerifyRunStatus, fmtDate }
