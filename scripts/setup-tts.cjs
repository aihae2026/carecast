#!/usr/bin/env node
// 안내 음성 모델(Supertonic 3) 받기 — `npm run setup:tts` (2026-09-21).
//
// 모델은 139MB 라 저장소에 넣지 않는다. 이 스크립트가 받아 `server/tts-models/supertonic-3/` 에 둔다
// (그 폴더는 .gitignore). 설치판은 이 폴더를 함께 담는다(2026-09-21 사용자 결정 — 인터넷 없는 현장).
//
//   npm run setup:tts                     인터넷에서 받는다(해시 확인)
//   npm run setup:tts -- --from <파일|폴더>  이미 받아 둔 압축 파일(.tar.bz2)이나 풀린 폴더에서 깐다
//
// 모델 가중치 라이선스는 **OpenRAIL-M**(사용 제한 조항 있음 — LICENSES.md). 코드(MIT)와 다르다.
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const 이름 = 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11'
const 주소 = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${이름}.tar.bz2`
// 2026-09-21 에 위 주소에서 받은 파일의 sha256(128,774,318 바이트). 다르면 깔지 않는다.
const SHA256 = '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427'
const 기본대상 = path.join(__dirname, '..', 'server', 'tts-models', 'supertonic-3')
const 필요 = ['duration_predictor.int8.onnx', 'text_encoder.int8.onnx', 'vector_estimator.int8.onnx',
  'vocoder.int8.onnx', 'tts.json', 'unicode_indexer.bin', 'voice.bin']

const 다있나 = (dir) => 필요.every((f) => fs.existsSync(path.join(dir, f)))
const 해시 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function 폴더에서(dir, 대상) {
  if (!다있나(dir)) throw new Error(`모델 파일이 모자란다: ${dir}`)
  fs.mkdirSync(대상, { recursive: true })
  for (const f of fs.readdirSync(dir)) {
    const s = path.join(dir, f)
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(대상, f))
  }
}

// ── .tar.bz2 풀기 — **파이썬 tarfile 로** (2026-09-21 실측) ─────────────────────────────
// tar 로는 PC 마다 결과가 달랐다: Git 이 깔린 PC 는 PATH 의 GNU tar 가 `C:` 를 원격 호스트로 읽어 실패하고,
// System32 의 tar(bsdtar)는 bz2 를 **바깥 bzip2 프로그램**에 맡기는데 그게 Git 것으로 잡혀 멎었다(2분·CPU 0).
// 파이썬은 bz2 를 자체로 푼다. 설치판은 파이썬을 함께 담고(runtime/python), 개발 PC 에도 있다.
function 파이썬찾기() {
  const 묶음 = path.join(__dirname, '..', 'runtime', 'python', 'python.exe')
  const 후보 = [묶음, 'python', 'py', 'python3']
  for (const p of 후보) {
    if (p === 묶음 && !fs.existsSync(p)) continue
    const r = spawnSync(p, ['--version'], { stdio: 'ignore' })
    if (r.status === 0) return p
  }
  return null
}
// 받기 **전에** 부른다(2026-10-17, 설치 시험 c12 — 129MB 를 다 받은 뒤에야 실패했다).
const 파이썬없음 = '파이썬(Python 3)을 못 찾았다 — 모델 압축을 풀 수 없어 받기 전에 멈춘다.\n'
  + '  https://www.python.org/downloads/windows/ 에서 Python 3 을 설치할 때 「Add python.exe to PATH」 를 체크하고,\n'
  + '  새 명령 창에서 다시 실행하세요. (이미 풀린 모델 폴더가 있으면 --from <폴더> 로 파이썬 없이 깔 수 있다)'
function 파이썬확인(찾기 = 파이썬찾기) {
  const py = 찾기()
  if (!py) throw new Error(파이썬없음)
  return py
}
function 풀기(file, 폴더, py = 파이썬확인()) {
  const 코드 = 'import sys, tarfile\n'
    + 't = tarfile.open(sys.argv[1], "r:bz2")\n'
    + 'kw = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}\n'   // 3.12+: 폴더 밖으로 못 쓰게
    + 't.extractall(sys.argv[2], **kw)\n'
  const r = spawnSync(py, ['-c', 코드, file, 폴더], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`압축을 못 풀었다(파이썬 종료코드 ${r.status})`)
}

function 압축에서(file, 대상, py) {
  const h = 해시(file)
  if (h !== SHA256) throw new Error(`해시가 다르다 — 받은 파일이 우리가 확인한 모델이 아니다(${h})`)
  const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tts-model-'))
  try {
    풀기(file, 임시, py)
    폴더에서(path.join(임시, 이름), 대상)
  } finally {
    try { fs.rmSync(임시, { recursive: true, force: true }) } catch { /* 임시 폴더 — 못 지워도 그만 */ }
  }
}

async function 받기(대상, py) {
  const 임시 = path.join(os.tmpdir(), `${이름}.tar.bz2`)
  console.log(`[setup:tts] 받는 중: ${주소}`)
  const res = await fetch(주소)
  if (!res.ok) throw new Error(`받기 실패: HTTP ${res.status}`)
  fs.writeFileSync(임시, Buffer.from(await res.arrayBuffer()))
  try { 압축에서(임시, 대상, py) } finally { try { fs.unlinkSync(임시) } catch { /* 임시 파일 */ } }
}

// 시험에서 대상 폴더·파이썬 찾기·받기를 바꿔 끼울 수 있게 인자로 받는다.
async function 실행({ argv = process.argv.slice(2), 대상 = 기본대상, 파이썬찾기: 찾기 = 파이썬찾기, 받기: 받는일 = 받기 } = {}) {
  const i = argv.indexOf('--from')
  const from = i >= 0 ? argv[i + 1] : null
  if (!from && 다있나(대상)) { console.log(`[setup:tts] 이미 있다: ${대상}`); return }
  if (from) {
    if (!fs.existsSync(from)) throw new Error(`없는 경로: ${from}`)
    if (fs.statSync(from).isDirectory()) 폴더에서(from, 대상)
    else 압축에서(from, 대상, 파이썬확인(찾기))
  } else {
    const py = 파이썬확인(찾기)   // 받기 전에 — 없으면 여기서 멈춘다
    await 받는일(대상, py)
  }
  if (!다있나(대상)) throw new Error('깔고 나서도 파일이 모자란다')
  console.log(`[setup:tts] 완료: ${대상}`)
}

module.exports = { 실행, 필요, 파이썬확인 }

if (require.main === module) {
  실행().catch((e) => { console.error(`[setup:tts] ${e.message}`); process.exit(1) })
}
