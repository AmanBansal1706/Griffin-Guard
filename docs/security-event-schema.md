# Security Event Schema v5.0

```json
{
  "timestamp": "2026-04-15T10:20:30Z",
  "request_id": "uuid",
  "tenant_id": "tenant-1",
  "user_id": "user-42",
  "method": "POST",
  "path": "/v1/chat/completions",
  "upstream": "https://api.openai.com",
  "input_score": 0.91,
  "input_blocked": true,
  "output_leak": false,
  "leak_types": [],
  "action": "block_input",
  "status_code": 403,
  "latency_ms": 8,
  "policy_version": "v5.0",
  "reason_code": "input_threat_threshold_exceeded",
  "rule_id": "input-score-threshold",
  "decision_source": "input-scanner",
  "failure_mode": "",
  "pii_tag": "SAFE",
  "risk_score": 0,
  "source_hash": "sha256"
}
```

All producers and consumers must preserve forward compatibility by ignoring unknown keys.
