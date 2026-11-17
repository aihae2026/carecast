// 음량 패널이 **손으로 조절할 만한 모습**인가 (2026-09-11 사용자 지적).
//
// 지적 원문: *"음량제어는 너 이따구로 하면 조정하고 싶겠냐"*.
// 그전에는 폭 전체를 채운 얇은 막대 일곱 개가 세로로 쌓여 있었다 —
// 레일이 얇아 손잡이를 잡기 어렵고, 일곱 줄이 다 같아 보여 무엇을 만지는지 헷갈렸다.
//
// **이 검사는 "예쁜가"를 보지 않는다.** 되돌아가면 곧바로 다시 불편해지는 것 넷만 본다:
//   ① 손잡이를 키운 슬라이더(`.vol-range`)를 쓰는가
//   ② 채운 비율을 스스로 그리는가(`--pct`) — 브라우저 기본 채움은 크로스브라우저가 아니다
//   ③ 음소거가 있고 **끄기 전 값을 기억**하는가
//   ④ 마이크가 배율(×)이라는 것이 눈에 띄게 갈라져 있는가
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const PANEL = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'easy', 'VolumePanel.jsx'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8')

test('앵커: 이 파일이 음량 패널이 맞다', () => {
  assert.match(PANEL, /export default function VolumePanel/)
  assert.match(PANEL, /PRESETS/, '프리셋이 사라졌다')
  assert.match(PANEL, /type="range"/, '슬라이더가 사라졌다')
})

test('손잡이를 키운 슬라이더를 쓴다 — 기본 range 로 되돌아가지 않았다', () => {
  assert.match(CSS, /\.vol-range\s*\{/, 'vol-range 정의가 사라졌다 — 이 가드를 옮길 것')
  assert.match(CSS, /::-webkit-slider-thumb/, '손잡이 크기를 안 정한다 — 얇고 작은 기본 모습으로 돌아간다')
  assert.match(CSS, /::-moz-range-thumb/, '파이어폭스에서만 기본 모습이 된다')
  assert.match(PANEL, /className=\{?["'`][^"'`]*vol-range/,
    '패널이 vol-range 를 안 쓴다')
  assert.doesNotMatch(PANEL, /accent-\w+-\d+/,
    '옛 accent-* 슬라이더가 남아 있다 — 레일이 얇아 잡기 어렵다')
})

test('채운 비율을 스스로 그린다 — 브라우저마다 다르게 보이지 않게', () => {
  assert.match(PANEL, /--pct/, '채운 비율을 안 넘긴다')
  assert.match(CSS, /var\(--pct/, 'CSS 가 그 비율을 안 쓴다')
})

test('음소거가 있고 끄기 전 값을 기억한다 — 다시 켤 때 손으로 맞추지 않게', () => {
  assert.match(PANEL, /음소거토글/, '음소거가 없다')
  assert.match(PANEL, /const \[음소거, set음소거\]/, '끄기 전 값을 기억하지 않는다')
  assert.match(PANEL, /VolumeX/, '꺼진 상태를 나타내는 아이콘이 없다 — 색만으로 구분하면 안 된다(UX-42)')
})

// ── 2026-09-11 독립 검수 지적 반영 ──────────────────────────────────────────
// 첫 판의 음소거는 각 채널의 `change*` 를 그대로 불렀다. 그래서 —
//   · BGM 음소거가 `saveBgmBroadcastDefault(0)` 까지 타서 **방송 BGM 기본 볼륨이 0 으로 저장**됐다.
//     다음 정시 방송의 BGM 이 무음으로 나간다.
//   · TV 음소거가 `saveTv(0)` 를 타서 **CC-055 1회성 인수 창을 닫았다.**
// 지금은 저장 경로를 아예 안 탄다. 되돌아가면 곧바로 같은 사고가 난다.
test('음소거는 저장하지 않는다 — 방송 기본값·인수 창을 건드리지 않는다', () => {
  const i = PANEL.indexOf('const 음소거토글')
  assert.notEqual(i, -1, '음소거토글이 사라졌다 — 이 가드를 옮길 것')
  const 본문 = PANEL.slice(PANEL.indexOf('const 소리만적용'), PANEL.indexOf('const 채널'))
  assert.ok(!/saveBgmBroadcastDefault/.test(본문),
    '음소거가 방송 BGM 기본 볼륨을 저장한다 — 다음 방송이 무음으로 나간다')
  assert.ok(!/saveTv\(/.test(본문),
    '음소거가 TV 볼륨을 저장한다 — CC-055 1회성 인수 창이 조용히 닫힌다')
  assert.ok(!/scheduleSave\(/.test(본문),
    '음소거가 일괄 저장을 부른다 — 잠깐 끄려던 것이 설정이 된다')
})

test('음소거가 change* 를 안 부른다 — 그 함수들이 저장을 안고 있다', () => {
  const i = PANEL.indexOf('const 음소거토글')
  const 본문 = PANEL.slice(i, PANEL.indexOf('const 채널', i))
  for (const f of ['changeBgm', 'changeTv', 'changeTts', 'changeMaster', 'changeAudio', 'changeMedia']) {
    assert.ok(!본문.includes(f + '('),
      `음소거가 ${f} 를 부른다 — 그 함수는 저장까지 한다`)
  }
})

test('음소거가 저장되지 않는다는 사실을 화면이 말한다', () => {
  assert.match(PANEL, /새로고침하면 원래 크기로 돌아옵니다/,
    '음소거가 임시라는 것을 안 적으면 사람은 저장된 줄 안다')
})

// ── 아래 셋은 2026-09-11 독립 검수(VERDICT FAIL)가 잡은 것을 고정한다 ────────
//
// 앞선 검사들이 왜 못 봤나: 전부 `assert.match(소스, /문구/)` 라 **문장이 있는지**만 봤다.
// 그 문장이 **참인지**는 안 봤다. 그래서 42건이 초록인 채로 세 결함이 지나갔다.
// 여기서는 문구가 아니라 **코드의 모양**을 본다.

test('꺼짐 판정이 값도 함께 본다 — 0% 인데 "켜짐"으로 그리지 않는다', () => {
  // `음소거` 는 이 탭의 state 라 새로고침에 사라지는데 서버가 준 master=0 은 남는다.
  // 맵만 보면 그 순간 **0% 인데 소리 켜짐 아이콘**이 된다 — 무음의 표시가 사라지는 자리다.
  assert.match(PANEL, /const 꺼졌나 = \(key, value\) => 음소거\[key\] !== undefined \|\| value <= 끈값/,
    '꺼짐 판정에 값 조건이 없다 — 슬라이더로 0 까지 내려도 꺼짐 표시가 안 뜬다')
  assert.ok((PANEL.match(/마스터꺼짐 \?/g) || []).length >= 3,
    '마스터꺼짐 을 만들어 놓고 아이콘·색·이름표에 안 쓴다')
})

test('마이크에는 음소거가 없다 — 1.0× 는 무음이 아니라 원음이다', () => {
  // 2026-09-11 독립 검수 지적. `끈값('mic')=1` 로 두고 최소값을 '끔'이라 불렀는데,
  // 판정을 하나로 합치자 **정상 1.0× 가 "꺼짐"으로 잡혀 버튼이 켜기 분기로 갔다.**
  // 누르면 1.0× → 2.5× 로 이득이 뛴다 — 마이크 생방송 중이면 하울링이 날 자리다.
  assert.match(PANEL, /const 음소거가능 = \(key\) => key !== 'mic'/,
    '마이크를 음소거 대상에서 빼지 않았다')
  assert.match(PANEL, /const 끈값 = 0\b/,
    "끈값 이 채널마다 다르다 — 마이크의 원음 1.0× 를 '끔'으로 부르는 것이 이 결함의 뿌리였다")
  assert.match(PANEL, /\{음소거가능\(c\.key\) && \(/, '마이크에도 음소거 버튼을 그린다')
  assert.match(PANEL, /const 꺼짐 = 음소거가능\(c\.key\) && 꺼졌나\(c\.key, c\.value\)/,
    '마이크가 여전히 "꺼짐"으로 회색 표시된다')
})

test('음소거 해제 기본값이 서버 단일 출처와 같다', () => {
  // 코드에 50 을 박았었다. 마스터는 저장까지 타는 채널이라 그 숫자가 DB 에 남는다 —
  // 볼륨 기본값이 8곳에 흩어져 있던 2026-08-28 사고를 다시 만드는 길이었다.
  // **표가 옮겨 갔다**(UX-39, 2026-09-11). 예전엔 이 파일 안에 있었는데, 오디오 설정 화면이
  // 자기 숫자를 따로 박고 있어서 **화면 공용 단일 출처**(`src/lib/volumeDefaults.js`)로 뺐다.
  // 가드도 같은 커밋에서 따라 옮긴다(CLAUDE.md "가드는 따라 옮긴다").
  // 지키려는 것은 그대로다 — 화면 기본값이 서버 `fallback` 과 같은가.
  const DEFAULTS = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'volumeDefaults.js'), 'utf8')
  const m = /export const 볼륨기본값 = \{([\s\S]*?)\}/.exec(DEFAULTS)
  assert.ok(m, '볼륨기본값 을 못 찾았다 — 이 가드를 옮길 것')
  // 긍정 앵커 — 패널이 그 단일 출처를 실제로 쓰는가. 없으면 표만 맞고 화면은 딴 값을 쓴다.
  assert.match(PANEL, /from '\.\.\/\.\.\/lib\/volumeDefaults'/,
    '패널이 단일 출처를 안 쓴다 — 표가 맞아도 화면이 딴 숫자를 볼 수 있다')
  const 화면 = {}
  for (const [, k, v] of m[1].matchAll(/(\w+):\s*(\d+)/g)) 화면[k] = Number(v)

  const VOL = fs.readFileSync(path.join(ROOT, 'server', 'domain', 'volume.js'), 'utf8')
  const 서버 = {}
  for (const [, k, v] of VOL.matchAll(/^\s{2}(\w+):\s*\{[^}]*fallback:\s*(\d+)/gm)) 서버[k] = Number(v)
  assert.ok(Object.keys(서버).length >= 6,
    `서버 fallback 을 ${Object.keys(서버).length}개만 읽었다 — 이 가드를 옮길 것`)

  for (const [k, v] of Object.entries(화면)) {
    assert.equal(v, 서버[k], `'${k}' 기본값이 갈렸다 — 화면 ${v}, 서버 ${서버[k]}`)
  }
  // 주석에 "예전엔 50 이었다"고 적는 것은 괜찮다 — **코드 줄**만 본다.
  const 코드줄 = PANEL.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/기본 = 50|c\.기본 \?\? 50/.test(코드줄), '아직 50 이 코드에 박혀 있다')
  assert.match(PANEL, /const 음소거토글 = \(key, value, 기본 = 볼륨기본값\[key\]\) =>/,
    '기본값을 표에서 안 찾는다')
})

test('표시와 동작이 같은 술어를 쓴다 — "해제" 버튼이 아무 일도 안 하는 일이 없게', () => {
  // 2026-09-11 독립 검수 지적. 아이콘은 값을 보고 토글은 맵만 봐서, 음소거 후 새로고침한
  // 상태(master=0, 맵 비어 있음)에서 **버튼은 "해제"인데 누르면 0 → 0** 이었다.
  // 그 세션 내내 버튼으로는 소리를 못 켠다 — 무음의 복구 동선이라 가장 나쁜 자리다.
  assert.match(PANEL, /const 마스터꺼짐 = 꺼졌나\('master', master\)/,
    '마스터 표시가 토글과 다른 술어를 쓴다')
  assert.match(PANEL, /const 꺼짐 = 음소거가능\(c\.key\) && 꺼졌나\(c\.key, c\.value\)/,
    '채널 카드 표시가 토글과 다른 술어를 쓴다')
  // 토글도 같은 함수로 갈라야 한다
  const m = /const 음소거토글 = \(key, value, 기본 = [^)]+\) => \{([\s\S]*?)\n {2}\}/.exec(PANEL)
  assert.ok(m, '음소거토글 을 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /if \(꺼졌나\(key, value\)\)/,
    '토글이 꺼졌나() 를 안 쓴다 — 표시와 판정이 갈린다')
  assert.match(m[1], /소리만적용\(key, 끈값\)/, '끄기가 0 이 아닌 값을 쓴다')
  assert.ok(!/음소거\[key\] === undefined/.test(m[1]),
    '토글에 맵만 보는 옛 판정이 남아 있다')
})

test('기억이 없으면 안전한 기본값으로 켠다 — 0 으로 "켜는" 것은 켜는 게 아니다', () => {
  assert.match(PANEL, /const 켤값 = \(key, 기본\) => \{/, '켤 값을 정하는 자리가 없다')
  assert.match(PANEL, /if \(기억 !== undefined && 기억 > 끈값\) return 기억/,
    '끄기 전 값이 이미 0 이었으면 그 0 으로 되돌아간다 — 켜지지 않는다')
  assert.match(PANEL, /음소거토글\(c\.key, c\.value, c\.기본\)/,
    '채널마다 다른 기본값을 안 넘긴다')
})

test('마스터가 저장된다는 예외를 화면이 밝힌다 — 문구가 거짓이면 안 된다', () => {
  // `소리만적용` 안에서 저장을 부르는 채널은 master 하나여야 하고(아래 검사),
  // 그렇다면 "저장되지 않습니다"는 그 하나에 대해 거짓이다. 그 예외를 화면이 말해야 한다.
  assert.match(PANEL, /전체 소리<\/span>만은 PC 음량이라 끈 값이 그대로 저장됩니다/,
    '마스터만 저장된다는 예외를 안 적으면, 직원이 전체 소리를 끈 채 퇴근한다')
})

test('음소거에서 저장을 부르는 채널은 master 하나뿐이다', () => {
  // 범위를 `소리만적용` 함수 본문으로 좁혀서 본다 — 파일 전체를 보면
  // 슬라이더의 정상 저장 경로까지 걸려 이 검사가 아무 뜻이 없어진다.
  const m = /const 소리만적용 = \(key, v\) => \{([\s\S]*?)\n {2}\}/.exec(PANEL)
  assert.ok(m, '소리만적용 함수를 못 찾았다 — 이 가드를 옮길 것')
  const 본문 = m[1]
  const 저장호출 = 본문.match(/save[A-Z]\w*\(/g) || []
  assert.deepEqual(저장호출, ['saveVolume('],
    `음소거가 부르는 저장은 마스터의 saveVolume 하나여야 한다 — 실제: ${저장호출.join(', ')}`)
  // 그 한 건이 정말 master 가지뿐인지 — 다른 채널 가지에 저장이 섞이지 않았는가
  assert.match(본문, /if \(key === 'master'\)[^\n]*saveVolume/,
    'saveVolume 이 master 가지에 있지 않다')
})

test('마이크는 배율(×)이라는 것이 갈라져 있다 — 퍼센트와 같은 눈금으로 읽히면 안 된다', () => {
  assert.match(PANEL, /배율/, '배율 표시가 없다')
  assert.match(PANEL, /toFixed\(1\)\}×/, '× 단위로 안 보여준다')
})

test('모든 슬라이더에 이름표가 있다 — 화면 낭독기가 "슬라이더"라고만 읽지 않게(UX-42)', () => {
  const 슬라이더수 = (PANEL.match(/type="range"/g) || []).length
  const 이름표수  = (PANEL.match(/aria-label=/g) || []).length
  assert.ok(이름표수 >= 슬라이더수,
    `슬라이더 ${슬라이더수}개인데 aria-label 이 ${이름표수}개다`)
})

test('저장 규칙은 안 건드렸다 — 일괄 저장에 tv 를 싣지 않는다(CC-055)', () => {
  // 이번 작업은 **그리는 부분만** 바꿨다. 저장 경로가 딸려 바뀌면 현장 TV 볼륨이 버려진다.
  const i = PANEL.indexOf('const scheduleSave')
  assert.notEqual(i, -1, 'scheduleSave 가 사라졌다')
  const end = PANEL.indexOf('}, [trackSave])', i)
  assert.ok(end > i, '일괄 저장 함수 경계를 못 찾았다')
  const 본문 = PANEL.slice(i, end)
  assert.doesNotMatch(본문, /\btv\b\s*:/, '일괄 저장에 tv 가 들어갔다 — 1회성 인수가 조용히 닫힌다')
})
