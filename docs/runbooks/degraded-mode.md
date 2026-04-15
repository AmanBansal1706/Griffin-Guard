# Degraded Mode Runbook

## ONNX Runtime Failure
- Set scanner status to degraded.
- Continue forwarding requests if `VIPER_SCANNER_FAIL_OPEN=true`.
- Alert on `scanner_unavailable` metric.
- If `VIPER_SCANNER_FAIL_OPEN=false`, return `503` and page on-call immediately.

## S3 Outage
- Enqueue to WAL only.
- Keep serving proxy traffic.
- Replay WAL when S3 recovers.
- If WAL exceeds local disk threshold, enable breaker and drop non-critical logs.

## Lambda Outage
- Continue writing raw logs.
- Trigger backfill tagging job once Lambda is healthy.
- Verify no parquet compaction jobs consume untagged data unexpectedly.

## Full Pipeline Outage
- Preserve proxy service availability.
- Mark observability as degraded in health dashboards.
- Trigger incident severity SEV-2 and begin 15-minute status updates.
