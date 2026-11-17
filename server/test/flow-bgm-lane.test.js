// 흐름·커스텀 자동순서의 분홍 선이 사실대로 말하게 (2026-09-02)
// (docs/td09-audiobus.md §3-A·§3-B · src/lib/bgmLane.js 머리말)
//
// 순서편집기(StepList)의 선은 H13에서 한 번 거짓말을 하다 걸렸다. 그 선을 흐름 화면
// (FlowBuilder·커스텀 자동순서 미리보기)에도 그리는데, **어휘가 다르다** — 흐름 단계는
// step.step_type이고 실행기도 server/services/flowRunner.js로 따로다. 자동방송 판정을
// 그대로 갖다 붙이면 같은 유형의 거짓말이 하나 더 생긴다. 그래서 서버에서 확인한 사실을
// 여기 박아 둔다.
//
// **자동방송과 갈리는 곳은 음원(audio)이다.**
//  · 자동방송의 음원 단계는 '잠시 멈춤'(pause)으로 그린다 — BGM이 돌아온다.
//  · 흐름의 음원 단계는 **끔(stop)**이다. flowRunner는 prayer_play를 restoreBGM:false로
//    쏘고, 받는 MusicPlayer는 (1) 무조건 carecast:broadcast-bgm-stop을 쏘고 (2) 되돌릴
//    BGM도 안 챙긴다(hadActiveBGM의 세 조건이 다 거짓). 게다가 흐름의 BGM은 언제나
//    유튜브(bgm_youtube_start)라, 그 정지 신호를 받으면 iframe이 사라지고 되살아날 길이
//    아예 없다 — 자동방송의 로컬 BGM에 있는 savedBGM 복귀 상태기계가 유튜브에는 없다.
//
// **유튜브 TV(video) 단계는 BGM을 안 끈다.** flowRunner는 tv-start만 쏘고 받는 쪽도 어떤
// BGM 정지 신호를 안 쏜다 → 음악은 실제로 계속 나간다(TV 소리와 겹쳐서). 겹치는 게 보기
// 싫다고 선을 끊으면 그게 H13과 똑같은 거짓말이다.
//
// 고정하는 사실 넷:
//  1. 흐름 step_type별 판정이 flowRunner의 실제 동작과 맞는다(근거를 소스에서 재확인)
//  2. 자동방송 판정에는 회귀가 없다(bgmRole·bgmCoverage 기본 동작 그대로)
//  3. FlowBuilder가 선을 그리고, 선이 **카드 안에서 시작하고 끝난다**(음수 오프셋 금지)
//  4. 커스텀 자동순서 미리보기(MorningEditor)도 같은 규칙·같은 그림을 쓴다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// Node는 CJS에서 ESM을 require할 수 있다(bgm-lane.test.js와 같은 방식)
const { bgmCoverage, bgmRole, flowBgmRole, flowBgmCoverage } =
  require(path.join(ROOT, 'src', 'lib', 'bgmLane.js'))

const S = (t) => ({ step_type: t })

// flowRunner.js에서 그 step_type을 다루는 갈래의 본문만 떼어 온다.
// 근거를 "파일 어딘가에 그 낱말이 있다"가 아니라 **그 갈래 안에 있다**로 보기 위한 것 —
// 파일 전체를 훑으면 다른 단계의 SSE 이름에 걸려 가드가 죽는다.
function flowBranch(stepType) {
  const src  = read('server/services/flowRunner.js')
  const head = `if (step.step_type === '${stepType}') {`
  const from = src.indexOf(head)
  assert.ok(from > 0, `flowRunner.js에 '${stepType}' 갈래가 없다 — 단계 유형이 사라졌거나 이름이 바뀌었다`)
  // 다음 갈래(또는 함수 끝)까지
  const rest = src.slice(from + head.length)
  const next = rest.search(/\n {2}if \(step\.step_type === '|\n}\n/)
  return rest.slice(0, next > 0 ? next : rest.length)
}

// ── 사실 1: 흐름 step_type 판정 ────────────────────────────────────────────────

// 2026-09-21: 흐름 BGM 이 **로컬 폴더(방송용·식사용)도** 될 수 있다. 신호는 bgmEmit 이 가른다
// (로컬 → bgm_start, 유튜브 → bgm_youtube_start). 예전 이 시험은 「로컬로 바뀌면 음원 단계의
// 복귀 규칙(savedBGM)이 살아나니 audio 판정을 다시 보라」고 적어 두었다 — **다시 봤다:**
// 흐름의 음원 단계는 token 을 싣고 restoreBGM:false 로 쏘므로 MusicPlayer 의 hadActiveBGM 이
// 거짓이 되어(`(restoreBGM || !token)`) 로컬 BGM 도 저장되지 않고 끝난다. 그래서 선은 그대로 참이다.
// 아래 음원 단계 시험이 그 두 조건(token·restoreBGM:false)을 함께 붙잡는다.
test('흐름의 BGM 단계가 구간을 연다 — bgmEmit 으로 쏘고 다음 단계로 넘어간다', () => {
  const branch = flowBranch('bgm')
  assert.match(branch, /emitBGM\(/,
    'flowRunner의 bgm 단계가 bgmEmit 을 안 거친다 — 로컬·유튜브 중 한쪽만 나가게 된다.')
  assert.match(read('server/services/bgmEmit.js'), /'bgm_youtube_start'[\s\S]*|'bgm_start'/,
    'bgmEmit 이 BGM 신호를 안 쏜다')
  assert.equal(flowBgmRole(S('bgm')), 'bgm')
})

test('흐름의 음원 단계는 BGM을 끈다 — 자동방송의 "잠시 멈춤"과 여기가 갈린다', () => {
  const branch = flowBranch('audio')
  // token 도 실려야 로컬 BGM 이 되살아나지 않는다(MusicPlayer: `(restoreBGM || !token)`).
  assert.match(branch, /prayer_play[\s\S]{0,200}?\btoken\b/, '음원 단계가 token 을 안 싣는다 — 로컬 BGM 이 녹음 음원 뒤처럼 되살아난다')
  assert.match(branch, /restoreBGM:\s*false/,
    'flowRunner의 음원 단계가 restoreBGM:false로 안 쏜다. true로 바뀌었다면 MusicPlayer가 '
    + 'BGM을 되돌리므로(hadActiveBGM 조건) 판정이 stop이 아니라 pause여야 한다 — '
    + '지금 화면은 "여기서 음악이 끝난다"고 그리고 있다.')
  // 받는 쪽(MusicPlayer): 흐르던 BGM 을 **세우고**(pause), restoreBGM:false + token 이면 **되살릴 것을
  // 안 챙긴다**(hadActiveBGM 거짓). 2026-09-21 부터 흐름의 BGM 도 이 재생기의 로컬 곡이다.
  const 재생기 = read('src/components/easy/MusicPlayer.jsx')
  const p = 재생기.indexOf("es.addEventListener('prayer_play'")
  const 처리 = 재생기.slice(p, 재생기.indexOf('\n    })', p))
  assert.match(처리, /const hadActiveBGM = !bgmWasStopping && \(restoreBGM \|\| !token\)/,
    'prayer_play 가 restoreBGM·token 으로 복귀를 가르지 않는다 — 판정 근거가 바뀌었다')
  assert.match(처리, /if \(audioRef\.current\) audioRef\.current\.pause\(\)/,
    'prayer_play 가 흐르던 BGM 을 안 세운다 — 흐름의 음원 단계는 BGM 을 끄지 않는 것이고, 선을 끊어 그리면 거짓말이 된다.')

  assert.equal(flowBgmRole(S('audio')), 'stop')
  // 선은 음원 칸 **앞에서** 끝난다 — 그 칸에는 이미 음악이 없다
  assert.deepEqual(
    flowBgmCoverage([S('bgm'), S('tts'), S('audio'), S('tts')]),
    ['start', 'mid|end', null, null],
    '흐름의 음원 단계 뒤로 선이 이어졌다 — 실제로는 BGM이 꺼져 있고, 흐름에는 그것을 '
    + '되살릴 bgm_after 같은 단계도 없다. 다시 켜려면 사람이 BGM 단계를 넣어야 한다.')
})

test('흐름의 업로드 영상 단계는 BGM을 끈다 — 화면이 재생과 함께 정지 신호를 쏜다', () => {
  const branch = flowBranch('video_file')
  assert.match(branch, /broadcastSSE\('video_play'/,
    'flowRunner의 video_file 단계가 video_play를 안 쏜다 — 근거가 바뀌었다')
  const vp = read('src/components/broadcast/VideoPlayer.jsx')
  // 흐름 BGM 은 이 PC 음원이다(2026-09-21) — 영상이 시작할 때 로컬 BGM 정지 신호를 쏴야 선이 참이다(Codex 5회차).
  assert.match(vp, /const handleVideoPlay = \(\) => \{[\s\S]{0,700}?carecast:broadcast-local-bgm-stop/,
    'VideoPlayer가 로컬 BGM 을 안 끈다 — 「방송용 BGM → 업로드 영상」 흐름에서 영상 밑으로 BGM 이 계속 깔린다')
  assert.match(vp, /onPlay=\{handleVideoPlay\}/,
    '그 정지 신호를 쏘는 handleVideoPlay가 <video>의 onPlay에 안 걸려 있다 — 실제로는 안 불린다')

  assert.equal(flowBgmRole(S('video_file')), 'stop')
})


// 외부 TV 송출('video') 단계는 2026-09-21 걷어냈다 — 실행기에 갈래가 없으니 아무 일도 안 하고, 선도 안 끊는다.
test('걷어낸 TV 송출(video) 단계는 실행기에 갈래가 없고, 선을 끊지 않는다', () => {
  assert.ok(!/step\.step_type === 'video'\)/.test(read('server/services/flowRunner.js')),
    "flowRunner 에 'video' 갈래가 되살아났다 — 받을 화면이 없는 단계다")
  assert.equal(flowBgmRole(S('video')), 'other')
})

test('TTS·차임벨·대기·묶음은 BGM을 안 건드린다 — 구간이 이어진다', () => {
  assert.match(flowBranch('tts'), /bgm:\s*null/,
    'flowRunner의 TTS 단계가 scheduled_broadcast에 bgm을 실어 보내기 시작했다 — 화면은 '
    + '"새 방송에 bgm이 있으면 교체"라 기존 BGM이 끊긴다(useScheduledBroadcast.js).')
  assert.match(read('src/hooks/useScheduledBroadcast.js'), /if \(bgm\?\.kind === 'local' && bgm\.files\?\.length\) \{/,
    '예약 TTS가 "bgm이 있을 때만 BGM을 교체한다"는 가지가 사라졌다 — 무조건 끊는다면 '
    + 'TTS 단계 판정이 other가 아니어야 한다')

  for (const t of ['tts', 'chime', 'delay', 'group']) {
    assert.equal(flowBgmRole(S(t)), 'other', `${t} 단계 판정이 바뀌었다`)
  }
  assert.deepEqual(
    flowBgmCoverage([S('bgm'), S('tts'), S('chime'), S('delay'), S('group'), S('tts')]),
    ['start', 'mid', 'mid', 'mid', 'mid', 'mid|end'])
})

test('모르는 step_type은 선을 끊지 않는다 — flowRunner에서도 아무 일이 안 일어난다', () => {
  assert.equal(flowBgmRole({ step_type: 'no_such_type' }), 'other')
  assert.equal(flowBgmRole(undefined), 'other')
})

test('다음 BGM 단계에서 구간이 새로 시작한다', () => {
  assert.deepEqual(
    flowBgmCoverage([S('bgm'), S('tts'), S('bgm'), S('tts')]),
    ['start', 'mid|end', 'start', 'mid|end'])
})

// ── 사실 2: 자동방송 판정에 회귀가 없다 ────────────────────────────────────────
// 흐름 어휘를 넣으면서 bgmRole·bgmCoverage의 기본 동작이 흔들리면, H13에서 고친 것이
// 조용히 되돌아간다. 표를 넘기는 옛 호출 형태 그대로 확인한다.
const TABLES = {
  bgmIds:   new Set(['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final']),
  videoIds: new Set(['morning_video', 'lunch_video_after', 'dinner_video_after']),
  audioCategory: { morning_prayer: 'morning-prayer', lunch_video: 'lunch-video' },
}

test('자동방송 판정은 그대로다 — 흐름 어휘를 더해도 기본 갈래가 안 바뀐다', () => {
  assert.equal(bgmRole({ id: 'bgm' }, TABLES), 'bgm')
  assert.equal(bgmRole({ id: 'morning_prayer' }, TABLES), 'pause')   // 음원은 잠시 멈춤
  assert.equal(bgmRole({ id: 'morning_video' }, TABLES), 'other')    // 마무리 뮤트 영상(H13)
  assert.equal(bgmRole({ id: 'lunch_video' }, TABLES), 'stop')       // 소리 있는 영상
  // 2026-09-02 고침: 커스텀 audio는 'pause'가 아니라 'stop'이다 — 실행이 flowRunner로 가고
  // prayer_play가 restoreBGM:false라 복귀가 없다. 이 줄은 원래 "흐름 어휘를 더한 날의 현상
  // 유지"를 얼려 둔 것이었는데, 그 현상이 거짓이었다(근거는 bgm-lane-truth.test.js 사실 2′).
  assert.equal(bgmRole({ id: 'c1', customType: 'audio' }, TABLES), 'stop')
  assert.equal(bgmRole({ id: 'c2', customType: 'video_file' }, TABLES), 'stop')

  // 표만 넘기는 호출(=역할 함수 미지정)은 예전과 완전히 같아야 한다
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm' }, { id: 'morning_prayer' }, { id: 'morning_video' }], TABLES),
    ['start', 'paused', 'mid|end'],
    'bgmCoverage의 기본 판정이 흐름 규칙으로 바뀌었다 — 자동방송 순서편집기의 선이 통째로 틀어진다')
})

// ── 사실 3: FlowBuilder가 선을 그린다 (카드 밖으로 안 나간다) ──────────────────
// **가드가 무엇을 겨냥하는지가 중요하다.** 이 파일에는 bg-rose-400이 여럿 있다(단계 유형
// 배지, BGM 종류 버튼). 색만 겨냥하면 선을 지워도 다른 요소가 걸려 초록으로 남는다.
// 그래서 BgmRail 함수 본문을 떼어 내 그 안만 본다.
function bgmRailBody(rel) {
  const src  = read(rel)
  const from = src.indexOf('export function BgmRail')
  assert.ok(from > 0, `${rel}에 BgmRail이 없다 — 분홍 선을 그리는 물건 자체가 사라졌다`)
  return src.slice(from, src.indexOf('\n}', from))
}

test('FlowBuilder가 BGM 구간에 분홍 선을 그린다 — 순서편집기와 같은 모양', () => {
  const src  = read('src/components/shared/FlowBuilder.jsx')
  const body = bgmRailBody('src/components/shared/FlowBuilder.jsx')

  // **앵커가 옮겨졌다**(2026-09-16): `bg-rose-400` → `bg-ds-v3-bgm`.
  // 분홍 선이 가리키는 것은 **BGM 구간**이고, 이 제품에서 음악의 색은 자주다(G-1).
  // 옛 벌을 걷어낼 때 한 번 경고색(`warn`)으로 잘못 보냈다가 **이 시험이 잡아서**
  // 되돌렸다 — 뜻을 보고 고르지 않고 계열만 보고 옮긴 탓이다.
  assert.match(body, /absolute left-1 w-\[3px\] bg-ds-v3-bgm/,
    '분홍 선의 모양이 순서편집기(StepList.jsx)와 다르다 — 같은 뜻을 두 화면이 다르게 그리면 '
    + '사람이 헷갈린다. StepList의 레일 클래스와 맞출 것.')
  assert.match(body, /opacity-30/, "'잠시 멈춤'(빗금=흐린 선) 표시가 없다")

  // **카드 안에서 시작하고 끝나야 한다.** 2026-09-02에 -bottom-2.5가 카드 밖으로 삐져나와
  // 허공에 토막으로 남는다는 신고를 받고 고쳤다(f8573ac). 같은 실수를 막는다.
  assert.doesNotMatch(body, /(^|[\s`])-(top|bottom|left|right|inset)-/m,
    '분홍 선에 음수 오프셋이 있다 — 선이 카드 밖으로 삐져나와 카드 사이 허공에 토막으로 남는다 '
    + '(2026-09-02 f8573ac에서 같은 이유로 고친 적 있다).')
  assert.match(body, /\$\{isStart \? 'top-3 rounded-t-full' : 'top-0'\}/,
    '구간의 시작 칸이 카드 안쪽에서 둥글게 시작하지 않는다')
  assert.match(body, /\$\{isEnd \? 'bottom-3 rounded-b-full' : 'bottom-0'\}/,
    '구간의 끝 칸이 카드 안쪽에서 둥글게 맺히지 않는다')

  // 규칙은 bgmLane 한 곳에서 가져온다 — 화면이 제 나름의 판정을 지어내면 안 된다
  assert.match(src, /import \{ flowBgmCoverage \} from '\.\.\/\.\.\/lib\/bgmLane'/,
    'FlowBuilder가 bgmLane의 흐름 규칙을 안 쓴다 — 규칙이 화면에 흩어지면 다시 갈린다')
  assert.match(src, /const bgmCover = flowBgmCoverage\(steps\)/,
    'FlowBuilder가 구간을 계산하지 않는다')
  assert.match(src, /<StepRow[^>]*cov=\{bgmCover\[i\]\}/,
    '단계 카드에 구간 값을 안 넘긴다 — 계산만 하고 그리지 않는다')

  // **단계 카드와 묶음 머리글 각각을 따로 본다.** 파일 전체에서 <BgmRail>을 세면 한쪽만
  // 지워도 다른 쪽이 걸려 초록으로 남는다(어제 bg-rose-400으로 겨냥했다가 겪은 그 함정).
  const bodyOf = (name) => {
    const at = src.indexOf(`function ${name}(`)
    assert.ok(at > 0, `${name}이 없다`)
    return src.slice(at, src.indexOf('\n}\n', at))
  }
  assert.match(bodyOf('StepRow'), /<BgmRail cov=\{cov\} \/>/,
    '단계 카드(StepRow)가 분홍 선을 그리지 않는다')
  assert.match(bodyOf('StepRow'), /group relative rounded-\[20px\]/,
    '단계 카드가 relative가 아니다 — 선이 카드가 아니라 목록 전체를 기준으로 붙어 엉뚱한 데 그려진다')
  assert.match(bodyOf('GroupHeaderRow'), /<BgmRail cov=\{cov\} \/>/,
    '묶음 머리글에 선이 없다 — 구간 한가운데서 선이 끊겨 "묶음에서 음악이 멎는다"로 읽힌다')
  assert.match(src, /<GroupHeaderRow[^>]*[\s\S]{0,200}?cov=\{bgmCover\[i\]\}/,
    '묶음 머리글에 구간 값을 안 넘긴다')
})

// ── 사실 4: 커스텀 자동순서 미리보기도 같은 선을 쓴다 ──────────────────────────
// 이 화면(MorningEditor의 FlowStepsPreview)이 사용자가 물은 그 화면이다. 읽기 전용이지만
// **여기서 순서를 읽고 안내를 어디 넣을지 정한다** — 그리는 근거가 편집 화면과 갈리면 안 된다.
test('커스텀 자동순서 미리보기도 같은 규칙·같은 그림으로 분홍 선을 그린다', () => {
  // 2026-09-05: FlowStepsPreview가 morningEditorPanels.jsx로 갈려 나갔다(순수 이동).
  // 가드도 따라간다 — 옛 파일을 계속 보면 아래 네 단언이 한꺼번에 빨간불이 된다.
  const src = read('src/components/admin/sections/morningEditorPanels.jsx')
  // 지키는 사실은 "**같은 BgmRail**을 쓴다"이다. 예전에는 이 미리보기가 FlowEditorModal과
  // 한 파일에 살아서 import 한 줄을 통째로 대조했는데, 2026-09-05에 갈라지며 모달은 본체에
  // 남았다. 그래서 짝이 아니라 **BgmRail이 그 파일에서 오는지**를 본다 — 사실은 그대로다.
  assert.match(src, /import \{[^}]*BgmRail[^}]*\} from '\.\.\/\.\.\/shared\/FlowBuilder'/,
    '미리보기가 편집 화면과 같은 BgmRail을 안 쓴다 — 같은 뜻을 두 화면이 다르게 그리게 된다')
  assert.match(src, /import \{ flowBgmCoverage \} from '\.\.\/\.\.\/\.\.\/lib\/bgmLane'/,
    '미리보기가 bgmLane의 흐름 규칙을 안 쓴다')
  assert.match(src, /const bgmCover = flowBgmCoverage\(steps\)/,
    '미리보기가 구간을 계산하지 않는다')
  assert.equal((src.match(/<BgmRail cov=\{bgmCover\[i\]\} \/>/g) || []).length, 2,
    '미리보기의 단계 카드와 묶음 머리글 둘 다에 선이 걸려 있어야 한다 — 머리글에서 끊으면 '
    + '"묶음에서 음악이 멎는다"는 없는 사실을 그리게 된다(머리글은 소리를 안 낸다).')
})
