# Execute with Windows PowerShell 5.1. Tests launchers, not game compatibility.
[CmdletBinding()]
param(
    [switch]$RequireFresh,
    [ValidateRange(1024, 65534)][int]$Port = 18870
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $root 'tools\launch-windows.ps1'
$pythonPath = Join-Path $root '.python\python.exe'
$shellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$evidence = Join-Path $root 'evidence\windows-launcher'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$results = New-Object System.Collections.Generic.List[object]
$started = Get-Date
$serverProcess = $null
$collisionListener = $null

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Add-Pass([string]$Name, [string]$Proof) {
    $script:results.Add([ordered]@{ name = $Name; result = 'REUSSI'; proof = $Proof })
    Write-Host "REUSSI - $Name : $Proof"
}

function Stop-TestProcess($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        # Kill only the process tree started by this test, never an existing server.
        & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>&1 | Out-Null
        $null = $Process.WaitForExit(10000)
    }
}

function Start-Launcher([string]$Name, [string[]]$Options) {
    # All options below are fixed switches/integers; only the quoted file path varies.
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script:launcherPath + '" ' + ($Options -join ' ')
    return Start-Process -FilePath $script:shellPath -ArgumentList $arguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $script:evidence ($Name + '.stdout.txt')) `
        -RedirectStandardError (Join-Path $script:evidence ($Name + '.stderr.txt'))
}

function Invoke-Launcher([string]$Name, [string[]]$Options, [int]$TimeoutSeconds = 180) {
    $process = Start-Launcher $Name $Options
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-TestProcess $process
        throw "Timeout: $Name ($TimeoutSeconds secondes)."
    }
    # Refresh after WaitForExit to make ExitCode available on PowerShell 5.1.
    $process.Refresh()
    return $process.ExitCode
}

function Get-HttpStatus([string]$Url, [string]$Method = 'GET') {
    try {
        return [int](Invoke-WebRequest -UseBasicParsing -Uri $Url -Method $Method -TimeoutSec 3).StatusCode
    } catch {
        if ($null -ne $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        throw
    }
}

function Wait-ForPage([string]$Url, $Process, [int]$TimeoutSeconds = 45) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw "Le lanceur s'est termine avant le serveur (code $($Process.ExitCode))." }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return $response }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    throw "Le serveur n'a pas repondu dans le delai: $Url"
}

try {
    Assert-True ($env:OS -eq 'Windows_NT') 'Ce test requiert Windows.'
    Assert-True (Test-Path -LiteralPath $launcherPath) 'Script de lancement absent.'
    Assert-True (Test-Path -LiteralPath $shellPath) 'Windows PowerShell 5.1 absent.'
    $wasFresh = -not (Test-Path -LiteralPath $pythonPath)
    if ($RequireFresh) {
        Assert-True $wasFresh 'RequireFresh refuse un runtime portable preexistant; aucun fichier supprime.'
        Assert-True (-not (Test-Path (Join-Path $root 'vendor'))) 'RequireFresh refuse un vendor preexistant.'
    }

    $exitCode = Invoke-Launcher 'prepare-online' @('-PrepareOnly') 300
    Assert-True ($exitCode -eq 0) "Preparation en ligne echouee: code $exitCode; voir prepare-online.*.txt."
    Assert-True (Test-Path -LiteralPath $pythonPath) 'Le runtime portable n a pas ete cree.'
    $version = & $pythonPath -X utf8 -c 'import sys; print(sys.version); print(sys.executable)'
    Assert-True ($LASTEXITCODE -eq 0) 'Le Python portable ne peut pas etre execute.'
    $version | Set-Content -Encoding UTF8 -Path (Join-Path $evidence 'portable-python.txt')
    Add-Pass 'Preparation automatique sans commande py/python du PATH' ("Code 0; runtime portable execute; dossier initialement vierge=$wasFresh.")

    $exitCode = Invoke-Launcher 'prepare-offline' @('-PrepareOnly', '-Offline')
    Assert-True ($exitCode -eq 0) "Preparation hors ligne echouee: code $exitCode."
    Add-Pass 'Relance hors ligne' 'PrepareOnly -Offline termine avec code 0 apres la preparation.'

    $portableArchive = Get-ChildItem -LiteralPath (Join-Path $root '.python') -Filter 'python*.zip' -File | Select-Object -First 1
    Assert-True ($null -ne $portableArchive) 'Bibliotheque standard portable absente.'
    $portableOriginal = [IO.File]::ReadAllBytes($portableArchive.FullName)
    $tamperedPortable = [byte[]]$portableOriginal.Clone()
    $tamperedPortable[0] = $tamperedPortable[0] -bxor 255
    try {
        [IO.File]::WriteAllBytes($portableArchive.FullName, $tamperedPortable)
        $badHash = (Get-FileHash -LiteralPath $portableArchive.FullName -Algorithm SHA256).Hash
        $exitCode = Invoke-Launcher 'tampered-portable' @('-PrepareOnly', '-Offline') 45
        Assert-True ($exitCode -ne 0) 'Le runtime portable altere aurait du etre refuse avant execution.'
        Assert-True ((Get-FileHash -LiteralPath $portableArchive.FullName -Algorithm SHA256).Hash -eq $badHash) 'Le runtime portable altere a ete remplace sans decision explicite.'
    } finally {
        [IO.File]::WriteAllBytes($portableArchive.FullName, $portableOriginal)
    }
    Add-Pass 'Integrite du Python portable' "Bibliotheque alteree refusee (code $exitCode), aucun remplacement automatique; octets originaux restaures par le test."

    $zipPath = Join-Path $root 'cache\python-3.12.10-embed-amd64.zip'
    $portableDir = Join-Path $root '.python'
    $portableHold = Join-Path $root '.python-test-hold'
    Assert-True (-not (Test-Path -LiteralPath $portableHold)) 'Dossier temporaire de test deja present; aucun remplacement.'
    Assert-True (Test-Path -LiteralPath $zipPath) 'Archive Python de cache absente apres preparation.'
    $zipOriginal = [IO.File]::ReadAllBytes($zipPath)
    $tamperedZip = [byte[]]$zipOriginal.Clone()
    $tamperedZip[0] = $tamperedZip[0] -bxor 255
    Rename-Item -LiteralPath $portableDir -NewName '.python-test-hold'
    try {
        [IO.File]::WriteAllBytes($zipPath, $tamperedZip)
        $exitCode = Invoke-Launcher 'tampered-archive' @('-PrepareOnly', '-Offline') 45
        Assert-True ($exitCode -ne 0) 'Une archive Python alteree aurait du etre refusee.'
        Assert-True (-not (Test-Path -LiteralPath $pythonPath)) 'Le Python altere a ete installe.'
    } finally {
        [IO.File]::WriteAllBytes($zipPath, $zipOriginal)
        Assert-True (-not (Test-Path -LiteralPath $portableDir)) 'Une installation inattendue empeche la restauration du dossier de test.'
        Rename-Item -LiteralPath $portableHold -NewName '.python'
    }
    Add-Pass 'Integrite de l archive avant extraction' "Archive de cache alteree refusee (code $exitCode); aucun python.exe installe; archive et runtime originaux restaures."

    $exitCode = Invoke-Launcher 'invalid-port' @('-NoBrowser', '-Offline', '-Port', '0') 30
    Assert-True ($exitCode -ne 0) 'Le port zero aurait du etre refuse.'
    $errorBytes = (Get-Item (Join-Path $evidence 'invalid-port.stdout.txt')).Length + (Get-Item (Join-Path $evidence 'invalid-port.stderr.txt')).Length
    Assert-True ($errorBytes -gt 0) 'L echec ne laisse aucun message de diagnostic.'
    Add-Pass 'Erreur de configuration visible' "Port 0 refuse (code $exitCode); message conserve dans invalid-port.*.txt."

    $collisionListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $collisionListener.Start()
    $exitCode = Invoke-Launcher 'occupied-port' @('-NoBrowser', '-Offline', '-Port', [string]$Port) 45
    Assert-True ($exitCode -ne 0) 'Un port occupe aurait du etre refuse.'
    Assert-True $collisionListener.Server.IsBound 'Le lanceur a affecte le service deja present.'
    $collisionListener.Stop()
    $collisionListener = $null
    Add-Pass 'Port occupe' "Code $exitCode; le listener etranger du test reste lie; aucun navigateur ouvert."

    $serverPort = $Port + 1
    $baseUrl = "http://127.0.0.1:$serverPort"
    $serverProcess = Start-Launcher 'server-offline' @('-NoBrowser', '-Offline', '-Port', [string]$serverPort)
    $page = Wait-ForPage ($baseUrl + '/') $serverProcess
    Assert-True ($page.Content -match 'Choisir une ROM') 'La page livree n est pas le prototype reel.'
    $health = Invoke-RestMethod -Uri ($baseUrl + '/__n64lab_health') -TimeoutSec 5
    Assert-True ($health.application -eq 'emuperso-real-n64') 'L identite du serveur est incorrecte.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($health.instance)) 'Le jeton d instance est absent.'
    Assert-True ($page.Headers['Cross-Origin-Opener-Policy'] -eq 'same-origin') 'En-tete COOP absent.'
    Assert-True ($page.Headers['Cross-Origin-Embedder-Policy'] -eq 'require-corp') 'En-tete COEP absent.'
    $module = Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + '/rom-file.mjs') -TimeoutSec 5
    Assert-True ($module.Headers['Content-Type'] -match '^text/javascript') 'Le type MIME .mjs est incorrect sous Windows.'
    Add-Pass 'Serveur reel prepare et demarre hors ligne' 'HTTP 200, identite et instance health, bouton Choisir une ROM, COOP/COEP et MIME .mjs verifies.'

    $originalInstance = $health.instance
    $exitCode = Invoke-Launcher 'second-launcher' @('-NoBrowser', '-Offline', '-Port', [string]$serverPort) 45
    Assert-True ($exitCode -ne 0) 'Un second lanceur a pu prendre le port du premier.'
    Assert-True (-not $serverProcess.HasExited) 'Le premier lanceur a ete arrete par le second.'
    $healthAfter = Invoke-RestMethod -Uri ($baseUrl + '/__n64lab_health') -TimeoutSec 5
    Assert-True ($healthAfter.application -eq 'emuperso-real-n64' -and $healthAfter.instance -eq $originalInstance) 'L instance du serveur original a change.'
    Add-Pass 'Double lancement sur un meme port' "Second lanceur refuse (code $exitCode); premiere instance toujours vivante et identique."

    foreach ($path in @('/cache/', '/.python/', '/.git/config')) {
        foreach ($method in @('GET', 'HEAD')) {
            $status = Get-HttpStatus ($baseUrl + $path) $method
            Assert-True ($status -eq 403) "Chemin protege accepte: $method $path ($status)."
        }
    }
    $postStatus = Get-HttpStatus ($baseUrl + '/') 'POST'
    Assert-True ($postStatus -eq 501) "POST devrait etre absent; code=$postStatus."
    Add-Pass 'Separation et absence de reception de ROM' 'GET/HEAD cache, .python, .git refuses 403; POST refuse 501. Aucun fichier ROM prive utilise.'

    Stop-TestProcess $serverProcess
    $serverProcess = $null
    $probe = [System.Net.Sockets.TcpClient]::new()
    $stillListening = $false
    try { $probe.Connect([System.Net.IPAddress]::Loopback, $serverPort); $stillListening = $true }
    catch [System.Net.Sockets.SocketException] { }
    finally { $probe.Dispose() }
    Assert-True (-not $stillListening) 'Le serveur accepte encore des connexions apres fermeture.'
    Add-Pass 'Fermeture du processus de test' "Connexion TCP au port $serverPort refusee apres arret du seul arbre de processus lance par le test."

    $batch = Get-Content -Raw -LiteralPath (Join-Path $root 'lancer.bat')
    Assert-True ($batch -match '(?im)^\s*pause\b') 'Le batch doit garder une erreur visible avec pause.'
    Assert-True ($batch -match '(?i)launch-windows\.ps1') 'Le batch ne delegue pas au nouveau lanceur.'
    Assert-True (-not ($batch -match '(?im)^\s*py(?:\s|$)')) 'Le batch depend encore de py installe.'
    Add-Pass 'Contrat du double clic (inspection du batch)' 'Delegation PowerShell, pause sur erreur et absence de commande py obligatoire. Interaction visuelle manuelle NON TESTEE.'
    Assert-True ($results.Count -eq 11) 'Le nombre attendu de groupes de tests est 11.'
} catch {
    $results.Add([ordered]@{ name = 'Execution du test'; result = 'ECHOUE'; proof = $_.Exception.Message })
    Write-Host ('ECHOUE - ' + $_.Exception.Message)
} finally {
    if ($null -ne $collisionListener) { $collisionListener.Stop() }
    Stop-TestProcess $serverProcess
    $report = [ordered]@{
        schema = 'emuperso/windows-launcher-tests/v1'
        started_utc = $started.ToUniversalTime().ToString('o')
        finished_utc = (Get-Date).ToUniversalTime().ToString('o')
        platform = [Environment]::OSVersion.VersionString
        powershell = $PSVersionTable.PSVersion.ToString()
        expected_groups = 11
        tests = @($results.ToArray())
        non_testes = @('Chrome sur le PC de Karl', 'Double clic visuel dans Explorer', 'Jeux commerciaux', 'Manette physique et haut-parleurs')
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path (Join-Path $evidence 'results.json')
}

if (@($results | Where-Object { $_.result -eq 'ECHOUE' }).Count -gt 0) { exit 1 }
exit 0
