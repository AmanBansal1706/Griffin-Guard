# Griffin Guard — Complete Project Guide

> **Purpose of this document:** One place to understand the entire Griffin Guard (AI Security Gateway) project — architecture, code paths, every important value, how to demo it, how it is tested, and what is honestly implemented vs planned.

---

## Table of Contents

1. [What Is Griffin Guard?](#1-what-is-griffin-guard)
2. [Problem It Solves](#2-problem-it-solves)
3. [High-Level Design (HLD)](#3-high-level-design-hld)
4. [Low-Level Design (LLD)](#4-low-level-design-lld)
5. [Repository Structure](#5-repository-structure)
6. [Tech Stack and Why](#6-tech-stack-and-why)
7. [All Configuration Values](#7-all-configuration-values)
8. [Security Policy (v5.0)](#8-security-policy-v50)
9. [Security Event Schema](#9-security-event-schema)
10. [Request Lifecycle (Step by Step)](#10-request-lifecycle-step-by-step)
11. [Component Deep Dive — Viper Proxy (Go)](#11-component-deep-dive--viper-proxy-go)
12. [Component Deep Dive — Python Pipeline](#12-component-deep-dive--python-pipeline)
13. [Component Deep Dive — Analytics UI](#13-component-deep-dive--analytics-ui)
14. [Mock Services (Local Test Bed)](#14-mock-services-local-test-bed)
15. [Testing Strategy](#15-testing-strategy)
16. [CI/CD and Infrastructure](#16-cicd-and-infrastructure)
17. [Demo Guide (Interview)](#17-demo-guide-interview)
18. [Failure Scenarios and Degraded Mode](#18-failure-scenarios-and-degraded-mode)
19. [Trade-offs and Design Decisions](#19-trade-offs-and-design-decisions)
20. [Honest Gaps (What Is NOT Claimed)](#20-honest-gaps-what-is-not-claimed)
21. [Interview Quick Answers](#21-interview-quick-answers)

---

## 1. What Is Griffin Guard?

**Griffin Guard** is an **AI Security Gateway** (also described as a semantic firewall for LLM traffic).

It sits **in front of** large language model APIs and:

- **Scores and blocks** risky input prompts (prompt injection / jailbreak style threats)
- **Scans streaming LLM output** for sensitive data leaks (email, phone, API keys, credit-card-like patterns)
- **Redacts or terminates** streams when leaks are detected
- **Logs every security decision** as structured JSON events for audit and analytics
- **Exposes a dashboard** to visualize incidents, trends, and request details

**Policy version in code:** `v5.0`

---

## 2. Problem It Solves

Companies want to use LLMs, but they need:

| Need | How Griffin Guard Helps |
|------|-------------------------|
| Block malicious prompts | Input threat scoring + threshold-based blocking |
| Prevent data leaks in responses | Streaming output DLP (regex detectors) |
| Audit trail | Structured security events with action, reason, latency |
| Visibility | Analytics dashboard (KPIs, incident feed, explorer) |
| Resilience | Async logging, WAL, circuit breaker — proxy stays up |

---

## 3. High-Level Design (HLD)

### 3.1 Three Planes

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY / DATA PLANE (runtime)               │
│  Client → Viper Proxy (Go) → ONNX Inference → Upstream LLM      │
│              ↓ streaming back                                    │
│         Output DLP (redact/terminate)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TELEMETRY / ANALYTICS PLANE                     │
│  Async Queue → Sink (Local JSONL or S3) → WAL on failure        │
│  [Cloud] S3 raw → PII Lambda → tagged JSON → Compactor → Parquet│
│  Live feed (/debug/events) → Analytics UI (DuckDB-Wasm)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                                   │
│  GitHub Actions CI, Terraform (ECS/S3/CloudWatch), Runbooks     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Main Components

| Component | Path | Role |
|-----------|------|------|
| **Viper Proxy** | `apps/viper-proxy` | Go reverse proxy — core enforcement |
| **PII Lambda** | `services/pii-lambda` | S3-triggered tagging + risk scoring |
| **Parquet Compactor** | `services/parquet-compactor` | Hourly batch → curated Parquet |
| **Analytics UI** | `apps/analytics-ui` | Next.js 15 + DuckDB-Wasm dashboard |
| **Mock Inference** | `services/mock-inference` | Local ONNX substitute (:9000) |
| **Mock LLM** | `services/mock-llm` | Local upstream with leak chunks (:9100) |
| **Terraform** | `infra/terraform` | ECS Fargate, S3 data lake, alarms |
| **Scripts** | `scripts/` | E2E smoke + live demo automation |

### 3.3 Ports (Local Demo)

| Service | Port | URL |
|---------|------|-----|
| Viper Proxy | **8080** | `http://localhost:8080` |
| Mock ONNX Inference | **9000** | `http://localhost:9000/infer` |
| Mock LLM Upstream | **9100** | `http://localhost:9100` |
| Analytics UI | **3000** | `http://localhost:3000` |

### 3.4 Security Actions (Outcomes)

Every request ends in one of these **actions**:

| Action | HTTP | Meaning |
|--------|------|---------|
| `allow` | 2xx from upstream | Passed input scan; no output leak (or clean stream) |
| `block_input` | **403** | Input threat score > threshold |
| `redact_stream` | Upstream status | Leak found; sensitive values masked in stream |
| `terminate_stream` | Upstream status (stream cut) | Leak found; stream stopped early |

---

## 4. Low-Level Design (LLD)

### 4.1 Proxy Bootstrap (`cmd/viper-proxy/main.go`)

```
config.Load() → Validate()
  → NewWAL(WALPath)
  → newLogSink() → LocalWriter OR S3Writer
  → NewQueue(size, workers, sink, wal) → ReplayWAL()
  → NewONNXEngine(modelPath, endpoint)
  → NewClassifier(tokenizer, engine)
  → NewGateway(upstream, classifier, threshold, queue, terminateOnLeak, scannerFailOpen)
  → HTTP mux routes
  → server.Start()
  → on SIGINT/SIGTERM → server.Stop() + queue.Close()
```

### 4.2 HTTP Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | * | Gateway (via RequestGuard + Recovery) |
| `/healthz` | GET | Full health (operator view) |
| `/healthz/public` | GET | Health without queue depth/capacity |
| `/healthz/operator` | GET | Same as `/healthz` |
| `/metrics` | GET | JSON metrics snapshot |
| `/debug/events` | GET, OPTIONS | Live event feed (dev/demo only) |

### 4.3 Health Status Fields

```json
{
  "proxy_ready": true,
  "scanner_ready": true,
  "logger_ready": true,
  "degraded": false,
  "queue_depth": 0,
  "queue_capacity": 1000,
  "version": "v5.0"
}
```

**Degraded logic:**
- `degraded = NOT scanner_ready OR NOT logger_ready`
- `scanner_ready = engine.IsReady() OR VIPER_SCANNER_FAIL_OPEN`
- `logger_ready = circuit breaker allows OR queue not full`

Returns **503** if any of `proxy_ready`, `scanner_ready`, or `logger_ready` is false.

### 4.4 Package Map (Go Proxy)

| Package | File(s) | Responsibility |
|---------|---------|----------------|
| `internal/config` | `config.go` | Env-based configuration + validation |
| `internal/proxy` | `reverse_proxy.go` | Request orchestration |
| `internal/security/input` | `tokenizer.go`, `onnx_engine.go`, `classifier.go` | Input threat scoring |
| `internal/security/output` | `detectors.go`, `redactor.go`, `stream_interceptor.go` | Streaming DLP |
| `internal/logging` | `queue.go`, `wal.go`, `s3_writer.go`, `local_writer.go`, `live_feed.go`, `circuit_breaker.go` | Event pipeline |
| `internal/middleware` | `request_guard.go`, `recovery.go` | Size limits, content-type, panic recovery |
| `internal/health` | `health.go` | Health JSON handler |
| `internal/metrics` | `metrics.go` | In-memory counters |
| `internal/server` | `server.go` | HTTP server lifecycle |

---

## 5. Repository Structure

```
Griffin Guard/
├── apps/
│   ├── viper-proxy/              # Go security gateway (core)
│   │   ├── cmd/viper-proxy/      # main.go, main_test.go
│   │   ├── internal/             # config, proxy, security, logging, etc.
│   │   ├── models/               # distilbert.onnx (placeholder for local demo)
│   │   └── tests/
│   │       ├── integration/      # redaction/termination tests
│   │       └── load/             # k6 scripts
│   └── analytics-ui/             # Next.js dashboard
│       ├── app/                  # page.tsx, layout, styles
│       ├── components/           # KPI, sidebar, drawer, UI primitives
│       └── lib/                  # duckdb.ts, queries.ts
├── services/
│   ├── mock-inference/           # Flask mock ONNX (:9000)
│   ├── mock-llm/                 # Flask mock upstream (:9100)
│   ├── pii-lambda/               # S3-triggered PII tagger
│   └── parquet-compactor/        # JSON → Parquet batch job
├── packages/
│   └── security-rules/
│       └── policy.yaml             # Policy documentation (NOT loaded at runtime)
├── infra/
│   ├── docker/viper-proxy.Dockerfile
│   └── terraform/
│       ├── environments/prod/
│       └── modules/ (ecs-viper-proxy, data-lake)
├── scripts/
│   ├── test-end-to-end.ps1       # Smoke validation
│   └── demo-live.ps1             # Long-running demo
├── docs/
│   ├── security-event-schema.md
│   ├── release-checklist.md
│   ├── production-metrics-weekly.md
│   └── runbooks/ (degraded-mode, rollback, secret-rotation)
└── .github/workflows/
    ├── ci.yml
    └── deploy-prod.yml
```

---

## 6. Tech Stack and Why

| Technology | Where Used | Why |
|------------|------------|-----|
| **Go 1.23** | Viper Proxy | Low latency, strong concurrency, good for streaming hot path |
| **Python 3.11** | Lambda, compactor, mocks | Fast for data/AWS tooling and local test doubles |
| **Flask** | Mock services | Lightweight HTTP servers for local test bed |
| **Next.js 15** | Analytics UI | Modern React framework, fast dev experience |
| **TypeScript 6** | Analytics UI | Type safety |
| **DuckDB-Wasm 1.29** | Analytics UI | SQL analytics in browser without backend query API |
| **Recharts 3.8** | Analytics UI | Charts for trends |
| **AWS SDK Go v2** | S3 writer | Cloud log sink |
| **Terraform >= 1.6** | Infra | Reproducible AWS deployment |
| **GitHub Actions** | CI/CD | Automated test/build/deploy gates |
| **k6** | Load tests | Performance smoke scenarios |
| **pytest / ruff** | Python tests | Regression for pipeline code |
| **Distroless Docker** | Proxy image | Minimal production container |

---

## 7. All Configuration Values

All runtime config is **environment variables** (see `apps/viper-proxy/internal/config/config.go`).

### 7.1 Server and Upstream

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_ENV` | `dev` | Environment name (`prod`/`production` triggers stricter validation) |
| `VIPER_LISTEN_ADDR` | `:8080` | Proxy listen address |
| `VIPER_UPSTREAM_URL` | `https://api.openai.com` | LLM upstream base URL |
| `VIPER_READ_TIMEOUT` | `15s` | HTTP read timeout |
| `VIPER_WRITE_TIMEOUT` | `65s` | HTTP write timeout |
| `VIPER_IDLE_TIMEOUT` | `120s` | HTTP idle timeout |

**Hardcoded in gateway (not env):**
- Upstream HTTP client timeout: **90 seconds**
- `MaxIdleConns`: **1024**
- `MaxIdleConnsPerHost`: **512**
- `IdleConnTimeout`: **90 seconds**
- Server shutdown timeout: **15 seconds**

### 7.2 Input Security

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_REQUEST_MAX_BYTES` | **1048576** (1 MiB = `1<<20`) | Max request body size |
| `VIPER_THREAT_SCORE_THRESHOLD` | **0.85** | Block if score exceeds this |
| `VIPER_MODEL_PATH` | `./models/distilbert.onnx` | Model file path (must exist on disk) |
| `VIPER_ONNX_ENDPOINT` | `""` (empty) | Inference HTTP endpoint; empty = scanner not ready |
| `VIPER_SCANNER_FAIL_OPEN` | `false` | If true, continue when scanner fails; if false → **503** |

**Tokenizer / classifier hardcoded values:**
- Max token length: **256**
- Token hash modulus: **30000**
- ONNX HTTP client timeout: **1200 ms** (1.2 seconds)
- Threat score valid range: **0.0 – 1.0**

### 7.3 Output Security

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_STREAM_TERMINATE_ON_LEAK` | `false` | `false` = redact; `true` = terminate stream |

**Stream interceptor hardcoded values:**
- Read chunk size: **1024 bytes**
- Rolling buffer max: **4096 bytes**
- Redact only if finding confidence >= **0.8**

### 7.4 Logging Pipeline

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_LOG_SINK` | `s3` | `s3` or `local` |
| `VIPER_LOG_BUCKET` | `vipergo-raw-logs` | S3 bucket (required when sink=s3) |
| `VIPER_LOG_REGION` | `us-east-1` | AWS region (required when sink=s3) |
| `VIPER_LOCAL_LOG_PATH` | `./var/logs/events.local.jsonl` | Local JSONL path (required when sink=local) |
| `VIPER_WAL_PATH` | `./var/logs/viper.wal` | Write-ahead log file |
| `VIPER_LOG_QUEUE_SIZE` | **1000** | Buffered channel capacity |
| `VIPER_LOG_WORKERS` | **20** | Async writer goroutines |
| `VIPER_LOGGER_FAIL_OPEN` | `false` | **Defined in config but NOT used in code** |

**Logging hardcoded values:**
- Circuit breaker threshold: **10 failures**
- Circuit breaker open window: **10 seconds**
- S3 PutObject retries: **3 attempts**
- S3 retry backoff: **200ms × (attempt+1)** (200ms, 400ms, 600ms)
- S3 key pattern: `year=YYYY/month=MM/day=DD/hour=HH/{nano}-{request_id}.json`
- Live event ring buffer cap: **5000 events**
- WAL drain poll interval: **10 ms**
- `BatchWindow()` helper: **750 ms** (defined, used for batching concept)

### 7.5 Debug / Demo Endpoints

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_ALLOW_DEBUG_EVENTS` | `false` | Enable `/debug/events` |
| `VIPER_DEBUG_EVENTS_TOKEN` | `""` | Required when debug enabled; checked via `X-Debug-Token` header |
| `VIPER_DEBUG_EVENTS_ALLOW_ORIGIN` | `*` | CORS origin for debug endpoint |
| `VIPER_DEBUG_EVENTS_MAX` | **500** | Max events returned in snapshot |

**Validation rules:**
- Debug events **forbidden** when `VIPER_ENV` is `prod` or `production`
- Token required when `VIPER_ALLOW_DEBUG_EVENTS=true`

### 7.6 Demo Script Values (`scripts/demo-live.ps1`)

```powershell
VIPER_UPSTREAM_URL          = http://127.0.0.1:9100
VIPER_LOG_SINK              = local
VIPER_LOCAL_LOG_PATH        = {repo}/var/logs/events.local.jsonl
VIPER_MODEL_PATH            = {repo}/apps/viper-proxy/models/distilbert.onnx
VIPER_ONNX_ENDPOINT         = http://127.0.0.1:9000/infer
VIPER_SCANNER_FAIL_OPEN     = true
VIPER_STREAM_TERMINATE_ON_LEAK = false
VIPER_WAL_PATH              = {repo}/var/logs/viper.wal
VIPER_ALLOW_DEBUG_EVENTS    = true
VIPER_DEBUG_EVENTS_TOKEN    = demo-token
VIPER_DEBUG_EVENTS_ALLOW_ORIGIN = http://localhost:3000
```

### 7.7 Analytics UI Environment

| Env Variable | Default in Code | Description |
|--------------|-----------------|-------------|
| `NEXT_PUBLIC_PROXY_EVENTS_URL` | `http://localhost:8080/debug/events` | Live events endpoint |
| `NEXT_PUBLIC_PROXY_EVENTS_TOKEN` | `""` | Token sent as `X-Debug-Token` |
| `NEXT_PUBLIC_CURATED_PARQUET_URL` | `""` | Optional Parquet URL for historical data |

**UI polling:** refreshes every **10 seconds** when browser tab is visible.

### 7.8 PII Lambda Environment

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_TAGGED_BUCKET` | `""` | Destination bucket for tagged events |
| `VIPER_DLQ_BUCKET` | `""` | Dead-letter queue bucket |
| `VIPER_S3_MAX_RETRIES` | **3** | S3 operation retries |
| `VIPER_S3_RETRY_BASE_SECONDS` | **0.3** | Exponential backoff base |

### 7.9 Parquet Compactor Environment

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `VIPER_SOURCE_BUCKET` | (required) | Tagged JSON source bucket |
| `VIPER_CURATED_BUCKET` | (required) | Parquet output bucket |
| `VIPER_SOURCE_PREFIX` | `tagged/` | S3 prefix for tagged data |
| `VIPER_BACKFILL_HOURS` | **1** | Hours to compact per run |
| `VIPER_CHECKPOINT_BUCKET` | same as curated | Checkpoint storage |
| `VIPER_CHECKPOINT_KEY` | `compactor/checkpoint.json` | Checkpoint object key |
| `VIPER_MIN_PARTITION_RECORDS` | **1** | Min objects before compacting |

**Parquet compression:** Snappy

---

## 8. Security Policy (v5.0)

Documented in `packages/security-rules/policy.yaml`:

```yaml
version: v5.0
input:
  threat_score_threshold: 0.85
  fail_open: false
output:
  terminate_on_leak: false
  detectors:
    - email
    - phone
    - api_key
    - credit_card
logging:
  queue_size: 1000
  workers: 20
  fail_open: false
```

**Important:** This YAML is **documentation only**. Runtime behavior is driven by **environment variables**, not by loading this file.

---

## 9. Security Event Schema

### 9.1 Go Event Struct (`internal/logging/types.go`)

| Field | JSON Key | Type | Notes |
|-------|----------|------|-------|
| Timestamp | `timestamp` | time | UTC |
| RequestID | `request_id` | string | UUID per request |
| TenantID | `tenant_id` | string | Optional — **often not populated by proxy** |
| UserID | `user_id` | string | Optional — **often not populated by proxy** |
| Method | `method` | string | HTTP method |
| Path | `path` | string | Request path |
| Upstream | `upstream` | string | Upstream base URL |
| InputScore | `input_score` | float64 | Threat score 0–1 |
| InputBlocked | `input_blocked` | bool | true if blocked at input |
| OutputLeak | `output_leak` | bool | true if leak detected in output |
| LeakTypes | `leak_types` | []string | e.g. `email`, `api_key` |
| Action | `action` | string | `allow`, `block_input`, `redact_stream`, `terminate_stream` |
| StatusCode | `status_code` | int | HTTP status |
| LatencyMs | `latency_ms` | int64 | End-to-end proxy latency |
| PolicyVersion | `policy_version` | string | Always `v5.0` in code |
| ReasonCode | `reason_code` | string | See below |
| RuleID | `rule_id` | string | e.g. `input-score-threshold` |
| DecisionSource | `decision_source` | string | `input-scanner` or `output-stream-scanner` |
| FailureMode | `failure_mode` | string | Optional |
| AdditionalData | `additional_data` | map | Optional |

### 9.2 Reason Codes

| Action | Reason Code |
|--------|-------------|
| `block_input` | `input_threat_threshold_exceeded` |
| `redact_stream` | `output_sensitive_leak_redacted` |
| `terminate_stream` | `output_sensitive_leak_terminated` |
| `allow` | `policy_allow` |

### 9.3 Rule IDs

| Path | Rule ID |
|------|---------|
| Input block | `input-score-threshold` |
| Output DLP | `output-stream-dlp` |

### 9.4 Extended Schema (Pipeline — after Lambda)

Lambda adds: `pii_tag`, `pii_entities`, `risk_score`, `source_hash`

**PII tag severity (Lambda):**
- `SAFE` — risk_score < 20
- `RED_FLAG` — risk_score >= 20
- `CRITICAL` — risk_score >= 50

**Risk score weights (Lambda tagging.py):**
- EMAIL: +20
- PHONE: +20
- CREDIT_CARD: +40
- TOKEN (API key): +50

---

## 10. Request Lifecycle (Step by Step)

### Phase A — Ingress (Middleware)

1. Request hits `Recovery` → `RequestGuard` → `Gateway`
2. If `Content-Length` > **1 MiB** → **413** `payload too large`
3. For POST/PUT/PATCH: Content-Type must contain `application/json` or `text/event-stream`; else **415**
4. Body wrapped with `http.MaxBytesReader`

### Phase B — Input Security

5. Read full request body into memory
6. Generate `request_id` (UUID)
7. **Classifier.Score(ctx, body)**:
   - Tokenize: lowercase words → FNV-style hash → `input_ids` + `attention_mask` (max **256** tokens, cached)
   - POST to `VIPER_ONNX_ENDPOINT` with JSON `{input_ids, attention_mask}`
   - Expect `{threat_score: 0.0–1.0}` within **1.2s**
8. If scanner error AND `VIPER_SCANNER_FAIL_OPEN=false` → **503** `scanner unavailable`
9. If `score > 0.85` (threshold):
   - **403** with message `blocked due to threat score X > Y`
   - Event: action=`block_input`, status=403
   - Enqueue + PublishLiveEvent → **return** (no upstream call)

### Phase C — Upstream Forward

10. Build upstream URL (preserve path + query)
11. Clone request headers (auth headers pass through unchanged)
12. `http.Client.Do` (90s timeout)
13. Upstream error → **502** `upstream unavailable`

### Phase D — Output Security (Streaming)

14. Copy response headers, write upstream status code
15. **InterceptAndWrite** loop:
    - Read up to **1024 bytes** per chunk
    - Append to rolling buffer; trim to last **4096 bytes**
    - **Detect()** on rolling text
    - If findings:
      - Mark `AnyLeakSeen`, collect leak types
      - If `terminateOnLeak` → break (Terminated=true)
      - Else **Redact** chunk (confidence >= 0.8)
    - Write chunk to client; flush if SSE flusher available
16. Map result:
    - No leak → `allow`
    - Leak + redact → `redact_stream`
    - Leak + terminate → `terminate_stream`

### Phase E — Telemetry

17. Build Event struct with all fields
18. `queue.Enqueue(event)`:
    - Queue closed → WAL append
    - Channel full → increment dropped counter, WAL append
    - Else worker processes
19. Worker:
    - Circuit breaker open → WAL append
    - Sink write success → breaker reset
    - Sink write fail → breaker failure++, WAL append
20. `PublishLiveEvent(event)` for `/debug/events`

---

## 11. Component Deep Dive — Viper Proxy (Go)

### 11.1 Input Detectors (Output DLP — Regex)

| Type | Confidence | Severity | Pattern Summary |
|------|------------|----------|-----------------|
| `email` | **0.92** | red_flag | Standard email regex |
| `phone` | **0.82** | red_flag | Phone with optional `+`, 8+ chars |
| `api_key` | **0.97** | critical | `(api_key\|token\|secret)= value` 12+ chars |
| `credit_card` | **0.95** | critical | 13–16 digit groups with spaces/dashes |

Redaction mask format: `[REDACTED_EMAIL]`, `[REDACTED_API_KEY]`, etc.

### 11.2 Metrics Snapshot (`/metrics`)

| Metric | Description |
|--------|-------------|
| `requests_total` | Total requests processed |
| `requests_blocked_total` | Input blocks |
| `scanner_failures_total` | Scanner errors (503 path) |
| `upstream_failures_total` | Upstream 502 path |
| `output_leaks_total` | Leaks detected |
| `stream_terminations_total` | Streams terminated |
| `decisions_by_action` | Count per action |
| `status_by_class` | Count per 2xx/3xx/4xx/5xx |
| `avg_latency_ms` | total_latency_ms / requests_total |

### 11.3 Allowed Content Types

- `application/json`
- `text/event-stream`

---

## 12. Component Deep Dive — Python Pipeline

### 12.1 Data Flow (Cloud Design)

```
Proxy → S3 raw bucket (year=.../month=.../day=.../hour=.../*.json)
  → S3 event triggers PII Lambda
  → Lambda reads raw JSON, tags PII, writes to tagged/ prefix
  → Compactor reads tagged/ hourly partitions
  → Writes curated/ Parquet (Snappy)
  → UI can load Parquet via NEXT_PUBLIC_CURATED_PARQUET_URL
```

### 12.2 PII Lambda Behavior

- Idempotent: skips if tagged object already exists (`head_object` check)
- Retries S3 ops with exponential backoff (base 0.3s, max 3 retries)
- On failure: writes to DLQ bucket with error details
- Target key: replaces first `year=` with `tagged/year=`

### 12.3 Compactor Status Values

| Status | Meaning |
|--------|---------|
| `empty` | No records in hour partition |
| `incomplete` | Below `MIN_PARTITION_RECORDS` |
| `exists` | Parquet already written (idempotent) |
| `ok` | Successfully compacted |

---

## 13. Component Deep Dive — Analytics UI

### 13.1 Stack

- Next.js **15.0.0**, React **18.3.1**, TypeScript **6.0.2**
- DuckDB-Wasm **1.29.0**, Recharts **3.8.1**

### 13.2 Dashboard Sections

| Section | SQL Template | Shows |
|---------|--------------|-------|
| Overview KPIs | `overview` | total_requests, blocked_requests, leak_events, avg_latency_ms |
| Threat Trends | `attackTrends` | blocked count by hour |
| Leak Frequency | `leakFrequency` | leak type counts |
| Provider Risk | `providerRisk` | avg input_score by upstream |
| User Behavior | `userBehavior` | requests/blocks by user_id |
| Critical Incidents | `criticalIncidents` | CRITICAL tag or terminate_stream |
| Decision Feed | `decisionFeed` | Last 100 decisions |

### 13.3 UI Features

- KPI cards, line/bar charts, incident feed (non-allow actions, max 8)
- Request explorer with search, action filter, severity filter
- Pagination (default **10 rows/page**)
- Request detail drawer (Escape to close)
- Light/dark theme toggle
- CSV export capability
- Live vs stale data source indicator
- Decision reason text (uses threshold **0.85** in UI copy)

### 13.4 Demo Seed Data (when no Parquet/live)

| request_id | action | input_score | pii_tag |
|------------|--------|-------------|---------|
| demo-1 | allow | 0.12 | SAFE |
| demo-2 | block_input | 0.93 | RED_FLAG |
| demo-3 | redact_stream | 0.44 | CRITICAL |

Live events default `pii_tag` to **SAFE** (Lambda tagging not in live proxy path).

---

## 14. Mock Services (Local Test Bed)

### 14.1 Mock Inference (`services/mock-inference/server.py`)

- **Port:** 9000
- **POST /infer:** Computes threat_score from input_ids:
  - token % 17 == 0 → +0.08
  - token % 7 == 0 → +0.02
  - capped at **0.99**
- **GET /healthz:** `{ok: true}`

### 14.2 Mock LLM (`services/mock-llm/server.py`)

- **Port:** 9100
- **POST /v1/chat/completions:**
  - If `stream=false`: JSON echo response
  - If `stream=true` (default): SSE chunks with **intentional leaks**:
    1. `"Hello from mock model. "`
    2. `"Contact: admin@example.com "` ← triggers email redaction
    3. `"token=abcd1234efgh5678"` ← triggers api_key redaction
  - 200ms delay between chunks
- **GET /healthz:** `{ok: true}`

---

## 15. Testing Strategy

### 15.1 Go Tests (`apps/viper-proxy`)

| Test File | What It Validates |
|-----------|-------------------|
| `internal/config/config_test.go` | Threshold validation, prod debug rejection, local sink, unknown sink |
| `cmd/viper-proxy/main_test.go` | Debug token auth, CORS preflight, local sink wiring |
| `tests/integration/failure_modes_test.go` | Email/api_key redaction, stream termination mode |

**CI runs:** `go fmt`, `go vet`, `go test ./...`, `go test -race ./...`

### 15.2 Python Tests

| Test File | What It Validates |
|-----------|-------------------|
| `services/pii-lambda/tests/test_handler.py` | Idempotency, retry, DLQ, empty records |
| `services/parquet-compactor/tests/test_compactor.py` | S3 iteration, run summary |

**CI runs:** `ruff check`, `py_compile`, `pytest`

### 15.3 Analytics UI Tests

- `npm run test` → `tsc --noEmit` (type check)
- `npm run build` with ESLint disabled in CI

### 15.4 E2E Script (`scripts/test-end-to-end.ps1`)

**What it does:**
1. Kills processes on ports 8080, 9000, 9100
2. Starts mock inference, mock LLM, proxy (with local sink)
3. Waits for health on all three (timeout: inference 20s, LLM 20s, proxy 50s)
4. Prints PASS checkpoints
5. Tears down processes in `finally` block

**PASS messages:**
- `PASS: mock inference service is healthy`
- `PASS: mock llm service is healthy`
- `PASS: proxy is healthy`
- `PASS: local end-to-end validation complete`

**Honest note:** Script validates **health/readiness**, not full streaming redaction assertion in PowerShell (redaction proven via Go integration tests + manual curl).

### 15.5 Load Tests (k6)

**smoke.js:**
- 20 VUs, 2 minutes
- Target: `/healthz/public`
- Thresholds: fail rate < 1%, p95 < 1200ms, p99 < 2000ms

**sse_load_test.js:**
- 500 VUs, 2 minutes
- POST `/v1/chat/completions`
- Thresholds: fail rate < 1%, p95 < 250ms

**Honest note:** Harness and scenarios exist; large-scale production benchmarking is a planned next phase.

### 15.6 Automation Framework Summary (For JD)

- **Test-bed:** Repeatable 3-service local environment (mock inference + mock LLM + proxy)
- **Orchestration:** PowerShell scripts (`test-end-to-end.ps1`, `demo-live.ps1`)
- **Regression:** Go tests, Python tests, CI gates on every PR/push
- **Performance:** k6 scripts with defined thresholds; failure-mode validation in Go

---

## 16. CI/CD and Infrastructure

### 16.1 CI Pipeline (`.github/workflows/ci.yml`)

| Job | Steps |
|-----|-------|
| `proxy` | go fmt, vet, test, race test (Go 1.23) |
| `python-services` | ruff, py_compile, pytest (Python 3.11) |
| `analytics-ui` | npm install, audit (high), tsc, build (Node 20) |
| `terraform-validate` | terraform init (no backend), validate |

Triggers: push to `main`, pull requests.

### 16.2 Deploy Prod (`.github/workflows/deploy-prod.yml`)

- Manual `workflow_dispatch`
- Inputs: `healthcheck_url` (required), `expected_version` (optional)
- Plan → upload artifact → apply (production environment gate)
- Post-apply: curl health up to 20 retries (10s apart)
- Asserts: `degraded == false`, optional version match

### 16.3 Terraform — ECS Proxy

- Cluster: `vipergo-prod`
- Fargate: **1024 CPU**, **2048 MB** memory
- Container port: **8080**
- Desired count: **2**
- Env: `VIPER_LOG_BUCKET`, `VIPER_UPSTREAM_URL`, `VIPER_ENV=production`
- Secrets injected from AWS Secrets Manager ARNs map

### 16.4 Terraform — Data Lake

- Raw + curated S3 buckets with versioning enabled
- SSE: AES256 on both buckets
- S3 notification: Lambda on `year=` prefix ObjectCreated events

### 16.5 CloudWatch Alarms

| Alarm | Threshold | Period |
|-------|-----------|--------|
| ECS high CPU | > **80%** | 60s × 5 evaluation periods |
| ECS high memory | > **85%** | 60s × 5 evaluation periods |

### 16.6 Docker

- Multi-stage build: golang:1.23 → distroless/base-debian12
- `CGO_ENABLED=0` static binary
- Exposes port **8080**

---

## 17. Demo Guide (Interview)

### Step 1 — Smoke Test

```powershell
.\scripts\test-end-to-end.ps1
```

Expect 4 PASS lines.

### Step 2 — Start Live Demo

```powershell
.\scripts\demo-live.ps1
```

Verify: `Invoke-WebRequest http://localhost:8080/healthz`

### Step 3 — Start UI (new terminal)

```powershell
cd apps/analytics-ui
$env:NEXT_PUBLIC_PROXY_EVENTS_URL='http://localhost:8080/debug/events'
$env:NEXT_PUBLIC_PROXY_EVENTS_TOKEN='demo-token'
npm install
npm run dev
```

Open: `http://localhost:3000`

### Step 4 — Trigger Traffic

```powershell
Invoke-WebRequest -Uri http://localhost:8080/v1/chat/completions -Method Post -Body '{"prompt":"hello","stream":true}' -ContentType 'application/json'
```

### Step 5 — Show in Dashboard

- Live Incident Feed: non-allow rows (`redact_stream`)
- Request Explorer: filtered by action
- Explain health: `degraded`, `scanner_ready`, `logger_ready`

### Prerequisites

- Go **1.23+**
- Python **3.11+** with Flask
- Node **20+**

---

## 18. Failure Scenarios and Degraded Mode

| Scenario | Behavior | Config |
|----------|----------|--------|
| **ONNX down** | 503 if fail-closed; forward if fail-open | `VIPER_SCANNER_FAIL_OPEN` |
| **ONNX timeout** | Same as above (>1.2s) | — |
| **Upstream timeout/error** | 502, no event for successful forward | 90s client timeout |
| **Sink down (S3/local fail)** | WAL append, circuit breaker opens after 10 failures | — |
| **Queue full** | Drop to WAL, increment dropped counter | queue size 1000 |
| **Queue closed (shutdown)** | WAL append | — |
| **Circuit breaker open** | 10s window, events go to WAL | 10 failures threshold |
| **Panic in handler** | 500, logged stack trace | Recovery middleware |
| **Payload too large** | 413 | 1 MiB limit |
| **Bad content-type** | 415 | POST/PUT/PATCH only |
| **Debug endpoint disabled** | 404 | `VIPER_ALLOW_DEBUG_EVENTS=false` |
| **Wrong debug token** | 401 | constant-time compare |

**WAL replay:** On startup, replays WAL entries through sink; successful writes removed, failures kept.

See also: `docs/runbooks/degraded-mode.md`

---

## 19. Trade-offs and Design Decisions

### 19.1 Regex DLP vs NER/LLM Classifier

| | Regex (current) | NER/ML (future) |
|--|-----------------|-----------------|
| **Pros** | Fast, deterministic, cheap, easy to debug | Better context, fewer false positives |
| **Cons** | Misses nuanced PII, cross-format gaps | Higher latency, cost, complexity |
| **Why now** | MVP streaming redaction with predictable behavior | Planned upgrade path |

### 19.2 Local Sink vs S3

| | Local | S3 |
|--|-------|-----|
| **Use** | Demo, dev, no AWS | Production telemetry |
| **Pros** | Zero cloud deps, reproducible | Durable, triggers Lambda pipeline |
| **Cons** | No multi-node durability | Needs AWS creds |

### 19.3 Async Logging

- **Pro:** LLM response not blocked on storage I/O
- **Con:** Event may lag slightly; WAL handles durability

### 19.4 Full Body Read (Input)

- **Pro:** Simple scoring on complete prompt
- **Con:** Not suitable for huge payloads (mitigated by 1 MiB limit)

### 19.5 Env Config vs policy.yaml

- **Pro:** 12-factor, easy container/ECS deployment
- **Con:** YAML documents intent but isn't loaded — **known gap**

---

## 20. Honest Gaps (What Is NOT Claimed)

Do **NOT** claim these unless you actually did them:

| Gap | Truth |
|-----|-------|
| Production enterprise rollout | Architecture exists; local demo is primary proof |
| Large-scale perf numbers | k6 harness exists; full benchmark not completed |
| ~80% incident reduction | Not in repo |
| 100% WAL recovery proven at scale | WAL logic exists; not load-proven |
| `<5%` broken rollouts | Not measured |
| `policy.yaml` loaded at runtime | **Env vars only** |
| `VIPER_LOGGER_FAIL_OPEN` | **Defined but unused in code** |
| `tenant_id` / `user_id` in events | Schema supports; proxy often doesn't populate |
| Live UI `pii_tag` | Defaults to SAFE; Lambda tagging is pipeline step |
| E2E script redaction assert | Health checks only in PS1; redaction in Go tests |
| Real ONNX model inference | Mock service used locally; model file is placeholder |
| S3 pipeline in local demo | Uses `VIPER_LOG_SINK=local` |

**Safe claims:**
- Working gateway with input block + output redact/terminate
- Repeatable test-bed and CI
- Structured events + dashboard
- Resilience patterns (queue, WAL, circuit breaker)
- Cloud infra defined in Terraform

---

## 21. Interview Quick Answers

### “Explain your project in 30 seconds”

> Griffin Guard is an AI security gateway I built in Go. It sits in front of LLM APIs, scores input prompts for threats, blocks risky ones, and scans streaming output for sensitive data like emails and API keys — redacting or stopping the stream. Every decision is logged as structured JSON, and a Next.js dashboard with DuckDB shows incidents and trends. I test it with a repeatable local test-bed, automated Go/Python tests, and CI.

### “What tech stack and why?”

> Go for the hot-path proxy, Python for the data pipeline, Next.js and DuckDB-Wasm for analytics, Terraform and GitHub Actions for infra and CI. I split real-time enforcement from data processing so latency stays low.

### “Have you tested it / do you use it personally?”

> Yes — I built a repeatable test-bed with mock inference, mock LLM, and the proxy, plus Go and Python automated tests and CI. I run it locally for development and demos. It's not my daily ChatGPT replacement, and I haven't completed large-scale production benchmarking yet — that's the next phase.

### “What happens when ONNX is down?”

> Configurable: fail-closed returns 503, fail-open continues forwarding. Health marks scanner as not ready and overall degraded.

### “What happens when S3/logging fails?”

> Events spill to WAL, circuit breaker opens after 10 failures for 10 seconds, proxy keeps serving traffic. WAL replays on startup.

### “Why regex for DLP?”

> Fast MVP for streaming with deterministic behavior. Upgrade path is hybrid regex + ML/NER for precision.

---

## Appendix A — Key File Reference

| Topic | File |
|-------|------|
| Config defaults | `apps/viper-proxy/internal/config/config.go` |
| Request flow | `apps/viper-proxy/internal/proxy/reverse_proxy.go` |
| Input scoring | `apps/viper-proxy/internal/security/input/` |
| Output DLP | `apps/viper-proxy/internal/security/output/` |
| Logging pipeline | `apps/viper-proxy/internal/logging/` |
| Main bootstrap | `apps/viper-proxy/cmd/viper-proxy/main.go` |
| UI data sync | `apps/analytics-ui/lib/duckdb.ts` |
| SQL queries | `apps/analytics-ui/lib/queries.ts` |
| Demo script | `scripts/demo-live.ps1` |
| E2E script | `scripts/test-end-to-end.ps1` |
| Policy doc | `packages/security-rules/policy.yaml` |
| Event schema doc | `docs/security-event-schema.md` |

---

## Appendix B — Quick Command Reference

```powershell
# E2E smoke
.\scripts\test-end-to-end.ps1

# Live demo (keeps running)
.\scripts\demo-live.ps1

# Proxy tests
cd apps/viper-proxy; go test ./...

# Python tests
pytest services/pii-lambda/tests services/parquet-compactor/tests

# UI dev
cd apps/analytics-ui; npm run dev

# Trigger test request
Invoke-WebRequest -Uri http://localhost:8080/v1/chat/completions -Method Post -Body '{"prompt":"hello","stream":true}' -ContentType 'application/json'

# Health check
Invoke-WebRequest http://localhost:8080/healthz

# Metrics
Invoke-WebRequest http://localhost:8080/metrics
```

---

*Document generated from Griffin Guard codebase. All numeric values match source code as of project state.*
