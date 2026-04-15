# Griffin Guard - ViperGo v5.0

ViperGo is an AI Security Gateway and Semantic Firewall for LLM traffic.

## Services
- `apps/viper-proxy`: Go reverse proxy with input/output security enforcement.
- `services/pii-lambda`: S3-triggered Python Lambda for PII severity tagging.
- `services/parquet-compactor`: Hourly JSON-to-Parquet compaction job.
- `apps/analytics-ui`: Next.js + DuckDB-Wasm analytics dashboard.
- `infra/terraform`: AWS ECS Fargate, S3 data lake, deployment infrastructure.

## Quick Start
1. Configure `VIPER_UPSTREAM_URL`, `VIPER_LOG_BUCKET`, and AWS credentials.
2. Run `go run ./cmd/viper-proxy` from `apps/viper-proxy`.
3. Send traffic to `http://localhost:8080`.

## Local End-To-End Test
- Prerequisites: Go 1.23+, Python 3.11, Node 20+.
- Run from repo root in PowerShell:
  - `.\scripts\test-end-to-end.ps1`
- This script starts:
  - mock ONNX inference service (`http://localhost:9000`)
  - mock LLM upstream (`http://localhost:9100`)
  - Viper proxy (`http://localhost:8080`)
- It then sends a streaming request and verifies sensitive data is redacted.

## UI Run
- `cd apps/analytics-ui`
- `npm install`
- `npm run dev`
- Open `http://localhost:3000`
