// 뜨는 창의 규격 — 13벌이 다시 갈라지지 않게 (G-53~G-59, 2026-09-13).
//
// 착수 시 실태: 덮개 색 6종 · 카드 반경 6종 · 그림자 5종. 13개 중 테두리가 있는 것 둘,
// `role`+`aria-modal` 둘, **초점이 돌아오는 것 하나**. 여덟은 Escape 로 안 닫혔고
// 닫기 단추가 44px 인 것은 **하나도 없었다**(18·26·27·32px).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n')
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const SHELL = 'src/components/shared/ModalShell.jsx'
const A11Y  = 'src/components/shared/useDialogA11y.js'
const CLOSE = 'src/components/shared/CloseButton.jsx'

test('감시할 대상이 있다 — 부품 셋이 그 자리에 있다', () => {
  for (const p of [SHELL, A11Y, CLOSE])
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} 가 없다 — 옮겼으면 이 시험도 같이 옮긴다`)
})

test('덮개는 알파가 붙은 토큰이다 — `/30` 수식어를 쓰지 않는다', () => {
  // **Tailwind v3 는 `var()` 색에 투명도 수식어가 안 먹는다.** 오류도 안 나고 **조용히
  // 투명해진다.** 실제로 `bg-ds-v3-ink/30` 으로 만들었다가 브라우저에서 덮개가
  // `rgba(0,0,0,0)` 으로 잡혔다(2026-09-13). `tokens.css` 머리말이 경고하는 그 함정이다.
  const code = codeOnly(read(SHELL))
  assert.match(code, /bg-ds-v3-veil/, '덮개가 veil 토큰이 아니다')
  assert.doesNotMatch(code, /bg-ds-v3-\w+\/\d/,
    '덮개에 투명도 수식어를 썼다 — var() 색에는 안 먹어 조용히 투명해진다')

  // 토큰이 양쪽에 다 등록돼 있나(한쪽만 있으면 클래스가 조용히 안 먹는다).
  assert.match(read('src/styles/tokens.css'), /--ds-v3-veil:\s*#[0-9A-Fa-f]{8};/,
    'tokens.css 에 veil 이 없거나 알파가 안 붙었다')
  assert.match(read('tailwind.config.js'), /'v3-veil':\s*'var\(--ds-v3-veil\)'/,
    'tailwind.config.js 에 veil 이 없다')
})

test('덮개에 blur 를 걸지 않는다 — 현장 PC 는 내장 그래픽이다', () => {
  const code = codeOnly(read(SHELL))
  assert.match(code, /fixed inset-0/, '덮개를 못 찾았다')
  assert.doesNotMatch(code, /backdrop-blur/,
    '덮개에 blur 가 들어왔다 — 뒤가 흐려지면 무엇 위에 떠 있는지를 잃고, 창을 열 때마다 프레임이 떨어진다')
})

test('창은 body 로 포털된다 — 부모의 overflow·transform 에 안 갇힌다', () => {
  const code = codeOnly(read(SHELL))
  assert.match(code, /createPortal\(/, '포털을 안 쓴다')
  assert.match(code, /document\.body,?\s*\)/, 'body 가 아닌 곳으로 포털한다')
})

test('접근성 넷이 한 벌로 온다', () => {
  const shell = codeOnly(read(SHELL))
  assert.match(shell, /aria-modal="true"/, 'aria-modal 이 없다')
  assert.match(shell, /role=\{role\}/, 'role 을 안 받는다')
  assert.match(shell, /aria-labelledby=/, '제목 연결이 없다')

  const a11y = codeOnly(read(A11Y))
  // **방향까지 본다.** 넷 중 하나라도 빠지면 키보드로 쓰는 사람이 그 창에 갇힌다.
  assert.match(a11y, /e\.key !== 'Escape'/, 'Escape 로 안 닫힌다')
  // **돌아갈 자리를 어디서 얻는가는 아래 「초점 복귀의 함정 둘」이 본다.**
  // 여기 잠깐 `돌아갈자리.current = document.activeElement` 를 고정해 뒀었는데,
  // **그것이 바로 버그였다** — 창 안 입력칸의 `autoFocus` 보다 늦게 읽어 그 입력칸을
  // 저장하고 있었다. 시험이 틀린 방식을 지키고 있던 셈이다(2026-09-13).
  assert.match(a11y, /돌아갈자리\.current = /, '돌아갈 자리를 저장하지 않는다')
  assert.match(a11y, /자리\.focus\(/, '**초점이 안 돌아온다** — 닫는 순간 탭 순서가 문서 처음으로 튄다')
  assert.match(a11y, /document\.body\.style\.overflow = 'hidden'/, '뒤쪽 스크롤이 안 잠긴다')
  // 풀어 주는 쪽도 있어야 한다 — 잠그기만 하면 창을 닫은 뒤 화면이 굳는다.
  assert.match(a11y, /document\.body\.style\.overflow = 원래/, '스크롤 잠금을 안 푼다')
})

test('Escape 는 **맨 위 한 겹만** 닫는다 — 아래 서랍까지 같이 닫지 않는다', () => {
  // 2026-09-13 실측한 사고: 서랍 안에서 연 폴더 선택 창에 Escape 를 눌렀더니
  // **창과 서랍이 한 번에 닫혔다.** 서랍이 닫히며 `inert` 가 되어 돌아갈 자리가 사라졌고,
  // 겉으로는 "초점이 안 돌아온다"로만 보였다 — 증상과 원인이 다른 자리다.
  //
  // 원인은 `stopPropagation()` 이었다. 그것은 *다음 요소*로 가는 것만 막는다.
  // 서랍(`HomeDrawer`)도 **같은 `document`** 에 keydown 을 걸어 두어서 그대로 다 돌았다.
  const a11y = codeOnly(read(A11Y))

  // ① 잡기 단계에서 듣는다 — 거품 단계의 서랍보다 먼저 돌아야 가로챌 수 있다.
  assert.match(a11y, /addEventListener\('keydown', onKey, true\)/,
    'keydown 을 잡기 단계(capture)로 안 듣는다 — 서랍이 먼저 돌아 같이 닫힌다')
  assert.match(a11y, /removeEventListener\('keydown', onKey, true\)/,
    '뗄 때 단계를 안 맞췄다 — 처리기가 안 떨어져 쌓인다')

  // ② 같은 요소의 나머지 처리기까지 끊는다. `stopPropagation` 만으로는 안 된다.
  assert.match(a11y, /e\.stopImmediatePropagation\(\)/,
    'stopImmediatePropagation 이 없다 — 같은 document 에 붙은 서랍 처리기가 그대로 돈다')
  assert.doesNotMatch(a11y, /e\.stopPropagation\(\)/,
    '고쳐진 자리에 옛 `stopPropagation()` 이 남아 있다 — 그것으로는 안 막힌다')

  // ③ 겹쳐 뜬 창은 맨 위부터 하나씩. 더미가 없으면 Escape 한 번에 다 닫힌다.
  assert.match(a11y, /창더미\.push\(/,   '열린 창을 더미에 안 쌓는다')
  assert.match(a11y, /창더미\.splice\(/, '닫힌 창을 더미에서 안 뺀다 — 더미가 새면 Escape 가 죽는다')
  assert.match(a11y, /창더미\[창더미\.length - 1\] !== 표/,
    '맨 위인지 안 보고 닫는다 — 겹친 창이 한 번에 다 닫힌다')

  // ④ 서랍이 **여전히 document 에 keydown 을 건다**는 전제가 살아 있는지 확인한다.
  //    서랍이 다른 방식으로 바뀌면 위 셋이 지키는 대상이 사라진 것이니 같이 손봐야 한다.
  //    (부정 단언 앞의 긍정 앵커 — CLAUDE.md "파일을 가를 때" ②)
  const drawer = codeOnly(read('src/components/home/HomeDrawer.jsx'))
  assert.match(drawer, /document\.addEventListener\('keydown'/,
    '서랍이 document 에 keydown 을 안 건다 — 이 시험이 지키는 충돌이 사라졌다. 위 단언을 다시 볼 것')
})

test('창 안쪽에 14px 미만 글자가 없다 (7단계)', () => {
  // 주 사용자가 50~60대다. 창은 **결정하는 자리**라 — 예약 시각, 되돌릴 수 없는 삭제 —
  // 여기서 글자가 작으면 잘못 읽고 확정한다. 착수 시 네 파일에 83곳이 있었다
  // (12px 65 · 11px 14 · 10px 4).
  //
  // 굵기는 안 올렸다. `.t-sub` 는 `@layer components` 라서 `font-semibold` 같은
  // 유틸리티가 그대로 이긴다 — 그 층 순서를 맞춰 둔 이유가 이것이다.
  //
  // **`RepeatPicker` 도 이 목록에 든다.** 파일은 창 밖에 있지만 오직 예약 창 안에서만
  // 그려진다(사용처 1곳). 파일 위치가 아니라 **사람이 보는 자리**로 가른다 —
  // 실제로 이 파일을 빼 놨다가 브라우저에서 5곳이 남은 것을 봤다(2026-09-13).
  const 창파일 = [
    'src/components/shared/ScheduleModal.jsx',
    'src/components/shared/RepeatPicker.jsx',
    'src/components/shared/FlowBuilder.jsx',
    'src/components/shared/ConfirmDialog.jsx',
    'src/components/admin/sections/subtitleEditorModal.jsx',
    'src/components/admin/sections/musicManagementModals.jsx',
  ]
  for (const p of 창파일) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} 가 없다 — 옮겼으면 이 목록도 같이 옮긴다`)
    const code = codeOnly(read(p))
    // 긍정 앵커 — 감시할 대상이 이 파일에 있다(부정 단언만 두면 빈 파일도 통과한다).
    assert.match(code, /className=/, `${p} 에 화면이 없다 — 목록이 낡았다`)
    const 걸린것 = code.match(/\btext-xs\b|\btext-\[1[0-3]px\]/g) || []
    assert.equal(걸린것.length, 0,
      `${p} 에 14px 미만이 ${걸린것.length}곳 돌아왔다 (${[...new Set(걸린것)].join(', ')})`)
  }
})

test('닫기 단추의 타격 크기는 44px 이다', () => {
  // 주 사용자가 50~60대이고 현장 PC 는 터치일 수 있다. 어떤 창에서는 이 단추가
  // **유일한 출구**이기도 하다(자막 편집).
  const code = codeOnly(read(CLOSE))
  assert.match(code, /min-h-\[44px\]/, '높이가 44px 이 아니다')
  assert.match(code, /min-w-\[44px\]/, '폭이 44px 이 아니다')
  assert.match(code, /aria-label=\{label\}/, 'aria-label 이 없다 — 낭독기가 "버튼"이라고만 읽는다')
})

test('규격의 출처였던 ConfirmDialog 가 그 규격을 쓴다', () => {
  // **떼어 낸 뒤 원본이 안 쓰면 같은 것이 두 벌이 된다.** 이 저장소가 반복해 겪은 실패다.
  const code = codeOnly(read('src/components/shared/ConfirmDialog.jsx'))
  assert.match(code, /<ModalShell/, 'ConfirmDialog 가 공용 껍데기를 안 쓴다')
  assert.match(code, /role="alertdialog"/, '되돌릴 수 없는 확인인데 alertdialog 가 아니다')
  assert.match(code, /첫초점=\{cancelRef\}/,
    '**기본 초점이 「취소」가 아니다** — 엔터 한 번에 방송이 나간다(G-42)')
  // 옛 껍데기가 남아 있지 않다.
  assert.doesNotMatch(code, /fixed inset-0/, '제 덮개를 아직 그린다 — 껍데기가 두 벌이다')
})

test('초점 복귀의 함정 둘 — 늦게 듣기, 너무 빨리 되돌리기', () => {
  // 브라우저 실측으로 **두 번 연속 틀렸다**(2026-09-13). 둘 다 "초점을 되돌린다"는
  // 코드는 있는데 실제로는 `body` 로 떨어지던 자리다. 글자로만 보면 둘 다 통과한다.
  const code = read(A11Y)

  // ① **듣기 시작이 늦으면 안 된다.** 창 안에서 `document.activeElement` 를 읽으면,
  //    그때는 이미 창 안 입력칸의 `autoFocus` 가 초점을 가져간 뒤다 — 그 입력칸을
  //    "돌아갈 자리"로 저장하면 창이 닫히며 같이 사라져 돌아갈 데가 없다.
  //    그래서 **모듈 차원에서 늘 듣고**, 창 안쪽은 기억하지 않는다.
  assert.match(code, /^let 마지막초점 = null/m,
    '모듈 차원의 초점 추적기가 없다 — 창 안에서 읽으면 autoFocus 뒤라 늦다')
  assert.match(code, /document\.addEventListener\('focusin'/,
    'focusin 을 안 듣는다')
  assert.match(code, /!t\.closest\('\[role="dialog"\], \[role="alertdialog"\]'\)/,
    '창 안쪽까지 기억한다 — 돌아갈 자리는 창 밖이어야 한다')
  assert.doesNotMatch(code, /돌아갈자리\.current = document\.activeElement/,
    '열리는 순간 activeElement 를 읽는다 — autoFocus 보다 늦어서 창 안 입력칸을 저장한다')

  // ② **되돌리기가 너무 빠르면 안 된다.** 정리 함수에서 바로 focus 하면 창 DOM 이 아직
  //    안 지워진 상태라, 곧이어 초점 받은 요소가 사라지며 브라우저가 초점을 body 로
  //    **다시 떨군다.** 다음 프레임에 되돌려야 한다.
  assert.match(code, /requestAnimationFrame\(\(\) => \{\s*\n\s*if \(document\.contains\(자리\)\)/,
    '초점 되돌리기가 다음 프레임이 아니다 — 창이 지워지며 초점이 body 로 떨어진다')
})

// (링크 추가 창은 2026-09-21 외부 동영상 연동째 걷어냈다 — 셋이다)
test('음원 관리 모달 셋이 공용 껍데기를 쓴다', () => {
  const code = codeOnly(read('src/components/admin/sections/musicManagementModals.jsx'))
  assert.equal((code.match(/<ModalShell /g) || []).length, 3,
    '세 창이 다 공용 껍데기를 쓰지 않는다')
  // 옛 껍데기가 남아 있지 않다 — 남으면 한 화면에 두 규격이 된다.
  assert.doesNotMatch(code, /fixed inset-0/, '제 덮개를 아직 그린다')
  assert.doesNotMatch(code, /bg-black\/\d/, '옛 검정 덮개가 남았다')
  assert.doesNotMatch(code, /rounded-\[20px\]/, '옛 카드 반경이 남았다')
  assert.doesNotMatch(code, /boxShadow: '0 8px 32px/, '옛 인라인 그림자가 남았다')
})

test('예약 창은 저장 안 한 입력을 지키고, 안 고쳤으면 안 묻는다', () => {
  // **G-57 의 예외 조항.** 여기 적은 것은 방송 시각·문구라, 스치듯 지나간 클릭 한 번에
  // 날아가면 안 된다. 그래서 바깥 클릭은 막고, 닫는 길 셋(Escape·✕·취소)은 같은 관문을 지난다.
  const code = codeOnly(read('src/components/shared/ScheduleModal.jsx'))
  assert.match(code, /<ModalShell/, '공용 껍데기를 안 쓴다')
  assert.match(code, /바깥클릭=\{false\}/,
    '바깥을 눌러도 닫힌다 — 적어 둔 시각·문구가 클릭 한 번에 날아간다')

  // **관문을 실제로 지나는가.** 셋 중 하나라도 `onClose` 를 직접 부르면 그 길로 샌다.
  assert.match(code, /onClose=\{닫기\}/, '✕·Escape 가 관문을 안 지난다')
  assert.match(code, /onClick=\{닫기\}/, '「취소」가 관문을 안 지난다')
  assert.match(code, /const 닫기 = \(\) => \{ if \(고쳤나\) set닫기물음\(true\); else onClose\(\) \}/,
    '닫기 관문의 모양이 바뀌었다')

  // **안 고쳤으면 묻지 않는다.** 아무것도 안 했는데 물으면 성가시고, 다음번에 사람이
  // 그 물음을 안 읽게 된다 — 정작 고쳤을 때 그냥 눌러 버린다.
  assert.match(code, /const 고쳤나 = 처음값 !== JSON\.stringify\(form\)/,
    '고쳤는지 판정이 바뀌었다')
  assert.match(code, /const \[처음값\] = useState\(\(\) => JSON\.stringify\(form\)\)/,
    '처음 값을 게으른 상태로 잡지 않는다 — ref 로 두면 렌더 중 읽기가 된다')

  // 옛 껍데기가 안 남았다.
  assert.doesNotMatch(code, /fixed inset-0/, '제 덮개를 아직 그린다')
  assert.doesNotMatch(code, /bg-black\/\d/, '옛 검정 덮개가 남았다')
})

test('자막 편집 창은 손질을 지킨다 — 바깥 클릭으로 안 닫힌다', () => {
  // **13벌 중 가장 위험했던 자리.** 받아쓰기 결과를 사람이 손질한 것이라, 닫으면
  // 다시 만들려면 처음부터 들어야 한다. 그런데 예전엔 **바깥 클릭으로 그냥 닫혔다.**
  const code = codeOnly(read('src/components/admin/sections/subtitleEditorModal.jsx'))
  assert.match(code, /<ModalShell/, '공용 껍데기를 안 쓴다')
  assert.match(code, /바깥클릭=\{false\}/,
    '바깥을 눌러도 닫힌다 — 손질한 자막이 클릭 한 번에 사라진다')
  assert.match(code, /const 닫기 = \(\) => \{ if \(고쳤나\) set닫기물음\(true\); else onClose\(\) \}/,
    '닫기 관문이 없다')
  assert.match(code, /<Shell embedded=\{embedded\} onClose=\{닫기\}>/,
    '껍데기가 관문을 안 지난다')

  // **기준은 저장·불러오기 때마다 갱신된다.** 안 하면 저장한 뒤에도 계속 묻는다.
  assert.equal((code.match(/set기준\(/g) || []).length, 2,
    '기준 갱신이 두 곳(불러온 뒤·저장한 뒤)이 아니다')
})

test('자막 미리보기가 실제 방송 화면과 같은 배경을 쓴다', () => {
  // 확인하라고 만든 화면이 실제와 다른 것을 보여 주면 확인이 아니다.
  // 옛 사탕색 그라디언트(민트→라임) 하나가 여기 손으로 적혀 있었는데, 방송 화면이
  // 시간대 하늘로 바뀐 뒤에도 **이 미리보기에만 남아 있었다**(2026-09-13).
  const code = codeOnly(read('src/components/admin/sections/subtitleEditorModal.jsx'))
  assert.match(code, /from '\.\.\/\.\.\/\.\.\/lib\/skyPalette'/, '하늘 팔레트를 안 쓴다')
  assert.match(code, /const PREVIEW_BG = 하늘\.blobs\.map\(blobLayer\)/,
    '미리보기 배경을 단일 출처에서 안 만든다')
  assert.doesNotMatch(code, /linear-gradient\(-45deg/,
    '옛 사탕색 그라디언트가 미리보기에 남았다 — 제품에는 없는 배경이다')
})
