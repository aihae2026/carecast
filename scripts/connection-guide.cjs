'use strict'
const { networkCandidates } = require('../server/domain/networkAddresses')

function printGuide(interfaces) {
  console.log('\n방송용 PC 한 대에만 설치합니다. 다른 PC·휴대폰은 주소로 접속하세요.')
  console.log('방송용 PC에서: http://localhost:3001')
  const rows = networkCandidates(interfaces)
  for (const row of rows) {
    console.log(`${row.name}${row.recommended ? ' [추천 후보]' : ' [연결 확인 필요]'}: http://${row.address}:3001`)
    if (row.network) console.log(`  서버 대역: ${row.network}`)
    if (row.prefix) console.log(`  휴대폰 Wi-Fi의 IP가 ${row.prefix}으로 시작하는지 확인하세요.`)
  }
  if (!rows.length) console.log('다른 기기용 주소가 없습니다. 유선·Wi-Fi 연결을 확인하세요.')
  console.log('서버를 시작한 뒤 접속하세요. 같은 네트워크여도 방화벽·공유기 격리 설정에 따라 연결이 막힐 수 있습니다.')
  console.log('이 주소는 시설 안에서만 사용하세요. 인터넷에 공개하면 아무나 방송할 수 있습니다.')
  console.log('다시 보기: 설정 → 초기 설정 → 마지막 단계 / 시스템 설정 → 접속 주소 안내\n')
}
if (require.main === module) {
  try { printGuide() } catch { console.error('주소 확인 실패. 서버 시작 후 초기 설정의 마지막 단계에서 다시 확인하세요.'); process.exitCode = 1 }
}
module.exports = { printGuide }
