// **처음 안내** — 간편 화면을 하나씩 짚으며, **실제 부품이 움직이는 모습**으로 보여 준다.
// (사용자 지시 2026-09-16~17 N11·N17·N18 · 별도 시안을 따라 만들었다)
//
// *"기능 이거 처럼 하나하나씩 알려주는 거 … 나이든 사람도 하나하나씩 따라해볼 수 있게"*
// *"DEV에서 실제 쓰는 구현한 기능을 갖고와서 해야지 실감나지"*
// *"이모션이 얼마나 가는지 모르니까 당황하잖아 위에 진행바같은거"*
// *"다봤어요 누르면 뭔가 성취했다는 ux경험을 주고 싶어"*
//
// 장 순서: 말로 예약(→ 자세히 수정) → 지금 방송 → 배경음악 → 순서 → 마이크 → 오늘 나갈 방송 →
//         간편모음 → 위 탭 → 글씨 크게 → 메뉴 → 「다 봤어요!」.
//
// ── 안전 — 사용자 확정 조건 (*"응 그렇게 해 기억했다가"*) ──────────────────────────────────
//  ① 막이 **모든 클릭을 받는다.** 밝힌 자리를 누르면 다음 장으로만 간다 — 실제 단추는 안 눌린다.
//  ② 부품은 `lib/tourStage` 통로로 **화면 상태만** 바꾼다. 확정·저장·방송 단추는 **눌리는 모습**만.
//  ③ 그래도 새어 나가지 않게 `api.js` 가 안내 중 쓰기 요청을 **보내기 전에 끊는다.**
//  ④ 장을 넘기거나 끝내면 연 카드·서랍·메뉴·입력값·글씨 크기를 되돌린다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { 무대보내기, 안내켜기, 안내시작이벤트, 안내대기키 } from '../../lib/tourStage'
import { getWarmup } from '../../lib/api'
import { 임시배율로, 먹이기, 읽기 as 저장배율 } from '../../lib/bigView'

// ── 속도 — **천천히** (사용자 신고 2026-09-17 「화면 전환이 너무 빨라 어지럽고 정신이 없대」) ─────────
// 연출 안의 기다림·타자 속도에 모두 곱한다. 장마다 숫자를 따로 고치면 장끼리 빠르기가 갈린다.
const 속도 = 1.5
const 느리게안함 = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const 찾기 = (sel) => { try { return document.querySelector(sel) } catch { return null } }
const 보이나 = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const 내일 = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ── 장 정의 — 글은 한두 줄(*"너무 과해 … 더 압축해서"*), 연출은 실제 부품을 움직인다 ─────────
// `대상` 은 밝힐 자리들(CSS 선택자). 연출 도중 `자리바꾸기` 로 바꿀 수 있다(예: 자세히 수정 창).
function 장목록() {
  return [
    {
      id: 'ask', 대상: ['[data-tour="ask"]', '[data-tour="card"]'], 길이: 13000, 제목: '말로 적으면 예약돼요',
      글: <>「<b className="font-semibold text-ds-v3-tts">내일</b> <b className="font-semibold text-ds-v3-tts">오후 3시</b>에 산책 안내 예약해 줘」처럼 적으면 예약 카드가 열려요. 더 고칠 건 「자세히 수정」에서.</>,
      연출: async (ㄱ) => {
        ㄱ.정리(() => { 무대보내기('card.more', false); 무대보내기('card.reset'); 무대보내기('ask.type', '') })
        if (!await ㄱ.쉬기(500)) return
        if (!await ㄱ.누르기('[data-tour="ask"] input, [data-tour="ask"] textarea, [data-tour="ask"]', 250)) return
        if (!await ㄱ.치기((v) => 무대보내기('ask.type', v), '내일 오후 3시에 산책 안내 예약해 줘', 90)) return
        if (!await ㄱ.쉬기(500)) return
        if (!await ㄱ.누르기('[data-tour="ask-go"]')) return
        무대보내기('card.sch', { said: '내일 오후 3시에 산책 안내 예약해 줘', 날짜: 내일(), 시각: '15:00', 제목: '산책 안내', 내용: '산책 안내' })
        ㄱ.따라가기(650); ㄱ.보이게('[data-tour="card"]', 0.3)
        if (!await ㄱ.쉬기(1900)) return
        if (!await ㄱ.누르기('[data-tour="card-more"]', 450)) return
        무대보내기('card.more', true); ㄱ.자리바꾸기(['[data-tour="modal"]']); ㄱ.따라가기(500)
        // 창이 뜨자마자 요일·종료일을 비워 두고 시작한다 — 그래야 「월·수·금을 누르면 켜진다」가 보인다.
        // 창이 무대 동작을 듣기 시작하는 것은 그려진 **뒤**(useEffect)라, 한 틀이 아니라 잠깐 기다린 뒤 보낸다.
        if (!await ㄱ.쉬기(250)) return
        무대보내기('modal.days', [])
        if (!await ㄱ.쉬기(1150)) return
        // **자세히 수정에서 실제로 무엇을 고치는지 마우스로 보여 준다** (사용자 지시 2026-09-17
        // 「진짜 시간이랑 반복시작일 반복요일 이런거 설정하는거 마우스가 움직여서 하는거」).
        // 값은 창 안의 입력칸만 바꾼다 — 저장은 「눌리는 모습」뿐이고 쓰기 요청은 api.js 가 끊는다.
        if (!await ㄱ.누르기('[data-tour="modal-time"]', 300)) return
        무대보내기('modal.time', '14:30')
        if (!await ㄱ.쉬기(900)) return
        if (!await ㄱ.누르기('[data-tour="modal-start"]', 300)) return
        무대보내기('modal.start', 내일())
        if (!await ㄱ.쉬기(900)) return
        for (const 요일 of [1, 3, 5]) {
          if (!await ㄱ.누르기(`[data-tour="modal-day-${요일}"]`, 260)) return
          무대보내기('modal.day', 요일)
          if (!await ㄱ.쉬기(350)) return
        }
        if (!await ㄱ.쉬기(800)) return
        if (!await ㄱ.누르기('[data-tour="modal-bgm"]', 320)) return
        무대보내기('modal.bgm', true); ㄱ.따라가기(400)
        if (!await ㄱ.쉬기(1500)) return
        await ㄱ.누르기('[data-tour="modal-save"]', 700)
      },
    },
    {
      id: 'tts', 대상: ['[data-tour="chip-tts"]', '[data-tour="card"]'], 길이: 9400, 제목: '지금 바로 방송',
      글: '할 말을 적고 「지금 방송」을 누르면 바로 나가요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('card.reset'))
        if (!await ㄱ.쉬기(600)) return
        if (!await ㄱ.누르기('[data-tour="chip-tts"]')) return
        무대보내기('card.open', 'tts'); ㄱ.따라가기(650); ㄱ.보이게('[data-tour="card"]', 0.3)
        if (!await ㄱ.쉬기(700)) return
        if (!await ㄱ.누르기('[data-tour="card"] textarea', 250)) return
        if (!await ㄱ.치기((v) => 무대보내기('card.content', v), '점심 식사 10분 전입니다. 손 씻고 식당으로 와 주세요.', 75)) return
        if (!await ㄱ.쉬기(700)) return
        if (!await ㄱ.누르기('[data-tour="card-bgm"]', 300)) return
        무대보내기('card.bgm', true); ㄱ.따라가기(450)
        if (!await ㄱ.쉬기(2200)) return
        await ㄱ.누르기('[data-tour="card-go"]', 700)
      },
    },
    {
      id: 'bgm', 대상: ['[data-tour="chip-bgm"]', '[data-tour="card"]'], 길이: 5600, 제목: '배경음악',
      글: '음악과 시간을 정하고 「지금 방송」을 눌러요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('card.reset'))
        if (!await ㄱ.쉬기(600)) return
        if (!await ㄱ.누르기('[data-tour="chip-bgm"]')) return
        무대보내기('card.open', 'bgm'); ㄱ.따라가기(650); ㄱ.보이게('[data-tour="card"]', 0.3)
        if (!await ㄱ.쉬기(700)) return
        // 폴더 칩을 고른다 — 이 PC 의 「식사용 BGM」(2026-09-21 검색어 칸을 걷었다)
        무대보내기('card.music', 'local_meal')
        if (!await ㄱ.쉬기(700)) return
        for (const n of [10, 20, 30]) { if (!await ㄱ.쉬기(280)) return; 무대보내기('card.minutes', n) }
        if (!await ㄱ.쉬기(900)) return
        await ㄱ.누르기('[data-tour="card-go"]', 700)
      },
    },
    {
      id: 'flow', 대상: ['[data-tour="chip-flow"]', '[data-tour="card"]'], 길이: 13500, 제목: '순서',
      글: '여러 방송을 차례대로 이어서 내보낼 때 써요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => { 무대보내기('card.newflow', false); 무대보내기('card.reset') })
        if (!await ㄱ.쉬기(600)) return
        if (!await ㄱ.누르기('[data-tour="chip-flow"]')) return
        무대보내기('card.open', 'flow'); ㄱ.따라가기(650); ㄱ.보이게('[data-tour="card"]', 0.3)
        if (!await ㄱ.쉬기(900)) return
        if (!await ㄱ.누르기('[data-tour="card-newflow"]', 350)) return
        무대보내기('card.newflow', true); ㄱ.따라가기(450); ㄱ.보이게('[data-tour="flow-builder"]', 0.18)
        if (!await ㄱ.쉬기(700)) return
        if (!await ㄱ.치기((v) => 무대보내기('flow.name', v), '생일 축하 방송', 120)) return
        for (const 종류 of ['chime', 'tts', 'bgm']) {
          if (!await ㄱ.쉬기(650)) return
          if (!await ㄱ.누르기(`[data-tour="flow-add-${종류}"]`, 300)) return
          무대보내기('flow.add', 종류); ㄱ.따라가기(400); ㄱ.보이게('[data-tour="flow-save"]', 0.6)
          if (종류 === 'tts' && !await ㄱ.치기((v) => 무대보내기('flow.text', v), '오후 3시에 생신 잔치가 있어요', 85)) return
          if (종류 === 'bgm') 무대보내기('flow.music', '생일 축하 노래')
        }
        if (!await ㄱ.쉬기(1200)) return
        await ㄱ.누르기('[data-tour="flow-save"]', 600)
      },
    },
    {
      // **차임벨 장** (사용자 지시 2026-09-17 「차임벨은 열려서 시작차임 종료차임 있는거 보여주면서 클릭 한번 해보는 모션」).
      // 패널을 실제로 펴고 「시작 차임」을 **누르는 모습만** 낸다 — 발사 함수는 부르지 않고, 새어도 api.js 가 끊는다.
      id: 'chime', 대상: ['[data-tour="chip-chime"]', '[data-tour="chime-panel"]'], 길이: 5200, 제목: '차임벨',
      글: '「시작 차임」·「종료 차임」을 누르면 바로 울려요. 사람을 모을 때 써요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('chime.open', false))
        if (!await ㄱ.쉬기(600)) return
        if (!await ㄱ.누르기('[data-tour="chip-chime"]', 300)) return
        무대보내기('chime.open', true); ㄱ.따라가기(400); ㄱ.보이게('[data-tour="chime-panel"]', 0.35)
        if (!await ㄱ.쉬기(1100)) return
        if (!await ㄱ.누르기('[data-tour="chime-general"]', 600)) return
        if (!await ㄱ.쉬기(700)) return
        await ㄱ.누르기('[data-tour="chime-end"]', 500)
      },
    },
    {
      id: 'mic', 대상: ['[data-tour="mic"]'], 길이: 4000, 제목: '마이크로 말하기',
      글: '한 번 누르면 시작, 다시 누르면 끝.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('mic.demo', false))
        if (!await ㄱ.쉬기(600)) return
        if (!await ㄱ.누르기('[data-tour="mic"]', 280)) return
        무대보내기('mic.demo', true); ㄱ.따라가기(250)
        if (!await ㄱ.쉬기(2400)) return
        if (!await ㄱ.누르기('[data-tour="mic"]', 280)) return
        무대보내기('mic.demo', false); ㄱ.따라가기(250)
      },
    },
    {
      id: 'today', 대상: ['[data-tour="today"]'], 길이: 4600, 제목: '오늘 나갈 방송',
      글: '시간이 되면 저절로 나가요. 방송 이름을 누르면 단계가 펼쳐지고, 「여기부터 재생」을 누르면 그 단계부터 나가요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('today.expand', false))
        if (!await ㄱ.쉬기(700)) return
        if (!await ㄱ.누르기('[data-tour="today"] [aria-controls^="today-steps-"]', 320)) return
        무대보내기('today.expand', true)
        ㄱ.자리바꾸기(['[aria-controls^="today-steps-"][aria-expanded="true"]', '[id^="today-steps-"]'])
        ㄱ.따라가기(1200); ㄱ.보이게('[id^="today-steps-"]', 0.3)
        if (!await ㄱ.쉬기(1500)) return
        const 단추들 = document.querySelectorAll('[id^="today-steps-"] li button')
        await ㄱ.누르기(단추들[1] || 단추들[0], 900)
      },
    },
    {
      id: 'drawer', 대상: ['[data-tour="grip"]', '#home-drawer'], 서랍: true, 길이: 1800, 제목: '자주 쓰는 건 여기에',
      글: '즐겨찾기 · 배경음악 · 음량 · 차임을 바로 써요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('drawer', false))
        if (!await ㄱ.쉬기(느리게안함() ? 150 : 800)) return
        if (!await ㄱ.누르기('[data-tour="grip"]', 250)) return
        무대보내기('drawer', true); ㄱ.따라가기(느리게안함() ? 60 : 450)
      },
    },
    {
      id: 'tabs', 대상: ['[data-tour="tabs"]'], 길이: 4800, 제목: '다른 화면은 위 탭으로',
      글: '달력 · 자동순서 · 업로드 · 설정으로 가요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('tabs.on', null))
        const 탭들 = [...document.querySelectorAll('[data-tour="tabs"] button')].filter(보이나)
        const 차례 = ['calendar', 'flow', 'media', 'settings']
        for (let i = 0; i < 탭들.length - 1 && i < 차례.length; i++) {
          if (!await ㄱ.쉬기(650)) return
          무대보내기('tabs.on', 차례[i])
          if (!await ㄱ.누르기(탭들[i + 1], 280)) return
        }
        if (!await ㄱ.쉬기(650)) return
        무대보내기('tabs.on', null)
      },
    },
    {
      id: 'zoom', 대상: ['[data-tour="zoom"]'], 길이: 4200, 제목: '글씨 크게',
      글: '누를 때마다 커지고, 한 번 더 누르면 돌아와요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => 무대보내기('zoom.restore'))
        for (let i = 0; i < 3; i++) {
          if (!await ㄱ.쉬기(950)) return
          if (!await ㄱ.누르기('[data-tour="zoom"]', 260)) return
          무대보내기('zoom.next'); ㄱ.따라가기(350)
        }
      },
    },
    {
      id: 'menu', 대상: ['[data-tour="menu"]', '[data-tour="menu-panel"]'], 길이: 2600, 제목: '나머지는 메뉴에',
      글: '기록 · 설정 · 이 안내 다시 보기가 있어요.',
      연출: async (ㄱ) => {
        ㄱ.정리(() => { 무대보내기('menu.hl', false); 무대보내기('menu', false) })
        if (!await ㄱ.쉬기(700)) return
        if (!await ㄱ.누르기('[data-tour="menu"]', 300)) return
        무대보내기('menu', true); ㄱ.따라가기(350)
        if (!await ㄱ.쉬기(500)) return
        ㄱ.보이게('[data-tour="menu-tour"]', 0.5)
        무대보내기('menu.hl', true)
      },
    },
  ]
}

export default function HomeTour() {
  const [열림, set열림] = useState(false)
  const [장번호, set장번호] = useState(0)
  // 「보여 주는 중 / 다 보여 드렸어요」 — 진행 막대처럼 연출이 직접 고치므로 상태(state)가 아니라 칸을 쥔다.
  const 상태칸 = useRef(null)
  const 상태쓰기 = (끝남) => {
    const el = 상태칸.current
    if (!el) return
    el.textContent = 끝남 ? '다 보여 드렸어요' : '보여 주는 중'
    el.className = 'text-[13px] ' + (끝남 ? 'font-semibold text-ds-v3-ink-2' : 'text-ds-v3-ink-3')
  }
  const [축하, set축하] = useState(false)
  const [다시번호, set다시번호] = useState(0)   // 「한 번 더 보기」 — 같은 장을 처음부터 다시 돌린다
  const [장들] = useState(장목록)
  const 회차 = useRef(0)
  const 정리들 = useRef([])
  const 지금영역 = useRef(null)
  const 잰길이 = useRef({})
  const 장바뀜 = useRef(0)
  const 구멍 = useRef(null)
  const 말풍선 = useRef(null)
  const 막대 = useRef(null)
  const 다음단추 = useRef(null)
  const 폭죽 = useRef(null)
  const 커서 = useRef(null)
  const 커서자리 = useRef(null)        // 화면 기준 {x, y} — 없으면 아직 한 번도 안 나타났다
  const 현재 = useRef(null)            // 구멍·말풍선이 지금 서 있는 자리(부드럽게 따라가려고 쥔다)
  const 앞틀 = useRef(0)

  const 보이는장 = useCallback(() => 장들.map((_, i) => i).filter((i) => 보이나(찾기(장들[i].대상[0]))), [장들])

  // ── 자리 — 밝힐 자리들의 합집합에 구멍을 뚫고, 말풍선을 곁에 둔다 ─────────────────────
  const 영역 = useCallback(() => {
    const 장 = 장들[장번호]
    if (!장) return null
    let a = null
    for (const sel of (지금영역.current || 장.대상)) {
      const el = 찾기(sel)
      if (!보이나(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (sel === '#home-drawer' && (r.left >= window.innerWidth - 2)) continue   // 닫힌 서랍은 화면 밖
      a = a ? { top: Math.min(a.top, r.top), left: Math.min(a.left, r.left), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }
        : { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
    }
    return a
  }, [장번호, 장들])

  const 자리 = useCallback(() => {
    const a = 영역(), h = 구멍.current, t = 말풍선.current
    if (!a || !h || !t) return
    // 「크게 보기」는 <html> 에 zoom 을 건다. 잰 자리(getBoundingClientRect)는 **확대된 화면 기준**인데
    // style 에 넣는 px 에는 확대가 한 번 더 곱해진다 — 그래서 넣을 때 배율로 나눈다(실측 2026-09-17: 1.5배에서 18→27).
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const px = (v) => `${v / z}px`
    const pad = 8, w = a.right - a.left, ht = a.bottom - a.top
    const tw = t.offsetWidth * z, th = t.offsetHeight * z, vw = window.innerWidth, vh = window.innerHeight
    let top, left
    if (a.bottom + pad + 14 + th <= vh - 12) { top = a.bottom + pad + 14; left = a.left + w / 2 - tw / 2 }
    else if (a.top - pad - 14 - th >= 12) { top = a.top - pad - 14 - th; left = a.left + w / 2 - tw / 2 }
    else { top = a.top + ht / 2 - th / 2; left = (a.left - pad - 14 - tw >= 16) ? a.left - pad - 14 - tw : a.right + pad + 14 }
    const 목표 = {
      ht: a.top - pad, hl: a.left - pad, hw: w + pad * 2, hh: ht + pad * 2,
      tt: Math.max(12, Math.min(top, vh - th - 12)), tl: Math.max(16, Math.min(left, vw - tw - 16)),
    }
    // ── **부드럽게 따라간다** (사용자 신고 2026-09-17 「사용자 시야에 천천히 들어가면서 따라올 수 있도록」) ──
    // 예전에는 장이 바뀌면 0.3초 CSS 로 미끄러지고 그 뒤로는 틀마다 **딱 붙었다** — 카드가 열리고 스크롤이
    // 도는 동안 말풍선이 튀어 다녀 눈이 못 따라갔다. 이제 매 틀 목표 쪽으로 **조금씩** 다가간다.
    // 구멍은 대상에서 떨어져 보이면 안 되므로 빠르게(≈0.2초), 말풍선은 읽는 눈이 따라오게 느리게(≈0.55초).
    const 지금 = performance.now(), dt = Math.min(64, 지금 - (앞틀.current || 지금)); 앞틀.current = 지금
    const 곧장 = !현재.current || 느리게안함()
    const 가기 = (from, to, τ) => (곧장 ? to : from + (to - from) * (1 - Math.exp(-dt / τ)))
    const p = 현재.current || 목표
    const n = {
      ht: 가기(p.ht, 목표.ht, 70), hl: 가기(p.hl, 목표.hl, 70), hw: 가기(p.hw, 목표.hw, 70), hh: 가기(p.hh, 목표.hh, 70),
      tt: 가기(p.tt, 목표.tt, 180), tl: 가기(p.tl, 목표.tl, 180),
    }
    현재.current = n
    Object.assign(h.style, { top: px(n.ht), left: px(n.hl), width: px(n.hw), height: px(n.hh) })
    t.style.top = px(n.tt)
    t.style.left = px(n.tl)
  }, [영역])

  const 정리하기 = useCallback(() => {
    const f = 정리들.current; 정리들.current = []
    f.reverse().forEach((g) => { try { g() } catch { /* 정리 하나가 실패해도 나머지는 되돌린다 */ } })
    지금영역.current = null
  }, [])

  // ── 한 장 그리기 — 이전 장을 정리하고, 연출을 돌리고, 진행 막대를 움직인다 ───────────────
  useEffect(() => {
    if (!열림) return undefined
    const 장 = 장들[장번호]
    const n = ++회차.current
    정리하기()
    const 살아있나 = () => n === 회차.current
    const 그대로쉬기 = (ms) => new Promise((res) => setTimeout(() => res(살아있나()), ms))
    const 쉬기 = (ms) => 그대로쉬기(ms * 속도)
    const 확대 = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const 커서놓기 = (x, y, ms) => {
      const c = 커서.current
      if (!c) return
      const z = 확대()
      c.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.2,1), opacity .35s ease` : 'opacity .35s ease'
      c.style.transform = `translate(${x / z}px, ${y / z}px)`
      c.style.opacity = '1'
      커서자리.current = { x, y }
    }
    // ── 가상 마우스 — 대상까지 **눈으로 따라갈 수 있는 빠르기로** 옮겨 간다 (사용자 지시 2026-09-17) ──
    // 멀수록 오래(0.5~1.2초). 대상이 화면 밖이면 먼저 부드럽게 스크롤해 보이게 한 뒤 간다.
    const 가리키기 = async (el) => {
      if (!커서.current || !보이나(el)) return 살아있나()
      let r = el.getBoundingClientRect()
      const 머리 = 찾기('header')?.getBoundingClientRect().bottom || 0
      if (r.top < 머리 + 8 || r.bottom > window.innerHeight - 12) {
        el.scrollIntoView({ block: 'center', behavior: 느리게안함() ? 'auto' : 'smooth' })
        if (!await 그대로쉬기(느리게안함() ? 60 : 700)) return false
        r = el.getBoundingClientRect()
      }
      const x = r.left + Math.min(r.width / 2, 48), y = r.top + r.height / 2
      if (!커서자리.current) {
        // 처음 나타날 때는 말풍선의 「다음」 단추 자리에서 출발한다 — 허공에서 튀어나오지 않게.
        const b = 다음단추.current?.getBoundingClientRect()
        커서놓기(b ? b.left + b.width / 2 : window.innerWidth / 2, b ? b.top + b.height / 2 : window.innerHeight / 2, 0)
        void 커서.current.offsetWidth
      }
      const 앞 = 커서자리.current
      const ms = 느리게안함() ? 0 : Math.round(Math.min(1200, Math.max(500, Math.hypot(x - 앞.x, y - 앞.y) * 1.3)))
      커서놓기(x, y, ms)
      return 그대로쉬기(ms + 150)
    }
    const ㄱ = {
      정리: (g) => 정리들.current.push(g),
      쉬기,
      자리바꾸기: (sels) => { 지금영역.current = sels },
      // 따라가기는 아래 「늘 따라가기」 틀이 매 순간 맡는다 — 연출 쪽 호출은 자리만 남긴다.
      따라가기: () => {},
      보이게: (sel, 위 = 0.25) => requestAnimationFrame(() => {
        const el = typeof sel === 'string' ? 찾기(sel) : sel
        if (!보이나(el) || !살아있나()) return
        const r = el.getBoundingClientRect(), 목표 = window.innerHeight * 위
        if (r.top >= 목표 - 40 && r.bottom <= window.innerHeight - 20) return
        window.scrollBy({ top: r.top - 목표, behavior: 느리게안함() ? 'auto' : 'smooth' })
      }),
      누르기: async (sel, ms = 380) => {
        const el = typeof sel === 'string' ? 찾기(sel) : sel
        if (!el) return 살아있나()
        if (!await 가리키기(el)) return false
        const c = 커서.current
        if (c) { c.classList.remove('cc-tour-click'); void c.offsetWidth; c.classList.add('cc-tour-click') }
        el.classList.add('cc-tour-press')
        정리들.current.push(() => el.classList.remove('cc-tour-press'))
        const ok = await 쉬기(Math.max(ms, 300))
        el.classList.remove('cc-tour-press')
        return ok
      },
      치기: async (넣기, 글, ms = 90) => {
        let s = ''
        for (const ch of 글) { s += ch; 넣기(s); if (!await 쉬기(ms)) return false }
        return true
      },
    }

    상태쓰기(false)
    const bar = 막대.current
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0%' }
    // 앞 장의 되돌리기(카드 닫기 등)로 **배치가 바뀐 뒤에** 잰다 — 바뀌기 전 자리로 스크롤하면
    // 대상이 옮겨 간 뒤 머리줄 뒤에 숨는다(사용자 신고 2026-09-17: 마이크 장이 시계를 밝혔다).
    // 말풍선은 장마다 살며시 다시 나타난다 — 자리는 위 「부드럽게 따라간다」가 옮긴다.
    const 풍 = 말풍선.current
    if (풍 && !느리게안함()) { 풍.classList.remove('cc-tour-tip-in'); void 풍.offsetWidth; 풍.classList.add('cc-tour-tip-in') }
    장바뀜.current = performance.now()
    const 스크롤틀 = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!살아있나()) return
      const 첫 = 찾기(장.대상[0])
      if (!보이나(첫)) return
      const r = 첫.getBoundingClientRect()
      const 머리 = 찾기('header')?.getBoundingClientRect().bottom || 0
      if (r.top >= 머리 + 8 && r.bottom <= window.innerHeight - 20) return   // 이미 다 보이면 안 움직인다
      첫.scrollIntoView({ block: 'center', behavior: 느리게안함() ? 'auto' : 'smooth' })
    }))
    const 시작타이머 = setTimeout(() => {
      if (!살아있나()) return
      자리(); 다음단추.current?.focus()
      const 길이 = 잰길이.current[장.id] || 장.길이 * 속도
      const 시작 = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!살아있나() || !bar) return
        bar.style.transition = `width ${길이}ms linear`; bar.style.width = '96%'
      }))
      Promise.resolve(장.연출(ㄱ)).then(() => {
        if (!살아있나()) return
        잰길이.current[장.id] = Math.round(performance.now() - 시작)
        if (bar) { bar.style.transition = 'width .25s ease'; bar.style.width = '100%' }
        상태쓰기(true)
      })
    }, 느리게안함() ? 380 : 800)   // 스크롤과 말풍선이 자리 잡은 뒤에 움직이기 시작한다
    return () => { clearTimeout(시작타이머); cancelAnimationFrame(스크롤틀) }
  }, [열림, 장번호, 다시번호, 장들, 정리하기, 자리])

  // ── 늘 따라가기 — 안내가 떠 있는 동안 매 틀마다 밝힐 자리를 다시 재고 그쪽으로 다가간다 ──────
  // 카드가 열리고 닫히며 배치가 바뀌거나 부드러운 스크롤이 도는 동안에도 구멍·말풍선이 따라간다.
  // 다가가는 빠르기는 `자리()` 가 정한다(구멍은 빠르게, 말풍선은 천천히).
  useEffect(() => {
    if (!열림) return undefined
    let raf = 0
    앞틀.current = 0
    const 틀 = () => { 자리(); raf = requestAnimationFrame(틀) }
    raf = requestAnimationFrame(틀)
    return () => { cancelAnimationFrame(raf); 현재.current = null; 커서자리.current = null }
  }, [열림, 영역, 자리])

  const 시작 = useCallback(() => {
    // 안내는 **보통 크기(1배)** 로 보여 준다 — 1.5배에서도 1.25배에서도 말풍선이 화면을 가렸다(사용자 신고 2026-09-17 두 번).
    // 설명은 화면 전체의 짜임을 보여 주는 것이라, 한눈에 들어오는 크기가 낫다. 끝나면 사람이 고른 배율로 돌아간다.
    임시배율로(1)
    무대보내기('card.reset'); 무대보내기('drawer', false); 무대보내기('menu', false); 무대보내기('zoom.restore')
    안내켜기(true)
    const 목록 = 보이는장()
    set장번호(목록[0] ?? 0); set축하(false); set열림(true)
  }, [보이는장])

  // **화면을 떠나도 쓰기 차단이 남지 않는다** (2026-09-17 제출 전 점검 B-1, HIGH).
  // 「안내 중」은 모듈 전역 표시라, 안내가 떠 있을 때 뒤로가기·다른 주소로 이 화면이 사라지면 `끝()` 이 안 불려
  // 표시가 켜진 채 남고 — 새로고침 전까지 **모든 저장이 막혔다.** 사라질 때 되돌리기와 함께 반드시 끈다.
  useEffect(() => () => { 회차.current++; 정리하기(); 안내켜기(false); 임시배율로(null); 먹이기(저장배율()) }, [정리하기])

  const 끝 = useCallback((축하까지) => {
    회차.current++
    정리하기()
    // 안내 배율을 풀고 사람이 고른 배율로 돌아간다(저장값은 안 건드렸다).
    임시배율로(null); 무대보내기('zoom.restore')
    set열림(false)
    // 되돌리는 동작이 다 돈 뒤에 쓰기 차단을 푼다(정리 중 부품이 무엇을 불러도 막히게).
    setTimeout(() => 안내켜기(false), 0)
    if (축하까지) set축하(true)
  }, [정리하기])

  // ── **한 번 누름 = 한 장** (사용자 신고 2026-09-17 「그냥 넘어갈 때가 있어, 2·3번 같이」) ──
  // 말풍선이 새 자리로 미끄러지는 동안(약 0.6초) 「다음」 단추가 손가락 밑에 남아 두 번째 누름을 받았고,
  // 두 번째 누름은 이미 바뀐 장 번호를 보고 한 장 더 넘겼다. 장이 바뀐 직후의 누름은 버린다.
  const 막넘김 = () => performance.now() - 장바뀜.current < 600
  const 다음 = () => {
    if (막넘김()) return
    const 목록 = 보이는장(), i = 목록.indexOf(장번호)
    if (i < 목록.length - 1) set장번호(목록[i + 1]); else 끝(true)
  }
  const 이전 = () => {
    if (막넘김()) return
    const 목록 = 보이는장(), i = 목록.indexOf(장번호)
    if (i > 0) set장번호(목록[i - 1])
  }
  const 한번더 = () => set다시번호((v) => v + 1)

  // ── 열기: 메뉴 「처음 안내 다시 보기」 · 초기 설정을 막 끝낸 첫 방문 ─────────────────────
  useEffect(() => {
    const 열기 = () => { try { localStorage.removeItem(안내대기키) } catch { /* 무시 */ } ; 시작() }
    window.addEventListener(안내시작이벤트, 열기)
    let 타이머 = null, 살아있음 = true
    // **첫 기동의 음성 합성이 끝난 뒤에 연다** (사용자 신고 2026-09-17 — 「다되면 보여줄 수 있게 … 밀리고」).
    // 합성 중에는 파이썬이 계속 떠서 움직임이 끊긴다. 그동안 위 띠(WarmupNotice)가 「설정 중」을 말한다.
    // 못 물으면 끝난 것으로 보고, 3분이 지나면 기다리지 않는다 — 안내가 영영 안 뜨면 안 된다.
    // 기다리는 사이 메뉴로 이미 열었으면(열기가 대기 표식을 지운다) 다시 열지 않는다(2026-09-26 Codex 검수 Medium).
    // 예전엔 준비가 끝나면 한 번 더 열려 무대 되돌리기(card.reset)가 그사이 쓰던 초안을 지웠다.
    const 아직대기 = () => { try { return localStorage.getItem(안내대기키) === '1' } catch { return false } }
    const 준비끝나면열기 = async () => {
      const 한도 = Date.now() + 3 * 60 * 1000
      while (살아있음 && 아직대기() && Date.now() < 한도) {
        let w = null
        try { w = await getWarmup() } catch { /* 못 물으면 끝난 것으로 본다 */ }
        if (!w?.running) break
        await new Promise((r) => { 타이머 = setTimeout(r, 2000) })
      }
      if (살아있음) 타이머 = setTimeout(() => { if (아직대기()) 열기() }, 1500)
    }
    try {
      if (localStorage.getItem(안내대기키) === '1') 준비끝나면열기()
    } catch { /* 못 읽으면 안 띄운다 */ }
    return () => { 살아있음 = false; window.removeEventListener(안내시작이벤트, 열기); if (타이머) clearTimeout(타이머) }
  }, [시작])

  // 창 크기·스크롤이 바뀌면 자리를 다시 잡고, 키보드로도 다닌다.
  useEffect(() => {
    if (!열림) return undefined
    const 다시 = () => 자리()
    const 키 = (e) => {
      // 키를 누르고 있으면 반복 입력이 들어와 여러 장이 날아갔다 — 반복은 버린다.
      if (e.repeat && e.key !== 'Tab') { e.preventDefault(); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); 끝(false) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); 다음() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); 이전() }
      // **키보드도 막 뒤로 못 간다** (2026-09-17 독립 검수 F2). 막은 마우스만 받아서, Tab 으로 뒤 단추에 가
      // Enter 를 누르면 실제 단추가 눌렸다. 초점을 말풍선 안에 가두고, 말풍선 밖을 겨눈 Enter·Space 는 버린다.
      else if (e.key === 'Tab') {
        const 칸들 = [...(말풍선.current?.querySelectorAll('button') || [])].filter((b) => !b.disabled && getComputedStyle(b).visibility !== 'hidden')
        if (!칸들.length) return
        const i = 칸들.indexOf(document.activeElement)
        e.preventDefault(); e.stopPropagation()
        칸들[(i + (e.shiftKey ? -1 : 1) + 칸들.length) % 칸들.length].focus()
      } else if ((e.key === 'Enter' || e.key === ' ') && !말풍선.current?.contains(document.activeElement)) {
        e.preventDefault(); e.stopPropagation()
      }
    }
    window.addEventListener('resize', 다시)
    window.addEventListener('scroll', 다시, true)
    window.addEventListener('keydown', 키, true)
    return () => { window.removeEventListener('resize', 다시); window.removeEventListener('scroll', 다시, true); window.removeEventListener('keydown', 키, true) }
  })

  // ── 축하 — 체크가 그려지고, 우리 색 물방울이 1.4초 톡 터진다(움직임 줄이기면 안 터진다) ──
  useEffect(() => {
    if (!축하 || 느리게안함()) return undefined
    const cv = 폭죽.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1
    cv.width = window.innerWidth * dpr; cv.height = window.innerHeight * dpr; ctx.scale(dpr, dpr)
    const 색 = ['#2563EB', '#B03A7A', '#6D28D9', '#87C6F1', '#EFB8E4']
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2 - 90
    const 알 = Array.from({ length: 70 }, () => { const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7; return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, r: 3 + Math.random() * 4, c: 색[Math.floor(Math.random() * 색.length)] } })
    const 시작 = performance.now()
    let raf = 0
    const 틀 = (t) => {
      const 지남 = t - 시작
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.globalAlpha = Math.max(0, 1 - 지남 / 1400)
      for (const o of 알) { o.vy += 0.22; o.vx *= 0.985; o.x += o.vx; o.y += o.vy; ctx.fillStyle = o.c; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill() }
      if (지남 < 1400) raf = requestAnimationFrame(틀); else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    }
    raf = requestAnimationFrame(틀)
    return () => cancelAnimationFrame(raf)
  }, [축하])

  const 목록 = 열림 ? 보이는장() : []
  const 장 = 장들[장번호]

  return (
    <>
      {열림 && 장 && (
        <div className="fixed inset-0 z-[9500]" data-cc-tour-layer
          onClick={(e) => {
            // 막은 클릭을 **받기만** 한다 — 뒤 단추로 안 흘린다. 밝힌 자리를 눌러도 넘기지 않는다(2026-09-17):
            // 1~3장은 밝힌 자리가 거의 같아(단추 줄+카드), 가상 마우스를 따라 누르면 「두 장이 같이 넘어갔다」로 보였다.
            // 넘기기는 「다음」 단추·→ 키만.
            e.stopPropagation()
          }}>
          <div ref={구멍} aria-hidden="true" className="cc-tour-hole" />
          {/* 가상 마우스 — 보여 주기만 한다(클릭은 막이 받는다). 처음엔 숨어 있다가 첫 동작에서 나타난다. */}
          <div ref={커서} aria-hidden="true" className="cc-tour-cursor">
            <svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5l15.5 9.2-6.6 1.5 3.9 7.3-3 1.6-3.9-7.4L5 19.3z" /></svg>
          </div>
          <div ref={말풍선} role="dialog" aria-modal="true" aria-labelledby="cc-tour-title"
            className="cc-tour-tip fixed w-[min(360px,calc(100vw/var(--cc-zoom,1)-32px))] rounded-[18px] bg-white px-[18px] pb-3.5 pt-4 text-ds-v3-ink shadow-[0_14px_40px_rgba(26,29,46,.24)]">
            <div className="mb-3 h-[5px] overflow-hidden rounded-full bg-ds-v3-line"><i ref={막대} className="block h-full w-0 rounded-full bg-ds-v3-ink" /></div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tabular-nums text-ds-v3-ink-3">{목록.indexOf(장번호) + 1} / {목록.length}</span>
                <span ref={상태칸} className="text-[13px] text-ds-v3-ink-3">보여 주는 중</span>
              </span>
              <span className="flex gap-2.5">
                <button type="button" onClick={한번더} className="min-h-[40px] px-0.5 text-sm text-ds-v3-ink-3 underline underline-offset-[3px]">한 번 더 보기</button>
                <button type="button" onClick={() => 끝(false)} className="min-h-[40px] px-0.5 text-sm text-ds-v3-ink-3 underline underline-offset-[3px]">그만 보기</button>
              </span>
            </div>
            <h4 id="cc-tour-title" className="m-0 mt-1 text-xl font-semibold leading-snug">{장.제목}</h4>
            <p className="m-0 mt-1 text-base leading-relaxed text-ds-v3-ink-2">{장.글}</p>
            <div className="mt-3 flex justify-between gap-2.5">
              <button type="button" onClick={이전}
                className={'min-h-[48px] rounded-full border border-ds-v3-line-2 px-5 text-base font-semibold ' + (목록[0] === 장번호 ? 'invisible' : '')}>이전</button>
              <button type="button" ref={다음단추} onClick={다음}
                className="min-h-[48px] rounded-full bg-ds-v3-ink px-6 text-base font-semibold text-white">
                {목록[목록.length - 1] === 장번호 ? '다 봤어요' : '다음'}
              </button>
            </div>
          </div>
        </div>
      )}

      {축하 && (
        <div className="fixed inset-0 z-[9500] grid place-items-center bg-[rgba(26,29,46,.45)] p-4" role="dialog" aria-modal="true" aria-labelledby="cc-tour-done">
          <canvas ref={폭죽} aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full" />
          <div className="cc-tour-pop relative w-[min(380px,100%)] rounded-[22px] bg-white px-6 pb-5 pt-7 text-center shadow-[0_20px_50px_rgba(26,29,46,.28)]">
            <svg viewBox="0 0 64 64" aria-hidden="true" className="cc-tour-check mx-auto mb-2 h-[72px] w-[72px]"><circle cx="32" cy="32" r="29" /><path d="M19 33l9 9 17-19" /></svg>
            <h4 id="cc-tour-done" className="m-0 text-2xl font-semibold">다 봤어요!</h4>
            <p className="m-0 mt-1.5 text-base leading-relaxed text-ds-v3-ink-2">이제 직접 한 번 해 보세요.<br />모르면 <b className="font-semibold text-ds-v3-ink">메뉴 → 처음 안내 다시 보기</b>에서 언제든 다시 볼 수 있어요.</p>
            <div className="mt-5 flex gap-2.5">
              <button type="button" onClick={() => set축하(false)} className="min-h-[52px] flex-1 rounded-full border border-ds-v3-line-2 text-base font-semibold">닫기</button>
              <button type="button" autoFocus onClick={() => { set축하(false); 무대보내기('card.open', 'tts') }}
                className="min-h-[52px] flex-1 rounded-full bg-ds-v3-ink text-base font-semibold text-white">지금 방송 해 보기</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
