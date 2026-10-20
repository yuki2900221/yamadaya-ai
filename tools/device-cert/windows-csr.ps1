# Offline administrator preparation for the actual shared Windows account.
# No network, no private-key files, no policy changes, no software-key fallback.
[CmdletBinding()]
param(
    [switch]$Prepare,
    [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Yamadaya-AI-device-request')
)
$ErrorActionPreference = 'Stop'
if (-not $Prepare) {
    Write-Output 'Preparation only: read the README. Run with -Prepare only after explicit authorization.'
    Write-Output 'This creates a non-exportable TPM RSA key in the current Windows user account and a PUBLIC CSR.'
    exit 0
}
if ($env:OS -ne 'Windows_NT') { throw 'Run this only on the approved Windows 11 shared PC.' }
$tpm = Get-Tpm
if (-not $tpm.TpmPresent -or -not $tpm.TpmReady) { throw 'TPM is unavailable or not ready. Stop; no software-provider fallback.' }
$cn = 'Yamadaya-trial-Windows-20261019'
$infPath = Join-Path $OutputDirectory 'yamadaya-windows-20261019.inf'
$csrPath = Join-Path $OutputDirectory 'yamadaya-windows-20261019.csr'
if (Test-Path $OutputDirectory) {
    # A failed or prior request may already have created its TPM key. Never silently run twice.
    throw 'Output directory already exists. Stop and inspect the original request; do not create another key.'
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$inf = @'
[Version]
Signature="$Windows NT$"

[NewRequest]
Subject = "CN=Yamadaya-trial-Windows-20261019"
FriendlyName = "Yamadaya AI mock Windows 20261019"
RequestType = PKCS10
KeyAlgorithm = RSA
KeyLength = 2048
HashAlgorithm = SHA256
ProviderName = "Microsoft Platform Crypto Provider"
MachineKeySet = FALSE
Exportable = FALSE
ExportableEncrypted = FALSE
KeyUsage = 0x80
SMIME = FALSE

[Extensions]
2.5.29.19 = "{text}CA=FALSE"
2.5.29.37 = "{text}1.3.6.1.5.5.7.3.2"
'@
Set-Content -LiteralPath $infPath -Value $inf -Encoding Ascii
& certreq.exe -user -new $infPath $csrPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $csrPath)) {
    throw 'certreq failed. Keep this request directory and inspect it; do not retry by changing providers or exportability.'
}
Write-Output "Public CSR saved: $csrPath"
Write-Output "Certificate CN: $cn"
Write-Output 'Private key: current user, Microsoft Platform Crypto Provider (TPM), non-exportable.'
Write-Output 'Send only the PUBLIC CSR to the administrator. No password, private key, PFX, or personal Google login is required.'
Write-Output 'After the administrator validates the returned PUBLIC certificate, run in the SAME Windows account:'
Write-Output 'certreq.exe -user -accept "C:\path\yamadaya-windows-20261019.cer"'
Write-Output 'Original trial deadline remains 2026-10-26 08:47:54 JST, regardless of certificate expiry.'
