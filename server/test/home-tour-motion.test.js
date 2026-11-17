'use strict'
// **처음 안내는 천천히, 따라올 수 있게, 누르는 모습까지** (사용자 피드백 2026-09-17)
//
// *"화면 전환이 너무 빨리 되니까 어지럽고, 정신이 없대"*
// *"사용자 시야에 천천히 들어가면서 따라올 수 있도록 메시지 카드 동적 위치 조정해 자연스러운 흐름으로"*
// *"마우스 같은걸로 누르는 모션도"* · *"TTS 상세설정은 진짜 시간이랑 반복시작일 반복요일 … 마우스가 움직여서"*
//
// 움직임 자체는 브라우저로 봤다. 여기서는 그 장치가 **빠지지 않게** 자리만 고정한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 안내 = 읽기('src/components/home/HomeTour.jsx')

test('연출의 기다림은 모두 속도를 곱한다 — 장마다 빠르기가 갈리지 않게', () => {
  const m = /const 속도 = ([\d.]+)/.exec(안내)
  assert.ok(m && Number(m[1]) > 1, '천천히 하는 배율이 없다')
  assert.match(안내, /const 쉬기 = \(ms\) => 그대로쉬기\(ms \* 속도\)/)
})

test('누르기는 **가상 마우스가 먼저 그 자리로 간 뒤** 눌린다', () => {
  const i = 안내.indexOf('누르기: async (sel')
  const 본문 = 안내.slice(i, 안내.indexOf('치기: async', i))
  assert.ok(본문.indexOf('가리키기(el)') > 0, '마우스가 안 움직이고 눌린다')
  assert.ok(본문.indexOf('가리키기(el)') < 본문.indexOf("classList.add('cc-tour-press')"), '움직이기 전에 눌린 모습이 먼저 나온다')
  assert.match(안내, /className="cc-tour-cursor"/, '마우스를 그리지 않는다')
  assert.match(읽기('src/index.css'), /\.cc-tour-cursor\.cc-tour-click/, '누를 때 모습이 없다')
})

test('말풍선은 **매 틀 목표 쪽으로 조금씩** 다가간다 · 움직임 줄이기면 곧장 선다', () => {
  assert.match(안내, /1 - Math\.exp\(-dt \/ τ\)/, '부드럽게 다가가지 않고 순간이동한다')
  assert.match(안내, /const 곧장 = !현재\.current \|\| 느리게안함\(\)/, '움직임 줄이기 설정을 안 본다')
})

test('「자세히 수정」 장은 시간 · 반복시작일 · 반복 요일을 마우스로 눌러 보인다', () => {
  for (const 자리 of ['modal-time', 'modal-start', 'modal-day-${요일}']) {
    assert.ok(안내.includes(`[data-tour="${자리}"]`), `${자리} 를 안 누른다`)
  }
  const 모달 = 읽기('src/components/shared/ScheduleModal.jsx')
  const 반복 = 읽기('src/components/shared/RepeatPicker.jsx')
  assert.match(모달, /data-tour="modal-time"/)
  assert.match(반복, /data-tour="modal-start"/)
  assert.match(반복, /data-tour=\{`modal-day-\$\{dow\}`\}/)
  for (const 동작 of ['modal.time', 'modal.start', 'modal.day', 'modal.days']) {
    assert.ok(모달.includes(`'${동작}':`), `창이 ${동작} 을 안 듣는다`)
  }
})

test('처음 안내는 **보통 크기(1배)** 로 보여 주고, 끝나면 저장된 배율로 돌아간다(저장값은 안 바꾼다)', () => {
  assert.match(안내, /임시배율로\(1\)/, '안내 시작 때 배율을 정하지 않는다')
  assert.match(안내, /임시배율로\(null\); 무대보내기\('zoom\.restore'\)/, '안내가 끝나도 안내 배율이 남는다')
  const 단추 = 읽기('src/components/home/BigViewButton.jsx')
  assert.match(단추, /'zoom\.restore': \(\) => \{ const v = 되돌릴배율\(\)/, '「원래대로」가 안내 배율을 모른다 — 글씨 크게 장이 끝나면 1.5배로 튄다')
  const src = 읽기('src/lib/bigView.js').replace(/^export /gm, '')
  const 모듈 = new Function('localStorage', `${src}; return { 임시배율로, 되돌릴배율, 지금배율 }`)({ getItem: () => '1.5', setItem() {} })
  모듈.임시배율로(1.25)
  assert.equal(모듈.되돌릴배율(), 1.25)
  assert.equal(모듈.지금배율(), 1.25)
  모듈.임시배율로(null)
  assert.equal(모듈.되돌릴배율(), 1.5, '안내가 끝났는데 저장된 배율로 안 돌아간다')
})

test('새로 설치해 초기 설정을 마치면 **처음 배율은 「크게」**, 이미 고른 값은 안 덮는다', () => {
  const src = 읽기('src/lib/bigView.js').replace(/^export /gm, '')
  const 모듈 = new Function(`${src}; return { 처음이면기본저장, 처음배율 }`)()
  const 빈 = { v: {}, getItem(k) { return k in this.v ? this.v[k] : null }, setItem(k, x) { this.v[k] = x } }
  모듈.처음이면기본저장(빈)
  assert.equal(빈.getItem('carecast:bigView'), '1.25')
  const 고른 = { v: { 'carecast:bigView': '1' }, getItem(k) { return k in this.v ? this.v[k] : null }, setItem(k, x) { this.v[k] = x } }
  모듈.처음이면기본저장(고른)
  assert.equal(고른.getItem('carecast:bigView'), '1', '사람이 고른 보통을 덮었다')
  assert.match(읽기('src/components/admin/sections/SetupWizard.jsx'), /처음이면기본저장\(\)/, '초기 설정을 마칠 때 부르지 않는다')
})
