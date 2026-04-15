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

# Start mock inference service
$inference = Start-Process python -ArgumentList "services/mock-inference/server.py" -PassThru
Start-Sleep -Seconds 1

# Start mock llm upstream
$mockLlm = Start-Process python -ArgumentList "services/mock-llm/server.py" -PassThru
Start-Sleep -Seconds 1

# Configure proxy env
$env:VIPER_UPSTREAM_URL = "http://localhost:9100"
$env:VIPER_LOG_BUCKET = "local-test-bucket"
$env:VIPER_LOG_REGION = "us-east-1"
$env:VIPER_MODEL_PATH = "$root/apps/viper-proxy/models/distilbert.onnx"
$env:VIPER_ONNX_ENDPOINT = "http://localhost:9000/infer"
$env:VIPER_SCANNER_FAIL_OPEN = "true"
$env:VIPER_STREAM_TERMINATE_ON_LEAK = "false"
$env:VIPER_WAL_PATH = "$root/var/logs/viper.wal"

# Ensure model file exists for startup check
New-Item -ItemType Directory -Force -Path "$root/apps/viper-proxy/models" | Out-Null
if (-not (Test-Path "$root/apps/viper-proxy/models/distilbert.onnx")) {
  New-Item -ItemType File -Path "$root/apps/viper-proxy/models/distilbert.onnx" | Out-Null
}

# Start proxy
$proxy = Start-Process go -ArgumentList "run ./cmd/viper-proxy" -WorkingDirectory "$root/apps/viper-proxy" -PassThru

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
  if (-not (Wait-HttpReady -url "http://localhost:9000/healthz" -timeoutSec 20)) {
    throw "mock inference service did not become ready (is Flask installed?)"
  }
  if (-not (Wait-HttpReady -url "http://localhost:9100/healthz" -timeoutSec 20)) {
    throw "mock llm service did not become ready (is Flask installed?)"
  }
  if (-not (Wait-HttpReady -url "http://localhost:8080/healthz" -timeoutSec 50)) {
    throw "viper proxy did not become ready in time"
  }

  $health = Invoke-WebRequest -Uri "http://localhost:8080/healthz"
  Write-Host "Proxy health: $($health.StatusCode)"

  $body = @{ prompt = "hello world"; stream = $true } | ConvertTo-Json
  $resp = Invoke-WebRequest -Uri "http://localhost:8080/v1/chat/completions" -Method Post -Body $body -ContentType "application/json"
  $text = $resp.Content
  if ($text -match "admin@example.com") {
    throw "FAIL: email not redacted"
  }
  if ($text -match "token=abcd1234efgh5678") {
    throw "FAIL: token not redacted"
  }
  Write-Host "PASS: streaming leak redaction works"

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
