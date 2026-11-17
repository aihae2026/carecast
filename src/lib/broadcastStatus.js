// 이력 행의 success 값을 화면이 쓰는 상태 문자열로 옮긴다.
//
// 화면에서 떼어낸 이유: 이 저장소에는 프론트엔드 테스트 러너가 없다. 렌더링은 못 덮어도
// "무엇으로 보일지"는 순수 함수로 만들면 node --test로 덮을 수 있다
// (server/test/flow-outcome.test.js의 '화면이 든 상태 값 사본이 서버와 같다'가 이 파일의
//  숫자를 서버 상수와 실제로 대조한다 — 2026-09-05까지는 그 대조가 **없었는데** 이 주석만
//  있었다. 갈리면 이력 화면이 거짓 상태를 보여준다).
// alertStore.js와 같은 방식이다.
//
// 값의 뜻은 server/domain/broadcastOutcome.js가 단일 출처다.
//   0 = 실패    1 = 성공    2 = 진행 중(아직 나갔다는 증거 없음)
//
// **모르는 값은 성공으로 봐주지 않는다.** 이 화면이 존재하는 이유가 "안 나간 방송을
// 알아채는 것"이라, 애매할 때 성공 쪽으로 기울면 화면을 만든 의미가 없어진다.

export const SUCCEEDED = 1
export const RUNNING   = 2

export function statusOf(success) {
  if (success === SUCCEEDED) return 'success'
  if (success === RUNNING)   return 'running'
  return 'fail'
}
