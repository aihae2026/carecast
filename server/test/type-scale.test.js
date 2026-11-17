// 글자 역할 여섯 — 조용히 되돌아가면 안 되는 것들 (2026-09-13).
//
// 정본은 `docs/audit/design-typography-v4.md`(T-1~T-9). 화면(JSX)은 여기서 못 돌리므로
// 소스를 글자로 읽어 고정한다. 부정 단언 앞에는 긍정 앵커를 세운다(CLAUDE.md).
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

const CSS = 'src/index.css'
// 자동순서 화면 — 14px 바닥과 색 셋을 지키는 자리
const 자동순서 = [
  'src/components/admin/sections/MorningEditor.jsx',
  'src/components/admin/sections/morningEditorPanels.jsx',
  'src/components/admin/sections/morningEditorParts.jsx',
  'src/components/admin/sections/StepList.jsx',
]

test('감시할 대상이 있다 — 역할 클래스 여섯이 그 자리에 있다', () => {
  const css = read(CSS)
  for (const [이름, px] of [['t-page', 28], ['t-section', 20], ['t-group', 18],
                            ['t-body', 16], ['t-label', 16], ['t-sub', 14]]) {
    const m = css.match(new RegExp(`\\.${이름}\\s*\\{([^}]*)\\}`))
    assert.ok(m, `.${이름} 이 없다 — 옮겼으면 이 시험도 같이 옮긴다`)
    assert.match(m[1], new RegExp(`font-size:\\s*${px}px`),
      `.${이름} 의 크기가 ${px}px 이 아니다: ${m[1].trim()}`)
    assert.match(m[1], /line-height:\s*\d+px/,
      `.${이름} 에 행간이 없다 — 크기만 주면 한글이 뭉친다(T-6)`)
  }
})

test('역할 클래스는 components 층에 있다 — 유틸리티가 덮어쓸 수 있어야 한다', () => {
  // **T-7.** utilities 에 두면 생성된 유틸리티보다 뒤에 깔려서 `class="t-sub text-lg"` 의
  // t-sub 가 이긴다. 이 저장소는 `.easy-card` 로 이미 그 함정에 빠져 있다(G-30).
  //
  // **방향까지 본다.** 처음엔 "@layer components 라는 글자가 있다"만 봤는데, 그러면
  // 역할 클래스를 utilities 블록으로 **옮겨도 초록불**이었다.
  // **주석을 먼저 걷는다.** 안 걷었더니 이 파일의 주석에 적힌 "@layer components" 라는
  // 글자를 블록 시작으로 읽어 엉뚱하게 빨간불이 났다(2026-09-13). 규칙을 설명하는 글이
  // 규칙을 검사하는 코드를 속인 것이다.
  const css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '')
  const c = css.indexOf('@layer components')
  assert.ok(c >= 0, '@layer components 블록이 없다')
  const t = css.indexOf('.t-page')
  assert.ok(t > c, '.t-page 가 @layer components 앞에 있다')

  // components 블록 뒤에 다른 @layer 가 열리기 전까지가 그 블록이다.
  const 다음층 = css.indexOf('@layer', c + 1)
  assert.ok(다음층 === -1 || t < 다음층,
    '역할 클래스가 components 블록 밖으로 나갔다 — 유틸리티가 못 덮어쓴다(T-7)')

  // utilities 블록 안에 들어가 있지 않은가를 **따로** 본다(가지를 갈라서).
  const u = css.indexOf('@layer utilities')
  if (u >= 0 && u < t) {
    const u끝 = css.indexOf('@layer', u + 1)
    assert.ok(u끝 !== -1 && t > u끝,
      '역할 클래스가 utilities 블록 안에 있다 — `text-lg` 를 덮어써 버린다')
  }

  // ── `.input-base` 도 **같은 층**이어야 한다 (2026-09-13) ──────────────────────
  // utilities 에 있던 동안 `class="input-base pl-9"` 의 `pl-9` 가 **조용히 졌다**
  // (dist CSS 실측: `.pl-9` @35649 < `.input-base` @56021 · 브라우저 paddingLeft 12px).
  // 눈에 보인 증상은 **돋보기 아이콘이 「내용 또는 담당자 검색」 글자를 15px 파고든 것**이고,
  // 같은 이유로 `pr-10`(지우기 단추 자리)·`py-1`(낮은 입력칸)·`w-auto`(날짜 칸)가 전부
  // 지고 있었다 — 방송 로그의 날짜 칸이 세로로 늘어져 화면을 넘긴 것도 이것이다.
  // 역할 클래스와 **원인도 증상도 같은 종류**라 같은 자리에서 함께 본다.
  const i = css.indexOf('.input-base')
  assert.ok(i >= 0, '.input-base 가 없다 — 옮겼으면 이 가드도 같이 옮긴다')
  assert.ok(i > c, '.input-base 가 @layer components 앞에 있다')
  const 다음층2 = css.indexOf('@layer', c + 1)
  assert.ok(다음층2 === -1 || i < 다음층2,
    '.input-base 가 components 블록 밖이다 — `pl-9`·`w-auto` 같은 유틸리티가 조용히 진다')
})

test('서체는 하나다 — Inter 를 다시 들이지 않는다', () => {
  const css = read(CSS)
  // 긍정 앵커 먼저: 볼 대상이 이 파일에 있다.
  assert.match(css, /font-family:\s*'Pretendard'/,
    'body 의 서체 선언이 없다 — 옮겼으면 이 가드도 같이 옮긴다')
  assert.doesNotMatch(css, /'Inter'/,
    "index.css 에 Inter 가 돌아왔다 — 한 줄 안에서 서체가 갈린다(T-8)")

  const html = read('index.html')
  assert.match(html, /pretendard/i, 'index.html 이 Pretendard 를 안 받는다')
  assert.doesNotMatch(html, /family=Inter/,
    'index.html 이 Inter 를 다시 받아 온다 — 쓰지도 않는 서체가 첫 화면을 늦춘다')

  const cfg = read('tailwind.config.js')
  assert.match(cfg, /sans:\s*\['Pretendard'/, "tailwind 의 sans 가 Pretendard 로 시작하지 않는다")
  assert.doesNotMatch(cfg, /inter:/, 'tailwind 에 inter 별칭이 돌아왔다(참조 0곳이었다)')
})

test('숫자 정렬은 tabular-nums 로만 한다 — 서체를 갈아끼우지 않는다', () => {
  // Pretendard 가 tnum 을 실제로 지원하는 것을 브라우저에서 쟀다(2026-09-13):
  // 기본이면 "1"=7.02px·"0"=9.53px 로 **2.5px 씩 흔들리고**, tabular-nums 를 주면
  // 둘 다 9.83px 로 같아진다. 그래서 `.nums` 는 시각 칸에 없으면 안 되는 장치다.
  const css = read(CSS)
  const m = css.match(/\.nums\s*\{([^}]*)\}/)
  assert.ok(m, '.nums 가 없다')
  assert.match(m[1], /font-variant-numeric:\s*tabular-nums/, '.nums 가 숫자 폭을 안 묶는다')
  assert.doesNotMatch(m[1], /font-family/,
    '.nums 가 서체를 바꾼다 — "07:50 아침 방송" 의 숫자와 글자가 다른 폰트가 된다(T-8)')
})

test('자동순서에 14px 미만이 없다 — 바닥은 t-sub 다', () => {
  for (const p of 자동순서) {
    const code = codeOnly(read(p))
    // 긍정 앵커: 이 파일이 역할 클래스를 실제로 쓰고 있다(대상이 있는 파일이다).
    assert.match(code, /\bt-sub\b/, `${p} 가 역할 클래스를 안 쓴다 — 옮겼으면 이 가드도 같이 옮긴다`)
    const 작은것 = code.match(/\btext-\[(?:9|10|11|12|13)px\]|\btext-xs\b/g)
    assert.equal(작은것, null,
      `${p} 에 14px 미만이 돌아왔다(${작은것 && [...new Set(작은것)].join(', ')}) — T-3`)
  }
})

test('자동순서의 색 계열은 셋뿐이다 — 종류색과 상태색을 섞지 않는다', () => {
  // **G-1**: 말=파랑(tts) · 음악=자주(bgm) · 순서=보라(flow). 그 밖의 색조는
  // 아무것도 가리키지 못하면서 뜻 있는 색까지 안 보이게 만든다.
  // 상태색(cc-danger·cc-warning·cc-success)은 종류가 아니라 **상태**라 예외다(G-35).
  const 금지 = /\b(?:bg|text|border|ring|from|to)-(violet|amber|rose|indigo|teal|purple|green|orange)-[0-9]{2,3}\b/g
  for (const p of 자동순서) {
    const code = codeOnly(read(p))
    const 걸린것 = code.match(금지)
    assert.equal(걸린것, null,
      `${p} 에 종류색 밖의 색조가 돌아왔다(${걸린것 && [...new Set(걸린것)].join(', ')}) — G-1`)
  }
})

test('레인마다 색을 주지 않는다 — TABS 에 color 가 없다', () => {
  const src = read('src/components/admin/sections/morningEditorConst.js')
  const m = src.match(/const TABS = \[([\s\S]*?)\n\]/)
  assert.ok(m, 'TABS 를 못 찾았다 — 옮겼으면 이 가드도 같이 옮긴다')
  // 긍정 앵커: 다섯 줄이 그대로 있다(지워 놓고 통과하는 것을 막는다).
  assert.equal((m[1].match(/\bid:\s*'/g) || []).length, 5, 'TABS 가 다섯 줄이 아니다')
  assert.doesNotMatch(m[1], /color:/,
    'TABS 에 레인별 색이 돌아왔다 — 왜 국민체조가 초록인지 답할 수 있는 사람이 없다(G-1)')
})

test('자동방송 발사표는 한 벌뿐이다 — 화면이 제 표를 다시 만들지 않는다', () => {
  const code = codeOnly(read('src/components/admin/sections/MorningEditor.jsx'))
  // 긍정 앵커 — 단일 출처를 실제로 쓴다.
  assert.match(code, /import \{ AUTO_TRIGGER \} from '\.\.\/\.\.\/\.\.\/lib\/broadcastTrigger'/,
    '단일 출처(AUTO_TRIGGER)를 안 쓴다')
  assert.match(code, /AUTO_TRIGGER\[activeTab\]\(\)/, 'AUTO_TRIGGER 를 부르지 않는다')
  // 부정 — 사본이 돌아오지 않았다. 자동방송이 하나 늘 때 두 곳을 고쳐야 하고,
  // 한 곳만 고치면 **그 방송만 조용히 안 나간다.**
  assert.doesNotMatch(code, /morning:\s*triggerMorningBroadcast/,
    '발사표 사본이 화면에 돌아왔다 — 단일 출처는 lib/broadcastTrigger.js 다')
})

test('「지금 방송」은 한 번 더 묻는다 — 되돌릴 수 없는 동작이다', () => {
  const code = codeOnly(read('src/components/admin/sections/MorningEditor.jsx'))
  // **이름 끝까지 본다.** 처음엔 `/<ConfirmDialog/` 였는데 그러면 `<ConfirmDialogX` 처럼
  // 다른 부품으로 갈아 끼워도 초록불이었다(2026-09-13 변이 시험에서 놓쳤다).
  assert.match(code, /<ConfirmDialog[\s/>]/, '확인창이 없다 — G-42')
  // **방향까지 본다.** 단추가 곧바로 handleTrigger 를 부르면 확인창이 있어도 소용없다.
  const 단추 = code.match(/onClick=\{[^}]*\}\s*\n?\s*className="[^"]*"[^>]*>\s*<Radio/)
  assert.ok(code.includes('onClick={() => setAsk(true)}'),
    '「지금 방송」이 확인창을 열지 않고 바로 발사한다 — G-42')
  assert.doesNotMatch(code, /onClick=\{handleTrigger\}/,
    '단추가 handleTrigger 를 직접 부른다 — 확인창을 건너뛴다')
  assert.ok(단추 !== undefined)
})

test('두께는 둘뿐이다 — 600 과 400 (방송 표시 화면은 예외)', () => {
  // **T-10.** 착수 시 제품의 두께는 다섯 종 762곳이었다(semibold 421·bold 191·medium 127·
  // normal 15·black 8). 다섯이면 "제일 굵은 것"이 무엇인지 눈이 못 고른다 — 실제로 제일
  // 굵은 `font-black`(900)이 제목이 아닌 자리(날씨 숫자)에 있었다.
  const 훑기 = (d, acc = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      // 방송 표시 화면은 UI 가 아니라 **어르신이 홀에서 멀리 보는 게시물**이다.
      if (e.isDirectory()) { if (e.name !== 'broadcast') 훑기(p, acc) }
      else if (/\.jsx?$/.test(e.name)) acc.push(p)
    }
    return acc
  }
  const 파일들 = 훑기(path.join(ROOT, 'src'))
  // 긍정 앵커 — 볼 대상이 실제로 많다(폴더가 비면 조용히 통과하는 것을 막는다).
  assert.ok(파일들.length > 50, `훑은 파일이 ${파일들.length}개뿐이다 — 경로가 바뀌었나`)

  const 걸린것 = []
  for (const p of 파일들) {
    const code = codeOnly(fs.readFileSync(p, 'utf8'))
    for (const m of code.match(/\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/g) || [])
      걸린것.push(`${path.relative(ROOT, p)}: ${m}`)
  }
  assert.deepEqual(걸린것, [],
    `600·400 밖의 두께가 돌아왔다 — T-10\n  ${걸린것.slice(0, 8).join('\n  ')}`)

  // 그리고 **쓰이고는 있다** — 둘 다 실제로 등장해야 "역할이 갈린다"가 성립한다.
  const 전부 = 파일들.map(p => fs.readFileSync(p, 'utf8')).join('\n')
  assert.match(전부, /\bfont-semibold\b/, '강조(600)를 아무도 안 쓴다')
  assert.match(전부, /\bfont-normal\b/,   '보통(400)을 아무도 안 쓴다')
})

test('방송 표시 화면은 이 규칙 밖이다 — 굵은 글씨를 지키고 있다', () => {
  // 예외가 **비어 있지 않다**는 것을 고정한다. 누가 "통일한다"며 여기까지 훑으면
  // 어르신이 홀에서 보는 자막이 얇아진다. 예외는 선언이 아니라 지켜져야 한다.
  const 자막 = read('src/components/broadcast/BroadcastCaption.jsx')
  assert.match(자막, /\bfont-black\b/,
    '방송 자막의 900 굵기가 사라졌다 — 멀리서 읽는 게시물이라 UI 규칙 밖이다(T-10 예외)')
})

test('껍데기 안에서 화면이 자기 바탕을 다시 깔지 않는다', () => {
  // **G-45.** `cc-bg` 와 `--ds-v3-bg` 는 **같은 값(#F4F6FB)** 이다. 그래서 이 판을 깔아도
  // 색이 한 픽셀도 안 틀리고, 아무도 못 알아챈 채 **물감 두 방울만 죽는다.**
  // 자동순서·설정만 "dev 그대로"로 보이던 원인이 이 한 줄이었다(사용자 지적 2026-09-13).
  const admin = codeOnly(read('src/pages/AdminMode.jsx'))
  assert.match(admin, /<HomeShell/, 'AdminMode 가 껍데기를 안 쓴다 — 옮겼으면 이 가드도 같이 옮긴다')
  const i = admin.indexOf('<HomeShell')
  assert.doesNotMatch(admin.slice(i), /className="[^"]*\bbg-cc-bg\b/,
    '껍데기 안에 불투명 바탕을 다시 깔았다 — 색은 같아서 안 보이고 물감만 죽는다(G-45)')
  // **방향까지 본다**: 관리자에서는 물감이 멈춰 있어야 한다.
  assert.match(admin, /backdrop="still"/,
    '관리자 화면의 물감이 떠다닌다 — 값을 고치며 오래 머무는 화면이다(G-46)')
})

test('껍데기는 sticky 를 죽이지 않는다 — overflow-hidden 이 아니다', () => {
  // **G-51.** `overflow:hidden` 인 조상은 스크롤 컨테이너가 되고, 그 안의 `position:sticky` 는
  // 그 상자를 기준으로 잡혀 **아예 발동을 안 한다.** 브라우저로 확인했다(1440, /admin):
  // 사이드바가 top 101px → -47px 로 따라 흘러갔고, `clip` 으로 바꾼 뒤 65px 에 붙었다.
  // 죽어 있던 것이 셋이다 — 관리자 사이드바 · 설정의 바로가기 칩 줄 · 자동순서 레인 목록.
  const shell = codeOnly(read('src/components/home/HomeShell.jsx'))
  assert.match(shell, /<main className=/, '본문 영역을 못 찾았다 — 옮겼으면 이 가드도 같이 옮긴다')
  const m = shell.match(/<main className=\{'relative ([a-z-]+)/)
  assert.ok(m, '본문의 overflow 설정을 못 읽었다')
  assert.equal(m[1], 'overflow-x-clip',
    `본문이 '${m[1]}' 이다 — hidden/auto/scroll 이면 안의 sticky 가 전부 죽는다(G-51)`)
})
