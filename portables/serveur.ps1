# Serveur local sans HTTP.sys, droits administrateur ni installation.
# Fermer la fenetre arrete le serveur. -SansNavigateur permet les essais isoles.
param([int]$PortDepart = 8765, [switch]$SansNavigateur)
$ErrorActionPreference = 'Stop'
$racine = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.mjs' = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.wasm' = 'application/wasm'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
  '.md' = 'text/plain; charset=utf-8'; '.data' = 'application/octet-stream'
  '.zip' = 'application/zip'; '.mem' = 'application/octet-stream'
}
$ecouteur = $null
$port = $PortDepart
for ($i = 0; $i -lt 20 -and $port -le 65535; $i++) {
  $essai = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
  try {
    $essai.Server.ExclusiveAddressUse = $true
    $essai.Start()
    $ecouteur = $essai
    break
  } catch { $essai.Stop(); $port++ }
}
if (-not $ecouteur) {
  Write-Host "Impossible de demarrer le serveur local (ports a partir de $PortDepart occupes)." -ForegroundColor Red
  exit 1
}
$url = "http://127.0.0.1:$port/"
Write-Host "Portables est pret : $url" -ForegroundColor Green
Write-Host 'Garde cette fenetre ouverte pendant que tu joues. Ferme-la pour arreter.'
if (-not $SansNavigateur) {
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url }
  else { Start-Process $url }
}
try {
  while ($true) {
    $client = $ecouteur.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 3000
      $client.SendTimeout = 10000
      $flux = $client.GetStream()
      $entete = [System.Collections.Generic.List[byte]]::new()
      while ($entete.Count -lt 16384) {
        $octet = $flux.ReadByte()
        if ($octet -lt 0) { break }
        $entete.Add([byte]$octet)
        $n = $entete.Count
        if ($n -ge 4 -and $entete[$n-4] -eq 13 -and $entete[$n-3] -eq 10 -and $entete[$n-2] -eq 13 -and $entete[$n-1] -eq 10) { break }
      }
      $requete = [System.Text.Encoding]::ASCII.GetString($entete.ToArray()).Split([char]10)[0].Trim()
      $code = 200; $raison = 'OK'; $corps = [byte[]]@(); $type = 'text/plain'; $methode = ''
      if ($requete -notmatch '^(GET|HEAD) (/\S*) HTTP/1\.[01]$') { $code = 405; $raison = 'Method Not Allowed' }
      else {
        $methode = $Matches[1]
        $cible = $Matches[2]
        try {
          $chemin = [System.Uri]::UnescapeDataString($cible.Split([char]'?')[0]).TrimStart('/')
          if ([string]::IsNullOrEmpty($chemin)) { $chemin = 'index.html' }
          $complet = [System.IO.Path]::GetFullPath((Join-Path $racine $chemin))
          if (-not $complet.StartsWith($racine + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { $code = 403; $raison = 'Forbidden' }
          elseif (-not (Test-Path -LiteralPath $complet -PathType Leaf)) { $code = 404; $raison = 'Not Found' }
          else {
            $type = $mime[[System.IO.Path]::GetExtension($complet).ToLowerInvariant()]
            if (-not $type) { $type = 'application/octet-stream' }
            $corps = [System.IO.File]::ReadAllBytes($complet)
          }
        } catch { $code = 400; $raison = 'Bad Request' }
      }
      $reponse = "HTTP/1.1 $code $raison`r`nContent-Type: $type`r`nContent-Length: $($corps.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
      $octets = [System.Text.Encoding]::ASCII.GetBytes($reponse)
      $flux.Write($octets, 0, $octets.Length)
      if ($methode -ne 'HEAD' -and $corps.Length) { $flux.Write($corps, 0, $corps.Length) }
    } catch { # Client ferme ou requete incomplete : continuer a servir les autres.
    } finally { $client.Close() }
  }
} finally { $ecouteur.Stop() }
