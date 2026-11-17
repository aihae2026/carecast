// 차임 합성 스크립트가 볼륨 인자를 안전한 범위로 가두는가 (P-18, 2026-09-08)
//
// 왜 이 파일이 있나:
//   `carecast_chime.py:37` 이 `VOLUME = float(sys.argv[2])` 로 **받은 값을 그대로 믿었다.**
//   그 값은 `:58` 에서 `scale = 0.75 * VOLUME * 32767 / mx` 로 진폭에 곱해진다.
//   [FACT] EV-000483 — 상한이 없다.
//
//   이 저장소에는 볼륨 단위가 **두 층**이다 — 화면·DB 는 0~100, 이 스크립트는 0~1.
//   앱 경로 둘은 `/100` 을 거쳐 들어오지만([FACT] EV-000484·EV-000485),
//   **스크립트를 직접 부르는 사람**(운영자·다른 도구·오타)이 `80` 을 넘기면
//   진폭이 100배가 되어 **요양원 홀에 굉음이 난다.** 되돌릴 수 없는 종류의 사고다.
//
//   음수도 같다 — 위상이 뒤집힌 소리가 나간다.
//
// 이 테스트는 **실제로 파이썬을 돌려** 확인한다. 소스 대조만으로는 "가뒀다"를 못 본다.
// 파이썬이 없는 환경(맥 CI 등)에서는 조용히 건너뛴다 — 없는 것을 실패로 적지 않는다.

const { test } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const SCRIPT = path.join(__dirname, '..', 'services/carecast_chime.py')

/** 이 PC 에서 쓸 수 있는 파이썬 하나. 없으면 null. */
function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    const r = spawnSync(cmd, ['-c', 'print(1)'], { encoding: 'utf8' })
    if (r.status === 0) return cmd
  }
  return null
}

/** 스크립트가 인자를 어떻게 가두는지, 그 함수만 떼어 물어본다(소리는 내지 않는다). */
function clampedTo(py, raw) {
  const code = [
    'import sys, re',
    `src = open(r"${SCRIPT}", encoding="utf-8").read()`,
    // VOLUME 을 정하는 줄만 뽑아서 그대로 실행한다 — 합성·재생은 건드리지 않는다
    'line = [l for l in src.split("\\n") if l.startswith("VOLUME")][0]',
    `sys.argv = ["x", "general", "${raw}"]`,
    'exec(line)',
    'print(VOLUME)',
  ].join('\n')
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8' })
  assert.equal(r.status, 0, `파이썬 실행 실패: ${r.stderr}`)
  return Number(r.stdout.trim())
}

const py = findPython()

test('볼륨 인자가 0~1 밖이면 가둔다 — 굉음도 위상 뒤집힘도 안 난다', { skip: py ? false : '이 PC 에 파이썬이 없다' }, () => {
  // 스크립트를 직접 부르는 사람이 0~100 단위로 넘긴 경우(가장 흔한 실수)
  assert.equal(clampedTo(py, '80'), 1, '80 을 그대로 쓰면 진폭이 80배가 된다 — 홀에 굉음이 난다')
  assert.equal(clampedTo(py, '100'), 1)
  // 음수 — 위상이 뒤집힌 소리
  assert.equal(clampedTo(py, '-1'), 0)
  // 정상 범위는 그대로
  assert.equal(clampedTo(py, '0.8'), 0.8)
  assert.equal(clampedTo(py, '0'), 0)
  assert.equal(clampedTo(py, '1'), 1)
})

test('소스에 상한 표기가 있다 — 파이썬이 없는 환경에서도 되돌림을 잡는다', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  assert.ok(/^VOLUME/m.test(src), 'VOLUME 을 정하는 줄이 없다 — 이 가드를 옮길 것')
  assert.match(src, /min\(|max\(/,
    'VOLUME 에 상·하한이 없다 — 스크립트를 직접 부르는 사람이 80 을 넘기면 굉음이 난다(P-18)')
})
