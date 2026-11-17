'use strict'
// **압축물에 개인정보가 섞여 있는지 훑는다** (2026-09-16, 제출 전 점검).
//
// 주최측 점검표: *"개인정보 및 민감정보가 포함된 원본 데이터를 업로드하지 않았습니다"*,
// *"이름, 연락처, 사진, 음성, 상담 내용 등은 삭제하거나 비식별 처리했습니다"*.
// **그 칸을 체크하려면 실제로 봐야 한다**(CLAUDE.md: 검증하지 않은 칸을 체크하지 않는다).
//
// 탐지기를 새로 만들지 않는다 — `services/promptPrivacy.js` 의 `이름찾기` 가 이미
// 어르신 실명을 찾는 일을 한다(Gemini 로 나가기 전에 가리는 그 함수다). 같은 눈으로 본다.
// **그 함수의 한계도 그대로 물려받는다** — 호칭 없는 이름은 못 찾는다. 그러니 이 검사가
// 조용하다고 "개인정보가 없다"가 아니라 **"이 그물에는 안 걸렸다"** 까지만 말한다.
const fs = require('node:fs')
const path = require('node:path')

const 대상폴더 = process.argv[2]
if (!대상폴더) { console.error('쓰는 법: node scripts/scan-package-privacy.cjs <압축 푼 폴더>'); process.exit(2) }

const { 이름찾기 } = require('../server/services/sensitiveInfo')

// 글자 파일만 본다. 그림·소리는 이 그물로 못 보고, 애초에 압축에 안 들어간다.
const 볼확장자 = /\.(js|jsx|ts|tsx|json|md|txt|html|css|bat|cjs|mjs|py|sql|yml|yaml)$/i
const 건너뛸폴더 = /(^|[\\/])(node_modules|\.git|dist|release)([\\/]|$)/

// 전화번호·주민번호처럼 모양이 분명한 것도 함께 본다.
const 모양들 = [
  { 이름: '휴대전화번호', 규칙: /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g },
  { 이름: '주민등록번호', 규칙: /\b\d{6}[-\s]?[1-4]\d{6}\b/g },
  { 이름: '이메일(개인)', 규칙: /\b[\w.+-]+@(?!example\.|noreply|users\.noreply)[\w-]+\.[\w.]{2,}\b/g },
]

function 파일들(뿌리) {
  const 나온것 = []
  const 걷기 = (여기) => {
    for (const 것 of fs.readdirSync(여기, { withFileTypes: true })) {
      const 길 = path.join(여기, 것.name)
      if (건너뛸폴더.test(길)) continue
      if (것.isDirectory()) 걷기(길)
      else if (볼확장자.test(것.name)) 나온것.push(길)
    }
  }
  걷기(뿌리)
  return 나온것
}

const 목록 = 파일들(대상폴더)
console.log(`글자 파일 ${목록.length}개를 봅니다.\n`)

const 실명걸림 = []
const 모양걸림 = []

for (const 길 of 목록) {
  let 글
  try { 글 = fs.readFileSync(길, 'utf8') } catch { continue }
  const 상대 = path.relative(대상폴더, 길)

  for (const 이름 of 이름찾기(글)) {
    실명걸림.push({ 상대, 이름 })
  }
  for (const { 이름, 규칙 } of 모양들) {
    규칙.lastIndex = 0
    const m = 글.match(규칙)
    if (m) 모양걸림.push({ 상대, 종류: 이름, 개수: m.length, 보기: m[0] })
  }
}

if (실명걸림.length) {
  console.log(`✖ 사람 이름처럼 보이는 것 ${실명걸림.length}건`)
  for (const { 상대, 이름 } of 실명걸림.slice(0, 20)) {
    // **이름 자체를 찍지 않는다** — 보고서에 옮겨 적으면 그게 또 유출이다.
    console.log(`   ${상대}  (${이름.length}자)`)
  }
} else {
  console.log('OK  사람 이름으로 걸린 것 없음')
}

if (모양걸림.length) {
  console.log(`\n✖ 연락처·번호 모양 ${모양걸림.length}건`)
  for (const { 상대, 종류, 개수, 보기 } of 모양걸림.slice(0, 20)) {
    console.log(`   ${상대}  ${종류} ${개수}건  예: ${보기.slice(0, 4)}…`)
  }
} else {
  console.log('OK  연락처·주민번호·개인 이메일 모양 없음')
}

console.log('\n※ 이 검사는 「이 그물에 안 걸렸다」까지만 말합니다 — 호칭 없는 이름은 못 찾습니다.')
process.exit(실명걸림.length || 모양걸림.length ? 1 : 0)
