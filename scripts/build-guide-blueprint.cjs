#!/usr/bin/env node
// 안내도·설계도 합본 — 심사용 아티팩트 한 장을 만든다.
//
// 왜 합치나: 심사위원에게 주는 것은 링크 하나다. 처음 보는 사람은 「안내도」 탭으로,
// 개발자는 「설계도」 탭으로 **같은 시스템**을 본다 — 사진과 CT처럼 찍는 방법만 다르다.
// 그래서 이 산출물은 앱 /guide 화면과 같은 소스로 조립한다(따로 그린 그림이 없다):
//   움직임  src/lib/guideMap.js      — BEATS·좌표·스프링 (단일 소스, 글 목록도 여기서 나온다)
//   칠하기  src/lib/guideMapDraw.js  — canvas 2D
//   배선    scripts/guide-blueprint-driver.js — React 대신 DOM으로 묶는 부분
//   설계도  docs/arch/structure.html — archify 산출물을 iframe srcdoc으로 통째로
// 넷 중 무엇을 고치든 이 스크립트를 다시 돌리면 아티팩트도 같은 그림이 된다.
//
// 디자인 규칙(2026-09-02, 사용자 10원칙): 글자는 13px 아래로 내려가지 않는다 · 글자/배경
// 대비 4.5:1 이상 · 여백은 4/8 배수 · 누르는 것은 최소 36px(토스 밀도, 2026-09-02 저녁 확정) · 메인 컬러는 파랑 하나
// (주황은 "소리" 의미색, 초록은 "켜짐") · 아이콘은 아래 ICONS 한 세트만 · 설계도 그림
// 영역은 archify 원래 다크가 기본(판독실). 캔버스 안 글자 크기는 여기서 다루지 않는다 —
// 앱과 공유하는 도면이라 guideMapDraw.js의 소관.
//
//   node scripts/build-guide-blueprint.cjs [출력경로]
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'arch', 'guide-blueprint.html')

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ES 모듈을 한 <script> 안에 이어붙이기 — import 줄을 지우고 export 머리만 벗긴다.
// guideMapDraw.js 머리말의 규칙(import 한 줄·export는 줄 머리)이 이 변환의 전제다.
const stripModule = (src) => src.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')

// 제3자용 낱말 바꿔치기(아티팩트만, 2026-09-02 사용자 결정) — 앱 /guide는 현장 말
// (선생님·요양원)을 그대로 쓴다. 그림 라벨·자막의 원본은 guideMap.js 하나이므로
// 소스는 안 건드리고 여기서 문자열만 중립어로 바꾼다.
const neutralize = (src) => src
  .replace(/선생님이 예약을 넣는다/g, '예약을 넣는다')
  .replace(/선생님이 지금 바로 내보낸다/g, '지금 바로 내보낸다')
  .replace(/선생님이 사무실 화면에서/g, '사무실 화면에서')
  .replace(/선생님이 예약을 넣습니다/g, '예약을 넣습니다')
  .replace(/요양원 안/g, '건물 안')
  .replace(/홀 — 어르신이 계신 곳/g, '홀 — 방송이 나오는 곳')

const guideSrc = neutralize(stripModule(read('src/lib/guideMap.js')))
const drawSrc = stripModule(read('src/lib/guideMapDraw.js'))
const driverSrc = read('scripts/guide-blueprint-driver.js')

// 설계도는 **다크가 기본**(2026-09-02 사용자 결정 — CT 판독실은 어둡다).
//
// 2026-09-03부터 archify를 쓰지 않는다 — 사용자 지시: "설계도는 안내도 구성 배치를
// 갖고 와서 재배치하고, 밑의 글 카드는 전부 없앤다." archify는 자동 배치라 안내도의
// 방 배치(사무실이나 폰 → 방송실 → 홀)를 강제할 수 없고, 이 환경에 도구도 없다.
// 그래서 structure.json(schema 2, 안내도 좌표계)을 여기서 직접 SVG로 그린다.
// JSON이 소스라는 규칙은 그대로다 — JSON을 고치고 이 스크립트를 다시 돌리면 된다.
function renderBlueprintSVG(j) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // **상자 밖으로 삐져나가는 글자 금지**(2026-09-03 사용자 지시).
  // SVG는 글자가 넘쳐도 안 잘리고 그대로 그려진다 — 눈으로 볼 때까지 아무도 모른다.
  // 그래서 폭을 여기서 검산한다: 한글·CJK는 글자 크기만큼, 그 밖(영문·숫자·기호)은 0.55배로
  // 잡는다(Noto Sans KR 실측 근사). 넘치면 …로 자르고, 자른 것은 빌드 로그에 남긴다 —
  // 조용히 자르면 "왜 이름이 반만 나오지"를 다음 사람이 다시 파헤친다.
  const overflows = []
  const WIDE_RANGES = [[0x1100, 0x11FF], [0x3130, 0x318F], [0xAC00, 0xD7AF],
    [0x4E00, 0x9FFF], [0x3000, 0x303F], [0xFF01, 0xFF60]]
  const isWide = (ch) => {
    const c = ch.codePointAt(0)
    return WIDE_RANGES.some(([lo, hi]) => c >= lo && c <= hi)
  }
  const textW = (s, px) => [...String(s)].reduce((w, ch) => w + (isWide(ch) ? px : px * 0.55), 0)
  const fit = (s, maxPx, px, where) => {
    if (textW(s, px) <= maxPx) return s
    let out = String(s)
    while (out.length > 1 && textW(out + '…', px) > maxPx) out = out.slice(0, -1)
    overflows.push(`${where}: "${s}" → "${out}…"`)
    return out + '…'
  }
  // 판독실 팔레트 — 페이지의 --well 값들과 같은 계열. 글자는 전부 바탕과 4.5:1 이상, 13px 아래 없음.
  const T = {
    wire:  { line: '#4F8EF7', box: '#3B5A8C', text: '#BFD6F6' },
    sound: { line: '#F97316', box: '#8A5A2B', text: '#F7CBA4' },
    quiet: { line: '#55606D', box: '#2E3947', text: '#9BA8B6' },
    store: { line: '#8B98A8', box: '#3E4A58', text: '#B9C4D0' },
    watch: { line: '#22C55E', box: '#2E5D43', text: '#A7E3C0' },
    faint: { line: '#242D38', box: '#242D38', text: '#77848F' },
  }
  const tone = (t) => T[t] || T.wire
  const out = []
  const { w, h } = j.meta.view
  out.push(`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(j.meta.title)}"
    style="display:block;width:100%;height:auto;background:var(--well)"
    font-family="'Noto Sans KR', Pretendard, system-ui, sans-serif">`)
  out.push('<defs>')
  for (const [k, v] of Object.entries(T)) {
    out.push(`<marker id="ah-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="${v.line}"/></marker>`)
  }
  out.push('</defs>')
  // 방 — 안내도의 ROOMS와 같은 역할. 라벨은 방 안 왼쪽 위.
  for (const r of j.rooms) {
    const c = tone(r.tone)
    out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="none"
      stroke="${c.line}" stroke-opacity="${r.tone === 'faint' ? 1 : 0.55}" stroke-width="1.5"${r.dashed ? ' stroke-dasharray="7 5"' : ''}/>`)
    out.push(`<text x="${r.x + 14}" y="${r.y - 8}" font-size="13" font-weight="700" fill="${c.text}">${esc(r.label)}</text>`)
  }
  // 선 — points가 곧 길이다(안내도 EDGES와 같은 형식).
  //
  // **화살표에는 라벨을 단다**(artifact-diagramming). 라벨 없는 화살표는 "어떻게든
  // 관련됨"일 뿐이고, 무엇이 오가는지가 이 그림의 요점이다. 한때 겹친다는 이유로 전부
  // 뺐는데 그러면 그림이 이름표 모음이 된다 — 겹침은 **글자 뒤에 바탕색 판을 깔아** 푼다.
  // 자리는 가장 긴 구간의 한가운데. 눈으로 맞추지 않고 계산해서 놓아야 격자가 안 흐트러진다.
  const labelBits = []
  const labelRects = []   // 겹침 검산용 — 글·번호가 차지하는 자리
  for (const wr of j.wires) {
    const c = tone(wr.tone)
    const pts = wr.points.map(p => p.join(',')).join(' ')
    out.push(`<polyline class="w" data-w="${esc(wr.id)}" data-from="${esc(wr.from || '')}" data-to="${esc(wr.to || '')}"`
      + ` data-num="${esc(wr.num || '')}" points="${pts}" fill="none" stroke="${c.line}"`
      + ` stroke-width="${wr.emphasis ? 3 : 2}" ${wr.dashed ? 'stroke-dasharray="6 4" ' : ''}`
      + `marker-end="url(#ah-${wr.tone in T ? wr.tone : 'wire'})" stroke-linejoin="round"/>`)
    if (!wr.label) continue
    // 자리는 **JSON이 정한다**(labelAt) — 자동 배치는 짧은 꺾임 위에 글을 얹어 전부 겹쳤다
    // (2026-09-04 사용자 지적). 사람이 빈 띠를 골라 적고, 겹침은 아래 검산이 잡는다.
    const px = 13
    const w2 = textW(wr.label, px) / 2 + 7
    let cx, cy
    if (Array.isArray(wr.labelAt)) {
      [cx, cy] = wr.labelAt
    } else {
      let best = null
      for (let i = 1; i < wr.points.length; i++) {
        const [x0, y0] = wr.points[i - 1], [x1, y1] = wr.points[i]
        const len = Math.abs(x1 - x0) + Math.abs(y1 - y0)
        if (!best || len > best.len) best = { len, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 }
      }
      cx = best.mx; cy = best.my
    }
    labelRects.push({ id: wr.id, what: `화살표 글 "${wr.label}"`, x: cx - w2, y: cy - 10, w: w2 * 2, h: 20 })
    labelBits.push(`<g class="wl" data-w="${esc(wr.id)}">`
      + `<rect x="${(cx - w2).toFixed(1)}" y="${(cy - 10).toFixed(1)}" width="${(w2 * 2).toFixed(1)}" height="20" rx="5" fill="#0D1116"/>`
      + `<text x="${cx.toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" font-size="${px}" fill="#B9C6D4" text-anchor="middle">${esc(wr.label)}</text>`
      + '</g>')
  }
  // 네모 — 안내도의 NODES와 같은 역할.
  // **개발 용어가 큰 글씨, 쉬운 말은 밑에 작게**(2026-09-03 사용자 지시) — 여기는 설계도다.
  for (const n of j.nodes) {
    const c = tone(n.tone)
    const pad = 14, inner = n.w - pad * 2
    out.push(`<g class="n" data-n="${esc(n.id)}" tabindex="0" role="button"`
      + ` aria-label="${esc(n.dev)} — ${esc(n.name)}. ${esc(n.desc)}">`)
    out.push(`<rect class="nbox" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="#141A21"
      stroke="${c.box}" stroke-width="1.5"${n.dashed ? ' stroke-dasharray="6 4"' : ''}/>`)
    if (n.h >= 70) {
      out.push(`<text x="${n.x + pad}" y="${n.y + 27}" font-size="15" font-weight="700" fill="#E7EDF3"
        font-family="'IBM Plex Mono', ui-monospace, monospace">${esc(fit(n.dev, inner, 15, n.id + '.dev'))}</text>`)
      out.push(`<text x="${n.x + pad}" y="${n.y + 47}" font-size="13" fill="${c.text}">${esc(fit(n.name, inner, 13, n.id + '.name'))}</text>`)
      out.push(`<text x="${n.x + pad}" y="${n.y + 65}" font-size="13" fill="#8895A4">${esc(fit(n.desc, inner, 13, n.id + '.desc'))}</text>`)
    } else {
      // 낮은 상자(장부·TV·지켜보기)는 두 줄 — 개발 용어 + 쉬운 말·설명 한 줄
      out.push(`<text x="${n.x + pad}" y="${n.y + 24}" font-size="15" font-weight="700" fill="#E7EDF3"
        font-family="'IBM Plex Mono', ui-monospace, monospace">${esc(fit(n.dev, inner, 15, n.id + '.dev'))}</text>`)
      out.push(`<text x="${n.x + pad}" y="${n.y + 43}" font-size="13" fill="${c.text}">`
        + `${esc(fit(n.name + ' — ' + n.desc, inner, 13, n.id + '.name+desc'))}</text>`)
    }
    out.push('</g>')
  }
  // 선 라벨은 상자 다음에 — 바탕 판이 상자 테두리를 가리지 않게 순서를 지킨다
  out.push(...labelBits)
  // 번호 배지 — 방송 하나가 나가는 순서(1~8). 상자 위에 그려야 선에 안 묻힌다.
  for (const wr of j.wires) {
    if (!wr.num || !wr.numAt) continue
    out.push(`<g class="b" data-num="${esc(wr.num)}" tabindex="0" role="button" aria-label="${esc(wr.num)}번 단계">`
      + `<circle cx="${wr.numAt[0]}" cy="${wr.numAt[1]}" r="12" fill="#E7EDF3"/>`
      + `<text x="${wr.numAt[0]}" y="${wr.numAt[1] + 4.5}" font-size="13" font-weight="700" fill="#14324F" text-anchor="middle">${esc(wr.num)}</text>`
      + '</g>')
  }
  out.push('</svg>')

  // ── 겹침 검산 (2026-09-04) ─────────────────────────────────────────────
  // 사용자 지적: "설계도 저렇게 다 겹치게". 원인은 상자를 8px 간격으로 붙여 놓고 그 틈에
  // 화살표 글을 넣은 것 — 자동 배치가 짧은 꺾임의 한가운데를 골랐다. 자리를 사람이 정하게
  // 바꿨으니, **정한 자리가 상자를 침범하면 빌드를 세운다.** 글자 넘침 검산과 같은 이유다:
  // 눈으로 볼 때까지 아무도 모르는 종류의 잘못이라 기계가 봐야 한다.
  const hits = []
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  for (const wr of j.wires) {
    if (!wr.num || !wr.numAt) continue
    labelRects.push({ id: wr.id, what: `번호 ${wr.num}`, x: wr.numAt[0] - 12, y: wr.numAt[1] - 12, w: 24, h: 24 })
  }
  for (const L of labelRects) {
    for (const n of j.nodes) {
      if (overlap(L, n)) hits.push(`${L.what}(${L.id})가 상자 '${n.id}'와 겹친다`)
    }
    for (const M of labelRects) {
      if (L !== M && overlap(L, M)) hits.push(`${L.what}(${L.id})가 ${M.what}(${M.id})와 겹친다`)
    }
  }
  if (hits.length) {
    const seen = [...new Set(hits)]
    throw new Error('[설계도] 겹침 ' + seen.length + '건 — structure.json의 labelAt/numAt을 빈 띠로 옮기세요:\n  '
      + seen.join('\n  '))
  }

  if (overflows.length) {
    console.warn('[설계도] 상자를 넘쳐 잘린 글자 ' + overflows.length + '건 — JSON의 글을 줄이거나 상자를 넓히세요:')
    for (const o of overflows) console.warn('  ' + o)
  }
  return out.join('\n')
}

const structureJson = JSON.parse(read('docs/arch/structure.json'))
// ── **클릭 반응은 한 벌이다** (사용자 지적 2026-09-15) ──────────────────────────
// *"설계도 예전에 클릭하면 반응 나왔는데 지금은 안되네?"*
//
// 원인: 이 스크립트가 **합본(guide-blueprint.html)에만** 들어 있었다. `/guide` 의 설계도
// 탭은 `docs/arch/structure.html` 을 iframe 으로 읽는데, 그 파일은 *"단독 열람용"* 이라
// **SVG 만 쓰고 스크립트를 뺐다.** 그림은 같은데 한쪽만 눌렸다.
//
// 그래서 CSS 와 스크립트를 **상수로 빼서 두 곳이 같은 것을 쓴다.** 한쪽에만 고치면
// 또 갈린다 — 이 저장소가 여러 번 데인 모양이다.
const 설계도상호작용CSS = `#bpWrap .n, #bpWrap .b{cursor:pointer}
#bpWrap .n:focus-visible .nbox, #bpWrap .b:focus-visible circle{outline:2px solid #E7EDF3}
#bpWrap .n .nbox{transition:stroke .15s, filter .15s}
#bpWrap .n:hover .nbox{stroke:#E7EDF3; filter:brightness(1.35)}
#bpWrap .n, #bpWrap .b, #bpWrap .w, #bpWrap .wl{transition:opacity .18s}
#bpWrap.sel .n, #bpWrap.sel .b, #bpWrap.sel .w, #bpWrap.sel .wl{opacity:.17}
#bpWrap.sel .n.on, #bpWrap.sel .b.on, #bpWrap.sel .w.on, #bpWrap.sel .wl.on{opacity:1}
#bpWrap.sel .w.on{stroke-width:4}
#bpWrap.sel .n.on .nbox{stroke:#E7EDF3}`

const 설계도상호작용JS = `<script>
(function () {
  const wrap = document.getElementById('bpWrap')
  if (!wrap) return
  const svg = wrap.querySelector('svg')
  const nodes = [...wrap.querySelectorAll('.n')]
  const wires = [...wrap.querySelectorAll('.w')]
  const badges = [...wrap.querySelectorAll('.b')]
  const wlabels = [...wrap.querySelectorAll('.wl')]
  const lightWire = (w) => { w.classList.add('on'); wlabels.find(l => l.dataset.w === w.dataset.w)?.classList.add('on') }
  const cap = document.getElementById('bpCap')
  const badge = document.getElementById('bpBadge')
  const STEPS = badges.map(b => b.dataset.num).filter(Boolean).sort((a, b) => a - b)
  let stepIdx = -1

  const clear = () => {
    wrap.classList.remove('sel')
    for (const el of [...nodes, ...wires, ...badges, ...wlabels]) el.classList.remove('on')
    badge.hidden = true
    cap.textContent = '아무것도 안 눌렀을 때는 전체를 봅니다.'
    stepIdx = -1
  }
  const nodeName = (id) => {
    const g = nodes.find(n => n.dataset.n === id)
    return g ? (g.getAttribute('aria-label') || '').split(' — ')[0] : id
  }
  const showNode = (id) => {
    wrap.classList.add('sel')
    for (const el of [...nodes, ...wires, ...badges, ...wlabels]) el.classList.remove('on')
    const self = nodes.find(n => n.dataset.n === id)
    if (self) self.classList.add('on')
    const linked = new Set([id])
    for (const w of wires) {
      if (w.dataset.from !== id && w.dataset.to !== id) continue
      lightWire(w)
      linked.add(w.dataset.from); linked.add(w.dataset.to)
      if (w.dataset.num) badges.find(b => b.dataset.num === w.dataset.num)?.classList.add('on')
    }
    for (const n of nodes) if (linked.has(n.dataset.n)) n.classList.add('on')
    badge.hidden = true
    const label = self ? self.getAttribute('aria-label') : id
    cap.textContent = label + ' — 이어진 것만 남겼습니다.'
  }
  const showStep = (num) => {
    wrap.classList.add('sel')
    for (const el of [...nodes, ...wires, ...badges, ...wlabels]) el.classList.remove('on')
    const w = wires.find(x => x.dataset.num === String(num))
    if (!w) return
    lightWire(w)
    badges.find(b => b.dataset.num === String(num))?.classList.add('on')
    for (const n of nodes) if (n.dataset.n === w.dataset.from || n.dataset.n === w.dataset.to) n.classList.add('on')
    badge.hidden = false
    badge.textContent = num
    cap.textContent = nodeName(w.dataset.from) + ' → ' + nodeName(w.dataset.to)
  }

  for (const n of nodes) {
    n.addEventListener('click', () => (n.classList.contains('on') && wrap.classList.contains('sel') ? clear() : showNode(n.dataset.n)))
    n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showNode(n.dataset.n) } })
  }
  for (const b of badges) {
    b.addEventListener('click', () => showStep(b.dataset.num))
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStep(b.dataset.num) } })
  }
  document.getElementById('bpStep')?.addEventListener('click', () => {
    stepIdx = (stepIdx + 1) % STEPS.length
    showStep(STEPS[stepIdx])
  })
  document.getElementById('bpReset')?.addEventListener('click', clear)
  svg?.addEventListener('click', e => { if (e.target === svg) clear() })
})()
</script>`

const blueprintSVG = renderBlueprintSVG(structureJson)

// 단독 열람용 structure.html도 같은 SVG로 다시 쓴다 — JSON과 HTML이 갈라지면
// 어느 쪽이 진실인지 아무도 모른다(docs/index.html·system-map이 이 파일을 연다).
fs.writeFileSync(path.join(ROOT, 'docs', 'arch', 'structure.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="build-guide-blueprint.cjs — structure.json schema 2">
<title>${structureJson.meta.title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>:root{--well:#0D1116}
body{margin:0;background:var(--well);min-height:100vh;color:#8895A4;
     font-family:'Noto Sans KR',system-ui,sans-serif}
#bpWrap{margin:0;padding:12px 10px 4px;display:flex;justify-content:center}
svg{max-width:1280px;width:100%;height:auto}
.cap{max-width:1280px;margin:0 auto;padding:10px 14px 16px;font-size:13px;line-height:1.6;
     display:flex;gap:8px;align-items:flex-start}
.capNo{flex:none;min-width:20px;height:20px;border-radius:999px;background:#2C3A49;color:#E7EDF3;
       font-size:12px;display:grid;place-items:center}
${설계도상호작용CSS}</style>
<figure id="bpWrap">${blueprintSVG}</figure>
<div class="cap"><span id="bpBadge" class="capNo" hidden></span><span id="bpCap">아무것도 안 눌렀을 때는 전체를 봅니다.</span></div>
${설계도상호작용JS}`, 'utf8')

// 머리줄 도장 — 손으로 적으면 낡는다. 한국 시각으로(심사장에서 읽는 줄이다).
const stamp = (() => {
  let branch = '?', commit = '?'
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim()
    const m = head.match(/^ref: refs\/heads\/(.+)$/)
    branch = m ? m[1] : head.slice(0, 7)
    commit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  } catch { /* git이 없으면 물음표 — 그림은 그대로 나온다 */ }
  return { branch, commit, builtAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) }
})()

// 아이콘은 이 한 세트뿐 — 24 그리드·굵기 2·둥근 끝(lucide 계열, 앱과 같은 계열).
const ICONS = {
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
}
const icon = (name) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  ICONS[name] + '</svg>'

const page = `<title>CareCast 시스템 지도</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
/* 색은 파랑 한 벌 + 의미색(소리=주황, 켜짐=초록). 글자색은 전부 바탕과 4.5:1 이상 —
   --blue는 그림·면 전용(캔버스와 같은 값), 글자와 채운 단추는 더 진한 --blue-text를 쓴다. */
:root{
  --bg:#F7F6FC; --card:#FFFFFF; --border:#E0DEE9;
  --ink:#201D28; --sub:#5C5964; --faint:#72707A; --dim:#8B8993;
  --blue:#4F8EF7; --blue-text:#286AC8; --blue-bg:#E4F1FF;
  --orange:#F97316; --orange-text:#C2410C; --orange-bg:#FFF7ED;
  --green-text:#15803D; --green-bg:#F0FDF4;
  /* 설계도 판독실 — archify 다크와 같은 값 */
  --well:#0D1116; --well-line:#242D38; --well-ink:#E7EDF3; --well-sub:#9BA8B6;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:"Noto Sans KR", Pretendard, system-ui, "Malgun Gothic", sans-serif;
  font-size:14px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1040px; margin:0 auto; padding:16px 16px 32px}
code{font-family:ui-monospace, Menlo, Consolas, monospace; font-size:.9em; color:var(--ink)}
b{color:var(--ink); font-weight:700}
svg{width:1em; height:1em; flex:0 0 auto}

/* 머리줄 */
.mast{display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px}
.brand{display:flex; align-items:center; gap:6px; font-weight:800; font-size:15px; letter-spacing:-.01em}
.brand .dot{width:8px; height:8px; border-radius:99px; background:var(--blue)}

/* 탭 — 표준 세그먼트(회색 홈 + 흰 활성 칩). 한 화면에는 한 갈래만 보인다 */
.tabs{display:inline-flex; gap:3px; padding:3px; background:#E8ECF2; border-radius:10px; margin-bottom:16px}
.tab{display:flex; align-items:center; gap:6px; min-height:36px; padding:4px 12px;
  border:0; border-radius:8px; background:transparent; color:var(--sub);
  font:inherit; font-weight:700; font-size:14px; cursor:pointer; transition:background .15s, color .15s}
.tab svg{font-size:14px}
.tab:hover{color:var(--ink)}
.tab.on{background:var(--card); color:var(--ink); box-shadow:0 1px 3px rgba(25,31,40,.12)}
.tab.on svg{color:var(--blue-text)}
.tab:focus-visible{outline:2px solid var(--blue-text); outline-offset:2px}

/* 위계: 제목 20 > 절 제목 16 > 항목 제목 13.5(굵게) > 본문 13.5 > 보조 13 — 13px 아래는 없다 */
h1{font-size:22px; line-height:1.35; font-weight:700; letter-spacing:-.01em; margin:0 0 6px; text-wrap:balance}
h1 .dim{color:var(--dim); font-weight:700}
h2{font-size:16px; line-height:1.3; font-weight:700; margin:24px 0 4px}
.lede{color:var(--sub); font-size:14px; line-height:1.55; max-width:50em; margin:0 0 14px}
.sub{color:var(--sub); font-size:13px; margin:0 0 8px}

.card{background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden}
.bar{display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px 10px; border-bottom:1px solid var(--border)}
.bar .note{font-size:13px; color:var(--faint); margin-left:auto}

/* 단추 — 전부 36px 이상, 위계는 셋: 채움(가장 먼저 누를 것) > 옅음 > 테두리 */
.btn{display:flex; align-items:center; gap:6px; min-height:36px; padding:6px 12px;
  border-radius:8px; border:1px solid transparent; font:inherit; font-size:14px; font-weight:500;
  cursor:pointer; transition:background .15s, border-color .15s, transform .05s}
.btn svg{font-size:14px}
.btn:active{transform:scale(.97)}
.btn:focus-visible{outline:2px solid var(--blue-text); outline-offset:2px}
.btn.fill{background:var(--blue-text); color:#fff}
.btn.fill:hover{background:#1F55A3}
.btn.tone{background:var(--blue-bg); color:var(--blue-text)}
.btn.tone:hover{background:#D3E7FA}
.btn.ghost{background:var(--card); border-color:var(--border); color:var(--sub)}
.btn.ghost:hover{border-color:#C9D2DE; color:var(--ink)}
.btn.ghost.on{background:var(--green-bg); border-color:#BBE5C8; color:var(--green-text)}

#canvasWrap{width:100%}
#mapCanvas{display:block; width:100%}
/* 자막 — 그림 **위**에 두고 또렷하게(2026-09-05 사용자 지시: "밑에 있으니 잘 안 보게 된다",
   "가시성 좀 좋게"). 바탕을 옅은 파랑으로 올리고 글자 16px, 왼쪽에 굵은 띠를 둔다.
   안내도 쪽은 높이를 두 줄로 고정한다 — 자막이 바뀔 때마다 그림이 위아래로 튀면 더 못 읽는다. */
.cap{display:flex; align-items:center; gap:10px; min-height:44px; padding:12px 16px;
  border-bottom:1px solid var(--border); border-left:4px solid var(--blue-text);
  background:var(--blue-bg); color:var(--ink);
  font-size:16px; font-weight:500; line-height:1.55}
#secGuide .cap{min-height:74px}
.capNo{flex:0 0 auto; width:24px; height:24px; border-radius:99px; background:var(--blue-text);
  color:#fff; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:center}

.keyline{font-size:13px; color:var(--sub); margin:10px 0 0; max-width:66em}

/* 순서 — 번호 칩. 자막은 그림 아래 cap 줄이 진행 중에 보여 준다 */
.steps{list-style:none; margin:8px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px}
.steps li{display:flex; align-items:center; gap:8px; background:var(--card);
  border:1px solid var(--border); border-radius:999px; padding:5px 14px 5px 5px; transition:background .2s, border-color .2s}
.steps li.on{border-color:var(--blue); background:var(--blue-bg)}
.stepNo{flex:0 0 auto; width:20px; height:20px; margin-top:0; border-radius:99px; background:var(--blue-bg);
  color:var(--blue-text); font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:center}
.stepNo.sound{background:var(--orange-bg); color:var(--orange-text)}
.stepBody b{font-size:14px; font-weight:500}

.notes{display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); margin-top:8px}
.note-card{background:var(--card); border:1px solid var(--border); border-left:3px solid var(--blue);
  border-radius:10px; padding:10px 12px}
.note-card.sound{border-left-color:var(--orange)}
.note-card.green{border-left-color:#22C55E}
.note-card h3{margin:0 0 4px; font-size:14px; line-height:1.3; font-weight:700}
.note-card p{margin:0; color:var(--sub); font-size:13px; line-height:1.5}

/* 설계도 판독실 — 그림 영역만 어둡다(다크가 기본). 주변 글은 밝은 채로 둔다 */
.well{background:var(--well); border-color:var(--well-line)}
.well .bar{border-bottom-color:var(--well-line)}
.well .bar .note{color:var(--well-sub); margin-left:0}
.well .bar code{color:var(--well-ink)}
.well .cap{background:#16202B; border-bottom-color:var(--well-line);
  border-left-color:#4F8EF7; color:var(--well-ink)}

/* 설계도 — 누르면 반응한다. 고른 것만 남기고 나머지는 흐려진다(무엇과 무엇이 이어졌는지가 요점) */
${설계도상호작용CSS}

footer{max-width:1040px; margin:0 auto; padding:0 16px 28px; color:var(--faint); font-size:13px; line-height:1.55}
footer .nums{font-family:"IBM Plex Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; font-size:13px}
footer .rule{border-top:1px solid var(--border); padding-top:12px}

/* 좁은 화면 — 탭·단추가 줄을 바꾸고, 제목만 줄인다(본문은 그대로 15px) */
@media (max-width:640px){
  .wrap{padding:12px 12px 32px}
  h1{font-size:18px}
  h2{font-size:15px; margin-top:20px}
  .tabs{display:flex}
  .tab{flex:1; justify-content:center}
  .bar .note{margin-left:0}
}
</style>

<div class="wrap">
  <div class="mast">
    <span class="brand"><span class="dot"></span>CareCast</span>
  </div>

  <!-- 같은 시스템을 두 가지로 찍었다 — 사진(안내도)과 CT(설계도). 한 화면에는 한 갈래만 -->
  <div class="tabs">
    <button id="tabGuide" class="tab on" aria-pressed="true">${icon('map')} 안내도</button>
    <button id="tabBlueprint" class="tab" aria-pressed="false">${icon('code')} 설계도</button>
  </div>

  <section id="secGuide">
    <h1>방송 한 건이 <span class="dim">홀까지 가는</span> 길</h1>
    <p class="lede">정해 둔 시각에 방송이 저절로 나가는 프로그램입니다. <b>사무실</b>이나 <b>폰</b>을 누르면 그 방송이 홀까지 가는 길이 움직입니다.</p>

    <div class="card">
      <div class="bar">
        <button id="btnOffice" class="btn fill">${icon('building')} 사무실에서 시작</button>
        <button id="btnPhone" class="btn tone">${icon('phone')} 폰에서 시작</button>
        <button id="btnLoop" class="btn ghost" aria-pressed="false">${icon('repeat')} <span id="loopLabel">되풀이</span></button>
        <button id="btnReset" class="btn ghost">${icon('reset')} 처음으로</button>
        <span aria-hidden="true" style="width:1px; align-self:stretch; margin:6px 4px; background:var(--border)"></span>
        <!-- 조형물 떨어뜨리기 — 누르면 그 소리가 길을 여행하고, 도착하면 실제로 울린다 -->
        <button id="btnTokChime" class="btn ghost" title="차임벨을 길에 떨어뜨립니다 — 홀에 닿으면 딩동 울립니다" style="color:var(--orange-text)">${icon('bell')} 차임벨</button>
        <button id="btnTokTts" class="btn ghost" title="안내 음성을 길에 떨어뜨립니다 — 스피커에 닿으면 말소리 리듬이 납니다" style="color:var(--blue-text)">${icon('message')} 안내 음성</button>
        <button id="btnTokBgm" class="btn ghost" title="음악을 길에 떨어뜨립니다 — TV에 닿으면 도·미·솔이 납니다" style="color:#BD4049">${icon('music')} BGM</button>
        <span id="reducedNote" class="note" hidden>움직임 줄임 설정이 켜져 있어 결과 그림만 보여 줍니다</span>
      </div>
      <div class="cap"><span id="capBadge" class="capNo" hidden></span><span id="capText"></span></div>
      <div id="canvasWrap"><canvas id="mapCanvas" role="img"
        aria-label="건물 배치도. 사무실과 폰에서 넣은 예약이 DB에 앉고, 타이머가 매분 그것을 읽어 방송 진행에 넘긴다. 소리는 두 갈래 — 서버가 직접 내는 것과 브라우저가 재생하는 것. 하루는 전원 켜기로 시작해 감시를 지나 자동 종료로 끝난다."></canvas></div>
    </div>

    <p class="keyline">소리 길은 두 개 — 안내 음성·차임벨은 서버가 직접 내고, 음원·음악·영상은 브라우저가 냅니다.</p>

    <h2>순서</h2>
    <ol id="steps" class="steps"></ol>

    <h2>알아두면 좋은 것</h2>
    <div class="notes">
      <div class="note-card">
        <h3>타이머는 그 1분만 본다</h3>
        <p>놓치면 그날 방송은 없다 — 5분 뒤 경보가 알려 준다.</p>
      </div>
      <div class="note-card sound">
        <h3>소리 길이 둘이라 증상도 둘</h3>
        <p>어느 쪽이 안 들렸는지가 고장을 찾는 단서다.</p>
      </div>
      <div class="note-card">
        <h3>DB는 그 컴퓨터에만 있다</h3>
        <p>예약·음원·설정은 파일 하나 — 매일 새벽 사본을 남긴다.</p>
      </div>
      <div class="note-card">
        <h3>AI는 초안까지만</h3>
        <p>사람이 확정을 눌러야 실제 예약이 된다.</p>
      </div>
    </div>
  </section>

  <section id="secBlueprint" hidden>
    <h1>전체 설계도</h1>
    <p class="lede">안내도와 <b>같은 배치</b>를 코드 파일 기준으로 세분화한 도면 — 왼쪽에서 넣고, 방송실이 진행하고, 홀에서 들립니다. 번호 <b>1~8</b>이 방송 하나가 나가는 순서입니다.</p>

    <!-- 밑에 글 카드는 두지 않는다(2026-09-03 사용자 지시) — 설명은 그림 안 라벨이 다 한다 -->
    <div class="card well">
      <div class="bar">
        <button id="bpStep" class="btn fill">${icon('repeat')} 순서 따라가기</button>
        <button id="bpReset" class="btn ghost">${icon('reset')} 전체 보기</button>
        <span class="note">상자나 번호를 누르면 그 길만 남습니다 · 원본 <code>structure.json</code></span>
      </div>
      <!-- 그림 하나 = 주장 하나. figcaption이 그 주장을 글로도 말한다(artifact-diagramming) -->
      <div class="cap"><span id="bpBadge" class="capNo" hidden></span><span id="bpCap">아무것도 안 눌렀을 때는 전체를 봅니다.</span></div>
      <figure id="bpWrap" style="margin:0; padding:20px 14px 6px">
        ${blueprintSVG}
        <figcaption style="padding:10px 4px 8px; font-size:13px; color:var(--well-sub); line-height:1.5">
          예약 하나가 왼쪽에서 들어와 방송실을 지나 홀에서 소리가 되기까지 —
          화살표의 글이 그 사이에 <b style="color:var(--well-ink)">무엇이 오가는지</b>이고,
          번호 1~8이 그 순서입니다.
        </figcaption>
      </figure>
    </div>
  </section>
</div>

<footer><div class="rule">
  안내도와 설계도는 같은 시스템을 두 방식으로 그린 것 — 어긋나면 <b>설계도가 원본</b>입니다.
  움직임은 프레임워크 없이 Canvas 2D + 순수 JS — 스프링·마찰 물리, 정적 레이어 프리렌더, 화면 밖 일시정지.
  <span class="nums" style="color:var(--faint)">${stamp.builtAt} · ${stamp.commit}</span>
</div></footer>

<script type="module">
${guideSrc}
${drawSrc}
${driverSrc}
</script>

<!-- 설계도 상호작용 — 안내도(캔버스)와 달리 여기는 SVG라, 클래스만 갈아끼우면 된다.
     규칙 하나: **고른 것과 이어진 것만 남긴다.** 무엇과 무엇이 이어졌는지가 설계도의 요점이다. -->
${설계도상호작용JS}
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, page, 'utf8')
console.log('[안내도·설계도 합본] ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB)')
