// 순서편집기 각 단계 행의 미리듣기 버튼 (2026-09-01)
//
// 왜 필요했나: 판정 함수(`lib/previewKind.js`)와 재생 함수는 진작 다 있었는데 **행에
// 버튼을 안 붙였을 뿐**이었다. `canPreview()`가 tts와 bgm에 false를 돌려줘서, 음원 단계
// 하나만 미리 들을 수 있었다. 사용자가 "단계별로 들어볼 수 있으면 좋겠다"고 요청.
//
// 이 가드가 지키는 것 둘:
//  1. 행 버튼이 종류를 가리지 않는다 — tts·bgm에도 붙는다
//  2. **BGM이 깔린 단계는 BGM부터 깔고 위에 얹는다.** 실제 방송이 그렇게 나가는데
//     맨목소리로만 들어보면 "음악에 묻히지 않는지"를 확인할 수 없다. 깔린 것이 무엇인지는
//     왼쪽 분홍 선과 같은 근거(bgmCover)를 본다 — 둘이 갈라지면 화면이 거짓말을 한다.
//  3. 무엇을 틀지 정하는 규칙은 한 곳(layBgmFor)이다. 전체 미리듣기가 따로 정하면
//     "전체로는 나는데 단계별로는 안 난다"가 된다 — 이 화면이 이미 겪은 사고다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'StepList.jsx')
const read = () => fs.readFileSync(FILE, 'utf8')

/** canPreview 함수 본문만 잘라 온다 */
function canPreviewBody() {
  const src = read()
  const start = src.indexOf('const canPreview = ')
  assert.ok(start > 0, '전제: canPreview가 있다')
  const end = src.indexOf('\n  }', start)
  assert.ok(end > start, '전제: canPreview의 끝을 찾을 수 있다')
  return src.slice(start, end)
}

test('행 미리듣기가 BGM 단계에도 붙는다', () => {
  const body = canPreviewBody()
  assert.match(body, /kind === 'bgm'\)\s*return true/,
    'BGM 단계에 미리듣기 버튼이 없다 — 브라우저 유튜브 재생기로 깔 수 있는데도 막혀 있다')
})

test('행 미리듣기가 TTS 단계에도 붙는다 — 단, 문구가 비어 있으면 안 붙는다', () => {
  const body = canPreviewBody()
  assert.match(body, /kind === 'tts'/,
    'TTS 단계에 미리듣기 버튼이 없다')
  assert.match(body, /kind === 'tts'\)\s*return !!String\(ttsText/,
    '문구가 비어 있어도 버튼이 붙는다 — 눌러도 아무 일이 없으면 고장으로 보인다')
})

test('BGM이 깔린 단계는 BGM부터 깔고 얹는다 — 왼쪽 분홍 선과 같은 근거를 본다', () => {
  const src = read()
  const start = src.indexOf('const handleRowPreview = ')
  assert.ok(start > 0, '전제: 행 미리듣기 처리기가 있다')
  const body = src.slice(start, src.indexOf('\n  }', start))
  assert.match(body, /bgmCover\[i\]/,
    '깔린 BGM을 왼쪽 선(bgmCover)과 다른 근거로 찾고 있다 — 둘이 갈라지면 화면이 거짓말을 한다')
  assert.match(body, /layBgmFor\(steps\[j\]/,
    '구간을 연 BGM 단계를 찾아 먼저 깔지 않는다')
})

// 사용자 신고(2026-09-02): 사이드바나 다른 자동순서 탭으로 넘어가도 미리듣기 음악이
// 계속 났다. BGM은 화면을 옮겨도 살아남는 앱 수준 재생기가 내기 때문이다 — 그렇게 만든
// 이유가 있지만(쉬운화면을 벗어나도 음악이 안 끊기게), 미리듣기까지 따라 살아남으면 안 된다.
test('이 화면을 떠나면 미리듣기를 끊는다 — BGM은 화면을 옮겨도 살아남는 재생기가 낸다', () => {
  const src = read()
  const at = src.indexOf('useEffect(() => () => {')
  assert.ok(at > 0, '떠날 때 정리하는 effect가 없다 — 사이드바로 넘어가도 음악이 계속 흐른다')
  assert.match(src.slice(at, at + 200), /stopAllPreview\(\)/,
    '떠날 때 끄는 문을 안 지난다')
})

// 끄는 자리가 갈래마다 흩어져 있으면 하나씩 빠뜨린다 — 실제로 이어듣기 루프를 빠뜨려서
// 미리듣기를 여러 개 누르면 소리가 겹쳤다(2026-09-02 사용자 신고).
test('끄는 문은 하나이고, 소리 갈래 셋을 모두 끈다', () => {
  const src = read()
  const at = src.indexOf('const stopAllPreview = ')
  assert.ok(at > 0, '끄는 문(stopAllPreview)이 없다')
  const body = src.slice(at, src.indexOf('\n  }', at))
  assert.match(body, /previewSessionRef\.current \+= 1/,
    '세대를 안 올린다 — await에서 깨어난 옛 경로가 소리를 다시 켠다')
  assert.match(body, /previewAllRef\.current\.stop = true/, '이어듣기 루프를 안 세운다')
  assert.match(body, /stopPreview\(\)/,    '음원·TTS 오디오를 안 끈다')
  assert.match(body, /stopPreviewBgm\(\)/, '유튜브 BGM을 안 끈다')
})

// 세대 확인이 빠지면 "여러 개 눌렀을 때 겹치는" 증상이 그대로 돌아온다.
// 미리듣기 경로는 대부분 await를 지난다(TTS 합성·유튜브 검색·파일 조회).
test('await에서 깨어난 경로는 자기 세대일 때만 소리를 낸다', () => {
  const src = read()
  const checks = [...src.matchAll(/최신인가\(my\)/g)].length
  assert.ok(checks >= 5,
    `세대 확인이 ${checks}곳뿐 — 루프·재생대기·BGM·TTS·음원 경로가 모두 확인해야 한다`)
  assert.match(src, /const 최신인가 = \(my\) => previewSessionRef\.current === my/,
    '세대 판정이 한 곳에 정의돼 있지 않다')
})

// 사용자 요청(2026-09-02): "BGM이랑 같이 나오는 거면 BGM만 따로가 아니라 TTS 묶음으로".
// 음악만 따로 들어서는 확인할 게 없다 — 알고 싶은 것은 "이 음악 위에 안내가 얹혔을 때
// 묻히지 않는가"다.
test('BGM 단계 미리듣기는 그 구간을 묶어서 들려준다 — 음악만 따로 틀지 않는다', () => {
  const src = read()
  const start = src.indexOf('const handleRowPreview = ')
  const body = src.slice(start, src.indexOf('\n  }', start))
  assert.match(body, /startPreviewAll\(span\)/,
    'BGM 단계가 구간 묶음이 아니라 음악만 튼다')
  assert.match(body, /c\.startsWith\('start'\)\) break/,
    '구간의 끝(다음 BGM 시작·커버리지 종료)을 안 보고 있다 — 뒤 단계까지 딸려 들어간다')
})

test('무엇을 틀지 정하는 규칙은 한 곳뿐 — 전체 미리듣기도 같은 함수를 쓴다', () => {
  const src = read()
  // 호출 자리 둘: 전체 미리듣기의 bgm 단계 + 단계별 미리듣기에서 "위에 깔린 BGM 먼저 깔기".
  // (BGM 단계 자체를 누른 경우는 구간 묶음으로 가므로 전체 미리듣기 쪽 자리를 다시 지난다.)
  const calls = [...src.matchAll(/layBgmFor\(/g)].length
  assert.ok(calls >= 2, `layBgmFor 호출이 ${calls}건 — 두 자리 모두 이 함수를 지나야 한다`)
  // BGM 곡을 고르는 로직이 두 벌이 되면 안 된다. 2026-09-21 부터 곡은 서버가 그 용도 폴더에서
  // 골라 준다(GET /bgm/preview) — **그 호출이 한 자리**인지 센다.
  const picks = [...src.matchAll(/getBgmPreview\(/g)].length
  assert.equal(picks, 1, `BGM 곡을 고르는 자리가 ${picks}곳 — 갈라지면 한쪽만 고쳐진다`)
})
