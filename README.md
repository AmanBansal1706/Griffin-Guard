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

Then it sends a streaming request and verifies that sensitive data is redacted and events are logged.

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
