'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { networkCandidates, getLocalIP } = require('../domain/networkAddresses')
const nic = (address, netmask = '255.255.255.0') => ({ address, netmask, family: 'IPv4', internal: false })

test('physical private LAN is preferred over virtual, public and link-local adapters', () => {
  const interfaces = { 'vEthernet (WSL)': [nic('172.20.0.1')], Ethernet: [nic('192.168.0.8')], VPN: [nic('10.8.0.2')], Other: [nic('169.254.1.2'), nic('203.0.113.2')] }
  const rows = networkCandidates(interfaces)
  assert.equal(getLocalIP(interfaces), '192.168.0.8')
  assert.equal(rows.length, 5)
  assert.equal(rows[0].recommended, true)
  assert.equal(rows.filter(r => r.recommended).length, 1)
  assert.equal(rows.find(r => r.name.includes('WSL')).virtual, true)
})
test('subnet comes from actual mask, not assumed /24', () => {
  const [row] = networkCandidates({ Ethernet: [nic('10.20.30.40', '255.255.0.0')] })
  assert.equal(row.network, '10.20.0.0/16')
  assert.equal(row.prefix, '10.20.')
  assert.equal(networkCandidates({ E: [nic('192.168.1.130', '255.255.255.128')] })[0].prefix, null)
})
test('offline and loopback do not become a remote connection recommendation', () => {
  assert.deepEqual(networkCandidates({ lo: [{ ...nic('127.0.0.1'), internal: true }] }), [])
  assert.equal(getLocalIP({}), '127.0.0.1')
  assert.equal(networkCandidates({ 'VirtualBox Host-Only': [nic('192.168.56.1')] })[0].recommended, false)
})
