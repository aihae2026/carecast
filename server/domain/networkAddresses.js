'use strict'
const os = require('node:os')
const { isIPv4 } = require('node:net')

// 어댑터 순서는 연결 우선순위가 아니다. 후보를 보존하고 추천은 추정으로 표시한다.
function networkCandidates(interfaces = os.networkInterfaces()) {
  const rows = []
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const iface of addresses || []) {
      if (iface.internal || !['IPv4', 4].includes(iface.family) || !isIPv4(iface.address)) continue
      const parts = iface.address.split('.').map(Number)
      const privateLAN = parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
      const virtual = /virtual|vethernet|wsl|hyper-v|vmware|vbox|vpn|tailscale|zerotier|docker|loopback|tunnel|tap-|tun\d/i.test(name)
      const mask = isIPv4(iface.netmask || '') ? iface.netmask.split('.').map(Number) : null
      const bits = mask?.map(n => n.toString(2).padStart(8, '0')).join('')
      const prefixLength = bits && /^1*0*$/.test(bits) ? bits.indexOf('0') < 0 ? 32 : bits.indexOf('0') : null
      const network = prefixLength === null ? null : `${parts.map((n, i) => n & mask[i]).join('.')}/${prefixLength}`
      const prefix = [8, 16, 24].includes(prefixLength) ? parts.slice(0, prefixLength / 8).join('.') + '.' : null
      rows.push({ name, address: iface.address, netmask: iface.netmask || null, network, prefix, privateLAN, virtual, recommended: false })
    }
  }
  rows.sort((a, b) => Number(b.privateLAN && !b.virtual) - Number(a.privateLAN && !a.virtual) || Number(a.virtual) - Number(b.virtual) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
  if (rows[0]?.privateLAN && !rows[0].virtual) rows[0].recommended = true
  return rows
}

function getLocalIP(interfaces) {
  return networkCandidates(interfaces)[0]?.address || '127.0.0.1'
}

module.exports = { networkCandidates, getLocalIP }
