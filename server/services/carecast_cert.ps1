# CareCast - make a self-signed HTTPS certificate WITHOUT openssl (user report 2026-09-17).
#
# Phone microphones need HTTPS (browser secure context). The installer cannot ship
# server/ssl (it is per-PC and gitignored), and a fresh laptop has no openssl/Git, so
# the old "generate certificate" button failed and https://<ip>:3443 never opened.
# New-SelfSignedCertificate is built into Windows 10+, so this works on any site PC.
#
# The certificate is exported as PFX (read by Node https with a passphrase) and then
# removed from the user's certificate store - nothing is left behind except the file.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Sans,
  [Parameter(Mandatory = $true)][string]$Pass
)
$ErrorActionPreference = 'Stop'
$c = New-SelfSignedCertificate -Subject 'CN=carecast-local' -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(2) `
  -TextExtension @("2.5.29.17={text}$Sans")
try {
  $pw = ConvertTo-SecureString -String $Pass -Force -AsPlainText
  $opt = @{}
  # AES when available: Node (OpenSSL 3) rejects the old RC2/3DES PFX some Windows builds write by default.
  if ((Get-Command Export-PfxCertificate).Parameters.ContainsKey('CryptoAlgorithmOption')) { $opt['CryptoAlgorithmOption'] = 'AES256_SHA256' }
  Export-PfxCertificate -Cert $c -FilePath $Out -Password $pw @opt | Out-Null
} finally {
  Remove-Item ('Cert:\CurrentUser\My\' + $c.Thumbprint) -ErrorAction SilentlyContinue
}
