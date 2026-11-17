// 테스트가 도는 동안 **앱 로그를 stdout에 쓰지 않는다.**
//
// 왜 필요했나(2026-09-03, 하루에 네 번): `npm run verify`가 assertion 실패가 아니라
// `Unable to deserialize cloned data due to invalid or unsupported version.`으로 넘어졌다.
// 매번 다른 파일이었고 단독 실행·재실행에서는 늘 통과했다.
//
// 실측한 것: 이 저장소는 테스트 파일이 179개, CPU가 12코어라 **열두 프로세스가 동시에** 돈다.
// 그 프로세스들이 합본 한 번에 앱 로그 **2945줄**(그중 한글이 2715줄)을 러너 스트림으로
// 쏟아낸다. 러너는 그 스트림에 자기 메시지를 직렬화해 실어 나르는데, 여러 자식이 멀티바이트
// 문자를 섞어 쓰는 동안 그 틀이 깨지는 것으로 보인다.
//
// 그래서 **동시성을 줄이는 대신 원인(쏟아지는 출력)을 줄인다** — 동시성을 낮추면 합본이
// 그만큼 느려지고, 느려진 합본은 결국 아무도 안 돌린다.
//
// console.error도 함께 막는다. 남은 줄을 세어 보니 대부분이 **테스트가 일부러 만든 실패**의
// 소음이었다(경보·단계 실패·자동업데이트 실패 흉내). 진짜 실패 원인은 러너가 따로 찍어 주는
// assertion 진단(error·expected·actual)에 있고, 그것은 이 억제와 무관하다.
// 로그를 눈으로 봐야 할 때: `CARECAST_TEST_VERBOSE=1 npm test`
'use strict'

if (process.env.CARECAST_TEST_VERBOSE !== '1') {
  const noop = () => {}
  // 테스트가 스스로 console.log를 바꿔치기해 검사하는 곳이 다섯 있는데(chime-types·
  // fatal-and-filelog·mac-platform-guards·settings-read-failure·spawn-error-guard),
  // 그쪽은 이 값을 자기 것으로 덮었다가 되돌리므로 영향을 안 받는다.
  // fileLog.install()도 지금 값을 감싸 파일에 쓰므로 파일 내용 검사는 그대로 통과한다.
  console.log = noop
  console.info = noop
  console.warn = noop
  console.debug = noop
  console.error = noop
}
