// SwitchBot 기기 목록 조회 테스트 스크립트
// 실행: node test-switchbot-devices.js
const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

// .env 파일 수동 파싱 (dotenv 미설치 환경 대비)
function loadEnv() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) {
    console.error('.env 파일이 없습니다. .env.example을 참고해 .env를 만들어주세요.')
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.trim().split('=')
    if (key && !key.startsWith('#') && rest.length) {
      process.env[key.trim()] = rest.join('=').trim()
    }
  }
}

loadEnv()

const TOKEN  = process.env.SWITCHBOT_TOKEN
const SECRET = process.env.SWITCHBOT_SECRET

if (!TOKEN || !SECRET) {
  console.error('.env에 SWITCHBOT_TOKEN 또는 SWITCHBOT_SECRET이 없습니다.')
  process.exit(1)
}

function makeHeaders(token, secret) {
  const t     = Date.now().toString()
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const sign  = crypto
    .createHmac('sha256', secret)
    .update(token + t + nonce)
    .digest('base64')
  return {
    'Authorization': token,
    'sign':          sign,
    't':             t,
    'nonce':         nonce,
  }
}

async function listDevices() {
  const res  = await fetch('https://api.switch-bot.com/v1.1/devices', {
    headers: makeHeaders(TOKEN, SECRET),
  })
  const data = await res.json()

  if (data.statusCode !== 100) {
    console.error('API 오류:', data.statusCode, data.message)
    process.exit(1)
  }

  const devices = data.body?.deviceList ?? []
  if (devices.length === 0) {
    console.log('등록된 기기가 없습니다.')
    return
  }

  console.log(`\n등록된 기기 총 ${devices.length}개\n`)
  console.log('─'.repeat(60))
  for (const d of devices) {
    console.log(`deviceId   : ${d.deviceId}`)
    console.log(`deviceName : ${d.deviceName}`)
    console.log(`deviceType : ${d.deviceType ?? '-'}`)
    console.log('─'.repeat(60))
  }
}

listDevices().catch(err => {
  console.error('오류:', err.message)
  process.exit(1)
})
