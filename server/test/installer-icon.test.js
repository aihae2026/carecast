'use strict'
// **설치 파일 아이콘과 설치된 프로그램 아이콘** (2026-09-16 처음 · 2026-09-18 설치 파일 전용 추가).
//
// `scripts/make-icon.cjs` 머리말이 「이 시험이 대조한다」고 적고 있었는데 **파일이 없었다**(2026-09-18 발견).
// 그래서 이번에 만든다. 지키는 것:
//  · 두 아이콘이 다 있고, 규격대로 묶인 ICO 다(크기 7개, 각 조각이 PNG).
//  · **설치 파일만** 상자 아이콘을 쓰고, 바로가기·제거 목록은 원래 얼굴을 쓴다 —
//    *"설치파일이랑, 실행파일이랑 같으니까 헷갈려"* 가 다시 생기지 않게.
//  · 두 아이콘은 서로 **다른 그림**이다(같은 파일을 두 번 쓰면 위 약속이 조용히 깨진다).
//  · 색은 토큰과 같다(G-1 — 아이콘에 새 색을 들이지 않는다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 설치폴더 = path.join(ROOT, 'scripts', 'installer')
const PNG머리 = Buffer.from([0x89, 0x50, 0x4e, 0x47])

function 조각들(파일) {
  const b = fs.readFileSync(파일)
  assert.equal(b.readUInt16LE(0), 0, `${path.basename(파일)}: 예약 칸이 0 이 아니다`)
  assert.equal(b.readUInt16LE(2), 1, `${path.basename(파일)}: 아이콘(1)이 아니다`)
  const n = b.readUInt16LE(4)
  const out = []
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16
    const 크기 = b[o] || 256
    const 길이 = b.readUInt32LE(o + 8), 자리 = b.readUInt32LE(o + 12)
    const 자료 = b.subarray(자리, 자리 + 길이)
    out.push({ 크기, 자료 })
  }
  return out
}

// `carecast.ico` 는 **포장할 때 만든다**(`package-installer.cjs` → `make-icon.cjs`, .gitignore 대상). 새로 받은
// 저장소에는 없으므로, 없으면 그 파일 대조만 이유를 적고 건너뛴다(출시 검수 2026-10-17 — 새 clone 에서 늘 빨간불이었다).
// 포장 스크립트가 만든 뒤 없으면 던지는 검사는 `package-installer.cjs` 에 따로 있다.
const 원래아이콘있나 = fs.existsSync(path.join(설치폴더, 'carecast.ico'))
const 원래아이콘옵션 = 원래아이콘있나 ? {} : { skip: 'carecast.ico 가 아직 없다 — 포장 때 node scripts/make-icon.cjs 가 만든다' }

test('두 아이콘이 다 있고, 크기 7개가 전부 PNG 조각으로 들어 있다', () => {
  const { 크기들 } = require('../../scripts/make-icon.cjs')
  for (const 이름 of [...(원래아이콘있나 ? ['carecast.ico'] : []), 'carecast-setup.ico']) {
    const 파일 = path.join(설치폴더, 이름)
    assert.ok(fs.existsSync(파일), `${이름} 이 없다 — node scripts/make-icon.cjs 로 만든다`)
    const 조각 = 조각들(파일)
    assert.deepEqual(조각.map(c => c.크기), 크기들, `${이름}: 크기 목록이 다르다`)
    for (const c of 조각) {
      assert.ok(c.자료.subarray(0, 4).equals(PNG머리), `${이름} ${c.크기}px 조각이 PNG 가 아니다`)
      assert.ok(c.자료.length > 100, `${이름} ${c.크기}px 조각이 비었다`)
    }
  }
})

test('설치 파일 아이콘은 원래 얼굴과 **다른 그림**이다 — 크기마다', 원래아이콘옵션, () => {
  const 원래 = 조각들(path.join(설치폴더, 'carecast.ico'))
  const 설치 = 조각들(path.join(설치폴더, 'carecast-setup.ico'))
  원래.forEach((c, i) => {
    assert.ok(!c.자료.equals(설치[i].자료), `${c.크기}px 가 같은 그림이다 — 설치 파일과 프로그램이 다시 구분이 안 된다`)
  })
})

test('설치 파일만 상자 아이콘을 쓰고, 바로가기·제거 목록은 원래 얼굴이다', () => {
  const iss = fs.readFileSync(path.join(설치폴더, 'CareCast.iss'), 'utf8')
  assert.match(iss, /^SetupIconFile=carecast-setup\.ico\s*$/m, '설치 파일이 상자 아이콘을 안 쓴다')
  assert.match(iss, /^UninstallDisplayIcon=\{app\}\\carecast\.ico\s*$/m, '제거 목록이 원래 얼굴이 아니다')
  const 바로가기 = iss.split('\n').filter(l => /^Name: "\{(group|autodesktop|userstartup)\}/.test(l))
  assert.ok(바로가기.length >= 3, '긍정 앵커 — 바로가기 줄이 있다')
  for (const l of 바로가기) {
    assert.match(l, /IconFilename: "\{app\}\\carecast\.ico"/, `바로가기가 원래 얼굴이 아니다: ${l.slice(0, 60)}`)
  }
})

test('아이콘 색은 토큰 값과 같다(G-1 — 새 색을 들이지 않는다)', () => {
  const { 색 } = require('../../scripts/make-icon.cjs')
  const 토큰 = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8')
  const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')
  const 하늘hex = /--ds-v3-drop-tts:\s*([^;]+);/.exec(토큰)
  const 자두hex = /--ds-v3-drop-bgm:\s*([^;]+);/.exec(토큰)
  assert.ok(하늘hex && 자두hex, '긍정 앵커 — 토큰에 물감 두 색이 있다')
  // 토큰이 `135,198,241` 처럼 숫자로 적혀 있을 수도, `#87C6F1` 로 적혀 있을 수도 있다 — 둘 다 받는다
  const 풀기 = (v) => v.trim().startsWith('#') ? rgb(v.trim()) : v.trim().replace(/\s+/g, '')
  assert.equal(색.하늘, 풀기(하늘hex[1]), '하늘색이 토큰과 다르다')
  assert.equal(색.자두, 풀기(자두hex[1]), '자두색이 토큰과 다르다')
})
