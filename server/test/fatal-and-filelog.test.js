// 서버가 죽을 때 이유를 남기는가 / 로그가 파일로 남는가.
//
// 왜 필요했나 (둘 다 2026-08-29 리뷰에서 확인):
//  · uncaughtException / unhandledRejection 핸들러가 하나도 없었다. spawn 실패 같은 사고로
//    프로세스가 죽으면 시작 bat이 재시작은 해 주지만, **왜 죽었는지가 어디에도 안 남는다.**
//    같은 장애가 반복돼도 원인을 못 찾는다.
//  · 로그가 cmd 창 스크롤백에만 존재했다(생성되는 carecast-start.bat에 리다이렉트 없음).
//    창을 닫거나 PC가 재부팅되면 전부 사라진다. "지난 화요일 저녁 마무리가 왜 안 나왔나"를
//    조사할 근거가 애초에 존재하지 않았다.
//
// 로그를 bat이 아니라 서버가 직접 쓰는 이유: autoUpdate는 코드만 pull하고 carecast-start.bat을
// 재생성하지 않는다. bat을 고치면 현장 PC에서 사람이 설치 bat을 다시 실행해야 반영된다 —
// 손대기 어려운 현장 PC에 수동 절차를 만드는 건 무인 운영이라는 목적과 어긋난다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const test   = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')

const TMP = path.join(os.tmpdir(), `carecast_test_fatal_${process.pid}_${Date.now()}`)

test.before(() => { fs.mkdirSync(TMP, { recursive: true }) })
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 무시 */ } })

// ── fileLog ────────────────────────────────────────────────────────────────

test('fileLog가 날짜별 파일에 기록한다', () => {
  const dir = path.join(TMP, 'logs1')
  const fileLog = require('../services/fileLog')
  const restore = fileLog.install({ dir, keepDays: 30 })
  try {
    console.log('아침 방송 완료')
    console.error('[경보:저녁 마무리] 음원 파일 없음')
  } finally {
    restore()
  }

  const files = fs.readdirSync(dir)
  assert.equal(files.length, 1, `날짜별 파일 하나여야 한다: ${JSON.stringify(files)}`)
  assert.match(files[0], /^server_\d{8}\.log$/)

  const body = fs.readFileSync(path.join(dir, files[0]), 'utf8')
  assert.match(body, /아침 방송 완료/)
  assert.match(body, /음원 파일 없음/, 'console.error도 같은 파일에 남아야 한다')
  assert.match(body, /\d{4}-\d{2}-\d{2}T/, '타임스탬프가 있어야 사후 추적이 된다')
})

test('fileLog를 걸어도 화면 출력은 그대로 나간다 — 파일로 "옮기는" 게 아니라 "함께" 남긴다', () => {
  const dir = path.join(TMP, 'logs2')
  const fileLog = require('../services/fileLog')
  const seen = []
  const origLog = console.log
  console.log = (...a) => { seen.push(a.join(' ')) }
  const restore = fileLog.install({ dir, keepDays: 30 })
  try {
    console.log('창에도 보여야 한다')
  } finally {
    restore()
    console.log = origLog
  }
  assert.ok(seen.some(l => l.includes('창에도 보여야 한다')), '원래 콘솔로도 계속 나가야 한다')
})

test('keepDays보다 오래된 로그를 지운다 — 디스크 풀로 SQLite 쓰기가 막히면 방송 기록이 끊긴다', () => {
  const dir = path.join(TMP, 'logs3')
  fs.mkdirSync(dir, { recursive: true })

  const oldFile = path.join(dir, 'server_20250101.log')
  const newFile = path.join(dir, 'server_20991231.log')
  fs.writeFileSync(oldFile, 'old')
  fs.writeFileSync(newFile, 'new')
  const ancient = Date.now() - 90 * 24 * 3600 * 1000
  fs.utimesSync(oldFile, ancient / 1000, ancient / 1000)

  const fileLog = require('../services/fileLog')
  const removed = fileLog.prune(dir, 30)

  assert.equal(removed, 1)
  assert.equal(fs.existsSync(oldFile), false, '90일 지난 로그는 지워져야 한다')
  assert.equal(fs.existsSync(newFile), true, '최근 로그는 남아야 한다')
})

test('로그 디렉터리를 못 만들어도 서버는 계속 돌아간다', () => {
  const fileLog = require('../services/fileLog')
  // 파일을 디렉터리 경로로 준다 — mkdir이 실패하는 상황
  const blocker = path.join(TMP, 'blocker')
  fs.writeFileSync(blocker, 'x')
  let restore
  assert.doesNotThrow(() => { restore = fileLog.install({ dir: blocker, keepDays: 30 }) })
  assert.doesNotThrow(() => console.log('로그 못 써도 방송은 나가야 한다'))
  restore()
})

// ── fatal ──────────────────────────────────────────────────────────────────

test('uncaughtException이 crash.log에 남고 종료코드가 0이 아니다', () => {
  const crashLog = path.join(TMP, 'crash.log')
  const fatalPath = require.resolve('../services/fatal').replace(/\\/g, '\\\\')
  const script = `
    require('${fatalPath}').install({ crashLogPath: '${crashLog.replace(/\\/g, '\\\\')}' })
    setTimeout(() => { throw new Error('차임벨 spawn ENOENT 흉내') }, 10)
  `
  let code = 0
  try {
    execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 15000 })
  } catch (e) {
    code = e.status
  }

  assert.notEqual(code, 0, '종료코드가 0이면 시작 bat이 "정상 종료"로 보고 재시작하지 않을 수 있다')
  assert.ok(fs.existsSync(crashLog), 'crash.log가 있어야 왜 죽었는지 알 수 있다')
  const body = fs.readFileSync(crashLog, 'utf8')
  assert.match(body, /uncaughtException/)
  assert.match(body, /차임벨 spawn ENOENT 흉내/)
  assert.match(body, /\d{4}-\d{2}-\d{2}T/, '언제 죽었는지가 있어야 한다')
})

test('unhandledRejection은 기록만 하고 프로세스를 죽이지 않는다', () => {
  const crashLog = path.join(TMP, 'crash2.log')
  const fatalPath = require.resolve('../services/fatal').replace(/\\/g, '\\\\')
  const script = `
    require('${fatalPath}').install({ crashLogPath: '${crashLog.replace(/\\/g, '\\\\')}' })
    Promise.reject(new Error('날씨 API 응답 없음'))
    setTimeout(() => process.exit(0), 400)
  `
  let code = 0
  try {
    execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 15000 })
  } catch (e) { code = e.status }

  assert.equal(code, 0, 'promise 하나 깨졌다고 방송 서버를 죽이면 안 된다 — 기록하고 계속 간다')
  const body = fs.readFileSync(crashLog, 'utf8')
  assert.match(body, /unhandledRejection/)
  assert.match(body, /날씨 API 응답 없음/)
})

test('crash.log를 못 써도 종료 자체는 진행된다', () => {
  const fatalPath = require.resolve('../services/fatal').replace(/\\/g, '\\\\')
  const bad = path.join(TMP, 'nope', 'deeper', 'crash.log').replace(/\\/g, '\\\\')
  const script = `
    require('${fatalPath}').install({ crashLogPath: '${bad}' })
    setTimeout(() => { throw new Error('기록 못 하는 상황') }, 10)
  `
  let code = 0
  try {
    execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 15000 })
  } catch (e) { code = e.status }
  assert.notEqual(code, 0, '로그를 못 써도 죽는 건 죽어야 재시작이 걸린다')
})
