'use strict'
// ── **휴대폰 마이크용 HTTPS 인증서 — openssl 없이도 만든다** (사용자 신고 2026-09-17 「예전엔 됐었어」) ──
//
// 휴대폰 브라우저는 보안 접속(HTTPS)에서만 마이크를 내준다. 예전에 되던 PC(개발·현장)에는 openssl(Git)로
// 만들어 둔 `server/ssl/key.pem`·`cert.pem` 이 있었다. 그 폴더는 PC 마다 다르고 git 에서 빠지므로 **설치 파일에는
// 안 들어가고**, 새 노트북에는 openssl 도 없어 「인증서 생성」도 실패했다 → 3443 이 영영 안 열렸다.
//
// 그래서 Windows 에 기본으로 있는 PowerShell `New-SelfSignedCertificate` 로 PFX 를 만든다(carecast_cert.ps1).
// 이미 있는 pem(예전 방식)은 그대로 먼저 쓴다 — 현장 PC 의 인증서를 바꾸지 않는다.
const fs = require('fs')
const path = require('path')

const 기본폴더 = path.join(__dirname, '..', 'ssl')
const PFX이름 = 'cert.pfx'
// 자체서명 인증서를 여는 암호는 **인증서마다 새로 만들어** 인증서 옆 파일에 둔다(2026-11-10 추가 점검 —
// 예전엔 모든 설치가 같은 암호를 코드에 박아 썼다). 이 폴더(server/ssl)는 git 에 안 올라간다.
const 암호파일이름 = 'cert-pass.txt'
// **읽기 전용 호환값** — 암호 파일이 생기기 전에 만든 인증서(이미 설치된 PC)를 여는 데만 쓴다.
// 이것을 지우면 그 PC 들은 업데이트 직후 HTTPS(휴대폰 마이크)가 꺼진다. 새 인증서에는 쓰지 않는다.
const 옛PFX암호 = 'carecast-local'
const 스크립트 = path.join(__dirname, 'carecast_cert.ps1')

/** 있는 인증서를 읽어 `https.createServer` 옵션으로 준다. 없으면 null. */
function 인증서읽기(폴더 = 기본폴더) {
  const key = path.join(폴더, 'key.pem'), cert = path.join(폴더, 'cert.pem'), pfx = path.join(폴더, PFX이름)
  try {
    if (fs.existsSync(key) && fs.existsSync(cert)) return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
    if (fs.existsSync(pfx)) {
      const 암호파일 = path.join(폴더, 암호파일이름)
      const 암호 = fs.existsSync(암호파일) ? fs.readFileSync(암호파일, 'utf8').trim() : ''
      return { pfx: fs.readFileSync(pfx), passphrase: 암호 || 옛PFX암호 }
    }
  } catch { /* 못 읽으면 없는 것으로 본다 — HTTP 는 그대로 돈다 */ }
  return null
}

/**
 * Windows 에서 PFX 인증서를 만든다. 성공하면 true.
 * @param {string[]} ips 인증서에 넣을 이 PC 의 주소들(휴대폰이 들어올 주소)
 * @param {object} [의존] 시험용 — spawnSync·platform·폴더를 바꿔 끼운다
 */
function 인증서만들기(ips, { spawnSync = require('child_process').spawnSync, platform = process.platform, 폴더 = 기본폴더, log = console } = {}) {
  if (platform !== 'win32') return false
  try { fs.mkdirSync(폴더, { recursive: true }) } catch { /* 아래 실행이 실패하면 그때 알린다 */ }
  const 주소 = [...new Set(['127.0.0.1', ...(ips || [])])].filter((ip) => /^[0-9.]+$/.test(ip))
  const sans = [...주소.map((ip) => `IPAddress=${ip}`), 'DNS=localhost'].join('&')
  // 이 인증서만의 암호. **16진수만** 쓴다 — base64 계열은 `-` 로 시작할 수 있는데, PowerShell 은
  // `-Pass -abc…` 의 값을 다른 매개변수 이름으로 읽어 인증서 만들기가 실패한다. 따옴표·특수문자도 안 낀다.
  const 암호 = require('crypto').randomBytes(16).toString('hex')
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 스크립트,
    '-Out', path.join(폴더, PFX이름), '-Sans', sans, '-Pass', 암호], { stdio: 'pipe', timeout: 30000, windowsHide: true })
  if (r.status === 0 && fs.existsSync(path.join(폴더, PFX이름))) {
    // 암호를 못 적으면 그 인증서는 아무도 못 연다 — 인증서를 지우고 실패로 돌린다(다음 기동 때 다시 만든다).
    try { fs.writeFileSync(path.join(폴더, 암호파일이름), 암호, 'utf8') } catch (e) {
      try { fs.unlinkSync(path.join(폴더, PFX이름)) } catch { /* 이미 없으면 그만 */ }
      log.warn?.('[HTTPS] 인증서 암호를 저장하지 못해 인증서를 지웠습니다:', e.message)
      return false
    }
    log.log?.(`[HTTPS] 인증서를 만들었습니다(openssl 없이) — ${주소.join(', ')}`)
    return true
  }
  log.warn?.('[HTTPS] 인증서를 만들지 못했습니다:', String(r.stderr || r.error?.message || '').trim().slice(0, 300))
  return false
}

/** 시험·소리 끈 시험 서버에서는 PC 의 인증서 저장소를 건드리지 않는다. */
function 자동생성해도되나() {
  if (process.env.NODE_TEST_CONTEXT || process.env.CARECAST_TEST === '1') return false
  try { if (require('./hardwareMode').hardwareDisabled()) return false } catch { /* 모르면 아래로 */ }
  return true
}

module.exports = { 인증서읽기, 인증서만들기, 자동생성해도되나, PFX이름, 기본폴더 }
