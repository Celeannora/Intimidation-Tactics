Set-StrictMode -Version Latest

function Get-LauncherEnvironment {
    param([Parameter(Mandatory)][string]$ProjectRoot)
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
    $npm = if ($node) { Join-Path (Split-Path $node.Source) 'node_modules\npm\bin\npm-cli.js' } else { '' }
    $kind = 'Ready'; $message = 'Ready to start.'
    if (-not (Test-Path (Join-Path $root 'package.json') -PathType Leaf)) { $kind='Folder'; $message='The application folder is missing. Keep the launcher with the app files.' }
    elseif (-not $node) { $kind='Node'; $message='Node.js is not installed. Install Node.js LTS, then reopen this launcher.' }
    elseif (-not (Test-Path $vite -PathType Leaf)) { $kind='Dependencies'; $message='First-time setup needed. Click Install required files (internet connection needed).' }
    [pscustomobject]@{ Ready=($kind -eq 'Ready'); Kind=$kind; Message=$message; ProjectRoot=$root; NodePath=$(if($node){$node.Source}else{''}); VitePath=$vite; NpmPath=$npm }
}
function Get-ServerKind {
    param([string]$CommandLine, [string]$ProjectRoot, [int]$Port=5173)
    if ($CommandLine -notmatch ('(?i)(?:^|\s)--port(?:\s+|=)' + $Port + '(?:\s|$)')) { return 'Foreign' }
    $m = [regex]::Match($CommandLine, '(?i)^\s*(?:"[^"]*node(?:\.exe)?"|[^\s"]*node(?:\.exe)?)\s+(?:"(?<p>[A-Z]:[^"]*?[\\/]vite[\\/]bin[\\/]vite\.js)"|(?<p>[A-Z]:[^\s"]*?[\\/]vite[\\/]bin[\\/]vite\.js))(?:\s|$)')
    if (-not $m.Success) { return 'Foreign' }
    $path = [IO.Path]::GetFullPath($m.Groups['p'].Value.Replace('/','\'))
    $current = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'))
    $legacyRoot = Join-Path (Split-Path $ProjectRoot) 'Intimidation-Tactics-main\Intimidation-Tactics-main'
    $legacy = [IO.Path]::GetFullPath((Join-Path $legacyRoot 'node_modules\vite\bin\vite.js'))
    $kind = if ($path -ieq $current) { 'Current' } elseif ($path -ieq $legacy) { 'Legacy' } else { return 'Foreign' }
    $expectedRoot = if ($kind -eq 'Current') { [IO.Path]::GetFullPath($ProjectRoot) } else { [IO.Path]::GetFullPath($legacyRoot) }
    # Accept only our known CLI shape; root/config overrides and extra positionals are not proof.
    $tail = $CommandLine.Substring($m.Length).Trim()
    $cli = [regex]::Match($tail, '^(?:"(?<root>[A-Za-z]:[^"]+)"\s+|(?<root>[A-Za-z]:[^\s"]+)\s+)?--host\s+localhost\s+--port\s+'+$Port+'\s+--strictPort\s*$')
    if (-not $cli.Success) { return 'Foreign' }
    if ($cli.Groups['root'].Success) {
        try { if ([IO.Path]::GetFullPath($cli.Groups['root'].Value) -ine $expectedRoot) { return 'Foreign' } } catch { return 'Foreign' }
    } else {
        # Old ZIP launchers have no root argument. Authenticate the actual transformed source,
        # never the Vite executable location or an unknown process working directory.
        if ((Get-LauncherSourceRoot $Port) -ine $expectedRoot) { return 'Foreign' }
    }
    return $kind
}
function Get-LauncherSourceRoot {
    param([ValidateRange(1,65535)][int]$Port)
    $response=$null; $reader=$null
    try {
        $request=[Net.HttpWebRequest]::Create(('http://localhost:'+$Port+'/src/App.tsx'))
        $request.Proxy=$null; $request.AllowAutoRedirect=$false; $request.Timeout=800; $request.ReadWriteTimeout=800
        $response=$request.GetResponse()
        if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 1048576) { return $null }
        $reader=[IO.StreamReader]::new($response.GetResponseStream())
        $buffer=New-Object char[] 1048577
        $read=$reader.ReadBlockAsync($buffer,0,$buffer.Length)
        if (-not $read.Wait(800)) { $request.Abort(); return $null }
        $count=$read.Result
        if ($count -ge $buffer.Length) { return $null }
        $text=[string]::new($buffer,0,$count)
        $matches=[regex]::Matches($text, '(?:_jsxFileName\s*=|fileName\s*:)\s*("(?:[^"\\]|\\.)*")')
        $sources=@($matches | ForEach-Object { $_.Groups[1].Value | ConvertFrom-Json } | Select-Object -Unique)
        if ($sources.Count -ne 1) { return $null }
        $source=$sources[0]
        if ($source -notmatch '^[A-Za-z]:[\\/].*[\\/]src[\\/]App\.tsx$') { return $null }
        return [IO.Path]::GetFullPath((Split-Path (Split-Path $source)))
    } catch { return $null }
    finally { if ($reader) { $reader.Dispose() }; if ($response) { $response.Close() } }
}
function Get-LauncherServer {
    param([string]$ProjectRoot, [ValidateRange(1,65535)][int]$Port=5173)
    $active = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $Port)
    if ($active.Count -eq 0) { return [pscustomobject]@{Kind='Free';ProcessId=0;CommandLine=''} }
    try {
        $ids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($ids.Count -ne 1) { throw 'Ambiguous listener' }
        $p = Get-CimInstance Win32_Process -Filter ('ProcessId='+$ids[0]) -ErrorAction Stop
        if ($p.Name -ine 'node.exe' -or -not $p.CommandLine) { throw 'Cannot verify a Node listener' }
        return [pscustomobject]@{Kind=(Get-ServerKind $p.CommandLine $ProjectRoot $Port);ProcessId=[int]$p.ProcessId;CommandLine=$p.CommandLine}
    } catch { return [pscustomobject]@{Kind='Foreign';ProcessId=0;CommandLine=''} }
}
function Start-LauncherServer {
    param([string]$ProjectRoot, [ValidateRange(1,65535)][int]$Port=5173)
    $env = Get-LauncherEnvironment $ProjectRoot
    if (-not $env.Ready) { throw $env.Message }
    if ((Get-LauncherServer $ProjectRoot $Port).Kind -ne 'Free') { throw 'The application address is already in use. No other process was stopped.' }
    $logs = Join-Path $env.ProjectRoot '.hermes\launcher\logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $name = [Guid]::NewGuid().ToString('N')
    $stdout = Join-Path $logs ($name+'.out.log'); $stderr = Join-Path $logs ($name+'.err.log')
    $args = '"'+$env.VitePath+'" "'+$env.ProjectRoot+'" --host localhost --port '+$Port+' --strictPort'
    $p = Start-Process -FilePath $env.NodePath -ArgumentList $args -WorkingDirectory $env.ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    [pscustomobject]@{Process=$p;LogPath=$stderr;OutputPath=$stdout}
}
function Test-LauncherReady {
    param([ValidateRange(1,65535)][int]$Port=5173)
    try {
        $request = [Net.HttpWebRequest]::Create(('http://localhost:'+$Port+'/'))
        $request.Proxy=$null; $request.Timeout=500; $request.AllowAutoRedirect=$false
        $response=$request.GetResponse()
        try { return [int]$response.StatusCode -eq 200 } finally { $response.Close() }
    } catch { return $false }
}
function Stop-LauncherServer {
    param([string]$ProjectRoot, [ValidateRange(1,65535)][int]$Port=5173, [Parameter(Mandatory)][int]$ExpectedProcessId, [ValidateSet('Current','Legacy')][string]$ExpectedKind='Current')
    $state = Get-LauncherServer $ProjectRoot $Port
    if ($state.Kind -eq 'Free') {
        if ($ExpectedKind -eq 'Legacy') { throw 'The confirmed legacy listener changed or stopped.' }
        $pending = Get-CimInstance Win32_Process -Filter ('ProcessId='+$ExpectedProcessId) -ErrorAction SilentlyContinue
        if (-not $pending) { return $true }
        $kind = Get-ServerKind $pending.CommandLine $ProjectRoot $Port
        if ($pending.Name -ine 'node.exe' -or ($kind -ne $ExpectedKind)) { throw 'Refusing to stop an unrelated startup process.' }
        Stop-Process -Id $ExpectedProcessId -ErrorAction Stop
        return $true
    }
    if ($state.ProcessId -ne $ExpectedProcessId -or ($state.Kind -ne $ExpectedKind)) { throw 'Refusing to stop an unrelated or changed application.' }
    Stop-Process -Id $ExpectedProcessId -ErrorAction Stop
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while ((Get-LauncherServer $ProjectRoot $Port).Kind -ne 'Free') {
        if ($clock.Elapsed.TotalSeconds -gt 5) { throw 'The previous application has not stopped. Close its window and try again.' }
        Start-Sleep -Milliseconds 100
    }
    return $true
}
Export-ModuleMember -Function Get-LauncherEnvironment,Get-ServerKind,Get-LauncherServer,Start-LauncherServer,Test-LauncherReady,Stop-LauncherServer
