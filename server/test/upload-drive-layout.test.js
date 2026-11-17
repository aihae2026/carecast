// 업로드 화면은 **드라이브의 문법**을 따른다 (2026-09-13, 사용자 지시로 다시 짰다).
//
// 사용자 원문: *"구글드라이브가 저렇게 되어있어? 왼쪽에 지저분하게 안되어있잖아 …
// 옆에 메뉴는 음원 누르면 음원 좌르르, 영상 누르면 영상 좌르르, 어떤 플로우에서 선택하면
// 꼬리표만 붙여주면되잖아 … 왼쪽에는 폴더별 분류, 가운데에는 파일들 또는 유튜브링크
// 입력창, 오른쪽은 그 영상이나 음원 정보와 자막설정창"*
//
// 지적받은 것 여섯 — 이 파일이 그 여섯을 하나씩 문다:
//   ① 왼쪽에 **시스템 카테고리 아홉**이 폴더인 척 서 있었다 → 갈래 둘만 남기고 꼬리표로 내림
//   ② **「← 나감」** 은 우리끼리 쓰는 말이다 → 문장으로
//   ③ 올린 파일을 **지우거나 옮길 길이 목록에 없었다** → 줄마다 늘 보이는 동작
//   ④ **여러 개를 고를 수 없었다** → 체크박스와 일괄 동작
//   ⑤ **폴더에 들어갈 수 없었다** → 이름을 누르면 들어간다
//   ⑥ 유튜브 링크를 **창에서만** 넣을 수 있었고 그 창을 찾을 수 없었다 → 가운데에 상시
//
// 화면 구조는 브라우저를 열어야 보이므로 **소스 대조**로 고정한다. 되돌리면 여기가 운다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const MM = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'admin', 'sections', 'MusicManagement.jsx'), 'utf8')
// 주석은 걷고 본다 — 이 파일은 "예전엔 이랬다"를 주석으로 많이 적어서, 글자만 찾으면
// 그 설명 자체에 걸린다(폴더 삭제 안내에서 이미 한 번 겪었다).
//
// **`//` 줄 주석과 `{/* … */}` JSX 주석을 둘 다 걷는다.** 한쪽만 걷었더니 화면 안의
// JSX 주석에 적어 둔 «「← 나감」을 안 쓴다»는 설명 자체가 걸려 빨간불이 났다.
const 코드 = MM
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

test('긍정 앵커 — 이 파일이 업로드 화면을 그린다', () => {
  assert.match(코드, /export default function MusicManagement/)
  assert.match(코드, /<GroupHeader title="음원"/)
  assert.match(코드, /<GroupHeader title="영상"/)
})

// ── ① 왼쪽에는 갈래와 폴더만 ────────────────────────────────────────────────
test('왼쪽에 시스템 카테고리를 늘어놓지 않는다 — 갈래 둘과 사용자 폴더뿐', () => {
  const i = MM.indexOf('<GroupHeader title="음원"')
  const j = MM.indexOf('{/* ══ 가운데')
  assert.ok(i >= 0 && j > i, '왼쪽 칸의 경계를 못 찾았다 — 옮겼으면 이 시험도 옮긴다')
  const 왼쪽 = MM.slice(i, j)

  // 사용자 폴더는 트리로 그린다(긍정 앵커)
  assert.match(왼쪽, /groupFolders\['misc-audio'\]|오디오폴더/, '음원 폴더를 안 그린다')
  assert.match(왼쪽, /groupFolders\['misc-video'\]|영상폴더/, '영상 폴더를 안 그린다')
  // **시스템 카테고리를 다시 늘어놓으면 빨간불** — 그것이 지저분하다고 지적받은 그것이다
  assert.ok(!/보일카테고리\(/.test(왼쪽) && !/audioCats|videoCats/.test(왼쪽),
    '왼쪽에 시스템 카테고리 목록이 되살아났다 — 사용자 폴더와 섞여 구별이 안 된다')
})

test('카테고리는 줄의 **꼬리표**다 — 누르면 그 갈래만 걸러 본다', () => {
  assert.match(코드, /CATEGORIES\.find\(c => c\.key === it\.category\)/,
    '줄에서 갈래 이름을 찾지 않는다 — 꼬리표가 안 붙는다')
  assert.match(코드, /onClick=\{\(\) => navigateTo\(it\.category, \[\]\)\}/,
    '꼬리표를 눌러도 그 갈래로 못 간다 — 왼쪽에서 내렸으면 들어갈 길이 있어야 한다')
})

// ── ② 우리끼리 쓰는 말을 안 쓴다 ────────────────────────────────────────────
test('「← 나감」 같은 줄임말을 화면에 안 쓴다', () => {
  assert.ok(!/← 나감|←나감/.test(코드),
    '「← 나감」이 되살아났다 — 무엇이 나간다는 건지 사람은 모른다')
})

// ── ③ 지우고·옮기고·이름 바꾸는 길이 목록에 있다 ────────────────────────────
test('줄마다 동작이 **늘 보인다** — 마우스를 올려야 나오면 있는 줄도 모른다', () => {
  const i = MM.indexOf('{/* 줄 동작')
  assert.ok(i >= 0, '줄 동작 칸이 없다')
  // **글자 수로 자르지 않는다**(2026-09-13 고침). `i + 1400` 으로 잘랐더니, 줄에 주석
  // 몇 줄이 붙자 창이 `handleDelete(it)` 앞에서 끝나 **있는 코드를 없다고** 했다.
  // 끝은 그 줄의 끝(`</li>`)이다 — 그게 이 칸의 진짜 경계다.
  const 끝 = MM.indexOf('</li>', i)
  assert.ok(끝 > i, '줄의 끝(</li>)을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 동작 = MM.slice(i, 끝)
  assert.match(동작, /handleDelete\(it\)/, '줄에서 파일을 못 지운다')
  assert.match(동작, /handleDeleteFolder\(it\)/, '줄에서 폴더를 못 지운다')
  assert.match(동작, /handleRenameFolder\(it, n\)/, '줄에서 폴더 이름을 못 바꾼다')
  // 예전엔 `hidden group-hover:flex` 로 숨겨 뒀다
  assert.ok(!/group-hover:(flex|block)/.test(동작),
    '동작을 마우스 올림으로 숨겼다 — 터치 화면에서는 아예 닿지 않는다')
})

test('오른쪽 상세에서 옮기기·삭제·이름 바꾸기·자막이 된다', () => {
  const i = MM.indexOf('{/* ══ 오른쪽')
  assert.ok(i >= 0, '오른쪽 칸이 없다')
  const 오른쪽 = MM.slice(i)
  assert.match(오른쪽, /setMoveTarget\(상세\.것\)/, '옮기기가 없다')
  assert.match(오른쪽, /handleDelete\(상세\.것\)/, '삭제가 없다')
  assert.match(오른쪽, /handleRename\(상세\.것\)/, '이름 바꾸기가 없다')
  assert.match(오른쪽, /<SubtitleEditor file=\{상세\.것\}/, '자막 편집이 없다')
})

// ── ④ 여러 개 고르기 ────────────────────────────────────────────────────────
test('여러 개를 고르고 한 번에 옮기거나 지운다', () => {
  assert.match(코드, /type="checkbox" checked=\{다선택됨\}/, '전체 선택이 없다')
  assert.match(코드, /type="checkbox" checked=\{골랐나\}/, '줄 선택이 없다')
  assert.match(코드, /일괄삭제/, '여러 개를 한 번에 지우는 길이 없다')
  assert.match(코드, /setMoveTarget\(\{ 여럿: 고른파일 \}\)/, '여러 개를 한 번에 옮기는 길이 없다')
  assert.match(코드, /개 선택/, '몇 개 골랐는지 안 알려준다')
})

// ── ④-1 **글자만 보지 않는다 — 진짜 함수를 부른다** (V③ R15 지적 6, 2026-09-13) ─────
//
// 위 시험은 `setMoveTarget({ 여럿: 고른파일 })` 이라는 **글자가 있는지만** 봤다. 그런데
// 받는 쪽(`handleMoveFile`)은 `moveTarget.id` 하나만 읽고 있어서 **여러 개를 고르면
// `undefined` 를 서버로 보냈다.** 글자는 멀쩡했으므로 관련 시험 41건이 결함이 있는 채로
// 전부 초록이었다. 지키려는 것은 글자가 아니라 **결과**다.
test('여러 개 옮기기: 고른 것이 실제로 파일 목록으로 풀린다 — 진짜 함수를 부른다', async () => {
  const 옮기기 = await import(
    'file:///' + path.join(ROOT, 'src', 'lib', 'mediaMove.js').replace(/\\/g, '/'))
  const 옮길파일들 = 옮기기.옮길파일들

  // 목록의 「일괄 옮기기」가 넣는 모양 그대로
  const 셋 = [{ id: 1, original_name: 'a.mp3' }, { id: 2, original_name: 'b.mp3' }, { id: 3, original_name: 'c.mp3' }]
  assert.deepEqual(옮길파일들({ 여럿: 셋 }).map(f => f.id), [1, 2, 3],
    '여러 개를 골랐는데 파일 목록으로 안 풀린다 — 서버로 undefined 가 간다')

  // 오른쪽 상세의 「옮기기」가 넣는 모양 그대로 (파일 객체 하나)
  assert.deepEqual(옮길파일들({ id: 7, original_name: 'one.mp3' }).map(f => f.id), [7],
    '한 개 옮기기가 깨졌다')

  // 아무것도 안 고른 상태 · id 없는 찌꺼기는 서버로 보내지 않는다(그대로 가면 400 이다)
  assert.deepEqual(옮길파일들(null), [], '창이 닫힌 상태인데 뭔가를 옮기려 한다')
  assert.deepEqual(옮길파일들({ 여럿: [] }), [], '빈 선택인데 뭔가를 옮기려 한다')
  assert.deepEqual(옮길파일들({ 여럿: [{ original_name: 'id 없음' }, { id: 9 }] }).map(f => f.id), [9],
    'id 없는 것을 걸러내지 않는다 — 그대로 보내면 서버가 400 을 준다')

  // **화면이 그 함수를 실제로 쓰는가.** 위가 아무리 맞아도 화면이 제 안에서 따로 풀면 뜻이 없다.
  assert.match(코드, /옮기기실행\(\{ 옮길것: moveTarget/, '화면이 옮기기실행() 을 안 쓴다 — 판정이 두 벌이 된다')
  assert.ok(!/moveTarget\.id/.test(코드), 'moveTarget.id 를 직접 읽는 자리가 남아 있다 — 여러 개일 때 undefined 다')
})

// ── ④-2 **실제로 옮기는 자리까지 돌려 본다** (V③ R16 지적 1, 2026-09-14) ──────────────
//
// ④-1 은 **목록 변환만** 불렀다. 독립 검수가 다시 물었다 — *"API 호출을 제거하거나 잘못된
// ID 를 전달해도 이 시험은 통과할 수 있다. 요청 횟수·중간 실패 후 계속 처리·실패 안내를
// 단언하지 않는다."* 맞는 말이었다. 그래서 **옮기는 창구를 대역으로 갈아 끼워** 몇 번·어떤
// id·어느 목적지로 불렀는지까지 잰다.
test('여러 개 옮기기: 실제로 옮기는 자리를 돌려 본다 — 요청 수·id·목적지·중간 실패', async () => {
  const M = await import(
    'file:///' + path.join(ROOT, 'src', 'lib', 'mediaMove.js').replace(/\\/g, '/'))

  // ① 세 건 — 정확한 id 와 목적지로 **세 번** 부른다
  const 부른것 = []
  const 셋 = [{ id: 11, original_name: 'a.mp3' }, { id: 22, original_name: 'b.mp3' }, { id: 33, original_name: 'c.mp3' }]
  let r = await M.옮기기실행({
    옮길것: { 여럿: 셋 }, 목적지: 5,
    옮기기: async (id, 목적지) => { 부른것.push([id, 목적지]) },
  })
  assert.deepEqual(부른것, [[11, 5], [22, 5], [33, 5]], '고른 수만큼·고른 목적지로 안 부른다')
  assert.deepEqual([r.시도, r.옮김, r.실패.length], [3, 3, 0])
  assert.equal(M.옮기기안내(r), null, '다 잘 갔는데 굳이 알린다')

  // ② **두 번째가 실패해도 세 번째를 계속 부른다.** 폴더는 자기 카테고리만 받으므로
  //    여러 종류를 함께 고르면 일부만 들어가는 것이 정상이다.
  const 부른것2 = []
  r = await M.옮기기실행({
    옮길것: { 여럿: 셋 }, 목적지: null,
    옮기기: async (id) => {
      부른것2.push(id)
      if (id === 22) throw new Error('같은 종류의 폴더로만 옮길 수 있습니다')
    },
  })
  assert.deepEqual(부른것2, [11, 22, 33], '한 건이 실패하자 나머지를 그만뒀다')
  assert.deepEqual([r.시도, r.옮김, r.실패.length], [3, 2, 1])
  const 안내 = M.옮기기안내(r)
  assert.match(안내, /3개 중 1개/, '몇 개 중 몇 개가 안 갔는지 안 말한다')
  assert.match(안내, /b\.mp3/, '**어느 파일이** 안 갔는지 이름을 안 댄다')
  assert.match(안내, /같은 종류의 폴더/, '서버가 알려 준 이유를 사람에게 안 전한다')

  // ③ 한 개 옮기기 · 아무것도 안 고른 상태에서는 **한 번도 안 부른다**
  const 부른것3 = []
  const 한개 = await M.옮기기실행({ 옮길것: { id: 7, original_name: 'one.mp3' }, 목적지: 9, 옮기기: async (id, t) => 부른것3.push([id, t]) })
  assert.deepEqual(부른것3, [[7, 9]], '한 개 옮기기가 깨졌다')
  assert.deepEqual([한개.시도, 한개.옮김], [1, 1])
  for (const 빈것 of [null, { 여럿: [] }, { 여럿: [{ original_name: 'id 없음' }] }]) {
    const 부른것4 = []
    const rr = await M.옮기기실행({ 옮길것: 빈것, 목적지: 1, 옮기기: async (id) => 부른것4.push(id) })
    assert.deepEqual(부른것4, [], `옮길 것이 없는데 서버를 불렀다: ${JSON.stringify(빈것)}`)
    assert.equal(rr.시도, 0)
  }

  // ④ **화면이 그 결과를 실제로 쓰는가** — 창 닫기·새로고침·사람에게 말하기까지.
  assert.match(코드, /옮기기안내\(결과\)/, '옮기기 실패를 사람에게 말하지 않는다')
  assert.match(코드, /옮기기: moveAudioFile/, '화면이 진짜 옮기는 창구를 안 넘긴다 — 그러면 아무것도 안 옮긴다')
})

test('자리를 옮기면 고른 것을 비운다 — 안 보이는 줄이 골라진 채 남으면 안 된다', () => {
  const i = 코드.indexOf('const navigateTo')
  assert.ok(i >= 0, 'navigateTo 가 없다')
  const 본문 = 코드.slice(i, i + 500)
  assert.match(본문, /setz고른것\(new Set\(\)\)/, '자리를 옮겨도 선택이 남는다')
  assert.match(본문, /set상세\(null\)/, '자리를 옮겨도 상세가 남는다')
})

// ── ⑤ 폴더에 들어간다 · 폴더가 언제나 위 ────────────────────────────────────
test('폴더 이름을 누르면 그 안으로 들어간다', () => {
  assert.match(코드, /navigateTo\(it\.category, \[\.\.\.folderPath, \{ id: it\.id, name: it\.name \}\]\)/,
    '폴더를 눌러도 안 들어간다')
})

test('폴더가 **언제나 목록 위**에 있다', () => {
  const i = 코드.indexOf('const 줄들 = [')
  assert.ok(i >= 0, '목록을 짓는 자리가 없다')
  const 줄들 = 코드.slice(i, i + 260)
  const 폴더자리 = 줄들.indexOf('보일폴더')
  const 파일자리 = 줄들.indexOf('보일파일')
  assert.ok(폴더자리 >= 0 && 파일자리 >= 0, '폴더·파일을 둘 다 안 그린다')
  assert.ok(폴더자리 < 파일자리, '파일이 폴더보다 먼저 온다 — 드라이브·탐색기의 규칙과 반대다')
})

// ── ⑥ 유튜브 링크를 창 없이 그 자리에서 ─────────────────────────────────────
// 2026-09-21: 외부 동영상 링크 등록은 걷어냈다(사용자 지시) — 영상도 이 PC 에 올린 파일뿐이다.
test('걷어낸 링크 입력칸이 가운데에 되살아나지 않는다 — 영상은 파일로만 올린다', () => {
  assert.ok(!/유튜브 주소 붙여넣기|handleAddYoutube|addYoutubeVideoLink/.test(코드), '걷어낸 링크 입력이 남았다')
})

// ── 3단인가 ─────────────────────────────────────────────────────────────────
test('왼쪽·가운데·오른쪽 셋이 다 있다', () => {
  for (const 칸 of ['{/* ══ 왼쪽', '{/* ══ 가운데', '{/* ══ 오른쪽']) {
    assert.ok(MM.includes(칸), `${칸} 칸이 없다 — 3단 구성이 무너졌다`)
  }
})

// ── ⑦ 2026-09-13 두 번째 라운드 — 사용자 지적 넷 ─────────────────────────────

test('폴더는 **두 번 눌러** 들어간다 — 한 번은 고르는 것이다', () => {
  const i = MM.indexOf('{/* 이름 —')
  assert.ok(i >= 0, '이름 칸을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 끝 = MM.indexOf('{/* 갈래', i)
  assert.ok(끝 > i, '이름 칸의 끝을 못 찾았다')
  const 이름칸 = MM.slice(i, 끝)

  assert.match(이름칸, /onDoubleClick=\{\(\) => \{ if \(종류 === 'folder'\) navigateTo\(/,
    '폴더를 두 번 눌러도 안 들어간다')
  // 한 번 누르면 **자리를 옮기지 않는다.** 이름을 보려고 눌렀을 뿐인데 화면이 바뀌면 안 된다.
  const 한번 = 이름칸.slice(이름칸.indexOf('onClick='), 이름칸.indexOf('onDoubleClick='))
  assert.ok(!/navigateTo\(/.test(한번),
    '한 번 눌러도 들어간다 — 두 번 누르기와 뜻이 겹친다')
  assert.match(한번, /set상세\(\{ 종류: 'folder'/, '폴더를 한 번 눌러도 아무 일이 없다')
})

test('오른쪽 칸이 폴더도 받는다 — 안 그러면 폴더를 눌렀을 때 빈 칸이 뜬다', () => {
  const i = MM.indexOf('{/* ══ 오른쪽')
  const 오른쪽 = MM.slice(i)
  assert.match(오른쪽, /상세\.종류 === 'folder' \?/, '오른쪽이 폴더 갈래를 안 가른다')
  assert.match(오른쪽, /이 폴더 열기/, '폴더를 골랐을 때 들어갈 길이 없다')
  // 파일에만 있는 것을 폴더에 그리지 않는다 — 폴더에는 미리듣기도 자막도 없다
  const 폴더칸 = 오른쪽.slice(오른쪽.indexOf("상세.종류 === 'folder' ?"), 오른쪽.indexOf(') : ('))
  assert.ok(!/handlePreview|SubtitleEditor/.test(폴더칸),
    '폴더 상세에 파일용 단추가 들어 있다')
})

test('빵부스러기가 가운데 카드 **안**에 있다 — 세 칸의 윗변이 어긋나지 않게', () => {
  // 사용자 지적: *"음원 글씨 하나 때문에 안맞잖아 맞춰 높이 윗 끝"*.
  // 빵부스러기가 카드 밖 위에 있으면 가운데만 그 높이만큼 내려가 시작한다.
  const 가운데 = MM.slice(MM.indexOf('{/* ══ 가운데'), MM.indexOf('{/* ══ 오른쪽'))
  const 카드 = 가운데.indexOf('card-base p-3')
  const 빵   = 가운데.indexOf('ChevronRight size={12}')
  assert.ok(카드 >= 0 && 빵 >= 0, '가운데 칸의 카드나 빵부스러기를 못 찾았다')
  assert.ok(카드 < 빵,
    '빵부스러기가 카드보다 위에 있다 — 가운데 칸만 아래에서 시작해 윗변이 어긋난다')
})

test('자막을 열면 오른쪽이 넓어지고, 좁은 자리에서는 아래로 내려간다', () => {
  // 사용자 지적: *"정보에서 자막 작업하려면 반응형으로 나머지것이 좀 옆으로 가야하지 않겠니"*
  assert.match(MM, /const 자막폄 = Boolean\(/, '자막이 펴졌는지를 아무도 안 본다')
  // **폭을 클래스 글자로 고정하지 않는다**(2026-09-16). 앞 판은 `w-[440px]` 이라는 글자를
  // 요구했는데, 그 숫자는 아래 `오른쪽폭` 에도 **한 벌 더** 있었다 — 두 벌이면 한쪽만
  // 고쳐지는 날이 온다(실제로 1.5배로 넓히면서 그 자리가 됐다). 이제 숫자는 `오른쪽폭`
  // 한 곳이고 화면은 그것을 style 로 받는다. 지키는 사실은 그대로다: **자막을 펴면
  // 오른쪽이 넓어진다.**
  const 폭 = /const 오른쪽폭 = 자막폄 \? (\d+) : (\d+)/.exec(MM)
  assert.ok(폭, '오른쪽 칸 폭을 정하는 곳이 없다')
  assert.ok(Number(폭[1]) > Number(폭[2]),
    `자막을 열어도 오른쪽 칸이 안 넓어진다(${폭[1]} vs ${폭[2]}) — 좁은 칸에서는 문구가 한 글자씩 흐른다`)
  assert.match(MM, /style=\{좁나 \? undefined : \{ width: 오른쪽폭 \}\}/,
    '계산만 하고 화면이 그 폭을 안 받는다')

  // **화면 폭이 아니라 이 자리의 폭**을 잰다. 설정 껍데기는 사이드바가 280px 을 먼저 가져가서,
  // 같은 1920 모니터에서도 남는 폭이 다르다 — 미디어 질의로는 못 가른다.
  assert.match(MM, /new ResizeObserver\(재기\)/, '자리 폭을 안 잰다')
  assert.match(MM, /const 좁나 = 판폭 < \d+/, '좁은지 판정이 없다')
  assert.ok(!/laptop:grid-cols|hidden laptop:block/.test(MM.slice(MM.indexOf('{/* ══ 왼쪽'), MM.indexOf('{/* ══ 가운데'))),
    '왼쪽 칸을 화면 폭(미디어 질의)으로 숨긴다 — 설정 껍데기에서는 안 맞는다')
  assert.match(MM, /폴더 \{트리열림 \? '접기' : '펼치기'\}/,
    '좁을 때 왼쪽 트리를 펼칠 손잡이가 없다 — 접어 두기만 하면 폴더에 못 간다')
})

test('줄의 곁칸 둘도 **재서** 접는다 — 미디어 질의로는 설정 껍데기를 못 가른다', () => {
  // 브라우저 실측(2026-09-13, 1440 모니터의 /admin): 남은 폭이 976 뿐인데 `laptop:`·`wide:`
  // 가 둘 다 참이라 곁칸 둘(112+112)을 다 펼쳤고, **이름 칸이 30px** 이 됐다.
  // 이름이 안 보이는 목록은 목록이 아니다. 고친 뒤 같은 자리에서 이름이 온전히 보인다.
  assert.match(MM, /const 가운데폭 = 좁나 \? 판폭 :/, '가운데가 쓸 폭을 계산하지 않는다')
  // 재는 값의 **이름**이 2026-09-16 에 `가운데폭` → `가운데여유` 로 갈렸다(갈래 칸이
  // 자막을 폈나에 따라 좁아지면서, 그 차이를 더한 값으로 접기를 판정한다). 이름을 글자로
  // 박지 않고 **「잰 값으로 접는다」** 는 사실만 본다.
  assert.match(MM, /const 갈래칸보임 = 가운데[가-힣]* >= \d+/, '갈래 칸을 재서 접지 않는다')
  assert.match(MM, /const 정보칸보임 = 가운데[가-힣]* >= \d+/, '정보 칸을 재서 접지 않는다')
  // 자막을 펴면 오른쪽이 넓어지니 가운데가 줄고, 곁칸이 **먼저** 접혀 이름이 마지막까지 남는다.
  // (숫자 자체는 위 시험이 본다 — 여기서 겹쳐 박으면 1.5배로 넓힐 때 두 곳이 빨간불이 난다)
  assert.match(MM, /const 오른쪽폭 = 자막폄 \? \d+ : \d+/,
    '자막을 펴도 가운데 계산이 그대로다 — 곁칸이 안 접혀 이름이 다시 뭉개진다')

  // 줄 안에서 미디어 질의로 칸을 숨기지 않는다
  const i = MM.indexOf('{/* 갈래')
  const 끝 = MM.indexOf('</li>', i)
  assert.ok(i >= 0 && 끝 > i, '줄의 곁칸을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 곁칸 = MM.slice(i, 끝)
  assert.ok(!/hidden (laptop|wide|tablet):/.test(곁칸),
    '줄의 곁칸을 다시 화면 폭으로 숨긴다 — 설정 껍데기는 사이드바가 280px 을 먼저 가져간다')
  assert.match(곁칸, /갈래칸보임 \?/, '갈래 칸이 계산된 폭을 안 본다')
  assert.match(곁칸, /정보칸보임 \?/, '정보 칸이 계산된 폭을 안 본다')
})
