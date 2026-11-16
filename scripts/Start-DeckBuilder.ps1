param([ValidateRange(1,65535)][int]$Port=5173, [switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot
$url='http://localhost:'+ $Port
$script:server=$null
$script:borrowed=$false
$script:borrowedProcessId=0
$script:ready=$false
$script:phase='Idle'
$script:sessionLost=$false

try {
    Import-Module (Join-Path $PSScriptRoot 'DeckBuilderLauncher.psm1') -Force
} catch {
    Write-Host ('STATUS: Launcher files could not be loaded: '+$_.Exception.Message) -ForegroundColor Red
    exit 1
}

$created=$false
$mutex=[Threading.Mutex]::new($true,('Local\MTGDeckBuilderLauncher-'+$Port),[ref]$created)
if (-not $created) {
    Write-Host ('STATUS: Another launcher is already managing '+$url+'. Use that terminal window.')
    $mutex.Dispose()
    exit 0
}

function Write-Status([string]$Message,[ConsoleColor]$Color=[ConsoleColor]::Gray) {
    Write-Host ('STATUS: '+$Message) -ForegroundColor $Color
}

function Show-Menu {
    Write-Host ''
    Write-Host 'Commands: [O] open app  [S] stop  [R] start/restart  [L] logs  [Q] quit'
}

function Test-ActiveSessionIdentity {
    if (-not $script:ready) { return $true }
    try {
        if ($script:server) {
            $script:server.Process.Refresh()
            if ($script:server.Process.HasExited) { return $false }
            $state=Get-LauncherServer -ProjectRoot $projectRoot -Port $Port
            return ($state.Kind -eq 'Current' -and $state.ProcessId -eq $script:server.Process.Id)
        }
        if ($script:borrowed) {
            $state=Get-LauncherServer -ProjectRoot $projectRoot -Port $Port
            return ($state.Kind -eq 'Current' -and $state.ProcessId -eq $script:borrowedProcessId)
        }
    } catch { return $false }
    return $false
}

function Handle-SessionIdentityLoss {
    $script:ready=$false
    $script:phase='IdentityChanged'
    $script:sessionLost=$true
    Write-Status 'The server identity changed after startup. The app session was closed; any replacement server was left untouched.' Red
    if ($script:server) {
        try {
            $script:server.Process.Refresh()
            if (-not $script:server.Process.HasExited) {
                # This Process handle is the exact Node child launched by this terminal.
                $script:server.Process.Kill()
                $script:server.Process.WaitForExit(3000) | Out-Null
            }
        } catch { Write-Status 'The old launcher-owned process already exited.' Yellow }
        $script:server=$null
    }
    $script:borrowed=$false
    $script:borrowedProcessId=0
}

function Read-LauncherCommand {
    if ([Console]::IsInputRedirected) {
        $line=Read-Host 'Command'
        if (-not (Test-ActiveSessionIdentity)) {
            Handle-SessionIdentityLoss
            return $null
        }
        return $line
    }
    Write-Host 'Command (press O/S/R/L/Q): ' -NoNewline
    while ($true) {
        if (-not (Test-ActiveSessionIdentity)) {
            Handle-SessionIdentityLoss
            return $null
        }
        if ([Console]::KeyAvailable) {
            $key=[Console]::ReadKey($true)
            if ($key.KeyChar -eq "`r" -or $key.KeyChar -eq "`n" -or [char]::IsControl($key.KeyChar)) { continue }
            Write-Host $key.KeyChar
            return [string]$key.KeyChar
        }
        Start-Sleep -Milliseconds 250
    }
}

function Open-App {
    if ($script:ready -and -not (Test-ActiveSessionIdentity)) {
        Handle-SessionIdentityLoss
        return
    }
    if (-not $script:ready) {
        Write-Status 'The app is not ready. Use [R] to start it first.' Yellow
        return
    }
    if ($NoBrowser) {
        Write-Status 'Browser opening suppressed (-NoBrowser).' Cyan
        return
    }
    try {
        Start-Process $url
        if (-not (Test-ActiveSessionIdentity)) {
            Handle-SessionIdentityLoss
            return
        }
        Write-Status ('Opened '+$url) Green
    } catch {
        Write-Status ('Could not open the browser: '+$_.Exception.Message) Red
    }
}

function Show-LauncherLogs {
    if (-not $script:server) {
        if ($script:borrowed) {
            Write-Status 'This is a borrowed session; its owner controls its startup logs.' Yellow
        } else {
            Write-Status 'No launcher-owned server log is available yet.' Yellow
        }
        return
    }
    $path=$script:server.LogPath
    Write-Status ('Logs: '+$path) Cyan
    if (Test-Path $path -PathType Leaf) {
        Get-Content -Path $path -Tail 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host 'No error output has been written.'
    }
}

function Start-App {
    $script:ready=$false
    $script:phase='Starting'
    $environment=Get-LauncherEnvironment $projectRoot
    if (-not $environment.Ready) {
        $script:phase='Error'
        if ($environment.Kind -eq 'Dependencies') {
            Write-Status 'Dependencies are missing. To install, run npm ci --ignore-scripts in this folder after confirming the download.' Red
        } elseif ($environment.Kind -eq 'Node') {
            Write-Status 'Node.js was not found. Install Node.js LTS with npm, then relaunch. No installation was started.' Red
        } else {
            Write-Status $environment.Message Red
        }
        return $false
    }

    $state=Get-LauncherServer $projectRoot $Port
    if ($state.Kind -eq 'Legacy') {
        $legacyProcessId=[int]$state.ProcessId
        $legacyKind=[string]$state.Kind
        Write-Status ('An older ZIP copy is using '+$url+' (PID '+$legacyProcessId+').') Yellow
        Write-Host 'Switching will stop only that exact legacy process. Browser data at this address is unchanged.'
        $answer=Read-Host 'Type YES to stop the pinned legacy process and start this checkout'
        if ($answer -cne 'YES') {
            $script:phase='Idle'
            Write-Status 'Legacy server left untouched; start cancelled.' Yellow
            return $false
        }
        Stop-LauncherServer -ProjectRoot $projectRoot -Port $Port -ExpectedProcessId $legacyProcessId -ExpectedKind $legacyKind | Out-Null
        $state=Get-LauncherServer $projectRoot $Port
        if ($state.Kind -ne 'Free') {
            throw 'The confirmed legacy listener changed or another process took the address. Nothing else was stopped.'
        }
    }
    if ($state.Kind -eq 'Foreign') {
        $script:phase='Error'
        Write-Status ('Another application is using '+$url+'. Close that application or free port '+$Port+', then press [R]. Nothing was stopped.') Red
        return $false
    }

    $script:borrowed=($state.Kind -eq 'Current')
    if ($script:borrowed) {
        $script:borrowedProcessId=[int]$state.ProcessId
        Write-Status ('Borrowing the current checkout already running at '+$url+' (PID '+$state.ProcessId+'). This launcher will not stop it.') Cyan
    } else {
        $script:borrowedProcessId=0
        $script:server=Start-LauncherServer -ProjectRoot $projectRoot -Port $Port
        Write-Status ('Starting the current checkout (owned server PID '+$script:server.Process.Id+').') Cyan
    }

    $clock=[Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 30) {
        if ($script:server) {
            $script:server.Process.Refresh()
            if ($script:server.Process.HasExited) {
                $script:phase='Error'
                Write-Status ('The server exited before readiness. Use [L] for logs: '+$script:server.LogPath) Red
                return $false
            }
        }
        if (Test-LauncherReady -Port $Port) {
            $script:ready=$true
            $script:phase='Ready'
            Write-Host ('READY: '+$url) -ForegroundColor Green
            Write-Status 'Ready. Existing browser data at this exact localhost address is preserved.' Green
            Open-App
            if ($script:sessionLost -or -not (Test-ActiveSessionIdentity)) {
                if (-not $script:sessionLost) { Handle-SessionIdentityLoss }
                return $false
            }
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    $script:phase='Error'
    if ($script:server) {
        Write-Status ('Startup timed out. Use [S] to stop this owned server, or [L] for logs: '+$script:server.LogPath) Red
    } else {
        Write-Status 'The current listener did not become ready within 30 seconds. It remains borrowed and will not be stopped.' Red
    }
    return $false
}

function Stop-App {
    if ($script:borrowed) {
        Write-Status 'This server belongs to another launcher. It remains running; this launcher will not stop borrowed sessions.' Yellow
        return
    }
    if (-not $script:server) {
        $script:ready=$false
        $script:phase='Idle'
        Write-Status 'No launcher-owned server is running.' Yellow
        return
    }
    $expectedProcessId=[int]$script:server.Process.Id
    Stop-LauncherServer -ProjectRoot $projectRoot -Port $Port -ExpectedProcessId $expectedProcessId -ExpectedKind Current | Out-Null
    $script:server=$null
    $script:ready=$false
    $script:phase='Idle'
    Write-Status 'Stopped the launcher-owned server. The port is free.' Green
}

function Restart-App {
    if ($script:borrowed) {
        Write-Status 'Cannot restart a borrowed session. Its owner must stop it; this launcher will not terminate it.' Yellow
        return
    }
    if ($script:server) {
        Stop-App
    }
    [void](Start-App)
}

Write-Host 'MTG Deck Builder - terminal launcher' -ForegroundColor Cyan
Write-Host ('Application: '+$projectRoot)
Write-Host ('Address:     '+$url+' (same browser origin and IndexedDB)')
Write-Host 'Keep this terminal open while using the app. Quit or close stops only a server this launcher started.'

try {
    try { [void](Start-App) } catch { $script:phase='Error';Write-Status $_.Exception.Message Red }
    while (-not $script:sessionLost) {
        Show-Menu
        $choice=Read-LauncherCommand
        if ($null -eq $choice) { break }
        if ($script:sessionLost) { break }
        switch ($choice.Trim().ToUpperInvariant()) {
            'O' { Open-App }
            'S' { try { Stop-App } catch { Write-Status $_.Exception.Message Red } }
            'R' { try { Restart-App } catch { Write-Status $_.Exception.Message Red } }
            'L' { Show-LauncherLogs }
            'Q' { break }
            '' { }
            default { Write-Status 'Use O, S, R, L, or Q.' Yellow }
        }
        if ($choice.Trim().ToUpperInvariant() -eq 'Q') { break }
    }
} finally {
    if ($script:server) {
        try {
            $expectedProcessId=[int]$script:server.Process.Id
            Stop-LauncherServer -ProjectRoot $projectRoot -Port $Port -ExpectedProcessId $expectedProcessId -ExpectedKind Current | Out-Null
            Write-Status 'Stopped the launcher-owned server on exit.' Green
        } catch {
            Write-Status ('Could not safely stop the owned server: '+$_.Exception.Message) Red
        }
        $script:server=$null
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
