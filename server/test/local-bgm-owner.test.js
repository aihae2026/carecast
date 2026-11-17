// 예약 TTS 로컬 반주의 **주인 표**·덕킹·방송별 볼륨 격리 — 2026-09-21 Codex 재검수 재현 다섯 건을 고정한다.
//
// Codex 가 실제 소스를 가짜 Audio·타이머로 돌려 재현한 것:
//   H1 취소된 예약의 반주가 350ms 뒤 뒤늦게 시작해 새 방송 뒤까지 흐름
//   H2 녹음 음원을 받아 오는 사이 끄라는 신호를 무시 → 조회 실패 시 예전 반주가 계속 흐름
//   H3 안내 중 다음 곡으로 넘어가면 덕킹이 풀려 제 음량까지 올라감
//   M1 앞 예약의 꼬리 타이머가 뒤에 시작한 다른 BGM 을 끔
//   M2 방송별 볼륨(예: 10%)이 다음 식사 BGM 에 남음
// 이 저장소의 다른 화면 시험처럼 **소스가 그 약속을 지니는지**를 본다(브라우저 없이 도는 시험).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 플레이어 = 읽기('src/components/easy/MusicPlayer.jsx')
const 훅 = 읽기('src/hooks/useScheduledBroadcast.js')

test('H1 — 예약 반주를 깔 때 주인 표를 싣고, 취소·교체(stopBGM) 때 그 주인 표로 로컬 반주도 끈다', () => {
  assert.match(훅, /carecast:broadcast-local-bgm-start'[\s\S]{0,200}?owner: 로컬반주주인Ref\.current/,
    '예약 반주 시작 신호에 주인 표가 없다')
  const stop = /const stopBGM = \(\) => \{([\s\S]*?)\n {4}\}/.exec(훅)
  assert.ok(stop, 'stopBGM 을 못 찾았다')
  assert.match(stop[1], /carecast:broadcast-local-bgm-stop[\s\S]*owner: 로컬반주주인Ref\.current/,
    '취소·새 방송 때 이 훅이 깐 로컬 반주를 안 끈다 — 350ms 뒤 뒤늦게 시작한다')
})

test('M1 — 꼬리 끄기 신호에도 주인 표, 재생기는 주인이 다르면 안 끈다', () => {
  assert.match(훅, /owner: 주인 \}/, '꼬리 끄기 신호에 주인 표가 없다')
  const h = /const localBGMStopHandler = \(e\) => \{([\s\S]*?)\n {4}\}/.exec(플레이어)
  assert.ok(h, 'localBGMStopHandler 를 못 찾았다')
  assert.match(h[1], /주인신호 && \(playRef\.current\.owner \?\? null\) !== d\.owner\) return/,
    '다른 주인의 BGM 을 끈다 — 앞 예약의 꼬리가 뒤에 시작한 BGM 을 끈다')
  assert.match(플레이어, /owner: owner \?\? null/, '재생기가 주인 표를 기억하지 않는다')
})

test('H2 — 녹음 음원을 못 틀면 savedBGM 이 남아 있을 때만 되살리고, 지워졌으면 멈춘다', () => {
  const f = /function 녹음못틀면복귀\(\) \{([\s\S]*?)\n {6}\}/.exec(플레이어)
  assert.ok(f, '녹음못틀면복귀 가 없다')
  assert.match(f[1], /const 되살릴것 = playRef\.current\.savedBGM/, '조회 뒤의 savedBGM 을 안 본다(조회 전 사본을 쓴다)')
  // 2회차: 4초 페이드(stopBGM)가 아니라 **조용히 멈춘다** — 소리는 끄기 신호 때 이미 줄었다.
  assert.match(f[1], /a\.pause\(\)/, '되살릴 것이 없을 때 반주를 멈추지 않는다')
})

// ── Codex 2회차(46faf337) 재현 넷 ─────────────────────────────────────────

test('R2-1 — 새 예약이 들어오면 앞 예약이 깐 로컬 반주를 주인 표로 끝낸다(반주 없는 새 예약이어도)', () => {
  const 진입 = /clearBgmTimers\(\) {3}\/\/ 켜는 타이머도 함께[\s\S]{0,900}?const 세대 = /.exec(훅)
  assert.ok(진입, '예약 진입부를 못 찾았다')
  assert.match(진입[0], /carecast:broadcast-local-bgm-stop[\s\S]*owner: 로컬반주주인Ref\.current/,
    '새 예약이 앞 예약의 반주를 안 끝낸다 — 350ms 뒤 뒤늦게 시작해 계속 흐른다')
})

// R2-2 는 3회차에서 **설계를 바꿔** 닫았다: 받아 오는 동안 반주를 흘리지 않고, 예약 음원이 시작될 때
// 앞 로컬 반주를 멈춘다(유튜브 반주가 원래 그랬다). 「조회 중」 표시가 세 가지 새 구멍을 냈기 때문이다.
test('R3 — 예약 음원이 시작되면 앞 로컬 반주를 페이드 뒤 멈춘다(받아 오는 동안 반주를 안 흘린다)', () => {
  assert.doesNotMatch(플레이어, /조회중Ref/, '「조회 중」 표시가 남아 있다 — 3회차 회귀의 뿌리')
  assert.match(플레이어, /녹음전정지Ref\.current = setTimeout\(\(\) => \{[\s\S]{0,160}?audioRef\.current\?\.pause\(\)/,
    '예약 음원 시작 때 앞 반주를 안 멈춘다')
})

// ── Codex 4회차(49c0110b) 재현 둘 ─────────────────────────────────────────

test('R4-1 — 이미 끄는 중이던 반주는 음원 뒤에 되살리지 않는다', () => {
  assert.match(플레이어, /const 끄던중 = !!bgmStopRef\.current[^\n]*\n\s*if \(bgmStartDelayRef\.current\)/,
    '멈춤 예약을 걷기 **전에** 「끄는 중이었나」를 안 본다')
  assert.match(플레이어, /const savedState = 끄던중\s*\n?\s*\? \{ playlist: \[\]/, '끄는 중이던 반주를 savedBGM 으로 담는다')
})

test('R4-2 — 멈춤 타이머는 제 음원이 아직 받아 오는 중일 때만 멈추고, 앞 음원의 타이머는 먼저 걷는다', () => {
  assert.match(플레이어, /if \(playRef\.current === 이녹음 && 이녹음\.녹음대기\) audioRef\.current\?\.pause\(\)/,
    '앞 음원의 타이머가 뒤에 시작한 음원을 멈춘다')
  const 걷기 = 플레이어.indexOf('if (녹음전정지Ref.current) { clearTimeout(녹음전정지Ref.current); 녹음전정지Ref.current = null }\n      if (소리나던반주)')
  const 걷기CRLF = 플레이어.indexOf('if (녹음전정지Ref.current) { clearTimeout(녹음전정지Ref.current); 녹음전정지Ref.current = null }\r\n      if (소리나던반주)')
  assert.ok(걷기 > 0 || 걷기CRLF > 0, '새 타이머를 걸기 전에 앞 타이머를 안 걷는다 — 덮어쓰면 앞 것이 살아남는다')
})

test('R3 — 새 소리를 틀 때 앞 페이드·멈춤 예약을 걷는다(음원이 0 음량으로 나가지 않게)', () => {
  const p = /const playURL = useCallback\(\(url, name\) => \{([\s\S]*?)\n {2}\}, \[fadeTo\]\)/.exec(플레이어)
  assert.ok(p, 'playURL 을 못 찾았다')
  const 앞부분 = p[1].slice(0, p[1].indexOf('audio.src ='))
  assert.match(앞부분, /clearInterval\(fadeRef\.current\)/, '앞 페이드가 새 소리 음량까지 끌어내린다')
  assert.match(앞부분, /clearTimeout\(녹음전정지Ref\.current\)/, '앞 반주 멈춤 예약이 새 음원을 멈춘다')
})

test('R3 — 녹음 음원을 받아 오는 사이 앞 곡이 끝나도 음원 종료로 읽지 않는다', () => {
  assert.match(플레이어, /addEventListener\('ended', \(\) => \{\s*(\/\/[^\n]*\n\s*)*if \(playRef\.current\.녹음대기\) return/,
    '받아 오는 사이의 ended 를 음원 종료로 읽어 정상 음원 응답을 버린다')
})

test('R2-3 — 음원 뒤 직원멘트 조회의 늦은 응답은 **지금 상태**를 보고, 상태가 바뀌었으면 아무것도 안 한다', () => {
  assert.match(플레이어, /const 직원상태 = playRef\.current = /, '직원멘트 조회의 상태를 잡아 두지 않는다')
  assert.match(플레이어, /if \(playRef\.current !== 직원상태\) return/, '늦은 응답이 다른 상태를 덮는다')
  assert.match(플레이어, /const 되살릴것 = 직원상태\.savedBGM/, '조회 전에 잡아 둔 savedBGM 으로 되살린다')
})

test('R2-4 — 앞 음원의 조회 실패가 그 뒤 시작한 BGM 을 멈추지 않는다(내 상태일 때만 움직인다)', () => {
  assert.match(플레이어, /const 내것인가 = \(\) => playRef\.current === 녹음상태/, '조회 응답이 제 상태인지 안 본다')
  assert.match(플레이어, /\.catch\(\(\) => \{ if \(내것인가\(\)\) 녹음못틀면복귀\(\) \}\)/, '조회 실패가 남의 BGM 을 건드린다')
})

test('H3 — 안내 중(덕킹) 곡이 바뀌어도 덕킹 음량으로 들어간다', () => {
  assert.match(플레이어, /duckedRef\.current = true/, '덕킹 시작을 기억하지 않는다')
  assert.match(플레이어, /duckedRef\.current = false/, '덕킹 끝을 기억하지 않는다')
  assert.match(플레이어, /fadeTo\(duckedRef\.current \? Math\.max\(0\.2, nomVolRef\.current \* 0\.35\) : nomVolRef\.current, 3000\)/,
    '곡 시작 페이드가 덕킹을 무시한다')
})

test('M2 — 볼륨을 안 실어 온 재생은 시스템 BGM 볼륨으로 돌아간다(방송별 값이 남지 않는다)', () => {
  assert.match(플레이어, /nomVolRef\.current = bgmDefault !== undefined \? bgmDefault \/ 100 : globalBgmVolRef\.current/,
    '방송별 볼륨이 다음 재생까지 남는다')
  // 시스템 값이 들어오는 세 곳(서버 volume_change · 볼륨판 · 재생바 슬라이더)이 전부 시스템 값도 고친다
  assert.equal((플레이어.match(/globalBgmVolRef\.current = v/g) || []).length, 3,
    '시스템 BGM 볼륨이 바뀌는 자리 중 globalBgmVolRef 를 안 고치는 곳이 있다')
})
