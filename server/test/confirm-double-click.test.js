// **두 번 눌러도 한 번만 나간다** — 카드 쪽 잠금 (사용자 지시 2026-09-14).
//
// ── 왜 `disabled` 로는 모자라나 ──────────────────────────────────────────────
// 확정 단추에는 `disabled={saving}` 이 걸려 있다. 그런데 `setSaving(true)` 는 **다시
// 그려진 뒤에야** 단추에 닿는다. 그 사이 한 프레임에 두 번째 클릭이 들어오면 핸들러가
// 두 번 돈다 — **방송이 두 번 나간다.** 페르소나 P3 「두 번 누르는 시설장」이 그 자리다.
// 전관 스피커로 나간 소리는 되돌릴 수 없다.
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// `disabled` 라는 **글자가 있는지**가 아니라, 핸들러를 **떼어 두 번 불러** 방송이 몇 번
// 나가는지 센다. 화면은 렌더하지 않는다(이 저장소는 렌더러를 시험에 안 들인다).
//
// 이것은 **첫 번째 방어선**이다 — 다른 PC·브라우저 재시도는 여기 안 걸린다.
// 서버 쪽은 `duplicate-broadcast-guard.test.js` 가 본다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')

/** `{` 부터 짝이 맞는 `}` 까지. */
function 블록(글, 여는곳) {
  let 깊이 = 0
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) return 글.slice(여는곳 + 1, k) }
  }
  assert.fail('블록의 끝을 못 찾았다')
}

function 확정몸통() {
  const i = SRC.indexOf('const handleConfirm = async () => {')
  assert.ok(i > 0, '긍정 앵커 — handleConfirm 이 있다')
  return 블록(SRC, SRC.indexOf('{', SRC.indexOf('=>', i)))
}

/** 확정 핸들러를 돌릴 수 있는 최소 환경. 발사·저장은 **센다.** */
function 환경({ 즉시 = true, 저장지연 = 0 } = {}) {
  const 기록 = { 저장: 0, 발사: 0, 보낸것: null }
  const 무시 = () => {}
  const env = {
    draft: { title: '겹침 시험', scheduled_time: '09:30', broadcast_type: 'text',
             content: '겹침 시험 문구입니다', immediate: 즉시,
             target: '전체', main_volume: 35, repeat_broadcast: 1,
             bgm_enabled: 1, bgm_type: 'preset', bgm_value: '클래식', bgm_delay: 3 },
    NEEDS_AUDIO_FILE: ['audio', 'video'],
    notes: [], acked: false,
    보내는중Ref: { current: false },
    setSaveError: 무시, setSaving: 무시, setFiredMsg: 무시, reset: 무시, 띠띄우기: 무시,
    onAdded: 무시,
    createSchedule: async () => {
      기록.저장++
      if (저장지연) await new Promise(r => setTimeout(r, 저장지연))
      return { id: 7 }
    },
    triggerSchedule: async () => { 기록.발사++ },
    // ── B-3: 즉시 실행은 **공통 함수 하나**를 지난다 (V③ R9, 2026-09-14) ──────────
    // 확정 단추와 「자세히 수정」이 같은 것을 쓴다. 대역도 **제품이 하는 만큼만** 한다 —
    // 유형에 따라 갈리는 것까지 흉내 낸다(안 그러면 대역이 진짜보다 친절해진다).
    지금내보내기: async (d) => {
      if ((d.broadcast_type || 'text') !== 'text') {
        기록.저장++
        기록.발사++
        return
      }
      기록.발사++
      기록.보낸것 = {
        text: d.content, target: d.target || '전체',
        volume: d.main_volume ?? null, repeat: !!d.repeat_broadcast,
        chimeStart: true, chimeEnd: false,
        bgm: d.bgm_enabled ? { bgm_type: d.bgm_type, bgm_delay: d.bgm_delay } : null,
      }
      if (저장지연) await new Promise(r => setTimeout(r, 저장지연))
    },
    chime: true, endChime: false,
  }
  const 이름들 = Object.keys(env)
  const 만들기 = new Function(...이름들, `return (async () => {${확정몸통()}})`)
  return { 기록, env, 누르기: () => 만들기(...이름들.map(k => env[k]))() }
}

// 2026-09-14(B-3): **즉시 방송은 이제 예약을 안 만든다.** 앞 판은 "한 번 저장하고 한 번
// 나간다"를 앵커로 삼았는데, 저장이 없어진 것이 **이번 변경의 요점**이다. 앵커를 사실에 맞춘다.
test('긍정 앵커 — 한 번 누르면 한 번 나간다 (저장은 안 한다)', async () => {
  const e = 환경()
  await e.누르기()
  assert.equal(e.기록.발사, 1, '즉시 방송이 안 나갔다 — 이 시험의 전제가 깨졌다')
  assert.equal(e.기록.저장, 0, '즉시 방송이 아직 예약 행을 만든다')
})

test('**두 번 눌러도 한 번만 나간다** — 다시 그려지기 전의 둘째 클릭', async () => {
  // 저장이 끝나기 전에 두 번째 클릭이 들어온다. `setSaving(true)` 는 아직 단추에 안 닿았다.
  const e = 환경({ 저장지연: 30 })
  const 첫 = e.누르기()
  const 둘 = e.누르기()                 // 같은 프레임의 둘째 손가락
  await Promise.all([첫, 둘])
  assert.equal(e.기록.발사, 1,
    `두 번 눌렀더니 방송이 ${e.기록.발사}번 나갔다 — 전관 스피커로 나간 소리는 못 되돌린다`)
  assert.equal(e.기록.저장, 0, `예약이 ${e.기록.저장}건 만들어졌다 — 즉시 방송은 행을 안 남긴다`)
})

test('끝난 뒤에는 **다시 누를 수 있다** — 잠금이 끼면 아무것도 못 한다', async () => {
  const e = 환경()
  await e.누르기()
  await e.누르기()
  assert.equal(e.기록.발사, 2, '한 번 보내고 나면 다시 못 보낸다 — 잠금이 안 풀린다')
})

test('저장이 **실패해도** 잠금이 풀린다', async () => {
  const e = 환경()
  e.env.createSchedule = async () => { throw new Error('서버가 안 받았습니다') }
  await e.누르기()
  assert.equal(e.env.보내는중Ref.current, false,
    '실패한 채로 잠금이 남는다 — 그 카드는 영영 아무것도 못 보낸다')
})

// ── 발사가 실패했을 때 **사람이 그 사실을 안다** ────────────────────────────
// 이 파일(`QuickSchedulePhrase.jsx`)은 「초안 닫기」 단추 옆에 스스로 적어 뒀다 —
// *"먼저 닫아 버리면 예약이 안 만들어졌는데 사람은 아무 말도 못 듣는다. 이 저장소에서
// 가장 비싼 실패의 모양이다."* 그런데 즉시 방송은 **발사보다 먼저 닫고 있었다.**
// 겹침 거절(409)이 생기면서 이 길이 실제로 밟히게 됐다.
test('즉시 방송이 **거절되면 카드가 안 닫힌다** — 사유를 그릴 자리가 남는다', async () => {
  const e = 환경()
  let 닫힘 = 0, 사유 = ''
  e.env.reset = () => { 닫힘++ }
  e.env.setSaveError = (v) => { if (v) 사유 = v }
  // 즉시 안내는 이제 공통 실행 함수를 지난다(B-3·R9) — 거절도 그쪽에서 온다(서버 409).
  e.env.지금내보내기 = async () => { throw new Error('같은 방송이 지금 나가고 있습니다.') }
  await e.누르기()
  assert.equal(닫힘, 0, '발사가 실패했는데 카드를 닫았다 — 사유를 그릴 자리가 사라진다')
  assert.match(사유, /나가고 있습니다/, '거절 사유를 화면에 안 전한다 — 조용히 버린 것과 같다')
})

test('성공하면 **닫고 나갔다고 알린다** — 초안이 남으면 또 누른다', async () => {
  const e = 환경()
  let 닫힘 = 0, 알림 = ''
  e.env.reset = () => { 닫힘++ }
  e.env.setFiredMsg = (v) => { 알림 = v }
  await e.누르기()
  assert.equal(닫힘, 1, '방송이 나갔는데 카드가 그대로 열려 있다')
  assert.match(알림, /내보냈습니다/, '나갔다는 말을 안 한다')
})

// ── **즉시 방송은 예약 행을 안 만든다** (B-3, 사용자 승인 2026-09-14) ─────────────
// 예전에는 예약을 하나 만들어 수동 트리거로 쐈다. 그 행이 **예약으로 남아** 몇 분 뒤 다시
// 나가고 내일도 나갔다(현장 신고). 실행값을 맞춰 막고 있지만 **애초에 안 만들면** 그 위험이
// 없고, 스케줄러 경로가 못 받던 차임·음량·반복·BGM 이 함께 간다.
test('즉시 안내 방송은 **예약을 안 만들고** 바로 내보낸다', async () => {
  const e = 환경()
  await e.누르기()
  assert.equal(e.기록.저장, 0,
    '즉시 방송이 아직 예약 행을 만든다 — 그 행이 남아 다시 나가는 길이 열린다')
  assert.equal(e.기록.발사, 1, '방송이 안 나갔다')
})

test('카드에서 고른 **다섯 가지가 전부 실린다** — UI 에만 남는 옵션이 없게', async () => {
  const e = 환경()
  await e.누르기()
  const 보낸것 = e.기록.보낸것
  assert.ok(보낸것, '즉시 TTS 경로로 안 갔다')
  assert.equal(보낸것.text, '겹침 시험 문구입니다', '문구가 안 갔다')
  assert.equal(보낸것.volume, 35, '안내 음량이 안 갔다')
  assert.equal(보낸것.repeat, true, '「2회 반복」이 안 갔다')
  // ── **차임은 여기서 안 잰다** (2026-09-16 정정) ───────────────────────────────
  // 앞 판은 여기서 `chimeStart === true` 를 단언했는데, 그 값은 **이 파일의 대역
  // (`지금내보내기`)이 스스로 박아 넣은 것**이다. 제품이 차임을 어떻게 정하든 늘 통과하는
  // **가짜 오라클**이었다 — 2026-09-16 에 BGM 차임 규칙을 바꿨을 때 이 줄만 안 바뀌어서
  // 드러났다. 이 시험의 일은 **두 번 눌러도 한 번 나가는가**이고, 차임을 실제 코드로 재는
  // 곳은 `immediate-one-path.test.js` 다(거기서 BGM 켬·끔 둘 다 본다).
  assert.equal(보낸것.bgm?.bgm_type, 'preset', 'BGM 갈래가 안 갔다')
  assert.equal(보낸것.bgm?.bgm_delay, 3, 'BGM 지연이 안 갔다')
})

test('BGM 을 **안 켰으면 안 보낸다** — 안 시킨 반주가 나가면 안 된다', async () => {
  const e = 환경()
  e.env.draft = { ...e.env.draft, bgm_enabled: 0 }
  await e.누르기()
  assert.equal(e.기록.보낸것.bgm, null, '끈 BGM 이 그대로 실려 간다')
})

test('**안내 음성이 아닌 즉시 실행**은 아직 예약 경로 그대로다 — 조용히 딴 길로 안 보낸다', async () => {
  const e = 환경()
  e.env.draft = { ...e.env.draft, broadcast_type: 'bgm', content: '' }
  await e.누르기()
  assert.equal(e.기록.저장, 1, '차임·음원·BGM 즉시 실행이 말없이 TTS 경로로 갔다')
  assert.equal(e.기록.보낸것, null, 'TTS 가 아닌데 TTS 로 보냈다')
})
