'use strict'
// **설치 파일과 바로가기의 아이콘을 만든다** (사용자 지적 2026-09-16 요지: 아이콘이 보기 좋지 않다).
//
// ── 무엇이 이상했나 ────────────────────────────────────────────────────────
// `CareCast.iss` 에 `SetupIconFile` 도 `IconFilename` 도 없었다. 그러면 Windows 가
// 제 기본값을 쓴다:
//   · 설치 파일(`CareCast-Setup.exe`) → **Inno Setup 의 기본 아이콘**(아래 화살표)
//   · 바탕화면 바로가기               → 가리키는 `wscript.exe` 의 아이콘
// 둘 다 「이 프로그램」과 아무 상관이 없는 그림이라, 바탕화면에서 무엇인지 알 수 없다.
//
// ── 무엇을 그리나 (사용자 지시) ────────────────────────────────────────────
// *"아이콘 케어캐스트 홈화면 처럼 있잖아 그거"* — 화면 왼쪽 위의 이름표
// (`src/components/shared/BrandMark.jsx`)와 **같은 얼굴**로 그린다. 그래야 바탕화면·
// 작업 표시줄·앱 화면이 전부 같은 것으로 읽힌다.
//
// 그 이름표는 둘로 돼 있다:
//   · 물감 두 방울을 흘린 둥근 사각 판 — 하늘(`--ds-v3-drop-tts` #87C6F1) ·
//     자두(`--ds-v3-drop-bgm` #EFB8E4). **새 색이 아니다**(G-1).
//   · 그 위의 전파 표시(lucide `Radio`) — 잉크색.
//
// ── 왜 PNG 를 줄이지 않고 다시 그리나 ──────────────────────────────────────
// 512px 한 장을 16px 로 줄이면 **선이 뭉갠다.** 전파 표시는 가는 호(弧) 넷이라
// 특히 그렇다. 크기마다 **그 크기에 맞는 선 굵기로 새로 그리면** 16px 에서도 살아 있다.
//
// ── 그리는 일은 .NET 에 맡긴다 ─────────────────────────────────────────────
// 이미지 라이브러리를 새로 들이지 않는다(의존성 추가는 승인 항목이다). Windows 에 이미
// 있는 `System.Drawing` 으로 그린다.
//
// ── ICO 안에는 PNG 를 그대로 넣는다 ────────────────────────────────────────
// ICO 는 원래 BMP(DIB)를 담지만 Vista 부터 **PNG 를 그대로** 담을 수 있다. 설치 대상이
// Windows 10 이상이라(`MinVersion=10.0`) 안전하고, 알파가 그대로 살아 투명한 모서리가
// 깨끗하다.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const 나갈곳 = path.join(ROOT, 'scripts', 'installer', 'carecast.ico')
// ── **설치 파일은 따로 알아보게 한다** (사용자 지적 2026-09-18) ──────────────────────────
// *"설치파일이랑, 실행파일이랑 같으니까 헷갈려, 뭔가 구분짓게"* · *"아이콘 설치파일 저 오른쪽 부분에 cd가 삽입된 느낌"*
// 둘이 같은 얼굴이라 다운로드 폴더의 `CareCast-Setup.exe` 와 바탕화면의 「CareCast AI」 가 구분이 안 됐다.
// 설치 파일에는 **같은 얼굴의 위쪽 3분의 1을 가로로 잘라 낸 자리에 CD 한 장이 꽂혀 삐져나온** 그림을 쓴다(설치 프로그램에 흔한 관례).
// 설치하면 바탕화면·시작 메뉴에는 CD 없는 원래 얼굴이 뜬다 — 「받은 파일」과 「설치된 프로그램」이 갈린다.
// (한 번 「열린 상자에서 나오는 얼굴」로 잘못 그렸다가 사용자 말을 다시 듣고 고쳤다 — 2026-09-18.)
const 설치파일아이콘 = path.join(ROOT, 'scripts', 'installer', 'carecast-setup.ico')

// Windows 가 실제로 꺼내 쓰는 크기들. 256 은 「큰 아이콘」 보기에 쓰인다.
const 크기들 = [16, 24, 32, 48, 64, 128, 256]

// 색은 `src/styles/tokens.css` 의 값과 같아야 한다. **여기서 새로 정하지 않는다** —
// 토큰이 바뀌면 이 표도 같이 바꾼다(`server/test/installer-icon.test.js` 가 대조한다).
const 하늘 = '135,198,241'   // --ds-v3-drop-tts  #87C6F1
const 자두 = '239,184,228'   // --ds-v3-drop-bgm  #EFB8E4
const 잉크 = '26,29,35'      // --ds-v3-ink 계열 — 물감 위에서 읽히는 어두운 색

/**
 * 크기 하나를 그리는 PowerShell 조각.
 *
 * lucide `Radio` 는 24 칸 안에 그려진 **호 넷 + 가운데 점**이다. 좌표를 그대로 옮기지 않고
 * 중심(12,12) 기준의 **각도와 반지름**으로 다시 적는다 — 그래야 어느 크기에서도 같은 모양이다.
 *   · 바깥 호: 반지름 10.04, 왼쪽 135°~225° · 오른쪽 315°~45°
 *   · 안쪽 호: 반지름 5.94,  같은 각도
 *   · 가운데 점: 반지름 2
 * (GDI+ 의 각도는 3시 방향이 0 이고 시계 방향으로 는다.)
 */
function 그리기코드(임시폴더, { 디스크 = false } = {}) {
  const 폴더 = 임시폴더.replace(/'/g, "''")
  // ── 디스크(설치 파일 전용) ────────────────────────────────────────────────
  // *"오른쪽 부분에 cd가 삽입된 느낌"* · *"원래 아이콘 3분의 1 자르고 집어넣어야지 … 사이즈 정규사이즈에 맞게"*
  // 얼굴은 **줄이지 않는다** — 원래 크기 그대로 두고 **위쪽 3분의 1을 가로로 잘라** 그 자리에 CD 를 끼운다(처음엔 오른쪽을 세로로 잘랐다가 사용자 지시로 바꿨다 — 2026-09-18). 그래야
  // 다른 아이콘들과 크기가 같다(한 번 얼굴을 72% 로 줄였다가 사용자가 고쳐 줬다).
  // 그리는 순서가 곧 앞뒤다: ① CD(뒤) → ② 얼굴(앞, 아래 2/3 만) — 잘린 자리에서 CD 가 드러난다.
  // **새 색을 들이지 않는다**(G-1) — 옅은 은색 판(#F4F6FB 계열) · 잉크 테두리 · 하늘색 반짝임(물감 한 방울과 같은 색)뿐.
  // 16px 에서는 반짝임이 한 픽셀이라 빼고 **원 + 테두리 + 가운데 구멍**만 남겨도 디스크로 읽힌다.
  // **바깥 괄호가 꼭 있어야 한다** — `New-Object … Pen (색), [float](…)` 처럼 괄호 없이 넘기면 PowerShell 이
  // `[float](…)` 을 따로 떨어진 위치 인자로 읽어 「'1' 인수를 받는 매개 변수를 찾을 수 없습니다」로 죽는다(실측).
  const 선 = (w) => `([float]([Math]::Max(1.0, $size * ${w})))`
  const 디스크앞 = !디스크 ? [] : [
    '',
    '  # ── 디스크 ① 얼굴 뒤 위쪽에 CD ────────────────────────────────',
    '  $R = $size * 0.42; $dx = $size * 0.50; $dy = $size * 0.44',
    `  $dPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, ${잉크})), ${선(0.035)}`,
    '  $disc = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 244, 246, 251))',
    '  $g.FillEllipse($disc, ($dx - $R), ($dy - $R), ($R * 2), ($R * 2))',
    '  $g.DrawEllipse($dPen, ($dx - $R), ($dy - $R), ($R * 2), ($R * 2))',
    '  if ($size -ge 24) {',
    '    # 반짝임 — 위로 보이는 쪽에 하늘색 호 하나',
    `    $shine = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, ${하늘})), ${선(0.045)}`,
    '    $sr = $R * 0.70',
    '    $g.DrawArc($shine, ($dx - $sr), ($dy - $sr), ($sr * 2), ($sr * 2), 290, 50)',
    '    $shine.Dispose()',
    '  }',
    '  # 가운데 허브와 구멍 — 얼굴에 가려 안 보인다(작은 크기에서 모양만 맞춘다)',
    '  $hr = $R * 0.34',
    '  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))',
    '  $g.FillEllipse($white, ($dx - $hr), ($dy - $hr), ($hr * 2), ($hr * 2))',
    '  $g.DrawEllipse($dPen, ($dx - $hr), ($dy - $hr), ($hr * 2), ($hr * 2))',
    '  $hole = [Math]::Max(1.0, $R * 0.12)',
    `  $inkb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, ${잉크}))`,
    '  $g.FillEllipse($inkb, ($dx - $hole), ($dy - $hole), ($hole * 2), ($hole * 2))',
    '  $inkb.Dispose(); $white.Dispose(); $disc.Dispose(); $dPen.Dispose()',
    '  # ② 얼굴은 원래 크기 그대로, 위쪽 3분의 1 을 가로로 잘라 낸 채로 그린다 — 잘린 자리에 CD 가 보인다',
    '  $g.SetClip((New-Object System.Drawing.RectangleF 0, ($size * 0.333), $size, ($size * 0.667)))',
  ]
  const 디스크뒤 = !디스크 ? [] : [
    '  $g.ResetClip()',
  ]
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Drawing',
    `foreach ($size in @(${크기들.join(',')})) {`,
    '  $bmp = New-Object System.Drawing.Bitmap $size, $size',
    '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '  $g.Clear([System.Drawing.Color]::Transparent)',
    ...디스크앞,
    '',
    '  # ── 둥근 사각 판 ──────────────────────────────────────────────',
    '  # 모서리 반지름은 크기의 22% — 화면 이름표(rounded-[10px] on 32px)와 같은 비율이다.',
    '  $r = [Math]::Max(2.0, $size * 0.22)',
    '  $pad = 0.0',
    '  $rect = New-Object System.Drawing.RectangleF $pad, $pad, ($size - $pad*2), ($size - $pad*2)',
    '  $path = New-Object System.Drawing.Drawing2D.GraphicsPath',
    '  $d = $r * 2',
    '  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)',
    '  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)',
    '  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)',
    '  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)',
    '  $path.CloseFigure()',
    '',
    '  # 물감 두 방울 — 왼쪽 위 하늘, 오른쪽 아래 자두. 화면 이름표와 같은 방향이다.',
    '  $p1 = New-Object System.Drawing.PointF 0, 0',
    '  $p2 = New-Object System.Drawing.PointF ([float]$size), ([float]$size)',
    `  $c1 = [System.Drawing.Color]::FromArgb(255, ${하늘})`,
    `  $c2 = [System.Drawing.Color]::FromArgb(255, ${자두})`,
    '  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $c1, $c2',
    '  $g.FillPath($brush, $path)',
    '  $brush.Dispose()',
    '',
    '  # ── 전파 표시 ────────────────────────────────────────────────',
    '  # 24칸 그림을 판의 62% 크기로 가운데 놓는다.',
    '  $glyph = $size * 0.62',
    '  $k = $glyph / 24.0',
    '  $cx = $size / 2.0',
    // 설치 파일은 위 3분의 1 이 잘려 있으니 전파 표시를 **남은 판의 가운데**(위에서 2/3)로 내린다 —
    // 한가운데에 두면 바깥 호의 윗부분이 잘린다(사용자 지적 2026-09-18 *"로고 잘리지 않게 밑으로"*).
    디스크 ? '  $cy = $size * 0.667' : '  $cy = $size / 2.0',
    '  # 선 굵기: 24칸 기준 2.0 을 비례로 줄이되 **1.2px 밑으로는 안 내린다** —',
    '  # 그 밑에서는 안티에일리어싱에 묻혀 호가 사라진다(16px 에서 실제로 그랬다).',
    '  $sw = [Math]::Max(1.2, 2.0 * $k)',
    `  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, ${잉크})), ([float]$sw)`,
    '  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round',
    '',
    '  foreach ($rr in @(10.04, 5.94)) {',
    '    $rad = $rr * $k',
    '    $box = New-Object System.Drawing.RectangleF ($cx - $rad), ($cy - $rad), ($rad*2), ($rad*2)',
    '    $g.DrawArc($pen, $box, 135, 90)   # 왼쪽',
    '    $g.DrawArc($pen, $box, 315, 90)   # 오른쪽',
    '  }',
    '  $dot = 2.0 * $k',
    `  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, ${잉크}))`,
    '  $g.FillEllipse($fill, ($cx - $dot), ($cy - $dot), ($dot*2), ($dot*2))',
    '  $fill.Dispose()',
    '  $pen.Dispose()',
    ...디스크뒤,
    '  $path.Dispose()',
    '  $g.Dispose()',
    `  $bmp.Save((Join-Path '${폴더}' ("$size.png")), [System.Drawing.Imaging.ImageFormat]::Png)`,
    '  $bmp.Dispose()',
    '}',
  ].join('\n')
}

/**
 * PNG 조각들을 ICO 한 파일로 묶는다.
 *
 * 머리 6바이트 + 조각마다 16바이트 목록 + 그 뒤로 PNG 바이트들.
 * **256 은 폭·높이 칸에 0 으로 적는다** — 그 칸이 1바이트라 256 이 안 들어간다.
 * 0 이 곧 256 이라는 것이 규격이고, 여기를 틀리면 큰 아이콘만 안 나온다.
 */
function 묶기(조각들) {
  const 머리 = Buffer.alloc(6)
  머리.writeUInt16LE(0, 0)               // 예약 — 늘 0
  머리.writeUInt16LE(1, 2)               // 1 = 아이콘(2 면 커서다)
  머리.writeUInt16LE(조각들.length, 4)

  const 목록 = Buffer.alloc(16 * 조각들.length)
  let 자리 = 6 + 목록.length             // 첫 PNG 가 시작하는 바이트 위치
  조각들.forEach((조각, i) => {
    const o = i * 16
    목록[o]     = 조각.크기 >= 256 ? 0 : 조각.크기   // 폭
    목록[o + 1] = 조각.크기 >= 256 ? 0 : 조각.크기   // 높이
    목록[o + 2] = 0                     // 색 수 — 트루컬러면 0
    목록[o + 3] = 0                     // 예약
    목록.writeUInt16LE(1, o + 4)        // 색 평면
    목록.writeUInt16LE(32, o + 6)       // 비트 깊이(알파 포함)
    목록.writeUInt32LE(조각.자료.length, o + 8)
    목록.writeUInt32LE(자리, o + 12)
    자리 += 조각.자료.length
  })

  return Buffer.concat([머리, 목록, ...조각들.map(c => c.자료)])
}

function 만들기() {
  return [
    한벌(나갈곳, {}),                        // 바탕화면·시작 메뉴·설치된 프로그램
    한벌(설치파일아이콘, { 디스크: true }),    // 설치 파일(CareCast-Setup.exe)만
  ]
}

function 한벌(나갈곳, 선택) {
  const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-icon-'))
  try {
    execFileSync('powershell',
      ['-NoProfile', '-NonInteractive', '-Command', 그리기코드(임시, 선택)],
      { stdio: 'inherit' })
    const 조각들 = 크기들.map(크기 => {
      const p = path.join(임시, `${크기}.png`)
      const 자료 = fs.readFileSync(p)
      // 그리기가 조용히 실패하면 빈 파일이 남는다 — 그대로 묶으면 아이콘이 안 뜬다.
      if (자료.length < 100) throw new Error(`${크기}px 조각이 비었다`)
      return { 크기, 자료 }
    })
    fs.mkdirSync(path.dirname(나갈곳), { recursive: true })
    fs.writeFileSync(나갈곳, 묶기(조각들))
    const kb = (fs.statSync(나갈곳).size / 1024).toFixed(1)
    console.log(`아이콘 만듦: ${path.relative(ROOT, 나갈곳)}  (${크기들.join('·')}px, ${kb}KB)`)
    return 나갈곳
  } finally {
    fs.rmSync(임시, { recursive: true, force: true })
  }
}

if (require.main === module) 만들기()
module.exports = { 만들기, 크기들, 나갈곳, 설치파일아이콘, 묶기, 그리기코드, 색: { 하늘, 자두, 잉크 } }
