# Production Release Checklist

## Build and Test Gates
- CI is green for Go, Python, UI build, and Terraform validate.
- `go test -race ./...` passes for proxy.
- Python service tests pass under `services/*/tests`.

## Security and Config Gates
- No high-severity `npm audit` findings.
- Production config validation passes with required env and secret inputs.
- Debug endpoints disabled in production (`VIPER_ALLOW_DEBUG_EVENTS=false`).

## Deployment Gates
- Terraform plan reviewed by at least one engineer.
- Deploy workflow health verification succeeds.
- Post-deploy `/metrics` and `/healthz/public` checks are green.

## Post-Release
- Confirm alarms are quiet or acknowledged.
- Update changelog and incident notes if any degradation occurred.
