$ErrorActionPreference = "Stop"

Write-Host "=== Griffin Guard live demo bootstrap ==="

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python not found in PATH"
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  throw "go not found in PATH"
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

$env:VIPER_UPSTREAM_URL = "http://127.0.0.1:9100"
$env:VIPER_LOG_SINK = "local"
$env:VIPER_LOCAL_LOG_PATH = "$root/var/logs/events.local.jsonl"
$env:VIPER_MODEL_PATH = "$root/apps/viper-proxy/models/distilbert.onnx"
$env:VIPER_ONNX_ENDPOINT = "http://127.0.0.1:9000/infer"
$env:VIPER_SCANNER_FAIL_OPEN = "true"
$env:VIPER_STREAM_TERMINATE_ON_LEAK = "false"
$env:VIPER_WAL_PATH = "$root/var/logs/viper.wal"
$env:VIPER_ALLOW_DEBUG_EVENTS = "true"
$env:VIPER_DEBUG_EVENTS_TOKEN = "demo-token"
$env:VIPER_DEBUG_EVENTS_ALLOW_ORIGIN = "http://localhost:3000"

New-Item -ItemType Directory -Force -Path "$root/apps/viper-proxy/models" | Out-Null
if (-not (Test-Path "$root/apps/viper-proxy/models/distilbert.onnx")) {
  New-Item -ItemType File -Path "$root/apps/viper-proxy/models/distilbert.onnx" | Out-Null
}

Write-Host "Starting mock inference service on :9000"
Start-Process python -ArgumentList "services/mock-inference/server.py" -WorkingDirectory $root | Out-Null
Start-Sleep -Seconds 1

Write-Host "Starting mock LLM service on :9100"
Start-Process python -ArgumentList "services/mock-llm/server.py" -WorkingDirectory $root | Out-Null
Start-Sleep -Seconds 1

Write-Host "Starting viper proxy on :8080"
Start-Process go -ArgumentList "run ./cmd/viper-proxy" -WorkingDirectory "$root/apps/viper-proxy" | Out-Null

Write-Host ""
Write-Host "Demo services started."
Write-Host "1) Verify health:"
Write-Host "   Invoke-WebRequest http://localhost:8080/healthz | Select-Object -ExpandProperty Content"
Write-Host "2) Generate one incident request:"
Write-Host "   Invoke-WebRequest -Uri http://localhost:8080/v1/chat/completions -Method Post -Body '{""prompt"":""hello"",""stream"":true}' -ContentType 'application/json'"
Write-Host "3) Start UI in new terminal:"
Write-Host "   cd apps/analytics-ui"
Write-Host "   `$env:NEXT_PUBLIC_PROXY_EVENTS_URL='http://localhost:8080/debug/events'"
Write-Host "   `$env:NEXT_PUBLIC_PROXY_EVENTS_TOKEN='demo-token'"
Write-Host "   npm install"
Write-Host "   npm run dev"
Write-Host "4) Open http://localhost:3000 and show incident feed / redact_stream rows."
Write-Host ""
Write-Host "To stop everything, close started terminals or kill python/go processes."
