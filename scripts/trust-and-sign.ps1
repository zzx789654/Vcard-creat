<#
  trust-and-sign.ps1

  Purpose (self-use only): remove the Windows SmartScreen / "unknown publisher"
  warning for THIS machine, using a self-signed code-signing certificate.
  Pure PowerShell - no Windows SDK, no Node, no GitHub secrets required.

  What it does:
    1. Creates a self-signed code-signing certificate (once), or reuses the
       existing one that matches -Subject.
    2. Trusts it on THIS machine by importing it into the CurrentUser
       "Trusted Root Certification Authorities" and "Trusted Publishers" stores.
    3. If an installer path is given, signs it with Set-AuthenticodeSignature
       and strips the downloaded "Mark of the Web" so it runs without warning.

  Security: the private key is created NON-exportable and the certificate
  expires after 1 year, limiting what a stolen or misused key can sign.
  To stop trusting it, delete it from certmgr.msc (Current User > Personal,
  Trusted Root Certification Authorities, Trusted Publishers).

  NOTE (ASCII-only comments and messages on purpose): Windows PowerShell 5.1
  reads .ps1 as ANSI; non-ASCII in comments can swallow following code lines.
  Chinese walkthrough lives in README.md instead.

  Usage examples (run in PowerShell on your own PC):
    # One-time: just create + trust the certificate
    powershell -ExecutionPolicy Bypass -File scripts\trust-and-sign.ps1

    # Sign a downloaded installer (run after each new download)
    powershell -ExecutionPolicy Bypass -File scripts\trust-and-sign.ps1 `
      -ExePath "$HOME\Downloads\vCard QRCode Generator Setup 1.2.1.exe"
#>

param(
  # Path of the .exe to sign. Omit to only create + trust the certificate.
  [string]$ExePath = "",

  # Certificate subject / friendly name. Keep it stable so the same cert is reused.
  [string]$Subject = "vCard QRCode Generator (self-signed)"
)

$ErrorActionPreference = "Stop"
$dn = "CN=$Subject"

function Get-OrCreateCert {
  param([string]$dn)

  # Reuse an existing code-signing cert with this subject if present.
  $existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $dn -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if ($existing) {
    Write-Host "Reusing existing certificate: $($existing.Thumbprint)"
    return $existing
  }

  Write-Host "Creating a new self-signed code-signing certificate..."
  return New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $dn `
    -FriendlyName $Subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy NonExportable `
    -NotAfter (Get-Date).AddYears(1)
}

function Trust-Cert {
  param($cert)

  # Import the PUBLIC cert into this user's Trusted Root + Trusted Publishers.
  # This is what makes Windows trust anything signed by it, on THIS machine.
  foreach ($storeName in @("Root", "TrustedPublisher")) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
      $storeName, "CurrentUser")
    $store.Open("ReadWrite")
    $already = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if (-not $already) {
      # Import public part only (no private key) into the trust stores.
      $pub = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $cert.Export("Cert"))
      $store.Add($pub)
      Write-Host "Trusted certificate in CurrentUser\$storeName."
    } else {
      Write-Host "Certificate already trusted in CurrentUser\$storeName."
    }
    $store.Close()
  }
}

$cert = Get-OrCreateCert -dn $dn
Trust-Cert -cert $cert

if ([string]::IsNullOrWhiteSpace($ExePath)) {
  Write-Host ""
  Write-Host "Certificate is ready and trusted on this machine."
  Write-Host "Re-run with -ExePath <installer.exe> to sign a downloaded installer."
  exit 0
}

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "File not found: $ExePath"
}

# Strip Mark-of-the-Web so SmartScreen does not treat it as an internet download.
try {
  Unblock-File -LiteralPath $ExePath
  Write-Host "Removed Mark-of-the-Web from the file."
} catch {
  Write-Host "Could not unblock file (may already be unblocked): $($_.Exception.Message)"
}

# Sign the installer. No timestamp server is used (offline-friendly); the
# signature stays valid as long as the certificate has not expired.
$result = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -HashAlgorithm SHA256
Write-Host ""
Write-Host "Signing status : $($result.Status)"
Write-Host "Signed file    : $ExePath"

if ($result.Status -ne "Valid") {
  Write-Host "Signature status is not Valid. Check that the certificate is trusted."
  exit 1
}

Write-Host ""
Write-Host "Done. This installer should now run without the warning on THIS machine."
