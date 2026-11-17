'use strict'

// 개발일지(devlog)에서 항상 자동으로 숨길 커밋 스코프.
// dev-console(고도화 제안/코칭 브리프 등 개발자 전용 도구) 관련 커밋은
// CareCast의 실제 기능 개발 기록이 아니라서 매번 수동으로 숨길 필요 없이 여기서 걸러낸다.
const AUTO_HIDDEN_SCOPES = new Set(['dev-console'])

// 'feat(dev-console): 설명' 형태의 커밋 제목에서 category/scope를 추출한다.
function parseCommit(subject) {
  const m = subject.match(/^(feat|fix|refactor|docs|chore|style|test|build|ci|perf|revert)(?:\((.+?)\))?:\s*/i)
  return {
    category: m ? m[1].toLowerCase() : null,
    scope: m && m[2] ? m[2].toLowerCase() : null,
  }
}

function isAutoHiddenScope(scope) {
  return !!scope && AUTO_HIDDEN_SCOPES.has(scope)
}

// 페이징 파라미터(limit/offset)는 git 명령 문자열에 그대로 들어가므로,
// 정수가 아니면 통째로 기본값으로 떨어뜨리고 범위도 강제로 자른다.
function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

module.exports = { parseCommit, isAutoHiddenScope, clampInt, AUTO_HIDDEN_SCOPES }
