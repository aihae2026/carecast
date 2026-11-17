// 콘솔 출력을 날짜별 파일에도 남긴다.
//
// 왜 서버가 직접 쓰나: 원래는 시작 bat의 `start /b node server\index.js`에 리다이렉트를
// 붙이는 게 자연스럽다. 그런데 autoUpdate는 코드만 pull하고 carecast-start.bat을 다시
// 만들지 않는다 — bat을 고치면 현장 PC에서 사람이 설치 bat을 재실행해야 반영된다.
// 손대기 어려운 현장 PC에 수동 절차를 만드는 건 무인 운영이라는 목적과 어긋나므로,
// 서버가 자기 로그를 스스로 남긴다. 이러면 자동 업데이트만으로 배포된다.
//
// 설계 결정 둘:
//  · "옮기지 않고 함께 남긴다" — 원래 콘솔 출력은 그대로 두고 파일에도 쓴다. cmd 창을 보는
//    사람의 경험이 바뀌면 안 된다.
//  · appendFileSync를 쓴다 — 비동기로 쓰면 프로세스가 죽는 순간의 마지막 줄들이 유실된다.
//    그런데 그 마지막 줄이 정확히 우리가 보고 싶은 것이다. 하루 수백 줄 규모라 동기 I/O
//    비용은 무시할 수 있다.
'use strict'

const fs   = require('fs')
const path = require('path')
const { currentRunId } = require('./runContext')

const DEFAULT_DIR       = path.join(__dirname, '..', 'logs')
const DEFAULT_KEEP_DAYS = 30

// 파일명은 로컬(KST) 날짜 기준. toISOString()을 쓰면 09시 이전 로그가 전날 파일로 들어가
// "어제 아침에 무슨 일이 있었나"를 찾을 때 엉뚱한 파일을 열게 된다.
function stampOf(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function fileFor(dir, d = new Date()) {
  return path.join(dir, `server_${stampOf(d)}.log`)
}

/**
 * keepDays보다 오래된 로그 파일을 지운다.
 * 디스크가 차면 SQLite 쓰기가 실패해 방송 기록 자체가 끊기므로, 무한 증가를 막는다.
 * @returns {number} 지운 파일 수
 */
function prune(dir = DEFAULT_DIR, keepDays = DEFAULT_KEEP_DAYS) {
  let removed = 0
  try {
    const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!/^server_\d{8}\.log$/.test(name)) continue
      const p = path.join(dir, name)
      try {
        if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++ }
      } catch { /* 다른 프로세스가 이미 지웠으면 무시 */ }
    }
  } catch { /* 디렉터리가 없으면 지울 것도 없다 */ }
  return removed
}

/**
 * console.log/warn/error를 감싸서 파일에도 남긴다.
 * @returns {function} restore — 원래 console로 되돌린다(테스트용)
 */
function install({ dir = DEFAULT_DIR, keepDays = DEFAULT_KEEP_DAYS } = {}) {
  let usable = true
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    // 로그를 못 쓴다고 방송을 멈추지 않는다. 다만 조용히 넘어가지도 않는다.
    console.warn('[로그] 로그 디렉터리를 만들 수 없어 파일 기록을 끕니다:', e.message)
    usable = false
  }

  const orig = { log: console.log, warn: console.warn, error: console.error }

  const write = (level, args) => {
    if (!usable) return
    try {
      // 방송 구간 안이면 이름표를 싣는다(CC-035) — 같은 방송의 줄을 grep 하나로 모을 수 있다.
      // **파일에만 붙인다.** cmd 창을 보는 사람의 화면은 바뀌지 않아야 한다는 이 파일의 설계
      // 결정을 지킨다(상관관계를 따지는 일은 로그 파일에서 한다).
      const runId = currentRunId()
      const line = `[${new Date().toISOString()}] [${level}] ` + (runId ? `[#${runId}] ` : '') +
        args.map(a => (typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : safeJson(a)))).join(' ')
      fs.appendFileSync(fileFor(dir), line + '\n', 'utf8')
    } catch {
      // 디스크 풀·권한 문제 등. 한 번 실패하면 이후 매 줄마다 실패하므로 기록을 포기한다
      // (여기서 console.error를 부르면 무한 재귀가 된다).
      usable = false
    }
  }

  console.log   = (...a) => { write('info',  a); orig.log(...a) }
  console.warn  = (...a) => { write('warn',  a); orig.warn(...a) }
  console.error = (...a) => { write('error', a); orig.error(...a) }

  if (usable) prune(dir, keepDays)

  return function restore() {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error
  }
}

function safeJson(v) {
  try { return JSON.stringify(v) } catch { return String(v) }
}

module.exports = { install, prune, fileFor, DEFAULT_DIR, DEFAULT_KEEP_DAYS }
