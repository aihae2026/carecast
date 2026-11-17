'use strict'
// **비상방송 문안을 현장에서 고칠 수 있다** (사용자 지시 2026-09-16).
//
// *"비상방송관리는 수정 편집할 수 있게 해줘야지"* · *"직접 입력 비상방송은 위로 올려주고"*
//
// ── 이 화면이 특별한 이유 ──────────────────────────────────────────────────
// 여기 적힌 글은 **사람이 급할 때 누르면 확인 절차 없이 그대로 방송된다.** 그래서
// 다른 설정보다 검사가 세다 — 빈 내용으로 저장되면 급한 순간에 **아무 소리도 안 나는
// 단추**가 되고, 그때는 아무도 이유를 못 찾는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const { 기본문안, 목록읽기, 최대글자 } = require('../domain/emergencyPresets')

test('**빈 내용은 저장되지 않는다** — 급할 때 소리 안 나는 단추가 된다', () => {
  const 한개 = (덮어쓰기) => [{ ...기본문안[0], ...덮어쓰기 }]

  for (const 빈것 of ['', '   ', null, undefined]) {
    const r = 목록읽기(한개({ content: 빈것 }))
    assert.equal(r.ok, false, `빈 내용이 통과했다: ${JSON.stringify(빈것)}`)
    assert.match(r.사유, /비었/, '왜 막혔는지를 안 말한다')
  }
  // 제목도 마찬가지다 — 무엇을 누르는지 모르는 단추가 된다.
  assert.equal(목록읽기(한개({ title: '  ' })).ok, false, '빈 제목이 통과했다')
})

test('**너무 긴 글은 막는다** — 합성이 길어져 급한 순간에 늦는다', () => {
  const 긴글 = 'ㄱ'.repeat(최대글자 + 1)
  const r = 목록읽기([{ ...기본문안[0], content: 긴글 }])
  assert.equal(r.ok, false, `${최대글자}자를 넘겨도 통과했다`)
  assert.match(r.사유, new RegExp(String(최대글자)), '얼마까지인지를 안 말한다')

  // 상한 안쪽은 그대로 받는다 — 막는 것은 「너무 긴 것」이지 「긴 것」이 아니다.
  assert.equal(목록읽기([{ ...기본문안[0], content: 'ㄱ'.repeat(최대글자) }]).ok, true)
})

test('**기본 문안 넷이 그대로 통과한다** — 기본값이 제 검사에 걸리면 안 된다', () => {
  const r = 목록읽기(기본문안)
  assert.equal(r.ok, true, `기본 문안이 자기 검사에 걸린다: ${r.사유}`)
  assert.equal(r.값.length, 4, '기본 문안이 넷이 아니다')
})

test('**서버와 화면의 기본 문안이 같다** — 갈리면 서버 없을 때 다른 글이 뜬다', () => {
  // 화면은 서버가 안 뜰 때 `src/data/presets.js` 를 폴백으로 쓴다. 둘이 갈리면
  // **어느 쪽을 보고 있는지에 따라 방송되는 글이 달라진다.**
  const 화면 = 읽기('src/data/presets.js')
  for (const p of 기본문안) {
    assert.ok(화면.includes(p.content),
      `「${p.title}」 문안이 화면 쪽(src/data/presets.js)과 다르다 — 서버 없을 때 다른 글이 나간다`)
  }
})

test('**직접 입력이 미리 적어 둔 문안보다 위에 있다** — 급한 사람은 스크롤 안 한다', () => {
  const src = 읽기('src/components/admin/sections/EmergencyBroadcast.jsx')
  const 직접 = src.indexOf('직접 입력 비상 방송')
  const 미리 = src.indexOf('미리 적어 둔 문안')
  assert.ok(직접 > 0 && 미리 > 0, '두 묶음을 못 찾았다 — 이 시험의 전제가 무너졌다')
  assert.ok(직접 < 미리,
    '미리 적어 둔 문안이 직접 입력보다 위에 있다 — 급할 때 스크롤을 내리게 만든다')
})

test('**플러그가 방송을 늦추지 않는다** — 결과를 기다리지 않는다', () => {
  // **주석을 걷고 본다.** 이 파일의 머리말이 옛 코드(`await switchBotOn()`)를 인용하고
  // 있어서, 안 걷으면 고쳐 놓고도 빨간불이 난다 — 실제로 그랬다.
  const 코드만 = 읽기('src/components/admin/sections/EmergencyBroadcast.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 기다리면 외부 API 응답만큼 방송이 늦는다 — 비상방송에서 가장 비싼 시간이다.
  assert.ok(!/await switchBotOn\(\)/.test(코드만),
    '플러그 응답을 기다린다 — 그만큼 비상 방송이 늦는다')
  assert.match(코드만, /switchBotOn\(\)\.catch\(/, '플러그 켜기 시도 자체가 사라졌다')
})

// 2026-09-26(Codex 통합 검수 SOLO-0916A High): 저장된 문안을 못 불러오면 화면은 기본 문안을 쥐고 있다.
// 그 상태에서 하나를 고쳐 저장하면 **목록 전체**를 보내므로, 시설이 고쳐 둔 다른 문안까지 기본값으로 덮인다.
// 그래서 **불러오기가 성공해야만** 저장이 나간다. 「처음 상태로」는 원래 전체를 덮는 단추라 제외.
test('**저장된 문안을 못 불러왔으면 하나 고친 저장이 나가지 않는다** — 다른 문안이 기본값으로 덮인다', () => {
  const 코드만 = 읽기('src/components/admin/sections/EmergencyBroadcast.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const 시작 = 코드만.indexOf('const 저장 = async')
  const 끝 = 코드만.indexOf('const 기본값으로')
  assert.ok(시작 > 0 && 끝 > 시작, '저장 함수를 못 찾았다 — 이 시험의 전제가 무너졌다')
  const 본문 = 코드만.slice(시작, 끝)
  const 보냄 = 본문.indexOf('saveEmergencyPresets(')
  assert.ok(보냄 > 0, '저장 함수가 서버로 보내지 않는다 — 대상 앵커')
  const 막음 = 본문.search(/if\s*\(\s*불러옴\s*!==\s*'됨'\s*\)/)
  assert.ok(막음 >= 0 && 막음 < 보냄,
    '불러오기 성공을 확인하기 전에 목록 전체를 보낸다 — 못 불러온 날 시설 문안이 기본값으로 덮인다')
  // 실패를 **기억해야** 막을 수 있다. 조용히 삼키면 위 조건은 영원히 '됨'이 아니거나 거짓으로 '됨'이다.
  const 불러오기 = 코드만.slice(코드만.indexOf('const 불러오기'), 시작)
  assert.match(불러오기, /\.catch\([^)]*\)\s*=>\s*set불러옴\('실패'\)|\.catch\(\s*\(\)\s*=>\s*\{?\s*set불러옴\('실패'\)/,
    '불러오기 실패를 기억하지 않는다')
  assert.match(코드만, /다시 불러오기/, '못 불러왔을 때 다시 시도할 길이 화면에 없다')
})

test('**없는 기능을 단정하지 않는다** — 플러그는 아직 안 붙어 있다', () => {
  // 사용자 확정 2026-09-16: *"플러그 연동예정"*. 앞 판은 *"SwitchBot 전원이 자동 ON
  // 됩니다"* 라고 단정했다 — 급할 때 「전원이 켜지겠구나」 하고 믿게 만드는 문구다.
  const src = 읽기('src/components/admin/sections/EmergencyBroadcast.jsx')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/SwitchBot 전원이 자동 ON 됩니다/.test(코드만),
    '안 켜지는 것을 켜진다고 단정한다')
  assert.match(코드만, /아직 연결된 장치가 없어/,
    '플러그가 실제로는 안 켜진다는 사실을 화면이 말하지 않는다')
})
