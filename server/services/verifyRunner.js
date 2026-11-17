'use strict'

// "지금 점검 실행" 버튼이 npm run verify를 돌린 결과를 실행기록(checkin_runs)에 남길 형태로 요약한다.
// exec() 콜백을 직접 테스트하기 부담스러워서(진짜로 verify를 재귀 실행해야 함) 순수 요약 로직만 분리했다.
function summarizeVerifyResult(err, stdout, stderr) {
  const passed = !err
  const combined = `${stdout || ''}${stderr || ''}`.trim()
  const tail = combined.split('\n').slice(-15).join('\n')
  return {
    result: passed ? 'auto_verified' : 'failed',
    note: tail || (passed ? 'npm run verify 통과' : 'npm run verify 실패'),
  }
}

module.exports = { summarizeVerifyResult }
