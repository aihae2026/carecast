'use strict'

// 진단 URL 에서 키를 지운다. **원래 글자와 인코딩된 모습을 모두** 지운다 —
// `URLSearchParams` 가 `+`·`/`·`=` 를 `%2B`·`%2F`·`%3D` 로 바꾸므로 원래 글자만
// 찾으면 한 글자도 안 걸린다. 이 값은 진단 패널이 화면에 그대로 띄운다.
// 질의 이름으로도 한 번 더 훑어서, 키를 못 알아본 경우에도 값이 안 남게 한다.
function 키가리기(url, 키, 가린것) {
  let s = String(url)
  for (const 모습 of [키, encodeURIComponent(키)]) {
    if (모습) s = s.split(모습).join(가린것)
  }
  // 질의 이름으로 한 번 더 — 키를 못 알아본 경우에도 값이 안 남게 한다.
  s = s.replace(/([?&][\w.-]*(?:key|secret|token)[\w.-]*=)[^&\s]+/gi, '$1***')
  // **조각도 지운다.** 응답이 잘려 키가 반만 실려 오면 위의 통째 검색이 못 본다.
  // 키가 넉넉히 길 때만(16자 이상) 앞 12자를 단서로 삼는다 — 짧은 키에 이 그물을
  // 쓰면 평범한 글자열까지 지운다.
  if (키 && 키.length >= 16) {
    for (const 모습 of [키, encodeURIComponent(키)]) {
      const 앞 = 모습.slice(0, 12)
      if (앞.length >= 12) s = s.split(앞).join(가린것)
    }
  }
  return s
}

module.exports = { 키가리기 }
