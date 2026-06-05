# Griffin Guard – AI Security Gateway

Griffin Guard is an AI Security Gateway and semantic firewall for LLM traffic. It sits in front of large language models to:

- enforce input threat controls (prompt abuse, jailbreak attempts)
- prevent sensitive data leaks in streamed outputs
- capture rich security telemetry for analytics and auditing

## Architecture Overview

- `apps/viper-proxy`: Go reverse proxy with input/output security enforcement, streaming DLP and structured decision logging.
- `services/pii-lambda`: S3-triggered Python Lambda for PII tagging, risk scoring, and DLQ handling.
- `services/parquet-compactor`: Batch job that compacts tagged JSON events into Parquet for analytics.
- `apps/analytics-ui`: Next.js 15 + DuckDB-Wasm dashboard for real-time and historical security analytics.
- `infra/terraform`: AWS ECS Fargate, S3 data lake, CloudWatch alarms, and deployment infrastructure.

## Features

- Inline input classification and policy-based blocking for risky prompts.
- Streaming output inspection with redaction/termination for sensitive leaks.
- Resilient logging pipeline with WAL, async S3 writes, and DLQs.
- Production-grade CI/CD (Go/Python/Next.js/Terraform) with health-gated deploys.
- Minimal, analytics-focused UI for request explorer, trends, and incidents.

## Quick Start – Proxy

1. Configure environment:
   - `VIPER_UPSTREAM_URL` – LLM endpoint (e.g. OpenAI-compatible proxy).
   - `VIPER_LOG_BUCKET` – S3 bucket for raw security events.
   - AWS credentials with access to the log bucket.
2. From `apps/viper-proxy`:
   - `go run ./cmd/viper-proxy`
3. Send traffic to:
   - `http://localhost:8080`

## Local End-to-End Test

Prerequisites: Go 1.23+, Python 3.11, Node 20+.

From repo root in PowerShell:

- `.\scripts\test-end-to-end.ps1`

The script starts:

- mock ONNX inference service (`http://localhost:9000`)
- mock LLM upstream (`http://localhost:9100`)
- Viper proxy (`http://localhost:8080`)

Then it verifies local service health and runs integration redaction checks.

## Running the Analytics UI

1. `cd apps/analytics-ui`
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000` (or the port printed by Next.js) to view the Griffin Guard analytics dashboard.

The dashboard shows:

- KPIs for total/blocked requests, leak events, and latency.
- Time-series trends for blocked traffic.
- A request explorer with filters and CSV export.
- An incident feed and request detail drawer for investigations.

## Local Interview Demo

### Step 1: Run smoke e2e and show PASS

From repo root in PowerShell:

- `.\scripts\test-end-to-end.ps1`

Expected checkpoints:

- `PASS: mock inference service is healthy`
- `PASS: mock llm service is healthy`
- `PASS: proxy is healthy`
- `PASS: local end-to-end validation complete`

### Step 2: Start live demo services

From repo root in PowerShell:

- `.\scripts\demo-live.ps1`

Then open:

- `http://localhost:8080/healthz`

Explain health fields:

- `degraded`: true means scanner/logger path is partially degraded.
- `scanner_ready`: scanner endpoint state (or allowed by fail-open).
- `logger_ready`: async logging queue health.

### Step 3: Start UI with live proxy events

In a new PowerShell terminal:

1. `cd apps/analytics-ui`
2. `$env:NEXT_PUBLIC_PROXY_EVENTS_URL='http://localhost:8080/debug/events'`
3. `$env:NEXT_PUBLIC_PROXY_EVENTS_TOKEN='demo-token'`
4. `npm install`
5. `npm run dev`
6. Open `http://localhost:3000`

### Step 4: Show incident and redact_stream in dashboard

Generate live traffic:

- `Invoke-WebRequest -Uri http://localhost:8080/v1/chat/completions -Method Post -Body '{"prompt":"hello","stream":true}' -ContentType 'application/json'`

In dashboard show:

- Live Incident Feed has non-allow decision rows.
- Request Explorer shows `redact_stream` actions.

### Troubleshooting

- `python not found` or services fail to start: install Python 3.11+ and Flask.
- `debug endpoint disabled` or `unauthorized`: ensure `VIPER_ALLOW_DEBUG_EVENTS=true` and token matches `NEXT_PUBLIC_PROXY_EVENTS_TOKEN`.
- UI stays stale: confirm URL is `http://localhost:8080/debug/events` and browser can access proxy.
- Port conflicts on `8080`, `9100`, `9000`: stop old processes and rerun scripts.
