# Weekly Production Readiness Metrics

Track these every week to measure hardening progress and production fitness.

## Reliability
- Availability SLO (% healthy checks / total checks).
- P95 and P99 latency (ms) from proxy metrics.
- Error rate (% of non-2xx responses).

## Security
- Total blocked requests (`block_input` actions).
- Output leak detections and stream terminations.
- False-positive rate from sampled decision reviews.

## Data Pipeline
- Event-to-curated freshness (minutes).
- PII Lambda processing errors and DLQ volume.
- Compactor partition status counts (`ok`, `empty`, `incomplete`, `exists`).

## Delivery
- Change failure rate (failed deploys / total deploys).
- Mean time to recovery (MTTR).
- Rollback duration and frequency.
