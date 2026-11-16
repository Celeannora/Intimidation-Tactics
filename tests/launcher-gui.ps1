$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$entry=Join-Path $root 'scripts\Start-DeckBuilder.ps1'
$module=Join-Path $root 'scripts\DeckBuilderLauncher.psm1'
if (-not (Test-Path $entry)) { throw 'Missing terminal launcher' }
Import-Module $module -Force
$environment=Get-LauncherEnvironment $root
if (-not $environment.Ready) { throw ('Terminal acceptance requires existing Node dependencies: '+$environment.Message+' (no installation is performed)') }
$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();$port=$l.LocalEndpoint.Port;$l.Stop()
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
public sealed class TerminalLauncherChild : IDisposable {
  private readonly object gate = new object();
  private readonly List<string> lines = new List<string>();
  public readonly Process Process;
  public TerminalLauncherChild(string file, string arguments, string cwd) {
    var start = new ProcessStartInfo(file, arguments) { UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true, RedirectStandardOutput=true, RedirectStandardError=true, WorkingDirectory=cwd };
    Process = new Process { StartInfo=start, EnableRaisingEvents=true };
    Process.OutputDataReceived += (s,e) => Add(e.Data);
    Process.ErrorDataReceived += (s,e) => Add("STDERR: " + e.Data);
    Process.Start(); Process.BeginOutputReadLine(); Process.BeginErrorReadLine();
  }
  private void Add(string line) { if (line == null) return; lock(gate) { lines.Add(line); if(lines.Count>500) lines.RemoveAt(0); } }
  public string Output { get { lock(gate) return String.Join(Environment.NewLine, lines); } }
  public int Count(string text) { lock(gate) return lines.Count(x=>x.IndexOf(text,StringComparison.OrdinalIgnoreCase)>=0); }
  public bool WaitFor(string text, int seconds) { var timer=Stopwatch.StartNew(); do { lock(gate) if(lines.Any(x=>x.IndexOf(text,StringComparison.OrdinalIgnoreCase)>=0)) return true; if(Process.HasExited) return false; Thread.Sleep(40); } while(timer.Elapsed.TotalSeconds<seconds); return false; }
  public bool WaitForCount(string text, int count, int seconds) { var timer=Stopwatch.StartNew(); do { if(Count(text)>=count) return true; if(Process.HasExited) return false; Thread.Sleep(40); } while(timer.Elapsed.TotalSeconds<seconds); return false; }
  public void Send(string line) { Process.StandardInput.WriteLine(line); Process.StandardInput.Flush(); }
  public void Dispose() { try { if(!Process.HasExited) { Process.StandardInput.WriteLine("Q"); Process.StandardInput.Flush(); Process.WaitForExit(10000); } } catch {} if(!Process.HasExited) Process.Kill(); Process.Dispose(); }
}
'@
$child=$null
$borrowedChild=$null
$borrowedServer=$null
try {
    $args='-NoProfile -ExecutionPolicy Bypass -File "'+$entry+'" -Port '+$port+' -NoBrowser'
    $child=[TerminalLauncherChild]::new((Get-Command powershell.exe).Source,$args,$root)
    if (-not $child.WaitFor('READY: http://localhost:'+ $port,35)) { throw ('Automatic startup did not become ready. Child output: '+$child.Output) }
    if (-not $child.WaitFor('[O] open app',5)) { throw ('The terminal menu is incomplete: '+$child.Output) }
    if ($child.Output -notmatch '(?i)\[S\] stop' -or $child.Output -notmatch '(?i)\[R\] start/restart' -or $child.Output -notmatch '(?i)\[L\] logs' -or $child.Output -notmatch '(?i)\[Q\] quit') { throw ('The terminal menu is incomplete: '+$child.Output) }
    $first=Get-LauncherServer $root $port
    if ($first.Kind -ne 'Current') { $raw=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess);$procs=@($raw|ForEach-Object {Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.OwningProcess)}|Select-Object ProcessId,CommandLine);throw ('Automatic start was not the current checkout: kind='+$first.Kind+' childPid='+$child.Output+' listeners='+($raw|ConvertTo-Json -Compress)+' processes='+($procs|ConvertTo-Json -Compress)) }
    $child.Send('O')
    if (-not $child.WaitFor('STATUS: Browser opening suppressed',5)) { throw ('Open command did not report status: '+$child.Output) }
    $child.Send('S')
    if (-not $child.WaitFor('STATUS: Stopped',10)) { throw ('Stop command did not report stopped: '+$child.Output) }
    if ((Get-LauncherServer $root $port).Kind -ne 'Free') { throw 'Stop command left the owned server listening' }
    $child.Send('R')
    if (-not $child.WaitForCount('READY: http://localhost:'+ $port,2,35)) { throw ('Restart command did not become ready: '+$child.Output) }
    $restart=Get-LauncherServer $root $port
    if ($restart.Kind -ne 'Current') { throw ('Restart did not run the current checkout: '+$restart.Kind) }
    $child.Send('L')
    if (-not $child.WaitFor('STATUS: Logs:',5)) { throw ('Logs command did not report its log path: '+$child.Output) }
    $child.Send('Q')
    if (-not $child.Process.WaitForExit(15000)) { throw 'Quit command did not exit the launcher' }
    if ((Get-LauncherServer $root $port).Kind -ne 'Free') { throw 'Quit left the launcher-owned server listening' }
    $monitorChild=$null
    $replacement=$null
    try {
        $args='-NoProfile -ExecutionPolicy Bypass -File "'+$entry+'" -Port '+$port+' -NoBrowser'
        $monitorChild=[TerminalLauncherChild]::new((Get-Command powershell.exe).Source,$args,$root)
        if(-not $monitorChild.WaitFor('READY: http://localhost:'+ $port,35)){throw ('Monitor test startup did not become ready: '+$monitorChild.Output)}
        $original=Get-LauncherServer $root $port
        if($original.Kind -ne 'Current'){throw 'Monitor test positive control was not the current checkout'}
        Stop-Process -Id $original.ProcessId -ErrorAction Stop
        $replacement=Start-LauncherServer -ProjectRoot $root -Port $port
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while(-not (Test-LauncherReady -Port $port)){if($clock.Elapsed.TotalSeconds -gt 20){throw 'Replacement listener positive control did not become ready'};Start-Sleep -Milliseconds 100}
        $replacementState=Get-LauncherServer $root $port
        if($replacementState.Kind -ne 'Current' -or $replacementState.ProcessId -ne $replacement.Process.Id){throw 'Replacement listener positive control identity mismatch'}
        $monitorChild.Send('O')
        if(-not $monitorChild.Process.WaitForExit(3000)){throw 'Terminal did not reject the menu command after its listener PID was replaced'}
        if($monitorChild.Output -notmatch '(?i)(changed|replaced).*(listener|session)|(listener|session).*(changed|replaced)'){throw ('Missing replacement notice: '+$monitorChild.Output)}
        $replacementState=Get-LauncherServer $root $port
        if($replacementState.Kind -ne 'Current' -or $replacementState.ProcessId -ne $replacement.Process.Id){throw 'Terminal stopped the replacement listener'}
    } finally {
        if($monitorChild){$monitorChild.Dispose()}
        if($replacement){$state=Get-LauncherServer $root $port;if($state.Kind -eq 'Current' -and $state.ProcessId -eq $replacement.Process.Id){Stop-LauncherServer -ProjectRoot $root -Port $port -ExpectedProcessId $replacement.Process.Id -ExpectedKind Current | Out-Null}}
    }
    $borrowedServer=Start-LauncherServer -ProjectRoot $root -Port $port
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-LauncherReady -Port $port)) { if ($clock.Elapsed.TotalSeconds -gt 20) { throw 'Borrowed-session positive control did not become ready' };Start-Sleep -Milliseconds 100 }
    $args='-NoProfile -ExecutionPolicy Bypass -File "'+$entry+'" -Port '+$port+' -NoBrowser'
    $borrowedChild=[TerminalLauncherChild]::new((Get-Command powershell.exe).Source,$args,$root)
    if (-not $borrowedChild.WaitFor('Borrowing the current checkout',35)) { throw ('Launcher did not borrow the current session: '+$borrowedChild.Output) }
    $borrowedState=Get-LauncherServer $root $port
    if ($borrowedState.Kind -ne 'Current' -or $borrowedState.ProcessId -ne $borrowedServer.Process.Id) { throw 'Borrowed-session positive control changed identity' }
    $borrowedChild.Send('S')
    if (-not $borrowedChild.WaitFor('will not stop borrowed sessions',5)) { throw ('Stop did not preserve borrowed server: '+$borrowedChild.Output) }
    $borrowedState=Get-LauncherServer $root $port
    if ($borrowedState.Kind -ne 'Current' -or $borrowedState.ProcessId -ne $borrowedServer.Process.Id) { throw 'Stop command changed the borrowed listener' }
    $borrowedChild.Send('R')
    if (-not $borrowedChild.WaitFor('Cannot restart a borrowed session',5)) { throw ('Restart did not refuse a borrowed server: '+$borrowedChild.Output) }
    $borrowedChild.Send('Q')
    if (-not $borrowedChild.Process.WaitForExit(10000)) { throw 'Quit command did not exit the borrowed-session launcher' }
    $borrowedState=Get-LauncherServer $root $port
    if ($borrowedState.Kind -ne 'Current' -or $borrowedState.ProcessId -ne $borrowedServer.Process.Id) { throw 'Quit stopped or replaced a borrowed session' }
    Stop-LauncherServer -ProjectRoot $root -Port $port -ExpectedProcessId $borrowedServer.Process.Id -ExpectedKind Current | Out-Null
    $output=$child.Output+"`n--- BORROWED SESSION ---`n"+$borrowedChild.Output
    if ($output.Length -gt 50000) { throw 'Terminal output exceeded the 50 KB acceptance bound' }
    [pscustomobject]@{automaticStart=$true;menuCommands=@('O','S','R','L','Q');openNoBrowser=$true;stopReleasesOwnedServer=$true;restartCurrentCheckout=$true;quitStopsOwnedServer=$true;borrowedStopRestartAndQuitPreserveServer=$true;port=$port;output=$output} | ConvertTo-Json -Compress
} finally {
    if ($child) { $child.Dispose() }
    if ($borrowedChild) { $borrowedChild.Dispose() }
    if ($borrowedServer) {
        $state=Get-LauncherServer $root $port
        if ($state.Kind -eq 'Current' -and $state.ProcessId -eq $borrowedServer.Process.Id) { Stop-LauncherServer -ProjectRoot $root -Port $port -ExpectedProcessId $borrowedServer.Process.Id -ExpectedKind Current | Out-Null }
    }
}
