# Windows PowerShell 5.1. ASCII source; no system Python or administrator needed.
[CmdletBinding()]
param(
    [switch]$PrepareOnly,
    [switch]$NoBrowser,
    [switch]$Offline,
    [int]$Port = 8771
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$CacheRoot = Join-Path $ProjectRoot 'cache'
$PortableRoot = Join-Path $ProjectRoot '.python'
$LogPath = Join-Path $CacheRoot 'launcher-bootstrap.log'

function Assert-PlainPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Lien ou jonction refuse : $Path"
        }
    }
}

function Write-LaunchLog([string]$Message) {
    Write-Host $Message
    if (Test-Path -LiteralPath $CacheRoot) {
        $line = [DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine
        [IO.File]::AppendAllText($LogPath, $line, [Text.UTF8Encoding]::new($false))
    }
}

function Test-PortableFiles([string]$Directory, $Lock) {
    Assert-PlainPath $Directory
    foreach ($property in $Lock.files.PSObject.Properties) {
        $name = $property.Name
        if ($name -match '[\\/:]' -or $name.StartsWith('.') -or $name -match '[\x00-\x1f]') {
            throw 'Chemin du verrou Python interdit.'
        }
        $file = Join-Path $Directory $name
        Assert-PlainPath $file
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Python portable incomplet : $name. Reextrayez le ZIP dans un nouveau dossier."
        }
        $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $property.Value) {
            throw "Python portable altere : $name. Reextrayez le ZIP dans un nouveau dossier."
        }
    }
}

$ExitResult = 1
try {
    Assert-PlainPath $ProjectRoot
    Assert-PlainPath $CacheRoot
    [void][IO.Directory]::CreateDirectory($CacheRoot)
    Assert-PlainPath $LogPath
    Write-LaunchLog 'PS1 Web - preparation automatique, sans installation systeme.'
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Cette livraison necessite Windows 10/11 64 bits.'
    }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port invalide (1 a 65535).' }
    $lock = Get-Content -LiteralPath (Join-Path $ProjectRoot 'docs\portable-python-lock.json') -Raw | ConvertFrom-Json
    if ($lock.schema -ne 'emuperso/portable-python-lock/v1' -or
        $lock.url -ne 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -or
        $lock.archive -ne 'python-3.12.10-embed-amd64.zip') {
        throw 'Verrou de Python portable invalide.'
    }
    if (-not (Test-Path -LiteralPath $PortableRoot)) {
        $archive = Join-Path $CacheRoot $lock.archive
        Assert-PlainPath $archive
        if (-not (Test-Path -LiteralPath $archive)) {
            if ($Offline) { throw 'Python portable absent. Le premier lancement necessite Internet.' }
            Write-LaunchLog '1/3 - Telechargement du Python portable officiel (environ 11 Mo)...'
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $partial = $archive + '.part'
            Assert-PlainPath $partial
            try {
                Invoke-WebRequest -Uri $lock.url -UseBasicParsing -OutFile $partial -TimeoutSec 120
                if ((Get-Item -LiteralPath $partial).Length -ne $lock.bytes -or
                    (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.sha256) {
                    throw 'Integrite du telechargement Python invalide.'
                }
                Move-Item -LiteralPath $partial -Destination $archive
            } finally {
                if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
            }
        }
        if ((Get-Item -LiteralPath $archive).Length -ne $lock.bytes -or
            (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.sha256) {
            throw 'Archive Python du cache alteree. Reextrayez le ZIP dans un nouveau dossier.'
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $staging = Join-Path $CacheRoot ('python-stage-' + [Guid]::NewGuid().ToString('N'))
        try {
            [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
            Test-PortableFiles $staging $lock
            Move-Item -LiteralPath $staging -Destination $PortableRoot
        } finally {
            if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        }
    }
    Test-PortableFiles $PortableRoot $lock
    Write-LaunchLog '2/3 - Python portable verifie. Preparation du moteur local...'
    $env:PYTHONUTF8 = '1'
    $arguments = @('-X', 'utf8', (Join-Path $ProjectRoot 'tools\launcher.py'), '--port', [string]$Port)
    if ($PrepareOnly) { $arguments += '--prepare-only' }
    if ($NoBrowser) { $arguments += '--no-browser' }
    if ($Offline) { $arguments += '--offline' }
    Write-LaunchLog '3/3 - Ouverture automatique de l interface apres verification du serveur.'
    & (Join-Path $PortableRoot 'python.exe') @arguments
    $ExitResult = $LASTEXITCODE
    if ($ExitResult -ne 0) { throw 'Le lancement a echoue. Le detail est affiche ci-dessus et dans cache\launcher.log.' }
} catch {
    Write-LaunchLog ('ECHEC : ' + $_.Exception.Message)
    $ExitResult = 1
}
exit $ExitResult
