# Firma digitale con le API crittografiche di Windows: certificati installati (anche smart card e token di firma
# digitale: CNS, CIE, chiavette) oppure un file .pfx/.p12. La password del file arriva nella variabile DW_PFX_PASS.
# Uso: powershell -File sign.ps1 -Op list|sign|verify -Json <file.json>   (risultato JSON su stdout)
param([string]$Op, [string]$Json)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cfg = if ($Json) { Get-Content -LiteralPath $Json -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }

function Cn($dn) { if ($dn -match '(?:^|,\s*)CN=("[^"]+"|[^,]+)') { $Matches[1].Trim('"') } else { $dn } }
function Field($dn, $key) { if ($dn -match "(?:^|,\s*)$key=(""[^""]+""|[^,]+)") { $Matches[1].Trim('"') } else { '' } }
function Describe($c) {
  $ku = $c.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509KeyUsageExtension] } | Select-Object -First 1
  $flags = [Security.Cryptography.X509Certificates.X509KeyUsageFlags]
  [ordered]@{
    thumbprint = $c.Thumbprint; name = (Cn $c.Subject); subject = $c.Subject; issuer = (Cn $c.Issuer)
    serial = (Field $c.Subject 'SERIALNUMBER'); email = (Field $c.Subject 'E')
    notBefore = $c.NotBefore.ToUniversalTime().ToString('o'); notAfter = $c.NotAfter.ToUniversalTime().ToString('o')
    nonRepudiation = [bool]($ku -and ($ku.KeyUsages -band $flags::NonRepudiation))
    signing = [bool](-not $ku -or ($ku.KeyUsages -band ($flags::NonRepudiation -bor $flags::DigitalSignature)))
  }
}

if ($Op -eq 'list') {
  $store = New-Object Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
  $store.Open('ReadOnly')
  $out = @($store.Certificates | Where-Object { $_.HasPrivateKey } | ForEach-Object { Describe $_ })
  $store.Close()
  ConvertTo-Json -InputObject $out -Depth 4 -Compress
  exit 0
}

if ($Op -eq 'sign') {
  if ($cfg.pfx) {
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($cfg.pfx, [string]$env:DW_PFX_PASS, 'UserKeySet')
    if (-not $cert.HasPrivateKey) { throw 'il file non contiene la chiave privata' }
  } else {
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
    $store.Open('ReadOnly')
    $cert = $store.Certificates | Where-Object { $_.Thumbprint -eq $cfg.thumbprint } | Select-Object -First 1
    $store.Close()
    if (-not $cert) { throw 'certificato non trovato' }
  }
  $data = [IO.File]::ReadAllBytes($cfg.input)
  $ci = New-Object Security.Cryptography.Pkcs.ContentInfo(, $data)
  $cms = New-Object Security.Cryptography.Pkcs.SignedCms($ci, (-not $cfg.attached))
  $signer = New-Object Security.Cryptography.Pkcs.CmsSigner($cert)
  $signer.IncludeOption = 'WholeChain'
  $signer.DigestAlgorithm = New-Object Security.Cryptography.Oid('2.16.840.1.101.3.4.2.1')   # SHA-256
  # ESS signing-certificate-v2 (RFC 5035): lega il certificato alla firma, richiesto da PAdES e CAdES
  $h = [Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
  $ess = [byte[]](@(0x30, 0x26, 0x30, 0x24, 0x30, 0x22, 0x04, 0x20) + $h)
  $signer.SignedAttributes.Add((New-Object Security.Cryptography.AsnEncodedData('1.2.840.113549.1.9.16.2.47', $ess))) | Out-Null
  # PAdES vuole l'ora della firma nel PDF (/M), non dentro la firma
  if (-not $cfg.pades) { $signer.SignedAttributes.Add((New-Object Security.Cryptography.Pkcs.Pkcs9SigningTime)) | Out-Null }
  $cms.ComputeSignature($signer, $false)   # $false: Windows può chiedere il PIN della smart card
  [IO.File]::WriteAllBytes($cfg.output, $cms.Encode())
  ConvertTo-Json -InputObject (Describe $cert) -Compress
  exit 0
}

if ($Op -eq 'verify') {
  $out = @()
  foreach ($s in $cfg.items) {
    $r = [ordered]@{ ok = $false }
    try {
      $ci = New-Object Security.Cryptography.Pkcs.ContentInfo(, [IO.File]::ReadAllBytes($s.data))
      $cms = New-Object Security.Cryptography.Pkcs.SignedCms($ci, $true)
      $cms.Decode([IO.File]::ReadAllBytes($s.sig))
      $si = $cms.SignerInfos[0]
      if ($si.Certificate) { $d = Describe $si.Certificate; foreach ($k in $d.Keys) { $r[$k] = $d[$k] } }
      foreach ($a in $si.SignedAttributes) {
        if ($a.Oid.Value -eq '1.2.840.113549.1.9.5') { $r.signedAt = ([Security.Cryptography.Pkcs.Pkcs9SigningTime]$a.Values[0]).SigningTime.ToUniversalTime().ToString('o') }
      }
      try { $cms.CheckSignature($true); $r.ok = $true } catch { $r.problem = $_.Exception.Message.Trim() }
      if ($si.Certificate) { $r.trusted = $si.Certificate.Verify() }
    } catch { $r.problem = $_.Exception.Message.Trim() }
    $out += $r
  }
  ConvertTo-Json -InputObject $out -Depth 4 -Compress
  exit 0
}
throw "operazione sconosciuta: $Op"
