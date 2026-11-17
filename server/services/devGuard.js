// **개발 콘솔 라우트의 바꾸기·실행은 이 PC 에서만 받는다** (2026-11-10 추가 점검).
//
// 개발 기록·개선 제안·코칭 브리프·구성도는 개발자가 쓰는 화면인데, 인증 없이 열려 있어서 같은
// 네트워크의 아무 기기(직원 휴대폰 포함)나 수정·삭제할 수 있었다. 그중 「지금 점검」(run-verify)은
// 방송 PC 에서 npm build·테스트를 돌리고, 「구성도 다시 만들기」는 스크립트를 띄운다 — 운영 중인
// 화면 파일(dist)을 다시 만들고 CPU 를 오래 붙잡아 정시 방송을 밀 수 있다.
//
// **읽기(GET·HEAD)는 그대로 둔다** — 원격 PC 의 관리 화면이 목록을 보는 것은 막을 이유가 없다.
// 이 PC 판정은 소리 담당 판정과 **같은 함수**(`sse.isLocalRequest` — 요청이 들어온 주소)를 쓴다.
'use strict'

const { isLocalRequest } = require('./sse')

function 이PC에서만바꾸기(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || isLocalRequest(req)) return next()
  return res.status(403).json({ error: '개발 도구는 서버가 도는 이 PC 에서만 바꾸거나 실행할 수 있습니다.' })
}

module.exports = { 이PC에서만바꾸기 }
