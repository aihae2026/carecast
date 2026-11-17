// 쉬운 화면 — 손가락으로 눌러 빗나가지 않는 크기 (고도화 제안 #24, 2026-09-03).
//
// 왜 필요했나: 현장에서 "나이 드신 분도 쓴다"는 말을 받았다. 실측해 보니 쉬운 화면 버튼 70개
// 가운데 28개가 26~32px였고(권장은 애플 44 · 구글 48), 10~11px 글씨가 75곳이었다.
//
// 사용자가 정한 기준(2026-09-03):
//   · 표적 최소 **44px**
//   · 글자는 본문 14px, 보조 12px까지 허용 — **12px 미만은 없다**
//     (버튼 글자는 본문으로 본다: 눌러야 하는 글자를 못 읽으면 크기를 키운 의미가 없다)
//
// 이 테스트는 **되돌아오는 것**을 막는다. 새 버튼을 하나 붙일 때 옛 습관대로 p-1.5·text-xs로
// 쓰면 여기서 걸린다. 실제로 눌러 본 것은 사람이고, 여기서는 치수만 지킨다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const SRC_DIR = path.join(__dirname, '..', '..', 'src')
const EASY_DIR = path.join(SRC_DIR, 'components', 'easy')

function easyFiles() {
  const files = fs.readdirSync(EASY_DIR)
    .filter(f => f.endsWith('.jsx'))
    .map(f => path.join(EASY_DIR, f))
  files.push(path.join(SRC_DIR, 'pages', 'EasyMode.jsx'))
  // 파일이 줄면 검사가 조용히 헐거워진다 — 최소 개수를 못 박는다(2026-09-03 실측 15개)
  assert.ok(files.length >= 15, `쉬운 화면 파일이 줄었다(${files.length}개) — 검사 범위를 확인할 것`)
  return files
}

/** <button 뒤 첫 className 리터럴을 돌려준다(문자열·템플릿 둘 다). */
function buttonClasses(src) {
  const out = []
  const re = /<button\b/g
  let m
  while ((m = re.exec(src))) {
    const i = src.indexOf('className=', m.index)
    if (i < 0) continue
    const j = i + 'className='.length
    if (src[j] === '"') {
      out.push({ at: m.index, cls: src.slice(j + 1, src.indexOf('"', j + 1)) })
    } else if (src.startsWith('{`', j)) {
      out.push({ at: m.index, cls: src.slice(j + 2, src.indexOf('`', j + 2)) })
    }
  }
  return out
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length

test('12px 미만 글씨가 없다', () => {
  const bad = []
  for (const file of easyFiles()) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/text-\[(\d+)px\]/g)) {
      if (Number(m[1]) < 12) bad.push(`${path.basename(file)}:${lineOf(src, m.index)} ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [], '10px대 글씨가 다시 들어왔다')
})

test('버튼마다 44px 하한이 걸려 있다', () => {
  const bad = []
  for (const file of easyFiles()) {
    const src = fs.readFileSync(file, 'utf8')
    for (const b of buttonClasses(src)) {
      if (!b.cls.includes('min-h-[44px]')) {
        bad.push(`${path.basename(file)}:${lineOf(src, b.at)}`)
      }
    }
  }
  assert.deepEqual(bad, [], '표적 하한이 없는 버튼이 있다 — min-h-[44px] min-w-[44px]를 붙일 것')
})

test('아이콘 정사각 버튼이 44px보다 작지 않다', () => {
  const bad = []
  for (const file of easyFiles()) {
    const src = fs.readFileSync(file, 'utf8')
    for (const b of buttonClasses(src)) {
      const m = /\bw-(\d+) h-\1\b/.exec(b.cls)
      // tailwind 기본 눈금은 4px — w-11이 44px이다
      if (m && Number(m[1]) < 11) bad.push(`${path.basename(file)}:${lineOf(src, b.at)} ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [], '44px보다 작은 아이콘 버튼이 있다')
})

test('버튼 글자가 12px로 내려가지 않는다', () => {
  const bad = []
  for (const file of easyFiles()) {
    const src = fs.readFileSync(file, 'utf8')
    for (const b of buttonClasses(src)) {
      if (/\btext-xs\b/.test(b.cls)) bad.push(`${path.basename(file)}:${lineOf(src, b.at)}`)
    }
  }
  assert.deepEqual(bad, [], '버튼 글자는 본문 취급(14px)이다 — text-xs가 남아 있다')
})
