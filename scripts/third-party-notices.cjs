#!/usr/bin/env node
/**
 * **THIRD-PARTY-NOTICES.md 를 만든다** (사용자 지시 2026-10-07 — 「오픈소스로 열렸을 때 문제 없도록」).
 *
 * 쓰는 법: `npm run notices` (= `node scripts/third-party-notices.cjs`)
 *          `node scripts/third-party-notices.cjs --check` — 다시 만든 것과 저장소의 파일이 다르면 exit 1
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * MIT·ISC·BSD·Apache 는 모두 「복사본에 저작권 고지와 라이선스 문구를 함께 넣을 것」을 조건으로 건다.
 * 설치판은 `server/node_modules` 를 통째로 담아 각 부품의 LICENSE 가 따라가지만, **화면 쪽 부품
 * (React 등)은 `dist/` 한 덩어리로 묶여** 각자의 LICENSE 가 사라진다. 그래서 한 파일로 모아 둔다.
 *
 * ── 무엇을 담나 ──────────────────────────────────────────────────────────────
 *  · 대상: 두 잠금파일(`package-lock.json` · `server/package-lock.json`)에서 **개발용이 아닌**
 *    패키지 전부(전이 포함). 개발용(빌드·시험 도구)은 제품에 안 들어가 뺀다.
 *  · 라이선스 이름은 잠금파일 → 없으면 설치된 package.json. 그래도 없으면 그렇다고 적는다(지어내지 않는다).
 *  · 전문은 설치된 폴더의 LICENSE·LICENCE·COPYING 파일. **설치가 안 돼 있으면 그렇다고 적는다** —
 *    `--check` 가 그 차이를 잡으므로, 만들 때는 두 폴더 모두 `npm install` 된 상태여야 한다.
 *  · 같은 이름@판은 한 번만. 순서는 이름순(다시 만들어도 같은 파일이 나온다).
 *
 * 세는 법은 `scripts/measure-licenses.cjs` 와 다르다 — 그쪽은 「설치된 것을 이름 기준으로 세기」,
 * 이쪽은 「배포에 들어가는 것을 이름@판 기준으로 고지」. 목적이 달라 합치지 않는다.
 */
'use strict'

const fs = require('node:fs')
const p = require('node:path')

const ROOT = p.join(__dirname, '..')
const OUT = p.join(ROOT, 'THIRD-PARTY-NOTICES.md')
const 뿌리들 = [
  { 이름: '화면(브라우저로 나가는 묶음)', 잠금: 'package-lock.json', 폴더: '' },
  { 이름: '서버', 잠금: 'server/package-lock.json', 폴더: 'server' },
]
const 전문후보 = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i

// ── LICENSE 파일이 없는 부품 (Codex 2회차 Medium) ──────────────────────────────
// cookie-signature 는 README 의 「License」 절에, qrcode-generator 는 소스 머리말에 고지가 있다. 이름만 적으면
// MIT 의 조건(저작권 고지 + 이용허락 문구를 함께)을 못 지킨다.
//
// **자동으로 추리지 않는다** (Codex 3회차 Medium). 2회차 판은 README 의 License 절·소스 머리말을 알아서 찾아
// 붙였는데, 절이 「MIT」 한 줄뿐이거나 머리말이 다른 라이선스를 말해도 성공으로 넘어갔다. 그래서 **사람이 원문을
// 읽어 확인한 부품만** 아래 표에 이름@판으로 적고, 그 판의 정확한 자리(파일·줄)에서 가져온다. 판이 바뀌면 표에
// 없으므로 생성이 실패한다 — 다시 확인하라는 뜻이다. 모든 칸은 끝에 `맞는가()` 로 이름과 본문을 대조한다.
const MIT_표준 = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
  'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
  'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
  'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions',
  'of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
  'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF',
  'CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER',
  'DEALINGS IN THE SOFTWARE.',
].join('\n')

// 원문을 사람이 확인한 부품 (2026-10-07). `부품파일` = 설치 폴더 안 파일의 줄 범위(1부터, 끝 줄 포함),
// `저장소파일` = 이 저장소 `licenses/` 에 받아 둔 원문(설치 안 된 PC 에서도 같은 결과가 나오게).
const sherpa원문 = {
  저장소파일: ['licenses/sherpa-onnx-1.13.8-LICENSE.txt'], sha256: '283ea6cc2997a1a70da0049e09adf9317bb60ca1b51279b65196b83a69e1996b',
  출처: 'npm 꾸러미에 LICENSE 파일이 없어 원본 저장소 k2-fsa/sherpa-onnx v1.13.8 의 LICENSE 를 옮김',
}
const sherpa원문_ORT = {   // 플랫폼 꾸러미는 Microsoft ONNX Runtime 1.28.2 DLL(MIT)을 함께 담는다(DLL 판 정보로 확인)
  저장소파일: ['licenses/sherpa-onnx-1.13.8-LICENSE.txt', 'licenses/onnxruntime-1.28.2-LICENSE.txt'], sha256: '83038e841d6a341994d7542834971e205a780a9075dbea521f2520efdcbce531',
  출처: 'npm 꾸러미에 LICENSE 파일이 없어 k2-fsa/sherpa-onnx v1.13.8 의 LICENSE 와, 함께 든 onnxruntime.dll(1.28.2)의 '
    + 'microsoft/onnxruntime v1.28.2 LICENSE 를 옮김. ONNX Runtime 의 제3자 고지 전문: licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt',
}
// **해시로 고정한다** (Codex 5회차 Medium). 4회차 판은 cookie-signature 를 41줄에서 잘라 마지막 문장
// 「SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.」가 빠졌는데(그 README 는 줄바꿈 없이 끝나는
// 42번째 줄이 있다), 낱말 검사만 해서 통과했다. 이제 사람이 확인한 그 원문의 sha256 을 함께 적고, 가져온 글이
// 한 글자라도 다르면(잘림·저작권자 삭제·다른 라이선스 선언) 생성이 실패한다. 해시는 MIT 문구를 덧붙이기 **전**의 원문이다.
const 확인한원문 = {
  'cookie-signature@1.0.7': { 부품파일: ['Readme.md', 21, 42], sha256: '4072f7ac49dd39f61e83af60c0bbea0350d3a40b93217a97829acb6d872881d8',
    출처: 'LICENSE 파일이 없어 Readme.md 의 License 절(21~42줄)을 옮김' },
  'qrcode-generator@2.0.4': { 부품파일: ['dist/qrcode.js', 1, 16], MIT덧붙임: true, sha256: '9004a88fdfad71196916d937b8e999fb29ee6f958212f20e82a5d4db74256f3f',
    출처: 'LICENSE 파일이 없어 dist/qrcode.js 머리말(1~16줄)을 옮기고, 머리말이 가리키는 MIT 이용허락 문구를 덧붙임' },
  'sherpa-onnx-node@1.13.8': sherpa원문,
  ...Object.fromEntries(['win-x64', 'win-ia32', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']
    .map((os) => [`sherpa-onnx-${os}@1.13.8`, sherpa원문_ORT])),
}

/** 표가 가리키는 원문(덧붙이기 전). 설치 안 된 부품 파일이면 null. */
function 원문뽑기(표, 폴더) {
  if (표.저장소파일) {
    return 표.저장소파일.map((f) => fs.readFileSync(p.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n----\n\n')
  }
  const [f, 처음, 끝] = 표.부품파일
  let 원문; try { 원문 = fs.readFileSync(p.join(폴더, f), 'utf8') } catch { return null }   // 설치 안 됨
  return 원문.replace(/\r\n/g, '\n').split('\n').slice(처음 - 1, 끝).join('\n').trim()
}

/** 가져온 원문이 사람이 확인한 그 원문과 글자까지 같은가. */
function 원문맞나(표, 글) {
  return typeof 글 === 'string' && require('node:crypto').createHash('sha256').update(글).digest('hex') === 표.sha256
}

function 확인한원문읽기(열쇠, 폴더) {
  const 표 = 확인한원문[열쇠]
  if (!표) return null
  const 원문 = 원문뽑기(표, 폴더)
  if (원문 === null) return null
  let 글 = 원문
  if (표.MIT덧붙임) 글 += '\n\n' + MIT_표준
  return { 글, 출처: 표.출처, 원문맞음: 원문맞나(표, 원문) }
}

/**
 * 라이선스 이름과 본문이 맞는가. 이름은 MIT 인데 본문에 MIT 이용허락 문구가 없으면(요약·다른 라이선스) false.
 * 모르는 이름은 null — 사람이 볼 일이라 실패로 치지 않고 칸에 그대로 둔다.
 */
function 맞는가(license, 글) {
  if (!글) return false
  const l = String(license)
  if (/^MIT$/i.test(l)) return /Permission is hereby granted/i.test(글) && /copyright/i.test(글)
  if (/^ISC$/i.test(l)) return /Permission to use, copy, modify/i.test(글) && /copyright/i.test(글)
  if (/^Apache-2\.0$/i.test(l)) return /Apache License[\s\S]*Version 2\.0/i.test(글) && /TERMS AND CONDITIONS/i.test(글)
  if (/^BSD-[23]-Clause$/i.test(l)) return /Redistribution and use/i.test(글) && /copyright/i.test(글)
  return null
}

/**
 * 한 부품의 고지 글을 고른다 → { text, 출처, 원문다름 }.
 * **표(확인한원문)에 등록된 부품은 표가 먼저다** (Codex 6회차). 꾸러미에 LICENSE 파일이 따로 생겨도(잘린 것이라도)
 * 그것을 쓰지 않고, 사람이 확인한 자리의 원문을 해시로 대조한다 — 그러지 않으면 해시 검증을 건너뛴다.
 * 등록 안 된 부품만 꾸러미의 LICENSE·LICENCE·COPYING 을 쓴다.
 */
function 고지글고르기(열쇠, 폴더) {
  if (확인한원문[열쇠]) {
    const 찾음 = 확인한원문읽기(열쇠, 폴더)
    if (찾음) return { text: 찾음.글, 출처: 찾음.출처, 원문다름: !찾음.원문맞음 }
    return { text: null, 출처: '', 원문다름: false }   // 등록됐지만 이 PC 에 설치 안 됨 — 아래 「전문 없음」으로 걸린다
  }
  let text = null
  try {
    const f = fs.readdirSync(폴더).filter((x) => 전문후보.test(x)).sort()[0]
    if (f) text = fs.readFileSync(p.join(폴더, f), 'utf8').replace(/\r\n/g, '\n').trim()
  } catch { /* 설치 안 됨 */ }
  return { text, 출처: '', 원문다름: false }
}

function 라이선스이름(v, pkgJson) {
  let l = v.license || pkgJson?.license
  if (!l && Array.isArray(pkgJson?.licenses)) l = pkgJson.licenses.map((x) => x.type || x).join(' OR ')
  if (l && typeof l === 'object') l = l.type
  return l || '(package.json 에 적혀 있지 않음 — 아래 전문을 보세요)'
}

function 모으기() {
  const 모음 = new Map()   // 'name@version' → { name, version, license, text, 어디 }
  for (const r of 뿌리들) {
    const lock = JSON.parse(fs.readFileSync(p.join(ROOT, r.잠금), 'utf8'))
    for (const [경로, v] of Object.entries(lock.packages || {})) {
      if (!경로 || v.dev || v.devOptional) continue
      const name = v.name || 경로.slice(경로.lastIndexOf('node_modules/') + 'node_modules/'.length)
      const 열쇠 = `${name}@${v.version}`
      if (모음.has(열쇠)) { 모음.get(열쇠).어디.add(r.이름); continue }
      const 폴더 = p.join(ROOT, r.폴더, 경로)
      let pkgJson = null
      try { pkgJson = JSON.parse(fs.readFileSync(p.join(폴더, 'package.json'), 'utf8')) } catch { /* 설치 안 됨 */ }
      const { text, 출처, 원문다름 } = 고지글고르기(열쇠, 폴더)
      // 다른 OS 전용 부품(optional + os 제한)은 이 PC 에 없을 수 있다 — 그렇다고 적는다.
      const 설치됨 = !!pkgJson
      const license = 라이선스이름(v, pkgJson)
      모음.set(열쇠, { name, version: v.version, license, text, 출처, 원문다름, 설치됨,
        선택: !!v.optional, 어디: new Set([r.이름]) })
    }
  }
  return [...모음.values()].sort((a, b) => (a.name + '@' + a.version).localeCompare(b.name + '@' + b.version))
}

function 쓰기(목록) {
  const 줄 = []
  줄.push('# THIRD-PARTY NOTICES — 함께 담긴 프로그램 부품의 라이선스')
  줄.push('')
  줄.push('CareCast(Apache-2.0, Copyright 2026 jung-svg)가 배포에 함께 담는 npm 부품과 그 라이선스 전문입니다.')
  줄.push('**이 파일은 `npm run notices` 가 두 잠금파일에서 만듭니다 — 손으로 고치지 마세요.**')
  줄.push('음성 모델(Open RAIL-M)·실행기(Node.js·Python)·날씨 자료의 조건은 `LICENSES.md` 와 `NOTICE` 에 있습니다.')
  줄.push('')
  줄.push('> **GPL-3.0 부품이 들어 있습니다.** `sherpa-onnx-*` 플랫폼 꾸러미의 실행 파일(`sherpa-onnx-c-api.dll` 등)에는')
  줄.push('> 발음 변환용 **espeak-ng(GPL-3.0)** 과 **piper-phonemize(MIT)** 가 정적으로 들어 있습니다. 아래 표의 라이선스 칸은')
  줄.push('> 꾸러미가 스스로 밝힌 이름(Apache-2.0)이라 이 사실이 드러나지 않습니다. CareCast 소스는 Apache-2.0 이지만,')
  줄.push('> 이 꾸러미를 담은 **설치판을 나눠 줄 때는 GPL-3.0 의 고지·소스 제공 조건**을 따라야 합니다 — `LICENSES.md` 2-1절.')
  줄.push('')
  줄.push('| 부품 | 판 | 라이선스 | 쓰는 곳 |')
  줄.push('|---|---|---|---|')
  for (const x of 목록) {
    줄.push(`| ${x.name} | ${x.version} | ${x.license} | ${[...x.어디].join(' · ')}${x.선택 ? ' (선택 — 해당 OS 에서만)' : ''} |`)
  }
  줄.push('')
  줄.push('---')
  for (const x of 목록) {
    줄.push('')
    줄.push(`## ${x.name}@${x.version} — ${x.license}`)
    줄.push('')
    if (x.출처) { 줄.push(`(${x.출처})`); 줄.push('') }
    if (x.text) { 줄.push('```text'); 줄.push(x.text.replace(/```/g, "'''")); 줄.push('```') }
    else if (!x.설치됨) 줄.push(`(이 PC 에 설치돼 있지 않아 전문을 담지 못했습니다${x.선택 ? ' — 다른 OS 전용 선택 부품' : ''}. 라이선스: ${x.license})`)
    else 줄.push(`(패키지에 라이선스 파일이 없습니다. package.json 의 라이선스: ${x.license})`)
  }
  줄.push('')
  return 줄.join('\n')
}

function main() {
  const 목록 = 모으기()
  // **만들지 않는 경우** — 이름만 남거나 이름과 본문이 어긋난 고지는 조건을 못 지킨다(Codex 3회차).
  //  · 전문이 없다 — 설치 안 된 **다른 OS 전용 선택 부품**만 예외(그 PC 에서는 쓰지 않는다)
  //  · 라이선스 이름과 본문이 맞지 않는다(맞는가 === false)
  //  · 확인한 원문과 글자가 다르다(해시 불일치 — 잘림·바뀜, Codex 5회차)
  const 문제 = 목록.filter((x) => (!x.text && !(x.선택 && !x.설치됨)) || x.원문다름 || (맞는가(x.license, x.text) === false && x.text))
    .map((x) => `${x.name}@${x.version} (${x.license}) — ${!x.text ? '전문 없음' : x.원문다름 ? '확인한 원문과 다름(해시)' : '이름과 본문이 맞지 않음'}`)
  if (문제.length) {
    console.error(`고지를 만들 수 없는 부품 ${문제.length}개 — 원문을 확인해 「확인한원문」 표에 더하세요:\n  ${문제.join('\n  ')}`)
    process.exit(1)
  }
  const 글 = 쓰기(목록)
  if (process.argv.includes('--check')) {
    const 지금 = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
    if (지금 !== 글) { console.error('THIRD-PARTY-NOTICES.md 가 잠금파일과 다릅니다 — npm run notices 로 다시 만드세요.'); process.exit(1) }
    console.log('THIRD-PARTY-NOTICES.md — 잠금파일과 같음'); return
  }
  fs.writeFileSync(OUT, 글)
  console.log(`THIRD-PARTY-NOTICES.md 를 만들었습니다 (${글.length} 글자)`)
}

if (require.main === module) main()
module.exports = { 모으기, 쓰기, 맞는가, 확인한원문, 원문맞나, 원문뽑기, 고지글고르기 }
