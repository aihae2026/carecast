// 시스템 설정 아코디언은 닫힌 그룹도 마운트한다 — 되돌리면 값이 늦게 뜬다 (TD-10, 2026-09-02)
//
// 왜 필요했나: SystemSettings.jsx가 1204줄이라 그룹 셋(오디오·방송 운영·기타)을 형제
// 파일로 떼어냈다. 그 셋은 각자 자기 상태와 초기 로드 effect를 함께 들고 갔다 — 상태만
// 옮기고 로딩을 부모에 남기면 props로 꿰야 해서 오히려 나빠지기 때문이다.
//
// 그래서 **불러오는 시점이 마운트 시점에 묶였다.** 쪼개기 전에는 부모가 모든 값을 한
// effect에서 미리 불러왔으므로, 그룹을 펼칠 때는 이미 값이 채워져 있었다. 만약
// AccordionSection이 예전처럼 open 조건으로 children을 가두면, 자식은 그룹을 펼치는
// 순간에야 마운트되고 그제서야 서버에 묻는다 — 딜레이 450, 빈 종료시각, 빈 커밋정보가
// 잠깐 보였다가 실제 값으로 바뀐다. 눈에 띄는 퇴보다.
//
// 그래서 children은 **항상 마운트하고 `hidden` 속성으로 감춘다.** 이 테스트는 그 형태와,
// 세 자식이 부모에서 열림 여부와 무관하게 렌더되는 것을 소스 대조로 고정한다.
// 개수를 세지 않고 **금지된 형태가 있으면 실패**시킨다 — 개수는 하나 늘고 하나 줄면 통과한다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const SECTIONS = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections')
const PARENT   = path.join(SECTIONS, 'SystemSettings.jsx')

// 2026-09-11: `SystemSettingsAudio` 는 시스템 설정에서 **'음량 및 TTS' 화면으로 옮겨졌다**
// (UX-37). 아코디언 자식이 아니므로 아래 목록에서 뺀다 — 다만 **목록이 그냥 줄면 감시가
// 조용히 헐거워진다**(CLAUDE.md 「파일을 가를 때」 규칙 2). 그래서 옮겨 간 자리를 보는
// 검사를 이 파일 끝에 함께 뒀다. 뜻은 그대로다: "값을 보여줄 컴포넌트가 실제로 렌더되고
// 스스로 불러온다."
const CHILDREN = [
  ['SystemSettingsBroadcast', 'systemSettingsBroadcast.jsx'],
  ['SystemSettingsEtc',       'systemSettingsEtc.jsx'],
  // 2026-09-23 — 방송 감시·백업 카드. '방송 운영 · 자동화' 갈래에 붙는다.
  ['SystemSettingsWatch',     'systemSettingsWatch.jsx'],
]

// 옮겨 간 것 — 부모가 아코디언이 아니라 '음량 및 TTS' 화면이다.
const MOVED = [['SystemSettingsAudio', 'systemSettingsAudio.jsx', 'SoundSettings.jsx']]

/** 주석을 지운다 — 주석이 금지 형태를 설명하느라 그 형태를 그대로 적기 때문이다 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ── 2026-09-12: **접이식을 걷었다.** 이 가드가 그 사실을 소리 내어 알렸다 ──────────
//
// 사용자 지시로 아코디언을 없애고 세 갈래를 다 펼쳐 뒀다(분량을 재 보니 「기타」가 389px
// 이었다 — 한 화면의 절반도 안 되는 것을 접고 있었다). 그 순간 아래 검사가
// "AccordionSection이 사라졌다 — 이 가드가 볼 대상이 없다"로 멈췄다.
// **조용히 통과하지 않은 것이 이 가드의 값어치다**(부정 단언 앞의 긍정 앵커, CLAUDE.md).
//
// **뜻은 그대로다**: "값을 보여줄 컴포넌트가 조건 없이 마운트돼 스스로 불러온다."
// 접이식이 없어졌으니 조건이 아예 없어야 한다 — 예전보다 강한 요구다. 그래서
// "hidden 으로 감춘다"는 **수단**은 빠지고 "가두지 않는다"는 **뜻**만 남긴다.

/** 갈래를 그리는 자리만 잘라낸다 — 부모의 다른 조건부 렌더에 걸리면 안 된다 */
function 갈래렌더본문(src) {
  const start = src.indexOf('function SettingsSection(')
  assert.notEqual(start, -1,
    'SettingsSection이 사라졌다 — 이 가드가 볼 대상이 없다. 갈래를 그리는 자리를 다시 짚을 것')
  const end = src.indexOf('\nexport default function SystemSettings', start)
  assert.notEqual(end, -1, 'SystemSettings 본체를 못 찾았다 — 파일 구조가 바뀌었다')
  return src.slice(start, end)
}

test('갈래를 그리는 자리가 children 을 조건부로 가두지 않는다', () => {
  const body = stripComments(갈래렌더본문(fs.readFileSync(PARENT, 'utf8')))

  assert.ok(/\{children\}/.test(body),
    'children 을 그리지 않는다 — 갈래 안의 내용이 아예 안 뜬다')

  // 접이식이 돌아오면 지연 마운트도 함께 돌아온다. 그 모양을 전부 막는다.
  assert.ok(!/\{\s*open\s*&&/.test(body),
    'open 조건으로 children 을 가두고 있다 — 닫힌 갈래가 마운트되지 않아,\n' +
    '  펼치는 순간 기본값(딜레이 450 등)이 잠깐 보였다가 실제 값으로 바뀐다.')
  assert.ok(!/hidden=/.test(body),
    'hidden 으로 감추고 있다 — 접이식을 걷었으므로 감출 것이 없다. 되살리려면 이 가드부터 고칠 것')
  assert.ok(!/style=\{\{[^}]*display/.test(body),
    'style.display 로 감추고 있다 — 이 저장소는 그렇게 감추지 않는다')
})

test('접이식 상태를 다시 들이지 않았다 — 기억해 두고 감추면 지연 마운트가 되살아난다', () => {
  const src = stripComments(fs.readFileSync(PARENT, 'utf8'))
  assert.ok(!/openGroup/.test(src),
    'openGroup 상태가 되살아났다 — 펼칠 때만 마운트되면 값이 늦게 뜬다')
  assert.ok(!/cc_settings_open_group/.test(src),
    '열린 갈래를 localStorage 에 기억하고 있다 — 접이식이 돌아온 것이다')
  // 긍정 앵커 — 깊은 링크는 **펼치는 대신 옮겨 준다**
  assert.match(src, /scrollIntoView/,
    'section 질의로 들어온 사람을 그 자리로 옮겨 주지 않는다')
})

test('남은 그룹 컴포넌트가 열림 여부와 무관하게 렌더된다', () => {
  const src = fs.readFileSync(PARENT, 'utf8')

  for (const [name, file] of CHILDREN) {
    assert.ok(fs.existsSync(path.join(SECTIONS, file)), file + '이 없다')

    const mod = './' + file.replace('.jsx', '')
    assert.ok(src.includes(name) && src.includes("from '" + mod + "'"),
      name + '을 부모가 ' + mod + '에서 가져오지 않는다')

    // 렌더 자리는 `{g.id === '...' && (` 안이다 — 그룹 **정체**로 고르는 것이지
    // 열려 있느냐로 고르는 것이 아니다. openGroup으로 걸면 지연 로딩이 되살아난다.
    const at = src.indexOf('<' + name + ' />')
    assert.notEqual(at, -1, name + '을 부모가 렌더하지 않는다')

    // 이 렌더를 감싸고 있는 가장 가까운 조건을 본다
    const before = src.slice(0, at)
    const cond   = before.slice(before.lastIndexOf('{g.id'))
    assert.ok(cond.length > 0 && cond.length < 400,
      name + '의 렌더가 `{g.id === ...}` 슬롯 안에 있지 않다 — 조건이 무엇인지 확인할 것')
    assert.ok(!/openGroup/.test(cond),
      name + '의 렌더가 openGroup에 걸려 있다 — 펼칠 때만 마운트되면 값이 늦게 뜬다')
  }
})

/** 마운트 시 1회 로드 effect(`useEffect(() => { … }, [])`)가 있는가.
 *  두 검사(남은 것 · 옮겨 간 것)가 **같은 판정**을 쓰도록 함수로 뺐다 — 두 벌로 적었더니
 *  한쪽 정규식이 깨진 채로 들어간 적이 있다(2026-09-11). */
function 마운트로드있음(src) {
  return /useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[\]\)/.test(src)
}

test('남은 그룹 컴포넌트가 각자 마운트 시 1회 로드 effect를 들고 있다', () => {
  // 위 두 가드가 통과해도, 자식이 불러오기를 안 하면 아무 값도 안 채워진다.
  for (const [, file] of CHILDREN) {
    const src = fs.readFileSync(path.join(SECTIONS, file), 'utf8')
    assert.ok(마운트로드있음(src),
      file + '에 마운트 시 1회 로드 effect가 없다 — 껍데기만 옮긴 것이다')
  }
})

// ── 옮겨 간 컴포넌트를 계속 본다 (2026-09-11) ────────────────────────────────
// 목록에서 빼기만 하면 그 파일은 아무도 안 보게 된다. 뜻(값을 보여줄 컴포넌트가 실제로
// 렌더되고 스스로 불러온다)을 새 자리에서 그대로 지킨다.
test('음량 및 TTS 화면이 옮겨 온 컴포넌트를 실제로 렌더한다', () => {
  for (const [name, file, host] of MOVED) {
    const hostPath = path.join(SECTIONS, host)
    assert.ok(fs.existsSync(hostPath), host + '이 없다 — 이 가드를 옮길 것')
    const src = fs.readFileSync(hostPath, 'utf8')
    assert.ok(src.includes("from './" + file.replace('.jsx', '') + "'"),
      host + '이 ' + name + '을 가져오지 않는다')
    assert.notEqual(src.indexOf('<' + name + ' />'), -1, host + '이 ' + name + '을 렌더하지 않는다')

    const child = fs.readFileSync(path.join(SECTIONS, file), 'utf8')
    assert.ok(마운트로드있음(child),
      file + '에 마운트 시 1회 로드 effect가 없다 — 껍데기만 옮긴 것이다')
  }
})

test('시스템 설정에는 더 이상 오디오·TTS 아코디언이 없다 — 두 자리에 두지 않는다', () => {
  const src = stripComments(fs.readFileSync(PARENT, 'utf8'))
  assert.ok(!/id: 'audio'/.test(src), "시스템 설정에 'audio' 아코디언이 남아 있다 — 소리 설정이 또 두 곳이다")
  assert.ok(!/id: 'tts'/.test(src),   "시스템 설정에 'tts' 아코디언이 남아 있다")
  assert.ok(/id: 'broadcast'/.test(src), '긍정 앵커 — 남아야 할 그룹까지 사라졌다')
})
