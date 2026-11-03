param(
    [string]$OutputDir,
    [switch]$RunNpx,
    [string]$VerifyDir
)

$ErrorActionPreference = 'Stop'

if ($RunNpx) {
    $env:USERPROFILE = Join-Path $VerifyDir 'profile'
    $env:PORT = '0'
    Remove-Item Env:CLAUDE_DASH_SYNC_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:CLAUDE_DASH_MACHINE_NAME -ErrorAction SilentlyContinue
    Set-Location -LiteralPath $VerifyDir
    & npx.cmd --no-install claude-usage-dashboard
    $npxExitCode = $LASTEXITCODE
    Write-Output "NPX_RETURNED:$npxExitCode"
    exit $npxExitCode
}

if (-not $IsWindows) { throw 'The npx foreground regression check requires Windows' }
if (-not $OutputDir) { throw 'OutputDir is required' }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$packOutput = & npm pack --json --pack-destination $OutputDir
if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }
$packOutput | Set-Content -LiteralPath (Join-Path $OutputDir 'pack.json') -Encoding utf8
$pack = @($packOutput | ConvertFrom-Json)[0]
$tarball = Join-Path $OutputDir $pack.filename
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('claude-dashboard-npx-' + [guid]::NewGuid().ToString('N'))
$process = $null

function Get-Descendants([int]$ParentId) {
    $all = @(Get-CimInstance Win32_Process)
    $parents = @($ParentId)
    while ($parents.Count -gt 0) {
        $children = @($all | Where-Object { $_.ParentProcessId -in $parents })
        $children
        $parents = @($children | Select-Object -ExpandProperty ProcessId)
    }
}

try {
    $fixtureDir = Join-Path $scratch 'profile/.claude/projects/-Users-test-Workspace-releasefixture'
    New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null
    @{
        type = 'assistant'; sessionId = 'release-smoke'; timestamp = '2026-11-02T12:00:00.000Z'
        message = @{
            id = 'release-smoke'; model = 'claude-sonnet-5-5'
            usage = @{ input_tokens = 1000; output_tokens = 500; cache_read_input_tokens = 0; cache_creation_input_tokens = 0 }
        }
    } | ConvertTo-Json -Compress -Depth 5 | Set-Content -LiteralPath (Join-Path $fixtureDir 'session.jsonl') -Encoding utf8

    & npm install --prefix $scratch $tarball --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Packed package installation failed' }
    $stdout = Join-Path $OutputDir 'npx-out.log'
    $stderr = Join-Path $OutputDir 'npx-err.log'
    $process = Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @(
        '-NoProfile', '-NonInteractive', '-File', ('"{0}"' -f $PSCommandPath),
        '-RunNpx', '-VerifyDir', ('"{0}"' -f $scratch)
    ) -WorkingDirectory $scratch -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

    $baseUrl = ''
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw "npx exited before readiness: $(Get-Content $stderr -Raw)" }
        $log = Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue
        if ($log -match 'http://localhost:\d+') { $baseUrl = $Matches[0]; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $baseUrl) { throw 'Server did not become ready within 20 seconds' }
    $page = Invoke-WebRequest -Uri $baseUrl -TimeoutSec 10
    $status = Invoke-RestMethod -Uri "$baseUrl/api/status" -TimeoutSec 10
    $usage = Invoke-RestMethod -Uri "$baseUrl/api/usage" -TimeoutSec 10
    if ($page.StatusCode -ne 200 -or $status.record_count -ne 1 -or $usage.total.input_tokens -ne 1000) {
        throw 'Packed server did not serve the isolated fixture correctly'
    }

    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited -or (Get-Content $stdout -Raw) -match 'NPX_RETURNED') { throw 'npx returned to the shell while the server was running' }
    $descendants = @(Get-Descendants $process.Id)
    $cli = @($descendants | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'cli\.cjs' })
    $server = @($descendants | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server[\\/]index\.js' })
    if ($cli.Count -ne 1 -or $server.Count -ne 1 -or $server[0].ParentProcessId -ne $cli[0].ProcessId) {
        throw 'CLI/server foreground process chain is invalid'
    }
    [ordered]@{
        version = $pack.version; integrity = $pack.integrity
        httpStatus = $page.StatusCode; records = $status.record_count
        parentAlive = $true; shellReturned = $false
        cliPid = $cli[0].ProcessId; serverPid = $server[0].ProcessId
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'verification.json') -Encoding utf8
    Write-Output "Verified $($pack.name)@$($pack.version): HTTP 200, isolated fixture, and npx foreground process chain"
}
finally {
    if ($process) {
        $ownedProcesses = @(Get-Descendants $process.Id)
        [array]::Reverse($ownedProcesses)
        foreach ($owned in $ownedProcesses) {
            $live = Get-CimInstance Win32_Process -Filter "ProcessId = $($owned.ProcessId)"
            if ($live -and $live.CommandLine -eq $owned.CommandLine) { Stop-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue }
        }
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
    if (Test-Path -LiteralPath $scratch) {
        $resolved = (Resolve-Path -LiteralPath $scratch).Path
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolved)).StartsWith('claude-dashboard-npx-')) { throw 'Unsafe cleanup target' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
