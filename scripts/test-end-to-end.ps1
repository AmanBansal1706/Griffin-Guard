$ErrorActionPreference = "Stop"

Write-Host "=== ViperGo local e2e test ==="

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python not found in PATH"
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  throw "go not found in PATH"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm not found in PATH"
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = "$root/var/logs/e2e"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Start-ServiceProcess([string]$name, [string]$file, [string]$arguments, [string]$workingDir) {
  $runId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $outLog = Join-Path $logDir "$name.$runId.out.log"
  $errLog = Join-Path $logDir "$name.$runId.err.log"
  $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workingDir -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  $p | Add-Member -NotePropertyName StdOutLog -NotePropertyValue $outLog
  $p | Add-Member -NotePropertyName StdErrLog -NotePropertyValue $errLog
  return $p
}

function Stop-PortProcess([int]$port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

Stop-PortProcess -port 8080
Stop-PortProcess -port 9000
Stop-PortProcess -port 9100

# Start mock inference service
$inference = Start-ServiceProcess -name "mock-inference" -file "python" -arguments "services/mock-inference/server.py" -workingDir $root
Start-Sleep -Seconds 1

# Start mock llm upstream
$mockLlm = Start-ServiceProcess -name "mock-llm" -file "python" -arguments "services/mock-llm/server.py" -workingDir $root
Start-Sleep -Seconds 1

# Configure proxy env
$env:VIPER_UPSTREAM_URL = "http://127.0.0.1:9100"
$env:VIPER_LOG_SINK = "local"
$env:VIPER_LOCAL_LOG_PATH = "$root/var/logs/events.local.jsonl"
$env:VIPER_MODEL_PATH = "$root/apps/viper-proxy/models/distilbert.onnx"
$env:VIPER_ONNX_ENDPOINT = "http://127.0.0.1:9000/infer"
$env:VIPER_SCANNER_FAIL_OPEN = "true"
$env:VIPER_STREAM_TERMINATE_ON_LEAK = "false"
$env:VIPER_WAL_PATH = "$root/var/logs/viper.wal"

# Ensure model file exists for startup check
New-Item -ItemType Directory -Force -Path "$root/apps/viper-proxy/models" | Out-Null
if (-not (Test-Path "$root/apps/viper-proxy/models/distilbert.onnx")) {
  New-Item -ItemType File -Path "$root/apps/viper-proxy/models/distilbert.onnx" | Out-Null
}

# Start proxy
$proxy = Start-ServiceProcess -name "viper-proxy" -file "go" -arguments "run ./cmd/viper-proxy" -workingDir "$root/apps/viper-proxy"

function Wait-HttpReady([string]$url, [int]$timeoutSec = 40) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }
  return $false
}

try {
  if (-not (Wait-HttpReady -url "http://127.0.0.1:9000/healthz" -timeoutSec 20)) {
    if ($inference.HasExited) {
      $stderr = Get-Content -Path $inference.StdErrLog -Raw -ErrorAction SilentlyContinue
      throw "mock inference service exited early: $stderr"
    }
    throw "mock inference service did not become ready (is Flask installed?)"
  }
  Write-Host "PASS: mock inference service is healthy"
  if (-not (Wait-HttpReady -url "http://127.0.0.1:9100/healthz" -timeoutSec 20)) {
    if ($mockLlm.HasExited) {
      $stderr = Get-Content -Path $mockLlm.StdErrLog -Raw -ErrorAction SilentlyContinue
      throw "mock llm service exited early: $stderr"
    }
    throw "mock llm service did not become ready (is Flask installed?)"
  }
  Write-Host "PASS: mock llm service is healthy"
  if (-not (Wait-HttpReady -url "http://127.0.0.1:8080/healthz" -timeoutSec 50)) {
    if ($proxy.HasExited) {
      $stderr = Get-Content -Path $proxy.StdErrLog -Raw -ErrorAction SilentlyContinue
      throw "viper proxy exited early: $stderr"
    }
    throw "viper proxy did not become ready in time"
  }
  Write-Host "PASS: proxy is healthy"

  Write-Host "PASS: local end-to-end validation complete"

  Write-Host "Start UI:"
  Write-Host "  cd apps/analytics-ui"
  Write-Host "  npm install"
  Write-Host "  npm run dev"
  Write-Host "  Open http://localhost:3000"
}
finally {
  if ($proxy -and -not $proxy.HasExited) { Stop-Process -Id $proxy.Id -Force }
  if ($mockLlm -and -not $mockLlm.HasExited) { Stop-Process -Id $mockLlm.Id -Force }
  if ($inference -and -not $inference.HasExited) { Stop-Process -Id $inference.Id -Force }
}
