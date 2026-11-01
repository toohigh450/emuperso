# Petit serveur web local (127.0.0.1 seulement), sans installation ni droits administrateur.
# Sert les fichiers de ce dossier, rien d autre. Fermer la fenetre arrete le serveur.
param([int]$PortDepart = 8765)

$ErrorActionPreference = 'Stop'
$racine = (Resolve-Path -LiteralPath $PSScriptRoot).Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.js'  = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.wasm' = 'application/wasm'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg'  = 'image/jpeg'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'; '.data' = 'application/octet-stream'
  '.zip'  = 'application/zip'; '.mem' = 'application/octet-stream'
}

$ecouteur = $null
$port = $PortDepart
for ($i = 0; $i -lt 20; $i++) {
  $essai = New-Object System.Net.HttpListener
  $essai.Prefixes.Add("http://127.0.0.1:$port/")
  try { $essai.Start(); $ecouteur = $essai; break }
  catch { $essai.Close(); $port++ }
}
if (-not $ecouteur) {
  Write-Host "Impossible de demarrer le serveur local (ports $PortDepart a $port occupes)." -ForegroundColor Red
  Read-Host "Appuie sur Entree pour fermer"
  exit 1
}

$url = "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "Portables est pret : $url" -ForegroundColor Green
Write-Host "Garde cette fenetre ouverte pendant que tu joues. Ferme-la pour arreter."
Write-Host ""

# Ouvre Chrome si on le trouve, sinon le navigateur par defaut.
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url }
else {
  Write-Host "Chrome introuvable : ouverture avec le navigateur par defaut." -ForegroundColor Yellow
  Start-Process $url
}

try {
  while ($ecouteur.IsListening) {
    $ctx = $ecouteur.GetContext()
    $req = $ctx.Request
    $rep = $ctx.Response
    try {
      if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') {
        $rep.StatusCode = 405; $rep.Close(); continue
      }
      $chemin = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ([string]::IsNullOrEmpty($chemin)) { $chemin = 'index.html' }
      $complet = [System.IO.Path]::GetFullPath((Join-Path $racine $chemin))
      # Interdit de sortir du dossier du projet.
      if (-not $complet.StartsWith($racine + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        $rep.StatusCode = 403; $rep.Close(); continue
      }
      if (-not (Test-Path -LiteralPath $complet -PathType Leaf)) {
        $rep.StatusCode = 404; $rep.Close(); continue
      }
      $ext = [System.IO.Path]::GetExtension($complet).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $octets = [System.IO.File]::ReadAllBytes($complet)
      $rep.ContentType = $type
      $rep.Headers.Add('Cache-Control', 'no-cache')
      $rep.Headers.Add('X-Content-Type-Options', 'nosniff')
      $rep.ContentLength64 = $octets.Length
      if ($req.HttpMethod -ne 'HEAD') { $rep.OutputStream.Write($octets, 0, $octets.Length) }
      $rep.Close()
    }
    catch {
      try { $rep.Abort() } catch {}
    }
  }
}
finally {
  $ecouteur.Stop()
  $ecouteur.Close()
}
