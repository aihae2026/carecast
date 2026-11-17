// 구성도(그림) 4장을 개발 콘솔에서 바로 열기 위한 라우트.
//
// 왜 정적 마운트가 아니라 /api 밑인가: 개발 화면(Vite 5173)은 /api와 /audio만 3001로
// 넘긴다. /docs로 붙이면 빌드본(3001)에서만 열리고 개발 화면에서는 404가 난다.
//
// 그림 자체는 이 서버가 만들지 않는다 — docs/arch/*.json이 소스이고 HTML은 archify(/arch-view)가
// 낸 산출물이다. 합본(system-map)만 scripts/build-system-map.cjs로 다시 만들 수 있어서
// 그것만 rebuild를 연다.
'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const router = express.Router()
const ROOT = path.join(__dirname, '..', '..')
const ARCH_DIR = path.join(ROOT, 'docs', 'arch')

// 키 → 파일. **목록을 코드 밖에서 받지 않는다** — 파일명을 요청에서 받으면 경로 탈출이 된다.
const VIEWS = [
  { key: 'system-map', file: 'system-map.html', title: '시스템 지도 (합본)',
    detail: '그림 세 장과 배포 경로를 한 장에 — 진행 상황·코칭 브리프는 여기 없다', buildable: true },
  { key: 'structure', file: 'structure.html', title: '전체 설계도',
    detail: '예약하기 · 방송하기 · 소리내기 · 지켜보기. 번호 1~8이 방송 하나가 나가는 순서', buildable: false },
  { key: 'flow-reserve', file: 'flow-reserve.html', title: '1. 예약하기',
    detail: '문장 한 줄이 예약이 되기까지. AI는 초안까지만 만들고 사람이 확정한다', buildable: false },
  { key: 'flow-broadcast', file: 'flow-broadcast.html', title: '2. 방송하기',
    detail: '그 시각에 무슨 일이 일어나는가. 소리가 두 갈래로 갈리는 곳', buildable: false },
]

const viewOf = (key) => VIEWS.find(v => v.key === key)

// GET /api/dev/arch — 목록 + 각 그림이 실제로 있는지·언제 만들었는지
router.get('/', (req, res) => {
  res.json({
    views: VIEWS.map(v => {
      const full = path.join(ARCH_DIR, v.file)
      let stat = null
      try { stat = fs.statSync(full) } catch { /* 없으면 exists:false로 내려간다 */ }
      return {
        key: v.key, title: v.title, detail: v.detail, buildable: v.buildable,
        exists: !!stat,
        sizeKB: stat ? Math.round(stat.size / 1024) : 0,
        builtAt: stat ? stat.mtime.toISOString() : null,
      }
    }),
    building: build.running,
  })
})

// GET /api/dev/arch/:key/html — 그림 한 장을 그대로 내려준다(개발 콘솔의 iframe이 읽는다)
router.get('/:key/html', (req, res) => {
  const v = viewOf(req.params.key)
  if (!v) return res.status(404).send('그런 그림이 없습니다.')
  const full = path.join(ARCH_DIR, v.file)
  if (!fs.existsSync(full)) {
    return res.status(404).send('아직 만들지 않은 그림입니다. 개발 콘솔의 "다시 만들기"를 누르거나 /arch-view로 다시 그리세요.')
  }
  res.type('html').sendFile(full)
})

// ── 합본 다시 만들기 ────────────────────────────────────────────
// run-verify와 같은 모양: 즉시 응답하고 상태는 폴링한다. 동시에 두 번 돌지 않는다.
const build = { running: false, ok: null, message: '', finishedAt: null }

router.post('/rebuild', (req, res) => {
  if (build.running) return res.status(409).json({ error: '이미 만들고 있습니다.' })
  build.running = true
  build.ok = null
  build.message = ''

  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build-system-map.cjs')],
    { cwd: ROOT, windowsHide: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d.toString() })
  child.stderr.on('data', (d) => { out += d.toString() })
  child.on('error', (e) => {
    build.running = false; build.ok = false
    build.message = '실행하지 못했습니다: ' + e.message
    build.finishedAt = new Date().toISOString()
  })
  child.on('close', (code) => {
    build.running = false
    build.ok = code === 0
    build.message = (out.trim().split('\n').pop() || '') || ('종료코드 ' + code)
    build.finishedAt = new Date().toISOString()
  })
  res.json({ started: true })
})

router.get('/rebuild/status', (req, res) => res.json(build))

module.exports = router
module.exports.VIEWS = VIEWS
