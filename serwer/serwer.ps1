# Serwer symulatora ATtiny24
# - udostepnia aplikacje (folder "aplikacja") pod adresem http://localhost:PORT/
# - kompiluje programy dolaczonym kompilatorem avr-gcc 7.3.0 (folder "kompilator"),
#   tymi samymi flagami co PlatformIO (board = attiny24, framework = arduino)
# Wymaga tylko Windows PowerShell 5.1 (jest w kazdym Windows 10/11).

param([switch]$NoBrowser, [int]$Port = 8024)

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$app = Join-Path $base 'aplikacja'
$bin = Join-Path $base 'kompilator\bin'
$ard = Join-Path $base 'arduino'
$utf8 = New-Object System.Text.UTF8Encoding $false

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.txt' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'
}

function Quote([string]$a) {
  if ($a -match '[\s"]') { return '"' + ($a -replace '"', '\"') + '"' }
  return $a
}

function Run-Tool([string]$exe, [string[]]$argv, [string]$cwd) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $bin $exe
  $psi.Arguments = ($argv | ForEach-Object { Quote $_ }) -join ' '
  $psi.WorkingDirectory = $cwd
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  $p.WaitForExit()
  return @{ code = $p.ExitCode; out = $out.Result; err = $err.Result; cmd = "$exe " + $psi.Arguments }
}

# folder roboczy kompilacji; avr-gcc 7 zle znosi znaki spoza ASCII w sciezkach
$tempRoot = $env:TEMP
if ($tempRoot -match '[^\x00-\x7F]') { $tempRoot = $env:PUBLIC }

function Compile($req) {
  $work = Join-Path $tempRoot ('symulator-attiny24\' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $res = @{ ok = $false; steps = @(); hex = ''; eep = ''; size = ''; nm = ''; lines = ''; lst = '' }
  try {
    $fcpu = [string]$req.fcpu
    if (-not $fcpu) { $fcpu = '8000000' }
    $mode = [string]$req.mode
    $common = @('-mmcu=attiny24', '-Os', '-Wall', '-ffunction-sections', '-fdata-sections', '-g')
    $cxx = @('-fno-exceptions', '-fno-threadsafe-statics', '-fpermissive', '-std=gnu++11', '-flto')

    if ($mode -eq 'basic') {
      [System.IO.File]::WriteAllText((Join-Path $work 'program.bas'), [string]$req.source, $utf8)
      [System.IO.File]::WriteAllText((Join-Path $work 'program.c'), [string]$req.csource, $utf8)
      $c = @('-c') + $common + @('-std=gnu11', '-Wno-unused-label', '-Wno-unused-variable', '-Wno-unused-but-set-variable', "-DF_CPU=${fcpu}UL", 'program.c', '-o', 'program.o')
      $l = @('-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-o', 'firmware.elf', 'program.o', '-lm')
      $tool = 'avr-gcc.exe'
    } elseif ($mode -eq 'cpp') {
      [System.IO.File]::WriteAllText((Join-Path $work 'main.cpp'), [string]$req.source, $utf8)
      $c = @('-c') + $cxx + $common + @("-DF_CPU=${fcpu}L", 'main.cpp', '-o', 'main.o')
      $l = @('-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-flto', '-fuse-linker-plugin', '-o', 'firmware.elf', 'main.o', '-lm')
      $tool = 'avr-g++.exe'
    } else {
      [System.IO.File]::WriteAllText((Join-Path $work 'main.cpp'), [string]$req.source, $utf8)
      $c = @('-c') + $cxx + $common + @('-DPLATFORMIO=60200', '-DARDUINO_AVR_ATTINYX4', "-DF_CPU=${fcpu}L", '-DARDUINO_ARCH_AVR',
        '-DARDUINO=10808', '-DCLOCK_SOURCE=0', '-DNEOPIXELPORT=PORTA', "-I$ard\core", "-I$ard\variant", 'main.cpp', '-o', 'main.o')
      $l = @('-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-flto', '-fuse-linker-plugin', '-o', 'firmware.elf', 'main.o',
        "-L$ard", '-Wl,--start-group', '-lFrameworkArduino', '-lm', '-Wl,--end-group')
      $tool = 'avr-g++.exe'
    }

    $r = Run-Tool $tool $c $work
    $res.steps += @{ name = 'kompilacja'; code = $r.code; out = $r.out + $r.err; cmd = $r.cmd }
    if ($r.code -ne 0) { return $res }
    $r = Run-Tool $tool $l $work
    $res.steps += @{ name = 'linkowanie'; code = $r.code; out = $r.out + $r.err; cmd = $r.cmd }
    if ($r.code -ne 0) { return $res }

    Run-Tool 'avr-objcopy.exe' @('-O', 'ihex', '-R', '.eeprom', 'firmware.elf', 'firmware.hex') $work | Out-Null
    Run-Tool 'avr-objcopy.exe' @('-O', 'ihex', '-j', '.eeprom', '--set-section-flags=.eeprom=alloc,load', '--no-change-warnings',
      '--change-section-lma', '.eeprom=0', 'firmware.elf', 'firmware.eep') $work | Out-Null
    $res.hex = [System.IO.File]::ReadAllText((Join-Path $work 'firmware.hex'))
    $eepPath = Join-Path $work 'firmware.eep'
    if (Test-Path $eepPath) { $res.eep = [System.IO.File]::ReadAllText($eepPath) }
    $res.size = (Run-Tool 'avr-size.exe' @('-A', 'firmware.elf') $work).out
    $res.nm = (Run-Tool 'avr-nm.exe' @('-S', '-n', '-C', 'firmware.elf') $work).out
    $res.lines = (Run-Tool 'avr-objdump.exe' @('--dwarf=decodedline', 'firmware.elf') $work).out
    $res.lst = (Run-Tool 'avr-objdump.exe' @('-d', '-S', '-C', 'firmware.elf') $work).out
    $res.ok = $true
    return $res
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
}

# gotowy plik z zewnatrz (PlatformIO, BASCOM): kind = 'elf' albo 'hex', data = base64
function Analyze($req) {
  $work = Join-Path $tempRoot ('symulator-attiny24\' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $res = @{ ok = $false; hex = ''; eep = ''; size = ''; nm = ''; lines = ''; lst = '' }
  try {
    $bytes = [Convert]::FromBase64String([string]$req.data)
    if ([string]$req.kind -eq 'elf') {
      [System.IO.File]::WriteAllBytes((Join-Path $work 'firmware.elf'), $bytes)
      Run-Tool 'avr-objcopy.exe' @('-O', 'ihex', '-R', '.eeprom', 'firmware.elf', 'firmware.hex') $work | Out-Null
      Run-Tool 'avr-objcopy.exe' @('-O', 'ihex', '-j', '.eeprom', '--set-section-flags=.eeprom=alloc,load', '--no-change-warnings',
        '--change-section-lma', '.eeprom=0', 'firmware.elf', 'firmware.eep') $work | Out-Null
      $res.hex = [System.IO.File]::ReadAllText((Join-Path $work 'firmware.hex'))
      $eepPath = Join-Path $work 'firmware.eep'
      if (Test-Path $eepPath) { $res.eep = [System.IO.File]::ReadAllText($eepPath) }
      $res.size = (Run-Tool 'avr-size.exe' @('-A', 'firmware.elf') $work).out
      $res.nm = (Run-Tool 'avr-nm.exe' @('-S', '-n', '-C', 'firmware.elf') $work).out
      $res.lines = (Run-Tool 'avr-objdump.exe' @('--dwarf=decodedline', 'firmware.elf') $work).out
      $res.lst = (Run-Tool 'avr-objdump.exe' @('-d', '-S', '-C', 'firmware.elf') $work).out
    } else {
      [System.IO.File]::WriteAllBytes((Join-Path $work 'firmware.hex'), $bytes)
      $res.hex = [System.Text.Encoding]::ASCII.GetString($bytes)
      $res.lst = (Run-Tool 'avr-objdump.exe' @('-D', '-m', 'avr25', '-b', 'ihex', 'firmware.hex') $work).out
    }
    $res.ok = $true
    return $res
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
}

function Send($ctx, [int]$status, [string]$type, [byte[]]$bytes) {
  $resp = $ctx.Response
  $resp.StatusCode = $status
  $resp.ContentType = $type
  $resp.Headers.Add('Cache-Control', 'no-store')
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.Close()
}

function Send-Json($ctx, $obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 6 -Compress
  Send $ctx 200 'application/json; charset=utf-8' $utf8.GetBytes($json)
}

# --- start serwera na pierwszym wolnym porcie
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}
if (-not $listener) { Write-Host 'Nie udalo sie uruchomic serwera (zajete porty).'; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Symulator ATtiny24 - stanowisko LTM' -ForegroundColor Cyan
Write-Host "  Adres: $url" -ForegroundColor Green
Write-Host '  Zamkniecie tego okna wylacza symulator.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
  try {
    if ($path -eq '/api/ping') {
      Send-Json $ctx @{ ok = $true; kompilator = 'avr-gcc 7.3.0'; port = $Port }
    } elseif ($path -eq '/api/analyze' -and $req.HttpMethod -eq 'POST') {
      $reader = New-Object System.IO.StreamReader($req.InputStream, $utf8)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      $res = Analyze $body
      Write-Host ("  [{0}] gotowy plik ({1})" -f (Get-Date -Format 'HH:mm:ss'), $body.kind)
      Send-Json $ctx $res
    } elseif ($path -eq '/api/compile' -and $req.HttpMethod -eq 'POST') {
      $reader = New-Object System.IO.StreamReader($req.InputStream, $utf8)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      $t0 = Get-Date
      $res = Compile $body
      $ms = [int]((Get-Date) - $t0).TotalMilliseconds
      $res.ms = $ms
      $status = 'blad'
      if ($res.ok) { $status = 'OK' }
      Write-Host ("  [{0}] kompilacja ({1}) - {2}, {3} ms" -f (Get-Date -Format 'HH:mm:ss'), $body.mode, $status, $ms)
      Send-Json $ctx $res
    } else {
      $rel = $path.TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $app $rel))
      if (-not $full.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        Send $ctx 404 'text/plain; charset=utf-8' $utf8.GetBytes('404')
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        Send $ctx 200 $type ([System.IO.File]::ReadAllBytes($full))
      }
    }
  } catch {
    Write-Host ("  Blad: " + $_.Exception.Message) -ForegroundColor Red
    try { Send $ctx 500 'text/plain; charset=utf-8' $utf8.GetBytes($_.Exception.Message) } catch { }
  }
}
