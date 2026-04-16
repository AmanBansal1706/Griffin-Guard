# Rollback and Deployment Verification Runbook

## Preconditions
- Latest Terraform plan artifact is available and reviewed.
- `Deploy Prod` workflow has `healthcheck_url` configured.
- On-call engineer is present during apply.

## Verification Steps
1. Confirm `/healthz/public` reports `"degraded": false`.
2. Confirm `/metrics` counters are increasing for `requests_total`.
3. Validate no sustained ECS CPU/memory alarms are firing.
4. Execute a canary request and verify expected policy decision logging.

## Rollback Steps
1. Re-run deploy workflow with the previous known-good image tag.
2. Apply last known-good Terraform plan if infra drift caused failure.
3. Disable traffic at upstream caller if health remains degraded.
4. Post rollback verification: repeat health and metrics checks.

## Incident Notes
- Capture failure start/end times, blast radius, and root cause hypothesis.
- Link logs, alarms, and workflow run URL in incident document.
