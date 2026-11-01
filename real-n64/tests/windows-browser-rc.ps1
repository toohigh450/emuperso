# Windows PowerShell 5.1 CI harness. Not a test on Karl's computer.
# Uses a separate actions/setup-python runtime, not the application's portable Python.
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$evidence = Join-Path $root 'evidence\windows-browser-rc'
$cache = Join-Path $root 'cache\windows-browser-rc'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
# A manually repeated harness must not upload stale reports as a fresh run.
# Retain earlier scoped evidence locally rather than deleting it.
if (Test-Path -LiteralPath $evidence -PathType Container) {
    $existingEvidence = @(Get-ChildItem -LiteralPath $evidence -Force)
    if ($existingEvidence.Count -gt 0) {
        $priorEvidence = Join-Path $cache ('prior-evidence-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $priorEvidence | Out-Null
        foreach ($entry in $existingEvidence) {
            Move-Item -LiteralPath $entry.FullName -Destination $priorEvidence
        }
    }
}
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$results = New-Object System.Collections.Generic.List[object]
$started = Get-Date
$environmentMetadata = $null
$pythonPath = $null
$oldChromiumPath = [Environment]::GetEnvironmentVariable('CHROMIUM_PATH', 'Process')
$oldPythonUtf8 = [Environment]::GetEnvironmentVariable('PYTHONUTF8', 'Process')
$oldPythonUnbuffered = [Environment]::GetEnvironmentVariable('PYTHONUNBUFFERED', 'Process')
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Json($Value, [string]$Path) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), $script:utf8)
}

function Stop-TestProcess($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        # Kill only this test process and its own browser/server descendants.
        & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>&1 | Out-Null
        $null = $Process.WaitForExit(10000)
    }
}

function Invoke-TestPython([string]$Name, [string]$Arguments, [int]$TimeoutSeconds) {
    $process = Start-Process -FilePath $script:pythonPath -ArgumentList $Arguments -PassThru -WindowStyle Hidden `
        -WorkingDirectory $script:root `
        -RedirectStandardOutput (Join-Path $script:evidence ($Name + '.stdout.txt')) `
        -RedirectStandardError (Join-Path $script:evidence ($Name + '.stderr.txt'))
    $null = $process.Handle
    try {
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            throw "Timeout for $Name after $TimeoutSeconds seconds; see scoped stdout/stderr."
        }
        $process.WaitForExit()
        Assert-True ($null -ne $process.ExitCode) "No exit code available for $Name."
        return [int]$process.ExitCode
    } finally {
        Stop-TestProcess $process
    }
}

function Invoke-BrowserBench([string]$Name, [string]$Script, [string]$Report, [string]$Schema, [int]$ExpectedGroups, [int]$TimeoutSeconds, [string[]]$Images) {
    $benchStarted = Get-Date
    $fileNames = @($Report)
    if ($null -ne $Images) { $fileNames += @($Images | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) }
    $prior = @{}
    $cleared = New-Object 'System.Collections.Generic.HashSet[string]'
    $generated = New-Object System.Collections.Generic.List[object]
    $backupDirectory = Join-Path $script:cache ('prior-source-' + $Name + '-' + [Guid]::NewGuid().ToString('N'))
    try {
        # A stale Linux/source report must never be relabelled as a Windows pass.
        # Preserve prior evidence byte-for-byte and restore it in finally.
        # PowerShell variables are case-insensitive: never use $name here,
        # because that would overwrite the benchmark parameter $Name.
        foreach ($evidenceName in $fileNames) {
            $path = Join-Path (Join-Path $script:root 'evidence') $evidenceName
            $exists = Test-Path -LiteralPath $path -PathType Leaf
            $bytes = $null
            $modified = $null
            if ($exists) {
                $bytes = [IO.File]::ReadAllBytes($path)
                $modified = [IO.File]::GetLastWriteTimeUtc($path)
                New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
                # Keep a disk backup as well, so a restoration I/O failure cannot
                # discard the only retained copy when the process exits.
                [IO.File]::WriteAllBytes((Join-Path $backupDirectory $evidenceName), $bytes)
            }
            $prior[$evidenceName] = @{ exists = $exists; bytes = $bytes; modified = $modified }
            if ($exists) { Remove-Item -LiteralPath $path }
            $null = $cleared.Add($evidenceName)
        }
        $scriptPath = Join-Path $PSScriptRoot $Script
        Assert-True (Test-Path -LiteralPath $scriptPath -PathType Leaf) "Missing benchmark: $Script"
        $arguments = '-X utf8 -u "' + $scriptPath + '"'
        $exitCode = Invoke-TestPython $Name $arguments $TimeoutSeconds
        $reportPath = Join-Path (Join-Path $script:root 'evidence') $Report
        Assert-True (Test-Path -LiteralPath $reportPath -PathType Leaf) "No fresh report from $Script (exit $exitCode)."
        $data = Get-Content -Raw -Encoding UTF8 -LiteralPath $reportPath | ConvertFrom-Json
        Assert-True ($data.schema -eq $Schema) "Unexpected report schema for $Script."
        $rows = @($data.results)
        Assert-True ($exitCode -eq 0) "Benchmark $Script failed with exit $exitCode; inspect its fresh report."
        Assert-True ($rows.Count -eq $ExpectedGroups) "Expected $ExpectedGroups groups from $Script, observed $($rows.Count)."
        $successStatus = 'R' + [char]201 + 'USSI'
        $failed = @($rows | Where-Object { $_.status -ne $successStatus })
        Assert-True ($failed.Count -eq 0) "$Script contains a failed or non-testable group; no success is inferred."
        $script:results.Add([ordered]@{
            name = $Name; result = 'REUSSI'; script = $Script; groups = $rows.Count
            report = $Report; generated_on_this_runner = $true
            started_utc = $benchStarted.ToUniversalTime().ToString('o')
            finished_utc = (Get-Date).ToUniversalTime().ToString('o')
        })
        Write-Host "REUSSI - $Name : $($rows.Count) real-browser checks on this Windows CI runner."
    } catch {
        $script:results.Add([ordered]@{
            name = $Name; result = 'ECHOUE'; script = $Script
            proof = $_.Exception.Message; started_utc = $benchStarted.ToUniversalTime().ToString('o')
            finished_utc = (Get-Date).ToUniversalTime().ToString('o')
        })
        Write-Host ('ECHOUE - ' + $Name + ' : ' + $_.Exception.Message)
    } finally {
        $cleanupErrors = New-Object System.Collections.Generic.List[string]
        foreach ($evidenceName in $fileNames) {
            $source = Join-Path (Join-Path $script:root 'evidence') $evidenceName
            try {
                if ($cleared.Contains($evidenceName) -and (Test-Path -LiteralPath $source -PathType Leaf)) {
                    $destination = Join-Path $script:evidence $evidenceName
                    Copy-Item -LiteralPath $source -Destination $destination -Force
                    $generated.Add([ordered]@{ path = $evidenceName; sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() })
                }
            } catch {
                $cleanupErrors.Add("Fresh evidence copy failed for ${evidenceName}: $($_.Exception.Message)")
            }
            # Each restoration has its own error boundary. Failure to copy or
            # restore one file must not skip the remaining preserved files.
            try {
                if ($prior.ContainsKey($evidenceName)) {
                    if ($prior[$evidenceName].exists) {
                        [IO.File]::WriteAllBytes($source, [byte[]]$prior[$evidenceName].bytes)
                        [IO.File]::SetLastWriteTimeUtc($source, $prior[$evidenceName].modified)
                    } elseif ($cleared.Contains($evidenceName) -and (Test-Path -LiteralPath $source -PathType Leaf)) {
                        Remove-Item -LiteralPath $source
                    }
                }
            } catch {
                $cleanupErrors.Add("Prior evidence restoration failed for ${evidenceName}: $($_.Exception.Message); retained backup: $backupDirectory")
            }
        }
        try {
            Write-Json ([ordered]@{ schema = 'emuperso/windows-browser-evidence/v1'; bench = $Name; files = @($generated.ToArray()); cleanup_errors = @($cleanupErrors.ToArray()); scope = 'Fresh files produced on this Windows CI runner only, owned MIT ROM; no personal saves or commercial ROM.' }) (Join-Path $script:evidence ($Name + '.evidence.json'))
        } catch {
            $cleanupErrors.Add("Evidence manifest write failed: $($_.Exception.Message)")
        }
        if ($cleanupErrors.Count -gt 0) {
            $summary = $script:results[$script:results.Count - 1]
            $summary['result'] = 'ECHOUE'
            $summary['proof'] = $cleanupErrors -join ' | '
            Write-Host ('ECHOUE - ' + $Name + ' evidence preservation : ' + ($cleanupErrors -join ' | '))
        }
    }
}

try {
    Assert-True ($env:OS -eq 'Windows_NT') 'This harness requires Windows; do not label a Linux run as Windows.'
    $pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
    Assert-True (Test-Path -LiteralPath $pythonPath -PathType Leaf) 'actions/setup-python Python was not found.'
    Assert-True (Test-Path -LiteralPath (Join-Path $root 'vendor\data\src\emulator.js') -PathType Leaf) 'Run the Windows launcher preparation first.'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONUNBUFFERED = '1'
    $metadataPath = Join-Path $evidence 'environment.json'
    $helperPath = Join-Path $cache 'observe-environment.py'
    # ASCII Python helper writes an ASCII-escaped JSON file, avoiding PowerShell
    # 5.1 native stdout decoding problems in the apostrophe/accent checkout path.
    $helper = @'
import json, platform, sys
from importlib.metadata import version
from pathlib import Path
from playwright.sync_api import sync_playwright
assert sys.platform == 'win32', sys.platform
assert version('playwright') == '1.62.0'
assert version('pillow') == '12.3.0'
with sync_playwright() as pw:
    executable = pw.chromium.executable_path
    browser = pw.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    chromium_version = browser.version
    browser.close()
assert chromium_version.startswith('151.'), 'Pinned Playwright browser differs: ' + chromium_version
metadata = {
    'schema': 'emuperso/windows-browser-environment/v1',
    'python': {'executable': sys.executable, 'version': sys.version, 'platform': platform.platform()},
    'packages': {'playwright': version('playwright'), 'pillow': version('pillow')},
    'chromium': {'executable': executable, 'version': chromium_version},
    'scope': 'Windows Server 2022 GitHub Actions runner and pinned Chrome for Testing; actual N64 Wasm core with only the repository MIT demo.',
    'tested_on_karl_pc': False,
    'not_tested': ['Karl Windows/Chrome device', 'physical gamepad and speakers', 'commercial ROM compatibility', 'all native save peripherals']
}
Path(sys.argv[1]).write_text(json.dumps(metadata, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
print('Observed Windows runner and pinned Chromium ' + chromium_version)
'@
    [IO.File]::WriteAllText($helperPath, $helper, $utf8)
    $arguments = '-X utf8 -u "' + $helperPath + '" "' + $metadataPath + '"'
    $exitCode = Invoke-TestPython 'environment-preflight' $arguments 90
    Assert-True ($exitCode -eq 0) "Browser preflight failed (exit $exitCode)."
    $environmentMetadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $metadataPath | ConvertFrom-Json
    $env:CHROMIUM_PATH = [string]$environmentMetadata.chromium.executable
    Assert-True (Test-Path -LiteralPath $env:CHROMIUM_PATH -PathType Leaf) 'Python did not report an installed Chromium executable.'

    Invoke-BrowserBench 'ram-identification' 'probe_ram_identification_rc.py' 'tests-ram-identification-rc-browser.json' 'emuperso/ram-identification-rc-tests/v1' 3 180 @()
    Invoke-BrowserBench 'restore-independent' 'probe_restore_rc.py' 'probe-restore-rc.json' 'emuperso/restore-independent-probe/v1' 3 120 @()
    Invoke-BrowserBench 'restore-regressions' 'browser_restore_rc.py' 'tests-restore-rc-browser.json' 'emuperso/restore-rc-browser-tests/v1' 9 360 @('restore-rc-final.png', 'restore-rc-failure.png')
    Invoke-BrowserBench 'restore-guards' 'browser_restore_guards_rc.py' 'tests-restore-guards-rc-browser.json' 'emuperso/restore-guards-rc-browser-tests/v1' 4 180 @('restore-guards-rc-final.png', 'restore-guards-rc-failure.png')
    Invoke-BrowserBench 'hub-full' 'browser_hub.py' 'tests-hub-browser.json' 'emuperso/hub-browser-tests/v1' 17 420 @('hub-first.png', 'hub-animation.png', 'hub-final.png', 'hub-failure.png', 'hub-failure-diagnostic.json')
} catch {
    $results.Add([ordered]@{ name = 'Windows browser harness'; result = 'ECHOUE'; proof = $_.Exception.Message })
    Write-Host ('ECHOUE - ' + $_.Exception.Message)
} finally {
    $report = [ordered]@{
        schema = 'emuperso/windows-browser-rc-tests/v1'
        started_utc = $started.ToUniversalTime().ToString('o')
        finished_utc = (Get-Date).ToUniversalTime().ToString('o')
        platform = [Environment]::OSVersion.VersionString
        powershell = $PSVersionTable.PSVersion.ToString()
        environment = $environmentMetadata
        expected_benches = 5
        expected_groups = 36
        tests = @($results.ToArray())
        tested_on_karl_pc = $false
        scope = 'Windows Server 2022 CI plus real pinned Chrome, own MIT homebrew only. No original save, private BIOS or commercial ROM.'
        non_testes = @('Chrome on Karl PC', 'Physical gamepad and speakers', 'Commercial games and all cheats')
    }
    Write-Json $report (Join-Path $evidence 'results.json')
    [Environment]::SetEnvironmentVariable('CHROMIUM_PATH', $oldChromiumPath, 'Process')
    [Environment]::SetEnvironmentVariable('PYTHONUTF8', $oldPythonUtf8, 'Process')
    [Environment]::SetEnvironmentVariable('PYTHONUNBUFFERED', $oldPythonUnbuffered, 'Process')
}

if ($results.Count -ne 5 -or @($results | Where-Object { $_.result -ne 'REUSSI' }).Count -gt 0) { exit 1 }
exit 0
